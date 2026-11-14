// Today's `App` (`frontend/app.ts`) for the Play page, made as today's `setup` makes it
// (`frontend/setup.tsx`) for the one chat the page shows: the protocol client over a transport to
// RPE's action routes (transport.ts), send and request, the packs' catalog, the UI state (in Play),
// the toasts, and the bridge the shell gives. The chat's state is RPE's (source.ts), in the place
// today's state sync put it (`App.sync`). Left out is what this build no longer has: the state sync
// itself, prepared replies and restart, swipe-ask, Build's draft, the agents, and the float overlays
// (the map, the palette and the World sheet are Lumiverse's float widgets): none opens here.
//
// What RPE answers `unavailable`, today's code would show as an error toast; it is said on the page
// instead, in RPE's own words, once.

import type { AgentsView } from "../../../shared/agents";
import { type App, type Draft, initialUi, makeRequest, type Toast, type UiState } from "../../../frontend/app";
import { UI_PACKS } from "../../../frontend/packs";
import { ProtocolClient } from "../../../frontend/protocol-client";
import { createStore, type Readable } from "../../../frontend/store";
import { buildCatalog } from "../../../frontend/ui-registry";
import type { Timers } from "../../roads";
import { NO_OVERLAYS, showIdsChosen, TOAST_MS, TOASTS_SHOWN } from "../app";
import type { KeptHost } from "../host";
import type { ChatState } from "./source";
import type { PlayTransport } from "./transport";

export interface PlayDeps {
  /** Today's messages, to RPE's action routes and back. */
  transport: PlayTransport;
  /** The chat's state as RPE gives it. */
  state: ChatState;
  host: KeptHost;
  timers: Timers;
}

export interface Played {
  app: App;
  /** RPE's own sentences for the taps it does not serve that the page asked for, each once, in the order said. */
  said: Readable<readonly string[]>;
  /** Takes everything back: the client's hearing and the toasts' timers. */
  stop(): void;
}

export function playApp(deps: PlayDeps): Played {
  const { timers } = deps;
  const clock = { set: (run: () => void, ms: number) => timers.setTimeout(run, ms), clear: (handle: unknown) => timers.clearTimeout(handle) };
  const stops: (() => void)[] = [];
  const client = new ProtocolClient(deps.transport, { timers: clock });
  stops.push(() => client.dispose());

  const toasts = createStore<Toast[]>([]);
  const said = createStore<readonly string[]>([]);
  const showing = new Set<unknown>();
  let toastId = 0;
  let stopped = false;
  const toast = (text: string, tone: Toast["tone"] = "info"): void => {
    // Once the page is left, nothing more shows (the client answers what was still out as it stops).
    if (stopped) return;
    if (tone === "error" && deps.transport.refusals().some((answer) => answer.message === text)) {
      if (!said.get().includes(text)) said.update((all) => [...all, text]);
      return;
    }
    toastId += 1;
    const id = toastId;
    toasts.update((all) => [...all.slice(1 - TOASTS_SHOWN), { id, text, tone }]);
    const handle = timers.setTimeout(() => {
      showing.delete(handle);
      toasts.update((all) => all.filter((entry) => entry.id !== id));
    }, TOAST_MS[tone]);
    showing.add(handle);
  };
  stops.push(() => {
    for (const handle of showing) timers.clearTimeout(handle);
    showing.clear();
  });
  stops.push(client.onError((error) => toast(error.message, "error")));

  const app: App = {
    client,
    send: client.send,
    sync: deps.state,
    catalog: buildCatalog(UI_PACKS),
    ui: createStore<UiState>(initialUi(showIdsChosen())),
    toasts,
    host: deps.host,
    overlays: NO_OVERLAYS,
    drafts: createStore<Draft | null>(null),
    agents: createStore<AgentsView | null>(null),
    toast,
    request: makeRequest(client.send, toast),
  };
  return {
    app,
    said,
    stop() {
      stopped = true;
      for (const stop of stops.reverse()) stop();
    },
  };
}
