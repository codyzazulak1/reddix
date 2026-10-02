import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { sql } from "../src/server/db";
import { getMemberByXId } from "../src/server/members";
import { getAuth } from "../src/lib/auth-provider";
import {
  ATTEMPT_COOKIE,
  PASS_COOKIE,
  completeAdmission,
  createAuthenticationAttempt,
  ensureAuthDatabase,
  recordAttemptProfile,
} from "../src/lib/auth-store";
import {
  ADMISSION_TTL_MS,
  readCookie,
  tokenDigest,
} from "../src/lib/auth-policy";
import { parseXProfile, type XProfile } from "../src/lib/auth-x";
import { currentMember } from "../src/lib/auth-session";
import { POST as retiredInvite } from "../src/app/api/auth/invite/route";
import { GET as authStatus } from "../src/app/api/auth/status/route";

config({ path: ".env.local", quiet: true });
const prefix = `auth-test-${randomUUID()}`;
const testOrigin = "http://127.0.0.1:3000";
const testXIds: string[] = [];
const testAuthUserIds: string[] = [];
const attemptTokens: string[] = [];
let verifiedMemberXId: string;
let verifiedMemberPass: string;
let sequence = 0;
let clientSequence = 0;

function nextXId() {
  const xId = `998${Date.now()}${++sequence}`;
  testXIds.push(xId);
  return xId;
}

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

function profile(xId: string, verification: XProfile["verification"] = "blue") {
  return parseXProfile({
    id: xId,
    name: "Test Member",
    username: `test_member_${sequence}`,
    verified_type: verification,
    public_metrics: { followers_count: 12, following_count: 34 },
  });
}

