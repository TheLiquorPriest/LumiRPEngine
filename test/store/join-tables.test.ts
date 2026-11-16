// What a continue's join does with every column of the store's tables that names a turn, or a turn's node (R-203): nothing the
// store keeps is left under the held turn, which every reader is refused. The columns are read from the database itself, so a table
// or a column the store gains fails here until this test says what the join does with it. The cast's and the story's tables are
// joined by `joinCast` and `joinStory` in the caller's same write, and their own tests hold them.

import { expect, test } from "bun:test";
import { STORE_TABLES } from "../../src/store/schema";
import { engine, goTo, make, play, POV, testStore, tick, USER } from "./fixtures";

/**
 * What the join does with a column that names the held turn (`turn`) or its node (`node`): `moved`, it names the extended turn after;
 * `kept`, the held turn's own record, which stays; `dropped`, with its row; `never`, a column a held open turn never appears in. A
 * column that names no turn is `none`.
 */
type Fate = { names: "turn" | "node"; does: "moved" | "kept" | "dropped" | "never" } | "none";

const turnIs = (does: "moved" | "kept" | "dropped" | "never"): Fate => ({ names: "turn", does });
const nodeIs = (does: "moved" | "kept" | "dropped" | "never"): Fate => ({ names: "node", does });

const FATES: Readonly<Record<string, Readonly<Record<string, Fate>>>> = {
  // A chat's path and head hold the turns its comparison or a tie placed there: never a held open turn.
  chat: { user: "none", id: "none", world: "none", revision: "none", source_chat: "none", source_message: "none", head: nodeIs("never"), path: turnIs("never"), created: "none", deleted: "none", heard: "none", heard_count: "none", compared: "none" },
  message_link: { user: "none", chat: "none", message: "none", source_chat: "none", source_message: "none" },
  session: { user: "none", id: "none", chat: "none", scene: "none", opened_by: turnIs("moved"), closed_by: turnIs("moved") },
  // The held turn's row stays as the record of a joined turn; no turn stands after it, and it joins none of its own.
  turn: {
    user: "none",
    id: turnIs("kept"),
    chat: "none",
    parent: turnIs("never"),
    node: nodeIs("kept"),
    depth: "none",
    kind: "none",
    imported: "none",
    generation: "none",
    message: "none",
    hash: "none",
    swipe_date: "none",
    status: "none",
    edited: "none",
    intent: "none",
    story_time: "none",
    timings: "none",
    tokens_in: "none",
    tokens_out: "none",
    created: "none",
    joined: turnIs("never"),
  },
  path_node: { user: "none", key: nodeIs("kept"), prev: nodeIs("never"), turn: turnIs("kept"), depth: "none" },
  change: { id: "none", user: "none", turn: turnIs("moved"), chat: "none", ord: "none", lane: "none", op: "none", value: "none", by: "none", standing: "none", precision: "none", source: "none", cite: "none", job: "none", applied: "none", reports: "none", told: "none", created: "none", handle: "none" },
  snapshot: { user: "none", node: nodeIs("dropped"), kind: "none", fingerprint: "none", upto: "none", state: "none", created: "none" },
  // A snapshot's parts go with the last snapshot that names them; none names a turn.
  snapshot_part: { user: "none", hash: "none", body: "none", refs: "none" },
  fold_mark: { user: "none", chat: "none", mark: "none" },
  world_revision: { user: "none", revision: "none", world: "none", doc: "none", created: "none" },
  job_end: { user: "none", job: "none", ended: "none" },
};

type Row = Record<string, unknown> & { _row: number };

test("every store column that names a turn is one the join handles", () => {
  let clock = 0;
  const { store, s, revision } = testStore({ now: () => ++clock });
  const db = store.db;
  s.createChat({ id: "c", revision });
  play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10)));
  const into = play(s, "c", "m2", "Bram lends her a lantern.", 2, engine(make("lantern", "Lantern", POV)));
  const held = s.beginTurn({ chat: "c", kind: "continue", on: into.node });
  // Everything the store keeps by a held turn: its changes and a job's, a session it opened, one it closed, a state stored on it.
  s.addChanges(held.id, engine(goTo(POV, "cellar")));
  s.addChanges(held.id, engine(tick(5)).map((c) => ({ ...c, job: "j-cellar" })));
  s.openSession({ chat: "c", scene: "the cellar", turn: held.id });
  s.closeSession(s.openSession({ chat: "c", scene: "the inn", turn: into.id }).id, held.id);
  s.setBase(held.id, s.stateAt(held.id).state.world);

  // The store's tables, as the database holds them, are the ones this test knows, column for column.
  const tables = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  expect(tables).toEqual([...STORE_TABLES].sort());
  expect(Object.keys(FATES).sort()).toEqual(tables);
  for (const table of tables) {
    const columns = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    expect([table, columns.sort()]).toEqual([table, Object.keys(FATES[table] ?? {}).sort()]);
  }

  const read = (): Record<string, Row[]> => Object.fromEntries(tables.map((t) => [t, db.query<Row, [string]>(`SELECT rowid AS _row, * FROM ${t} WHERE user = ?`).all(USER)]));
  const before = read();
  s.joinTurn(held.id, into.id);
  const after = read();

  /** The rows whose column names `id`: a chat's path holds it among the entries it keeps as text. */
  const naming = (rows: readonly Row[], column: string, id: string): number[] => rows.filter((r) => (column === "path" ? String(r.path).includes(id) : r[column] === id)).map((r) => r._row);
  for (const table of tables) {
    for (const [column, fate] of Object.entries(FATES[table] ?? {})) {
      if (fate === "none") continue;
      const id = fate.names === "turn" ? held.id : held.node;
      const was = naming(before[table] ?? [], column, id);
      const now = naming(after[table] ?? [], column, id);
      const where = `${table}.${column}`;
      if (fate.does === "never") expect([where, was, now]).toEqual([where, [], []]);
      else if (fate.does === "kept") {
        expect([where, was.length > 0]).toEqual([where, true]);
        expect([where, now]).toEqual([where, was]);
      } else if (fate.does === "dropped") {
        expect([where, was.length > 0, now]).toEqual([where, true, []]);
      } else {
        // Moved: each row that named the held turn names the extended turn now.
        expect([where, was.length > 0, now]).toEqual([where, true, []]);
        const to = fate.names === "turn" ? into.id : into.node;
        expect([where, (after[table] ?? []).filter((r) => was.includes(r._row)).map((r) => r[column])]).toEqual([where, was.map(() => to)]);
      }
    }
  }
});
