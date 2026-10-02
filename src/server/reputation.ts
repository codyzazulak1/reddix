import type { Reputation } from "@/lib/types";
import { sql } from "./db";

export async function getReputation(memberId: string): Promise<Reputation> {
  // Aggregate each vote table separately so posts and comments cannot multiply
  // each other's votes. Read the current votes across the member's full history.
  const [row] = await sql`SELECT
    COALESCE((
      SELECT sum(v.value) FROM post_votes v JOIN posts p ON p.id=v.post_id
      WHERE p.author_id=${memberId} AND p.status='published' AND v.user_id<>p.author_id
    ),0) posts,
    COALESCE((
      SELECT sum(v.value) FROM comment_votes v JOIN comments c ON c.id=v.comment_id
      JOIN posts p ON p.id=c.post_id
      WHERE c.author_id=${memberId} AND c.status='published' AND p.status='published'
        AND v.user_id<>c.author_id
    ),0) comments`;
  // Keep the underlying votes intact, but reputation never falls below zero.
  const posts = Math.max(0, Number(row.posts));
  const comments = Math.max(0, Number(row.comments));
  return { posts, comments, total: posts + comments };
}
