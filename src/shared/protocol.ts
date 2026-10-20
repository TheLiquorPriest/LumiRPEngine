// Frontend ↔ backend protocol over Spindle messaging (`ctx.sendToBackend` /
// `spindle.sendToFrontend`, routed by userId and frontendSessionId). ARCHITECTURE §5.
//
// Every message is an envelope `{ lre: PROTOCOL_VERSION, type, ... }`. Requests carry a
// `reqId` chosen by the frontend; the backend answers each with exactly one `lre.result` or
// `lre.error` carrying the same `reqId`. State arrives unsolicited as snapshots and deltas.

import type { JsonObject, JsonValue } from "./json";
import type { LoreIndexAddition } from "./lore";
import type { MindEditOp } from "./minds";
import type { ActionId, BoundMode, ChatId, ChipId, DomainId, EntityId, FieldId, KindId, Level, MessageId, PanelId, PlaceId, RelationTypeId, RevisionId, StageId, TierId, TrackId, WorldId } from "./ids";
import type { EntityUpgradePick, EventRef, PathHash, ResolveScope, TimeControl, TimeScope, UpgradeAspect, UpgradePicks } from "./ledger";
import type { ExtractionType, UserSettings } from "./settings";
import type { GmView, SheetSectionView, StateView } from "./state-view";
import type { AdjudicationDef, FacetId, FacetValueId, KindDef, LifeStateId, MapDisplay, RelationTypeDef, RevisionNote, WorldDoc, WorldIndex } from "./world";

export const PROTOCOL_VERSION = 1;

/**
 * The level of the requests outside clients rely on (DESIGN §23): editor `version`, `patch` and
 * `restore`, commit notes and history, `templates`, `chats` and `lre.draft.changed`. `lre.hello`
 * answers with it; a build without them answers without it.
 */
export const AGENT_API = 1;

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
  /** The active Loom preset as the frontend's state has it (`loom.activePresetId`); absent when it can't say. */
  presetId?: string | null;
  /** An outside client (the `lumirpengine` CLI or MCP server, DESIGN §23) names itself: its commits are labelled `agent`, and the log says who connected. */
  client?: { name: string; version: string };
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
 *  - `classify` sets an entity's classes (facet → values, the world's facets and values only) and
 *    tags, both whole; the chat holds them from then on over the world's definition.
 *  - `spawn` adds an entity; `despawn` takes one out of the world (`gone`, its relations unlinked)
 *    and `restore` brings it back.
 *  - `mind_pin`, `mind_refresh`, `mind_memory`: a character's mind (DESIGN §24.9): pin their fidelity,
 *    ask for a fresh mind next turn, edit or delete a note, commitment or plan (`MindEditOp`).
 *  - `effect` runs a pack effect registered for GM edits (`EffectDef.gm`) with literal arguments:
 *    what no entity field holds, such as an asset's price.
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
  | { op: "classify"; entity: EntityId; class: Record<FacetId, FacetValueId[]>; tags: string[] }
  /** A life state (DESIGN §8), and who is told it besides everyone with the entity; at least one of them. */
  | { op: "life"; entity: EntityId; to?: LifeStateId; tell?: EntityId[] }
  | { op: "spawn"; kind: KindId; name: string; id?: EntityId; tier?: TierId; place?: PlaceId; agent?: boolean }
  | { op: "despawn"; entity: EntityId }
  | { op: "restore"; entity: EntityId }
  | MindEditOp
  | { op: "effect"; effect: string; args: JsonObject };

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
  /** It names someone or somewhere the POV can't see: shown as "A hidden change" until the owner opens the spoiler gate. */
  secret?: true;
}

export interface UpgradeEntityRow {
  entity: EntityId;
  name: string;
  /** The kind's label. */
  kind: string;
  status: "new" | "removed" | "changed";
  changes: UpgradeChange[];
  /** Someone or something the POV can't see: the whole row waits behind the spoiler gate. */
  secret?: true;
}

