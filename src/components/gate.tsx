"use client";
import { useState } from "react";
import Image from "next/image";
import { ArrowRight, BadgeCheck, Github, Loader2, MapPin } from "lucide-react";
import { Logo } from "./ui";
import { XMark } from "./x-brand";
import "./gate-brand.css";

export type AuthStatus = {
  development: boolean;
  xConfigured: boolean;
  inviteRequired: false;
  verificationRequired: true;
  returningMember?: boolean;
};

export default function Gate({
  status,
  onLogin,
  error,
  returnPath = "/popular",
}: {
  status: AuthStatus | null;
  onLogin: () => Promise<void>;
  error?: string;
  returnPath?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>();
  async function devLogin(persona: string) {
    setBusy(persona);
    setNotice(undefined);
    try {
      const res = await fetch("/api/auth/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data.error?.message || "Could not enter local preview.",
        );
      await onLogin();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function xLogin() {
    setBusy("x");
    setNotice(undefined);
    try {
      const res = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "twitter", callbackURL: returnPath }),
      });
      const json = await res.json();
      if (!res.ok || !json.url)
        throw new Error(
          json.error?.message ||
            json.message ||
            "X sign-in is not available yet.",
        );
      window.location.assign(json.url);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Please try again.");
      setBusy(null);
    }
  }

  const xButton = (label: string) => (
    <button
      className="landing-join"
      disabled={!!busy || !status?.xConfigured}
      onClick={xLogin}
    >
      {busy === "x" ? (
        <Loader2 size={19} className="spin" />
      ) : (
        <XMark size={18} />
      )}
      {busy === "x" ? "Connecting to X…" : label}
      <ArrowRight size={18} />
    </button>
  );

  return (
    <div className="landing">
      <main>
        <section className="landing-hero" aria-labelledby="landing-title">
          <Image
            className="landing-backdrop"
            src="/brand/painted-ladies-hero.webp"
            alt=""
            fill
            sizes="(max-width: 1400px) 1400px, 100vw"
            preload
            unoptimized
          />
          <div className="landing-wash" />
          <header className="landing-header">
            <a href="/" aria-label="Reddix home">
              <Logo />
            </a>
            <nav aria-label="Welcome navigation">
              <a href="/support">Help</a>
              <button
                disabled={!!busy || !status?.xConfigured}
                onClick={xLogin}
              >
                Log in <ArrowRight size={15} />
              </button>
            </nav>
          </header>

          <div className="landing-intro">
            <a
              className="landing-eyebrow"
              href="https://github.com/codyzazulak1/reddix"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github size={15} aria-hidden="true" /> An open-source home for
              tech
            </a>
            <h1 id="landing-title">
              The real people of{" "}
              <span className="landing-headline-x">
                <XMark />
                <span className="sr-only">X</span>.
              </span>
              <br />
              The platform of{" "}
              <span className="landing-reddit-word">Reddit</span>.
            </h1>
            <p>
              Find real people in topic-based communities.
              <br className="landing-desktop-break" /> Share ideas, go deep in
              the comments, and meet up IRL.
            </p>
            {xButton(
              status?.returningMember ? "Welcome back with X" : "Join with X",
            )}
            <p className="landing-join-note">Open to verified X accounts.</p>
            {(notice || error) && (
              <p role="alert" className="landing-error">
                {notice || error}
              </p>
            )}
          </div>
          <div className="landing-hero-bottom">
            <div className="landing-location">
              <MapPin size={13} /> Online connections. Real-world community.
            </div>
            <div className="landing-verification">
              <div className="landing-verification-badges" aria-hidden="true">
                <BadgeCheck className="landing-check-blue" size={34} />
              </div>
              <div>
                <h2>Your verification comes with you.</h2>
                <p>
                  Sign up with a blue, gold, or gray check on X. A blue or gold
                  check lets you post, comment, vote, and RSVP.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-details" aria-label="At home on Reddix">
          <div className="landing-feature">
            <span className="landing-feature-icon">
              <XMark size={20} />
            </span>
            <div>
              <h2>Same you. New conversations.</h2>
              <p>
                Bring your name, handle, and profile from X. Find the people who
                share your interests.
              </p>
            </div>
          </div>
          <div className="landing-feature">
            <span className="landing-feature-icon">
              <img
                src="/brand/reddit.svg"
                width={22}
                height={22}
                alt="Reddit"
              />
            </span>
            <div>
              <h2>Already feels familiar.</h2>
              <p>
                Follow communities, upvote great posts, and dive into threaded
                discussions. The Reddit format, with your tech circle.
              </p>
            </div>
          </div>
          <div className="landing-feature">
            <span className="landing-feature-icon">
              <img
                src="/community-logos/github.svg"
                width={22}
                height={22}
                alt="GitHub"
              />
            </span>
            <div>
              <h2>Open source.</h2>
              <p>Explore the code on GitHub.</p>
              <a
                className="landing-source-link"
                href="https://github.com/codyzazulak1/reddix"
                target="_blank"
                rel="noopener noreferrer"
              >
                View source on GitHub <ArrowRight size={14} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>
        {status?.development && (
          <aside
            className="landing-preview"
            aria-label="Local development preview"
          >
            <span>Local preview</span>
            <button disabled={!!busy} onClick={() => devLogin("alex")}>
              {busy === "alex" && <Loader2 className="spin" size={14} />}{" "}
              Verified member <ArrowRight size={13} />
            </button>
            <button disabled={!!busy} onClick={() => devLogin("jamie")}>
              {busy === "jamie" && <Loader2 className="spin" size={14} />}{" "}
              Browse-only <ArrowRight size={13} />
            </button>
          </aside>
        )}
      </main>
      <footer className="landing-footer">
        <div>
          <span>© {new Date().getFullYear()} Reddix</span>
          <p>Independent and open source. Not affiliated with X or Reddit.</p>
        </div>
        <nav aria-label="Legal">
          <a href="/community-guidelines">Guidelines</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </footer>
    </div>
  );
}
