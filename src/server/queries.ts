import type {
  Bootstrap,
  Comment,
  Community,
  Member,
  Post,
  ReddixEvent,
} from "@/lib/types";
import { sql } from "./db";
import { MODERATOR_ID, moderationMessage } from "./moderation";
import { DomainError, requireAdmitted, requireOnboarded } from "./domain";
import { iso, memberFromRow, nullableIso, publicMember } from "./members";
import { getReputation } from "./reputation";

export async function getCommunities(memberId: string): Promise<Community[]> {
  const rows =
    await sql`SELECT c.*, (SELECT count(*) FROM community_memberships f WHERE f.community_id=c.id) AS members_count,
    EXISTS(SELECT 1 FROM community_memberships f WHERE f.community_id=c.id AND f.user_id=${memberId}) AS is_following
    , (SELECT row_to_json(o) FROM (SELECT a.handle FROM community_x_accounts a WHERE a.community_id=c.id AND a.enabled=true) o) x_account,
    (SELECT COALESCE(json_agg(l),'[]'::json) FROM (SELECT u.id,u.name,u.handle FROM community_x_affiliations a JOIN users u ON u.x_id=a.x_id
      JOIN community_x_accounts o ON o.community_id=a.community_id
      WHERE a.community_id=c.id AND a.source='x' AND a.revoked_at IS NULL AND a.expires_at>now() AND o.enabled=true AND u.status='active' AND u.admitted_at IS NOT NULL ORDER BY u.name LIMIT 30) l) leaders
    FROM communities c ORDER BY c.created_at,c.id`;
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    icon: r.icon,
    color: r.color,
    city: r.city,
    membersCount: Number(r.members_count),
    isFollowing: r.is_following,
    archived: r.archived,
    xAccount: r.x_account
      ? {
          handle: r.x_account.handle,
          url: `https://x.com/${r.x_account.handle}`,
          affiliatesUrl: `https://x.com/${r.x_account.handle}/affiliates`,
        }
      : undefined,
    leaders: r.leaders ?? [],
  }));
}
export function mapPost(r: Record<string, unknown>): Post {
  return {
    id: String(r.id),
    communityId: String(r.community_id),
    communitySlug: String(r.community_slug),
    communityName: String(r.community_name),
    authorIsLeader: Boolean(r.author_is_leader),
    promoteOnX: Boolean(r.promote_on_x),
    author: publicMember(memberFromRow(r.author as Record<string, unknown>)),
    title:
      r.status === "published"
        ? String(r.title)
        : r.status === "deleted"
          ? "This discussion was deleted"
          : "This discussion was removed",
    body: r.status === "published" ? String(r.body) : "",
    type: r.type as Post["type"],
    url: r.status === "published" ? (r.url as string | null) : null,
    imageUrl: r.status === "published" ? (r.image_url as string | null) : null,
    score: Number(r.score),
    commentCount: Number(r.comment_count),
    myVote: Number(r.my_vote) as Post["myVote"],
    isSaved: Boolean(r.is_saved),
    isPinned: Boolean(r.pinned),
    locked: Boolean(r.locked),
    status: r.status as Post["status"],
    moderation:
      r.status === "removed" && r.moderation_category
        ? {
            botId: MODERATOR_ID,
            category: String(r.moderation_category),
            message: moderationMessage(
              String(r.moderation_category),
              Boolean(r.moderation_reviewer),
            ),
          }
        : undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    tags: r.status === "published" ? (r.tags as string[]) : [],
  };
}
export async function getPosts(
  memberId: string,
  postId?: string,
  postIds?: string[],
  options: { query?: string; authorId?: string; limit?: number } = {},
): Promise<Post[]> {
  if (postIds?.length === 0) return [];
  // Full-text search can use its index across the full history. Keep the
  // partial-word fallback bounded to the latest 200 posts, as in bootstrap,
  // instead of an OR that scans every discussion body for a substring.
  const rows =
    await sql`SELECT p.*,md.category moderation_category,md.reviewed_by moderation_reviewer,c.slug community_slug,c.name community_name,row_to_json(u) author,
    COALESCE((SELECT sum(v.value) FROM post_votes v WHERE v.post_id=p.id),0) score,
    (SELECT count(*) FROM comments co WHERE co.post_id=p.id AND co.status='published') comment_count,
    COALESCE((SELECT v.value FROM post_votes v WHERE v.post_id=p.id AND v.user_id=${memberId}),0) my_vote,
    EXISTS(SELECT 1 FROM saved_posts s WHERE s.post_id=p.id AND s.user_id=${memberId}) is_saved
    , EXISTS(SELECT 1 FROM community_x_affiliations a JOIN community_x_accounts o ON o.community_id=a.community_id WHERE a.community_id=p.community_id AND a.x_id=u.x_id AND a.source='x' AND a.revoked_at IS NULL AND a.expires_at>now() AND o.enabled=true AND c.archived=false) author_is_leader
    FROM posts p JOIN communities c ON c.id=p.community_id JOIN users u ON u.id=p.author_id
    LEFT JOIN moderation_decisions md ON md.id=p.moderation_decision_id
    WHERE ${postId ? sql`p.id=${postId}` : postIds ? sql`p.id IN ${sql(postIds)} AND p.status='published'` : sql`p.status='published'`}
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=${memberId} AND b.blocked_id=p.author_id)
      AND ${options.authorId ? sql`p.author_id=${options.authorId}` : sql`true`}
      AND ${
        options.query
          ? sql`p.id IN (
              SELECT matched.id FROM posts matched WHERE matched.status='published'
                AND to_tsvector('english',matched.title||' '||matched.body) @@ websearch_to_tsquery('english',${options.query})
              UNION
              SELECT recent.id FROM (
                SELECT fallback.id,fallback.title,fallback.body FROM posts fallback WHERE fallback.status='published'
                  AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=${memberId} AND b.blocked_id=fallback.author_id)
                ORDER BY fallback.created_at DESC,fallback.id DESC LIMIT 200
              ) recent WHERE strpos(lower(recent.title||' '||recent.body),lower(${options.query}))>0
            )`
          : sql`true`
      }
    ORDER BY p.created_at DESC,p.id DESC LIMIT ${options.limit ?? 200}`;
  return rows.map(mapPost);
}
export async function getComments(
  memberId: string,
  postId: string,
): Promise<Comment[]> {
  const rows =
    await sql`SELECT c.*,md.category moderation_category,md.reviewed_by moderation_reviewer,row_to_json(u) author,
    COALESCE((SELECT sum(v.value) FROM comment_votes v WHERE v.comment_id=c.id),0) score,
    COALESCE((SELECT v.value FROM comment_votes v WHERE v.comment_id=c.id AND v.user_id=${memberId}),0) my_vote
    , EXISTS(SELECT 1 FROM posts p JOIN communities co ON co.id=p.community_id JOIN community_x_affiliations a ON a.community_id=p.community_id JOIN community_x_accounts o ON o.community_id=a.community_id
      WHERE p.id=c.post_id AND a.x_id=u.x_id AND a.source='x' AND a.revoked_at IS NULL AND a.expires_at>now() AND o.enabled=true AND co.archived=false AND u.status='active') author_is_leader
    FROM comments c JOIN users u ON u.id=c.author_id LEFT JOIN moderation_decisions md ON md.id=c.moderation_decision_id WHERE c.post_id=${postId}
    AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=${memberId} AND b.blocked_id=c.author_id)
    ORDER BY c.created_at ASC LIMIT 200`;
  return rows.map((r) => ({
    id: r.id,
    postId: r.post_id,
    authorIsLeader: Boolean(r.author_is_leader),
    parentId: r.parent_id,
    author: publicMember(memberFromRow(r.author)),
    body: r.status === "published" ? r.body : "[removed]",
    depth: r.depth,
    score: Number(r.score),
    myVote: Number(r.my_vote) as Comment["myVote"],
    status: r.status,
    moderation:
      r.status === "removed" && r.moderation_category
        ? {
            botId: MODERATOR_ID,
            category: String(r.moderation_category),
            message: moderationMessage(
              String(r.moderation_category),
              Boolean(r.moderation_reviewer),
            ),
          }
        : undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }));
}
export async function canReadEvent(
  memberId: string,
  eventId: string,
): Promise<boolean> {
  const [event] = await sql`SELECT e.id FROM events e WHERE e.id=${eventId} AND
    (e.visibility<>'invited' OR e.host_id=${memberId} OR EXISTS(SELECT 1 FROM event_invitations i WHERE i.event_id=e.id AND i.user_id=${memberId})
     OR EXISTS(SELECT 1 FROM event_rsvps r WHERE r.event_id=e.id AND r.user_id=${memberId} AND r.status IN ('going','pending_approval','waitlisted')))
    AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=${memberId} AND b.blocked_id=e.host_id)`;
  return Boolean(event);
}
export async function canReadPost(
  memberId: string,
  postId: string,
): Promise<boolean> {
  const [post] =
    await sql`SELECT p.id FROM posts p WHERE p.id=${postId} AND p.status='published'
    AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=${memberId} AND b.blocked_id=p.author_id)`;
  return Boolean(post);
}
export async function canReadComment(
  memberId: string,
  commentId: string,
): Promise<boolean> {
  const [comment] =
    await sql`SELECT c.id FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.id=${commentId} AND c.status='published' AND p.status='published'
    AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=${memberId} AND b.blocked_id IN (c.author_id,p.author_id))`;
  return Boolean(comment);
}
export async function getEvents(
  memberId: string,
  eventId?: string,
  hostId?: string,
  options: { query?: string; limit?: number } = {},
): Promise<ReddixEvent[]> {
  const rows = await sql`SELECT e.*,row_to_json(u) host,
    (SELECT count(*) FROM event_rsvps r WHERE r.event_id=e.id AND r.status='going') going_count,
    (SELECT count(*) FROM event_rsvps r WHERE r.event_id=e.id AND r.status='interested') interested_count,
    COALESCE((SELECT r.status FROM event_rsvps r WHERE r.event_id=e.id AND r.user_id=${memberId}),'none') my_rsvp,
    EXISTS(SELECT 1 FROM saved_events s WHERE s.event_id=e.id AND s.user_id=${memberId}) is_saved
    FROM events e JOIN users u ON u.id=e.host_id WHERE
    ${eventId ? sql`e.id=${eventId}` : sql`(e.visibility='listed' OR e.host_id=${memberId} OR EXISTS(SELECT 1 FROM event_invitations i WHERE i.event_id=e.id AND i.user_id=${memberId}) OR EXISTS(SELECT 1 FROM event_rsvps r WHERE r.event_id=e.id AND r.user_id=${memberId} AND r.status IN ('going','pending_approval','waitlisted')))`}
    AND (e.visibility<>'invited' OR e.host_id=${memberId} OR EXISTS(SELECT 1 FROM event_invitations i WHERE i.event_id=e.id AND i.user_id=${memberId})
     OR EXISTS(SELECT 1 FROM event_rsvps r WHERE r.event_id=e.id AND r.user_id=${memberId} AND r.status IN ('going','pending_approval','waitlisted')))
    AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=${memberId} AND b.blocked_id=e.host_id)
    AND ${hostId ? sql`e.host_id=${hostId}` : sql`true`}
    AND ${options.query ? sql`e.visibility='listed' AND strpos(lower(e.title||' '||e.description),lower(${options.query}))>0` : sql`true`}
    ORDER BY e.starts_at LIMIT ${options.limit ?? 150}`;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    host: publicMember(memberFromRow(r.host)),
    source: r.source,
    externalUrl: r.external_url,
    sourceLabel: r.source_label,
    city: r.city,
    timezone: r.timezone,
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    venue: r.venue,
    venueDisclosure: r.venue_disclosure,
    exactAddress:
      r.host_id === memberId ||
      r.venue_disclosure === "all" ||
      (r.venue_disclosure === "attendees" && r.my_rsvp === "going")
        ? r.exact_address
        : null,
    format: r.format,
    visibility: r.visibility,
    status: r.status,
    capacity: r.capacity,
    requiresApproval: r.requires_approval,
    waitlistEnabled: r.waitlist_enabled,
    goingCount: Number(r.going_count),
    interestedCount: Number(r.interested_count),
    myRsvp: r.my_rsvp,
    isSaved: r.is_saved,
    coverStyle: r.cover_style,
    registrationClosed: r.registration_closed,
    communityId: r.community_id,
    tags: r.tags,
    createdAt: iso(r.created_at),
    revision: r.revision,
  }));
}
export async function getBootstrap(member: Member): Promise<Bootstrap> {
  requireAdmitted(member);
  if (!member.onboardingCompletedAt)
    return {
      member,
      reputation: { posts: 0, comments: 0, total: 0 },
      communities: [],
      posts: [],
      events: [],
      notifications: [],
      members: [],
      stats: { members: 0, discussions: 0, events: 0 },
      demo:
        process.env.NODE_ENV !== "production" &&
        process.env.AUTH_MODE === "development",
      generatedAt: new Date().toISOString(),
    };
  const [communities, posts, events, notifications, users, counts, reputation] =
    await Promise.all([
      getCommunities(member.id),
      getPosts(member.id),
      getEvents(member.id),
      sql`SELECT * FROM notifications WHERE user_id=${member.id} ORDER BY created_at DESC LIMIT 50`,
      sql`SELECT * FROM users WHERE status='active' AND admitted_at IS NOT NULL ORDER BY created_at LIMIT 50`,
      sql`SELECT (SELECT count(*) FROM users WHERE status='active' AND admitted_at IS NOT NULL AND is_bot=false) members,
      (SELECT count(*) FROM posts WHERE status='published') discussions,
      (SELECT count(*) FROM events WHERE visibility='listed' AND status='published' AND ends_at>now()) events`,
      getReputation(member.id),
    ]);
  return {
    member,
    reputation,
    communities,
    posts,
    events,
    notifications: notifications.map((r) => ({
      id: r.id,
      type: r.type,
      message: r.message,
      resourceId: r.resource_id,
      readAt: nullableIso(r.read_at),
      createdAt: iso(r.created_at),
    })),
    members: users.map((r) => publicMember(memberFromRow(r))),
    stats: {
      members: Number(counts[0].members),
      discussions: Number(counts[0].discussions),
      events: Number(counts[0].events),
    },
    demo:
      process.env.NODE_ENV !== "production" &&
      process.env.AUTH_MODE === "development",
    generatedAt: new Date().toISOString(),
  };
}
export async function getPostDetail(member: Member, postId: string) {
  requireOnboarded(member);
  const [[post], comments] = await Promise.all([
    getPosts(member.id, postId),
    getComments(member.id, postId),
  ]);
  if (!post)
    throw new DomainError(
      "RESOURCE_NOT_FOUND",
      "This discussion is unavailable.",
      404,
    );
  return { post, comments };
}
