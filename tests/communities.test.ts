import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  COMMUNITY_CATALOG,
  communityMatchesSearch,
} from "../src/lib/community-catalog";
import { ensureDatabase, sql } from "../src/server/db";
import { seedCommunities } from "../src/server/seed";

const requestedSlugs = [
  "a16z",
  "speedrun",
  "y-combinator",
  "tesla",
  "openai",
  "anthropic",
];

describe("curated community catalog", () => {
  it("contains unique, routable topics including the requested communities", () => {
    const slugs = COMMUNITY_CATALOG.map((community) => community.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toEqual(expect.arrayContaining(requestedSlugs));
    for (const community of COMMUNITY_CATALOG) {
      expect(community.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(community.name.trim().length).toBeGreaterThan(0);
      expect(community.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("searches aliases and requires every mixed-case or hyphenated token to match", () => {
    const a16z = COMMUNITY_CATALOG.find((item) => item.slug === "a16z")!;
    const yc = COMMUNITY_CATALOG.find((item) => item.slug === "y-combinator")!;
    expect(communityMatchesSearch(a16z, "  ANDREESSEN Horowitz  ")).toBe(true);
    expect(communityMatchesSearch(yc, "YC applications")).toBe(true);
    expect(communityMatchesSearch(yc, "Y-COMBINATOR")).toBe(true);
    expect(communityMatchesSearch(yc, "YC unrelated-topic")).toBe(false);
    expect(communityMatchesSearch(a16z, "  ")).toBe(true);
  });
});

describe.runIf(process.env.RUN_DB_TESTS === "1")(
  "community catalog seeding",
  () => {
    beforeAll(async () => {
      await ensureDatabase();
    });

    it("adds every topic once without overwriting admin edits or memberships on reseed", async () => {
      await sql.begin(async (tx) => {
        // Temporary tables shadow the live tables on this transaction's connection.
        // The production seed SQL runs against the actual schema without changing
        // any real community, membership, user, or discussion.
        await tx`CREATE TEMPORARY TABLE communities (LIKE public.communities INCLUDING ALL) ON COMMIT DROP`;
        await tx`CREATE TEMPORARY TABLE community_memberships (LIKE public.community_memberships INCLUDING ALL) ON COMMIT DROP`;
        await seedCommunities(tx);
        const first =
          await tx`SELECT id,slug,name FROM communities ORDER BY slug`;
        expect(first).toHaveLength(COMMUNITY_CATALOG.length);
        expect(first.map((row) => row.slug)).toEqual(
          COMMUNITY_CATALOG.map((community) => community.slug).sort(),
        );

        const memberId = `catalog-test-${randomUUID()}`;
        const joinedAt = new Date("2026-01-05T12:30:00.000Z");
        await tx`UPDATE communities SET name='Community-maintained OpenAI',description='Edited by a community administrator.',rules='Custom community rules.',color='#abcdef',icon='code',archived=true WHERE slug='openai'`;
        await tx`INSERT INTO community_memberships(user_id,community_id,created_at) VALUES(${memberId},'openai',${joinedAt})`;
        const [edited] =
          await tx`SELECT * FROM communities WHERE slug='openai'`;
        const [membership] =
          await tx`SELECT * FROM community_memberships WHERE user_id=${memberId}`;

        await seedCommunities(tx);
        expect(await tx`SELECT id FROM communities`).toHaveLength(first.length);
        expect(await tx`SELECT * FROM communities WHERE slug='openai'`).toEqual(
          [edited],
        );
        expect(
          await tx`SELECT * FROM community_memberships WHERE user_id=${memberId}`,
        ).toEqual([membership]);
        expect(
          await tx`SELECT slug,count(*)::int AS count FROM communities WHERE slug IN ${tx(requestedSlugs)} GROUP BY slug ORDER BY slug`,
        ).toEqual(
          [...requestedSlugs].sort().map((slug) => ({ slug, count: 1 })),
        );
      });
    });

    it("makes each requested topic available exactly once in the configured database", async () => {
      const topics =
        await sql`SELECT slug,count(*)::int AS count FROM communities WHERE slug IN ${sql(requestedSlugs)} GROUP BY slug ORDER BY slug`;
      expect(topics).toEqual(
        [...requestedSlugs].sort().map((slug) => ({ slug, count: 1 })),
      );
    });
  },
);
