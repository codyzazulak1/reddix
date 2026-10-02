import { accountMember, revokeOtherSessions } from "@/lib/account-service";
import { apiError, json, requireSameOrigin } from "@/server/http";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    return json(
      await revokeOtherSessions(await accountMember(request), request),
    );
  } catch (error) {
    return apiError(error);
  }
}
