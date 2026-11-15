// Shipped defaults and the user's own files beside them (plan §5.2, §5.4 "Defaults"). The shipped level
// is laid out again at every start; what an update changed of it is kept (`tree_default`): each changed
// file's text before, and when. The Files page then says, of a file of the user's that replaces a
// default, that the default changed since the user last wrote theirs, and shows both differences: the
// user's file against the default, and the default before the update against the default now. The
// user's file is never touched. Resetting is removing the user's file, after which the default is taken.

import type { Database } from "bun:sqlite";
import type { TreeWrites } from "./chats";
import { MOUNTS } from "./layout";
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

/** A shipped default an update changed: its text before, and when the update laid it out. */
export interface DefaultChange {
  before: string;
  at: number;
}

/** One line of a difference between two texts: in both, only in the second, or only in the first. */
export interface DiffLine {
  op: "same" | "added" | "removed";
  text: string;
}

/** Lays the shipped level (`layShippedChanges`) and keeps what it changed of the level laid out before. */
export async function layDefaults(deps: DefaultsDeps): Promise<ShippedChange[]> {
  const changes = await layShippedChanges(deps.files, deps.scratch, deps.sources);
  if (changes.length > 0) {
    const at = deps.now();
    await deps.writes.run((db) => {
      for (const c of changes) db.run("INSERT INTO tree_default (user, path, before, at) VALUES (?, ?, ?, ?) ON CONFLICT (user, path) DO UPDATE SET before = excluded.before, at = excluded.at", [deps.user, c.path, c.before, at]);
    }, "keeping what an update changed of the shipped files");
  }
  return changes;
}

/** Every shipped default an update changed, as kept for `user`, by its path in the view (`@shipped/…`). */
export function defaultChanges(db: Database, user: string): Map<string, DefaultChange> {
  return new Map(db.query<{ path: string; before: string; at: number }, [string]>("SELECT path, before, at FROM tree_default WHERE user = ?").all(user).map((r) => [`${MOUNTS.shipped}${r.path}`, { before: r.before, at: r.at }]));
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
