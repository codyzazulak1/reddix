import { NextResponse } from "next/server";
import { DomainError } from "@/server/domain";

export function authFailure(error: unknown, status = 400) {
  if (error instanceof DomainError)
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  const message =
    error instanceof Error ? error.message : "Unable to complete this request.";
  const safe =
    /invitation|admission|origin|from the Reddix|attempts|development authentication|X sign-in|configured|persona/i.test(
      message,
    );
  return NextResponse.json(
    {
      error: {
        code: status === 503 ? "SETUP_REQUIRED" : "AUTH_REQUEST_FAILED",
        message: safe
          ? message
          : "Unable to complete this request. Please try again.",
      },
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
