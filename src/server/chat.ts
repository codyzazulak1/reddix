import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { z } from "zod";
import type {
  ChatConversation,
  ChatInbox,
  ChatMessage,
  ChatThread,
} from "@/lib/chat-types";
import type { Member, PublicMember } from "@/lib/types";
import { ensureDatabase, sql } from "./db";
import {
  DomainError,
  isFreshEligible,
  requireEligible,
  requireOnboarded,
} from "./domain";
import { iso, memberFromRow, publicMember } from "./members";

const id = z.string().min(1).max(100);
const body = z
  .string()
  .trim()
  .min(1, "Write a message before sending.")
  .max(4000, "Messages can contain up to 4,000 characters.");
export const chatActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("request"),
      recipientId: id,
      body,
      clientId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("send"),
      conversationId: id,
      body,
      clientId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.enum(["accept", "decline", "block"]),
      conversationId: id,
    })
    .strict(),
  z
    .object({ action: z.literal("read"), conversationId: id, messageId: id })
    .strict(),
]);

const notFound = () =>
  new DomainError(
    "RESOURCE_NOT_FOUND",
    "That conversation is unavailable.",
    404,
  );
const unavailable = () =>
  new DomainError("CHAT_UNAVAILABLE", "You cannot message this member.", 403);
const closed = () =>
  new DomainError(
    "CHAT_CLOSED",
    "This conversation is closed. You cannot send another request.",
    409,
  );
const pending = () =>
  new DomainError(
    "REQUEST_PENDING",
    "Wait for your message request to be accepted before sending more.",
    409,
  );
const conflict = () =>
  new DomainError(
    "IDEMPOTENCY_CONFLICT",
    "This message ID was already used. Refresh and try again.",
    409,
  );

async function actor(tx: TransactionSql, member: Member): Promise<Member> {
  const [row] = await tx`SELECT * FROM users WHERE id=${member.id} FOR SHARE`;
  if (!row) throw new DomainError("AUTH_REQUIRED", "Sign in to use chat.", 401);
  const fresh = memberFromRow(row);
  requireOnboarded(fresh);
  return fresh;
}

// Every writer locks both user rows before the pair/conversation. Account
// deletion locks its user first, so neither path can resurrect private content.
async function lockPair(tx: TransactionSql, member: Member, peerId: string) {
  if (member.id === peerId)
    throw new DomainError(
      "VALIDATION_ERROR",
      "Choose another member to message.",
      422,
    );
  const rows =
    await tx`SELECT * FROM users WHERE id IN (${member.id},${peerId}) ORDER BY id FOR SHARE`;
  const own = rows.find((row) => row.id === member.id);
  if (!own) throw new DomainError("AUTH_REQUIRED", "Sign in to use chat.", 401);
  const fresh = memberFromRow(own);
  requireOnboarded(fresh);
  const peer = rows.find((row) => row.id === peerId);
  await tx`SELECT pg_advisory_xact_lock(hashtextextended('chat-pair:'||least(${member.id}::text,${peerId}::text)||'|'||greatest(${member.id}::text,${peerId}::text),0))`;
  return { fresh, peer: peer ? memberFromRow(peer) : null };
}

function peerAvailable(peer: Member | null): peer is Member {
  return (
    !!peer &&
    !peer.isBot &&
    peer.status === "active" &&
    !!peer.admittedAt &&
    !!peer.onboardingCompletedAt
  );
}

async function isBlocked(tx: TransactionSql, memberId: string, peerId: string) {
  const [row] =
    await tx`SELECT 1 FROM blocks WHERE (user_id=${memberId} AND blocked_id=${peerId}) OR (user_id=${peerId} AND blocked_id=${memberId}) LIMIT 1`;
  return !!row;
}

async function rateLimit(
  tx: TransactionSql,
  memberId: string,
  kind: string,
  seconds: number,
  limit: number,
) {
  const key = `chat:${memberId}:${kind}`;
  const [row] = await tx`INSERT INTO rate_limits(key,count) VALUES(${key},1)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.window_start<now()-(${seconds} * interval '1 second') THEN 1 ELSE rate_limits.count+1 END,
    window_start=CASE WHEN rate_limits.window_start<now()-(${seconds} * interval '1 second') THEN now() ELSE rate_limits.window_start END RETURNING count`;
  if (Number(row.count) > limit)
    throw new DomainError(
      "RATE_LIMITED",
      kind.startsWith("requests")
        ? "You've sent several message requests. Please try again later."
        : "You're sending messages too quickly. Try again in a minute.",
      429,
    );
}

