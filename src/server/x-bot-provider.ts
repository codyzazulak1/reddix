import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import { z } from "zod";

const id = z.string().regex(/^\d{1,20}$/);
export const xUserSchema = z.object({
  id,
  username: z.string().regex(/^[a-zA-Z0-9_]{1,15}$/),
  name: z.string().max(200),
  description: z.string().max(2000).optional(),
  protected: z.boolean().optional(),
  verified_type: z.string().optional(),
});
export type BotProfile = z.infer<typeof xUserSchema>;
export function botConfig() {
  const mode = process.env.X_BOT_MODE;
  return {
    mode: (mode === "live" || mode === "dry-run" ? mode : "off") as
      "off" | "dry-run" | "live",
    configured: [
      "X_BOT_USER_ID",
      "X_BOT_CLIENT_ID",
      "X_BOT_CLIENT_SECRET",
    ].every((k) => Boolean(process.env[k]?.trim())),
    userId: process.env.X_BOT_USER_ID ?? "",
    timeZone: process.env.X_BOT_TIMEZONE || "America/Los_Angeles",
    includeSessions: process.env.X_BOT_INCLUDE_SESSIONS === "1",
    automationApproved: process.env.X_BOT_AUTOMATION_APPROVED === "1",
  };
}
export function positiveLimit(name: string, fallback: number) {
  const raw = Number(process.env[name] ?? fallback);
  return Number.isInteger(raw) && raw >= 0 && raw <= 10000 ? raw : fallback;
}
export class XBotError extends Error {
  constructor(
    public code: string,
    public uncertain = false,
    public retryable = false,
  ) {
    super(code);
  }
}
export async function boundedJson(response: Response) {
  if (!response.body) throw new Error("EMPTY_PROVIDER_RESPONSE");
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 256_000) {
        await reader.cancel();
        throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
export async function xBotRequest(
  path: string,
  query: Record<string, string> = {},
  body?: unknown,
): Promise<unknown> {
  const config = botConfig();
  if (config.mode === "off" || !config.configured)
    throw new XBotError("BOT_NOT_CONFIGURED");
  if (body && (config.mode !== "live" || !config.automationApproved))
    throw new XBotError("BOT_WRITES_DISABLED");
  if (!/^\/2\/[a-zA-Z0-9/_-]+$/.test(path))
    throw new XBotError("INVALID_X_PATH");
  const url = new URL(path, "https://api.x.com");
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const method = body ? "POST" : "GET";
  const { botAccessToken } = await import("./x-bot-auth");
  let accessToken: string;
  try {
    accessToken = await botAccessToken();
  } catch (error) {
    throw error instanceof XBotError
      ? error
      : new XBotError("BOT_CREDENTIALS_UNAVAILABLE");
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new XBotError("X_NETWORK_ERROR", Boolean(body), !body);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    // A failed write may have reached X. Never automatically repeat an ambiguous write.
    throw new XBotError(
      `X_HTTP_${response.status}`,
      Boolean(body) && response.status >= 500,
      response.status === 429 || (!body && response.status >= 500),
    );
  }
  try {
    return await boundedJson(response);
  } catch {
    throw new XBotError("X_INVALID_RESPONSE", Boolean(body), !body);
  }
}
export async function lookupBotProfile(xId: string) {
  id.parse(xId);
  return z.object({ data: xUserSchema }).parse(
    await xBotRequest(`/2/users/${xId}`, {
      "user.fields": "id,name,username,description,protected,verified_type",
    }),
  ).data;
}
export function appOrigin() {
  const url = new URL(
    process.env.APP_URL ||
      process.env.BETTER_AUTH_URL ||
      "http://127.0.0.1:3000",
  );
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    throw new Error("HTTPS_APP_URL_REQUIRED");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("INVALID_APP_URL");
  return url.origin;
}
function encryptionKey() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("BOT_ENCRYPTION_SECRET_REQUIRED");
  return createHash("sha256").update(`reddix-x-outbox-v1:${secret}`).digest();
}
export function sealBotSecret(text: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((v) => v.toString("base64url"))
    .join(".");
}
export function openBotSecret(value: string) {
  const [iv, tag, data] = value
    .split(".")
    .map((v) => Buffer.from(v, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
