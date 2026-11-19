// RPE's store of chats, turns and changes (plan §6.3, Appendix B), on bun:sqlite. A turn is one reply
// attempt, tied to its message by the saved text's hash and the swipe's date; swipes are siblings;
// a chat's path is the chain of its showing swipes. Changes are only ever added (an open turn's
// staged ones aside), each with its lane, and state at any point is folded from the nearest
// snapshot along the exact path to it. Each chat's current state is held in memory.
//
// Every row carries the user: `store.user(id)` answers for one user only.
//
// The store writes only inside its write calls, each one transaction (a savepoint inside the
// caller's, as in RPE's write queue): nothing on opening a database it is handed, nothing in a read.
// A snapshot a read finds worth keeping is stored by that user's next write. States held in memory
// carry the user's fold mark, a row every write that changes what a fold gives replaces, so a state
// folded inside a write the caller then rolls back is never used again.

import { Database } from "bun:sqlite";
import { hashParts } from "../shared/hash";
import type { JsonObject, JsonValue } from "../shared/json";
import { deepFreeze, isRecord } from "../shared/json";
import type { RevisionId, WorldId } from "../shared/ids";
import type { WorldDoc } from "../shared/world";
import type { Registry } from "../engine/registry-impl";
import { setWalkLimits, WALK_DEFAULTS, WALK_SETTINGS, walkLimits } from "../engine/scope";
import type { WorldState } from "../engine/state";
import { aboutOf, applyChecked, applyOwner, applyUnchecked, foldSteps, initialStoreState, inventedUnchecked, laterWrite, type FoldEnv, type FoldStep, type Item, type JobChange, type Outcome, type OwnerChange, type StoredChange } from "./fold";
import { baseOf, draft } from "./working";
import { Areas, type Away, type StoreArea } from "./areas";
import { readSnapshot, snapshotRows, type SnapshotDoc, type SnapshotRows } from "./snapshot";
import { reversal, type UndoPlan } from "./undo";
import { checkChange } from "./input";
import { chainOf, comparePaths, keptOf, matchTurn, mergeKept, nodeKey, toldWith, turnByHash, turnsShown, type ShowingTurn } from "./path";
import { BLANK_REVISION, blankWorld } from "./blank";
import { UserWorlds, type WorldChange, type WorldRevisionRow } from "./worlds";
import { migrateStore, missingStoreTables } from "./schema";
import { FoldAway, type AwayFold, type AwayHeld, type FoldJob, type StoreAway, type StoreBrief } from "./away";
import { TreeView } from "./view";
import {
  bySomeone,
  JoinedTurnError,
  LANES,
  StoreInputError,
  StoreSchemaError,
  type ChangeInput,
  type ChangeRow,
  type ChatRow,
  type EarlierLanded,
  type Folded,
  type KeptOwn,
  type KeptReport,
  type Lane,
  type NotApplied,
  type PathEntry,
  type PathReport,
  type Precision,
  type Report,
  type SeenMessage,
  type ShownMessage,
  type Source,
  type Standing,
  type StoreState,
  type StretchWhy,
  type TurnPoint,
  type TurnRow,
  type TurnStart,
  type TurnStatus,
  type UnsettledChange,
  type UnsettledWhy,
  type WriteTarget,
} from "./types";

/** Defaults for the store's settings. */
export const STORE_DEFAULTS = Object.freeze({
  /** Turns between snapshots on a path (plan §6.3). */
  snapshotEvery: 25,
  /** Chats whose states are held in memory, the chat read least recently let go first; null: every chat. */
  chatsHeld: null as number | null,
  /** States each chat holds (its head, an open turn's, a question's point, …), the least recently read going first. */
  statesPerChat: 8,
  /** Snapshots a user's reads found worth storing, waiting in memory for the user's next write. */
  snapshotsHeld: 32,
  /** Branch links followed back from a chat's messages to the turns they share (plan §6.3). */
  branchHops: 32,
  /** Places up the tree a place's values are inherited from (plan §6.4). */
  placeDepth: 64,
  /** Fields that only describe a level of the tree and never pass down to what is inside it. */
  ownOnly: Object.freeze(["description", "tags"]) as readonly string[],
  /** Names of note in each reflection. */
  notable: 3,
  /** How far the engine's own walks go (`setWalkLimits`): up a kind's chain, up a thing's holders, up the places a visit counts for. */
  kindChain: WALK_DEFAULTS.kindChain,
  holderDepth: WALK_DEFAULTS.holderDepth,
  visitDepth: WALK_DEFAULTS.visitDepth,
  /** Changes a fold may run over here: past it, a caller that can wait (`Store.afar`) has the fold run on a worker thread (plan §4.1 l.199). */
  workerFoldAt: 500,
});

/** Bumped whenever this fold's output for the same changes would differ: snapshots made before are not used. */
const FOLD_VERSION = 8;

/** A fold that holds the thread this long or longer says so in the log, once (`saidLong`). */
const LONG_FOLD_MS = 1000;

export interface StoreOptions {
  /**
   * A database file's path or `:memory:`: the store opens it, brings its tables up and closes it.
   * Or an open database: its owner has made the store's tables (on RPE's, the application's
   * migrations), keeps it open, and wraps every write call (RPE's write queue).
   */
  db: Database | string;
  registry: Registry;
  /** World documents by revision. */
  worlds: (revision: RevisionId) => WorldDoc | undefined;
  /** Told once a world's revision, index, draft or history note is durable (`UserWorlds`): the app passes it to the live socket for open Build pages. */
  worldChanged?: (change: WorldChange) => void;
  snapshotEvery?: number;
  /** Identifies the code that folds (a build id): snapshots other code made are not used. Defaults to the packs and their versions. */
  fingerprint?: string;
  /** How many chats' states are held in memory, the chat read least recently let go first; null (the default): every chat. */
  chatsHeld?: number | null;
  /** How many states each chat holds (its head, an open turn's, a question's point, …), the least recently read going first. */
  statesPerChat?: number;
  /** How many snapshots a user's reads found worth storing wait in memory for the user's next write. */
  snapshotsHeld?: number;
  /** How many branch links back a chat's messages are followed to the turns they share. */
  branchHops?: number;
  /** How many places up the tree a place's values are inherited from. */
  placeDepth?: number;
  ownOnly?: readonly string[];
  notable?: number;
  now?: () => number;
  /**
   * Told when an engine handler, or a pack's code a fold calls, throws while the store applies or checks a change: an error in the
   * engine, not in the story, naming the user, the chat whose turn it is, the turn and the change (null before it is kept). Its text
   * is for people (the log, the live view) and never reaches a model, whose report says only that the handler failed. Unset, it is
   * written to standard error.
   */
  handlerFailed?: (failure: StoreFailure) => void;
  /** How far the engine's own walks go (`engine.maxKindChain`, `engine.maxHolderDepth`, `places.maxVisitDepth`); each 32 by default. */
  kindChain?: number;
  holderDepth?: number;
  visitDepth?: number;
  /** The log, for what the store and the engine say for people: a walk cut short by its setting, once for each chain. Unset: the log given before. */
  log?: (message: string, data: Record<string, unknown>) => void;
  /** The areas whose operations (`<area>.<op>`) fold beside the engine's: the story, the cast, lore overlays (`StoreArea`). */
  areas?: readonly StoreArea[];
  /** The most changes a fold runs over before `afar` hands it to a thread (`store.workerFoldAt`, 500 by default). */
  workerFoldAt?: number;
  /** Where a long fold runs, with the database file it reads there; none: every fold runs where it is asked (`afar` just reads). */
  away?: StoreAway;
  /**
   * Told when a read holds snapshots for the user's next write (`hold`): its owner stores them soon after (`UserStore.storeHeld`), so
   * what reads fold outlives a restart even where nothing is written for a long while. Unset: they wait for the user's next write.
   */
  heldWaiting?: (user: string) => void;
}

/** A handler's failure, as the store tells it (`StoreOptions.handlerFailed`). */
export interface StoreFailure {
  op: string;
  error: unknown;
  user: string;
  /** The chat the turn was played in; absent for a turn the store no longer holds. */
  chat?: string;
  turn: string;
  change: number | null;
}

/** One turn on a chat's line (`UserStore.line`): its id, and the place on the chat's path of the reply it stands at. */
export interface LineTurn {
  turn: string;
  at: number;
}

export interface SessionRow {
  id: string;
  chat: string;
  scene: string;
  openedBy: string;
  closedBy: string | null;
}

interface TurnDb {
  id: string;
  chat: string;
  parent: string | null;
  node: string;
  depth: number;
  kind: string;
  imported: number;
  generation: string | null;
  message: string | null;
  hash: string | null;
  swipe_date: number | null;
  status: string;
  edited: string | null;
  text: string | null;
  joined: string | null;
  intent: string | null;
  story_time: number | null;
  timings: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created: number;
}

interface ChangeDb {
  id: number;
  turn: string;
  chat: string | null;
  ord: number;
  lane: string;
  op: string;
  value: string;
  by: string | null;
  handle: string | null;
  standing: string | null;
  precision: string | null;
  source: string | null;
  cite: string | null;
  job: string | null;
  applied: number;
  reports: string | null;
  /** The reports its tool made for it, as JSON; null: none. */
  told: string | null;
  created: number;
  /** His own change written again after an import (`restoreOwn`): the turn it stands just before, and the moment it is placed by. */
  placed: string | null;
  moment: number | null;
}

interface ChatDb {
  id: string;
  world: string | null;
  revision: string | null;
  source_chat: string | null;
  source_message: string | null;
  head: string | null;
  path: string;
  /** What was heard of the chat's messages since its last comparison (`Heard`), as JSON. */
  heard: string;
  /** How many marks and edits of the chat's messages RPE has heard, ever: what each entry of `heard` is numbered by. */
  heard_count: number;
  created: number;
  /** When the chat was first compared (`sync`); null before. */
  compared: number | null;
  deleted: number | null;
  seed: string | null;
  started: number | null;
  was_on: number | null;
  engine: string | null;
  /** What a comparison between turns found and kept for the next turn's start to tell (`KeptReport`), as JSON; null: nothing. */
  kept: string | null;
}

interface Cached {
  /** The chat whose fold mark it was folded under: the chat its node's turn was played in; null: a world's start, held under any. */
  chat: string | null;
  mark: string | null;
  folded: Folded;
  upto: number;
}

/** A snapshot a user's fold found worth storing, kept for the user's next write while the mark of the chat it was folded under holds. */
interface HeldRow {
  upto: number;
  rows: SnapshotRows;
  chat: string;
  mark: string;
}

/** A chat's path as its last comparison took it, read from the text its row keeps, with its entries by message id. */
interface ComparedPath {
  text: string;
  entries: readonly PathEntry[];
  byMessage: ReadonlyMap<string, PathEntry>;
}

function turnOf(r: TurnDb): TurnRow {
  return {
    id: r.id,
    chat: r.chat,
    parent: r.parent,
    node: r.node,
    depth: r.depth,
    kind: r.kind,
    imported: r.imported === 1,
    generation: r.generation,
    message: r.message,
    hash: r.hash,
    date: r.swipe_date,
    status: r.status as TurnStatus,
    edited: r.edited,
    text: r.text,
    joined: r.joined,
    intent: r.intent,
    storyTime: r.story_time,
    timings: r.timings === null ? null : (JSON.parse(r.timings) as JsonValue),
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    created: r.created,
  };
}

/** A change's tool reports as its row keeps them: JSON, or null for none. */
function toldOf(c: ChangeInput): string | null {
  return c.reports === undefined || c.reports.length === 0 ? null : JSON.stringify(c.reports.map((r) => (r.values === undefined ? { code: r.code } : { code: r.code, values: r.values })));
}

function changeOf(r: ChangeDb): ChangeRow {
  return {
    id: r.id,
    turn: r.turn,
    chat: r.chat,
    ord: r.ord,
    lane: r.lane as Lane,
    op: r.op,
    value: JSON.parse(r.value) as JsonValue,
    by: r.by,
    handle: r.handle,
    standing: r.standing as Standing | null,
    precision: r.precision as Precision | null,
    source: r.source as Source | null,
    cite: r.cite === null ? null : (JSON.parse(r.cite) as JsonValue),
    job: r.job,
    applied: r.applied === 1,
    reports: [...(r.told === null ? [] : (JSON.parse(r.told) as Report[])), ...(r.reports === null ? [] : (JSON.parse(r.reports) as Report[]))],
    created: r.created,
  };
}

function chatOf(r: ChatDb): ChatRow {
  return { id: r.id, world: r.world as WorldId | null, revision: r.revision as RevisionId | null, sourceChat: r.source_chat, sourceMessage: r.source_message, head: r.head, created: r.created, deleted: r.deleted, seed: r.seed ?? r.id, started: r.started ?? r.created, wasOn: r.was_on === null ? null : r.was_on === 1, engine: r.engine };
}

/**
 * A chat's path as stored. A path stored before the store kept hidden marks holds none: its messages
 * read as not hidden until the next comparison takes the marks as the chat shows them.
 */
function pathOf(json: string): PathEntry[] {
  const path = JSON.parse(json) as (Omit<PathEntry, "hidden"> & { hidden?: boolean })[];
  for (const e of path) e.hidden ??= false;
  return path as PathEntry[];
}

/**
 * What RPE heard of a chat's messages since its last comparison (plan §4.2, §6.3), by message id, kept in the chat's row until a
 * comparison takes it: a hidden mark set or taken off, where it differs from the mark the last comparison took (none taken: not
 * hidden), whether the message is on the path yet or not; and an edit of a reply, as the hash the text of the swipe a turn was
 * played on now has, by turn. Each entry carries the chat's heard count when it was last heard (`at`; one kept before the store
 * counted reads 0), so a comparison takes only what the path it compares could have shown. An edit heard is not the turn's own
 * edit mark (`edited`), which only a comparison sets, so the comparison still finds the edit, records it and tells it.
 */
type Heard = Record<string, { hidden?: boolean; edits?: Record<string, string>; at?: number }>;

/** Puts `message`'s entry into `heard`, numbered `at`: its mark and its edits; one that holds neither goes. */
function hear(heard: Heard, message: string, hidden: boolean | undefined, edits: Record<string, string> | undefined, at: number): void {
  const entry: Heard[string] = { at };
  if (hidden !== undefined) entry.hidden = hidden;
  if (edits !== undefined && Object.keys(edits).length > 0) entry.edits = edits;
  if (entry.hidden === undefined && entry.edits === undefined) delete heard[message];
  else heard[message] = entry;
}

/**
 * The one refusal of a write to a joined turn (plan §10.10, R-192 (f)), made first, over the database itself, by every write call of
 * the store, the cast and the story, and by every reading of a turn's state: a turn joined to another is refused with the typed error
 * naming the turn it joined, so the refusal does not rest on a caller meeting any other check first. A turn that is not there is left
 * to the call's own check. It reads one row and writes nothing.
 */
export function refuseJoined(db: Database, user: string, turn: string): void {
  const joined = db.query<{ joined: string | null }, [string, string]>("SELECT joined FROM turn WHERE user = ? AND id = ?").get(user, turn)?.joined ?? null;
  if (joined !== null) throw new JoinedTurnError(turn, joined);
}

/**
 * The one check of what may be joined (plan §10.10, R-192 (e)), made first by the store's, the cast's and the story's joins: `held`,
 * a continue's open turn, and `into`, the turn tied to the message the continue's end names, both there, neither joined already, of
 * one chat. Anything else is refused with the store's typed errors: a turn that is not there, a turn joined already (naming the turn
 * it joined), a held turn that is not open, a turn that is not tied, turns of different chats. The two turns, read. It writes nothing.
 */
export function joinable(db: Database, user: string, held: string, into: string): { from: TurnRow; to: TurnRow } {
  const [from, to] = [held, into].map((id) => {
    const r = db.query<TurnDb, [string, string]>("SELECT * FROM turn WHERE user = ? AND id = ?").get(user, id);
    if (!r) throw new StoreInputError(`no turn ${id}`);
    refuseJoined(db, user, id);
    return turnOf(r);
  }) as [TurnRow, TurnRow];
  if (from.status !== "open") throw new StoreInputError(`turn ${held} is ${from.status}: only a continue's open turn joins another`);
  if (to.status !== "done" && to.status !== "cut") throw new StoreInputError(`turn ${into} is ${to.status}: a continue joins the turn tied to the message it extended`);
  if (from.chat !== to.chat) throw new StoreInputError(`turn ${held} is chat ${from.chat}'s and turn ${into} is chat ${to.chat}'s: a continue extends a turn of its own chat`);
  return { from, to };
}

/** Opens a store over a database: a path it opens and brings up itself, or a database whose owner made its tables. */
export function openStore(options: StoreOptions): Store {
  return new Store(options);
}

export class Store {
  readonly db: Database;
  readonly env: FoldEnv;
  readonly snapshotEvery: number;
  readonly fingerprint: string;
  /** How many chats are held (null: every one), the states each holds, and the snapshots waiting for a user's next write. */
  private readonly chatsHeld: number | null;
  private readonly statesPerChat: number;
  private readonly snapshotsHeld: number;
  readonly branchHops: number;
  readonly viewOptions: { ownOnly: readonly string[]; notable: number; placeDepth: number };
  readonly now: () => number;
  private readonly worldTold: ((change: WorldChange) => void) | undefined;
  private readonly heldWaiting: ((user: string) => void) | undefined;
  /** The log, for what the store says for people (a walk cut short); null when none was given. */
  readonly log: ((message: string, data: Record<string, unknown>) => void) | null;
  /** Whether the store opened the database itself: then it brought the tables up, and it closes it. */
  private readonly owned: boolean;
  private readonly folds = new Map<string, Cached>();
  /** The keys of the states held, by user and chat (a world's starts under `~`): the chats in the order read, least recent first. */
  private readonly byChat = new Map<string, Set<string>>();
  private readonly held = new Map<string, Map<string, HeldRow>>();
  private readonly compared = new Map<string, ComparedPath>();
  private readonly views = new WeakMap<StoreState, TreeView>();
  private readonly envs = new Map<string, FoldEnv>();
  private readonly handlerFailed: (failure: StoreFailure) => void;
  /** Where a long fold runs (`afar`), the number of changes past which one is long, and what a thread needs to fold as this store does. */
  private readonly away: StoreAway | null;
  /** @internal */ readonly workerFoldAt: number;
  private readonly forThreads: Omit<StoreBrief, "path">;
  /** @internal Whether a fold longer than `workerFoldAt` throws `FoldAway`: set by `afar` for the one synchronous read it makes. */
  guarding = false;

  constructor(options: StoreOptions) {
    if (typeof options.db === "string") {
      // A file the store opens is its own: set up for one writer and many readers, and brought up to its tables.
      this.db = new Database(options.db, { create: true });
      this.owned = true;
      try {
        this.db.run("PRAGMA journal_mode = WAL");
        migrateStore(this.db);
      } catch (error) {
        this.db.close();
        throw error;
      }
    } else {
      // A database the store is handed is its owner's: nothing is written to it here, and its tables must be there.
      this.db = options.db;
      this.owned = false;
      const missing = missingStoreTables(this.db);
      if (missing.length > 0) {
        throw new StoreSchemaError(
          `This database does not hold the store's tables (${missing.join(", ")} missing). On RPE's database the application makes them, running STORE_MIGRATIONS as the "store" area; a database of the store's own is brought up with migrateStore before the store opens on it.`,
        );
      }
    }
    // A chat that names no world plays on the blank one, which the store answers for itself.
    const blank = blankWorld(options.registry);
    this.handlerFailed = options.handlerFailed ?? ((f: StoreFailure) => console.error(`RPE's store: the handler for ${f.op} failed on turn ${f.turn}:`, f.error));
    // An area's operation is never named as an engine event: the store opens on no such pair (`Areas`).
    this.env = { registry: options.registry, worlds: (revision) => (revision === BLANK_REVISION ? blank : options.worlds(revision)), areas: new Areas(options.areas ?? [], (type) => options.registry.get(type) !== undefined) };
    this.snapshotEvery = Math.max(1, Math.floor(options.snapshotEvery ?? STORE_DEFAULTS.snapshotEvery));
    const whole = (n: number | undefined, d: number, least: number): number => Math.max(least, Math.floor(n ?? d));
    this.chatsHeld = options.chatsHeld === undefined ? STORE_DEFAULTS.chatsHeld : options.chatsHeld === null ? null : Math.max(1, Math.floor(options.chatsHeld));
    this.statesPerChat = whole(options.statesPerChat, STORE_DEFAULTS.statesPerChat, 1);
    this.snapshotsHeld = whole(options.snapshotsHeld, STORE_DEFAULTS.snapshotsHeld, 0);
    this.branchHops = whole(options.branchHops, STORE_DEFAULTS.branchHops, 1);
    this.log = options.log ?? null;
    this.workerFoldAt = whole(options.workerFoldAt, STORE_DEFAULTS.workerFoldAt, 1);
    this.away = options.away ?? null;
    this.forThreads = { fingerprint: options.fingerprint, snapshotEvery: this.snapshotEvery, statesPerChat: this.statesPerChat, snapshotsHeld: this.snapshotsHeld, kindChain: options.kindChain, holderDepth: options.holderDepth, visitDepth: options.visitDepth };
    // The engine's walks, read once for every fold: a store opened without them (a script's, the migration's) keeps the process's. A
    // walk one cuts short goes to the log, once for each chain.
    const log = options.log;
    setWalkLimits(
      { kindChain: options.kindChain, holderDepth: options.holderDepth, visitDepth: options.visitDepth },
      log && ((cut) => log("An engine walk stopped at its setting; what lies past it is not counted.", { walk: cut.walk, setting: WALK_SETTINGS[cut.walk], from: cut.from, at: cut.at, limit: cut.limit })),
    );
    // A state folded or a snapshot stored under other walk limits is not used: the limits join whatever fingerprint the store is given.
    const walks = walkLimits();
    const given = options.fingerprint ?? hashParts("rpe.store", String(FOLD_VERSION), ...options.registry.packs.map((p) => `${p.id}@${p.version}`));
    const usual = walks.kindChain === WALK_DEFAULTS.kindChain && walks.holderDepth === WALK_DEFAULTS.holderDepth && walks.visitDepth === WALK_DEFAULTS.visitDepth;
    this.fingerprint = usual ? given : hashParts(given, "walks", String(walks.kindChain), String(walks.holderDepth), String(walks.visitDepth));
    this.viewOptions = { ownOnly: options.ownOnly ?? STORE_DEFAULTS.ownOnly, notable: Math.max(0, Math.floor(options.notable ?? STORE_DEFAULTS.notable)), placeDepth: whole(options.placeDepth, STORE_DEFAULTS.placeDepth, 1) };
    this.now = options.now ?? Date.now;
    this.worldTold = options.worldChanged;
    this.heldWaiting = options.heldWaiting;
  }

