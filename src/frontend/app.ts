// The frontend's app object: the protocol client, the UI registry catalog, local UI state, host
// capabilities and overlay control, shared with every Preact tree (drawer, HUD, chips, sheets,
// map) through one context.

import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { SpindleComponentsHelper } from "lumiverse-spindle-types";
import type { ChatId, PanelId, RevisionId, WorldId } from "../shared/ids";
import type { JobKind, LintIssue, ResultBodies, WorldCollection, WorldPart } from "../shared/protocol";
import type { StateView } from "../shared/state-view";
import type { KindDef, RelationTypeDef, WorldDoc } from "../shared/world";
import type { Viewport } from "./layout";
import type { ProtocolClient, SyncState } from "./protocol-client";
import type { RequestBody, Send } from "./registry";
import type { Readable, Store } from "./store";
import { useSelect } from "./store";
import type { UiCatalog } from "./ui-registry";

export type Section = "play" | "build" | "settings";

export type BuildRoute =
  | { view: "worlds" }
  | { view: "world"; worldId: WorldId }
  | { view: "collection"; worldId: WorldId; collection: WorldCollection }
  | { view: "item"; worldId: WorldId; collection: WorldCollection; id: string | null }
  | { view: "part"; worldId: WorldId; part: WorldPart }
  | { view: "check"; worldId: WorldId }
  | { view: "job"; worldId: WorldId; kind: JobKind };

export interface UiState {
  section: Section;
  playPanel: PanelId | null;
  build: BuildRoute;
  /** The map renders in the drawer when the drawer could not be closed (DESIGN §12 fallback). */
  mapInDrawer: boolean;
  /** The float overlay that is open; one at a time. */
  overlay: "map" | "palette" | null;
  /** Bumped each time LumiRPEngine Studio says an offer is waiting (DESIGN §15), so Build reviews it. */
  studioOffer: number;
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
}

/** The world being edited in Build: the draft the backend returned and the revision it started from. */
export interface Draft {
  worldId: WorldId;
  base: RevisionId | null;
  /** The stored draft's write count as Build last read it (0 when none is stored): a push with another means it changed elsewhere. */
  version: number;
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
