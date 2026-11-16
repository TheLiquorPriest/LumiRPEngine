// What a comparison of a chat's path found (plan §6.3, §10.10), kept with the chat so it reaches each
// turn it is for, whatever becomes of the intake that found it: turns deleted, another swipe showing,
// a reply or a player's message edited, replies written in the chat without a turn. Each is kept as
// data, filed under the turn at the head of the chat's path when it was found, which is the turn the
// next one follows; its words are the notices part's, given when it is told. A turn is told what was
// filed under the turn it follows, so an intake that ends before the harness takes its request leaves it
// for the next one, and a swipe of a turn that was told it is told it too. What a turn was told is kept
// where it decides something: a continue's, so the turns after the turn it continues are not told it again.

import type { Database } from "bun:sqlite";
import type { LvStep } from "../adapter/lumiverse/reads";
import { textHash } from "../adapter/lumiverse/wire";
import type { PathEntry, PathReport } from "../store";

/** How Lumiverse's text of a message with nothing written in it reads as a hash. */
const NOTHING_WRITTEN = textHash("");

/** A turn a delete took: its id, its message, and that message's number as the chat stood before the deletion (the first 0; null where RPE did not hold it). */
export interface GoneTurn {
  turn: string;
  message: string;
  n: number | null;
}

/** A change that no longer applies after a flip: the change, the turn it came from, its operation, and why, as the store's report codes. */
export interface StoppedChange {
  change: number;
  turn: string;
  op: string;
  codes: string[];
}

/** One thing a comparison found, as data. */
export type FoundItem =
  /** Turns whose messages are gone from the chat, each with its message and number. */
  | { kind: "deleted"; turns: string[]; gone: GoneTurn[] }
  /** Another swipe showing on the newest reply: its turn, none for a swipe made without RPE. */
  | { kind: "swiped"; message: string; to: string | null }
  /**
   * Another swipe showing on an earlier reply: the stretch of the turns applied again on it (its first and last message), and the
   * changes this flip stopped from applying, none a flip before it had stopped.
   */
  | { kind: "flipped"; message: string; to: string | null; stretch: { from: string; to: string } | null; stopped: StoppedChange[] }
  /** A reply edited after its turn was tied. */
  | { kind: "edited"; message: string; turn: string }
  /** A player's message edited since RPE last read it: `had` is the hash it had then. */
  | { kind: "player_edited"; message: string; had: string }
  /** Replies no turn is tied to, from the first to the last, as one stretch of the chat. */
  | { kind: "unplayed"; from: string; to: string };

/** A found thing as kept: when it was found. */
export interface KeptItem {
  id: string;
  at: number;
  item: FoundItem;
}

/**
 * What a comparison found, each thing found once. `was` is the path as RPE held it before the comparison, for the numbers of the
 * messages a delete took, the player's own messages (the store compares replies) and the replies no turn is tied to: the store's
 * comparison finds every one of those again, so only those `was` did not hold as they read now, new since or changed since, are found,
 * in stretches broken by a played reply or by one found before. A message with nothing written in it (what Lumiverse keeps of a
 * generation stopped or failed before its first word) is no reply anyone wrote, and is not found. `stoppedBefore`: the changes the
 * chat's last flip had stopped, which this one does not list again.
 */