  /**
   * @internal The fold's environment for one user: a handler's failure is told naming the user, the chat its turn was played in,
   * the turn and the change.
   */
  envOf(user: string): FoldEnv {
    let env = this.envs.get(user);
    if (!env) {
      env = {
        ...this.env,
        failed: (f) => {
          const chat = this.db.query<{ chat: string }, [string, string]>("SELECT chat FROM turn WHERE user = ? AND id = ?").get(user, f.turn)?.chat;
          this.handlerFailed({ op: f.op, error: f.error, user, ...(chat === undefined ? {} : { chat }), turn: f.turn, change: f.change });
        },
      };
      this.envs.set(user, env);
    }
    return env;
  }

  /** The store for one user: every call reads and writes that user's rows only. */
  user(id: string): UserStore {
    if (id === "") throw new StoreInputError("a user is needed");
    return new UserStore(this, id);
  }

  private readonly writeListeners = new Set<(user: string, chats: readonly string[] | null) => void>();

  /**
   * Tells `listener` of each write a user's store makes, as it is done: the chats whose folds it changes, or null for a write that names none
   * (a comparison moves a chat's head without changing a fold). The state search follows a chat's head by it. Returns what stops it.
   */
  onWrite(listener: (user: string, chats: readonly string[] | null) => void): () => void {
    this.writeListeners.add(listener);
    return () => void this.writeListeners.delete(listener);
  }

