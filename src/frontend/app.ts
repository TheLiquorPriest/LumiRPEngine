// The frontend's app object: the protocol client, the UI registry catalog, local UI state, host
// capabilities and overlay control, shared with every Preact tree (drawer, HUD, chips, sheets,
// map) through one context. UI state: a mode, Play's
// destination with its sub-tabs and sheet stack, GM's gate, Build's route and Settings' page.

import { createContext } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import type { MapGridReply, MapWrote } from "../shared/api";
import type { ChatId, MessageId, PanelId, RevisionId, WorldId } from "../shared/ids";
import type { ResultBodies } from "../shared/protocol";
import type { JobKind } from "../shared/jobs";
import type { LintIssue } from "../shared/lint";
import type { WorldCollection, WorldPart } from "../shared/world";
import type { JsonObject } from "../shared/json";
import type { Chip, StateView } from "../shared/state-view";
import type { KindDef, RelationTypeDef, WorldDoc } from "../shared/world";
import type { Viewport } from "./layout";
import type { ProtocolClient, SyncState } from "./protocol-client";
import type { RequestBody, Send } from "./registry";
import type { Readable, Store } from "../ui/store";
import { useSelect } from "../ui/store";
import type { UiCatalog } from "./ui-registry";

/** What a control the host draws hands back: its element, a way to change its options, and a way to take it away. */
export interface ControlHandle<O> {
  readonly componentId: string;
  readonly element: HTMLElement;
  update(patch: Partial<O>): void;
  destroy(): void;
}

/** A control's place: the element itself, or a selector naming it. */
export type ControlTarget = Element | string;

export interface SwitchOptions {
  checked?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  onChange?(checked: boolean): void;
}

export interface SelectOptions {
  value?: string;
  options?: readonly { value: string; label: string; sublabel?: string; disabled?: boolean }[];
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  onChange?(value: string): void;
}

export interface SliderOptions {
  min: number;
  max: number;
  value?: number;
  step?: number;
  integer?: boolean;
  label?: string;
  hint?: string;
  format?: { suffix?: string };
  disabled?: boolean;
  onCommit?(value: number): void;
  onDragValue?(value: number | null): void;
}

export interface ModelPickerOptions {
  value?: string;
  connection?: { kind: "llm"; id?: string };
  onChange?(model: string): void;
}

/** The four controls the kept views mount through the host, each drawn by the shell they run in: Lumiverse's own in the drawer, the page's in the web shell. */
export interface HostControls {
  mountSwitch(target: ControlTarget, options?: SwitchOptions): ControlHandle<SwitchOptions> & { getValue(): boolean };
  mountSelect(target: ControlTarget, options: SelectOptions): ControlHandle<SelectOptions> & { getValue(): string };
  mountRangeSlider(target: ControlTarget, options: SliderOptions): ControlHandle<SliderOptions> & { getValue(): number };
  mountModelCombobox(target: ControlTarget, options: ModelPickerOptions): ControlHandle<ModelPickerOptions>;
}

/** The drawer's modes. `harness` holds the harness's own pages and is offered only while the open chat plays on the harness (`harness/mode.ts`). */
export type Mode = "play" | "gm" | "build" | "settings" | "harness";

/** Play's bottom-bar destinations. */
export type Dest = "now" | "me" | "people" | "orgs" | "places" | "story";

/** Where a panel lives: a Play destination, or the World page. */
export type PanelHome = Dest | "gm";

/** `org_edit`: an organization's editors in Play (ORG-SPEC §4.4): a member's sheet, Hire someone, Admit a member, a position, a delegation, its dues. `fight`: the fight's page. */
export type SheetKind = "person" | "place" | "item" | "account" | "quest" | "money" | "org" | "org_edit" | "fight";

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

/** The World page's sections: the engine's own, and each pack's tab by its registered id, which holds a dot (`economy.money`). */
export type GmSection = "world" | "places" | "things" | "story" | "chat" | `${string}.${string}`;

export interface GmState {
  /** The truth shows only once the gate is opened; leaving the World page closes it again. */
  revealed: boolean;
  section: GmSection;
  /** A character to open in `section` once it shows (a link from another GM page); it is taken when the page opens. */
  focus?: string;
}

export type SettingsPage = "home" | "helper" | "model" | "steps" | "minds" | "narrator" | "timeouts" | "agents" | "roles" | "context" | "main" | "assistant" | "prompts" | "retention" | "speed" | "realism" | "checks" | "time" | "extraction" | "swipes" | "preset" | "lore" | "display" | "caveats" | "diagnostics" | "mcp" | "story";

