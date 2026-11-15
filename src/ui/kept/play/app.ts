// Today's `App` (`frontend/app.ts`) for the Play page, made as today's `setup` makes it
// (`frontend/setup.tsx`) for the one chat the page shows: the protocol client over a transport to
// RPE's routes (transport.ts), send and request, the packs' catalog, the UI state (in Play), the
// toasts, and the bridge the shell gives. The chat's state is RPE's (source.ts), in the place today's
// state sync put it (`App.sync`); where today's page asks the client for the chat's view afresh (open,
// retry, resync), the state is read again from RPE. Left out is what this build no longer has: the
// state sync itself, prepared replies and restart, swipe-ask, Build's draft and the agents.
//
// The float overlays (the map, the actions sheet and the World sheet) were Lumiverse's float widgets,
// which this build does not have. Today's components still draw the buttons that open them, so each
// says what it does here: the map goes to Play's own Places, as Now's Map does, and what has nowhere
// to open says so once, on the page. Today's Play's "Open Build" goes to the Build page of the shell.
//
// What RPE answers `unavailable`, today's code would show as an error toast; it is said on the page
// instead, in RPE's own words, once. So is the sentence an Undo's answer gives (`said`), which today's
// components do not show.

import type { AgentsView } from "../../../shared/agents";
import type { ChatId } from "../../../shared/ids";
import type { ErrorMessage, ResultMessage } from "../../../shared/protocol";
import { type App, type Draft, initialUi, makeRequest, type Overlays, playAt, type Toast, type UiState } from "../../../frontend/app";
import { UI_PACKS } from "../../../frontend/packs";
import { ProtocolClient } from "../../../frontend/protocol-client";
import type { Send } from "../../../frontend/registry";
import { createStore, type Readable, type Store } from "../../store";
import { buildCatalog } from "../../../frontend/ui-registry";
import type { Timers } from "../../roads";
import { showIdsChosen, TOAST_MS, TOASTS_SHOWN } from "../app";
import type { KeptHost } from "../host";
import type { ChatState } from "./source";
import type { PlayTransport } from "./transport";

/** What the page says of an overlay this build has nowhere to open, when one of today's buttons asks for it. */
export const NOT_HERE = {
  /** Act, Actions, Timelapse and a fight's turn open today's actions sheet. */
  palette: "The actions sheet (Act, Actions, Timelapse) does not open in this build of RPE.",
  /** The map's Full screen, asked on Places, where the map already shows. */
  map: "The map does not open full screen in this build of RPE; Places shows it here.",
  world: "The World sheet does not open in this build of RPE.",
} as const;

/** What the page says once Attach gave the chat a world, named as the worlds' list named it. */
export function attachedWords(world: string): string {
  return `${world} is attached to this chat.`;
}

export interface PlayDeps {
  /** Today's messages, to RPE's routes and back. */
  transport: PlayTransport;
  /** The chat's state as RPE gives it. */
  state: ChatState;
  host: KeptHost;
  timers: Timers;
  /** Shows the shell's Build page, where today's Play would switch to Build mode. */
  openBuild(): void;
}

export interface Played {
  app: App;
  /** What the page says once, in the order said: RPE's own sentences for the taps it does not serve, an Undo's sentence, and what an overlay's button does not open. */
  said: Readable<readonly string[]>;
  /** Takes everything back: the client's hearing, the UI's watch and the toasts' timers. */
  stop(): void;
}

/** Today's client, but the chat's view comes from RPE's state route: asking for it afresh reads it again (source.ts). */
class PlayClient extends ProtocolClient {
  constructor(
    transport: PlayTransport,
    options: ConstructorParameters<typeof ProtocolClient>[1],
    private readonly chatView: ChatState,
  ) {
    super(transport, options);
  }

