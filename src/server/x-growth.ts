import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { sql } from "./db";
import { ensureAuthDatabase } from "@/lib/auth-store";
import {
  appOrigin,
  botConfig,
  positiveLimit,
  xBotRequest,
  XBotError,
  xUserSchema,
} from "./x-bot-provider";
import { previousLocalDay, publicTitle, safeHandle } from "./x-growth-policy";

type Transaction = postgres.TransactionSql;
const numericId = z.string().regex(/^\d{1,20}$/);
const pageSchema = z
  .object({
    data: z.array(xUserSchema).max(1000).optional(),
    errors: z.array(z.unknown()).optional(),
    meta: z
      .object({
        next_token: z.string().optional(),
        result_count: z.number().optional(),
      })
      .optional(),
  })
  .refine(
    (page) => page.data !== undefined || page.meta?.result_count === 0,
    "Affiliate response must contain results or an explicit empty count.",
  );
export async function reserveBotUsage(kind: string, limit: number) {
  const rows =
    await sql`INSERT INTO x_bot_usage(day,kind,count) SELECT (now() AT TIME ZONE 'UTC')::date,${kind},1 WHERE ${limit}>0
    ON CONFLICT(day,kind) DO UPDATE SET count=x_bot_usage.count+1 WHERE x_bot_usage.count<${limit} RETURNING count`;
  return rows.length > 0;
}
export async function enqueuePostPromotion(tx: Transaction, postId: string) {
  await tx`INSERT INTO x_outbox(id,dedupe_key,kind,resource_id,next_attempt_at)
    SELECT ${randomUUID()},${`post:${postId}`},'post',id,now()+interval '2 minutes' FROM posts WHERE id=${postId} AND promote_on_x=true
    ON CONFLICT(dedupe_key) DO NOTHING`;
}
export async function retirePendingInvitations() {
  await sql`UPDATE x_invite_requests SET state='stopped',profile=NULL,consent_text='',decision=NULL,reason='Invitation codes have been retired.',updated_at=now() WHERE state IN ('pending','review','error','approved')`;
  await sql`UPDATE x_outbox SET state='canceled',secret_payload=NULL,last_error='Invitation codes have been retired.',updated_at=now() WHERE kind='invite_dm' AND state IN ('queued','preview','error','uncertain','sending')`;
}
export async function syncOrganizationAffiliates() {
  const [account] =
    await sql`SELECT a.* FROM community_x_accounts a JOIN communities c ON c.id=a.community_id WHERE a.enabled=true AND c.archived=false AND a.next_sync_at<=now() ORDER BY a.next_sync_at LIMIT 1`;
  if (!account) return;
  const syncId = account.sync_id ?? randomUUID();
  try {
    const query: Record<string, string> = {
      max_results: "100",
      "user.fields": "id,name,username",
    };
    if (account.sync_cursor) query.pagination_token = account.sync_cursor;
    const response = pageSchema.parse(
      await xBotRequest(`/2/users/${account.x_id}/affiliates`, query),
    );
    if (response.errors?.length) throw new Error("AFFILIATES_INCOMPLETE");
    await sql.begin(async (tx) => {
      const [current] =
        await tx`SELECT * FROM community_x_accounts WHERE community_id=${account.community_id} FOR UPDATE`;
      if (
        !current?.enabled ||
        current.x_id !== account.x_id ||
        current.sync_id !== account.sync_id
      )
        return;
      for (const affiliate of response.data ?? []) {
        await tx`INSERT INTO community_x_affiliations(community_id,x_id,source,sync_id,evidence,expires_at)
          VALUES(${account.community_id},${affiliate.id},'x',${syncId},${`https://x.com/${account.handle}/affiliates`},now()+interval '48 hours')
          ON CONFLICT(community_id,x_id) DO UPDATE SET source='x',sync_id=excluded.sync_id,evidence=excluded.evidence,expires_at=excluded.expires_at,revoked_at=NULL,updated_at=now()`;
      }
      if (!response.meta?.next_token) {
        await tx`UPDATE community_x_affiliations SET revoked_at=now(),updated_at=now() WHERE community_id=${account.community_id} AND sync_id IS DISTINCT FROM ${syncId}`;
      }
      await tx`UPDATE community_x_accounts SET sync_id=${response.meta?.next_token ? syncId : null},sync_cursor=${response.meta?.next_token ?? null},
        synced_at=CASE WHEN ${!response.meta?.next_token} THEN now() ELSE synced_at END,
        next_sync_at=CASE WHEN ${Boolean(response.meta?.next_token)} THEN now() ELSE now()+interval '24 hours' END,last_error=NULL,updated_at=now() WHERE community_id=${account.community_id}`;
    });
  } catch (error) {
    await sql`UPDATE community_x_accounts SET last_error=${error instanceof XBotError ? error.code : "AFFILIATES_UNAVAILABLE"},next_sync_at=now()+interval '1 hour',updated_at=now() WHERE community_id=${account.community_id}`;
  }
}
export async function recordMemberVisit(memberId: string, now = new Date()) {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`visit:${memberId}`},0))`;
    const [member] =
      await tx`SELECT id FROM users WHERE id=${memberId} AND status='active' AND admitted_at IS NOT NULL AND is_bot=false`;
    if (!member) return;
    const [last] =
      await tx`SELECT last_seen_at FROM member_activity WHERE member_id=${memberId} FOR UPDATE`;
    if (
      !last ||
      now.getTime() - new Date(last.last_seen_at).getTime() >= 30 * 60 * 1000
    )
      await tx`INSERT INTO member_visit_sessions(id,member_id,started_at) VALUES(${randomUUID()},${memberId},${now})`;
    await tx`INSERT INTO member_activity(member_id,last_seen_at) VALUES(${memberId},${now}) ON CONFLICT(member_id) DO UPDATE SET last_seen_at=GREATEST(member_activity.last_seen_at,excluded.last_seen_at)`;
  });
}
export async function buildDigest(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("INVALID_DIGEST_DAY");
  const config = botConfig();
  const [bounds] =
    await sql`SELECT ${day}::date::timestamp AT TIME ZONE ${config.timeZone} starts, (${day}::date+1)::timestamp AT TIME ZONE ${config.timeZone} ends`;
  const [counts] =
    await sql`SELECT (SELECT count(*) FROM comments c JOIN users u ON u.id=c.author_id WHERE c.created_at>=${bounds.starts} AND c.created_at<${bounds.ends} AND c.status='published' AND u.is_bot=false) comments,
    (SELECT count(*) FROM member_visit_sessions WHERE started_at>=${bounds.starts} AND started_at<${bounds.ends}) sessions`;
  const [top] = await sql`SELECT p.id,p.title,u.handle,
    COALESCE((SELECT sum(v.value) FROM post_votes v WHERE v.post_id=p.id AND v.created_at<${bounds.ends}),0) score
    FROM posts p JOIN users u ON u.id=p.author_id JOIN communities c ON c.id=p.community_id
    WHERE p.created_at>=${bounds.starts} AND p.created_at<${bounds.ends} AND p.status='published' AND p.promote_on_x=true AND c.archived=false
    AND u.status='active' AND u.is_bot=false AND (u.preferences->>'xPromotionOptOut') IS DISTINCT FROM 'true'
    ORDER BY score DESC,p.created_at ASC,p.id ASC LIMIT 1`;
  const lines = [`Reddix daily highlights · ${day}`];
  if (top)
    lines.push(
      `Top discussion by ${safeHandle(top.handle)}:`,
      publicTitle(top.title, 100),
    );
  lines.push(
    `${Number(counts.comments)} comments across Reddix${config.includeSessions ? ` · ${Number(counts.sessions)} member sessions` : ""}`,
  );
  lines.push(top ? `${appOrigin()}/p/${top.id}` : appOrigin());
  return {
    text: lines.join("\n"),
    day,
    postId: top?.id ?? null,
    comments: Number(counts.comments),
    sessions: config.includeSessions ? Number(counts.sessions) : null,
  };
}
export async function enqueueDailyDigest(now = new Date()) {
  const day = previousLocalDay(now, botConfig().timeZone);
  // A unique local date makes repeated cron invocations and DST changes safe.
  const [exists] =
    await sql`SELECT id FROM x_outbox WHERE dedupe_key=${`digest:${day}`}`;
  if (exists) return;
  const payload = await buildDigest(day);
  await sql`INSERT INTO x_outbox(id,dedupe_key,kind,resource_id,payload) VALUES(${randomUUID()},${`digest:${day}`},'digest',${day},${sql.json(payload)}) ON CONFLICT DO NOTHING`;
}
export async function renderOutbox(item: Record<string, unknown>) {
  if (item.kind === "post") {
    const [post] =
      await sql`SELECT p.*,u.handle,u.status author_status,u.preferences,c.archived FROM posts p JOIN users u ON u.id=p.author_id JOIN communities c ON c.id=p.community_id WHERE p.id=${String(item.resource_id)}`;
    if (
      !post ||
      post.status !== "published" ||
      post.author_status !== "active" ||
      post.archived ||
      !post.promote_on_x ||
      post.preferences?.xPromotionOptOut
    )
      return null;
    return {
      text: `New on Reddix by ${safeHandle(post.handle)}\n${publicTitle(post.title)}\n${appOrigin()}/p/${post.id}`,
    };
  }
  if (item.kind === "digest") {
    // Recompute before sending so a deleted post or withdrawn consent cannot leak.
    return buildDigest(String(item.resource_id));
  }
  return null;
}
export async function dispatchOutbox() {
  const config = botConfig();
  if (config.mode === "off") return;
  await retirePendingInvitations();
  // Crashed/expired sends require reconciliation; blindly retrying can duplicate posts.
  await sql`UPDATE x_outbox SET state='uncertain',last_error='Delivery was interrupted. Check X before retrying.',updated_at=now() WHERE state='sending' AND updated_at<now()-interval '3 minutes'`;
  const [item] =
    await sql`SELECT * FROM x_outbox WHERE state='queued' AND next_attempt_at<=now() AND kind IN ('post','digest') ORDER BY CASE kind WHEN 'digest' THEN 0 ELSE 1 END,created_at LIMIT 1`;
  if (!item) return;
  const payload = await renderOutbox(item);
  if (!payload) {
    await sql`UPDATE x_outbox SET state='canceled',secret_payload=NULL,updated_at=now() WHERE id=${item.id} AND state='queued'`;
    return;
  }
  if (config.mode === "dry-run" || !config.automationApproved) {
    await sql`UPDATE x_outbox SET state='preview',payload=${sql.json(payload)},updated_at=now() WHERE id=${item.id} AND state='queued'`;
    return;
  }
  if (
    !(await reserveBotUsage(
      "posts",
      positiveLimit("X_BOT_DAILY_POST_LIMIT", 100),
    ))
  ) {
    await sql`UPDATE x_outbox SET next_attempt_at=((now() AT TIME ZONE 'UTC')::date+1)::timestamp AT TIME ZONE 'UTC',updated_at=now() WHERE id=${item.id} AND state='queued'`;
    return;
  }
  const claimed =
    await sql`UPDATE x_outbox SET state='sending',attempts=attempts+1,updated_at=now() WHERE id=${item.id} AND state='queued' RETURNING id`;
  if (!claimed.length) return;
  try {
    const response = z
      .object({
        data: z.object({
          id: numericId.optional(),
        }),
      })
      .parse(await xBotRequest("/2/tweets", {}, { text: payload.text }));
    const remoteId = response.data.id;
    if (!remoteId) throw new XBotError("X_MISSING_RECEIPT", true);
    await sql.begin(async (tx) => {
      await tx`UPDATE x_outbox SET state='sent',remote_id=${remoteId},secret_payload=NULL,payload=${tx.json(payload)},last_error=NULL,updated_at=now() WHERE id=${item.id}`;
    });
  } catch (error) {
    // Schema/DB failures after a successful HTTP response are uncertain too.
    const state =
      error instanceof XBotError && !error.uncertain
        ? error.retryable
          ? "queued"
          : "error"
        : "uncertain";
    await sql`UPDATE x_outbox SET state=${state},last_error=${error instanceof XBotError ? error.code : "DELIVERY_UNCERTAIN"},next_attempt_at=now()+interval '30 minutes',updated_at=now() WHERE id=${item.id}`;
  }
}
export async function runXGrowthJobs() {
  const config = botConfig();
  if (config.mode === "off") return { mode: "off" };
  await ensureAuthDatabase();
  const token = randomUUID();
  const lease =
    await sql`INSERT INTO x_bot_state(key,value,lease_until) VALUES('worker',${sql.json({ token })},now()+interval '115 seconds')
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,lease_until=excluded.lease_until WHERE x_bot_state.lease_until IS NULL OR x_bot_state.lease_until<now() RETURNING key`;
  if (!lease.length) return { mode: config.mode, busy: true };
  const result: Record<string, string | boolean> = { mode: config.mode };
  const start = Date.now();
  try {
    await enqueueDailyDigest();
    if (!config.configured) return { ...result, configured: false };
    const me = z
      .object({ data: xUserSchema })
      .parse(await xBotRequest("/2/users/me"));
    if (me.data.id !== config.userId) throw new Error("BOT_IDENTITY_MISMATCH");
    // Remember the actual connected account handle.
    await sql`INSERT INTO x_bot_state(key,value) VALUES('identity',${sql.json({ handle: me.data.username })}) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`;
    for (const [name, run] of [
      ["affiliates", () => syncOrganizationAffiliates()],
      ["outbox", () => dispatchOutbox()],
      ["outbox2", () => dispatchOutbox()],
      ["outbox3", () => dispatchOutbox()],
    ] as const) {
      if (Date.now() - start > 80_000) break;
      try {
        await run();
        result[name] = "ok";
      } catch (error) {
        result[name] = error instanceof XBotError ? error.code : "unavailable";
      }
    }
    await sql`DELETE FROM member_visit_sessions WHERE started_at<now()-interval '90 days'`;
    await sql`UPDATE x_invite_requests SET profile=NULL,consent_text='',decision=NULL WHERE created_at<now()-interval '30 days' AND state IN ('delivered','declined','stopped')`;
    await retirePendingInvitations();
    return result;
  } catch (error) {
    result.error = error instanceof XBotError ? error.code : "BOT_RUN_FAILED";
    throw error;
  } finally {
    await sql`UPDATE x_bot_state SET lease_until=NULL,value=${sql.json({ lastRun: new Date().toISOString(), result })},updated_at=now() WHERE key='worker' AND value->>'token'=${token}`;
  }
}
