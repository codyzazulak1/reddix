import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureAuthDatabase } from "../src/lib/auth-store";
import type { Member } from "../src/lib/types";
import { performAction } from "../src/server/actions";
import { sql } from "../src/server/db";
import { getMemberById } from "../src/server/members";

describe.runIf(process.env.RUN_DB_TESTS === "1")(
  "admin community creation and suggestion review",
  () => {
    const prefix = `admin-subs-${randomUUID()}`;
    const adminId = `${prefix}-admin`;
    const memberId = `${prefix}-member`;
    const expiredAuthorId = `${prefix}-expired`;
    const memberIds = [adminId, memberId, expiredAuthorId];
    let admin: Member, member: Member, expiredAuthor: Member;

    async function suggest(label: string, author = member) {
      const name = `${prefix} ${label}`;
      const description = `A dedicated community for ${label} discussions.`;
      // Insert a pending fixture without sending synthetic requests to real admins.
      await sql`INSERT INTO community_suggestions(id,user_id,name,description,city)
        VALUES(${randomUUID()},${author.id},${name},${description},'Toronto')`;
      const [suggestion] = await sql<
        { id: string; name: string; description: string; status: string }[]
      >`SELECT id,name,description,status FROM community_suggestions WHERE user_id=${author.id} AND name=${name}`;
      return { ...suggestion, slug: name.replaceAll(" ", "-") };
    }

    async function reviewEffects(suggestionId: string) {
      const [suggestion] =
        await sql`SELECT status,resolution FROM community_suggestions WHERE id=${suggestionId}`;
      const notifications =
        await sql`SELECT user_id,type,resource_id FROM notifications WHERE dedupe_key=${`community-review:${suggestionId}`}`;
      const audit =
        await sql`SELECT actor_id,action,detail FROM audit_events WHERE target_id=${suggestionId}`;
      return { suggestion, notifications, audit };
    }

    beforeAll(async () => {
      expect(["127.0.0.1", "localhost"]).toContain(
        new URL(
          process.env.DATABASE_URL ??
            "postgresql://reddix@127.0.0.1:55432/reddix",
        ).hostname,
      );
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("AUTH_MODE", "development");
      vi.stubEnv("AUTO_MIGRATE", "1");
      await ensureAuthDatabase();
      for (const id of memberIds)
        await sql`INSERT INTO users(id,x_id,name,handle,verification_type,verification_expires_at,is_admin,admitted_at,onboarding_completed_at)
          VALUES(${id},${id},'Community Test Fixture',${id},${id === adminId ? "none" : "blue"},now()+interval '1 day',${id === adminId},now(),now())`;
      admin = (await getMemberById(adminId))!;
      member = (await getMemberById(memberId))!;
      expiredAuthor = (await getMemberById(expiredAuthorId))!;
    }, 30000);

    afterAll(async () => {
      // Cleanup is limited to this run's fixture users and community prefix.
      await sql`DELETE FROM notifications WHERE type='community_suggestion' AND resource_id IN (SELECT id FROM community_suggestions WHERE user_id IN ${sql(memberIds)})`;
      await sql`DELETE FROM notifications WHERE user_id IN ${sql(memberIds)}`;
      await sql`DELETE FROM audit_events WHERE actor_id IN ${sql(memberIds)}`;
      await sql`DELETE FROM rate_limits WHERE key LIKE ${`action:${prefix}%`}`;
      await sql`DELETE FROM community_suggestions WHERE user_id IN ${sql(memberIds)}`;
      await sql`DELETE FROM community_memberships WHERE user_id IN ${sql(memberIds)} OR community_id IN (SELECT id FROM communities WHERE slug LIKE ${`${prefix}%`})`;
      await sql`DELETE FROM communities WHERE slug LIKE ${`${prefix}%`}`;
      await sql`DELETE FROM users WHERE id IN ${sql(memberIds)}`;
      vi.unstubAllEnvs();
    });

    it("notifies admins of a new request with a link to its pending suggestion", async () => {
      const name = `${prefix} notify-admins`;
      try {
        await expect(
          performAction(member, {
            action: "suggestCommunity",
            name,
            description:
              "A pending request that needs an administrator's decision.",
          }),
        ).resolves.toEqual({ submitted: true });
        const [suggestion] =
          await sql`SELECT id,status FROM community_suggestions WHERE user_id=${memberId} AND name=${name}`;
        expect(suggestion.status).toBe("open");
        const notifications =
          await sql`SELECT user_id,message,read_at FROM notifications WHERE type='community_suggestion' AND resource_id=${suggestion.id}`;
        expect(notifications).toContainEqual({
          user_id: adminId,
          message: `New sub request: ${name}.`,
          read_at: null,
        });
        expect(new Set(notifications.map((item) => item.user_id)).size).toBe(
          notifications.length,
        );
        expect(notifications.some((item) => item.user_id === memberId)).toBe(
          false,
        );
        const unexpected =
          await sql`SELECT n.id FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.type='community_suggestion' AND n.resource_id=${suggestion.id} AND (u.is_admin=false OR u.is_bot=true OR u.status<>'active' OR u.admitted_at IS NULL)`;
        expect(unexpected).toHaveLength(0);
      } finally {
        // The local preview also has seeded admins. Remove only this request's notices.
        await sql`DELETE FROM notifications WHERE type='community_suggestion' AND resource_id IN (SELECT id FROM community_suggestions WHERE user_id=${memberId} AND name=${name})`;
      }
    });

    it("keeps ordinary member suggestions pending and rejects privileged member actions", async () => {
      const suggestion = await suggest("member-request");
      expect(suggestion.status).toBe("open");
      expect(
        await sql`SELECT id FROM communities WHERE slug=${suggestion.slug}`,
      ).toHaveLength(0);
      for (const input of [
        {
          action: "adminCreateCommunity",
          name: `${prefix} forbidden`,
          description: "A member cannot bypass community review.",
        },
        {
          action: "adminSuggestion",
          suggestionId: suggestion.id,
          status: "accepted",
        },
        {
          action: "adminSuggestion",
          suggestionId: suggestion.id,
          status: "declined",
        },
      ])
        await expect(performAction(member, input)).rejects.toMatchObject({
          code: "FORBIDDEN",
          status: 403,
        });
      expect((await reviewEffects(suggestion.id)).suggestion.status).toBe(
        "open",
      );
      expect(
        await sql`SELECT id FROM communities WHERE slug=${`${prefix}-forbidden`}`,
      ).toHaveLength(0);
    });

    it("lets an admin create a community immediately without a suggestion or X verification", async () => {
      expect(admin.eligible).toBe(false);
      const name = `${prefix} direct`;
      const description = "A community created directly by an administrator.";
      const result = await performAction(admin, {
        action: "adminCreateCommunity",
        name: `  ${name}  `,
        description: `  ${description}  `,
        city: "Toronto",
      });
      expect(result).toMatchObject({
        communityId: expect.any(String),
        slug: `${prefix}-direct`,
      });
      const [community] =
        await sql`SELECT name,description,city,archived FROM communities WHERE id=${String(result.communityId)}`;
      expect(community).toEqual({
        name,
        description,
        city: "Toronto",
        archived: false,
      });
      expect(
        await sql`SELECT id FROM community_suggestions WHERE name=${name}`,
      ).toHaveLength(0);
      expect(
        await sql`SELECT id FROM notifications WHERE type='community_suggestion' AND message=${`New sub request: ${name}.`}`,
      ).toHaveLength(0);
      expect(
        await sql`SELECT id FROM audit_events WHERE actor_id=${adminId} AND action='community_create' AND target_id=${String(result.communityId)}`,
      ).toHaveLength(1);
    });

    it("approves an open suggestion, creates its community and records one decision", async () => {
      const suggestion = await suggest("approve");
      const result = await performAction(admin, {
        action: "adminSuggestion",
        suggestionId: suggestion.id,
        status: "accepted",
        reason: "Useful topic for members.",
      });
      expect(result).toMatchObject({
        reviewed: true,
        communityId: expect.any(String),
        slug: suggestion.slug,
      });
      const [community] =
        await sql`SELECT name,description,city FROM communities WHERE id=${String(result.communityId)}`;
      expect(community).toEqual({
        name: suggestion.name,
        description: suggestion.description,
        city: "Toronto",
      });
      const effects = await reviewEffects(suggestion.id);
      expect(effects.suggestion).toEqual({
        status: "accepted",
        resolution: "Useful topic for members.",
      });
      expect(effects.notifications).toEqual([
        { user_id: memberId, type: "community", resource_id: suggestion.slug },
      ]);
      expect(effects.audit).toHaveLength(1);
      expect(effects.audit[0]).toMatchObject({
        actor_id: adminId,
        action: "community_suggestion_review",
        detail: { status: "accepted", communityId: result.communityId },
      });
    });

    it("declines without creating a community and prevents a later contradictory decision", async () => {
      const suggestion = await suggest("decline");
      await expect(
        performAction(admin, {
          action: "adminSuggestion",
          suggestionId: suggestion.id,
          status: "declined",
        }),
      ).resolves.toMatchObject({ reviewed: true });
      await expect(
        performAction(admin, {
          action: "adminSuggestion",
          suggestionId: suggestion.id,
          status: "accepted",
        }),
      ).rejects.toMatchObject({ code: "SUGGESTION_REVIEWED", status: 409 });
      const effects = await reviewEffects(suggestion.id);
      expect(effects.suggestion.status).toBe("declined");
      expect(effects.notifications).toHaveLength(1);
      expect(effects.audit).toHaveLength(1);
      expect(
        await sql`SELECT id FROM communities WHERE slug=${suggestion.slug}`,
      ).toHaveLength(0);
    });

    it("allows reviewing a suggestion after its author's verification expires", async () => {
      const suggestion = await suggest("expired-author", expiredAuthor);
      await sql`UPDATE users SET verification_type='none',verification_expires_at=now()-interval '1 day' WHERE id=${expiredAuthorId}`;
      await expect(
        performAction(admin, {
          action: "adminSuggestion",
          suggestionId: suggestion.id,
          status: "accepted",
        }),
      ).resolves.toMatchObject({ reviewed: true, slug: suggestion.slug });
      expect((await reviewEffects(suggestion.id)).suggestion.status).toBe(
        "accepted",
      );
      await expect(
        performAction((await getMemberById(expiredAuthorId))!, {
          action: "suggestCommunity",
          name: `${prefix} ineligible-new-request`,
          description: "An expired member still cannot submit new suggestions.",
        }),
      ).rejects.toMatchObject({ code: "VERIFICATION_REQUIRED", status: 403 });
    });

    it("keeps a conflicting suggestion open instead of silently approving an existing community", async () => {
      const suggestion = await suggest("duplicate");
      await performAction(admin, {
        action: "adminCreateCommunity",
        name: suggestion.name,
        description: "The existing community must retain its own description.",
      });
      await expect(
        performAction(admin, {
          action: "adminSuggestion",
          suggestionId: suggestion.id,
          status: "accepted",
        }),
      ).rejects.toMatchObject({ code: "COMMUNITY_EXISTS", status: 409 });
      const effects = await reviewEffects(suggestion.id);
      expect(effects.suggestion.status).toBe("open");
      expect(effects.notifications).toHaveLength(0);
      expect(effects.audit).toHaveLength(0);
      const [community] =
        await sql`SELECT description FROM communities WHERE slug=${suggestion.slug}`;
      expect(community.description).toBe(
        "The existing community must retain its own description.",
      );
    });

    it("creates exactly one community when identical direct requests race", async () => {
      const input = {
        action: "adminCreateCommunity",
        name: `${prefix} concurrent-create`,
        description:
          "Concurrent creation requests cannot duplicate communities.",
      };
      const results = await Promise.allSettled([
        performAction(admin, input),
        performAction(admin, input),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === "rejected"),
      ).toMatchObject({
        reason: { code: "COMMUNITY_EXISTS", status: 409 },
      });
      const communities =
        await sql`SELECT id FROM communities WHERE slug=${`${prefix}-concurrent-create`}`;
      expect(communities).toHaveLength(1);
      expect(
        await sql`SELECT id FROM audit_events WHERE action='community_create' AND target_id=${communities[0].id}`,
      ).toHaveLength(1);
    });

    it.each([
      ["accepted", "accepted"],
      ["accepted", "declined"],
    ] as const)(
      "records only one decision when %s and %s reviews race",
      async (first, second) => {
        const suggestion = await suggest(`race-${first}-${second}`);
        const results = await Promise.allSettled(
          [first, second].map((status) =>
            performAction(admin, {
              action: "adminSuggestion",
              suggestionId: suggestion.id,
              status,
            }),
          ),
        );
        expect(
          results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        expect(
          results.find((result) => result.status === "rejected"),
        ).toMatchObject({
          reason: { code: "SUGGESTION_REVIEWED", status: 409 },
        });
        const effects = await reviewEffects(suggestion.id);
        const winner = results.findIndex(
          (result) => result.status === "fulfilled",
        );
        expect(effects.suggestion.status).toBe([first, second][winner]);
        expect(effects.notifications).toHaveLength(1);
        expect(effects.audit).toHaveLength(1);
        expect(
          await sql`SELECT id FROM communities WHERE slug=${suggestion.slug}`,
        ).toHaveLength(effects.suggestion.status === "accepted" ? 1 : 0);
      },
    );
  },
);
