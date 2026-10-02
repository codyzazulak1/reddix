import { randomUUID } from "node:crypto";
import { ensureDatabase, hardenDatabasePrivacy, sql } from "@/server/db";
import { memberFromRow } from "@/server/members";
import { DomainError } from "@/server/domain";
import {
  ADMISSION_TTL_MS,
  hasSignupVerification,
  isDevelopmentAuth,
  opaqueToken,
  tokenDigest,
  VERIFICATION_TTL_MS,
} from "./auth-policy";
import type { XProfile } from "./auth-x";

export const DEV_COOKIE = "reddix.development-session";
export const ATTEMPT_COOKIE = "reddix.admission-attempt";
export const PASS_COOKIE = "reddix.admission-pass";
let ready: Promise<void> | undefined;

export async function ensureAuthDatabase(): Promise<void> {
  if (!ready)
    ready = (async () => {
      await ensureDatabase();
      if (
        process.env.NODE_ENV !== "production" &&
        process.env.AUTO_MIGRATE === "1"
      ) {
        await migrateAuthDatabase();
        return;
      }
      const [schema] =
        await sql`SELECT to_regclass('auth_user') AS users, to_regclass('auth_session') AS sessions,
      to_regclass('auth_account') AS accounts, to_regclass('auth_verification') AS verifications,
      to_regclass('enrollment_invites') AS invites, to_regclass('auth_admission_attempts') AS attempts,
      to_regclass('auth_admission_passes') AS passes, to_regclass('auth_sync_state') AS sync,
      to_regclass('auth_dev_sessions') AS dev_sessions, to_regclass('auth_rate_limits') AS rate_limits,
      to_regclass('auth_audit') AS audit`;
      if (!schema || Object.values(schema).some((value) => value === null)) {
        throw new Error(
          "Authentication database schema is missing. Run pnpm db:setup before starting Reddix.",
        );
      }
    })().catch((error) => {
      ready = undefined;
      throw error;
    });
  return ready;
}

