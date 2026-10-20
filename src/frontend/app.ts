// The frontend's app object: the protocol client, the UI registry catalog, local UI state, host
// capabilities and overlay control, shared with every Preact tree (drawer, HUD, chips, sheets,
// map) through one context. UI state: a mode, Play's
// destination with its sub-tabs and sheet stack, GM's gate, Build's route and Settings' page.

import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { SpindleComponentsHelper } from "lumiverse-spindle-types";
import type { ChatId, MessageId, PanelId, RevisionId, WorldId } from "../shared/ids";
import type { JobKind, LintIssue, ResultBodies, WorldCollection, WorldPart } from "../shared/protocol";
import type { StateView } from "../shared/state-view";
import type { KindDef, RelationTypeDef, WorldDoc } from "../shared/world";
import type { Viewport } from "./layout";
import type { ProtocolClient, SyncState } from "./protocol-client";
import type { RequestBody, Send } from "./registry";
import type { Readable, Store } from "./store";
import { useSelect } from "./store";
import type { UiCatalog } from "./ui-registry";

export type Mode = "play" | "gm" | "build" | "settings";

/** Play's bottom-bar destinations. */
export type Dest = "now" | "me" | "people" | "places" | "story";

/** Where a panel lives: a Play destination, or GM mode. */
export type PanelHome = Dest | "gm";

export type SheetKind = "person" | "place" | "item" | "account" | "quest" | "money";

/** A detail sheet opened over a Play destination. */
export interface SheetRoute {
  kind: SheetKind;
  id: string;
}

export interface PlayState {
  dest: Dest;
  /** The sub-tab chosen in each destination, kept for the session. */
  tab: Partial<Record<Dest, PanelId>>;
  /** Sheets open over the destination; the last one shows. */
  stack: SheetRoute[];
}

/** GM mode's sections: the engine's own, and each pack's tab by its registered id, which holds a dot (`economy.money`). */
export type GmSection = "world" | "places" | "story" | "chat" | `${string}.${string}`;

export interface GmState {
  /** The truth shows only once the gate is opened; leaving GM mode closes it again. */
  revealed: boolean;
  section: GmSection;
}

export type SettingsPage = "home" | "helper" | "model" | "steps" | "minds" | "timeouts" | "realism" | "checks" | "time" | "extraction" | "swipes" | "preset" | "display" | "caveats" | "diagnostics";

export type BuildRoute =
  | { view: "worlds" }
  | { view: "world"; worldId: WorldId }
  | { view: "collection"; worldId: WorldId; collection: WorldCollection }
  | { view: "item"; worldId: WorldId; collection: WorldCollection; id: string | null }
  | { view: "part"; worldId: WorldId; part: WorldPart }
  | { view: "check"; worldId: WorldId }
  | { view: "job"; worldId: WorldId; kind: JobKind };

export interface UiState {
  mode: Mode;
  play: PlayState;
  gm: GmState;
  build: BuildRoute;
  settings: { page: SettingsPage };
  /** The float overlay that is open; one at a time. */
  overlay: "map" | "palette" | "world" | null;
  /** Bumped each time LumiRPEngine Studio says an offer is waiting (DESIGN §15), so Build reviews it. */
  studioOffer: number;
  /** Ids show beside names everywhere (Settings → Display); kept on this device under SHOW_IDS_KEY. */
  showIds: boolean;
}

/** The localStorage key Show ids is kept under. */
export const SHOW_IDS_KEY = "lre:ui:show-ids";

/** The UI state a session starts with. */
export function initialUi(showIds: boolean): UiState {
  return { mode: "play", play: { dest: "now", tab: {}, stack: [] }, gm: { revealed: false, section: "world" }, build: { view: "worlds" }, settings: { page: "home" }, overlay: null, studioOffer: 0, showIds };
}

/** Play at a destination, on one of its panels when given. Navigating starts with no sheet open. */
export function playAt(ui: UiState, dest: Dest, panel?: PanelId): UiState {
  return { ...ui, mode: "play", play: { dest, tab: panel === undefined ? ui.play.tab : { ...ui.play.tab, [dest]: panel }, stack: [] } };
}

/** A panel shown where it lives: its Play destination on its tab, or GM mode for a GM panel. */
export function showPanel(ui: UiState, catalog: UiCatalog, panel: PanelId): UiState {
  const home = catalog.panels.find((def) => def.id === panel)?.home;
  if (home === undefined) return ui;
  return home === "gm" ? { ...ui, mode: "gm" } : playAt(ui, home, panel);
}

/** A sheet opened over the current Play destination. */
export function pushSheet(ui: UiState, route: SheetRoute): UiState {
  return { ...ui, mode: "play", play: { ...ui.play, stack: [...ui.play.stack, route] } };
}

