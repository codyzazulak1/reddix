import { z } from "zod";
import { apiMember } from "@/server/http";
import { requireAdmin } from "@/server/domain";
import { finishBotConnection } from "@/server/x-bot-auth";
import { appOrigin } from "@/server/x-bot-provider";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const member = await apiMember(request);
    requireAdmin(member);
    const url = new URL(request.url),
      state = z.string().min(20).max(100).parse(url.searchParams.get("state")),
      code = z.string().min(1).max(2000).parse(url.searchParams.get("code"));
    await finishBotConnection(member.id, state, code);
    return new Response(null, {
      status: 303,
      headers: {
        Location: `${appOrigin()}/admin?bot=connected`,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return new Response(null, {
      status: 303,
      headers: {
        Location: `${appOrigin()}/admin?bot=connection-failed`,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
}
