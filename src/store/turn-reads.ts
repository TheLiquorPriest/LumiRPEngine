// What a page reads of a turn, worked out from the state at the turn's end and stored with the turn's node (the Journal's notes of a
// turn, the line under its reply): a fact of the node for as long as its state stands, so a restart reads it and folds nothing for it.
// Each row is one node's one read: the store's fingerprint it was folded under (as a snapshot's), the reader's own key (the words it was
// worded in, the version of the code that words it, what else it names) and what it gave, as JSON. The store removes a node's rows in
// the write that makes the node's state another (`KEPT_BY_NODE`, as it does the node's snapshots) and with the node itself, so a row
// that is there is the node's read; a row under another fingerprint or key is worked out again and replaced.
//
// Only what the state at the turn's end and the turn's own changes give is stored: his own changes and a job's at its end stand only in
// the head's reading, which no row holds. A row is stored for a turn that is done or cut, never one still open (whose every write makes
// its node another), and only while the state it was worked out from is still the node's (`turnMark`, read again inside the write).
//
// Each reader stores what a turn shows when the turn ends too, in the background (`afterTurns`): once a chat's writes have settled and
// no run of it goes on, the newest of its turns whose node holds no row (the turn just ended, or those a job's changes or an edit made
// another) are worked out while their states are in memory, so a page opened later, after a restart or not, finds their rows.

import type { Database } from "bun:sqlite";
import { STORE_DEFAULTS, type Store, type UserStore } from "./store";

/** What a row holds of its turn: the Journal's notes (`play/journal.ts`), or the line under its reply (`turn/replies.ts`). */
export type TurnReadKind = "notes" | "line";

/**
 * What names the state at a turn's end in this store now (`UserStore.foldKey`): another once a write makes it another. A reader keeps
 * in memory under it, and a read worked out under it is stored only while it still names the node's state. Throws the store's
 * `JoinedTurnError` for a joined turn.
 */
export function turnMark(s: UserStore, turn: string): string {
  return s.foldKey(turn);
}

/** A node's read as stored: the reader's key for it, and what it gave (JSON). */
export interface TurnRead {
  key: string;
  value: string;
}

/** A read worked out from the state at a turn's end, to be stored with the turn's node: the node, and the turn's mark when it was worked out. */
export interface TurnReadMade extends TurnRead {
  node: string;
  mark: string;
}

/** The rows of `kind` stored for `nodes` under the store's fingerprint, by node. */
export function storedTurnReads(store: Store, user: string, kind: TurnReadKind, nodes: readonly string[]): Map<string, TurnRead> {
  if (nodes.length === 0) return new Map();
  const rows = store.db
    .query<{ node: string; key: string; value: string }, [string, string, string, string]>(
      "SELECT node, key, value FROM turn_read WHERE user = ?1 AND kind = ?2 AND fingerprint = ?3 AND node IN (SELECT value FROM json_each(?4))",
    )
    .all(user, kind, store.fingerprint, JSON.stringify(nodes));
  return new Map(rows.map((r) => [r.node, { key: r.key, value: r.value }]));
}

/**
 * Stores each turn's read of `kind` with its node, replacing the row the node had; inside a write. A read whose turn's state is another
 * by now (its mark moved), or whose turn is no longer done or cut, is not stored: the next read works it out again.
 */
export function storeTurnReads(store: Store, user: string, kind: TurnReadKind, rows: ReadonlyMap<string, TurnReadMade>): void {
  const s = store.user(user);
  const put = store.db.query(
    `INSERT INTO turn_read (user, node, kind, fingerprint, key, value) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (user, node, kind) DO UPDATE SET fingerprint = excluded.fingerprint, key = excluded.key, value = excluded.value`,
  );
  for (const [turn, read] of rows) {
    const row = s.turn(turn);
    if (row === null || row.node !== read.node || (row.status !== "done" && row.status !== "cut")) continue;
    if (turnMark(s, turn) !== read.mark) continue;
    put.run(user, read.node, kind, store.fingerprint, read.key, read.value);
  }
}

