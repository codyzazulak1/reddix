import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as search } from "../src/app/api/search/route";
import {
  createDevelopmentSession,
  DEV_COOKIE,
  ensureAuthDatabase,
} from "../src/lib/auth-store";
import type { Member } from "../src/lib/types";
import { sql } from "../src/server/db";
import { getFeed } from "../src/server/feed";
import { getMemberById } from "../src/server/members";
import { getPostDetail, getPosts } from "../src/server/queries";

describe.runIf(process.env.RUN_DB_TESTS === "1")(
  "bounded navigation queries",
  () => {
    const prefix = `performance-${randomUUID()}`;
    const viewerId = `${prefix}-viewer`;
    const authorId = `${prefix}-author`;
    const blockedId = `${prefix}-blocked`;
    const userIds = [viewerId, authorId, blockedId];
    const keyword = `needle${randomUUID().replaceAll("-", "")}`;
    const oldPostId = `${prefix}-old`;
    let viewer: Member;
    let cookie: string;

    beforeAll(async () => {
      await ensureAuthDatabase();
      for (const id of userIds)
        await sql`INSERT INTO users(id,x_id,name,handle,verification_type,verification_expires_at,admitted_at,onboarding_completed_at)
          VALUES(${id},${id},${id === viewerId ? "Viewer" : keyword},${id},'blue',now()+interval '1 day',now(),now())`;
      await sql`INSERT INTO communities(id,slug,name,description) VALUES(${prefix},${prefix},'Performance fixture','Query test fixtures')`;
      await sql`INSERT INTO blocks(user_id,blocked_id) VALUES(${viewerId},${blockedId})`;
      await sql`INSERT INTO posts(id,community_id,author_id,title,body,created_at)
        SELECT ${prefix}||'-filler-'||n,${prefix},${authorId},'Unrelated discussion','Unrelated body',now()-n*interval '1 minute'
        FROM generate_series(1,205) AS n`;
      await sql`INSERT INTO posts(id,community_id,author_id,title,body,created_at)
        VALUES(${oldPostId},${prefix},${authorId},${keyword},'An older matching discussion',now()-interval '1 year'),
          (${`${prefix}-hidden`},${prefix},${blockedId},${keyword},'Blocked discussion',now())`;
      await sql`INSERT INTO comments(id,post_id,author_id,body)
        VALUES(${`${prefix}-comment`},${oldPostId},${authorId},'Visible reply'),
          (${`${prefix}-hidden-comment`},${oldPostId},${blockedId},'Blocked reply')`;
      await sql`INSERT INTO events(id,host_id,title,description,source,city,timezone,starts_at,ends_at,exact_address)
        SELECT ${prefix}||'-event-'||n,${authorId},'Unrelated event','Unrelated description','native','sf','America/Los_Angeles',now()+n*interval '1 day',now()+n*interval '1 day'+interval '1 hour','Private address'
        FROM generate_series(1,151) AS n`;
      for (const [suffix, hostId, visibility] of [
        ["matching", authorId, "listed"],
        ["unlisted", authorId, "unlisted"],
        ["invited", authorId, "invited"],
        ["blocked", blockedId, "listed"],
      ])
        await sql`INSERT INTO events(id,host_id,title,description,source,city,timezone,starts_at,ends_at,exact_address,visibility)
          VALUES(${`${prefix}-${suffix}`},${hostId},${keyword},'Matching description','native','sf','America/Los_Angeles',now()+interval '1 year',now()+interval '1 year 1 hour','Private address',${visibility})`;
      viewer = (await getMemberById(viewerId))!;
      cookie = `${DEV_COOKIE}=${await createDevelopmentSession(viewerId)}`;
    }, 30_000);

    afterAll(async () => {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM auth_dev_sessions WHERE member_id IN ${tx(userIds)}`;
        await tx`DELETE FROM feed_snapshots WHERE user_id IN ${tx(userIds)}`;
        await tx`DELETE FROM comments WHERE author_id IN ${tx(userIds)}`;
        await tx`DELETE FROM posts WHERE author_id IN ${tx(userIds)}`;
        await tx`DELETE FROM events WHERE host_id IN ${tx(userIds)}`;
        await tx`DELETE FROM blocks WHERE user_id IN ${tx(userIds)}`;
        await tx`DELETE FROM communities WHERE id=${prefix}`;
        await tx`DELETE FROM users WHERE id IN ${tx(userIds)}`;
      });
    });

    it("finds matching content beyond bootstrap limits while enforcing privacy", async () => {
      const response = await search(
        new Request(`http://127.0.0.1:3000/api/search?q=${keyword}`, {
          headers: { cookie },
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const data = await response.json();
      expect(data.posts.map((post: { id: string }) => post.id)).toEqual([
        oldPostId,
      ]);
      expect(data.events.map((event: { id: string }) => event.id)).toEqual([
        `${prefix}-matching`,
      ]);
      expect(data.events[0].exactAddress).toBeNull();
      expect(data.members.map((member: { id: string }) => member.id)).toEqual([
        authorId,
      ]);
      expect(data.members[0]).not.toHaveProperty("preferences");
    });

    it("returns full detail with filtered comments and rejects blocked posts", async () => {
      const detail = await getPostDetail(viewer, oldPostId);
      expect(detail.post.id).toBe(oldPostId);
      expect(detail.comments.map((comment) => comment.id)).toEqual([
        `${prefix}-comment`,
      ]);
      await expect(
        getPostDetail(viewer, `${prefix}-hidden`),
      ).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    });

    it("filters profile posts before the query limit and rechecks blocks", async () => {
      const visible = await getPosts(viewer.id, undefined, undefined, {
        authorId,
        limit: 100,
      });
      expect(visible).toHaveLength(100);
      expect(visible.every((post) => post.author.id === authorId)).toBe(true);
      expect(
        await getPosts(viewer.id, undefined, undefined, {
          authorId: blockedId,
          limit: 100,
        }),
      ).toEqual([]);
    });

    it("writes a snapshot only for paginated feeds and preserves cursor ownership", async () => {
      const empty = await getFeed(
        viewer,
        new URLSearchParams({ sort: "new", community: `${prefix}-absent` }),
      );
      expect(empty.posts).toEqual([]);
      expect(empty.nextCursor).toBeNull();
      expect(
        await sql`SELECT id FROM feed_snapshots WHERE user_id=${viewerId}`,
      ).toHaveLength(0);

      const first = await getFeed(
        viewer,
        new URLSearchParams({ sort: "new", community: prefix }),
      );
      expect(first.posts).toHaveLength(25);
      expect(first.nextCursor).toBeTruthy();
      expect(
        await sql`SELECT id FROM feed_snapshots WHERE user_id=${viewerId}`,
      ).toHaveLength(1);
      const second = await getFeed(
        viewer,
        new URLSearchParams({ cursor: first.nextCursor! }),
      );
      expect(second.posts).toHaveLength(25);
      expect(
        second.posts.some((post) => first.posts.some((p) => p.id === post.id)),
      ).toBe(false);
      await expect(
        getFeed(
          { ...viewer, id: authorId },
          new URLSearchParams({ cursor: first.nextCursor! }),
        ),
      ).rejects.toMatchObject({ code: "FEED_EXPIRED" });

      await sql`UPDATE posts SET status='removed' WHERE community_id=${prefix} AND id<>${oldPostId}`;
      const single = await getFeed(
        viewer,
        new URLSearchParams({ sort: "new", community: prefix }),
      );
      expect(single.posts.map((post) => post.id)).toEqual([oldPostId]);
      expect(single.nextCursor).toBeNull();
      expect(
        await sql`SELECT id FROM feed_snapshots WHERE user_id=${viewerId}`,
      ).toHaveLength(1);
    });
  },
);
