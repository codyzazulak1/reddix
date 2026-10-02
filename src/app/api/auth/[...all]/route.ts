import { NextResponse } from "next/server";
import { authFailure } from "@/lib/auth-http";
import { assertSameOrigin } from "@/lib/auth-policy";
import { getAuth, xConfigured } from "@/lib/auth-provider";
import { ensureAuthDatabase, rateLimit } from "@/lib/auth-store";

export const runtime = "nodejs";
const allowed = new Map([
  ["/sign-in/social", "POST"],
  ["/callback/twitter", "GET"],
  ["/sign-out", "POST"],
]);
async function handle(request: Request) {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
  if (allowed.get(path) !== request.method)
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Not found." } },
      { status: 404 },
    );
  if (!xConfigured())
    return authFailure(
      new Error(
        "X sign-in is not configured yet. Add X developer credentials to enable it.",
      ),
      503,
    );
  try {
    if (request.method === "POST") assertSameOrigin(request);
    await ensureAuthDatabase();
    await rateLimit(
      `oauth:${request.headers.get("x-forwarded-for") ?? "local"}`,
      30,
      60,
    );
    const response = await getAuth().handler(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return authFailure(error);
  }
}
export const GET = handle;
export const POST = handle;
