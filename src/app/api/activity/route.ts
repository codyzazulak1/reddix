import { apiError, apiMember, json, requireSameOrigin } from "@/server/http";
import { recordMemberVisit } from "@/server/x-growth";
import { enforceRateLimit } from "@/server/actions";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const member = await apiMember(request);
    await enforceRateLimit(member.id, "activity");
    await recordMemberVisit(member.id);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