export function foundItems(report: PathReport, was: readonly PathEntry[], steps: readonly LvStep[], stoppedBefore: ReadonlySet<number> = new Set()): FoundItem[] {
  const items: FoundItem[] = [];
  const number = new Map(was.map((e, i) => [e.message, i]));
  const gone = report.gone.flatMap((g) => (g.turn === null ? [] : [{ turn: g.turn, message: g.message, n: number.get(g.message) ?? null }]));
  if (gone.length > 0) items.push({ kind: "deleted", turns: gone.map((g) => g.turn), gone });
  if (report.swiped !== null) items.push({ kind: "swiped", message: report.swiped.message, to: report.swiped.to });
  const stopped = report.notApplied.filter((n) => !stoppedBefore.has(n.change)).map((n) => ({ change: n.change, turn: n.turn, op: n.op, codes: n.reports.map((r) => r.code) }));
  const stretch = report.rebased === null ? null : { from: report.rebased.from, to: report.rebased.to };
  for (const f of report.flipped) items.push({ kind: "flipped", message: f.message, to: f.to, stretch, stopped });
  for (const e of report.edited) items.push({ kind: "edited", message: e.message, turn: e.turn });
  const heard = new Map(was.flatMap((e) => (e.user ? [[e.message, e.hash] as const] : [])));
  for (const s of steps) {
    const had = heard.get(s.id);
    if (s.role === "user" && had !== undefined && had !== s.shown.hash) items.push({ kind: "player_edited", message: s.id, had });
  }
  const read = new Map(was.flatMap((e) => (e.user ? [] : [[e.message, e.hash] as const])));
  const at = new Map(steps.map((s, i) => [s.id, i]));
  for (const run of report.unplayed) {
    const from = at.get(run.from);
    const to = at.get(run.to);
    if (from === undefined || to === undefined) continue;
    let stretch: { from: string; to: string } | null = null;
    for (const s of steps.slice(from, to + 1)) {
      if (s.role !== "assistant") continue;
      if (s.shown.hash !== NOTHING_WRITTEN && read.get(s.id) !== s.shown.hash) {
        if (stretch === null) stretch = { from: s.id, to: s.id };
        else stretch.to = s.id;
        continue;
      }
      if (stretch !== null) items.push({ kind: "unplayed", ...stretch });
      stretch = null;
    }
    if (stretch !== null) items.push({ kind: "unplayed", ...stretch });
  }
  return items;
}

export class SinceKept {
  constructor(private readonly db: Database) {}

  /** Keeps what a comparison found under `after`, the turn at the head of the chat's path then (null while none is); inside a queued write. */
  keep(into: Database, user: string, chat: string, after: string | null, items: readonly FoundItem[], at: number): void {
    const put = into.query("INSERT INTO since_found (user, id, chat, after, at, item) VALUES (?, ?, ?, ?, ?, ?)");
    for (const item of items) put.run(user, crypto.randomUUID(), chat, after, at, JSON.stringify(item));
  }

  /** What was found while `after` was the turn at the head of the chat's path, oldest first. */
  found(user: string, chat: string, after: string | null): KeptItem[] {
    return this.db
      .query<{ id: string; at: number; item: string }, [string, string, string | null]>("SELECT id, at, item FROM since_found WHERE user = ? AND chat = ? AND after IS ? ORDER BY at, rowid")
      .all(user, chat, after)
      .map((r) => ({ id: r.id, at: r.at, item: JSON.parse(r.item) as FoundItem }));
  }

  /** The changes the chat's last flip kept here had stopped from applying; none before its first. */
  stoppedBefore(user: string, chat: string): Set<number> {
    const row = this.db
      .query<{ item: string }, [string, string]>("SELECT item FROM since_found WHERE user = ? AND chat = ? AND json_extract(item, '$.kind') = 'flipped' ORDER BY at DESC, rowid DESC LIMIT 1")
      .get(user, chat);
    const item = row === null ? null : (JSON.parse(row.item) as FoundItem);
    return new Set(item?.kind === "flipped" ? (item.stopped ?? []).map((s) => s.change) : []);
  }

  /** The ids of what `turn` was told. */
  toldTo(user: string, turn: string): Set<string> {
    return new Set(this.db.query<{ item: string }, [string, string]>("SELECT item FROM since_told WHERE user = ? AND turn = ?").all(user, turn).map((r) => r.item));
  }

  /** Keeps that `turn` was told these; inside a queued write. */
  told(into: Database, user: string, turn: string, items: readonly string[]): void {
    const put = into.query("INSERT OR IGNORE INTO since_told (user, turn, item) VALUES (?, ?, ?)");
    for (const item of items) put.run(user, turn, item);
  }
}
