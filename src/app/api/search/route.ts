import { apiError, apiMember, json } from "@/server/http";
import { getCommunities, getEvents, getPosts } from "@/server/queries";
import { sql } from "@/server/db";
import { communityMatchesSearch } from "@/lib/community-catalog";
import { memberFromRow, publicMember } from "@/server/members";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const member = await apiMember(request),
      q = (new URL(request.url).searchParams.get("q") ?? "")
        .trim()
        .slice(0, 200);
    if (q.length < 2)
      return json({ posts: [], communities: [], events: [], members: [] });
    const [posts, communities, events, members] = await Promise.all([
      getPosts(member.id, undefined, undefined, { query: q, limit: 50 }),
      getCommunities(member.id),
      getEvents(member.id, undefined, undefined, { query: q, limit: 20 }),
      sql`SELECT u.* FROM users u WHERE u.status='active' AND u.admitted_at IS NOT NULL
        AND strpos(lower(u.name||' '||u.handle),lower(${q}))>0
        AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=${member.id} AND b.blocked_id=u.id)
        ORDER BY u.created_at,u.id LIMIT 20`,
    ]);
    return json({
      posts,
      communities: communities
        .filter((c) => !c.archived && communityMatchesSearch(c, q))
        .slice(0, 20),
      events,
      members: members.map((row) => publicMember(memberFromRow(row))),
    });
  } catch (error) {
    return apiError(error);
  }
}
