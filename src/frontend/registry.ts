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
import type { OrgView } from "../shared/org-view";
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
  /**
   * Changes when the chat moves on (a turn, an edit, an undo: `gmReloadKey`), not when the GM view is
   * only loaded again: a tab that reads more than `gm` reads it again on this, not on `gm`, so one
   * change isn't read twice (once for the chat moving on, once for the reload after it).
   */
  reloadKey: string;
  busy: boolean;
  /** Sends the operations as one `lre.edit` (all or none, one GM edit chip), then reloads the view; true when it was accepted. The GM view then says what it did, with its Undo. */
  edit(ops: EditOp[]): Promise<boolean>;
  /** Asks for the GM view again (after a request other than an edit changed the chat). */
  reload(): Promise<void>;
  /**
   * After a change sent through a request of its own (GM → Workspace's writes, each one GM edit with
   * its chip): the GM view loads again and its notice says `text` with that change's Undo (`undo`),
   * as after an edit; one held while a reply is written (`pending`, no chip yet) is said in a toast.
   */
  changed(text: string, result: { pending?: boolean; undo?: string | null }): Promise<void>;
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

/** The tabs the orgs pack's own page draws (ORG-SPEC §4.3): a pack's part may join one of them. */
export type OrgShellTab = "overview" | "people" | "rules";

/** What a pack's tab or part of an organization's page gets: the page as the reader may see it, and its own section of it. */
export interface OrgTabProps {
  chatId: ChatId;
  org: OrgView;
  /** `org.sections[def.section]`: what the pack's `r.orgSection` built for this reader. */
  section: JsonValue;
  state: StateView;
  send: Send;
  /** Opens a sheet over the organization's page. */
  open(route: SheetRoute): void;
}

/** What a pack's tab or part gets in GM → Orgs (ORG-SPEC §6.1): the page as the GM sees it, and the GM view's own props, to change it by edits. */
export interface OrgGmTabProps extends OrgTabProps {
  gm: GmSectionProps;
}

/**
 * A pack's tab on an organization's page (ORG-SPEC §4.3, `r.orgTab`), the UI half of the pack's
 * `r.orgSection`: it shows only while the page holds that section, which the backend builds only for
 * a reader who holds its power, at the organization's Money level.
 */
export interface OrgTabDef {
  /** Unique across packs, with a dot (`economy.money`). */
  id: `${string}.${string}`;
  label: string;
  /** Its place among the page's tabs, the shell's being Overview 10, People 20 and Rules 90; ties by id. */
  order: number;
  /** The section it draws (`OrgView.sections`). */
  section: string;
  /** A part at the foot of one of the shell's tabs rather than a tab of its own (People's Payroll): the page draws it in a Section headed by `label`. */
  within?: OrgShellTab;
  component: ComponentType<OrgTabProps>;
  /** Drawn instead of `component` in GM → Orgs, with the GM's controls; absent, GM → Orgs draws `component`. */
  gm?: ComponentType<OrgGmTabProps>;
}

/** What a pack's part of Play's place sheet gets: the place, whether the player character is there, and the sheet's own props. */
export interface PlacePartProps {
  chatId: ChatId;
  place: string;
  /** The player character is at this very place (the map's `here`). */
  here: boolean;
  state: StateView;
  send: Send;
  /** Opens a sheet over the place sheet. */
  open(route: SheetRoute): void;
}

/** A part a pack adds to Play's place sheet, under its own details (the gear pack's Things here); it draws nothing where it has nothing to say. */
export interface PlacePartDef {
  /** Unique across packs, with a dot (`gear.here`). */
  id: `${string}.${string}`;
  /** Order among the parts, ties by id. */
  order: number;
  component: ComponentType<PlacePartProps>;
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
  /** A tab, or a part of one of the shell's tabs, on an organization's page in Orgs; ids are unique across packs. */
  orgTab(def: OrgTabDef): void;
  /** A part of Play's place sheet, under the place's details; ids are unique across packs. */
  placePart(def: PlacePartDef): void;
}

export interface UiPackDef {
  id: PackId;
  register(registry: UiRegistry): void;
}
