// The UI registry contract for pack `ui` modules (DESIGN §3, §12; ARCHITECTURE §5). A pack's ui
// default-exports a UiPackDef. Components are Preact and render the
// view models the pack's core builds (`PanelViewDef`); they never compute state. Every interaction
// goes to the backend through `send`, as a protocol request.

import type { ComponentType } from "preact";
import type { PanelHome, SheetKind, SheetRoute } from "./app";
import type { IconName } from "./icons";
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

/** A panel of Play (DESIGN §12: Scene, You, Money, Garage, Gear, Cast, Calendar, Quests, …) or of GM mode (GM view, Context). */
export interface PanelDef {
  id: PanelId;
  label: string;
  /** Order within its home, ties by id. */
  order: number;
  /** The Play destination it shows in, or GM mode. */
  home: PanelHome;
  component: ComponentType<PanelProps>;
}

/** A detail sheet over a Play destination; it renders `StateView` data only. */
export interface SheetProps {
  chatId: ChatId;
  /** The entity, place, account or quest the sheet shows. */
  id: string;
  state: StateView;
  send: Send;
  /** Opens a further sheet over this one. */
  open(route: SheetRoute): void;
  /** Back one level. */
  close(): void;
}

/**
 * A compact card in Play → Now: at most three rows with a link to its panel, or
 * null when there's nothing worth showing. It shows only while its panel is visible, and its view
 * is that panel's (`StateView.panels[panel]`).
 */
export interface GlanceDef {
  id: string;
  order: number;
  panel: PanelId;
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

/** A field of a place a pack reads (a cash machine, a bank branch): places have no kinds, so their fields are JSON unless a pack draws an editor for one. */
export interface PlaceFieldEditorProps {
  doc: WorldDoc;
  place: { id: string; fields: JsonObject };
  field: string;
  value: JsonValue | undefined;
  lint: readonly LintIssue[];
  /** The field's document path (`places.<id>.fields.<field>`). */
  path: string;
  onChange(next: JsonValue | undefined): void;
}

export interface PlaceFieldDef {
  field: string;
  label: string;
  component: ComponentType<PlaceFieldEditorProps>;
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
  /** Sends the operations as one `lre.edit` (all or none, one GM edit chip), then reloads the view; true when it was accepted. The GM view then says what it did, with its Undo. */
  edit(ops: EditOp[]): Promise<boolean>;
  /** Asks for the GM view again (after a request other than an edit changed the chat). */
  reload(): Promise<void>;
  send: Send;
}

/** A tab of the GM view (DESIGN §7) a pack adds, after the engine's own World, Places and Story. */
export interface GmSectionDef {
  /** Unique across packs, with a dot (`economy.money`). */
  id: `${string}.${string}`;
  label: string;
  /** Its icon in GM mode's bottom bar. */
  icon: IconName;
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
  /** Draws one field of every place with the pack's own editor in Build's place form; one per field. */
  placeField(def: PlaceFieldDef): void;
  /** The detail sheet for one kind of thing; one per kind. */
  sheet(kind: SheetKind, component: ComponentType<SheetProps>): void;
  /** A compact card for Play → Now. */
  glance(def: GlanceDef): void;
}

export interface UiPackDef {
  id: PackId;
  register(registry: UiRegistry): void;
}
