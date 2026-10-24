// Per-chat ledger contracts (DESIGN §4.3, §5.1; ARCHITECTURE §4).
//
// Stored in three places:
//   - chat metadata `lumi_rp_engine`: ChatRun;
//   - assistant message metadata `spindle_metadata.lumi_rp_engine`: MessageLedger;
//   - the shadow journal in userStorage `runs/<chatId>/journal.json`: Journal.
// The journal is authoritative; message metadata is its re-asserted mirror (DESIGN §4.3).

import type { JsonObject, JsonValue } from "./json";
import type { ClaimsPolicy } from "./claims";
import type { InferredChecks } from "./inferred";
import type { AdjudicationDef } from "./world";
import type {
  ActionId,
  ActivityType,
  Band,
  ChatId,
  DomainId,
  EntityId,
  FieldId,
  GenerationId,
  InterruptClass,
  Level,
  MessageId,
  RelationTypeId,
  RevisionId,
  SceneTypeId,
  StageId,
  TrackId,
  WorldId,
} from "./ids";
import type { EntityDef } from "./world";

export const LEDGER_NAMESPACE = "lumi_rp_engine";

/** A path hash: 32 hex digits from `hashParts` (DESIGN §4.3, path hash). */
export type PathHash = string;
/** The empty chain: the parent path of the first message. */
export const ROOT_PATH: PathHash = "00000000000000000000000000000000";

/** Identity of a piece of text: its length and hash. */
export interface ContentId {
  len: number;
  hash: string;
}

// ---------------------------------------------------------------- events

/**
 * Every event may name a group: contiguous events of one record list that share it are one unit
 * (a purchase's posting, history line and item). Plans and reads keep or skip a unit
 * whole, and a rebased view drops it whole when any member fails against the new parent.
 */
export interface EventBase {
  group?: string;
}

/** Assignment: carries the final value (location, status, owner, flags, equipped). */
export interface SetEvent extends EventBase {
  type: "set";
  entity: EntityId;
  field: FieldId;
  value: JsonValue;
}

/** Accumulator: carries a concrete delta (fuel, odometer, quantities, regard, needs). */
export interface AddEvent extends EventBase {
  type: "add";
  entity: EntityId;
  field: FieldId;
  delta: number;
}

export interface PostingLine {
  /** Account entity id; the external economy is `economy.external:<counterpartyId>`. */
  account: EntityId;
  /** Integer cents; the lines of one posting sum to zero. */
  amount: number;
}

/** A balanced double-entry posting (DESIGN §9.2 Money). */
export interface PostEvent extends EventBase {
  type: "post";
  lines: PostingLine[];
  memo: string;
}

export interface LinkEvent extends EventBase {
  type: "link";
  rel: RelationTypeId;
  from: EntityId;
  to: EntityId;
  fields?: JsonObject;
  until?: number;
}

export interface UnlinkEvent extends EventBase {
  type: "unlink";
  rel: RelationTypeId;
  from: EntityId;
  to: EntityId;
}

export interface SpawnEvent extends EventBase {
  type: "spawn";
  entity: EntityDef;
}

export interface StageEvent extends EventBase {
  type: "stage";
  track: TrackId;
  to: StageId;
}

/** The clock advance applied by a turn: its elapsed time, a timelapse or an applied `time.advance`. */
export interface ClockEvent extends EventBase {
  type: "clock";
  minutes: number;
  cause: "tick" | "action" | "timelapse" | "advance";
}

/** Lazy materialization: detail sampled within the entity's current representation (DESIGN §9.2). */
export interface MaterializeEvent extends EventBase {
  type: "materialize";
  entity: EntityId;
  domain: DomainId;
  generatorVersion: number;
  tablesRevision: string;
  /** The concrete events the materializer produced. */
  events: LedgerEvent[];
}

/** What a timelapse runs until (DESIGN §9.2): a duration, a day part, the next shift, commitment or arrival, a time, a track stage, or the next interrupt. `at` is minutes since the world epoch. */
export type TimelapseTarget =
  | { type: "duration"; minutes: number }
  | { type: "day_part"; dayPart: string }
  | { type: "shift" }
  | { type: "commitment" }
  | { type: "arrival" }
  | { type: "at"; at: number }
  | { type: "stage"; track: TrackId; stage: StageId }
  | { type: "interrupt" };

/** What ended a timelapse before its target (DESIGN §9.2): an interrupt class, or a character's mind at a time skip's beat (§24.7). */
export type TimelapseStop = InterruptClass | "mind";

