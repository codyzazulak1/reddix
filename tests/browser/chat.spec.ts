import { createHash, randomBytes, randomUUID } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";
import {
  expect,
  test as base,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

config({ path: ".env.local", quiet: true });

type ChatMember = {
  id: string;
  name: string;
  handle: string;
  context: BrowserContext;
  page: Page;
};
type ChatPeople = {
  sender: ChatMember;
  recipient: ChatMember;
  stranger: ChatMember;
};

const test = base.extend<{ people: ChatPeople }>({
  people: async ({ browser, baseURL }, use) => {
    // These fixtures never modify the seeded development personas or their chats.
    expect(["localhost", "127.0.0.1"]).toContain(new URL(baseURL!).hostname);
    const databaseURL =
      process.env.DATABASE_URL ?? "postgresql://reddix@127.0.0.1:55432/reddix";
    expect(["localhost", "127.0.0.1"]).toContain(new URL(databaseURL).hostname);
    const sql = postgres(databaseURL, { max: 1, onnotice: () => {} });
    const prefix = `browser-chat-${randomUUID()}`;
    const members: ChatMember[] = [];
    const ids = ["sender", "recipient", "stranger"].map(
      (role) => `${prefix}-${role}`,
    );
    try {
      for (const [index, role] of [
        "sender",
        "recipient",
        "stranger",
      ].entries()) {
        const id = ids[index];
        const name = `Chat ${role} ${prefix.slice(-8)}`;
        const handle = `chat_${role}_${prefix.slice(-8)}`;
        await sql`INSERT INTO users(id,x_id,name,handle,verification_type,verification_checked_at,verification_expires_at,admitted_at,onboarding_completed_at)
          VALUES(${id},${id},${name},${handle},'blue',now(),now()+interval '24 hours',now(),now())`;
        const token = randomBytes(32).toString("base64url");
        const digest = createHash("sha256").update(token).digest("hex");
        await sql`INSERT INTO auth_dev_sessions(token_digest,member_id,expires_at)
          VALUES(${digest},${id},now()+interval '1 hour')`;
        const context = await browser.newContext({
          baseURL,
          colorScheme: "dark",
        });
        await context.addCookies([
          {
            name: "reddix.development-session",
            value: token,
            url: baseURL!,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        members.push({
          id,
          name,
          handle,
          context,
          page: await context.newPage(),
        });
      }
      await use({
        sender: members[0],
        recipient: members[1],
        stranger: members[2],
      });
    } finally {
      for (const member of members) await member.context.close();
      await sql`DELETE FROM chat_conversations WHERE requester_id IN ${sql(ids)} OR recipient_id IN ${sql(ids)}`;
      await sql`DELETE FROM blocks WHERE user_id IN ${sql(ids)} OR blocked_id IN ${sql(ids)}`;
      await sql`DELETE FROM auth_dev_sessions WHERE member_id IN ${sql(ids)}`;
      await sql`DELETE FROM rate_limits WHERE key LIKE ${`chat:${prefix}%`}`;
      await sql`DELETE FROM notifications WHERE user_id IN ${sql(ids)}`;
      await sql`DELETE FROM feed_snapshots WHERE user_id IN ${sql(ids)}`;
      await sql`DELETE FROM users WHERE id IN ${sql(ids)}`;
      await sql.end();
    }
  },
});

function change(
  request: APIRequestContext,
  baseURL: string,
  data: Record<string, unknown>,
) {
  return request.post("/api/chat", {
    headers: { Origin: new URL(baseURL).origin },
    data,
  });
}

async function submit(page: Page, action: string, click: () => Promise<void>) {
  const pending = page.waitForResponse((response) => {
    if (!response.url().endsWith("/api/chat")) return false;
    return response.request().postDataJSON()?.action === action;
  });
  await click();
  const response = await pending;
  const result = await response.json();
  expect(response.ok(), JSON.stringify(result)).toBe(true);
  return result;
}

async function fitsViewport(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("requests stay quiet until accepted, then both people can chat and block further contact", async ({
  people: { sender, recipient, stranger },
  baseURL,
}) => {
  await sender.page.setViewportSize({ width: 1440, height: 1000 });
  await recipient.page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  sender.page.on("pageerror", (error) => errors.push(error.message));
  recipient.page.on("pageerror", (error) => errors.push(error.message));
  const opening = "Would you like to compare notes after the SF meetup?";
  const reply = "Yes, happy to compare notes here.";
  const followup = "Great, the conversation now works in both directions.";

  await sender.page.goto("/chat");
  await expect(
    sender.page.getByRole("heading", { name: "Messages", exact: true }),
  ).toBeVisible();
  await sender.page
    .locator(".chat-inbox-heading")
    .getByRole("button", { name: "New message", exact: true })
    .click();
  await sender.page
    .getByLabel("Search members", { exact: true })
    .fill(recipient.handle);
  await sender.page
    .getByRole("button", { name: new RegExp(recipient.name) })
    .click();
  await sender.page
    .getByLabel("Message request", { exact: true })
    .fill(opening);
  const created = await submit(sender.page, "request", () =>
    sender.page
      .getByRole("button", { name: "Send request", exact: true })
      .click(),
  );
  const conversationId = created.conversationId as string;
  expect(conversationId).toBeTruthy();
  await expect(sender.page).toHaveURL(new RegExp(`/chat/${conversationId}$`));
  await expect(sender.page.getByLabel("Message", { exact: true })).toHaveCount(
    0,
  );

  const pendingInbox = await recipient.context.request
    .get("/api/chat")
    .then((response) => response.json());
  expect(pendingInbox.conversations).toHaveLength(0);
  expect(pendingInbox.requests).toHaveLength(1);
  expect(pendingInbox.unreadCount).toBe(0);
  const bootstrap = await recipient.context.request
    .get("/api/bootstrap")
    .then((response) => response.json());
  expect(bootstrap.notifications).toHaveLength(0);
  const forbiddenFollowup = await change(sender.context.request, baseURL!, {
    action: "send",
    conversationId,
    body: "This must wait for approval.",
    clientId: randomUUID(),
  });
  expect(forbiddenFollowup.status()).toBe(409);
  expect((await forbiddenFollowup.json()).error.code).toBe("REQUEST_PENDING");

  expect(
    (
      await stranger.context.request.get(`/api/chat/${conversationId}`)
    ).status(),
  ).toBe(404);
  for (const action of ["send", "accept", "decline", "block", "read"]) {
    const denied = await change(stranger.context.request, baseURL!, {
      action,
      conversationId,
      ...(action === "send"
        ? { body: "Not a participant", clientId: randomUUID() }
        : action === "read"
          ? { messageId: created.messageId }
          : {}),
    });
    expect(denied.status(), action).toBe(404);
  }

  await recipient.page.goto("/chat");
  await expect(
    recipient.page.locator(".app-header .chat-header-count"),
  ).toHaveCount(0);
  await recipient.page.getByRole("tab", { name: /^Requests/ }).click();
  await recipient.page
    .getByRole("button", { name: new RegExp(sender.name) })
    .click();
  const recipientThread = recipient.page.getByTestId("chat-thread");
  await expect(
    recipientThread.getByText(opening, { exact: true }),
  ).toBeVisible();
  await expect(
    recipient.page.getByLabel("Message", { exact: true }),
  ).toHaveCount(0);
  await submit(recipient.page, "accept", () =>
    recipient.page
      .getByRole("button", { name: "Accept request", exact: true })
      .click(),
  );
  await recipient.page.getByLabel("Message", { exact: true }).fill(reply);
  await submit(recipient.page, "send", () =>
    recipient.page
      .getByRole("button", { name: "Send message", exact: true })
      .click(),
  );
  await recipient.page.goto("/popular");
  await sender.page.reload();
  const senderThread = sender.page.getByTestId("chat-thread");
  await expect(senderThread.getByText(reply, { exact: true })).toBeVisible();
  await sender.page.getByLabel("Message", { exact: true }).fill(followup);
  await submit(sender.page, "send", () =>
    sender.page
      .getByRole("button", { name: "Send message", exact: true })
      .click(),
  );
  const activeInbox = await recipient.context.request
    .get("/api/chat")
    .then((response) => response.json());
  expect(activeInbox.requests).toHaveLength(0);
  expect(activeInbox.unreadCount).toBeGreaterThan(0);
  await recipient.page.goto(`/chat/${conversationId}`);
  await expect(
    recipient.page
      .getByTestId("chat-thread")
      .getByText(followup, { exact: true }),
  ).toBeVisible();
  await recipient.page.reload();
  await expect(
    recipient.page
      .getByTestId("chat-thread")
      .getByText(opening, { exact: true }),
  ).toBeVisible();
  await expect(
    recipient.page.getByTestId("chat-thread").getByText(reply, { exact: true }),
  ).toBeVisible();
  await recipient.page.screenshot({
    path: ".local/screenshots/chat-accepted-desktop.png",
  });
  await recipient.page
    .getByRole("button", { name: "Conversation options", exact: true })
    .click();
  await recipient.page
    .getByRole("menuitem", { name: "Block member", exact: true })
    .click();
  await submit(recipient.page, "block", () =>
    recipient.page
      .getByRole("dialog")
      .getByRole("button", { name: "Block member", exact: true })
      .click(),
  );
  const blocked = await change(sender.context.request, baseURL!, {
    action: "send",
    conversationId,
    body: "This contact is blocked.",
    clientId: randomUUID(),
  });
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).error.code).toBe("CHAT_UNAVAILABLE");
  expect(errors).toEqual([]);
});

test("mobile request review can decline contact, while signed-out clients cannot read or write chat", async ({
  people: { sender, recipient },
  request,
  baseURL,
}) => {
  const opening =
    "A single invitation to connect, with no follow-up until accepted.";
  const created = await change(sender.context.request, baseURL!, {
    action: "request",
    recipientId: recipient.id,
    body: opening,
    clientId: randomUUID(),
  });
  expect(created.ok()).toBe(true);
  const { conversationId } = await created.json();
  for (const path of [
    "/api/chat",
    `/api/chat/${conversationId}`,
    "/api/chat/members?q=chat",
  ]) {
    expect((await request.get(path)).status(), path).toBe(401);
  }
  expect(
    (
      await change(request, baseURL!, {
        action: "send",
        conversationId,
        body: "No signed-in session",
        clientId: randomUUID(),
      })
    ).status(),
  ).toBe(401);

  await recipient.page.setViewportSize({ width: 390, height: 844 });
  await recipient.page.goto("/chat");
  await expect(
    recipient.page.locator(".app-header .chat-header-count"),
  ).toHaveCount(0);
  await recipient.page.getByRole("tab", { name: /^Requests/ }).click();
  await recipient.page
    .getByRole("button", { name: new RegExp(sender.name) })
    .click();
  await expect(
    recipient.page
      .getByTestId("chat-thread")
      .getByText(opening, { exact: true }),
  ).toBeVisible();
  await expect(
    recipient.page.getByRole("button", {
      name: "Back to messages",
      exact: true,
    }),
  ).toBeVisible();
  await fitsViewport(recipient.page);
  await recipient.page.screenshot({
    path: ".local/screenshots/chat-request-mobile.png",
  });
  await submit(recipient.page, "decline", () =>
    recipient.page
      .getByRole("button", { name: "Decline", exact: true })
      .click(),
  );
  await recipient.page.reload();
  const inbox = await recipient.context.request
    .get("/api/chat")
    .then((response) => response.json());
  expect(inbox.requests).toHaveLength(0);
  expect(inbox.unreadCount).toBe(0);
  const repeated = await change(sender.context.request, baseURL!, {
    action: "request",
    recipientId: recipient.id,
    body: "This repeated request must be refused.",
    clientId: randomUUID(),
  });
  expect(repeated.status()).toBe(409);
  expect((await repeated.json()).error.code).toBe("CHAT_CLOSED");
  await fitsViewport(recipient.page);
  const signOut = await recipient.context.request.post("/api/auth/logout", {
    headers: { Origin: new URL(baseURL!).origin },
  });
  expect(signOut.ok()).toBe(true);
  expect(
    (
      await recipient.context.request.get(`/api/chat/${conversationId}`)
    ).status(),
  ).toBe(401);
  expect(
    (
      await change(recipient.context.request, baseURL!, {
        action: "accept",
        conversationId,
      })
    ).status(),
  ).toBe(401);
});

test("long messages become read at their end, while new arrivals preserve older reading position", async ({
  people: { sender, recipient },
  baseURL,
}) => {
  test.setTimeout(60_000);
  const created = await change(sender.context.request, baseURL!, {
    action: "request",
    recipientId: recipient.id,
    body: "The opening message at the start of this conversation.",
    clientId: randomUUID(),
  });
  expect(created.ok()).toBe(true);
  const { conversationId } = await created.json();
  expect(
    (
      await change(recipient.context.request, baseURL!, {
        action: "accept",
        conversationId,
      })
    ).ok(),
  ).toBe(true);
  async function send(body: string) {
    const response = await change(sender.context.request, baseURL!, {
      action: "send",
      conversationId,
      body,
      clientId: randomUUID(),
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  async function unread() {
    const inbox = await recipient.context.request
      .get("/api/chat")
      .then((response) => response.json());
    return inbox.unreadCount as number;
  }
  for (let index = 0; index < 6; index++) {
    await send(
      `Earlier discussion ${index + 1}.\n${"A useful detail from our conversation about the meetup.\n".repeat(7)}`,
    );
  }
  const longBody = (marker: string) =>
    `${marker}\n\n${Array.from(
      { length: 45 },
      (_, index) =>
        `Paragraph ${index + 1}: A long message still needs to be readable without marking future messages as seen. Here are the details from our conversation.`,
    ).join("\n\n")}`.slice(0, 3990);
  await send(longBody("Initial long message marker"));
  await recipient.page.setViewportSize({ width: 390, height: 844 });
  // Profile links use member IDs, and an existing pair must open its thread.
  await recipient.page.goto(`/chat/new?to=${encodeURIComponent(sender.id)}`);
  await expect(recipient.page).toHaveURL(
    new RegExp(`/chat/${conversationId}$`),
  );
  const thread = recipient.page.getByTestId("chat-thread");
  const scroller = thread.locator(".chat-messages");
  await expect(
    thread
      .getByTestId("chat-message")
      .filter({ hasText: "Initial long message marker" }),
  ).toBeAttached();
  await expect.poll(unread, { timeout: 10_000 }).toBe(0);
  expect(
    await scroller.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    ),
  ).toBeGreaterThan(1000);
  await fitsViewport(recipient.page);

  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBe(0);
  await send("A new arrival while the recipient is reading earlier messages.");
  await expect(
    thread
      .getByTestId("chat-message")
      .filter({ hasText: "A new arrival while the recipient" }),
  ).toBeAttached({ timeout: 12_000 });
  expect(await unread()).toBe(1);
  expect(await scroller.evaluate((element) => element.scrollTop)).toBeLessThan(
    4,
  );

  await send(longBody("Latest long message marker"));
  await expect(
    thread
      .getByTestId("chat-message")
      .filter({ hasText: "Latest long message marker" }),
  ).toBeAttached({ timeout: 12_000 });
  expect(await unread()).toBe(2);
  expect(await scroller.evaluate((element) => element.scrollTop)).toBeLessThan(
    4,
  );
  await recipient.page
    .getByRole("button", { name: "New messages", exact: true })
    .click();
  await expect.poll(unread, { timeout: 10_000 }).toBe(0);
  await expect
    .poll(() =>
      scroller.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThan(4);
  await fitsViewport(recipient.page);
});

test("quick chat stays with the feed, preserves drafts, and only reads messages while open", async ({
  people: { sender, recipient },
  baseURL,
}) => {
  test.setTimeout(60_000);
  const page = recipient.page;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const opening = "Want to compare the demos from the meetup?";
  const created = await change(sender.context.request, baseURL!, {
    action: "request",
    recipientId: recipient.id,
    body: opening,
    clientId: randomUUID(),
  });
  expect(created.ok()).toBe(true);
  const { conversationId } = await created.json();
  const unread = () =>
    recipient.context.request
      .get("/api/chat")
      .then((response) => response.json())
      .then((inbox) => inbox.unreadCount as number);

  await page.goto("/popular");
  const feedURL = page.url();
  const launcher = page.locator(".app-header .chat-header-button");
  await expect(page.locator(".app-header .chat-header-count")).toHaveCount(0);
  await launcher.click();
  const dock = page.getByRole("dialog", { name: "Quick chat", exact: true });
  await expect(dock).toBeVisible();
  await expect(page).toHaveURL(feedURL);
  expect(
    await page
      .locator(".quick-chat")
      .evaluate((element) => getComputedStyle(element).position),
  ).toBe("fixed");
  const bounds = await dock.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThan(1440 / 2);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1440);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(1000);

  await dock.getByRole("tab", { name: /^Requests/ }).click();
  await dock.getByRole("button", { name: new RegExp(sender.name) }).click();
  await expect(
    dock.getByTestId("chat-thread").getByText(opening, { exact: true }),
  ).toBeVisible();
  await expect(dock.getByLabel("Message", { exact: true })).toHaveCount(0);
  await submit(page, "accept", () =>
    dock.getByRole("button", { name: "Accept request", exact: true }).click(),
  );
  const reply = "Yes, the demo with the local model was a standout.";
  await dock.getByLabel("Message", { exact: true }).fill(reply);
  await submit(page, "send", () =>
    dock.getByRole("button", { name: "Send message", exact: true }).click(),
  );
  await expect(
    dock.getByTestId("chat-thread").getByText(reply, { exact: true }),
  ).toBeVisible();
  await expect.poll(unread).toBe(0);

  const draft = "I have a few more notes to share when you have time.";
  await dock.getByLabel("Message", { exact: true }).fill(draft);
  await dock
    .getByRole("button", { name: "Minimize chat", exact: true })
    .click();
  await expect(dock).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restore chat", exact: true }),
  ).toBeVisible();
  const arrival = "Here is another message while your chat is minimized.";
  expect(
    (
      await change(sender.context.request, baseURL!, {
        action: "send",
        conversationId,
        body: arrival,
        clientId: randomUUID(),
      })
    ).ok(),
  ).toBe(true);
  // Span a thread poll so a hidden conversation cannot silently mark this read.
  await page.waitForTimeout(6500);
  expect(await unread()).toBe(1);
  await expect(page).toHaveURL(feedURL);
  await page.getByRole("button", { name: "Restore chat", exact: true }).click();
  await expect(
    dock.getByTestId("chat-thread").getByText(arrival, { exact: true }),
  ).toBeVisible();
  await expect(dock.getByLabel("Message", { exact: true })).toHaveValue(draft);
  await expect.poll(unread, { timeout: 10_000 }).toBe(0);

  await dock.getByRole("button", { name: "Close chat", exact: true }).click();
  await expect(dock).not.toBeVisible();
  await expect(launcher).toBeFocused();
  await page
    .locator(".utility-nav")
    .getByRole("button", { name: /^Chat/ })
    .click();
  await expect(dock.getByLabel("Message", { exact: true })).toHaveValue(draft);
  await fitsViewport(page);
  await page.screenshot({ path: ".local/screenshots/quick-chat-desktop.png" });
  await dock
    .getByRole("button", { name: "Open full chat", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/chat/${conversationId}$`));
  await expect(dock).not.toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(draft);
  await expect(
    page.getByTestId("chat-thread").getByText(reply, { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile quick chat reviews requests without leaving the page and can expand to messages", async ({
  people: { sender, recipient },
  baseURL,
}) => {
  const page = recipient.page;
  await page.setViewportSize({ width: 390, height: 844 });
  const opening = "One request to connect after the community event.";
  const created = await change(sender.context.request, baseURL!, {
    action: "request",
    recipientId: recipient.id,
    body: opening,
    clientId: randomUUID(),
  });
  expect(created.ok()).toBe(true);
  await page.goto("/s/sf");
  const feedURL = page.url();
  const launcher = page.locator(".app-header .chat-header-button");
  await expect(page.locator(".app-header .chat-header-count")).toHaveCount(0);
  await launcher.click();
  const dock = page.getByRole("dialog", { name: "Quick chat", exact: true });
  await expect(dock).toBeVisible();
  await dock.getByRole("tab", { name: /^Requests/ }).click();
  await dock.getByRole("button", { name: new RegExp(sender.name) }).click();
  await expect(
    dock.getByTestId("chat-thread").getByText(opening, { exact: true }),
  ).toBeVisible();
  await expect(
    dock.getByRole("button", { name: "Back to messages", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(feedURL);
  const bounds = await dock.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await fitsViewport(page);
  await page.screenshot({ path: ".local/screenshots/quick-chat-mobile.png" });
  await submit(page, "decline", () =>
    dock.getByRole("button", { name: "Decline", exact: true }).click(),
  );
  const inbox = await recipient.context.request
    .get("/api/chat")
    .then((response) => response.json());
  expect(inbox.requests).toHaveLength(0);
  expect(inbox.unreadCount).toBe(0);
  await expect(page).toHaveURL(feedURL);
  await dock
    .getByRole("button", { name: "Minimize chat", exact: true })
    .click();
  await page.getByRole("button", { name: "Restore chat", exact: true }).click();
  await dock
    .getByRole("button", { name: "Open full chat", exact: true })
    .click();
  await expect(page).toHaveURL(/\/chat(?:\/[^/?]+)?$/);
  await expect(dock).not.toBeVisible();
  await fitsViewport(page);
});

test("a new quick chat keeps its recipient and draft while browsing communities and expanding", async ({
  people: { sender, recipient },
}) => {
  const page = sender.page;
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/s/sf");
  await page.locator(".app-header .chat-header-button").click();
  const dock = page.getByRole("dialog", { name: "Quick chat", exact: true });
  await dock.getByRole("button", { name: "New message", exact: true }).click();
  await dock
    .getByLabel("Search members", { exact: true })
    .fill(recipient.handle);
  await dock.getByRole("button", { name: new RegExp(recipient.name) }).click();
  const draft =
    "I enjoyed your thoughts on building smaller, useful communities.";
  await dock.getByLabel("Message request", { exact: true }).fill(draft);

  await page
    .getByRole("button", { name: "Discover communities", exact: true })
    .click();
  await expect(page).toHaveURL(/\/communities$/);
  await expect(dock.getByLabel("Message request", { exact: true })).toHaveValue(
    draft,
  );
  await page
    .getByLabel("Search communities", { exact: true })
    .fill("Anthropic");
  await page.locator('.topic-directory-link[href="/s/anthropic"]').click();
  await expect(page).toHaveURL(/\/s\/anthropic$/);
  await expect(dock).toBeVisible();
  await expect(dock.getByLabel("Message request", { exact: true })).toHaveValue(
    draft,
  );
  await expect(dock.locator(".chat-selected-recipient")).toContainText(
    recipient.name,
  );

  await dock
    .getByRole("button", { name: "Open full chat", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/chat/new\\?to=${recipient.id}$`));
  await expect(dock).not.toBeVisible();
  await expect(page.getByLabel("Message request", { exact: true })).toHaveValue(
    draft,
  );
  await expect(page.locator(".chat-selected-recipient")).toContainText(
    recipient.name,
  );
  const inbox = await recipient.context.request
    .get("/api/chat")
    .then((response) => response.json());
  expect(inbox.requests).toHaveLength(0);
  await fitsViewport(page);
});
