import { apiError, apiMember, json, requireSameOrigin } from "@/server/http";
import { requireAdmin } from "@/server/domain";
import { requireRecentAuthentication } from "@/lib/auth-session";
import { startBotConnection } from "@/server/x-bot-auth";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const member = await apiMember(request);
    requireAdmin(member);
    await requireRecentAuthentication(request);
    return json({ url: await startBotConnection(member.id) });
  } catch (error) {
    return apiError(error);
  }
}
