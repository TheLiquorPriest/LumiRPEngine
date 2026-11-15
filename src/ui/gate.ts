// The spoiler gate (plan §10.3, §10.7, §14). What the agents planned and did can give away what is
// coming, so the intent record and the agents' work show only once the player opens the gate, for one
// chat. It is never kept: a new page starts with every gate shut, and the shells shut it when the
// player leaves the chat.

import { createStore, type Readable } from "./store";

export interface Gate extends Readable<ReadonlySet<string>> {
  open(chat: string): void;
  close(chat: string): void;
  closeAll(): void;
}

export function createGate(): Gate {
  const opened = createStore<ReadonlySet<string>>(new Set());
  return {
    get: opened.get,
    subscribe: opened.subscribe,
    open(chat) {
      if (!opened.get().has(chat)) opened.set(new Set([...opened.get(), chat]));
    },
    close(chat) {
      if (!opened.get().has(chat)) return;
      const next = new Set(opened.get());
      next.delete(chat);
      opened.set(next);
    },
    closeAll() {
      if (opened.get().size > 0) opened.set(new Set());
    },
  };
}