/** The Harness tab's pages: LumiAH's (the agents at work, where the tab opens) and the story's own, Cast, Record and Notebook (`story/`). */
export type HarnessPage = "agents" | "cast" | "record" | "notebook";

/** Where the Harness tab is: its page, and what that page opens at: someone on Cast, a reply on Record. */
export interface HarnessRoute {
  page: HarnessPage;
  entity?: string;
  at?: { messageId: string; swipeId: number };
}

/**
 * Where Settings is: a page, and on a page with pages of its own one of them (`sub`: one of the
 * Agents page's sections, a role on Roles or on Context); `at`, a part of it to open at (a role
 * page's section); `open`, the Prompts page and text to open.
 */
export interface SettingsRoute {
  page: SettingsPage;
  sub?: string;
  at?: string;
  open?: { page: string; text?: string };
}

/** Back from `route`: a page within a page goes to that page, a page to Settings home. */
export function settingsBack(route: SettingsRoute): SettingsRoute {
  return route.sub !== undefined ? { page: route.page } : { page: "home" };
}

/**
 * What takes focus once Settings has gone from `from` to `to`: Back put it on the row that opened the
 * page left (home's row for a page, the page's row for a page within it); going in, the part of the
 * new page it opens at (`at`), else its Back, at its header. `reveal` is how the scroller brings it
 * into view.
 */
export function settingsFocus(from: SettingsRoute | null, to: SettingsRoute): { selector: string; reveal: "start" | "nearest" } {
  const up = from !== null && (to.page === "home" ? from.page !== "home" : from.page === to.page && from.sub !== undefined && to.sub === undefined);
  if (!up || from === null) return to.at !== undefined ? { selector: `[data-lre-agent-section="${to.at}"]`, reveal: "start" } : { selector: ".lre-page-header button", reveal: "start" };
  return to.page === "home" ? { selector: `[data-lre-settings="${from.page}"] button`, reveal: "nearest" } : { selector: `[data-lre-settings-sub="${from.sub}"] button`, reveal: "nearest" };
}

/** The world home's lists of entities (ITEMS-SPEC §10.1): characters, organizations, things and money records. */
export type EntityGroup = "people" | "orgs" | "things" | "money";

export type BuildRoute =
  | { view: "worlds" }
  | { view: "world"; worldId: WorldId }
  | { view: "collection"; worldId: WorldId; collection: WorldCollection }
  /** One of the world home's lists of entities; Things is its own page (by place, by owner). */
  | { view: "entities"; worldId: WorldId; group: EntityGroup }
  /** `at`: the lint path the page opens at (Problems' Open), for an editor with sheets of its own; a routine opens the block it names. */
  | { view: "item"; worldId: WorldId; collection: WorldCollection; id: string | null; at?: string }
  | { view: "part"; worldId: WorldId; part: WorldPart }
  | { view: "check"; worldId: WorldId }
  | { view: "job"; worldId: WorldId; kind: JobKind }
  /** Build → Lore → Secrecy in your World Info: the user's books moved to secret marks (DESIGN §4.2). */
  | { view: "secrecy"; worldId: WorldId };

export interface UiState {
  mode: Mode;
  play: PlayState;
  gm: GmState;
  build: BuildRoute;
  settings: SettingsRoute;
  harness: HarnessRoute;
  /** The float overlay that is open; one at a time. */
  overlay: "map" | "palette" | "world" | null;
  /** Ids show beside names everywhere (Settings); kept on this device under SHOW_IDS_KEY. */
  showIds: boolean;
}

/** The localStorage key Show ids is kept under. */
export const SHOW_IDS_KEY = "lre:ui:show-ids";

/** The UI state a session starts with. */
export function initialUi(showIds: boolean): UiState {
  return { mode: "play", play: { dest: "now", tab: {}, stack: [] }, gm: { revealed: false, section: "world" }, build: { view: "worlds" }, settings: { page: "home" }, harness: { page: "agents" }, overlay: null, showIds };
}

/** Play at a destination, on one of its panels when given. Navigating starts with no sheet open. */
export function playAt(ui: UiState, dest: Dest, panel?: PanelId): UiState {
  return { ...ui, mode: "play", play: { dest, tab: panel === undefined ? ui.play.tab : { ...ui.play.tab, [dest]: panel }, stack: [] } };
}

