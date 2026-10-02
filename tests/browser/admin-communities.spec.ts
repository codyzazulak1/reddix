import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { Bootstrap, Community } from "../../src/lib/types";

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
  const bootstrap = await context.request.get("/api/bootstrap");
  expect(bootstrap.ok()).toBe(true);
  return (await bootstrap.json()) as Bootstrap;
}

function community(name: string): Community {
  const slug = name.toLowerCase().replaceAll(" ", "-");
  return {
    id: slug,
    slug,
    name,
    description: "A browser fixture for community administration.",
    city: null,
    icon: "users",
    color: "#24a47f",
    archived: false,
    isFollowing: false,
    membersCount: 0,
  };
}

async function mockBootstrap(page: Page, data: Bootstrap) {
  let reads = 0;
  await page.route("**/api/bootstrap", (route) => {
    reads++;
    return route.fulfill({ json: data });
  });
  await page.route("**/api/activity", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  return () => reads;
}

test("admins approve and decline pending requests, prevent duplicate clicks, and refresh the directory", async ({
  page,
  context,
  baseURL,
}) => {
  const data = await login(context, baseURL!, "alex");
  const bootstrapReads = await mockBootstrap(page, data);
  const approved = community(`Approved fixture ${randomUUID()}`);
  const declined = community(`Declined fixture ${randomUUID()}`);
  const suggestions = [approved, declined].map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    city: null,
    status: "open",
    createdAt: new Date().toISOString(),
    author: { handle: "fixture-member" },
  }));
  const submitted: Record<string, unknown>[] = [];
  let releaseApproval!: () => void;
  const approvalGate = new Promise<void>((resolve) => {
    releaseApproval = resolve;
  });
  await page.route("**/api/admin", (route) =>
    route.fulfill({ json: { suggestions, reports: [] } }),
  );
  await page.route("**/api/actions", async (route) => {
    const input = route.request().postDataJSON();
    submitted.push(input);
    expect(input.action).toBe("adminSuggestion");
    const suggestion = suggestions.find(
      (item) => item.id === input.suggestionId,
    )!;
    expect(suggestion).toBeDefined();
    if (input.status === "accepted") {
      await approvalGate;
      data.communities.push(approved);
    }
    suggestion.status = input.status;
    await route.fulfill({ json: { ok: true, reviewed: true } });
  });
  await page.goto("/admin");
  const panel = page.getByRole("region", { name: "Community suggestions" });
  const approvedRow = panel.getByRole("article", {
    name: approved.name,
    exact: true,
  });
  const declinedRow = panel.getByRole("article", {
    name: declined.name,
    exact: true,
  });
  await expect(approvedRow.getByText("Pending", { exact: true })).toBeVisible();
  await approvedRow
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  try {
    await expect(
      approvedRow.getByRole("button", { name: "Approve", exact: true }),
    ).toBeDisabled();
    await expect(
      approvedRow.getByRole("button", { name: "Decline", exact: true }),
    ).toBeDisabled();
  } finally {
    releaseApproval();
  }
  await expect(
    approvedRow.getByText("Approved", { exact: true }),
  ).toBeVisible();
  await expect(approvedRow.getByRole("button")).toHaveCount(0);
  await declinedRow
    .getByRole("button", { name: "Decline", exact: true })
    .click();
  await expect(
    declinedRow.getByText("Declined", { exact: true }),
  ).toBeVisible();
  await expect(declinedRow.getByRole("button")).toHaveCount(0);
  expect(submitted).toEqual([
    {
      action: "adminSuggestion",
      suggestionId: approved.id,
      status: "accepted",
    },
    {
      action: "adminSuggestion",
      suggestionId: declined.id,
      status: "declined",
    },
  ]);
  expect(bootstrapReads()).toBeGreaterThanOrEqual(3);
  await page.reload();
  await expect(
    approvedRow.getByText("Approved", { exact: true }),
  ).toBeVisible();
  await expect(
    declinedRow.getByText("Declined", { exact: true }),
  ).toBeVisible();
  await page.goto("/communities");
  await page
    .getByRole("searchbox", { name: "Search communities" })
    .fill("fixture");
  await expect(
    page.getByRole("article", { name: approved.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: declined.name, exact: true }),
  ).toHaveCount(0);
});

