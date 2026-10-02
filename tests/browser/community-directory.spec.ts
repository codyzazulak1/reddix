import { expect, test, type Page } from "@playwright/test";
import type { Bootstrap } from "../../src/lib/types";

async function openDirectory(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Verified member/ }).click();
  await page.waitForURL("**/popular");
  await expect(
    page.getByRole("heading", { name: "Popular", exact: true }),
  ).toBeVisible();
  await page.goto("/communities");
  await expect(
    page.getByRole("heading", { name: "Communities", exact: true }),
  ).toBeVisible();
}

function communityCard(page: Page, name: string) {
  return page.getByRole("article", { name, exact: true });
}

test("the directory discovers current topics by aliases and intersecting categories", async ({
  page,
}) => {
  await openDirectory(page);
  const search = page.getByRole("searchbox", { name: "Search communities" });
  const categories = page.getByRole("group", {
    name: "Community categories",
  });

  await search.fill("  ANDREESSEN  ");
  await expect(communityCard(page, "a16z")).toBeVisible();
  await expect(communityCard(page, "Tesla")).toHaveCount(0);
  await categories
    .getByRole("button", { name: "Startups & capital", exact: true })
    .click();
  await expect(communityCard(page, "a16z")).toBeVisible();
  await expect(
    categories.getByRole("button", {
      name: "Startups & capital",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");

  await categories
    .getByRole("button", { name: "AI & models", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No communities found" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(search).toHaveValue("");
  await expect(
    categories.getByRole("button", { name: "All", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const name of [
    "a16z",
    "Speedrun",
    "Y Combinator",
    "Tesla",
    "OpenAI",
    "Anthropic",
  ]) {
    await expect(communityCard(page, name)).toBeVisible();
  }

  await categories
    .getByRole("button", { name: "AI & models", exact: true })
    .click();
  await expect(communityCard(page, "OpenAI")).toBeVisible();
  await expect(communityCard(page, "Anthropic")).toBeVisible();
  await expect(communityCard(page, "Tesla")).toHaveCount(0);
  await search.fill("Claude");
  await expect(communityCard(page, "Anthropic")).toBeVisible();
  await expect(communityCard(page, "OpenAI")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear community search" }).click();
  await expect(search).toHaveValue("");
  await expect(communityCard(page, "OpenAI")).toBeVisible();
});

test("a new community can be joined, reopened and used in the post composer", async ({
  page,
  baseURL,
}) => {
  await openDirectory(page);
  const before: Bootstrap = await page.request
    .get("/api/bootstrap")
    .then((response) => response.json());
  const original = before.communities.find((item) => item.slug === "openai")!;
  expect(original).toBeDefined();
  const following = !original.isFollowing;

  try {
    await page
      .getByRole("searchbox", { name: "Search communities" })
      .fill("OpenAI");
    const card = communityCard(page, "OpenAI");
    const saved = page.waitForResponse((response) => {
      if (!response.url().endsWith("/api/actions")) return false;
      const body = response.request().postDataJSON();
      return body?.action === "follow" && body.communityId === original.id;
    });
    await card
      .getByRole("button", {
        name: `${original.isFollowing ? "Leave" : "Join"} OpenAI`,
        exact: true,
      })
      .click();
    expect((await saved).ok()).toBe(true);
    await expect(
      card.getByRole("button", {
        name: `${following ? "Leave" : "Join"} OpenAI`,
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", String(following));

    await page.reload();
    const restored = communityCard(page, "OpenAI");
    await expect(
      restored.getByRole("button", {
        name: `${following ? "Leave" : "Join"} OpenAI`,
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", String(following));
    const persisted: Bootstrap = await page.request
      .get("/api/bootstrap")
      .then((response) => response.json());
    expect(
      persisted.communities.find((item) => item.id === original.id)
        ?.isFollowing,
    ).toBe(following);

    await restored.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/s\/openai$/);
    await expect(
      page.getByRole("heading", { name: "OpenAI", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Create post", exact: true })
      .click();
    const picker = page.getByRole("button", { name: "Choose a subreddix" });
    await expect(picker).toContainText("OpenAI");
    await expect(picker).toContainText("s/openai");
    await picker.click();
    const search = page.getByRole("combobox", { name: "Search communities" });
    for (const slug of ["a16z", "speedrun", "tesla", "openai", "anthropic"]) {
      await search.fill(slug);
      await expect(
        page.getByRole("option", { name: new RegExp(`s/${slug}$`) }),
      ).toBeVisible();
    }
  } finally {
    const restored = await page.request.post("/api/actions", {
      headers: { Origin: baseURL! },
      data: {
        action: "follow",
        communityId: original.id,
        following: original.isFollowing,
      },
    });
    expect(restored.ok()).toBe(true);
  }
});

test("directory search and category controls stay usable on narrow screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDirectory(page);
  const search = page.getByRole("searchbox", { name: "Search communities" });
  await search.fill("Tesla");
  await expect(communityCard(page, "Tesla")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Clear community search" }).click();
  await page
    .getByRole("group", { name: "Community categories" })
    .getByRole("button", { name: "Frontier tech", exact: true })
    .click();
  await expect(communityCard(page, "Tesla")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("header search returns communities through aliases and opens their feeds", async ({
  page,
}) => {
  await openDirectory(page);
  const search = page.getByRole("textbox", { name: "Search Reddix" });
  await search.fill("YC");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/search(?:\?.*)?$/);
  await expect(search).toHaveValue("YC");
  const results = page.getByRole("region", {
    name: "Community search results",
  });
  const yc = results.getByRole("link", { name: /Y Combinator/ });
  await expect(yc).toHaveAttribute("href", "/s/y-combinator");
  await page.reload();
  await expect(search).toHaveValue("YC");
  await expect(yc).toHaveAttribute("href", "/s/y-combinator");
  await yc.click();
  await expect(page).toHaveURL(/\/s\/y-combinator$/);
  await expect(
    page.getByRole("heading", { name: "Y Combinator", exact: true }),
  ).toBeVisible();
});
