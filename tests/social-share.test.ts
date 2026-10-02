import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSiteUrl,
  getSocialMetadata,
  SOCIAL_IMAGE_SIZE,
  type CommunityShareData,
} from "../src/lib/social-share";
import { getCommunityShareData } from "../src/server/social-share";
import { generateMetadata } from "../src/app/(site)/[...segments]/page";

const { sql, ensureDatabase } = vi.hoisted(() => ({
  sql: vi.fn(),
  ensureDatabase: vi.fn(),
}));

vi.mock("../src/server/db", () => ({ sql, ensureDatabase }));

const community: CommunityShareData = {
  slug: "community-created-today",
  name: "Community Created Today",
  description: "Current details maintained by the community.",
};

beforeEach(() => {
  vi.clearAllMocks();
  sql.mockResolvedValue([]);
  for (const name of [
    "APP_URL",
    "BETTER_AUTH_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
    "VERCEL_URL",
  ])
    vi.stubEnv(name, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("social metadata", () => {
  it("uses the configured canonical origin for the main PNG and large Twitter card", () => {
    vi.stubEnv("APP_URL", "https://reddix.test/app?ignored=1");
    vi.stubEnv("VERCEL_URL", "preview.vercel.app");
    const metadata = getSocialMetadata();

    expect(String(metadata.metadataBase)).toBe("https://reddix.test/");
    expect(metadata.openGraph).toMatchObject({
      title: "Reddix | The tech community for people on X",
      url: "https://reddix.test/",
      images: [
        {
          url: "https://reddix.test/og/image",
          ...SOCIAL_IMAGE_SIZE,
          type: "image/png",
        },
      ],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      images: [{ url: "https://reddix.test/og/image" }],
    });
  });

  it("keeps community text and public URLs while sharing the main image", () => {
    vi.stubEnv("APP_URL", "https://reddix.test");
    const metadata = getSocialMetadata(community);

    expect(metadata).toMatchObject({
      title: "Community Created Today | Reddix",
      description: community.description,
      openGraph: {
        url: "https://reddix.test/s/community-created-today",
        title: "Community Created Today | Reddix",
        description: community.description,
        images: [
          {
            url: "https://reddix.test/og/image",
            width: 2400,
            height: 1260,
            alt: "Reddix, the tech community for people on X",
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: "Community Created Today | Reddix",
        description: community.description,
        images: [{ url: "https://reddix.test/og/image" }],
      },
    });
  });

  it("falls back through auth, production Vercel, preview Vercel, and local origins", () => {
    vi.stubEnv("APP_URL", "not a URL");
    vi.stubEnv("BETTER_AUTH_URL", "https://auth.reddix.test");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "reddix.vercel.app");
    vi.stubEnv("VERCEL_URL", "reddix-preview.vercel.app");
    expect(getSiteUrl().href).toBe("https://auth.reddix.test/");

    vi.stubEnv("BETTER_AUTH_URL", "javascript:alert(1)");
    expect(getSiteUrl().href).toBe("https://reddix.vercel.app/");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", undefined);
    expect(getSiteUrl().href).toBe("https://reddix-preview.vercel.app/");
    vi.stubEnv("VERCEL_URL", undefined);
    expect(getSiteUrl().href).toBe("http://127.0.0.1:3000/");
  });
});

describe("public community share lookup", () => {
  it("reads current public fields for communities absent from the seed catalog without migrating", async () => {
    sql.mockResolvedValue([community]);
    expect(await getCommunityShareData(community.slug)).toEqual(community);

    expect(sql).toHaveBeenCalledOnce();
    const [query, slug] = sql.mock.calls[0] as [TemplateStringsArray, string];
    expect(query.join("?").replace(/\s+/g, " ").trim()).toBe(
      "SELECT slug, name, description FROM communities WHERE slug = ? AND archived = false LIMIT 1",
    );
    expect(slug).toBe(community.slug);
    expect(ensureDatabase).not.toHaveBeenCalled();
  });

  it("returns null when the database has no active community for the slug", async () => {
    expect(await getCommunityShareData("missing-or-archived")).toBeNull();
  });

  it.each(["", "../openai", "OpenAI", "two words", "a--b", "a".repeat(81)])(
    "rejects invalid slug %j before querying",
    async (slug) => {
      expect(await getCommunityShareData(slug)).toBeNull();
      expect(sql).not.toHaveBeenCalled();
    },
  );

  it("lets metadata callers distinguish database failures from missing communities", async () => {
    sql.mockRejectedValue(new Error("database unavailable"));
    await expect(getCommunityShareData("openai")).rejects.toThrow(
      "database unavailable",
    );
  });
});

describe("community route metadata", () => {
  it("uses live community data for the exact community route", async () => {
    sql.mockResolvedValue([community]);
    const metadata = await generateMetadata({
      params: Promise.resolve({ segments: ["s", community.slug] }),
    });
    expect(metadata.title).toBe("Community Created Today | Reddix");
    expect(metadata.description).toBe(community.description);
  });

  it.each([["s"], ["communities"], ["s", "openai", "other"], ["u", "openai"]])(
    "inherits root metadata without querying for segments %j",
    async (...segments) => {
      expect(
        await generateMetadata({ params: Promise.resolve({ segments }) }),
      ).toEqual({});
      expect(sql).not.toHaveBeenCalled();
    },
  );

  it("inherits root metadata when a community is missing or the database is unavailable", async () => {
    const props = { params: Promise.resolve({ segments: ["s", "openai"] }) };
    expect(await generateMetadata(props)).toEqual({});
    sql.mockRejectedValue(new Error("database unavailable"));
    expect(await generateMetadata(props)).toEqual({});
  });
});
