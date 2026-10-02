import type {
  Member,
  Preferences,
  PublicMember,
  VerificationType,
} from "@/lib/types";
import { ensureDatabase, sql } from "./db";
import { highResolutionAvatar } from "@/lib/avatar";

export const defaultPreferences: Preferences = {
  city: "sf",
  interests: [],
  theme: "system",
  density: "comfortable",
  emailNotifications: false,
  eventReminders: true,
  publicAttendance: false,
};
export const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);
export const nullableIso = (value: unknown): string | null =>
  value == null ? null : iso(value);
export function memberFromRow(row: Record<string, unknown>): Member {
  const verificationType = row.verification_type as VerificationType;
  const expires = nullableIso(row.verification_expires_at);
  const status = row.status as Member["status"];
  return {
    id: String(row.id),
    xId: String(row.x_id),
    name: String(row.name),
    handle: String(row.handle),
    avatarUrl: highResolutionAvatar(
      row.avatar_url ? String(row.avatar_url) : null,
    ),
    bio: String(row.bio ?? ""),
    website: String(row.website ?? ""),
    location: String(row.location ?? ""),
    followersCount: Number(row.followers_count ?? 0),
    followingCount: Number(row.following_count ?? 0),
    verificationType,
    verificationCheckedAt: nullableIso(row.verification_checked_at),
    verificationExpiresAt: expires,
    eligible:
      !row.is_bot &&
      status === "active" &&
      !!row.admitted_at &&
      (verificationType === "blue" || verificationType === "business") &&
      !!expires &&
      new Date(expires).getTime() > Date.now(),
    isAdmin: Boolean(row.is_admin),
    isBot: Boolean(row.is_bot),
    admittedAt: nullableIso(row.admitted_at),
    onboardingCompletedAt: nullableIso(row.onboarding_completed_at),
    status,
    preferences: {
      ...defaultPreferences,
      ...((row.preferences as Partial<Preferences>) ?? {}),
    },
    invitesRemaining: Math.max(
      0,
      Number(row.invite_quota ?? 3) - Number(row.invites_issued ?? 0),
    ),
    createdAt: iso(row.created_at),
  };
}
export function publicMember(member: Member): PublicMember {
  return {
    id: member.id,
    name: member.name,
    handle: member.handle,
    avatarUrl: member.avatarUrl,
    bio: member.bio,
    location: member.location,
    followersCount: member.followersCount,
    verificationType: member.verificationType,
    isBot: member.isBot,
  };
}
export async function getMemberById(id: string): Promise<Member | null> {
  await ensureDatabase();
  const [row] = await sql`SELECT * FROM users WHERE id=${id}`;
  return row ? memberFromRow(row) : null;
}
export async function getMemberByXId(xId: string): Promise<Member | null> {
  await ensureDatabase();
  const [row] = await sql`SELECT * FROM users WHERE x_id=${xId}`;
  return row ? memberFromRow(row) : null;
}
export type XProfileUpdate = {
  name: string;
  handle: string;
  avatarUrl?: string | null;
  bio?: string;
  website?: string;
  location?: string;
  followersCount?: number;
  followingCount?: number;
  verificationType: VerificationType;
};
export async function updateXProfile(
  id: string,
  profile: XProfileUpdate,
): Promise<Member | null> {
  await ensureDatabase();
  const eligible =
    profile.verificationType === "blue" ||
    profile.verificationType === "business";
  const [row] =
    await sql`UPDATE users SET name=${profile.name},handle=${profile.handle},avatar_url=${profile.avatarUrl ?? null},
    bio=${profile.bio ?? ""},website=${profile.website ?? ""},location=${profile.location ?? ""},
    followers_count=${profile.followersCount ?? 0},following_count=${profile.followingCount ?? 0},
    verification_type=${profile.verificationType},verification_checked_at=now(),
    verification_expires_at=${eligible ? new Date(Date.now() + 86400000) : null}
    WHERE id=${id} AND status='active' AND admitted_at IS NOT NULL RETURNING *`;
  return row ? memberFromRow(row) : null;
}
