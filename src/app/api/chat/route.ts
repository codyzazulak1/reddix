import {
  chatActionSchema,
  getChatInbox,
  getChatSummary,
  performChatAction,
} from "@/server/chat";
import {
  apiError,
  apiMember,
  json,
  readBoundedBody,
  requireSameOrigin,
} from "@/server/http";
import { resyncMember } from "@/lib/auth-resync";
import { requireAdmitted } from "@/server/domain";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const member = await apiMember(request);
    return json(
      await (new URL(request.url).searchParams.get("summary") === "1"
        ? getChatSummary(member)
        : getChatInbox(member)),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    let member = await apiMember(request);
    const text = new TextDecoder().decode(
      await readBoundedBody(request, 20000),
    );
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      return json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Enter a valid chat request.",
          },
        },
        422,
      );
    }
    const data = chatActionSchema.parse(input);
    if (
      (data.action === "request" || data.action === "send") &&
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
    return json({ ok: true, ...(await performChatAction(member, data)) });
  } catch (error) {
    return apiError(error);
  }
}
