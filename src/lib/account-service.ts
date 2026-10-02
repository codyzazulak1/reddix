import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql } from "@/server/db";
import { DomainError } from "@/server/domain";
import { getMemberById } from "@/server/members";
import { deletePrivateImage } from "@/server/storage";
import type { Member } from "./types";
import { currentMember } from "./auth-session";
import { DEV_COOKIE, ensureAuthDatabase } from "./auth-store";
import { getAuth, xConfigured } from "./auth-provider";
import { isDevelopmentAuth, readCookie, tokenDigest } from "./auth-policy";

/** Privacy controls remain available to suspended, admitted accounts. */
export async function accountMember(request: Request): Promise<Member> {
  const member = await currentMember(request);
  if (!member?.admittedAt || member.status === "deleted")
    throw new DomainError(
      "AUTH_REQUIRED",
      "Sign in to manage your Reddix account.",
      401,
    );
  return member;
}

export async function exportAccount(member: Member) {
  await ensureAuthDatabase();
  const fresh = await getMemberById(member.id);
  if (!fresh || fresh.status === "deleted")
    throw new DomainError(
      "AUTH_REQUIRED",
      "This account is no longer available.",
      401,
    );
  const [
    posts,
    comments,
    events,
    registrations,
    savedPosts,
    savedEvents,
    follows,
    notifications,
    reports,
    suggestions,
    invitations,
    votes,
    commentVotes,
    blocks,
    chatConversations,
    chatMessages,
    moderation,
    xInvitations,
    affiliations,
    visitSessions,
  ] = await Promise.all([
    sql`SELECT id,community_id,title,body,type,url,image_url,status,tags,promote_on_x,created_at,updated_at FROM posts WHERE author_id=${member.id} ORDER BY created_at`,
    sql`SELECT id,post_id,parent_id,body,status,created_at,updated_at FROM comments WHERE author_id=${member.id} ORDER BY created_at`,
    sql`SELECT id,title,description,source,external_url,city,timezone,starts_at,ends_at,venue,exact_address,venue_disclosure,visibility,status,capacity,requires_approval,registration_closed,created_at FROM events WHERE host_id=${member.id} ORDER BY created_at`,
    sql`SELECT event_id,status,approved,public_attendance,created_at,updated_at FROM event_rsvps WHERE user_id=${member.id} ORDER BY created_at`,
    sql`SELECT post_id,created_at FROM saved_posts WHERE user_id=${member.id} ORDER BY created_at`,
    sql`SELECT event_id,created_at FROM saved_events WHERE user_id=${member.id} ORDER BY created_at`,
    sql`SELECT community_id,created_at FROM community_memberships WHERE user_id=${member.id} ORDER BY created_at`,
    sql`SELECT id,type,message,resource_id,read_at,created_at FROM notifications WHERE user_id=${member.id} ORDER BY created_at`,
    sql`SELECT target_type,target_id,reason,status,created_at FROM reports WHERE reporter_id=${member.id} ORDER BY created_at`,
    sql`SELECT name,description,city,status,created_at FROM community_suggestions WHERE user_id=${member.id} ORDER BY created_at`,
    sql`SELECT created_at,expires_at,revoked_at,redeemed_at FROM enrollment_invites WHERE issuer_id=${member.id} ORDER BY created_at`,
    sql`SELECT post_id,value,created_at FROM post_votes WHERE user_id=${member.id} ORDER BY created_at`,
    sql`SELECT comment_id,value,created_at FROM comment_votes WHERE user_id=${member.id} ORDER BY created_at`,
    sql`SELECT blocked_id,created_at FROM blocks WHERE user_id=${member.id} ORDER BY created_at`,
    sql`SELECT id,requester_id,recipient_id,status,created_at,updated_at FROM chat_conversations WHERE requester_id=${member.id} OR recipient_id=${member.id} ORDER BY created_at`,
    sql`SELECT m.id,m.conversation_id,m.sender_id,m.body,m.created_at FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id WHERE c.requester_id=${member.id} OR c.recipient_id=${member.id} ORDER BY m.sequence`,
    sql`SELECT id,target_type,target_id,action,category,confidence,reason,model,resolution,review_note,reviewed_at,created_at FROM moderation_decisions WHERE author_id=${member.id} ORDER BY created_at`,
    sql`SELECT state,reason,source_post_id,created_at,updated_at FROM x_invite_requests WHERE x_id=${fresh.xId}`,
    sql`SELECT community_id,source,evidence,expires_at,revoked_at FROM community_x_affiliations WHERE x_id=${fresh.xId}`,
    sql`SELECT started_at FROM member_visit_sessions WHERE member_id=${member.id} ORDER BY started_at`,
  ]);
  return {
    xInvitations,
    affiliations,
    visitSessions,
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    member: {
      id: fresh.id,
      xId: fresh.xId,
      name: fresh.name,
      handle: fresh.handle,
      avatarUrl: fresh.avatarUrl,
      bio: fresh.bio,
      website: fresh.website,
      location: fresh.location,
      followersCount: fresh.followersCount,
      followingCount: fresh.followingCount,
      verificationType: fresh.verificationType,
      createdAt: fresh.createdAt,
      admittedAt: fresh.admittedAt,
      onboardingCompletedAt: fresh.onboardingCompletedAt,
    },
    preferences: fresh.preferences,
    posts,
    comments,
    events,
    registrations,
    saves: { posts: savedPosts, events: savedEvents },
    communityFollows: follows,
    notifications,
    reports,
    communitySuggestions: suggestions,
    invitations,
    votes: { posts: votes, comments: commentVotes },
    blocks,
    chat: { conversations: chatConversations, messages: chatMessages },
    moderation,
  };
}

