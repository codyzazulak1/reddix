import { after } from "next/server";
import { processModerationQueue } from "@/server/moderation";
import { performAction } from "@/server/actions";
import {
  apiError,
  apiMember,
  json,
  readBoundedBody,
  requireSameOrigin,
} from "@/server/http";
import { resyncMember } from "@/lib/auth-resync";
import { requireAdmitted } from "@/server/domain";
import { requireRecentAuthentication } from "@/lib/auth-session";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    let member = await apiMember(request, true);
    const text = new TextDecoder().decode(
      await readBoundedBody(request, 100000),
    );
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      return json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Enter a valid request.",
          },
        },
        422,
      );
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      return json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Enter a valid action object.",
          },
        },
        422,
      );
    if (typeof data.action === "string" && data.action.startsWith("admin"))
      await requireRecentAuthentication(request);
    const restricted = [
      "createPost",
      "comment",
      "editPost",
      "editComment",
      "createEvent",
      "editEvent",
      "closeEventRegistration",
      "reviewRsvp",
      "eventUpdate",
      "inviteEventGuest",
      "suggestCommunity",
      "issueInvite",
    ];
    const writes =
      restricted.includes(String(data.action)) ||
      (data.action === "vote" && data.value !== 0) ||
      (data.action === "rsvp" && data.state !== "canceled");
    if (
      writes &&
      !member.eligible &&
      ["blue", "business"].includes(member.verificationType)
    ) {
      const refreshed = (
        await resyncMember(member, request.headers, {
          eligibilityOnly: true,
          automatic: true,
        })
      ).member;
      requireAdmitted(refreshed);
      member = refreshed;
    }
    const result = await performAction(member, data);
    if (
      ["createPost", "comment", "editPost", "editComment", "report"].includes(
        String(data.action),
      )
    ) {
      after(async () => {
        try {
          await processModerationQueue({ limit: 1 });
        } catch {
          console.error(
            "Moderation queue processing was deferred to the scheduler.",
          );
        }
      });
    }
    return json({ ok: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}
