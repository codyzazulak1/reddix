import type { Comment } from "@/lib/types";
import { apiError, apiMember, json } from "@/server/http";
import { sql } from "@/server/db";
import { DomainError } from "@/server/domain";
import { iso, memberFromRow, publicMember } from "@/server/members";
import { getEvents, getPosts } from "@/server/queries";
import { getReputation } from "@/server/reputation";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const viewer = await apiMember(request),
      id = (await params).id;
    const [person] =
      await sql`SELECT u.* FROM users u WHERE u.id=${id} AND u.admitted_at IS NOT NULL AND u.status='active'
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=${viewer.id} AND b.blocked_id=u.id)`;
    if (!person)
      throw new DomainError(
        "RESOURCE_NOT_FOUND",
        "This member is unavailable.",
        404,
      );
    const member = publicMember(memberFromRow(person));
    const [posts, commentRows, events, reputation] = await Promise.all([
      getPosts(viewer.id, undefined, undefined, { authorId: id, limit: 100 }),
      sql`SELECT c.*,p.title post_title,co.slug community_slug,
        COALESCE((SELECT sum(v.value) FROM comment_votes v WHERE v.comment_id=c.id),0) score,
        COALESCE((SELECT v.value FROM comment_votes v WHERE v.comment_id=c.id AND v.user_id=${viewer.id}),0) my_vote
        FROM comments c JOIN posts p ON p.id=c.post_id JOIN communities co ON co.id=p.community_id
        WHERE c.author_id=${id} AND c.status='published' AND p.status='published'
        AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=${viewer.id} AND b.blocked_id=p.author_id)
        ORDER BY c.created_at DESC,c.id DESC LIMIT 100`,
      getEvents(viewer.id, undefined, id),
      getReputation(id),
    ]);
    const comments = commentRows.map((r) => ({
      id: r.id,
      postId: r.post_id,
      parentId: r.parent_id,
      author: member,
      body: r.body,
      depth: r.depth,
      score: Number(r.score),
      myVote: Number(r.my_vote) as Comment["myVote"],
      status: r.status,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      postTitle: r.post_title,
      communitySlug: r.community_slug,
    }));
    return json({
      member,
      reputation,
      posts,
      comments,
      events,
    });
  } catch (error) {
    return apiError(error);
  }
}
