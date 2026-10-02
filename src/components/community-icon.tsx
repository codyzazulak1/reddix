"use client";

import { useState } from "react";
import {
  Asterisk,
  Bot,
  Boxes,
  BrainCircuit,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CalendarRange,
  ChartNoAxesCombined,
  Code2,
  Coins,
  GitFork,
  Hammer,
  Leaf,
  Mountain,
  Rocket,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
  Utensils,
  Workflow,
  Zap,
} from "lucide-react";
import { getCommunityIdentity } from "@/lib/community-identities";
import { cn } from "@/lib/utils";
import "./community-icon.css";

const glyphs: Record<string, typeof Building2> = {
  asterisk: Asterisk,
  bot: Bot,
  boxes: Boxes,
  brain: BrainCircuit,
  briefcase: BriefcaseBusiness,
  building: Building2,
  calendar: CalendarDays,
  "calendar-range": CalendarRange,
  chart: ChartNoAxesCombined,
  code: Code2,
  coins: Coins,
  "git-fork": GitFork,
  hammer: Hammer,
  maple: Leaf,
  mountain: Mountain,
  rocket: Rocket,
  shield: ShieldCheck,
  sparkles: Sparkles,
  sun: Sun,
  terminal: Terminal,
  utensils: Utensils,
  workflow: Workflow,
  zap: Zap,
};

export function CommunityIcon({
  slug,
  name,
  icon,
  large = false,
}: {
  slug: string;
  name: string;
  icon: string;
  large?: boolean;
}) {
  const identity = getCommunityIdentity(slug);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const image = identity?.src;
  const glyph = identity?.glyph ?? icon;
  const Icon = glyphs[glyph];
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "R";

  return (
    <span
      className={cn("community-icon", "community-identity", large && "large")}
      data-icon={icon}
      data-community={slug}
      style={
        identity
          ? { backgroundColor: identity.background, color: identity.foreground }
          : undefined
      }
      aria-hidden="true"
    >
      {image && failedSource !== image ? (
        <img
          className={cn(
            "community-logo-image",
            identity?.fullBleed && "community-logo-full",
          )}
          src={image}
          alt=""
          width={40}
          height={40}
          decoding="async"
          onError={() => setFailedSource(image)}
        />
      ) : glyph === "bridge" ? (
        <svg
          className="community-glyph"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          focusable="false"
        >
          <path d="M6 4v16M18 4v16M2 16h20M2 12Q4 11 6 6Q12 17 18 6Q20 11 22 12M10 12v4M14 12v4" />
        </svg>
      ) : Icon ? (
        <Icon className="community-glyph" strokeWidth={1.7} />
      ) : (
        <span className="community-monogram">{initials}</span>
      )}
    </span>
  );
}
