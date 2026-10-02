import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Member, Post } from "@/lib/types";
import { sql } from "./db";
import { DomainError, requireOnboarded } from "./domain";
import { getPosts } from "./queries";
import { iso } from "./members";

const pageSize = 25;
const snapshotLimit = 500;
function cursorSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.AUTH_MODE === "development"
  )
    return "reddix-development-feed-cursor-only";
  throw new DomainError(
    "CONFIGURATION_REQUIRED",
    "Feed signing is not configured.",
    503,
  );
}
function encodeCursor(id: string, offset: number): string {
  const value = Buffer.from(JSON.stringify({ id, offset })).toString(
    "base64url",
  );
  return `${value}.${createHmac("sha256", cursorSecret()).update(value).digest("base64url")}`;
}
function decodeCursor(cursor: string): { id: string; offset: number } {
  try {
    if (cursor.length > 500) throw new Error("Invalid cursor");
    const [value, signature, extra] = cursor.split(".");
    if (!value || !signature || extra) throw new Error("Invalid cursor");
    const expected = createHmac("sha256", cursorSecret())
      .update(value)
      .digest("base64url");
    if (
      expected.length !== signature.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    )
      throw new Error("Invalid cursor");
    return z
      .object({
        id: z.uuid(),
        offset: z.number().int().min(0).max(snapshotLimit),
      })
      .parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    throw new DomainError(
      "INVALID_CURSOR",
      "This feed link is invalid. Refresh to load a new feed.",
      400,
    );
  }
}

export async function getFeed(member: Member, params: URLSearchParams) {
  requireOnboarded(member);
  const input = z
    .object({
      sort: z.enum(["popular", "new"]).default("popular"),
      scope: z.enum(["all", "following"]).default("all"),
      community: z.string().max(80).optional(),
      city: z.string().max(80).optional(),
      cursor: z.string().max(500).optional(),
    })
    .parse(Object.fromEntries(params));
  let snapshotId: string,
    orderedIds: string[],
    asOf: string,
    offset = 0;
  let saveSnapshot: PromiseLike<unknown> = Promise.resolve();
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor);
    snapshotId = cursor.id;
    offset = cursor.offset;
    const [snapshot] =
      await sql`SELECT * FROM feed_snapshots WHERE id=${snapshotId} AND user_id=${member.id} AND expires_at>now()`;
    if (!snapshot)
      throw new DomainError(
        "FEED_EXPIRED",
        "This feed has expired. Refresh to see the latest conversations.",
        410,
      );
    orderedIds = snapshot.ordered_ids;
    asOf = iso(snapshot.as_of);
  } else {
    snapshotId = randomUUID();
    const captured = new Date();
    asOf = captured.toISOString();
    const rows =
      await sql`SELECT p.id${input.sort === "popular" ? sql`,COALESCE((SELECT sum(v.value) FROM post_votes v WHERE v.post_id=p.id),0) score` : sql``}
      FROM posts p JOIN communities c ON c.id=p.community_id
      WHERE p.status='published' AND p.created_at<=${captured}
      AND ${input.sort === "popular" ? sql`p.created_at>=${new Date(captured.getTime() - 86400000)}` : sql`true`}
      AND ${input.scope === "following" ? sql`EXISTS(SELECT 1 FROM community_memberships f WHERE f.user_id=${member.id} AND f.community_id=p.community_id)` : sql`true`}
      AND ${input.community ? sql`c.slug=${input.community}` : sql`true`}
      AND ${input.city ? sql`c.city=${input.city}` : sql`true`}
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=${member.id} AND b.blocked_id=p.author_id)
      ORDER BY ${input.sort === "popular" ? sql`score DESC,p.created_at DESC,p.id DESC` : sql`p.created_at DESC,p.id DESC`} LIMIT ${snapshotLimit}`;
    orderedIds = rows.map((r) => r.id);
    // A single-page feed has no cursor to preserve. For longer feeds, persist
    // the snapshot alongside the first page read instead of adding a round trip.
    if (orderedIds.length > pageSize)
      saveSnapshot = sql`INSERT INTO feed_snapshots(id,user_id,sort,scope,community,city,ordered_ids,as_of)
        VALUES(${snapshotId},${member.id},${input.sort},${input.scope},${input.community ?? null},${input.city ?? null},${sql.json(orderedIds)},${captured})`;
  }
  const posts: Post[] = [];
  await Promise.all([
    saveSnapshot,
    (async () => {
      while (posts.length < pageSize && offset < orderedIds.length) {
        const remaining = pageSize - posts.length,
          candidates = orderedIds.slice(offset, offset + remaining);
        const visible = await getPosts(member.id, undefined, candidates),
          byId = new Map(visible.map((post) => [post.id, post]));
        for (const id of candidates) {
          const post = byId.get(id);
          if (post) posts.push(post);
        }
        offset += candidates.length;
      }
    })(),
  ]);
  return {
    posts,
    nextCursor:
      offset < orderedIds.length ? encodeCursor(snapshotId, offset) : null,
    asOf,
  };
}
