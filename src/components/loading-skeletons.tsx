import type { CSSProperties, ReactNode } from "react";
import "./loading-skeletons.css";

function Block({
  width,
  className = "",
}: {
  width?: CSSProperties["width"];
  className?: string;
}) {
  return (
    <span
      className={`skeleton-block ${className}`}
      style={width ? { width } : undefined}
    />
  );
}

function LoadingRegion({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`loading-skeleton ${className}`}
      role="status"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

function IdentityRow() {
  return (
    <div className="skeleton-identity">
      <Block className="skeleton-avatar" />
      <Block width="24%" />
      <Block width="12%" className="skeleton-faint" />
    </div>
  );
}

function PostRows({ count = 3 }: { count?: number }) {
  return Array.from({ length: count }, (_, index) => (
    <div className="skeleton-post" key={index}>
      <IdentityRow />
      <Block width={index % 2 ? "76%" : "90%"} className="skeleton-title" />
      <div className="skeleton-lines">
        <Block />
        <Block width="94%" />
        <Block width={index % 2 ? "60%" : "72%"} />
      </div>
      <div className="skeleton-actions">
        <Block width={88} className="skeleton-pill" />
        <Block width={64} className="skeleton-pill" />
        <Block width={68} className="skeleton-pill" />
      </div>
    </div>
  ));
}

export function FeedSkeleton({
  count = 3,
  label = "Loading posts",
}: {
  count?: number;
  label?: string;
} = {}) {
  return (
    <LoadingRegion label={label} className="skeleton-feed">
      <PostRows count={count} />
    </LoadingRegion>
  );
}

export function ProfileSkeleton() {
  return (
    <LoadingRegion label="Loading profile" className="skeleton-profile">
      <div className="skeleton-profile-header">
        <Block className="skeleton-avatar skeleton-avatar-large" />
        <Block width="44%" className="skeleton-heading" />
        <Block width="23%" />
        <div className="skeleton-lines">
          <Block width="82%" />
          <Block width="65%" />
        </div>
        <div className="skeleton-actions">
          <Block width={115} />
          <Block width={115} />
        </div>
      </div>
      <div className="skeleton-tabs">
        <Block width={48} />
        <Block width={76} />
        <Block width={55} />
      </div>
      <PostRows count={2} />
    </LoadingRegion>
  );
}

export function PostDetailSkeleton() {
  return (
    <LoadingRegion label="Loading conversation" className="skeleton-detail">
      <Block width={115} className="skeleton-back" />
      <PostRows count={1} />
      <Block className="skeleton-composer" />
      <div className="skeleton-tabs">
        <Block width={115} />
      </div>
      {[0, 1, 2].map((index) => (
        <div className="skeleton-comment" key={index}>
          <IdentityRow />
          <div className="skeleton-lines">
            <Block width={index % 2 ? "74%" : "94%"} />
            <Block width="56%" />
          </div>
        </div>
      ))}
    </LoadingRegion>
  );
}

export function PageSkeleton({
  label = "Loading page",
}: { label?: string } = {}) {
  return (
    <LoadingRegion label={label} className="skeleton-page">
      <Block width="38%" className="skeleton-heading" />
      <Block width="62%" />
      <div className="skeleton-tabs">
        <Block width={70} />
        <Block width={90} />
        <Block width={70} />
      </div>
      {[0, 1, 2].map((index) => (
        <div className="skeleton-panel" key={index}>
          <IdentityRow />
          <div className="skeleton-lines">
            <Block width="86%" />
            <Block width="68%" />
          </div>
        </div>
      ))}
    </LoadingRegion>
  );
}

export function ChatSkeleton() {
  return (
    <LoadingRegion label="Loading chat" className="skeleton-chat">
      <div className="skeleton-chat-layout">
        <div className="skeleton-chat-list">
          <Block width="45%" className="skeleton-heading" />
          <Block className="skeleton-search" />
          <ChatContacts />
        </div>
        <div className="skeleton-chat-conversation">
          <IdentityRow />
          <div className="skeleton-chat-messages">
            <Block width="68%" className="skeleton-chat-bubble" />
            <Block width="53%" className="skeleton-chat-bubble" />
            <Block width="63%" className="skeleton-chat-bubble" />
          </div>
          <Block className="skeleton-search" />
        </div>
      </div>
    </LoadingRegion>
  );
}

function ChatContacts({ count = 5 }: { count?: number }) {
  return Array.from({ length: count }, (_, index) => (
    <div className="skeleton-chat-contact" key={index}>
      <Block className="skeleton-avatar" />
      <div className="skeleton-lines">
        <Block width={index % 2 ? "72%" : "58%"} />
        <Block width="86%" />
      </div>
    </div>
  ));
}

export function ChatListSkeleton() {
  return (
    <LoadingRegion label="Loading messages" className="skeleton-chat-inbox">
      <ChatContacts />
    </LoadingRegion>
  );
}

export function ChatThreadSkeleton() {
  return (
    <LoadingRegion
      label="Loading conversation"
      className="skeleton-chat-thread"
    >
      <div className="skeleton-chat-conversation">
        <IdentityRow />
        <div className="skeleton-chat-messages">
          <Block width="68%" className="skeleton-chat-bubble" />
          <Block width="53%" className="skeleton-chat-bubble" />
          <Block width="63%" className="skeleton-chat-bubble" />
        </div>
        <Block className="skeleton-search" />
      </div>
    </LoadingRegion>
  );
}

export function QuickChatSkeleton() {
  return (
    <LoadingRegion label="Loading chat" className="skeleton-quick-chat">
      <div className="skeleton-quick-chat-heading">
        <h2>Chat</h2>
        <Block width={80} />
      </div>
      <div className="skeleton-chat-inbox">
        <ChatContacts count={3} />
      </div>
    </LoadingRegion>
  );
}

export function AppSkeleton() {
  return (
    <LoadingRegion
      label="Loading Reddix"
      className="app-shell app-skeleton skeleton-app"
    >
      <div className="app-header">
        <div className="header-brand">
          <span className="header-logo">
            <span className="wordmark">
              <span className="logo-mark" />
              <span>reddix</span>
            </span>
          </span>
        </div>
        <Block className="skeleton-search" />
        <div className="header-actions">
          <Block width={108} className="skeleton-pill skeleton-create" />
          <Block className="skeleton-avatar" />
          <Block className="skeleton-avatar" />
        </div>
      </div>
      <div className="sidebar skeleton-sidebar">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
          <div className="skeleton-nav-item" key={index}>
            <Block className="skeleton-avatar" />
            <Block width={index % 2 ? "56%" : "66%"} />
          </div>
        ))}
      </div>
      <div className="main-workspace">
        <div className="workspace-grid">
          <div className="main-content">
            <Block width={170} className="skeleton-heading" />
            <div className="skeleton-toolbar">
              <Block width={90} />
              <Block width={110} />
            </div>
            <PostRows count={3} />
          </div>
          <div className="right-sidebar skeleton-rail">
            <Block width="58%" className="skeleton-title" />
            {[0, 1, 2, 3].map((index) => (
              <div className="skeleton-panel" key={index}>
                <IdentityRow />
                <div className="skeleton-lines">
                  <Block width="94%" />
                  <Block width="72%" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}
