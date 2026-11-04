// Ledgers recorded on older code re-fold on this code to exactly what they were (DESIGN §14, replay
// identical). `recorded-58b2ac44.json` holds two Riverton chats played on an export of 58b2ac44
// (`git archive`), before interest ran at Money 3 and before the market followed the stock index's
// history, each saved as its world without its tables, the world's hash, the events, the clock, the
// balances and the marks: one at Money 3 through 1 November's deposit interest and the Visa's
// statement day, one at Money 4 through the market's days and its month's last close with an index
// fund held. `recorded-58b2ac44.tables.json.gz` keeps the tables those worlds pinned, 58b2ac44's own
// table files (`git show 58b2ac44:src/packs/<pack>/core/tables/modern-us/<table>.json`), since this
// code ships later revisions of some (the items model sized the Modern US tables); the world's hash
// proves the world put back together is the very one recorded. Interest and prices are events
// recorded as the turn runs (the money process's cycle tasks, the market's step), never worked out
// in the fold, so every recorded event is accepted and folds to the same balances and marks,
// whatever the world now keeps; what the new code adds starts with the next turn played. Data
// updates (DESIGN §9.2) make a new revision with this code's tables and leave the recorded one as
// it is, so a recorded chat replays on its own revision until it is upgraded, and the same after.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { hashJson } from "../../src/shared/hash";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import type { DataTable } from "../../src/shared/tables";
import { calendarOf, clockOfLocal } from "../../src/engine/calendar";
import { objOf } from "../../src/engine/pack-kit";
import { createRegistry } from "../../src/engine/registry-impl";
import { runTimelapse } from "../../src/engine/time";
import { Working } from "../../src/engine/working";
import type { WorldState } from "../../src/engine/state";
import { dateText } from "../../src/packs/economy/core/assets";
import { lastInterestOf } from "../../src/packs/economy/core/journal";
import { INDEX_HISTORY_TABLE } from "../../src/packs/economy/core/history";
import { ALL_PACKS, defaultTables } from "../../src/packs/index";
import { tableUpdates } from "../../src/engine/table-updates";
import { fold, startState } from "../packs/support";

interface Recorded {
  name: string;
  world: WorldDoc;
  worldHash: string;
  events: LedgerEvent[];
  clock: number;
  balances: Record<string, number>;
  quotes: Record<string, number>;
}

const reg = createRegistry(ALL_PACKS);
const recorded = (JSON.parse(readFileSync(join(import.meta.dir, "recorded-58b2ac44.json"), "utf8")) as { recorded: Recorded[] }).recorded;
/** The tables the recorded worlds pinned, as 58b2ac44 shipped them. */
const kept = JSON.parse(gunzipSync(readFileSync(join(import.meta.dir, "recorded-58b2ac44.tables.json.gz"))).toString("utf8")) as { commit: string; tables: Record<string, DataTable> };
const ALL_NOTE = { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } as const;

/** The world as it was recorded: its tables (left out of the file) are the ones it pinned, kept beside it. */
function worldOf(r: Recorded): WorldDoc {
  const pinned = Object.keys(r.world.pins.tables).flatMap((id) => {
    const t = kept.tables[id];
    return t ? [[id, t] as const] : [];
  });
  return { ...r.world, tables: Object.fromEntries(pinned) };
}

function named(name: string): Recorded {
  const r = recorded.find((x) => x.name === name);
  if (!r) throw new Error(`no recorded ledger ${name}`);
  return r;
}

function quotesOf(state: WorldState): unknown {
  return objOf(objOf(objOf(state.packs.economy).holdings).quotes);
}

