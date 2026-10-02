import { expect, test, type Page } from "@playwright/test";

const status = {
  development: false,
  xConfigured: true,
  inviteRequired: false,
  verificationRequired: true,
  returningMember: false,
};

async function showGate(page: Page, overrides: Partial<typeof status> = {}) {
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { message: "Sign in first." } },
    }),
  );
  await page.route("**/api/auth/status", (route) =>
    route.fulfill({ json: { ...status, ...overrides } }),
  );
  await page.goto("/");
}

test("verified X signup needs no invite and preserves the destination", async ({
  page,
}) => {
  await showGate(page);
  await page.goto("/s/sf?q=meetup");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "The platform of Reddit.",
  );
  await expect(page.getByLabel("Invite code")).toHaveCount(0);
  await expect(page.getByText("Open to verified X accounts.")).toBeVisible();
  await expect(page.getByText("Invite-only.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Join with X" })).toBeEnabled();
  await page.route("**/api/auth/sign-in/social", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      provider: "twitter",
      callbackURL: "/s/sf?q=meetup",
    });
    await route.fulfill({ json: { url: "/s/sf?oauth=started" } });
  });
  await page.getByRole("button", { name: "Join with X" }).click();
  await expect(page).toHaveURL(/oauth=started/);
});

test("unverified X signup explains the verification requirement", async ({
  page,
}) => {
  await showGate(page);
  await page.goto("/?authError=verification-required");
  await expect(page.locator(".landing-error[role=alert]")).toHaveText(
    "A verified X account is required to sign up. Sign in with a blue, gold, or gray check on X.",
  );
  await expect(page.getByLabel("Invite code")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Join with X" })).toBeEnabled();
});

test("unavailable X verification offers another sign-in attempt", async ({
  page,
}) => {
  await showGate(page);
  await page.goto("/?authError=verification-unavailable");
  await expect(page.locator(".landing-error[role=alert]")).toHaveText(
    "We couldn’t confirm your X verification. Please try signing in again.",
  );
  await expect(page.getByRole("button", { name: "Join with X" })).toBeEnabled();
});

test("returning members keep their X login entry point", async ({ page }) => {
  await showGate(page, { returningMember: true });
  await expect(
    page.getByRole("button", { name: "Welcome back with X" }),
  ).toBeEnabled();
  await expect(page.getByLabel("Invite code")).toHaveCount(0);
});

test("verified X signup continues directly into account onboarding", async ({
  page,
}) => {
  await showGate(page);
  // Supply the normal member bootstrap after a successful X sign-in.
  await page.request.post("/api/auth/dev-login", {
    data: { persona: "alex" },
    headers: { Origin: "http://127.0.0.1:3000" },
  });
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  expect(bootstrap.member).toBeTruthy();
  bootstrap.member.onboardingCompletedAt = null;
  const inviteRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/auth/invite"))
      inviteRequests.push(request.url());
  });
  await page.route("**/api/auth/sign-in/social", async (route) => {
    await page.route("**/api/bootstrap", (next) =>
      next.fulfill({ json: bootstrap }),
    );
    await route.fulfill({ json: { url: "/popular" } });
  });
  await page.getByRole("button", { name: "Join with X" }).click();
  await expect(
    page.getByRole("button", { name: "Looks like me" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/popular$/);
  expect(inviteRequests).toEqual([]);
});

for (const width of [1440, 390, 320]) {
  test(`verified signup landing fits a ${width}px viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await showGate(page);
    await expect(
      page.getByRole("button", { name: "Join with X" }),
    ).toBeVisible();
    await expect(page.locator(".landing-backdrop")).toBeVisible();
    await page
      .locator(".landing-backdrop")
      .evaluate((img: HTMLImageElement) => img.decode());
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/landing-${width}.png`,
      fullPage: true,
    });
  });
}
