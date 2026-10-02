import { sql } from "@/server/db";
import { getMemberById } from "@/server/members";
import { DomainError } from "@/server/domain";
import type { Member } from "./types";
import { getAuth, xConfigured } from "./auth-provider";
import { ensureAuthDatabase } from "./auth-store";
import {
  isDevelopmentAuth,
  RESYNC_COOLDOWN_MS,
  VERIFICATION_TTL_MS,
} from "./auth-policy";
import { fetchXProfile, XLookupError } from "./auth-x";

/** Both manual and future job-driven checks serialize on the immutable X ID. */
export async function resyncMember(
  member: Member,
  _headers?: Headers,
  options: { eligibilityOnly?: boolean; automatic?: boolean } = {},
) {
  await ensureAuthDatabase();
  if (!member.admittedAt || member.status !== "active")
    throw new DomainError(
      "FORBIDDEN",
      "This account cannot sync its X profile.",
      403,
    );
  let lookupError: Error | undefined;
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`x:${member.xId}`}, 0))`;
    const [current] =
      await tx`SELECT status,admitted_at,x_id FROM users WHERE id=${member.id}`;
    if (
      !current ||
      current.status !== "active" ||
      !current.admitted_at ||
      current.x_id !== member.xId
    ) {
      throw new DomainError(
        "FORBIDDEN",
        "This account cannot sync its X profile.",
        403,
      );
    }
    const [state] =
      await tx`SELECT last_manual_at FROM auth_sync_state WHERE member_id=${member.id}`;
    if (
      !options.automatic &&
      state?.last_manual_at &&
      new Date(state.last_manual_at).getTime() + RESYNC_COOLDOWN_MS > Date.now()
    ) {
      throw new DomainError(
        "RESYNC_COOLDOWN",
        "Your X profile was just synced. Please wait five minutes before syncing again.",
        429,
      );
    }
    await tx`INSERT INTO auth_sync_state (member_id,last_manual_at,attempted_at,outcome) VALUES (${member.id},${options.automatic ? null : new Date()},now(),'checking')
      ON CONFLICT(member_id) DO UPDATE SET attempted_at=now(),last_manual_at=coalesce(excluded.last_manual_at,auth_sync_state.last_manual_at),outcome='checking'`;
    if (isDevelopmentAuth() && member.id.startsWith("demo-")) {
      await tx`UPDATE users SET verification_checked_at=now(),verification_expires_at=now() + interval '24 hours' WHERE id=${member.id}`;
      await tx`UPDATE auth_sync_state SET outcome='development_fixture' WHERE member_id=${member.id}`;
      return;
    }
    if (!xConfigured())
      throw new DomainError(
        "SETUP_REQUIRED",
        "X profile syncing needs the X developer app credentials.",
        503,
      );
    const [account] =
      await tx`SELECT id,user_id FROM auth_account WHERE provider_id='twitter' AND account_id=${member.xId}`;
    const attemptAt = new Date();
    try {
      if (!account)
        throw new XLookupError(
          "reauth_required",
          "Reconnect the same X account to sync your profile.",
        );
      // The browser cannot call this endpoint: the public auth router uses an
      // explicit allowlist. Tokens remain inside this server operation.
      let tokens;
      try {
        tokens = await getAuth().api.getAccessToken({
          body: { accountId: account.id, userId: account.user_id },
        });
      } catch {
        // Better Auth intentionally normalizes refresh failures, so this does
        // not prove revocation. Keep the existing lease's original expiry.
        throw new XLookupError(
          "temporarily_unavailable",
          "X could not refresh your access. Try again shortly, or reconnect X if the problem continues.",
        );
      }
      const profile = await fetchXProfile(tokens.accessToken, member.xId);
      const eligible =
        profile.verification === "blue" || profile.verification === "business";
      await tx`UPDATE users SET verification_type=${profile.verification}, verification_checked_at=${attemptAt}, verification_expires_at=${eligible ? new Date(attemptAt.getTime() + VERIFICATION_TTL_MS) : null}
        WHERE id=${member.id} AND (verification_checked_at IS NULL OR verification_checked_at<=${attemptAt})`;
      if (!options.eligibilityOnly) {
        await tx`UPDATE users SET name=${profile.name},handle=${profile.handle},avatar_url=${profile.avatar},bio=${profile.bio},website=${profile.website ?? ""},location=${profile.location},followers_count=${profile.followers ?? 0},following_count=${profile.following ?? 0} WHERE id=${member.id}`;
      }
      await tx`UPDATE auth_sync_state SET outcome=${eligible ? "eligible" : profile.verification === "unknown" ? "unknown" : "ineligible"} WHERE member_id=${member.id}`;
    } catch (error) {
      const normalized =
        error instanceof XLookupError
          ? error
          : new XLookupError(
              "temporarily_unavailable",
              "X is temporarily unavailable. Your current profile has been preserved.",
            );
      // A transient provider failure cannot extend the old evidence lease.
      // Explicitly missing/revoked evidence invalidates eligibility immediately.
      if (normalized.kind !== "temporarily_unavailable")
        await tx`UPDATE users SET verification_type='unknown',verification_checked_at=${attemptAt},verification_expires_at=NULL WHERE id=${member.id} AND (verification_checked_at IS NULL OR verification_checked_at<=${attemptAt})`;
      await tx`UPDATE auth_sync_state SET outcome=${normalized.kind} WHERE member_id=${member.id}`;
      lookupError = normalized;
    }
  });
  // Throw only after the evidence invalidation transaction has committed.
  if (lookupError) throw lookupError;
  return {
    member: await getMemberById(member.id),
    development: isDevelopmentAuth(),
    message: isDevelopmentAuth()
      ? "Local demo identity refreshed. No request was sent to X."
      : "Your profile and verification are now synced with X.",
  };
}
