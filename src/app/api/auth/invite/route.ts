import { NextResponse } from "next/server";

/** Retired endpoint: invitation codes cannot grant membership. */
export async function POST() {
  return NextResponse.json(
    {
      error: {
        code: "INVITES_RETIRED",
        message:
          "Invitation codes are no longer used. Sign in with a verified X account to join Reddix.",
      },
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
