import { expect, test, type Page } from "@playwright/test";
import type { Bootstrap, Post } from "../../src/lib/types";

const titles = {
  text: "What makes a useful developer community?",
  image: "A closer look at the new community workspace",
  link: "A practical guide to building accessible community interfaces",
};

// These rendering fixtures never create posts or change a member's preferences
// in the database. Real preference persistence is covered by navigation.spec.ts.
async function fixtureFeed(page: Page, density: "comfortable" | "compact") {
  await page.goto("/");
  await page.getByRole("button", { name: /Verified member/ }).click();
  await expect(
    page.getByRole("heading", { name: "Popular", exact: true }),
  ).toBeVisible();
  const bootstrap: Bootstrap = await page.request
    .get("/api/bootstrap")
    .then((response) => response.json());
  const community = bootstrap.communities.find((item) => item.slug === "sf")!;
  const now = new Date().toISOString();
  const imageUrl = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#516782"/><rect x="120" y="120" width="960" height="360" rx="24" fill="#c0d4de"/></svg>',
  )}`;
  const shared: Omit<
    Post,
    "id" | "title" | "body" | "type" | "url" | "imageUrl"
  > = {
    communityId: community.id,
    communitySlug: community.slug,
    communityName: community.name,
    author: bootstrap.member,
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
  };
  const posts: Post[] = [
    {
      ...shared,
      id: "layout-text",
      title: titles.text,
      type: "text",
      body: "A community works best when its conversations are easy to follow.\n\n**Preview the whole discussion** before deciding whether to join in. This paragraph must remain available in the expanded preview and on the discussion page.",
      url: null,
      imageUrl: null,
    },
    {
      ...shared,
      id: "layout-image",
      title: titles.image,
      type: "image",
      body: "The new workspace has room for quiet work and community meetups.",
      url: null,
      imageUrl,
    },
    {
      ...shared,
      id: "layout-link",
      title: titles.link,
      type: "link",
      body: "A reference for readable discussion feeds and keyboard navigation.",
      url: "https://example.com/community-interface-guidelines?reference=an-intentionally-long-reference-for-narrow-screen-layout-testing",
      imageUrl: null,
    },
  ];
  bootstrap.posts = posts;
  bootstrap.member.preferences.density = density;
  bootstrap.member.preferences.theme = "dark";
  const actions: Array<Record<string, unknown>> = [];

  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({ json: bootstrap }),
  );
  await page.route("**/api/feed?*", (route) =>
    route.fulfill({ json: { posts, nextCursor: null } }),
  );
  await page.route("**/api/posts/layout-*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    await route.fulfill({
      json: { post: posts.find((post) => post.id === id), comments: [] },
    });
  });
  await page.route("**/api/actions", async (route) => {
    const action = route.request().postDataJSON();
    actions.push(action);
    if (action.action === "preferences") {
      Object.assign(bootstrap.member.preferences, action.preferences);
    } else {
      const post = posts.find((item) => item.id === action.postId);
      if (!post || !["save", "vote"].includes(action.action)) {
        throw new Error(`Unexpected fixture action: ${action.action}`);
      }
      if (action.action === "save") post.isSaved = action.saved;
      if (action.action === "vote") {
        post.score += action.value - post.myVote;
        post.myVote = action.value;
      }
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/s/sf");
  await expect(
    page.getByRole("heading", { name: titles.text, exact: true }),
  ).toBeVisible();
  return { actions };
}

function postCard(page: Page, title: string) {
  return page
    .locator(".post-card")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

async function setView(page: Page, view: "Card" | "Compact") {
  await page.getByRole("button", { name: /^Post view:/ }).click();
  await page.getByRole("menuitemradio", { name: view, exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Post view: ${view}` }),
  ).toBeVisible();
  await expect(page.getByRole("menu")).toBeHidden();
}