/** What an Upgrade brings into the chat, entity by entity (DESIGN §4.3 `migrate`). */
export interface UpgradePreview {
  /** The revision the chat's definitions come from (its own, unless an earlier Upgrade left them behind) and the one it moves to. */
  from: RevisionId;
  to: RevisionId;
  entities: UpgradeEntityRow[];
  /** Tracks that go back to their start, in words; a track the POV can't see is `secret`. */
  tracks: { text: string; secret?: true }[];
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

/** The D32 preset caveats (Settings → Caveats), apart from settings: they need a dry run of the chat, which takes long on a long chat. */
export interface SettingsCaveatsRequest extends Request<"lre.settings.caveats"> {}

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
 * Play's map (DESIGN §12). `display` (the default op): how the map shows this chat, what the POV
 * knows or fog of war; presentation, kept beside the chat rather than in its ledger, so it never
 * changes the world. `walk`: what Walk here to a cell of the grid the POV stands on takes, judged
 * as the step action is, on the real ground: the page's grid is cut to the display, so it can't
 * path-find under fog.
 */
export type MapRequest = Request<"lre.map"> & { chatId: ChatId } & ({ op?: "display"; display: MapDisplay } | { op: "walk"; x: number; y: number });

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
 * optional: an empty one removes it; `loreIndex` is the lore lookup table `{terms, topics}`, whole;
 * `minds` is `world.minds` (DESIGN §24.2), whole: the defaults remove it.
 */
export type WorldPart = "calendar" | "realism" | "time" | "meta" | "tiers" | "ruleset" | "loreIndex" | "minds";

/** One RFC 6902 operation, its paths RFC 6901 JSON Pointers into the whole world document. */
export type JsonPatchOp =
  | { op: "add"; path: string; value: JsonValue }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: JsonValue }
  | { op: "move"; from: string; path: string }
  | { op: "copy"; from: string; path: string }
  | { op: "test"; path: string; value: JsonValue };

/**
 * Build-draft operations. `get` returns the stored draft (or a fresh copy of the head when there is
 * none) so a reload or a second device resumes it; its `base` is ignored. `discard` drops the draft.
 * `profile` applies a ruleset profile to the draft in one write (`shared/profiles`), each
 * conflicting item kept or taken by its path in `choices` (kept when unnamed). `patch` applies
 * RFC 6902 operations to the whole draft, all of them or none. `restore` makes the draft a copy of
 * one of the world's revisions, which a commit then makes head again (DESIGN §23).
 *
 * `version` names a state of the world's working copy, and is never reused within a world: each
 * write counts one, and so does a discard or commit (which drops the draft) and a Studio install
 * that moves the head while no draft is stored. With no draft stored it is the world's count
 * (`WorldIndex.draftVersion`; 0 for a world never edited), and a new draft starts one above it.
 * A request that sends `version` is refused with `conflict` when the working copy has moved on
 * from it; one without it is not checked. Every result carries the current one.
 */
export type EditorRequest = Request<"lre.editor"> & { worldId: WorldId; base: RevisionId | null; version?: number } & (
    | { op: "get" }
    | { op: "discard" }
    | { op: "put"; collection: WorldCollection; id: string; value: JsonValue }
    | { op: "remove"; collection: WorldCollection; id: string }
    | { op: "set"; part: WorldPart; value: JsonValue }
    | { op: "profile"; profile: string; choices: Record<string, "mine" | "profile"> }
    | { op: "patch"; ops: JsonPatchOp[] }
    | { op: "restore"; revision: RevisionId }
  );

/**
 * World operations. `sheet` previews the Sheet Designer's layout: the draft world with `ruleset` in
 * place of its own, read on `entity` (the POV by default) as a new chat would start; nothing is saved.
 * `commit`'s `note` goes into the world's history, and its `version`, when sent, is checked as an
 * editor write's is (DESIGN §23). `templates` lists the starter worlds `create` takes; `chats` lists
 * the user's chats that play a world (one world's with `worldId`, one chat with `chatId`).
 */