test("admin creation publishes immediately through the directory and opens the new subreddix", async ({
  page,
  context,
  baseURL,
}) => {
  const data = await login(context, baseURL!, "alex");
  const bootstrapReads = await mockBootstrap(page, data);
  const created = community(`Direct fixture ${randomUUID()}`);
  const submitted: Record<string, unknown>[] = [];
  let releaseCreation!: () => void;
  const creationGate = new Promise<void>((resolve) => {
    releaseCreation = resolve;
  });
  await page.route("**/api/actions", async (route) => {
    submitted.push(route.request().postDataJSON());
    await creationGate;
    data.communities.push(created);
    await route.fulfill({
      json: { ok: true, communityId: created.id, slug: created.slug },
    });
  });
  await page.goto("/communities");
  await page
    .getByRole("button", { name: "Create a subreddix", exact: true })
    .last()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create a subreddix",
    exact: true,
  });
  await dialog.getByLabel("Community name", { exact: true }).fill(created.name);
  await dialog
    .getByLabel("What brings this community together?", { exact: true })
    .fill(created.description);
  await dialog
    .getByRole("button", { name: "Create subreddix", exact: true })
    .click();
  try {
    await expect(
      dialog.getByRole("button", { name: "Creating…", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByLabel("Community name", { exact: true }),
    ).toBeDisabled();
  } finally {
    releaseCreation();
  }
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/s/${created.slug}$`));
  await expect(
    page.getByRole("heading", { name: created.name, exact: true }),
  ).toBeVisible();
  expect(submitted).toEqual([
    {
      action: "adminCreateCommunity",
      name: created.name,
      description: created.description,
    },
  ]);
  expect(bootstrapReads()).toBeGreaterThanOrEqual(2);
});

test("members still send suggestions and cannot call admin community actions", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const adminInput = {
    action: "adminCreateCommunity",
    name: `Forbidden ${randomUUID()}`,
    description: "A member cannot create this community directly.",
  };
  expect(
    (
      await context.request.post("/api/actions", {
        headers: { Origin: origin },
        data: adminInput,
      })
    ).status(),
  ).toBe(401);
  const data = await login(context, baseURL!, "morgan");
  data.member.eligible = true;
  expect((await context.request.get("/api/admin")).status()).toBe(403);
  for (const input of [
    adminInput,
    {
      action: "adminSuggestion",
      suggestionId: "nonexistent-fixture",
      status: "accepted",
    },
    {
      action: "adminSuggestion",
      suggestionId: "nonexistent-fixture",
      status: "declined",
    },
  ]) {
    expect(
      (
        await context.request.post("/api/actions", {
          headers: { Origin: origin },
          data: input,
        })
      ).status(),
    ).toBe(403);
  }
  await mockBootstrap(page, data);
  const submitted: Record<string, unknown>[] = [];
  await page.route("**/api/actions", (route) => {
    submitted.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, submitted: true } });
  });
  await page.goto("/communities");
  await expect(
    page.getByRole("button", { name: "Create a subreddix", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Suggest a community", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "There’s room for your corner.",
    exact: true,
  });
  await dialog
    .getByLabel("Community name", { exact: true })
    .fill("Member fixture topic");
  await dialog
    .getByLabel("What brings this community together?", { exact: true })
    .fill("A topic submitted for the administrator to review.");
  await dialog
    .getByRole("button", { name: "Send suggestion", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(submitted).toEqual([
    {
      action: "suggestCommunity",
      name: "Member fixture topic",
      description: "A topic submitted for the administrator to review.",
    },
  ]);
  await expect(page).toHaveURL(/\/communities$/);
});

test("an admin request notification opens the review queue", async ({
  page,
  context,
  baseURL,
}) => {
  const data = await login(context, baseURL!, "alex");
  data.notifications = [
    {
      id: randomUUID(),
      type: "community_suggestion",
      message: "New sub request: Fixture Design.",
      resourceId: "fixture-suggestion",
      createdAt: new Date().toISOString(),
      readAt: null,
    },
  ];
  await mockBootstrap(page, data);
  await page.route("**/api/admin", (route) =>
    route.fulfill({ json: { reports: [], suggestions: [] } }),
  );
  await page.goto("/notifications");
  await page
    .getByText("New sub request: Fixture Design.", { exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(
    page.getByRole("region", { name: "Community suggestions" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".admin-page-title")
      .getByRole("button", { name: "Create a subreddix", exact: true }),
  ).toBeVisible();
});
