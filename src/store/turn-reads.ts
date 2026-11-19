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

import type { Database } from "bun:sqlite";
import type { Store, UserStore } from "./store";

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