function messageFromRow(row: Record<string, unknown>): ChatMessage {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    senderId: String(row.sender_id),
    sequence: String(row.sequence),
    body: String(row.body),
    createdAt: iso(row.created_at),
  };
}

function conversationFromRow(
  row: Record<string, unknown>,
  member: Member,
): ChatConversation {
  const peer = memberFromRow(row.peer as Record<string, unknown>);
  const blocked = Boolean(row.blocked);
  const status = row.status as ChatConversation["status"];
  return {
    id: String(row.id),
    peer: publicMember(peer),
    status,
    direction: row.requester_id === member.id ? "outgoing" : "incoming",
    lastMessage: row.last_created_at
      ? {
          body: String(row.last_body),
          createdAt: iso(row.last_created_at),
          senderId: String(row.last_sender_id),
        }
      : null,
    unreadCount:
      status === "accepted" && !blocked ? Number(row.unread_count ?? 0) : 0,
    canSend:
      status === "accepted" &&
      !blocked &&
      isFreshEligible(member) &&
      peerAvailable(peer),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    isBlocked: blocked,
  };
}

async function conversationRows(
  tx: TransactionSql,
  member: Member,
  conversationId: string | null = null,
  group: "requests" | "conversations" | null = null,
) {
  return tx`SELECT c.*,to_jsonb(peer) AS peer,
    EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=${member.id} AND b.blocked_id=peer.id) OR (b.user_id=peer.id AND b.blocked_id=${member.id})) AS blocked,
    latest.body AS last_body,latest.created_at AS last_created_at,latest.sender_id AS last_sender_id,
    (SELECT count(*)::int FROM chat_messages m WHERE m.conversation_id=c.id AND m.sender_id<>${member.id}
      AND m.sequence>CASE WHEN c.requester_id=${member.id} THEN c.requester_read_sequence ELSE c.recipient_read_sequence END) AS unread_count
    FROM chat_conversations c JOIN users peer ON peer.id=CASE WHEN c.requester_id=${member.id} THEN c.recipient_id ELSE c.requester_id END
    LEFT JOIN LATERAL (SELECT left(body,240) AS body,created_at,sender_id FROM chat_messages WHERE conversation_id=c.id ORDER BY sequence DESC LIMIT 1) latest ON true
    WHERE (c.requester_id=${member.id} OR c.recipient_id=${member.id})
      AND (${conversationId}::text IS NULL OR c.id=${conversationId})
      AND (${conversationId}::text IS NOT NULL OR c.status<>'closed' OR c.accepted_at IS NOT NULL OR c.requester_id=${member.id})
      AND (${group}::text IS NULL OR (${group}='requests' AND c.status='pending' AND c.recipient_id=${member.id})
        OR (${group}='conversations' AND NOT (c.status='pending' AND c.recipient_id=${member.id})))
    ORDER BY c.updated_at DESC,c.id DESC LIMIT 200`;
}

export async function getChatInbox(member: Member): Promise<ChatInbox> {
  await ensureDatabase();
  return sql.begin(async (tx) => {
    const fresh = await actor(tx, member);
    const requests = (await conversationRows(tx, fresh, null, "requests")).map(
      (row) => conversationFromRow(row, fresh),
    );
    const conversations = (
      await conversationRows(tx, fresh, null, "conversations")
    ).map((row) => conversationFromRow(row, fresh));
    return {
      conversations,
      requests,
      unreadCount: await unreadCount(tx, fresh.id),
    };
  });
}

async function unreadCount(tx: TransactionSql, memberId: string) {
  const [unread] =
    await tx`SELECT count(*)::int AS count FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id
    WHERE c.status='accepted' AND (c.requester_id=${memberId} OR c.recipient_id=${memberId}) AND m.sender_id<>${memberId}
    AND m.sequence>CASE WHEN c.requester_id=${memberId} THEN c.requester_read_sequence ELSE c.recipient_read_sequence END
    AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=c.requester_id AND b.blocked_id=c.recipient_id) OR (b.user_id=c.recipient_id AND b.blocked_id=c.requester_id))`;
  return Number(unread.count);
}

