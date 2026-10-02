import { NextResponse } from "next/server";
import { accountMember, deleteAccount } from "@/lib/account-service";
import { requireRecentAuthentication } from "@/lib/auth-session";
import { ATTEMPT_COOKIE, DEV_COOKIE, PASS_COOKIE } from "@/lib/auth-store";
import { authCookieOptions } from "@/lib/auth-provider";
import { apiError, requireSameOrigin } from "@/server/http";
import { DomainError } from "@/server/domain";

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const member = await accountMember(request);
    await requireRecentAuthentication(request);
    const text = await request.text();
    if (text.length > 4096)
      throw new DomainError(
        "VALIDATION_ERROR",
        "This request is too large.",
        413,
      );
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Enter a valid deletion confirmation.",
        422,
      );
    }
    const result = await deleteAccount(member, input);
    const response = NextResponse.json(result, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Vary: "Cookie",
      },
    });
    for (const name of [
      DEV_COOKIE,
      ATTEMPT_COOKIE,
      PASS_COOKIE,
      "better-auth.session_token",
      "__Secure-better-auth.session_token",
      "better-auth.session_data",
      "__Secure-better-auth.session_data",
    ]) {
      response.cookies.set(name, "", authCookieOptions(0));
    }
    return response;
  } catch (error) {
    return apiError(error);
  }
}
