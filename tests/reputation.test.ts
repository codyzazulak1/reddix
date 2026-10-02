import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GET as profileRead } from "../src/app/api/members/[id]/route";
import {
  createDevelopmentSession,
  DEV_COOKIE,
  ensureAuthDatabase,
} from "../src/lib/auth-store";
import type { Member } from "../src/lib/types";
import { performAction } from "../src/server/actions";
import { sql } from "../src/server/db";
import { getMemberById } from "../src/server/members";
import { getBootstrap } from "../src/server/queries";
import { getReputation } from "../src/server/reputation";

describe.runIf(process.env.RUN_DB_TESTS === "1")(
  "contribution reputation",
  () => {
    const prefix = `rep-${randomUUID()}`;
    const authorId = `${prefix}-author`;
    const voterId = `${prefix}-voter`;
    const otherId = `${prefix}-other`;
    const ids = [authorId, voterId, otherId];
    const postId = `${prefix}-post`;
    const commentId = `${prefix}-comment`;
    let author: Member, voter: Member, other: Member, cookie: string;

    async function clearContributions() {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM comment_votes WHERE user_id IN ${tx(ids)}`;
        await tx`DELETE FROM post_votes WHERE user_id IN ${tx(ids)}`;
        await tx`DELETE FROM comments WHERE author_id IN ${tx(ids)}`;
        await tx`DELETE FROM posts WHERE author_id IN ${tx(ids)}`;
        await tx`DELETE FROM blocks WHERE user_id IN ${tx(ids)}`;
        await tx`DELETE FROM rate_limits WHERE key LIKE ${`action:${prefix}%`}`;
      });
    }

    beforeAll(async () => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("AUTH_MODE", "development");
      vi.stubEnv("AUTO_MIGRATE", "1");
      await ensureAuthDatabase();
      for (const id of ids)
        await sql`INSERT INTO users(id,x_id,name,handle,verification_type,verification_expires_at,admitted_at,onboarding_completed_at)
        VALUES(${id},${id},'Reputation fixture',${id},'blue',now()+interval '1 day',now(),now())`;
      [author, voter, other] = (await Promise.all(
        ids.map(getMemberById),
      )) as Member[];
      cookie = `${DEV_COOKIE}=${await createDevelopmentSession(voterId)}`;
    }, 30_000);

    beforeEach(async () => {
      await clearContributions();
      await sql`INSERT INTO posts(id,community_id,author_id,title,body)
      VALUES(${postId},'sf',${authorId},'Reputation test discussion','A contribution with its automatic self vote.')`;
      await sql`INSERT INTO comments(id,post_id,author_id,body)
      VALUES(${commentId},${postId},${authorId},'A reply with its automatic self vote.')`;
      await sql`INSERT INTO post_votes(user_id,post_id,value) VALUES(${authorId},${postId},1)`;
      await sql`INSERT INTO comment_votes(user_id,comment_id,value) VALUES(${authorId},${commentId},1)`;
    });

    afterAll(async () => {
      await clearContributions();
      await sql`DELETE FROM auth_dev_sessions WHERE member_id IN ${sql(ids)}`;
      await sql`DELETE FROM users WHERE id IN ${sql(ids)}`;
      vi.unstubAllEnvs();
    });

    function profileRequest(authenticated = true) {
      return profileRead(
        new Request(`http://127.0.0.1:3000/api/members/${authorId}`, {
          headers: authenticated ? { cookie } : {},
        }),
        { params: Promise.resolve({ id: authorId }) },
      );
    }

    it("starts at zero and excludes self votes even when changed or withdrawn", async () => {
      expect(await getReputation(authorId)).toEqual({
        posts: 0,
        comments: 0,
        total: 0,
      });
      expect(await getReputation(voterId)).toEqual({
        posts: 0,
        comments: 0,
        total: 0,
      });
      for (const value of [-1, 0, 1]) {
        await performAction(author, { action: "vote", postId, value });
        await performAction(author, { action: "vote", commentId, value });
        expect(await getReputation(authorId)).toEqual({
          posts: 0,
          comments: 0,
          total: 0,
        });
      }
    });

    it("credits the author separately for post and comment votes, not the voter", async () => {
      await performAction(voter, { action: "vote", postId, value: 1 });
      await performAction(other, { action: "vote", postId, value: 1 });
      await performAction(voter, { action: "vote", commentId, value: -1 });
      expect(await getReputation(authorId)).toEqual({
        posts: 2,
        comments: 0,
        total: 2,
      });
      expect(await getReputation(voterId)).toEqual({
        posts: 0,
        comments: 0,
        total: 0,
      });
      expect((await getBootstrap(author)).reputation).toEqual({
        posts: 2,
        comments: 0,
        total: 2,
      });
      expect(
        (await getBootstrap({ ...author, onboardingCompletedAt: null }))
          .reputation,
      ).toEqual({ posts: 0, comments: 0, total: 0 });
    });

    it.each(["post", "comment"] as const)(
      "handles concurrent duplicate %s votes, vote switches, and withdrawal exactly once",
      async (kind) => {
        const target = kind === "post" ? { postId } : { commentId };
        const key = kind === "post" ? "posts" : "comments";
        await Promise.all(
          Array.from({ length: 4 }, () =>
            performAction(voter, { action: "vote", ...target, value: 1 }),
          ),
        );
        expect((await getReputation(authorId))[key]).toBe(1);
        await performAction(voter, { action: "vote", ...target, value: -1 });
        const floor = { posts: 0, comments: 0, total: 0 };
        expect(await getReputation(authorId)).toEqual(floor);
        expect((await (await profileRequest()).json()).reputation).toEqual(
          floor,
        );
        await performAction(voter, { action: "vote", ...target, value: -1 });
        expect(await getReputation(authorId)).toEqual(floor);

        // Preserve negative vote totals so recovering to zero earns no points.
        await performAction(other, { action: "vote", ...target, value: -1 });
        expect(await getReputation(authorId)).toEqual(floor);
        await performAction(voter, { action: "vote", ...target, value: 1 });
        expect(await getReputation(authorId)).toEqual(floor);
        await performAction(other, { action: "vote", ...target, value: 0 });
        expect((await getReputation(authorId))[key]).toBe(1);

        await performAction(voter, { action: "vote", ...target, value: -1 });
        await performAction(
          { ...voter, eligible: false, verificationType: "none" },
          { action: "vote", ...target, value: 0 },
        );
        expect(await getReputation(authorId)).toEqual({
          posts: 0,
          comments: 0,
          total: 0,
        });
        await performAction(voter, { action: "vote", ...target, value: 1 });
        expect((await getReputation(authorId))[key]).toBe(1);
      },
    );

    it("excludes removed or deleted content and restores the current votes when republished", async () => {
      await performAction(voter, { action: "vote", postId, value: 1 });
      await performAction(voter, { action: "vote", commentId, value: 1 });
      for (const status of ["removed", "deleted"]) {
        await sql`UPDATE comments SET status=${status} WHERE id=${commentId}`;
        expect(await getReputation(authorId)).toEqual({
          posts: 1,
          comments: 0,
          total: 1,
        });
        await sql`UPDATE comments SET status='published' WHERE id=${commentId}`;
        expect(await getReputation(authorId)).toEqual({
          posts: 1,
          comments: 1,
          total: 2,
        });
        await sql`UPDATE posts SET status=${status} WHERE id=${postId}`;
        expect(await getReputation(authorId)).toEqual({
          posts: 0,
          comments: 0,
          total: 0,
        });
        await sql`UPDATE posts SET status='published' WHERE id=${postId}`;
        expect(await getReputation(authorId)).toEqual({
          posts: 1,
          comments: 1,
          total: 2,
        });
      }
      await sql`DELETE FROM post_votes WHERE user_id=${voterId}`;
      await sql`DELETE FROM comment_votes WHERE user_id=${voterId}`;
      expect(await getReputation(authorId)).toEqual({
        posts: 0,
        comments: 0,
        total: 0,
      });
    });

    it("does not credit rejected votes or expose a blocked member's reputation", async () => {
      await expect(
        performAction(
          { ...voter, eligible: false, verificationType: "none" },
          {
            action: "vote",
            postId,
            value: 1,
          },
        ),
      ).rejects.toMatchObject({ code: "VERIFICATION_REQUIRED" });
      await expect(
        performAction(voter, { action: "vote", postId, value: 2 }),
      ).rejects.toThrow();
      expect(await getReputation(authorId)).toEqual({
        posts: 0,
        comments: 0,
        total: 0,
      });
      expect((await profileRequest(false)).status).toBe(401);
      await sql`INSERT INTO blocks(user_id,blocked_id) VALUES(${voterId},${authorId})`;
      const blocked = await profileRequest();
      expect(blocked.status).toBe(404);
      expect(await blocked.json()).not.toHaveProperty("reputation");
    });

    it("includes existing votes across the full history beyond profile and bootstrap limits", async () => {
      await sql`INSERT INTO posts(id,community_id,author_id,title,body)
      SELECT ${prefix}||'-history-post-'||n,'sf',${authorId},'History contribution','Previously voted post'
      FROM generate_series(1,205) AS n`;
      await sql`INSERT INTO comments(id,post_id,author_id,body)
      SELECT ${prefix}||'-history-comment-'||n,${postId},${authorId},'Previously voted comment'
      FROM generate_series(1,205) AS n`;
      await sql`INSERT INTO post_votes(user_id,post_id,value)
      SELECT ${voterId},id,1 FROM posts WHERE author_id=${authorId} AND id<>${postId}`;
      await sql`INSERT INTO comment_votes(user_id,comment_id,value)
      SELECT ${voterId},id,1 FROM comments WHERE author_id=${authorId} AND id<>${commentId}`;
      const expected = { posts: 205, comments: 205, total: 410 };
      expect(await getReputation(authorId)).toEqual(expected);
      const response = await profileRequest();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const profile = await response.json();
      expect(profile.posts).toHaveLength(100);
      expect(profile.comments).toHaveLength(100);
      expect(profile.reputation).toEqual(expected);
      expect(profile.member).not.toHaveProperty("preferences");
      const bootstrap = await getBootstrap(author);
      expect(bootstrap.posts).toHaveLength(200);
      expect(bootstrap.reputation).toEqual(expected);
    });
  },
);
