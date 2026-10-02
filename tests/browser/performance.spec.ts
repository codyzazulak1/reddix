import { expect, test, type Page } from "@playwright/test";
import type { Bootstrap, Post } from "../../src/lib/types";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixtureSession(
  page: Page,
  baseURL: string,
  options: {
    bootstrapReady?: Promise<void>;
    newFeedReady?: Promise<void>;
  } = {},
) {
  const login = await page.request.post("/api/auth/dev-login", {
    headers: { Origin: new URL(baseURL).origin },
    data: { persona: "alex" },
  });
  expect(login.ok()).toBe(true);
  const response = await page.request.get("/api/bootstrap");
  expect(response.ok()).toBe(true);
  const bootstrap: Bootstrap = await response.json();
  const community = bootstrap.communities.find((item) => item.slug === "sf")!;
  expect(community).toBeDefined();
  bootstrap.communities = bootstrap.communities.map((item) => ({
    ...item,
    isFollowing: item.id === community.id,
  }));
  bootstrap.member.preferences.density = "comfortable";
  bootstrap.member.preferences.theme = "dark";
  bootstrap.events = [];
  bootstrap.notifications = [];
  const now = new Date().toISOString();
  const post = (name: string): Post => ({
    id: `performance-${name}`,
    communityId: community.id,
    communitySlug: community.slug,
    communityName: community.name,
    author: bootstrap.member,
    title: `${name} feed fixture`,
    body: "A deterministic discussion for navigation and loading checks.",
    type: "text",
    url: null,
    imageUrl: null,
    score: 12,
    commentCount: 0,
    myVote: 0,
    isSaved: false,
    isPinned: false,
    locked: false,
    status: "published",
    createdAt: now,
    updatedAt: now,
    tags: [],
  });
  bootstrap.posts = [post("Popular")];
  const session = { signedIn: true, bootstrap, post };

  await page.route("**/api/bootstrap", async (route) => {
    await options.bootstrapReady;
    await route.fulfill(
      session.signedIn
        ? { json: session.bootstrap }
        : { status: 401, json: { error: { message: "Sign in to continue." } } },
    );
  });
  await page.route("**/api/feed?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const name = params.has("community")
      ? "Community"
      : params.get("scope") === "following"
        ? "Following"
        : params.get("sort") === "new"
          ? "New"
          : "Popular";
    if (name === "New") await options.newFeedReady;
    await route.fulfill({ json: { posts: [post(name)], nextCursor: null } });
  });
  await page.route("**/api/chat?summary=1", (route) =>
    route.fulfill({ json: { unreadCount: 0 } }),
  );
  await page.route("**/api/activity", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  return session;
}

test("navigation keeps the shell, loads only the new feed, and reuses feeds on back and forward", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const newFeed = deferred();
  await fixtureSession(page, baseURL!, { newFeedReady: newFeed.promise });
  await page.goto("/popular");
  await expect(
    page.getByRole("heading", { name: "Popular feed fixture", exact: true }),
  ).toBeVisible();

  const requests: string[] = [];
  const serverNavigations: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) requests.push(url.pathname);
    if (request.isNavigationRequest() || request.headers().rsc === "1") {
      serverNavigations.push(url.pathname);
    }
  });
  const sidebar = page.locator("#primary-sidebar");
  const header = page.locator(".app-header");
  // A remounted shell would lose these markers even if it looked identical.
  await sidebar.evaluate((element) => {
    element.setAttribute("data-persistent-shell", "sidebar");
  });
  await header.evaluate((element) => {
    element.setAttribute("data-persistent-shell", "header");
  });

  try {
    await sidebar.getByRole("button", { name: "New", exact: true }).click();
    await expect(page).toHaveURL(/\/new$/);
    await expect(
      page.getByRole("heading", { name: "New posts", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator(".main-content")
        .getByRole("status", { name: "Loading posts" }),
    ).toBeVisible();
    await expect(sidebar).toBeVisible();
    await expect(header).toBeVisible();
    await expect(page.locator(".app-loading, .app-skeleton")).toHaveCount(0);
    await expect(page.locator(".post-card")).toHaveCount(0);
  } finally {
    newFeed.resolve();
  }
  await expect(
    page.getByRole("heading", { name: "New feed fixture", exact: true }),
  ).toBeVisible();

  for (const destination of [
    {
      button: "Following",
      path: /\/following$/,
      title: "Following feed fixture",
    },
    {
      button: "San Francisco",
      path: /\/s\/sf$/,
      title: "Community feed fixture",
    },
  ]) {
    await sidebar
      .getByRole("button", { name: destination.button, exact: true })
      .click();
    await expect(page).toHaveURL(destination.path);
    await expect(
      page.getByRole("heading", { name: destination.title, exact: true }),
    ).toBeVisible();
  }

  expect(requests).toEqual(["/api/feed", "/api/feed", "/api/feed"]);
  expect(serverNavigations).toEqual([]);
  await expect(sidebar).toHaveAttribute("data-persistent-shell", "sidebar");
  await expect(header).toHaveAttribute("data-persistent-shell", "header");

  for (const destination of [
    { path: /\/following$/, title: "Following feed fixture" },
    { path: /\/new$/, title: "New feed fixture" },
    { path: /\/popular$/, title: "Popular feed fixture" },
  ]) {
    await page.goBack();
    await expect(page).toHaveURL(destination.path);
    await expect(
      page.getByRole("heading", { name: destination.title, exact: true }),
    ).toBeVisible();
  }
  await page.goForward();
  await expect(page).toHaveURL(/\/new$/);
  await expect(
    page.getByRole("heading", { name: "New feed fixture", exact: true }),
  ).toBeVisible();
  expect(requests).toEqual(["/api/feed", "/api/feed", "/api/feed"]);
  expect(serverNavigations).toEqual([]);
  await expect(sidebar).toHaveAttribute("data-persistent-shell", "sidebar");
  await expect(header).toHaveAttribute("data-persistent-shell", "header");
});

