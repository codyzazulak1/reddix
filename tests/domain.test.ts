import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Member, Post } from "../src/lib/types";
import {
  DomainError,
  isFreshEligible,
  popular24Hours,
  requireEligible,
  rsvpDecision,
  safeHttpsUrl,
} from "../src/server/domain";
import { defaultPreferences, getMemberById } from "../src/server/members";
import { ensureDatabase, sql } from "../src/server/db";
import { performAction } from "../src/server/actions";
import {
  changeRsvp,
  closeEventRegistration,
  createEvent,
  editEvent,
  reviewRsvp,
} from "../src/server/events";
import { getBootstrap, getEvents, getPosts } from "../src/server/queries";
import { getFeed } from "../src/server/feed";
import { escapeIcs, foldCalendarLine } from "../src/server/calendar";

const now = Date.now();
const member: Member = {
  id: "test",
  xId: "test",
  name: "Test",
  handle: "test",
  avatarUrl: null,
  bio: "",
  website: "",
  location: "",
  followersCount: 999999,
  followingCount: 0,
  verificationType: "blue",
  verificationCheckedAt: new Date(now).toISOString(),
  verificationExpiresAt: new Date(now + 86400000).toISOString(),
  eligible: true,
  isAdmin: false,
  admittedAt: new Date(now).toISOString(),
  onboardingCompletedAt: new Date(now).toISOString(),
  status: "active",
  preferences: defaultPreferences,
  invitesRemaining: 3,
  createdAt: new Date(now).toISOString(),
};

describe("contribution policy", () => {
  it("accepts only fresh blue or business evidence", () => {
    expect(isFreshEligible(member, now)).toBe(true);
    expect(
      isFreshEligible({ ...member, verificationType: "business" }, now),
    ).toBe(true);
    for (const verificationType of ["government", "none", "unknown"] as const)
      expect(isFreshEligible({ ...member, verificationType }, now)).toBe(false);
    expect(
      isFreshEligible(
        { ...member, verificationExpiresAt: new Date(now).toISOString() },
        now,
      ),
    ).toBe(false);
    expect(isFreshEligible({ ...member, status: "suspended" }, now)).toBe(
      false,
    );
    expect(isFreshEligible({ ...member, admittedAt: null }, now)).toBe(false);
  });
  it("does not permit admin or follower count to bypass verification", () => {
    expect(() =>
      requireEligible({ ...member, isAdmin: true, verificationType: "none" }),
    ).toThrow(DomainError);
  });
  it("rejects script and credential-bearing links", () => {
    expect(() => safeHttpsUrl("javascript:alert(1)")).toThrow();
    expect(() => safeHttpsUrl("https://user:secret@example.com")).toThrow();
    expect(safeHttpsUrl("https://example.com/path")).toBe(
      "https://example.com/path",
    );
  });
});

describe("published ranking", () => {
  it("uses creation in the last 24 hours, score, timestamp and stable ID without follower boosts", () => {
    const post = (
      id: string,
      score: number,
      age: number,
      status = "published",
    ) =>
      ({
        id,
        score,
        createdAt: new Date(now - age).toISOString(),
        status,
      }) as Post;
    const ranked = popular24Hours(
      [
        post("old", 999, 86400001),
        post("removed", 100, 1, "removed"),
        post("future", 10, -1),
        post("a", 4, 1000),
        post("b", 4, 1000),
        post("new", 4, 1),
        post("winner", 5, 2000),
      ],
      now,
    );
    expect(ranked.map((p) => p.id)).toEqual(["winner", "new", "b", "a"]);
  });
});

describe("RSVP decisions", () => {
  it("never consumes a seat while awaiting approval", () =>
    expect(
      rsvpDecision({
        full: false,
        approvalRequired: true,
        approved: false,
        waitlistEnabled: true,
      }),
    ).toBe("pending_approval"));
  it("waitlists a full approved request only when enabled", () => {
    expect(
      rsvpDecision({
        full: true,
        approvalRequired: true,
        approved: true,
        waitlistEnabled: true,
      }),
    ).toBe("waitlisted");
    expect(() =>
      rsvpDecision({
        full: true,
        approvalRequired: true,
        approved: true,
        waitlistEnabled: false,
      }),
    ).toThrow(/full/);
  });
});

