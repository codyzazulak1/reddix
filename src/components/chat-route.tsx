"use client";

import { useSearchParams } from "next/navigation";
import type { Member } from "@/lib/types";
import ChatView from "./chat/ChatView";

export default function ChatRoute({
  member,
  conversationId,
  onNavigate,
  onUnreadChange,
}: {
  member: Member;
  conversationId?: string;
  onNavigate: (path: string) => void;
  onUnreadChange: (count: number) => void;
}) {
  const search = useSearchParams();
  return (
    <ChatView
      member={member}
      conversationId={conversationId}
      recipientId={search.get("to") || undefined}
      onNavigate={onNavigate}
      onUnreadChange={onUnreadChange}
    />
  );
}
