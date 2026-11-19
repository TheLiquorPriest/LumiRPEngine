// The history of one value by turn (plan §14 l.1551, §6.6): for a chat, at its head or at one of its turns, and a level and part of
// it (a field, a relation, a balance, a quest's stage, a fact's key, a world value, an area item's part), every change along the
// chat's path that wrote it, oldest first: the turn's own changes, and what is placed before each turn (a job's that took effect then,
// his own), and at the head his own after the last turn. Each with its turn's number, whether it applied, what it wrote there, and,
// for a fact, the later exact record that settled it (R-62). Read from the store alone; nothing is written.

import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { Touch } from "../engine/registry";
import { eventOf, type FoldEnv } from "./fold";
import type { UserStore } from "./store";
import { STORE_OPS, type ChangeRow } from "./types";

/** One change that wrote a value, as its history lists it. */
export interface ValueWrite {
  change: ChangeRow;
  /** The turn it is of, or the turn it stands just before (his own, a job's); null after the path's last turn. */
  turn: string | null;
  /** That turn's number on the chat's path; for one after the path's last turn, the number the next turn will have. */
  n: number;
  applied: boolean;
  /** What it left there: the value a field, a fact or a world value took, the amount posted, the stage reached; null where it took one off. */
  value: JsonValue;
  /** A typed value's write, or a fact standing beside one. */
  kind: "value" | "fact";
  /** For a fact: the turn of the later exact record of its key that settled it; null while it stands. */
  settledBy: string | null;
}

/** What a change writes: each (tree ref, part) it writes, with what it left there. */
export function writesOf(env: Pick<FoldEnv, "registry" | "areas">, op: string, value: JsonValue): { ref: string; part: string; value: JsonValue; fact?: true }[] {
  const v = isRecord(value) ? value : {};
  const area = env.areas?.of(op);
  if (area) {
    try {
      return (area.def.touches?.(value) ?? []).map((p) => ({ ref: p.ref, part: p.part, value }));
    } catch {
      return [];
    }
  }
  if (op === STORE_OPS.fact) return typeof v.about === "string" && typeof v.key === "string" ? [{ ref: v.about, part: v.key, value: typeof v.value === "string" && v.value !== "" ? v.value : null, fact: true }] : [];
  if (op === STORE_OPS.note) return typeof v.at === "string" ? [{ ref: v.at, part: "note", value: typeof v.text === "string" && v.text !== "" ? v.text : null }] : [];
  if (op === STORE_OPS.value) return typeof v.key === "string" ? [{ ref: "world", part: v.key, value: v.value ?? null }] : [];
  const ev = eventOf(op, value);
  if (ev === null) return [];
  switch (ev.type) {
    case "set":
      return [{ ref: `entity:${ev.entity}`, part: ev.field, value: ev.value }];
    case "add":
      return [{ ref: `entity:${ev.entity}`, part: ev.field, value: ev.delta }];
    case "post":
      return ev.lines.map((l) => ({ ref: `entity:${l.account}`, part: "posted", value: l.amount }));
    case "link":
      return [{ ref: `entity:${ev.from}`, part: ev.rel, value: ev.to }];
    case "unlink":
      return [{ ref: `entity:${ev.from}`, part: ev.rel, value: null }];
    case "stage":
      return [{ ref: `track:${ev.track}`, part: "stage", value: ev.to }];
    case "clock":
      return [{ ref: "world", part: "time", value: ev.minutes }];
  }
  let touches: readonly Touch[];
  try {
    touches = env.registry.get(ev.type)?.touches?.(ev) ?? [];
  } catch {
    return [];
  }
  return touches.map((t) => ({ ref: `entity:${t.entity}`, part: "field" in t ? t.field : "rel" in t ? t.rel : t.aspect, value: value }));
}

/** A level and one part of it whose history is asked (`valueHistories`). */
export interface ValueAsked {
  ref: string;
  part: string;
}