  /** @internal */
  wrote(user: string, chats: readonly string[] | null): void {
    for (const listener of this.writeListeners) {
      try {
        listener(user, chats);
      } catch (error) {
        this.log?.("A listener of the store's writes failed.", { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private readonly worldListeners = new Set<(change: WorldChange) => void>();

  /**
   * Tells `listener` of each change to a user's worlds (a revision put, the index, the draft written or dropped, a history note, a world
   * removed), once it is durable, by whoever made it: the store's own `StoreOptions.worldChanged` first, then each listener in the order added.
   * Build's world service tells its open pages by it. Returns what stops it.
   */
  onWorld(listener: (change: WorldChange) => void): () => void {
    this.worldListeners.add(listener);
    return () => void this.worldListeners.delete(listener);
  }

  /** @internal What each `UserWorlds` calls when it has written: the store's own notice, then every listener; one that throws is logged and the rest are still told. */
  worldChanged(change: WorldChange): void {
    for (const told of [this.worldTold, ...this.worldListeners]) {
      try {
        told?.(change);
      } catch (error) {
        this.log?.("A listener of the store's world changes failed.", { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  /** Lets go of everything held in memory: folded states, snapshots waiting for a write, and the paths read last. */
  dropCaches(): void {
    this.folds.clear();
    this.byChat.clear();
    this.held.clear();
    this.compared.clear();
  }

  /**
   * Runs `read`, a call that only reads and may be made again, where a fold over more than `workerFoldAt` changes runs on a worker
   * thread and not here: the fold is handed over, the states the thread held are held here when it answers, and the read is made
   * again, now answered from memory. A read with nothing long in it is made once, as it always was; so is every read where no
   * thread is given, and where a thread's fold fails (the failure is logged).
   */
  async afar<T>(read: () => T): Promise<T> {
    const away = this.away;
    if (away === null) return read();
    for (let tries = 0; tries < 4; tries++) {
      let job: FoldJob;
      this.guarding = true;
      try {
        return read();
      } catch (error) {
        if (!(error instanceof FoldAway)) throw error;
        job = error.job;
      } finally {
        this.guarding = false;
      }
      try {
        await this.foldAway(away, job);
      } catch (error) {
        this.log?.("A long fold could not run on a worker thread, so it runs here.", { error: error instanceof Error ? error.message : String(error) });
        return read();
      }
    }
    return read();
  }

  /** Hands `job` to a thread and takes what it held: a state folded under a mark that moved since is not held, and a snapshot waits for the user's next write as any found by a fold here does. */
  private async foldAway(away: StoreAway, job: FoldJob): Promise<void> {
    const before = new Map(this.db.query<{ chat: string; mark: string }, [string]>("SELECT chat, mark FROM fold_mark WHERE user = ?").all(job.user).map((r) => [r.chat, r.mark]));
    const done = await away.run({ path: away.path, ...this.forThreads }, job);
    for (const f of done.folds) {
      if (f.chat !== null && (f.mark !== (before.get(f.chat) ?? "") || f.mark !== this.markOf(job.user, f.chat))) continue;
      this.keep(f.key, f.folded, f.upto, job.user, f.chat, f.mark);
    }
    this.hold(job.user, done.held);
    for (const said of done.logs) this.log?.(said.message, said.data);
    for (const f of done.failures) this.handlerFailed({ op: f.op, error: new Error(f.message), user: f.user, ...(f.chat === undefined ? {} : { chat: f.chat }), turn: f.turn, change: f.change });
  }

  /** @internal What `user`'s folds hold in memory, for a thread to hand back. */
  takeFolds(user: string): AwayFold[] {
    const prefix = `${user}\u0000`;
    return [...this.folds].filter(([key]) => key.startsWith(prefix)).map(([key, c]) => ({ key, chat: c.chat, mark: c.mark, folded: c.folded, upto: c.upto }));
  }

  /** @internal The snapshots `user`'s folds found worth storing, as `hold` takes them back. */
  takeHeld(user: string): AwayHeld[] {
    return [...(this.held.get(user) ?? [])].map(([node, row]): AwayHeld => [node, row.upto, row.rows, row.chat, row.mark]);
  }

  /** Closes the database if the store opened it; one it was handed stays open, its owner's to close. */
  close(): void {
    if (this.owned) this.db.close();
  }

  /** @internal A chat's fold mark. Being a row, a rollback puts it back with the rows it answers for. */
  markOf(user: string, chat: string): string {
    return this.db.query<{ mark: string }, [string, string]>("SELECT mark FROM fold_mark WHERE user = ? AND chat = ?").get(user, chat)?.mark ?? "";
  }

  /** @internal Gives each of the chats a fold mark never used before; inside a write. */
  newMarks(user: string, chats: readonly string[]): void {
    const put = this.db.query("INSERT INTO fold_mark (user, chat, mark) VALUES (?, ?, ?) ON CONFLICT (user, chat) DO UPDATE SET mark = excluded.mark");
    for (const chat of chats) put.run(user, chat, crypto.randomUUID());
  }

  /** @internal A state held in memory: one folded under `mark`, or one that holds under any. Reading it makes it, and its chat, the most recently read. */
  cached(key: string, mark?: string): Cached | null {
    const hit = this.folds.get(key);
    if (!hit || (hit.mark !== null && hit.mark !== mark)) return null;
    const group = key.slice(0, key.indexOf("\u0000") + 1) + (hit.chat ?? "~");
    const keys = this.byChat.get(group);
    if (keys) {
      keys.delete(key);
      keys.add(key);
      this.byChat.delete(group);
      this.byChat.set(group, keys);
    }
    return hit;
  }

  /**
   * @internal Holds a folded state in memory for `user`'s `chat` (null: a world's start). It is frozen, through and through, once,
   * here: its state, and the lists of turns standing rebased and of what no longer applies that come with it, reports and all. Every
   * reader of that point is handed these very objects (a question, the turn that follows it, the comparison's report, the tree), so a
   * reader that changed one would change what every later fold, briefing and turn there starts from. Freezing walks only what the fold
   * made: what it shares with the state it started from is frozen already. A chat holds `statesPerChat` states, the least recently
   * read going first; past `chatsHeld` chats, the chat read least recently is let go whole.
   */
  keep(key: string, folded: Folded, upto: number, user: string, chat: string | null, mark: string | null): void {
    deepFreeze(folded);
    const group = `${user}\u0000${chat ?? "~"}`;
    let keys = this.byChat.get(group);
    if (!keys) keys = new Set();
    else this.byChat.delete(group);
    this.byChat.set(group, keys);
    keys.delete(key);
    keys.add(key);
    this.folds.set(key, { chat, mark, folded, upto });
    for (const oldest of keys) {
      if (keys.size <= this.statesPerChat) break;
      keys.delete(oldest);
      this.folds.delete(oldest);
    }
    if (this.chatsHeld === null) return;
    let chats = 0;
    for (const g of this.byChat.keys()) if (!g.endsWith("\u0000~")) chats++;
    for (const [g, gone] of this.byChat) {
      if (chats <= this.chatsHeld) break;
      if (g.endsWith("\u0000~") || g === group) continue;
      for (const k of gone) this.folds.delete(k);
      this.byChat.delete(g);
      chats--;
    }
  }

  /** @internal Holds snapshots (node, upto, the rows to store, the chat and its mark they were folded under) for the user's next write, and says so (`heldWaiting`). */
  hold(user: string, rows: readonly [string, number, SnapshotRows, string, string][]): void {
    if (rows.length === 0) return;
    let held = this.held.get(user);
    if (!held) {
      held = new Map();
      this.held.set(user, held);
    }
    for (const [node, upto, snapshot, chat, mark] of rows) {
      held.delete(node);
      held.set(node, { upto, rows: snapshot, chat, mark });
    }
    for (const oldest of held.keys()) {
      if (held.size <= this.snapshotsHeld) break;
      held.delete(oldest);
    }
    this.heldWaiting?.(user);
  }

  /**
   * @internal Stores the user's held snapshots whose chats' marks still hold; inside a write. One of a node not stored yet (a question's
   * fold of a path no comparison has stored) waits, under its mark, for the write that stores the node.
   */
  flush(user: string): void {
    const held = this.held.get(user);
    if (!held) return;
    this.held.delete(user);
    const marks = new Map<string, string>();
    const holds = (row: HeldRow): boolean => {
      let mark = marks.get(row.chat);
      if (mark === undefined) {
        mark = this.markOf(user, row.chat);
        marks.set(row.chat, mark);
      }
      return mark === row.mark;
    };
    const rows = [...held].filter(([, row]) => holds(row));
    for (const [, row] of rows) this.putParts(user, row.rows.parts);
    const waiting = new Map<string, HeldRow>();
    for (const [node, row] of rows) if (!this.putSnapshot(user, node, "cache", row.upto, row.rows.manifest)) waiting.set(node, row);
    for (const [, row] of rows) this.dropUnheld(user, row.rows.parts);
    if (waiting.size > 0) this.held.set(user, waiting);
  }

  /** @internal Stores a snapshot at `node` (`kind` cache or base), its parts first; inside a write. */
  storeSnapshot(user: string, node: string, kind: "cache" | "base", upto: number, rows: SnapshotRows): void {
    this.putParts(user, rows.parts);
    this.putSnapshot(user, node, kind, upto, rows.manifest);
    this.dropUnheld(user, rows.parts);
  }

  private putParts(user: string, parts: readonly [string, string][]): void {
    const put = this.db.query("INSERT OR IGNORE INTO snapshot_part (user, hash, body, refs) VALUES (?, ?, ?, 0)");
    for (const [hash, body] of parts) put.run(user, hash, body);
  }

  /** A snapshot's row, where its node is stored and every part it names is: whether it was stored. Its parts count it (the triggers). */
  private putSnapshot(user: string, node: string, kind: "cache" | "base", upto: number, manifest: string): boolean {
    return (
      this.db
        .query<unknown, [string, string, string, string, number, string, number]>(
          `INSERT INTO snapshot (user, node, kind, fingerprint, upto, state, created) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
           WHERE EXISTS (SELECT 1 FROM path_node WHERE user = ?1 AND key = ?2)
             AND NOT EXISTS (SELECT 1 FROM json_each(?6, '$.parts') j WHERE NOT EXISTS (SELECT 1 FROM snapshot_part p WHERE p.user = ?1 AND p.hash = j.value))
           ON CONFLICT (user, node, kind) DO UPDATE SET fingerprint = excluded.fingerprint, upto = excluded.upto, state = excluded.state, created = excluded.created`,
        )
        .run(user, node, kind, this.fingerprint, upto, manifest, this.now()).changes > 0
    );
  }

  /** Parts put for snapshots that no stored snapshot names after all go. */
  private dropUnheld(user: string, parts: readonly [string, string][]): void {
    const drop = this.db.query("DELETE FROM snapshot_part WHERE user = ? AND hash = ? AND refs <= 0");
    for (const [hash] of parts) drop.run(user, hash);
  }

  /** @internal A stored snapshot's row read whole, its parts read from the user's. */
  readSnapshot(user: string, text: string): SnapshotDoc {
    return readSnapshot(text, (hashes) => {
      const rows = this.db.query<{ hash: string; body: string }, [string, string]>("SELECT p.hash, p.body FROM json_each(?2) j JOIN snapshot_part p ON p.user = ?1 AND p.hash = j.value").all(user, JSON.stringify(hashes));
      return new Map(rows.map((r) => [r.hash, r.body]));
    });
  }

  /**
   * @internal A chat's path as its last comparison took it, from the text the chat's row keeps: read once for each text, so a
   * question asked again of a chat not compared since does not read the whole path again. Read it, never change it.
   */
  comparedPath(user: string, chat: string, text: string): ComparedPath {
    const key = `${user}\u0000${chat}`;
    const hit = this.compared.get(key);
    if (hit !== undefined && hit.text === text) return hit;
    const entries = pathOf(text);
    const read: ComparedPath = { text, entries, byMessage: new Map(entries.map((e) => [e.message, e])) };
    this.compared.delete(key);
    this.compared.set(key, read);
    for (const oldest of this.compared.keys()) {
      if (this.chatsHeld === null || this.compared.size <= this.chatsHeld) break;
      this.compared.delete(oldest);
    }
    return read;
  }

  /**
   * A named read of an area's slice in `state` (`StoreArea.reads`): what the tree and the world state ask an area. An area or read the
   * store does not have is refused as input it cannot read.
   */
  readArea(state: StoreState, area: string, read: string, args: JsonObject = {}): JsonValue {
    const a = this.env.areas?.get(area);
    const fn = a?.reads && Object.hasOwn(a.reads, read) ? a.reads[read] : undefined;
    if (!a || !fn) throw new StoreInputError(`no read ${read} of the area ${area}`);
    return fn(state.areas?.[area] ?? a.initial?.() ?? {}, args);
  }

  /**
   * The tree over `state`, held with it. A state folded from one whose tree is held (along the drafts it was made over) has its tree
   * made from that one, kept current with what changed rather than built afresh (PlanStore-S2 item 5).
   * @internal
   */
  viewOf(state: StoreState): TreeView {
    let view = this.views.get(state);
    if (!view) {
      let prev: TreeView | undefined;
      for (let at = baseOf(state); at !== undefined && prev === undefined; at = baseOf(at)) prev = this.views.get(at);
      view = new TreeView(this.env, state, this.viewOptions, prev);
      this.views.set(state, view);
    }
    return view;
  }
}

/** One user's chats, turns, changes and state. */
export class UserStore {
  constructor(
    private readonly store: Store,
    readonly id: string,
  ) {}

  private get db(): Database {
    return this.store.db;
  }

  /**
   * Every write the store makes runs here, as one transaction (a savepoint inside the caller's).
   * Snapshots earlier reads found are stored first, while the marks they were folded under hold. A
   * write that changes what a fold gives (changes added or taken back, a starting state set, turns
   * removed) names the chats whose folds it changes (`chats`: those whose path runs through what it
   * writes; false for a write that changes no fold), and gives each a new fold mark before and after
   * it, so no state of theirs folded before it, or during it, is used once it is done, or once it is
   * undone. Every other chat keeps what it holds.
   */
  private write<T>(chats: readonly string[] | false, fn: () => T): T {
    return this.db.transaction(() => {
      this.store.flush(this.id);
      if (chats !== false) this.store.newMarks(this.id, chats);
      const out = fn();
      if (chats !== false) this.store.newMarks(this.id, chats);
      else this.store.flush(this.id);
      this.store.wrote(this.id, chats === false ? null : chats);
      return out;
    })();
  }

  /**
   * The chats whose path runs through a turn: its own, and each branch of it (and of its branches) whose path holds the turn, since
   * shared history is shared, not copied (plan §6.3 l.616). A write on the turn changes their folds, and no other chat's.
   */
  private throughTurn(turn: TurnRow): string[] {
    return this.db
      .query<{ chat: string }, [string, string, string]>(
        `WITH RECURSIVE kin(chat) AS (
           SELECT ?2 UNION SELECT l.chat FROM message_link l JOIN kin k ON l.user = ?1 AND l.source_chat = k.chat)
         SELECT k.chat FROM kin k JOIN chat c ON c.user = ?1 AND c.id = k.chat
         WHERE k.chat = ?2 OR EXISTS (SELECT 1 FROM json_each(c.path) j WHERE json_extract(j.value, '$.turn') = ?3)`,
      )
      .all(this.id, turn.chat, turn.id)
      .map((r) => r.chat);
  }

  /** A chat and every branch of it, and of its branches: all whose paths may run through its turns. */
  private withBranches(chat: string): string[] {
    return this.db
      .query<{ chat: string }, [string, string]>("WITH RECURSIVE kin(chat) AS (SELECT ?2 UNION SELECT l.chat FROM message_link l JOIN kin k ON l.user = ?1 AND l.source_chat = k.chat) SELECT chat FROM kin")
      .all(this.id, chat)
      .map((r) => r.chat);
  }

  // ------------------------------------------------------------ chats

  /**
   * A new chat, starting on `revision` of `world`. It keeps its own record: its seed and when it started (one made on RPE gets its
   * own; a carried chat is given the old engine's), and, for a carried chat, whether the old engine was on for it before the swap and
   * which engine played it. Every caller reads them with the chat (`ChatRow`).
   */
  createChat(input: { id: string; world?: WorldId | null; revision?: RevisionId | null; seed?: string; started?: number; wasOn?: boolean | null; engine?: string | null }): ChatRow {
    if (this.chat(input.id)) throw new StoreInputError(`chat ${input.id} exists`);
    const now = this.store.now();
    this.write(false, () =>
      this.db.run("INSERT INTO chat (user, id, world, revision, created, seed, started, was_on, engine) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        this.id,
        input.id,
        input.world ?? null,
        input.revision ?? null,
        now,
        input.seed ?? crypto.randomUUID(),
        input.started ?? now,
        input.wasOn === undefined || input.wasOn === null ? null : input.wasOn ? 1 : 0,
        input.engine ?? null,
      ]),
    );
    return this.chat(input.id) as ChatRow;
  }

  chat(id: string): ChatRow | null {
    const r = this.chatDb(id);
    return r ? chatOf(r) : null;
  }

  /** The chat's row, or for a chat the store does not hold the row an untouched chat reads as (no world, its id for its seed), never stored. */
  chatOrUntouched(id: string): ChatRow {
    return chatOf(this.chatRead(id));
  }

  /** The chat's row as stored, its path included; null for a chat the store does not know. */
  private chatDb(id: string): ChatDb | null {
    return this.db.query<ChatDb, [string, string]>("SELECT * FROM chat WHERE user = ? AND id = ?").get(this.id, id);
  }

  /** The user's chats, oldest first; a chat deleted while a branch still shares its turns is left out. Each chat's path is not read. */
  chats(): ChatRow[] {
    return this.db
      .query<ChatDb, [string]>("SELECT id, world, revision, source_chat, source_message, head, '' AS path, '{}' AS heard, 0 AS heard_count, created, deleted FROM chat WHERE user = ? AND deleted IS NULL ORDER BY created, rowid")
      .all(this.id)
      .map(chatOf);
  }

  /**
   * Attaches a chat to a world revision (Build's Attach): a chat that plays no world yet plays
   * `revision` of `world` from its start, at once. One the store has not seen is made so; one that
   * has turns has them folded again from the revision, so the snapshots kept on their paths go. A
   * chat that plays a revision already keeps it, and nothing changes. The revision the chat plays now.
   */
  attachWorld(input: { id: string; world: WorldId; revision: RevisionId }): RevisionId {
    if (input.revision === BLANK_REVISION || this.store.env.worlds(input.revision) === undefined) throw new StoreInputError(`the world revision ${input.revision} is not available`);
    const row = this.chat(input.id);
    if (row === null) {
      this.createChat(input);
      return input.revision;
    }
    if (row.revision !== null) return row.revision;
    this.write(this.withBranches(input.id), () => {
      this.db.run("UPDATE chat SET world = ?, revision = ? WHERE user = ? AND id = ?", [input.world, input.revision, this.id, input.id]);
      this.db.run(
        `WITH RECURSIVE down(key) AS (
           SELECT key FROM path_node WHERE user = ?1 AND turn IN (SELECT id FROM turn WHERE user = ?1 AND chat = ?2)
           UNION SELECT n.key FROM path_node n JOIN down d ON n.user = ?1 AND n.prev = d.key)
         DELETE FROM snapshot WHERE user = ?1 AND kind = 'cache' AND node IN (SELECT key FROM down)`,
        [this.id, input.id],
      );
    });
    return input.revision;
  }

  private chatOrThrow(id: string): ChatDb {
    const r = this.chatDb(id);
    if (!r) throw new StoreInputError(`no chat ${id}`);
    return r;
  }

  /**
   * The chat's row for a reading: as stored, or for a chat the store does not hold, the row an untouched chat has (no world, no
   * turn, an empty path), which is never stored: a read of a chat RPE has not taken on answers as an untouched chat reads.
   */
  private chatRead(id: string): ChatDb {
    return this.chatDb(id) ?? { id, world: null, revision: null, source_chat: null, source_message: null, head: null, path: "[]", heard: "{}", heard_count: 0, created: 0, compared: null, deleted: null, seed: null, started: null, was_on: null, engine: null, kept: null };
  }

  /**
   * A branch (plan §6.3): a new chat whose messages carry new ids for the source chat's, by the
   * old-to-new map the chat application gave when it made the copy. The branch's path finds the
   * source's turns through the map, so shared history is shared, not copied. The fork point is the
   * message the branch was made at: given, or, as Lumiverse's `CHAT_FORKED` gives only the two chats
   * and the map, the last message of the source's path that the map names. The branch keeps its own record as any chat does
   * (`createChat`): its own seed and start unless given, and, for a carried branch, whether the old engine was on and which played it.
   */
  branchChat(input: { id: string; from: string; map: Readonly<Record<string, string>>; at?: string | null; seed?: string; started?: number; wasOn?: boolean | null; engine?: string | null }): ChatRow {
    const source = this.chatOrThrow(input.from);
    if (this.chat(input.id)) throw new StoreInputError(`chat ${input.id} exists`);
    const was = pathOf(source.path);
    const at = input.at ?? was.findLast((e) => Object.hasOwn(input.map, e.message))?.message ?? null;
    // Its line from the moment it is made: the source's path up to the branch point, each message the branch's copy with its hidden
    // mark, and its head the node there; what was heard of the copied messages since the source's last comparison goes across too.
    const upto = at === null ? -1 : was.findIndex((e) => e.message === at);
    const path = was.slice(0, upto + 1).flatMap((e) => (Object.hasOwn(input.map, e.message) ? [{ ...e, message: input.map[e.message] as string }] : []));
    const head = path.findLast((e) => e.node !== null)?.node ?? null;
    const heardThere = JSON.parse(source.heard) as Heard;
    const heard: Heard = {};
    for (const [old, now] of Object.entries(input.map)) {
      const h = heardThere[old];
      if (h !== undefined) heard[now] = h;
    }
    this.write(false, () => {
      const made = this.store.now();
      this.db.run("INSERT INTO chat (user, id, world, revision, source_chat, source_message, head, path, heard, heard_count, created, seed, started, was_on, engine) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        this.id,
        input.id,
        source.world,
        source.revision,
        input.from,
        at,
        head,
        JSON.stringify(path),
        JSON.stringify(heard),
        source.heard_count,
        made,
        input.seed ?? crypto.randomUUID(),
        input.started ?? made,
        input.wasOn === undefined || input.wasOn === null ? null : input.wasOn ? 1 : 0,
        input.engine ?? null,
      ]);
      const link = this.db.query("INSERT OR REPLACE INTO message_link (user, chat, message, source_chat, source_message) VALUES (?, ?, ?, ?, ?)");
      for (const [old, now] of Object.entries(input.map)) link.run(this.id, input.id, now, input.from, old);
    });
    return this.chat(input.id) as ChatRow;
  }

  /**
   * Deletes a chat and everything that is only its own. When a branch still shares its turns, the
   * turns and their changes are kept and the chat is only marked deleted, until its last branch goes.
   */
  deleteChat(id: string): { kept: boolean } {
    const row = this.chatOrThrow(id);
    const shared = this.db.query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM message_link WHERE user = ? AND source_chat = ?").get(this.id, id);
    if ((shared?.n ?? 0) > 0) {
      this.write(false, () => {
        this.db.run("UPDATE chat SET deleted = ?, path = '[]', heard = '{}', head = NULL WHERE user = ? AND id = ?", [this.store.now(), this.id, id]);
        this.db.run("DELETE FROM session WHERE user = ? AND chat = ?", [this.id, id]);
      });
      return { kept: true };
    }
    // The chat goes, and with it each deleted source kept only for it: none of them is held any more.
    const gone = [id];
    for (let source = row.source_chat; source !== null; ) {
      const up = this.db.query<{ deleted: number | null; source_chat: string | null }, [string, string]>("SELECT deleted, source_chat FROM chat WHERE user = ? AND id = ?").get(this.id, source);
      if (!up || up.deleted === null) break;
      gone.push(source);
      source = up.source_chat;
    }
    this.write(gone, () => {
      this.removeChat(id);
      // A deleted chat kept only for this branch goes with it.
      for (let source = row.source_chat; source !== null; ) {
        const up = this.db.query<{ deleted: number | null; source_chat: string | null; links: number }, [string, string]>("SELECT deleted, source_chat, (SELECT count(*) FROM message_link l WHERE l.user = c.user AND l.source_chat = c.id) AS links FROM chat c WHERE c.user = ? AND c.id = ?").get(this.id, source);
        if (!up || up.deleted === null || up.links > 0) break;
        this.removeChat(source);
        source = up.source_chat;
      }
    });
    return { kept: false };
  }

  /** Removes a chat's own rows: its turns, their changes and path nodes, every snapshot on a path through them, its sessions and links, and the chat. */
  private removeChat(id: string): void {
    const turns = "SELECT id FROM turn WHERE user = ?1 AND chat = ?2";
    this.db.run(
      `WITH RECURSIVE down(key) AS (
         SELECT key FROM path_node WHERE user = ?1 AND turn IN (${turns})
         UNION SELECT n.key FROM path_node n JOIN down d ON n.user = ?1 AND n.prev = d.key)
       DELETE FROM snapshot WHERE user = ?1 AND node IN (SELECT key FROM down)`,
      [this.id, id],
    );
    this.db.run(`DELETE FROM change WHERE user = ?1 AND (turn IN (${turns}) OR chat = ?2)`, [this.id, id]);
    this.db.run(`DELETE FROM path_node WHERE user = ?1 AND turn IN (${turns})`, [this.id, id]);
    for (const table of ["turn", "session", "message_link", "reply_reason"]) this.db.run(`DELETE FROM ${table} WHERE user = ? AND chat = ?`, [this.id, id]);
    this.db.run("DELETE FROM chat WHERE user = ? AND id = ?", [this.id, id]);
  }

  /**
   * Whether a chat has been played on RPE: it holds a turn RPE began itself, a change RPE recorded on one of its turns (an import gives
   * every change it writes the source `import`), or a change of his own.
   */
  isPlayed(chat: string): boolean {
    this.chatOrThrow(chat);
    return this.playedOnTurns(chat) || this.db.query<{ id: number }, [string, string]>("SELECT id FROM change WHERE user = ? AND chat = ? LIMIT 1").get(this.id, chat) !== null;
  }

  /** Whether a chat holds a turn RPE played (`playedIn`) or a change RPE recorded on one of its turns; his own changes, of no turn, are not counted. */
  private playedOnTurns(chat: string): boolean {
    if (this.playedIn(chat)) return true;
    const r = this.db
      .query<{ played: number }, [string, string]>(
        `SELECT EXISTS(SELECT 1 FROM change c JOIN turn t ON t.user = c.user AND t.id = c.turn WHERE c.user = ?1 AND t.chat = ?2 AND (c.source IS NULL OR c.source <> 'import')) AS played`,
      )
      .get(this.id, chat);
    return r?.played === 1;
  }

  /**
   * Of `turns`, the ones RPE played: the one test of whether RPE played a turn, read by everything that asks it of a turn, a path or a
   * chat (a migrated chat's first briefing, the counts of perceptions owed, the Turn page, the Chats page). A turn RPE began itself (its
   * row is not a migration's import, `imported`), or a turn a migration carried that a continue RPE played has joined (`joined`, plan
   * §10.10). A turn a migration carried, with the record of its run the migration keeps, is not among them, nor one only a Settle now
   * run of RPE's settled: the earlier build played it.
   */
  playedOf(turns: readonly string[]): Set<string> {
    if (turns.length === 0) return new Set();
    const rows = this.db
      .query<{ id: string }, [string, string]>(
        `SELECT id FROM turn WHERE user = ?1 AND id IN (SELECT value FROM json_each(?2))
           AND (imported = 0 OR id IN (SELECT joined FROM turn WHERE user = ?1 AND joined IS NOT NULL))`,
      )
      .all(this.id, JSON.stringify(turns));
    return new Set(rows.map((r) => r.id));
  }

  /** Whether RPE played a turn in this chat, by the one test (`playedOf`): it began one there, as a continue of a carried reply begins its held turn there. */
  playedIn(chat: string): boolean {
    return this.db.query<{ played: number }, [string, string]>("SELECT EXISTS(SELECT 1 FROM turn WHERE user = ? AND chat = ? AND imported = 0) AS played").get(this.id, chat)?.played === 1;
  }

  /**
   * Removes everything an import wrote for a chat that has not been played on RPE, so the next
   * migration run can import it afresh: its turns, their changes, the snapshots and starting states on
   * its paths, its links and the chat itself; and the same for every branch made from it, whose
   * history its turns are. A chat counts as played by a turn RPE began or a change RPE recorded on a
   * turn; his own changes (his edits, his jobs') do not count: they go with the chat and are returned
   * (`kept`), each with the reply whose turn it stood before, for `restoreOwn` once the import has
   * tied the turns afresh (R-79). When it or one of those branches has been played, nothing is
   * removed and the played ones are listed.
   */
  forgetImport(chat: string): { removed: string[]; played: string[]; kept: KeptOwn[] } {
    if (!this.chat(chat)) return { removed: [], played: [], kept: [] };
    const chats = [chat];
    for (let i = 0; i < chats.length; i++) {
      const branches = this.db.query<{ chat: string }, [string, string]>("SELECT DISTINCT chat FROM message_link WHERE user = ? AND source_chat = ?").all(this.id, chats[i] ?? "");
      for (const b of branches) if (!chats.includes(b.chat)) chats.push(b.chat);
    }
    const played = chats.filter((c) => this.playedOnTurns(c));
    if (played.length > 0) return { removed: [], played, kept: [] };
    const kept = chats.flatMap((c) => this.keptOwn(c));
    this.write(chats, () => {
      for (const c of chats) this.removeChat(c);
    });
    return { removed: chats, played: [], kept };
  }

  /**
   * His own changes of a chat, in the order made, each with where it stands on the chat's own path (as `placeOwner` places it): the
   * reply of the chat's turn it stands just before; none after the path's end, and none for a job's not ended yet, which takes effect
   * when it ends.
   */
  private keptOwn(chat: string): KeptOwn[] {
    const head = this.chatOrThrow(chat).head;
    const run = head === null ? [] : this.chainRows(head);
    const rows = this.db
      .query<ChangeDb & { ended: number | null; depth: number | null }, [string, string]>(
        `SELECT c.*, e.ended, pn.depth FROM change c LEFT JOIN job e ON e.user = c.user AND e.id = c.job
         LEFT JOIN turn pt ON c.placed IS NOT NULL AND pt.user = c.user AND pt.id = c.placed LEFT JOIN path_node pn ON pn.user = c.user AND pn.key = pt.node
         WHERE c.user = ?1 AND c.chat = ?2 ORDER BY c.ord`,
      )
      .all(this.id, chat);
    return rows.map((r): KeptOwn => {
      const at = Math.max(r.moment ?? 0, r.ended ?? r.created);
      const pending = r.job !== null && r.ended === null;
      const i = pending ? -1 : r.depth !== null ? run.findIndex((s) => s.chat === chat && s.depth >= (r.depth ?? 0)) : run.findIndex((s) => s.chat === chat && s.created > at);
      const t = i < 0 ? null : this.turn(run[i]?.turn ?? "");
      const c = changeOf({ ...r, told: null });
      return {
        chat,
        lane: c.lane,
        op: c.op,
        value: c.value,
        by: c.by,
        handle: c.handle,
        standing: c.standing,
        precision: c.precision,
        source: c.source,
        cite: c.cite,
        job: c.job,
        applied: c.applied,
        reports: c.reports,
        told: r.told === null ? [] : (JSON.parse(r.told) as Report[]),
        created: r.created,
        at,
        ended: r.ended,
        before: t?.message ? { message: t.message, hash: t.hash, date: t.date } : null,
      };
    });
  }

  /**
   * Writes again his own changes an import forgot (`forgetImport`), once the import has tied the chats' turns afresh: each as his own
   * change of its chat, in the order kept, with its job's end, just before the turn of that chat now tied to the reply it stood before
   * (`matchTurn` over the reply's swipes; the import's turns share one moment, so it is placed by that turn, not by its moment); one
   * that stood after the path's end takes effect now, at the chat's head. One whose chat or reply is gone is not written: it is
   * returned in `lost`. The chats' stored snapshots are let go, so every fold sees them.
   */
  restoreOwn(kept: readonly KeptOwn[]): { placed: number; lost: KeptOwn[] } {
    const lost: KeptOwn[] = [];
    const put: { k: KeptOwn; turn: string | null }[] = [];
    for (const k of kept) {
      const turn = k.before === null ? null : (matchTurn(this.chat(k.chat) === null ? [] : this.swipes(k.chat, k.before.message), { hash: k.before.hash ?? "", date: k.before.date }).turn?.id ?? undefined);
      if (this.chat(k.chat) === null || turn === undefined) lost.push(k);
      else put.push({ k, turn });
    }
    if (put.length === 0) return { placed: 0, lost };
    const chats = [...new Set(put.map((p) => p.k.chat))];
    const now = this.store.now();
    this.write(chats, () => {
      const ords = new Map<string, number>();
      const insert = this.db.query(
        "INSERT INTO change (user, turn, chat, ord, lane, op, value, by, handle, standing, precision, source, cite, job, applied, reports, told, created, placed, moment) VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const { k, turn } of put) {
        const ord = ords.get(k.chat) ?? (this.db.query<{ ord: number | null }, [string, string]>("SELECT max(ord) AS ord FROM change WHERE user = ? AND chat = ?").get(this.id, k.chat)?.ord ?? -1) + 1;
        ords.set(k.chat, ord + 1);
        const pending = k.job !== null && k.ended === null;
        const cite = k.cite === null ? null : JSON.stringify(k.cite);
        const reports = k.reports.length === 0 ? null : JSON.stringify(k.reports);
        const told = k.told.length === 0 ? null : JSON.stringify(k.told);
        insert.run(this.id, k.chat, ord, k.lane, k.op, JSON.stringify(k.value), k.by, k.handle, k.standing, k.precision, k.source, cite, k.job, k.applied ? 1 : 0, reports, told, k.created, turn, pending ? null : now);
        if (k.job !== null && k.ended !== null) this.db.run("INSERT INTO job (user, id, ended) VALUES (?, ?, ?) ON CONFLICT (user, id) DO UPDATE SET ended = COALESCE(job.ended, excluded.ended)", [this.id, k.job, k.ended]);
      }
    });
    for (const chat of chats) this.dropSnapshots(chat);
    return { placed: put.length, lost };
  }

  // ------------------------------------------------------------ turns

  turn(id: string): TurnRow | null {
    const r = this.db.query<TurnDb, [string, string]>("SELECT * FROM turn WHERE user = ? AND id = ?").get(this.id, id);
    return r ? turnOf(r) : null;
  }

  private turnOrThrow(id: string): TurnRow {
    const t = this.turn(id);
    if (!t) throw new StoreInputError(`no turn ${id}`);
    return t;
  }

  /**
   * A turn a write, or a reading of its state, is addressed to: one there is, and not one joined to another turn, which is refused,
   * naming the turn it joined (plan §10.10, R-192 (f); `refuseJoined`). The store never sends such a call on itself.
   */
  private turnToWrite(id: string): TurnRow {
    refuseJoined(this.db, this.id, id);
    return this.turnOrThrow(id);
  }

  /**
   * The path node for `turn`, one of this user's, standing after the node `on` (null: at the
   * start), made if new. For importers that rebuild a recorded path.
   */
  extendPath(on: string | null, turn: string): string {
    this.turnToWrite(turn);
    let depth = 0;
    if (on !== null) {
      const before = this.db.query<{ depth: number }, [string, string]>("SELECT depth FROM path_node WHERE user = ? AND key = ?").get(this.id, on);
      if (!before) throw new StoreInputError(`no path node ${on}`);
      depth = before.depth + 1;
    }
    const key = nodeKey(on, turn);
    this.write(false, () => this.db.run("INSERT OR IGNORE INTO path_node (user, key, prev, turn, depth) VALUES (?, ?, ?, ?, ?)", [this.id, key, on, turn, depth]));
    return key;
  }

  /**
   * Starts a turn: staged until it is tied to a saved reply. It stands after the chat's head, or,
   * for a swipe or a regenerate of `target`, after the turn before that message on the path; an
   * importer gives the path node itself (`on`).
   */
  beginTurn(input: { chat: string; kind: string; imported?: boolean; generation?: string | null; target?: string | null; on?: string | null; intent?: string | null }): TurnRow {
    const chat = this.chatOrThrow(input.chat);
    let on: string | null = chat.head;
    if (input.on !== undefined) on = input.on;
    else if (input.target) {
      const path = pathOf(chat.path);
      const at = path.findIndex((e) => e.message === input.target);
      if (at >= 0) on = path.slice(0, at).findLast((e) => e.node !== null)?.node ?? null;
    }
    const id = crypto.randomUUID();
    const base = on === null ? null : this.db.query<{ turn: string; depth: number }, [string, string]>("SELECT turn, depth FROM path_node WHERE user = ? AND key = ?").get(this.id, on);
    if (on !== null && !base) throw new StoreInputError(`no path node ${on}`);
    const node = nodeKey(on, id);
    this.write(false, () => {
      this.db.run("INSERT INTO path_node (user, key, prev, turn, depth) VALUES (?, ?, ?, ?, ?)", [this.id, node, on, id, base ? base.depth + 1 : 0]);
      this.db.run("INSERT INTO turn (user, id, chat, parent, node, depth, kind, imported, generation, status, intent, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)", [this.id, id, input.chat, base?.turn ?? null, node, base ? base.depth + 1 : 0, input.kind, input.imported === true ? 1 : 0, input.generation ?? null, input.intent ?? null, this.store.now()]);
    });
    return this.turnOrThrow(id);
  }

  /**
   * Ties a turn to the reply as saved: its message, the saved text's hash and the swipe's date. A
   * reply saved only in part is `cut`. A continue ties the same turn again to the longer text. The
   * turn joins its chat's path at once where it extends it (a new reply after the head, a swipe of
   * the newest reply, or a turn begun after the one its message holds: a branch's continue of a
   * reply it shares); anything else waits for the next comparison (`sync`). An importer gives, with
   * `text`, the text a carried reply was played on, kept with the turn: where the chat shows other
   * text, a comparison tells the edit with it.
   */
  tieTurn(id: string, input: { message: string; hash: string; date?: number | null; status?: "done" | "cut"; text?: string | null }): TurnRow {
    const t = this.turnToWrite(id);
    if (t.status === "dropped") throw new StoreInputError(`turn ${id} was dropped`);
    // A finished turn every `snapshotEvery` along its path keeps its state, so a cold start is short.
    const keep = (t.depth + 1) % this.store.snapshotEvery === 0 ? this.foldNode(t.node) : null;
    this.write(false, () => {
      this.db.run("UPDATE turn SET message = ?, hash = ?, swipe_date = ?, status = ?, edited = NULL WHERE user = ? AND id = ?", [input.message, input.hash, input.date ?? null, input.status ?? "done", this.id, id]);
      if (input.text !== undefined) this.db.run("UPDATE turn SET text = ? WHERE user = ? AND id = ?", [input.text, this.id, id]);
      this.joinPath(t, { message: input.message, user: false, turn: id, node: t.node, own: true, hash: input.hash, date: input.date ?? null });
      if (keep) {
        const doc: SnapshotDoc = { state: keep.folded.state, notApplied: keep.folded.notApplied, rebased: keep.folded.rebased };
        this.store.storeSnapshot(this.id, t.node, "cache", keep.upto, snapshotRows(doc));
      }
    });
    return this.turnOrThrow(id);
  }

  /**
   * A tied turn joins its chat's path where it extends it: a new reply after the head, a swipe of the newest reply, or a turn begun
   * after the turn its message holds, which takes that turn's place there with its own node, so the path still runs through that
   * turn. Inside a write.
   */
  private joinPath(t: TurnRow, entry: Omit<PathEntry, "hidden">): void {
    const chat = this.chatOrThrow(t.chat);
    const path = pathOf(chat.path);
    const prev = this.db.query<{ prev: string | null }, [string, string]>("SELECT prev FROM path_node WHERE user = ? AND key = ?").get(this.id, t.node)?.prev ?? null;
    const at = path.findIndex((e) => e.message === entry.message);
    if (at < 0) {
      if (prev !== chat.head) return;
      // A reply new to the chat comes with no hidden mark.
      path.push({ ...entry, hidden: false });
    } else {
      const before = path.slice(0, at).findLast((e) => e.node !== null)?.node ?? null;
      const goesOn = path[at]?.turn === t.parent && path[at]?.node === prev;
      if ((before !== prev && !goesOn) || path.slice(at + 1).some((e) => e.turn !== null)) return;
      // The hidden mark is the message's: a new swipe of it keeps it.
      path[at] = { ...entry, hidden: path[at]?.hidden ?? false };
    }
    this.db.run("UPDATE chat SET path = ?, head = ? WHERE user = ? AND id = ?", [JSON.stringify(path), t.node, this.id, t.chat]);
  }

  /** A turn whose generation stopped with nothing saved: it never joins a path. */
  dropTurn(id: string): TurnRow {
    const t = this.turnToWrite(id);
    if (t.status !== "open") throw new StoreInputError(`turn ${id} is ${t.status}, not open`);
    this.write(false, () => this.db.run("UPDATE turn SET status = 'dropped' WHERE user = ? AND id = ?", [this.id, id]));
    return this.turnOrThrow(id);
  }

  updateTurn(id: string, input: { intent?: string | null; storyTime?: number | null; timings?: JsonValue | null; tokensIn?: number | null; tokensOut?: number | null }): TurnRow {
    this.turnToWrite(id);
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    const put = (column: string, value: string | number | null): void => {
      sets.push(`${column} = ?`);
      values.push(value);
    };
    if (input.intent !== undefined) put("intent", input.intent);
    if (input.storyTime !== undefined) put("story_time", input.storyTime);
    if (input.timings !== undefined) put("timings", input.timings === null ? null : JSON.stringify(input.timings));
    if (input.tokensIn !== undefined) put("tokens_in", input.tokensIn);
    if (input.tokensOut !== undefined) put("tokens_out", input.tokensOut);
    if (sets.length > 0) this.write(false, () => this.db.run(`UPDATE turn SET ${sets.join(", ")} WHERE user = ? AND id = ?`, [...values, this.id, id]));
    return this.turnOrThrow(id);
  }

  /**
   * The (chat, message) pairs a chat's message is: its own, and through branch links its sources', as many links back as
   * `store.maxBranchHops` says. Where a link goes on past that, it stops: each place it stopped is put in `stopped` and told to the log.
   */
  private sources(chat: string, messages: readonly string[], stopped?: { chat: string; message: string; hops: number }[]): Map<string, { chat: string; message: string }[]> {
    const out = new Map<string, { chat: string; message: string }[]>(messages.map((m) => [m, [{ chat, message: m }]]));
    let frontier: [string, string, string][] = messages.map((m) => [m, chat, m]);
    const linked = (from: readonly [string, string, string][]) =>
      this.db
        .query<{ shown: string; source_chat: string; source_message: string }, [string, string]>(
          "SELECT json_extract(j.value, '$[0]') AS shown, l.source_chat, l.source_message FROM json_each(?2) j CROSS JOIN message_link l ON l.user = ?1 AND l.chat = json_extract(j.value, '$[1]') AND l.message = json_extract(j.value, '$[2]')",
        )
        .all(this.id, JSON.stringify(from));
    const hops = this.store.branchHops;
    for (let hop = 0; frontier.length > 0 && hop < hops; hop++) {
      const links = linked(frontier);
      frontier = links.map((l) => [l.shown, l.source_chat, l.source_message]);
      for (const l of links) out.get(l.shown)?.push({ chat: l.source_chat, message: l.source_message });
    }
    if (frontier.length === 0) return out;
    // Links that go on past the setting: where each chain stopped.
    const beyond = new Set(linked(frontier).map((l) => l.shown));
    const seen = new Set<string>();
    for (const [shown, at, message] of frontier) {
      if (!beyond.has(shown) || seen.has(`${at}\u0000${message}`)) continue;
      seen.add(`${at}\u0000${message}`);
      stopped?.push({ chat: at, message, hops });
      this.store.log?.("A chat's branch links were followed as far as store.maxBranchHops says; the turns beyond are not found.", { user: this.id, chat, stoppedAtChat: at, stoppedAtMessage: message, hops });
    }
    return out;
  }

  /** The turns tied to each of a chat's messages, through branch links too; where the links were followed no further goes in `stopped`. */
  private tiedTo(chat: string, messages: readonly string[], stopped?: { chat: string; message: string; hops: number }[]): Map<string, TurnRow[]> {
    const pairs = this.sources(chat, messages, stopped);
    const flat = [...pairs.entries()].flatMap(([shown, list]) => list.map((p) => [shown, p.chat, p.message] as const));
    const rows = this.db
      .query<TurnDb & { shown: string }, [string, string]>(
        "SELECT json_extract(j.value, '$[0]') AS shown, t.* FROM json_each(?2) j CROSS JOIN turn t ON t.user = ?1 AND t.chat = json_extract(j.value, '$[1]') AND t.message = json_extract(j.value, '$[2]')",
      )
      .all(this.id, JSON.stringify(flat));
    const out = new Map<string, TurnRow[]>();
    for (const r of rows) out.set(r.shown, [...(out.get(r.shown) ?? []), turnOf(r)]);
    return out;
  }

  /** The turns tied to a message, its swipes, oldest first: through branch links too. */
  swipes(chat: string, message: string): TurnRow[] {
    return (this.tiedTo(chat, [message]).get(message) ?? []).filter((t) => t.status === "done" || t.status === "cut").sort((a, b) => a.created - b.created);
  }

  // ------------------------------------------------------------ the path

  /** The chat's path; empty for a chat the store does not hold, as an untouched chat's is. */
  path(chat: string): PathEntry[] {
    return pathOf(this.chatRead(chat).path);
  }

  /**
   * A chat's line of turns, oldest first (plan §6.3), each with the place on its path of the reply it stands at: the turns its path
   * entries hold, and before one of them any turn its node stands after that no entry holds. That is a turn a branch shares, where
   * the branch's own turn begun after it at the same reply (a continue of it) took its place in the entry: the shared turn stays on
   * the branch's line, just before that turn, as it stays in the chain its state is folded along. Every reader of a chat's line of
   * turns reads it here.
   */
  line(chat: string): LineTurn[] {
    const path = this.path(chat);
    const node = this.db.query<{ prev: string | null; turn: string }, [string, string]>("SELECT prev, turn FROM path_node WHERE user = ? AND key = ?");
    const out: LineTurn[] = [];
    let before: string | null = null;
    path.forEach((e, at) => {
      if (e.turn === null || e.node === null) return;
      // Back from the node the entry's turn stands after to the entry before it; a chain that does not meet it adds nothing.
      const between: string[] = [];
      let key = node.get(this.id, e.node)?.prev ?? null;
      while (key !== null && key !== before && between.length < path.length) {
        const row = node.get(this.id, key);
        if (row === null) break;
        between.push(row.turn);
        key = row.prev;
      }
      if (key === before) for (const turn of between.reverse()) out.push({ turn, at });
      out.push({ turn: e.turn, at });
      before = e.node;
    });
    return out;
  }

  /**
   * Compares the chat as shown with the turn tree, by ids and hashes only, and takes the shown path
   * as the chat's path (plan §6.3): messages gone leave it, the swipe showing on each reply is the
   * turn there, each message's hidden mark is the one shown, and turns after an earlier reply's
   * flipped swipe stand rebased, their changes applied again on the swipe now showing. The report
   * says what it found, with what no longer applies on the new path.
   *
   * What was heard of the chat since the last comparison goes only where this one takes it: a hidden
   * mark where the path shown gives Lumiverse's own mark for that message, an edit where the path
   * shows that text at that turn (the comparison records the edit, or finds it recorded), and both
   * where the path no longer shows the message. `heardUpTo` is the chat's heard count (`heardCount`)
   * read before the path shown was read: what was heard after it, which that path could not show, is
   * kept whole. Absent, the path was read now, after everything heard. `swipesOf` gives a message's swipes, each with its saved-text
   * hash and date, asked only for a reply whose date ties a turn's while its text differs: when that turn's saved text is still among
   * them, the reply is another swipe, not an edit (§6.3 l.617). Messages inserted before a played turn are reported with it.
   *
   * A comparison asked to `keep` (made between turns, when no turn of the chat is going on) keeps what it finds, a flip, a delete, an edit, an
   * inserted message, with the chat as well as returning it: the next comparison, at a turn's start, gives what was kept with what it finds
   * itself, once (R-130).
   */
  sync(chat: string, shown: readonly ShownMessage[], heardUpTo?: number, swipesOf?: (message: string) => readonly { hash: string; date?: number | null }[] | null, options: { keep?: boolean } = {}): PathReport {
    const row = this.chatOrThrow(chat);
    const before = pathOf(row.path);
    const was = new Map(before.map((e) => [e.message, e]));
    const date = (m: ShownMessage): number | null => m.date ?? null;
    // A reply shown as it was last time keeps its turn; any other is matched again.
    const again = new Set(
      shown
        .filter((m) => {
          const old = was.get(m.id);
          return !m.user && (!old || old.turn === null || old.hash !== m.hash || old.date !== date(m));
        })
        .map((m) => m.id),
    );
    const branchStopped: NonNullable<PathReport["branchStopped"]> = [];
    const tied = this.tiedTo(chat, [...again], branchStopped);
    const edited: PathReport["edited"] = [];
    // Turns whose edited flag changes: the hash the reply shows now, or null once it shows as saved again.
    const flags: [string, string | null][] = [];
    const after: PathEntry[] = [];
    for (const m of shown) {
      if (m.user) {
        after.push({ message: m.id, user: true, turn: null, node: null, own: null, hash: m.hash, date: date(m), hidden: m.hidden === true });
        continue;
      }
      let turn: string | null = was.get(m.id)?.turn ?? null;
      if (again.has(m.id)) {
        // A reply whose date ties a turn's with other text is an edit only when that turn's saved text is no longer among its swipes.
        const match = matchTurn(tied.get(m.id) ?? [], m, turn, swipesOf === undefined ? undefined : () => swipesOf(m.id));
        turn = match.turn?.id ?? null;
        if (match.turn && match.edited && match.turn.edited !== m.hash) {
          edited.push({ turn: match.turn.id, message: m.id, saved: match.turn.hash ?? "", now: m.hash, ...(typeof match.turn.text === "string" ? { text: match.turn.text } : {}) });
          flags.push([match.turn.id, m.hash]);
        } else if (match.turn && !match.edited && match.turn.edited !== null) flags.push([match.turn.id, null]);
      }
      after.push({ message: m.id, user: false, turn, node: null, own: null, hash: m.hash, date: date(m), hidden: m.hidden === true });
    }
    // Path nodes: the same as last time as long as the turns before them are; after that, the chain the path shows (`chainOf`). A turn
    // whose parent stands at the reply before it (one rebased after a flipped swipe) is chained as it stands.
    const oldTurns = before.filter((e) => e.turn !== null);
    const showing = after.filter((e) => e.turn !== null);
    const held = showing.map((e): ShowingTurn => ({ turn: e.turn as string, message: e.message }));
    let kept = 0;
    while (kept < held.length && oldTurns[kept]?.turn === held[kept]?.turn && oldTurns[kept]?.node != null) kept++;
    const depths = new Map(
      this.db
        .query<{ key: string; depth: number }, [string, string]>("SELECT n.key, n.depth FROM json_each(?2) j CROSS JOIN path_node n ON n.user = ?1 AND n.key = j.value")
        .all(this.id, JSON.stringify(oldTurns.slice(0, kept).map((e) => e.node)))
        .map((r) => [r.key, r.depth]),
    );
    let depth = 0;
    showing.slice(0, kept).forEach((e, i) => {
      const old = oldTurns[i] as PathEntry;
      e.node = old.node;
      e.own = old.own;
      depth = (depths.get(old.node as string) ?? depth) + 1;
    });
    const fresh = showing.slice(kept);
    const { keys, nodes } = chainOf(held.slice(kept), showing[kept - 1]?.node ?? null, depth, this.goesOn(chat, held, kept));
    fresh.forEach((e, i) => {
      e.node = keys[i] ?? null;
    });
    const ownNodes = new Map(
      this.db
        .query<{ id: string; node: string }, [string, string]>("SELECT t.id, t.node FROM json_each(?2) j CROSS JOIN turn t ON t.user = ?1 AND t.id = j.value")
        .all(this.id, JSON.stringify(fresh.map((e) => e.turn)))
        .map((r) => [r.id, r.node]),
    );
    for (const e of fresh) e.own = e.turn !== null && ownNodes.get(e.turn) === e.node;
    const head = showing.at(-1)?.node ?? null;
    const found = comparePaths(before, after);
    const branched = row.source_chat !== null && row.compared === null && after.length > 0 ? { from: row.source_chat, at: row.source_message } : null;
    // Messages new to the path standing before a turn it had: inserted before a played turn, each with the first such turn after it. A
    // chat's first comparison has no path of the player's messages to insert into (a migration ties only the replies), so it finds none.
    const inserted: NonNullable<PathReport["inserted"]> = [];
    const hadTurn = new Set(oldTurns.map((e) => e.turn));
    let next: string | null = null;
    for (let i = after.length - 1; row.compared !== null && i >= 0; i--) {
      const e = after[i] as PathEntry;
      if (!was.has(e.message)) {
        if (next !== null) inserted.unshift({ message: e.message, before: next });
      } else if (e.turn !== null && hadTurn.has(e.turn)) next = e.turn;
    }
    // What no longer applies is folded inside the write, so the snapshots that fold finds are stored with it.
    const report = this.write(false, () => {
      const flag = this.db.query("UPDATE turn SET edited = ? WHERE user = ? AND id = ?");
      for (const [turn, hash] of flags) flag.run(hash, this.id, turn);
      const put = this.db.query("INSERT OR IGNORE INTO path_node (user, key, prev, turn, depth) VALUES (?, ?, ?, ?, ?)");
      for (const [key, p, turn, d] of nodes) put.run(this.id, key, p, turn, d);
      this.db.run("UPDATE chat SET path = ?, head = ?, heard = ?, compared = COALESCE(compared, ?) WHERE user = ? AND id = ?", [
        JSON.stringify(after),
        head,
        JSON.stringify(this.untaken(row, shown, after, heardUpTo ?? row.heard_count)),
        after.length > 0 ? this.store.now() : null,
        this.id,
        chat,
      ]);
      const notApplied = found.rebased ? this.headState(chat).notApplied : [];
      const now: PathReport = { ...found, unplayed: this.withReasons(chat, found.unplayed, after), edited, branched, notApplied, ...(branchStopped.length > 0 ? { branchStopped } : {}), ...(inserted.length > 0 ? { inserted } : {}) };
      // What was kept between turns is told with this one's report, once; this one's own is kept where it was asked to be.
      const kept: KeptReport = row.kept === null ? {} : (JSON.parse(row.kept) as KeptReport);
      if (options.keep === true) {
        this.db.run("UPDATE chat SET kept = ? WHERE user = ? AND id = ?", [JSON.stringify(mergeKept(kept, keptOf(now))), this.id, chat]);
        return now;
      }
      if (row.kept === null) return now;
      this.db.run("UPDATE chat SET kept = NULL WHERE user = ? AND id = ?", [this.id, chat]);
      return toldWith(now, kept);
    });
    return report;
  }

  /**
   * Keeps why a reply stands with no turn played (`stopped`, `failed`, `restarted`), by its message, as a carrier gives it from what the
   * old engine recorded on the reply; null takes it off. A comparison lists it with the reply's unplayed stretch.
   */
  setReason(chat: string, message: string, why: StretchWhy | null): void {
    this.chatOrThrow(chat);
    this.write(false, () => {
      if (why === null) this.db.run("DELETE FROM reply_reason WHERE user = ? AND chat = ? AND message = ?", [this.id, chat, message]);
      else this.db.run("INSERT INTO reply_reason (user, chat, message, why) VALUES (?, ?, ?, ?) ON CONFLICT (user, chat, message) DO UPDATE SET why = excluded.why", [this.id, chat, message, why]);
    });
  }

  /** Each unplayed stretch with the reasons kept for the replies in it (`setReason`); none kept: the stretches as compared. */
  private withReasons(chat: string, stretches: PathReport["unplayed"], after: readonly PathEntry[]): PathReport["unplayed"] {
    if (stretches.length === 0) return stretches;
    const kept = new Map(this.db.query<{ message: string; why: string }, [string, string]>("SELECT message, why FROM reply_reason WHERE user = ? AND chat = ?").all(this.id, chat).map((r) => [r.message, r.why as StretchWhy]));
    if (kept.size === 0) return stretches;
    const replies = after.filter((e) => !e.user).map((e) => e.message);
    return stretches.map((s) => {
      const why = replies.slice(replies.indexOf(s.from), replies.indexOf(s.to) + 1).flatMap((message) => (kept.has(message) ? [{ message, why: kept.get(message) as StretchWhy }] : []));
      return why.length === 0 ? s : { ...s, why };
    });
  }

  /**
   * Lets the next comparison tell the edits this chat's turns carry as it tells any: the mark that a reply was edited (`TurnRow.edited`) is the
   * comparison's record that it told it, and the path keeps the hash each reply showed then; both go back to the text the turn was saved on,
   * so the next comparison finds the reply showing other text and tells it. An import's own comparisons are not the Author's. The turns
   * keep the text they were played on. How many replies it was done for.
   */
  forgetEdits(chat: string): number {
    const row = this.chatOrThrow(chat);
    const marked = new Map(
      this.db
        .query<{ id: string; hash: string | null }, [string, string]>("SELECT id, hash FROM turn WHERE user = ? AND chat = ? AND edited IS NOT NULL")
        .all(this.id, chat)
        .map((t) => [t.id, t.hash ?? ""]),
    );
    if (marked.size === 0) return 0;
    const path = pathOf(row.path).map((e) => (e.turn !== null && marked.has(e.turn) ? { ...e, hash: marked.get(e.turn) as string } : e));
    this.write(false, () => {
      this.db.run("UPDATE turn SET edited = NULL WHERE user = ? AND chat = ? AND edited IS NOT NULL", [this.id, chat]);
      this.db.run("UPDATE chat SET path = ? WHERE user = ? AND id = ?", [JSON.stringify(path), this.id, chat]);
    });
    return marked.size;
  }

  /** What was heard of a chat (`row`) that a comparison of `shown` (taken as `after`), read once `upto` was heard, does not take. */
  private untaken(row: ChatDb, shown: readonly ShownMessage[], after: readonly PathEntry[], upto: number): Heard {
    const heard = JSON.parse(row.heard) as Heard;
    const marks = new Map(shown.map((m) => [m.id, m.hidden]));
    const showing = new Map(after.map((e) => [e.message, e]));
    const out: Heard = {};
    for (const [message, entry] of Object.entries(heard)) {
      const at = entry.at ?? 0;
      const now = showing.get(message);
      // Heard after the path was read: that path could not show it.
      if (at > upto) out[message] = entry;
      else if (now !== undefined) {
        // A mark the path gives no mark for stays where it differs from the one the comparison takes: none, not hidden.
        const hidden = entry.hidden === true && marks.get(message) === undefined ? true : undefined;
        hear(out, message, hidden, Object.fromEntries(Object.entries(entry.edits ?? {}).filter(([turn, hash]) => !(now.turn === turn && now.hash === hash))), at);
      }
    }
    return out;
  }

  /**
   * How many marks and edits of the chat's messages RPE has heard (`markHidden`, `heardEdit`), ever; 0 for a chat the store does not
   * know. A caller reads it before it reads the chat's path, and hands it to the comparison of that path (`sync`), which then keeps
   * what was heard after it.
   */
  heardCount(chat: string): number {
    return this.chatDb(chat)?.heard_count ?? 0;
  }

  /**
   * A message hidden from the prompt, or shown again, as heard between comparisons (plan §4.2, R-21): kept with the chat by message
   * id, whether the message is on RPE's path yet or not, and laid on by the question's answer (`turnStart`), until a comparison takes
   * the marks the chat shows, which it does whether this was heard or not. A mark the last comparison took is no news: it leaves no
   * mark heard for the message. A chat the store does not know keeps nothing: its first comparison takes the marks. Whether the
   * chat is known. It changes no state.
   */
  markHidden(chat: string, message: string, hidden: boolean): boolean {
    return this.write(false, () => {
      const row = this.chatDb(chat);
      if (row === null) return false;
      const heard = JSON.parse(row.heard) as Heard;
      const count = row.heard_count + 1;
      // A mark the last comparison took (none taken: not hidden) is no news.
      const compared = this.store.comparedPath(this.id, chat, row.path).byMessage.get(message)?.hidden ?? false;
      hear(heard, message, hidden === compared ? undefined : hidden, heard[message]?.edits, count);
      this.db.run("UPDATE chat SET heard = ?, heard_count = ? WHERE user = ? AND id = ?", [JSON.stringify(heard), count, this.id, chat]);
      return true;
    });
  }

  /**
   * A reply edited between comparisons (plan §6.3): its showing swipe, found by the message and that swipe's `date` as a comparison
   * finds it (`matchTurn`), now has text whose hash is `hash`. Kept with the chat, apart from the turn's own edit mark, so the next
   * question knows the turn by its new text (`turnStart`), while the next comparison still records the edit on the turn and tells it,
   * and then lets it go (`sync`). A swipe no turn was played on, and a chat the store does not know, are left to the comparison; a
   * swipe that shows its saved text again takes back an edit heard for it. The turn the edit was kept for, or null. It changes no
   * state.
   */
  heardEdit(chat: string, message: string, date: number | null, hash: string): string | null {
    return this.write(false, () => {
      const row = this.chatDb(chat);
      if (row === null) return null;
      const last = this.store.comparedPath(this.id, chat, row.path).byMessage.get(message)?.turn ?? null;
      const match = matchTurn(this.tiedTo(chat, [message]).get(message) ?? [], { hash, date }, last);
      if (match.turn === null) return null;
      const heard = JSON.parse(row.heard) as Heard;
      const edits = { ...heard[message]?.edits };
      if (match.edited) edits[match.turn.id] = hash;
      else if (edits[match.turn.id] !== undefined) delete edits[match.turn.id];
      else return null;
      const count = row.heard_count + 1;
      hear(heard, message, heard[message]?.hidden, edits, count);
      this.db.run("UPDATE chat SET heard = ?, heard_count = ? WHERE user = ? AND id = ?", [JSON.stringify(heard), count, this.id, chat]);
      return match.edited ? match.turn.id : null;
    });
  }

  /** A message deleted, as heard (plan §4.2): what was heard of it goes with it. A chat the store does not know holds nothing. */
  heardDeleted(chat: string, message: string): void {
    this.write(false, () => {
      const row = this.chatDb(chat);
      if (row === null) return;
      const heard = JSON.parse(row.heard) as Heard;
      if (heard[message] === undefined) return;
      delete heard[message];
      this.db.run("UPDATE chat SET heard = ? WHERE user = ? AND id = ?", [JSON.stringify(heard), this.id, chat]);
    });
  }

  /**
   * The turns of a run showing along a path (`held` from `from` on) that stand after another turn at their own message: each whose
   * parent is not the turn showing before it, but is tied to the same message (a branch's own turn going on from a reply it shares,
   * plan §6.3, §10.10 "Branch"). By turn, that parent, for `chainOf`.
   */
  private goesOn(chat: string, held: readonly ShowingTurn[], from: number): Map<string, string> {
    const run = held.slice(from);
    const parents = new Map(
      this.db
        .query<{ id: string; parent: string | null }, [string, string]>("SELECT t.id, t.parent FROM json_each(?2) j CROSS JOIN turn t ON t.user = ?1 AND t.id = j.value")
        .all(this.id, JSON.stringify(run.map((h) => h.turn)))
        .map((r) => [r.id, r.parent]),
    );
    const asked = run.flatMap((h, i) => {
      const parent = parents.get(h.turn) ?? null;
      return parent !== null && parent !== (held[from + i - 1]?.turn ?? null) ? [{ ...h, parent }] : [];
    });
    if (asked.length === 0) return new Map();
    const atMessage = this.tiedTo(chat, asked.map((a) => a.message));
    return new Map(asked.flatMap((a) => ((atMessage.get(a.message) ?? []).some((t) => t.id === a.parent) ? [[a.turn, a.parent] as const] : [])));
  }

  // ------------------------------------------------------------ changes

  /** A turn's changes, in order. */
  changes(turn: string): ChangeRow[] {
    return this.db.query<ChangeDb, [string, string]>("SELECT * FROM change WHERE user = ? AND turn = ? ORDER BY ord").all(this.id, turn).map(changeOf);
  }

  /**
   * The changes `turns` recorded themselves (not their jobs'), in one read, each turn's in order; with `naming`, only those whose value
   * names one of those words (as its JSON text has it), so a reader after the few changes that can concern something reads no others.
   */
  ownChanges(turns: readonly string[], naming: readonly string[] | null = null): Map<string, ChangeRow[]> {
    const words = naming?.map((w) => JSON.stringify(w).slice(1, -1));
    const out = new Map<string, ChangeRow[]>();
    if (turns.length === 0 || words?.length === 0) return out;
    const rows = this.db
      .query<ChangeDb, [string, string, string]>(
        `SELECT c.* FROM change c WHERE c.user = ?1 AND c.turn IN (SELECT value FROM json_each(?2)) AND c.job IS NULL
           AND (?3 = 'null' OR EXISTS (SELECT 1 FROM json_each(?3) w WHERE instr(c.value, w.value) > 0)) ORDER BY c.turn, c.ord`,
      )
      .all(this.id, JSON.stringify(turns), JSON.stringify(words ?? null));
    for (const row of rows) {
      const c = changeOf(row);
      const list = out.get(row.turn);
      if (list === undefined) out.set(row.turn, [c]);
      else list.push(c);
    }
    return out;
  }

  /**
   * Whether anything may stand placed before a turn of `chat` (`changesBefore`): a change of his own on the chat's line, or any ended
   * job's change of this user's. Where neither is, every turn has nothing placed before it, and a reader of many turns asks none of them.
   */
  anyPlaced(chat: string): boolean {
    if (this.ownerIn(chat)) return true;
    return this.db.query<{ any: number }, [string]>("SELECT EXISTS(SELECT 1 FROM change c JOIN job e ON e.user = c.user AND e.id = c.job AND e.ended IS NOT NULL WHERE c.user = ?1 AND c.job IS NOT NULL) AS any").get(this.id)?.any === 1;
  }

  /**
   * Of `turns`, given oldest first, the newest that recorded an applied change of `lane` on itself, in one read; null when none did.
   * Only a turn's own changes count (a job's writes recorded on the turn among them); his own changes, of no turn, never do.
   */
  newestWith(turns: readonly string[], lane: Lane): string | null {
    return (
      this.db
        .query<{ turn: string }, [string, string, string]>(
          "SELECT j.value AS turn FROM json_each(?2) j WHERE EXISTS (SELECT 1 FROM change c WHERE c.user = ?1 AND c.turn = j.value AND c.lane = ?3 AND c.applied = 1) ORDER BY j.key DESC LIMIT 1",
        )
        .get(this.id, JSON.stringify(turns), lane)?.turn ?? null
    );
  }

  /**
   * Records changes on a turn, in order, each applied by its handler on the state inside the turn.
   * Nothing is refused for what it says: a change that does not apply is recorded with its report
   * and stays unapplied. Grouped events are one unit only within one call. A turn takes changes
   * while open, and after it is tied too (a job's, a correction's). The state returned is the
   * store's own, held for the next call: read it, never change it. A job's changes are recorded with
   * the turn that started it and take effect once the job has ended (`endJob`), before the next turn
   * to begin; until then only the job sees them: each is checked on the job's own state (`stateFor`),
   * and the state returned for them is that one. `refused` names inputs (by place in `inputs`) that are known not to stand, each with the
   * report that says why: they are recorded unapplied, with it, and the rest are applied as if they were not there.
   */
  addChanges(turnId: string, inputs: readonly ChangeInput[], refused?: ReadonlyMap<number, Report>): { changes: ChangeRow[]; state: StoreState } {
    const turn = this.turnToWrite(turnId);
    if (turn.status === "dropped") throw new StoreInputError(`turn ${turnId} was dropped`);
    inputs.forEach((c, i) => checkChange(c, i, this.store.env.areas));
    const jobs = [...new Set(inputs.flatMap((c) => (c.job ? [c.job] : [])))];
    const ended = jobs.find((j) => this.db.query<{ id: string }, [string, string]>("SELECT id FROM job WHERE user = ? AND id = ? AND ended IS NOT NULL").get(this.id, j) !== null);
    if (ended !== undefined) throw new StoreInputError(`job ${ended} has ended: it records nothing more`);
    const inside = this.foldNode(turn.node);
    const own = jobs.length === 1 && inputs.every((c) => c.job === jobs[0]) ? (jobs[0] ?? null) : null;
    // A draft over the state inside the turn: what the changes write is copied, the rest stays the held state's.
    const state = draft((own === null ? inside.folded : this.stateFor(turnId, own)).state);
    const existing = this.changes(turnId);
    // Groups that did not land earlier in the turn: a unit tied to one does not land either.
    const fell = new Set(existing.filter((c) => !c.applied).flatMap((c) => (isRecord(c.value) && typeof c.value.group === "string" ? [c.value.group] : [])));
    // The engine's handlers put a change's own objects into the state, which is then held frozen: they apply the store's copy, so the
    // caller's values stay the caller's.
    const stand = inputs.flatMap((_, i) => (refused?.has(i) === true ? [] : [i]));
    const items: Item[] = stand.map((i) => {
      const c = inputs[i] as ChangeInput;
      return { op: c.op, value: structuredClone(c.value), turn: turnId, n: turn.depth + 1, by: c.by ?? null, cite: c.cite ?? null, precision: c.precision ?? null, standing: c.standing ?? null, source: c.source ?? null };
    });
    const done = applyChecked(this.store.envOf(this.id), state, items, fell);
    const landed = new Map(stand.map((i, k) => [i, done[k]] as const));
    const outcomes: Outcome[] = inputs.map((_, i) => (refused?.has(i) === true ? { applied: false, reports: [refused.get(i) as Report] } : (landed.get(i) ?? { applied: false, reports: [] })));
    const now = this.store.now();
    let ord = (existing.at(-1)?.ord ?? -1) + 1;
    const through = this.throughTurn(turn);
    const ids = this.write(through, () => {
      const put = this.db.query("INSERT INTO change (user, turn, ord, lane, op, value, by, handle, standing, precision, source, cite, job, applied, reports, told, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const made = inputs.map((c, i) => {
        const o = outcomes[i] ?? { applied: false, reports: [] };
        const cite = c.cite === undefined || c.cite === null ? null : JSON.stringify(c.cite);
        return Number(put.run(this.id, turnId, ord++, c.lane, c.op, JSON.stringify(c.value), c.by ?? null, c.handle ?? null, c.standing ?? null, c.precision ?? null, c.source ?? null, cite, c.job ?? null, o.applied ? 1 : 0, o.reports.length > 0 ? JSON.stringify(o.reports) : null, toldOf(c), now).lastInsertRowid);
      });
      this.dropSnapshotsThrough(turnId);
      return made;
    });
    // The state inside the turn now, held under the mark the write left: it stands only if the write does. A job's changes are not the turn's.
    if (jobs.length === 0) this.store.keep(this.cacheKey(turn.node), { ...inside.folded, state }, Math.max(inside.upto, ...ids), this.id, turn.chat, this.store.markOf(this.id, turn.chat));
    const rows = this.db.query<ChangeDb, [string, string]>("SELECT * FROM change WHERE user = ?1 AND id IN (SELECT value FROM json_each(?2)) ORDER BY ord").all(this.id, JSON.stringify(ids)).map(changeOf);
    return { changes: rows, state };
  }

  /**
   * Adds changes to a turn that later turns have followed (R-54): on his word, as his answer to a carried keep-or-discard question lands the
   * held turns' changes, each on its own turn, never after the newest reply, where an old value would overwrite what a later turn set. They are
   * rows of that turn like any other; the snapshots from it on are dropped and the later turns' changes are applied again on top of them, in
   * order. What a later turn wrote stands over an added change that writes it: that change is recorded unapplied with `later_value`, naming that
   * turn's number. What of the later turns no longer applies is listed by thing and value (`NotApplied`), and the stretch from the turn to the
   * head is reported as a swipe flipped on an earlier message is; both are kept with each chat whose path runs through the turn, for that chat's
   * next turn's start to tell once (`sync`), and returned here, per chat, for the caller's own answer.
   */
  addEarlier(turnId: string, inputs: readonly ChangeInput[]): { changes: ChangeRow[]; landed: EarlierLanded[] } {
    const turn = this.turnToWrite(turnId);
    const stretches = new Map<string, PathEntry[]>();
    for (const chat of this.throughTurn(turn)) {
      const path = pathOf(this.chatOrThrow(chat).path);
      const at = path.findIndex((e) => e.turn === turnId);
      const after = at < 0 ? [] : path.slice(at + 1).filter((e) => e.turn !== null);
      if (after.length > 0) stretches.set(chat, after);
    }
    const heads = new Map([...stretches.keys()].map((chat) => [chat, this.headState(chat)] as const));
    const had = new Map([...heads].map(([chat, head]) => [chat, new Set(head.notApplied.map((n) => n.change))] as const));
    // A part a later turn wrote stands over a change that writes it, and so does the rest of the change's unit.
    const env = this.store.envOf(this.id);
    const unit = (c: ChangeInput, i: number): string => (isRecord(c.value) && typeof c.value.group === "string" ? `g:${c.value.group}` : `c:${i}`);
    const later = new Map<string, number | Report>();
    inputs.forEach((c, i) => {
      for (const head of heads.values()) {
        const at = laterWrite(env, head.state, { id: i, op: c.op, lane: c.lane, value: c.value, by: c.by ?? null, applied: true, turn: turnId, from: turn.depth + 1 });
        const prior = later.get(unit(c, i));
        if (at !== null && (typeof prior !== "number" || (typeof at === "number" && at > prior))) later.set(unit(c, i), at);
      }
    });
    const refused = new Map<number, Report>();
    inputs.forEach((c, i) => {
      const at = later.get(unit(c, i));
      if (at !== undefined) refused.set(i, typeof at === "number" ? { code: "later_value", values: { turn: at } } : at);
    });
    // The write drops every state held from the turn on, in each chat through it; those held for the turns before it change in nothing
    // and stay held (PlanStore-S2 item 3), under the marks the write leaves.
    const prev = this.db.query<{ prev: string | null }, [string, string]>("SELECT prev FROM path_node WHERE user = ? AND key = ?").get(this.id, turn.node)?.prev ?? null;
    const kept = (prev === null ? [] : this.chainRows(prev)).flatMap((r) => {
      const held = this.store.cached(this.cacheKey(r.key), this.store.markOf(this.id, r.chat));
      return held === null ? [] : [{ key: r.key, chat: r.chat, held }];
    });
    const added = this.addChanges(turnId, inputs, refused);
    for (const k of kept) this.store.keep(this.cacheKey(k.key), k.held.folded, k.held.upto, this.id, k.chat, this.store.markOf(this.id, k.chat));
    const landed: EarlierLanded[] = [];
    for (const [chat, after] of stretches) {
      const notApplied = this.headState(chat).notApplied.filter((n) => !(had.get(chat)?.has(n.change) ?? false));
      const rebased = { from: (after[0] as PathEntry).message, to: (after.at(-1) as PathEntry).message, turns: after.map((e) => e.turn as string) };
      const kept = this.chatDb(chat)?.kept;
      this.write(false, () => this.db.run("UPDATE chat SET kept = ? WHERE user = ? AND id = ?", [JSON.stringify(mergeKept(kept === null || kept === undefined ? {} : (JSON.parse(kept) as KeptReport), { rebased, notApplied })), this.id, chat]));
      landed.push({ chat, rebased, notApplied });
    }
    return { changes: added.changes, landed };
  }

  /**
   * Where a write goes (R-73): a turn's call to its turn; an agent's job to its starting turn, with the job; his own edit, what is done
   * on his word outside a turn, or a job he started, to his own changes, kept with the chat. No call is refused for belonging to no turn.
   */
  writeTarget(at: { chat: string; turn?: string | null; job?: string | null }): WriteTarget {
    const job = at.job ?? undefined;
    if (at.turn !== undefined && at.turn !== null && at.turn !== "") return job === undefined ? { kind: "turn", turn: at.turn } : { kind: "turn", turn: at.turn, job };
    return job === undefined ? { kind: "owner", chat: at.chat } : { kind: "owner", chat: at.chat, job };
  }

  /** Records changes where `target` says (`writeTarget`): on a turn as `addChanges` records them, or as his own (`addOwnerChanges`). */
  record(target: WriteTarget, inputs: readonly ChangeInput[]): { changes: ChangeRow[]; state: StoreState } {
    if (target.kind === "turn") return this.addChanges(target.turn, target.job === undefined ? inputs : inputs.map((c) => ({ ...c, job: target.job })));
    return this.addOwnerChanges(target.chat, inputs, target.job ?? null);
  }

  /**
   * His own changes (plan §6.3 l.632, §10.10, R-22, R-29): of no turn, kept with the chat and the moment they are made, applied at once
   * and never refused for what they say. Each takes effect just before the first turn of the chat's own path to begin after it, so the
   * chat's head shows it now and no turn begun already has its state changed; in a branch that has played no turn of its own, it is the
   * branch's. A job of his (`job`) records into them too: its own reads see its writes, nobody else's do until it ends (`endJob`), and
   * then they take effect as his edits do, from that moment. Each change is checked on the head (a job's, on the job's own state) as
   * a turn's is; the state returned is that one.
   */
  addOwnerChanges(chat: string, inputs: readonly ChangeInput[], job: string | null = null): { changes: ChangeRow[]; state: StoreState } {
    const row = this.chatOrThrow(chat);
    inputs.forEach((c, i) => checkChange(c, i, this.store.env.areas));
    if (job !== null && this.db.query<{ id: string }, [string, string]>("SELECT id FROM job WHERE user = ? AND id = ? AND ended IS NOT NULL").get(this.id, job) !== null) {
      throw new StoreInputError(`job ${job} has ended: it records nothing more`);
    }
    const base = this.headState(chat);
    const n = row.head === null ? 1 : (this.db.query<{ depth: number }, [string, string]>("SELECT depth FROM path_node WHERE user = ? AND key = ?").get(this.id, row.head)?.depth ?? -1) + 2;
    const env = this.store.envOf(this.id);
    const state = draft(base.state);
    if (job !== null) {
      const mine = this.db.query<ChangeDb, [string, string, string]>("SELECT * FROM change WHERE user = ? AND chat = ? AND job = ? AND applied = 1 ORDER BY ord").all(this.id, chat, job).map(changeOf);
      applyChecked(env, state, mine.map((c): Item => ({ op: c.op, value: c.value, turn: "", n, by: c.by, cite: c.cite, change: c.id, precision: c.precision, standing: c.standing, source: c.source })), new Set());
    }
    const items: Item[] = inputs.map((c) => ({ op: c.op, value: structuredClone(c.value), turn: "", n, by: c.by ?? null, cite: c.cite ?? null, precision: c.precision ?? null, standing: c.standing ?? null, source: c.source ?? null }));
    const outcomes = applyChecked(env, state, items, new Set());
    const now = this.store.now();
    const ids = this.write([chat], () => {
      let ord = (this.db.query<{ ord: number | null }, [string, string]>("SELECT max(ord) AS ord FROM change WHERE user = ? AND chat = ?").get(this.id, chat)?.ord ?? -1) + 1;
      const put = this.db.query("INSERT INTO change (user, turn, chat, ord, lane, op, value, by, handle, standing, precision, source, cite, job, applied, reports, told, created) VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      return inputs.map((c, i) => {
        const o = outcomes[i] ?? { applied: false, reports: [] };
        const cite = c.cite === undefined || c.cite === null ? null : JSON.stringify(c.cite);
        return Number(put.run(this.id, chat, ord++, c.lane, c.op, JSON.stringify(c.value), c.by ?? null, c.handle ?? null, c.standing ?? null, c.precision ?? null, c.source ?? null, cite, job, o.applied ? 1 : 0, o.reports.length > 0 ? JSON.stringify(o.reports) : null, toldOf(c), now).lastInsertRowid);
      });
    });
    const rows = this.db.query<ChangeDb, [string, string]>("SELECT * FROM change WHERE user = ?1 AND id IN (SELECT value FROM json_each(?2)) ORDER BY ord").all(this.id, JSON.stringify(ids)).map(changeOf);
    return { changes: rows, state };
  }

  /**
   * Lets go of a chat's stored snapshots, on every path through its turns and after them: each is made again by the fold when next
   * due, and no answer changes. States held in memory stay as they are.
   */
  dropSnapshots(chat: string): number {
    this.chatOrThrow(chat);
    return this.write(false, () =>
      this.db.run(
        `WITH RECURSIVE down(key) AS (
           SELECT key FROM path_node WHERE user = ?1 AND turn IN (SELECT id FROM turn WHERE user = ?1 AND chat = ?2)
           UNION SELECT n.key FROM path_node n JOIN down d ON n.user = ?1 AND n.prev = d.key)
         DELETE FROM snapshot WHERE user = ?1 AND kind = 'cache' AND node IN (SELECT key FROM down)`,
        [this.id, chat],
      ).changes,
    );
  }

  /** Takes back an open turn's staged changes, all or one run's (`handle`: the lead dropping a sub-agent's writes). How many went. */
  dropStaged(turnId: string, handle?: string): number {
    const turn = this.turnToWrite(turnId);
    if (turn.status !== "open") throw new StoreInputError(`turn ${turnId} is ${turn.status}: only an open turn's staged changes can be taken back`);
    return this.write(this.throughTurn(turn), () => {
      const r = handle === undefined ? this.db.run("DELETE FROM change WHERE user = ? AND turn = ?", [this.id, turnId]) : this.db.run("DELETE FROM change WHERE user = ? AND turn = ? AND handle = ?", [this.id, turnId, handle]);
      this.dropSnapshotsThrough(turnId);
      return r.changes;
    });
  }

  /**
   * Takes back what a turn recorded after its change numbered `after` (its `ord`; -1 for all of it), tied or not: what a continue
   * recorded when it saved nothing new (plan §6.3, §10.10). A job's changes are the job's, recorded with the turn that started it
   * (plan §10.9), and stay. How many went.
   */
  takeBack(turnId: string, after: number): number {
    const turn = this.turnToWrite(turnId);
    if (turn.status === "dropped") throw new StoreInputError(`turn ${turnId} was dropped`);
    return this.write(this.throughTurn(turn), () => {
      const r = this.db.run("DELETE FROM change WHERE user = ? AND turn = ? AND ord > ? AND job IS NULL", [this.id, turnId, after]);
      this.dropSnapshotsThrough(turnId);
      return r.changes;
    });
  }

  /**
   * A continue's held turn joins the turn it extended (plan §10.10, "Continue: the same turn, extended"; R-192 (e), (f), R-203): when
   * the generation's end names a message `into` is tied to, what the continue's run held on its own open turn lands on `into` as if
   * it had been made there, in that order. Its own changes come after `into`'s own, in the order they were made, and a job's keep their
   * job, a job being recorded with the turn that started it, which is now `into` (§10.9). Each is checked again where it lands by the
   * store's ordinary check, as a write on `into` checks it: the held turn's own on the state inside `into` after `into`'s own changes, a
   * job's on the job's own state there (`stateFor`), with the groups that fell earlier in the turn. Its outcome, whether it applies
   * and its reports, is recorded: a change that no longer applies is recorded as not applied, with its reports, and one that now
   * applies as applied (§6.1: code reports what does not add up and never decides). The join is never refused for this. Everything
   * the store keeps by the held turn moves in the same write: a session it opened or closed names `into`; its stored states go. The
   * held turn is kept, with its own row and path node, marked as joined, never dropped: a job it started may still be running with
   * it in its scope, and `joinedTo` names where that job writes. What may be joined is checked first (`joinable`), as the cast's and
   * the story's joins check it. The store relies on its caller joining before anything else of the chat begins (a missed end is
   * joined at the next intake before the next turn is begun): a job of the continue that ended before then would otherwise be
   * placed before a turn begun already. The changes it moved, in order, as they now stand on `into`: each with whether it applies
   * there and its reports.
   */
  joinTurn(held: string, into: string): ChangeRow[] {
    const { to } = joinable(this.db, this.id, held, into);
    const moved = this.changes(held);
    const own = this.changes(into);
    const outcomes = this.landing(to, own, moved);
    const next = (own.at(-1)?.ord ?? -1) + 1;
    this.write(this.throughTurn(to), () => {
      const put = this.db.query("UPDATE change SET turn = ?, ord = ?, applied = ?, reports = ? WHERE user = ? AND id = ?");
      moved.forEach((c, i) => {
        const o = outcomes[i] ?? { applied: false, reports: [] };
        put.run(into, next + i, o.applied ? 1 : 0, o.reports.length > 0 ? JSON.stringify(o.reports) : null, this.id, c.id);
      });
      this.db.run("UPDATE session SET opened_by = ? WHERE user = ? AND opened_by = ?", [into, this.id, held]);
      this.db.run("UPDATE session SET closed_by = ? WHERE user = ? AND closed_by = ?", [into, this.id, held]);
      this.db.run("DELETE FROM snapshot WHERE user = ?1 AND node IN (SELECT key FROM path_node WHERE user = ?1 AND turn = ?2)", [this.id, held]);
      this.db.run("UPDATE turn SET status = 'joined', joined = ? WHERE user = ? AND id = ?", [into, this.id, held]);
      this.dropSnapshotsThrough(into);
    });
    const ids = new Set(moved.map((c) => c.id));
    return this.changes(into).filter((c) => ids.has(c.id));
  }

  /**
   * What each of `moved` comes to where it lands on `into`, after `own`, `into`'s rows: checked in order as `addChanges` checks a
   * write there. A run of the turn's own on the state inside `into` so far; a run of a job's on that job's state there, the turn's
   * state with the job's rows that apply on top (`stateFor`). The groups that fell earlier in the turn fall with them.
   */
  private landing(into: TurnRow, own: readonly ChangeRow[], moved: readonly ChangeRow[]): Outcome[] {
    const state = draft(this.foldNode(into.node).folded.state);
    const fell = new Set(own.filter((c) => !c.applied).flatMap((c) => (isRecord(c.value) && typeof c.value.group === "string" ? [c.value.group] : [])));
    const item = (c: ChangeRow): Item => ({ op: c.op, value: structuredClone(c.value), turn: into.id, n: into.depth + 1, by: c.by, cite: c.cite, change: c.id, precision: c.precision, standing: c.standing, source: c.source });
    const env = this.store.envOf(this.id);
    const out: Outcome[] = [];
    for (let i = 0; i < moved.length; ) {
      const job = moved[i]?.job ?? null;
      let end = i + 1;
      while (end < moved.length && (moved[end]?.job ?? null) === job) end++;
      const run = moved.slice(i, end).map(item);
      if (job === null) out.push(...applyChecked(env, state, run, fell));
      else {
        const mine = draft(state);
        const before = [...own.filter((c) => c.job === job && c.applied), ...moved.slice(0, i).filter((c, k) => c.job === job && out[k]?.applied === true)];
        applyChecked(env, mine, before.map(item), new Set());
        out.push(...applyChecked(env, mine, run, fell));
      }
      i = end;
    }
    return out;
  }

  /** The turn a joined turn joined (`joinTurn`); null for a turn that joined none. The one place that resolves a joined turn asks it. */
  joinedTo(turn: string): string | null {
    return this.turnOrThrow(turn).joined;
  }

  /** Cached snapshots on every path through the turn, and after it, no longer hold. */
  private dropSnapshotsThrough(turn: string): void {
    this.db.run(
      `WITH RECURSIVE down(key) AS (
         SELECT key FROM path_node WHERE user = ?1 AND turn = ?2
         UNION SELECT n.key FROM path_node n JOIN down d ON n.user = ?1 AND n.prev = d.key)
       DELETE FROM snapshot WHERE user = ?1 AND kind = 'cache' AND node IN (SELECT key FROM down)`,
      [this.id, turn],
    );
  }

  // ------------------------------------------------------------ state

  /**
   * State at a turn, along the path it was made on; inside an open turn, with its staged changes. A turn joined to another holds no
   * changes of its own any more: reading it is refused, naming the turn it joined.
   */
  stateAt(turnId: string): Folded {
    return this.foldNode(this.turnToWrite(turnId).node).folded;
  }

  /**
   * What names the state at a turn as it is folded now (`stateAt`): the node it was made on and the fold mark of the chat it was played
   * in, the key the store's own held states go by. Another key once anything that fold reads changes; a reader that keeps something
   * worked out from that state keeps it under this key, and holds no state for it. A joined turn is refused, as every reading of one is.
   */
  foldKey(turnId: string): string {
    const t = this.turnToWrite(turnId);
    return `${this.id}\u0000${t.node}\u0000${this.store.markOf(this.id, t.chat)}`;
  }

  /**
   * State as one reading sees it at a turn (plan §10.9): a job's (`job`) has the job's own changes so
   * far on top of the turn's state (`stateAt`), in the order it recorded them, each that applied when
   * recorded checked again there; nobody else sees them until the job ends on the path (`jobsPlaced`).
   * With no job, the turn's state.
   */
  stateFor(turnId: string, job: string | null): Folded {
    const at = this.stateAt(turnId);
    if (job === null) return at;
    const turn = this.turnOrThrow(turnId);
    const own = this.db.query<ChangeDb, [string, string, string]>("SELECT * FROM change WHERE user = ? AND turn = ? AND job = ? AND applied = 1 ORDER BY ord").all(this.id, turnId, job).map(changeOf);
    if (own.length === 0) return at;
    const state = draft(at.state);
    applyChecked(this.store.envOf(this.id), state, own.map((c): Item => ({ op: c.op, value: c.value, turn: turnId, n: turn.depth + 1, by: c.by, cite: c.cite, change: c.id, precision: c.precision, standing: c.standing, source: c.source })), new Set());
    return { ...at, state };
  }

  /**
   * The state a turn started from, along the path it was made on: before any change of its own. What
   * a briefing at its start was shown, whatever the turn recorded since. A joined turn is refused, as
   * every reading of one is, naming the turn it joined.
   */
  startOf(turnId: string): Folded {
    const t = this.turnToWrite(turnId);
    const prev = this.db.query<{ prev: string | null }, [string, string]>("SELECT prev FROM path_node WHERE user = ? AND key = ?").get(this.id, t.node)?.prev ?? null;
    const before = prev === null ? this.initial(this.chatOrThrow(t.chat).revision) : this.foldNode(prev).folded;
    // What was placed just before it (jobs' changes, his own) is where it started.
    const { jobs, owner } = this.placedBefore(t);
    if (jobs.length === 0 && owner.length === 0) return before;
    const state = draft(before.state);
    const done = foldSteps(this.store.envOf(this.id), { state, upto: 0 }, [{ node: t.node, turn: t.id, n: t.depth + 1, own: true, changes: [], jobs, owner }]);
    return { ...before, state, notApplied: [...before.notApplied, ...done.notApplied] };
  }

  /**
   * Where a turn not yet begun will start, on the path the question of where it starts carries (plan §4.2, §9.6 l.1121-1122, R-5):
   * the state at the point, folded along the chain of turns that path shows as the turn's own comparison will fold it (`sync`): the
   * turn of a message the path no longer has is off the chain, and after a reply deleted or a swipe flipped before the point the
   * later turns stand rebased, their changes applied again. A reply edited since the last comparison is known by the edit heard for
   * it (`heardEdit`). With it, that path up to the point, each message with the hidden mark the store holds for it (heard since the
   * last comparison, else as that comparison took it), and where the answer stands. A path none of whose messages the tree ties to a
   * turn, and a chat the store does not know, are answered at the world's start, and the answer says so. The point and the chain come
   * from the path alone; what the last comparison found is reused where the path still shows it, as the comparison reuses it: a reply
   * shown as it was then (its id and text) keeps the turn it was tied to then, and the turns standing as they stood keep their stored
   * nodes, whose keys name the same turns. It reads RPE's own store only (the state held in memory, else folded from the nearest
   * snapshot), asks neither the chat application nor a model, and writes nothing. The state is held under the keys a comparison of
   * that path will store, so the turn that follows starts from it; it may be the held state itself: read it, never change it.
   */
  turnStart(chat: string, path: readonly SeenMessage[], point: TurnPoint): TurnStart {
    const row = this.chatDb(chat);
    const heard: Heard = row === null ? {} : (JSON.parse(row.heard) as Heard);
    const compared = row === null ? null : this.store.comparedPath(this.id, chat, row.path);
    const was = (m: SeenMessage): PathEntry | undefined => compared?.byMessage.get(m.id);
    const asThen = (m: SeenMessage): string | null => {
      const then = was(m);
      return !m.user && then !== undefined && then.turn !== null && then.hash === m.hash ? then.turn : null;
    };
    // Any other reply's turn is known by its saved text, by the edit the last comparison recorded on it, or by an edit heard since.
    const changed = path.flatMap((m) => (m.user || asThen(m) !== null ? [] : [m.id]));
    const tied = new Map(
      [...(changed.length === 0 ? [] : this.tiedTo(chat, changed))].map(([message, turns]) => [
        message,
        turns.flatMap((t) => {
          const edit = heard[message]?.edits?.[t.id];
          return edit === undefined ? [t] : [t, { ...t, edited: edit }];
        }),
      ]),
    );
    const shown = turnsShown(path, point, (m) => asThen(m) ?? turnByHash(tied.get(m.id) ?? [], m.hash)?.id ?? null);
    // A mark heard since the last comparison is newer than the one it took.
    const messages = shown.map(({ message, turn }) => ({ ...message, hidden: heard[message.id]?.hidden ?? was(message)?.hidden ?? false, turn }));
    const held = shown.flatMap(({ message, turn }): ShowingTurn[] => (turn === null ? [] : [{ turn, message: message.id }]));
    // The stored nodes of the turns as they stood, as long as the turns before them are the same; from there, the chain the path shows.
    const stood = compared?.entries.filter((e) => e.turn !== null) ?? [];
    let same = 0;
    while (same < held.length && stood[same]?.turn === held[same]?.turn && stood[same]?.node != null) same++;
    const prev = stood[same - 1]?.node ?? null;
    const depth = prev === null ? 0 : (this.db.query<{ depth: number }, [string, string]>("SELECT depth FROM path_node WHERE user = ? AND key = ?").get(this.id, prev)?.depth ?? -1) + 1;
    const fresh = chainOf(held.slice(same), prev, depth, this.goesOn(chat, held, same));
    const end = fresh.nodes.at(-1)?.[0] ?? prev;
    const last = held.at(-1);
    const at = last === undefined ? null : { message: last.message, turn: last.turn };
    // Every node stored: the state there, as any stored node's. Else the chain from the start, needed only when nothing is held for it.
    const endTurn = fresh.nodes.at(-1)?.[2] ?? "";
    const folded = end === null ? this.withOwner(chat, null, row?.revision ?? null, true) : fresh.nodes.length === 0 ? this.withOwner(chat, end, row?.revision ?? null, true) : this.foldPath(end, endTurn, () => chainOf(held, null, 0, this.goesOn(chat, held, 0)).nodes);
    return { ...folded, messages, at, known: row !== null };
  }

  /**
   * State at the end of the chat's path: rebased turns' changes applied again where they now stand, and his own changes no turn of
   * the path began after, at once (plan §6.3 l.632, R-22). For a chat the store does not hold, an untouched chat's: the start of no world.
   */
  headState(chat: string): Folded {
    const row = this.chatRead(chat);
    return this.withOwner(chat, row.head === null ? null : row.head, row.revision);
  }

  /**
   * The state at `node` (null: the chat's start) with his own changes of `chat` that stand after it on the chat's path, and, when
   * `jobs`, the ended jobs' changes no turn there began after (what the next turn will start with, plan §10.9). Held for the chat.
   */
  private withOwner(chat: string, node: string | null, revision: string | null, jobs = false): Folded {
    const base = node === null ? this.initial(revision) : this.foldNode(node).folded;
    // A chat none of whose line holds a change of his, and with no job ended since its node's turn began, is its node's state.
    const owner = this.ownerIn(chat);
    const due = jobs && node !== null && this.jobEndedSince(node);
    if (!owner && !due) return base;
    const mark = this.store.markOf(this.id, chat);
    const key = `${this.cacheKey(node ?? "~")}\u0000@${chat}${jobs ? "+jobs" : ""}`;
    const hit = this.store.cached(key, mark);
    if (hit) return hit.folded;
    const path = node === null ? [] : this.chainRows(node);
    const after = owner ? this.placeOwner(path, false, chat).after : [];
    const pending = due ? this.jobsPending(path) : [];
    if (after.length === 0 && pending.length === 0) {
      this.store.keep(key, base, 0, this.id, chat, mark);
      return base;
    }
    const state = draft(base.state);
    const n = (path.at(-1)?.depth ?? -1) + 2;
    const notApplied = [...base.notApplied];
    if (pending.length > 0) {
      const env = this.store.envOf(this.id);
      foldSteps(env, { state, upto: 0 }, [{ node: node ?? "", turn: "", n, own: true, changes: [], jobs: pending }], (_s, _st, _u, missed) => notApplied.push(...missed));
    }
    notApplied.push(...applyOwner(this.store.envOf(this.id), state, after, n));
    const folded: Folded = { ...base, state, notApplied };
    this.store.keep(key, folded, 0, this.id, chat, mark);
    return folded;
  }

  /** Whether a job has ended since the turn of `node` began: none has, and no job's change is pending after it (`jobsPending`). */
  private jobEndedSince(node: string): boolean {
    return (
      this.db
        .query<{ any: number }, [string, string]>(
          "SELECT EXISTS(SELECT 1 FROM job e WHERE e.user = ?1 AND e.ended >= (SELECT t.created FROM path_node n JOIN turn t ON t.user = n.user AND t.id = n.turn WHERE n.user = ?1 AND n.key = ?2)) AS any",
        )
        .get(this.id, node)?.any === 1
    );
  }

  /** Whether the chat, or a chat it was branched from, holds a change of his own. */
  private ownerIn(chat: string): boolean {
    return (
      this.db
        .query<{ any: number }, [string, string]>(
          `WITH RECURSIVE up(chat) AS (SELECT ?2 UNION SELECT c.source_chat FROM chat c JOIN up ON c.user = ?1 AND c.id = up.chat WHERE c.source_chat IS NOT NULL)
           SELECT EXISTS(SELECT 1 FROM change WHERE user = ?1 AND chat IN (SELECT chat FROM up)) AS any`,
        )
        .get(this.id, chat)?.any === 1
    );
  }

  /** A stored path's nodes, oldest first, from its start to `node`: each with its turn, the turn's chat, and when it began. */
  private chainRows(node: string): { key: string; turn: string; depth: number; chat: string; created: number }[] {
    return this.db
      .query<{ key: string; turn: string; depth: number; chat: string; created: number }, [string, string]>(
        `WITH RECURSIVE up(key, prev, turn, depth) AS (
           SELECT key, prev, turn, depth FROM path_node WHERE user = ?1 AND key = ?2
           UNION ALL SELECT n.key, n.prev, n.turn, n.depth FROM path_node n JOIN up ON n.user = ?1 AND n.key = up.prev)
         SELECT up.key, up.turn, up.depth, t.chat, t.created FROM up JOIN turn t ON t.user = ?1 AND t.id = up.turn ORDER BY up.depth`,
      )
      .all(this.id, node);
  }

  /**
   * His own changes of these chats that have taken effect (a job of his, once it ended), each with the moment it did, in that order;
   * one written again after an import (`restoreOwn`) with the depth of the turn it stands just before.
   */
  private ownerOf(chats: readonly string[]): OwnerChange[] {
    return this.db
      .query<{ id: number; chat: string; op: string; lane: string; value: string; by: string | null; cite: string | null; precision: string | null; standing: string | null; source: string | null; at: number; placed: number | null }, [string, string]>(
        `SELECT c.id, c.chat, c.op, c.lane, c.value, c.by, c.cite, c.precision, c.standing, c.source, MAX(COALESCE(c.moment, 0), COALESCE(e.ended, c.created)) AS at, pn.depth AS placed
         FROM change c LEFT JOIN job e ON e.user = c.user AND e.id = c.job
         LEFT JOIN turn pt ON c.placed IS NOT NULL AND pt.user = c.user AND pt.id = c.placed LEFT JOIN path_node pn ON pn.user = c.user AND pn.key = pt.node
         WHERE c.user = ?1 AND c.chat IN (SELECT value FROM json_each(?2)) AND c.applied = 1 AND (c.job IS NULL OR e.ended IS NOT NULL)
         ORDER BY at, c.id`,
      )
      .all(this.id, JSON.stringify(chats))
      .map((c) => ({ id: c.id, chat: c.chat, at: c.at, placed: c.placed, op: c.op, lane: c.lane as Lane, value: JSON.parse(c.value) as JsonValue, by: c.by, cite: c.cite === null ? null : (JSON.parse(c.cite) as JsonValue), applied: true, precision: c.precision as Precision | null, standing: c.standing as Standing | null, source: c.source as Source | null }));
  }

  /**
   * Where his own changes stand along a run of a path (plan §6.3 l.632): each just before the first turn of the run, of its chat or of
   * a branch of it made after it, that began after it took effect; one written again after an import, just before its chat's turn at
   * the depth of the turn it was placed before, whose moment the import's other turns share; else after the run's end, for `reader`,
   * the chat whose head that is, when it is that chat's or one of its sources' made before the reader was. With `skipFirst`, the run's
   * first node is where a fold starts: what stands before it is in its state already.
   */
  private placeOwner(run: readonly { key: string; chat: string; created: number; depth: number }[], skipFirst: boolean, reader: string | null): { before: Map<string, OwnerChange[]>; after: OwnerChange[] } {
    const before = new Map<string, OwnerChange[]>();
    const after: OwnerChange[] = [];
    const chats = new Set(run.map((s) => s.chat));
    if (reader !== null) chats.add(reader);
    // Each chat with when it was made and the chats it was branched from.
    const line = new Map<string, { created: number; sources: Set<string> }>();
    for (const chat of chats) {
      const sources = new Set<string>();
      const made = this.chatDb(chat)?.created ?? 0;
      for (let up = this.chatDb(chat)?.source_chat ?? null; up !== null && !sources.has(up); up = this.chatDb(up)?.source_chat ?? null) sources.add(up);
      line.set(chat, { created: made, sources });
    }
    const all = new Set([...chats, ...[...line.values()].flatMap((l) => [...l.sources])]);
    const fits = (c: OwnerChange, chat: string): boolean => c.chat === chat || ((line.get(chat)?.sources.has(c.chat) ?? false) && c.at <= (line.get(chat)?.created ?? 0));
    for (const c of this.ownerOf([...all])) {
      const i = c.placed !== null ? run.findIndex((s) => s.chat === c.chat && s.depth >= (c.placed ?? 0)) : run.findIndex((s) => s.created > c.at && fits(c, s.chat));
      if (i < 0) {
        if (reader !== null && fits(c, reader)) after.push(c);
        continue;
      }
      if (skipFirst && i === 0) continue;
      const key = run[i]?.key ?? "";
      before.set(key, [...(before.get(key) ?? []), c]);
    }
    return { before, after };
  }

  /**
   * Folds and holds a chat's current state, with its tree, ahead of its first question: a help for a caller that learns first that a
   * generation is coming. The question folds and holds a chat not held all the same.
   */
  holdAhead(chat: string): void {
    this.store.viewOf(this.headState(chat).state);
  }

  /**
   * Stores the snapshots this user's reads found worth storing, now rather than at the user's next write (`StoreOptions.heldWaiting`):
   * a write of derived rows alone, kept true by the fold marks they were folded under (`Store.flush`), which changes no fold and so
   * tells no listener of the store's writes. Inside the owner's write, as every write.
   */
  storeHeld(): void {
    this.db.transaction(() => this.store.flush(this.id))();
  }

  /**
   * The chats whose path wants a snapshot this build can use where none is stored (`prepareNext`), the chat played most recently
   * first: those a fold would otherwise fold from their start, after an update or an import under another build.
   */
  unprepared(): string[] {
    return this.db
      .query<{ id: string }, [string]>("SELECT c.id FROM chat c WHERE c.user = ?1 AND c.deleted IS NULL AND c.head IS NOT NULL ORDER BY (SELECT max(t.created) FROM turn t WHERE t.user = c.user AND t.chat = c.id) DESC, c.created DESC")
      .all(this.id)
      .map((c) => c.id)
      .filter((chat) => this.wanting(chat).missing > 0);
  }

  /**
   * A chat's path from its start to its head, each node with its turn's changes (its jobs' aside) and whether a snapshot this build can
   * use is stored there; and how many of the nodes where a fold stores one (every `snapshotEvery` turns, an open turn's aside) have none.
   */
  private wanting(chat: string): { rows: { key: string; depth: number; changes: number; due: boolean; usable: boolean }[]; missing: number } {
    const head = this.chatDb(chat)?.head ?? null;
    if (head === null) return { rows: [], missing: 0 };
    const every = this.store.snapshotEvery;
    const rows = this.db
      .query<{ key: string; depth: number; open: number; changes: number; usable: number }, [string, string, string]>(
        `WITH RECURSIVE up(key, prev, turn, depth) AS (
           SELECT key, prev, turn, depth FROM path_node WHERE user = ?1 AND key = ?2
           UNION ALL SELECT n.key, n.prev, n.turn, n.depth FROM path_node n JOIN up ON n.user = ?1 AND n.key = up.prev)
         SELECT up.key, up.depth, t.status = 'open' AS open,
           (SELECT count(*) FROM change c WHERE c.user = ?1 AND c.turn = up.turn AND c.job IS NULL) AS changes,
           EXISTS(SELECT 1 FROM snapshot s WHERE s.user = ?1 AND s.node = up.key AND (s.kind = 'base' OR s.fingerprint = ?3)) AS usable
         FROM up JOIN turn t ON t.user = ?1 AND t.id = up.turn ORDER BY up.depth`,
      )
      .all(this.id, head, this.store.fingerprint)
      .map((r) => ({ key: r.key, depth: r.depth, changes: r.changes, due: (r.depth + 1) % every === 0 && r.open !== 1, usable: r.usable === 1 }));
    return { rows, missing: rows.filter((r) => r.due && !r.usable).length };
  }

  /**
   * Folds the next stretch of a chat's path that wants a snapshot (`unprepared`): from the state the stretch before it ended on (`after`,
   * held in memory) or the deepest snapshot stored before it, turn after turn, each from the state the one before it left, for as long
   * as `forMs` allows (one turn at least), up to the first node where a snapshot is due and none is stored at most. The snapshots it finds
   * wait to be stored (`storeHeld`). What it folded: the node it ended on, the changes of its turns, and how many such nodes are left.
   */
  prepareNext(chat: string, after: string | null, forMs: number): { at: string | null; changes: number; left: number } {
    const began = performance.now();
    const { rows, missing } = this.wanting(chat);
    const end = rows.findIndex((r) => r.due && !r.usable);
    if (end < 0) return { at: null, changes: 0, left: 0 };
    let to = end;
    while (to > 0 && !rows[to - 1]?.usable && rows[to - 1]?.key !== after) to--;
    let changes = 0;
    let at: string | null = null;
    for (; to <= end && (at === null || performance.now() - began < forMs); to++) {
      const row = rows[to];
      if (row === undefined) break;
      this.foldNode(row.key);
      at = row.key;
      changes += row.changes;
    }
    return { at, changes, left: at === rows[end]?.key ? missing - 1 : missing };
  }

  /**
   * A starting state that stands for the engine's state after a turn on a path (a migrated chat's, where today's fold and this one
   * differ, plan §15.3 item 7): folds start from it, whatever the turns before it hold, and a change recorded on the turn afterwards
   * (a correction) is folded on top of it. What the store keeps beside the engine's state (agents' lines, what changed last, the areas'
   * slices) is the turn's own as folded. Any turn of a chat takes one, on the chat's path or off it (another swipe of a message); it
   * stands at the path node of the turn made on its own path unless `at` names another node the turn stands at (the head of a
   * rebased chat, where the turn's own path is not the one shown): every path through that node, the later turns of it included,
   * folds from it.
   */
  setBase(turnId: string, world: WorldState, at?: string): void {
    const turn = this.turnToWrite(turnId);
    const node = at ?? turn.node;
    if (at !== undefined && this.db.query<{ turn: string }, [string, string]>("SELECT turn FROM path_node WHERE user = ? AND key = ?").get(this.id, at)?.turn !== turnId) {
      throw new StoreInputError(`${at} is not a path node of turn ${turnId}`);
    }
    const own = this.foldNode(node).folded.state;
    const doc: SnapshotDoc = { state: { ...own, world }, notApplied: [], rebased: [] };
    this.write(this.throughTurn(turn), () => {
      // Every change of this user's recorded so far stands within the base or before it; ids only grow.
      const upto = this.db.query<{ n: number | null }, [string]>("SELECT max(id) AS n FROM change WHERE user = ?").get(this.id)?.n ?? 0;
      this.store.storeSnapshot(this.id, node, "base", upto, snapshotRows(doc));
      this.dropSnapshotsThrough(turnId);
    });
  }

  /** The state a chat starts from: its world revision's, or, for a chat that names no world, the blank world's. */
  private initial(revision: string | null): Folded {
    const from = revision ?? BLANK_REVISION;
    const key = `${this.id}\u0000~${from}`;
    const hit = this.store.cached(key);
    if (hit) return hit.folded;
    const state = initialStoreState(this.store.env, from);
    if (!state) throw new StoreInputError(`the world revision ${from} is not available`);
    const folded: Folded = { node: null, state, notApplied: [], rebased: [] };
    this.store.keep(key, folded, 0, this.id, null, null);
    return folded;
  }

  private cacheKey(node: string): string {
    return `${this.id}\u0000${node}`;
  }

  /** The turns of the path a stored node ends, its own turn among them. */
  private turnsTo(key: string): Set<string> {
    return new Set(
      this.db
        .query<{ turn: string }, [string, string]>("WITH RECURSIVE up(key, prev, turn) AS (SELECT key, prev, turn FROM path_node WHERE user = ?1 AND key = ?2 UNION ALL SELECT n.key, n.prev, n.turn FROM path_node n JOIN up ON n.user = ?1 AND n.key = up.prev) SELECT turn FROM up")
        .all(this.id, key)
        .map((r) => r.turn),
    );
  }

  /**
   * Where `turn` stands rebased on a path whose turns before it are `before` (plan §6.3): the turns of the path it was made on (`made`,
   * its own node) that this path does not have, an earlier reply's other swipe or a reply deleted since, with their messages. Its
   * areas' changes are told it (`AreaChange.away`); undefined where its own node is not known.
   */
  private awayOf(turn: string, made: string | undefined, before: ReadonlySet<string>): Away | undefined {
    if (made === undefined) return undefined;
    const turns = [...this.turnsTo(made)].filter((t) => t !== turn && !before.has(t));
    const messages = this.db
      .query<{ message: string }, [string, string]>("SELECT DISTINCT t.message FROM json_each(?2) j CROSS JOIN turn t ON t.user = ?1 AND t.id = j.value WHERE t.message IS NOT NULL")
      .all(this.id, JSON.stringify(turns))
      .map((r) => r.message);
    return { turns, messages };
  }

  /**
   * Folds the path ending at `node`, from the nearest state on it held in memory under the fold mark of the chat its turn was played
   * in, else stored, else the chat's start. It writes nothing: the snapshots it finds worth storing wait for the user's next write.
   */
  private foldNode(node: string): { folded: Folded; upto: number } {
    const own = this.db
      .query<{ chat: string; mark: string | null }, [string, string]>(
        "SELECT t.chat, m.mark FROM path_node n JOIN turn t ON t.user = n.user AND t.id = n.turn LEFT JOIN fold_mark m ON m.user = t.user AND m.chat = t.chat WHERE n.user = ?1 AND n.key = ?2",
      )
      .get(this.id, node);
    if (!own) throw new StoreInputError(`no path node ${node}`);
    const mark = own.mark ?? "";
    const hit = this.store.cached(this.cacheKey(node), mark);
    if (hit) return { folded: hit.folded, upto: hit.upto };
    // The path back to the nearest stored snapshot this code may use, or to the start, each node with its turn's chat and that chat's mark.
    const chain = this.db
      .query<{ key: string; prev: string | null; turn: string; depth: number; snap: number; chat: string; created: number; mark: string | null }, [string, string, string]>(
        `WITH RECURSIVE up(key, prev, turn, depth, snap) AS (
           SELECT n.key, n.prev, n.turn, n.depth, EXISTS(SELECT 1 FROM snapshot s WHERE s.user = n.user AND s.node = n.key AND (s.kind = 'base' OR s.fingerprint = ?2))
           FROM path_node n WHERE n.user = ?1 AND n.key = ?3
           UNION ALL
           SELECT n.key, n.prev, n.turn, n.depth, EXISTS(SELECT 1 FROM snapshot s WHERE s.user = n.user AND s.node = n.key AND (s.kind = 'base' OR s.fingerprint = ?2))
           FROM path_node n JOIN up ON n.user = ?1 AND n.key = up.prev WHERE up.snap = 0)
         SELECT up.key, up.prev, up.turn, up.depth, up.snap, t.chat, t.created, m.mark FROM up JOIN turn t ON t.user = ?1 AND t.id = up.turn
         LEFT JOIN fold_mark m ON m.user = ?1 AND m.chat = t.chat ORDER BY up.depth`,
      )
      .all(this.id, this.store.fingerprint, node);
    if (chain.length === 0) throw new StoreInputError(`no path node ${node}`);
    const at = new Map(chain.map((c) => [c.key, { chat: c.chat, mark: c.mark ?? "" }]));
    // Start from the latest state held in memory, else the stored snapshot, else the chat's start.
    let from = -1;
    let start: { state: StoreState; upto: number; notApplied: Folded["notApplied"]; rebased: string[] } | null = null;
    // The held state the fold starts from, itself: a fold that adds nothing to it gives it back, with the view held over it.
    let base: StoreState | null = null;
    for (let i = chain.length - 2; i >= 0; i--) {
      const c = chain[i];
      const held = c === undefined ? null : this.store.cached(this.cacheKey(c.key), c.mark ?? "");
      if (!held) continue;
      from = i;
      start = { state: draft(held.folded.state), upto: held.upto, notApplied: [...held.folded.notApplied], rebased: [...held.folded.rebased] };
      base = held.folded.state;
      break;
    }
    const first = chain[0];
    if (!first) throw new StoreInputError(`no path node ${node}`);
    // The newest change id in the stored snapshot the fold starts from; null when it starts elsewhere.
    let stored: number | null = null;
    if (!start && first.snap === 1) {
      const snap = this.db
        .query<{ upto: number; state: string }, [string, string, string]>("SELECT upto, state FROM snapshot WHERE user = ?1 AND node = ?2 AND (kind = 'base' OR fingerprint = ?3) ORDER BY kind = 'base' DESC LIMIT 1")
        .get(this.id, first.key, this.store.fingerprint);
      if (snap) {
        const doc = this.store.readSnapshot(this.id, snap.state);
        from = 0;
        stored = snap.upto;
        // Read once and never changed: the fold works on a draft over it, and what it does not change stays shared.
        start = { state: draft(deepFreeze(doc.state)), upto: snap.upto, notApplied: doc.notApplied, rebased: doc.rebased };
      }
    }
    if (!start) {
      const init = this.chatStartOf(first.turn);
      start = { state: draft(init.state), upto: 0, notApplied: [], rebased: [] };
    }
    const rest = chain.slice(from + 1);
    const ids = (stored === null ? rest : [first, ...rest]).map((c) => c.turn);
    this.guardLong(ids, () => ({ user: this.id, node }));
    const turns = new Map(
      this.db
        .query<{ id: string; node: string; status: string }, [string, string]>("SELECT t.id, t.node, t.status FROM json_each(?2) j CROSS JOIN turn t ON t.user = ?1 AND t.id = j.value")
        .all(this.id, JSON.stringify(ids))
        .map((t) => [t.id, t]),
    );
    const byTurn = this.changesOf(ids);
    const stepOf = (c: { key: string; prev: string | null; turn: string; depth: number }, changes: StoredChange[]): FoldStep => {
      const made = turns.get(c.turn)?.node;
      const own = made === c.key;
      const away = own ? undefined : this.awayOf(c.turn, made, c.prev === null ? new Set() : this.turnsTo(c.prev));
      return { node: c.key, turn: c.turn, n: c.depth + 1, own, changes, ...(away === undefined ? {} : { away }) };
    };
    const placed = this.jobsPlaced(node);
    // His own changes, placed along the steps folded here; those placed at or before the start are in it already.
    const owner = this.ownerIn(own.chat) ? this.placeOwner(from >= 0 ? chain.slice(from) : rest, from >= 0, null).before : new Map<string, OwnerChange[]>();
    const steps = rest.map((c): FoldStep => ({ ...stepOf(c, byTurn.get(c.turn) ?? []), jobs: placed.get(c.key) ?? [], owner: owner.get(c.key) ?? [] }));
    // Changes the snapshot's own turn took after it was stored (a correction after a starting state was set) go on top of it.
    const late = (byTurn.get(first.turn) ?? []).filter((c) => c.id > (stored ?? Number.POSITIVE_INFINITY));
    if (late.length > 0) steps.unshift(stepOf(first, late));
    const every = this.store.snapshotEvery;
    const snaps: [string, number, SnapshotRows, string, string][] = [];
    const began = performance.now();
    const result = foldSteps(this.store.envOf(this.id), start, steps, (step, state, upto, notApplied, rebased) => {
      // Every `snapshotEvery` turns along a path, once its turn is no longer open, where none is stored.
      if (step.n % every !== 0 || turns.get(step.turn)?.status === "open" || (stored !== null && step.node === first.key)) return;
      const doc: SnapshotDoc = { state, notApplied: [...(start?.notApplied ?? []), ...notApplied], rebased: [...(start?.rebased ?? []), ...rebased] };
      const of = at.get(step.node) ?? { chat: own.chat, mark };
      snaps.push([step.node, upto, snapshotRows(doc), of.chat, of.mark]);
    });
    this.saidLong(began, own.chat, node, steps.length);
    this.store.hold(this.id, snaps);
    // A turn that adds nothing (one just begun) holds the same state as the one before it: the same object, so the tree held over it
    // answers the world state at the turn's start from memory, with no tree built at the compile (PlanStore-S2 item 4).
    const same = base !== null && steps.every((s) => s.changes.length === 0 && (s.jobs?.length ?? 0) === 0 && (s.owner?.length ?? 0) === 0);
    const folded: Folded = { node, state: same && base !== null ? base : result.state, notApplied: [...start.notApplied, ...result.notApplied], rebased: [...start.rebased, ...result.rebased] };
    this.store.keep(this.cacheKey(node), folded, result.upto, this.id, own.chat, mark);
    return { folded, upto: result.upto };
  }

  /**
   * Folds a path ending at the node `end`, given by its node rows, oldest first, as `foldNode` folds a stored one: to the deepest of
   * them the store holds, then the rest in memory, each turn's changes applied again where it stands rebased, and jobs' changes placed
   * along it. The rows are asked for only when no state is held at `end`. It writes nothing, and holds the state under `end`, so a
   * comparison that stores these nodes finds it held; and the snapshots a fold of those nodes would store, which wait for the write
   * that stores the nodes (`Store.flush`), as a comparison folding them itself stores them.
   */
  private foldPath(end: string, turn: string, chain: () => readonly (readonly [key: string, prev: string | null, turn: string, depth: number])[]): Folded {
    // Held under the mark of the chat the end's turn was played in, as `foldNode` holds a stored node.
    const chat = this.turnOrThrow(turn).chat;
    const mark = this.store.markOf(this.id, chat);
    const hit = this.store.cached(this.cacheKey(end), mark);
    if (hit) return hit.folded;
    const nodes = chain();
    // The chain from the start names the same turns as the one reused from the last comparison, so it ends at the same key.
    const last = nodes.at(-1)?.[0];
    if (last !== end) throw new Error(`the chain of a question's path ends at ${last ?? "no node"}, not at ${end}`);
    const stored = new Set(
      this.db
        .query<{ key: string }, [string, string]>("SELECT n.key FROM json_each(?2) j CROSS JOIN path_node n ON n.user = ?1 AND n.key = j.value")
        .all(this.id, JSON.stringify(nodes.map(([key]) => key)))
        .map((r) => r.key),
    );
    const deepest = nodes.findLastIndex(([key]) => stored.has(key));
    if (deepest === nodes.length - 1) return this.foldNode(end).folded;
    const turns = new Map(
      this.db
        .query<{ id: string; node: string; status: string; created: number; chat: string }, [string, string]>("SELECT t.id, t.node, t.status, t.created, t.chat FROM json_each(?2) j CROSS JOIN turn t ON t.user = ?1 AND t.id = j.value")
        .all(this.id, JSON.stringify(nodes.map(([, , turn]) => turn)))
        .map((t) => [t.id, t]),
    );
    this.guardLong(nodes.slice(deepest + 1).map(([, , t]) => t), () => ({ user: this.id, end, turn, nodes }));
    const marks = new Map<string, string>();
    const markFor = (c: string): string => {
      const m = marks.get(c) ?? this.store.markOf(this.id, c);
      marks.set(c, m);
      return m;
    };
    const base = deepest >= 0 ? this.foldNode(nodes[deepest]?.[0] ?? "") : { folded: this.chatStartOf(nodes[0]?.[2] ?? ""), upto: 0 };
    const rest = nodes.slice(deepest + 1);
    const byTurn = this.changesOf(rest.map(([, , turn]) => turn));
    const placed = this.jobsAlong(nodes.map(([key, , turn, depth]) => ({ key, turn, depth, created: turns.get(turn)?.created ?? 0 }))).placed;
    const run = nodes.map(([key, , turn, depth]) => ({ key, chat: turns.get(turn)?.chat ?? chat, created: turns.get(turn)?.created ?? 0, depth }));
    const owner = this.ownerIn(chat) ? this.placeOwner(deepest >= 0 ? run.slice(deepest) : run, deepest >= 0, null).before : new Map<string, OwnerChange[]>();
    // The turns before each step on this path, which may not all be stored yet: the chain's own, grown as the steps go.
    const before = new Set(nodes.slice(0, deepest + 1).map(([, , t]) => t));
    const steps = rest.map(([key, , turn, depth]): FoldStep => {
      const made = turns.get(turn)?.node;
      const own = made === key;
      const away = own ? undefined : this.awayOf(turn, made, before);
      before.add(turn);
      return { node: key, turn, n: depth + 1, own, changes: byTurn.get(turn) ?? [], jobs: placed.get(key) ?? [], owner: owner.get(key) ?? [], ...(away === undefined ? {} : { away }) };
    });
    const every = this.store.snapshotEvery;
    const snaps: [string, number, SnapshotRows, string, string][] = [];
    const began = performance.now();
    const result = foldSteps(this.store.envOf(this.id), { state: draft(base.folded.state), upto: base.upto }, steps, (step, state, upto, notApplied, rebased) => {
      // Every `snapshotEvery` turns along the path, once its turn is no longer open, as `foldNode` keeps them.
      if (step.n % every !== 0 || turns.get(step.turn)?.status === "open") return;
      const doc: SnapshotDoc = { state, notApplied: [...base.folded.notApplied, ...notApplied], rebased: [...base.folded.rebased, ...rebased] };
      const of = turns.get(step.turn)?.chat ?? chat;
      snaps.push([step.node, upto, snapshotRows(doc), of, markFor(of)]);
    });
    this.saidLong(began, chat, end, steps.length);
    this.store.hold(this.id, snaps);
    const folded: Folded = { node: end, state: result.state, notApplied: [...base.folded.notApplied, ...result.notApplied], rebased: [...base.folded.rebased, ...result.rebased] };
    this.store.keep(this.cacheKey(end), folded, result.upto, this.id, chat, mark);
    return folded;
  }

  /** One line in the log for a fold that held the thread `LONG_FOLD_MS` or more: its chat, the node it ended at, how many turns it folded and how long it took. */
  private saidLong(began: number, chat: string, node: string, turns: number): void {
    const ms = Math.round(performance.now() - began);
    if (ms >= LONG_FOLD_MS) this.store.log?.("A fold held the thread long.", { chat, node, turns, ms });
  }

  /** Throws `FoldAway` for a fold about to run over the turns `ids` when `afar` waits for a thread and they hold more changes than `workerFoldAt`. */
  private guardLong(ids: readonly string[], job: () => FoldJob): void {
    if (!this.store.guarding) return;
    const n = this.db.query<{ n: number }, [string, string]>("SELECT COUNT(*) AS n FROM change WHERE user = ?1 AND turn IN (SELECT value FROM json_each(?2)) AND job IS NULL").get(this.id, JSON.stringify(ids))?.n ?? 0;
    if (n > this.store.workerFoldAt) throw new FoldAway(job());
  }

  /** @internal Folds what a thread was asked to (`FoldJob`), the states left held for `Store.takeFolds`. */
  foldJob(job: FoldJob): void {
    if ("node" in job) this.foldNode(job.node);
    else this.foldPath(job.end, job.turn, () => job.nodes);
  }

  /** The state the chat a turn was made in starts from (`initial`). */
  private chatStartOf(turn: string): Folded {
    const opener = this.db.query<{ revision: string | null }, [string, string]>("SELECT c.revision FROM turn t JOIN chat c ON c.user = t.user AND c.id = t.chat WHERE t.user = ? AND t.id = ?").get(this.id, turn);
    return this.initial(opener?.revision ?? null);
  }

  /** The changes the given turns recorded themselves (not their jobs'), as the fold reads them: by turn, each turn's in order. */
  private changesOf(turns: readonly string[]): Map<string, StoredChange[]> {
    const byTurn = new Map<string, StoredChange[]>();
    for (const c of this.db
      .query<{ id: number; turn: string; op: string; lane: string; value: string; by: string | null; cite: string | null; applied: number; precision: string | null; standing: string | null; source: string | null }, [string, string]>(
        "SELECT c.id, c.turn, c.op, c.lane, c.value, c.by, c.cite, c.applied, c.precision, c.standing, c.source FROM change c WHERE c.user = ?1 AND c.turn IN (SELECT value FROM json_each(?2)) AND c.job IS NULL ORDER BY c.turn, c.ord",
      )
      .all(this.id, JSON.stringify(turns))) {
      const list = byTurn.get(c.turn) ?? [];
      list.push({ id: c.id, op: c.op, lane: c.lane as Lane, value: JSON.parse(c.value) as JsonValue, by: c.by, cite: c.cite === null ? null : (JSON.parse(c.cite) as JsonValue), applied: c.applied === 1, precision: c.precision as Precision | null, standing: c.standing as Standing | null, source: c.source as Source | null });
      byTurn.set(c.turn, list);
    }
    return byTurn;
  }

  /** Jobs' changes along the stored path ending at `node`, placed as `jobsAlong` places them. */
  private jobsPlaced(node: string): Map<string, JobChange[]> {
    const path = this.db
      .query<{ key: string; turn: string; depth: number; created: number }, [string, string]>(
        `WITH RECURSIVE up(key, prev, turn, depth) AS (
           SELECT key, prev, turn, depth FROM path_node WHERE user = ?1 AND key = ?2
           UNION ALL SELECT n.key, n.prev, n.turn, n.depth FROM path_node n JOIN up ON n.user = ?1 AND n.key = up.prev)
         SELECT up.key, up.turn, up.depth, t.created FROM up JOIN turn t ON t.user = ?1 AND t.id = up.turn ORDER BY up.depth`,
      )
      .all(this.id, node);
    return this.jobsAlong(path).placed;
  }

  /**
   * Jobs' changes along a path (its nodes oldest first, each with its turn and when that turn began), by the node of the turn each
   * takes effect just before (plan §10.9): the first turn after the one that started the job to have begun after the job ended. A job
   * that has not ended has not taken effect; one that ended after every later turn on the path began is pending: it takes effect
   * before the next turn to begin.
   */
  private jobsAlong(path: readonly { key: string; turn: string; depth: number; created: number }[]): { placed: Map<string, JobChange[]>; pending: JobChange[] } {
    const placed = new Map<string, JobChange[]>();
    const pending: JobChange[] = [];
    const jobs = this.db
      .query<{ id: number; turn: string; op: string; lane: string; value: string; by: string | null; cite: string | null; applied: number; precision: string | null; standing: string | null; source: string | null; ended: number }, [string, string]>(
        `SELECT c.id, c.turn, c.op, c.lane, c.value, c.by, c.cite, c.applied, c.precision, c.standing, c.source, e.ended FROM change c JOIN job e ON e.user = c.user AND e.id = c.job AND e.ended IS NOT NULL
         WHERE c.user = ?1 AND c.job IS NOT NULL AND c.turn IN (SELECT value FROM json_each(?2)) ORDER BY c.id`,
      )
      .all(this.id, JSON.stringify(path.map((p) => p.turn)));
    const index = new Map(path.map((p, i) => [p.turn, i]));
    for (const c of jobs) {
      const i = index.get(c.turn);
      const started = i === undefined ? undefined : path[i];
      if (!started || i === undefined) continue;
      const before = path.slice(i + 1).find((p) => p.created > c.ended);
      const change: JobChange = { id: c.id, turn: c.turn, from: started.depth + 1, op: c.op, lane: c.lane as Lane, value: JSON.parse(c.value) as JsonValue, by: c.by, cite: c.cite === null ? null : (JSON.parse(c.cite) as JsonValue), applied: c.applied === 1, precision: c.precision as Precision | null, standing: c.standing as Standing | null, source: c.source as Source | null };
      if (before) placed.set(before.key, [...(placed.get(before.key) ?? []), change]);
      else pending.push(change);
    }
    return { placed, pending };
  }

  /** Ended jobs' changes along a stored path that no turn on it began after: what the next turn to begin starts with. */
  private jobsPending(path: readonly { key: string; turn: string; depth: number; created: number }[]): JobChange[] {
    return path.length === 0 ? [] : this.jobsAlong(path).pending;
  }

  /**
   * Notes that a job has ended (plan §10.9): its changes, recorded with the turn that started it (or with his own, for a job of his),
   * take effect just before the first turn that begins from now on, so no turn begun already has its state changed; his own job's are
   * at the chat's head at once. A job ends once; one that has ended records nothing more.
   */
  endJob(job: string): void {
    const chats = this.db
      .query<{ chat: string }, [string, string]>("SELECT DISTINCT COALESCE(c.chat, t.chat) AS chat FROM change c LEFT JOIN turn t ON t.user = c.user AND t.id = c.turn WHERE c.user = ?1 AND c.job = ?2")
      .all(this.id, job)
      .flatMap((r) => (r.chat === null ? [] : [r.chat]));
    this.write(chats, () => this.db.run("INSERT INTO job (user, id, ended) VALUES (?, ?, ?) ON CONFLICT (user, id) DO UPDATE SET ended = COALESCE(job.ended, excluded.ended)", [this.id, job, this.store.now()]));
  }

  /**
   * What jobs changed at the start of a turn, for its briefing (plan §10.9): their changes placed just
   * before it, on the path it was made on, each with whether it took effect and what was reported. A
   * joined turn is refused, as every reading of one is, naming the turn it joined.
   */
  jobsBefore(turnId: string): { change: ChangeRow; applied: boolean; reports: Report[] }[] {
    return this.changesBefore(turnId).filter((c) => c.change.chat === null);
  }

  /** What stands just before a turn on the path it was made on: jobs' changes placed there, and his own (plan §10.9, §6.3 l.632). */
  private placedBefore(t: TurnRow): { jobs: JobChange[]; owner: OwnerChange[] } {
    const jobs = this.jobsPlaced(t.node).get(t.node) ?? [];
    if (!this.ownerIn(t.chat)) return { jobs, owner: [] };
    const rows = this.db
      .query<{ key: string; chat: string; created: number; depth: number }, [string, string]>(
        "SELECT n.key, t.chat, t.created, n.depth FROM path_node n JOIN turn t ON t.user = n.user AND t.id = n.turn WHERE n.user = ?1 AND n.key IN (?2, (SELECT prev FROM path_node WHERE user = ?1 AND key = ?2)) ORDER BY n.depth",
      )
      .all(this.id, t.node);
    const owner = this.placeOwner(rows, rows.length > 1, null).before.get(t.node) ?? [];
    return { jobs, owner };
  }

  /**
   * Every change placed before a turn (plan §10.9): a job's, and his own, each with who made it (on its row), its lane and value, the
   * things it is about (tree refs and an area's parts, by what it touches), whether it took effect there, and its reports (a later value
   * standing names the later turn). A joined turn is refused, as every reading of one is.
   */
  changesBefore(turnId: string): { change: ChangeRow; about: string[]; applied: boolean; reports: Report[] }[] {
    const t = this.turnToWrite(turnId);
    const { jobs, owner } = this.placedBefore(t);
    const placed = [...jobs, ...owner];
    if (placed.length === 0) return [];
    const missed = new Map(this.stateAt(t.id).notApplied.map((n) => [n.change, n.reports]));
    return placed.map((c) => {
      const change = this.changeOrThrow(c.id);
      return { change, about: aboutOf(this.store.env, change.op, change.value), applied: !missed.has(c.id), reports: missed.get(c.id) ?? [] };
    });
  }

  /**
   * What "unsettled" lists of a turn and what follows it (plan §6.7, §10.5, AuTurn-K41): every change of the turn (null: none, the
   * chat's start), and every change placed after it before the next turn (a job's, his own), that carries a report, did not apply,
   * names no source, or is an invention with no gap check or consent, wherever in the world it is. The next turn is `next` when given,
   * else the one after it on the chat's path, else the newest begun after it; with none, what stands after it at the chat's head. Each
   * with its turn (null: placed between turns), the things it is about, and why it is listed. A joined turn is refused, as every
   * reading of one is. Only what someone made is listed (`bySomeone`: an agent's own call, or a person), since only that is anyone's
   * to settle: never RPE's own records, a migration's rows, or the rows a write brings with it, as the turn's counts leave them out.
   */
  unsettledOf(chat: string, turnId: string | null, next?: string): UnsettledChange[] {
    const t = turnId === null ? null : this.turnToWrite(turnId);
    const row = this.chatOrThrow(chat);
    let upto = next;
    if (upto === undefined && t !== null) {
      const onPath = pathOf(row.path).flatMap((e) => (e.turn === null ? [] : [e.turn]));
      const at = onPath.indexOf(t.id);
      upto =
        (at >= 0 ? onPath[at + 1] : undefined) ??
        this.db.query<{ id: string }, [string, string, string]>("SELECT id FROM turn WHERE user = ? AND chat = ? AND parent = ? AND status <> 'joined' ORDER BY created DESC LIMIT 1").get(this.id, chat, t.id)?.id;
    }
    const placed: { change: ChangeRow; applied: boolean; reports: Report[] }[] = upto !== undefined ? this.changesBefore(upto) : t !== null ? this.trailingAfter(row, t) : [];
    const env = this.store.env;
    const out: UnsettledChange[] = [];
    const consider = (change: ChangeRow, turn: string | null, applied: boolean, reports: readonly Report[]): void => {
      if (!bySomeone(change)) return;
      const why: UnsettledWhy[] = [];
      if (change.reports.length > 0 || reports.length > 0) why.push("reported");
      if (!applied) why.push("not_applied");
      if (change.source === null) why.push("unsourced");
      if (inventedUnchecked(change.source, change.cite)) why.push("unchecked");
      if (why.length === 0) return;
      out.push({ change: reports.length === 0 ? change : { ...change, reports: [...change.reports, ...reports] }, turn, about: aboutOf(env, change.op, change.value), why });
    };
    // The turn's own changes; its jobs' are listed where they are placed.
    if (t !== null) for (const c of this.changes(t.id)) if (c.job === null) consider(c, t.id, c.applied, []);
    for (const p of placed) consider(p.change, null, p.applied, p.reports);
    return out;
  }

  /** His own changes of a chat (`addOwnerChanges`; his jobs' among them), in the order they were made. */
  ownerChanges(chat: string): ChangeRow[] {
    return this.db.query<ChangeDb, [string, string]>("SELECT * FROM change WHERE user = ? AND chat = ? ORDER BY ord").all(this.id, chat).map(changeOf);
  }

  /** What stands after a turn at the chat's head, when the turn is the head's: his own changes since, and ended jobs' changes pending. */
  private trailingAfter(row: ChatDb, t: TurnRow): { change: ChangeRow; applied: boolean; reports: Report[] }[] {
    if (row.head === null || row.head !== t.node) return [];
    const path = this.chainRows(row.head);
    const ids = [...this.jobsPending(path), ...(this.ownerIn(row.id) ? this.placeOwner(path, false, row.id).after : [])].map((c) => c.id);
    if (ids.length === 0) return [];
    const missed = new Map(this.withOwner(row.id, row.head, row.revision, true).notApplied.map((n) => [n.change, n.reports]));
    return ids.map((id) => ({ change: this.changeOrThrow(id), applied: !missed.has(id), reports: missed.get(id) ?? [] }));
  }

  // ------------------------------------------------------------ sessions

  /** A session: the scene it is, opened by a turn of the user's. */
  openSession(input: { chat: string; scene: string; turn: string }): SessionRow {
    this.chatOrThrow(input.chat);
    this.turnToWrite(input.turn);
    const id = crypto.randomUUID();
    this.write(false, () => this.db.run("INSERT INTO session (user, id, chat, scene, opened_by) VALUES (?, ?, ?, ?, ?)", [this.id, id, input.chat, input.scene, input.turn]));
    return this.session(id) as SessionRow;
  }

  closeSession(id: string, turn: string): SessionRow {
    if (!this.session(id)) throw new StoreInputError(`no session ${id}`);
    this.turnToWrite(turn);
    this.write(false, () => this.db.run("UPDATE session SET closed_by = ? WHERE user = ? AND id = ?", [turn, this.id, id]));
    return this.session(id) as SessionRow;
  }

  session(id: string): SessionRow | null {
    const r = this.db.query<{ id: string; chat: string; scene: string; opened_by: string; closed_by: string | null }, [string, string]>("SELECT id, chat, scene, opened_by, closed_by FROM session WHERE user = ? AND id = ?").get(this.id, id);
    return r ? { id: r.id, chat: r.chat, scene: r.scene, openedBy: r.opened_by, closedBy: r.closed_by } : null;
  }

  sessions(chat: string): SessionRow[] {
    return this.db
      .query<{ id: string; chat: string; scene: string; opened_by: string; closed_by: string | null }, [string, string]>("SELECT id, chat, scene, opened_by, closed_by FROM session WHERE user = ? AND chat = ? ORDER BY rowid")
      .all(this.id, chat)
      .map((r) => ({ id: r.id, chat: r.chat, scene: r.scene, openedBy: r.opened_by, closedBy: r.closed_by }));
  }

  // ------------------------------------------------------------ worlds

  /**
   * This user's worlds: every revision's bytes as received, each world's index, draft and history, one write at a time and each told
   * to the change notice the store was opened with (`worlds` module). `putWorld`, `worldDoc` and `worldRevisions` are the revision calls
   * a chat's caller makes of a document it has parsed.
   */
  get worlds(): UserWorlds {
    return new UserWorlds(this.db, this.id, (fn) => this.write(false, fn), this.store.now, (change) => this.store.worldChanged(change));
  }

  /**
   * Keeps a world revision's document (plan §4.5) for chats that play it, under the id chats and
   * markers name it by. A revision's document never changes, so one already kept stays as it is.
   * Whether it was added.
   */
  putWorld(revision: RevisionId, doc: WorldDoc): boolean {
    return this.worlds.putRevision(doc.id, JSON.stringify(doc), revision).added;
  }

  /** A kept revision's document, read as today's world store reads one; null when this user keeps no such revision. */
  worldDoc(revision: RevisionId): WorldDoc | null {
    return this.worlds.doc(revision);
  }

  /** The revisions this user keeps, of one world or of all, oldest first. */
  worldRevisions(world?: WorldId): WorldRevisionRow[] {
    return this.worlds.revisions(world);
  }

  /**
   * Keeps what the migration carried of this user's worlds (its `world_file` table, plan §15.2) byte for byte, so the chats it
   * imported play their worlds: every revision not yet kept, and the index, draft and history of a world this user keeps none of. A
   * revision already kept stays as it is; one that does not read as a world document is kept and listed. The migration calls it after a run.
   */
  copyMigratedWorlds(): { added: number; held: number; unreadable: { world: WorldId; revision: RevisionId }[] } {
    return this.worlds.copyCarried();
  }

  // ------------------------------------------------------------ undo and the review card

  /** A change by its id, his own or a turn's; null where he has none of that id. */
  change(id: number): ChangeRow | null {
    const r = this.db.query<ChangeDb, [string, number]>("SELECT * FROM change WHERE user = ? AND id = ?").get(this.id, id);
    return r ? changeOf(r) : null;
  }

  private changeOrThrow(id: number): ChangeRow {
    const c = this.change(id);
    if (c === null) throw new StoreInputError(`no change ${id}`);
    return c;
  }

  /**
   * What undoing a change would record and leave, read against the chat's head, with the chat whose own changes the undo goes to;
   * none for a change no longer on its chat's path. `turn` is the change's turn, null for one of his own; `own` the changes of the
   * same turn, or his own of the same chat, among which its unit (the changes sharing its group) is.
   */
  private undoPlan(c: ChangeRow, turn: TurnRow | null, own: readonly ChangeRow[]): { plan: UndoPlan; chat: string | null } {
    const offPath = { plan: { inputs: [], left: [{ code: "not_on_path", values: { change: c.id, op: c.op } }] }, chat: null };
    // The change with the rest of its unit: the changes of its turn, or his own, that share its group.
    const group = isRecord(c.value) && typeof c.value.group === "string" ? c.value.group : null;
    const unit = group === null ? [c] : own.filter((x) => isRecord(x.value) && x.value.group === group);
    const first = unit[0] ?? c;
    if (turn === null) {
      const chat = c.chat ?? "";
      const before = this.ownerBefore(chat, first.id);
      // His own changes that came after the unit: one of them that wrote a part of it is changed since.
      const last = Math.max(...unit.map((x) => x.id));
      return before === null ? offPath : { plan: reversal(unit, before, this.headState(chat).state, this.store.env, own.filter((x) => x.id > last && !unit.includes(x))), chat };
    }
    const chat = this.chatOrThrow(turn.chat);
    if (!pathOf(chat.path).some((e) => e.turn === turn.id)) return offPath;
    // The state just before the unit: the turn's start, and what the turn recorded before it.
    const before = draft(this.startOf(turn.id).state);
    const earlier = own.filter((x) => x.applied && x.job === null && x.ord < first.ord);
    applyUnchecked(this.store.envOf(this.id), before, earlier.map((x): Item => ({ op: x.op, value: x.value, turn: turn.id, n: turn.depth + 1, by: x.by, cite: x.cite, change: x.id, precision: x.precision, standing: x.standing, source: x.source })));
    return { plan: reversal(unit, before, this.headState(chat.id).state, this.store.env), chat: chat.id };
  }

  /** The state just before his own change `first` where it stands on its chat's path (before a turn, or after the path's end); null: on none. */
  private ownerBefore(chat: string, first: number): StoreState | null {
    const row = this.chatOrThrow(chat);
    const run = row.head === null ? [] : this.chainRows(row.head);
    const { before, after } = this.placeOwner(run, false, chat);
    const env = this.store.envOf(this.id);
    for (const [i, s] of run.entries()) {
      const list = before.get(s.key) ?? [];
      const k = list.findIndex((x) => x.id === first);
      if (k < 0) continue;
      const prev = run[i - 1];
      const state = draft((prev === undefined ? this.initial(row.revision) : this.foldNode(prev.key).folded).state);
      foldSteps(env, { state, upto: 0 }, [{ node: s.key, turn: s.turn, n: s.depth + 1, own: true, changes: [], jobs: this.jobsPlaced(s.key).get(s.key) ?? [], owner: list.slice(0, k) }]);
      return state;
    }
    const k = after.findIndex((x) => x.id === first);
    if (k < 0) return null;
    const state = draft((row.head === null ? this.initial(row.revision) : this.foldNode(row.head).folded).state);
    applyOwner(env, state, after.slice(0, k), (run.at(-1)?.depth ?? -1) + 2);
    return state;
  }

  /**
   * Undoes changes (plan §6.8), each in the order given: records the changes that reverse it as his own (`addOwnerChanges`), at the
   * chat's head at once and before the next turn, with source `player`, each citing the change it undoes. Nothing recorded is taken
   * away. What would be left is listed; when a later change has written the same part since, nothing is recorded for it. A change
   * still staged in an open turn is taken back with `dropStaged` instead.
   */
  undo(changeIds: number | readonly number[], by: string | null = "player"): { changes: ChangeRow[]; left: Report[] } {
    const changes: ChangeRow[] = [];
    const left: Report[] = [];
    for (const id of typeof changeIds === "number" ? [changeIds] : changeIds) {
      const c = this.changeOrThrow(id);
      const turn = c.chat === null ? this.turnOrThrow(c.turn) : null;
      if (turn?.status === "open") throw new StoreInputError(`change ${id} is staged in an open turn: dropStaged takes it back`);
      const own = turn === null ? this.ownerChanges(c.chat ?? "") : this.changes(turn.id);
      const { plan, chat } = this.undoPlan(c, turn, own);
      left.push(...plan.left);
      if (chat === null || plan.inputs.length === 0) continue;
      changes.push(...this.addOwnerChanges(chat, plan.inputs.map((i): ChangeInput => ({ ...i, by, source: "player", cite: { undoes: id } }))).changes);
    }
    return { changes, left };
  }

  /**
   * What the review card shows of a turn (plan §6.8): its changes by lane, each with its undo — the
   * operations undoing it would record and what would be left — and the changes that already undid it.
   * A joined turn is refused, as every reading of one is, naming the turn it joined.
   */
  reviewCard(turnId: string): { lane: Lane; changes: { change: ChangeRow; undo: { ops: string[]; left: Report[] }; undoneBy: number[] }[] }[] {
    const turn = this.turnToWrite(turnId);
    const own = this.changes(turn.id);
    const undone = new Map<number, number[]>();
    for (const r of this.db.query<{ id: number; undoes: number }, [string, string]>("SELECT c.id, json_extract(c.cite, '$.undoes') AS undoes FROM change c LEFT JOIN turn t ON t.user = c.user AND t.id = c.turn WHERE c.user = ?1 AND COALESCE(c.chat, t.chat) = ?2 AND json_extract(c.cite, '$.undoes') IS NOT NULL ORDER BY c.id").all(this.id, turn.chat)) {
      undone.set(r.undoes, [...(undone.get(r.undoes) ?? []), r.id]);
    }
    return LANES.map((lane) => ({
      lane,
      changes: own
        .filter((c) => c.lane === lane)
        .map((change) => {
          const { plan } = turn.status === "open" ? { plan: { inputs: [], left: [{ code: "staged", values: { change: change.id, op: change.op } }] } } : this.undoPlan(change, turn, own);
          return { change, undo: { ops: plan.inputs.map((i) => i.op), left: plan.left }, undoneBy: undone.get(change.id) ?? [] };
        }),
    })).filter((l) => l.changes.length > 0);
  }

  // ------------------------------------------------------------ the tree view

  /** The tree over the chat's current state. */
  view(chat: string): TreeView {
    return this.store.viewOf(this.headState(chat).state);
  }

  /** The tree over the state at a turn. */
  viewAt(turn: string): TreeView {
    return this.store.viewOf(this.stateAt(turn).state);
  }

  /** The tree as one reading sees it at a turn: a job's with the job's own changes on top (`stateFor`). */
  viewFor(turn: string, job: string | null): TreeView {
    return this.store.viewOf(this.stateFor(turn, job).state);
  }

  /**
   * A chat's current state as a job of his (no turn) sees it (R-26): his job's own changes so far on top of the chat's head, in the
   * order recorded, each checked again there, as `addOwnerChanges` checks a job's next ones; nobody else sees them until the job ends.
   * With no job, or none of its changes applied, the head's state.
   */
  headFor(chat: string, job: string | null): Folded {
    const base = this.headState(chat);
    if (job === null) return base;
    const mine = this.db.query<ChangeDb, [string, string, string]>("SELECT * FROM change WHERE user = ? AND chat = ? AND job = ? AND applied = 1 ORDER BY ord").all(this.id, chat, job).map(changeOf);
    if (mine.length === 0) return base;
    const head = this.chatOrThrow(chat).head;
    const n = head === null ? 1 : (this.db.query<{ depth: number }, [string, string]>("SELECT depth FROM path_node WHERE user = ? AND key = ?").get(this.id, head)?.depth ?? -1) + 2;
    const state = draft(base.state);
    applyChecked(this.store.envOf(this.id), state, mine.map((c): Item => ({ op: c.op, value: c.value, turn: "", n, by: c.by, cite: c.cite, change: c.id, precision: c.precision, standing: c.standing, source: c.source })), new Set());
    return { ...base, state };
  }

  /** The tree as a job of his sees the chat now (`headFor`). */
  viewHeadFor(chat: string, job: string | null): TreeView {
    return this.store.viewOf(this.headFor(chat, job).state);
  }

  /**
   * Names the world a chat that played none plays from now (R-22, R-29: attached from Build, its next turn taking the world's head
   * revision through his own `store.marker` migrate): only where the chat names none, leaving its `revision` (the fold's start), its
   * snapshots and every state held as they are. Whether it changed; refused for a chat that is not there.
   */
  playsWorld(chat: string, world: WorldId): boolean {
    this.chatOrThrow(chat);
    return this.write(false, () => this.db.run("UPDATE chat SET world = ? WHERE user = ? AND id = ? AND world IS NULL", [world, this.id, chat]).changes > 0);
  }

  /**
   * Lets go of a world that is deleted: each live chat that plays it plays none from now, so a world can be attached to it again. Its record
   * stays whole, and so do its `revision` (the fold's start) and the revisions it played, which the deletion keeps. The chats it was.
   */
  forgetWorld(world: WorldId): string[] {
    return this.write(false, () => this.db.query<{ id: string }, [string, string]>("UPDATE chat SET world = NULL WHERE user = ? AND world = ? AND deleted IS NULL RETURNING id").all(this.id, world).map((row) => row.id));
  }
}
