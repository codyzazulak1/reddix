import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Verified member/ }).click();
  await expect(
    page.getByRole("heading", { name: "Popular", exact: true }),
  ).toBeVisible();
}

test("desktop sidebar can be collapsed and restored across reloads and routes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  const sidebar = page.locator("#primary-sidebar");
  const collapse = page.getByRole("button", { name: "Collapse sidebar" });
  const expand = page.getByRole("button", { name: "Expand sidebar" });

  await expect(sidebar).toBeVisible();
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await expect(
    page
      .locator(".app-header")
      .getByRole("button", { name: "Collapse sidebar" }),
  ).toHaveCount(0);
  const sidebarBounds = await sidebar.boundingBox();
  const toggleBounds = await collapse.boundingBox();
  expect(sidebarBounds).not.toBeNull();
  expect(toggleBounds).not.toBeNull();
  expect(
    Math.abs(
      toggleBounds!.x +
        toggleBounds!.width / 2 -
        (sidebarBounds!.x + sidebarBounds!.width),
    ),
  ).toBeLessThanOrEqual(8);
  await collapse.click();
  await expect(sidebar).toBeHidden();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  expect(
    await page.evaluate(() => localStorage.getItem("reddix-sidebar-collapsed")),
  ).not.toBeNull();

  await page.reload();
  await expect(expand).toBeVisible();
  await expect(sidebar).toBeHidden();
  await page.goto("/s/sf");
  await expect(
    page.getByRole("heading", { name: "San Francisco", exact: true }),
  ).toBeVisible();
  await expect(sidebar).toBeHidden();
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(sidebar).toBeVisible();

  await page.reload();
  await expect(collapse).toBeVisible();
  await expect(sidebar).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("mobile navigation opens, dismisses with Escape, and closes after navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const sidebar = page.locator("#primary-sidebar");
  const open = page.getByRole("button", { name: "Open navigation" });

  await expect(sidebar).toBeHidden();
  await open.click();
  await expect(sidebar).toBeVisible();
  const close = page.getByRole("button", { name: "Close navigation" });
  await expect(close).toBeFocused();
  const lastNavigationButton = sidebar.locator("button").last();
  await lastNavigationButton.focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(lastNavigationButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sidebar).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  await sidebar
    .getByRole("button", { name: "Discover communities", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Communities", exact: true }),
  ).toBeVisible();
  await expect(sidebar).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("feed density updates the member preference and survives reload", async ({
  page,
  baseURL,
}) => {
  await login(page);
  const before = await page.request
    .get("/api/bootstrap")
    .then((response) => response.json());
  const original = before.member.preferences.density;
  const next = original === "comfortable" ? "compact" : "comfortable";
  const originalLabel = original === "compact" ? "Compact" : "Card";
  const nextLabel = next === "compact" ? "Compact" : "Card";
  const selected = page.getByRole("menuitemradio", { name: nextLabel });
  const other = page.getByRole("menuitemradio", { name: originalLabel });

  try {
    const trigger = page.getByRole("button", {
      name: `Post view: ${originalLabel}`,
    });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(selected).toHaveAttribute("aria-checked", "false");
    await expect(other).toHaveAttribute("aria-checked", "true");
    const saved = page.waitForResponse((response) => {
      if (!response.url().endsWith("/api/actions")) return false;
      const body = response.request().postDataJSON();
      return body?.action === "preferences";
    });
    await selected.click();
    expect((await saved).ok()).toBe(true);
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(
      page.getByRole("button", { name: `Post view: ${nextLabel}` }),
    ).toBeVisible();

    const persisted = await page.request
      .get("/api/bootstrap")
      .then((response) => response.json());
    expect(persisted.member.preferences.density).toBe(next);
    await page.reload();
    const restoredTrigger = page.getByRole("button", {
      name: `Post view: ${nextLabel}`,
    });
    await restoredTrigger.click();
    await expect(selected).toHaveAttribute("aria-checked", "true");
    await expect(other).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(restoredTrigger).toBeFocused();
    if (next === "compact") {
      await expect(page.locator(".app-shell")).toHaveClass(/density-compact/);
    } else {
      await expect(page.locator(".app-shell")).not.toHaveClass(
        /density-compact/,
      );
    }
  } finally {
    const restored = await page.request.post("/api/actions", {
      headers: { Origin: new URL(baseURL!).origin },
      data: { action: "preferences", preferences: { density: original } },
    });
    expect(restored.ok()).toBe(true);
  }
});

test("the right column stays visible and scrolls independently from a long feed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  // Login renders the heading before its /popular navigation completes.
  // Wait for the final route and feed before adding DOM layout fixtures.
  await expect(page).toHaveURL(/\/popular$/);
  await expect(page.locator(".post-card").first()).toBeVisible();
  const column = page.getByRole("complementary", {
    name: "Community information and events",
  });
  await expect(column).toBeVisible();
  // Layout fixtures make this regression independent of the number of seeded posts/events.
  await page.locator(".main-content").evaluate((element) => {
    const filler = document.createElement("div");
    filler.style.height = "2400px";
    filler.setAttribute("aria-hidden", "true");
    element.append(filler);
  });
  await column.evaluate((element) => {
    const filler = document.createElement("div");
    filler.style.height = "1400px";
    filler.setAttribute("aria-hidden", "true");
    element.append(filler);
  });
  await expect
    .poll(() =>
      column.evaluate((element) => element.scrollHeight - element.clientHeight),
    )
    .toBeGreaterThan(100);
  const main = await page.locator(".main-content").boundingBox();
  await page.mouse.move(main!.x + main!.width / 2, 650);
  await page.mouse.wheel(0, 900);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(500);
  const pinned = await column.boundingBox();
  expect(pinned!.y).toBeGreaterThan(50);
  expect(pinned!.y).toBeLessThan(140);
  expect(pinned!.y + pinned!.height).toBeLessThanOrEqual(901);
  expect(await column.evaluate((element) => element.scrollTop)).toBe(0);

  const feedScroll = await page.evaluate(() => window.scrollY);
  await page.mouse.move(pinned!.x + pinned!.width / 2, pinned!.y + 200);
  await page.mouse.wheel(0, 600);
  await expect
    .poll(() => column.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(100);
  expect(await page.evaluate(() => window.scrollY)).toBe(feedScroll);
  await column.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBe(feedScroll);
});