/**
 * The word a change must name to write `ref`, where every write of it names one: a track's id, which the one event that moves a track
 * (`stage`) carries as its `track`, and a fact or a note at the track's level carries in its `about` or `at`. Null for any other level,
 * which a pack's code may write by what it works out of a change (`touches`).
 */
function namedBy(ref: string): string | null {
  return ref.startsWith("track:") ? ref.slice("track:".length) : null;
}

/**
 * For each of `asked`, every change along `chat`'s path, up to `turn` (its head when none is given), that wrote that part of that level,
 * oldest first (`ValueWrite`), in one walk of the path for all of them. A turn of another chat on the path (a branch's shared history) is
 * read as the path holds it; a turn begun and not yet tied to its reply is read after the turn it follows (its parent: the path's last
 * turn for a new reply, the one before the reply it swipes for a swipe), with the path up to there. Where every level asked is one a
 * write always names (`namedBy`), only the changes naming one of them are read; where nothing stands placed before any turn of the
 * chat (`UserStore.anyPlaced`), no turn is asked what is.
 */
export function valueHistories(store: UserStore, env: Pick<FoldEnv, "registry" | "areas">, chat: string, asked: readonly ValueAsked[], turn?: string): ValueWrite[][] {
  const outs = asked.map((): ValueWrite[] => []);
  if (asked.length === 0) return outs;
  const path = store.path(chat).flatMap((e) => (e.turn === null ? [] : [e.turn]));
  const open = turn !== undefined && !path.includes(turn) && store.turn(turn)?.status === "open" ? store.turn(turn) : undefined;
  const parent = open?.parent ?? null;
  const end = turn === undefined ? path.length : open !== undefined ? (parent === null ? 0 : path.includes(parent) ? path.indexOf(parent) + 1 : path.length) : path.indexOf(turn) + 1;
  const at = new Map(asked.map((a, i) => [`${a.ref}\u0000${a.part}`, i]));
  const seen = new Set<number>();
  const take = (c: ChangeRow, t: string | null, n: number, applied: boolean): void => {
    seen.add(c.id);
    for (const w of writesOf(env, c.op, c.value)) {
      const i = at.get(`${w.ref}\u0000${w.part}`);
      if (i !== undefined) outs[i]?.push({ change: c, turn: t, n, applied, value: w.value, kind: w.fact ? "fact" : "value", settledBy: null });
    }
  };
  const names = asked.map((a) => namedBy(a.ref));
  const naming = names.every((n) => n !== null) ? [...new Set(names as string[])] : null;
  const walked = path.slice(0, Math.max(end, 0));
  const placed = store.anyPlaced(chat);
  const own = store.ownChanges(walked, naming);
  for (const [i, t] of walked.entries()) {
    if (placed) for (const p of store.changesBefore(t)) take(p.change, t, i + 1, p.applied);
    // A job's write on a turn counts where it takes effect, among what is placed before a later turn.
    for (const c of own.get(t) ?? []) take(c, t, i + 1, c.applied);
  }
  // A turn begun and not yet tied to its reply stands after the turn it follows: what was placed before it and its own changes count there.
  if (open !== undefined && turn !== undefined) {
    if (placed) for (const p of store.changesBefore(turn)) take(p.change, turn, end + 1, p.applied);
    for (const c of store.ownChanges([turn], naming).get(turn) ?? []) take(c, turn, end + 1, c.applied);
  }
  // At the head, his own edits after the path's last turn.
  if (turn === undefined) for (const c of store.ownerChanges(chat)) if (!seen.has(c.id) && c.job === null) take(c, null, path.length + 1, c.applied);
  // A fact is settled by the first later exact record of its key's value (R-62).
  for (const out of outs) {
    for (const [i, w] of out.entries()) {
      if (w.kind !== "fact") continue;
      const later = out.slice(i + 1).find((x) => x.kind === "value" && x.applied && x.n > w.n && (x.change.precision === null || x.change.precision === "exact"));
      w.settledBy = later?.turn ?? null;
    }
  }
  return outs;
}
