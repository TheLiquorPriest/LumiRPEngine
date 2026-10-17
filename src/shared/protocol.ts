// Frontend ↔ backend protocol over Spindle messaging (`ctx.sendToBackend` /
// `spindle.sendToFrontend`, routed by userId and frontendSessionId). ARCHITECTURE §5.
//
// Every message is an envelope `{ lre: PROTOCOL_VERSION, type, ... }`. Requests carry a
// `reqId` chosen by the frontend; the backend answers each with exactly one `lre.result` or
// `lre.error` carrying the same `reqId`. State arrives unsolicited as snapshots and deltas.

import type { JsonObject, JsonValue } from "./json";
import type { LoreIndexAddition } from "./lore";
import type { ActionId, BoundMode, ChatId, ChipId, DomainId, EntityId, FieldId, KindId, Level, MessageId, PanelId, PlaceId, RelationTypeId, RevisionId, StageId, TierId, TrackId, WorldId } from "./ids";
import type { EntityUpgradePick, EventRef, PathHash, ResolveScope, TimeControl, TimeScope, UpgradeAspect, UpgradePicks } from "./ledger";
import type { ExtractionType, UserSettings } from "./settings";
import type { GmView, SheetSectionView, StateView } from "./state-view";
import type { AdjudicationDef, KindDef, RelationTypeDef, WorldDoc, WorldIndex } from "./world";

export const PROTOCOL_VERSION = 1;

interface Envelope<T extends string> {
  lre: typeof PROTOCOL_VERSION;
  type: T;
}

interface Request<T extends string> extends Envelope<T> {
  reqId: string;
}

// ---------------------------------------------------------------- state push

/** One change to a StateView: set or delete the value at `path` (object keys and array indexes). */
export type DeltaOp = { op: "set"; path: (string | number)[]; value: JsonValue } | { op: "del"; path: (string | number)[] };

export interface StateSnapshot extends Envelope<"lre.state.snapshot"> {
  chatId: ChatId;
  /** Per (user, chat) push counter; strictly increasing. */
  rev: number;
  view: StateView;
}

export interface StateDelta extends Envelope<"lre.state.delta"> {
  chatId: ChatId;
  /** The `rev` the ops apply to. A frontend holding another rev sends `lre.state.resync`. */
  base: number;
  rev: number;
  ops: DeltaOp[];
}

// ---------------------------------------------------------------- requests (frontend → backend)

/** The frontend opened (or switched to) a chat; the backend replies with a snapshot. */
export interface HelloRequest extends Request<"lre.hello"> {
  chatId: ChatId | null;
}

export interface ResyncRequest extends Request<"lre.state.resync"> {
  chatId: ChatId;
}

/** A palette, map, command or chip action; the backend appends a user message with `intent` and triggers a generation. */
export interface ActionRequest extends Request<"lre.action"> {
  chatId: ChatId;
  action: ActionId;
  params: JsonObject;
  source: "palette" | "map" | "command" | "chip";
  /** Optional user-visible text for the appended message. */
  text?: string;
}

export interface ChipRequest extends Request<"lre.chip"> {
  chatId: ChatId;
  chip: ChipId;
  /** One of the chip's `actions[].id`. */
  choice: string;
  payload?: JsonObject;
}

/** A player-facing observation: opening detail may materialize it (DESIGN §9.2, "show"). */
export interface ViewOpenRequest extends Request<"lre.view.open"> {
  chatId: ChatId;
  panel: PanelId;
  entity: EntityId | null;
}

/** A ✎ fix on the head: one typed `set` (`EditOp`), written as a `post` entry of kind `fix`. Locked fields are refused. */
export interface FixRequest extends Request<"lre.fix"> {
  chatId: ChatId;
  entity: EntityId;
  field: FieldId;
  value: JsonValue;
}

