import { processModerationQueue } from "@/server/moderation";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { apiError, json } from "@/server/http";
import { DomainError } from "@/server/domain";
import { sql } from "@/server/db";
import { ensureAuthDatabase } from "@/lib/auth-store";
import { resyncMember } from "@/lib/auth-resync";
import { memberFromRow } from "@/server/members";
import { retirePendingInvitations } from "@/server/x-growth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET,
      supplied =
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (
      !secret ||
      Buffer.byteLength(secret) !== Buffer.byteLength(supplied) ||
      !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))
    )
      throw new DomainError(
        "FORBIDDEN",
        "Scheduler authentication is required.",
        403,
      );
    await ensureAuthDatabase();
    await sql`DELETE FROM member_visit_sessions WHERE started_at<now()-interval '90 days'`;
    await sql`DELETE FROM member_activity WHERE last_seen_at<now()-interval '90 days'`;
    await sql`DELETE FROM x_bot_state WHERE key LIKE 'oauth:%' AND lease_until<now()`;
    await sql`UPDATE x_invite_requests SET profile=NULL,consent_text='',decision=NULL WHERE created_at<now()-interval '30 days' AND state IN ('delivered','declined','stopped')`;
    await retirePendingInvitations();

    let reminders = 0;
    await sql.begin(async (tx) => {
      const [lock] =
        await tx`SELECT pg_try_advisory_xact_lock(921874) acquired`;
      if (!lock.acquired) return;
      const due =
        await tx`SELECT e.id,e.revision,r.user_id,CASE WHEN e.starts_at<=now()+interval '1 hour' THEN '1h' ELSE '24h' END reminder
        FROM events e JOIN event_rsvps r ON r.event_id=e.id JOIN users u ON u.id=r.user_id
        WHERE e.source='native' AND e.status='published' AND e.starts_at>now() AND e.starts_at<=now()+interval '24 hours'
        AND r.status='going' AND u.status='active' AND (u.preferences->>'eventReminders')::boolean IS DISTINCT FROM false
        AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.dedupe_key='reminder:'||e.id||':'||e.revision||':'||r.user_id||':'||CASE WHEN e.starts_at<=now()+interval '1 hour' THEN '1h' ELSE '24h' END)
        ORDER BY e.starts_at LIMIT 200`;
      for (const item of due) {
        await tx`INSERT INTO notifications(id,user_id,type,message,resource_id,dedupe_key) VALUES(${randomUUID()},${item.user_id},'event',
          ${item.reminder === "1h" ? "Your event starts within an hour. Check the event for the latest details." : "Your event is coming up within 24 hours. Check the event for the latest details."},
          ${item.id},${`reminder:${item.id}:${item.revision}:${item.user_id}:${item.reminder}`}) ON CONFLICT DO NOTHING`;
        reminders++;
      }
      await tx`DELETE FROM auth_dev_sessions WHERE expires_at<now()`;
      await tx`DELETE FROM auth_rate_limits WHERE expires_at<now()-interval '1 day'`;
      await tx`DELETE FROM rate_limits WHERE window_start<now()-interval '1 day'`;
      await tx`DELETE FROM feed_snapshots WHERE expires_at<now()`;
    });
    const candidates =
      await sql`SELECT u.* FROM users u WHERE u.status='active' AND u.admitted_at IS NOT NULL
      AND (u.verification_checked_at IS NULL OR u.verification_checked_at<now()-interval '12 hours')
      AND EXISTS(SELECT 1 FROM auth_account a JOIN auth_session s ON s.user_id=a.user_id WHERE a.account_id=u.x_id AND a.provider_id='twitter'
        AND s.expires_at>now() AND s.updated_at>now()-interval '24 hours')
      AND NOT EXISTS(SELECT 1 FROM auth_sync_state ss WHERE ss.member_id=u.id AND ss.attempted_at>now()-interval '5 minutes')
      ORDER BY u.verification_checked_at NULLS FIRST LIMIT 5`;
    let checked = 0,
      unavailable = 0;
    for (const candidate of candidates) {
      try {
        await resyncMember(memberFromRow(candidate), undefined, {
          eligibilityOnly: true,
          automatic: true,
        });
        checked++;
      } catch {
        unavailable++;
      }
    }
    const moderation = await processModerationQueue({ limit: 2 });
    return json({
      ok: true,
      moderation,
      reminders,
      verification: { checked, unavailable },
    });
  } catch (error) {
    return apiError(error);
  }
}
