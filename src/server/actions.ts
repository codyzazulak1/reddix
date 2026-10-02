import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Member } from "@/lib/types";
import { sql } from "./db";
import { enqueuePostPromotion } from "./x-growth";
import { enqueueModeration } from "./moderation";
import {
  DomainError,
  requireAdmin,
  requireAdmitted,
  requireEligible,
  requireOnboarded,
  safeHttpsUrl,
} from "./domain";
import { getMemberById } from "./members";
import { insertCommunity } from "./communities";
import { preparePostPreview } from "./post-preview";
import { deletePrivateImage } from "./storage";
import { canReadComment, canReadEvent, canReadPost, getPosts } from "./queries";
import {
  cancelEvent,
  changeRsvp,
  closeEventRegistration,
  createEvent,
  editEvent,
  eventUpdate,
  reviewRsvp,
} from "./events";

const idSchema = z.string().min(1).max(100);
const preferencesSchema = z
  .object({
    city: z.string().max(80).optional(),
    interests: z.array(z.string().max(60)).max(20).optional(),
    theme: z.enum(["light", "dark", "system"]).optional(),
    density: z.enum(["comfortable", "compact"]).optional(),
    emailNotifications: z.boolean().optional(),
    eventReminders: z.boolean().optional(),
    publicAttendance: z.boolean().optional(),
    xPromotionOptOut: z.boolean().optional(),
  })
  .strict();

export async function enforceRateLimit(memberId: string, action: string) {
  const key = `action:${memberId}:${action}`;
  const [row] = await sql`INSERT INTO rate_limits(key,count) VALUES(${key},1)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.window_start<now()-interval '1 minute' THEN 1 ELSE rate_limits.count+1 END,
    window_start=CASE WHEN rate_limits.window_start<now()-interval '1 minute' THEN now() ELSE rate_limits.window_start END RETURNING count`;
  const limit = [
    "createPost",
    "createEvent",
    "suggestCommunity",
    "adminCreateCommunity",
  ].includes(action)
    ? 10
    : 60;
  if (Number(row.count) > limit)
    throw new DomainError(
      "RATE_LIMITED",
      "You're doing that a little too quickly. Try again in a minute.",
      429,
    );
}

