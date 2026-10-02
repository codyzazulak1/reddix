"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Post } from "./types";

type FeedPage = { posts: Post[]; nextCursor: string | null };
type CachedFeed = FeedPage & { loadedAt: number };
const FRESH_FOR = 30_000;
const CACHE_LIMIT = 12;

/** Session-local only: never persist private feed contents to browser storage. */
export function useFeed({
  enabled,
  memberId,
  query,
  generation,
}: {
  enabled: boolean;
  memberId: string;
  query: string;
  generation: number;
}) {
  const cache = useRef(new Map<string, CachedFeed>());
  const owner = useRef(memberId);
  const request = useRef<AbortController | null>(null);
  const paging = useRef(false);
  const pending = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const key = `${memberId}:${query}`;
  const identity = `${key}:${generation}:${attempt}`;
  const [result, setResult] = useState<{
    identity: string;
    page?: FeedPage;
    error?: string;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const remember = useCallback((cacheKey: string, page: CachedFeed) => {
    cache.current.delete(cacheKey);
    cache.current.set(cacheKey, page);
    if (cache.current.size > CACHE_LIMIT)
      cache.current.delete(cache.current.keys().next().value!);
  }, []);
  const invalidate = useCallback(() => {
    cache.current.clear();
    // A response started before a mutation must not overwrite its fresh rows.
    if (pending.current || paging.current) {
      request.current?.abort();
      pending.current = false;
      paging.current = false;
      setAttempt((value) => value + 1);
    }
  }, []);
  const updatePosts = useCallback((posts: Post[]) => {
    const fresh = new Map(posts.map((post) => [post.id, post]));
    setResult((previous) =>
      previous?.page
        ? {
            ...previous,
            page: {
              ...previous.page,
              posts: previous.page.posts.map(
                (post) => fresh.get(post.id) || post,
              ),
            },
          }
        : previous,
    );
  }, []);

  useEffect(() => {
    if (owner.current !== memberId) {
      cache.current.clear();
      owner.current = memberId;
      setResult(null);
    }
    paging.current = false;
    pending.current = false;
    setLoadingMore(false);
    if (!enabled) return;

    const controller = new AbortController();
    request.current = controller;
    const cached = cache.current.get(key);
    if (cached && Date.now() - cached.loadedAt < FRESH_FOR) {
      setResult({ identity, page: cached });
    } else {
      pending.current = true;
      setResult({ identity });
      fetch(`/api/feed?${query}`, { signal: controller.signal })
        .then(async (response) => {
          const page = await response.json();
          if (!response.ok)
            throw new Error(
              page.error?.message || "Feed unavailable. Please try again.",
            );
          if (controller.signal.aborted) return;
          pending.current = false;
          remember(key, { ...page, loadedAt: Date.now() });
          setResult({ identity, page });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            pending.current = false;
            setResult({
              identity,
              error:
                error instanceof Error
                  ? error.message
                  : "Feed unavailable. Please try again.",
            });
          }
        });
    }
    return () => controller.abort();
  }, [enabled, memberId, key, identity, query, remember]);

  const current = enabled && result?.identity === identity ? result : null;
  const more = async () => {
    const page = current?.page;
    const controller = request.current;
    if (
      !page?.nextCursor ||
      !controller ||
      controller.signal.aborted ||
      paging.current
    )
      return;
    paging.current = true;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/feed?cursor=${encodeURIComponent(page.nextCursor)}`,
        { signal: controller.signal },
      );
      const next = await response.json();
      if (!response.ok)
        throw new Error(
          next.error?.message ||
            "This feed expired. Refresh to keep exploring.",
        );
      if (controller.signal.aborted) return;
      const existing = new Set(page.posts.map((post) => post.id));
      const combined: FeedPage = {
        posts: [
          ...page.posts,
          ...next.posts.filter((post: Post) => !existing.has(post.id)),
        ],
        nextCursor: next.nextCursor,
      };
      // Keep the original freshness deadline even when loading additional pages.
      remember(key, {
        ...combined,
        loadedAt: cache.current.get(key)?.loadedAt ?? Date.now(),
      });
      setResult({ identity, page: combined });
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      if (!controller.signal.aborted) {
        paging.current = false;
        setLoadingMore(false);
      }
    }
  };

  return {
    rows: current?.page?.posts ?? null,
    cursor: current?.page?.nextCursor ?? null,
    loading: enabled && ((!current?.page && !current?.error) || loadingMore),
    error: current?.error,
    more,
    invalidate,
    updatePosts,
    retry: () => {
      cache.current.delete(key);
      setAttempt((value) => value + 1);
    },
  };
}
