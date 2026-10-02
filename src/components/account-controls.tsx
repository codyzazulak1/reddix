"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Member } from "@/lib/types";
import { Modal } from "./ui";
import { XMark } from "./x-brand";

export function AccountControls({
  member,
  demo,
  onLogout,
}: {
  member: Member;
  demo: boolean;
  onLogout: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(path, init);
    if (!response.ok) {
      const data = await response.json();
      throw new Error(
        data.error?.message || "That account action could not be completed.",
      );
    }
    return response;
  }

  async function exportData() {
    setBusy("export");
    try {
      const response = await request("/api/account/export");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `reddix-account-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Your account export is ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  }

  async function revokeSessions() {
    setBusy("sessions");
    try {
      const response = await request("/api/account/revoke-sessions", {
        method: "POST",
      });
      const data = await response.json();
      toast.success(
        data.revoked
          ? `${data.revoked} other session${data.revoked === 1 ? "" : "s"} signed out.`
          : "You have no other active sessions.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Session update failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    setBusy("delete");
    try {
      await request("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation, deleteContent: true }),
      });
      setDeleting(false);
      toast.success("Your Reddix account and contributions have been deleted.");
      onLogout();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Account deletion failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="settings-panel">
      <h2>Your account</h2>
      <p className="secondary">
        Reddix uses your X account for sign-in. Your private preferences remain
        on Reddix.
      </p>
      {demo && (
        <div className="status-note">
          <span>
            You’re using a fictional account in local development. Live X
            authentication requires developer credentials.
          </span>
        </div>
      )}
      <div className="sync-row">
        <p>
          Your data
          <small>
            Download your profile, preferences, contributions, and registrations
            as JSON.
          </small>
        </p>
        <button
          className="button secondary small"
          disabled={!!busy}
          onClick={() => void exportData()}
        >
          {busy === "export" && <Loader2 size={15} className="spin" />}
          Export data
        </button>
      </div>
      <div className="sync-row">
        <p>
          Other sessions
          <small>Sign out other browsers while keeping this session.</small>
        </p>
        <button
          className="button secondary small"
          disabled={!!busy}
          onClick={() => void revokeSessions()}
        >
          Sign out others
        </button>
      </div>
      <div className="sync-row">
        <p>
          Connected X account
          <small>Manage Reddix’s access in your X connected apps.</small>
        </p>
        <a
          className="button secondary small x-account-link"
          href="https://x.com/settings/connected_apps"
          target="_blank"
          rel="noopener noreferrer"
        >
          <XMark size={15} /> Open X
        </a>
      </div>
      <div className="sync-row">
        <p>Sign out of this browser</p>
        <button className="button secondary small" onClick={onLogout}>
          Sign out
        </button>
      </div>
      <div className="sync-row">
        <p>
          Delete account
          <small>
            Remove your profile and contributions, cancel hosted events, and
            withdraw registrations.
          </small>
        </p>
        <button
          className="button secondary small"
          onClick={() => setDeleting(true)}
        >
          Delete account
        </button>
      </div>
      <Modal
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete your Reddix account?"
        description="This permanently removes your profile, posts, comments, and private account data from active use. Hosted events are canceled and your registrations are withdrawn. Your X account is unaffected."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void deleteAccount();
          }}
        >
          <p className="secondary">
            Sign in within the last 15 minutes to confirm. Minimal security
            records and backups may remain until their retention period ends.
          </p>
          <label htmlFor="delete-account-confirm">
            Type {member.handle} to confirm
          </label>
          <input
            id="delete-account-confirm"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <div className="compose-footer">
            <button
              className="button secondary"
              type="button"
              onClick={() => setDeleting(false)}
            >
              Keep account
            </button>
            <button
              className="button primary"
              disabled={confirmation !== member.handle || !!busy}
            >
              {busy === "delete" && <Loader2 size={16} className="spin" />}
              Delete permanently
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
