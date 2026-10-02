import { expect, test } from "@playwright/test";
test("bot workspace is inactive before setup, and new posts stay off X", async ({
  page,
  context,
  baseURL,
}) => {
  expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
  const login = await context.request.post("/api/auth/dev-login", {
    headers: { Origin: new URL(baseURL!).origin },
    data: { persona: "alex" },
  });
  expect(login.ok()).toBe(true);
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Community growth", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Bot offline", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Waiting for the Reddix X account", { exact: true }),
  ).toBeVisible();
  await page
    .getByText("Organization affiliates", { exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Verify and link" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("combobox", { name: "Community", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/reddix-x-growth-admin.png",
    fullPage: false,
  });
  await page.goto("/new");
  await page
    .getByRole("button", { name: "Create post", exact: true })
    .first()
    .click();
  const share = page.getByRole("checkbox", {
    name: /Let Reddix feature this post on X and tag me/,
  });
  await expect(share).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Publish post", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: "/tmp/reddix-x-growth-compose.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(share).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Publish post", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: "/tmp/reddix-x-growth-mobile.png" });
  const title = `Discussion without X promotion ${Date.now()}`;
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Post body").fill("A conversation for Reddix.");
  const published = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/actions") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.action === "createPost",
  );
  await page.getByRole("button", { name: "Publish post", exact: true }).click();
  const response = await published;
  expect(response.ok()).toBe(true);
  const { post } = await response.json();
  try {
    expect(response.request().postDataJSON().promoteOnX).toBe(false);
    expect(post.promoteOnX).toBe(false);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  } finally {
    const deleted = await context.request.post("/api/actions", {
      headers: { Origin: new URL(baseURL!).origin },
      data: { action: "deletePost", postId: post.id },
    });
    expect(deleted.ok()).toBe(true);
  }
});