/** The application's write queue, as a reader stores its rows through it. */
export interface TurnReadWrites {
  run<T>(write: (db: Database) => T, label?: string): Promise<T>;
}

/** Stores reads a reader worked out, in a write of their own that the read does not wait for (`turnReadKeeper`). */
export type KeepTurnReads = (store: Store, user: string, kind: TurnReadKind, rows: ReadonlyMap<string, TurnReadMade>) => void;

/** A keeper that stores through `writes`; `failed` is told why a write did not land, and the next read works those reads out again. */
export function turnReadKeeper(writes: TurnReadWrites, failed: (error: unknown) => void): KeepTurnReads {
  return (store, user, kind, rows) => {
    if (rows.size === 0) return;
    void writes.run(() => storeTurnReads(store, user, kind, rows), kind === "notes" ? "the Journal's notes worked out" : "the lines under replies worked out").catch(failed);
  };
}

/**
 * The most of a chat's newest turns a turn's end works out what they show for (`afterTurns`): as many as the store holds states for a
 * chat by default, so it folds what is in memory and no more; older turns' are worked out by the first read that asks for them.
 */
export const ENDED_MOST = STORE_DEFAULTS.statesPerChat;

/** How long after a chat's last write a turn's end is taken as done (`afterTurns`): the writes of one end (its changes, its tie, a job's end) are one. */
export const SETTLED_MS = 500;

/**
 * Calls `ended` for each chat a write of the store changed, once the chat's writes have settled (`settledMs` after the last of any write)
 * and no run of it goes on (`running`; a chat still running is asked again after as long): in the background, never inside a write or a
 * run. What `ended` throws is told to `failed`. Returns what stops it.
 */
export function afterTurns(store: Store, running: (user: string, chat: string) => boolean, ended: (user: string, chat: string) => Promise<void>, failed: (error: unknown) => void, settledMs = SETTLED_MS): () => void {
  const pending = new Map<string, { user: string; chat: string }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let passing = false;
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => void settle(), settledMs);
    // It keeps no process alive that has nothing else to do (a command, a test).
    timer.unref();
  };
  const settle = async (): Promise<void> => {
    timer = undefined;
    // One pass at a time: what was written meanwhile waits for the next.
    if (passing) return arm();
    passing = true;
    try {
      const due = [...pending];
      pending.clear();
      for (const [key, at] of due) {
        if (running(at.user, at.chat)) {
          pending.set(key, at);
          continue;
        }
        await ended(at.user, at.chat).catch(failed);
      }
    } finally {
      passing = false;
    }
    if (pending.size > 0 && timer === undefined) arm();
  };
  const stop = store.onWrite((user, chats) => {
    for (const chat of chats ?? []) pending.set(`${user}\u0000${chat}`, { user, chat });
    // A write that names no chat (a turn tied to its reply, a comparison) still says the chats waiting are not settled yet.
    if (pending.size > 0) arm();
  });
  return () => {
    stop();
    clearTimeout(timer);
  };
}

/**
 * The newest of `turns` (oldest first; each a turn and the key its row would name, null for one that has none to store) whose node holds
 * no row of `kind` under that key, back to the first that does, at most `ENDED_MOST`: what a turn's end works out (`afterTurns`).
 */
export function endedRowless(store: Store, user: string, kind: TurnReadKind, turns: readonly { turn: string; key: string | null }[]): string[] {
  const s = store.user(user);
  const newest = turns.slice(-ENDED_MOST).flatMap((t) => {
    const row = s.turn(t.turn);
    return t.key === null || row === null || (row.status !== "done" && row.status !== "cut") ? [] : [{ turn: t.turn, node: row.node, key: t.key }];
  });
  const rows = storedTurnReads(store, user, kind, newest.map((t) => t.node));
  const out: string[] = [];
  for (const t of [...newest].reverse()) {
    if (rows.get(t.node)?.key === t.key) break;
    out.unshift(t.turn);
  }
  return out;
}
