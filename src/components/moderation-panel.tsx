"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { timeAgo } from "@/lib/utils";
import { Modal } from "./ui";
import "./moderation-panel.css";

type Resolution = "remove" | "restore" | "dismiss";
type ModerationCase = {
  id: string;
  targetType: "post" | "comment";
  targetId: string;
  postId: string;
  authorName: string;
  authorHandle: string;
  title: string;
  body: string;
  contentStatus: string;
  action: "allow" | "review" | "remove";
  category: string;
  confidence: number;
  reason: string;
  model: string;
  createdAt: string;
  resolution: "pending" | "removed" | "restored" | "dismissed" | "superseded";
  reviewNote: string | null;
};
type ModerationData = {
  bot: { id: string; handle: string; name: string };
  configured: boolean;
  mode: "off" | "review" | "auto";
  model: string;
  dailyLimit: number;
  today: { requests: number; costUsd: number };
  counts: { queued: number; review: number; removed: number; failed: number };
  cases: ModerationCase[];
  errors: {
    id: string;
    targetType: string;
    targetId: string;
    message: string;
    createdAt: string;
  }[];
};

const resolutionLabels: Record<ModerationCase["resolution"], string> = {
  pending: "Needs review",
  removed: "Removed",
  restored: "Restored",
  dismissed: "Dismissed",
  superseded: "Content changed",
};
const actionLabels: Record<Resolution, string> = {
  remove: "Remove content",
  restore: "Restore content",
  dismiss: "Dismiss flag",
};

async function readResponse(response: Response) {
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.message || "Moderation is unavailable. Try again.",
    );
  return data;
}

