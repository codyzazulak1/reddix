import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { currentMember } from "@/lib/auth-session";
import { DomainError, requireAdmitted, requireOnboarded } from "./domain";

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Cookie",
    },
  });
}
export async function apiMember(request: Request, allowOnboarding = false) {
  const member = await currentMember(request);
  requireAdmitted(member);
  if (!allowOnboarding) requireOnboarded(member);
  return member;
}
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = new Set([new URL(request.url).origin]);
  if (process.env.NEXT_PUBLIC_APP_URL)
    allowed.add(new URL(process.env.NEXT_PUBLIC_APP_URL).origin);
  if (process.env.BETTER_AUTH_URL)
    allowed.add(new URL(process.env.BETTER_AUTH_URL).origin);
  if (!origin || !allowed.has(origin))
    throw new DomainError(
      "FORBIDDEN",
      "This request must originate from Reddix.",
      403,
    );
}
export async function readBoundedBody(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > maximumBytes)
    throw new DomainError(
      "VALIDATION_ERROR",
      "This request is too large.",
      413,
    );
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new DomainError(
          "VALIDATION_ERROR",
          "This request is too large.",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
export function apiError(error: unknown) {
  const requestId = randomUUID();
  if (error && typeof error === "object" && "code" in error) {
    if (
      error.code === "RX004" ||
      error.code === "RX005" ||
      error.code === "RX006"
    )
      return json(
        {
          error: {
            code:
              error.code === "RX004"
                ? "CHAT_UNAVAILABLE"
                : error.code === "RX005"
                  ? "REQUEST_PENDING"
                  : "VALIDATION_ERROR",
            message:
              error.code === "RX004"
                ? "This conversation is unavailable."
                : error.code === "RX005"
                  ? "Wait for your message request to be accepted before sending more."
                  : "Write a message before sending.",
            requestId,
          },
        },
        error.code === "RX004" ? 403 : error.code === "RX005" ? 409 : 422,
      );
    if (error.code === "40P01" || error.code === "40001")
      return json(
        {
          error: {
            code: "VERSION_CONFLICT",
            message:
              "This account or item changed while you were updating it. Refresh and try again.",
            requestId,
          },
        },
        409,
      );
    if (error.code === "RX001")
      return json(
        {
          error: {
            code: "VERIFICATION_REQUIRED",
            message:
              "Your X verification changed. Resync your account before participating.",
            requestId,
          },
        },
        403,
      );
    if (error.code === "RX002")
      return json(
        {
          error: {
            code: "AUTH_REQUIRED",
            message:
              "This account is no longer active. Sign in again to continue.",
            requestId,
          },
        },
        401,
      );
    if (error.code === "RX003")
      return json(
        {
          error: {
            code: "ONBOARDING_REQUIRED",
            message: "Complete onboarding before participating.",
            requestId,
          },
        },
        403,
      );
  }
  if (error instanceof ZodError)
    return json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message:
            error.issues[0]?.message ?? "Check the values and try again.",
          requestId,
        },
      },
      422,
    );
  if (error instanceof DomainError)
    return json(
      { error: { code: error.code, message: error.message, requestId } },
      error.status,
    );
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "status" in error &&
    "message" in error &&
    typeof error.status === "number" &&
    error.status < 500
  ) {
    return json(
      { error: { code: error.code, message: error.message, requestId } },
      error.status,
    );
  }
  console.error("Reddix API failure", {
    requestId,
    error: error instanceof Error ? error.message : "Unknown error",
  });
  return json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Please try again.",
        requestId,
      },
    },
    500,
  );
}
