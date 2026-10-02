"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  ChevronDown,
  ChevronUp,
  Maximize2,
  MessageSquare,
  Plus,
  X,
} from "lucide-react";
import type { Member } from "@/lib/types";
import { cn } from "@/lib/utils";
import ChatView from "./ChatView";
import { useChatSession } from "./ChatSession";
import "./quick-chat.css";

export default function QuickChat({
  member,
  unreadCount,
  onUnreadChange,
  onNavigate,
  suspended = false,
}: {
  member: Member;
  unreadCount: number;
  onUnreadChange: (count: number) => void;
  onNavigate: (path: string) => void;
  suspended?: boolean;
}) {
  const { state, update } = useChatSession(member.id);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const open = state.mode === "open";
  const [pathname, query = ""] = state.path.split("?");
  const conversationId = pathname.split("/")[2] || undefined;
  const recipientId = new URLSearchParams(query).get("to") || undefined;

  useEffect(() => {
    if (open && !wasOpen.current) {
      const previous = document.activeElement;
      if (
        previous instanceof HTMLElement &&
        previous !== document.body &&
        !previous.closest(".quick-chat")
      )
        opener.current = previous;
      panel.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);

  const navigateChat = useCallback(
    (path: string) => {
      if (path === "/chat" || path.startsWith("/chat/")) update({ path });
      else onNavigate(path);
    },
    [update, onNavigate],
  );

  function restoreFocus() {
    const previous = opener.current;
    if (previous?.isConnected && previous.getClientRects().length)
      previous.focus({ preventScroll: true });
    else
      document
        .querySelector<HTMLButtonElement>(".chat-header-button")
        ?.focus({ preventScroll: true });
  }
  function close() {
    update({ mode: "closed" });
    restoreFocus();
  }
  function minimize() {
    update({ mode: "minimized" });
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(".quick-chat-restore")
        ?.focus({ preventScroll: true }),
    );
  }
  function expand() {
    update({ mode: "closed" });
    onNavigate(state.path);
  }

  if (state.mode === "closed") return null;

  return (
    <div
      inert={suspended}
      className={cn(
        "quick-chat",
        conversationId && "quick-chat-selected",
        !open && "quick-chat-minimized",
      )}
    >
      {!open && (
        <div className="quick-chat-bar">
          <button
            className="quick-chat-restore"
            aria-label="Restore chat"
            onClick={() => update({ mode: "open" })}
          >
            <MessageSquare size={19} />
            <span>Chat</span>
            {unreadCount > 0 && (
              <span className="chat-unread-count">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
            <ChevronUp size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Close chat"
            title="Close chat"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
      )}
      <div
        id="quick-chat-panel"
        className="quick-chat-panel"
        role="dialog"
        aria-label="Quick chat"
        tabIndex={-1}
        ref={panel}
        hidden={!open}
        inert={!open}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            !event.defaultPrevented &&
            event.currentTarget.contains(event.target as Node)
          ) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <header className="quick-chat-heading">
          <h2>
            Chat{" "}
            {unreadCount > 0 && (
              <span className="chat-unread-count">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </h2>
          <div className="quick-chat-controls">
            <button
              className="icon-button"
              aria-label="New message"
              title="New message"
              onClick={() => update({ path: "/chat/new" })}
              disabled={!member.eligible}
            >
              <Plus size={20} />
            </button>
            <button
              className="icon-button"
              aria-label="Open full chat"
              title="Open full chat"
              onClick={expand}
            >
              <Maximize2 size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Minimize chat"
              title="Minimize chat"
              onClick={minimize}
            >
              <ChevronDown size={20} />
            </button>
            <button
              className="icon-button"
              aria-label="Close chat"
              title="Close chat"
              onClick={close}
            >
              <X size={19} />
            </button>
          </div>
        </header>
        <ChatView
          member={member}
          conversationId={conversationId}
          recipientId={recipientId}
          onNavigate={navigateChat}
          onUnreadChange={onUnreadChange}
          active={open && !suspended}
          compact
        />
      </div>
    </div>
  );
}
