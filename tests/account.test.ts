import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "../src/server/db";
import { getMemberById, getMemberByXId } from "../src/server/members";
import { performAction } from "../src/server/actions";
import { currentMember } from "../src/lib/auth-session";
import { resyncMember } from "../src/lib/auth-resync";
import type { Member } from "../src/lib/types";
import {
  ATTEMPT_COOKIE,
  createAuthenticationAttempt,
  createDevelopmentSession,
  DEV_COOKIE,
  ensureAuthDatabase,
  PASS_COOKIE,
  findAdmissionAttempt,
  recordAttemptProfile,
} from "../src/lib/auth-store";
import { tokenDigest } from "../src/lib/auth-policy";
import { parseXProfile } from "../src/lib/auth-x";
import { writePrivateImage } from "../src/server/storage";
import { GET as exportRoute } from "../src/app/api/account/export/route";
import { POST as revokeRoute } from "../src/app/api/account/revoke-sessions/route";
import { DELETE as deleteRoute } from "../src/app/api/account/route";
import { GET as accountStatusRoute } from "../src/app/api/account/status/route";
import { GET as authStatusRoute } from "../src/app/api/auth/status/route";
import { GET as bootstrapRoute } from "../src/app/api/bootstrap/route";
import { POST as logoutRoute } from "../src/app/api/auth/logout/route";

config({ path: ".env.local", quiet: true });
const prefix = `account-test-${randomUUID()}`;
const ownerId = `${prefix}-owner`,
  keepId = `${prefix}-keep`,
  hostId = `${prefix}-host`,
  waiterId = `${prefix}-waiter`;
const memberIds = [ownerId, keepId, hostId, waiterId];
const ownerXId = `${prefix}-x`;
const ownPost = `${prefix}-post`,
  hostPost = `${prefix}-host-post`,
  keepPost = `${prefix}-keep-post`;
const ownComment = `${prefix}-comment`,
  otherReply = `${prefix}-reply`;
const ownEvent = `${prefix}-own-event`,
  hostEvent = `${prefix}-host-event`,
  assetId = randomUUID();
const authUserId = `${prefix}-auth-user`,
  authAccountId = `${prefix}-auth-account`;
const origin = "http://127.0.0.1:3000";
let primaryToken: string,
  secondaryToken: string,
  ownerCookie: string,
  keepCookie: string,
  issuedCode: string,
  storedKey: string;
