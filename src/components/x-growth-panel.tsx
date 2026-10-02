"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import "./x-growth.css";
type Delivery = {
  id: string;
  kind: string;
  state: string;
  preview: string;
  last_error: string | null;
  remote_id: string | null;
};
type Organization = {
  community_id: string;
  name: string;
  handle: string;
  enabled: boolean;
  affiliates: number;
  last_error: string | null;
};
type Data = {
  config: {
    mode: string;
    configured: boolean;
    connected: boolean;
    automationApproved: boolean;
    timeZone: string;
  };
  outbox: Delivery[];
  organizations: Organization[];
  communities: { id: string; name: string }[];
  worker: { value?: { result?: Record<string, string | boolean> } } | null;
};
export function XGrowthPanel() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [community, setCommunity] = useState(""),
    [handle, setHandle] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/x-bot", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message || "Bot settings unavailable");
      setData(body);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bot settings unavailable");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/x-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || "Update unavailable");
      await load();
      toast.success("Bot workspace updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update unavailable");
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/x-bot/connect", {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message || "Connection unavailable");
      window.location.assign(result.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Connection unavailable");
      setBusy(false);
    }
  }
  function link(e: FormEvent) {
    e.preventDefault();
    void act({
      action: "linkOrganization",
      communityId: community,
      handle: handle.replace(/^@/, ""),
    });
  }
  return (
    <section className="settings-panel x-growth-panel">
      <div className="x-growth-heading">
        <div>
          <p className="x-growth-eyebrow">REDDIX ON X</p>
          <h2>Community growth</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh X bot status"
          onClick={() => void load()}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p>Loading bot workspace…</p>
      ) : (
        <>
          <div className="x-growth-status">
            <span className="status-pill">
              {data.config.mode === "off"
                ? "Bot offline"
                : data.config.mode === "dry-run"
                  ? "Preview mode"
                  : "Live mode"}
            </span>
            <span>
              {data.config.connected
                ? "Reddix X account connected"
                : "Waiting for the Reddix X account"}
            </span>
          </div>
          {data.config.configured && (
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() => void connect()}
            >
              {data.config.connected
                ? "Reconnect bot account"
                : "Connect bot account"}
            </button>
          )}
          {typeof window !== "undefined" &&
            new URLSearchParams(window.location.search).get("bot") ===
              "connection-failed" && (
              <p role="alert">
                Could not connect. Check the bot account ID, callback URL, and
                requested permissions, then retry.
              </p>
            )}
          <p className="secondary">
            Public discussion previews and daily highlights. Daily highlights
            use {data.config.timeZone}.{" "}
            {data.config.mode === "live" && !data.config.automationApproved
              ? "Live delivery is waiting for the X automation activation check."
              : ""}
          </p>
          {data.worker?.value?.result?.error && (
            <p role="alert">
              Bot needs attention: {String(data.worker.value.result.error)}.
              Reconnect the account or check its API access.
            </p>
          )}
          <details>
            <summary>
              Publishing queue <span>{data.outbox.length}</span>
            </summary>
            {!data.outbox.length ? (
              <p className="secondary">
                New posts approved for sharing will appear here.
              </p>
            ) : (
              data.outbox.map((item) => (
                <div className="x-growth-row" key={item.id}>
                  <div>
                    <strong>
                      {item.kind === "digest"
                        ? "Daily highlights"
                        : "New discussion"}
                    </strong>
                    <p className="x-growth-preview">{item.preview}</p>
                    <span className="status-pill">{item.state}</span>
                    {item.last_error && <p>{item.last_error}</p>}
                    {item.remote_id && (
                      <a
                        href={`https://x.com/i/status/${item.remote_id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View on X
                      </a>
                    )}
                  </div>
                  <div className="x-growth-actions">
                    {["preview", "error"].includes(item.state) && (
                      <button
                        disabled={busy}
                        className="button secondary small"
                        onClick={() =>
                          void act({ action: "retryDelivery", id: item.id })
                        }
                      >
                        Queue delivery
                      </button>
                    )}
                    {item.state === "uncertain" && (
                      <>
                        <button
                          disabled={busy}
                          className="button secondary small"
                          onClick={() => {
                            const remoteId = window.prompt(
                              "After checking X, enter the delivered post ID:",
                            );
                            if (remoteId)
                              void act({
                                action: "confirmDelivered",
                                id: item.id,
                                remoteId,
                              });
                          }}
                        >
                          Confirm delivered
                        </button>
                        <button
                          disabled={busy}
                          className="button secondary small"
                          onClick={() => {
                            if (
                              window.confirm(
                                "Confirm you checked the bot’s X account and this item was NOT sent. Retrying an item that was sent creates a duplicate.",
                              )
                            )
                              void act({
                                action: "retryDelivery",
                                id: item.id,
                                confirmedNotSent: true,
                              });
                          }}
                        >
                          Checked X: retry
                        </button>
                      </>
                    )}
                    {["queued", "preview", "error", "uncertain"].includes(
                      item.state,
                    ) && (
                      <button
                        disabled={busy}
                        className="button ghost small"
                        onClick={() =>
                          void act({ action: "cancelDelivery", id: item.id })
                        }
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </details>
          <details>
            <summary>
              Organization affiliates <span>{data.organizations.length}</span>
            </summary>
            <p className="secondary">
              Link each community to its real business account. Only people in
              that organization’s official X Affiliates list receive
              discussion-leader badges. This does not give moderation powers or
              imply the company operates Reddix.
            </p>
            <form className="x-growth-link" onSubmit={link}>
              <label>
                Community
                <select
                  required
                  value={community}
                  onChange={(e) => setCommunity(e.target.value)}
                >
                  <option value="">Choose a community</option>
                  {data.communities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                X business account
                <input
                  required
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="@speedrun"
                  maxLength={16}
                />
              </label>
              <button
                className="button secondary small"
                disabled={
                  busy || !data.config.configured || data.config.mode === "off"
                }
              >
                Verify and link
              </button>
            </form>
            {data.organizations.map((o) => (
              <div className="x-growth-row" key={o.community_id}>
                <div>
                  <strong>{o.name}</strong>
                  <p>
                    <a
                      href={`https://x.com/${o.handle}/affiliates`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      @{o.handle} affiliates
                    </a>{" "}
                    · {o.affiliates} verified ·{" "}
                    {o.enabled ? "Connected" : "Disconnected"}
                  </p>
                  {o.last_error && <p>{o.last_error}</p>}
                </div>
                {o.enabled && (
                  <button
                    disabled={busy}
                    className="button ghost small"
                    onClick={() =>
                      void act({
                        action: "unlinkOrganization",
                        communityId: o.community_id,
                      })
                    }
                  >
                    Disconnect
                  </button>
                )}
              </div>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
