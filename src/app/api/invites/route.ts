import { apiError, apiMember, json } from "@/server/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await apiMember(request);
    return json({
      invites: [],
      remaining: 0,
    });
  } catch (error) {
    return apiError(error);
  }
}