/** A panel shown where it lives: its Play destination on its tab, or the World page for a World panel. */
export function showPanel(ui: UiState, catalog: UiCatalog, panel: PanelId): UiState {
  const home = catalog.panels.find((def) => def.id === panel)?.home;
  if (home === undefined) return ui;
  return home === "gm" ? { ...ui, mode: "gm" } : playAt(ui, home, panel);
}

/** A sheet opened over the current Play destination. */
export function pushSheet(ui: UiState, route: SheetRoute): UiState {
  return { ...ui, mode: "play", play: { ...ui.play, stack: [...ui.play.stack, route] } };
}

/** Play at a destination with one sheet open over it: a link from one destination into another's page (Cast's groups open their organization in Orgs). */
export function openAt(ui: UiState, dest: Dest, route: SheetRoute): UiState {
  return pushSheet(playAt(ui, dest), route);
}

/**
 * The `org` sheet's route (ORG-SPEC §4.3): an organization's page, opened on one of its tabs when
 * `tab` names one (`overview`, `people`, `rules`, or a pack's `r.orgTab` id, as Money → Assets opens
 * a stake's Ownership). Its id is the organization's, URI-encoded so it holds no `#`, then `#` and the
 * tab; a plain id (`alder_automotive_co`) reads as itself.
 */
export function orgRoute(org: string, tab?: string): SheetRoute {
  return { kind: "org", id: tab === undefined ? encodeURIComponent(org) : `${encodeURIComponent(org)}#${tab}` };
}

/** The organization an `org` sheet's id names (`orgRoute`), and the tab it opens on (null: none named); a head that doesn't decode reads as written. */
export function orgRouteOf(id: string): { org: string; tab: string | null } {
  const at = id.indexOf("#");
  const head = at < 0 ? id : id.slice(0, at);
  const tab = at < 0 ? null : id.slice(at + 1) || null;
  try {
    return { org: decodeURIComponent(head), tab };
  } catch {
    return { org: head, tab };
  }
}

/** Back one level: the sheet under the top one, or the destination itself. */
export function popSheet(ui: UiState): UiState {
  return ui.play.stack.length === 0 ? ui : { ...ui, play: { ...ui.play, stack: ui.play.stack.slice(0, -1) } };
}

/**
 * Opens the host's active chat. What was open over the last one closes first: the float overlays
 * and every Play sheet, since a sheet asks its chat for its entity's detail (`lre.view.open`) and
 * the new chat's player opened nothing. The World page closes its own spoiler gate on the change.
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
  /** A change of his made at once, which the toast offers to take back: its chat and the edit's id its Undo takes. */
  undo?: { chat: ChatId; edit: string };
}

export interface DrawerState {
  open: boolean;
}

export interface HostBridge {
  viewport: Readable<Viewport>;
  drawer: Readable<DrawerState>;
  components: HostControls;
  confirm(title: string, message: string, variant: "info" | "warning" | "danger", confirmLabel: string): Promise<boolean>;
  worldBooks(): Promise<{ id: string; name: string }[]>;
  connections(): Promise<{ id: string; name: string; model: string | null }[]>;
  download(fileName: string, text: string): void;
  activeChat(): ChatId | null;
  /** Runs the host's Regenerate or Continue (`command:action-regenerate`, `action-continue`, gated by `generation`); false when unavailable. */
  generate(as: "regenerate" | "continue"): Promise<boolean>;
  /** Closes Lumiverse's drawer, which on a phone covers the chat and the float widgets over it; false when it could not be closed. */
  closeDrawer(): Promise<boolean>;
  /** Scrolls a reply into view in the chat, closing the drawer first where it covers the chat (a phone's); false when it isn't mounted (scrolled out of a virtual list, another chat). */
  revealMessage(messageId: MessageId): Promise<boolean>;
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
  /** Each registered pack's own label, by its id (`lre.world get`): what Build shows wherever it names a pack. */
  packLabels: Record<string, string>;
  /** Every function a formula may call outside an effect argument (`lre.world get`), for the expression editor. */
  functions: string[];
}

/** An intent gate's Edit (DESIGN §5.1): the chip whose read action the palette changes, and that action with the read's picks. */
export interface PaletteEdit {
  chatId: ChatId;
  chip: Chip;
  action: string;
  params: JsonObject;
}

