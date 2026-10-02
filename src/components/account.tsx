"use client";
import dynamic from "next/dynamic";
import { PageSkeleton } from "./loading-skeletons";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, LogOut, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Member, Preferences } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { Avatar, Badge, Empty, Logo } from "./ui";
import { type Action, type Navigate } from "./discussions";
import { AccountControls } from "./account-controls";
import { XMark } from "./x-brand";
import "./x-account.css";

const XGrowthPanel = dynamic(
  () => import("./x-growth-panel").then((module) => module.XGrowthPanel),
  {
    loading: () => <PageSkeleton label="Loading bot workspace" />,
  },
);
const ModerationPanel = dynamic(
  () => import("./moderation-panel").then((module) => module.ModerationPanel),
  {
    loading: () => <PageSkeleton label="Loading moderation" />,
  },
);

const cities = [
  "San Francisco",
  "New York",
  "Toronto",
  "Seattle",
  "Los Angeles",
  "Remote / Online",
];
const cityValues: Record<string, string> = {
  "San Francisco": "sf",
  "New York": "new-york",
  Toronto: "toronto",
  Seattle: "seattle",
  "Los Angeles": "los-angeles",
  "Remote / Online": "online",
};
const interests = [
  "AI",
  "Startups",
  "Engineering",
  "Product",
  "Design",
  "Fundraising",
  "Open source",
  "Careers",
  "Events",
  "Venture capital",
  "Infrastructure",
  "Community",
];

