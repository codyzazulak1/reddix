import type { CommunityShareData } from "@/lib/social-share";
import { sql } from "./db";

/** Read public page metadata, including communities created after seeding. */
export async function getCommunityShareData(
  slug: string,
): Promise<CommunityShareData | null> {
  if (slug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;

  const [community] = await sql<CommunityShareData[]>`
    SELECT slug, name, description
    FROM communities
    WHERE slug = ${slug} AND archived = false
    LIMIT 1
  `;
  return community ?? null;
}
