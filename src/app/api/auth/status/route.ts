import { NextResponse } from "next/server";
import { isDevelopmentAuth, readCookie } from "@/lib/auth-policy";
import { xConfigured } from "@/lib/auth-provider";
import { hasReturningMemberPass, PASS_COOKIE } from "@/lib/auth-store";

export async function GET(request: Request) {
  const returningMember = await hasReturningMemberPass(
    readCookie(request.headers.get("cookie"), PASS_COOKIE),
  );
  return NextResponse.json(
    {
      development: isDevelopmentAuth(),
      xConfigured: xConfigured(),
      inviteRequired: false,
      verificationRequired: true,
      returningMember,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
