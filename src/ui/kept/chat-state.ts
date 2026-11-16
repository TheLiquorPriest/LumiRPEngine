// The state of the chat the kept App is for, as RPE holds it (plan §14): the one `ChatState` the App's
// `sync` is, for the chat a store names. In Play the chat is the page's; in Build it is the chat
// Lumiverse has open in the drawer, or the one the route names in the web shell, with the world and
// revision it plays in its view (`view.worldId`, `view.revision`) or none, so Build can mark the world
// the open chat plays and offer Attach. When the chat changes the view is dropped and the new chat's is
// read; with no chat there is no view.

import type { SyncState } from "../../frontend/protocol-client";
import type { LiveEvent } from "../../shared/api";
import { type Readable, createStore } from "../store";
import type { RpeClient } from "../client";
import { type ChatState, chatState } from "./play/source";

/** Before anything is read, or with no chat: no view and nothing waiting. */
function idle(chat: string | null): SyncState {
  return { chatId: chat, rev: null, view: null, status: chat === null ? "closed" : "syncing", resyncs: 0, activity: null, canStop: null, failed: null };
}

export function openChatState(client: Pick<RpeClient, "call" | "follow">, chat: Readable<string | null>, heard?: (events: readonly LiveEvent[]) => void): ChatState {
  const state = createStore<SyncState>(idle(chat.get()));
  let following: ChatState | null = null;
  let stopHearing: (() => void) | null = null;
  const bind = (id: string | null): void => {
    stopHearing?.();
    following?.stop();
    following = null;
    stopHearing = null;
    state.set(idle(id));
    if (id === null) return;
    const mine = chatState(client, id, heard);
    following = mine;
    stopHearing = mine.subscribe((next) => state.set(next));
    state.set(mine.get());
  };
  bind(chat.get());
  const offChat = chat.subscribe((id) => {
    if (id !== (following?.get().chatId ?? null)) bind(id);
  });
  return {
    get: () => state.get(),
    subscribe: (listener) => state.subscribe(listener),
    read: () => following?.read(),
    stop() {
      offChat();
      stopHearing?.();
      following?.stop();
      following = null;
    },
  };
}
