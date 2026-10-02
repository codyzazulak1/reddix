import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Member } from "../src/lib/types";
import { sql } from "../src/server/db";
import { getMemberById } from "../src/server/members";
import {
  getBootstrap,
  getPostDetail,
  canReadEvent,
} from "../src/server/queries";
import { performAction } from "../src/server/actions";
import {
  createDevelopmentSession,
  DEV_COOKIE,
  ensureAuthDatabase,
} from "../src/lib/auth-store";
import { GET as mediaRead } from "../src/app/api/media/[id]/route";
import { GET as bootstrapRead } from "../src/app/api/bootstrap/route";
import { POST as rawAuthPost } from "../src/app/api/auth/[...all]/route";
import { POST as developmentLogin } from "../src/app/api/auth/dev-login/route";
import { GET as eventRead } from "../src/app/api/events/[id]/route";

config({ path: ".env.local", quiet: true });
const prefix = `security-${randomUUID()}`;
const ownerId = `${prefix}-owner`,
  viewerId = `${prefix}-viewer`,
  readerId = `${prefix}-reader`;
const postId = `${prefix}-post`,
  removedPostId = `${prefix}-removed`,
  commentId = `${prefix}-comment`,
  removedCommentId = `${prefix}-removed-comment`;
const eventId = `${prefix}-event`,
  attachedImageId = randomUUID(),
  unattachedImageId = randomUUID();
const origin = "http://127.0.0.1:3000";
let viewer: Member, reader: Member, viewerCookie: string, readerCookie: string;

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AUTH_MODE", "development");
  vi.stubEnv("AUTO_MIGRATE", "1");
  await ensureAuthDatabase();
  for (const id of [ownerId, viewerId, readerId]) {
    await sql`INSERT INTO users(id,x_id,name,handle,verification_type,verification_checked_at,verification_expires_at,admitted_at,onboarding_completed_at,preferences)
      VALUES(${id},${id},'Security fixture',${id},'blue',now(),now()+interval '24 hours',now(),now(),${sql.json({ city: "private-city-preference", interests: ["private-interest"] })})`;
  }
  await sql`INSERT INTO blocks(user_id,blocked_id) VALUES(${viewerId},${ownerId})`;
  await sql`INSERT INTO posts(id,community_id,author_id,title,body,type,image_url) VALUES(${postId},'sf',${ownerId},'Hidden author security fixture','Do not expose this blocked discussion.','image',${`/api/media/${attachedImageId}`})`;
  await sql`INSERT INTO posts(id,community_id,author_id,title,body,status) VALUES(${removedPostId},'sf',${ownerId},'Removed security fixture','Removed discussion body.','removed')`;
  await sql`INSERT INTO comments(id,post_id,author_id,body) VALUES(${commentId},${postId},${ownerId},'Hidden author comment'),(${removedCommentId},${removedPostId},${ownerId},'Comment beneath a removed discussion')`;
  await sql`INSERT INTO events(id,host_id,title,description,source,city,timezone,starts_at,ends_at,venue,exact_address,venue_disclosure)
    VALUES(${eventId},${ownerId},'Hidden host security fixture','Private test event description.','native','sf','America/Los_Angeles',now()+interval '2 days',now()+interval '2 days 2 hours','Approximate neighborhood','private-venue-secret','attendees')`;
  await sql`INSERT INTO event_updates(id,event_id,author_id,body) VALUES(${randomUUID()},${eventId},${ownerId},'Guest-only logistical update with private meeting link.')`;
  const directory = path.join(process.cwd(), ".data", "media");
  await mkdir(directory, { recursive: true });
  for (const id of [attachedImageId, unattachedImageId]) {
    await writeFile(
      path.join(directory, `${id}.webp`),
      "synthetic private media bytes",
      { mode: 0o600 },
    );
    await sql`INSERT INTO media_assets(id,owner_id,storage_key,mime_type,byte_size,width,height,attached_post_id)
      VALUES(${id},${ownerId},${`${id}.webp`},'image/webp',28,1,1,${id === attachedImageId ? postId : null})`;
  }
  viewer = (await getMemberById(viewerId))!;
  reader = (await getMemberById(readerId))!;
  viewerCookie = `${DEV_COOKIE}=${await createDevelopmentSession(viewerId)}`;
  readerCookie = `${DEV_COOKIE}=${await createDevelopmentSession(readerId)}`;
}, 30000);

