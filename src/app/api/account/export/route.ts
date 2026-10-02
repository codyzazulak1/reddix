import { accountMember, exportAccount } from "@/lib/account-service";
import { apiError } from "@/server/http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const member = await accountMember(request);
    return Response.json(await exportAccount(member), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Vary: "Cookie",
        "Content-Disposition": `attachment; filename="reddix-account-${new Date().toISOString().slice(0, 10)}.json"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
