import type { PublicMember } from "./types";

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  sequence: string;
  body: string;
  createdAt: string;
};

export type ChatConversation = {
  id: string;
  peer: PublicMember;
  status: "pending" | "accepted" | "closed";
  direction: "incoming" | "outgoing";
  lastMessage: Pick<ChatMessage, "body" | "createdAt" | "senderId"> | null;
  unreadCount: number;
  canSend: boolean;
  createdAt: string;
  updatedAt: string;
  isBlocked?: boolean;
};

export type ChatInbox = {
  conversations: ChatConversation[];
  requests: ChatConversation[];
  unreadCount: number;
};

export type ChatThread = {
  conversation: ChatConversation;
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor: string | null;
};
