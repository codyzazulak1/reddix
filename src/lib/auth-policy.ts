import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const RESYNC_COOLDOWN_MS = 5 * 60 * 1000;
export const ADMISSION_TTL_MS = 10 * 60 * 1000;
export const DEV_PERSONAS = ["alex", "morgan", "jamie"] as const;
export type DevPersona = (typeof DEV_PERSONAS)[number];
export type VerificationType =
  "blue" | "business" | "government" | "none" | "unknown";

export function isDevelopmentAuth(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): boolean {
  return env.NODE_ENV !== "production" && env.AUTH_MODE === "development";
}

export function validateAuthEnvironment(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): void {
  if (env.NODE_ENV !== "production") return;
  if (env.AUTH_MODE !== "x")
    throw new Error(
      "Production requires AUTH_MODE=x. Development authentication cannot run in production.",
    );
  for (const key of [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "X_CLIENT_ID",
    "X_CLIENT_SECRET",
  ] as const) {
    if (!env[key])
      throw new Error(`Production authentication requires ${key}.`);
  }
  if ((env.BETTER_AUTH_SECRET?.length ?? 0) < 32)
    throw new Error(
      "Production session secret must contain at least 32 characters.",
    );
  if (!env.BETTER_AUTH_URL?.startsWith("https://"))
    throw new Error("Production BETTER_AUTH_URL must use HTTPS.");
}

/** X's authoritative blue, gold, and gray verification types allow signup. */
export function hasSignupVerification(type: string): boolean {
  return type === "blue" || type === "business" || type === "government";
}

export function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}
export function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function safeReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\x00-\x20]/.test(value)
  )
    return "/popular";
  try {
    const url = new URL(value, "https://reddix.invalid");
    if (
      url.origin !== "https://reddix.invalid" ||
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/auth/")
    )
      return "/popular";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/popular";
  }
}

export function normalizeVerification(payload: unknown): VerificationType {
  if (!payload || typeof payload !== "object") return "unknown";
  const verifiedType = (payload as Record<string, unknown>).verified_type;
  if (
    verifiedType === "blue" ||
    verifiedType === "business" ||
    verifiedType === "government" ||
    verifiedType === "none"
  )
    return verifiedType;
  return "unknown";
}

export function hasFreshVerification(
  type: string,
  expiresAt: Date | string | null | undefined,
  now = Date.now(),
): boolean {
  return (
    (type === "blue" || type === "business") &&
    !!expiresAt &&
    new Date(expiresAt).getTime() > now
  );
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const expected = process.env.BETTER_AUTH_URL
    ? new URL(process.env.BETTER_AUTH_URL).origin
    : new URL(request.url).origin;
  // Browser mutations always send Origin. Explicitly reject absent Origin to prevent
  // ambient-cookie requests from becoming a CSRF bypass through nonstandard clients.
  if (!origin || origin !== expected)
    throw new Error("This request must come from the Reddix app.");
}

export function readCookie(header: string | null, name: string): string | null {
  const item = header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!item) return null;
  try {
    return decodeURIComponent(item.slice(name.length + 1));
  } catch {
    return null;
  }
}
