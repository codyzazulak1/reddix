import { NextResponse } from "next/server";
import { getMemberById } from "@/server/members";
import { authFailure } from "@/lib/auth-http";
import {
  DEV_PERSONAS,
  assertSameOrigin,
  isDevelopmentAuth,
} from "@/lib/auth-policy";
import { authCookieOptions } from "@/lib/auth-provider";
import {
  DEV_COOKIE,
  createDevelopmentSession,
  rateLimit,
} from "@/lib/auth-store";

export async function POST(request: Request) {
  if (!isDevelopmentAuth())
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Not found." } },
      { status: 404 },
    );
  try {
    assertSameOrigin(request);
    await rateLimit(
      `dev:${request.headers.get("x-forwarded-for") ?? "local"}`,
      30,
      60,
    );
    const body = await request.json();
    if (!DEV_PERSONAS.includes(body.persona))
      throw new Error("Choose a supported development persona.");
    const member = await getMemberById(`demo-${body.persona}`);
    if (!member)
      throw new Error("Development personas have not been initialized.");
    const token = await createDevelopmentSession(member.id);
    const response = NextResponse.json(
      { member, development: true },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(DEV_COOKIE, token, authCookieOptions(30 * 86400));
    return response;
  } catch (error) {
    return authFailure(error);
  }
}
