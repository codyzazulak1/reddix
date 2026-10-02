import { normalizeVerification, type VerificationType } from "./auth-policy";
import { DomainError } from "@/server/domain";
import { highResolutionAvatar } from "./avatar";

export type XProfile = {
  xId: string;
  name: string;
  handle: string;
  avatar: string | null;
  bio: string;
  location: string;
  website: string | null;
  followers: number | null;
  following: number | null;
  verification: VerificationType;
  subscriptionType: string | null;
  observedAt: string;
};
export class XLookupError extends DomainError {
  constructor(
    public readonly kind:
      "reauth_required" | "temporarily_unavailable" | "unknown",
    message: string,
  ) {
    super(
      `X_${kind.toUpperCase()}`,
      message,
      kind === "temporarily_unavailable"
        ? 503
        : kind === "reauth_required"
          ? 403
          : 422,
    );
  }
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function parseXProfile(value: unknown, expectedXId?: string): XProfile {
  if (!value || typeof value !== "object")
    throw new XLookupError("unknown", "X returned an incomplete identity.");
  const p = value as Record<string, unknown>;
  if (
    typeof p.id !== "string" ||
    !/^\d+$/.test(p.id) ||
    typeof p.name !== "string" ||
    typeof p.username !== "string"
  ) {
    throw new XLookupError("unknown", "X returned an incomplete identity.");
  }
  if (expectedXId && p.id !== expectedXId)
    throw new XLookupError(
      "reauth_required",
      "Reconnect the same X account to refresh this profile.",
    );
  const metrics =
    p.public_metrics && typeof p.public_metrics === "object"
      ? (p.public_metrics as Record<string, unknown>)
      : {};
  const entities = p.entities as
    { url?: { urls?: { expanded_url?: string }[] } } | undefined;
  return {
    xId: p.id,
    name: p.name.slice(0, 150),
    handle: p.username.slice(0, 50),
    avatar: highResolutionAvatar(safeUrl(p.profile_image_url)),
    bio: typeof p.description === "string" ? p.description.slice(0, 2000) : "",
    location: typeof p.location === "string" ? p.location.slice(0, 200) : "",
    website: safeUrl(entities?.url?.urls?.[0]?.expanded_url ?? p.url),
    followers: count(metrics.followers_count),
    following: count(metrics.following_count),
    verification: normalizeVerification(p),
    subscriptionType:
      typeof p.subscription_type === "string" ? p.subscription_type : null,
    observedAt: new Date().toISOString(),
  };
}

export async function fetchXProfile(
  accessToken: string,
  expectedXId?: string,
): Promise<XProfile> {
  const observedAt = new Date().toISOString();
  const signal = AbortSignal.timeout(8000);
  const fields =
    "id,name,username,description,location,url,entities,profile_image_url,public_metrics,verified_type,subscription_type";
  let response: Response;
  try {
    response = await fetch(
      `https://api.x.com/2/users/me?user.fields=${fields}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal,
        redirect: "error",
      },
    );
    // Optional self-only subscription fields are not an authentication dependency.
    if (response.status === 400) {
      response = await fetch(
        `https://api.x.com/2/users/me?user.fields=${fields.replace(",subscription_type", "")}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
          signal,
          redirect: "error",
        },
      );
    }
    if (response.status === 400) {
      // Existing members can still authenticate if optional fields are unavailable.
      // New signups require authoritative verification and fail closed.
      // This response deliberately has unknown verification evidence.
      response = await fetch(
        "https://api.x.com/2/users/me?user.fields=id,name,username,profile_image_url",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
          signal,
          redirect: "error",
        },
      );
    }
  } catch {
    throw new XLookupError(
      "temporarily_unavailable",
      "X is temporarily unavailable. Please try again shortly.",
    );
  }
  if (response.status === 401 || response.status === 403)
    throw new XLookupError(
      "reauth_required",
      "Reconnect X to restore profile access.",
    );
  if (response.status === 429 || response.status >= 500)
    throw new XLookupError(
      "temporarily_unavailable",
      "X is temporarily unavailable. Please try again shortly.",
    );
  if (!response.ok)
    throw new XLookupError(
      "unknown",
      "X could not provide the required profile fields.",
    );
  let body: { data?: unknown };
  try {
    body = await response.json();
  } catch {
    throw new XLookupError("unknown", "X returned an incomplete identity.");
  }
  return { ...parseXProfile(body.data, expectedXId), observedAt };
}
