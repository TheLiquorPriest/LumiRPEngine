// RPE's store of chats, turns and changes (plan §6.3, Appendix B), on bun:sqlite. A turn is one reply
// attempt, tied to its message by the saved text's hash and the swipe's date; swipes are siblings;
// a chat's path is the chain of its showing swipes. Changes are only ever added (an open turn's
// staged ones aside), each with its lane, and state at any point is folded from the nearest
// snapshot along the exact path to it. Each chat's current state is held in memory.
//
// Every row carries the user: `store.user(id)` answers for one user only.

import { Database } from "bun:sqlite";
import { hashParts } from "../shared/hash";
import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { RevisionId, WorldId } from "../shared/ids";
import type { WorldDoc } from "../shared/world";
import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { applyChecked, foldSteps, initialStoreState, type FoldEnv, type FoldStep, type Item, type StoredChange } from "./fold";
import { checkChange } from "./input";
import { comparePaths, matchTurn, nodeKey } from "./path";
import { migrateStore } from "./schema";
import { TreeView } from "./view";
import {
  StoreInputError,
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
  /** Folded states held in memory, the least recently used going first. */
  foldsKept: 32,
  /** Fields that only describe a level of the tree and never pass down to what is inside it. */
  ownOnly: Object.freeze(["description", "tags"]) as readonly string[],
  /** Names of note in each reflection. */
  notable: 3,
});

/** Bumped whenever this fold's output for the same changes would differ: snapshots made before are not used. */
const FOLD_VERSION = 1;

export interface StoreOptions {
  /** A database file's path, `:memory:`, or an open database. */
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
  epoch: number;
  folded: Folded;
  upto: number;
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
    job: r.job,
    applied: r.applied === 1,
    reports: r.reports === null ? [] : (JSON.parse(r.reports) as Report[]),
    created: r.created,
  };
}

function chatOf(r: ChatDb): ChatRow {
  return { id: r.id, world: r.world as WorldId | null, revision: r.revision as RevisionId | null, sourceChat: r.source_chat, sourceMessage: r.source_message, head: r.head, created: r.created, deleted: r.deleted };
}

