import { apiError, apiMember, json } from "@/server/http";
import { getFeed } from "@/server/feed";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return json(
      await getFeed(
        await apiMember(request),
        new URL(request.url).searchParams,
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
