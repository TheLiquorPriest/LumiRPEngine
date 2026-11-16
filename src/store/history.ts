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

/**
 * Every change along `chat`'s path, up to `turn` (its head when none is given), that wrote `part` of the level `ref`, oldest first
 * (`ValueWrite`). A turn of another chat on the path (a branch's shared history) is read as the path holds it.
 */
export function valueHistory(store: UserStore, env: Pick<FoldEnv, "registry" | "areas">, chat: string, ref: string, part: string, turn?: string): ValueWrite[] {
  const path = store.path(chat).flatMap((e) => (e.turn === null ? [] : [e.turn]));
  const end = turn === undefined ? path.length : path.indexOf(turn) + 1;
  const out: ValueWrite[] = [];
  const seen = new Set<number>();
  const take = (c: ChangeRow, at: string | null, n: number, applied: boolean): void => {
    seen.add(c.id);
    for (const w of writesOf(env, c.op, c.value)) if (w.ref === ref && w.part === part) out.push({ change: c, turn: at, n, applied, value: w.value, kind: w.fact ? "fact" : "value", settledBy: null });
  };
  for (const [i, t] of path.slice(0, Math.max(end, 0)).entries()) {
    for (const placed of store.changesBefore(t)) take(placed.change, t, i + 1, placed.applied);
    // A job's write on a turn counts where it takes effect, among what is placed before a later turn.
    for (const c of store.changes(t)) if (c.job === null) take(c, t, i + 1, c.applied);
  }
  // At the head, his own edits after the path's last turn.
  if (turn === undefined) for (const c of store.ownerChanges(chat)) if (!seen.has(c.id) && c.job === null) take(c, null, path.length + 1, c.applied);
  // A fact is settled by the first later exact record of its key's value (R-62).
  for (const [i, w] of out.entries()) {
    if (w.kind !== "fact") continue;
    const later = out.slice(i + 1).find((x) => x.kind === "value" && x.applied && x.n > w.n && (x.change.precision === null || x.change.precision === "exact"));
    w.settledBy = later?.turn ?? null;
  }
  return out;
}