export async function performAction(
  member: Member,
  input: unknown,
): Promise<Record<string, unknown>> {
  requireAdmitted(member);
  const data = z.record(z.string(), z.unknown()).parse(input);
  const action = z.string().parse(data.action);
  await enforceRateLimit(member.id, action);
  if (
    action !== "onboarding" &&
    action !== "resync" &&
    action !== "preferences"
  )
    requireOnboarded(member);
  if (action === "onboarding" || action === "preferences") {
    const preferences = preferencesSchema.parse(data.preferences ?? {});
    if (action === "onboarding" && data.acceptTerms !== true)
      throw new DomainError(
        "VALIDATION_ERROR",
        "Accept the community rules and privacy policy to continue.",
        422,
      );
    const merged = { ...member.preferences, ...preferences };
    await sql.begin(async (tx) => {
      const [current] =
        await tx`SELECT onboarding_completed_at,status,admitted_at FROM users WHERE id=${member.id} FOR UPDATE`;
      if (!current || current.status !== "active" || !current.admitted_at)
        throw new DomainError(
          "AUTH_REQUIRED",
          "This account is no longer active.",
          401,
        );
      await tx`UPDATE users SET preferences=${tx.json(merged)},onboarding_completed_at=CASE WHEN ${action === "onboarding"} THEN COALESCE(onboarding_completed_at,now()) ELSE onboarding_completed_at END WHERE id=${member.id}`;
      if (action === "onboarding") {
        if (!current?.onboarding_completed_at)
          await tx`INSERT INTO audit_events(id,actor_id,action,detail) VALUES(${randomUUID()},${member.id},'onboarding_consent',${tx.json({ termsVersion: "2026-09-27", privacyVersion: "2026-09-27" })})`;
        const cities: Record<string, string> = {
          "San Francisco": "sf",
          "New York": "new-york",
          Toronto: "toronto",
          Seattle: "seattle",
          "Los Angeles": "los-angeles",
        };
        const city = cities[preferences.city ?? ""] ?? preferences.city;
        const interests: Record<string, string> = {
          AI: "ai",
          Startups: "startups",
          Engineering: "engineering",
          Fundraising: "fundraising",
          "Open source": "open-source",
          Careers: "careers",
          Infrastructure: "engineering",
          "Venture capital": "fundraising",
        };
        const selected = new Set(
          (preferences.interests ?? []).map(
            (interest) => interests[interest] ?? interest,
          ),
        );
        if (city) selected.add(city);
        if ((preferences.interests ?? []).includes("Events") && city) {
          const events: Record<string, string> = {
            sf: "sf-events",
            "new-york": "ny-events",
            toronto: "toronto-events",
            seattle: "seattle-events",
            "los-angeles": "la-events",
          };
          if (events[city]) selected.add(events[city]);
        }
        await tx`INSERT INTO community_memberships(user_id,community_id)
          SELECT ${member.id},a.community_id FROM community_x_affiliations a JOIN community_x_accounts o ON o.community_id=a.community_id JOIN communities c ON c.id=a.community_id
          WHERE a.x_id=${member.xId} AND a.source='x' AND a.revoked_at IS NULL AND a.expires_at>now() AND o.enabled=true AND c.archived=false ON CONFLICT DO NOTHING`;
        for (const communityId of selected)
          await tx`INSERT INTO community_memberships(user_id,community_id)
          SELECT ${member.id},id FROM communities WHERE id=${communityId} ON CONFLICT DO NOTHING`;
      }
    });
    return { member: await getMemberById(member.id) };
  }
  if (action === "resync") {
    const { resyncMember } = await import("@/lib/auth-resync");
    return resyncMember(member);
  }
  if (action === "follow") {
    const communityId = idSchema.parse(data.communityId);
    const [community] =
      await sql`SELECT id FROM communities WHERE id=${communityId}`;
    if (!community)
      throw new DomainError(
        "RESOURCE_NOT_FOUND",
        "That community is unavailable.",
        404,
      );
    const [current] =
      await sql`SELECT user_id FROM community_memberships WHERE user_id=${member.id} AND community_id=${communityId}`;
    const following =
      typeof data.following === "boolean" ? data.following : !current;
    if (following)
      await sql`INSERT INTO community_memberships(user_id,community_id) VALUES(${member.id},${communityId}) ON CONFLICT DO NOTHING`;
    else
      await sql`DELETE FROM community_memberships WHERE user_id=${member.id} AND community_id=${communityId}`;
    return { following };
  }
  if (action === "save" || action === "saveEvent") {
    const targetId = idSchema.parse(
      action === "save" ? data.postId : data.eventId,
    );
    if (data.saved !== false && action === "save") {
      const [post] = await getPosts(member.id, targetId);
      if (!post || post.status !== "published")
        throw new DomainError(
          "RESOURCE_NOT_FOUND",
          "That discussion is unavailable.",
          404,
        );
    } else if (
      data.saved !== false &&
      action === "saveEvent" &&
      !(await canReadEvent(member.id, targetId))
    )
      throw new DomainError(
        "RESOURCE_NOT_FOUND",
        "That event is unavailable.",
        404,
      );
    const table = action === "save" ? "saved_posts" : "saved_events";
    const column = action === "save" ? "post_id" : "event_id";
    const [current] =
      await sql`SELECT user_id FROM ${sql(table)} WHERE user_id=${member.id} AND ${sql(column)}=${targetId}`;
    const saved = typeof data.saved === "boolean" ? data.saved : !current;
    if (saved)
      await sql`INSERT INTO ${sql(table)}(user_id,${sql(column)}) VALUES(${member.id},${targetId}) ON CONFLICT DO NOTHING`;
    else
      await sql`DELETE FROM ${sql(table)} WHERE user_id=${member.id} AND ${sql(column)}=${targetId}`;
    return { saved };
  }
  if (action === "vote") {
    const value = z
      .union([z.literal(-1), z.literal(0), z.literal(1)])
      .parse(data.value);
    if (value !== 0) requireEligible(member);
    const isComment = typeof data.commentId === "string";
    const targetId = idSchema.parse(isComment ? data.commentId : data.postId);
    if (
      value !== 0 &&
      !(isComment
        ? await canReadComment(member.id, targetId)
        : await canReadPost(member.id, targetId))
    )
      throw new DomainError(
        "RESOURCE_NOT_FOUND",
        "That contribution is unavailable.",
        404,
      );
    const targetTable = isComment ? "comments" : "posts",
      voteTable = isComment ? "comment_votes" : "post_votes",
      column = isComment ? "comment_id" : "post_id";
    await sql.begin(async (tx) => {
      const [target] =
        await tx`SELECT * FROM ${tx(targetTable)} WHERE id=${targetId} FOR UPDATE`;
      if (!target || (value !== 0 && target.status !== "published"))
        throw new DomainError(
          "RESOURCE_NOT_FOUND",
          "That contribution is unavailable.",
          404,
        );
      if (value === 0)
        await tx`DELETE FROM ${tx(voteTable)} WHERE user_id=${member.id} AND ${tx(column)}=${targetId}`;
      else
        await tx`INSERT INTO ${tx(voteTable)}(user_id,${tx(column)},value) VALUES(${member.id},${targetId},${value})
        ON CONFLICT(user_id,${tx(column)}) DO UPDATE SET value=EXCLUDED.value`;
    });
    const [score] =
      await sql`SELECT COALESCE(sum(value),0) score FROM ${sql(voteTable)} WHERE ${sql(column)}=${targetId}`;
    return { value, score: Number(score.score) };
  }
  if (action === "createPost") {
    requireEligible(member);
    const post = z
      .object({
        communityId: idSchema,
        title: z.string().trim().min(3).max(300),
        body: z.string().trim().max(20000).default(""),
        type: z.enum(["text", "link", "image"]).default("text"),
        url: z.string().optional().nullable(),
        imageUrl: z.string().optional().nullable(),
        tags: z.array(z.string().max(40)).max(5).default([]),
        promoteOnX: z.boolean().default(false),
      })
      .parse(data);
    const [community] =
      await sql`SELECT id FROM communities WHERE id=${post.communityId} AND archived=false`;
    if (!community)
      throw new DomainError(
        "VALIDATION_ERROR",
        "Choose an active subreddix.",
        422,
      );
    if (post.type === "text" && !post.body)
      throw new DomainError(
        "VALIDATION_ERROR",
        "Add some text to your discussion.",
        422,
      );
    const url = post.type === "link" ? safeHttpsUrl(post.url ?? "") : null;
    let imageUrl: string | null = null;
    if (post.type === "image") {
      imageUrl = z
        .string()
        .regex(/^\/api\/media\/[a-f0-9-]{36}$/)
        .parse(post.imageUrl);
      const [asset] =
        await sql`SELECT id FROM media_assets WHERE id=${imageUrl.split("/").pop()!} AND owner_id=${member.id} AND attached_post_id IS NULL`;
      if (!asset)
        throw new DomainError(
          "VALIDATION_ERROR",
          "Upload an image before publishing.",
          422,
        );
    }
    const id = randomUUID();
    const preview =
      post.type === "image" ? null : await preparePostPreview(url, post.body);
    const publishedImageUrl =
      imageUrl ?? (preview ? `/api/media/${preview.id}` : null);
    try {
      await sql.begin(async (tx) => {
        if (imageUrl) {
          const [asset] =
            await tx`SELECT id FROM media_assets WHERE id=${imageUrl.split("/").pop()!} AND owner_id=${member.id} AND attached_post_id IS NULL FOR UPDATE`;
          if (!asset)
            throw new DomainError(
              "VALIDATION_ERROR",
              "This image is already attached to another discussion.",
              422,
            );
        }
        await tx`INSERT INTO posts(id,community_id,author_id,title,body,type,url,image_url,tags,promote_on_x)
          VALUES(${id},${post.communityId},${member.id},${post.title},${post.body},${post.type},${url},${publishedImageUrl},${tx.json(post.tags)},${post.promoteOnX && !member.preferences.xPromotionOptOut})`;
        if (preview)
          await tx`INSERT INTO media_assets(id,owner_id,storage_key,mime_type,byte_size,width,height,alt_text,attached_post_id)
            VALUES(${preview.id},${member.id},${preview.storageKey},'image/webp',${preview.byteSize},${preview.width},${preview.height},${`Link preview for ${post.title}`},${id})`;
        await tx`INSERT INTO post_votes(user_id,post_id,value) VALUES(${member.id},${id},1)`;
        await enqueueModeration(tx, "post", id, "create");
        await enqueuePostPromotion(tx, id);
        if (imageUrl)
          await tx`UPDATE media_assets SET attached_post_id=${id} WHERE id=${imageUrl.split("/").pop()!} AND owner_id=${member.id}`;
      });
    } catch (error) {
      if (preview) {
        try {
          await deletePrivateImage(
            preview.storageKey,
            AbortSignal.timeout(2_000),
          );
        } catch {
          console.error("Could not clean up an unused link preview", {
            assetId: preview.id,
          });
        }
      }
      throw error;
    }
    return { post: (await getPosts(member.id, id))[0] };
  }
  if (action === "withdrawXPromotion") {
    const id = idSchema.parse(data.postId);
    const rows =
      await sql`UPDATE posts SET promote_on_x=false WHERE id=${id} AND author_id=${member.id} RETURNING id`;
    if (!rows.length)
      throw new DomainError(
        "FORBIDDEN",
        "Only the author can change sharing.",
        403,
      );
    await sql`UPDATE x_outbox SET state='canceled',updated_at=now() WHERE kind='post' AND resource_id=${id} AND state IN ('queued','preview','error')`;
    return { ok: true };
  }
  if (action === "comment") {
    requireEligible(member);
    const comment = z
      .object({
        postId: idSchema,
        parentId: idSchema.nullable().optional(),
        body: z.string().trim().min(1).max(10000),
      })
      .parse(data);
    if (!(await canReadPost(member.id, comment.postId)))
      throw new DomainError(
        "RESOURCE_NOT_FOUND",
        "This discussion is unavailable.",
        404,
      );
    if (comment.parentId) {
      const [blocked] =
        await sql`SELECT b.user_id FROM comments c JOIN blocks b ON b.blocked_id=c.author_id WHERE c.id=${comment.parentId} AND b.user_id=${member.id}`;
      if (blocked)
        throw new DomainError(
          "RESOURCE_NOT_FOUND",
          "This comment is unavailable.",
          404,
        );
    }
    const id = randomUUID();
    await sql.begin(async (tx) => {
      const [post] =
        await tx`SELECT * FROM posts WHERE id=${comment.postId} FOR UPDATE`;
      if (!post || post.status !== "published")
        throw new DomainError(
          "RESOURCE_NOT_FOUND",
          "This discussion is unavailable.",
          404,
        );
      if (post.locked)
        throw new DomainError(
          "THREAD_LOCKED",
          "This discussion is locked.",
          409,
        );
      let depth = 0,
        recipient = post.author_id;
      if (comment.parentId) {
        const [parent] =
          await tx`SELECT * FROM comments WHERE id=${comment.parentId} AND post_id=${comment.postId}`;
        if (!parent)
          throw new DomainError(
            "VALIDATION_ERROR",
            "The parent comment does not belong to this discussion.",
            422,
          );
        depth = parent.depth + 1;
        recipient = parent.author_id;
        if (depth > 8)
          throw new DomainError(
            "VALIDATION_ERROR",
            "This thread has reached its maximum reply depth. Start a new comment.",
            422,
          );
      }
      await tx`INSERT INTO comments(id,post_id,parent_id,author_id,body,depth) VALUES(${id},${comment.postId},${comment.parentId ?? null},${member.id},${comment.body},${depth})`;
      await tx`INSERT INTO comment_votes(user_id,comment_id,value) VALUES(${member.id},${id},1)`;
      await enqueueModeration(tx, "comment", id, "create");
      if (recipient !== member.id) {
        const [blocked] =
          await tx`SELECT user_id FROM blocks WHERE user_id=${recipient} AND blocked_id=${member.id}`;
        if (!blocked)
          await tx`INSERT INTO notifications(id,user_id,type,message,resource_id,dedupe_key) VALUES(${randomUUID()},${recipient},'reply',
          ${`${member.name} replied to your discussion.`},${comment.postId},${`comment:${id}`}) ON CONFLICT DO NOTHING`;
      }
    });
    return { commentId: id };
  }
  if (
    action === "deletePost" ||
    action === "deleteComment" ||
    action === "editPost" ||
    action === "editComment"
  ) {
    const edit = action.startsWith("edit");
    if (edit) requireEligible(member);
    const targetId = idSchema.parse(
        action.endsWith("Post") ? data.postId : data.commentId,
      ),
      table = action.endsWith("Post") ? "posts" : "comments";
    const [row] = await sql`SELECT * FROM ${sql(table)} WHERE id=${targetId}`;
    if (!row || row.author_id !== member.id)
      throw new DomainError(
        "FORBIDDEN",
        "You can only change your own contributions.",
        403,
      );
    if (edit) {
      if (row.status !== "published" || row.locked)
        throw new DomainError(
          "THREAD_LOCKED",
          "This contribution can no longer be edited.",
          409,
        );
      if (table === "comments") {
        const [post] =
          await sql`SELECT locked,status FROM posts WHERE id=${row.post_id}`;
        if (
          !post ||
          post.locked ||
          post.status !== "published" ||
          !(await canReadPost(member.id, row.post_id))
        )
          throw new DomainError(
            "THREAD_LOCKED",
            "This discussion is locked or unavailable.",
            409,
          );
      }
      const body = z
        .string()
        .trim()
        .min(1)
        .max(table === "posts" ? 20000 : 10000)
        .parse(data.body);
      await sql.begin(async (tx) => {
        await tx`UPDATE ${tx(table)} SET body=${body},moderation_decision_id=NULL,updated_at=now() WHERE id=${targetId} AND status='published'`;
        await enqueueModeration(
          tx,
          table === "posts" ? "post" : "comment",
          targetId,
          "edit",
        );
      });
    } else {
      await sql.begin(async (tx) => {
        await tx`UPDATE ${tx(table)} SET status='deleted',body='',moderation_decision_id=NULL,updated_at=now() WHERE id=${targetId}`;
        await tx`DELETE FROM moderation_jobs WHERE target_type=${table === "posts" ? "post" : "comment"} AND target_id=${targetId}`;
      });
    }
    return { updated: true };
  }
  if (action === "report") {
    const report = z
      .object({
        targetType: z.enum(["post", "comment", "event"]),
        targetId: idSchema,
        reason: z.string().trim().min(3).max(2000),
      })
      .parse(data);
    const accessible =
      report.targetType === "event"
        ? await canReadEvent(member.id, report.targetId)
        : report.targetType === "post"
          ? await canReadPost(member.id, report.targetId)
          : await canReadComment(member.id, report.targetId);
    if (!accessible)
      throw new DomainError(
        "RESOURCE_NOT_FOUND",
        "That item is unavailable.",
        404,
      );
    await sql.begin(async (tx) => {
      await tx`INSERT INTO reports(id,reporter_id,target_type,target_id,reason) VALUES(${randomUUID()},${member.id},${report.targetType},${report.targetId},${report.reason}) ON CONFLICT DO NOTHING`;
      if (report.targetType !== "event")
        await enqueueModeration(
          tx,
          report.targetType,
          report.targetId,
          "report",
        );
    });
    return { reported: true };
  }
  if (action === "suggestCommunity") {
    requireEligible(member);
    const suggestion = z
      .object({
        name: z.string().trim().min(3).max(80),
        description: z.string().trim().min(10).max(3000),
        city: z.string().max(80).optional(),
      })
      .parse(data);
    await sql.begin(async (tx) => {
      const suggestionId = randomUUID();
      await tx`INSERT INTO community_suggestions(id,user_id,name,description,city) VALUES(${suggestionId},${member.id},${suggestion.name},${suggestion.description},${suggestion.city ?? null})`;
      const admins =
        await tx`SELECT id FROM users WHERE is_admin=true AND is_bot=false AND status='active' AND admitted_at IS NOT NULL`;
      for (const admin of admins)
        await tx`INSERT INTO notifications(id,user_id,type,message,resource_id,dedupe_key)
          VALUES(${randomUUID()},${admin.id},'community_suggestion',${`New sub request: ${suggestion.name}.`},${suggestionId},${`community-suggestion:${suggestionId}:${admin.id}`})`;
    });
    return { submitted: true };
  }
  if (action === "issueInvite") {
    throw new DomainError(
      "INVITATIONS_RETIRED",
      "Invitation codes are no longer needed. Sign up with a verified X account.",
      410,
    );
  }
  if (action === "markNotificationsRead") {
    await sql`UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE user_id=${member.id}`;
    return { read: true };
  }
  if (action === "block") {
    const blockedId = idSchema.parse(data.memberId);
    if (blockedId === member.id)
      throw new DomainError(
        "VALIDATION_ERROR",
        "You cannot block your own account.",
        422,
      );
    if (data.blocked === false)
      await sql`DELETE FROM blocks WHERE user_id=${member.id} AND blocked_id=${blockedId}`;
    else
      await sql`INSERT INTO blocks(user_id,blocked_id) VALUES(${member.id},${blockedId}) ON CONFLICT DO NOTHING`;
    return { blocked: data.blocked !== false };
  }
  if (action === "createEvent") return createEvent(member, data);
  if (action === "rsvp") return changeRsvp(member, data);
  if (action === "reviewRsvp") return reviewRsvp(member, data);
  if (action === "cancelEvent")
    return cancelEvent(member, idSchema.parse(data.eventId));
  if (action === "eventUpdate") return eventUpdate(member, data);
  if (action === "editEvent") return editEvent(member, data);
  if (action === "closeEventRegistration")
    return closeEventRegistration(member, idSchema.parse(data.eventId));
  if (action === "inviteEventGuest") {
    requireEligible(member);
    const eventId = idSchema.parse(data.eventId),
      guestId = idSchema.parse(data.memberId);
    const [event] =
      await sql`SELECT id FROM events WHERE id=${eventId} AND host_id=${member.id}`;
    if (!event)
      throw new DomainError(
        "FORBIDDEN",
        "Only the host can invite guests.",
        403,
      );
    const [guest] =
      await sql`SELECT id FROM users WHERE id=${guestId} AND admitted_at IS NOT NULL AND status='active'`;
    if (!guest)
      throw new DomainError(
        "RESOURCE_NOT_FOUND",
        "That member is unavailable.",
        404,
      );
    await sql`INSERT INTO event_invitations(event_id,user_id) VALUES(${eventId},${guestId}) ON CONFLICT DO NOTHING`;
    return { invited: true };
  }
  if (action === "adminReport") {
    requireAdmin(member);
    const reportId = idSchema.parse(data.reportId),
      status = z.enum(["resolved", "dismissed"]).parse(data.status),
      reason = z
        .string()
        .trim()
        .min(3)
        .max(2000)
        .parse(data.reason ?? "Reviewed by a platform administrator.");
    await sql.begin(async (tx) => {
      const [report] =
        await tx`SELECT * FROM reports WHERE id=${reportId} FOR UPDATE`;
      if (!report)
        throw new DomainError(
          "RESOURCE_NOT_FOUND",
          "That report is unavailable.",
          404,
        );
      await tx`UPDATE reports SET status=${status === "resolved" ? "actioned" : "dismissed"},resolution=${reason} WHERE id=${reportId}`;
      if (data.removeTarget === true && status === "resolved") {
        const table = { post: "posts", comment: "comments", event: "events" }[
          report.target_type as "post" | "comment" | "event"
        ];
        await tx`UPDATE ${tx(table)} SET status=${report.target_type === "event" ? "canceled" : "removed"},updated_at=now()
          ${report.target_type === "event" ? tx`` : tx`,moderation_decision_id=NULL`} WHERE id=${report.target_id} AND status<>'deleted'`;
        if (report.target_type !== "event") {
          await tx`UPDATE moderation_jobs SET state='superseded',lease_token=NULL,lease_until=NULL WHERE target_type=${report.target_type} AND target_id=${report.target_id}`;
          await tx`UPDATE moderation_decisions SET resolution='superseded' WHERE target_type=${report.target_type} AND target_id=${report.target_id} AND resolution='pending'`;
        }
      }
      await tx`INSERT INTO audit_events(id,actor_id,action,target_id,detail) VALUES(${randomUUID()},${member.id},'report_review',${reportId},${tx.json({ status, removeTarget: data.removeTarget === true, reason })})`;
    });
    return { reviewed: true };
  }
  if (action === "adminCreateCommunity") {
    requireAdmin(member);
    return sql.begin(async (tx) => {
      const community = await insertCommunity(tx, data);
      await tx`INSERT INTO audit_events(id,actor_id,action,target_id,detail) VALUES(${randomUUID()},${member.id},'community_create',${community.communityId},${tx.json({ slug: community.slug })})`;
      return community;
    });
  }
  if (action === "adminSuggestion") {
    requireAdmin(member);
    const suggestionId = idSchema.parse(data.suggestionId),
      status = z.enum(["accepted", "declined"]).parse(data.status);
    const reason = z
      .string()
      .trim()
      .max(2000)
      .parse(data.reason ?? "");
    return sql.begin(async (tx) => {
      const [suggestion] =
        await tx`SELECT * FROM community_suggestions WHERE id=${suggestionId} FOR UPDATE`;
      if (!suggestion)
        throw new DomainError(
          "RESOURCE_NOT_FOUND",
          "That suggestion is unavailable.",
          404,
        );
      if (suggestion.status !== "open")
        throw new DomainError(
          "SUGGESTION_REVIEWED",
          "That suggestion has already been reviewed. Refresh to see its decision.",
          409,
        );
      const community =
        status === "accepted"
          ? await insertCommunity(tx, {
              name: suggestion.name,
              description: suggestion.description,
              city: suggestion.city,
              slug: data.slug,
            })
          : undefined;
      await tx`UPDATE community_suggestions SET status=${status},resolution=${reason} WHERE id=${suggestionId}`;
      await tx`INSERT INTO notifications(id,user_id,type,message,resource_id,dedupe_key)
        VALUES(${randomUUID()},${suggestion.user_id},'community',${`Your subreddix suggestion was ${status === "accepted" ? "approved" : "declined"}.`},${community?.slug ?? null},${`community-review:${suggestionId}`})`;
      await tx`INSERT INTO audit_events(id,actor_id,action,target_id,detail) VALUES(${randomUUID()},${member.id},'community_suggestion_review',${suggestionId},${tx.json({ status, reason, ...community })})`;
      return { reviewed: true, ...community };
    });
  }
  if (action === "adminLockPost") {
    requireAdmin(member);
    const postId = idSchema.parse(data.postId),
      locked = z.boolean().parse(data.locked);
    await sql`UPDATE posts SET locked=${locked} WHERE id=${postId}`;
    await sql`INSERT INTO audit_events(id,actor_id,action,target_id,detail) VALUES(${randomUUID()},${member.id},'thread_lock',${postId},${sql.json({ locked })})`;
    return { locked };
  }
  throw new DomainError(
    "VALIDATION_ERROR",
    "This action is not supported.",
    422,
  );
}

export function requestHash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
