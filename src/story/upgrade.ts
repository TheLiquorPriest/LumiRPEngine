// The story record moved onto the store's changes (plan Appendix B "Story", §9.3 "overlays are changes"): a database that holds the
// story's own table `story_entry` and the lore's `lore_overlay` has each row made a change of the story's area, on the turn it was
// tied to and in the place it had there, each item keeping its id, and both tables go. The starting states a migration set
// (`UserStore.setBase`) stand for everything before their turn, so they are given the story as it stood there too: a fold that starts
// from one reads the whole record. The same refresh serves a migration's story import, which writes its changes after the bases are set.

import type { Database } from "bun:sqlite";
import type { JsonObject, JsonValue } from "../shared/json";
import type { Source } from "../store";
import { applyStory, emptySlice, STORY_AREA_ID, STORY_OPS, type StorySlice } from "./fold";

interface StoryEntryRow {
  id: number;
  user: string;
  turn: string;
  ord: number;
  part: string;
  item: string;
  value: string;
  by: string | null;
  agent: string | null;
  created: number;
}

interface OverlayRow {
  id: number;
  user: string;
  turn: string;
  ord: number;
  entry: string;
  note: string;
  by: string | null;
  agent: string | null;
  created: number;
}

function hasTable(db: Database, name: string): boolean {
  return db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.n === 1;
}

/** The writer a migration's import gave its rows: its changes are the import's, so a chat holding only them is not a played one. */
const IMPORT_WRITER = "migration";

/**
 * Makes every row of `story_entry` and `lore_overlay` a change of the story's area, then drops both tables and refreshes the
 * starting states. Rows come after the turn's other changes, in the order they had (an overlay without a place first), and a row of a
 * turn the store no longer holds goes with it. A job's rows were read at once on the turn that started it: they are the turn's own
 * now, which is how every reading saw them. Nothing happens on a database that holds neither table.
 */
export function moveStoryRows(db: Database): void {
  const entries = hasTable(db, "story_entry") ? db.query<StoryEntryRow, []>("SELECT id, user, turn, ord, part, item, value, by, agent, created FROM story_entry").all() : [];
  const overlays = hasTable(db, "lore_overlay") ? db.query<OverlayRow, []>("SELECT id, user, turn, ord, entry, note, by, agent, created FROM lore_overlay").all() : [];
  if (entries.length + overlays.length > 0) {
    const turns = new Set(db.query<{ user: string; id: string }, []>("SELECT user, id FROM turn").all().map((t) => `${t.user}\u0000${t.id}`));
    type Moved = { user: string; turn: string; ord: number; created: number; table: 0 | 1; id: number; op: string; value: JsonValue; by: string | null; agent: string | null };
    const moved: Moved[] = [
      ...entries.map((r): Moved => ({ user: r.user, turn: r.turn, ord: r.ord, created: r.created, table: 0, id: r.id, op: STORY_OPS.write, value: { part: r.part, item: r.item, value: JSON.parse(r.value) as JsonObject }, by: r.by, agent: r.agent })),
      ...overlays.map((r): Moved => ({ user: r.user, turn: r.turn, ord: r.ord, created: r.created, table: 1, id: r.id, op: STORY_OPS.overlay, value: { entry: r.entry, note: r.note }, by: r.by, agent: r.agent })),
    ]
      .filter((m) => turns.has(`${m.user}\u0000${m.turn}`))
      .sort((a, b) => a.user.localeCompare(b.user) || a.turn.localeCompare(b.turn) || a.ord - b.ord || a.created - b.created || a.table - b.table || a.id - b.id);
    const last = db.query<{ ord: number | null }, [string, string]>("SELECT max(ord) AS ord FROM change WHERE user = ? AND turn = ?");
    const put = db.query<unknown, [string, string, number, string, string, string | null, string | null, number, string | null]>(
      "INSERT INTO change (user, turn, ord, lane, op, value, by, standing, precision, source, cite, job, applied, reports, created, handle) VALUES (?, ?, ?, 'story', ?, ?, ?, NULL, NULL, ?, NULL, NULL, 1, NULL, ?, ?)",
    );
    let next = 0;
    let at = "";
    for (const m of moved) {
      const key = `${m.user}\u0000${m.turn}`;
      if (key !== at) {
        at = key;
        next = (last.get(m.user, m.turn)?.ord ?? -1) + 1;
      }
      put.run(m.user, m.turn, next++, m.op, JSON.stringify(m.value), m.by, m.by === IMPORT_WRITER ? "import" : null, m.created, m.agent);
    }
    // A new item is given its id from its first change: no change is ever given a number an item carried over already holds.
    const held = Math.max(0, ...entries.map((r) => r.id));
    db.run("INSERT INTO sqlite_sequence (name, seq) SELECT 'change', 0 WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'change')");
    db.run("UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name = 'change'", [held]);
  }
  if (hasTable(db, "story_entry")) db.run("DROP TABLE story_entry");
  if (hasTable(db, "lore_overlay")) db.run("DROP TABLE lore_overlay");
  // The states held before knew no story: they are made again when next wanted. The starting states a migration set are refreshed.
  if (!hasTable(db, "snapshot")) return;
  db.run("DELETE FROM snapshot WHERE kind = 'cache'");
  refreshStoryBases(db);
}

