// Today's `App` (`frontend/app.ts`) for the part of today's frontend this build keeps: Build and the
// Play view, made as today's `setup` makes it (`frontend/setup.tsx`), and made once, for both. One
// protocol client over one transport (client.ts: the call files' typed routes, and the old road for what
// none takes yet), send and request, the packs' catalog, the UI state, the toasts and their one toast,
// the draft and its tracking, and the host bridge the shell gives. The state the App's `sync` holds is
// RPE's (chat-state.ts), for the chat the App is for: Play's chat, or the chat Lumiverse has open.
// What RPE's live feed says of that chat reaches today's client as the pushes today's backend sent
// (each call file's `live`), so today's components react unchanged.
//
// A refusal RPE answers on the old road (`unavailable` to a request no route serves yet) is said once on
// the page, in RPE's own words, and never toasted: it is held back by the request it answers (the
// transport knows which), not by what its words are. Nothing is remembered: the same request asked again
// is asked again. A road failure is not a refusal and toasts as the road's.

import { type App, type Draft, initialUi, type Overlays, type Toast, type UiState } from "../../frontend/app";
import { ProtocolClient } from "../../frontend/protocol-client";
import type { RequestBody, Send } from "../../frontend/registry";
import { buildCatalog, type UiCatalog } from "../../frontend/ui-registry";
import type { ChatId } from "../../shared/ids";
import type { ErrorMessage, ResultMessage } from "../../shared/protocol";
import { SHOW_IDS_KEY } from "../../frontend/app";
import type { RpeClient } from "../client";
import type { Timers } from "../roads";
import { createStore, type Readable, type Store } from "../store";
import { openChatState } from "./chat-state";
import { type CallFile, keptTransport } from "./client";
import type { KeptHost } from "./host";
import { keptMapHand } from "./maps";
import { keptNextMessage } from "./next-message";
import type { ChatState } from "./play/source";

/** What the toasts read of the page's settings, at each toast: how many show at once and for how long (`pages.toastsShown`, `pages.errorToastMs`, `pages.toastMs`). */
export interface ToastSettings {
  readonly toastsShown: number;
  readonly errorToastMs: number;
  readonly toastMs: number;
}

/** What the page says once Attach gave the chat a world, named as the worlds' list named it. */
export function attachedWords(world: string): string {
  return `${world} is attached to this chat.`;
}

/** What a change made at once says where RPE gives no words of it. */
export const CHANGE_MADE = "Done: your change is made, as your own edit.";

/** The sheets of an App whose views open none (Build, the things browser): only Play's views open one, and each gives its own (`play/mount.tsx`, `../chat/chat-play.ts`). */
const NO_OVERLAYS: Overlays = {
  openMap: () => Promise.resolve(),
  closeMap: () => undefined,
  openPalette: () => Promise.resolve(),
  closePalette: () => undefined,
  openWorld: () => Promise.resolve(),
  closeWorld: () => undefined,
};

/** The catalog of an App that draws no pack's panel: every list empty. */
const NO_PACKS: UiCatalog = buildCatalog([]);

export interface KeptDeps {
  client: Pick<RpeClient, "call" | "follow">;
  /** The chat the App is for: Play's chat, or the chat Lumiverse has open (the page sets it as the chat changes); null for none. */
  chat: Store<string | null>;
  /** Which kept view the App is for. */
  mode: "build" | "play";
  host: KeptHost;
  timers: Timers;
  /** The toasts' count and times, read at each toast. */
  settings(): ToastSettings;
  /** Shows the shell's Build page, where today's Play would switch to Build mode. */
  openBuild?(): void;
  /** Shows one of RPE's pages where the shell shows its pages (the Live page, a turn's page). */
  open?(route: { page: string; chat?: string | null; at?: readonly string[] }): void;
  /** The sheets the App's views open (the map, the actions sheet, the World sheet): the Play view's and the chat's surfaces' give theirs; an App whose views open none has none. */
  overlays?: Overlays;
  /** The call files; the folder's list unless a test gives its own. */
  calls?: readonly CallFile[];
  /** The packs' panels, sheets and editors the views draw from; none where the App is for surfaces that draw no pack's (the chat's HUD and its reply lines): the kept chunk (`chunk.ts`) gives the whole catalog to the views it mounts. */
  catalog?: UiCatalog;
  /** What keeps Build's draft current as pushes move it (`frontend/build/draft.ts`); the Build view gives it, no other has a draft. */
  draft?: (app: App, clock: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void }) => () => void;
}

