import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { sql } from "./db";
import {
  appOrigin,
  botConfig,
  boundedJson,
  openBotSecret,
  sealBotSecret,
  XBotError,
  xUserSchema,
} from "./x-bot-provider";

export const BOT_SCOPES = [
  "users.read",
  "tweet.read",
  "tweet.write",
  "offline.access",
];
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string(),
});
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const callback = () => `${appOrigin()}/api/admin/x-bot/callback`;
async function tokenRequest(values: Record<string, string>) {
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${encodeURIComponent(process.env.X_BOT_CLIENT_ID!)}:${encodeURIComponent(process.env.X_BOT_CLIENT_SECRET!)}`).toString("base64")}`,
    },
    body: new URLSearchParams(values),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new XBotError("BOT_RECONNECT_REQUIRED");
  }
  const tokens = tokenSchema.parse(await boundedJson(response));
  if (BOT_SCOPES.some((scope) => !tokens.scope.split(" ").includes(scope)))
    throw new XBotError("BOT_SCOPES_MISSING");
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}
export async function startBotConnection(memberId: string) {
  if (!botConfig().configured)
    throw new XBotError("BOT_CLIENT_CONFIGURATION_REQUIRED");
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  await sql`DELETE FROM x_bot_state WHERE key LIKE 'oauth:%' AND lease_until<now()`;
  await sql`INSERT INTO x_bot_state(key,value,lease_until) VALUES(${`oauth:${hash(state)}`},${sql.json({ memberId, verifier: sealBotSecret(verifier) })},now()+interval '10 minutes')`;
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_BOT_CLIENT_ID!,
    redirect_uri: callback(),
    scope: BOT_SCOPES.join(" "),
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return url.href;
}
export async function finishBotConnection(
  memberId: string,
  state: string,
  code: string,
) {
  const [attempt] =
    await sql`DELETE FROM x_bot_state WHERE key=${`oauth:${hash(state)}`} AND value->>'memberId'=${memberId} AND lease_until>now() RETURNING value`;
  if (!attempt) throw new XBotError("BOT_OAUTH_STATE_INVALID");
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: callback(),
    client_id: process.env.X_BOT_CLIENT_ID!,
    code_verifier: openBotSecret(attempt.value.verifier),
  });
  const response = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new XBotError("BOT_IDENTITY_UNAVAILABLE");
  const me = z
    .object({ data: xUserSchema })
    .parse(await boundedJson(response)).data;
  if (me.id !== botConfig().userId)
    throw new XBotError("BOT_IDENTITY_MISMATCH");
  await sql.begin(async (tx) => {
    await tx`INSERT INTO x_bot_state(key,value) VALUES('credentials',${tx.json({ xId: me.id, sealed: sealBotSecret(JSON.stringify(tokens)) })}) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`;
    await tx`INSERT INTO x_bot_state(key,value) VALUES('identity',${tx.json({ handle: me.username })}) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`;
  });
}
export async function botAccessToken() {
  if (!botConfig().configured) throw new XBotError("BOT_NOT_CONFIGURED");
  return sql.begin(async (tx) => {
    const [row] =
      await tx`SELECT value FROM x_bot_state WHERE key='credentials' FOR UPDATE`;
    if (!row?.value?.sealed || row.value.xId !== botConfig().userId)
      throw new XBotError("BOT_RECONNECT_REQUIRED");
    const saved = z
      .object({
        accessToken: z.string(),
        refreshToken: z.string(),
        expiresAt: z.number(),
      })
      .parse(JSON.parse(openBotSecret(row.value.sealed)));
    if (saved.expiresAt > Date.now() + 60_000) return saved.accessToken;
    const tokens = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: saved.refreshToken,
      client_id: process.env.X_BOT_CLIENT_ID!,
    });
    await tx`UPDATE x_bot_state SET value=${tx.json({ xId: row.value.xId, sealed: sealBotSecret(JSON.stringify(tokens)) })},updated_at=now() WHERE key='credentials'`;
    return tokens.accessToken;
  });
}
