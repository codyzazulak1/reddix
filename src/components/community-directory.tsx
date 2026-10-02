"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";
import {
  COMMUNITY_CATEGORIES,
  communityMatchesSearch,
  getCommunityMetadata,
} from "@/lib/community-catalog";
import type { Community } from "@/lib/types";
import { cn, compactNumber } from "@/lib/utils";
import type { Action, Navigate } from "./discussions";
import { CommunityIcon } from "./ui";
import "./community-directory.css";

export function CommunitySearchResults({
  communities,
  onNavigate,
}: {
  communities: Community[];
  onNavigate: Navigate;
}) {
  return (
    <section
      className="community-search-results"
      aria-label="Community search results"
    >
      <h2>Communities</h2>
      <div>
        {communities.map((community) => (
          <a
            key={community.id}
            href={`/s/${community.slug}`}
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              onNavigate(`/s/${community.slug}`);
            }}
          >
            <CommunityIcon
              slug={community.slug}
              name={community.name}
              icon={community.icon}
            />
            <span>
              <strong>{community.name}</strong>
              <span>s/{community.slug}</span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

export default function CommunityDirectory({
  communities,
  onNavigate,
  onAction,
  onSuggest,
  isAdmin = false,
}: {
  communities: Community[];
  onNavigate: Navigate;
  onAction: Action;
  onSuggest: () => void;
  isAdmin?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const pendingIds = useRef(new Set<string>());
  const searchRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(
    () =>
      communities
        .filter((community) => !community.archived)
        .map((community) => {
          const metadata = getCommunityMetadata(community.slug);
          return {
            community,
            category: metadata?.category ?? "other",
            featured: metadata?.featured ?? false,
          };
        })
        .sort(
          (a, b) =>
            Number(b.featured) - Number(a.featured) ||
            a.community.name.localeCompare(b.community.name),
        ),
    [communities],
  );

  const matchingSearch = entries.filter((entry) =>
    communityMatchesSearch(entry.community, query),
  );
  const visible = matchingSearch.filter(
    (entry) => category === "all" || entry.category === category,
  );
  const categories = [
    { id: "all", label: "All" },
    ...COMMUNITY_CATEGORIES,
    ...(entries.some((entry) => entry.category === "other")
      ? [{ id: "other", label: "Other" }]
      : []),
  ];
  const categoryLabel = categories.find((item) => item.id === category)?.label;

  async function toggleFollow(community: Community) {
    if (pendingIds.current.has(community.id)) return;
    pendingIds.current.add(community.id);
    setBusyIds(new Set(pendingIds.current));
    try {
      await onAction("follow", {
        communityId: community.id,
        following: !community.isFollowing,
      });
    } catch {
      // The shared action handler presents API errors to the member.
    } finally {
      pendingIds.current.delete(community.id);
      setBusyIds(new Set(pendingIds.current));
    }
  }

  function resetFilters() {
    setQuery("");
    setCategory("all");
    searchRef.current?.focus();
  }

  return (
    <section className="topic-directory" aria-labelledby="communities-title">
      <div className="page-title">
        <h1 id="communities-title">Communities</h1>
        <p>Find your people, follow your interests.</p>
      </div>

      <div className="topic-directory-search" role="search">
        <Search size={18} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          aria-label="Search communities"
          placeholder="Search companies, topics, or cities"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button
            className="icon-button"
            aria-label="Clear community search"
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      <div
        className="topic-directory-categories"
        role="group"
        aria-label="Community categories"
      >
        {categories.map((item) => (
          <button
            key={item.id}
            aria-pressed={category === item.id}
            onClick={() => setCategory(item.id)}
          >
            {item.label}
            <span aria-hidden="true">
              {item.id === "all"
                ? matchingSearch.length
                : matchingSearch.filter((entry) => entry.category === item.id)
                    .length}
            </span>
          </button>
        ))}
      </div>

      <p className="topic-directory-count" role="status" aria-live="polite">
        {visible.length} {visible.length === 1 ? "community" : "communities"}
        {category !== "all" && ` in ${categoryLabel}`}
      </p>

      {visible.length ? (
        <div className="topic-directory-grid">
          {visible.map(({ community }) => (
            <article
              className="topic-directory-card"
              key={community.id}
              aria-label={community.name}
            >
              <a
                className="topic-directory-link"
                href={`/s/${community.slug}`}
                onClick={(event) => {
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  event.preventDefault();
                  onNavigate(`/s/${community.slug}`);
                }}
              >
                <CommunityIcon
                  slug={community.slug}
                  name={community.name}
                  icon={community.icon}
                  large
                />
                <div>
                  <h2>{community.name}</h2>
                  <span className="topic-directory-slug">
                    s/{community.slug}
                  </span>
                </div>
              </a>
              <p className="topic-directory-description">
                {community.description}
              </p>
              <div className="topic-directory-card-footer">
                <span>
                  {compactNumber(community.membersCount)}{" "}
                  {community.membersCount === 1 ? "member" : "members"}
                </span>
                <button
                  className={cn(
                    "button small",
                    community.isFollowing ? "secondary" : "primary",
                  )}
                  aria-label={`${community.isFollowing ? "Leave" : "Join"} ${community.name}`}
                  aria-pressed={community.isFollowing}
                  aria-busy={busyIds.has(community.id)}
                  disabled={busyIds.has(community.id)}
                  onClick={() => void toggleFollow(community)}
                >
                  {community.isFollowing ? (
                    <Check size={13} aria-hidden="true" />
                  ) : (
                    <Plus size={13} aria-hidden="true" />
                  )}
                  {community.isFollowing ? "Joined" : "Join"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="topic-directory-empty">
          <h2>No communities found</h2>
          <p>Try a different search or explore another category.</p>
          <button className="button secondary" onClick={resetFilters}>
            Reset filters
          </button>
        </div>
      )}

      <div className="topic-directory-suggest">
        <p>Something missing?</p>
        <button className="button secondary small" onClick={onSuggest}>
          {isAdmin ? "Create a subreddix" : "Suggest a community"}
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