export interface Kept {
  app: App;
  /** What the page says once, in the order said: RPE's own words for a request it does not serve yet that the page asked, and an Undo's sentence. */
  said: Readable<readonly string[]>;
  /** Takes everything back: the client's hearing, the chat's state, the draft's tracking, the toasts' timers. */
  stop(): void;
}

/** Show ids, as this device last chose it (Settings, On this device); hidden where storage is refused. */
export function showIdsChosen(): boolean {
  try {
    return localStorage.getItem(SHOW_IDS_KEY) === "true";
  } catch {
    return false;
  }
}

/** The page's word that Show ids changed on this device, which every kept App of the page hears, in whichever of RPE's files it was made. */
export const SHOW_IDS_CHANGED = "rpe:show-ids";

/** Show ids chosen on this device and told to every kept App of the page; false where the browser refuses to keep it. */
export function chooseShowIds(on: boolean): boolean {
  try {
    localStorage.setItem(SHOW_IDS_KEY, on ? "true" : "false");
  } catch {
    return false;
  }
  globalThis.dispatchEvent?.(new Event(SHOW_IDS_CHANGED));
  return true;
}

/** Follows Show ids as this device keeps it: chosen on this page, or in another tab of the same browser; the returned function stops. */
function followShowIds(ui: Store<UiState>): () => void {
  const take = (): void => {
    const on = showIdsChosen();
    if (ui.get().showIds !== on) ui.update((held) => ({ ...held, showIds: on }));
  };
  const fromTab = (event: Event): void => {
    if ((event as StorageEvent).key === SHOW_IDS_KEY) take();
  };
  globalThis.addEventListener?.(SHOW_IDS_CHANGED, take);
  globalThis.addEventListener?.("storage", fromTab);
  return () => {
    globalThis.removeEventListener?.(SHOW_IDS_CHANGED, take);
    globalThis.removeEventListener?.("storage", fromTab);
  };
}

/** Today's client, but the chat's view comes from RPE's state route: asking for it afresh reads it again (chat-state.ts). */
class KeptClient extends ProtocolClient {
  constructor(
    transport: ConstructorParameters<typeof ProtocolClient>[0],
    options: ConstructorParameters<typeof ProtocolClient>[1],
    private readonly chatView: ChatState,
  ) {
    super(transport, options);
  }