export type WorldRequest = Request<"lre.world"> &
  (
    | { op: "list" }
    | { op: "get"; worldId: WorldId; revision?: RevisionId }
    | { op: "create"; name: string; template: string | null }
    | { op: "delete"; worldId: WorldId }
    | { op: "commit"; worldId: WorldId; base: RevisionId | null; note?: string; version?: number }
    | { op: "import"; file: JsonValue }
    | { op: "export"; worldId: WorldId; revision?: RevisionId }
    | { op: "lint"; worldId: WorldId }
    | { op: "attach"; worldId: WorldId; chatId: ChatId }
    | { op: "upgrade"; chatId: ChatId; to: RevisionId; merge?: UpgradePicks }
    | { op: "sheet"; worldId: WorldId; ruleset: JsonValue; entity?: EntityId }
    | { op: "templates" }
    | { op: "chats"; worldId?: WorldId; chatId?: ChatId }
  );

/** A starter world `lre.world create` can start from. */
export interface TemplateInfo {
  id: string;
  name: string;
  /** One or two sentences on what it holds. */
  summary: string;
}

/**
 * A chat that plays a world: the revision it plays now (after any Upgrade), and whether that is
 * behind the world's head. `revision` is null, with `reason`, when the chat's ledger can't be read;
 * `behind` is then false.
 */
export interface WorldChatInfo {
  chatId: ChatId;
  name: string;
  worldId: WorldId;
  revision: RevisionId | null;
  behind: boolean;
  reason?: string;
}

/**
 * Lore curation (DESIGN §4.2). `drift`: the draft's entries indexed from a World Info book whose
 * book entry changed since (its current text and hash) or is gone; `id` asks about one entry.
 * `save`: the chat's latest reply, or `text` (an excerpt of the chat), becomes a lore entry in the
 * draft of the chat's world, its source the message it came from.
 */
export type LoreRequest = Request<"lre.lore"> & ({ op: "drift"; worldId: WorldId; id?: string } | { op: "save"; chatId: ChatId; text?: string });

/** A book-sourced lore entry whose World Info entry changed since it was indexed (with its text now), or is gone. */
export type LoreDrift = { status: "changed"; content: string; hash: string } | { status: "missing" };

/**
 * LumiRPEngine Studio's offer (DESIGN §15). `offer` reads the world the Studio offers and reviews
 * it, installing nothing; `install` installs the offer reviewed as `offerId`: a new world, or the
 * next revision of one of the user's worlds.
 */
export type StudioRequest = Request<"lre.studio"> &
  (
    | { op: "offer" }
    /** `acceptMovedHead`: install a revision though its world's head moved since the Studio took it (`StudioOfferView.headMoved`). */
    | { op: "install"; offerId: string; hash: string; acceptMovedHead?: boolean }
  );

/** A Studio offer as Build reviews it before anything is installed. */
export interface StudioOfferView {
  offerId: string;
  mode: "new" | "revision";
  name: string;
  createdAt: number;
  /** A revision's world: its id, and its name (null when the user has no such world). */
  target: { worldId: WorldId; name: string | null } | null;
  /** Items per collection, the collections that have any. */
  counts: Record<string, number>;
  /** The engine's lint of the document, errors first (at most 50). */
  lint: LintIssue[];
  errors: number;
  /** Macros in its lore and templates, to review before playing it. */
  macros: LintIssue[];
  /** The chat the Studio wants it attached to, once installed. */
  attachChatId: ChatId | null;
  /** Why it can't be installed as it is (not a world, errors, a missing world, Build's unsaved draft); null when it can. */
  blocked: string | null;
  /** The world revision it became, once installed. */
  installed: { worldId: WorldId; revision: RevisionId } | null;
  /**
   * A revision whose world's head isn't the one the Studio took it from: that base (null when the
   * Studio gave none) and the head now. Installing makes the offer the new head without what was
   * committed since, so Build warns and Install must confirm it (`acceptMovedHead`).
   */
  headMoved: { base: RevisionId | null; head: RevisionId } | null;
  /** The offer as reviewed (`hashJson` of it): Install names it back, and is refused when the offer has changed since. */
  hash: string;
}

/**
 * Settings → Preset (DESIGN §6.8): `get` reads the active preset's card; `add` adds the RPEngine
 * blocks it lacks, then reads it; `active` tells the backend the active Loom preset changed.
 */
export type PresetRequest = Request<"lre.preset"> & ({ op: "get" | "add" } | { op: "active"; presetId: string | null });

