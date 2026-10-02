import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  apiError,
  apiMember,
  json,
  readBoundedBody,
  requireSameOrigin,
} from "@/server/http";
import { DomainError, requireAdmin } from "@/server/domain";
import { requireRecentAuthentication } from "@/lib/auth-session";
import { ensureAuthDatabase } from "@/lib/auth-store";
import { sql } from "@/server/db";
import { renderOutbox } from "@/server/x-growth";
import { botConfig, xBotRequest, xUserSchema } from "@/server/x-bot-provider";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    requireAdmin(await apiMember(request));
    const [outbox, organizations, communities, worker, usage] =
      await Promise.all([
        sql`SELECT id,kind,resource_id,state,attempts,remote_id,last_error,created_at,payload FROM x_outbox WHERE kind IN ('post','digest') ORDER BY CASE WHEN state IN ('error','uncertain','preview','queued') THEN 0 ELSE 1 END,created_at DESC LIMIT 50`,
        sql`SELECT a.*,c.name,(SELECT count(*)::int FROM community_x_affiliations f WHERE f.community_id=a.community_id AND f.revoked_at IS NULL AND f.expires_at>now()) affiliates FROM community_x_accounts a JOIN communities c ON c.id=a.community_id ORDER BY c.name`,
        sql`SELECT id,name FROM communities WHERE archived=false ORDER BY name`,
        sql`SELECT value,updated_at FROM x_bot_state WHERE key='worker'`,
        sql`SELECT kind,count FROM x_bot_usage WHERE day=(now() AT TIME ZONE 'UTC')::date`,
      ]);
    const previews = await Promise.all(
      outbox.map(async (item) => ({
        ...item,
        preview:
          (await renderOutbox(item))?.text ??
          "Canceled: unavailable or sharing withdrawn.",
      })),
    );
    const [credentials] =
      await sql`SELECT value->>'xId' x_id FROM x_bot_state WHERE key='credentials'`;
    return json({
      config: {
        ...botConfig(),
        connected: credentials?.x_id === botConfig().userId,
      },
      outbox: previews,
      organizations,
      communities,
      worker: worker[0] ?? null,
      usage,
    });
  } catch (error) {
    return apiError(error);
  }
}
const command = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reviewInvite"),
    id: z.string().max(100),
    approve: z.boolean(),
  }),
  z.object({
    action: z.literal("linkOrganization"),
    communityId: z.string().max(100),
    handle: z.string().regex(/^[a-zA-Z0-9_]{1,15}$/),
  }),
  z.object({
    action: z.literal("unlinkOrganization"),
    communityId: z.string().max(100),
  }),
  z.object({
    action: z.literal("retryDelivery"),
    id: z.string().max(100),
    confirmedNotSent: z.boolean().default(false),
  }),
  z.object({ action: z.literal("cancelDelivery"), id: z.string().max(100) }),
  z.object({
    action: z.literal("confirmDelivered"),
    id: z.string().max(100),
    remoteId: z.string().regex(/^\d{1,20}$/),
  }),
]);
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const member = await apiMember(request);
    requireAdmin(member);
    await requireRecentAuthentication(request);
    await ensureAuthDatabase();
    const data = command.parse(
      JSON.parse(
        new TextDecoder().decode(await readBoundedBody(request, 5000)),
      ),
    );
    if (data.action === "reviewInvite") {
      throw new DomainError(
        "INVITATIONS_RETIRED",
        "Invitation codes are no longer needed. Sign up with a verified X account.",
        410,
      );
    } else if (data.action === "linkOrganization") {
      const organization = z.object({ data: xUserSchema }).parse(
        await xBotRequest(`/2/users/by/username/${data.handle}`, {
          "user.fields": "id,name,username,verified_type",
        }),
      ).data;
      if (organization.verified_type !== "business")
        throw new DomainError(
          "BUSINESS_REQUIRED",
          "Choose an X account with business verification.",
          422,
        );
      await sql.begin(async (tx) => {
        const [community] =
          await tx`SELECT id FROM communities WHERE id=${data.communityId} AND archived=false FOR UPDATE`;
        if (!community)
          throw new DomainError("NOT_FOUND", "Community unavailable.", 404);
        await tx`UPDATE community_x_affiliations SET revoked_at=now() WHERE community_id=${data.communityId}`;
        await tx`INSERT INTO community_x_accounts(community_id,x_id,handle,verified_by) VALUES(${data.communityId},${organization.id},${organization.username},${member.id})
          ON CONFLICT(community_id) DO UPDATE SET x_id=excluded.x_id,handle=excluded.handle,enabled=true,sync_cursor=NULL,sync_id=NULL,synced_at=NULL,next_sync_at=now(),last_error=NULL,verified_by=excluded.verified_by,updated_at=now()`;
      });
    } else if (data.action === "unlinkOrganization") {
      await sql.begin(async (tx) => {
        await tx`UPDATE community_x_accounts SET enabled=false,updated_at=now() WHERE community_id=${data.communityId}`;
        await tx`UPDATE community_x_affiliations SET revoked_at=now(),updated_at=now() WHERE community_id=${data.communityId}`;
      });
    } else if (data.action === "retryDelivery") {
      await sql`UPDATE x_outbox SET state='queued',next_attempt_at=now(),last_error=NULL,updated_at=now() WHERE id=${data.id}
        AND kind IN ('post','digest') AND (state IN ('preview','error') OR (state='uncertain' AND ${data.confirmedNotSent}))`;
    } else if (data.action === "cancelDelivery") {
      await sql`UPDATE x_outbox SET state='canceled',secret_payload=NULL,updated_at=now() WHERE id=${data.id} AND state IN ('queued','preview','error','uncertain')`;
    } else if (data.action === "confirmDelivered") {
      await sql`UPDATE x_outbox SET state='sent',remote_id=${data.remoteId},secret_payload=NULL,last_error=NULL,updated_at=now() WHERE id=${data.id} AND state='uncertain' AND kind IN ('post','digest')`;
    }
    await sql`INSERT INTO audit_events(id,actor_id,action,target_id) VALUES(${randomUUID()},${member.id},${`x_bot.${data.action}`},${"id" in data ? data.id : "communityId" in data ? data.communityId : null})`;
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