describe("calendar exports", () => {
  it("escapes controls and folds UTF-8 lines without corrupting characters", () => {
    expect(escapeIcs("Room 1, 2;\nHello")).toBe("Room 1\\, 2\\;\\nHello");
    const original = "SUMMARY:" + "Café ☕ ".repeat(30),
      folded = foldCalendarLine(original);
    expect(
      folded.split("\r\n").every((line) => Buffer.byteLength(line) <= 75),
    ).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(original);
  });
});

describe.runIf(process.env.RUN_DB_TESTS === "1")(
  "PostgreSQL domain invariants",
  () => {
    const prefix = `test-${randomUUID()}`;
    const userIds = [
      `${prefix}-host`,
      `${prefix}-a`,
      `${prefix}-b`,
      `${prefix}-reader`,
    ];
    let host: Member, a: Member, b: Member, reader: Member;
    beforeAll(async () => {
      await ensureDatabase();
      for (const [index, id] of userIds.entries())
        await sql`INSERT INTO users(id,x_id,name,handle,verification_type,verification_checked_at,verification_expires_at,admitted_at,onboarding_completed_at)
      VALUES(${id},${id},'Test member',${id},${index === 3 ? "none" : "blue"},now(),now()+interval '1 day',now(),now())`;
      [host, a, b, reader] = (await Promise.all(
        userIds.map(getMemberById),
      )) as Member[];
      await sql`INSERT INTO communities(id,slug,name,description) VALUES(${prefix},${prefix},'Test community','Temporary integration test community')`;
    });
    afterAll(async () => {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM notifications WHERE user_id IN ${tx(userIds)} OR resource_id IN (SELECT id FROM events WHERE host_id=${userIds[0]})`;
        await tx`DELETE FROM event_rsvps WHERE user_id IN ${tx(userIds)} OR event_id IN (SELECT id FROM events WHERE host_id=${userIds[0]})`;
        await tx`DELETE FROM event_invitations WHERE event_id IN (SELECT id FROM events WHERE host_id=${userIds[0]})`;
        await tx`DELETE FROM events WHERE host_id=${userIds[0]}`;
        await tx`DELETE FROM comment_votes WHERE user_id IN ${tx(userIds)}`;
        await tx`DELETE FROM comments WHERE author_id IN ${tx(userIds)}`;
        await tx`DELETE FROM post_votes WHERE user_id IN ${tx(userIds)}`;
        await tx`DELETE FROM saved_posts WHERE user_id IN ${tx(userIds)}`;
        await tx`DELETE FROM posts WHERE author_id IN ${tx(userIds)}`;
        await tx`DELETE FROM community_memberships WHERE user_id IN ${tx(userIds)}`;
        await tx`DELETE FROM feed_snapshots WHERE user_id IN ${tx(userIds)}`;
        await tx`DELETE FROM communities WHERE id=${prefix}`;
        await tx`DELETE FROM users WHERE id IN ${tx(userIds)}`;
        await tx`DELETE FROM rate_limits WHERE key LIKE ${`%${prefix}%`}`;
      });
    });
    const eventInput = (overrides: Record<string, unknown> = {}) => ({
      title: "Test private dinner",
      description: "An event for integration testing only.",
      source: "native",
      city: "sf",
      timezone: "America/Los_Angeles",
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 90000000).toISOString(),
      venue: "Neighborhood",
      exactAddress: "Secret exact address",
      capacity: 1,
      ...overrides,
    });
    it("blocks browse-only contributions while allowing personal saves/preferences", async () => {
      await expect(
        performAction(reader, {
          action: "createPost",
          communityId: "sf",
          title: "Must not publish",
          body: "No verification",
        }),
      ).rejects.toMatchObject({ code: "VERIFICATION_REQUIRED" });
      await expect(
        performAction(reader, {
          action: "preferences",
          preferences: { density: "compact" },
        }),
      ).resolves.toHaveProperty("member.preferences.density", "compact");
    });
    it("returns no community content before required onboarding consent", async () => {
      const pending = await getBootstrap({ ...a, onboardingCompletedAt: null });
      expect(pending.member.id).toBe(a.id);
      expect(pending.posts).toEqual([]);
      expect(pending.events).toEqual([]);
      expect(pending.communities).toEqual([]);
    });
    it("keeps concurrent requested votes idempotent and permits unverified withdrawal", async () => {
      const { post } = (await performAction(host, {
        action: "createPost",
        communityId: "sf",
        title: "Vote invariant",
        body: "Testing concurrency.",
      })) as { post: Post };
      await Promise.all(
        [1, 2, 3].map(() =>
          performAction(a, { action: "vote", postId: post.id, value: 1 }),
        ),
      );
      const [row] =
        await sql`SELECT count(*) count FROM post_votes WHERE user_id=${a.id} AND post_id=${post.id}`;
      expect(Number(row.count)).toBe(1);
      expect((await getPosts(host.id, post.id))[0].score).toBe(2);
      await performAction(
        { ...a, verificationType: "none", eligible: false },
        { action: "vote", postId: post.id, value: 0 },
      );
      expect((await getPosts(host.id, post.id))[0].score).toBe(1);
    });
    it("rejects a parent comment from another post", async () => {
      const first = (await performAction(host, {
        action: "createPost",
        communityId: "sf",
        title: "Parent thread",
        body: "First thread.",
      })) as { post: Post };
      const second = (await performAction(host, {
        action: "createPost",
        communityId: "sf",
        title: "Other thread",
        body: "Second thread.",
      })) as { post: Post };
      const comment = await performAction(a, {
        action: "comment",
        postId: first.post.id,
        body: "Parent comment",
      });
      await expect(
        performAction(b, {
          action: "comment",
          postId: second.post.id,
          parentId: comment.commentId,
          body: "Invalid reply",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });
    it("allocates the last seat once and promotes the waitlist on withdrawal", async () => {
      const { event } = await createEvent(host, eventInput());
      const responses = await Promise.all([
        changeRsvp(a, { eventId: event.id, state: "going" }),
        changeRsvp(b, { eventId: event.id, state: "going" }),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([
        "going",
        "waitlisted",
      ]);
      const winner = responses[0].status === "going" ? a : b,
        waiter = winner.id === a.id ? b : a;
      await changeRsvp(
        { ...winner, eligible: false, verificationType: "none" },
        { eventId: event.id, state: "canceled" },
      );
      expect((await getEvents(waiter.id, event.id))[0].myRsvp).toBe("going");
      expect((await getEvents(host.id, event.id))[0].goingCount).toBe(1);
    });
    it("preserves pending approval when full and waitlisting is disabled", async () => {
      const { event } = await createEvent(
        host,
        eventInput({ requiresApproval: true, waitlistEnabled: false }),
      );
      await changeRsvp(a, { eventId: event.id, state: "going" });
      await changeRsvp(b, { eventId: event.id, state: "going" });
      await reviewRsvp(host, {
        eventId: event.id,
        memberId: a.id,
        decision: "approved",
      });
      await expect(
        reviewRsvp(host, {
          eventId: event.id,
          memberId: b.id,
          decision: "approved",
        }),
      ).rejects.toMatchObject({ code: "EVENT_FULL" });
      const [row] =
        await sql`SELECT status,approved FROM event_rsvps WHERE event_id=${event.id} AND user_id=${b.id}`;
      expect(row.status).toBe("pending_approval");
      expect(row.approved).toBe(false);
    });
    it("protects restricted event metadata and exact venue", async () => {
      const { event } = await createEvent(
        host,
        eventInput({ visibility: "invited" }),
      );
      expect(await getEvents(a.id, event.id)).toEqual([]);
      expect((await getEvents(host.id, event.id))[0].exactAddress).toBe(
        "Secret exact address",
      );
      const listed = await createEvent(host, eventInput());
      expect(
        (await getEvents(a.id, listed.event.id))[0].exactAddress,
      ).toBeNull();
      await changeRsvp(a, { eventId: listed.event.id, state: "going" });
      expect((await getEvents(a.id, listed.event.id))[0].exactAddress).toBe(
        "Secret exact address",
      );
    });
    it("rejects undersized capacity and stale edits, and closes registration", async () => {
      const { event } = await createEvent(host, eventInput({ capacity: 2 }));
      await changeRsvp(a, { eventId: event.id, state: "going" });
      await changeRsvp(b, { eventId: event.id, state: "going" });
      await expect(
        editEvent(host, { eventId: event.id, capacity: 1 }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await editEvent(host, {
        eventId: event.id,
        title: "Updated event title",
        revision: 1,
      });
      await expect(
        editEvent(host, {
          eventId: event.id,
          title: "Stale event title",
          revision: 1,
        }),
      ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
      await closeEventRegistration(host, event.id);
      await expect(
        changeRsvp(host, { eventId: event.id, state: "going" }),
      ).rejects.toMatchObject({ code: "EVENT_CLOSED" });
      await expect(
        changeRsvp(a, { eventId: event.id, state: "canceled" }),
      ).resolves.toHaveProperty("status", "canceled");
    });
    it("keeps feed pages stable and owner-bound while rechecking removed content", async () => {
      for (let index = 0; index < 30; index++)
        await sql`INSERT INTO posts(id,community_id,author_id,title,body,created_at)
      VALUES(${`${prefix}-feed-${index}`},${prefix},${host.id},${`Feed ${index}`},'Test fixture',${new Date(Date.now() - 30000 + index * 100)})`;
      const first = await getFeed(
        a,
        new URLSearchParams({ sort: "new", community: prefix }),
      );
      expect(first.posts).toHaveLength(25);
      expect(first.nextCursor).toBeTruthy();
      await sql`UPDATE posts SET status='removed' WHERE id=${`${prefix}-feed-3`}`;
      await sql`INSERT INTO posts(id,community_id,author_id,title,body) VALUES(${`${prefix}-feed-new`},${prefix},${host.id},'New after snapshot','Test fixture')`;
      const second = await getFeed(
        a,
        new URLSearchParams({ cursor: first.nextCursor! }),
      );
      expect(second.posts.map((post) => post.id)).toEqual(
        [4, 2, 1, 0].map((index) => `${prefix}-feed-${index}`),
      );
      expect(second.nextCursor).toBeNull();
      await expect(
        getFeed(b, new URLSearchParams({ cursor: first.nextCursor! })),
      ).rejects.toMatchObject({ code: "FEED_EXPIRED" });
      await expect(
        getFeed(
          a,
          new URLSearchParams({ cursor: first.nextCursor! + "tamper" }),
        ),
      ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    });
    it("rejects cached membership writes after account deletion or badge loss", async () => {
      await sql`UPDATE users SET verification_type='none',verification_expires_at=NULL WHERE id=${b.id}`;
      await expect(
        performAction(b, {
          action: "createPost",
          communityId: "sf",
          title: "Must not publish stale verification",
          body: "Cached request.",
        }),
      ).rejects.toMatchObject({ code: "RX001" });
      await sql`UPDATE users SET status='deleted',admitted_at=NULL WHERE id=${b.id}`;
      await expect(
        performAction(b, {
          action: "createPost",
          communityId: "sf",
          title: "Must not publish after deletion",
          body: "Cached request.",
        }),
      ).rejects.toMatchObject({ code: "RX002" });
      await expect(
        performAction(b, {
          action: "preferences",
          preferences: { city: "Toronto" },
        }),
      ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
      await expect(
        sql`INSERT INTO media_assets(id,owner_id,storage_key,mime_type,byte_size,width,height) VALUES(${randomUUID()},${b.id},'not-uploaded.webp','image/webp',10,1,1)`,
      ).rejects.toMatchObject({ code: "RX002" });
      expect(
        await sql`SELECT id FROM posts WHERE author_id=${b.id}`,
      ).toHaveLength(0);
    });
  },
);
