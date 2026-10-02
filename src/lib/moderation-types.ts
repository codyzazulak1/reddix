export const MODERATION_CATEGORIES = [
  "none",
  "spam",
  "scam",
  "harassment",
  "hate",
  "threats",
  "privacy",
  "sexual_content",
  "off_topic",
  "other",
] as const;

export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];
export type ModerationMode = "off" | "review" | "auto";

export interface ModerationInput {
  targetType: "post" | "comment";
  title: string;
  body: string;
  community: string;
  rules: string;
  context: Array<{ role: "post" | "parent"; text: string }>;
  hasImage: boolean;
  reported: boolean;
}

export interface ModerationDecision {
  verdict: "allow" | "review" | "remove";
  category: ModerationCategory;
  confidence: number;
  reason: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

/** This object may be exposed to admins. Never add an API key or key fragment. */
export interface ModerationConfig {
  configured: boolean;
  mode: ModerationMode;
  model: string;
  dailyLimit: number;
  maxInputUsdPerMillion: number;
  maxOutputUsdPerMillion: number;
}
