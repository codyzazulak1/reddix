import { apiError, apiMember } from "@/server/http";
import { DomainError } from "@/server/domain";
import { sql } from "@/server/db";
import { readPrivateImage } from "@/server/storage";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const member = await apiMember(request),
      id = (await params).id;
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new DomainError(
        "RESOURCE_NOT_FOUND",
        "This image is unavailable.",
        404,
      );
    const [asset] =
      await sql`SELECT a.* FROM media_assets a LEFT JOIN posts p ON p.id=a.attached_post_id
      WHERE a.id=${id} AND ((a.owner_id=${member.id} AND a.attached_post_id IS NULL) OR (p.status='published'
        AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=${member.id} AND b.blocked_id=p.author_id)))`;
    if (!asset)
      throw new DomainError(
        "RESOURCE_NOT_FOUND",
        "This image is unavailable.",
        404,
      );
    const object = await readPrivateImage(asset.storage_key);
    return new Response(object.body as BodyInit, {
      headers: {
        "Content-Type": asset.mime_type,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        ...(object.length ? { "Content-Length": String(object.length) } : {}),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
