// The UI registry contract for pack `ui` modules (DESIGN §3, §12; ARCHITECTURE §5).
// A pack's ui default-exports a UiPackDef. Components are Preact and render the view models
// the pack's core builds (`PanelViewDef`); they never compute state. Every interaction goes
// to the backend through `send`, as a protocol request.

import type { ComponentType } from "preact";
import type { JsonObject, JsonValue } from "../shared/json";
import type { ChatId, PackId, PanelId } from "../shared/ids";
import type { FrontendToBackend, ResultMessage, ErrorMessage, LintIssue, WorldCollection } from "../shared/protocol";
import type { ChipKind, Chip, StateView } from "../shared/state-view";
import type { WorldDoc } from "../shared/world";

/** Requests without the envelope fields; `send` adds `lre` and `reqId`. */
export type RequestBody = FrontendToBackend extends infer R ? (R extends FrontendToBackend ? Omit<R, "lre" | "reqId"> : never) : never;

/** Sends a request and resolves with its result or error. */
export type Send = (request: RequestBody) => Promise<ResultMessage | ErrorMessage>;

export interface PanelProps {
  chatId: ChatId;
  /** The panel's view model from `StateView.panels[id]`. */
  view: JsonValue;
  state: StateView;
  send: Send;
}

/** A Play tab section (DESIGN §12: Scene, You, Money, Garage, Gear, Cast, Calendar, Quests, …). */
export interface PanelDef {
  id: PanelId;
  label: string;
  /** Order within Play. */
  order: number;
  component: ComponentType<PanelProps>;
}

export interface EditorProps {
  world: WorldDoc;
  collection: WorldCollection;
  id: string | null;
  send: Send;
}

/** A Build editor for one world collection (schema-driven by default). */
export interface EditorDef {
  collection: WorldCollection;
  label: string;
  component: ComponentType<EditorProps>;
}

/** A pack's own fields for its `config`, edited in Build on the pack's entry. */
export interface PackConfigProps {
  world: WorldDoc;
  /** The config as edited; the generic JSON field below edits the same object. */
  config: JsonObject;
  lint: readonly LintIssue[];
  onChange(next: JsonObject): void;
}

export interface ChipProps {
  chip: Chip;
  chatId: ChatId;
  send: Send;
}

export interface UiRegistry {
  panel(def: PanelDef): void;
  editor(def: EditorDef): void;
  /** Dedicated fields for the registering pack's config, shown above its config as JSON. */
  config(component: ComponentType<PackConfigProps>): void;
  /** Overrides the default chip rendering for a kind. */
  chip(kind: ChipKind, component: ComponentType<ChipProps>): void;
}

export interface UiPackDef {
  id: PackId;
  register(registry: UiRegistry): void;
}
