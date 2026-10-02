import { apiError, apiMember, json } from "@/server/http";
import { getPostDetail } from "@/server/queries";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const member = await apiMember(request);
    return json(await getPostDetail(member, (await params).id));
  } catch (error) {
    return apiError(error);
  }
}
