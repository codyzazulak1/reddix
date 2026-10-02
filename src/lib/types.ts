export type VerificationType =
  "blue" | "business" | "government" | "none" | "unknown";
export type Preferences = {
  city: string;
  interests: string[];
  theme: "light" | "dark" | "system";
  density: "comfortable" | "compact";
  emailNotifications: boolean;
  eventReminders: boolean;
  publicAttendance: boolean;
  xPromotionOptOut?: boolean;
};
export type Member = {
  id: string;
  xId: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  bio: string;
  website: string;
  location: string;
  followersCount: number;
  followingCount: number;
  verificationType: VerificationType;
  verificationCheckedAt: string | null;
  verificationExpiresAt: string | null;
  eligible: boolean;
  isAdmin: boolean;
  isBot?: boolean;
  admittedAt: string | null;
  onboardingCompletedAt: string | null;
  status: "active" | "suspended" | "deleted";
  preferences: Preferences;
  invitesRemaining: number;
  createdAt: string;
};
export type PublicMember = Pick<
  Member,
  | "id"
  | "name"
  | "handle"
  | "avatarUrl"
  | "bio"
  | "location"
  | "followersCount"
  | "verificationType"
  | "isBot"
>;
export type Community = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  city: string | null;
  membersCount: number;
  isFollowing: boolean;
  archived: boolean;
  xAccount?: { handle: string; url: string; affiliatesUrl: string };
  leaders?: { id: string; name: string; handle: string }[];
};
export type ModerationNotice = {
  botId: string;
  category: string;
  message: string;
};
export type Post = {
  id: string;
  communityId: string;
  communitySlug: string;
  communityName: string;
  authorIsLeader?: boolean;
  promoteOnX?: boolean;
  author: PublicMember;
  title: string;
  body: string;
  type: "text" | "link" | "image";
  url: string | null;
  imageUrl: string | null;
  score: number;
  commentCount: number;
  myVote: -1 | 0 | 1;
  isSaved: boolean;
  isPinned: boolean;
  locked: boolean;
  status: "published" | "removed" | "deleted";
  moderation?: ModerationNotice;
  createdAt: string;
  updatedAt: string;
  tags: string[];
};
export type Comment = {
  id: string;
  authorIsLeader?: boolean;
  postId: string;
  parentId: string | null;
  author: PublicMember;
  body: string;
  depth: number;
  score: number;
  myVote: -1 | 0 | 1;
  status: "published" | "removed" | "deleted";
  moderation?: ModerationNotice;
  createdAt: string;
  updatedAt: string;
};
export type RsvpStatus =
  | "none"
  | "pending_approval"
  | "going"
  | "waitlisted"
  | "declined"
  | "canceled"
  | "interested";
export type ReddixEvent = {
  id: string;
  title: string;
  description: string;
  host: PublicMember;
  source: "native" | "external";
  externalUrl: string | null;
  sourceLabel: string | null;
  city: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  venueDisclosure: "all" | "attendees" | "later";
  exactAddress: string | null;
  format: "in_person" | "online";
  visibility: "listed" | "unlisted" | "invited";
  status: "published" | "canceled";
  capacity: number | null;
  requiresApproval: boolean;
  waitlistEnabled: boolean;
  goingCount: number;
  interestedCount: number;
  myRsvp: RsvpStatus;
  registrationClosed: boolean;
  isSaved: boolean;
  coverStyle: string;
  communityId: string | null;
  tags: string[];
  createdAt: string;
  revision: number;
};
export type AppNotification = {
  id: string;
  type: string;
  message: string;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
};
export type Reputation = {
  posts: number;
  comments: number;
  total: number;
};
export type Bootstrap = {
  member: Member;
  reputation: Reputation;
  communities: Community[];
  posts: Post[];
  events: ReddixEvent[];
  notifications: AppNotification[];
  members: PublicMember[];
  stats: { members: number; discussions: number; events: number };
  demo: boolean;
  generatedAt: string;
};
export type ApiError = {
  error: { code: string; message: string; requestId?: string };
};