test("a slow initial session shows a page skeleton instead of the fullscreen loader", async ({
  page,
  baseURL,
}) => {
  const bootstrap = deferred();
  await fixtureSession(page, baseURL!, { bootstrapReady: bootstrap.promise });
  try {
    await page.goto("/popular");
    await expect(page.locator(".app-skeleton")).toBeVisible();
    await expect(page.locator(".app-loading")).toHaveCount(0);
    await expect(page.getByText("Finding your corner…")).toHaveCount(0);
  } finally {
    bootstrap.resolve();
  }
  await expect(
    page.getByRole("heading", { name: "Popular feed fixture", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".app-skeleton")).toHaveCount(0);
});

test("a failed feed keeps navigation available and can be retried", async ({
  page,
  baseURL,
}) => {
  await fixtureSession(page, baseURL!);
  let attempts = 0;
  await page.route("**/api/feed?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("sort") !== "new") {
      await route.fallback();
      return;
    }
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        json: { error: { message: "Temporary feed failure" } },
      });
    } else {
      await route.fallback();
    }
  });
  await page.goto("/popular");
  await expect(
    page.getByRole("heading", { name: "Popular feed fixture", exact: true }),
  ).toBeVisible();
  await page
    .locator("#primary-sidebar")
    .getByRole("button", { name: "New", exact: true })
    .click();
  await expect(
    page.getByText("Temporary feed failure", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#primary-sidebar")).toBeVisible();
  await expect(page.locator(".app-header")).toBeVisible();
  await page.getByRole("button", { name: "Retry feed", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New feed fixture", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Temporary feed failure", { exact: true }),
  ).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("leaving a feed cancels delayed pagination without mixing posts into the destination", async ({
  page,
  baseURL,
}) => {
  const { post } = await fixtureSession(page, baseURL!);
  const paginationStarted = deferred();
  const paginationReady = deferred();
  const paginationFinished = deferred();
  await page.route("**/api/feed?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has("cursor")) {
      paginationStarted.resolve();
      await paginationReady.promise;
      await route.fulfill({
        json: { posts: [post("Late popular")], nextCursor: null },
      });
      paginationFinished.resolve();
    } else if (params.get("sort") === "popular") {
      await route.fulfill({
        json: { posts: [post("Popular")], nextCursor: "popular-page-2" },
      });
    } else {
      await route.fallback();
    }
  });
  await page.goto("/popular");
  const more = page.getByRole("button", {
    name: "More conversations",
    exact: true,
  });
  await more.click();
  await paginationStarted.promise;
  await expect(more).toBeDisabled();
  const canceled = page.waitForEvent("requestfailed", {
    predicate: (request) => new URL(request.url()).searchParams.has("cursor"),
  });
  try {
    await page
      .locator("#primary-sidebar")
      .getByRole("button", { name: "New", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "New feed fixture", exact: true }),
    ).toBeVisible();
    await canceled;
  } finally {
    paginationReady.resolve();
  }
  await paginationFinished.promise;
  await expect(page.locator(".post-card")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Late popular feed fixture" }),
  ).toHaveCount(0);

  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Popular feed fixture", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".post-card")).toHaveCount(1);
  await expect(more).toBeEnabled();
  await more.click();
  await expect(
    page.getByRole("heading", {
      name: "Late popular feed fixture",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".post-card")).toHaveCount(2);
});