test("Card and Compact use different layouts for text, links, and images", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixtureFeed(page, "comfortable");
  const text = postCard(page, titles.text);
  const image = postCard(page, titles.image);
  const link = postCard(page, titles.link);

  await expect(text.locator(".post-excerpt")).toBeVisible();
  await expect(image.locator(".post-image img")).toBeVisible();
  await expect(link.locator(".link-preview")).toBeVisible();
  await expect(page.locator(".post-thumbnail")).toHaveCount(0);
  const fullImage = await image.locator(".post-image").boundingBox();
  const cardHeight = (await image.boundingBox())!.height;

  await setView(page, "Compact");
  for (const card of [text, image, link]) {
    await expect(card).toHaveClass(/post-card-compact/);
    await expect(card.locator(".post-thumbnail")).toBeVisible();
    await expect(card.locator(".post-excerpt")).toBeHidden();
    await expect(card.locator(".post-image")).toBeHidden();
    await expect(card.locator(".link-preview")).toBeHidden();
    const thumbnail = (await card.locator(".post-thumbnail").boundingBox())!;
    const title = (await card.locator(".post-title-button").boundingBox())!;
    expect(thumbnail.x + thumbnail.width).toBeLessThanOrEqual(title.x);
  }
  const thumbImage = image.locator(".post-thumbnail img");
  await expect(thumbImage).toBeVisible();
  await expect
    .poll(() =>
      thumbImage.evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBe(1200);
  const thumbnail = (await image.locator(".post-thumbnail").boundingBox())!;
  expect(thumbnail.height).toBeLessThan(fullImage!.height / 2);
  expect((await image.boundingBox())!.height).toBeLessThan(cardHeight * 0.65);

  const url = page.url();
  const expand = image.getByRole("button", {
    name: "Expand preview",
    exact: true,
  });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expand.click();
  await expect(image.locator(".post-preview .post-image img")).toBeVisible();
  await expect(
    image.getByRole("button", { name: "Collapse preview" }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(page.url()).toBe(url);
  await image.getByRole("button", { name: "Collapse preview" }).click();
  await expect(image.locator(".post-preview")).toBeHidden();
  expect(page.url()).toBe(url);

  await text.getByRole("button", { name: "Expand preview" }).click();
  await expect(text.locator(".post-preview strong")).toHaveText(
    "Preview the whole discussion",
  );
  await text.getByRole("button", { name: "Collapse preview" }).click();
  await link.getByRole("button", { name: "Expand preview" }).click();
  await expect(link.locator(".post-preview .link-preview")).toHaveAttribute(
    "href",
    /^https:\/\/example\.com\//,
  );

  await setView(page, "Card");
  await expect(page.locator(".post-card-compact")).toHaveCount(0);
  await expect(image.locator(".post-image img")).toBeVisible();
  await expect(text.locator(".post-excerpt")).toBeVisible();
});

test("compact voting, saving, and comments work while post details keep their full content", async ({
  page,
}) => {
  const { actions } = await fixtureFeed(page, "compact");
  const image = postCard(page, titles.image);
  await image.getByRole("button", { name: "Upvote", exact: true }).click();
  await expect(
    image.getByRole("button", { name: "Upvote", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await image.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    image.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  expect(actions).toContainEqual({
    action: "vote",
    postId: "layout-image",
    value: 1,
  });
  expect(actions).toContainEqual({
    action: "save",
    postId: "layout-image",
    saved: true,
  });

  await image.getByRole("button", { name: "0 comments", exact: true }).click();
  await expect(page).toHaveURL(/\/p\/layout-image$/);
  const detail = page.locator(".post-card-detail");
  await expect(detail).not.toHaveClass(/post-card-compact/);
  await expect(detail.locator(".post-body")).toContainText(
    "The new workspace has room for quiet work",
  );
  await expect(detail.locator(".post-image img")).toBeVisible();
  await expect(detail.locator(".post-thumbnail")).toHaveCount(0);
  await expect(
    detail.getByRole("button", { name: "Expand preview" }),
  ).toHaveCount(0);
  await expect(page.locator("#comment-input")).toBeVisible();
  await page.reload();
  await expect(detail.locator(".post-image img")).toBeVisible();
  await expect(detail.locator(".post-body")).toBeVisible();
});

test("both feed views and expanded compact previews fit a 390px screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtureFeed(page, "compact");
  for (const title of Object.values(titles)) {
    const card = postCard(page, title);
    const thumbnail = (await card.locator(".post-thumbnail").boundingBox())!;
    const heading = (await card.locator(".post-title-button").boundingBox())!;
    expect(thumbnail.x + thumbnail.width).toBeLessThanOrEqual(heading.x);
    const actions = (await card.locator(".post-actions").boundingBox())!;
    expect(actions.x + actions.width).toBeLessThanOrEqual(390);
  }
  const link = postCard(page, titles.link);
  await link.getByRole("button", { name: "Expand preview" }).click();
  await expect(link.locator(".post-preview .link-preview")).toBeVisible();
  const image = postCard(page, titles.image);
  await image.getByRole("button", { name: "Expand preview" }).click();
  await expect(image.locator(".post-preview .post-image img")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await setView(page, "Card");
  await expect(image.locator(".post-image img")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
