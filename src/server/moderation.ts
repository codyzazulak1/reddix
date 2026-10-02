import { createHash, randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import type { Member } from "@/lib/types";
import type {
  ModerationDecision,
  ModerationInput,
} from "@/lib/moderation-types";
import { ensureDatabase, sql } from "./db";
import { DomainError, requireAdmin } from "./domain";
import { iso } from "./members";
import { classifyModeration, moderationConfig } from "./moderation-provider";

export const MODERATOR_ID = "system-reddix";
type TargetType = "post" | "comment";
type Queryable = Sql | TransactionSql;
const AUTO_REMOVE_CATEGORIES = new Set(["spam", "scam", "threats", "hate"]);
const categoryMessages: Record<string, string> = {
  spam: "suspected spam",
  scam: "a suspected scam",
  harassment: "targeted harassment",
  hate: "hateful content",
  threats: "a threat of violence",
  privacy: "sharing private information",
  sexual_content: "sexual content",
  off_topic: "a community rule violation",
  other: "a community rule violation",
};
export function moderationMessage(
  category: string,
  reviewedByAdmin = false,
): string {
  const actor = reviewedByAdmin
    ? "an administrator after @reddix review"
    : "@reddix";
  return `Hidden by ${actor} for ${categoryMessages[category] ?? "a community rule violation"}. An administrator can review this decision.`;
}

async function loadTarget(
  db: Queryable,
  type: TargetType,
  id: string,
  lock = false,
) {
  const rows =
    type === "post"
      ? await db`SELECT p.*,p.id post_id,u.status author_status,u.admitted_at,u.is_bot,u.name author_name,u.handle author_handle,
        c.name community_name,c.rules,'published' post_status,NULL::text parent_body
        FROM posts p JOIN users u ON u.id=p.author_id JOIN communities c ON c.id=p.community_id
        WHERE p.id=${id} ${lock ? db`FOR UPDATE OF p` : db``}`
      : await db`SELECT co.*,p.title,p.url,p.image_url,p.status post_status,p.body post_body,
        u.status author_status,u.admitted_at,u.is_bot,u.name author_name,u.handle author_handle,c.name community_name,c.rules,
        CASE WHEN parent.status='published' THEN parent.body ELSE NULL END parent_body
        FROM comments co JOIN posts p ON p.id=co.post_id JOIN users u ON u.id=co.author_id
        JOIN communities c ON c.id=p.community_id LEFT JOIN comments parent ON parent.id=co.parent_id
        WHERE co.id=${id} ${lock ? db`FOR UPDATE OF co` : db``}`;
  const row = rows[0];
  if (!row) return null;
  // Context is checked separately before applying an answer. Only this item's
  // content identifies a review, so edits to surrounding posts cannot undo it.
  const hash = createHash("sha256")
    .update(
      JSON.stringify(
        type === "post"
          ? [
              row.author_id,
              row.title,
              row.body,
              row.url,
              row.image_url,
              row.community_id,
            ]
          : [row.author_id, row.body, row.post_id, row.parent_id],
      ),
    )
    .digest("hex");
  const context: ModerationInput["context"] = [];
  if (type === "comment") {
    context.push({
      role: "post",
      text: `${row.title}\n${String(row.post_body ?? "").slice(0, 3000)}`,
    });
    if (row.parent_body)
      context.push({
        role: "parent",
        text: String(row.parent_body).slice(0, 2000),
      });
  }
  const input: ModerationInput = {
    targetType: type,
    title: type === "post" ? String(row.title) : "",
    body: `${String(row.body)}${type === "post" && row.url ? `\nLink URL (not fetched): ${row.url}` : ""}`,
    community: String(row.community_name),
    rules: String(row.rules).slice(0, 3000),
    context,
    hasImage: type === "post" && Boolean(row.image_url),
    reported: false,
  };
  return { row, hash, input };
}

export async function enqueueModeration(
  tx: TransactionSql,
  targetType: TargetType,
  targetId: string,
  source: "create" | "edit" | "report",
): Promise<string | null> {
  const target = await loadTarget(tx, targetType, targetId);
  if (
    !target ||
    target.row.is_bot ||
    target.row.status !== "published" ||
    target.row.author_status !== "active"
  )
    return null;
  // A newer edit cancels pending work on an older version. Completed audit
  // records remain, but no worker can apply the older result to this version.
  await tx`UPDATE moderation_jobs SET state='superseded',lease_token=NULL,lease_until=NULL,updated_at=now()
    WHERE target_type=${targetType} AND target_id=${targetId} AND content_hash<>${target.hash} AND state IN ('queued','processing','error')`;
  await tx`UPDATE moderation_decisions SET resolution='superseded'
    WHERE target_type=${targetType} AND target_id=${targetId} AND content_hash<>${target.hash} AND resolution='pending'`;
  const [job] =
    await tx`INSERT INTO moderation_jobs(id,target_type,target_id,content_hash,source,reported)
    VALUES(${randomUUID()},${targetType},${targetId},${target.hash},${source},${source === "report"})
    ON CONFLICT(target_type,target_id,content_hash) DO UPDATE SET reported=moderation_jobs.reported OR EXCLUDED.reported
    RETURNING id`;
  return job.id;
}

async function claimJob(limit: number, jobIds?: string[]) {
  return sql.begin(async (tx) => {
    await tx`UPDATE moderation_jobs SET state='error',last_error='The worker stopped before finishing. Review this item manually.',lease_token=NULL,lease_until=NULL
      WHERE ((state='processing' AND lease_until<now()) OR state='queued') AND attempts>=3
      AND (${jobIds === undefined} OR id=ANY(${jobIds ?? []}::text[]))`;
    const [job] = await tx`SELECT * FROM moderation_jobs WHERE attempts<3 AND
      ((state IN ('queued','error') AND next_attempt_at<=now()) OR (state='processing' AND lease_until<now()))
      AND (${jobIds === undefined} OR id=ANY(${jobIds ?? []}::text[]))
      ORDER BY reported DESC,created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!job) return { job: null, limited: false };
    await tx`INSERT INTO moderation_daily_usage(day) VALUES((now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING`;
    const [usage] =
      await tx`SELECT *,day::text usage_day FROM moderation_daily_usage WHERE day=(now() AT TIME ZONE 'UTC')::date FOR UPDATE`;
    if (usage.requests >= limit) return { job: null, limited: true };
    await tx`UPDATE moderation_daily_usage SET requests=requests+1 WHERE day=${usage.usage_day}::date`;
    const token = randomUUID();
    await tx`UPDATE moderation_jobs SET state='processing',attempts=attempts+1,lease_token=${token},lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=${job.id}`;
    return {
      job: {
        id: String(job.id),
        target_type: String(job.target_type),
        target_id: String(job.target_id),
        content_hash: String(job.content_hash),
        reported: Boolean(job.reported),
        lease_token: token,
        usage_day: String(usage.usage_day),
      },
      limited: false,
    };
  });
}

function effectiveAction(
  result: ModerationDecision,
  input: ModerationInput,
  mode: string,
) {
  if (input.hasImage) return "review";
  if (
    result.verdict === "allow" &&
    result.category === "none" &&
    result.confidence >= 0.85
  )
    return "allow";
  if (
    mode === "auto" &&
    result.verdict === "remove" &&
    result.confidence >= 0.98 &&
    AUTO_REMOVE_CATEGORIES.has(result.category)
  )
    return "remove";
  return "review";
}

/** Durable leased jobs, with a small batch after writes and a cron recovery path. */
export async function processModerationQueue(
  options: {
    limit?: number;
    jobIds?: string[];
    classify?: (input: ModerationInput) => Promise<ModerationDecision>;
  } = {},
) {
  const config = moderationConfig();
  const stats = {
    processed: 0,
    allowed: 0,
    review: 0,
    removed: 0,
    failed: 0,
    skipped: 0,
    limited: false,
    disabled: !config.configured || config.mode === "off",
  };
  if (stats.disabled || options.jobIds?.length === 0) return stats;
  await ensureDatabase();
  const batch = Math.max(1, Math.min(3, options.limit ?? 2));
  for (let index = 0; index < batch; index++) {
    const claim = await claimJob(config.dailyLimit, options.jobIds);
    stats.limited = claim.limited;
    if (!claim.job) break;
    const job = claim.job;
    const type = job.target_type as TargetType;
    const target = await loadTarget(sql, type, String(job.target_id));
    if (
      !target ||
      target.hash !== job.content_hash ||
      target.row.status !== "published" ||
      target.row.post_status !== "published" ||
      target.row.author_status !== "active" ||
      !target.row.admitted_at ||
      target.row.is_bot
    ) {
      await sql`UPDATE moderation_jobs SET state='superseded',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=${job.id} AND lease_token=${job.lease_token}`;
      stats.skipped++;
      continue;
    }
    target.input.reported = Boolean(job.reported);
    try {
      const result = await (options.classify ?? classifyModeration)(
        target.input,
      );
      const applied = await sql.begin(async (tx) => {
        // Lock author before content, matching account deletion's lock order.
        await tx`SELECT id FROM users WHERE id=${target.row.author_id} FOR SHARE`;
        const fresh = await loadTarget(tx, type, String(job.target_id), true);
        const [owned] =
          await tx`SELECT * FROM moderation_jobs WHERE id=${job.id} FOR UPDATE`;
        // Usage still counts if an edit/deletion made the in-flight answer stale.
        await tx`UPDATE moderation_daily_usage SET input_tokens=input_tokens+${result.inputTokens},output_tokens=output_tokens+${result.outputTokens},cost_usd=cost_usd+${result.costUsd ?? 0} WHERE day=${job.usage_day}`;
        if (
          !owned ||
          owned.state !== "processing" ||
          owned.lease_token !== job.lease_token
        )
          return "skipped";
        if (
          !fresh ||
          fresh.hash !== job.content_hash ||
          fresh.row.status !== "published" ||
          fresh.row.post_status !== "published" ||
          fresh.row.author_status !== "active" ||
          !fresh.row.admitted_at
        ) {
          await tx`UPDATE moderation_jobs SET state='superseded',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=${job.id}`;
          return "skipped";
        }
        if (
          JSON.stringify(fresh.input.context) !==
            JSON.stringify(target.input.context) ||
          fresh.input.rules !== target.input.rules
        ) {
          await tx`UPDATE moderation_jobs SET state='queued',lease_token=NULL,lease_until=NULL,next_attempt_at=now()+interval '1 minute',updated_at=now() WHERE id=${job.id}`;
          return "skipped";
        }
        const latestConfig = moderationConfig();
        if (!latestConfig.configured || latestConfig.mode === "off") {
          await tx`UPDATE moderation_jobs SET state='queued',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=${job.id}`;
          return "skipped";
        }
        const action = effectiveAction(result, target.input, latestConfig.mode);
        const id = randomUUID();
        await tx`INSERT INTO moderation_decisions(id,job_id,target_type,target_id,post_id,author_id,content_hash,action,category,confidence,reason,model,input_tokens,output_tokens,cost_usd,resolution)
          VALUES(${id},${job.id},${type},${job.target_id},${fresh.row.post_id},${fresh.row.author_id},${fresh.hash},${action},${result.category},${result.confidence},${result.reason},${result.model},${result.inputTokens},${result.outputTokens},${result.costUsd},${action === "remove" ? "removed" : "pending"})`;
        if (action === "remove") {
          await tx`UPDATE ${tx(type === "post" ? "posts" : "comments")} SET status='removed',moderation_decision_id=${id},updated_at=now() WHERE id=${job.target_id}`;
          await tx`INSERT INTO notifications(id,user_id,type,message,resource_id,dedupe_key)
            VALUES(${randomUUID()},${fresh.row.author_id},'moderation',${moderationMessage(result.category)},${fresh.row.post_id},${`moderation:${id}`}) ON CONFLICT DO NOTHING`;
        }
        if (action !== "allow")
          await tx`INSERT INTO audit_events(id,actor_id,action,target_id,detail) VALUES(${randomUUID()},${MODERATOR_ID},${`moderation.${action}`},${job.target_id},${tx.json({ decisionId: id, category: result.category, model: result.model })})`;
        await tx`UPDATE moderation_jobs SET state='complete',last_error=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=${job.id}`;
        return action;
      });
      stats.processed++;
      if (applied === "allow") stats.allowed++;
      else if (applied === "review") stats.review++;
      else if (applied === "remove") stats.removed++;
      else stats.skipped++;
    } catch {
      // Provider bodies can contain private text or credentials. Store only a
      // fixed diagnostic, never the raw exception or model response.
      await sql`UPDATE moderation_jobs SET state='error',lease_token=NULL,lease_until=NULL,
        last_error='The AI check could not finish. It will retry up to three times; admins can still review reports.',
        next_attempt_at=now()+interval '5 minutes',updated_at=now() WHERE id=${job.id} AND lease_token=${job.lease_token}`;
      stats.failed++;
    }
  }
  return stats;
}

const reviewSchema = z
  .object({
    decisionId: z.string().min(1).max(100),
    resolution: z.enum(["remove", "restore", "dismiss"]),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();

export async function reviewModerationDecision(member: Member, input: unknown) {
  requireAdmin(member);
  const data = reviewSchema.parse(input);
  await sql.begin(async (tx) => {
    const [lookup] =
      await tx`SELECT * FROM moderation_decisions WHERE id=${data.decisionId}`;
    if (!lookup)
      throw new DomainError(
        "RESOURCE_NOT_FOUND",
        "That moderation review is unavailable.",
        404,
      );
    const people =
      await tx`SELECT * FROM users WHERE id IN (${member.id},${lookup.author_id}) ORDER BY id FOR SHARE`;
    const admin = people.find((person) => person.id === member.id);
    if (
      !admin?.is_admin ||
      admin.status !== "active" ||
      !admin.admitted_at ||
      !admin.onboarding_completed_at
    )
      throw new DomainError(
        "FORBIDDEN",
        "Administrator access is required.",
        403,
      );
    const type = lookup.target_type as TargetType;
    const target = await loadTarget(tx, type, String(lookup.target_id), true);
    const [decision] =
      await tx`SELECT * FROM moderation_decisions WHERE id=${data.decisionId} FOR UPDATE`;
    if (
      !decision ||
      !target ||
      target.hash !== decision.content_hash ||
      target.row.status === "deleted" ||
      target.row.author_status !== "active" ||
      !target.row.admitted_at
    )
      throw new DomainError(
        "MODERATION_STALE",
        "This contribution changed or is no longer available. Refresh the review queue.",
        409,
      );
    if (
      data.resolution === "restore" &&
      (target.row.status !== "removed" ||
        target.row.moderation_decision_id !== decision.id)
    )
      throw new DomainError(
        "MODERATION_STALE",
        "Only content hidden by this decision can be restored here.",
        409,
      );
    if (
      data.resolution === "remove" &&
      target.row.status !== "published" &&
      target.row.moderation_decision_id !== decision.id
    )
      throw new DomainError(
        "MODERATION_STALE",
        "Another moderator has already removed this contribution.",
        409,
      );
    if (data.resolution === "dismiss" && target.row.status !== "published")
      throw new DomainError(
        "MODERATION_STALE",
        "Use Restore content to reverse this removal.",
        409,
      );
    const resolution =
      data.resolution === "remove"
        ? "removed"
        : data.resolution === "restore"
          ? "restored"
          : "dismissed";
    await tx`UPDATE moderation_decisions SET resolution=${resolution},reviewed_by=${member.id},review_note=${data.reason},reviewed_at=now() WHERE id=${decision.id}`;
    if (data.resolution !== "dismiss") {
      await tx`UPDATE ${tx(type === "post" ? "posts" : "comments")} SET status=${data.resolution === "restore" ? "published" : "removed"},moderation_decision_id=${decision.id},updated_at=now() WHERE id=${target.row.id}`;
      await tx`INSERT INTO notifications(id,user_id,type,message,resource_id,dedupe_key)
        VALUES(${randomUUID()},${target.row.author_id},'moderation',${data.resolution === "restore" ? "An administrator restored your contribution after reviewing @reddix's decision." : "An administrator reviewed and removed your contribution for a community rule violation."},${target.row.post_id},${`moderation-review:${decision.id}:${resolution}`}) ON CONFLICT DO NOTHING`;
    }
    // Human decisions outrank in-flight model answers and future retries.
    await tx`UPDATE moderation_jobs SET state='complete',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE target_type=${type} AND target_id=${target.row.id} AND content_hash=${target.hash}`;
    // Keep free-text reasons only on the decision, so account deletion erases
    // them without leaving a second copy in the general audit log.
    await tx`INSERT INTO audit_events(id,actor_id,action,target_id,detail) VALUES(${randomUUID()},${member.id},${`moderation.${resolution}`},${target.row.id},${tx.json({ decisionId: decision.id })})`;
  });
  return { reviewed: true };
}

export async function getModerationDashboard() {
  const config = moderationConfig();
  const [cases, errors, counts, usage] = await Promise.all([
    sql`SELECT d.*,u.name author_name,u.handle author_handle,COALESCE(p.title,parent.title,'Unavailable contribution') title,
        COALESCE(p.body,c.body,'') body,COALESCE(p.status,c.status,'deleted') content_status
      FROM moderation_decisions d JOIN users u ON u.id=d.author_id
      LEFT JOIN posts p ON d.target_type='post' AND p.id=d.target_id
      LEFT JOIN comments c ON d.target_type='comment' AND c.id=d.target_id
      LEFT JOIN posts parent ON parent.id=c.post_id
      WHERE d.action<>'allow' ORDER BY (d.resolution='pending') DESC,d.created_at DESC LIMIT 100`,
    sql`SELECT id,target_type,target_id,last_error,created_at FROM moderation_jobs WHERE state='error' ORDER BY created_at DESC LIMIT 20`,
    sql`SELECT
      (SELECT count(*)::int FROM moderation_jobs WHERE state IN ('queued','processing')) queued,
      (SELECT count(*)::int FROM moderation_decisions WHERE action='review' AND resolution='pending') review,
      (SELECT count(*)::int FROM moderation_decisions d WHERE (EXISTS(SELECT 1 FROM posts p WHERE p.moderation_decision_id=d.id AND p.status='removed') OR EXISTS(SELECT 1 FROM comments c WHERE c.moderation_decision_id=d.id AND c.status='removed'))) removed,
      (SELECT count(*)::int FROM moderation_jobs WHERE state='error') failed`,
    sql`SELECT * FROM moderation_daily_usage WHERE day=(now() AT TIME ZONE 'UTC')::date`,
  ]);
  return {
    bot: { id: MODERATOR_ID, handle: "reddix", name: "Reddix" },
    configured: config.configured,
    mode: config.mode,
    model: config.model,
    dailyLimit: config.dailyLimit,
    today: {
      requests: Number(usage[0]?.requests ?? 0),
      costUsd: Number(usage[0]?.cost_usd ?? 0),
    },
    counts: counts[0],
    cases: cases.map((row) => ({
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      postId: row.post_id,
      authorName: row.author_name,
      authorHandle: row.author_handle,
      title: row.title,
      body: row.content_status === "deleted" ? "" : row.body,
      contentStatus: row.content_status,
      action: row.action,
      category: row.category,
      confidence: Number(row.confidence),
      reason: row.reason,
      model: row.model,
      createdAt: iso(row.created_at),
      resolution: row.resolution,
      reviewNote: row.review_note,
    })),
    errors: errors.map((row) => ({
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      message: row.last_error,
      createdAt: iso(row.created_at),
    })),
  };
}