test("signing out discards feed caches before the same member signs in again", async ({
  page,
  baseURL,
}) => {
  const session = await fixtureSession(page, baseURL!);
  await page.goto("/popular");
  const previousPost = page.getByRole("heading", {
    name: "Popular feed fixture",
    exact: true,
  });
  await expect(previousPost).toBeVisible();
  await page.route("**/api/auth/logout", async (route) => {
    session.signedIn = false;
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Account settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Verified member/ }),
  ).toBeVisible();
  await expect(previousPost).toHaveCount(0);

  const freshFeed = deferred();
  await page.route("**/api/auth/dev-login", async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    session.signedIn = true;
    session.bootstrap.posts = [session.post("Second session")];
    await route.fulfill({ response });
  });
  await page.route("**/api/feed?*", async (route) => {
    await freshFeed.promise;
    await route.fulfill({
      json: { posts: [session.post("Second session")], nextCursor: null },
    });
  });
  try {
    await page.getByRole("button", { name: /Verified member/ }).click();
    await expect(page).toHaveURL(/\/popular$/);
    await expect(
      page
        .locator(".main-content")
        .getByRole("status", { name: "Loading posts" }),
    ).toBeVisible();
    await expect(previousPost).toHaveCount(0);
  } finally {
    freshFeed.resolve();
  }
  await expect(
    page.getByRole("heading", {
      name: "Second session feed fixture",
      exact: true,
    }),
  ).toBeVisible();
  await expect(previousPost).toHaveCount(0);
});

test("saving a post during pagination prevents the older response from restoring stale state", async ({
  page,
  baseURL,
}) => {
  const session = await fixtureSession(page, baseURL!);
  const paginationStarted = deferred();
  const paginationReady = deferred();
  const paginationFinished = deferred();
  let saved = false;
  await page.route("**/api/actions", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      action: "save",
      postId: "performance-Popular",
      saved: true,
    });
    saved = true;
    session.bootstrap.posts[0].isSaved = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/feed?*", async (route) => {
    if (new URL(route.request().url()).searchParams.has("cursor")) {
      paginationStarted.resolve();
      await paginationReady.promise;
      await route.fulfill({
        json: { posts: [session.post("Stale pagination")], nextCursor: null },
      });
      paginationFinished.resolve();
    } else {
      const post = session.post("Popular");
      post.isSaved = saved;
      await route.fulfill({
        json: { posts: [post], nextCursor: saved ? null : "popular-page-2" },
      });
    }
  });
  await page.goto("/popular");
  await page
    .getByRole("button", { name: "More conversations", exact: true })
    .click();
  await paginationStarted.promise;
  const canceled = page.waitForEvent("requestfailed", {
    predicate: (request) => new URL(request.url()).searchParams.has("cursor"),
  });
  try {
    await page
      .locator(".post-card")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      page
        .locator(".post-card")
        .getByRole("button", { name: "Saved", exact: true }),
    ).toBeVisible();
    await canceled;
  } finally {
    paginationReady.resolve();
  }
  await paginationFinished.promise;
  await expect(
    page
      .locator(".post-card")
      .getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".post-card")).toHaveCount(1);
  await expect(
    page.getByRole("heading", {
      name: "Stale pagination feed fixture",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("stale navigation refreshes notifications in the background while keeping the shell usable", async ({
  page,
  baseURL,
}) => {
  const session = await fixtureSession(page, baseURL!);
  const initialTime = new Date();
  await page.clock.setSystemTime(initialTime);
  await page.goto("/popular");
  await expect(
    page.getByRole("heading", { name: "Popular feed fixture", exact: true }),
  ).toBeVisible();
  const header = page.locator(".app-header");
  await header.evaluate((element) => {
    element.setAttribute("data-background-refresh", "preserved");
  });
  session.bootstrap.notifications = [
    {
      id: "background-notification",
      type: "reply",
      message: "A fresh notification after returning to Reddix",
      resourceId: null,
      readAt: null,
      createdAt: new Date(initialTime.getTime() + 60_000).toISOString(),
    },
  ];
  const refreshStarted = deferred();
  const refreshReady = deferred();
  let refreshRequests = 0;
  await page.route("**/api/bootstrap", async (route) => {
    refreshRequests += 1;
    refreshStarted.resolve();
    await refreshReady.promise;
    await route.fulfill({ json: session.bootstrap });
  });
  await page.clock.setSystemTime(new Date(initialTime.getTime() + 61_000));
  try {
    await page
      .getByRole("button", { name: "Notifications", exact: true })
      .click();
    await refreshStarted.promise;
    await expect(
      page.getByRole("heading", { name: "Your notifications", exact: true }),
    ).toBeVisible();
    await expect(header).toBeVisible();
    await expect(page.locator("#primary-sidebar")).toBeVisible();
    await expect(page.locator(".app-skeleton, .app-loading")).toHaveCount(0);
    await expect(header).toHaveAttribute(
      "data-background-refresh",
      "preserved",
    );
  } finally {
    refreshReady.resolve();
  }
  await expect(
    page.getByText(session.bootstrap.notifications[0].message, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Notifications, 1 unread", exact: true }),
  ).toBeVisible();
  await expect(header).toHaveAttribute("data-background-refresh", "preserved");
  expect(refreshRequests).toBe(1);
});
