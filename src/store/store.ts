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
import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { RevisionId, WorldId } from "../shared/ids";
import type { WorldDoc } from "../shared/world";
import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { applyChecked, applyUnchecked, foldSteps, initialStoreState, type FoldEnv, type FoldStep, type Item, type JobChange, type StoredChange } from "./fold";
import { reversal, type UndoPlan } from "./undo";
import { checkChange } from "./input";
import { comparePaths, matchTurn, nodeKey } from "./path";
import { BLANK_REVISION, blankWorld } from "./blank";
import { MIGRATED_REVISION, readWorldDoc, type WorldRevisionRow } from "./worlds";
import { isWorldDoc } from "../engine/authoring";
import { migrateStore, missingStoreTables } from "./schema";
import { TreeView } from "./view";
import {
  LANES,
  StoreInputError,
  StoreSchemaError,
  type ChangeInput,
  type ChangeRow,
  type ChatRow,
  type Folded,
  type Lane,
  type NotApplied,
  type PathEntry,
  type PathReport,
  type Precision,
  type Report,
  type ShownMessage,
  type Source,
  type Standing,
  type StoreState,
  type TurnRow,
  type TurnStatus,
} from "./types";

/** What a snapshot keeps: the state after its node, with what did not apply and what stood rebased on the path to it. */
interface SnapshotDoc {
  state: StoreState;
  notApplied: NotApplied[];
  rebased: string[];
}

/** Defaults for the store's settings. */
export const STORE_DEFAULTS = Object.freeze({
  /** Turns between snapshots on a path (plan §6.3). */
  snapshotEvery: 25,
  /** Folded states held in memory, the least recently used going first; also the most snapshots held for a user's next write. */
  foldsKept: 32,
  /** Fields that only describe a level of the tree and never pass down to what is inside it. */
  ownOnly: Object.freeze(["description", "tags"]) as readonly string[],
  /** Names of note in each reflection. */
  notable: 3,
});

/** Bumped whenever this fold's output for the same changes would differ: snapshots made before are not used. */
const FOLD_VERSION = 4;

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
  snapshotEvery?: number;
  /** Identifies the code that folds (a build id): snapshots other code made are not used. Defaults to the packs and their versions. */
  fingerprint?: string;
  foldsKept?: number;
  ownOnly?: readonly string[];
  notable?: number;
  now?: () => number;
  /**
   * Told when an engine handler throws while the store applies or checks a change: an error in the
   * engine, not in the story. Its text is for people (the log, the live view) and never reaches a
   * model, whose report says only that the handler failed. Unset, it is written to standard error.
   */
  handlerFailed?: (failure: { op: string; error: unknown }) => void;
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
  ord: number;
  lane: string;
  op: string;
  value: string;
  by: string | null;
  standing: string | null;
  precision: string | null;
  source: string | null;
  cite: string | null;
  job: string | null;
  applied: number;
  reports: string | null;
  created: number;
}

interface ChatDb {
  id: string;
  world: string | null;
  revision: string | null;
  source_chat: string | null;
  source_message: string | null;
  head: string | null;
  path: string;
  created: number;
  deleted: number | null;
}

interface Cached {
  /** The user's fold mark it was folded under; null: it holds under any (a world's start). */
  mark: string | null;
  folded: Folded;
  upto: number;
}

/** Snapshots a user's folds found worth storing, by node, kept for the user's next write while `mark` holds. */
interface Held {
  mark: string;
  rows: Map<string, { upto: number; state: string }>;
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
    intent: r.intent,
    storyTime: r.story_time,
    timings: r.timings === null ? null : (JSON.parse(r.timings) as JsonValue),
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    created: r.created,
  };
}

function changeOf(r: ChangeDb): ChangeRow {
  return {
    id: r.id,
    turn: r.turn,
    ord: r.ord,
    lane: r.lane as Lane,
    op: r.op,
    value: JSON.parse(r.value) as JsonValue,
    by: r.by,
    standing: r.standing as Standing | null,
    precision: r.precision as Precision | null,
    source: r.source as Source | null,
    cite: r.cite === null ? null : (JSON.parse(r.cite) as JsonValue),
    job: r.job,
    applied: r.applied === 1,
    reports: r.reports === null ? [] : (JSON.parse(r.reports) as Report[]),
    created: r.created,
  };
}