/** Back one level: the sheet under the top one, or the destination itself. */
export function popSheet(ui: UiState): UiState {
  return ui.play.stack.length === 0 ? ui : { ...ui, play: { ...ui.play, stack: ui.play.stack.slice(0, -1) } };
}

/**
 * Opens the host's active chat. What was open over the last one closes first: the float overlays
 * and every Play sheet, since a sheet asks its chat for its entity's detail (`lre.view.open`) and
 * the new chat's player opened nothing. GM mode closes its own gate on the change.
 */
export function switchChat(app: Pick<App, "client" | "ui" | "overlays">, chatId: ChatId | null): void {
  const now = app.client.getState();
  if (chatId === now.chatId && now.status !== "closed") return;
  app.overlays.closeMap();
  app.overlays.closePalette();
  app.overlays.closeWorld();
  app.ui.update((ui) => (ui.play.stack.length === 0 ? ui : { ...ui, play: { ...ui.play, stack: [] } }));
  void app.client.open(chatId);
}

export type PaletteTab = "actions" | "combat" | "buy" | "pay" | "transfer" | "drive" | "lend" | "timelapse";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

export interface DrawerState {
  open: boolean;
}

export interface HostBridge {
  viewport: Readable<Viewport>;
  drawer: Readable<DrawerState>;
  components: SpindleComponentsHelper;
  confirm(title: string, message: string, variant: "info" | "warning" | "danger", confirmLabel: string): Promise<boolean>;
  worldBooks(): Promise<{ id: string; name: string }[]>;
  connections(): Promise<{ id: string; name: string; model: string | null }[]>;
  download(fileName: string, text: string): void;
  activeChat(): ChatId | null;
  /** Runs the host's Regenerate (`command:action-regenerate`, gated by `generation`); false when unavailable. */
  regenerate(): Promise<boolean>;
  /** Scrolls a reply into view in the chat; false when it isn't mounted (scrolled out of a virtual list, another chat). */
  revealMessage(messageId: MessageId): boolean;
}

/** The world being edited in Build: the draft the backend returned and the revision it started from. */
export interface Draft {
  worldId: WorldId;
  base: RevisionId | null;
  /** The working copy's version as Build last read it (DESIGN §23): a push with a newer one means it changed elsewhere. */
  version: number;
  /** A reload from the backend (a change made elsewhere, or a first load), not Build's own write: forms keep their edits over a reload and follow Build's writes. */
  reloaded?: boolean;
  doc: WorldDoc;
  lint: LintIssue[];
  dirty: boolean;
  /** Kinds the registered packs define (`lre.world get`), for kind pickers and typed field forms; world kinds win. */
  packKinds: Record<string, KindDef>;
  /** Relation types the registered packs define (`lre.world get`), for relation pickers; world relation types win. */
  packRelations: Record<string, RelationTypeDef>;
  /** Every function a formula may call outside an effect argument (`lre.world get`), for the expression editor. */
  functions: string[];
}

export interface Overlays {
  openMap(): Promise<void>;
  closeMap(): void;
  openPalette(tab?: PaletteTab): Promise<void>;
  closePalette(): void;
  /** The World sheet: time, place, scene, weather and cash with ✎ fixes, the call meter, the clock toggle, Map and Actions. */
  openWorld(): Promise<void>;
  closeWorld(): void;
}

export interface App {
  client: ProtocolClient;
  send: Send;
  sync: Readable<SyncState>;
  catalog: UiCatalog;
  ui: Store<UiState>;
  toasts: Store<Toast[]>;
  host: HostBridge;
  overlays: Overlays;
  drafts: Store<Draft | null>;
  toast(text: string, tone?: Toast["tone"]): void;
  /** Sends a request; on an error, shows it and resolves null. */
  request<K extends keyof ResultBodies>(body: Extract<RequestBody, { type: K }>): Promise<ResultBodies[K] | null>;
}

export const AppContext = createContext<App | null>(null);

export function useApp(): App {
  const app = useContext(AppContext);
  if (!app) throw new Error("LumiRPEngine component rendered outside its app");
  return app;
}

export function useView(): StateView | null {
  return useSelect(useApp().sync, (state) => state.view);
}

export function useUi<S>(select: (state: UiState) => S): S {
  return useSelect(useApp().ui, select);
}

/** Builds `App.request` over a client and a toast sink. */
export function makeRequest(send: Send, toast: (text: string, tone: Toast["tone"]) => void): App["request"] {
  return async <K extends keyof ResultBodies>(body: Extract<RequestBody, { type: K }>): Promise<ResultBodies[K] | null> => {
    const message = await send(body);
    if (message.type === "lre.error") {
      toast(message.lint && message.lint.length > 0 ? `${message.message} (${message.lint.length} issue${message.lint.length === 1 ? "" : "s"})` : message.message, "error");
      return null;
    }
    return message.body as ResultBodies[K];
  };
}
