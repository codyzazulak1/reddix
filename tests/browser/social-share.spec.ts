import { expect, test, type Page } from "@playwright/test";
import { COMMUNITY_CATALOG } from "../../src/lib/community-catalog";

const canvasSize = { width: 1200, height: 630 };
const imageSize = { width: 2400, height: 1260 };

async function headMetadata(page: Page, html: string) {
  return page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, "text/html");
    const metadata: Record<string, string[]> = {};
    for (const tag of document.head.querySelectorAll("meta")) {
      const name = tag.getAttribute("property") ?? tag.getAttribute("name");
      if (name) (metadata[name] ??= []).push(tag.getAttribute("content") ?? "");
    }
    return metadata;
  }, html);
}

test("/og is a standalone screenshot canvas", async ({ page }) => {
  await page.setViewportSize(canvasSize);
  const response = await page.goto("/og");
  expect(response?.status()).toBe(200);

  const image = page.locator("img");
  await expect(image).toHaveCount(1);
  await image.evaluate((element: HTMLImageElement) => element.decode());
  await expect(image).toHaveAttribute("width", "1200");
  await expect(image).toHaveAttribute("height", "630");
  expect(await image.boundingBox()).toEqual({ x: 0, y: 0, ...canvasSize });
  expect(
    await image.evaluate((element: HTMLImageElement) => ({
      width: element.naturalWidth,
      height: element.naturalHeight,
      path: new URL(element.src).pathname,
    })),
  ).toEqual({ ...imageSize, path: "/og/image" });

  // Native DOM queries exclude Next.js development tools in their shadow root.
  expect(
    await page.evaluate(
      () =>
        document.body.querySelectorAll(
          "nav, header, aside, button, input, select, textarea, a",
        ).length,
    ),
  ).toBe(0);
  await expect(
    page.getByRole("textbox", { name: "Search Reddix" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Join with X/ })).toHaveCount(
    0,
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /(?=.*noindex)(?=.*nofollow)/,
  );
});

test("the shared image is a publicly accessible 2400x1260 PNG", async ({
  request,
}) => {
  const response = await request.get("/og/image");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\/png(?:;|$)/);
  const png = await response.body();
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(png.toString("ascii", 12, 16)).toBe("IHDR");
  expect({
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  }).toEqual(imageSize);
});

test("signed-out social crawlers receive the shared image and community details in the head", async ({
  request,
  page,
}) => {
  for (const slug of [null, "ai", "a16z"]) {
    const path = slug ? `/s/${slug}` : "/";
    await test.step(path, async () => {
      const response = await request.get(path, {
        headers: { "User-Agent": "Twitterbot/1.0" },
      });
      expect(response.status()).toBe(200);
      const metadata = await headMetadata(page, await response.text());
      expect(metadata["og:image"]).toHaveLength(1);
      const image = new URL(metadata["og:image"][0]);
      expect(image.protocol).toMatch(/^https?:$/);
      expect(image.pathname).toBe("/og/image");
      if (process.env.APP_URL) {
        expect(image.origin).toBe(new URL(process.env.APP_URL).origin);
      }
      expect(metadata["og:image:width"]).toEqual(["2400"]);
      expect(metadata["og:image:height"]).toEqual(["1260"]);
      expect(metadata["twitter:image"]).toEqual(metadata["og:image"]);
      expect(metadata["twitter:card"]).toEqual(["summary_large_image"]);
      expect(metadata["twitter:title"]).toEqual(metadata["og:title"]);
      expect(metadata["twitter:description"]).toEqual(
        metadata["og:description"],
      );
      expect(metadata["og:title"]?.[0]).toContain("Reddix");
      expect(metadata["og:description"]?.[0]).toBeTruthy();
      if (slug) {
        const community = COMMUNITY_CATALOG.find((item) => item.slug === slug)!;
        expect(metadata["og:title"][0]).toContain(community.name);
        expect(metadata["og:description"]).toEqual([community.description]);
      }
    });
  }
});