/**
 * One typed edit (DESIGN §7 GM edits, §12 ✎ fixes). Each is checked against what it touches (a
 * field's type, values and bounds; a relation type's kinds and fields; a tier, a track's stages)
 * and resolved through the core effects, so pack guards apply. A ✎ fix is one `set`; the GM editor
 * sends any of them in order, applied all or none as one `fix` entry.
 *  - `set`, `add`: an entity's field (an owner is `set owner`); `add` stops at the field's bounds.
 *  - `link` adds a relation or replaces its fields; `unlink` removes it.
 *  - `move` puts an entity at a place, out of any container; `put` puts it inside another entity
 *    (`in`), or with `into: null` takes it out to where its container is.
 *  - `adjust` moves money into (positive) or out of an account against `economy.external:correction`.
 *  - `stage` sets a track's stage.
 *  - `entity` sets an entity's tier, agent flag and per-domain level overrides (null follows the tier).
 *  - `spawn` adds an entity; `despawn` takes one out of the world (`gone`, its relations unlinked)
 *    and `restore` brings it back.
 */
export type EditOp =
  | { op: "set"; entity: EntityId; field: FieldId; value: JsonValue }
  | { op: "add"; entity: EntityId; field: FieldId; delta: number }
  | { op: "link"; rel: RelationTypeId; from: EntityId; to: EntityId; fields?: JsonObject; until?: number }
  | { op: "unlink"; rel: RelationTypeId; from: EntityId; to: EntityId }
  | { op: "move"; entity: EntityId; to: PlaceId }
  | { op: "put"; entity: EntityId; into: EntityId | null }
  | { op: "adjust"; account: EntityId; cents: number }
  | { op: "stage"; track: TrackId; to: StageId }
  | { op: "entity"; entity: EntityId; tier?: TierId; agent?: boolean; levels?: Partial<Record<DomainId, number | null>> }
  | { op: "spawn"; kind: KindId; name: string; id?: EntityId; tier?: TierId; place?: PlaceId; agent?: boolean }
  | { op: "despawn"; entity: EntityId }
  | { op: "restore"; entity: EntityId };

/** A GM edit on the head (DESIGN §7): the operations in order, all or none, as one `post` entry of kind `fix`; locked fields are writable. */
export interface EditRequest extends Request<"lre.edit"> {
  chatId: ChatId;
  ops: EditOp[];
}

/** The GM view's data (DESIGN §7), asked for when the GM view opens: never in a state push. */
export interface GmRequest extends Request<"lre.gm"> {
  chatId: ChatId;
}

/**
 * A Play change to the running chat: a realism, time, adjudication or Upgrade marker. With
 * `preview`, nothing is written. An Upgrade with `merge` brings the revision's definition changes in
 * as the picks say.
 */
export type MarkerRequest = Request<"lre.marker"> & { chatId: ChatId; preview?: true } & (
    | { kind: "resolve"; domain: DomainId; scope: ResolveScope; to: Level }
    | { kind: "time"; control: TimeControl; scope: TimeScope; to: JsonValue }
    | { kind: "adjudicate"; to: AdjudicationDef }
    | { kind: "migrate"; to: RevisionId; merge?: UpgradePicks }
  );

/** Where an Upgrade pick is written (DESIGN §4.3 `migrate`): a whole entity, one of its parts, a field, or one relation by type and target. */
export type UpgradeTarget =
  | { entity: EntityId; part: "entity" | UpgradeAspect }
  | { entity: EntityId; part: "field"; field: FieldId }
  | { entity: EntityId; part: "relation"; rel: RelationTypeId; to: string };

/** One change an Upgrade can bring into the chat, with its default pick and why. */
export interface UpgradeChange {
  /** Unique within the preview. */
  id: string;
  label: string;
  /** The chat's value now and the revision's, in words. */
  from: string;
  to: string;
  /** Take or keep; for an entity gone from the revision, keep or remove. */
  options: EntityUpgradePick[];
  /** The default: take what play never touched, keep what it did. */
  pick: EntityUpgradePick;
  why: "changed in play" | "unchanged" | "new" | "removed";
  /** Where a pick is written: both sides of a symmetric or inverse pair, which change together. */
  targets: UpgradeTarget[];
}

export interface UpgradeEntityRow {
  entity: EntityId;
  name: string;
  /** The kind's label. */
  kind: string;
  status: "new" | "removed" | "changed";
  changes: UpgradeChange[];
}