/** Summary of a timelapse segment (DESIGN §9.2). */
export interface TimelapseEvent extends EventBase {
  type: "timelapse";
  from: number;
  to: number;
  target: TimelapseTarget;
  stoppedBy: TimelapseStop | null;
  /** Whose mind stopped it, with `stoppedBy: "mind"`. */
  mind?: EntityId;
  segment: number;
}

/** A pack event: `<packId>.<name>` with a pack-validated body. Aggregates and period closes are pack events. */
export interface PackEvent extends EventBase {
  type: `${string}.${string}`;
  data: JsonObject;
}

export type CoreEvent =
  | SetEvent
  | AddEvent
  | PostEvent
  | LinkEvent
  | UnlinkEvent
  | SpawnEvent
  | StageEvent
  | ClockEvent
  | MaterializeEvent
  | TimelapseEvent;

export type LedgerEvent = CoreEvent | PackEvent;

/** Addresses one event: in `Rec.events`, or in the `post` entry with this `seq`. */
export type EventRef = { in: "events"; index: number } | { in: "post"; seq: number; index: number };

// ---------------------------------------------------------------- records, post entries, markers

export type PostKind = "materialize" | "fix" | "confirm" | "cont" | "narr";

/** An addition to a swipe after its turn (DESIGN §4.3, `post`). */
export interface PostEntry {
  /** Chat-wide sequence number, shared with markers. */
  seq: number;
  /** P1: the parent path the entry was made under. */
  at: PathHash;
  kind: PostKind;
  events: LedgerEvent[];
  /** A `fix` the player's own mechanical action made (DESIGN §11), not a correction: the action and how it reads ("Buy or sell investments: 10, …"). */
  by?: { action: string; label: string };
  /** A `fix` the GM made (`lre.edit`, a GM's minds run), not a ✎ correction of the player's: its chip says it was a GM edit (DESIGN §7). */
  gm?: true;
}

/** A level change for everyone, for one detail band (stored under `tier`, the key the band ids had as tiers) or for one entity. */
export type ResolveScope = { all: true } | { tier: Band } | { entity: EntityId };

export type TimeControl = "tick" | "scale" | "pause" | "interrupt" | "speed_through" | "montage" | "unit_cap";

/** A control an earlier build wrote into every chat's starting markers (NPC model calls per timelapse, which nothing read): a stored marker keeps it and it sets nothing. */
export type RetiredTimeControl = "npc_calls";

export type TimeScope =
  | { all: true }
  | { sceneType: SceneTypeId }
  | { activity: ActivityType }
  | { interrupt: InterruptClass };

/** One pick of an Upgrade's definition merge: bring the revision's value in, or keep the chat's. */
export type UpgradePick = "take" | "keep";

/** An entity-wide pick: a new entity is created (`take`) or left out (`keep`); one gone from the revision stays (`keep`) or is removed (`remove`). */
export type EntityUpgradePick = UpgradePick | "remove";

/** The definition parts an Upgrade merges besides fields and relations. */
export const UPGRADE_ASPECTS = ["kind", "name", "tier", "agent", "levels", "class", "life"] as const;
export type UpgradeAspect = (typeof UPGRADE_ASPECTS)[number];

/**
 * The owner's picks for one entity in an Upgrade (DESIGN §4.3 `migrate`): intent only, the values
 * come from the two revisions. Anything unpicked takes the default: `take` when no applied event
 * touched it, `keep` when one did.
 */
export interface EntityPicks extends Partial<Record<UpgradeAspect, UpgradePick>> {
  entity?: EntityUpgradePick;
  fields?: Record<FieldId, UpgradePick>;
  /** Per relation type, per target (an entity or a place). */
  relations?: Record<RelationTypeId, Record<string, UpgradePick>>;
}

/** An Upgrade's picks by entity. */
export type UpgradePicks = Record<EntityId, EntityPicks>;

export type MarkerBody =
  /** With `merge`, the revision's definition changes come into the chat as the picks say; without, only the revision switches. */
  | { kind: "migrate"; to: RevisionId; merge?: UpgradePicks }
  | { kind: "resolve"; domain: DomainId; scope: ResolveScope; to: Level }
  | { kind: "time"; control: TimeControl | RetiredTimeControl; scope: TimeScope; to: JsonValue }
  | { kind: "adjudicate"; to: AdjudicationDef }
  /** What a typed action's thing the world doesn't have becomes in this chat from now on (DESIGN §9.4 player claims). */
  | { kind: "claims"; to: ClaimsPolicy }
  /** How typed attempts are read as checks in this chat from now on (DESIGN §11 inferred checks). */
  | { kind: "infer"; to: InferredChecks };

