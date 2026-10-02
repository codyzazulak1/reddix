import { test, expect } from "@playwright/test";

test("signed-out members cannot retrieve community data or direct post content", async ({
  page,
  request,
}) => {
  await page.goto("/p/demo-post-1");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "The platform of Reddit.",
  );
  await expect(
    page.getByText("SF feels like a small town again.", { exact: false }),
  ).toHaveCount(0);
  for (const path of [
    "/api/bootstrap",
    "/api/posts/demo-post-1",
    "/api/events/demo-event-1",
    "/api/events/demo-event-1/calendar",
    "/api/search?q=SF",
  ]) {
    expect((await request.get(path)).status()).toBe(401);
  }
});

test("verified member can publish, reply, save and find a persisted discussion", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Verified member/ }).click();
  await expect(page.getByRole("heading", { name: "Popular" })).toBeVisible();
  await page.getByRole("button", { name: "Create post", exact: true }).click();
  const title = `Browser-tested conversation ${Date.now()}`;
  await page.getByRole("button", { name: "Choose a subreddix" }).click();
  await page.getByRole("combobox", { name: "Search communities" }).fill("sf");
  await page.getByRole("option", { name: /s\/sf$/ }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByLabel("Post body")
    .fill(
      "A real discussion persisted through the application and PostgreSQL.",
    );
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByRole("heading", { name: title }).click();
  await page
    .locator("#comment-input")
    .fill("A reply that survives a page reload.");
  await page
    .locator(".comment-composer")
    .getByRole("button", { name: "Reply", exact: true })
    .click();
  await expect(
    page.getByText("A reply that survives a page reload.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("A reply that survives a page reload.", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".post-card")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.getByRole("button", { name: "Saved posts", exact: true }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const id = (
    await page.request
      .get("/api/search?q=" + encodeURIComponent(title))
      .then((r) => r.json())
  ).posts[0].id;
  await page.request.post("/api/actions", {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: { action: "deletePost", postId: id },
  });
});

test("browse-only member sees content but cannot post or vote via direct API", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Browse-only/ }).click();
  await expect(
    page.getByText("You’re exploring in browse-only mode."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create post", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your voice belongs here." }),
  ).toBeVisible();
  const denied = await page.request.post("/api/actions", {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: { action: "vote", postId: "demo-post-1", value: 1 },
  });
  expect(denied.status()).toBe(403);
});

test("mobile navigation and community views fit a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Verified member/ }).click();
  await expect(page.getByRole("heading", { name: "Popular" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".mobile-bottom-nav")
    .getByRole("button", { name: "Explore", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Communities" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