  /**
   * RPE has no hello: the view it would ask for is read again from RPE and shows when it comes. The page shows this one chat, so
   * nothing is switched; and nothing the page shows waits on the hello's own answer (today's callers drop it), so none is given.
   */
  override open(_chatId: ChatId | null): Promise<ResultMessage | ErrorMessage> {
    this.chatView.read();
    return new Promise(() => undefined);
  }

  override retry(): void {
    this.chatView.read();
  }

  override resync(): void {
    this.chatView.read();
  }
}

/** The overlays as this page has them: the map is Play's Places; the rest say, once, that they do not open. */
function playOverlays(ui: Store<UiState>, say: (text: string) => void): Overlays {
  return {
    openMap: async () => {
      const at = ui.get();
      if (at.mode === "play" && at.play.dest === "places" && at.play.stack.length === 0) say(NOT_HERE.map);
      else ui.update((state) => playAt(state, "places"));
    },
    closeMap: () => undefined,
    openPalette: async () => say(NOT_HERE.palette),
    closePalette: () => undefined,
    openWorld: async () => say(NOT_HERE.world),
    closeWorld: () => undefined,
  };
}

export function playApp(deps: PlayDeps): Played {
  const { timers } = deps;
  const clock = { set: (run: () => void, ms: number) => timers.setTimeout(run, ms), clear: (handle: unknown) => timers.clearTimeout(handle) };
  const stops: (() => void)[] = [];
  const client = new PlayClient(deps.transport, { timers: clock }, deps.state);
  stops.push(() => client.dispose());

  const toasts = createStore<Toast[]>([]);
  const said = createStore<readonly string[]>([]);
  const showing = new Set<unknown>();
  let toastId = 0;
  let stopped = false;
  const say = (text: string): void => {
    if (!stopped && !said.get().includes(text)) said.update((all) => [...all, text]);
  };
  const toast = (text: string, tone: Toast["tone"] = "info"): void => {
    // Once the page is left, nothing more shows (the client answers what was still out as it stops).
    if (stopped) return;
    if (tone === "error" && deps.transport.refusals().some((answer) => answer.message === text)) {
      say(text);
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

  // The worlds' names, as the picker's list gave them, so an attach can be said with its world's name.
  const worldNames = new Map<string, string>();
  const send: Send = async (body) => {
    // Which engine plays the chat, which today's picker asks after its Attach to word its toast: RPE plays every chat one way, and
    // today's words name another. Nothing comes back, so the picker shows no toast (it toasts only an answer, and an answer that
    // never comes runs out no timer); the attach is said in the page's words instead. Every other `lre.chat.knowledge` goes to RPE.
    if (body.type === "lre.chat.knowledge" && body.engines === true) return new Promise(() => undefined);
    const answer = await client.send(body);
    if (answer.type === "lre.result" && answer.request === "lre.world") {
      for (const world of answer.body.worlds ?? []) worldNames.set(world.id, world.name);
      if (body.type === "lre.world" && body.op === "attach") say(attachedWords(worldNames.get(body.worldId) ?? body.worldId));
    }
    // An Undo's answer may say what it left as it was; today's Undo keeps only whether it applied.
    if (answer.type === "lre.result" && answer.request === "lre.chip" && answer.body.said !== undefined && answer.body.said !== "") say(answer.body.said);
    return answer;
  };
  const ui = createStore<UiState>(initialUi(showIdsChosen()));
  stops.push(
    ui.subscribe((state) => {
      if (state.mode !== "build") return;
      // The page stays Play's; Build is a page of the shell.
      ui.update((held) => ({ ...held, mode: "play" }));
      deps.openBuild();
    }),
  );
  const app: App = {
    client,
    send,
    sync: deps.state,
    catalog: buildCatalog(UI_PACKS),
    ui,
    toasts,
    host: deps.host,
    overlays: playOverlays(ui, say),
    drafts: createStore<Draft | null>(null),
    agents: createStore<AgentsView | null>(null),
    toast,
    request: makeRequest(send, toast),
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