/** A message-level intent marker: a pure intent with no values (DESIGN §4.3). */
export type Marker = MarkerBody & {
  seq: number;
  /** P1 path tag; `null` only on starting markers, which are live on every path. */
  at: PathHash | null;
  start?: true;
};

export type RecStatus = "ok" | "degraded" | "stopped";

/** Interpretation cache entry, keyed by `hash(user text, interpret config)` (DESIGN §5.1; `interpret` runs on the helper, D10). */
export interface IntentCacheEntry {
  action: ActionId | null;
  params: JsonObject;
  probabilities: Record<string, number>;
}

export interface KeepOverlay {
  convert: EventRef[];
}

/** A post entry a swipe didn't carry over (P3: a Re-narrate's copy or a Re-run's fix that failed re-validation, or a Re-run's fix it couldn't re-validate under a pause) or a Re-read didn't keep. */
export interface CarryDrop {
  seq: number;
  kind: PostKind;
  reason: string;
}

/** One swipe's turn record (DESIGN §4.3, `Rec`). */
export interface Rec {
  v: 1;
  /** World revision the turn was planned under. */
  defHash: RevisionId;
  /** Chat-wide sequence number taken when the record was made, so every record is distinct (tombstones match it). */
  seq: number;
  swipeHash: ContentId;
  /** The parent path the turn was planned at; "" on a bare record (no turn: it holds only an accepted identity or player entries). */
  path: PathHash;
  /**
   * Read on another chain: the one the turn was planned on was gone when it committed (DESIGN
   * §4.3). It keeps `path`, so what was made there travels with it, but folds as a rebased view
   * everywhere, on that path too.
   */
  readElsewhere?: true;
  seed: string;
  /** How many leading `events` were planned before the reply. */
  pre: number;
  events: LedgerEvent[];
  post: PostEntry[];
  markersApplied: number;
  keep?: Record<PathHash, KeepOverlay>;
  status: RecStatus;
  undone: EventRef[];
  intents: Record<string, IntentCacheEntry>;
  /** Entries dropped when carried onto this swipe or past a Re-read; the folds report them as `not_carried` notes. Outside every hash. */
  dropped?: CarryDrop[];
  /** Content accepted without being read: an assistant edit or an unread Continue (DESIGN §4.3). Outside every hash. */
  accepted?: ContentId;
  diag?: string;
}

/** `spindle_metadata.lumi_rp_engine` on an assistant message. Swipe keys are decimal indexes. */
export interface MessageLedger {
  v: 1;
  swipes: Record<string, Rec>;
  markers: Marker[];
}

/** Chat metadata `lumi_rp_engine`. */
export interface ChatRun {
  v: 1;
  worldId: WorldId;
  /** The world revision the chat was attached to; its starting `migrate` marker repeats it. */
  revision: RevisionId;
  runSeed: string;
  startedAt: number;
}

// ---------------------------------------------------------------- shadow journal

/** One message in the chain snapshot: what classification diffs against (DESIGN §4.3). */
export interface ChainEntry {
  id: MessageId;
  isUser: boolean;
  swipeId: number;
  swipeCount: number;
  content: ContentId;
  /** The message's parent path when the snapshot was taken (live-marker moves on deletion use it). */
  parentPath: PathHash;
}

/** A content edit pauses later records until Keep or Discard (DESIGN §4.3). */
export interface Pause {
  /** The edited message. */
  messageId: MessageId;
  /** Its content after the edit. */
  content: ContentId;
}

/** A discarded record, matched by message id, `swipeHash` and stored-record hash. */
export interface Tombstone {
  messageId: MessageId;
  swipeHash: ContentId;
  recHash: string;
}

/** A user write the journal holds while a window is open (P2). */
export type HeldWrite =
  | { kind: "post"; id: string; target: "head"; entry: Omit<PostEntry, "seq" | "at"> }
  | { kind: "marker"; id: string; target: "head"; body: MarkerBody }
  | { kind: "keep"; id: string; messageId: MessageId; parentPath: PathHash; convert: EventRef[] }
  | { kind: "discard"; id: string; after: MessageId }
  /** Re-read edit: re-extracts the record's post-step events from its accepted text when journaled (DESIGN §4.3). */
  | { kind: "reread"; id: string; messageId: MessageId; swipeId: number }
  /** Retry read: extracts a stopped head Continue's partial suffix into a `cont` entry (DESIGN §5.1 step 6). */
  | { kind: "retry_read"; id: string; messageId: MessageId; swipeId: number }
  /** An undo chip: the referenced events of the head record stop folding (`Rec.undone`; DESIGN §11, D4). */
  | { kind: "undo"; id: string; messageId: MessageId; swipeId: number; refs: EventRef[] };

