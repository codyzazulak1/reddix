import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { z } from "zod";
import { DomainError } from "./domain";

const communitySchema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().min(10).max(3000),
  city: z.string().trim().max(80).nullish(),
  slug: z
    .string()
    .max(80)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Use lowercase letters, numbers, and single hyphens for the sub URL.",
    )
    .optional(),
});

function slugFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || `sub-${randomUUID()}`;
}

/** The caller commits creation together with its review or audit record. */
export async function insertCommunity(tx: TransactionSql, input: unknown) {
  const community = communitySchema.parse(input);
  const slug = community.slug ?? slugFromName(community.name);
  const [created] = await tx<{ id: string; slug: string }[]>`
    INSERT INTO communities(id,slug,name,description,city)
    VALUES(${slug},${slug},${community.name},${community.description},${community.city || null})
    ON CONFLICT DO NOTHING RETURNING id,slug
  `;
  if (!created)
    throw new DomainError(
      "COMMUNITY_EXISTS",
      `A sub already uses s/${slug}. Choose a different name or URL.`,
      409,
    );
  return { communityId: created.id, slug: created.slug };
}
