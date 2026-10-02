import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Member } from "../src/lib/types";
import { sql } from "../src/server/db";
import { getMemberById } from "../src/server/members";
import {
  findChatMembers,
  getChatInbox,
  getChatThread,
  performChatAction,
} from "../src/server/chat";
import { performAction } from "../src/server/actions";
import {
  createDevelopmentSession,
  DEV_COOKIE,
  ensureAuthDatabase,
} from "../src/lib/auth-store";
import { deleteAccount, exportAccount } from "../src/lib/account-service";
import {
  GET as inboxRoute,
  POST as writeRoute,
} from "../src/app/api/chat/route";
import { GET as threadRoute } from "../src/app/api/chat/[id]/route";

const prefix = `chat-test-${randomUUID()}`;
const memberIds: string[] = [];
const origin = "http://127.0.0.1:3000";

async function fixture(label: string, verified = true) {
  const id = `${prefix}-${label}`;
  memberIds.push(id);
  await sql`INSERT INTO users(id,x_id,name,handle,verification_type,verification_expires_at,admitted_at,onboarding_completed_at)
    VALUES(${id},${id},${label},${id},${verified ? "blue" : "none"},now()+interval '1 day',now(),now())`;
  return (await getMemberById(id))!;
}
async function request(
  sender: Member,
  recipient: Member,
  body = "Hello from the tech community.",
) {
  return performChatAction(sender, {
    action: "request",
    recipientId: recipient.id,
    body,
    clientId: randomUUID(),
  });
}
async function acceptedPair(label: string) {
  const sender = await fixture(`${label}-a`),
    recipient = await fixture(`${label}-b`);
  const created = await request(sender, recipient);
  await performChatAction(recipient, {
    action: "accept",
    conversationId: created.conversationId,
  });
  return { sender, recipient, ...created };
}
function apiRequest(
  path = "/api/chat",
  cookie?: string,
  data?: unknown,
  requestOrigin = origin,
) {
  return new Request(`${origin}${path}`, {
    method: data ? "POST" : "GET",
    headers: {
      Origin: requestOrigin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AUTH_MODE", "development");
  vi.stubEnv("AUTO_MIGRATE", "1");
  vi.stubEnv("X_CLIENT_ID", "");
  await ensureAuthDatabase();
}, 30000);

afterAll(async () => {
  if (memberIds.length) {
    await sql`DELETE FROM chat_conversations WHERE requester_id IN ${sql(memberIds)} OR recipient_id IN ${sql(memberIds)}`;
    await sql`DELETE FROM blocks WHERE user_id IN ${sql(memberIds)} OR blocked_id IN ${sql(memberIds)}`;
    await sql`DELETE FROM rate_limits WHERE key LIKE ${`chat:${prefix}%`} OR key LIKE ${`action:${prefix}%`}`;
    await sql`DELETE FROM auth_dev_sessions WHERE member_id IN ${sql(memberIds)}`;
    await sql`DELETE FROM auth_audit WHERE member_id IN ${sql(memberIds)}`;
    await sql`DELETE FROM audit_events WHERE actor_id IN ${sql(memberIds)}`;
    await sql`DELETE FROM users WHERE id IN ${sql(memberIds)}`;
  }
  vi.unstubAllEnvs();
});

describe("private chat requests and conversations", () => {
  it("keeps first contact quiet and requires recipient approval before any follow-up", async () => {
    const sender = await fixture("quiet-a"),
      recipient = await fixture("quiet-b");
    const { conversationId, messageId } = await request(sender, recipient);
    const inbox = await getChatInbox(recipient);
    expect(inbox.requests).toHaveLength(1);
    expect(inbox.conversations).toHaveLength(0);
    expect(inbox.unreadCount).toBe(0);
    expect(inbox.requests[0]).toMatchObject({
      direction: "incoming",
      status: "pending",
      canSend: false,
      unreadCount: 0,
    });
    expect((await getChatInbox(sender)).conversations[0].direction).toBe(
      "outgoing",
    );
    await expect(
      performChatAction(sender, {
        action: "send",
        conversationId,
        body: "Follow-up",
        clientId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "REQUEST_PENDING" });
    await expect(
      performChatAction(recipient, {
        action: "send",
        conversationId,
        body: "Unapproved reply",
        clientId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "REQUEST_PENDING" });
    await expect(
      performChatAction(sender, { action: "accept", conversationId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      performChatAction(recipient, {
        action: "read",
        conversationId,
        messageId,
      }),
    ).rejects.toMatchObject({ code: "REQUEST_PENDING" });
    await performChatAction(recipient, { action: "accept", conversationId });
    expect((await getChatInbox(recipient)).unreadCount).toBe(1);
    await performChatAction(recipient, {
      action: "send",
      conversationId,
      body: "Welcome!",
      clientId: randomUUID(),
    });
    const [notifications] =
      await sql`SELECT count(*)::int AS count FROM notifications WHERE user_id IN (${sender.id},${recipient.id})`;
    expect(notifications.count).toBe(0);
  });

  it("cannot expose a thread or mutate it as an outsider, and API routes reject missing auth and CSRF", async () => {
    const { sender, recipient, conversationId, messageId } =
      await acceptedPair("privacy");
    const outsider = await fixture("outsider");
    expect((await getChatInbox(outsider)).conversations).toEqual([]);
    await expect(getChatThread(outsider, conversationId)).rejects.toMatchObject(
      { code: "RESOURCE_NOT_FOUND" },
    );
    for (const action of ["accept", "decline", "block", "read", "send"])
      await expect(
        performChatAction(outsider, {
          action,
          conversationId,
          ...(action === "read" ? { messageId } : {}),
          ...(action === "send"
            ? { body: "Intrusion", clientId: randomUUID() }
            : {}),
        }),
      ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect((await inboxRoute(apiRequest())).status).toBe(401);
    expect(
      (
        await threadRoute(apiRequest(`/api/chat/${conversationId}`), {
          params: Promise.resolve({ id: conversationId }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await writeRoute(
          apiRequest("/api/chat", undefined, {
            action: "accept",
            conversationId,
          }),
        )
      ).status,
    ).toBe(401);
    const cookie = `${DEV_COOKIE}=${await createDevelopmentSession(recipient.id)}`;
    expect(
      (
        await writeRoute(
          apiRequest(
            "/api/chat",
            cookie,
            { action: "accept", conversationId },
            "https://attacker.invalid",
          ),
        )
      ).status,
    ).toBe(403);
    const result = await getChatThread(sender, conversationId);
    expect(Object.keys(result.conversation.peer)).not.toContain("xId");
    expect(Object.keys(result.conversation.peer)).not.toContain("preferences");
  });

  it("permanently closes declined requests and enforces bilateral blocks from both chat and profile actions", async () => {
    const sender = await fixture("decline-a"),
      recipient = await fixture("decline-b");
    const { conversationId } = await request(sender, recipient);
    await performChatAction(recipient, { action: "decline", conversationId });
    await expect(request(sender, recipient)).rejects.toMatchObject({
      code: "CHAT_CLOSED",
    });
    await expect(request(recipient, sender)).rejects.toMatchObject({
      code: "CHAT_CLOSED",
    });
    expect((await getChatInbox(recipient)).requests).toEqual([]);
    expect((await getChatInbox(recipient)).conversations).toEqual([]);
    const chat = await acceptedPair("block");
    await performChatAction(chat.recipient, {
      action: "block",
      conversationId: chat.conversationId,
    });
    for (const user of [chat.sender, chat.recipient]) {
      await expect(
        performChatAction(user, {
          action: "send",
          conversationId: chat.conversationId,
          body: "Blocked",
          clientId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "CHAT_UNAVAILABLE" });
      expect(
        (await getChatThread(user, chat.conversationId)).conversation,
      ).toMatchObject({ status: "closed", canSend: false, isBlocked: true });
    }
    expect(
      (await findChatMembers(chat.sender, { id: chat.recipient.id })).members,
    ).toEqual([]);
    expect(
      (await findChatMembers(chat.recipient, { id: chat.sender.id })).members,
    ).toEqual([]);
    const profile = await acceptedPair("profile-block");
    await performAction(profile.recipient, {
      action: "block",
      memberId: profile.sender.id,
    });
    expect(
      (await getChatThread(profile.sender, profile.conversationId)).conversation
        .status,
    ).toBe("closed");
    await performAction(profile.recipient, {
      action: "block",
      memberId: profile.sender.id,
      blocked: false,
    });
    await expect(
      request(profile.sender, profile.recipient),
    ).rejects.toMatchObject({ code: "CHAT_CLOSED" });
  });

  it("rechecks current verification and admission while permitting browse-only request decisions", async () => {
    const sender = await fixture("eligibility-a"),
      reader = await fixture("eligibility-reader", false);
    const { conversationId } = await request(sender, reader);
    await performChatAction(reader, { action: "accept", conversationId });
    await expect(
      performChatAction(reader, {
        action: "send",
        conversationId,
        body: "Browse-only",
        clientId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "VERIFICATION_REQUIRED" });
    await sql`UPDATE users SET verification_expires_at=now()-interval '1 second' WHERE id=${sender.id}`;
    await expect(
      performChatAction(sender, {
        action: "send",
        conversationId,
        body: "Expired",
        clientId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "VERIFICATION_REQUIRED" });
    expect(
      (await getChatThread(sender, conversationId)).conversation.canSend,
    ).toBe(false);
    await sql`UPDATE users SET status='suspended' WHERE id=${sender.id}`;
    await expect(getChatInbox(sender)).rejects.toMatchObject({
      code: "ACCOUNT_SUSPENDED",
    });
    expect((await findChatMembers(reader, { id: sender.id })).members).toEqual(
      [],
    );
    await performChatAction(reader, { action: "block", conversationId });
  });

  it("makes concurrent retries idempotent and permits only one first message across reciprocal requests", async () => {
    const sender = await fixture("retry-a"),
      recipient = await fixture("retry-b");
    const input = {
      action: "request",
      recipientId: recipient.id,
      body: "Only once",
      clientId: randomUUID(),
    };
    const [first, second] = await Promise.all([
      performChatAction(sender, input),
      performChatAction(sender, input),
    ]);
    expect(first).toEqual(second);
    expect(
      (await getChatThread(recipient, first.conversationId)).messages,
    ).toHaveLength(1);
    await expect(
      performChatAction(sender, { ...input, body: "Changed replay" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const another = await fixture("retry-other");
    await expect(
      performChatAction(sender, { ...input, recipientId: another.id }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const a = await fixture("reciprocal-a"),
      b = await fixture("reciprocal-b");
    const reciprocal = await Promise.allSettled([request(a, b), request(b, a)]);
    expect(
      reciprocal.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      reciprocal.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const cross = await fixture("cross-sender"),
      one = await fixture("cross-one"),
      two = await fixture("cross-two");
    const clientId = randomUUID();
    const differentPairs = await Promise.allSettled([
      performChatAction(cross, {
        action: "request",
        recipientId: one.id,
        body: "One key",
        clientId,
      }),
      performChatAction(cross, {
        action: "request",
        recipientId: two.id,
        body: "One key",
        clientId,
      }),
    ]);
    expect(
      differentPairs.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      differentPairs.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("preserves chronological pagination and only marks messages through the displayed ID", async () => {
    const { sender, recipient, conversationId, messageId } =
      await acceptedPair("pagination");
    for (let index = 0; index < 52; index++)
      await performChatAction(sender, {
        action: "send",
        conversationId,
        body: `Message ${index}`,
        clientId: randomUUID(),
      });
    const latest = await getChatThread(recipient, conversationId);
    expect(latest.messages).toHaveLength(50);
    expect(latest.messages[0].body).toBe("Message 2");
    expect(latest.messages[49].body).toBe("Message 51");
    expect(latest.hasMore).toBe(true);
    const older = await getChatThread(
      recipient,
      conversationId,
      latest.nextCursor,
    );
    expect(older.messages).toHaveLength(3);
    expect(older.messages[0].id).toBe(messageId);
    expect(older.hasMore).toBe(false);
    await performChatAction(recipient, {
      action: "read",
      conversationId,
      messageId: latest.messages[48].id,
    });
    expect((await getChatInbox(recipient)).unreadCount).toBe(1);
    await performChatAction(recipient, {
      action: "read",
      conversationId,
      messageId,
    });
    expect((await getChatInbox(recipient)).unreadCount).toBe(1);
    await performChatAction(recipient, {
      action: "send",
      conversationId,
      body: "Reply does not imply all prior messages were displayed",
      clientId: randomUUID(),
    });
    expect((await getChatInbox(recipient)).unreadCount).toBe(1);
    const others = await acceptedPair("cursor-other");
    await expect(
      getChatThread(recipient, conversationId, others.messageId),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(
      performChatAction(recipient, {
        action: "read",
        conversationId,
        messageId: others.messageId,
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("serializes decline and block against concurrent send attempts, with database enforcement", async () => {
    const sender = await fixture("race-pending-a"),
      recipient = await fixture("race-pending-b");
    const { conversationId } = await request(sender, recipient);
    const result = await Promise.allSettled([
      performChatAction(recipient, { action: "decline", conversationId }),
      performChatAction(sender, {
        action: "send",
        conversationId,
        body: "Cannot pass pending gate",
        clientId: randomUUID(),
      }),
    ]);
    expect(result[0].status).toBe("fulfilled");
    expect(result[1].status).toBe("rejected");
    expect((await getChatThread(sender, conversationId)).messages).toHaveLength(
      1,
    );
    await expect(
      sql`INSERT INTO chat_messages(id,conversation_id,sender_id,client_id,body) VALUES(${randomUUID()},${conversationId},${sender.id},${randomUUID()},'Raw bypass')`,
    ).rejects.toMatchObject({ code: "RX004" });
    const accepted = await acceptedPair("race-block");
    const outcomes = await Promise.allSettled([
      performAction(accepted.recipient, {
        action: "block",
        memberId: accepted.sender.id,
      }),
      performChatAction(accepted.sender, {
        action: "send",
        conversationId: accepted.conversationId,
        body: "Concurrent send",
        clientId: randomUUID(),
      }),
    ]);
    expect(outcomes[0].status).toBe("fulfilled");
    await expect(
      performChatAction(accepted.sender, {
        action: "send",
        conversationId: accepted.conversationId,
        body: "After block",
        clientId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CHAT_UNAVAILABLE" });
    expect(
      (await getChatThread(accepted.sender, accepted.conversationId))
        .conversation.status,
    ).toBe("closed");
  });

  it("caps request spam and rejects invalid client IDs and oversized or empty messages", async () => {
    const sender = await fixture("limits-sender"),
      recipient = await fixture("limits-recipient");
    for (const body of ["", "  ", "a".repeat(4001)])
      await expect(
        performChatAction(sender, {
          action: "request",
          recipientId: recipient.id,
          body,
          clientId: randomUUID(),
        }),
      ).rejects.toBeDefined();
    await expect(
      performChatAction(sender, {
        action: "request",
        recipientId: recipient.id,
        body: "Hello",
        clientId: "not-a-uuid",
      }),
    ).rejects.toBeDefined();
    await sql`INSERT INTO rate_limits(key,count) VALUES(${`chat:${sender.id}:requests-hour`},5)`;
    await expect(request(sender, recipient)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect((await getChatInbox(recipient)).requests).toEqual([]);
  });

  it("exports only participant chat data and erases private bodies even when public contributions are retained", async () => {
    const { sender, recipient, conversationId } = await acceptedPair("delete");
    await performChatAction(sender, {
      action: "send",
      conversationId,
      body: "Private owner secret",
      clientId: randomUUID(),
    });
    await performChatAction(recipient, {
      action: "send",
      conversationId,
      body: "Peer keeps this reply",
      clientId: randomUUID(),
    });
    const unrelated = await acceptedPair("unrelated");
    await performChatAction(unrelated.sender, {
      action: "send",
      conversationId: unrelated.conversationId,
      body: "Unrelated private secret",
      clientId: randomUUID(),
    });
    const exported = await exportAccount(sender);
    expect(exported.chat.messages).toHaveLength(3);
    expect(JSON.stringify(exported.chat)).toContain("Private owner secret");
    expect(JSON.stringify(exported.chat)).not.toContain(
      "Unrelated private secret",
    );
    const race = await Promise.allSettled([
      deleteAccount(sender, {
        confirmation: sender.handle,
        deleteContent: false,
      }),
      performChatAction(sender, {
        action: "send",
        conversationId,
        body: "Deletion race secret",
        clientId: randomUUID(),
      }),
    ]);
    expect(race[0].status).toBe("fulfilled");
    const retained = await getChatThread(recipient, conversationId);
    expect(retained.conversation).toMatchObject({
      status: "closed",
      canSend: false,
    });
    expect(
      retained.messages
        .filter((message) => message.senderId === sender.id)
        .every((message) => message.body === ""),
    ).toBe(true);
    expect(
      retained.messages.find((message) => message.senderId === recipient.id)
        ?.body,
    ).toBe("Peer keeps this reply");
    await expect(getChatInbox(sender)).rejects.toMatchObject({
      code: "ADMISSION_REQUIRED",
    });
  });
});