afterAll(async () => {
  const ids = [ownerId, viewerId, readerId],
    posts = [postId, removedPostId];
  await sql`DELETE FROM auth_dev_sessions WHERE member_id IN ${sql(ids)}`;
  await sql`DELETE FROM rate_limits WHERE key LIKE ${`action:${prefix}%`}`;
  await sql`DELETE FROM notifications WHERE user_id IN ${sql(ids)}`;
  await sql`DELETE FROM reports WHERE reporter_id IN ${sql(ids)}`;
  await sql`DELETE FROM saved_events WHERE event_id=${eventId}`;
  await sql`DELETE FROM event_rsvps WHERE event_id=${eventId}`;
  await sql`DELETE FROM event_updates WHERE event_id=${eventId}`;
  await sql`DELETE FROM events WHERE id=${eventId}`;
  await sql`DELETE FROM media_assets WHERE owner_id=${ownerId}`;
  await sql`DELETE FROM comment_votes WHERE comment_id IN (SELECT id FROM comments WHERE post_id IN ${sql(posts)})`;
  await sql`DELETE FROM comments WHERE post_id IN ${sql(posts)}`;
  await sql`DELETE FROM post_votes WHERE post_id IN ${sql(posts)}`;
  await sql`DELETE FROM saved_posts WHERE post_id IN ${sql(posts)}`;
  await sql`DELETE FROM posts WHERE id IN ${sql(posts)}`;
  await sql`DELETE FROM blocks WHERE user_id IN ${sql(ids)} OR blocked_id IN ${sql(ids)}`;
  await sql`DELETE FROM users WHERE id IN ${sql(ids)}`;
  await Promise.all(
    [attachedImageId, unattachedImageId].map((id) =>
      unlink(path.join(process.cwd(), ".data", "media", `${id}.webp`)).catch(
        () => undefined,
      ),
    ),
  );
  vi.unstubAllEnvs();
});

