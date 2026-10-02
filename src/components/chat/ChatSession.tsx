"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

type ChatSessionState = {
  mode: "closed" | "open" | "minimized";
  path: string;
};
const initialState: ChatSessionState = { mode: "closed", path: "/chat" };
type Delivery = { body: string; clientId: string; pending: boolean };

function createChatStore() {
  let generation = 0;
  const sessions = new Map<string, ChatSessionState>();
  const drafts = new Map<string, Map<string, string>>();
  const deliveries = new Map<string, Map<string, Delivery>>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const getDraft = (memberId: string, key: string) =>
    drafts.get(memberId)?.get(key) || "";

  return {
    getGeneration() {
      return generation;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSession(memberId: string) {
      return sessions.get(memberId) || initialState;
    },
    updateSession(memberId: string, update: Partial<ChatSessionState>) {
      const current = sessions.get(memberId) || initialState;
      const next = { ...current, ...update };
      if (current.mode === next.mode && current.path === next.path) return;
      sessions.set(memberId, next);
      notify();
    },
    getDraft,
    isSending(memberId: string, key: string) {
      return deliveries.get(memberId)?.get(key)?.pending || false;
    },
    beginDelivery(memberId: string, key: string, body: string) {
      const current = deliveries.get(memberId)?.get(key);
      if (current?.pending) return null;
      const clientId =
        current?.body === body ? current.clientId : crypto.randomUUID();
      if (!deliveries.has(memberId)) deliveries.set(memberId, new Map());
      deliveries.get(memberId)!.set(key, { body, clientId, pending: true });
      notify();
      return clientId;
    },
    finishDelivery(
      memberId: string,
      key: string,
      clientId: string,
      sent: boolean,
    ) {
      const current = deliveries.get(memberId)?.get(key);
      if (!current || current.clientId !== clientId) return;
      if (sent) deliveries.get(memberId)?.delete(key);
      else deliveries.get(memberId)?.set(key, { ...current, pending: false });
      if (!deliveries.get(memberId)?.size) deliveries.delete(memberId);
      notify();
    },
    setDraft(
      memberId: string,
      key: string,
      update: SetStateAction<string>,
      sourceGeneration: number,
    ) {
      if (sourceGeneration !== generation) return;
      const current = getDraft(memberId, key);
      const next = typeof update === "function" ? update(current) : update;
      if (current === next) return;
      if (next) {
        if (!drafts.has(memberId)) drafts.set(memberId, new Map());
        drafts.get(memberId)!.set(key, next);
      } else {
        drafts.get(memberId)?.delete(key);
        if (!drafts.get(memberId)?.size) drafts.delete(memberId);
      }
      notify();
    },
    clear() {
      generation += 1;
      sessions.clear();
      drafts.clear();
      deliveries.clear();
      notify();
    },
  };
}

const ChatSessionContext = createContext<ReturnType<
  typeof createChatStore
> | null>(null);

/** Private drafts live only for this mounted application session. */
export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createChatStore);
  return (
    <ChatSessionContext.Provider value={store}>
      {children}
    </ChatSessionContext.Provider>
  );
}

function useChatStore() {
  const store = useContext(ChatSessionContext);
  if (!store) throw new Error("ChatSessionProvider is required for chat.");
  return store;
}

export function useChatSession(memberId: string) {
  const store = useChatStore();
  const snapshot = useCallback(
    () => store.getSession(memberId),
    [store, memberId],
  );
  const state = useSyncExternalStore(
    store.subscribe,
    snapshot,
    () => initialState,
  );
  const update = useCallback(
    (value: Partial<ChatSessionState>) => store.updateSession(memberId, value),
    [store, memberId],
  );
  const clear = useCallback(() => store.clear(), [store]);
  return { state, update, clear };
}

export function useChatDraft(
  memberId: string,
  key: string,
): [string, Dispatch<SetStateAction<string>>] {
  const store = useChatStore();
  const generation = store.getGeneration();
  const snapshot = useCallback(
    () => store.getDraft(memberId, key),
    [store, memberId, key],
  );
  const draft = useSyncExternalStore(store.subscribe, snapshot, () => "");
  const update = useCallback(
    (value: SetStateAction<string>) =>
      store.setDraft(memberId, key, value, generation),
    [store, memberId, key, generation],
  );
  return [draft, update];
}

/** Preserve request idempotency when a send outlives the dock or page. */
export function useChatDelivery(memberId: string, key: string) {
  const store = useChatStore();
  const snapshot = useCallback(
    () => store.isSending(memberId, key),
    [store, memberId, key],
  );
  const pending = useSyncExternalStore(store.subscribe, snapshot, () => false);
  const begin = useCallback(
    (body: string) => store.beginDelivery(memberId, key, body),
    [store, memberId, key],
  );
  const finish = useCallback(
    (clientId: string, sent: boolean) =>
      store.finishDelivery(memberId, key, clientId, sent),
    [store, memberId, key],
  );
  return { pending, begin, finish };
}