describe("a ledger recorded on 58b2ac44", () => {
  test.each(recorded.map((r) => [r.name, r] as const))("%s folds on this code to the balances and marks it had, every event accepted", (_name, r) => {
    const world = worldOf(r);
    // The very world it was recorded in: every table it pinned, at that revision.
    for (const [id, revision] of Object.entries(r.world.pins.tables)) expect(world.tables[id]?.revision).toBe(revision);
    expect(hashJson(world)).toBe(r.worldHash);
    const state = fold(reg, world, startState(world), r.events);
    expect(state.clock).toBe(r.clock);
    expect(state.accounts).toEqual(r.balances);
    expect(quotesOf(state)).toEqual(r.quotes);
  });

  test("the market's recorded marks fold the same against a world that has since taken the stock index's history (an Upgrade)", () => {
    const r = named("money4-market");
    const world = worldOf(r);
    const history = defaultTables()[INDEX_HISTORY_TABLE];
    if (!history) throw new Error("no history table");
    const upgraded: WorldDoc = { ...world, tables: { ...world.tables, [INDEX_HISTORY_TABLE]: history }, pins: { ...world.pins, tables: { ...world.pins.tables, [INDEX_HISTORY_TABLE]: history.revision } } };
    const state = fold(reg, upgraded, startState(world), r.events);
    expect(state.accounts).toEqual(r.balances);
    expect(quotesOf(state)).toEqual(r.quotes);
  });

  test("at Money 3 the interest the old code never ran starts with the next turn played, never for the days it recorded", () => {
    const r = named("money3-interest");
    const world = worldOf(r);
    const before = fold(reg, world, startState(world), r.events);
    // 1 November and the Visa's statement day passed without interest on the old code, and the fold adds none.
    expect(lastInterestOf(before, "savings")).toBeNull();
    expect(lastInterestOf(before, "card")).toBeNull();
    const w = new Working(reg, world, before);
    const to = clockOfLocal(calendarOf(world), "2026-12-04T12:00");
    for (let guard = 0; w.state.clock < to && guard < 64; guard++) {
      const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: "run", overrides: ALL_NOTE });
      if ("code" in out) throw new Error(out.reason);
    }
    // The next 1st pays November's interest, after the recorded days.
    const paid = lastInterestOf(w.state, "savings");
    expect(paid ? dateText(world, paid.at) : null).toBe("2026-12-01");
    expect(paid && paid.at > r.clock && paid.cents > 0).toBe(true);
    expect(w.state.accounts.savings ?? 0).toBeGreaterThan(r.balances.savings ?? 0);
  });

  test.each(recorded.map((r) => [r.name, r] as const))("%s keeps its own revision through Data updates, and folds the same once upgraded to the revision they make", (_name, r) => {
    const world = worldOf(r);
    const updates = tableUpdates(world, reg.tables);
    // Its world never changed a table, so every newer one is taken: sized, aliased, the index's history added, and the unemployment taxes' rows and the tax-exempt statuses (ORG-SPEC §3.11, Phase 5).
    expect(Object.fromEntries(updates.map((u) => [u.table, u.status]))).toEqual({ "economy.catalog": "update", "economy.categories": "update", "economy.exempt": "missing", "economy.finance": "update", "economy.regions": "update", [INDEX_HISTORY_TABLE]: "missing", "economy.projects": "missing", "gear.items": "update", "gear.containers": "update" });
    // What Apply puts in the draft (`lre.editor shipped`): each shipped table, pinned at its revision.
    const shipped = Object.fromEntries(updates.map((u) => [u.table, reg.tables.get(u.table)?.defaults]).filter((e): e is [string, DataTable] => e[1] !== undefined && e[1] !== null));
    const refreshed: WorldDoc = { ...world, tables: { ...world.tables, ...shipped }, pins: { ...world.pins, tables: { ...world.pins.tables, ...Object.fromEntries(Object.values(shipped).map((t) => [t.id, t.revision])) } } };
    expect(tableUpdates(refreshed, reg.tables)).toEqual([]);
    expect(hashJson(refreshed)).not.toBe(r.worldHash);
    // The recorded revision is untouched, and replays as recorded.
    expect(hashJson(world)).toBe(r.worldHash);
    const kept = fold(reg, world, startState(world), r.events);
    expect([kept.clock, kept.accounts, quotesOf(kept)]).toEqual([r.clock, r.balances, r.quotes]);
    // Upgraded, the recorded events fold the same against the new tables: what they add starts with the next turn.
    const upgraded = fold(reg, refreshed, startState(world), r.events);
    expect([upgraded.clock, upgraded.accounts, quotesOf(upgraded)]).toEqual([r.clock, r.balances, r.quotes]);
  });
});
