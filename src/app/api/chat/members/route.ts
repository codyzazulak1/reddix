import { findChatMembers } from "@/server/chat";
import { apiError, apiMember, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const member = await apiMember(request);
    const params = new URL(request.url).searchParams;
    return json(
      await findChatMembers(member, {
        q: params.get("q"),
        id: params.get("id"),
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