/** Opens a store over a database, bringing its tables up to date. */
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
  /** Bumped by every write that can change a fold: cached folds from an older epoch are not used. */
  private epoch = 0;
  private readonly folds = new Map<string, Cached>();
  private readonly views = new WeakMap<StoreState, TreeView>();

  constructor(options: StoreOptions) {
    // A database the store opens itself is set up for one writer and many readers; one it is given keeps its owner's settings.
    if (typeof options.db === "string") {
      this.db = new Database(options.db, { create: true });
      this.db.run("PRAGMA journal_mode = WAL");
    } else this.db = options.db;
    migrateStore(this.db);
    this.env = { registry: options.registry, worlds: options.worlds };
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

  /** Lets go of every folded state held in memory: the next folds start from the stored snapshots. */
  dropCaches(): void {
    this.folds.clear();
  }

  close(): void {
    this.db.close();
  }

  /** @internal */ touch(): void {
    this.epoch++;
    this.folds.clear();
  }

  /** @internal */ cached(key: string): Cached | null {
    const hit = this.folds.get(key);
    if (!hit || hit.epoch !== this.epoch) return null;
    this.folds.delete(key);
    this.folds.set(key, hit);
    return hit;
  }

  /** @internal */ keep(key: string, folded: Folded, upto: number): void {
    this.folds.delete(key);
    this.folds.set(key, { epoch: this.epoch, folded, upto });
    for (const oldest of this.folds.keys()) {
      if (this.folds.size <= this.foldsKept) break;
      this.folds.delete(oldest);
    }
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

  // ------------------------------------------------------------ chats

  /** A new chat, starting on `revision` of `world`. */
  createChat(input: { id: string; world?: WorldId | null; revision?: RevisionId | null }): ChatRow {
    if (this.chat(input.id)) throw new StoreInputError(`chat ${input.id} exists`);
    this.db.run("INSERT INTO chat (user, id, world, revision, created) VALUES (?, ?, ?, ?, ?)", [this.id, input.id, input.world ?? null, input.revision ?? null, this.store.now()]);
    return this.chat(input.id) as ChatRow;
  }

  chat(id: string): ChatRow | null {
    const r = this.db.query<ChatDb, [string, string]>("SELECT * FROM chat WHERE user = ? AND id = ?").get(this.id, id);
    return r ? chatOf(r) : null;
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
    this.db.transaction(() => {
      this.db.run("INSERT INTO chat (user, id, world, revision, source_chat, source_message, created) VALUES (?, ?, ?, ?, ?, ?, ?)", [this.id, input.id, source.world, source.revision, input.from, input.at ?? null, this.store.now()]);
      const link = this.db.query("INSERT OR REPLACE INTO message_link (user, chat, message, source_chat, source_message) VALUES (?, ?, ?, ?, ?)");
      for (const [old, now] of Object.entries(input.map)) link.run(this.id, input.id, now, input.from, old);
    })();
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
      this.db.run("UPDATE chat SET deleted = ?, path = '[]', head = NULL WHERE user = ? AND id = ?", [this.store.now(), this.id, id]);
      this.db.run("DELETE FROM session WHERE user = ? AND chat = ?", [this.id, id]);
      return { kept: true };
    }
    this.db.transaction(() => {
      this.removeChat(id);
      // A deleted chat kept only for this branch goes with it.
      for (let source = row.source_chat; source !== null; ) {
        const up = this.db.query<{ deleted: number | null; source_chat: string | null; links: number }, [string, string]>("SELECT deleted, source_chat, (SELECT count(*) FROM message_link l WHERE l.user = c.user AND l.source_chat = c.id) AS links FROM chat c WHERE c.user = ? AND c.id = ?").get(this.id, source);
        if (!up || up.deleted === null || up.links > 0) break;
        this.removeChat(source);
        source = up.source_chat;
      }
    })();
    this.store.touch();
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
    this.db.transaction(() => {
      for (const c of chats) this.removeChat(c);
    })();
    this.store.touch();
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

  /** The path node for `turn` standing after the node `on` (null: at the start), made if new. For importers that rebuild a recorded path. */
  extendPath(on: string | null, turn: string): string {
    const key = nodeKey(on, turn);
    const depth = on === null ? 0 : (this.db.query<{ depth: number }, [string, string]>("SELECT depth FROM path_node WHERE user = ? AND key = ?").get(this.id, on)?.depth ?? -1) + 1;
    if (depth < 0) throw new StoreInputError(`no path node ${on}`);
    this.db.run("INSERT OR IGNORE INTO path_node (user, key, prev, turn, depth) VALUES (?, ?, ?, ?, ?)", [this.id, key, on, turn, depth]);
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
    this.db.transaction(() => {
      this.db.run("INSERT INTO path_node (user, key, prev, turn, depth) VALUES (?, ?, ?, ?, ?)", [this.id, node, on, id, base ? base.depth + 1 : 0]);
      this.db.run("INSERT INTO turn (user, id, chat, parent, node, depth, kind, imported, generation, status, intent, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)", [this.id, id, input.chat, base?.turn ?? null, node, base ? base.depth + 1 : 0, input.kind, input.imported === true ? 1 : 0, input.generation ?? null, input.intent ?? null, this.store.now()]);
    })();
    return this.turnOrThrow(id);
  }

  /**
   * Ties a turn to the reply as saved: its message, the saved text's hash and the swipe's date. A
   * reply saved only in part is `cut`. A continue ties the same turn again to the longer text. The
   * turn joins its chat's path at once where it extends it (a new reply after the head, or a swipe
   * of the newest reply); anything else waits for the next comparison (`sync`).
   */
  tieTurn(id: string, input: { message: string; hash: string; date?: number | null; status?: "done" | "cut" }): TurnRow {
    const t = this.turnOrThrow(id);
    if (t.status === "dropped") throw new StoreInputError(`turn ${id} was dropped`);
    this.db.transaction(() => {
      this.db.run("UPDATE turn SET message = ?, hash = ?, swipe_date = ?, status = ?, edited = NULL WHERE user = ? AND id = ?", [input.message, input.hash, input.date ?? null, input.status ?? "done", this.id, id]);
      const chat = this.chatOrThrow(t.chat);
      const path = JSON.parse(chat.path) as PathEntry[];
      const prev = this.db.query<{ prev: string | null }, [string, string]>("SELECT prev FROM path_node WHERE user = ? AND key = ?").get(this.id, t.node)?.prev ?? null;
      const entry: PathEntry = { message: input.message, user: false, turn: id, node: t.node, own: true, hash: input.hash, date: input.date ?? null };
      const at = path.findIndex((e) => e.message === input.message);
      if (at < 0) {
        if (prev !== chat.head) return;
        path.push(entry);
      } else {
        const before = path.slice(0, at).findLast((e) => e.node !== null)?.node ?? null;
        if (before !== prev || path.slice(at + 1).some((e) => e.turn !== null)) return;
        path[at] = entry;
      }
      this.db.run("UPDATE chat SET path = ?, head = ? WHERE user = ? AND id = ?", [JSON.stringify(path), t.node, this.id, t.chat]);
    })();
    // A finished turn every `snapshotEvery` along its path keeps its state, so a cold start is short.
    if ((t.depth + 1) % this.store.snapshotEvery === 0) this.keepSnapshot(t.node);
    return this.turnOrThrow(id);
  }

  /** Stores the state after `node` as a snapshot this code may start from. */
  private keepSnapshot(node: string): void {
    const { folded, upto } = this.foldNode(node);
    const doc: SnapshotDoc = { state: folded.state, notApplied: folded.notApplied, rebased: folded.rebased };
    this.db.run("INSERT OR REPLACE INTO snapshot (user, node, kind, fingerprint, upto, state, created) VALUES (?, ?, 'cache', ?, ?, ?, ?)", [this.id, node, this.store.fingerprint, upto, JSON.stringify(doc), this.store.now()]);
  }

  /** A turn whose generation stopped with nothing saved: it never joins a path. */
  dropTurn(id: string): TurnRow {
    const t = this.turnOrThrow(id);
    if (t.status !== "open") throw new StoreInputError(`turn ${id} is ${t.status}, not open`);
    this.db.run("UPDATE turn SET status = 'dropped' WHERE user = ? AND id = ?", [this.id, id]);
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
    if (sets.length > 0) this.db.run(`UPDATE turn SET ${sets.join(", ")} WHERE user = ? AND id = ?`, [...values, this.id, id]);
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
    const after: PathEntry[] = [];
    for (const m of shown) {
      if (m.user) {
        after.push({ message: m.id, user: true, turn: null, node: null, own: null, hash: m.hash, date: date(m) });
        continue;
      }
      let turn: string | null = was.get(m.id)?.turn ?? null;
      if (again.has(m.id)) {
        const match = matchTurn(tied.get(m.id) ?? [], m);
        turn = match.turn?.id ?? null;
        if (match.turn && match.edited && match.turn.edited !== m.hash) {
          edited.push({ turn: match.turn.id, message: m.id, saved: match.turn.hash ?? "", now: m.hash });
          this.db.run("UPDATE turn SET edited = ? WHERE user = ? AND id = ?", [m.hash, this.id, match.turn.id]);
        } else if (match.turn && !match.edited && match.turn.edited !== null) this.db.run("UPDATE turn SET edited = NULL WHERE user = ? AND id = ?", [this.id, match.turn.id]);
      }
      after.push({ message: m.id, user: false, turn, node: null, own: null, hash: m.hash, date: date(m) });
    }
    // Path nodes: the same as last time as long as the turns before them are; new ones after that.
    const oldTurns = before.filter((e) => e.turn !== null);
    let prev: string | null = null;
    let depth = 0;
    let same = true;
    const nodes: [string, string | null, string, number][] = [];
    const fresh: PathEntry[] = [];
    for (const e of after) {
      if (e.turn === null) continue;
      const old = oldTurns[depth];
      same &&= old !== undefined && old.turn === e.turn && old.node !== null;
      if (same && old) {
        e.node = old.node;
        e.own = old.own;
      } else {
        e.node = nodeKey(prev, e.turn);
        nodes.push([e.node, prev, e.turn, depth]);
        fresh.push(e);
      }
      prev = e.node;
      depth++;
    }
    const ownNodes = new Map(
      this.db
        .query<{ id: string; node: string }, [string, string]>("SELECT t.id, t.node FROM json_each(?2) j CROSS JOIN turn t ON t.user = ?1 AND t.id = j.value")
        .all(this.id, JSON.stringify(fresh.map((e) => e.turn)))
        .map((r) => [r.id, r.node]),
    );
    for (const e of fresh) e.own = e.turn !== null && ownNodes.get(e.turn) === e.node;
    this.db.transaction(() => {
      const put = this.db.query("INSERT OR IGNORE INTO path_node (user, key, prev, turn, depth) VALUES (?, ?, ?, ?, ?)");
      for (const [key, p, turn, d] of nodes) put.run(this.id, key, p, turn, d);
      this.db.run("UPDATE chat SET path = ?, head = ? WHERE user = ? AND id = ?", [JSON.stringify(after), prev, this.id, chat]);
    })();
    const found = comparePaths(before, after);
    const branched = row.source_chat !== null && before.length === 0 && after.length > 0 ? { from: row.source_chat, at: row.source_message } : null;
    const notApplied = found.rebased ? this.headState(chat).notApplied : [];
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
   * store's own, held for the next call: read it, never change it.
   */
  addChanges(turnId: string, inputs: readonly ChangeInput[]): { changes: ChangeRow[]; state: StoreState } {
    const turn = this.turnOrThrow(turnId);
    if (turn.status === "dropped") throw new StoreInputError(`turn ${turnId} was dropped`);
    inputs.forEach((c, i) => checkChange(c, i));
    const inside = this.foldNode(turn.node);
    const state = structuredClone(inside.folded.state);
    const existing = this.changes(turnId);
    // Groups that did not land earlier in the turn: a unit tied to one does not land either.
    const fell = new Set(existing.filter((c) => !c.applied).flatMap((c) => (isRecord(c.value) && typeof c.value.group === "string" ? [c.value.group] : [])));
    const items: Item[] = inputs.map((c) => ({ op: c.op, value: c.value, turn: turnId, n: turn.depth + 1, by: c.by ?? null }));
    const outcomes = applyChecked(this.store.env, state, items, fell);
    const now = this.store.now();
    const ids: number[] = [];
    let ord = (existing.at(-1)?.ord ?? -1) + 1;
    this.db.transaction(() => {
      const put = this.db.query("INSERT INTO change (user, turn, ord, lane, op, value, by, standing, precision, source, job, applied, reports, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      inputs.forEach((c, i) => {
        const o = outcomes[i] ?? { applied: false, reports: [] };
        const r = put.run(this.id, turnId, ord++, c.lane, c.op, JSON.stringify(c.value), c.by ?? null, c.standing ?? null, c.precision ?? null, c.source ?? null, c.job ?? null, o.applied ? 1 : 0, o.reports.length > 0 ? JSON.stringify(o.reports) : null, now);
        ids.push(Number(r.lastInsertRowid));
      });
      this.dropSnapshotsThrough(turnId);
    })();
    this.store.touch();
    const upto = Math.max(inside.upto, ...ids);
    this.store.keep(this.cacheKey(turn.node), { ...inside.folded, state }, upto);
    const rows = this.db.query<ChangeDb, [string, string]>("SELECT * FROM change WHERE user = ?1 AND id IN (SELECT value FROM json_each(?2)) ORDER BY ord").all(this.id, JSON.stringify(ids)).map(changeOf);
    return { changes: rows, state };
  }

  /** Takes back an open turn's staged changes, all or one agent's (the lead dropping a sub-agent's writes). How many went. */
  dropStaged(turnId: string, by?: string): number {
    const turn = this.turnOrThrow(turnId);
    if (turn.status !== "open") throw new StoreInputError(`turn ${turnId} is ${turn.status}: only an open turn's staged changes can be taken back`);
    const r = by === undefined ? this.db.run("DELETE FROM change WHERE user = ? AND turn = ?", [this.id, turnId]) : this.db.run("DELETE FROM change WHERE user = ? AND turn = ? AND by = ?", [this.id, turnId, by]);
    this.store.touch();
    return r.changes;
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

  /** State at the end of the chat's path: rebased turns' changes applied again where they now stand. */
  headState(chat: string): Folded {
    const row = this.chatOrThrow(chat);
    if (row.head === null) return this.initial(row.revision);
    return this.foldNode(row.head).folded;
  }

  /**
   * A starting state that stands for the engine's state after a turn on its own path (a migrated
   * chat's, where today's fold and this one differ, plan §15.3 item 7): folds start from it, whatever
   * the turns before it hold. What the store keeps beside the engine's state (the horizon, agents'
   * lines, what changed last) is the turn's own as folded.
   */
  setBase(turnId: string, world: WorldState): void {
    const turn = this.turnOrThrow(turnId);
    const own = this.foldNode(turn.node).folded.state;
    const upto = this.db.query<{ n: number | null }, []>("SELECT max(id) AS n FROM change").get()?.n ?? 0;
    this.db.transaction(() => {
      const doc: SnapshotDoc = { state: { ...own, world }, notApplied: [], rebased: [] };
      this.db.run("INSERT OR REPLACE INTO snapshot (user, node, kind, fingerprint, upto, state, created) VALUES (?, ?, 'base', ?, ?, ?, ?)", [this.id, turn.node, this.store.fingerprint, upto, JSON.stringify(doc), this.store.now()]);
      this.dropSnapshotsThrough(turnId);
    })();
    this.store.touch();
  }

  private initial(revision: string | null): Folded {
    const key = `${this.id}\u0000~${revision ?? ""}`;
    const hit = this.store.cached(key);
    if (hit) return hit.folded;
    const state = revision === null ? null : initialStoreState(this.store.env, revision);
    if (!state) throw new StoreInputError(revision === null ? "the chat has no world revision" : `the world revision ${revision} is not available`);
    const folded: Folded = { node: null, state, notApplied: [], rebased: [] };
    this.store.keep(key, folded, 0);
    return folded;
  }

  private cacheKey(node: string): string {
    return `${this.id}\u0000${node}`;
  }

  /** Folds the path ending at `node`, from the nearest held or stored state on it. */
  private foldNode(node: string): { folded: Folded; upto: number } {
    const hit = this.store.cached(this.cacheKey(node));
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
      const held = key === undefined ? null : this.store.cached(this.cacheKey(key));
      if (!held) continue;
      from = i;
      start = { state: structuredClone(held.folded.state), upto: held.upto, notApplied: [...held.folded.notApplied], rebased: [...held.folded.rebased] };
      break;
    }
    const first = chain[0];
    if (!first) throw new StoreInputError(`no path node ${node}`);
    if (!start && first.snap === 1) {
      const snap = this.db
        .query<{ upto: number; state: string }, [string, string, string]>("SELECT upto, state FROM snapshot WHERE user = ?1 AND node = ?2 AND (kind = 'base' OR fingerprint = ?3) ORDER BY kind = 'base' DESC LIMIT 1")
        .get(this.id, first.key, this.store.fingerprint);
      if (snap) {
        const doc = JSON.parse(snap.state) as SnapshotDoc;
        from = 0;
        start = { state: doc.state, upto: snap.upto, notApplied: doc.notApplied, rebased: doc.rebased };
      }
    }
    if (!start) {
      const opener = this.db.query<{ revision: string | null }, [string, string]>("SELECT c.revision FROM turn t JOIN chat c ON c.user = t.user AND c.id = t.chat WHERE t.user = ? AND t.id = ?").get(this.id, first.turn);
      const init = this.initial(opener?.revision ?? null);
      start = { state: structuredClone(init.state), upto: 0, notApplied: [], rebased: [] };
    }
    const rest = chain.slice(from + 1);
    const ids = JSON.stringify(rest.map((c) => c.turn));
    const turns = new Map(
      this.db
        .query<{ id: string; node: string; status: string }, [string, string]>("SELECT t.id, t.node, t.status FROM json_each(?2) j CROSS JOIN turn t ON t.user = ?1 AND t.id = j.value")
        .all(this.id, ids)
        .map((t) => [t.id, t]),
    );
    const byTurn = new Map<string, StoredChange[]>();
    for (const c of this.db
      .query<{ id: number; turn: string; op: string; lane: string; value: string; by: string | null; applied: number }, [string, string]>(
        "SELECT c.id, c.turn, c.op, c.lane, c.value, c.by, c.applied FROM change c WHERE c.user = ?1 AND c.turn IN (SELECT value FROM json_each(?2)) ORDER BY c.turn, c.ord",
      )
      .all(this.id, ids)) {
      const list = byTurn.get(c.turn) ?? [];
      list.push({ id: c.id, op: c.op, lane: c.lane as Lane, value: JSON.parse(c.value) as JsonValue, by: c.by, applied: c.applied === 1 });
      byTurn.set(c.turn, list);
    }
    const steps: FoldStep[] = rest.map((c) => ({ node: c.key, turn: c.turn, n: c.depth + 1, own: turns.get(c.turn)?.node === c.key, changes: byTurn.get(c.turn) ?? [] }));
    const every = this.store.snapshotEvery;
    const snaps: [string, number, string][] = [];
    const result = foldSteps(this.store.env, start, steps, (step, state, upto, notApplied, rebased) => {
      // Every `snapshotEvery` turns along a path, once its turn is no longer open.
      if (step.n % every !== 0 || turns.get(step.turn)?.status === "open") return;
      const doc: SnapshotDoc = { state, notApplied: [...(start?.notApplied ?? []), ...notApplied], rebased: [...(start?.rebased ?? []), ...rebased] };
      snaps.push([step.node, upto, JSON.stringify(doc)]);
    });
    if (snaps.length > 0) {
      const put = this.db.query("INSERT OR REPLACE INTO snapshot (user, node, kind, fingerprint, upto, state, created) VALUES (?, ?, 'cache', ?, ?, ?, ?)");
      this.db.transaction(() => {
        for (const [key, upto, state] of snaps) put.run(this.id, key, this.store.fingerprint, upto, state, this.store.now());
      })();
    }
    const folded: Folded = { node, state: result.state, notApplied: [...start.notApplied, ...result.notApplied], rebased: [...start.rebased, ...result.rebased] };
    this.store.keep(this.cacheKey(node), folded, result.upto);
    return { folded, upto: result.upto };
  }

  // ------------------------------------------------------------ sessions

  /** A session: the scene it is, opened by a turn. */
  openSession(input: { chat: string; scene: string; turn: string }): SessionRow {
    this.chatOrThrow(input.chat);
    const id = crypto.randomUUID();
    this.db.run("INSERT INTO session (user, id, chat, scene, opened_by) VALUES (?, ?, ?, ?, ?)", [this.id, id, input.chat, input.scene, input.turn]);
    return this.session(id) as SessionRow;
  }

  closeSession(id: string, turn: string): SessionRow {
    if (!this.session(id)) throw new StoreInputError(`no session ${id}`);
    this.db.run("UPDATE session SET closed_by = ? WHERE user = ? AND id = ?", [turn, this.id, id]);
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

  // ------------------------------------------------------------ the tree view

  /** The tree over the chat's current state. */
  view(chat: string): TreeView {
    return this.store.viewOf(this.headState(chat).state);
  }

  /** The tree over the state at a turn. */
  viewAt(turn: string): TreeView {
    return this.store.viewOf(this.stateAt(turn).state);
  }
}