function chatOf(r: ChatDb): ChatRow {
  return { id: r.id, world: r.world as WorldId | null, revision: r.revision as RevisionId | null, sourceChat: r.source_chat, sourceMessage: r.source_message, head: r.head, created: r.created, deleted: r.deleted };
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
  private readonly foldsKept: number;
  readonly viewOptions: { ownOnly: readonly string[]; notable: number };
  readonly now: () => number;
  /** Whether the store opened the database itself: then it brought the tables up, and it closes it. */
  private readonly owned: boolean;
  private readonly folds = new Map<string, Cached>();
  private readonly held = new Map<string, Held>();
  private readonly views = new WeakMap<StoreState, TreeView>();

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
    const failed = options.handlerFailed ?? ((f: { op: string; error: unknown }) => console.error(`RPE's store: the handler for ${f.op} failed:`, f.error));
    this.env = { registry: options.registry, worlds: (revision) => (revision === BLANK_REVISION ? blank : options.worlds(revision)), failed };
    this.snapshotEvery = Math.max(1, Math.floor(options.snapshotEvery ?? STORE_DEFAULTS.snapshotEvery));
    this.foldsKept = Math.max(1, Math.floor(options.foldsKept ?? STORE_DEFAULTS.foldsKept));
    this.fingerprint = options.fingerprint ?? hashParts("rpe.store", String(FOLD_VERSION), ...options.registry.packs.map((p) => `${p.id}@${p.version}`));
    this.viewOptions = { ownOnly: options.ownOnly ?? STORE_DEFAULTS.ownOnly, notable: Math.max(0, Math.floor(options.notable ?? STORE_DEFAULTS.notable)) };
    this.now = options.now ?? Date.now;
  }

  /** The store for one user: every call reads and writes that user's rows only. */
  user(id: string): UserStore {
    if (id === "") throw new StoreInputError("a user is needed");
    return new UserStore(this, id);
  }

  /** Lets go of everything held in memory: folded states, and snapshots waiting for a write. */
  dropCaches(): void {
    this.folds.clear();
    this.held.clear();
  }

  /** Closes the database if the store opened it; one it was handed stays open, its owner's to close. */
  close(): void {
    if (this.owned) this.db.close();
  }

  /** @internal The user's fold mark. Being a row, a rollback puts it back with the rows it answers for. */
  markOf(user: string): string {
    return this.db.query<{ mark: string }, [string]>("SELECT mark FROM fold_mark WHERE user = ?").get(user)?.mark ?? "";
  }

  /** @internal Gives the user a fold mark never used before; inside a write. */
  newMark(user: string): void {
    this.db.run("INSERT INTO fold_mark (user, mark) VALUES (?, ?) ON CONFLICT (user) DO UPDATE SET mark = excluded.mark", [user, crypto.randomUUID()]);
  }

  /** @internal A state held in memory: one folded under `mark`, or one that holds under any. */
  cached(key: string, mark?: string): Cached | null {
    const hit = this.folds.get(key);
    if (!hit || (hit.mark !== null && hit.mark !== mark)) return null;
    this.folds.delete(key);
    this.folds.set(key, hit);
    return hit;
  }

  /** @internal */ keep(key: string, folded: Folded, upto: number, mark: string | null): void {
    this.folds.delete(key);
    this.folds.set(key, { mark, folded, upto });
    for (const oldest of this.folds.keys()) {
      if (this.folds.size <= this.foldsKept) break;
      this.folds.delete(oldest);
    }
  }

  /** @internal Holds snapshots (node, upto, state as JSON) a fold under `mark` found worth storing, for the user's next write. */
  hold(user: string, mark: string, rows: readonly [string, number, string][]): void {
    if (rows.length === 0) return;
    let held = this.held.get(user);
    if (!held || held.mark !== mark) {
      held = { mark, rows: new Map() };
      this.held.set(user, held);
    }
    for (const [node, upto, state] of rows) {
      held.rows.delete(node);
      held.rows.set(node, { upto, state });
    }
    for (const oldest of held.rows.keys()) {
      if (held.rows.size <= this.foldsKept) break;
      held.rows.delete(oldest);
    }
  }

  /** @internal Stores the user's held snapshots while the mark they were folded under still holds; inside a write. */
  flush(user: string): void {
    const held = this.held.get(user);
    if (!held) return;
    this.held.delete(user);
    if (held.mark !== this.markOf(user)) return;
    const put = this.db.query<unknown, [string, string, string, number, string, number]>(
      "INSERT OR REPLACE INTO snapshot (user, node, kind, fingerprint, upto, state, created) SELECT ?1, ?2, 'cache', ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM path_node WHERE user = ?1 AND key = ?2)",
    );
    const now = this.now();
    for (const [node, row] of held.rows) put.run(user, node, this.fingerprint, row.upto, row.state, now);
  }

  /** @internal */ viewOf(state: StoreState): TreeView {
    let view = this.views.get(state);
    if (!view) {
      view = new TreeView(this.env, state, this.viewOptions);
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
   * Snapshots earlier reads found are stored first, while the mark they were folded under holds. A
   * write that changes what a fold gives (`changesFolds`: changes added or taken back, a starting
   * state set, turns removed) gives the user a new fold mark before and after it, so no state folded
   * before it, or during it, is used once it is done, or once it is undone.
   */
  private write<T>(changesFolds: boolean, fn: () => T): T {
    return this.db.transaction(() => {
      this.store.flush(this.id);
      if (changesFolds) this.store.newMark(this.id);
      const out = fn();
      if (changesFolds) this.store.newMark(this.id);
      else this.store.flush(this.id);
      return out;
    })();
  }

  // ------------------------------------------------------------ chats

  /** A new chat, starting on `revision` of `world`. */
  createChat(input: { id: string; world?: WorldId | null; revision?: RevisionId | null }): ChatRow {
    if (this.chat(input.id)) throw new StoreInputError(`chat ${input.id} exists`);
    this.write(false, () => this.db.run("INSERT INTO chat (user, id, world, revision, created) VALUES (?, ?, ?, ?, ?)", [this.id, input.id, input.world ?? null, input.revision ?? null, this.store.now()]));
    return this.chat(input.id) as ChatRow;
  }

  chat(id: string): ChatRow | null {
    const r = this.db.query<ChatDb, [string, string]>("SELECT * FROM chat WHERE user = ? AND id = ?").get(this.id, id);
    return r ? chatOf(r) : null;
  }

  /** The user's chats, oldest first; a chat deleted while a branch still shares its turns is left out. Each chat's path is not read. */
  chats(): ChatRow[] {
    return this.db
      .query<ChatDb, [string]>("SELECT id, world, revision, source_chat, source_message, head, '' AS path, created, deleted FROM chat WHERE user = ? AND deleted IS NULL ORDER BY created, rowid")
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
    this.write(true, () => {
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
    const r = this.db.query<ChatDb, [string, string]>("SELECT * FROM chat WHERE user = ? AND id = ?").get(this.id, id);
    if (!r) throw new StoreInputError(`no chat ${id}`);
    return r;
  }

  /**
   * A branch (plan §6.3): a new chat whose messages carry new ids for the source chat's, by the
   * old-to-new map the chat application gave when it made the copy. The branch's path finds the
   * source's turns through the map, so shared history is shared, not copied.
   */
  branchChat(input: { id: string; from: string; map: Readonly<Record<string, string>>; at?: string | null }): ChatRow {
    const source = this.chatOrThrow(input.from);
    if (this.chat(input.id)) throw new StoreInputError(`chat ${input.id} exists`);
    this.write(false, () => {
      this.db.run("INSERT INTO chat (user, id, world, revision, source_chat, source_message, created) VALUES (?, ?, ?, ?, ?, ?, ?)", [this.id, input.id, source.world, source.revision, input.from, input.at ?? null, this.store.now()]);
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
        this.db.run("UPDATE chat SET deleted = ?, path = '[]', head = NULL WHERE user = ? AND id = ?", [this.store.now(), this.id, id]);
        this.db.run("DELETE FROM session WHERE user = ? AND chat = ?", [this.id, id]);
      });
      return { kept: true };
    }
    this.write(true, () => {
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
    this.db.run(`DELETE FROM change WHERE user = ?1 AND turn IN (${turns})`, [this.id, id]);
    this.db.run(`DELETE FROM path_node WHERE user = ?1 AND turn IN (${turns})`, [this.id, id]);
    for (const table of ["turn", "session", "message_link"]) this.db.run(`DELETE FROM ${table} WHERE user = ? AND chat = ?`, [this.id, id]);
    this.db.run("DELETE FROM chat WHERE user = ? AND id = ?", [this.id, id]);
  }

  /**
   * Whether a chat has been played on RPE: it holds a turn RPE began itself, or a change RPE recorded
   * on one of its turns (an import gives every change it writes the source `import`).
   */
  isPlayed(chat: string): boolean {
    this.chatOrThrow(chat);
    const r = this.db
      .query<{ played: number }, [string, string]>(
        `SELECT EXISTS(SELECT 1 FROM turn WHERE user = ?1 AND chat = ?2 AND imported = 0)
             OR EXISTS(SELECT 1 FROM change c JOIN turn t ON t.user = c.user AND t.id = c.turn WHERE c.user = ?1 AND t.chat = ?2 AND (c.source IS NULL OR c.source <> 'import')) AS played`,
      )
      .get(this.id, chat);
    return r?.played === 1;
  }

  /**
   * Removes everything an import wrote for a chat that has not been played on RPE, so the next
   * migration run can import it afresh: its turns, their changes, the snapshots and starting states on
   * its paths, its links and the chat itself; and the same for every branch made from it, whose
   * history its turns are. When it or one of those branches has been played, nothing is removed and
   * the played ones are listed.
   */
  forgetImport(chat: string): { removed: string[]; played: string[] } {
    if (!this.chat(chat)) return { removed: [], played: [] };
    const chats = [chat];
    for (let i = 0; i < chats.length; i++) {
      const branches = this.db.query<{ chat: string }, [string, string]>("SELECT DISTINCT chat FROM message_link WHERE user = ? AND source_chat = ?").all(this.id, chats[i] ?? "");
      for (const b of branches) if (!chats.includes(b.chat)) chats.push(b.chat);
    }
    const played = chats.filter((c) => this.isPlayed(c));
    if (played.length > 0) return { removed: [], played };
    this.write(true, () => {
      for (const c of chats) this.removeChat(c);
    });
    return { removed: chats, played: [] };
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
   * The path node for `turn`, one of this user's, standing after the node `on` (null: at the
   * start), made if new. For importers that rebuild a recorded path.
   */
  extendPath(on: string | null, turn: string): string {
    this.turnOrThrow(turn);
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
      const path = JSON.parse(chat.path) as PathEntry[];
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
   * reply it shares); anything else waits for the next comparison (`sync`).
   */
  tieTurn(id: string, input: { message: string; hash: string; date?: number | null; status?: "done" | "cut" }): TurnRow {
    const t = this.turnOrThrow(id);
    if (t.status === "dropped") throw new StoreInputError(`turn ${id} was dropped`);
    // A finished turn every `snapshotEvery` along its path keeps its state, so a cold start is short.
    const keep = (t.depth + 1) % this.store.snapshotEvery === 0 ? this.foldNode(t.node) : null;
    this.write(false, () => {
      this.db.run("UPDATE turn SET message = ?, hash = ?, swipe_date = ?, status = ?, edited = NULL WHERE user = ? AND id = ?", [input.message, input.hash, input.date ?? null, input.status ?? "done", this.id, id]);
      this.joinPath(t, { message: input.message, user: false, turn: id, node: t.node, own: true, hash: input.hash, date: input.date ?? null });
      if (keep) {
        const doc: SnapshotDoc = { state: keep.folded.state, notApplied: keep.folded.notApplied, rebased: keep.folded.rebased };
        this.db.run("INSERT OR REPLACE INTO snapshot (user, node, kind, fingerprint, upto, state, created) VALUES (?, ?, 'cache', ?, ?, ?, ?)", [this.id, t.node, this.store.fingerprint, keep.upto, JSON.stringify(doc), this.store.now()]);
      }
    });
    return this.turnOrThrow(id);
  }

  /**
   * A tied turn joins its chat's path where it extends it: a new reply after the head, a swipe of the newest reply, or a turn begun
   * after the turn its message holds, which takes that turn's place there with its own node, so the path still runs through that
   * turn. Inside a write.
   */
  private joinPath(t: TurnRow, entry: PathEntry): void {
    const chat = this.chatOrThrow(t.chat);
    const path = JSON.parse(chat.path) as PathEntry[];
    const prev = this.db.query<{ prev: string | null }, [string, string]>("SELECT prev FROM path_node WHERE user = ? AND key = ?").get(this.id, t.node)?.prev ?? null;
    const at = path.findIndex((e) => e.message === entry.message);
    if (at < 0) {
      if (prev !== chat.head) return;
      path.push(entry);
    } else {
      const before = path.slice(0, at).findLast((e) => e.node !== null)?.node ?? null;
      const goesOn = path[at]?.turn === t.parent && path[at]?.node === prev;
      if ((before !== prev && !goesOn) || path.slice(at + 1).some((e) => e.turn !== null)) return;
      path[at] = entry;
    }
    this.db.run("UPDATE chat SET path = ?, head = ? WHERE user = ? AND id = ?", [JSON.stringify(path), t.node, this.id, t.chat]);
  }

  /** A turn whose generation stopped with nothing saved: it never joins a path. */
  dropTurn(id: string): TurnRow {
    const t = this.turnOrThrow(id);
    if (t.status !== "open") throw new StoreInputError(`turn ${id} is ${t.status}, not open`);
    this.write(false, () => this.db.run("UPDATE turn SET status = 'dropped' WHERE user = ? AND id = ?", [this.id, id]));
    return this.turnOrThrow(id);
  }

  updateTurn(id: string, input: { intent?: string | null; storyTime?: number | null; timings?: JsonValue | null; tokensIn?: number | null; tokensOut?: number | null }): TurnRow {
    this.turnOrThrow(id);
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

  /** The (chat, message) pairs a chat's message is: its own, and through branch links its sources'. */
  private sources(chat: string, messages: readonly string[]): Map<string, { chat: string; message: string }[]> {
    const out = new Map<string, { chat: string; message: string }[]>(messages.map((m) => [m, [{ chat, message: m }]]));
    let frontier: [string, string, string][] = messages.map((m) => [m, chat, m]);
    for (let guard = 0; frontier.length > 0 && guard < 32; guard++) {
      const links = this.db
        .query<{ shown: string; source_chat: string; source_message: string }, [string, string]>(
          "SELECT json_extract(j.value, '$[0]') AS shown, l.source_chat, l.source_message FROM json_each(?2) j CROSS JOIN message_link l ON l.user = ?1 AND l.chat = json_extract(j.value, '$[1]') AND l.message = json_extract(j.value, '$[2]')",
        )
        .all(this.id, JSON.stringify(frontier));
      frontier = links.map((l) => [l.shown, l.source_chat, l.source_message]);
      for (const l of links) out.get(l.shown)?.push({ chat: l.source_chat, message: l.source_message });
    }
    return out;
  }

  /** The turns tied to each of a chat's messages, through branch links too. */
  private tiedTo(chat: string, messages: readonly string[]): Map<string, TurnRow[]> {
    const pairs = this.sources(chat, messages);
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

  path(chat: string): PathEntry[] {
    return JSON.parse(this.chatOrThrow(chat).path) as PathEntry[];
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
   * turn there, and turns after an earlier reply's flipped swipe stand rebased, their changes
   * applied again on the swipe now showing. The report says what it found, with what no longer
   * applies on the new path.
   */
  sync(chat: string, shown: readonly ShownMessage[]): PathReport {
    const row = this.chatOrThrow(chat);
    const before = JSON.parse(row.path) as PathEntry[];
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
    const tied = this.tiedTo(chat, [...again]);
    const edited: PathReport["edited"] = [];
    // Turns whose edited flag changes: the hash the reply shows now, or null once it shows as saved again.
    const flags: [string, string | null][] = [];
    const after: PathEntry[] = [];
    for (const m of shown) {
      if (m.user) {
        after.push({ message: m.id, user: true, turn: null, node: null, own: null, hash: m.hash, date: date(m) });
        continue;
      }
      let turn: string | null = was.get(m.id)?.turn ?? null;
      if (again.has(m.id)) {
        const match = matchTurn(tied.get(m.id) ?? [], m, turn);
        turn = match.turn?.id ?? null;
        if (match.turn && match.edited && match.turn.edited !== m.hash) {
          edited.push({ turn: match.turn.id, message: m.id, saved: match.turn.hash ?? "", now: m.hash });
          flags.push([match.turn.id, m.hash]);
        } else if (match.turn && !match.edited && match.turn.edited !== null) flags.push([match.turn.id, null]);
      }
      after.push({ message: m.id, user: false, turn, node: null, own: null, hash: m.hash, date: date(m) });
    }
    // Path nodes: the same as last time as long as the turns before them are; new ones after that. A turn begun after the turn its
    // own message holds (a branch's continue of a reply it shares) has a new node chained after one for that turn, which stays on the
    // line (`line`). A turn whose parent stands at the reply before it (one rebased after a flipped swipe) is chained as it stands.
    const oldTurns = before.filter((e) => e.turn !== null);
    const held = after.flatMap((e) => (e.turn === null ? [] : [{ turn: e.turn, message: e.message }]));
    const parents = new Map(
      this.db
        .query<{ id: string; parent: string | null }, [string, string]>("SELECT t.id, t.parent FROM json_each(?2) j CROSS JOIN turn t ON t.user = ?1 AND t.id = j.value")
        .all(this.id, JSON.stringify(held.map((h) => h.turn)))
        .map((r) => [r.id, r.parent]),
    );
    const asked = held.flatMap((h, at) => {
      const parent = parents.get(h.turn) ?? null;
      return parent !== null && parent !== (held[at - 1]?.turn ?? null) ? [{ ...h, parent }] : [];
    });
    const atMessage = asked.length === 0 ? new Map<string, TurnRow[]>() : this.tiedTo(chat, asked.map((a) => a.message));
    const standsAfter = new Map(asked.flatMap((a) => ((atMessage.get(a.message) ?? []).some((t) => t.id === a.parent) ? [[a.turn, a.parent] as const] : [])));
    const depths = new Map(
      this.db
        .query<{ key: string; depth: number }, [string, string]>("SELECT n.key, n.depth FROM json_each(?2) j CROSS JOIN path_node n ON n.user = ?1 AND n.key = j.value")
        .all(this.id, JSON.stringify(oldTurns.flatMap((e) => (e.node === null ? [] : [e.node]))))
        .map((r) => [r.key, r.depth]),
    );
    let prev: string | null = null;
    let depth = 0;
    let same = true;
    let k = 0;
    const nodes: [string, string | null, string, number][] = [];
    const fresh: PathEntry[] = [];
    for (const e of after) {
      if (e.turn === null) continue;
      const old = oldTurns[k++];
      same &&= old !== undefined && old.turn === e.turn && old.node !== null;
      if (same && old && old.node !== null) {
        e.node = old.node;
        e.own = old.own;
        depth = (depths.get(old.node) ?? depth) + 1;
      } else {
        const first = standsAfter.get(e.turn);
        if (first !== undefined) {
          const key = nodeKey(prev, first);
          nodes.push([key, prev, first, depth++]);
          prev = key;
        }
        e.node = nodeKey(prev, e.turn);
        nodes.push([e.node, prev, e.turn, depth++]);
        fresh.push(e);
      }
      prev = e.node;
    }
    const ownNodes = new Map(
      this.db
        .query<{ id: string; node: string }, [string, string]>("SELECT t.id, t.node FROM json_each(?2) j CROSS JOIN turn t ON t.user = ?1 AND t.id = j.value")
        .all(this.id, JSON.stringify(fresh.map((e) => e.turn)))
        .map((r) => [r.id, r.node]),
    );
    for (const e of fresh) e.own = e.turn !== null && ownNodes.get(e.turn) === e.node;
    const found = comparePaths(before, after);
    const branched = row.source_chat !== null && before.length === 0 && after.length > 0 ? { from: row.source_chat, at: row.source_message } : null;
    // What no longer applies is folded inside the write, so the snapshots that fold finds are stored with it.
    const notApplied = this.write(false, () => {
      const flag = this.db.query("UPDATE turn SET edited = ? WHERE user = ? AND id = ?");
      for (const [turn, hash] of flags) flag.run(hash, this.id, turn);
      const put = this.db.query("INSERT OR IGNORE INTO path_node (user, key, prev, turn, depth) VALUES (?, ?, ?, ?, ?)");
      for (const [key, p, turn, d] of nodes) put.run(this.id, key, p, turn, d);
      this.db.run("UPDATE chat SET path = ?, head = ? WHERE user = ? AND id = ?", [JSON.stringify(after), prev, this.id, chat]);
      return found.rebased ? this.headState(chat).notApplied : [];
    });
    return { ...found, edited, branched, notApplied };
  }

  // ------------------------------------------------------------ changes

  /** A turn's changes, in order. */
  changes(turn: string): ChangeRow[] {
    return this.db.query<ChangeDb, [string, string]>("SELECT * FROM change WHERE user = ? AND turn = ? ORDER BY ord").all(this.id, turn).map(changeOf);
  }

  /**
   * Records changes on a turn, in order, each applied by its handler on the state inside the turn.
   * Nothing is refused for what it says: a change that does not apply is recorded with its report
   * and stays unapplied. Grouped events are one unit only within one call. A turn takes changes
   * while open, and after it is tied too (a job's, a correction's). The state returned is the
   * store's own, held for the next call: read it, never change it. A job's changes are recorded with
   * the turn that started it and take effect once the job has ended (`endJob`), before the next turn
   * to begin; until then only the job sees them: each is checked on the job's own state (`stateFor`),
   * and the state returned for them is that one.
   */
  addChanges(turnId: string, inputs: readonly ChangeInput[]): { changes: ChangeRow[]; state: StoreState } {
    const turn = this.turnOrThrow(turnId);
    if (turn.status === "dropped") throw new StoreInputError(`turn ${turnId} was dropped`);
    inputs.forEach((c, i) => checkChange(c, i));
    const jobs = [...new Set(inputs.flatMap((c) => (c.job ? [c.job] : [])))];
    const ended = jobs.find((j) => this.db.query<{ job: string }, [string, string]>("SELECT job FROM job_end WHERE user = ? AND job = ?").get(this.id, j) !== null);
    if (ended !== undefined) throw new StoreInputError(`job ${ended} has ended: it records nothing more`);
    const inside = this.foldNode(turn.node);
    const own = jobs.length === 1 && inputs.every((c) => c.job === jobs[0]) ? (jobs[0] ?? null) : null;
    const state = structuredClone((own === null ? inside.folded : this.stateFor(turnId, own)).state);
    const existing = this.changes(turnId);
    // Groups that did not land earlier in the turn: a unit tied to one does not land either.
    const fell = new Set(existing.filter((c) => !c.applied).flatMap((c) => (isRecord(c.value) && typeof c.value.group === "string" ? [c.value.group] : [])));
    const items: Item[] = inputs.map((c) => ({ op: c.op, value: c.value, turn: turnId, n: turn.depth + 1, by: c.by ?? null, precision: c.precision ?? null, standing: c.standing ?? null, source: c.source ?? null }));
    const outcomes = applyChecked(this.store.env, state, items, fell);
    const now = this.store.now();
    let ord = (existing.at(-1)?.ord ?? -1) + 1;
    const ids = this.write(true, () => {
      const put = this.db.query("INSERT INTO change (user, turn, ord, lane, op, value, by, standing, precision, source, cite, job, applied, reports, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const made = inputs.map((c, i) => {
        const o = outcomes[i] ?? { applied: false, reports: [] };
        const cite = c.cite === undefined || c.cite === null ? null : JSON.stringify(c.cite);
        return Number(put.run(this.id, turnId, ord++, c.lane, c.op, JSON.stringify(c.value), c.by ?? null, c.standing ?? null, c.precision ?? null, c.source ?? null, cite, c.job ?? null, o.applied ? 1 : 0, o.reports.length > 0 ? JSON.stringify(o.reports) : null, now).lastInsertRowid);
      });
      this.dropSnapshotsThrough(turnId);
      return made;
    });
    // The state inside the turn now, held under the mark the write left: it stands only if the write does. A job's changes are not the turn's.
    if (jobs.length === 0) this.store.keep(this.cacheKey(turn.node), { ...inside.folded, state }, Math.max(inside.upto, ...ids), this.store.markOf(this.id));
    const rows = this.db.query<ChangeDb, [string, string]>("SELECT * FROM change WHERE user = ?1 AND id IN (SELECT value FROM json_each(?2)) ORDER BY ord").all(this.id, JSON.stringify(ids)).map(changeOf);
    return { changes: rows, state };
  }

  /** Takes back an open turn's staged changes, all or one agent's (the lead dropping a sub-agent's writes). How many went. */
  dropStaged(turnId: string, by?: string): number {
    const turn = this.turnOrThrow(turnId);
    if (turn.status !== "open") throw new StoreInputError(`turn ${turnId} is ${turn.status}: only an open turn's staged changes can be taken back`);
    return this.write(true, () => {
      const r = by === undefined ? this.db.run("DELETE FROM change WHERE user = ? AND turn = ?", [this.id, turnId]) : this.db.run("DELETE FROM change WHERE user = ? AND turn = ? AND by = ?", [this.id, turnId, by]);
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
    const turn = this.turnOrThrow(turnId);
    if (turn.status === "dropped") throw new StoreInputError(`turn ${turnId} was dropped`);
    return this.write(true, () => {
      const r = this.db.run("DELETE FROM change WHERE user = ? AND turn = ? AND ord > ? AND job IS NULL", [this.id, turnId, after]);
      this.dropSnapshotsThrough(turnId);
      return r.changes;
    });
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

  /** State at a turn, along the path it was made on; inside an open turn, with its staged changes. */
  stateAt(turnId: string): Folded {
    return this.foldNode(this.turnOrThrow(turnId).node).folded;
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
    const state = structuredClone(at.state);
    applyChecked(this.store.env, state, own.map((c): Item => ({ op: c.op, value: c.value, turn: turnId, n: turn.depth + 1, by: c.by, precision: c.precision, standing: c.standing, source: c.source })), new Set());
    return { ...at, state };
  }

  /**
   * The state a turn started from, along the path it was made on: before any change of its own. What
   * a briefing at its start was shown, whatever the turn recorded since.
   */
  startOf(turnId: string): Folded {
    const t = this.turnOrThrow(turnId);
    const prev = this.db.query<{ prev: string | null }, [string, string]>("SELECT prev FROM path_node WHERE user = ? AND key = ?").get(this.id, t.node)?.prev ?? null;
    return prev === null ? this.initial(this.chatOrThrow(t.chat).revision) : this.foldNode(prev).folded;
  }

  /** State at the end of the chat's path: rebased turns' changes applied again where they now stand. */
  headState(chat: string): Folded {
    const row = this.chatOrThrow(chat);
    if (row.head === null) return this.initial(row.revision);
    return this.foldNode(row.head).folded;
  }

  /**
   * A starting state that stands for the engine's state after a turn on its own path (a migrated
   * chat's, where today's fold and this one differ, plan §15.3 item 7): folds start from it, whatever
   * the turns before it hold, and a change recorded on the turn afterwards (a correction) is folded on
   * top of it. What the store keeps beside the engine's state (the horizon, agents' lines, what
   * changed last) is the turn's own as folded.
   */
  setBase(turnId: string, world: WorldState): void {
    const turn = this.turnOrThrow(turnId);
    const own = this.foldNode(turn.node).folded.state;
    const doc: SnapshotDoc = { state: { ...own, world }, notApplied: [], rebased: [] };
    this.write(true, () => {
      // Every change of this user's recorded so far stands within the base or before it; ids only grow.
      const upto = this.db.query<{ n: number | null }, [string]>("SELECT max(id) AS n FROM change WHERE user = ?").get(this.id)?.n ?? 0;
      this.db.run("INSERT OR REPLACE INTO snapshot (user, node, kind, fingerprint, upto, state, created) VALUES (?, ?, 'base', ?, ?, ?, ?)", [this.id, turn.node, this.store.fingerprint, upto, JSON.stringify(doc), this.store.now()]);
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
    this.store.keep(key, folded, 0, null);
    return folded;
  }

  private cacheKey(node: string): string {
    return `${this.id}\u0000${node}`;
  }

  /**
   * Folds the path ending at `node`, from the nearest state on it held in memory under the user's
   * fold mark, else stored, else the chat's start. It writes nothing: the snapshots it finds worth
   * storing wait for the user's next write.
   */
  private foldNode(node: string): { folded: Folded; upto: number } {
    const mark = this.store.markOf(this.id);
    const hit = this.store.cached(this.cacheKey(node), mark);
    if (hit) return { folded: hit.folded, upto: hit.upto };
    // The path back to the nearest stored snapshot this code may use, or to the start.
    const chain = this.db
      .query<{ key: string; prev: string | null; turn: string; depth: number; snap: number }, [string, string, string]>(
        `WITH RECURSIVE up(key, prev, turn, depth, snap) AS (
           SELECT n.key, n.prev, n.turn, n.depth, EXISTS(SELECT 1 FROM snapshot s WHERE s.user = n.user AND s.node = n.key AND (s.kind = 'base' OR s.fingerprint = ?2))
           FROM path_node n WHERE n.user = ?1 AND n.key = ?3
           UNION ALL
           SELECT n.key, n.prev, n.turn, n.depth, EXISTS(SELECT 1 FROM snapshot s WHERE s.user = n.user AND s.node = n.key AND (s.kind = 'base' OR s.fingerprint = ?2))
           FROM path_node n JOIN up ON n.user = ?1 AND n.key = up.prev WHERE up.snap = 0)
         SELECT key, prev, turn, depth, snap FROM up ORDER BY depth`,
      )
      .all(this.id, this.store.fingerprint, node);
    if (chain.length === 0) throw new StoreInputError(`no path node ${node}`);
    // Start from the latest state held in memory, else the stored snapshot, else the chat's start.
    let from = -1;
    let start: { state: StoreState; upto: number; notApplied: Folded["notApplied"]; rebased: string[] } | null = null;
    for (let i = chain.length - 2; i >= 0; i--) {
      const key = chain[i]?.key;
      const held = key === undefined ? null : this.store.cached(this.cacheKey(key), mark);
      if (!held) continue;
      from = i;
      start = { state: structuredClone(held.folded.state), upto: held.upto, notApplied: [...held.folded.notApplied], rebased: [...held.folded.rebased] };
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
        const doc = JSON.parse(snap.state) as SnapshotDoc;
        // A starting state set before the store kept facts and marks holds none yet.
        doc.state.marks ??= {};
        doc.state.facts ??= {};
        from = 0;
        stored = snap.upto;
        start = { state: doc.state, upto: snap.upto, notApplied: doc.notApplied, rebased: doc.rebased };
      }
    }
    if (!start) {
      const opener = this.db.query<{ revision: string | null }, [string, string]>("SELECT c.revision FROM turn t JOIN chat c ON c.user = t.user AND c.id = t.chat WHERE t.user = ? AND t.id = ?").get(this.id, first.turn);
      const init = this.initial(opener?.revision ?? null);
      start = { state: structuredClone(init.state), upto: 0, notApplied: [], rebased: [] };
    }
    const rest = chain.slice(from + 1);
    const ids = JSON.stringify((stored === null ? rest : [first, ...rest]).map((c) => c.turn));
    const turns = new Map(
      this.db
        .query<{ id: string; node: string; status: string }, [string, string]>("SELECT t.id, t.node, t.status FROM json_each(?2) j CROSS JOIN turn t ON t.user = ?1 AND t.id = j.value")
        .all(this.id, ids)
        .map((t) => [t.id, t]),
    );
    const byTurn = new Map<string, StoredChange[]>();
    for (const c of this.db
      .query<{ id: number; turn: string; op: string; lane: string; value: string; by: string | null; applied: number; precision: string | null; standing: string | null; source: string | null }, [string, string]>(
        "SELECT c.id, c.turn, c.op, c.lane, c.value, c.by, c.applied, c.precision, c.standing, c.source FROM change c WHERE c.user = ?1 AND c.turn IN (SELECT value FROM json_each(?2)) AND c.job IS NULL ORDER BY c.turn, c.ord",
      )
      .all(this.id, ids)) {
      const list = byTurn.get(c.turn) ?? [];
      list.push({ id: c.id, op: c.op, lane: c.lane as Lane, value: JSON.parse(c.value) as JsonValue, by: c.by, applied: c.applied === 1, precision: c.precision as Precision | null, standing: c.standing as Standing | null, source: c.source as Source | null });
      byTurn.set(c.turn, list);
    }
    const stepOf = (c: { key: string; turn: string; depth: number }, changes: StoredChange[]): FoldStep => ({ node: c.key, turn: c.turn, n: c.depth + 1, own: turns.get(c.turn)?.node === c.key, changes });
    const placed = this.jobsPlaced(node);
    const steps = rest.map((c): FoldStep => ({ ...stepOf(c, byTurn.get(c.turn) ?? []), jobs: placed.get(c.key) ?? [] }));
    // Changes the snapshot's own turn took after it was stored (a correction after a starting state was set) go on top of it.
    const late = (byTurn.get(first.turn) ?? []).filter((c) => c.id > (stored ?? Number.POSITIVE_INFINITY));
    if (late.length > 0) steps.unshift(stepOf(first, late));
    const every = this.store.snapshotEvery;
    const snaps: [string, number, string][] = [];
    const result = foldSteps(this.store.env, start, steps, (step, state, upto, notApplied, rebased) => {
      // Every `snapshotEvery` turns along a path, once its turn is no longer open, where none is stored.
      if (step.n % every !== 0 || turns.get(step.turn)?.status === "open" || (stored !== null && step.node === first.key)) return;
      const doc: SnapshotDoc = { state, notApplied: [...(start?.notApplied ?? []), ...notApplied], rebased: [...(start?.rebased ?? []), ...rebased] };
      snaps.push([step.node, upto, JSON.stringify(doc)]);
    });
    this.store.hold(this.id, mark, snaps);
    const folded: Folded = { node, state: result.state, notApplied: [...start.notApplied, ...result.notApplied], rebased: [...start.rebased, ...result.rebased] };
    this.store.keep(this.cacheKey(node), folded, result.upto, mark);
    return { folded, upto: result.upto };
  }

  /**
   * Jobs' changes along the path ending at `node`, by the node of the turn each takes effect just
   * before (plan §10.9): the first turn after the one that started the job to have begun after the
   * job ended. A job that has not ended, or that no turn on the path began after, has not taken effect.
   */
  private jobsPlaced(node: string): Map<string, JobChange[]> {
    const out = new Map<string, JobChange[]>();
    const path = this.db
      .query<{ key: string; turn: string; depth: number; created: number }, [string, string]>(
        `WITH RECURSIVE up(key, prev, turn, depth) AS (
           SELECT key, prev, turn, depth FROM path_node WHERE user = ?1 AND key = ?2
           UNION ALL SELECT n.key, n.prev, n.turn, n.depth FROM path_node n JOIN up ON n.user = ?1 AND n.key = up.prev)
         SELECT up.key, up.turn, up.depth, t.created FROM up JOIN turn t ON t.user = ?1 AND t.id = up.turn ORDER BY up.depth`,
      )
      .all(this.id, node);
    const jobs = this.db
      .query<{ id: number; turn: string; op: string; lane: string; value: string; by: string | null; applied: number; precision: string | null; standing: string | null; source: string | null; ended: number }, [string, string]>(
        `SELECT c.id, c.turn, c.op, c.lane, c.value, c.by, c.applied, c.precision, c.standing, c.source, e.ended FROM change c JOIN job_end e ON e.user = c.user AND e.job = c.job
         WHERE c.user = ?1 AND c.job IS NOT NULL AND c.turn IN (SELECT value FROM json_each(?2)) ORDER BY c.id`,
      )
      .all(this.id, JSON.stringify(path.map((p) => p.turn)));
    const index = new Map(path.map((p, i) => [p.turn, i]));
    for (const c of jobs) {
      const i = index.get(c.turn);
      const started = i === undefined ? undefined : path[i];
      const before = i === undefined ? undefined : path.slice(i + 1).find((p) => p.created > c.ended);
      if (!started || !before) continue;
      const change: JobChange = { id: c.id, turn: c.turn, from: started.depth + 1, op: c.op, lane: c.lane as Lane, value: JSON.parse(c.value) as JsonValue, by: c.by, applied: c.applied === 1, precision: c.precision as Precision | null, standing: c.standing as Standing | null, source: c.source as Source | null };
      out.set(before.key, [...(out.get(before.key) ?? []), change]);
    }
    return out;
  }

  /**
   * Notes that a job has ended (plan §10.9): its changes, recorded with the turn that started it, take
   * effect just before the first turn that begins from now on, so no turn begun already has its state
   * changed. A job ends once; one that has ended records nothing more.
   */
  endJob(job: string): void {
    this.write(false, () => this.db.run("INSERT OR IGNORE INTO job_end (user, job, ended) VALUES (?, ?, ?)", [this.id, job, this.store.now()]));
  }

  /**
   * What jobs changed at the start of a turn, for its briefing (plan §10.9): their changes placed just
   * before it, on the path it was made on, each with whether it took effect and what was reported.
   */
  jobsBefore(turnId: string): { change: ChangeRow; applied: boolean; reports: Report[] }[] {
    const t = this.turnOrThrow(turnId);
    const placed = this.jobsPlaced(t.node).get(t.node) ?? [];
    if (placed.length === 0) return [];
    const missed = new Map(this.stateAt(t.id).notApplied.map((n) => [n.change, n.reports]));
    const rows = new Map(placed.map((c) => [c.id, this.changeOrThrow(c.id)]));
    return placed.map((c) => ({ change: rows.get(c.id) as ChangeRow, applied: !missed.has(c.id), reports: missed.get(c.id) ?? [] }));
  }

  // ------------------------------------------------------------ sessions

  /** A session: the scene it is, opened by a turn of the user's. */
  openSession(input: { chat: string; scene: string; turn: string }): SessionRow {
    this.chatOrThrow(input.chat);
    this.turnOrThrow(input.turn);
    const id = crypto.randomUUID();
    this.write(false, () => this.db.run("INSERT INTO session (user, id, chat, scene, opened_by) VALUES (?, ?, ?, ?, ?)", [this.id, id, input.chat, input.scene, input.turn]));
    return this.session(id) as SessionRow;
  }

  closeSession(id: string, turn: string): SessionRow {
    if (!this.session(id)) throw new StoreInputError(`no session ${id}`);
    this.turnOrThrow(turn);
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
   * Keeps a world revision's document (plan §4.5) for chats that play it, under the id chats and
   * markers name it by. A revision's document never changes, so one already kept stays as it is.
   * Whether it was added.
   */
  putWorld(revision: RevisionId, doc: WorldDoc): boolean {
    if (revision === "" || revision === BLANK_REVISION) throw new StoreInputError(`"${revision}" cannot name a kept revision: the blank world is the store's own`);
    if (!isWorldDoc(doc)) throw new StoreInputError(`revision ${revision} is not a world document`);
    return this.write(false, () => this.db.run("INSERT INTO world_revision (user, revision, world, doc, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user, revision) DO NOTHING", [this.id, revision, doc.id, JSON.stringify(doc), this.store.now()]).changes > 0);
  }

  /** A kept revision's document, read as today's world store reads one; null when this user keeps no such revision. */
  worldDoc(revision: RevisionId): WorldDoc | null {
    const row = this.db.query<{ doc: string }, [string, string]>("SELECT doc FROM world_revision WHERE user = ? AND revision = ?").get(this.id, revision);
    return row ? readWorldDoc(row.doc) : null;
  }

  /** The revisions this user keeps, of one world or of all, oldest first. */
  worldRevisions(world?: WorldId): WorldRevisionRow[] {
    const rows =
      world === undefined
        ? this.db.query<WorldRevisionRow, [string]>("SELECT revision, world, created FROM world_revision WHERE user = ? ORDER BY created, rowid").all(this.id)
        : this.db.query<WorldRevisionRow, [string, string]>("SELECT revision, world, created FROM world_revision WHERE user = ? AND world = ? ORDER BY created, rowid").all(this.id, world);
    return rows.map((r) => ({ revision: r.revision, world: r.world, created: r.created }));
  }

  /**
   * Keeps every world revision the migration carried for this user (its `world_file` table, plan
   * §15.2), so the chats it imported play their worlds. A revision already kept stays as it is; a file
   * that does not read as a world document is left out and listed. The migration calls it after a run.
   */
  copyMigratedWorlds(): { added: number; held: number; unreadable: { world: WorldId; revision: RevisionId }[] } {
    if (!this.db.query<{ n: number }, []>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'world_file'").get()?.n) {
      throw new StoreSchemaError("This database holds no world_file table: the migration's tables are not here, so it carried no worlds into it.");
    }
    const files = this.db.query<{ world: string; file: string; bytes: Uint8Array }, [string]>("SELECT world, file, bytes FROM world_file WHERE user = ? ORDER BY world, file").all(this.id);
    const decoder = new TextDecoder();
    const unreadable: { world: WorldId; revision: RevisionId }[] = [];
    let added = 0;
    let held = 0;
    this.write(false, () => {
      const put = this.db.query("INSERT INTO world_revision (user, revision, world, doc, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user, revision) DO NOTHING");
      const now = this.store.now();
      for (const f of files) {
        const revision = MIGRATED_REVISION.exec(f.file)?.[1];
        if (revision === undefined) continue;
        const text = decoder.decode(f.bytes);
        if (!readWorldDoc(text)) {
          unreadable.push({ world: f.world, revision });
          continue;
        }
        if (put.run(this.id, revision, f.world, text, now).changes > 0) added++;
        else held++;
      }
    });
    return { added, held, unreadable };
  }

  // ------------------------------------------------------------ undo and the review card

  private changeOrThrow(id: number): ChangeRow {
    const r = this.db.query<ChangeDb, [string, number]>("SELECT * FROM change WHERE user = ? AND id = ?").get(this.id, id);
    if (!r) throw new StoreInputError(`no change ${id}`);
    return changeOf(r);
  }

  /**
   * What undoing a change would record and leave, read against the chat's newest reply, with the turn
   * of that reply, where the undo goes; none for a change no longer on the chat's path.
   */
  private undoPlan(c: ChangeRow, turn: TurnRow, own: readonly ChangeRow[]): { plan: UndoPlan; on: string | null } {
    const chat = this.chatOrThrow(turn.chat);
    const onPath = (JSON.parse(chat.path) as PathEntry[]).some((e) => e.turn === turn.id);
    const head = chat.head === null ? null : (this.db.query<{ turn: string }, [string, string]>("SELECT turn FROM path_node WHERE user = ? AND key = ?").get(this.id, chat.head)?.turn ?? null);
    if (!onPath || head === null) return { plan: { inputs: [], left: [{ code: "not_on_path", values: { change: c.id, op: c.op } }] }, on: null };
    // The change with the rest of its unit: the changes of its turn that share its group.
    const group = isRecord(c.value) && typeof c.value.group === "string" ? c.value.group : null;
    const unit = group === null ? [c] : own.filter((x) => isRecord(x.value) && x.value.group === group);
    const first = unit[0]?.ord ?? c.ord;
    // The state just before the unit: the turn's start, and what the turn recorded before it.
    const before = structuredClone(this.startOf(turn.id).state);
    const earlier = own.filter((x) => x.applied && x.job === null && x.ord < first);
    applyUnchecked(this.store.env, before, earlier.map((x): Item => ({ op: x.op, value: x.value, turn: turn.id, n: turn.depth + 1, by: x.by, precision: x.precision, standing: x.standing, source: x.source })));
    return { plan: reversal(unit, before, this.headState(chat.id).state), on: head };
  }

  /**
   * Undoes one change (plan §6.8): records the changes that reverse it after the chat's newest reply,
   * with source `player`, each citing the change it undoes. Nothing recorded is taken away. What would
   * be left is listed; when a later change has written the same part since, nothing is recorded. A
   * change still staged in an open turn is taken back with `dropStaged` instead.
   */
  undo(changeId: number, by: string | null = "player"): { changes: ChangeRow[]; left: Report[] } {
    const c = this.changeOrThrow(changeId);
    const turn = this.turnOrThrow(c.turn);
    if (turn.status === "open") throw new StoreInputError(`change ${changeId} is staged in an open turn: dropStaged takes it back`);
    const { plan, on } = this.undoPlan(c, turn, this.changes(turn.id));
    if (on === null || plan.inputs.length === 0) return { changes: [], left: plan.left };
    const inputs = plan.inputs.map((i): ChangeInput => ({ ...i, by, source: "player", cite: { undoes: changeId } }));
    return { changes: this.addChanges(on, inputs).changes, left: plan.left };
  }

  /**
   * What the review card shows of a turn (plan §6.8): its changes by lane, each with its undo — the
   * operations undoing it would record and what would be left — and the changes that already undid it.
   */
  reviewCard(turnId: string): { lane: Lane; changes: { change: ChangeRow; undo: { ops: string[]; left: Report[] }; undoneBy: number[] }[] }[] {
    const turn = this.turnOrThrow(turnId);
    const own = this.changes(turn.id);
    const undone = new Map<number, number[]>();
    for (const r of this.db.query<{ id: number; undoes: number }, [string, string]>("SELECT c.id, json_extract(c.cite, '$.undoes') AS undoes FROM change c JOIN turn t ON t.user = c.user AND t.id = c.turn WHERE c.user = ? AND t.chat = ? AND json_extract(c.cite, '$.undoes') IS NOT NULL ORDER BY c.id").all(this.id, turn.chat)) {
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
}
