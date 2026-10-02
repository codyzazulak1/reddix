import { apiError, apiMember, json } from "@/server/http";
import { getEvents } from "@/server/queries";
import { sql } from "@/server/db";
import { DomainError } from "@/server/domain";
import { iso } from "@/server/members";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const member = await apiMember(request),
      id = (await params).id;
    const [event] = await getEvents(member.id, id);
    if (!event)
      throw new DomainError(
        "RESOURCE_NOT_FOUND",
        "This event is unavailable.",
        404,
      );
    const canReadUpdates =
      event.host.id === member.id ||
      ["going", "pending_approval", "waitlisted"].includes(event.myRsvp);
    const updates = canReadUpdates
      ? await sql`SELECT id,body,created_at FROM event_updates WHERE event_id=${id} ORDER BY created_at DESC LIMIT 30`
      : [];
    return json({
      event,
      updates: updates.map((r) => ({
        id: r.id,
        body: r.body,
        createdAt: iso(r.created_at),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
