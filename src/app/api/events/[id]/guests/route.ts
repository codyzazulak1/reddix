import { apiError, apiMember, json } from "@/server/http";
import { sql } from "@/server/db";
import { DomainError } from "@/server/domain";
import { iso, memberFromRow, publicMember } from "@/server/members";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const member = await apiMember(request),
      id = (await params).id;
    const [event] = await sql`SELECT host_id FROM events WHERE id=${id}`;
    if (!event || event.host_id !== member.id)
      throw new DomainError(
        "FORBIDDEN",
        "Only the event host can view guest details.",
        403,
      );
    const guests =
      await sql`SELECT r.status,r.created_at,row_to_json(u) member FROM event_rsvps r JOIN users u ON u.id=r.user_id WHERE r.event_id=${id} ORDER BY r.created_at LIMIT 1000`;
    return json({
      guests: guests.map((r) => ({
        member: publicMember(memberFromRow(r.member)),
        status: r.status,
        createdAt: iso(r.created_at),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
