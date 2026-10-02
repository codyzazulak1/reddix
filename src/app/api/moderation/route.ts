import { z } from "zod";
import {
  apiError,
  apiMember,
  json,
  readBoundedBody,
  requireSameOrigin,
} from "@/server/http";
import { requireAdmin, DomainError } from "@/server/domain";
import { requireRecentAuthentication } from "@/lib/auth-session";
import { enforceRateLimit } from "@/server/actions";
import {
  getModerationDashboard,
  processModerationQueue,
  reviewModerationDecision,
} from "@/server/moderation";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: Request) {
  try {
    const member = await apiMember(request);
    requireAdmin(member);
    return json(await getModerationDashboard());
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const member = await apiMember(request);
    requireAdmin(member);
    await requireRecentAuthentication(request);
    await enforceRateLimit(member.id, "adminModeration");
    let raw: unknown;
    try {
      raw = JSON.parse(
        new TextDecoder().decode(await readBoundedBody(request, 5000)),
      );
    } catch {
      throw new DomainError(
        "VALIDATION_ERROR",
        "Enter a valid moderation request.",
        422,
      );
    }
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("process") }).strict(),
        z
          .object({
            action: z.literal("review"),
            decisionId: z.string().min(1).max(100),
            resolution: z.enum(["remove", "restore", "dismiss"]),
            reason: z.string().trim().min(5).max(1000),
          })
          .strict(),
      ])
      .parse(raw);
    if (input.action === "process")
      return json({
        ok: true,
        ...(await processModerationQueue({ limit: 3 })),
      });
    const { action: _, ...review } = input;
    return json({
      ok: true,
      ...(await reviewModerationDecision(member, review)),
    });
  } catch (error) {
    return apiError(error);
  }
}
