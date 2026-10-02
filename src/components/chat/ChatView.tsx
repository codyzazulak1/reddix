"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Ban,
  Check,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { Member, PublicMember } from "@/lib/types";
import type {
  ChatConversation,
  ChatInbox,
  ChatMessage,
} from "@/lib/chat-types";
import { Avatar, Badge, Modal } from "../ui";
import { ChatListSkeleton, ChatThreadSkeleton } from "../loading-skeletons";
import { cn, timeAgo } from "@/lib/utils";
import { useChatDelivery, useChatDraft } from "./ChatSession";
import "./chat.css";

type ConversationResponse = {
  conversation: ChatConversation;
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor: string | null;
};
type Props = {
  member: Member;
  onNavigate: (path: string) => void;
  conversationId?: string;
  recipientId?: string;
  onUnreadChange?: (count: number) => void;
  active?: boolean;
  compact?: boolean;
};
const emptyInbox: ChatInbox = {
  conversations: [],
  requests: [],
  unreadCount: 0,
};
const messageLimit = 4000;

async function chatApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.message || "Something went wrong. Please try again.",
    );
  return data as T;
}
function chatAction<T = unknown>(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
) {
  return chatApi<T>("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
}
function messageError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
function mergeMessages(previous: ChatMessage[], current: ChatMessage[]) {
  const byId = new Map(previous.map((message) => [message.id, message]));
  current.forEach((message) => byId.set(message.id, message));
  return [...byId.values()].sort((a, b) => {
    const left = BigInt(a.sequence);
    const right = BigInt(b.sequence);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
function dateLabel(value: string) {
  const date = new Date(value);
  if (date.toDateString() === new Date().toDateString()) return "Today";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  }).format(date);
}
function PeerName({ peer }: { peer: PublicMember }) {
  return (
    <span className="chat-peer-name">
      <span>{peer.name}</span>
      <Badge type={peer.verificationType} />
    </span>
  );
}

export default function ChatView({
  member,
  onNavigate,
  conversationId,
  recipientId,
  onUnreadChange,
  active = true,
  compact = false,
}: Props) {
  const viewId = useId();
  const [inbox, setInbox] = useState<ChatInbox>(emptyInbox);
  const [tab, setTab] = useState<"chats" | "requests">("chats");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const unreadCallback = useRef(onUnreadChange);
  const selectedFolder = useRef<string | undefined>(undefined);
  unreadCallback.current = onUnreadChange;
  const refreshInbox = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    async function refresh() {
      if (running || controller.signal.aborted || document.hidden) return;
      running = true;
      clearTimeout(timer);
      try {
        const result = await chatApi<ChatInbox>("/api/chat", {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setInbox(result);
          unreadCallback.current?.(result.unreadCount);
          setError("");
        }
      } catch (caught) {
        if (!controller.signal.aborted) setError(messageError(caught));
      } finally {
        running = false;
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(refresh, 5000);
        }
      }
    }
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [revision, member.id, active]);

  useEffect(() => {
    if (!conversationId || loading || selectedFolder.current === conversationId)
      return;
    selectedFolder.current = conversationId;
    setTab(
      inbox.requests.some((item) => item.id === conversationId)
        ? "requests"
        : "chats",
    );
  }, [conversationId, inbox.requests, loading]);

  const existingRecipient = recipientId
    ? [...inbox.conversations, ...inbox.requests].find(
        (item) => item.peer.id === recipientId,
      )
    : undefined;
  useEffect(() => {
    if (active && conversationId === "new" && existingRecipient)
      onNavigate(`/chat/${existingRecipient.id}`);
  }, [active, conversationId, existingRecipient?.id, onNavigate]);

  const rows = tab === "requests" ? inbox.requests : inbox.conversations;
  function switchTab(next: "chats" | "requests") {
    setTab(next);
    document.getElementById(`${viewId}-tab-${next}`)?.focus();
  }
  return (
    <section
      className={cn(
        "chat-view",
        conversationId && "chat-has-selection",
        compact && "chat-view-compact",
      )}
      aria-label="Messages"
    >
      <aside className="chat-inbox">
        <div className="chat-inbox-heading">
          <h1>Messages</h1>
          <button
            className="icon-button"
            aria-label="New message"
            title="New message"
            onClick={() => onNavigate("/chat/new")}
            disabled={!member.eligible}
          >
            <Plus size={20} />
          </button>
        </div>
        <div
          className="chat-tabs"
          role="tablist"
          aria-label="Message folders"
          onKeyDown={(event) => {
            if (
              ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            ) {
              event.preventDefault();
              switchTab(
                event.key === "Home"
                  ? "chats"
                  : event.key === "End"
                    ? "requests"
                    : tab === "chats"
                      ? "requests"
                      : "chats",
              );
            }
          }}
        >
          <button
            role="tab"
            id={`${viewId}-tab-chats`}
            aria-controls={`${viewId}-conversation-list`}
            aria-selected={tab === "chats"}
            tabIndex={tab === "chats" ? 0 : -1}
            onClick={() => setTab("chats")}
          >
            Chats
            {inbox.unreadCount > 0 && (
              <span className="chat-count">{inbox.unreadCount}</span>
            )}
          </button>
          <button
            role="tab"
            id={`${viewId}-tab-requests`}
            aria-controls={`${viewId}-conversation-list`}
            aria-selected={tab === "requests"}
            tabIndex={tab === "requests" ? 0 : -1}
            onClick={() => setTab("requests")}
          >
            Requests
            {inbox.requests.length > 0 && (
              <span className="chat-request-count">
                {inbox.requests.length}
              </span>
            )}
          </button>
        </div>
        {tab === "requests" && (
          <p className="chat-folder-note">
            You choose who can reach you. Requests stay here until you accept.
          </p>
        )}
        <div
          className="chat-conversation-list"
          id={`${viewId}-conversation-list`}
          role="tabpanel"
          aria-labelledby={`${viewId}-tab-${tab}`}
        >
          {error && (
            <div className="chat-inline-error" role="status">
              <p>{error}</p>
              <button onClick={refreshInbox}>Try again</button>
            </div>
          )}
          {loading ? (
            <ChatListSkeleton />
          ) : rows.length === 0 ? (
            <div className="chat-list-empty">
              <h2>
                {tab === "requests" ? "All clear" : "Start a conversation"}
              </h2>
              <p>
                {tab === "requests"
                  ? "New message requests will appear here, without a notification."
                  : "Reach out to someone in your community. Your first message gives them a chance to say hello."}
              </p>
            </div>
          ) : (
            rows.map((conversation) => (
              <button
                key={conversation.id}
                className={cn(
                  "chat-conversation-row",
                  conversationId === conversation.id && "selected",
                  conversation.unreadCount > 0 && "unread",
                )}
                aria-current={
                  conversationId === conversation.id ? "page" : undefined
                }
                onClick={() => onNavigate(`/chat/${conversation.id}`)}
              >
                <Avatar member={conversation.peer} />
                <span className="chat-row-content">
                  <span className="chat-row-top">
                    <PeerName peer={conversation.peer} />
                    <time dateTime={conversation.updatedAt}>
                      {timeAgo(conversation.updatedAt).replace(" ago", "")}
                    </time>
                  </span>
                  <span className="chat-row-preview">
                    {conversation.status === "closed"
                      ? "Conversation closed"
                      : conversation.status === "pending" &&
                          conversation.direction === "outgoing"
                        ? "Request sent"
                        : conversation.lastMessage?.body || "Say hello"}
                  </span>
                </span>
                {conversation.unreadCount > 0 &&
                  conversation.status === "accepted" && (
                    <span
                      className="chat-unread-dot"
                      aria-label={`${conversation.unreadCount} unread messages`}
                    />
                  )}
              </button>
            ))
          )}
        </div>
        <p className="chat-inbox-footer">
          Private conversations. No unexpected interruptions.
        </p>
      </aside>
      <div className="chat-main">
        {conversationId === "new" && (loading || existingRecipient) ? (
          <ChatThreadSkeleton />
        ) : conversationId === "new" ? (
          <NewConversation
            key={recipientId || "new"}
            member={member}
            recipientId={recipientId}
            conversations={[...inbox.conversations, ...inbox.requests]}
            onNavigate={onNavigate}
            onUpdate={refreshInbox}
            active={active}
          />
        ) : conversationId ? (
          <Conversation
            key={conversationId}
            id={conversationId}
            member={member}
            onNavigate={onNavigate}
            onUpdate={refreshInbox}
            active={active}
          />
        ) : (
          <div className="chat-welcome">
            <h2>Your messages</h2>
            <p>
              Choose a conversation or reach out to someone in the community.
              New connections start with a request you can accept or decline.
            </p>
            <button
              className="button primary"
              onClick={() => onNavigate("/chat/new")}
              disabled={!member.eligible}
            >
              Write a message
            </button>
            {!member.eligible && (
              <span className="chat-eligibility-note">
                X verification is required to send messages.
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function NewConversation({
  member,
  recipientId,
  conversations,
  onNavigate,
  onUpdate,
  active,
}: {
  member: Member;
  recipientId?: string;
  conversations: ChatConversation[];
  onNavigate: Props["onNavigate"];
  onUpdate: () => void;
  active: boolean;
}) {
  const formId = useId();
  const [recipient, setRecipient] = useState<PublicMember | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PublicMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [body, setBody] = useChatDraft(
    member.id,
    recipientId ? `new:${recipientId}` : "new",
  );
  const [genericBody, setGenericBody] = useChatDraft(member.id, "new");
  const delivery = useChatDelivery(
    member.id,
    `request:${recipientId || "new"}`,
  );
  const busy = delivery.pending;
  const [error, setError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (recipientId && genericBody) {
      setBody((current) => current || genericBody);
      setGenericBody("");
    }
  }, [recipientId, genericBody, setBody, setGenericBody]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setSearchError("");
    const exact = recipientId && !recipient && !query;
    if (recipient || (!exact && query.trim().length < 2)) {
      setMatches([]);
      setSearching(false);
      return () => controller.abort();
    }
    setSearching(true);
    const timer = setTimeout(
      async () => {
        try {
          const result = await chatApi<{ members: PublicMember[] }>(
            `/api/chat/members?${exact ? `id=${encodeURIComponent(recipientId)}` : `q=${encodeURIComponent(query.trim())}`}`,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          if (exact) {
            if (result.members[0]) setRecipient(result.members[0]);
            else setSearchError("This member isn't available for chat.");
          } else setMatches(result.members);
        } catch (caught) {
          if (!controller.signal.aborted) setSearchError(messageError(caught));
        } finally {
          if (!controller.signal.aborted) setSearching(false);
        }
      },
      exact ? 0 : 250,
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, query, recipientId, recipient, searchRevision]);

  async function sendRequest() {
    if (!active || !recipient || !body.trim() || busy || !member.eligible)
      return;
    const message = body.trim();
    const clientId = delivery.begin(message);
    if (!clientId) return;
    let sent = false;
    setError("");
    try {
      const result = await chatAction<{ conversationId: string }>({
        action: "request",
        recipientId: recipient.id,
        body: message,
        clientId,
      });
      sent = true;
      setBody((current) => (current.trim() === message ? "" : current));
      if (!mounted.current) return;
      onUpdate();
      onNavigate(`/chat/${result.conversationId}`);
    } catch (caught) {
      if (mounted.current) setError(messageError(caught));
    } finally {
      delivery.finish(clientId, sent);
    }
  }
  return (
    <div className="chat-new">
      <div className="chat-thread-heading">
        <button
          className="icon-button"
          aria-label="Back to messages"
          onClick={() => onNavigate("/chat")}
        >
          <ArrowLeft size={20} />
        </button>
        <h2>New message</h2>
      </div>
      <div className="chat-new-content">
        <label htmlFor={`${formId}-member-search`}>To</label>
        {recipient ? (
          <div className="chat-selected-recipient">
            <Avatar member={recipient} />
            <span>
              <PeerName peer={recipient} />
              <small>@{recipient.handle}</small>
            </span>
            <button
              className="icon-button"
              aria-label="Change recipient"
              onClick={() => {
                onNavigate("/chat/new");
                setRecipient(null);
                setQuery("");
              }}
              disabled={busy}
            >
              <X size={17} />
            </button>
          </div>
        ) : (
          <>
            <div className="chat-search">
              <Search size={17} />
              <input
                id={`${formId}-member-search`}
                aria-label="Search members"
                placeholder="Search by name or X handle"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
                autoFocus={active && !recipientId}
              />
            </div>
            <div className="chat-search-results" aria-live="polite">
              {searching ? (
                <p className="chat-loading">
                  <Loader2 size={16} className="spin" />
                  Looking for members
                </p>
              ) : searchError ? (
                <div className="chat-inline-error">
                  <p>{searchError}</p>
                  <button
                    onClick={() => setSearchRevision((value) => value + 1)}
                  >
                    Try again
                  </button>
                </div>
              ) : (
                matches.map((person) => (
                  <button
                    className="chat-person-result"
                    key={person.id}
                    onClick={() => {
                      const existing = conversations.find(
                        (item) => item.peer.id === person.id,
                      );
                      if (existing) onNavigate(`/chat/${existing.id}`);
                      else
                        onNavigate(
                          `/chat/new?to=${encodeURIComponent(person.id)}`,
                        );
                      setError("");
                    }}
                  >
                    <Avatar member={person} />
                    <span>
                      <PeerName peer={person} />
                      <small>@{person.handle}</small>
                    </span>
                    <Plus size={16} />
                  </button>
                ))
              )}
              {!searching &&
                !searchError &&
                query.trim().length >= 2 &&
                matches.length === 0 && (
                  <p className="chat-search-note">
                    No members found. Try another name or handle.
                  </p>
                )}
            </div>
          </>
        )}
        <div className="chat-request-intro">
          <h3>Start with an introduction.</h3>
          <p>
            Your first message goes to their requests. You can keep talking once
            they accept. Requests don’t send notifications.
          </p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void sendRequest();
          }}
        >
          <label htmlFor={`${formId}-request-body`}>Message request</label>
          <textarea
            id={`${formId}-request-body`}
            placeholder={
              recipient
                ? `Say hello to ${recipient.name.split(" ")[0]}…`
                : "A little context goes a long way…"
            }
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={messageLimit}
            rows={5}
            disabled={busy || !member.eligible}
            required
          />
          {!member.eligible && (
            <p className="chat-eligibility-note">
              X verification is required to send messages.
            </p>
          )}
          {error && (
            <p className="chat-inline-error" role="alert">
              {error} Your message is still here. You can retry.
            </p>
          )}
          <div className="chat-new-actions">
            <span>
              {body.length > messageLimit - 500
                ? `${body.length.toLocaleString()} / ${messageLimit.toLocaleString()}`
                : "Your message stays in their requests until accepted."}
            </span>
            <button
              type="submit"
              className="button primary"
              disabled={!recipient || !body.trim() || busy || !member.eligible}
            >
              {busy ? (
                <>
                  <Loader2 size={16} className="spin" />
                  Sending
                </>
              ) : error ? (
                "Retry request"
              ) : (
                "Send request"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Conversation({
  id,
  member,
  onNavigate,
  onUpdate,
  active,
}: {
  id: string;
  member: Member;
  onNavigate: Props["onNavigate"];
  onUpdate: () => void;
  active: boolean;
}) {
  const composerId = useId();
  const [data, setData] = useState<ConversationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [draft, setDraft] = useChatDraft(member.id, `conversation:${id}`);
  const delivery = useChatDelivery(member.id, `send:${id}`);
  const [busy, setBusy] = useState("");
  const [olderBusy, setOlderBusy] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const [revision, setRevision] = useState(0);
  const scrollArea = useRef<HTMLDivElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const restoreComposerFocus = useRef(false);
  const latestMessage = useRef<HTMLTimeElement>(null);
  const mounted = useRef(true);
  const nearBottom = useRef(true);
  const scrollIntent = useRef<
    "bottom" | { height: number; top: number } | null
  >("bottom");
  const olderLoaded = useRef(false);
  const lastId = useRef<string | undefined>(undefined);
  const markedRead = useRef<string | undefined>(undefined);
  const olderController = useRef<AbortController | null>(null);
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      olderController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!active) restoreComposerFocus.current = false;
    if (active && !busy && restoreComposerFocus.current) {
      restoreComposerFocus.current = false;
      composerInput.current?.focus({ preventScroll: true });
    }
  }, [active, busy]);

  useEffect(() => {
    if (!active) {
      olderController.current?.abort();
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    async function poll() {
      if (running || document.hidden || controller.signal.aborted) return;
      running = true;
      clearTimeout(timer);
      try {
        const result = await chatApi<ConversationResponse>(
          `/api/chat/${encodeURIComponent(id)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        const currentLast = result.messages.at(-1)?.id;
        if (currentLast !== lastId.current) {
          if (nearBottom.current) scrollIntent.current = "bottom";
          else if (lastId.current) setNewMessages(true);
          lastId.current = currentLast;
        }
        setData((previous) => ({
          ...result,
          messages: mergeMessages(previous?.messages || [], result.messages),
          hasMore: olderLoaded.current
            ? previous?.hasMore || false
            : result.hasMore,
          nextCursor: olderLoaded.current
            ? previous?.nextCursor || null
            : result.nextCursor,
        }));
        setLoadError("");
      } catch (caught) {
        if (!controller.signal.aborted) setLoadError(messageError(caught));
      } finally {
        running = false;
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(poll, 4500);
        }
      }
    }
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [id, revision, active]);

  useLayoutEffect(() => {
    const area = scrollArea.current;
    if (!active || !area || !scrollIntent.current) return;
    if (scrollIntent.current === "bottom") {
      area.scrollTop = area.scrollHeight;
      nearBottom.current = true;
      setNewMessages(false);
    } else
      area.scrollTop =
        scrollIntent.current.top +
        area.scrollHeight -
        scrollIntent.current.height;
    scrollIntent.current = null;
  }, [data, active]);

  const lastMessageId = data?.messages.at(-1)?.id;
  useEffect(() => {
    const node = latestMessage.current;
    if (
      !active ||
      !node ||
      !lastMessageId ||
      data?.conversation.status !== "accepted" ||
      markedRead.current === lastMessageId
    )
      return;
    const controller = new AbortController();
    let visible = false;
    let reading = false;
    async function markRead() {
      if (
        !visible ||
        document.hidden ||
        controller.signal.aborted ||
        reading ||
        markedRead.current === lastMessageId
      )
        return;
      reading = true;
      try {
        await chatAction(
          { action: "read", conversationId: id, messageId: lastMessageId },
          controller.signal,
        );
        if (!controller.signal.aborted) {
          markedRead.current = lastMessageId;
          onUpdate();
        }
      } catch {
        /* Reading is best effort; a later visible update retries it. */
      } finally {
        reading = false;
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible) void markRead();
      },
      { root: scrollArea.current, threshold: 0.5 },
    );
    observer.observe(node);
    const retryTimer = setInterval(() => void markRead(), 5000);
    const onVisible = () => {
      if (!document.hidden) void markRead();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      observer.disconnect();
      clearInterval(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, data?.conversation.status, lastMessageId, id, onUpdate]);

  async function loadOlder() {
    if (!active || !data?.hasMore || !data.nextCursor || olderBusy) return;
    const controller = new AbortController();
    olderController.current = controller;
    setOlderBusy(true);
    setActionError("");
    try {
      const result = await chatApi<ConversationResponse>(
        `/api/chat/${encodeURIComponent(id)}?before=${encodeURIComponent(data.nextCursor)}`,
        { signal: controller.signal },
      );
      if (!mounted.current || controller.signal.aborted) return;
      const area = scrollArea.current;
      if (area)
        scrollIntent.current = {
          height: area.scrollHeight,
          top: area.scrollTop,
        };
      olderLoaded.current = true;
      setData((previous) => ({
        ...result,
        conversation: previous?.conversation || result.conversation,
        messages: mergeMessages(result.messages, previous?.messages || []),
      }));
    } catch (caught) {
      if (!controller.signal.aborted) setActionError(messageError(caught));
    } finally {
      if (mounted.current) setOlderBusy(false);
    }
  }
  async function update(action: "accept" | "decline" | "block") {
    if (!active || busy) return;
    setBusy(action);
    setActionError("");
    try {
      await chatAction({ action, conversationId: id });
      if (!mounted.current) return;
      setBlockOpen(false);
      onUpdate();
      if (action === "decline") onNavigate("/chat");
      else refresh();
    } catch (caught) {
      if (mounted.current) setActionError(messageError(caught));
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  async function send() {
    if (
      !active ||
      !draft.trim() ||
      busy ||
      delivery.pending ||
      !data?.conversation.canSend ||
      !member.eligible
    )
      return;
    const body = draft.trim();
    const clientId = delivery.begin(body);
    if (!clientId) return;
    let sent = false;
    setBusy("send");
    restoreComposerFocus.current = true;
    setActionError("");
    try {
      await chatAction({
        action: "send",
        conversationId: id,
        body,
        clientId,
      });
      sent = true;
      setDraft((current) => (current.trim() === body ? "" : current));
      if (!mounted.current) return;
      scrollIntent.current = "bottom";
      nearBottom.current = true;
      onUpdate();
      refresh();
    } catch (caught) {
      if (mounted.current) setActionError(messageError(caught));
    } finally {
      delivery.finish(clientId, sent);
      if (mounted.current) setBusy("");
    }
  }
  function scrollToBottom() {
    const area = scrollArea.current;
    if (area)
      area.scrollTo({
        top: area.scrollHeight,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    nearBottom.current = true;
    setNewMessages(false);
  }
  const conversation = data?.conversation;
  if (loading) return <ChatThreadSkeleton />;
  if (!conversation)
    return (
      <div className="chat-thread-failure">
        <h2>Conversation unavailable</h2>
        <p>{loadError || "This conversation could not be found."}</p>
        <button className="button secondary" onClick={refresh}>
          Try again
        </button>
        <button className="button ghost" onClick={() => onNavigate("/chat")}>
          Back to messages
        </button>
      </div>
    );
  const incoming =
    conversation.status === "pending" && conversation.direction === "incoming";
  return (
    <div className="chat-thread" data-testid="chat-thread">
      <div className="chat-thread-heading">
        <button
          className="icon-button chat-mobile-back"
          aria-label="Back to messages"
          onClick={() => onNavigate("/chat")}
        >
          <ArrowLeft size={20} />
        </button>
        <button
          className="chat-thread-person"
          onClick={() => onNavigate(`/u/${conversation.peer.id}`)}
        >
          <Avatar member={conversation.peer} />
          <span>
            <PeerName peer={conversation.peer} />
            <small>@{conversation.peer.handle}</small>
          </span>
        </button>
        <Dropdown.Root>
          <Dropdown.Trigger
            className="icon-button"
            aria-label="Conversation options"
          >
            <MoreHorizontal size={21} />
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content
              className="dropdown-content"
              align="end"
              sideOffset={8}
            >
              <Dropdown.Item
                onSelect={() => onNavigate(`/u/${conversation.peer.id}`)}
              >
                View profile
              </Dropdown.Item>
              <Dropdown.Item
                onSelect={() => setBlockOpen(true)}
                disabled={conversation.isBlocked}
              >
                Block member
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      </div>
      {loadError && (
        <div className="chat-inline-error chat-poll-error" role="status">
          <span>Couldn’t refresh messages.</span>
          <button onClick={refresh}>Retry</button>
        </div>
      )}
      <div
        className="chat-messages"
        ref={scrollArea}
        onScroll={() => {
          const area = scrollArea.current;
          if (area) {
            nearBottom.current =
              area.scrollHeight - area.scrollTop - area.clientHeight < 70;
            if (nearBottom.current) setNewMessages(false);
          }
        }}
      >
        {data.hasMore && (
          <button
            className="chat-load-older"
            onClick={() => void loadOlder()}
            disabled={olderBusy}
          >
            {olderBusy ? (
              <>
                <Loader2 size={14} className="spin" />
                Loading
              </>
            ) : (
              "Load earlier messages"
            )}
          </button>
        )}
        <div className="chat-conversation-start">
          <Avatar member={conversation.peer} size="large" />
          <PeerName peer={conversation.peer} />
          <span>@{conversation.peer.handle}</span>
          {conversation.peer.bio && <p>{conversation.peer.bio}</p>}
        </div>
        <div
          className="chat-message-log"
          role="log"
          aria-label="Conversation messages"
          aria-live={
            active && conversation.status === "accepted" ? "polite" : "off"
          }
          aria-relevant="additions"
        >
          {data.messages.map((message, index) => {
            const own = message.senderId === member.id;
            const previous = data.messages[index - 1];
            const newDay =
              !previous ||
              new Date(previous.createdAt).toDateString() !==
                new Date(message.createdAt).toDateString();
            return (
              <div key={message.id} className="chat-message-group">
                {newDay && (
                  <div className="chat-day">
                    <span>{dateLabel(message.createdAt)}</span>
                  </div>
                )}
                <div
                  className={cn("chat-message", own && "own")}
                  data-testid="chat-message"
                >
                  <span className="sr-only">
                    {own ? "You" : conversation.peer.name}:{" "}
                  </span>
                  <div
                    className={cn(
                      "chat-bubble",
                      !message.body && "chat-message-removed",
                    )}
                  >
                    {message.body || "Message removed"}
                  </div>
                  <time
                    ref={
                      index === data.messages.length - 1
                        ? latestMessage
                        : undefined
                    }
                    dateTime={message.createdAt}
                    title={new Date(message.createdAt).toLocaleString()}
                  >
                    {new Intl.DateTimeFormat("en", {
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(message.createdAt))}
                  </time>
                </div>
              </div>
            );
          })}
        </div>
        <div className="chat-scroll-end" />
      </div>
      {newMessages && (
        <button className="chat-jump" onClick={scrollToBottom}>
          New messages
          <ArrowDown size={14} />
        </button>
      )}
      {actionError && !blockOpen && (
        <div className="chat-inline-error chat-action-error" role="alert">
          {actionError}
          {draft && " Your message is still here. Try sending it again."}
        </div>
      )}
      {incoming ? (
        <div className="chat-request-decision">
          <h3>{conversation.peer.name.split(" ")[0]} wants to chat.</h3>
          <p>Accept to reply. They won’t see when you read this request.</p>
          <div>
            <button
              className="button primary"
              onClick={() => void update("accept")}
              disabled={!!busy || delivery.pending}
            >
              {busy === "accept" ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}
              Accept request
            </button>
            <button
              className="button secondary"
              onClick={() => void update("decline")}
              disabled={!!busy}
            >
              Decline
            </button>
            <button
              className="button ghost"
              onClick={() => setBlockOpen(true)}
              disabled={!!busy}
            >
              Block
            </button>
          </div>
        </div>
      ) : conversation.status === "pending" ? (
        <div className="chat-thread-notice">
          <h3>Request sent</h3>
          <p>
            You can send more messages after{" "}
            {conversation.peer.name.split(" ")[0]} accepts.
          </p>
        </div>
      ) : conversation.status === "closed" ? (
        <div className="chat-thread-notice">
          <h3>Conversation closed</h3>
          <p>
            {conversation.isBlocked
              ? "This conversation is blocked. No further messages can be sent."
              : "You can’t send messages in this conversation."}
          </p>
        </div>
      ) : !member.eligible || !conversation.canSend ? (
        <div className="chat-thread-notice">
          <p>
            {!member.eligible
              ? "X verification is required to send messages. You can still read your conversations."
              : "You can’t send messages in this conversation right now."}
          </p>
        </div>
      ) : (
        <form
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor={`${composerId}-message`} className="sr-only">
            Message
          </label>
          <div className="chat-compose-input">
            <textarea
              ref={composerInput}
              id={`${composerId}-message`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Write a message…"
              maxLength={messageLimit}
              rows={2}
              disabled={!!busy || delivery.pending}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button
              className="chat-send"
              type="submit"
              aria-label="Send message"
              disabled={!draft.trim() || !!busy || delivery.pending}
            >
              {busy === "send" || delivery.pending ? (
                <Loader2 size={18} className="spin" />
              ) : (
                <ArrowUp size={20} />
              )}
            </button>
          </div>
          <p>
            <span>Enter to send · Shift + Enter for a new line</span>
            {draft.length > messageLimit - 500 && (
              <span>
                {draft.length.toLocaleString()} /{" "}
                {messageLimit.toLocaleString()}
              </span>
            )}
          </p>
        </form>
      )}
      <Modal
        open={active && blockOpen}
        onOpenChange={setBlockOpen}
        title={`Block ${conversation.peer.name}?`}
        description="They won’t be able to send you messages or new requests. This conversation will close."
      >
        <div className="chat-block-dialog">
          {actionError && (
            <p className="chat-inline-error" role="alert">
              {actionError}
            </p>
          )}
          <button
            className="button secondary"
            onClick={() => setBlockOpen(false)}
            disabled={!!busy}
          >
            Cancel
          </button>
          <button
            className="button primary"
            onClick={() => void update("block")}
            disabled={!!busy}
          >
            {busy === "block" ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Ban size={16} />
            )}
            Block member
          </button>
        </div>
      </Modal>
    </div>
  );
}