describe("resource authorization survives direct API calls", () => {
  it("requires a session for bootstrap and raw image reads", async () => {
    expect(
      (await bootstrapRead(new Request(`${origin}/api/bootstrap`))).status,
    ).toBe(401);
    expect(
      (
        await mediaRead(new Request(`${origin}/api/media/${attachedImageId}`), {
          params: Promise.resolve({ id: attachedImageId }),
        })
      ).status,
    ).toBe(401);
  });

  it("does not expose another member's settings, eligibility lease, role, or X ID in bootstrap author DTOs", async () => {
    const data = await getBootstrap(reader);
    const other = data.members.find((member) => member.id === ownerId)!;
    expect(other).toBeTruthy();
    const publicAuthor = data.posts.find((post) => post.id === postId)!.author;
    for (const dto of [other, publicAuthor]) {
      for (const privateField of [
        "xId",
        "preferences",
        "isAdmin",
        "verificationExpiresAt",
        "admittedAt",
        "invitesRemaining",
        "email",
        "accessToken",
        "refreshToken",
      ]) {
        expect(dto).not.toHaveProperty(privateField);
      }
    }
    expect(JSON.stringify(other)).not.toContain("private-city-preference");
    expect(
      data.events.find((event) => event.id === eventId)?.exactAddress,
    ).toBeNull();
  });

  it("does not allow voting on a discussion omitted by the viewer's block", async () => {
    await expect(getPostDetail(viewer, postId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      performAction(viewer, { action: "vote", postId, value: 1 }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("does not allow comments or replies on a discussion omitted by a block", async () => {
    await expect(
      performAction(viewer, {
        action: "comment",
        postId,
        body: "Bypass attempt",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      performAction(viewer, {
        action: "comment",
        postId,
        parentId: commentId,
        body: "Hidden-parent bypass attempt",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("does not allow voting on a comment whose parent discussion is removed", async () => {
    await expect(
      performAction(reader, {
        action: "vote",
        commentId: removedCommentId,
        value: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("redacts moderator-removed post titles and tags as well as their body", async () => {
    const detail = await getPostDetail(reader, removedPostId);
    expect(JSON.stringify(detail.post)).not.toContain(
      "Removed security fixture",
    );
    expect(detail.post.body).toBe("");
    expect(detail.post.tags).toEqual([]);
    expect(detail.post.imageUrl).toBeNull();
  });

  it("does not allow voting on a comment under a blocked discussion", async () => {
    await expect(
      performAction(viewer, { action: "vote", commentId, value: -1 }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("applies the same post visibility rules to raw image reads", async () => {
    const hidden = await mediaRead(
      new Request(`${origin}/api/media/${attachedImageId}`, {
        headers: { Cookie: viewerCookie },
      }),
      { params: Promise.resolve({ id: attachedImageId }) },
    );
    expect(hidden.status).toBe(404);
    const visible = await mediaRead(
      new Request(`${origin}/api/media/${attachedImageId}`, {
        headers: { Cookie: readerCookie },
      }),
      { params: Promise.resolve({ id: attachedImageId }) },
    );
    expect(visible.status).toBe(200);
    expect(visible.headers.get("Cache-Control")).toContain("no-store");
    const draft = await mediaRead(
      new Request(`${origin}/api/media/${unattachedImageId}`, {
        headers: { Cookie: readerCookie },
      }),
      { params: Promise.resolve({ id: unattachedImageId }) },
    );
    expect(draft.status).toBe(404);
  });

  it("does not allow RSVP or saving for an event hidden by a blocked host", async () => {
    expect(await canReadEvent(viewer.id, eventId)).toBe(false);
    await expect(
      performAction(viewer, { action: "rsvp", eventId, state: "going" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      performAction(viewer, { action: "saveEvent", eventId, saved: true }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("limits guest announcements to the host and intended RSVP audience", async () => {
    const request = new Request(`${origin}/api/events/${eventId}`, {
      headers: { Cookie: readerCookie },
    });
    const context = { params: Promise.resolve({ id: eventId }) };
    const publicView = await eventRead(request, context);
    expect(publicView.status).toBe(200);
    expect((await publicView.json()).updates).toEqual([]);
    await sql`INSERT INTO event_rsvps(event_id,user_id,status) VALUES(${eventId},${readerId},'going')`;
    const attendeeView = await eventRead(request, context);
    expect((await attendeeView.json()).updates).toHaveLength(1);
    await sql`UPDATE event_rsvps SET status='canceled' WHERE event_id=${eventId} AND user_id=${readerId}`;
    const formerAttendeeView = await eventRead(request, context);
    expect((await formerAttendeeView.json()).updates).toEqual([]);
  });

  it("keeps forbidden auth-library endpoints unreachable over HTTP", async () => {
    for (const endpoint of [
      "get-access-token",
      "refresh-token",
      "update-user",
      "link-social",
      "unlink-account",
      "sign-up/email",
      "sign-in/email",
    ]) {
      const response = await rawAuthPost(
        new Request(`${origin}/api/auth/${endpoint}`, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: "{}",
        }),
      );
      expect(response.status).toBe(404);
    }
  });

  it("cannot use the development login endpoint in a production process", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const response = await developmentLogin(
        new Request(`${origin}/api/auth/dev-login`, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({ persona: "alex" }),
        }),
      );
      expect(response.status).toBe(404);
    } finally {
      vi.stubEnv("NODE_ENV", "test");
    }
  });
});
