import { accountMember } from "@/lib/account-service";
import { apiError, json } from "@/server/http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return json({ member: await accountMember(request) });
  } catch (error) {
    return apiError(error);
  }
}
