import { apiError, apiMember } from "@/server/http";
import { getEvents } from "@/server/queries";
import { DomainError } from "@/server/domain";
import { eventCalendar } from "@/server/calendar";
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
    return new Response(eventCalendar(event), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="reddix-event.ics"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