  /**
   * RPE has no hello: the view it would ask for is read again from RPE and shows when it comes. The App shows the one chat the
   * page names, so nothing is switched; and nothing the page shows waits on the hello's own answer (today's callers drop it), so
   * none is given.
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

/** The live channel of what concerns the user and no one chat (`LIVE_USER` of RPE's app, which the page may not import). */
const USER_CHANNEL = "~user";

export function keptApp(deps: KeptDeps): Kept {
  const { timers } = deps;
  const clock = { set: (run: () => void, ms: number) => timers.setTimeout(run, ms), clear: (handle: unknown) => timers.clearTimeout(handle) };
  const stops: (() => void)[] = [];
  // The world is read from the chat's state when a call asks for it, so it is the state's as it stands then (`state` is made below).
  const transport = keptTransport({ client: deps.client, chat: () => deps.chat.get(), world: () => state.get().view?.worldId ?? null, ...(deps.calls === undefined ? {} : { calls: deps.calls }) });
  stops.push(() => transport.close());
  // What RPE's live feed says of the chat the App is for reaches today's client as the pushes today's backend sent (each call file's `live`).
  const state = openChatState(deps.client, deps.chat, (events) => {
    for (const event of events) transport.live(event);
  });
  stops.push(() => state.stop());
  const client = new KeptClient(transport, { timers: clock }, state);
  stops.push(() => client.dispose());

  const toasts = createStore<Toast[]>([]);
  const said = createStore<readonly string[]>([]);
  const showing = new Set<unknown>();
  let toastId = 0;
  let stopped = false;
  const say = (text: string): void => {
    if (!stopped && text !== "" && !said.get().includes(text)) said.update((all) => [...all, text]);
  };
  const toast = (text: string, tone: Toast["tone"] = "info", undo?: Toast["undo"]): void => {
    // Once the page is left, nothing more shows (the client answers what was still out as it stops); a refusal's words were blanked, and said on the page.
    if (stopped || text === "") return;
    const { toastsShown, errorToastMs, toastMs } = deps.settings();
    toastId += 1;
    const id = toastId;
    toasts.update((all) => [...all.slice(Math.max(0, all.length - (toastsShown - 1))), { id, text, tone, ...(undo === undefined ? {} : { undo }) }]);
    const handle = timers.setTimeout(
      () => {
        showing.delete(handle);
        toasts.update((all) => all.filter((entry) => entry.id !== id));
      },
      // One that offers an Undo stays as long as an error does, so there is time to press it.
      tone === "error" || undo !== undefined ? errorToastMs : toastMs,
    );
    showing.add(handle);
  };
  stops.push(() => {
    for (const handle of showing) timers.clearTimeout(handle);
    showing.clear();
  });
  stops.push(client.onError((error) => toast(error.message, "error")));

  const ui = createStore<UiState>({ ...initialUi(showIdsChosen()), mode: deps.mode });
  stops.push(followShowIds(ui));
  if (deps.mode === "build") {
    // A place Build opens at, then said once for the place it is on: what a refusal said stays only while the same page shows.
    let place = JSON.stringify(ui.get().build);
    stops.push(
      ui.subscribe((held) => {
        const next = JSON.stringify(held.build);
        if (next === place) return;
        place = next;
        said.set([]);
      }),
    );
  } else {
    stops.push(
      ui.subscribe((held) => {
        if (held.mode !== "build") return;
        // The page stays Play's; Build is a page of the shell.
        ui.update((now) => ({ ...now, mode: "play" }));
        deps.openBuild?.();
      }),
    );
  }

  // The worlds' names, as the picker's list gave them, so an attach can be said with its world's name.
  const worldNames = new Map<string, string>();
  // RPE's words for each refusal `send` blanked, by the answer it blanked.
  const refusals = new WeakMap<object, string>();
  const send: Send = async (body) => {
    const answer = await client.send(body);
    if (answer.type === "lre.error") {
      // RPE's refusal of a request it does not serve yet: its words are the page's, said once by `request`; what a component gets back from `send` has none, so nothing toasts them.
      if (!transport.takeRefusal(answer.reqId)) return answer;
      const blanked = { ...answer, message: "" };
      refusals.set(blanked, answer.message);
      return blanked;
    }
    if (deps.mode === "play") {
      if (answer.request === "lre.world") {
        for (const world of answer.body.worlds ?? []) worldNames.set(world.id, world.name);
        if (body.type === "lre.world" && body.op === "attach") say(attachedWords(worldNames.get(body.worldId) ?? body.worldId));
      }
      // An Undo's answer may say what it left as it was; today's Undo keeps only whether it applied.
      if (answer.request === "lre.chip" && answer.body.said !== undefined && answer.body.said !== "") say(answer.body.said);
    }
    return answer;
  };
  /**
   * Sends a request; an error is shown, as a toast, or said on the page where it is RPE's refusal of a request it does not serve yet, and
   * the request resolves null. In Play, a change made at once as his own edit (a tap that manages, a ✎ fix, an edit) is told where it was
   * made, in RPE's words of it, with its Undo (plan §10.10).
   */
  const request: App["request"] = async (body) => {
    const message = await send(body);
    if (message.type === "lre.error") {
      const refusal = refusals.get(message);
      if (refusal !== undefined) say(refusal);
      else toast(message.lint && message.lint.length > 0 ? `${message.message} (${message.lint.length} issue${message.lint.length === 1 ? "" : "s"})` : message.message, "error");
      return null;
    }
    const made: RequestBody = body;
    if (deps.mode === "play" && (made.type === "lre.action" || made.type === "lre.fix" || made.type === "lre.edit")) {
      const done = message.body as { undo?: string | null; said?: string };
      if (typeof done.undo === "string") toast(done.said !== undefined && done.said !== "" ? done.said : CHANGE_MADE, "info", { chat: made.chatId, edit: done.undo });
    }
    return message.body as never;
  };
  const app: App = {
    client,
    send,
    sync: state,
    catalog: deps.catalog ?? NO_PACKS,
    ui,
    toasts,
    host: deps.host,
    overlays: deps.overlays ?? NO_OVERLAYS,
    drafts: createStore<Draft | null>(null),
    toast,
    request,
    maps: keptMapHand(deps.client, () => state.read()),
    next: keptNextMessage(deps.client, () => state.read()),
    ...(deps.open === undefined ? {} : { open: deps.open }),
  };
  // A push that the draft moved past the one Build holds has it read again (DESIGN §23).
  if (deps.mode === "build") {
    if (deps.draft !== undefined) stops.push(deps.draft(app, clock));
    // What concerns the user and no one chat (a world's draft moved) is told on the user's own channel, which Build hears whether or not a chat is open.
    stops.push(
      deps.client.follow(USER_CHANNEL, {
        events: (events) => {
          for (const event of events) transport.live(event);
        },
        reset: () => undefined,
        refused: () => undefined,
      }),
    );
  }
  return {
    app,
    said,
    stop() {
      stopped = true;
      for (const stop of stops.reverse()) stop();
    },
  };
}