export interface Overlays {
  /** `fullscreen`: the map fills the window at any width (the map's own Full screen), the drawer closed first where it is open. */
  openMap(how?: { fullscreen?: boolean }): Promise<void>;
  closeMap(): void;
  /** `edit`: the palette opens to change an intent gate's read action (DESIGN §5.1), its picks made, and plays it through the chip. */
  openPalette(tab?: PaletteTab, edit?: PaletteEdit): Promise<void>;
  closePalette(): void;
  /** The World sheet: time, place, scene, weather and cash with ✎ fixes, the call meter, the clock toggle, Map and Actions. */
  openWorld(): Promise<void>;
  closeWorld(): void;
}

/** One stroke of squares on a grid: the symbol laid on single squares, a rectangle's corners or a line's ends (columns and rows counted from 1). */
export interface MapStroke {
  symbol: string;
  squares?: number[][];
  rect?: number[][];
  line?: number[][];
}

/** A grid laid for a place that has none: its size in squares, how wide a square is in feet, and a name. */
export interface MapLaying {
  width: number;
  height: number;
  feet: number;
  title?: string;
}

/**
 * The owner's hand on a chat's map (plan §8.2; PlanChatUI-4): the grid of a place in full, someone dragged to a square, squares
 * changed, a grid laid, and the Undo of each. Each is his own change on the chat's line, told to the Author. Squares are counted
 * from 1 here, as RPE counts them. A refusal is thrown with RPE's words.
 */
export interface MapHand {
  grid(chat: ChatId, place: string): Promise<MapGridReply>;
  move(chat: ChatId, place: string, who: string, square: readonly [number, number]): Promise<MapWrote>;
  paint(chat: ChatId, place: string, strokes: readonly MapStroke[]): Promise<MapWrote>;
  lay(chat: ChatId, place: string, laying: MapLaying): Promise<MapWrote>;
  undo(chat: ChatId, edit: string): Promise<void>;
  /** How the chat's map shows what its character knows: Known, or Fog; the chat's own setting (`map.display`), in force at once. */
  display(chat: ChatId, display: "knowledge" | "fog"): Promise<void>;
}

/**
 * What waits for his next message from a panel (plan §10.10), where the App is taken to RPE's typed routes: sent now, its line put in
 * the chat as his message and a reply started (`POST /api/v1/chats/:chat/plays`), or taken back (`DELETE /api/v1/chats/:chat/requests/
 * :request`), each by the request's id the state view gives (`StateView.staged`); and a press a turn did not carry out
 * (`StateView.notCarried`), held again for his next message (`POST …/requests/:request/again`) or dropped (`…/drop`). A refusal is
 * thrown with RPE's words.
 */
export interface NextMessage {
  sendNow(chat: ChatId, request: string): Promise<void>;
  takeBack(chat: ChatId, request: string): Promise<void>;
  again(chat: ChatId, request: string): Promise<void>;
  drop(chat: ChatId, request: string): Promise<void>;
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
  /** Shows a toast; `undo`, a change made at once that it offers to take back. */
  toast(text: string, tone?: Toast["tone"], undo?: Toast["undo"]): void;
  /** Sends a request; on an error, shows it and resolves null. */
  request<K extends keyof ResultBodies>(body: Extract<RequestBody, { type: K }>): Promise<ResultBodies[K] | null>;
  /** Shows one of RPE's own pages (the Live page, a turn's page) where the shell shows its pages; absent where the App has no shell to ask. */
  open?(route: { page: string; chat?: string | null; at?: readonly string[] }): void;
  /** The owner's hand on a chat's map, where the App is taken to RPE's typed routes; absent where it is not, and the map panel then shows no tools. */
  maps?: MapHand;
  /** What waits for his next message, sent now or taken back, where the App is taken to RPE's typed routes; absent where it is not. */
  next?: NextMessage;
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

/** The chat's world, as its revision has it, with the packs' kinds: what Build's forms read on the World page (places, owners, fields, a preview's calendar and tables); null until it is read. */
export function useChatWorld(send: Send): WorldDoc | null {
  const view = useView();
  const worldId = view?.worldId ?? null;
  const revision = view?.revision ?? null;
  const [doc, setDoc] = useState<WorldDoc | null>(null);
  useEffect(() => {
    if (worldId === null) return;
    let live = true;
    void send({ type: "lre.world", op: "get", worldId, ...(revision ? { revision } : {}) }).then((m) => {
      if (!live || m.type !== "lre.result" || m.request !== "lre.world" || !m.body.world) return;
      const world = m.body.world;
      setDoc({ ...world, kinds: { ...m.body.packKinds, ...world.kinds } });
    });
    return () => {
      live = false;
    };
  }, [worldId, revision]);
  return doc;
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
