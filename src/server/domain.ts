import type { Member, Post } from "@/lib/types";

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function requireAdmitted(
  member: Member | null,
): asserts member is Member {
  if (!member)
    throw new DomainError("AUTH_REQUIRED", "Sign in with X to continue.", 401);
  if (!member.admittedAt)
    throw new DomainError(
      "ADMISSION_REQUIRED",
      "Sign up with a verified X account to join Reddix.",
      403,
    );
  if (member.status !== "active")
    throw new DomainError(
      "ACCOUNT_SUSPENDED",
      "This account cannot access the community. Contact support for help.",
      403,
    );
}
export function requireOnboarded(member: Member) {
  requireAdmitted(member);
  if (!member.onboardingCompletedAt)
    throw new DomainError(
      "ONBOARDING_REQUIRED",
      "Finish setting up your Reddix account first.",
      403,
    );
}
export function isFreshEligible(member: Member, now = Date.now()): boolean {
  return (
    !member.isBot &&
    member.status === "active" &&
    !!member.admittedAt &&
    ["blue", "business"].includes(member.verificationType) &&
    !!member.verificationExpiresAt &&
    new Date(member.verificationExpiresAt).getTime() > now
  );
}
export function requireEligible(member: Member) {
  requireOnboarded(member);
  if (!isFreshEligible(member))
    throw new DomainError(
      "VERIFICATION_REQUIRED",
      "A current blue or gold X verification is required. Resync your X account to check your status.",
      403,
    );
}
export function requireAdmin(member: Member) {
  requireOnboarded(member);
  if (!member.isAdmin)
    throw new DomainError(
      "FORBIDDEN",
      "This action is available to platform administrators.",
      403,
    );
}
export function popular24Hours(posts: Post[], now = Date.now()): Post[] {
  return posts
    .filter(
      (post) =>
        post.status === "published" &&
        new Date(post.createdAt).getTime() >= now - 86400000 &&
        new Date(post.createdAt).getTime() <= now,
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.id.localeCompare(a.id),
    );
}
export function safeHttpsUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Enter a complete HTTPS link.",
      422,
    );
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new DomainError(
      "VALIDATION_ERROR",
      "Links must use HTTPS and cannot contain credentials.",
      422,
    );
  return url.toString();
}
export function rsvpDecision(input: {
  full: boolean;
  approvalRequired: boolean;
  approved: boolean;
  waitlistEnabled: boolean;
}): "going" | "pending_approval" | "waitlisted" {
  if (input.approvalRequired && !input.approved) return "pending_approval";
  if (!input.full) return "going";
  if (input.waitlistEnabled) return "waitlisted";
  throw new DomainError(
    "EVENT_FULL",
    "This event is full and does not have a waitlist.",
    409,
  );
}