async function currentSessionSelection(member: Member, request: Request) {
  if (isDevelopmentAuth()) {
    const cookie = readCookie(request.headers.get("cookie"), DEV_COOKIE);
    if (cookie) {
      const digest = tokenDigest(cookie);
      const [session] =
        await sql`SELECT member_id FROM auth_dev_sessions WHERE token_digest=${digest} AND member_id=${member.id} AND expires_at>now()`;
      if (session) return { developmentDigest: digest, authSessionId: null };
    }
  }
  if (xConfigured()) {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (session) {
      const [account] =
        await sql`SELECT id FROM auth_account WHERE user_id=${session.user.id} AND provider_id='twitter' AND account_id=${member.xId}`;
      if (account)
        return { developmentDigest: null, authSessionId: session.session.id };
    }
  }
  throw new DomainError(
    "AUTH_REQUIRED",
    "Your session expired. Sign in again to manage sessions.",
    401,
  );
}

export async function revokeOtherSessions(member: Member, request: Request) {
  await ensureAuthDatabase();
  const current = await currentSessionSelection(member, request);
  const count = await sql.begin(async (tx) => {
    const devSessions =
      await tx`DELETE FROM auth_dev_sessions WHERE member_id=${member.id} AND (${current.developmentDigest}::text IS NULL OR token_digest<>${current.developmentDigest}) RETURNING token_digest`;
    const authSessions =
      await tx`DELETE FROM auth_session WHERE user_id IN (SELECT user_id FROM auth_account WHERE provider_id='twitter' AND account_id=${member.xId})
      AND (${current.authSessionId}::text IS NULL OR id<>${current.authSessionId}) RETURNING id`;
    await tx`INSERT INTO audit_events(id,actor_id,action,detail) VALUES(${randomUUID()},${member.id},'account.other_sessions_revoked',${tx.json({ count: devSessions.length + authSessions.length })})`;
    return devSessions.length + authSessions.length;
  });
  return { revoked: count, currentSessionKept: true };
}

export const deleteAccountSchema = z
  .object({
    confirmation: z.string().min(1).max(100),
    deleteContent: z.boolean().default(true),
  })
  .strict();

