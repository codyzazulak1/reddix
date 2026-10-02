import { headers } from "next/headers";
import type { Member } from "./types";
import { memberFromRow } from "@/server/members";
import { sql } from "@/server/db";
import {
  isDevelopmentAuth,
  readCookie,
  validateAuthEnvironment,
} from "./auth-policy";
import { tokenDigest } from "./auth-policy";
import { DomainError } from "@/server/domain";
import {
  DEV_COOKIE,
  developmentSessionMember,
  ensureAuthDatabase,
} from "./auth-store";
import { getAuth, xConfigured } from "./auth-provider";

/** The membership boundary used by every protected page and API. */
export async function currentMember(request?: Request): Promise<Member | null> {
  validateAuthEnvironment();
  const requestHeaders = request?.headers ?? (await headers());
  let member: Member | null = null;
  if (isDevelopmentAuth()) {
    const token = readCookie(requestHeaders.get("cookie"), DEV_COOKIE);
    if (token) member = await developmentSessionMember(token);
  }
  if (!member && xConfigured()) {
    await ensureAuthDatabase();
    const session = await getAuth().api.getSession({ headers: requestHeaders });
    if (session) {
      const [row] =
        await sql`SELECT u.* FROM auth_account a JOIN users u ON u.x_id=a.account_id
          WHERE a.user_id=${session.user.id} AND a.provider_id='twitter'`;
      if (row) member = memberFromRow(row);
    }
  }
  if (!member?.admittedAt || member.status === "deleted") return null;
  // Suspended members may access their restricted account status, while the
  // shared domain policy prohibits them from reading or writing content.
  return member;
}

export async function requireRecentAuthentication(
  request: Request,
  maximumAgeSeconds = 15 * 60,
): Promise<void> {
  let authenticatedAt: Date | null = null;
  if (isDevelopmentAuth()) {
    const token = readCookie(request.headers.get("cookie"), DEV_COOKIE);
    if (token) {
      await ensureAuthDatabase();
      const [session] =
        await sql`SELECT created_at FROM auth_dev_sessions WHERE token_digest=${tokenDigest(token)} AND expires_at>now()`;
      if (session) authenticatedAt = new Date(session.created_at);
    }
  }
  if (!authenticatedAt && xConfigured()) {
    const session = await getAuth().api.getSession({
      headers: request.headers,
    });
    if (session) authenticatedAt = new Date(session.session.createdAt);
  }
  if (
    !authenticatedAt ||
    authenticatedAt.getTime() + maximumAgeSeconds * 1000 < Date.now()
  ) {
    throw new DomainError(
      "RECENT_AUTH_REQUIRED",
      "Sign in with X again before making this sensitive account change.",
      403,
    );
  }
}
