import { timingSafeEqual } from "node:crypto";
import { runXGrowthJobs } from "@/server/x-growth";
import { json, apiError } from "@/server/http";
import { DomainError } from "@/server/domain";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: Request) {
  try {
    const expected = process.env.CRON_SECRET ?? "",
      actual =
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (
      !expected ||
      Buffer.byteLength(expected) !== Buffer.byteLength(actual) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
    )
      throw new DomainError(
        "FORBIDDEN",
        "Scheduler authentication is required.",
        403,
      );
    return json(await runXGrowthJobs());
  } catch (error) {
    return apiError(error);
  }
}