/** An area's slice as a snapshot part is named: the text's hash and length, as the store names its own parts. */
const hashOf = (body: string): string => `${Bun.hash(body).toString(36)}.${body.length}`;

/** The story's slice along the path ending at `node`, before the turn standing there: the story changes of the turns before it, in their order. */
function sliceBefore(db: Database, user: string, node: string): StorySlice {
  const chain = db
    .query<{ turn: string; depth: number }, [string, string]>(
      `WITH RECURSIVE up(key, prev, turn, depth) AS (
         SELECT key, prev, turn, depth FROM path_node WHERE user = ?1 AND key = ?2
         UNION ALL SELECT n.key, n.prev, n.turn, n.depth FROM path_node n JOIN up ON n.user = ?1 AND n.key = up.prev)
       SELECT turn, depth FROM up ORDER BY depth`,
    )
    .all(user, node)
    .slice(0, -1);
  const rows = db
    .query<{ turn: string; op: string; value: string; by: string | null; source: string | null }, [string, string]>(
      "SELECT turn, op, value, by, source FROM change WHERE user = ?1 AND turn IN (SELECT value FROM json_each(?2)) AND op LIKE 'story.%' AND applied = 1 AND job IS NULL ORDER BY ord",
    )
    .all(user, JSON.stringify(chain.map((c) => c.turn)));
  const byTurn = new Map<string, typeof rows>();
  for (const r of rows) byTurn.set(r.turn, [...(byTurn.get(r.turn) ?? []), r]);
  return applyStory(
    emptySlice(),
    chain.flatMap(({ turn, depth }) => (byTurn.get(turn) ?? []).map((r) => ({ op: r.op, value: JSON.parse(r.value) as JsonValue, turn, n: depth + 1, by: r.by, source: r.source as Source | null }))),
  );
}

/**
 * Gives every starting state a migration set (a `base` snapshot) the story as it stood before its turn, which its own turn's changes
 * (those after the state was stored: `UserStore.setBase`) then fold on top of. A fold that starts from such a state then holds the
 * whole record, whenever its changes were written. Run again, it says the same. The user's, or everyone's.
 */
export function refreshStoryBases(db: Database, user?: string): void {
  const bases = db.query<{ user: string; node: string; state: string }, [string | null]>("SELECT user, node, state FROM snapshot WHERE kind = 'base' AND (?1 IS NULL OR user = ?1)").all(user ?? null);
  for (const b of bases) {
    const slice = sliceBefore(db, b.user, b.node);
    const doc = JSON.parse(b.state) as { parts?: Record<string, string>; state?: { areas?: Record<string, unknown> } };
    if (doc.parts === undefined) {
      // A state stored whole, before the store kept parts.
      if (doc.state === undefined) continue;
      doc.state.areas = { ...doc.state.areas, [STORY_AREA_ID]: slice };
      db.run("UPDATE snapshot SET state = ? WHERE user = ? AND node = ? AND kind = 'base'", [JSON.stringify(doc), b.user, b.node]);
      continue;
    }
    const beside = db.query<{ body: string }, [string, string]>("SELECT body FROM snapshot_part WHERE user = ? AND hash = ?").get(b.user, doc.parts.s ?? "");
    if (beside === null) continue;
    const rest = JSON.parse(beside.body) as { areas?: string[] } & Record<string, unknown>;
    const parts = { ...doc.parts };
    const put = db.query<unknown, [string, string, string]>("INSERT OR IGNORE INTO snapshot_part (user, hash, body, refs) VALUES (?, ?, ?, 0)");
    const sliceBody = JSON.stringify(slice);
    parts[`a:${STORY_AREA_ID}`] = hashOf(sliceBody);
    put.run(b.user, hashOf(sliceBody), sliceBody);
    const besideBody = JSON.stringify({ ...rest, areas: [...new Set([...(rest.areas ?? []), STORY_AREA_ID])] });
    parts.s = hashOf(besideBody);
    put.run(b.user, hashOf(besideBody), besideBody);
    db.run("UPDATE snapshot SET state = ? WHERE user = ? AND node = ? AND kind = 'base'", [JSON.stringify({ ...doc, parts }), b.user, b.node]);
  }
}
