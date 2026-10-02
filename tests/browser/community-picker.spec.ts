import { expect, test, type Page } from "@playwright/test";
import type { Bootstrap } from "../../src/lib/types";

async function openComposer(
  page: Page,
  baseURL: string,
  followedSlugs = ["openai"],
) {
  expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL).hostname);
  const login = await page.request.post("/api/auth/dev-login", {
    headers: { Origin: new URL(baseURL).origin },
    data: { persona: "alex" },
  });
  expect(login.ok()).toBe(true);
  const response = await page.request.get("/api/bootstrap");
  expect(response.ok()).toBe(true);
  const bootstrap: Bootstrap = await response.json();
  bootstrap.communities = bootstrap.communities.map((community) => ({
    ...community,
    isFollowing: followedSlugs.includes(community.slug),
    archived: community.archived || community.slug === "tesla",
  }));
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({ json: bootstrap }),
  );
  await page.goto("/popular");
  await page.getByRole("button", { name: "Create post", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Start a conversation" }),
  ).toBeVisible();
  return bootstrap;
}

test("community recommendations prioritize joined communities and search reaches other active communities", async ({
  page,
  baseURL,
}) => {
  await openComposer(page, baseURL!);
  await page.getByRole("button", { name: "Choose a subreddix" }).click();
  const search = page.getByRole("combobox", { name: "Search communities" });
  await expect(search).toBeFocused();
  const joined = page.getByRole("group", { name: "Your communities" });
  await expect(joined.getByRole("option")).toHaveCount(1);
  const openai = joined.getByRole("option", { name: "OpenAI, s/openai" });
  await expect(openai).toBeVisible();
  await expect(openai.locator(".community-icon")).toBeVisible();
  await expect(page.getByRole("option").first()).toHaveAccessibleName(
    "OpenAI, s/openai",
  );
  expect(await page.getByRole("option").count()).toBeLessThanOrEqual(8);

  await search.fill("  CLAUDE  ");
  const anthropic = page.getByRole("option", {
    name: "Anthropic, s/anthropic",
  });
  await expect(anthropic).toBeVisible();
  await expect(anthropic.locator(".community-icon")).toBeVisible();
  await expect(
    page.getByRole("option", { name: "OpenAI, s/openai" }),
  ).toHaveCount(0);
  await search.fill("Tesla");
  await expect(page.getByRole("option")).toHaveCount(0);
  await search.fill("no-community-matches-this-query");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(
    page.getByText("No communities found", { exact: true }),
  ).toBeVisible();
  await search.press("Escape");
  await expect(search).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose a subreddix" }),
  ).toBeFocused();
  await expect(
    page.getByRole("dialog", { name: "Start a conversation" }),
  ).toBeVisible();
});

test("keyboard community selection sends the chosen destination when publishing", async ({
  page,
  baseURL,
}) => {
  const bootstrap = await openComposer(page, baseURL!);
  await page.getByRole("button", { name: "Choose a subreddix" }).click();
  const search = page.getByRole("combobox", { name: "Search communities" });
  const initialActive = await search.getAttribute("aria-activedescendant");
  expect(initialActive).toBeTruthy();
  await search.press("ArrowDown");
  await expect(search).not.toHaveAttribute(
    "aria-activedescendant",
    initialActive!,
  );
  await search.press("ArrowUp");
  await expect(search).toHaveAttribute("aria-activedescendant", initialActive!);
  await search.press("Tab");
  await expect(search).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Text", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Choose a subreddix" }).click();
  await expect(search).toBeFocused();

  await search.fill("s/anthropic");
  await expect(page.getByRole("option").first()).toHaveAccessibleName(
    "Anthropic, s/anthropic",
  );
  await search.press("Enter");
  const picker = page.getByRole("button", { name: "Choose a subreddix" });
  await expect(picker).toContainText("Anthropic");
  await expect(picker).toContainText("s/anthropic");
  await expect(search).not.toBeVisible();
  await page
    .getByLabel("Title", { exact: true })
    .fill("A question about Claude");
  await page
    .getByLabel("Post body")
    .fill("Which workflow has worked best for you?");

  await page.route("**/api/actions", async (route) => {
    if (route.request().postDataJSON()?.action === "createPost") {
      await route.fulfill({ json: { ok: true } });
    } else {
      await route.continue();
    }
  });
  const published = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/actions") &&
      request.postDataJSON()?.action === "createPost",
  );
  await page.getByRole("button", { name: "Publish post" }).click();
  expect((await published).postDataJSON().communityId).toBe(
    bootstrap.communities.find((community) => community.slug === "anthropic")!
      .id,
  );
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("popular recommendations and community search fit narrow screens", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const bootstrap = await openComposer(page, baseURL!, []);
  await page.getByRole("button", { name: "Choose a subreddix" }).click();
  await expect(
    page.getByRole("group", { name: "Your communities" }),
  ).toHaveCount(0);
  const popular = page.getByRole("group", { name: "Popular communities" });
  await expect(popular).toBeVisible();
  expect(await popular.getByRole("option").count()).toBeLessThanOrEqual(5);
  const mostPopular = bootstrap.communities
    .filter((community) => !community.archived)
    .sort((a, b) => b.membersCount - a.membersCount)[0];
  await expect(popular.getByRole("option").first()).toHaveAccessibleName(
    `${mostPopular.name}, s/${mostPopular.slug}`,
  );
  const search = page.getByRole("combobox", { name: "Search communities" });
  await expect(search).toBeInViewport();
  const listbox = page.getByRole("listbox", { name: "Communities" });
  const bounds = await listbox.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await search.fill("sf");
  const sf = page.getByRole("option", { name: /s\/sf$/ });
  await expect(sf).toBeInViewport();
  await sf.click();
  await expect(
    page.getByRole("button", { name: "Choose a subreddix" }),
  ).toContainText("s/sf");
});
