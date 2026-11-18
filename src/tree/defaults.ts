// Shipped defaults and the user's own files beside them (plan §5.2, §5.4 "Defaults"). The shipped level
// is laid out again at every start; every change an update made to it is kept (`tree_default`, one row
// for each file an update changed or took away, with the file's text before and when), and so is when
// the user wrote each of their own files through RPE (`tree_written`, with how many updates there had
// been). The Files page then says, of a file of the user's that replaces a default, every change made
// to that default since they last wrote theirs, as one difference from the default as it stood when
// they wrote theirs to the default now and as one for each update, and of one that replaces a default an
// update removed, that it was removed. The user's file is never touched. Resetting is removing the
// user's file, after which the default is taken.

import type { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { TreeWrites } from "./chats";
import { GLOBAL_FOLDERS, MOUNTS, NOTES_FOLDER } from "./layout";
import { layShippedChanges, type ShippedChange } from "./shipped";

export interface DefaultsDeps {
  /** The tree's folder: the global level. */
  files: string;
  /** A folder beside the tree, on the same disk, where the shipped level's new copy is made. */
  scratch: string;
  /** The shipped folders the level is laid out from: RPH's, then RPE's over it. */
  sources: { rph: string; rpe: string };
  writes: TreeWrites;
  /** The user this RPE belongs to, whose record of what an update changed this is. */
  user: string;
  now(): number;
}

/** One update's change to a shipped default, without its text: where it stands among the updates, when it was laid out, and whether it took the file away. */
export interface DefaultUpdate {
  seq: number;
  at: number;
  removed: boolean;
}

/** When the user wrote one of their own files through RPE: when, and how many updates had changed defaults by then. */
export interface FileWritten {
  seen: number;
  at: number;
}

/** What the Files page knows of the defaults, as kept for one user: every update's change to each shipped file by its path in the view (`@shipped/…`), oldest first, and when each of the user's files was written. */
export interface DefaultStanding {
  updates: ReadonlyMap<string, readonly DefaultUpdate[]>;
  written: ReadonlyMap<string, FileWritten>;
}

/** An update's change to a shipped default with its text before: what the difference of the default as it was is made from. */
export interface DefaultUpdateText extends DefaultUpdate {
  before: string;
}

/** How far after RPE wrote a file its time of change may be and the file still be as RPE wrote it, in milliseconds: a disk keeps its times coarsely, and the write is recorded just after it lands. */
const WRITTEN_SLACK_MS = 2000;

/** One line of a difference between two texts: in both, only in the second, or only in the first. */
export interface DiffLine {
  op: "same" | "added" | "removed";
  text: string;
}

/**
 * Lays the global level's folders plan §5 draws (`.agents/ .skills/ .tools/ .hooks/ .prompts/ .rules/` and its notes folder, R-175),
 * no file among them, and the shipped level (`layShippedChanges`), keeping what it changed of the level laid out before.
 */
export async function layDefaults(deps: DefaultsDeps): Promise<ShippedChange[]> {
  await Promise.all([...Object.values(GLOBAL_FOLDERS), NOTES_FOLDER].map((folder) => mkdir(join(deps.files, folder), { recursive: true })));
  const changes = await layShippedChanges(deps.files, deps.scratch, deps.sources);
  if (changes.length > 0) {
    const at = deps.now();
    await deps.writes.run((db) => {
      for (const c of changes) db.run("INSERT INTO tree_default (user, path, before, removed, at) VALUES (?, ?, ?, ?, ?)", [deps.user, c.path, c.before, c.removed === true ? 1 : 0, at]);
    }, "keeping what an update changed of the shipped files");
  }
  return changes;
}

/** What the Files page knows of the defaults for `user`: every update's change to each shipped file, and when each of their files was written. */
export function defaultStanding(db: Database, user: string): DefaultStanding {
  const updates = new Map<string, DefaultUpdate[]>();
  for (const r of db.query<{ path: string; seq: number; at: number; removed: number }, [string]>("SELECT path, seq, at, removed FROM tree_default WHERE user = ? ORDER BY seq").all(user)) {
    const path = `${MOUNTS.shipped}${r.path}`;
    updates.set(path, [...(updates.get(path) ?? []), { seq: r.seq, at: r.at, removed: r.removed === 1 }]);
  }
  const written = new Map(db.query<{ file: string; seen: number; at: number }, [string]>("SELECT file, seen, at FROM tree_written WHERE user = ?").all(user).map((r) => [r.file, { seen: r.seen, at: r.at }]));
  return { updates, written };
}

/** Every change updates made to one shipped default (by its path in the view), with its text before, oldest first. */
export function defaultUpdateTexts(db: Database, user: string, path: string): DefaultUpdateText[] {
  const below = path.slice(MOUNTS.shipped.length);
  return db.query<{ seq: number; at: number; removed: number; before: string }, [string, string]>("SELECT seq, at, removed, before FROM tree_default WHERE user = ? AND path = ? ORDER BY seq").all(user, below).map((r) => ({ seq: r.seq, at: r.at, removed: r.removed === 1, before: r.before }));
}

/**
 * The updates that changed a default after the user last wrote their file that replaces it: those since the write RPE recorded
 * (the file's time of change, which a copy resets, is not what says it), or, for a file made or edited beyond RPE's sight since,
 * those after its time of change.
 */
export function updatesSince<U extends DefaultUpdate>(updates: readonly U[], written: FileWritten | undefined, changed: number): U[] {
  if (written !== undefined && changed <= written.at + WRITTEN_SLACK_MS) return updates.filter((u) => u.seq > written.seen);
  return updates.filter((u) => u.at > changed);
}

/** Keeps that the user wrote their file `file` (its place below the tree's folder, "/" between names) now, after the updates there have been. */
export async function recordWritten(writes: TreeWrites, user: string, file: string, at: number): Promise<void> {
  await writes.run((db) => {
    db.run("INSERT INTO tree_written (user, file, seen, at) VALUES (?1, ?2, COALESCE((SELECT MAX(seq) FROM tree_default WHERE user = ?1), 0), ?3) ON CONFLICT (user, file) DO UPDATE SET seen = excluded.seen, at = excluded.at", [user, file, at]);
  }, "keeping when you wrote a file");
}

function linesOf(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * The difference from `before` to `after`, line by line: the lines both keep, in order, as few as can
 * be removed and added around them. Past `cells` line pairs to compare (the setting `files.diffCells`),
 * the changed middle is shown removed, then added whole.
 */
export function lineDiff(before: string, after: string, cells: number): DiffLine[] {
  const a = linesOf(before);
  const b = linesOf(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const middle: DiffLine[] = [];
  if (x.length * y.length > cells) {
    for (const text of x) middle.push({ op: "removed", text });
    for (const text of y) middle.push({ op: "added", text });
  } else {
    // The longest run of lines both keep, by the usual table: `kept[i][j]` for the lines from `x[i]` and `y[j]` on.
    const width = y.length + 1;
    const kept = new Uint32Array((x.length + 1) * width);
    for (let i = x.length - 1; i >= 0; i--) {
      for (let j = y.length - 1; j >= 0; j--) kept[i * width + j] = x[i] === y[j] ? (kept[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(kept[(i + 1) * width + j] ?? 0, kept[i * width + j + 1] ?? 0);
    }
    let i = 0;
    let j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        middle.push({ op: "same", text: x[i] ?? "" });
        i++;
        j++;
      } else if (i < x.length && (j === y.length || (kept[(i + 1) * width + j] ?? 0) >= (kept[i * width + j + 1] ?? 0))) {
        middle.push({ op: "removed", text: x[i] ?? "" });
        i++;
      } else {
        middle.push({ op: "added", text: y[j] ?? "" });
        j++;
      }
    }
  }
  return [...a.slice(0, head).map((text): DiffLine => ({ op: "same", text })), ...middle, ...a.slice(a.length - tail).map((text): DiffLine => ({ op: "same", text }))];
}