/** What the active preset says to LumiRPEngine: the section outlets its enabled blocks hold (with the section each places, null when none has that name) and each guidance block's state. */
export interface PresetCard {
  preset: { id: string; name: string } | null;
  outlets: { outlet: string; label: string | null }[];
  blocks: { target: string; name: string; state: "missing" | "empty" | "read" | "enabled" }[];
}

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
  | SettingsCaveatsRequest
  | EditorRequest
  | WorldRequest
  | UiRequest
  | MapRequest
  | JobRequest
  | LoreRequest
  | StudioRequest
  | PresetRequest;

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

/** Settings plus a derived view: effective extraction modes. */
export interface SettingsResult {
  settings: UserSettings;
  extraction: Record<ExtractionType, ExtractionModeView>;
}

/** Results per request type. */
export interface ResultBodies {
  /** `agentApi`: the outside-client level this build speaks (`AGENT_API`). */
  "lre.hello": { accepted: true; agentApi: number };
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
  "lre.settings.caveats": { caveats: { code: string; message: string }[] };
  /** `base`: the revision the draft started from (send it with the next edit); `stored`: whether a draft exists apart from the head; `version`: the working copy's version (see `EditorRequest`). */
  "lre.editor": { draft: WorldDoc; lint: LintIssue[]; base: RevisionId | null; stored: boolean; version: number };
  /**
   * `get` also carries `packKinds` and `packRelations`: every kind (label, extends, fields) and
   * relation type the registered packs define, for Build's kind and relation pickers and typed
   * field forms (a world kind or relation type with the same id wins); and `functions`: every
   * function a formula may call outside an effect's arguments (the math built-ins, the engine's and
   * the packs' formulas), for the expression editor. `sheet` answers the `sheet` preview: the
   * sections, or null when the ruleset designs no sheet. `templates` and `chats` answer their ops.
   * `get` carries the world's `history` (oldest first; `list` leaves it out). `upgrade` says
   * `pending` when the chat is mid-turn: its Upgrade lands when the turn ends.
   */
  "lre.world": { worlds?: WorldIndex[]; world?: WorldDoc; revision?: RevisionId; lint?: LintIssue[]; file?: JsonValue; packKinds?: Record<string, KindDef>; packRelations?: Record<string, RelationTypeDef>; functions?: string[]; sheet?: SheetSectionView[] | null; templates?: TemplateInfo[]; chats?: WorldChatInfo[]; history?: RevisionNote[]; pending?: boolean };
  "lre.ui": { done: true };
  "lre.map": { display?: MapDisplay; walk?: { minutes: number; disabled?: string } };
  /** `start`, `cancel` and `dismiss` name the job; `list` returns the world's kept jobs. */
  "lre.job": { jobId?: string; jobs?: JobSummary[] };
  /** `drift`: book-sourced entries whose book entry changed or is gone, by lore id (unchanged ones are left out); `save`: the world and the new entry's id. */
  "lre.lore": { drift?: Record<string, LoreDrift>; worldId?: WorldId; id?: string };
  /**
   * `offer`: the offer under review, or null and why there is none (`message`). `install`: what it
   * became, with the macros to review before playing it (`lint`).
   */
  "lre.studio": { offer?: StudioOfferView | null; message?: string; installed?: { offerId: string; mode: "new" | "revision"; worldId: WorldId; name: string; revision: RevisionId; attachChatId: ChatId | null }; lint?: LintIssue[] };
  "lre.preset": { card: PresetCard };
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

/**
 * A world's working copy changed: its draft written, discarded or committed, or its head moved by
 * a Studio install (DESIGN §23). Sent to every session of the user after the reply to the request
 * that changed it, so a Build open on that world reloads what another window or an outside agent did.
 */
export interface DraftChanged extends Envelope<"lre.draft.changed"> {
  worldId: WorldId;
  /** The working copy's version now (see `EditorRequest`). */
  version: number;
  stored: boolean;
  /** The revision the draft started from, or the head when none is stored. */
  base: RevisionId | null;
}

export type BackendToFrontend = StateSnapshot | StateDelta | ResultMessage | ErrorMessage | JobUpdate | DraftChanged;
