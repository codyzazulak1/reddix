import { aiCommunityAssets } from "./community-assets/ai";
import { toolCommunityAssets } from "./community-assets/tools";
import { frontierCommunityAssets } from "./community-assets/frontier";

export type CommunityIdentity = {
  src?: string;
  glyph?: string;
  fullBleed?: boolean;
  background: string;
  foreground: string;
};

// Stable slugs connect an identity to every existing and newly seeded community.
// Brand assets are local; topic and city identities use the shared icon family.
export const COMMUNITY_IDENTITIES: Readonly<Record<string, CommunityIdentity>> =
  {
    ...aiCommunityAssets,
    ...toolCommunityAssets,
    ...frontierCommunityAssets,
    sf: { glyph: "bridge", background: "#213F4B", foreground: "#B9E9EA" },
    "sf-restaurants": {
      glyph: "utensils",
      background: "#5A362B",
      foreground: "#FFD6B3",
    },
    "sf-tech-week": {
      glyph: "calendar-range",
      background: "#42335E",
      foreground: "#E3C8FF",
    },
    "sf-events": {
      glyph: "calendar",
      background: "#213F4B",
      foreground: "#B9E9EA",
    },
    "new-york": {
      glyph: "building",
      background: "#293B62",
      foreground: "#D0DEFF",
    },
    "ny-events": {
      glyph: "calendar",
      background: "#293B62",
      foreground: "#D0DEFF",
    },
    toronto: { glyph: "maple", background: "#61353A", foreground: "#FFD5D5" },
    "toronto-events": {
      glyph: "calendar",
      background: "#61353A",
      foreground: "#FFD5D5",
    },
    seattle: {
      glyph: "mountain",
      background: "#274B40",
      foreground: "#C5EDCE",
    },
    "seattle-events": {
      glyph: "calendar",
      background: "#274B40",
      foreground: "#C5EDCE",
    },
    "los-angeles": {
      glyph: "sun",
      background: "#5D452B",
      foreground: "#FFE0A8",
    },
    "la-events": {
      glyph: "calendar",
      background: "#5D452B",
      foreground: "#FFE0A8",
    },
    startups: { glyph: "rocket", background: "#633B2C", foreground: "#FFD5B0" },
    ai: { glyph: "brain", background: "#403361", foreground: "#E4D3FF" },
    engineering: {
      glyph: "terminal",
      background: "#263C50",
      foreground: "#BFE3FF",
    },
    "open-source": {
      glyph: "git-fork",
      background: "#27463B",
      foreground: "#C8EFCF",
    },
    fundraising: {
      glyph: "chart",
      background: "#4E442B",
      foreground: "#FCE4A4",
    },
    careers: {
      glyph: "briefcase",
      background: "#303F64",
      foreground: "#D1DDFF",
    },
    "build-in-public": {
      glyph: "hammer",
      background: "#234B4C",
      foreground: "#BEF0E9",
    },
    "ai-agents": {
      glyph: "workflow",
      background: "#32386B",
      foreground: "#D5D9FF",
    },
    "open-models": {
      glyph: "boxes",
      background: "#4D355B",
      foreground: "#F0D5FF",
    },
    robotics: { glyph: "bot", background: "#294A51", foreground: "#BFEFF1" },
    "ai-safety": {
      glyph: "shield",
      background: "#29463B",
      foreground: "#D0EFDA",
    },
    stablecoins: {
      glyph: "coins",
      background: "#54462B",
      foreground: "#FFE6A7",
    },
  };

export function getCommunityIdentity(
  slug: string,
): CommunityIdentity | undefined {
  return Object.hasOwn(COMMUNITY_IDENTITIES, slug)
    ? COMMUNITY_IDENTITIES[slug]
    : undefined;
}