let originalOwner: Member;
const request = (
  pathname: string,
  cookie?: string,
  method = "GET",
  body?: unknown,
  requestOrigin = origin,
) =>
  new Request(`${origin}${pathname}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      Origin: requestOrigin,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AUTH_MODE", "development");
  vi.stubEnv("AUTO_MIGRATE", "1");
  vi.stubEnv("X_CLIENT_ID", "");
  vi.stubEnv("STORAGE_BUCKET", "");
  await ensureAuthDatabase();
  for (const id of memberIds)
    await sql`INSERT INTO users(id,x_id,name,handle,bio,location,verification_type,verification_checked_at,verification_expires_at,admitted_at,onboarding_completed_at,preferences)
    VALUES(${id},${id === ownerId ? ownerXId : id},${id === ownerId ? "Account Owner" : "Other Fixture"},${id},${id === ownerId ? "own-profile-bio" : "other-private-profile-text"},'Example City','blue',now(),now()+interval '24 hours',now(),now(),${sql.json({ city: id === ownerId ? "own-private-city" : "other-private-city" })})`;
  await sql`INSERT INTO posts(id,community_id,author_id,title,body,type,image_url) VALUES
    (${ownPost},'sf',${ownerId},'Owner private contribution','Own post body','image',${`/api/media/${assetId}`}),
    (${hostPost},'sf',${hostId},'Other member contribution','other-member-body-secret','text',NULL),
    (${keepPost},'sf',${keepId},'Keep my anonymous contribution','Retained content by explicit choice','text',NULL)`;
  await sql`INSERT INTO comments(id,post_id,parent_id,author_id,body,depth) VALUES(${ownComment},${ownPost},NULL,${ownerId},'Own comment body',0),(${otherReply},${ownPost},${ownComment},${hostId},'Another member reply survives.',1)`;
  await sql`INSERT INTO post_votes(user_id,post_id,value) VALUES(${ownerId},${hostPost},1),(${hostId},${ownPost},1)`;
  await sql`INSERT INTO comment_votes(user_id,comment_id,value) VALUES(${ownerId},${otherReply},1)`;
  await sql`INSERT INTO saved_posts(user_id,post_id) VALUES(${ownerId},${hostPost})`;
  await sql`INSERT INTO community_memberships(user_id,community_id) VALUES(${ownerId},'sf')`;
  for (const [id, host] of [
    [ownEvent, ownerId],
    [hostEvent, hostId],
  ])
    await sql`INSERT INTO events(id,host_id,title,description,source,city,timezone,starts_at,ends_at,venue,exact_address,capacity)
    VALUES(${id},${host},${host === ownerId ? "Own event title" : "Other private event title"},${host === ownerId ? "Own sensitive event details" : "other-private-event-description"},'native','sf','UTC',now()+interval '2 days',now()+interval '2 days 2 hours','Neighborhood',${host === ownerId ? "own-private-exact-address" : "other-private-exact-address"},1)`;
  await sql`INSERT INTO event_rsvps(event_id,user_id,status) VALUES(${ownEvent},${hostId},'going'),(${hostEvent},${ownerId},'going'),(${hostEvent},${waiterId},'waitlisted')`;
  await sql`INSERT INTO event_updates(id,event_id,author_id,body) VALUES(${randomUUID()},${ownEvent},${ownerId},'Own private guest announcement')`;
  await sql`INSERT INTO notifications(id,user_id,type,message,resource_id,dedupe_key) VALUES(${randomUUID()},${hostId},'reply','Account Owner replied to your discussion.',${ownPost},${`comment:${ownComment}`}),(${randomUUID()},${ownerId},'reply','Your notification',${hostPost},NULL)`;
  await sql`INSERT INTO auth_user(id,name,email) VALUES(${authUserId},'Account Owner',${`${ownerXId}@x.reddix.invalid`})`;
  await sql`INSERT INTO auth_account(id,account_id,provider_id,user_id,access_token,refresh_token) VALUES(${authAccountId},${ownerXId},'twitter',${authUserId},'server-provider-access-secret','server-provider-refresh-secret')`;
  await sql`INSERT INTO auth_session(id,expires_at,token,user_id) VALUES(${`${prefix}-auth-session-1`},now()+interval '1 day',${`${prefix}-auth-secret-1`},${authUserId}),(${`${prefix}-auth-session-2`},now()+interval '1 day',${`${prefix}-auth-secret-2`},${authUserId})`;
  primaryToken = await createDevelopmentSession(ownerId);
  secondaryToken = await createDevelopmentSession(ownerId);
  originalOwner = (await getMemberById(ownerId))!;
  ownerCookie = `${DEV_COOKIE}=${primaryToken}`;
  keepCookie = `${DEV_COOKIE}=${await createDevelopmentSession(keepId)}`;
  await sql`INSERT INTO auth_admission_passes(token_digest,member_id,x_id,expires_at) VALUES(${tokenDigest(`${prefix}-pass-secret`)},${ownerId},${ownerXId},now()+interval '30 days')`;
  // Retained invitation history must remain private after enrollment codes retire.
  issuedCode = `${prefix}-legacy-code`;
  await sql`INSERT INTO enrollment_invites(id,code_digest,issuer_id,expires_at) VALUES(${`${prefix}-legacy-invite`},${tokenDigest(issuedCode)},${ownerId},now()+interval '7 days')`;
  storedKey = await writePrivateImage(
    assetId,
    Buffer.from("synthetic private image"),
    "image/webp",
  );
  await sql`INSERT INTO media_assets(id,owner_id,storage_key,mime_type,byte_size,width,height,attached_post_id) VALUES(${assetId},${ownerId},${storedKey},'image/webp',23,1,1,${ownPost})`;
}, 30000);

afterAll(async () => {
  const postIds = [ownPost, hostPost, keepPost],
    eventIds = [ownEvent, hostEvent];
  await sql`DELETE FROM auth_dev_sessions WHERE member_id IN ${sql(memberIds)}`;
  await sql`DELETE FROM rate_limits WHERE key LIKE ${`action:${prefix}%`}`;
  await sql`DELETE FROM auth_admission_passes WHERE member_id IN ${sql(memberIds)}`;
  await sql`DELETE FROM auth_sync_state WHERE member_id IN ${sql(memberIds)}`;
  await sql`DELETE FROM auth_admission_attempts WHERE invite_id IN (SELECT id FROM enrollment_invites WHERE issuer_id IN ${sql(memberIds)})`;
  await sql`DELETE FROM enrollment_invites WHERE issuer_id IN ${sql(memberIds)}`;
  await sql`DELETE FROM auth_user WHERE id=${authUserId}`;
  await sql`DELETE FROM auth_audit WHERE member_id IN ${sql(memberIds)}`;
  await sql`DELETE FROM audit_events WHERE actor_id IN ${sql(memberIds)}`;
  await sql`DELETE FROM notifications WHERE user_id IN ${sql(memberIds)}`;
  await sql`DELETE FROM event_updates WHERE event_id IN ${sql(eventIds)}`;
  await sql`DELETE FROM event_rsvps WHERE event_id IN ${sql(eventIds)}`;
  await sql`DELETE FROM event_invitations WHERE event_id IN ${sql(eventIds)}`;
  await sql`DELETE FROM saved_events WHERE event_id IN ${sql(eventIds)}`;
  await sql`DELETE FROM events WHERE id IN ${sql(eventIds)}`;
  await sql`DELETE FROM media_assets WHERE owner_id IN ${sql(memberIds)}`;
  await sql`DELETE FROM comment_votes WHERE comment_id IN (SELECT id FROM comments WHERE post_id IN ${sql(postIds)})`;
  await sql`DELETE FROM comments WHERE post_id IN ${sql(postIds)}`;
  await sql`DELETE FROM post_votes WHERE post_id IN ${sql(postIds)}`;
  await sql`DELETE FROM saved_posts WHERE post_id IN ${sql(postIds)}`;
  await sql`DELETE FROM posts WHERE id IN ${sql(postIds)}`;
  await sql`DELETE FROM community_memberships WHERE user_id IN ${sql(memberIds)}`;
  await sql`DELETE FROM users WHERE id IN ${sql(memberIds)}`;
  vi.unstubAllEnvs();
});

describe("account privacy and session controls", () => {
  it("requires authentication to export account data", async () => {
    expect((await exportRoute(request("/api/account/export"))).status).toBe(
      401,
    );
  });

  it("reports returning admission only for a validated browser pass without exposing identity", async () => {
    const passed = await authStatusRoute(
      request("/api/auth/status", `${PASS_COOKIE}=${prefix}-pass-secret`),
    );
    const status = await passed.json();
    expect(status.returningMember).toBe(true);
    expect(JSON.stringify(status)).not.toContain(ownerId);
    const invalid = await authStatusRoute(
      request("/api/auth/status", `${PASS_COOKIE}=forged-pass`),
    );
    expect((await invalid.json()).returningMember).toBe(false);
  });

  it("exports only the caller's records, without provider credentials, invitation secrets, or other guests", async () => {
    const response = await exportRoute(
      request(`/api/account/export?memberId=${hostId}`, ownerCookie),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    const result = await response.json();
    expect(result.member.id).toBe(ownerId);
    expect(result.posts).toHaveLength(1);
    expect(result.comments).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.registrations).toHaveLength(1);
    expect(result.events[0].exact_address).toBe("own-private-exact-address");
    const encoded = JSON.stringify(result);
    for (const forbidden of [
      "server-provider-access-secret",
      "server-provider-refresh-secret",
      "auth-secret",
      issuedCode,
      "code_digest",
      "token_digest",
      "other-member-body-secret",
      "other-private-event-description",
      "other-private-exact-address",
      "other-private-city",
    ])
      expect(encoded).not.toContain(forbidden);
  });

  it("revokes other sessions while preserving the session that requested it", async () => {
    const blocked = await revokeRoute(
      request(
        "/api/account/revoke-sessions",
        ownerCookie,
        "POST",
        {},
        "https://attacker.invalid",
      ),
    );
    expect(blocked.status).toBe(403);
    const response = await revokeRoute(
      request("/api/account/revoke-sessions", ownerCookie, "POST", {}),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      revoked: 3,
      currentSessionKept: true,
    });
    expect((await currentMember(request("/", ownerCookie)))?.id).toBe(ownerId);
    expect(
      await currentMember(request("/", `${DEV_COOKIE}=${secondaryToken}`)),
    ).toBeNull();
    expect(
      await sql`SELECT id FROM auth_session WHERE user_id=${authUserId}`,
    ).toHaveLength(0);
  });

  it("requires exact handle confirmation and recent authentication before deletion", async () => {
    const crossSite = await deleteRoute(
      request(
        "/api/account",
        ownerCookie,
        "DELETE",
        { confirmation: ownerId },
        "https://attacker.invalid",
      ),
    );
    expect(crossSite.status).toBe(403);
    const mismatch = await deleteRoute(
      request("/api/account", ownerCookie, "DELETE", {
        confirmation: "wrong-handle",
      }),
    );
    expect(mismatch.status).toBe(422);
    expect((await getMemberById(ownerId))?.status).toBe("active");
    await sql`UPDATE auth_dev_sessions SET created_at=now()-interval '1 hour' WHERE token_digest=${tokenDigest(primaryToken)}`;
    const stale = await deleteRoute(
      request("/api/account", ownerCookie, "DELETE", { confirmation: ownerId }),
    );
    expect(stale.status).toBe(403);
    expect((await getMemberById(ownerId))?.status).toBe("active");
    await sql`UPDATE auth_dev_sessions SET created_at=now() WHERE token_digest=${tokenDigest(primaryToken)}`;
  });

  it("atomically anonymizes identity, deletes own content, revokes credentials, cancels events, and preserves other replies", async () => {
    const response = await deleteRoute(
      request("/api/account", ownerCookie, "DELETE", { confirmation: ownerId }),
    );
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result.deleted).toBe(true);
    expect(result.contentDeleted).toBe(true);
    expect(result.counts).toMatchObject({
      posts: 1,
      comments: 1,
      canceledEvents: 1,
      revokedRegistrations: 1,
      media: 1,
    });
    expect(result.mediaCleanupPending).toBe(0);
    const member = await getMemberById(ownerId);
    expect(member).toMatchObject({
      name: "[deleted]",
      bio: "",
      avatarUrl: null,
      status: "deleted",
      eligible: false,
      isAdmin: false,
      admittedAt: null,
    });
    expect(member?.xId).not.toBe(ownerXId);
    expect(await getMemberByXId(ownerXId)).toBeNull();
    expect(await currentMember(request("/", ownerCookie))).toBeNull();
    expect(
      await sql`SELECT id FROM auth_account WHERE user_id=${authUserId}`,
    ).toHaveLength(0);
    expect(
      await sql`SELECT id FROM auth_user WHERE id=${authUserId}`,
    ).toHaveLength(0);
    expect(
      await sql`SELECT token_digest FROM auth_admission_passes WHERE member_id=${ownerId}`,
    ).toHaveLength(0);
    expect(
      (
        await (
          await authStatusRoute(
            request("/api/auth/status", `${PASS_COOKIE}=${prefix}-pass-secret`),
          )
        ).json()
      ).returningMember,
    ).toBe(false);
    const [post] =
      await sql`SELECT title,body,status,image_url FROM posts WHERE id=${ownPost}`;
    expect(post).toMatchObject({
      title: "[deleted]",
      body: "",
      status: "deleted",
      image_url: null,
    });
    const [comment] =
      await sql`SELECT body,status FROM comments WHERE id=${ownComment}`;
    expect(comment).toMatchObject({ body: "", status: "deleted" });
    const [reply] =
      await sql`SELECT body,status FROM comments WHERE id=${otherReply}`;
    expect(reply).toMatchObject({
      body: "Another member reply survives.",
      status: "published",
    });
    expect(
      await sql`SELECT * FROM post_votes WHERE user_id=${ownerId}`,
    ).toHaveLength(0);
    expect(
      await sql`SELECT * FROM post_votes WHERE user_id=${hostId} AND post_id=${ownPost}`,
    ).toHaveLength(1);
    const [event] =
      await sql`SELECT title,description,status,exact_address FROM events WHERE id=${ownEvent}`;
    expect(event).toMatchObject({
      title: "[deleted event]",
      description: "",
      status: "canceled",
      exact_address: null,
    });
    const notices =
      await sql`SELECT message FROM notifications WHERE user_id=${hostId}`;
    expect(notices.some((n) => n.message.includes("organizer deleted"))).toBe(
      true,
    );
    expect(notices.every((n) => !n.message.includes("Account Owner"))).toBe(
      true,
    );
    await expect(
      access(path.join(process.cwd(), ".data", "media", storedKey)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("releases a deleted member's event seat and promotes an eligible waiter", async () => {
    expect(
      await sql`SELECT user_id FROM event_rsvps WHERE user_id=${ownerId}`,
    ).toHaveLength(0);
    const [promoted] =
      await sql`SELECT status FROM event_rsvps WHERE event_id=${hostEvent} AND user_id=${waiterId}`;
    expect(promoted.status).toBe("going");
    const [count] =
      await sql`SELECT count(*)::int count FROM event_rsvps WHERE event_id=${hostEvent} AND status='going'`;
    expect(count.count).toBe(1);
  });

  it("does not let a queued resync restore a deleted account's X presentation", async () => {
    await expect(resyncMember(originalOwner)).rejects.toMatchObject({
      status: 403,
    });
    expect((await getMemberById(ownerId))?.name).toBe("[deleted]");
  });

  it("rejects a contribution using a cached member record after account deletion", async () => {
    await expect(
      performAction(originalOwner, {
        action: "createPost",
        communityId: "sf",
        title: "Stale identity must not publish",
        body: "A request authenticated before deletion cannot publish afterward.",
        type: "text",
      }),
    ).rejects.toMatchObject({ code: "RX002" });
    const [count] =
      await sql`SELECT count(*)::int count FROM posts WHERE author_id=${ownerId} AND status='published'`;
    expect(count.count).toBe(0);
  });

  it("keeps privacy controls available when suspended or onboarding-pending, and can retain anonymous contributions", async () => {
    await sql`UPDATE users SET status='suspended',onboarding_completed_at=NULL WHERE id=${keepId}`;
    const status = await accountStatusRoute(
      request("/api/account/status", keepCookie),
    );
    expect(status.status).toBe(200);
    expect((await status.json()).member.status).toBe("suspended");
    expect(
      (await bootstrapRoute(request("/api/bootstrap", keepCookie))).status,
    ).toBe(403);
    expect(
      (await exportRoute(request("/api/account/export", keepCookie))).status,
    ).toBe(200);
    const response = await deleteRoute(
      request("/api/account", keepCookie, "DELETE", {
        confirmation: keepId,
        deleteContent: false,
      }),
    );
    expect(response.status).toBe(200);
    const [post] =
      await sql`SELECT p.body,p.status,u.name,u.avatar_url FROM posts p JOIN users u ON u.id=p.author_id WHERE p.id=${keepPost}`;
    expect(post).toMatchObject({
      body: "Retained content by explicit choice",
      status: "published",
      name: "[deleted]",
      avatar_url: null,
    });
    expect(await currentMember(request("/", keepCookie))).toBeNull();
  });

  it("clears the returning-member pass on logout so another verified X account can sign in", async () => {
    const token = await createDevelopmentSession(hostId);
    const passToken = `${prefix}-logout-pass`;
    await sql`INSERT INTO auth_admission_passes(token_digest,member_id,x_id,expires_at) VALUES(${tokenDigest(passToken)},${hostId},${hostId},now()+interval '30 days')`;
    const attempts: string[] = [];
    try {
      const priorAttempt = await createAuthenticationAttempt(passToken);
      attempts.push(priorAttempt.id);
      const otherProfile = parseXProfile({
        id: "987654321",
        name: "Another Verified Member",
        username: "another_member",
        verified_type: "blue",
      });
      await expect(
        recordAttemptProfile(priorAttempt.id, otherProfile),
      ).rejects.toThrow("does not match");
      const cookie = `${DEV_COOKIE}=${token}; ${PASS_COOKIE}=${passToken}; ${ATTEMPT_COOKIE}=${priorAttempt.token}`;
      const response = await logoutRoute(
        request("/api/auth/logout", cookie, "POST"),
      );
      expect(response.status).toBe(200);
      for (const name of [DEV_COOKIE, ATTEMPT_COOKIE, PASS_COOKIE])
        expect(response.cookies.get(name)).toMatchObject({
          value: "",
          maxAge: 0,
          path: "/",
          httpOnly: true,
          sameSite: "lax",
        });
      expect(await currentMember(request("/", cookie))).toBeNull();
      // Apply the logout response's cleared pass to the next sign-in attempt.
      const nextAttempt = await createAuthenticationAttempt(
        response.cookies.get(PASS_COOKIE)?.value || null,
      );
      attempts.push(nextAttempt.id);
      expect(
        (await findAdmissionAttempt(nextAttempt.token))?.expected_x_id,
      ).toBeNull();
      await expect(
        recordAttemptProfile(nextAttempt.id, otherProfile),
      ).resolves.toBeUndefined();
    } finally {
      if (attempts.length)
        await sql`DELETE FROM auth_admission_attempts WHERE id IN ${sql(attempts)}`;
    }
  });
});
