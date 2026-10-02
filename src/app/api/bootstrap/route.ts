import { apiError, apiMember, json } from "@/server/http";
import { getBootstrap } from "@/server/queries";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return json(await getBootstrap(await apiMember(request, true)));
  } catch (error) {
    return apiError(error);
  }
}
