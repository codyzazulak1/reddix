import { expect, test, type Page } from "@playwright/test";
import type { Bootstrap, Post } from "../../src/lib/types";

const titles = {
  link: "A guide to welcoming community spaces",
  text: "This article has a useful take on local communities",
  upload: "An uploaded photo of our neighborhood",
  missing: "An article without a preview image",
  broken: "An article whose preview is unavailable",
};
const previewImage = "/api/media/preview-fixture-image";

// Rendering fixtures keep posts, media, and preference changes out of the DB.
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
  const shared: Omit<Post, "id" | "title" | "type"> = {
    communityId: community.id,
    communitySlug: community.slug,
    communityName: community.name,
    author: bootstrap.member,
    body: "A useful reference for the next community conversation.",
    url: "https://example.com/community-guide",
    imageUrl: previewImage,
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
    { ...shared, id: "preview-link", title: titles.link, type: "link" },
    {
      ...shared,
      id: "preview-text",
      title: titles.text,
      type: "text",
      body: "Read [this article](https://example.com/community-guide) before our next meetup.",
      url: null,
    },
    {
      ...shared,
      id: "preview-upload",
      title: titles.upload,
      type: "image",
      url: null,
    },
    {
      ...shared,
      id: "preview-missing",
      title: titles.missing,
      type: "link",
      imageUrl: null,
    },
    {
      ...shared,
      id: "preview-broken",
      title: titles.broken,
      type: "link",
      imageUrl: "/api/media/preview-fixture-missing",
    },
  ];
  bootstrap.posts = posts;
  bootstrap.member.preferences.density = density;
  bootstrap.member.preferences.theme = "dark";
  await page.route("**/api/media/preview-fixture-*", (route) =>
    route.request().url().endsWith("missing")
      ? route.fulfill({ status: 404, body: "Not found" })
      : route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#58768b"/><circle cx="600" cy="450" r="260" fill="#b7d9cf"/><path d="M0 700L340 390 740 800 1100 500 1200 610V900H0Z" fill="#334a54"/></svg>',
        }),
  );
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({ json: bootstrap }),
  );
  await page.route("**/api/feed?*", (route) =>
    route.fulfill({ json: { posts, nextCursor: null } }),
  );
  await page.route("**/api/posts/preview-*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    return route.fulfill({
      json: { post: posts.find((post) => post.id === id), comments: [] },
    });
  });
  await page.route("**/api/actions", (route) => {
    const action = route.request().postDataJSON();
    if (action.action !== "preferences") {
      throw new Error(`Unexpected fixture action: ${action.action}`);
    }
    Object.assign(bootstrap.member.preferences, action.preferences);
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/s/sf");
  await expect(
    page.getByRole("heading", { name: titles.link, exact: true }),
  ).toBeVisible();
  return posts;
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

test("link and text posts show cropped Card banners while uploads retain their full image", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixtureFeed(page, "comfortable");
  for (const title of [titles.link, titles.text]) {
    const card = postCard(page, title);
    const banner = card.getByRole("button", {
      name: `Open link preview: ${title}`,
      exact: true,
    });
    await banner.scrollIntoViewIfNeeded();
    await expect(banner).toBeVisible();
    const image = banner.getByRole("img", {
      name: `Link preview for ${title}`,
    });
    await expect(image).toHaveCSS("object-fit", "cover");
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => element.naturalWidth),
      )
      .toBe(1200);
    const bounds = (await banner.boundingBox())!;
    expect(bounds.width / bounds.height).toBeCloseTo(1.91, 1);
    expect(bounds.width).toBeCloseTo(
      (await card.locator(".post-card-content").boundingBox())!.width,
      0,
    );
  }
  const uploaded = postCard(page, titles.upload);
  await uploaded.scrollIntoViewIfNeeded();
  await expect(uploaded.locator(".post-link-banner")).toHaveCount(0);
  await expect(uploaded.locator(".post-image img")).toHaveCSS(
    "object-fit",
    "contain",
  );
  await expect(
    uploaded.getByRole("button", { name: `Open image post: ${titles.upload}` }),
  ).toBeVisible();
  await expect(
    postCard(page, titles.link).locator(".link-preview"),
  ).toHaveAttribute("href", "https://example.com/community-guide");
});

test("Compact shows preview thumbnails and preserves expansion and full post navigation", async ({
  page,
}) => {
  await fixtureFeed(page, "compact");
  for (const title of [titles.link, titles.text]) {
    const card = postCard(page, title);
    await expect(card.locator(".post-thumbnail img")).toBeVisible();
    await expect(card.locator(".post-thumbnail img")).toHaveCSS(
      "object-fit",
      "cover",
    );
    await expect(card.locator(".post-link-banner")).toBeHidden();
    await card
      .getByRole("button", { name: "Expand preview", exact: true })
      .click();
    await expect(card.locator(".post-link-banner img")).toBeVisible();
    await expect(card.locator(".post-body")).toBeVisible();
    await card
      .getByRole("button", { name: "Collapse preview", exact: true })
      .click();
    await expect(card.locator(".post-preview")).toBeHidden();
  }
  await postCard(page, titles.link).locator(".post-thumbnail").click();
  await expect(page).toHaveURL(/\/p\/preview-link$/);
  const detail = page.locator(".post-card-detail");
  await expect(detail.locator(".post-link-banner img")).toBeVisible();
  await expect(detail.locator(".post-body")).toBeVisible();
  await expect(detail.locator(".post-thumbnail")).toHaveCount(0);
  await expect(detail.locator(".link-preview")).toHaveAttribute(
    "href",
    "https://example.com/community-guide",
  );
});

test("unavailable images fall back cleanly and a replacement image can load", async ({
  page,
}) => {
  const posts = await fixtureFeed(page, "compact");
  for (const title of [titles.missing, titles.broken]) {
    const card = postCard(page, title);
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator(".post-thumbnail img")).toHaveCount(0);
    await expect(card.locator(".post-thumbnail svg")).toBeVisible();
    await card
      .getByRole("button", { name: "Expand preview", exact: true })
      .click();
    await expect(card.locator(".post-image")).toHaveCount(0);
    await expect(card.locator(".link-preview")).toBeVisible();
  }
  await setView(page, "Card");
  for (const title of [titles.missing, titles.broken]) {
    await expect(postCard(page, title).locator(".post-image")).toHaveCount(0);
  }
  posts.find((post) => post.id === "preview-broken")!.imageUrl = previewImage;
  await setView(page, "Compact");
  const repaired = postCard(page, titles.broken).locator(".post-thumbnail img");
  await repaired.scrollIntoViewIfNeeded();
  await expect(repaired).toBeVisible();
  await expect
    .poll(() =>
      repaired.evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBe(1200);
});

test("Card banners and expanded Compact previews fit a mobile screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtureFeed(page, "comfortable");
  const card = postCard(page, titles.link);
  const banner = card.locator(".post-link-banner");
  await expect(banner).toBeVisible();
  const bounds = (await banner.boundingBox())!;
  expect(bounds.width / bounds.height).toBeCloseTo(1.91, 1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await setView(page, "Compact");
  await expect(card.locator(".post-thumbnail img")).toBeVisible();
  await expect(banner).toBeHidden();
  await card
    .getByRole("button", { name: "Expand preview", exact: true })
    .click();
  await expect(banner).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
