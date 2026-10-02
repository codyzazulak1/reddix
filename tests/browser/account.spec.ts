import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function login(
  context: BrowserContext,
  baseURL: string,
  persona: "alex" | "morgan",
) {
  expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL).hostname);
  const response = await context.request.post("/api/auth/dev-login", {
    headers: { Origin: new URL(baseURL).origin },
    data: { persona },
  });
  expect(response.status()).toBe(200);
}

async function mutation(page: Page, click: () => Promise<unknown>) {
  const pending = page.waitForResponse((response) =>
    response.url().endsWith("/api/actions"),
  );
  await click();
  const response = await pending;
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBe(true);
  return body;
}

test("X presentation fields are read-only and account export downloads personal JSON", async ({
  page,
  context,
  baseURL,
}) => {
  await login(context, baseURL!, "morgan");
  const bootstrap = await context.request
    .get("/api/bootstrap")
    .then((response) => response.json());
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  const profile = page.locator(".settings-panel").first();
  const fields = profile.locator("input, textarea");
  await expect(fields).toHaveCount(5);
  expect(
    await fields.evaluateAll((elements) =>
      elements.every((element) => element.hasAttribute("readonly")),
    ),
  ).toBe(true);
  await expect(fields.nth(0)).toHaveValue(bootstrap.member.name);
  await expect(fields.nth(1)).toHaveValue(`@${bootstrap.member.handle}`);
  await expect(fields.nth(2)).toHaveValue(bootstrap.member.bio);
  await expect(fields.nth(3)).toHaveValue(bootstrap.member.location);
  await expect(fields.nth(4)).toHaveValue(bootstrap.member.website);
  await expect(page.getByRole("link", { name: "Edit on X" })).toHaveAttribute(
    "href",
    `https://x.com/${bootstrap.member.handle}`,
  );
  await expect(
    page.getByRole("button", { name: "Resync from X" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Account", exact: true }).click();
  const downloadPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export data", exact: true }).click();
  const download = await downloadPending;
  expect(download.suggestedFilename()).toMatch(
    /^reddix-account-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(exported.formatVersion).toBe(1);
  expect(exported.member.id).toBe("demo-morgan");
  expect(exported.member.handle).toBe(bootstrap.member.handle);
  expect(exported.preferences).toEqual(bootstrap.member.preferences);
  for (const key of [
    "posts",
    "comments",
    "events",
    "registrations",
    "communityFollows",
  ]) {
    expect(Array.isArray(exported[key])).toBe(true);
  }
  expect(JSON.stringify(exported)).not.toMatch(
    /"(?:access_?token|refresh_?token|token_digest|client_secret|token)"\s*:/i,
  );
});

test("signing out other browsers preserves the current session", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  await login(context, baseURL!, "morgan");
  const otherContext = await browser.newContext({ baseURL });
  try {
    await login(otherContext, baseURL!, "morgan");
    expect((await otherContext.request.get("/api/bootstrap")).status()).toBe(
      200,
    );
    await page.goto("/settings");
    await page.getByRole("button", { name: "Account", exact: true }).click();
    const pending = page.waitForResponse((response) =>
      response.url().endsWith("/api/account/revoke-sessions"),
    );
    await page
      .getByRole("button", { name: "Sign out others", exact: true })
      .click();
    const response = await pending;
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.currentSessionKept).toBe(true);
    expect(result.revoked).toBeGreaterThanOrEqual(1);
    expect((await context.request.get("/api/bootstrap")).status()).toBe(200);
    expect((await otherContext.request.get("/api/bootstrap")).status()).toBe(
      401,
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
  } finally {
    await otherContext.close();
  }
});

test("authors can edit discussions and edit, collapse, and delete their replies", async ({
  page,
  context,
  baseURL,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(context, baseURL!, "alex");
  const title = `browser-account-discussion-${randomUUID()}`;
  const updatedBody = "This edited post body remains after a fresh page load.";
  const firstReply = "An original reply for the discussion authoring check.";
  const editedReply = "An edited reply with a nested discussion below it.";
  const nestedReply = "The nested reply remains after its parent is deleted.";
  let postId: string | undefined;
  try {
    await page.goto("/popular");
    await page
      .getByRole("button", { name: "Create post", exact: true })
      .click();
    await page.getByRole("button", { name: "Choose a subreddix" }).click();
    await page.getByRole("combobox", { name: "Search communities" }).fill("sf");
    await page.getByRole("option", { name: /s\/sf$/ }).click();
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page
      .getByLabel("Post body")
      .fill("A temporary browser-test conversation for author controls.");
    const created = await mutation(page, () =>
      page.getByRole("button", { name: "Publish post", exact: true }).click(),
    );
    postId = created.post.id;
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByRole("heading", { name: title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${postId}$`));
    await page
      .locator(".post-card-detail")
      .getByRole("button", { name: "Post options", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Edit your post", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Body", { exact: true })
      .fill(updatedBody);
    await mutation(page, () =>
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Save changes", exact: true })
        .click(),
    );
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.reload();
    await expect(page.locator(".post-body")).toHaveText(updatedBody);

    await page.locator("#comment-input").fill(firstReply);
    await mutation(page, () =>
      page
        .locator(".comment-composer")
        .getByRole("button", { name: "Reply", exact: true })
        .click(),
    );
    const parent = page.locator(".comment-list > .comment").first();
    await expect(parent.locator(":scope > .comment-body")).toHaveText(
      firstReply,
    );
    await parent
      .locator(":scope > .comment-actions")
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Reply", { exact: true })
      .fill(editedReply);
    await mutation(page, () =>
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Save reply", exact: true })
        .click(),
    );
    await expect(parent.locator(":scope > .comment-body")).toHaveText(
      editedReply,
    );
    await parent
      .locator(":scope > .comment-actions")
      .getByRole("button", { name: "Reply", exact: true })
      .click();
    await page.locator("#comment-input").fill(nestedReply);
    await mutation(page, () =>
      page
        .locator(".comment-composer")
        .getByRole("button", { name: "Reply", exact: true })
        .click(),
    );
    await expect(parent.getByText(nestedReply, { exact: true })).toBeVisible();
    await parent
      .locator(":scope > .comment-head")
      .getByRole("button", { name: "Collapse replies", exact: true })
      .click();
    await expect(page.getByText(editedReply, { exact: true })).toHaveCount(0);
    await expect(page.getByText(nestedReply, { exact: true })).toHaveCount(0);
    await parent
      .getByRole("button", { name: "Expand replies", exact: true })
      .click();
    await expect(parent.getByText(nestedReply, { exact: true })).toBeVisible();
    await parent
      .locator(":scope > .comment-actions")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await mutation(page, () =>
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Delete reply", exact: true })
        .click(),
    );
    await expect(parent.locator(":scope > .comment-body")).toHaveText(
      "[deleted]",
    );
    await expect(parent.getByText(nestedReply, { exact: true })).toBeVisible();
    await page.reload();
    await expect(parent.locator(":scope > .comment-body")).toHaveText(
      "[deleted]",
    );
    await expect(parent.getByText(nestedReply, { exact: true })).toBeVisible();

    await page
      .locator(".post-card-detail")
      .getByRole("button", { name: "Post options", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Delete your post", exact: true })
      .click();
    await mutation(page, () =>
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Delete post", exact: true })
        .click(),
    );
    await expect(page).toHaveURL(/\/popular$/);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    if (postId) {
      const cleanup = await context.request.post("/api/actions", {
        headers: { Origin: new URL(baseURL!).origin },
        data: { action: "deletePost", postId },
      });
      expect(cleanup.ok()).toBe(true);
    }
  }
});
