import { expect, test, type BrowserContext } from "@playwright/test";

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

function dashboard() {
  return {
    bot: { id: "system-reddix", handle: "reddix", name: "Reddix" },
    configured: false,
    mode: "auto",
    model: "fixture/low-cost-model",
    dailyLimit: 500,
    today: { requests: 0, costUsd: 0 },
    counts: { queued: 0, review: 0, removed: 0, failed: 0 },
    cases: [],
    errors: [],
  };
}

test("no-key moderation is clearly inactive and cannot start AI checks", async ({
  page,
  context,
  baseURL,
}) => {
  await login(context, baseURL!, "alex");
  let mutationCount = 0;
  await page.route("**/api/moderation", async (route) => {
    if (route.request().method() !== "GET") mutationCount++;
    await route.fulfill({ json: dashboard() });
  });
  await page.goto("/admin");
  const panel = page.getByRole("region", { name: "@reddix moderation" });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByText("Waiting for an OpenRouter key", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText(/No AI decisions are being made yet/),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Run queued checks" }),
  ).toBeDisabled();
  await panel.getByRole("button", { name: "Refresh moderation" }).click();
  await expect(
    panel.getByRole("button", { name: "Refresh moderation" }),
  ).toBeEnabled();
  expect(mutationCount).toBe(0);
  await expect(
    panel.getByRole("link", { name: "Meet @reddix" }),
  ).toHaveAttribute("href", "/u/system-reddix");
});

test("admin reviews require a reason and update the visible moderation history", async ({
  page,
  context,
  baseURL,
}) => {
  await login(context, baseURL!, "alex");
  let reviewed = false;
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/moderation", async (route) => {
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON();
      reviewed = true;
      return route.fulfill({ json: { reviewed: true } });
    }
    return route.fulfill({
      json: {
        ...dashboard(),
        counts: { queued: 0, review: reviewed ? 0 : 1, removed: 0, failed: 0 },
        cases: [
          {
            id: "fixture-decision",
            targetType: "post",
            targetId: "fixture-post",
            postId: "fixture-post",
            authorName: "Sample Member",
            authorHandle: "sample",
            title: "A legitimate technical discussion",
            body: "A harmless fixture, never stored in the shared database.",
            contentStatus: "published",
            action: "review",
            category: "other",
            confidence: 0.6,
            reason: "Context needs a human review.",
            model: "fixture/low-cost-model",
            createdAt: new Date().toISOString(),
            resolution: reviewed ? "dismissed" : "pending",
            reviewNote: reviewed ? String(submitted?.reason) : null,
          },
        ],
      },
    });
  });
  await page.goto("/admin");
  const panel = page.getByRole("region", { name: "@reddix moderation" });
  await panel
    .getByRole("button", { name: "Dismiss flag", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Dismiss flag" });
  const submit = dialog.getByRole("button", {
    name: "Dismiss flag",
    exact: true,
  });
  await expect(submit).toBeDisabled();
  await dialog
    .getByRole("textbox", { name: "Review reason" })
    .fill("This is an on-topic discussion, not a policy violation.");
  await submit.click();
  await expect(dialog).not.toBeVisible();
  await expect(panel.getByText("Dismissed", { exact: true })).toBeVisible();
  await expect(panel.getByText(/This is an on-topic discussion/)).toBeVisible();
  expect(submitted).toEqual({
    action: "review",
    decisionId: "fixture-decision",
    resolution: "dismiss",
    reason: "This is an on-topic discussion, not a policy violation.",
  });
});

test("the @reddix profile identifies the bot without impersonating an X member or accepting DMs", async ({
  page,
  context,
  baseURL,
}) => {
  await login(context, baseURL!, "morgan");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/u/system-reddix");
  await expect(
    page.getByRole("heading", { name: "Reddix", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Automated moderator", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".profile-header .avatar img")).toHaveAttribute(
    "src",
    "/brand/reddix-logo.png",
  );
  await expect(
    page.getByRole("button", { name: "Posts", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Comments", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".page-tabs")
      .getByRole("button", { name: "Events", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "About", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "About @reddix" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Message", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View on X" })).toHaveCount(0);
  await expect(page.getByText(/followers on X/)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open moderation workspace" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const profile = await context.request
    .get("/api/members/system-reddix")
    .then((response) => response.json());
  expect(profile.member).toMatchObject({
    id: "system-reddix",
    handle: "reddix",
    isBot: true,
  });
});

test("the moderation API rejects unauthenticated and non-admin access", async ({
  context,
  baseURL,
}) => {
  expect((await context.request.get("/api/moderation")).status()).toBe(401);
  await login(context, baseURL!, "morgan");
  expect((await context.request.get("/api/moderation")).status()).toBe(403);
  const response = await context.request.post("/api/moderation", {
    headers: { Origin: new URL(baseURL!).origin },
    data: {
      action: "review",
      decisionId: "nonexistent-fixture",
      resolution: "dismiss",
      reason: "No authorization.",
    },
  });
  expect(response.status()).toBe(403);
});