/** What an Upgrade brings into the chat, entity by entity (DESIGN §4.3 `migrate`). */
export interface UpgradePreview {
  /** The revision the chat's definitions come from (its own, unless an earlier Upgrade left them behind) and the one it moves to. */
  from: RevisionId;
  to: RevisionId;
  entities: UpgradeEntityRow[];
  /** Tracks that go back to their start, in words. */
  tracks: string[];
}

/** What a marker would do (DESIGN §9.2: the demotion preview lists predicates whose inputs will freeze; an Upgrade's lists its definition changes). */
export interface MarkerPreview {
  lines: { text: string; tone: "freeze" | "promote" | "materialize" | "info" }[];
  upgrade?: UpgradePreview;
}

/** Keep-report and pause decisions (DESIGN §4.3). */
export type KeepRequest = Request<"lre.keep"> & { chatId: ChatId } & (
    | { choice: "keep"; messageId: MessageId }
    | { choice: "discard"; messageId: MessageId }
    | { choice: "convert"; messageId: MessageId; parentPath: PathHash; refs: EventRef[] }
  );

export interface SettingsGetRequest extends Request<"lre.settings.get"> {}

/**
 * An RFC 7386 merge patch over UserSettings: `null` deletes (unpin a type with
 * `{extraction: {purchase: null}}`) and arrays replace. A `realism.preset` or `modelUse.preset`
 * other than `custom` is expanded by the backend into levels and band caps, or steps and budgets;
 * any manual change sends `preset: "custom"`.
 */
export interface SettingsSetRequest extends Request<"lre.settings.set"> {
  patch: JsonObject;
}

/** Host UI operations only the backend can perform (the frontend has no close-drawer API; DESIGN §12). */
export interface UiRequest extends Request<"lre.ui"> {
  op: "close_drawer";
}

/**
 * Background-lane jobs (DESIGN §13, §15): Import from lore, Build/Refine with AI, Describe a map,
 * Playtest, Check world, and the lore indexing jobs (§4.2). Input: `import_lore` `{bookIds}`;
 * `refine` `{instructions}`; `describe_map` `{scope, prose, mapId?}` (the place drawn, the author's
 * description, and the map's id, by default `<scope>_map`; its one proposal is the map); `playtest`
 * `{turns: string[]}`; `check_world` `{days?: number}` (1–14 simulated days, default 3);
 * `index_book` `{bookId}`; `index_text` `{text}`. Playtest and Check world results share the
 * `turns`/`lint` shape (Check world: one entry per day, with drops, failures and leaks as notes).
 */
export type JobKind = "import_lore" | "refine" | "describe_map" | "playtest" | "check_world" | "index_book" | "index_text";

/**
 * `list`: the user's kept jobs for a world (running ones, and the last few that ended), oldest
 * first, so Build shows a job and its proposals after a reload or a restart. `dismiss` removes a
 * job that has ended, with its result.
 */
export type JobRequest = Request<"lre.job"> & ({ op: "start"; kind: JobKind; worldId: WorldId; input: JsonObject } | { op: "cancel"; jobId: string } | { op: "list"; worldId: WorldId } | { op: "dismiss"; jobId: string });

/** A proposed world edit; the UI applies accepted ones as `lre.editor put`, then `lre.world commit`. */
export interface JobProposal {
  id: string;
  collection: WorldCollection;
  key: string;
  value: JsonValue;
  source: string;
  confidence: number;
  note?: string;
  /** The pack the proposal belongs to (an entity's kind's pack; `space` for places and routes), for grouping the review. */
  pack?: string;
  /** Import: the title of each lore entry the value's `sources` cite, by back-link (`bookId/entryId`), for the review; a book index job: the book entry its lore entry comes from. */
  sourceNames?: Record<string, string>;
  /** A lore indexing proposal: the terms and topics its entry joins in the lookup table when it is applied. */
  index?: LoreIndexAddition;
}

export type JobResult = { proposals: JobProposal[] } | { turns: { user: string; reply: string; notes: string[] }[]; lint: LintIssue[] };

