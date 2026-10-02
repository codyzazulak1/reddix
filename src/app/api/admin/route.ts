import { apiError, apiMember, json } from "@/server/http";
import { requireAdmin } from "@/server/domain";
import { sql } from "@/server/db";
import { iso, memberFromRow, publicMember } from "@/server/members";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const member = await apiMember(request);
    requireAdmin(member);
    const [reports, suggestions, audit, [counts]] = await Promise.all([
      sql`SELECT r.*,row_to_json(u) reporter FROM reports r JOIN users u ON u.id=r.reporter_id ORDER BY r.created_at DESC LIMIT 100`,
      sql`SELECT s.*,row_to_json(u) author FROM community_suggestions s JOIN users u ON u.id=s.user_id ORDER BY (s.status='open') DESC,s.created_at DESC,s.id DESC LIMIT 100`,
      sql`SELECT id,action,target_id,created_at FROM audit_events ORDER BY created_at DESC LIMIT 30`,
      sql`SELECT (SELECT count(*) FROM reports WHERE status='open') AS open_reports,
        (SELECT count(*) FROM community_suggestions WHERE status='open') AS open_suggestions`,
    ]);
    return json({
      reports: reports.map((r) => ({
        id: r.id,
        targetType: r.target_type,
        targetId: r.target_id,
        reason: r.reason,
        status: r.status,
        resolution: r.resolution,
        createdAt: iso(r.created_at),
        reporter: publicMember(memberFromRow(r.reporter)),
      })),
      suggestions: suggestions.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        city: s.city,
        status: s.status,
        resolution: s.resolution,
        createdAt: iso(s.created_at),
        author: publicMember(memberFromRow(s.author)),
      })),
      audit: audit.map((a) => ({
        id: a.id,
        action: a.action,
        targetId: a.target_id,
        createdAt: iso(a.created_at),
      })),
      counts: {
        openReports: Number(counts.open_reports),
        openSuggestions: Number(counts.open_suggestions),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
