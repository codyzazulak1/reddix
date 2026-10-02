"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type {
  Bootstrap,
  Comment,
  Post,
  PublicMember,
  ReddixEvent,
  Reputation,
} from "@/lib/types";
import { compactNumber, timeAgo, cn } from "@/lib/utils";
import { Avatar, Badge, Empty } from "./ui";
import { XMark } from "./x-brand";
import { PostCard, type Action, type Navigate } from "./discussions";
import { ProfileSkeleton } from "./loading-skeletons";
import { ReputationSummary } from "./reputation";
import "./moderation-panel.css";

type ProfileData = {
  member: PublicMember;
  posts: Post[];
  comments: (Comment & { postTitle: string; communitySlug: string })[];
  events: ReddixEvent[];
  reputation: Reputation;
};
export default function Profile({
  data,
  id,
  onAction,
  onNavigate,
}: {
  data: Bootstrap;
  id: string;
  onAction: Action;
  onNavigate: Navigate;
}) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(
    null,
  );
  const [selection, setSelection] = useState({ id, tab: "Posts" });
  const tab = selection.id === id ? selection.tab : "Posts";
  const setTab = (value: string) => setSelection({ id, tab: value });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/members/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok)
          throw new Error(d.error?.message || "This member is unavailable.");
        if (!controller.signal.aborted) {
          setProfile(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError({ id, message: e.message });
      });
    return () => controller.abort();
  }, [id, data.generatedAt]);
  if (error?.id === id)
    return <Empty title="Member unavailable" description={error.message} />;
  if (!profile || profile.member.id !== id) return <ProfileSkeleton />;
  const person = profile.member;
  return (
    <>
      <section className="profile-header">
        <Avatar member={person} size="large" />
        <div className="profile-name-row">
          <h1>
            {person.name}
            {!person.isBot && <Badge type={person.verificationType} />}
          </h1>
          {person.isBot ? (
            data.member.isAdmin && (
              <Link href="/admin" className="button secondary small">
                Open moderation workspace
              </Link>
            )
          ) : id === data.member.id ? (
            <button
              className="button secondary small"
              onClick={() => onNavigate("/settings")}
            >
              Manage profile
            </button>
          ) : (
            <div className="profile-contact-actions">
              <button
                className="button primary small"
                onClick={() =>
                  onNavigate(`/chat/new?to=${encodeURIComponent(person.id)}`)
                }
                disabled={!data.member.eligible}
                title={
                  !data.member.eligible
                    ? "Resync your X verification to send messages."
                    : undefined
                }
              >
                Message
              </button>
              <a
                className="button secondary small x-account-link"
                href={`https://x.com/${person.handle}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <XMark size={15} /> View on X
              </a>
            </div>
          )}
        </div>
        <p className="profile-handle">@{person.handle}</p>
        {person.isBot && (
          <span className="profile-bot-label">
            <ShieldCheck size={14} aria-hidden="true" /> Automated moderator
          </span>
        )}
        <p className="profile-bio">{person.bio}</p>
        <div className="profile-facts">
          {person.location && <span>{person.location}</span>}
          {!person.isBot && (
            <span>
              <strong>{compactNumber(person.followersCount)}</strong> followers
              on X
            </span>
          )}
          <span>
            <strong>{profile.posts.length}</strong> Reddix posts
          </span>
          {person.isBot && (
            <span>
              <strong>{profile.comments.length}</strong> comments
            </span>
          )}
        </div>
        {!person.isBot && <ReputationSummary reputation={profile.reputation} />}
      </section>
      <div className="page-tabs">
        {[
          "Posts",
          "Comments",
          "Events",
          ...(person.isBot ? ["About"] : []),
        ].map((t) => (
          <button
            key={t}
            className={cn(t === tab && "active")}
            aria-pressed={t === tab}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "About" && person.isBot ? (
        <section className="profile-bot-about">
          <h2>About @{person.handle}</h2>
          <p>
            This is Reddix’s automated moderation account. When AI checks are
            enabled, @{person.handle} checks community posts and comments for
            spam, scams, harassment, threats, and sharing private information.
          </p>
          <p>
            Uncertain cases go to site admins. If content is removed, a notice
            explains why. Admins can review and reverse a moderation decision.
          </p>
          <p>
            This account does not accept chat requests or send personal
            messages.
          </p>
          <Link href="/community-guidelines">
            Read the community guidelines
          </Link>
        </section>
      ) : tab === "Posts" ? (
        profile.posts.length ? (
          profile.posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              member={data.member}
              onAction={onAction}
              onNavigate={onNavigate}
            />
          ))
        ) : (
          <Empty
            title="A fresh page."
            description="Conversations started by this member will appear here."
          />
        )
      ) : tab === "Comments" ? (
        profile.comments.length ? (
          profile.comments.map((c) => (
            <button
              className="profile-comment"
              onClick={() => onNavigate(`/p/${c.postId}`)}
              key={c.id}
            >
              <span>
                s/{c.communitySlug}
                <span>·</span>
                {timeAgo(c.createdAt)}
              </span>
              <h3>{c.postTitle}</h3>
              <p>{c.body}</p>
              <small>{c.score} points</small>
            </button>
          ))
        ) : (
          <Empty
            title="No replies just yet."
            description="Their contributions to the conversation will appear here."
          />
        )
      ) : profile.events.length ? (
        profile.events.map((e) => (
          <button
            className="profile-event"
            key={e.id}
            onClick={() => onNavigate(`/e/${e.id}`)}
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
              <h3>{e.title}</h3>
              <p>
                {e.venue} ·{" "}
                {new Date(e.startsAt).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  timeZone: e.timezone,
                })}
              </p>
            </span>
          </button>
        ))
      ) : (
        <Empty
          title="Good company, coming soon."
          description="Events hosted by this member will appear here."
        />
      )}
    </>
  );
}