async function startOAuth(callbackURL = "/popular") {
  const clientIp = `192.0.2.${++clientSequence}`;
  const response = await getAuth().handler(
    new Request(`${testOrigin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: testOrigin,
        "X-Forwarded-For": clientIp,
      },
      body: JSON.stringify({
        provider: "twitter",
        callbackURL,
        disableRedirect: true,
      }),
    }),
  );
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  const authorize = new URL(body.url);
  expect(authorize.origin).toBe("https://x.com");
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  const scopes = authorize.searchParams.get("scope")?.split(" ");
  expect(scopes).not.toContain("users.email");
  expect(scopes).toEqual(
    expect.arrayContaining(["users.read", "tweet.read", "offline.access"]),
  );
  const cookie = cookies(response);
  const token = readCookie(cookie, ATTEMPT_COOKIE);
  expect(token).toBeTruthy();
  attemptTokens.push(token!);
  return { authorize, cookie, token: token!, clientIp };
}

async function finishOAuth(
  started: Awaited<ReturnType<typeof startOAuth>>,
  xId: string,
  evidence: Record<string, unknown>,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const address =
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (address === "https://api.x.com/2/oauth2/token")
        return Response.json({
          access_token: "test-x-access-token",
          refresh_token: "test-x-refresh-token",
          token_type: "bearer",
          expires_in: 7200,
          scope: "users.read tweet.read offline.access",
        });
      if (address.startsWith("https://api.x.com/2/users/me?")) {
        expect(new URL(address).searchParams.get("user.fields")).toContain(
          "verified_type",
        );
        return Response.json({
          data: {
            id: xId,
            name: "Test Member",
            username: `test_member_${sequence}`,
            ...evidence,
          },
        });
      }
      throw new Error(
        `Unexpected network request in auth test: ${new URL(address).origin}`,
      );
    }),
  );
  const response = await getAuth().handler(
    new Request(
      `${testOrigin}/api/auth/callback/twitter?state=${encodeURIComponent(started.authorize.searchParams.get("state")!)}&code=test-code`,
      {
        headers: {
          Cookie: started.cookie,
          "X-Forwarded-For": started.clientIp,
        },
      },
    ),
  );
  const [account] =
    await sql`SELECT * FROM auth_account WHERE provider_id='twitter' AND account_id=${xId}`;
  expect(
    account,
    `Callback location: ${response.headers.get("location")}`,
  ).toBeTruthy();
  testAuthUserIds.push(account.user_id);
  return { response, account, cookie: cookies(response) };
}

async function directAdmission(xId = nextXId()) {
  const authUserId = `${prefix}-${++sequence}`;
  testAuthUserIds.push(authUserId);
  await sql`INSERT INTO auth_user(id,name,email) VALUES(${authUserId},'Test Member',${`${authUserId}@x.reddix.invalid`})`;
  await sql`INSERT INTO auth_account(id,account_id,provider_id,user_id) VALUES(${randomUUID()},${xId},'twitter',${authUserId})`;
  const attempt = await createAuthenticationAttempt(null);
  attemptTokens.push(attempt.token);
  await recordAttemptProfile(attempt.id, profile(xId));
  return { ...attempt, authUserId, xId };
}

beforeAll(async () => {
  const database = new URL(
    process.env.DATABASE_URL ?? "postgresql://reddix@127.0.0.1:55432/reddix",
  );
  if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname))
    throw new Error("Auth integration tests require a local database.");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AUTH_MODE", "x");
  vi.stubEnv("X_CLIENT_ID", "test-client-id");
  vi.stubEnv("X_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "test-only-session-secret-with-more-than-32-characters",
  );
  vi.stubEnv("BETTER_AUTH_URL", testOrigin);
  vi.stubEnv("INVITE_HMAC_SECRET", "");
  // Stale deployment settings must neither block verified signup nor allow
  // unverified signup now that invitation-based admission has been removed.
  vi.stubEnv("INVITE_MODE", "required");
  vi.stubEnv("LAUNCH_AT", "2099-01-01T00:00:00Z");
  await ensureAuthDatabase();
}, 30000);

afterAll(async () => {
  vi.unstubAllGlobals();
  for (const token of attemptTokens)
    await sql`DELETE FROM auth_admission_attempts WHERE token_digest=${tokenDigest(token)}`;
  if (testXIds.length) {
    await sql`DELETE FROM auth_admission_passes WHERE x_id IN ${sql(testXIds)}`;
    await sql`DELETE FROM auth_audit WHERE member_id IN (SELECT id FROM users WHERE x_id IN ${sql(testXIds)})`;
    await sql`DELETE FROM users WHERE x_id IN ${sql(testXIds)}`;
  }
  for (const userId of new Set(testAuthUserIds))
    await sql`DELETE FROM auth_user WHERE id=${userId}`;
  vi.unstubAllEnvs();
});

describe("persistent verified admission and installed Better Auth integration", () => {
  it("retires invitation redemption so codes cannot grant membership", async () => {
    const response = await retiredInvite();
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      error: { code: "INVITES_RETIRED" },
    });
  });

  it.each(["blue", "business", "government"] as const)(
    "admits a new X %s account directly without an invitation",
    async (verification) => {
      const xId = nextXId();
      const started = await startOAuth();
      const { response, account, cookie } = await finishOAuth(started, xId, {
        verified_type: verification,
      });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain("/popular");
      const member = await getMemberByXId(xId);
      expect(member?.admittedAt).toBeTruthy();
      expect(member?.verificationType).toBe(verification);
      expect(account.access_token).not.toBe("test-x-access-token");
      expect(account.refresh_token).not.toBe("test-x-refresh-token");
      const [attempt] =
        await sql`SELECT * FROM auth_admission_attempts WHERE token_digest=${tokenDigest(started.token)}`;
      expect(attempt.completed_at).toBeTruthy();
      expect(attempt.profile).toBeNull();
      expect(attempt.invite_id).toBeNull();
      expect(readCookie(cookie, ATTEMPT_COOKIE)).toBe("");
      const request = new Request(`${testOrigin}/api/auth/status`, {
        headers: { Cookie: cookie },
      });
      expect((await currentMember(request))?.xId).toBe(xId);
      const status = await (await authStatus(request)).json();
      expect(status).toMatchObject({
        xConfigured: true,
        inviteRequired: false,
        verificationRequired: true,
        returningMember: true,
      });
      expect(status).not.toHaveProperty("setupProfile");
      if (verification === "blue") {
        verifiedMemberXId = xId;
        verifiedMemberPass = readCookie(cookie, PASS_COOKIE)!;
      }
      const replay = await getAuth().handler(
        new Request(
          `${testOrigin}/api/auth/callback/twitter?state=${encodeURIComponent(started.authorize.searchParams.get("state")!)}&code=test-code`,
          { headers: { Cookie: started.cookie } },
        ),
      );
      expect(replay.status).toBe(403);
    },
    15000,
  );

  it.each([
    {
      evidence: { verified_type: "none" },
      error: "verification-required",
      mode: "open",
    },
    {
      evidence: { verified_type: "premium" },
      error: "verification-unavailable",
      mode: "required",
    },
    {
      evidence: { verified: true, subscription_type: "PremiumPlus" },
      error: "verification-unavailable",
      mode: "open",
    },
  ])(
    "rejects new accounts with $evidence and clears the OAuth session",
    async ({ evidence, error, mode }) => {
      vi.stubEnv("INVITE_MODE", mode);
      vi.stubEnv("LAUNCH_AT", "2020-01-01T00:00:00Z");
      const xId = nextXId();
      const started = await startOAuth();
      const { response, account, cookie } = await finishOAuth(
        started,
        xId,
        evidence,
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(`/?authError=${error}`);
      expect(await getMemberByXId(xId)).toBeNull();
      const sessions =
        await sql`SELECT id FROM auth_session WHERE user_id=${account.user_id}`;
      expect(sessions).toHaveLength(0);
      expect(readCookie(cookie, ATTEMPT_COOKIE)).toBe("");
      expect(readCookie(cookie, "better-auth.session_token")).toBe("");
      expect(
        await currentMember(
          new Request(testOrigin, { headers: { Cookie: cookie } }),
        ),
      ).toBeNull();
    },
    15000,
  );

  it("lets an admitted member sign in after losing verification while denying participation", async () => {
    const started = await startOAuth("/s/sf?q=meetup");
    const { response, cookie } = await finishOAuth(started, verifiedMemberXId, {
      verified_type: "none",
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/s/sf?q=meetup");
    const member = await currentMember(
      new Request(testOrigin, { headers: { Cookie: cookie } }),
    );
    expect(member?.xId).toBe(verifiedMemberXId);
    expect(member?.admittedAt).toBeTruthy();
    expect(member?.eligible).toBe(false);
  }, 15000);

  it("binds a returning-member pass to its original X identity", async () => {
    const attempt = await createAuthenticationAttempt(verifiedMemberPass);
    attemptTokens.push(attempt.token);
    await expect(
      recordAttemptProfile(attempt.id, profile(nextXId())),
    ).rejects.toThrow("does not match");
  });

  it.each(["stale", "future", "invalid"])(
    "rejects %s verification observations even when the profile says blue",
    async (time) => {
      const attempt = await directAdmission();
      const evidence = profile(attempt.xId);
      evidence.observedAt =
        time === "invalid"
          ? "invalid"
          : new Date(
              Date.now() +
                (time === "future" ? 60000 : -ADMISSION_TTL_MS - 1000),
            ).toISOString();
      await recordAttemptProfile(attempt.id, evidence);
      await expect(
        completeAdmission(attempt.id, attempt.token, attempt.authUserId),
      ).rejects.toMatchObject({ code: "X_VERIFICATION_UNAVAILABLE" });
      expect(await getMemberByXId(attempt.xId)).toBeNull();
    },
  );

  it("requires the OAuth account and attempt token to match the observed identity", async () => {
    const first = await directAdmission();
    const second = await directAdmission();
    await expect(
      completeAdmission(first.id, second.token, first.authUserId),
    ).rejects.toThrow();
    await expect(
      completeAdmission(first.id, first.token, second.authUserId),
    ).rejects.toThrow("identity mismatch");
    expect(await getMemberByXId(first.xId)).toBeNull();
    expect(await getMemberByXId(second.xId)).toBeNull();
  });

  it("allows only one completion of simultaneous requests for an admission attempt", async () => {
    const attempt = await directAdmission();
    const results = await Promise.allSettled([
      completeAdmission(attempt.id, attempt.token, attempt.authUserId),
      completeAdmission(attempt.id, attempt.token, attempt.authUserId),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect((await getMemberByXId(attempt.xId))?.admittedAt).toBeTruthy();
  });

  it("serializes simultaneous verified admissions for the same immutable X identity", async () => {
    const first = await directAdmission();
    const second = await createAuthenticationAttempt(null);
    attemptTokens.push(second.token);
    await recordAttemptProfile(second.id, profile(first.xId));
    const admissions = await Promise.all([
      completeAdmission(first.id, first.token, first.authUserId),
      completeAdmission(second.id, second.token, first.authUserId),
    ]);
    expect(admissions[0].memberId).toBe(admissions[1].memberId);
    const members = await sql`SELECT id FROM users WHERE x_id=${first.xId}`;
    expect(members).toHaveLength(1);
  });
});
