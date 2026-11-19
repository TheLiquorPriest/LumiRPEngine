// What a chat's fold does, step by step, counted from a read-only copy of RPE's database: how many of its path's turns fold as they
// were recorded (`foldSteps`' clean steps: on their own path, every change after all those before) and how many are checked again; of
// the clean ones, how many hold an event whose writes the store does not know, which makes the step's draft copy the whole world
// (`thaw`), by the types that do; and of the checked ones, how many units of events land in place (the store knows what each event
// writes) and how many are tried on a copy of the whole world first (`trialOnCopy`), by the event types that send them there. Counts
// and type names only: no value, no text.
//
// With the build id the snapshots were stored under, it then folds the newest `turns` of the path (all of them where none is given) one
// after another, as the Journal's notes walk them cold, each step from the state the one before it left, and says what the steps cost
// by part: the copies (`structuredClone`: of the whole world for a unit tried on a copy, of the rest of the world where a draft is
// thawed, of an entity a known event writes), the freeze of each state held (`Store.keep`), the world documents read, the snapshot read
// the walk starts from, the ended jobs placed along each step's whole path (`jobsPlaced`), and the rest; with the slowest step.
//
//   bun build scripts/perf/fold-shape.ts --target bun --outfile fold-shape.js
//   bun fold-shape.js <copy of rpe.db> <chat id> [<build id> [<turns>]]

import { Database } from "bun:sqlite";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { Store, storedWorlds, UserStore } from "../../src/store";
import { STORE_AREAS } from "../../src/turn/store-areas";

const [file, chat, build, newest] = process.argv.slice(2);
if (file === undefined || chat === undefined) {
  console.log(JSON.stringify({ stopped: "arguments", wants: "<copy of rpe.db> <chat id> [<build id> [<turns>]]" }));
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
const counts = { turns: turns.length, clean: 0, cleanThawing: 0, checked: 0, changes: 0, applied: 0, eventsChecked: 0, singlesChecked: 0, unitsInPlace: 0, unitsOnCopy: 0, eventsOnCopy: 0 };
const onCopyBy = new Map<string, number>();
const thawBy = new Map<string, number>();
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
    // The first event of a type whose writes the store does not know thaws the step's draft: the whole world copied once.
    const unknown = live.flatMap((c) => {
      const ev = eventOf(c.op, c.value);
      return ev === null || KNOWN.has(ev.type) ? [] : [ev.type];
    });
    if (unknown.length > 0) {
      counts.cleanThawing++;
      for (const t of new Set(unknown)) thawBy.set(t, (thawBy.get(t) ?? 0) + 1);
    }
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
console.log(JSON.stringify({ cleanThawingByType: Object.fromEntries([...thawBy].sort((a, b) => b[1] - a[1])) }));
console.log(JSON.stringify({ unitsOnCopyByType: Object.fromEntries([...onCopyBy].sort((a, b) => b[1] - a[1])) }));
console.log(JSON.stringify({ groupSizes: Object.fromEntries([...groupSizes].sort((a, b) => a[0] - b[0])) }));

if (build !== undefined) {
  // Each part's time where it runs; none runs inside another, and what is left of the walk is the rest (the reducers, checks and reads).
  const ms = { copyUnitOnCopy: 0, copyThaw: 0, copyEntity: 0, copyOther: 0, freeze: 0, worldDocs: 0, snapshotRead: 0, pathJobs: 0 };
  const timed = <T, A extends unknown[], R>(fn: (this: T, ...a: A) => R, add: (took: number) => void) =>
    function (this: T, ...a: A): R {
      const began = performance.now();
      try {
        return fn.apply(this, a);
      } finally {
        add(performance.now() - began);
      }
    };
  const clone = globalThis.structuredClone;
  globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
    const began = performance.now();
    const out = clone(value, options);
    const took = performance.now() - began;
    const stack = new Error().stack ?? "";
    if (stack.includes("trialOnCopy")) ms.copyUnitOnCopy += took;
    else if (stack.includes("thaw")) ms.copyThaw += took;
    else if (stack.includes("claimed")) ms.copyEntity += took;
    else ms.copyOther += took;
    return out;
  }) as typeof structuredClone;
  const keep = Store.prototype.keep;
  Store.prototype.keep = timed(keep, (took) => (ms.freeze += took)) as typeof keep;
  const readSnapshot = Store.prototype.readSnapshot;
  Store.prototype.readSnapshot = timed(readSnapshot, (took) => (ms.snapshotRead += took)) as typeof readSnapshot;
  // A private method of the store's, reached by its name for the probe alone.
  const steps = UserStore.prototype as unknown as Record<"jobsPlaced", (this: UserStore, node: string) => unknown>;
  steps.jobsPlaced = timed(steps.jobsPlaced, (took) => (ms.pathJobs += took));
  const read = storedWorlds(db);
  const worlds = timed(read, (took) => (ms.worldDocs += took));
  const store = new Store({ db, registry: createRegistry(ALL_PACKS), worlds, areas: STORE_AREAS, fingerprint: build, log: () => undefined, handlerFailed: () => undefined });
  const s = store.user(row.user);
  const walked = turns.slice(-Math.max(1, Number(newest ?? turns.length)));
  let slowest = 0;
  const began = performance.now();
  for (const turn of walked) {
    const at = performance.now();
    s.stateAt(turn);
    slowest = Math.max(slowest, performance.now() - at);
  }
  const total = performance.now() - began;
  const parts = Object.values(ms).reduce((n, v) => n + v, 0);
  const round = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
  console.log(JSON.stringify({ walk: { steps: walked.length, ms: Math.round(total), perStep: Math.round(total / walked.length), slowestStep: Math.round(slowest), ...round(ms), rest: Math.round(total - parts) } }));
}
db.close();