export async function getChatSummary(member: Member) {
  await ensureDatabase();
  return sql.begin(async (tx) => {
    const fresh = await actor(tx, member);
    return { unreadCount: await unreadCount(tx, fresh.id) };
  });
}

export async function getChatThread(
  member: Member,
  conversationId: string,
  before?: string | null,
): Promise<ChatThread> {
  id.parse(conversationId);
  if (before) id.parse(before);
  await ensureDatabase();
  return sql.begin(async (tx) => {
    const fresh = await actor(tx, member);
    const [row] = await conversationRows(tx, fresh, conversationId);
    if (!row) throw notFound();
    let sequence: string | null = null;
    if (before) {
      const [cursor] =
        await tx`SELECT sequence FROM chat_messages WHERE id=${before} AND conversation_id=${conversationId}`;
      if (!cursor)
        throw new DomainError(
          "INVALID_CURSOR",
          "That message page is unavailable. Refresh the conversation.",
          422,
        );
      sequence = String(cursor.sequence);
    }
    const rows =
      await tx`SELECT id,conversation_id,sender_id,sequence,body,created_at FROM chat_messages WHERE conversation_id=${conversationId}
      AND (${sequence}::bigint IS NULL OR sequence<${sequence}::bigint) ORDER BY sequence DESC LIMIT 51`;
    const hasMore = rows.length > 50;
    const messages = rows.slice(0, 50).reverse().map(messageFromRow);
    return {
      conversation: conversationFromRow(row, fresh),
      messages,
      hasMore,
      nextCursor: hasMore ? messages[0].id : null,
    };
  });
}

export async function findChatMembers(
  member: Member,
  input: { q?: string | null; id?: string | null },
): Promise<{ members: PublicMember[] }> {
  const query = z
    .string()
    .trim()
    .max(80)
    .parse(input.q ?? "");
  const memberId = input.id ? id.parse(input.id) : null;
  await ensureDatabase();
  return sql.begin(async (tx) => {
    const fresh = await actor(tx, member);
    if (!memberId && query.length < 2) return { members: [] };
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const rows =
      await tx`SELECT * FROM users u WHERE u.id<>${fresh.id} AND u.is_bot=false AND u.status='active' AND u.admitted_at IS NOT NULL AND u.onboarding_completed_at IS NOT NULL
      AND ((${memberId}::text IS NOT NULL AND u.id=${memberId}) OR (${memberId}::text IS NULL AND (u.name ILIKE ${pattern} OR u.handle ILIKE ${pattern})))
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=${fresh.id} AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=${fresh.id}))
      ORDER BY u.followers_count DESC,u.id LIMIT 20`;
    return { members: rows.map((row) => publicMember(memberFromRow(row))) };
  });
}

