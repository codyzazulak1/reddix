"use client";
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Bookmark,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Compass,
  Flame,
  LayoutGrid,
  ChevronLeft,
  Loader2,
  Menu,
  MessageSquare,
  Plus,
  Search,
  ShieldCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import type { Bootstrap, Community, Member, Post } from "@/lib/types";
import { useFeed } from "@/lib/use-feed";
import { getCommunityMetadata } from "@/lib/community-catalog";
import { cn, compactNumber, timeAgo } from "@/lib/utils";
import Gate, { type AuthStatus } from "./gate";
import { Avatar, Badge, CommunityIcon, Empty, Logo, Modal } from "./ui";
import { ComposePost, PostCard, PostDetail, type Action } from "./discussions";
import CommunityBanner from "./community-banner";
import { AccountControls } from "./account-controls";
import { ReputationIndicator } from "./reputation";
import {
  AppSkeleton,
  FeedSkeleton,
  PageSkeleton,
  ProfileSkeleton,
  ChatSkeleton,
  QuickChatSkeleton,
} from "./loading-skeletons";
import { useChatSession } from "./chat/ChatSession";
import FeedViewMenu from "./feed-view-menu";
const AdminView = dynamic(
  () => import("./account").then((module) => module.AdminView),
  {
    loading: () => <PageSkeleton label="Loading admin workspace" />,
  },
);
const LegalPage = dynamic(
  () => import("./account").then((module) => module.LegalPage),
  {
    loading: () => <PageSkeleton />,
  },
);
const Onboarding = dynamic(
  () => import("./account").then((module) => module.Onboarding),
  {
    loading: () => <PageSkeleton />,
  },
);
const SettingsView = dynamic(
  () => import("./account").then((module) => module.SettingsView),
  {
    loading: () => <PageSkeleton label="Loading settings" />,
  },
);
const Profile = dynamic(() => import("./profile"), {
  loading: () => <ProfileSkeleton />,
});
const EventsView = dynamic(() => import("./events/EventsView"), {
  loading: () => <PageSkeleton label="Loading events" />,
});
const ChatRoute = dynamic(() => import("./chat-route"), {
  loading: () => <ChatSkeleton />,
});
const QuickChat = dynamic(() => import("./chat/QuickChat"), {
  loading: () => <QuickChatSkeleton />,
});
const CommunityDirectory = dynamic(() => import("./community-directory"), {
  loading: () => <PageSkeleton label="Loading communities" />,
});
const CommunitySearchResults = dynamic(
  () =>
    import("./community-directory").then(
      (module) => module.CommunitySearchResults,
    ),
  {
    loading: () => <PageSkeleton label="Loading communities" />,
  },
);

const cityFilters = [
  "Everywhere",
  "San Francisco",
  "New York",
  "Toronto",
  "Seattle",
  "Los Angeles",
];
const citySlugs: Record<string, string> = {
  "San Francisco": "sf",
  "New York": "new-york",
  Toronto: "toronto",
  Seattle: "seattle",
  "Los Angeles": "los-angeles",
};
const publicPages = ["terms", "privacy", "support", "community-guidelines"];

export default function ReddixApp() {
  return (
    <Suspense fallback={<AppSkeleton />}>
      <ReddixAppContent />
    </Suspense>
  );
}

function ReddixAppContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("q") ?? "";
  const [data, setData] = useState<Bootstrap | null>(null);
  const [restrictedMember, setRestrictedMember] = useState<Member | null>(null);
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const refreshSequence = useRef(0);
  const lastRefreshAt = useRef(0);
  const revalidating = useRef(false);
  const [compose, setCompose] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const {
    state: chatSession,
    update: updateChatSession,
    clear: clearChatSession,
  } = useChatSession(data?.member.id || "");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    try {
      setSidebarCollapsed(
        localStorage.getItem("reddix-sidebar-collapsed") === "true",
      );
    } catch {}
  }, []);
  function toggleSidebar() {
    setSidebarCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem("reddix-sidebar-collapsed", String(next));
      } catch {}
      return next;
    });
  }
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const sidebar = document.getElementById("primary-sidebar");
    const focusable = () =>
      Array.from(
        sidebar?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], [tabindex='0']",
        ) || [],
      ).filter((node) => node.offsetParent !== null);
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const onResize = () => {
      if (window.innerWidth > 960) setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      previous?.focus();
    };
  }, [mobileOpen]);
  const [query, setQuery] = useState(searchQuery);
  const [city, setCity] = useState("Everywhere");
  const [sort, setSort] = useState("popular");
  const [suggest, setSuggest] = useState(false);
  const [suggestName, setSuggestName] = useState("");
  const [suggestDescription, setSuggestDescription] = useState("");
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [feedGeneration, setFeedGeneration] = useState(0);
  const [searchPosts, setSearchPosts] = useState<Post[] | null>(null);
  const [searchCommunities, setSearchCommunities] = useState<Community[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [pageCount, setPageCount] = useState(10);
  const pathParts = pathname.split("/").filter(Boolean);
  const view = pathParts[0] || "popular";
  useEffect(() => {
    if (view === "search") setQuery(searchQuery);
  }, [searchQuery, view]);
  const isPublic = publicPages.includes(view);
  const isFeed = ["popular", "following", "new", "s"].includes(view);
  const isChat = view === "chat";
  const feedSort = view === "new" ? "new" : sort;
  const feedParams = new URLSearchParams({
    sort: feedSort,
    scope: view === "following" ? "following" : "all",
  });
  if (view === "s") feedParams.set("community", pathParts[1]);
  if (city !== "Everywhere" && view !== "s")
    feedParams.set("city", citySlugs[city]);
  const {
    rows: feedRows,
    cursor: feedCursor,
    loading: feedLoading,
    error: feedError,
    more: loadMoreFeed,
    retry: retryFeed,
    invalidate: invalidateFeed,
    updatePosts: updateFeedPosts,
  } = useFeed({
    enabled: !!data?.member.onboardingCompletedAt && isFeed,
    memberId: data?.member.id || "",
    query: feedParams.toString(),
    generation: feedGeneration,
  });

  useEffect(() => {
    if (!data?.member.onboardingCompletedAt || data.member.status !== "active")
      return;
    let last = 0;
    const record = () => {
      if (document.hidden || Date.now() - last < 60_000) return;
      last = Date.now();
      void fetch("/api/activity", { method: "POST" }).catch(() => undefined);
    };
    record();
    document.addEventListener("pointerdown", record, { passive: true });
    document.addEventListener("keydown", record);
    document.addEventListener("visibilitychange", record);
    return () => {
      document.removeEventListener("pointerdown", record);
      document.removeEventListener("keydown", record);
      document.removeEventListener("visibilitychange", record);
    };
  }, [
    data?.member.id,
    data?.member.onboardingCompletedAt,
    data?.member.status,
  ]);
  const quickChatOpen = !isChat && chatSession.mode === "open";
  useEffect(() => {
    if (!loading && !isPublic && !data && !error) clearChatSession();
  }, [loading, isPublic, data, error, clearChatSession]);
  useEffect(() => {
    if (!data?.member.onboardingCompletedAt) {
      setChatUnread(0);
      return;
    }
    if (isChat || quickChatOpen) return; // The open inbox supplies its fresher accepted-message count.
    const controller = new AbortController();
    let active = true;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      if (!active || pending || document.hidden) return;
      pending = true;
      try {
        const response = await fetch("/api/chat?summary=1", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (response.ok) {
          const inbox = await response.json();
          if (active) setChatUnread(Number(inbox.unreadCount) || 0);
        } else if (response.status === 401 || response.status === 403) {
          if (active) setChatUnread(0);
        }
      } catch {
      } finally {
        pending = false;
        if (active && !document.hidden) timer = setTimeout(poll, 15000);
      }
    }
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void poll();
    };
    void poll();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [
    data?.member.id,
    data?.member.onboardingCompletedAt,
    isChat,
    quickChatOpen,
  ]);
  const navigate = useCallback((path: string) => {
    setMobileOpen(false);
    setPageCount(10);
    // All site views use the same client shell and API data. Updating history
    // also updates Next's pathname/search hooks without a redundant RSC trip.
    if (`${window.location.pathname}${window.location.search}` !== path)
      window.history.pushState(null, "", path);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  function openChat() {
    setMobileOpen(false);
    if (isChat) navigate("/chat");
    else updateChatSession({ mode: "open" });
  }
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    lastRefreshAt.current = Date.now();
    const res = await fetch("/api/bootstrap", { cache: "no-store" });
    const json = await res.json();
    if (sequence !== refreshSequence.current) return;
    if (res.status === 401) {
      invalidateFeed();
      clearChatSession();
      setData(null);
      setRestrictedMember(null);
      return;
    }
    if (res.status === 403) {
      invalidateFeed();
      clearChatSession();
      setData(null);
      const account = await fetch("/api/account/status").then((r) => r.json());
      if (sequence !== refreshSequence.current) return;
      setRestrictedMember(account.member || null);
      if (account.member) return;
    }
    if (!res.ok)
      throw new Error(
        json.error?.message || "Reddix could not connect to its database.",
      );
    invalidateFeed();
    setRestrictedMember(null);
    setData(json);
    updateFeedPosts(json.posts || []);
    setError(undefined);
    setRevision((r) => r + 1);
  }, [clearChatSession, invalidateFeed, updateFeedPosts]);
  useEffect(() => {
    if (isPublic || data) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    Promise.all([
      refresh(),
      fetch("/api/auth/status")
        .then((r) => r.json())
        .then((s) => active && setStatus(s)),
    ])
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [refresh, isPublic]);
  useEffect(() => {
    if (!data?.member.id || isPublic) return;
    const revalidate = () => {
      if (
        document.hidden ||
        revalidating.current ||
        Date.now() - lastRefreshAt.current < 60_000
      )
        return;
      revalidating.current = true;
      // Keep the current shell usable while checking for new notifications,
      // events, and account changes after a minute away from fresh data.
      void refresh()
        .catch(() => undefined)
        .finally(() => {
          revalidating.current = false;
        });
    };
    revalidate();
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [data?.member.id, pathname, isPublic, refresh]);
  useEffect(() => {
    if (!data) return;
    const theme = data.member.preferences.theme;
    const light =
      theme === "light" ||
      (theme === "system" &&
        window.matchMedia("(prefers-color-scheme: light)").matches);
    document.documentElement.dataset.theme = light ? "light" : "dark";
  }, [data?.member.preferences.theme]);
  useEffect(() => {
    if (!data || view !== "search") return;
    const controller = new AbortController();
    setSearchPosts(null);
    setSearchCommunities([]);
    setSearchError(null);
    if (query.trim().length < 2) {
      setSearchBusy(false);
      return;
    }
    setSearchBusy(true);
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok)
            throw new Error(
              result.error?.message ||
                "Search could not load. Please try again.",
            );
          return result;
        })
        .then((result) => {
          if (controller.signal.aborted) return;
          setSearchPosts(result.posts || []);
          setSearchCommunities(result.communities || []);
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setSearchError(
              error instanceof Error
                ? error.message
                : "Search could not load. Please try again.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchBusy(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, view, !!data, searchAttempt]);
  async function moreFeed() {
    try {
      await loadMoreFeed();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Feed unavailable");
    }
  }
  useEffect(() => {
    setPageCount(10);
  }, [city, sort, pathname]);
  const action: Action = useCallback(
    async (name, payload = {}) => {
      try {
        const res = await fetch("/api/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: name, ...payload }),
        });
        const json = await res.json();
        if (!res.ok)
          throw new Error(
            json.error?.message || "That action could not be completed.",
          );
        await refresh();
        if (["createPost", "deletePost", "follow"].includes(name))
          setFeedGeneration((n) => n + 1);
        return json;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Please try again.");
        throw e;
      }
    },
    [refresh],
  );
  async function logout() {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(
          result?.error?.message || "Could not log out. Please try again.",
        );
      }
      refreshSequence.current += 1;
      clearChatSession();
      setData(null);
      setRestrictedMember(null);
      invalidateFeed();
      setSearchPosts(null);
      setSearchCommunities([]);
      setSearchError(null);
      document.documentElement.dataset.theme = "dark";
      navigate("/");
      setStatus(await fetch("/api/auth/status").then((r) => r.json()));
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not log out. Please try again.",
      );
    }
  }
  async function login() {
    await refresh();
    navigate(
      pathname === "/"
        ? "/popular"
        : `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`,
    );
  }
  if (isPublic) return <LegalPage type={view} onNavigate={navigate} />;
  if (loading && !data) return <AppSkeleton />;
  if (restrictedMember)
    return (
      <main className="restricted-account">
        <Logo />
        <h1>Your account access is restricted.</h1>
        <p className="secondary">
          Community content is unavailable. You can still manage your data and
          sessions.
        </p>
        <AccountControls
          member={restrictedMember}
          demo={!!status?.development}
          onLogout={() => void logout()}
        />
      </main>
    );
  if (!data)
    return (
      <Gate
        status={status}
        onLogin={login}
        error={
          error ||
          (searchParams.get("authError") === "verification-required"
            ? "A verified X account is required to sign up. Sign in with a blue, gold, or gray check on X."
            : searchParams.get("authError") === "verification-unavailable"
              ? "We couldn’t confirm your X verification. Please try signing in again."
              : searchParams.has("authError")
                ? "X sign-in could not be completed. Please try again."
                : undefined)
        }
        returnPath={
          pathname === "/"
            ? "/popular"
            : `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`
        }
      />
    );
  if (!data.member.onboardingCompletedAt)
    return <Onboarding member={data.member} onAction={action} />;
  const member = data.member;
  const community =
    view === "s"
      ? data.communities.find((c) => c.slug === pathParts[1])
      : undefined;
  const following = data.communities.filter((c) => c.isFollowing);
  const unread = data.notifications.filter((n) => !n.readAt).length;
  const isEvents = view === "events" || view === "e";
  const hasRight = [
    "popular",
    "following",
    "new",
    "s",
    "p",
    "search",
    "saved",
  ].includes(view);
  let posts =
    view === "search"
      ? searchPosts || []
      : data.posts.filter((p) => p.status === "published");
  if (view === "s")
    posts = posts.filter((p) => p.communitySlug === pathParts[1]);
  if (view === "following")
    posts = posts.filter((p) => following.some((c) => c.id === p.communityId));
  if (view === "saved") posts = posts.filter((p) => p.isSaved);
  if (city !== "Everywhere" && ["popular", "following", "new"].includes(view))
    posts = posts.filter(
      (p) =>
        data.communities.find((c) => c.id === p.communityId)?.city ===
        citySlugs[city],
    );
  const effectiveSort = view === "new" ? "new" : sort;
  if (
    effectiveSort === "popular" &&
    ["popular", "following", "s"].includes(view)
  )
    posts = posts.filter(
      (p) =>
        Date.now() - new Date(p.createdAt).getTime() <= 86400000 &&
        new Date(p.createdAt).getTime() <= Date.now(),
    );
  posts = [...posts].sort(
    (a, b) =>
      (effectiveSort === "new"
        ? +new Date(b.createdAt) - +new Date(a.createdAt)
        : b.score - a.score ||
          +new Date(b.createdAt) - +new Date(a.createdAt)) ||
      b.id.localeCompare(a.id),
  );
  const visible = isFeed ? feedRows || [] : posts.slice(0, pageCount);
  const navigation = [
    { path: "/popular", label: "Popular", icon: Flame },
    { path: "/following", label: "Following", icon: Compass },
    { path: "/new", label: "New", icon: Zap },
    { path: "/events", label: "Events", icon: CalendarDays },
  ];
  const title =
    view === "following"
      ? "Following"
      : view === "new"
        ? "New posts"
        : view === "saved"
          ? "Saved posts"
          : view === "search"
            ? "Search"
            : "Popular";
  return (
    <div
      className={cn(
        "app-shell",
        sidebarCollapsed && "sidebar-collapsed",
        member.preferences.density === "compact" && "density-compact",
      )}
    >
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          onClick={() => setMobileOpen(false)}
          aria-label="Dismiss navigation"
          tabIndex={-1}
        />
      )}
      <button
        className="icon-button sidebar-toggle"
        onClick={toggleSidebar}
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!sidebarCollapsed}
        aria-controls="primary-sidebar"
        title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {sidebarCollapsed ? (
          <ChevronRight size={15} />
        ) : (
          <ChevronLeft size={15} />
        )}
      </button>
      <aside
        id="primary-sidebar"
        aria-label="Main navigation"
        className={cn("sidebar", mobileOpen && "sidebar-open")}
      >
        <div className="sidebar-mobile-heading">
          <Logo />
          <button
            className="icon-button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav className="main-nav" aria-label="Feeds">
          {navigation.map((n) => (
            <button
              key={n.path}
              className={cn(pathname.startsWith(n.path) && "active")}
              onClick={() => navigate(n.path)}
            >
              <n.icon size={19} strokeWidth={1.7} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-section-title">
          <span>Your communities</span>
          <button
            className="icon-button"
            onClick={() => navigate("/communities")}
            aria-label="Discover subreddixes"
          >
            <Plus size={15} />
          </button>
        </div>
        <nav className="community-nav">
          {following.slice(0, 7).map((c) => (
            <button
              className={cn(community?.id === c.id && "active")}
              key={c.id}
              onClick={() => navigate(`/s/${c.slug}`)}
            >
              <CommunityIcon slug={c.slug} name={c.name} icon={c.icon} />
              <span>{c.name}</span>
            </button>
          ))}
          {following.length === 0 && (
            <p className="sidebar-hint">Find a community. Make it yours.</p>
          )}
          <button
            className="discover-link"
            onClick={() => navigate("/communities")}
          >
            <LayoutGrid size={17} />
            <span>Discover communities</span>
          </button>
        </nav>
        <div className="sidebar-divider" />
        <nav className="main-nav utility-nav">
          <button
            className={cn((isChat || quickChatOpen) && "active")}
            onClick={openChat}
            aria-haspopup={isChat ? undefined : "dialog"}
            aria-expanded={isChat ? undefined : quickChatOpen}
            aria-controls={quickChatOpen ? "quick-chat-panel" : undefined}
          >
            <MessageSquare size={18} />
            <span>Chat</span>
            {chatUnread > 0 && (
              <span className="chat-nav-count">
                {chatUnread > 99 ? "99+" : chatUnread}
              </span>
            )}
          </button>
          <button
            className={cn(view === "saved" && "active")}
            onClick={() => navigate("/saved")}
          >
            <Bookmark size={18} />
            <span>Saved posts</span>
          </button>
          {member.isAdmin && (
            <button
              className={cn(view === "admin" && "active")}
              onClick={() => navigate("/admin")}
            >
              <ShieldCheck size={18} />
              <span>Admin</span>
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button className="suggest-link" onClick={() => setSuggest(true)}>
            <Plus size={15} />
            {member.isAdmin ? "Create a subreddix" : "Suggest a subreddix"}
          </button>
          {data.demo && (
            <div className="demo-label">Local preview · Fictional accounts</div>
          )}
          <button
            className="sidebar-account"
            onClick={() => navigate(`/u/${member.id}`)}
          >
            <Avatar member={member} />
            <span>
              <strong>
                {member.name}
                <Badge type={member.verificationType} />
              </strong>
              <small>@{member.handle}</small>
              <ReputationIndicator total={data.reputation.total} />
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      <div className="main-workspace" inert={mobileOpen || undefined}>
        <header className="app-header">
          <div className="header-brand">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={22} />
            </button>
            <button
              className="header-logo"
              aria-label="Reddix home"
              onClick={() => navigate("/popular")}
            >
              <Logo />
            </button>
          </div>
          <form
            className="global-search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/search?q=${encodeURIComponent(query.trim())}`);
            }}
          >
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => {
                const value = e.target.value;
                setQuery(value);
                if (view === "search") {
                  const params = new URLSearchParams(searchParams.toString());
                  params.set("q", value);
                  window.history.replaceState(
                    null,
                    "",
                    `/search?${params.toString()}`,
                  );
                }
              }}
              maxLength={200}
              placeholder="Search Reddix"
              aria-label="Search Reddix"
            />
          </form>
          <div className="header-actions">
            <button
              className="button primary header-create"
              onClick={() => setCompose(true)}
            >
              <Plus size={17} />
              <span>Create post</span>
            </button>
            <button
              className="icon-button chat-header-button"
              aria-label={`Chat${chatUnread ? `, ${chatUnread} unread` : ""}`}
              title="Chat"
              onClick={openChat}
              aria-haspopup={isChat ? undefined : "dialog"}
              aria-expanded={isChat ? undefined : quickChatOpen}
              aria-controls={quickChatOpen ? "quick-chat-panel" : undefined}
            >
              <MessageSquare size={19} />
              {chatUnread > 0 && (
                <span className="chat-header-count" aria-hidden="true">
                  {chatUnread > 99 ? "99+" : chatUnread}
                </span>
              )}
            </button>
            <button
              className="icon-button notification-bell"
              aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
              onClick={() => navigate("/notifications")}
            >
              <Bell size={19} />
              {unread > 0 && <span />}
            </button>
            <button
              className="header-avatar"
              onClick={() => navigate("/settings")}
              aria-label="Account settings"
            >
              <Avatar member={member} size="small" />
            </button>
          </div>
        </header>
        {community && (
          <section className="community-masthead">
            <CommunityBanner city={community.city} name={community.name} />
            <div className="community-summary">
              <CommunityIcon
                slug={community.slug}
                name={community.name}
                icon={community.icon}
                large
              />
              <div>
                <h1>{community.name}</h1>
                <span>s/{community.slug}</span>
                {community.xAccount && (
                  <a
                    className="community-x-link"
                    href={community.xAccount.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    @{community.xAccount.handle} on X ↗
                  </a>
                )}
              </div>
              <button
                className={cn(
                  "button",
                  community.isFollowing ? "secondary" : "primary",
                )}
                onClick={() =>
                  void action("follow", {
                    communityId: community.id,
                    following: !community.isFollowing,
                  }).catch(() => {})
                }
              >
                {community.isFollowing ? "Joined" : "Join community"}
              </button>
            </div>
            {Boolean(community.leaders?.length) && (
              <div className="community-leaders">
                <span>Discussion leaders</span>
                {community.leaders?.map((leader) => (
                  <button
                    key={leader.id}
                    onClick={() => navigate(`/u/${leader.id}`)}
                    title="Verified X organization affiliate"
                  >
                    {leader.name}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        <div
          className={cn(
            "workspace-grid",
            !hasRight && "workspace-wide",
            isChat && "workspace-chat",
          )}
        >
          <main className="main-content">
            {isChat ? (
              <Suspense fallback={<ChatSkeleton />}>
                <ChatRoute
                  member={member}
                  conversationId={pathParts[1]}
                  onNavigate={navigate}
                  onUnreadChange={setChatUnread}
                />
              </Suspense>
            ) : isEvents ? (
              <EventsView
                events={data.events}
                currentUser={member}
                communities={data.communities}
                onAction={action}
                onNavigate={navigate}
                selectedEventId={view === "e" ? pathParts[1] : undefined}
              />
            ) : view === "settings" ? (
              <SettingsView
                member={member}
                demo={data.demo}
                onAction={action}
                onLogout={logout}
              />
            ) : view === "admin" ? (
              <AdminView
                onAction={action}
                revision={revision}
                onCreateCommunity={() => setSuggest(true)}
              />
            ) : view === "u" ? (
              <Profile
                key={pathParts[1]}
                data={data}
                id={pathParts[1]}
                onAction={action}
                onNavigate={navigate}
              />
            ) : view === "p" ? (
              <PostDetail
                key={pathParts[1]}
                id={pathParts[1]}
                member={member}
                onAction={action}
                onNavigate={navigate}
                revision={revision}
              />
            ) : view === "communities" ? (
              <CommunityDirectory
                communities={data.communities}
                onNavigate={navigate}
                onAction={action}
                onSuggest={() => setSuggest(true)}
                isAdmin={member.isAdmin}
              />
            ) : view === "notifications" ? (
              <>
                <div className="page-title">
                  <h1>Your notifications</h1>
                </div>
                <div className="notification-tools">
                  <button
                    className="button secondary small"
                    onClick={() =>
                      void action("markNotificationsRead").catch(() => {})
                    }
                  >
                    <CheckCheck size={15} />
                    Mark all as read
                  </button>
                </div>
                {data.notifications.length ? (
                  data.notifications.map((n) => (
                    <button
                      className={cn("notification-row", !n.readAt && "unread")}
                      key={n.id}
                      onClick={() => {
                        if (n.type === "community_suggestion") {
                          navigate("/admin");
                          return;
                        }
                        if (n.type === "community") {
                          navigate(
                            data.communities.some(
                              (c) => c.slug === n.resourceId,
                            )
                              ? `/s/${n.resourceId}`
                              : "/communities",
                          );
                          return;
                        }
                        if (n.resourceId)
                          navigate(
                            n.type.includes("event") || n.type.includes("rsvp")
                              ? `/e/${n.resourceId}`
                              : `/p/${n.resourceId}`,
                          );
                      }}
                    >
                      <span className="notification-symbol">
                        {n.type === "community_suggestion" ? (
                          <ShieldCheck size={19} />
                        ) : n.type === "community" ? (
                          <Users size={19} />
                        ) : n.type.includes("event") ? (
                          <CalendarDays size={19} />
                        ) : (
                          <MessageSquare size={19} />
                        )}
                      </span>
                      <span>
                        <strong>{n.message}</strong>
                        <small>{timeAgo(n.createdAt)}</small>
                      </span>
                      {!n.readAt && <span className="unread-dot" />}
                    </button>
                  ))
                ) : (
                  <Empty
                    title="A quiet moment."
                    description="Replies, event updates, and community news will appear here."
                  />
                )}
              </>
            ) : (
              <>
                {!community && (
                  <div className="feed-heading-row">
                    <h1 className="feed-heading">{title}</h1>
                  </div>
                )}
                {!member.eligible && (
                  <div className="browse-notice">
                    <ShieldCheck size={17} />
                    <span>You’re exploring in browse-only mode.</span>
                    <button onClick={() => navigate("/settings")}>
                      Resync X <ArrowUpRight size={14} />
                    </button>
                  </div>
                )}
                <div className="feed-toolbar">
                  <div className="feed-filters">
                    {view === "saved" ? (
                      <span className="feed-context">Your collection</span>
                    ) : view === "search" ? (
                      <span className="feed-context">
                        {searchBusy
                          ? "Searching…"
                          : searchError
                            ? "Search unavailable"
                            : `${searchCommunities.length + posts.length} results`}
                      </span>
                    ) : (
                      <select
                        className="toolbar-select"
                        aria-label="Sort posts"
                        value={effectiveSort}
                        onChange={(event) => {
                          setSort(event.target.value);
                          if (
                            view === "new" &&
                            event.target.value === "popular"
                          )
                            navigate("/popular");
                        }}
                      >
                        <option value="popular">Popular · 24h</option>
                        <option value="new">New posts</option>
                      </select>
                    )}
                    {["popular", "following", "new"].includes(view) && (
                      <select
                        id="feed-city"
                        className="toolbar-select"
                        aria-label="Filter posts by city"
                        value={city}
                        onChange={(event) => setCity(event.target.value)}
                      >
                        {cityFilters.map((c) => (
                          <option key={c} value={c}>
                            {c === "Everywhere"
                              ? "All cities"
                              : c === "San Francisco"
                                ? "SF Bay Area"
                                : c}
                          </option>
                        ))}
                      </select>
                    )}
                    <FeedViewMenu
                      value={member.preferences.density}
                      onValueChange={async (density) => {
                        await action("preferences", {
                          preferences: {
                            ...member.preferences,
                            density,
                          },
                        });
                      }}
                    />
                  </div>
                </div>
                {view === "search" &&
                  !searchBusy &&
                  !searchError &&
                  searchCommunities.length > 0 && (
                    <CommunitySearchResults
                      communities={searchCommunities}
                      onNavigate={navigate}
                    />
                  )}
                {view === "search" &&
                  !searchBusy &&
                  !searchError &&
                  searchCommunities.length > 0 &&
                  visible.length > 0 && (
                    <h2 className="community-search-posts-heading">Posts</h2>
                  )}
                {view === "search" && searchBusy ? (
                  <FeedSkeleton label="Searching communities and posts" />
                ) : view === "search" && searchError ? (
                  <Empty
                    title="Search could not load"
                    description={searchError}
                    action={
                      <button
                        className="button secondary"
                        onClick={() =>
                          setSearchAttempt((attempt) => attempt + 1)
                        }
                      >
                        Retry search
                      </button>
                    }
                  />
                ) : view === "search" && query.trim().length < 2 ? (
                  <Empty
                    title="Find your next conversation"
                    description="Enter at least two characters to search communities and posts."
                  />
                ) : isFeed && feedError ? (
                  <Empty
                    title="Feed could not load"
                    description={feedError}
                    action={
                      <button className="button secondary" onClick={retryFeed}>
                        Retry feed
                      </button>
                    }
                  />
                ) : isFeed && !feedRows ? (
                  <FeedSkeleton />
                ) : visible.length ? (
                  visible.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      communityInfo={data.communities.find(
                        (c) => c.id === post.communityId,
                      )}
                      inCommunity={!!community}
                      member={member}
                      onAction={action}
                      onNavigate={navigate}
                    />
                  ))
                ) : view === "search" && searchCommunities.length > 0 ? null : (
                  <Empty
                    title={
                      view === "saved"
                        ? "Keep a good idea close."
                        : view === "search"
                          ? "Try a different rabbit hole."
                          : "The next conversation could be yours."
                    }
                    description={
                      view === "saved"
                        ? "Tap the bookmark on a post to find it here later."
                        : view === "following"
                          ? "Join a few communities to build a feed that feels like you."
                          : view === "search"
                            ? "No communities or posts match your search. Try another company, topic, or city."
                            : "There aren’t any discussions in this view yet."
                    }
                    action={
                      <button
                        className="button secondary"
                        onClick={() =>
                          view === "following" || view === "search"
                            ? navigate("/communities")
                            : setCompose(true)
                        }
                      >
                        {view === "following" || view === "search"
                          ? "Find communities"
                          : "Start a conversation"}
                        <ArrowRight size={15} />
                      </button>
                    }
                  />
                )}
                {(isFeed ? !!feedCursor : posts.length > pageCount) ? (
                  <button
                    className="button secondary load-more"
                    disabled={feedLoading}
                    onClick={() => {
                      if (isFeed) void moreFeed();
                      else setPageCount((c) => c + 10);
                    }}
                  >
                    More conversations
                    {feedLoading ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <ChevronDown size={16} />
                    )}
                  </button>
                ) : (
                  visible.length > 0 && (
                    <div className="feed-end">You’re all caught up.</div>
                  )
                )}
              </>
            )}
          </main>
          {hasRight && (
            <aside
              className="right-sidebar"
              aria-label="Community information and events"
              tabIndex={0}
            >
              {community && (
                <section className="right-panel community-about">
                  <h3>About {community.name}</h3>
                  <p>{community.description}</p>
                  <div className="community-stat">
                    <strong>{compactNumber(community.membersCount)}</strong>
                    <span>members</span>
                  </div>
                  <button
                    className="text-link"
                    onClick={() => navigate("/community-guidelines")}
                  >
                    Community guidelines
                  </button>
                </section>
              )}
              <section className="right-panel upcoming-panel">
                <div className="right-section-title">
                  <h3>Upcoming events</h3>
                </div>
                {data.events
                  .filter(
                    (e) =>
                      e.status !== "canceled" &&
                      new Date(e.startsAt) > new Date(),
                  )
                  .slice(0, 3)
                  .map((e) => (
                    <button
                      className="upcoming-event"
                      key={e.id}
                      onClick={() => navigate(`/e/${e.id}`)}
                    >
                      <span className="event-date-box">
                        <small>
                          {new Date(e.startsAt)
                            .toLocaleDateString("en-US", { month: "short" })
                            .toUpperCase()}
                        </small>
                        <strong>{new Date(e.startsAt).getDate()}</strong>
                      </span>
                      <span>
                        <strong>{e.title}</strong>
                        <small>
                          {Object.keys(citySlugs).find(
                            (k) => citySlugs[k] === e.city,
                          ) || e.city}{" "}
                          <span>·</span>{" "}
                          {new Date(e.startsAt).toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                            timeZone: e.timezone,
                          })}
                        </small>
                      </span>
                    </button>
                  ))}
                <button
                  className="right-bottom-link"
                  onClick={() => navigate("/events")}
                >
                  View calendar
                </button>
              </section>
              <section className="right-panel">
                <div className="right-section-title">
                  <h3>Discover communities</h3>
                </div>
                {data.communities
                  .filter((c) => !c.isFollowing && !c.archived)
                  .sort(
                    (a, b) =>
                      Number(!!getCommunityMetadata(b.slug)?.featured) -
                        Number(!!getCommunityMetadata(a.slug)?.featured) ||
                      a.name.localeCompare(b.name),
                  )
                  .slice(0, 3)
                  .map((c) => (
                    <div className="recommended-community" key={c.id}>
                      <button onClick={() => navigate(`/s/${c.slug}`)}>
                        <CommunityIcon
                          slug={c.slug}
                          name={c.name}
                          icon={c.icon}
                        />
                        <span>
                          <strong>{c.name}</strong>
                        </span>
                      </button>
                      <button
                        className="join-circle"
                        aria-label={`Join ${c.name}`}
                        onClick={() =>
                          void action("follow", {
                            communityId: c.id,
                            following: true,
                          }).catch(() => {})
                        }
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  ))}
                <button
                  className="right-bottom-link"
                  onClick={() => navigate("/communities")}
                >
                  View all communities
                </button>
              </section>
              <div className="right-footer">
                <button onClick={() => navigate("/support")}>
                  About & help
                </button>
                <button onClick={() => navigate("/community-guidelines")}>
                  Guidelines
                </button>
                <button onClick={() => navigate("/privacy")}>Privacy</button>
                <button onClick={() => navigate("/terms")}>Terms</button>
                <span className="x-independence">
                  An open-source community. Not affiliated with X or Reddit.
                </span>
                <span>© {new Date().getFullYear()} Reddix</span>
              </div>
            </aside>
          )}
        </div>
        <nav className="mobile-bottom-nav">
          <button
            className={cn(
              ["popular", "new", "following"].includes(view) && "active",
            )}
            onClick={() => navigate("/popular")}
          >
            <Flame size={21} />
            <span>Feed</span>
          </button>
          <button
            className={cn(view === "communities" && "active")}
            onClick={() => navigate("/communities")}
          >
            <Compass size={21} />
            <span>Explore</span>
          </button>
          <button
            className="mobile-create"
            onClick={() => setCompose(true)}
            aria-label="Create post"
          >
            <Plus size={23} />
          </button>
          <button
            className={cn(isEvents && "active")}
            onClick={() => navigate("/events")}
          >
            <CalendarDays size={21} />
            <span>Events</span>
          </button>
          <button
            className={cn(view === "settings" && "active")}
            onClick={() => navigate("/settings")}
          >
            <Users size={21} />
            <span>You</span>
          </button>
        </nav>
      </div>
      {!isChat && chatSession.mode !== "closed" && (
        <QuickChat
          key={member.id}
          member={member}
          unreadCount={chatUnread}
          onUnreadChange={setChatUnread}
          onNavigate={navigate}
          suspended={mobileOpen || compose || suggest}
        />
      )}
      <ComposePost
        open={compose}
        onClose={() => setCompose(false)}
        communities={data.communities}
        member={member}
        onAction={action}
        onNavigate={navigate}
        defaultCommunity={community?.id}
      />
      <Modal
        open={suggest}
        onOpenChange={setSuggest}
        title={
          member.isAdmin
            ? "Create a subreddix"
            : "There’s room for your corner."
        }
        description={
          member.isAdmin
            ? "Your new community will be available immediately. No approval needed."
            : "Tell us about a community you’d love to see on Reddix."
        }
      >
        <form
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            if (suggestBusy) return;
            setSuggestBusy(true);
            try {
              const result = await action(
                member.isAdmin ? "adminCreateCommunity" : "suggestCommunity",
                {
                  name: suggestName.trim(),
                  description: suggestDescription.trim(),
                },
              );
              setSuggest(false);
              setSuggestName("");
              setSuggestDescription("");
              toast.success(
                member.isAdmin
                  ? "Subreddix created."
                  : "Suggestion sent. We’ll take a look.",
              );
              if (member.isAdmin && typeof result.slug === "string")
                navigate(`/s/${result.slug}`);
            } catch {
            } finally {
              setSuggestBusy(false);
            }
          }}
        >
          <label htmlFor="suggest-name">Community name</label>
          <input
            id="suggest-name"
            value={suggestName}
            onChange={(e) => setSuggestName(e.target.value)}
            minLength={3}
            maxLength={80}
            disabled={suggestBusy}
            required
            placeholder="e.g. Toronto Design"
          />
          <label htmlFor="suggest-description">
            What brings this community together?
          </label>
          <textarea
            id="suggest-description"
            value={suggestDescription}
            onChange={(e) => setSuggestDescription(e.target.value)}
            rows={4}
            minLength={10}
            maxLength={3000}
            disabled={suggestBusy}
            required
          />
          <button
            className="button primary full modal-submit"
            disabled={suggestBusy || (!member.isAdmin && !member.eligible)}
          >
            {suggestBusy
              ? member.isAdmin
                ? "Creating…"
                : "Sending…"
              : member.isAdmin
                ? "Create subreddix"
                : "Send suggestion"}
            {suggestBusy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <ArrowUpRight size={16} />
            )}
          </button>
          {!member.isAdmin && !member.eligible && (
            <p className="field-hint">
              Suggestions require a verified X account.
            </p>
          )}
        </form>
      </Modal>
    </div>
  );
}