export function ModerationPanel({ revision }: { revision: number }) {
  const [data, setData] = useState<ModerationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{
    item: ModerationCase;
    resolution: Resolution;
  } | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    const next = await fetch("/api/moderation", {
      cache: "no-store",
      signal,
    }).then(readResponse);
    setData(next);
    setError(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((error: Error) => {
      if (error.name !== "AbortError") setError(error.message);
    });
    return () => controller.abort();
  }, [load, revision]);

  async function refresh() {
    setBusy(true);
    try {
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't refresh moderation.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function process() {
    setBusy(true);
    try {
      await fetch("/api/moderation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process" }),
      }).then(readResponse);
      await load();
      toast.success("Queue run finished. Review the latest results below.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't run queued checks.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitReview(event: FormEvent) {
    event.preventDefault();
    if (!review || reason.trim().length < 5) return;
    setBusy(true);
    try {
      await fetch("/api/moderation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review",
          decisionId: review.item.id,
          resolution: review.resolution,
          reason: reason.trim(),
        }),
      }).then(readResponse);
      setReview(null);
      setReason("");
      await load();
      toast.success("Review saved to the moderation history.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save your review.",
      );
    } finally {
      setBusy(false);
    }
  }

  function openReview(item: ModerationCase, resolution: Resolution) {
    setReason("");
    setReview({ item, resolution });
  }

  const canProcess =
    data?.configured && data.mode !== "off" && data.counts.queued > 0;

  return (
    <section
      className="settings-panel moderation-panel"
      aria-labelledby="moderation-heading"
    >
      <div className="moderation-heading">
        <span className="moderation-bot-mark" aria-hidden="true">
          <ShieldCheck size={22} />
        </span>
        <div>
          <h2 id="moderation-heading">@reddix moderation</h2>
          <p>Automated checks, with admins in control.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh moderation"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={17} className={busy ? "spin" : undefined} />
        </button>
      </div>

      {error ? (
        <div className="moderation-state" role="alert">
          <strong>Couldn't load moderation</strong>
          <p>{error}</p>
          <button
            className="button secondary small"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Try again
          </button>
        </div>
      ) : !data ? (
        <p className="moderation-loading" role="status">
          <Loader2 size={16} className="spin" /> Loading moderation
        </p>
      ) : (
        <>
          <div className="moderation-state">
            <strong>
              {!data.configured
                ? "Waiting for an OpenRouter key"
                : data.mode === "off"
                  ? "Automated checks are paused"
                  : data.mode === "review"
                    ? "Review mode"
                    : "Automatic moderation is on"}
            </strong>
            <p>
              {!data.configured
                ? "@reddix is set up. Add OPENROUTER_API_KEY to the server environment to enable AI checks. No AI decisions are being made yet."
                : data.mode === "off"
                  ? "New content is not being checked by AI. Admin reviews remain available."
                  : data.mode === "review"
                    ? "@reddix flags possible violations for an admin. AI checks do not remove content in this mode."
                    : "@reddix can remove clear violations. Uncertain cases come here for an admin to review."}
            </p>
            <Link
              href={`/u/${encodeURIComponent(data.bot.id)}`}
              className="text-link"
            >
              Meet @{data.bot.handle}
            </Link>
          </div>

          <dl className="moderation-configuration">
            <div>
              <dt>Model</dt>
              <dd>{data.model}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>
                {data.mode === "auto"
                  ? "Automatic"
                  : data.mode === "review"
                    ? "Review only"
                    : "Off"}
              </dd>
            </div>
            <div>
              <dt>Daily check limit</dt>
              <dd>{data.dailyLimit.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Today</dt>
              <dd>
                {data.today.requests.toLocaleString()} reserved checks · $
                {data.today.costUsd.toFixed(4)} reported cost
              </dd>
            </div>
          </dl>

          <dl
            className="moderation-counts"
            aria-label="Moderation queue counts"
          >
            <div>
              <dt>Queued</dt>
              <dd>{data.counts.queued}</dd>
            </div>
            <div>
              <dt>To review</dt>
              <dd>{data.counts.review}</dd>
            </div>
            <div>
              <dt>Removed</dt>
              <dd>{data.counts.removed}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{data.counts.failed}</dd>
            </div>
          </dl>
          <div className="moderation-run">
            <button
              className="button secondary small"
              disabled={busy || !canProcess}
              onClick={() => void process()}
            >
              {busy && <Loader2 className="spin" size={15} />} Run queued checks
            </button>
            <p>
              {!data.configured
                ? "Requires an OpenRouter key."
                : data.mode === "off"
                  ? "Enable review or automatic mode on the server to run checks."
                  : "Runs a bounded batch within the daily limit."}
            </p>
          </div>

          <div className="moderation-cases">
            <h3>Review and removal history</h3>
            {!data.cases.length ? (
              <p className="moderation-empty">
                No flagged conversations yet. AI checks and admin decisions will
                appear here.
              </p>
            ) : (
              data.cases.map((item) => (
                <article key={item.id} className="moderation-case">
                  <div className="moderation-case-meta">
                    <span
                      className="moderation-case-status"
                      data-status={item.resolution}
                    >
                      {resolutionLabels[item.resolution]}
                    </span>
                    <span>
                      {item.targetType === "post" ? "Post" : "Comment"} by @
                      {item.authorHandle}
                    </span>
                    <time dateTime={item.createdAt}>
                      {timeAgo(item.createdAt)}
                    </time>
                  </div>
                  <h4>{item.title || "Comment in a conversation"}</h4>
                  <p className="moderation-case-reason">{item.reason}</p>
                  <div className="moderation-case-evidence">
                    <span>{item.category.replaceAll("_", " ")}</span>
                    <span>
                      Model confidence {Math.round(item.confidence * 100)}%
                    </span>
                  </div>
                  <details className="moderation-case-content">
                    <summary>Inspect content and model</summary>
                    <p>{item.body || "No text body."}</p>
                    <small>
                      {item.model} · Content is {item.contentStatus}
                    </small>
                  </details>
                  {item.reviewNote && (
                    <p className="moderation-review-note">
                      <strong>Admin review:</strong> {item.reviewNote}
                    </p>
                  )}
                  <div className="moderation-case-actions">
                    <Link
                      href={`/p/${encodeURIComponent(item.postId)}`}
                      className="button ghost small"
                    >
                      View conversation
                    </Link>
                    {item.resolution === "pending" &&
                      item.contentStatus === "published" && (
                        <>
                          <button
                            className="button secondary small"
                            disabled={busy}
                            onClick={() => openReview(item, "dismiss")}
                          >
                            Dismiss flag
                          </button>
                          <button
                            className="button secondary small"
                            disabled={busy}
                            onClick={() => openReview(item, "remove")}
                          >
                            Remove content
                          </button>
                        </>
                      )}
                    {item.resolution === "removed" &&
                      item.contentStatus === "removed" && (
                        <button
                          className="button secondary small"
                          disabled={busy}
                          onClick={() => openReview(item, "restore")}
                        >
                          Restore content
                        </button>
                      )}
                  </div>
                </article>
              ))
            )}
          </div>

          {!!data.errors.length && (
            <details className="moderation-errors">
              <summary>Recent check failures ({data.errors.length})</summary>
              <p>Failed checks do not remove content.</p>
              {data.errors.map((item) => (
                <div key={item.id}>
                  <strong>
                    {item.targetType === "post" ? "Post" : "Comment"} check
                  </strong>
                  <p>{item.message}</p>
                  <time dateTime={item.createdAt}>
                    {timeAgo(item.createdAt)}
                  </time>
                </div>
              ))}
            </details>
          )}
        </>
      )}

      <Modal
        open={!!review}
        onOpenChange={(open) => !busy && !open && setReview(null)}
        title={review ? actionLabels[review.resolution] : "Review content"}
        description="Record why you made this decision. Your note is visible to other admins."
      >
        <form onSubmit={(event) => void submitReview(event)}>
          <label htmlFor="moderation-review-reason">Review reason</label>
          <textarea
            id="moderation-review-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={5}
            maxLength={1000}
            rows={4}
            required
            autoFocus
          />
          <button
            className="button primary full modal-submit"
            disabled={busy || reason.trim().length < 5}
          >
            {busy && <Loader2 className="spin" size={16} />}
            {review ? actionLabels[review.resolution] : "Save review"}
          </button>
        </form>
      </Modal>
    </section>
  );
}
