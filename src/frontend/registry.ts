// The UI registry contract for pack `ui` modules (DESIGN §3, §12; ARCHITECTURE §5).
// A pack's ui default-exports a UiPackDef. Components are Preact and render the view models
// the pack's core builds (`PanelViewDef`); they never compute state. Every interaction goes
// to the backend through `send`, as a protocol request.

import type { ComponentType } from "preact";
import type { JsonObject, JsonValue } from "../shared/json";
import type { ChatId, EntityId, FieldId, KindId, PackId, PanelId } from "../shared/ids";
import type { EditOp, FrontendToBackend, ResultMessage, ErrorMessage, LintIssue, WorldCollection } from "../shared/protocol";
import type { ChipKind, Chip, GmView, StateView } from "../shared/state-view";
import type { FieldDef, WorldCurrency, WorldDoc } from "../shared/world";

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

/**
 * A field a pack's kind declares whose value is structured (a person's flows, a job, payment
 * preferences): Build's entity form draws the pack's own editor for it instead of JSON.
 */
export interface FieldEditorProps {
  /** The draft with the packs' kinds and relation types, as the entity form reads it. */
  doc: WorldDoc;
  /** The entity whose field it is, as edited (unsaved changes included). */
  entity: { id: EntityId; kind: KindId; fields: JsonObject };
  field: FieldId;
  def: FieldDef;
  value: JsonValue | undefined;
  /** The lint at the field's path and below. */
  lint: readonly LintIssue[];
  /** The field's document path (`entities.<id>.fields.<field>`), for lint below it. */
  path: string;
  onChange(next: JsonValue | undefined): void;
}

export interface FieldEditorDef {
  /** The kind declaring the field; entities of a kind inheriting from it get the editor too. */
  kind: KindId;
  field: FieldId;
  component: ComponentType<FieldEditorProps>;
}

/** A proposed value of a collection, drawn for a job's review (a map as Play will show it). */
export interface PreviewProps {
  world: WorldDoc;
  collection: WorldCollection;
  id: string;
  value: JsonValue;
}

export interface ChipProps {
  chip: Chip;
  chatId: ChatId;
  send: Send;
}

/** What a pack's GM view tab gets: the GM view as loaded, and the one way it changes the chat. */
export interface GmSectionProps {
  chatId: ChatId;
  gm: GmView;
  currency: WorldCurrency;
  busy: boolean;
  /** Sends the operations as one `lre.edit` (all or none, one Corrected chip), then reloads the view; true when it was accepted. */
  edit(ops: EditOp[]): Promise<boolean>;
  /** Asks for the GM view again (after a request other than an edit changed the chat). */
  reload(): Promise<void>;
  send: Send;
}

/** A tab of the GM view (DESIGN §7) a pack adds, after the engine's own Entities, Places and Tracks. */
export interface GmSectionDef {
  id: string;
  label: string;
  /** Order among the packs' tabs. */
  order: number;
  component: ComponentType<GmSectionProps>;
}

export interface UiRegistry {
  panel(def: PanelDef): void;
  editor(def: EditorDef): void;
  /** Dedicated fields for the registering pack's config, shown above its config as JSON. */
  config(component: ComponentType<PackConfigProps>): void;
  /** Overrides the default chip rendering for a kind. */
  chip(kind: ChipKind, component: ComponentType<ChipProps>): void;
  /** Draws a proposed value of a collection in a job's review; one per collection. */
  preview(collection: WorldCollection, component: ComponentType<PreviewProps>): void;
  /** Adds a tab to the GM view; ids are unique across packs. */
  gm(def: GmSectionDef): void;
  /** Draws one declared field of a kind with the pack's own editor in Build's entity form; one per kind and field. */
  field(def: FieldEditorDef): void;
}

export interface UiPackDef {
  id: PackId;
  register(registry: UiRegistry): void;
}