export function Onboarding({
  member,
  onAction,
}: {
  member: Member;
  onAction: Action;
}) {
  const [step, setStep] = useState(0);
  const [city, setCity] = useState(member.preferences.city || "sf");
  const [selected, setSelected] = useState<string[]>(
    member.preferences.interests || [],
  );
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  async function finish() {
    setBusy(true);
    try {
      await onAction("onboarding", {
        preferences: { ...member.preferences, city, interests: selected },
        acceptTerms: accepted,
      });
    } catch {
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="onboarding">
      <Logo />
      <div className="onboarding-card">
        <div className="onboarding-progress">
          {[0, 1, 2].map((n) => (
            <span key={n} className={n <= step ? "complete" : ""} />
          ))}
        </div>
        <span className="small-label">Step {step + 1} of 3</span>
        {step === 0 ? (
          <>
            <Avatar member={member} size="large" />
            <div className="x-account-source">
              <XMark size={18} />
              <span>Your X profile, here on Reddix</span>
            </div>
            <h1>Hey, {member.name.split(" ")[0]}.</h1>
            <p>
              Same name, handle, and profile. A new place for your tech
              conversations. Update your profile on X, then resync here.
            </p>
            <div className="onboarding-identity">
              <strong>{member.name}</strong>
              <Badge type={member.verificationType} />
              <span>@{member.handle}</span>
            </div>
            <div className="status-note">
              <span>
                {member.eligible
                  ? "You’re verified and ready to join the conversation."
                  : "You can browse everything. Verify on X to post, comment, and RSVP."}
              </span>
            </div>
            <button className="button primary full" onClick={() => setStep(1)}>
              Looks like me
            </button>
          </>
        ) : step === 1 ? (
          <>
            <h1>Find your people.</h1>
            <p>Choose the topics you’re interested in.</p>
            <div className="interest-grid">
              {interests.map((i) => (
                <button
                  key={i}
                  aria-pressed={selected.includes(i)}
                  className={cn(
                    "interest-chip",
                    selected.includes(i) && "selected",
                  )}
                  onClick={() =>
                    setSelected((s) =>
                      s.includes(i) ? s.filter((v) => v !== i) : [...s, i],
                    )
                  }
                >
                  {selected.includes(i) && <Check size={14} />} {i}
                </button>
              ))}
            </div>
            <div className="onboarding-buttons">
              <button className="button ghost" onClick={() => setStep(0)}>
                Back
              </button>
              <button className="button primary" onClick={() => setStep(2)}>
                {selected.length ? "Continue" : "Skip for now"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>Where’s your corner?</h1>
            <p>
              We’ll use your city for nearby events. This is a private
              preference, not a change to your X profile.
            </p>
            <label htmlFor="home-city">Your home city</label>
            <select
              id="home-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            >
              {cities.map((c) => (
                <option key={c} value={cityValues[c]}>
                  {c}
                </option>
              ))}
            </select>
            <label className="checkbox-row consent">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>
                I agree to the{" "}
                <a href="/terms" target="_blank">
                  Terms
                </a>
                ,{" "}
                <a href="/privacy" target="_blank">
                  Privacy Policy
                </a>
                , and{" "}
                <a href="/community-guidelines" target="_blank">
                  Community Guidelines
                </a>
                .
              </span>
            </label>
            <div className="onboarding-buttons">
              <button className="button ghost" onClick={() => setStep(1)}>
                Back
              </button>
              <button
                className="button primary"
                disabled={!accepted || busy}
                onClick={() => void finish()}
              >
                {busy ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  "Find my people"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export function SettingsView({
  member,
  demo,
  onAction,
  onLogout,
}: {
  member: Member;
  demo: boolean;
  onAction: Action;
  onLogout: () => Promise<void>;
}) {
  const [tab, setTab] = useState("Profile");
  const [prefs, setPrefs] = useState<Preferences>(member.preferences);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => setPrefs(member.preferences), [member.preferences]);
  async function save() {
    setSaving(true);
    try {
      await onAction("preferences", { preferences: prefs });
      toast.success("Preferences saved.");
    } catch {
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="settings-page">
      <div className="page-title">
        <h1>Settings</h1>
      </div>
      <div className="page-tabs">
        {["Profile", "Preferences", "Notifications", "Account"].map((t) => (
          <button
            key={t}
            className={cn(tab === t && "active")}
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Profile" ? (
        <>
          <section className="settings-panel">
            <div
              className={cn("x-account-source", !demo && "x-account-connected")}
            >
              <XMark size={demo ? 18 : 13} />
              <span>{demo ? "X profile preview" : "Connected with X"}</span>
            </div>
            <div className="settings-identity">
              <Avatar member={member} size="large" />
              <div>
                <h2>
                  {member.name}
                  <Badge type={member.verificationType} />
                </h2>
                <span>@{member.handle}</span>
              </div>
              <a
                className="button secondary small"
                href={`https://x.com/${member.handle}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Edit on X
              </a>
            </div>
            <div className="field-grid">
              <div>
                <label htmlFor="profile-name">Display name</label>
                <input id="profile-name" value={member.name} readOnly />
              </div>
              <div>
                <label htmlFor="profile-handle">X handle</label>
                <input
                  id="profile-handle"
                  value={`@${member.handle}`}
                  readOnly
                />
              </div>
            </div>
            <label htmlFor="profile-bio">Bio</label>
            <textarea id="profile-bio" value={member.bio} rows={3} readOnly />
            <div className="field-grid">
              <div>
                <label htmlFor="profile-location">Location</label>
                <input id="profile-location" value={member.location} readOnly />
              </div>
              <div>
                <label htmlFor="profile-website">Website</label>
                <input id="profile-website" value={member.website} readOnly />
              </div>
            </div>
            <div className="sync-row">
              <p>Update your profile on X, then resync here.</p>
              <button
                className="button secondary"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onAction("resync");
                    toast.success(
                      demo
                        ? "Local fixture refreshed. Live X syncing is not connected."
                        : "Your profile is up to date.",
                    );
                  } catch {
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <RefreshCw size={16} className={saving ? "spin" : ""} />
                Resync from X
              </button>
            </div>
          </section>
          <section className="verification-panel">
            <div>
              <h3>
                {member.eligible ? "Verified account" : "Browse-only account"}
              </h3>
              <p>
                {member.eligible
                  ? "Your X verification lets you post, comment, vote, and RSVP."
                  : "Get a qualifying blue or business verification on X, then resync to participate."}
              </p>
              <span>
                Last checked{" "}
                {member.verificationCheckedAt
                  ? timeAgo(member.verificationCheckedAt)
                  : "not yet"}
              </span>
            </div>
          </section>
          <button
            type="button"
            className="button secondary"
            disabled={loggingOut}
            onClick={async () => {
              setLoggingOut(true);
              try {
                await onLogout();
              } finally {
                setLoggingOut(false);
              }
            }}
          >
            {loggingOut ? (
              <Loader2 size={16} className="spin" aria-hidden="true" />
            ) : (
              <LogOut size={16} aria-hidden="true" />
            )}
            {loggingOut ? "Logging out…" : "Log out"}
          </button>
        </>
      ) : tab === "Preferences" ? (
        <section className="settings-panel">
          <h2>Preferences</h2>
          <label htmlFor="settings-city">Home city</label>
          <select
            id="settings-city"
            value={prefs.city}
            onChange={(e) => setPrefs({ ...prefs, city: e.target.value })}
          >
            {cities.map((c) => (
              <option key={c} value={cityValues[c]}>
                {c}
              </option>
            ))}
          </select>
          <label>Interests</label>
          <div className="interest-grid">
            {interests.map((i) => (
              <button
                key={i}
                aria-pressed={prefs.interests.includes(i)}
                className={cn(
                  "interest-chip",
                  prefs.interests.includes(i) && "selected",
                )}
                onClick={() =>
                  setPrefs({
                    ...prefs,
                    interests: prefs.interests.includes(i)
                      ? prefs.interests.filter((s) => s !== i)
                      : [...prefs.interests, i],
                  })
                }
              >
                {prefs.interests.includes(i) && <Check size={13} />} {i}
              </button>
            ))}
          </div>
          <div className="field-grid">
            <div>
              <label htmlFor="settings-appearance">Appearance</label>
              <select
                id="settings-appearance"
                value={prefs.theme}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    theme: e.target.value as Preferences["theme"],
                  })
                }
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </div>
            <div>
              <label htmlFor="settings-density">Feed density</label>
              <select
                id="settings-density"
                value={prefs.density}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    density: e.target.value as Preferences["density"],
                  })
                }
              >
                <option value="comfortable">Card</option>
                <option value="compact">Compact</option>
              </select>
            </div>
          </div>
          <button
            className="button primary"
            disabled={saving}
            onClick={() => void save()}
          >
            Save preferences
          </button>
        </section>
      ) : tab === "Notifications" ? (
        <section className="settings-panel">
          <h2>Notifications and privacy</h2>
          <p className="secondary">
            Replies and account updates appear in your Reddix inbox.
          </p>
          <label className="switch-row">
            <span>
              <strong>Event reminders</strong>
              <small>Keep track of events you’re going to.</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={prefs.eventReminders}
              onChange={(e) =>
                setPrefs({ ...prefs, eventReminders: e.target.checked })
              }
            />
          </label>
          <label className="switch-row">
            <span>
              <strong>Keep my posts off X</strong>
              <small>
                Stops future bot promotion and highlights featuring your posts.
                Existing X posts may remain.
              </small>
            </span>
            <input
              type="checkbox"
              checked={prefs.xPromotionOptOut ?? false}
              onChange={(e) =>
                setPrefs({ ...prefs, xPromotionOptOut: e.target.checked })
              }
            />
          </label>
          <label className="switch-row">
            <span>
              <strong>Show my attendance</strong>
              <small>Let other members see when you’re attending.</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={prefs.publicAttendance}
              onChange={(e) =>
                setPrefs({ ...prefs, publicAttendance: e.target.checked })
              }
            />
          </label>
          <div className="status-note">
            <span>
              Email delivery is not connected yet. Notifications stay in your
              Reddix inbox.
            </span>
          </div>
          <button
            className="button primary"
            disabled={saving}
            onClick={() => void save()}
          >
            Save preferences
          </button>
        </section>
      ) : (
        <AccountControls member={member} demo={demo} onLogout={onLogout} />
      )}
    </div>
  );
}

type CommunitySuggestion = {
  id: string;
  name: string;
  description: string;
  city: string | null;
  status: "open" | "accepted" | "declined";
  author: { handle: string };
};

export function AdminView({
  onAction,
  revision,
  onCreateCommunity,
}: {
  onAction: Action;
  revision: number;
  onCreateCommunity: () => void;
}) {
  const [data, setData] = useState<{
    reports: Record<string, unknown>[];
    suggestions: CommunitySuggestion[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<Set<string>>(new Set());
  const pendingReviews = useRef(new Set<string>());
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetch("/api/admin", { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok)
          throw new Error(d.error?.message || "Admin access unavailable");
        if (!controller.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [revision]);

  async function reviewSuggestion(
    suggestionId: string,
    status: "accepted" | "declined",
  ) {
    if (pendingReviews.current.has(suggestionId)) return;
    pendingReviews.current.add(suggestionId);
    setReviewing(new Set(pendingReviews.current));
    try {
      await onAction("adminSuggestion", { suggestionId, status });
      setData(
        (current) =>
          current && {
            ...current,
            suggestions: current.suggestions.map((suggestion) =>
              suggestion.id === suggestionId
                ? { ...suggestion, status }
                : suggestion,
            ),
          },
      );
      toast.success(
        status === "accepted"
          ? "Suggestion approved. Subreddix created."
          : "Suggestion declined.",
      );
    } catch {
      // The shared action handler displays the server's error message.
    } finally {
      pendingReviews.current.delete(suggestionId);
      setReviewing(new Set(pendingReviews.current));
    }
  }
  if (error)
    return <Empty title="Admin access unavailable" description={error} />;
  return (
    <div className="admin-page">
      <div className="page-title admin-page-title">
        <h1>Admin workspace</h1>
        <button className="button primary small" onClick={onCreateCommunity}>
          <Plus size={16} aria-hidden="true" />
          Create a subreddix
        </button>
      </div>
      <section className="settings-panel" aria-label="Community suggestions">
        <h2>Community suggestions</h2>
        <p className="admin-suggestions-description">
          Approve a suggestion to make its subreddix available to everyone.
        </p>
        {!data ? (
          <PageSkeleton label="Loading community suggestions" />
        ) : !data.suggestions.length ? (
          <Empty
            title="Room to grow."
            description="Suggested subreddixes will land here."
          />
        ) : (
          data.suggestions.map((s) => (
            <article
              className="admin-row"
              key={s.id}
              aria-label={s.name}
              aria-busy={reviewing.has(s.id)}
            >
              <div>
                <strong>{s.name}</strong>
                <p>{s.description}</p>
                <p className="admin-suggestion-author">
                  Suggested by @{s.author.handle}
                  {s.city ? ` · ${s.city}` : ""}
                </p>
              </div>
              <span className="status-pill">
                {
                  {
                    open: "Pending",
                    accepted: "Approved",
                    declined: "Declined",
                  }[s.status]
                }
              </span>
              {s.status === "open" && (
                <>
                  <button
                    className="button secondary small"
                    disabled={reviewing.has(s.id)}
                    onClick={() => void reviewSuggestion(s.id, "accepted")}
                  >
                    {reviewing.has(s.id) && (
                      <Loader2 size={14} className="spin" aria-hidden="true" />
                    )}
                    Approve
                  </button>
                  <button
                    className="button ghost small"
                    disabled={reviewing.has(s.id)}
                    onClick={() => void reviewSuggestion(s.id, "declined")}
                  >
                    Decline
                  </button>
                </>
              )}
            </article>
          ))
        )}
      </section>
      <XGrowthPanel />
      <ModerationPanel revision={revision} />
      <section className="settings-panel">
        <h2>Report queue</h2>
        {!data ? (
          <PageSkeleton label="Loading reports" />
        ) : !data.reports?.length ? (
          <Empty
            title="All clear."
            description="Member reports will appear here for review."
          />
        ) : (
          data.reports.map((r) => (
            <div className="admin-row" key={String(r.id)}>
              <div>
                <strong>{String(r.reason || "Report")}</strong>
                <p>
                  {String(r.targetType || r.target_type || "Content")} ·{" "}
                  {String(r.status || "open")}
                </p>
              </div>
              <button
                className="button secondary small"
                onClick={() =>
                  void onAction("adminReport", {
                    reportId: r.id,
                    status: "resolved",
                  }).catch(() => {})
                }
              >
                Resolve
              </button>
              <button
                className="button secondary small"
                onClick={() =>
                  void onAction("adminReport", {
                    reportId: r.id,
                    status: "resolved",
                    removeTarget: true,
                  }).catch(() => {})
                }
              >
                Remove content
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

export function LegalPage({
  type,
  onNavigate,
}: {
  type: string;
  onNavigate: Navigate;
}) {
  const titles: Record<string, string> = {
    terms: "Terms of use",
    privacy: "Privacy",
    support: "A little help",
    "community-guidelines": "Community guidelines",
  };
  return (
    <main className="legal-page">
      <button onClick={() => onNavigate("/")}>
        <Logo />
      </button>
      <div className="legal-copy">
        <h1>{titles[type] || "About Reddix"}</h1>
        {type === "support" ? (
          <>
            <h2>Signing in</h2>
            <p>
              Sign up with an X account that has a blue, gold, or gray
              verification check. Select Join with X to connect your account and
              set up your Reddix profile.
            </p>
            <h2>Posting and commenting</h2>
            <p>
              You need a current blue or business verification on X to
              participate. If your account has changed, open Settings and select
              Resync from X.
            </p>
            <h2>Reporting a problem</h2>
            <p>
              Use the flag menu on a post, comment, or event to send a private
              report to the site administrators.
            </p>
          </>
        ) : type === "community-guidelines" ? (
          <>
            <h2>Be curious. Be constructive.</h2>
            <p>
              Disagree with ideas without attacking people. Share what you know,
              ask thoughtful questions, and give useful context.
            </p>
            <h2>Keep it relevant and honest.</h2>
            <p>
              Share work you’re proud of and disclose your affiliations. No
              spam, scams, impersonation, harassment, or sharing someone’s
              private information.
            </p>
            <h2>Look out for each other.</h2>
            <p>
              Report posts or comments that need attention. An X verification
              badge is a contribution requirement, not a guarantee of
              trustworthiness.
            </p>
          </>
        ) : type === "privacy" ? (
          <>
            <p>
              Reddix uses your X identity to connect your profile and verify
              your eligibility to sign up and contribute. We store your
              synchronized profile, preferences, contributions, and event
              registrations.
            </p>
            <h2>Your profile</h2>
            <p>
              Your name, handle, avatar, bio, and available public metrics come
              from X. Interests, home-city preferences, saves, and notification
              preferences stay private.
            </p>
            <h2>Events</h2>
            <p>
              Hosts can see the registration information needed to run their
              event. Guest visibility and venue access depend on the event
              settings and your preferences.
            </p>
            <h2>Automated moderation</h2>
            <p>
              When enabled, @reddix sends community posts and comments, relevant
              rules, and a short excerpt of the surrounding conversation through
              OpenRouter for automated review. Private messages, X credentials,
              and profile data are not included. Administrators can review
              flagged content and reverse moderation decisions.
            </p>
            <h2>Reddix on X</h2>
            <p>
              When you allow public promotion, the Reddix bot can share your
              post title, X handle, and a link on X, including in daily
              highlights. Post bodies, private images, and comments stay behind
              sign-in. You can disable future promotion in Settings. Posts
              already published on X may remain there.
            </p>
            <p>
              Official X organization affiliation can provide a community
              discussion-leader badge. Aggregate daily comment and
              member-session counts may appear in highlights. A member session
              starts after at least 30 minutes without recorded interaction.
              Session records are kept for 90 days.
            </p>
            <h2>Local development</h2>
            <p>
              This initial development version stores fictional demo accounts
              and activity in a local PostgreSQL database. Live X, email
              delivery, and advertising payments are not connected until
              configured.
            </p>
            <p className="policy-draft">
              Development policy draft. Operator details, retention schedules,
              and contact procedures must be finalized before accepting real
              member data.
            </p>
          </>
        ) : (
          <>
            <p>
              Reddix is a technology community. New accounts require blue, gold,
              or gray verification on X. You must sign in with X to view
              community content and have current blue or gold verification to
              contribute.
            </p>
            <h2>Your contributions</h2>
            <p>
              You are responsible for what you post and must have the right to
              share it. Follow the community guidelines and respect other
              members’ privacy.
            </p>
            <h2>Access and moderation</h2>
            <p>
              Administrators may remove content or restrict accounts that
              violate the guidelines. X verification does not guarantee
              continued access or contribution eligibility.
            </p>
            <p>
              The @reddix automated moderator can flag contributions for review
              or hide clear violations when enabled. Administrators review
              disputed decisions and can restore content.
            </p>
            <h2>Independent service</h2>
            <p>
              Reddix is independent of X, Reddit, and the organizations
              discussed in its communities.
            </p>
            <p className="policy-draft">
              Development terms draft. Operator details and final terms must be
              established before a public service is opened.
            </p>
          </>
        )}
        <button className="button secondary" onClick={() => onNavigate("/")}>
          Back to Reddix
        </button>
      </div>
    </main>
  );
}
