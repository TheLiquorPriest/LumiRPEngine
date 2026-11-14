// Today's `App` (`frontend/app.ts`) for the part of today's frontend this build keeps, Build mode,
// made as today's `setup` makes it (`frontend/setup.tsx`) over a transport to RPE: the protocol client,
// send and request, the packs' catalog, the UI state (in Build), the toasts and their toast, the draft
// and its tracking, and the host bridge the shell gives. What this build no longer has is left out:
// prepared replies and restart, swipe-ask, LumiAH's pages, the MCP notice, the chat's state sync, the
// drawer tab, the HUD and the float overlays. The App's type still names the chat's state, the agents
// and the overlays: the state is the client's own, which no hello ever opens; the agents stay unheard
// of; and no overlay exists to open.
//
// What RPE answers `unavailable` to a tool it does not serve (transport.ts) is said once, where it was
// asked for: on the Build page that asked, in RPE's own words, and never as a toast.

import type { AgentsView } from "../../shared/agents";
import type { ErrorMessage } from "../../shared/protocol";
import { type App, type Draft, initialUi, makeRequest, type Overlays, SHOW_IDS_KEY, type Toast, type UiState } from "../../frontend/app";
import type { Send } from "../../frontend/registry";
import { trackDraft } from "../../frontend/build/draft";
import { UI_PACKS } from "../../frontend/packs";
import { ProtocolClient } from "../../frontend/protocol-client";
import { createStore, type Readable } from "../../frontend/store";
import { buildCatalog } from "../../frontend/ui-registry";
import type { Timers } from "../roads";
import type { KeptHost } from "./host";
import type { BuildTransport } from "./transport";

/** As today's setup shows toasts: the newest three, an error for 6 s and anything else for 3.5 s. */
export const TOASTS_SHOWN = 3;
export const TOAST_MS: Readonly<Record<Toast["tone"], number>> = { error: 6000, info: 3500 };

/** Only Play's map, place sheet, calendar and combat panels open an overlay; Build opens none, and this build has none to open. */
export const NO_OVERLAYS: Overlays = {
  openMap: () => Promise.resolve(),
  closeMap: () => undefined,
  openPalette: () => Promise.resolve(),
  closePalette: () => undefined,
  openWorld: () => Promise.resolve(),
  closeWorld: () => undefined,
};

export interface KeptDeps {
  /** Today's messages, to RPE and back (transport.ts). */
  transport: BuildTransport;
  host: KeptHost;
  timers: Timers;
}

export interface Kept {
  app: App;
  /** RPE's own answers to the tools it does not serve that the Build page now showing asked for, each once, in the order asked. */
  said: Readable<readonly ErrorMessage[]>;
  /** Takes everything back: the client's hearing, the draft's tracking, the toasts' timers. */
  stop(): void;
}

/** Show ids, as this device last chose it in today's Settings → Display; hidden where storage is refused. */
export function showIdsChosen(): boolean {
  try {
    return localStorage.getItem(SHOW_IDS_KEY) === "true";
  } catch {
    return false;
  }
}

export function keptApp(deps: KeptDeps): Kept {
  const { timers } = deps;
  const clock = { set: (run: () => void, ms: number) => timers.setTimeout(run, ms), clear: (handle: unknown) => timers.clearTimeout(handle) };
  const stops: (() => void)[] = [];
  const client = new ProtocolClient(deps.transport, { timers: clock });
  stops.push(() => client.dispose());

  const toasts = createStore<Toast[]>([]);
  const showing = new Set<unknown>();
  let toastId = 0;
  let stopped = false;
  const refused = (text: string): boolean => deps.transport.refusals().some((answer) => answer.message === text);
  const toast = (text: string, tone: Toast["tone"] = "info"): void => {
    // Once the page is left, nothing more shows (the client answers what was still out as it stops); RPE's word on a tool it does not serve is said on the page instead.
    if (stopped || (tone === "error" && refused(text))) return;
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

  const ui = createStore<UiState>({ ...initialUi(showIdsChosen()), mode: "build" });
  const said = createStore<readonly ErrorMessage[]>([]);
  let place = JSON.stringify(ui.get().build);
  stops.push(
    ui.subscribe((state) => {
      const next = JSON.stringify(state.build);
      if (next === place) return;
      place = next;
      said.set([]);
    }),
  );
  const send: Send = async (body) => {
    const asked = place;
    const answer = await client.send(body);
    if (answer.type === "lre.error" && asked === place && refused(answer.message) && !said.get().some((s) => s.message === answer.message)) said.update((all) => [...all, answer]);
    return answer;
  };
  const app: App = {
    client,
    send,
    sync: { get: () => client.getState(), subscribe: (listener) => client.subscribe(listener) },
    catalog: buildCatalog(UI_PACKS),
    ui,
    toasts,
    host: deps.host,
    overlays: NO_OVERLAYS,
    drafts: createStore<Draft | null>(null),
    agents: createStore<AgentsView | null>(null),
    toast,
    request: makeRequest(send, toast),
  };
  // A push that the draft moved past the one Build holds has it read again (DESIGN §23); RPE sends a request's pushes with its answer.
  stops.push(trackDraft(app, clock));
  return {
    app,
    said,
    stop() {
      stopped = true;
      for (const stop of stops.reverse()) stop();
    },
  };
}