export async function performChatAction(
  member: Member,
  input: unknown,
): Promise<{ conversationId: string; messageId?: string }> {
  const data = chatActionSchema.parse(input);
  await ensureDatabase();
  return sql.begin(async (tx) => {
    // Resolve only caller-owned conversations before discovering or locking a
    // peer. An outsider sees the same 404 for missing and existing IDs.
    let existing: Record<string, unknown> | undefined;
    let peerId: string;
    if (data.action === "request") peerId = data.recipientId;
    else {
      [existing] =
        await tx`SELECT * FROM chat_conversations WHERE id=${data.conversationId} AND (requester_id=${member.id} OR recipient_id=${member.id})`;
      if (!existing) throw notFound();
      peerId = String(
        existing.requester_id === member.id
          ? existing.recipient_id
          : existing.requester_id,
      );
    }
    const { fresh, peer } = await lockPair(tx, member, peerId);
    if (data.action === "request" || data.action === "send")
      requireEligible(fresh);
    if (data.action === "request" || data.action === "send")
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`chat-client:${fresh.id}:${data.clientId}`},0))`;
    const [thread] =
      await tx`SELECT * FROM chat_conversations WHERE member_low=least(${fresh.id}::text,${peerId}::text) AND member_high=greatest(${fresh.id}::text,${peerId}::text) FOR UPDATE`;
    if (
      data.action !== "request" &&
      (!thread || thread.id !== data.conversationId)
    )
      throw notFound();

    if (data.action === "request" || data.action === "send") {
      const [replay] =
        await tx`SELECT m.*,c.requester_id,c.recipient_id FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id WHERE m.sender_id=${fresh.id} AND m.client_id=${data.clientId}`;
      if (replay) {
        const sameConversation =
          data.action === "request"
            ? replay.requester_id === fresh.id &&
              replay.recipient_id === peerId &&
              thread?.id === replay.conversation_id
            : replay.conversation_id === data.conversationId;
        if (!sameConversation || replay.body !== data.body) throw conflict();
        return {
          conversationId: String(replay.conversation_id),
          messageId: String(replay.id),
        };
      }
      if (!peerAvailable(peer) || (await isBlocked(tx, fresh.id, peerId)))
        throw unavailable();
      if (thread?.status === "closed") throw closed();
      if (data.action === "request" && thread) {
        if (thread.status === "pending") throw pending();
        throw new DomainError(
          "CONVERSATION_EXISTS",
          "You already have a conversation with this member. Open it from Chats.",
          409,
        );
      }
      if (data.action === "send" && thread.status !== "accepted")
        throw pending();
      if (data.action === "request") {
        await rateLimit(tx, fresh.id, "requests-hour", 3600, 5);
        await rateLimit(tx, fresh.id, "requests-day", 86400, 20);
      } else await rateLimit(tx, fresh.id, "messages-minute", 60, 60);
      const conversationId = thread ? String(thread.id) : randomUUID();
      if (!thread)
        await tx`INSERT INTO chat_conversations(id,requester_id,recipient_id) VALUES(${conversationId},${fresh.id},${peerId})`;
      const messageId = randomUUID();
      await tx`INSERT INTO chat_messages(id,conversation_id,sender_id,client_id,body) VALUES(${messageId},${conversationId},${fresh.id},${data.clientId},${data.body})`;
      await tx`UPDATE chat_conversations SET updated_at=now() WHERE id=${conversationId}`;
      return { conversationId, messageId };
    }

    const conversationId = String(thread.id);
    if (data.action === "block") {
      await tx`INSERT INTO blocks(user_id,blocked_id) VALUES(${fresh.id},${peerId}) ON CONFLICT DO NOTHING`;
      await tx`UPDATE chat_conversations SET status='closed',updated_at=now() WHERE id=${conversationId}`;
      return { conversationId };
    }
    if (data.action === "read") {
      if (thread.status !== "accepted")
        throw new DomainError(
          "REQUEST_PENDING",
          "Only accepted conversations have unread messages.",
          409,
        );
      const [message] =
        await tx`SELECT sequence FROM chat_messages WHERE id=${data.messageId} AND conversation_id=${conversationId}`;
      if (!message) throw notFound();
      await tx`UPDATE chat_conversations SET
        requester_read_sequence=CASE WHEN requester_id=${fresh.id} THEN greatest(requester_read_sequence,${message.sequence}::bigint) ELSE requester_read_sequence END,
        recipient_read_sequence=CASE WHEN recipient_id=${fresh.id} THEN greatest(recipient_read_sequence,${message.sequence}::bigint) ELSE recipient_read_sequence END WHERE id=${conversationId}`;
      return { conversationId };
    }
    if (thread.recipient_id !== fresh.id)
      throw new DomainError(
        "FORBIDDEN",
        "Only the recipient can decide a message request.",
        403,
      );
    if (data.action === "accept") {
      if (thread.status === "accepted") return { conversationId };
      if (thread.status === "closed") throw closed();
      if (!peerAvailable(peer) || (await isBlocked(tx, fresh.id, peerId)))
        throw unavailable();
      await tx`UPDATE chat_conversations SET status='accepted',accepted_at=now(),updated_at=now() WHERE id=${conversationId}`;
    } else {
      if (thread.status === "accepted")
        throw new DomainError(
          "REQUEST_DECIDED",
          "This request was already accepted. Block this member to stop messages.",
          409,
        );
      await tx`UPDATE chat_conversations SET status='closed',updated_at=now() WHERE id=${conversationId}`;
    }
    return { conversationId };
  });
}