/** Explicit deployment migration. Runtime requests do not migrate production. */
export async function migrateAuthDatabase(): Promise<void> {
  await ensureDatabase();
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(921875)`;
    await tx.unsafe(`
    CREATE TABLE IF NOT EXISTS auth_user (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, email_verified boolean NOT NULL DEFAULT false, image text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS auth_session (id text PRIMARY KEY, expires_at timestamptz NOT NULL, token text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), ip_address text, user_agent text, user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS auth_session_user_idx ON auth_session(user_id);
    CREATE TABLE IF NOT EXISTS auth_account (id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL, user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE, access_token text, refresh_token text, id_token text, access_token_expires_at timestamptz, refresh_token_expires_at timestamptz, scope text, password text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider_id, account_id));
    CREATE INDEX IF NOT EXISTS auth_account_user_idx ON auth_account(user_id);
    CREATE TABLE IF NOT EXISTS auth_verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS auth_verification_identifier_idx ON auth_verification(identifier);
    CREATE TABLE IF NOT EXISTS auth_dev_sessions (token_digest text PRIMARY KEY, member_id text NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS enrollment_invites (id text PRIMARY KEY, code_digest text NOT NULL UNIQUE, key_version integer NOT NULL DEFAULT 1, issuer_id text REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz, reserved_attempt text, reserved_until timestamptz, redeemer_x_id text, redeemer_id text REFERENCES users(id), redeemed_at timestamptz);
    ALTER TABLE enrollment_invites ADD COLUMN IF NOT EXISTS intended_x_id text;
    CREATE TABLE IF NOT EXISTS auth_admission_attempts (id text PRIMARY KEY, token_digest text NOT NULL UNIQUE, invite_id text REFERENCES enrollment_invites(id), expected_x_id text, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, completed_member_id text REFERENCES users(id), profile jsonb);
    CREATE TABLE IF NOT EXISTS auth_admission_passes (token_digest text PRIMARY KEY, member_id text NOT NULL REFERENCES users(id), x_id text NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz);
    CREATE TABLE IF NOT EXISTS auth_rate_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_sync_state (member_id text PRIMARY KEY REFERENCES users(id), last_manual_at timestamptz, attempted_at timestamptz, outcome text);
    CREATE TABLE IF NOT EXISTS auth_audit (id text PRIMARY KEY, member_id text REFERENCES users(id), action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    `);
    await hardenDatabasePrivacy(tx);
  });
}

export async function rateLimit(
  key: string,
  maximum = 20,
  seconds = 600,
): Promise<void> {
  await ensureAuthDatabase();
  const [row] = await sql`
    INSERT INTO auth_rate_limits (key, count, expires_at) VALUES (${tokenDigest(key)}, 1, now() + ${seconds} * interval '1 second')
    ON CONFLICT (key) DO UPDATE SET count = CASE WHEN auth_rate_limits.expires_at < now() THEN 1 ELSE auth_rate_limits.count + 1 END,
      expires_at = CASE WHEN auth_rate_limits.expires_at < now() THEN now() + ${seconds} * interval '1 second' ELSE auth_rate_limits.expires_at END
    RETURNING count`;
  if (Number(row.count) > maximum)
    throw new DomainError(
      "RATE_LIMITED",
      "Too many attempts. Please try again in a few minutes.",
      429,
    );
}

export async function createDevelopmentSession(
  memberId: string,
): Promise<string> {
  if (!isDevelopmentAuth())
    throw new Error("Development authentication is disabled.");
  await ensureAuthDatabase();
  const token = opaqueToken();
  await sql`INSERT INTO auth_dev_sessions (token_digest, member_id, expires_at) VALUES (${tokenDigest(token)}, ${memberId}, now() + interval '30 days')`;
  return token;
}

export async function developmentSessionMember(token: string) {
  if (!isDevelopmentAuth()) return null;
  await ensureAuthDatabase();
  const [row] =
    await sql`SELECT u.* FROM auth_dev_sessions s JOIN users u ON u.id=s.member_id
      WHERE s.token_digest=${tokenDigest(token)} AND s.expires_at>now()`;
  return row ? memberFromRow(row) : null;
}

export async function revokeDevelopmentSession(token: string): Promise<void> {
  await ensureAuthDatabase();
  await sql`DELETE FROM auth_dev_sessions WHERE token_digest = ${tokenDigest(token)}`;
}

export async function findAdmissionAttempt(token: string) {
  await ensureAuthDatabase();
  const [row] =
    await sql`SELECT * FROM auth_admission_attempts WHERE token_digest=${tokenDigest(token)} AND expires_at>now() AND completed_at IS NULL`;
  return row ?? null;
}

export async function createAuthenticationAttempt(passToken: string | null) {
  await ensureAuthDatabase();
  let expectedXId: string | null = null;
  if (passToken) {
    const [pass] =
      await sql`SELECT p.x_id FROM auth_admission_passes p JOIN users u ON u.id=p.member_id WHERE p.token_digest=${tokenDigest(passToken)} AND p.expires_at>now() AND p.revoked_at IS NULL AND u.status IN ('active','suspended') AND u.admitted_at IS NOT NULL AND u.x_id=p.x_id`;
    if (pass) expectedXId = pass.x_id;
  }
  const id = randomUUID();
  const token = opaqueToken();
  await sql`INSERT INTO auth_admission_attempts (id,token_digest,expected_x_id,expires_at) VALUES (${id},${tokenDigest(token)},${expectedXId},${new Date(Date.now() + ADMISSION_TTL_MS)})`;
  return { id, token };
}

export async function hasReturningMemberPass(
  passToken: string | null,
): Promise<boolean> {
  if (!passToken) return false;
  await ensureAuthDatabase();
  const [pass] =
    await sql`SELECT p.member_id FROM auth_admission_passes p JOIN users u ON u.id=p.member_id
    WHERE p.token_digest=${tokenDigest(passToken)} AND p.expires_at>now() AND p.revoked_at IS NULL
    AND u.status IN ('active','suspended') AND u.admitted_at IS NOT NULL AND u.x_id=p.x_id`;
  return !!pass;
}

export async function recordAttemptProfile(
  id: string,
  profile: XProfile,
): Promise<void> {
  await ensureAuthDatabase();
  const result =
    await sql`UPDATE auth_admission_attempts SET profile=${sql.json(profile)} WHERE id=${id} AND expires_at>now() AND completed_at IS NULL AND (expected_x_id IS NULL OR expected_x_id=${profile.xId}) RETURNING id`;
  if (!result.length)
    throw new Error("This X identity does not match the admission attempt.");
}

export async function completeAdmission(
  attemptId: string,
  attemptToken: string,
  authUserId: string,
): Promise<{ memberId: string; passToken: string }> {
  await ensureAuthDatabase();
  const passToken = opaqueToken();
  const memberId = await sql.begin(async (tx) => {
    const [attempt] =
      await tx`SELECT * FROM auth_admission_attempts WHERE id=${attemptId} AND token_digest=${tokenDigest(attemptToken)} FOR UPDATE`;
    if (
      !attempt ||
      attempt.completed_at ||
      new Date(attempt.expires_at).getTime() <= Date.now() ||
      !attempt.profile
    )
      throw new DomainError(
        "SETUP_EXPIRED",
        "Account setup expired. Sign in with X again to continue.",
        401,
      );
    const profile = attempt.profile as XProfile;
    const [account] =
      await tx`SELECT account_id FROM auth_account WHERE user_id=${authUserId} AND provider_id='twitter'`;
    if (
      !account ||
      account.account_id !== profile.xId ||
      (attempt.expected_x_id && attempt.expected_x_id !== profile.xId)
    )
      throw new Error("Admission identity mismatch.");
    // Serialize concurrent signups for the same immutable X identity.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`x:${profile.xId}`}, 0))`;
    const [existing] =
      await tx`SELECT * FROM users WHERE x_id=${profile.xId} FOR UPDATE`;
    // A suspended member may authenticate into their restricted account and
    // privacy controls. Every platform read/write still rejects suspension.
    if (existing && existing.status === "deleted")
      throw new Error("This account is restricted.");
    const checkedAt = new Date(profile.observedAt);
    const observedAt = checkedAt.getTime();
    const now = Date.now();
    const fresh =
      Number.isFinite(observedAt) &&
      observedAt <= now &&
      observedAt + ADMISSION_TTL_MS > now;
    if (!existing?.admitted_at) {
      if (!fresh || profile.verification === "unknown")
        throw new DomainError(
          "X_VERIFICATION_UNAVAILABLE",
          "We could not confirm your X verification. Sign in with X again to try again.",
          403,
        );
      if (!hasSignupVerification(profile.verification))
        throw new DomainError(
          "X_VERIFICATION_REQUIRED",
          "A verified X account is required to join Reddix. Sign in with an account that has a blue, gold, or gray check on X.",
          403,
        );
    }
    const id = existing?.id ?? randomUUID();
    const expiresAt =
      fresh && hasSignupVerification(profile.verification)
        ? new Date(observedAt + VERIFICATION_TTL_MS)
        : null;
    if (!existing) {
      const isAdmin = (process.env.ADMIN_X_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .includes(profile.xId);
      await tx`INSERT INTO users (id,x_id,name,handle,avatar_url,bio,website,location,followers_count,following_count,verification_type,verification_checked_at,verification_expires_at,is_admin,admitted_at)
        VALUES (${id},${profile.xId},${profile.name},${profile.handle},${profile.avatar},${profile.bio},${profile.website ?? ""},${profile.location},${profile.followers ?? 0},${profile.following ?? 0},${profile.verification},${checkedAt},${expiresAt},${isAdmin},now())`;
    } else {
      await tx`UPDATE users SET admitted_at=coalesce(admitted_at,now()),verification_type=${profile.verification},verification_checked_at=${checkedAt},verification_expires_at=${expiresAt} WHERE id=${id} AND (verification_checked_at IS NULL OR verification_checked_at<=${checkedAt})`;
    }
    await tx`UPDATE auth_admission_attempts SET completed_at=now(),completed_member_id=${id},invite_id=NULL,profile=NULL WHERE id=${attemptId}`;
    await tx`INSERT INTO auth_admission_passes (token_digest,member_id,x_id,expires_at) VALUES (${tokenDigest(passToken)},${id},${profile.xId},now() + interval '90 days')`;
    await tx`INSERT INTO auth_audit (id,member_id,action) VALUES (${randomUUID()},${id},'membership.admitted')`;
    return String(id);
  });
  return { memberId, passToken };
}