export async function deleteAccount(member: Member, input: unknown) {
  await ensureAuthDatabase();
  const data = deleteAccountSchema.parse(input);
  const result = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`x:${member.xId}`}, 0))`;
    const [account] =
      await tx`SELECT * FROM users WHERE id=${member.id} FOR UPDATE`;
    if (!account || account.status === "deleted")
      throw new DomainError(
        "AUTH_REQUIRED",
        "This account is no longer available.",
        401,
      );
    if (data.confirmation !== account.handle)
      throw new DomainError(
        "CONFIRMATION_REQUIRED",
        "Type your current X handle exactly to confirm account deletion.",
        422,
      );

    // Lock all affected events in a stable order. RSVP capacity changes use the
    // same event row locks as normal withdrawals and registrations.
    const affectedEvents =
      await tx`SELECT e.* FROM events e WHERE e.host_id=${member.id} OR EXISTS(SELECT 1 FROM event_rsvps r WHERE r.event_id=e.id AND r.user_id=${member.id}) ORDER BY e.id FOR UPDATE`;
    const previousRegistrations =
      await tx`SELECT event_id,status FROM event_rsvps WHERE user_id=${member.id}`;
    let canceledEvents = 0;
    for (const event of affectedEvents) {
      if (
        event.host_id === member.id &&
        event.status === "published" &&
        new Date(event.ends_at).getTime() > Date.now()
      ) {
        await tx`UPDATE events SET status='canceled',registration_closed=true,revision=revision+1,updated_at=now() WHERE id=${event.id}`;
        const guests =
          await tx`SELECT user_id FROM event_rsvps WHERE event_id=${event.id} AND user_id<>${member.id} AND status IN ('going','pending_approval','waitlisted','interested')`;
        for (const guest of guests)
          await tx`INSERT INTO notifications(id,user_id,type,message,resource_id,dedupe_key) VALUES(${randomUUID()},${guest.user_id},'event',
          ${event.source === "external" ? "An external event listing was removed from Reddix when its submitter deleted their account. Check the original provider for its current status." : "An event you registered for was canceled because its organizer deleted their Reddix account."},
          ${event.id},${`account-delete:${member.id}:${event.id}:${guest.user_id}`}) ON CONFLICT DO NOTHING`;
        canceledEvents++;
      }
    }
    await tx`DELETE FROM event_rsvps WHERE user_id=${member.id}`;
    // Removing a confirmed registration releases its seat and promotes the next
    // currently eligible waiter, preserving the normal capacity invariants.
    for (const event of affectedEvents) {
      if (
        event.host_id === member.id ||
        event.source !== "native" ||
        event.status !== "published" ||
        event.registration_closed ||
        !event.waitlist_enabled ||
        new Date(event.starts_at).getTime() <= Date.now() ||
        !previousRegistrations.some(
          (r) => r.event_id === event.id && r.status === "going",
        )
      )
        continue;
      const [occupied] =
        await tx`SELECT count(*)::int count FROM event_rsvps WHERE event_id=${event.id} AND status='going'`;
      let free =
        event.capacity === null
          ? Infinity
          : Number(event.capacity) - Number(occupied.count);
      const waiters =
        await tx`SELECT r.* FROM event_rsvps r JOIN users u ON u.id=r.user_id WHERE r.event_id=${event.id} AND r.status='waitlisted'
        AND u.status='active' AND u.admitted_at IS NOT NULL AND u.onboarding_completed_at IS NOT NULL AND u.verification_type IN ('blue','business') AND u.verification_expires_at>now()
        AND (${!event.requires_approval} OR r.approved=true)
        AND (${event.visibility !== "invited"} OR u.id=${event.host_id} OR EXISTS(SELECT 1 FROM event_invitations i WHERE i.event_id=${event.id} AND i.user_id=u.id))
        AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=u.id AND b.blocked_id=${event.host_id})
        ORDER BY r.created_at,r.user_id FOR UPDATE OF r`;
      for (const waiter of waiters) {
        if (free <= 0) break;
        await tx`UPDATE event_rsvps SET status='going',updated_at=now() WHERE event_id=${event.id} AND user_id=${waiter.user_id}`;
        await tx`INSERT INTO notifications(id,user_id,type,message,resource_id,dedupe_key) VALUES(${randomUUID()},${waiter.user_id},'event',
          'A place opened up. Your event registration is now confirmed.',${event.id},${`promoted:${event.id}:${waiter.user_id}:${waiter.revision}`}) ON CONFLICT DO NOTHING`;
        free--;
      }
    }
    const [postCount] =
      await tx`SELECT count(*)::int count FROM posts WHERE author_id=${member.id}`;
    const [commentCount] =
      await tx`SELECT count(*)::int count FROM comments WHERE author_id=${member.id}`;
    const media =
      await tx`DELETE FROM media_assets WHERE owner_id=${member.id} AND (${data.deleteContent} OR attached_post_id IS NULL) RETURNING storage_key`;
    await tx`UPDATE notifications SET message='A deleted member replied to your discussion.' WHERE dedupe_key IN (SELECT 'comment:'||id FROM comments WHERE author_id=${member.id})`;
    // Erase AI reasons even when the member elects to retain public posts.
    // The author row lock prevents an in-flight worker recreating decisions.
    await tx`DELETE FROM moderation_jobs WHERE
      (target_type='post' AND target_id IN (SELECT id FROM posts WHERE author_id=${member.id})) OR
      (target_type='comment' AND target_id IN (SELECT id FROM comments WHERE author_id=${member.id}))`;
    await tx`DELETE FROM member_activity WHERE member_id=${member.id}`;
    await tx`DELETE FROM member_visit_sessions WHERE member_id=${member.id}`;
    await tx`UPDATE x_outbox SET state='canceled',secret_payload=NULL,payload='{}'::jsonb,updated_at=now() WHERE
      (kind='post' AND resource_id IN (SELECT id FROM posts WHERE author_id=${member.id})) OR recipient_x_id=${account.x_id}`;
    await tx`UPDATE enrollment_invites SET revoked_at=now() WHERE intended_x_id=${account.x_id} AND redeemed_at IS NULL`;
    await tx`DELETE FROM x_invite_requests WHERE x_id=${account.x_id}`;
    await tx`DELETE FROM community_x_affiliations WHERE x_id=${account.x_id}`;
    await tx`UPDATE posts SET promote_on_x=false WHERE author_id=${member.id}`;
    if (data.deleteContent) {
      await tx`UPDATE posts SET title='[deleted]',body='',url=NULL,image_url=NULL,tags='[]'::jsonb,status='deleted',updated_at=now() WHERE author_id=${member.id}`;
      await tx`UPDATE comments SET body='',status='deleted',updated_at=now() WHERE author_id=${member.id}`;
      await tx`UPDATE events SET title='[deleted event]',description='',venue='',exact_address=NULL,
        external_url=CASE WHEN source='external' THEN 'https://reddix.invalid/deleted-event' ELSE NULL END,source_label=NULL,tags='[]'::jsonb,
        status='canceled',registration_closed=true,updated_at=now() WHERE host_id=${member.id}`;
      await tx`DELETE FROM event_updates WHERE author_id=${member.id}`;
    }
    await tx`DELETE FROM post_votes WHERE user_id=${member.id}`;
    await tx`DELETE FROM comment_votes WHERE user_id=${member.id}`;
    await tx`DELETE FROM saved_posts WHERE user_id=${member.id}`;
    await tx`DELETE FROM saved_events WHERE user_id=${member.id}`;
    await tx`DELETE FROM community_memberships WHERE user_id=${member.id}`;
    // Private message bodies are erased regardless of the public-content
    // retention choice. Peers retain only their own text and closed history.
    await tx`UPDATE chat_conversations SET status='closed',updated_at=now() WHERE requester_id=${member.id} OR recipient_id=${member.id}`;
    await tx`UPDATE chat_messages SET body='' WHERE sender_id=${member.id}`;
    await tx`DELETE FROM blocks WHERE user_id=${member.id} OR blocked_id=${member.id}`;
    await tx`DELETE FROM event_invitations WHERE user_id=${member.id}`;
    await tx`DELETE FROM notifications WHERE user_id=${member.id}`;
    await tx`DELETE FROM reports WHERE reporter_id=${member.id}`;
    await tx`DELETE FROM community_suggestions WHERE user_id=${member.id}`;
    await tx`DELETE FROM idempotency_keys WHERE user_id=${member.id}`;
    await tx`DELETE FROM feed_snapshots WHERE user_id=${member.id}`;
    await tx`DELETE FROM rate_limits WHERE key LIKE ${`action:${member.id}:%`}`;
    await tx`DELETE FROM rate_limits WHERE key LIKE ${`chat:${member.id}:%`}`;
    await tx`DELETE FROM auth_dev_sessions WHERE member_id=${member.id}`;
    await tx`DELETE FROM auth_admission_passes WHERE member_id=${member.id}`;
    await tx`DELETE FROM auth_sync_state WHERE member_id=${member.id}`;
    await tx`UPDATE auth_admission_attempts SET expected_x_id=NULL,profile=NULL,expires_at=now(),completed_at=coalesce(completed_at,now()),completed_member_id=NULL
      WHERE completed_member_id=${member.id} OR expected_x_id=${account.x_id} OR profile->>'xId'=${account.x_id}`;
    await tx`UPDATE enrollment_invites SET revoked_at=coalesce(revoked_at,now()),reserved_attempt=NULL,reserved_until=NULL WHERE issuer_id=${member.id} OR redeemer_id=${member.id}`;
    await tx`UPDATE enrollment_invites SET redeemer_x_id=NULL WHERE redeemer_id=${member.id}`;
    await tx`DELETE FROM auth_user WHERE id IN (SELECT user_id FROM auth_account WHERE provider_id='twitter' AND account_id=${account.x_id})`;
    await tx`UPDATE audit_events SET detail='{}'::jsonb WHERE actor_id=${member.id}`;
    await tx`UPDATE users SET x_id=${`deleted:${randomUUID()}`},name='[deleted]',handle=${`deleted-${randomUUID()}`},avatar_url=NULL,bio='',website='',location='',
      followers_count=0,following_count=0,verification_type='unknown',verification_checked_at=NULL,verification_expires_at=NULL,is_admin=false,
      status='deleted',preferences='{}'::jsonb,invite_quota=0,invites_issued=0,admitted_at=NULL,onboarding_completed_at=NULL WHERE id=${member.id}`;
    const counts = {
      posts: Number(postCount.count),
      comments: Number(commentCount.count),
      canceledEvents,
      revokedRegistrations: previousRegistrations.length,
      media: media.length,
    };
    await tx`INSERT INTO audit_events(id,actor_id,action,detail) VALUES(${randomUUID()},${member.id},'account.deleted',${tx.json({ deleteContent: data.deleteContent, ...counts })})`;
    return {
      counts,
      mediaKeys: media.map((asset) => String(asset.storage_key)),
    };
  });

  // The DB transaction removes access first. Physical object cleanup cannot
  // resurrect an account if storage is unavailable; retry keys are audit-only.
  const pendingMedia: string[] = [];
  for (const storageKey of result.mediaKeys) {
    try {
      await deletePrivateImage(storageKey);
    } catch {
      pendingMedia.push(storageKey);
    }
  }
  if (pendingMedia.length)
    await sql`INSERT INTO audit_events(id,actor_id,action,detail) VALUES(${randomUUID()},${member.id},'account.media_cleanup_pending',${sql.json({ storageKeys: pendingMedia })})`;
  return {
    deleted: true,
    contentDeleted: data.deleteContent,
    counts: result.counts,
    mediaCleanupPending: pendingMedia.length,
  };
}
