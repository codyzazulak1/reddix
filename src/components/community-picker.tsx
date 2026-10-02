"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { communityMatchesSearch } from "@/lib/community-catalog";
import type { Community } from "@/lib/types";
import { CommunityIcon } from "./community-icon";
import styles from "./community-picker.module.css";

export function CommunityPicker({
  communities,
  value,
  onChange,
  open,
  onOpenChange,
}: {
  communities: Community[];
  value: string;
  onChange: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const search = query.trim().replace(/^s\//i, "");
  const available = communities
    .filter((community) => !community.archived)
    .sort(
      (a, b) => b.membersCount - a.membersCount || a.name.localeCompare(b.name),
    );
  const selected = available.find((community) => community.id === value);
  const followed = available.filter((community) => community.isFollowing);
  const rank = (community: Community) => {
    const term = search.toLowerCase();
    const names = [community.name.toLowerCase(), community.slug.toLowerCase()];
    return names.includes(term)
      ? 0
      : names.some((name) => name.startsWith(term))
        ? 1
        : 2;
  };
  const groups = search
    ? [
        {
          label: "Search results",
          communities: available
            .filter((community) => communityMatchesSearch(community, search))
            .sort(
              (a, b) =>
                rank(a) - rank(b) ||
                Number(b.isFollowing) - Number(a.isFollowing) ||
                a.name.localeCompare(b.name),
            ),
        },
      ]
    : [
        { label: "Your communities", communities: followed.slice(0, 5) },
        {
          label: "Popular communities",
          communities: available
            .filter((community) => !community.isFollowing)
            .slice(0, followed.length ? 3 : 5),
        },
      ].filter((group) => group.communities.length);
  const options = groups.flatMap((group) => group.communities);
  const active =
    options.find((community) => community.id === activeId) ?? options[0];

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function dismiss(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open || !active) return;
    const option = document.getElementById(`${id}-option-${active.id}`);
    const list = listRef.current;
    if (!option || !list) return;
    const optionRect = option.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (optionRect.top < listRect.top)
      list.scrollTop -= listRect.top - optionRect.top;
    else if (optionRect.bottom > listRect.bottom)
      list.scrollTop += optionRect.bottom - listRect.bottom;
  }, [active?.id, open, id]);

  function show() {
    setQuery("");
    setActiveId(value);
    onOpenChange(true);
  }

  function close() {
    onOpenChange(false);
    triggerRef.current?.focus();
  }

  function select(community: Community) {
    onChange(community.id);
    close();
  }

  return (
    <div
      ref={rootRef}
      className={styles.picker}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          // Let the next field receive focus before removing the search input
          // so the dialog's focus trap does not move focus back to its root.
          requestAnimationFrame(() => {
            if (
              rootRef.current &&
              !rootRef.current.contains(document.activeElement)
            )
              onOpenChange(false);
          });
        }
      }}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <label className={styles.label} htmlFor={`${id}-trigger`}>
        Choose a subreddix
      </label>
      <button
        ref={triggerRef}
        id={`${id}-trigger`}
        className={styles.trigger}
        type="button"
        aria-label="Choose a subreddix"
        aria-describedby={`${id}-selection`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          }
        }}
      >
        {selected ? (
          <CommunityIcon
            slug={selected.slug}
            name={selected.name}
            icon={selected.icon}
          />
        ) : (
          <Search size={20} aria-hidden="true" />
        )}
        <span id={`${id}-selection`} className={styles.identity}>
          <strong>{selected?.name ?? "Find your community"}</strong>
          <span>
            {selected ? `s/${selected.slug}` : "Search by name or topic"}
          </span>
        </span>
        <ChevronDown className={styles.chevron} size={17} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.popup}>
          <div className={styles.search}>
            <Search size={17} aria-hidden="true" />
            <input
              ref={searchRef}
              className={styles.searchInput}
              role="combobox"
              aria-label="Search communities"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-activedescendant={
                active ? `${id}-option-${active.id}` : undefined
              }
              autoComplete="off"
              spellCheck={false}
              placeholder="Search communities…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveId(null);
                if (listRef.current) listRef.current.scrollTop = 0;
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  if (!options.length) return;
                  const index = options.findIndex(
                    (community) => community.id === active?.id,
                  );
                  const next =
                    (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      options.length) %
                    options.length;
                  setActiveId(options[next].id);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (active) select(active);
                }
              }}
            />
            {query && (
              <button
                type="button"
                className={styles.clear}
                aria-label="Clear community search"
                onClick={() => {
                  setQuery("");
                  setActiveId(null);
                  searchRef.current?.focus();
                }}
              >
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </div>
          <div
            ref={listRef}
            className={styles.list}
            id={`${id}-list`}
            role="listbox"
            tabIndex={-1}
            aria-label="Communities"
          >
            {groups.map((group, index) => (
              <div
                key={group.label}
                role="group"
                aria-labelledby={`${id}-group-${index}`}
              >
                <div className={styles.groupLabel} id={`${id}-group-${index}`}>
                  {group.label}
                </div>
                {group.communities.map((community) => (
                  <button
                    key={community.id}
                    id={`${id}-option-${community.id}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    className={styles.option}
                    aria-label={`${community.name}, s/${community.slug}`}
                    aria-selected={community.id === value}
                    data-active={community.id === active?.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onPointerMove={() => setActiveId(community.id)}
                    onClick={() => select(community)}
                  >
                    <CommunityIcon
                      slug={community.slug}
                      name={community.name}
                      icon={community.icon}
                    />
                    <span className={styles.identity}>
                      <strong>{community.name}</strong>
                      <span>s/{community.slug}</span>
                    </span>
                    {community.id === value ? (
                      <Check
                        className={styles.check}
                        size={17}
                        aria-hidden="true"
                      />
                    ) : community.isFollowing && search ? (
                      <span className={styles.joined}>Joined</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {!options.length && (
            <div className={styles.empty} role="status">
              <Search size={22} aria-hidden="true" />
              <strong>No communities found</strong>
              <span>Try a different name or topic.</span>
            </div>
          )}
          <div className={styles.hint} aria-live="polite">
            {search
              ? `${options.length} ${options.length === 1 ? "community" : "communities"} found`
              : "Search to find any community"}
          </div>
        </div>
      )}
    </div>
  );
}
