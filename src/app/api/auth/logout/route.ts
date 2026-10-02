import { NextResponse } from "next/server";
import { authFailure } from "@/lib/auth-http";
import { assertSameOrigin, readCookie } from "@/lib/auth-policy";
import { authCookieOptions, getAuth, xConfigured } from "@/lib/auth-provider";
import {
  ATTEMPT_COOKIE,
  DEV_COOKIE,
  PASS_COOKIE,
  revokeDevelopmentSession,
} from "@/lib/auth-store";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const token = readCookie(request.headers.get("cookie"), DEV_COOKIE);
    if (token) await revokeDevelopmentSession(token);
    const response = NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(DEV_COOKIE, "", authCookieOptions(0));
    response.cookies.set(ATTEMPT_COOKIE, "", authCookieOptions(0));
    response.cookies.set(PASS_COOKIE, "", authCookieOptions(0));
    if (xConfigured()) {
      const signedOut = await getAuth().api.signOut({
        headers: request.headers,
        asResponse: true,
      });
      for (const cookie of signedOut.headers.getSetCookie())
        response.headers.append("set-cookie", cookie);
    }
    return response;
  } catch (error) {
    return authFailure(error);
  }
}