export interface HeldEntry {
  write: HeldWrite;
  /** Windows open when the write was made; it is journaled once all have closed. */
  waitFor: GenerationId[];
}

/** A held write that no longer applied when its window closed (P2): kept so the player is told, until they dismiss the notice. */
export interface RefusedWrite {
  write: HeldWrite;
  /** The validator's reason, which may name hidden things: the GM view shows it; the player's notice words the write itself. */
  reason: string;
  /** The head assistant message when it was refused (its notice shows there), or null. */
  messageId: MessageId | null;
}

export type GenerationKind = "normal" | "regenerate" | "swipe" | "continue" | "impersonate" | "renarrate";

/** The shadow `pending` entry of one in-flight turn (DESIGN §5.1 steps 1 and 2). */
export interface PendingTurn {
  generationId: GenerationId;
  kind: GenerationKind;
  /** Target message; `null` until known (Continue: until `GENERATION_ENDED`). */
  messageId: MessageId | null;
  swipeId: number | null;
  /** Whether the context handler stored a plan; a turn without one commits `degraded`. */
  planned: boolean;
  /** The chain the plan was folded on, up to the target's parent. */
  chain: ChainEntry[];
  /** P4: pinned hashes of the user messages the turn answers. */
  userMessages: Record<MessageId, ContentId>;
  /** P4: re-renders accepted inside this turn's window. */
  rerendered: Record<MessageId, ContentId>;
  /** Set once the reply's save was seen; P4 re-renders are accepted only after it. */
  saved: boolean;
  seed: string;
  markersApplied: number;
  /** The target's parent path when planned (before P4 re-renders); a swipe or regenerate takes it as it starts, so one that gets no plan still knows where it was made (P3). */
  parentPath: PathHash;
  /** Planned (`pre`) events. */
  events: LedgerEvent[];
  /** Starting markers allocated at planning, attached to the first record that holds events (L20). */
  startMarkers: Marker[];
  /** Continue: the head message and its swipe's captured content. */
  continueHead?: MessageId;
  captured?: ContentId;
  /** Re-narrate source (P3). */
  renarrateOf?: { messageId: MessageId; swipeId: number };
  /** Re-narrate: the source's live fixes and materializations, re-validated, with their `seq`s and the new parent path as `at` (P3). */
  copies?: PostEntry[];
  /** Re-narrate: the source's undos of the copies' events, which stay undone. */
  undone?: EventRef[];
  /** Re-narrate: copies that failed re-validation (P3). */
  dropped?: CarryDrop[];
}

/** Latest journal state of one message's ledger. */
export interface JournalMessage {
  ledger: MessageLedger;
  /** True once the metadata mirror holds this state. */
  flushed: boolean;
}

export interface Journal {
  v: 1;
  chatId: ChatId;
  /** Last issued chat-wide `seq`; never reused (L9). */
  seq: number;
  chain: ChainEntry[];
  messages: Record<MessageId, JournalMessage>;
  pauses: Pause[];
  tombstones: Tombstone[];
  held: HeldEntry[];
  /** Open in-flight windows (P2). */
  windows: GenerationId[];
  pending: Record<GenerationId, PendingTurn>;
  /** Whether the starting markers have been written for this chat (L20). */
  started: boolean;
  /** The chat run the journal belongs to; a journal from another run (a re-attached world) is reset. */
  run?: { worldId: WorldId; runSeed: string };
  /** Held writes refused when their window closed, newest last (a few at most); absent when none. */
  refused?: RefusedWrite[];
}

// ---------------------------------------------------------------- fold outputs

/** `fix`: a ✎ fix or GM edit in the Journal (built by the view, never by a fold); `not_carried`: an entry a swipe or a Re-read dropped (`Rec.dropped`). */
export type NoteKind = "dropped" | "inert" | "not_carried" | "tombstoned" | "note" | "fix";

/** A derived Journal note (L16: every stored entry the fold doesn't apply has one). */
export interface JournalNote {
  kind: NoteKind;
  messageId: MessageId;
  ref: EventRef | { marker: number } | null;
  text: string;
}

/** One line of a Keep report (DESIGN §4.3). */
export interface KeepLine {
  messageId: MessageId;
  parentPath: PathHash;
  ref: EventRef | { marker: number };
  status: "dropped" | "inert" | "converted";
  text: string;
  /** The dropped event's group, when it belongs to one: its members drop and convert as one unit. */
  group?: string;
}

/** How a message folded. */
export type MessageFold = "user" | "plain" | "on_path" | "view" | "paused" | "tombstoned";
