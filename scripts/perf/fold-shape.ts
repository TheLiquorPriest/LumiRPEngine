// What a chat's fold does, step by step, counted from a read-only copy of RPE's database: how many of its path's turns fold as they
// were recorded (`foldSteps`' clean steps: on their own path, every change after all those before) and how many are checked again; and
// of the checked ones, how many units of events land in place (the store knows what each event writes) and how many are tried on a copy
// of the whole world first (`trialOnCopy`), by the event types that send them there. Counts and type names only: no value, no text.
//
//   bun build scripts/perf/fold-shape.ts --target bun --outfile fold-shape.js
//   bun fold-shape.js <copy of rpe.db> <chat id>

import { Database } from "bun:sqlite";

const [file, chat] = process.argv.slice(2);
if (file === undefined || chat === undefined) {
  console.log(JSON.stringify({ stopped: "arguments", wants: "<copy of rpe.db> <chat id>" }));
  process.exit(2);
}
const db = new Database(file, { readonly: true });
const row = db.query<{ user: string; path: string }, [string]>("SELECT user, path FROM chat WHERE id = ?").get(chat);
if (row === null) {
  console.log(JSON.stringify({ stopped: "no such chat" }));
  process.exit(2);
}
const turns = (JSON.parse(row.path) as { turn?: string | null }[]).flatMap((e) => (typeof e.turn === "string" ? [e.turn] : []));
const changesOf = db.query<{ id: number; op: string; value: string; applied: number }, [string, string]>("SELECT id, op, value, applied FROM change WHERE user = ? AND turn = ? AND job IS NULL ORDER BY ord");

// The core types whose writes the store knows (`working.ts` `writes`); a materialize knows its own when its inner events are such.
const KNOWN = new Set(["set", "add", "link", "unlink", "spawn", "post", "stage", "clock", "timelapse", "materialize"]);
/** The event a change carries, as the fold reads it (`eventOf`): an engine event's type and group, or null for a store or area operation. */
const eventOf = (op: string, value: string): { type: string; group: string | null } | null => {
  try {
    const v = JSON.parse(value) as { type?: unknown; group?: unknown };
    return typeof v.type === "string" && v.type === op ? { type: op, group: typeof v.group === "string" ? v.group : null } : null;
  } catch {
    return null;
  }
};

let upto = 0;
const counts = { turns: turns.length, clean: 0, checked: 0, changes: 0, applied: 0, eventsChecked: 0, singlesChecked: 0, unitsInPlace: 0, unitsOnCopy: 0, eventsOnCopy: 0 };
const onCopyBy = new Map<string, number>();
const groupSizes = new Map<number, number>();
for (const turn of turns) {
  const rows = changesOf.all(row.user, turn);
  counts.changes += rows.length;
  const live = rows.filter((c) => c.applied === 1);
  counts.applied += live.length;
  const first = rows[0]?.id ?? Number.POSITIVE_INFINITY;
  const clean = upto < first;
  for (const c of rows) if (c.id > upto) upto = c.id;
  if (clean) {
    counts.clean++;
    continue;
  }
  counts.checked++;
  // A run of events of one group is one unit; one with no group stands alone and lands in place, checked first (`runEvents`).
  const events = live.map((c) => eventOf(c.op, c.value));
  for (let k = 0; k < events.length; ) {
    const ev = events[k];
    if (ev === null || ev === undefined) {
      k++;
      continue;
    }
    counts.eventsChecked++;
    let end = k + 1;
    if (ev.group !== null) while (end < events.length && events[end]?.group === ev.group) end++;
    const unit = events.slice(k, end).filter((e): e is { type: string; group: string | null } => e !== null);
    if (unit.length === 1) counts.singlesChecked++;
    else {
      groupSizes.set(unit.length, (groupSizes.get(unit.length) ?? 0) + 1);
      if (unit.every((e) => KNOWN.has(e.type))) counts.unitsInPlace++;
      else {
        counts.unitsOnCopy++;
        counts.eventsOnCopy += unit.length;
        for (const t of new Set(unit.filter((e) => !KNOWN.has(e.type)).map((e) => e.type))) onCopyBy.set(t, (onCopyBy.get(t) ?? 0) + 1);
      }
    }
    counts.eventsChecked += unit.length - 1;
    k = end;
  }
}
const snapshots = db.query<{ kind: string; n: number }, [string]>("SELECT kind, count(*) AS n FROM snapshot WHERE user = ? GROUP BY kind").all(row.user);
console.log(JSON.stringify({ ...counts, snapshots: Object.fromEntries(snapshots.map((s) => [s.kind, s.n])) }));
console.log(JSON.stringify({ unitsOnCopyByType: Object.fromEntries([...onCopyBy].sort((a, b) => b[1] - a[1])) }));
console.log(JSON.stringify({ groupSizes: Object.fromEntries([...groupSizes].sort((a, b) => a[0] - b[0])) }));
db.close();