/** Pushed while a job runs and once when it ends. */
export interface JobUpdate extends Envelope<"lre.job.update"> {
  jobId: string;
  kind: JobKind;
  status: "running" | "done" | "failed" | "cancelled";
  /** 0..1 */
  progress: number;
  message?: string;
  result?: JobResult;
}

/**
 * A kept job (`lre.job list`). `interrupted`: it was running when the extension stopped; its result
 * holds the proposals it had made by then, and `input` runs it again as it was started.
 */
export interface JobSummary {
  jobId: string;
  kind: JobKind;
  worldId: WorldId;
  status: JobUpdate["status"] | "interrupted";
  progress: number;
  message?: string;
  result?: JobResult;
  input: JsonObject;
  /** Epoch ms of the job's last change. */
  at: number;
}

/** World document collections the editors write. */
export type WorldCollection =
  | "kinds"
  | "relations"
  | "entities"
  | "places"
  | "routes"
  | "grids"
  | "maps"
  | "rules"
  | "actions"
  | "checks"
  | "schedules"
  | "tracks"
  | "tables"
  | "sections"
  | "steps"
  | "packs"
  | "lore"
  | "classifications";

/**
 * Singleton parts of a world document. `tiers` is `{tiers, spawnTier?}` (DESIGN §9.1); `ruleset` is
 * optional: an empty one removes it; `loreIndex` is the lore lookup table `{terms, topics}`, whole.
 */
export type WorldPart = "calendar" | "realism" | "time" | "meta" | "tiers" | "ruleset" | "loreIndex";

/**
 * Build-draft operations. `get` returns the stored draft (or a fresh copy of the head when there is
 * none) so a reload or a second device resumes it; its `base` is ignored. `discard` drops the draft.
 */
export type EditorRequest = Request<"lre.editor"> & { worldId: WorldId; base: RevisionId | null } & (
    | { op: "get" }
    | { op: "discard" }
    | { op: "put"; collection: WorldCollection; id: string; value: JsonValue }
    | { op: "remove"; collection: WorldCollection; id: string }
    | { op: "set"; part: WorldPart; value: JsonValue }
  );

/**
 * World operations. `sheet` previews the Sheet Designer's layout: the draft world with `ruleset` in
 * place of its own, read on `entity` (the POV by default) as a new chat would start; nothing is saved.
 */
export type WorldRequest = Request<"lre.world"> &
  (
    | { op: "list" }
    | { op: "get"; worldId: WorldId; revision?: RevisionId }
    | { op: "create"; name: string; template: string | null }
    | { op: "delete"; worldId: WorldId }
    | { op: "commit"; worldId: WorldId; base: RevisionId | null }
    | { op: "import"; file: JsonValue }
    | { op: "export"; worldId: WorldId; revision?: RevisionId }
    | { op: "lint"; worldId: WorldId }
    | { op: "attach"; worldId: WorldId; chatId: ChatId }
    | { op: "upgrade"; chatId: ChatId; to: RevisionId; merge?: UpgradePicks }
    | { op: "sheet"; worldId: WorldId; ruleset: JsonValue; entity?: EntityId }
  );

/**
 * Lore curation (DESIGN §4.2). `drift`: the draft's entries indexed from a World Info book whose
 * book entry changed since (its current text and hash) or is gone; `id` asks about one entry.
 * `save`: the chat's latest reply, or `text` (an excerpt of the chat), becomes a lore entry in the
 * draft of the chat's world, its source the message it came from.
 */
export type LoreRequest = Request<"lre.lore"> & ({ op: "drift"; worldId: WorldId; id?: string } | { op: "save"; chatId: ChatId; text?: string });

/** A book-sourced lore entry whose World Info entry changed since it was indexed (with its text now), or is gone. */
export type LoreDrift = { status: "changed"; content: string; hash: string } | { status: "missing" };

export type FrontendToBackend =
  | HelloRequest
  | ResyncRequest
  | ActionRequest
  | ChipRequest
  | ViewOpenRequest
  | FixRequest
  | EditRequest
  | GmRequest
  | MarkerRequest
  | KeepRequest
  | SettingsGetRequest
  | SettingsSetRequest
  | EditorRequest
  | WorldRequest
  | UiRequest
  | JobRequest
  | LoreRequest;

