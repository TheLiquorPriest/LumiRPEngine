// Frontend ↔ backend protocol over Spindle messaging (`ctx.sendToBackend` /
// `spindle.sendToFrontend`, routed by userId and frontendSessionId). ARCHITECTURE §5.
//
// Every message is an envelope `{ lre: PROTOCOL_VERSION, type, ... }`. Requests carry a
// `reqId` chosen by the frontend; the backend answers each with exactly one `lre.result` or
// `lre.error` carrying the same `reqId`. State arrives unsolicited as snapshots and deltas.

import type { JsonObject, JsonValue } from "./json";
import type { ActionId, BoundMode, ChatId, ChipId, DomainId, EntityId, FieldId, Level, MessageId, PanelId, RevisionId, WorldId } from "./ids";
import type { EventRef, PathHash, ResolveScope, TimeControl, TimeScope } from "./ledger";
import type { ExtractionType, UserSettings } from "./settings";
import type { SheetSectionView, StateView } from "./state-view";
import type { KindDef, WorldDoc, WorldIndex } from "./world";

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

/** A ✎ fix on the head (a `post` entry of kind `fix`). */
export interface FixRequest extends Request<"lre.fix"> {
  chatId: ChatId;
  entity: EntityId;
  field: FieldId;
  value: JsonValue;
}

/** A Play change to the running chat: a realism, time or Upgrade marker. With `preview`, nothing is written. */
export type MarkerRequest = Request<"lre.marker"> & { chatId: ChatId; preview?: true } & (
    | { kind: "resolve"; domain: DomainId; scope: ResolveScope; to: Level }
    | { kind: "time"; control: TimeControl; scope: TimeScope; to: JsonValue }
    | { kind: "migrate"; to: RevisionId }
  );

/** What a marker would do (DESIGN §9.2: the demotion preview lists predicates whose inputs will freeze). */
export interface MarkerPreview {
  lines: { text: string; tone: "freeze" | "promote" | "materialize" | "info" }[];
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
 * Background-lane jobs (DESIGN §13, §15): Import from lore, Build/Refine with AI, Playtest, Check world.
 * Input: `import_lore` `{bookIds}`; `refine` `{instructions}`; `playtest` `{turns: string[]}`;
 * `check_world` `{days?: number}` (1–14 simulated days, default 3). Playtest and Check world results
 * share the `turns`/`lint` shape (Check world: one entry per day, with drops, failures and leaks as notes).
 */
export type JobKind = "import_lore" | "refine" | "playtest" | "check_world";

export type JobRequest = Request<"lre.job"> & ({ op: "start"; kind: JobKind; worldId: WorldId; input: JsonObject } | { op: "cancel"; jobId: string });

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
  /** Import: the title of each lore entry the value's `sources` cite, by back-link (`bookId/entryId`), for the review. */
  sourceNames?: Record<string, string>;
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

/** World document collections the editors write. */
export type WorldCollection =
  | "kinds"
  | "relations"
  | "entities"
  | "places"
  | "routes"
  | "grids"
  | "rules"
  | "actions"
  | "checks"
  | "schedules"
  | "tracks"
  | "tables"
  | "sections"
  | "steps"
  | "packs"
  | "lore";

/** Singleton parts of a world document. `tiers` is `{tiers, spawnTier?}` (DESIGN §9.1); `ruleset` is optional: an empty one removes it. */
export type WorldPart = "calendar" | "realism" | "time" | "meta" | "tiers" | "ruleset";

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
    | { op: "upgrade"; chatId: ChatId; to: RevisionId }
    | { op: "sheet"; worldId: WorldId; ruleset: JsonValue; entity?: EntityId }
  );

export type FrontendToBackend =
  | HelloRequest
  | ResyncRequest
  | ActionRequest
  | ChipRequest
  | ViewOpenRequest
  | FixRequest
  | MarkerRequest
  | KeepRequest
  | SettingsGetRequest
  | SettingsSetRequest
  | EditorRequest
  | WorldRequest
  | UiRequest
  | JobRequest;

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
  "lre.marker": { pending: boolean; preview?: MarkerPreview };
  "lre.keep": { pending: boolean };
  "lre.settings.get": SettingsResult;
  "lre.settings.set": SettingsResult;
  /** `base`: the revision the draft started from (send it with the next edit); `stored`: whether a draft exists apart from the head. */
  "lre.editor": { draft: WorldDoc; lint: LintIssue[]; base: RevisionId | null; stored: boolean };
  /**
   * `get` also carries `packKinds`: every kind the registered packs define (label, extends,
   * fields), for Build's kind pickers and typed field forms (a world kind with the same id wins);
   * and `functions`: every function a formula may call outside an effect's arguments (the math
   * built-ins, the engine's and the packs' formulas), for the expression editor. `sheet` answers
   * the `sheet` preview: the sections, or null when the ruleset designs no sheet.
   */
  "lre.world": { worlds?: WorldIndex[]; world?: WorldDoc; revision?: RevisionId; lint?: LintIssue[]; file?: JsonValue; packKinds?: Record<string, KindDef>; functions?: string[]; sheet?: SheetSectionView[] | null };
  "lre.ui": { done: true };
  "lre.job": { jobId: string };
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