// ---------------------------------------------------------------- responses (backend → frontend)

export interface LintIssue {
  severity: "error" | "warning" | "info";
  /** Document path, e.g. `entities.npc_dev.fields.cash`. */
  path: string;
  code: string;
  message: string;
}

/** Each extraction type's effective mode and where it comes from (DESIGN §11, D4 learning). */
export interface ExtractionModeView {
  mode: BoundMode;
  source: "pinned" | "learned" | "default" | "bound";
  /** The connection whose learning applies (the extract step's), when known. */
  connection: { id: string; name: string } | null;
  accepted: number;
  rejected: number;
}

/** Settings plus derived views: effective extraction modes and the D32 preset caveats. */
export interface SettingsResult {
  settings: UserSettings;
  extraction: Record<ExtractionType, ExtractionModeView>;
  caveats: { code: string; message: string }[];
}

/** Results per request type. */
export interface ResultBodies {
  "lre.hello": { accepted: true };
  "lre.state.resync": { accepted: true };
  "lre.action": { messageId: MessageId };
  "lre.chip": { applied: boolean; pending: boolean };
  "lre.view.open": { materialized: boolean; pending: boolean };
  "lre.fix": { pending: boolean };
  "lre.edit": { pending: boolean };
  "lre.gm": GmView;
  "lre.marker": { pending: boolean; preview?: MarkerPreview };
  "lre.keep": { pending: boolean };
  "lre.settings.get": SettingsResult;
  "lre.settings.set": SettingsResult;
  /** `base`: the revision the draft started from (send it with the next edit); `stored`: whether a draft exists apart from the head. */
  "lre.editor": { draft: WorldDoc; lint: LintIssue[]; base: RevisionId | null; stored: boolean };
  /**
   * `get` also carries `packKinds` and `packRelations`: every kind (label, extends, fields) and
   * relation type the registered packs define, for Build's kind and relation pickers and typed
   * field forms (a world kind or relation type with the same id wins); and `functions`: every
   * function a formula may call outside an effect's arguments (the math built-ins, the engine's and
   * the packs' formulas), for the expression editor. `sheet` answers the `sheet` preview: the
   * sections, or null when the ruleset designs no sheet.
   */
  "lre.world": { worlds?: WorldIndex[]; world?: WorldDoc; revision?: RevisionId; lint?: LintIssue[]; file?: JsonValue; packKinds?: Record<string, KindDef>; packRelations?: Record<string, RelationTypeDef>; functions?: string[]; sheet?: SheetSectionView[] | null };
  "lre.ui": { done: true };
  /** `start`, `cancel` and `dismiss` name the job; `list` returns the world's kept jobs. */
  "lre.job": { jobId?: string; jobs?: JobSummary[] };
  /** `drift`: book-sourced entries whose book entry changed or is gone, by lore id (unchanged ones are left out); `save`: the world and the new entry's id. */
  "lre.lore": { drift?: Record<string, LoreDrift>; worldId?: WorldId; id?: string };
}

export type ResultMessage = {
  [K in keyof ResultBodies]: Envelope<"lre.result"> & { reqId: string; request: K; body: ResultBodies[K] };
}[keyof ResultBodies];

export type ErrorCode =
  | "bad_request"
  | "not_found"
  | "not_world_chat"
  /** The `base` revision is stale; reload and retry. */
  | "conflict"
  /** The chat is paused on a user-message edit; resolve Keep or Discard first (DESIGN §4.3). */
  | "paused"
  | "validation"
  | "forbidden"
  | "unavailable"
  | "internal";

export interface ErrorMessage extends Envelope<"lre.error"> {
  /** Absent for errors not tied to a request. */
  reqId: string | null;
  code: ErrorCode;
  message: string;
  lint?: LintIssue[];
}

export type BackendToFrontend = StateSnapshot | StateDelta | ResultMessage | ErrorMessage | JobUpdate;
