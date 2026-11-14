// The packs' handlers are reused as they are: the two chats the ledger suite keeps, recorded on an
// earlier build (`test/ledger/recorded-58b2ac44.json`: money, interest, the market, people's needs,
// signals), folded through the store as turns of changes, end where today's reducers end, to the
// balances and marks they were recorded with.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { hashJson } from "../../src/shared/hash";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { DataTable } from "../../src/shared/tables";
import type { WorldDoc } from "../../src/shared/world";
import { applyEvent, validateEvent } from "../../src/engine/events";
import { objOf } from "../../src/engine/pack-kit";
import { initialState } from "../../src/engine/world-state";
import { engine, hashOf, registry, testStore } from "./fixtures";

interface Recorded {
  name: string;
  world: WorldDoc;
  worldHash: string;
  events: LedgerEvent[];
  clock: number;
  balances: Record<string, number>;
  quotes: Record<string, number>;
}

const dir = join(import.meta.dir, "..", "ledger");
const recorded = (JSON.parse(readFileSync(join(dir, "recorded-58b2ac44.json"), "utf8")) as { recorded: Recorded[] }).recorded;
const kept = JSON.parse(gunzipSync(readFileSync(join(dir, "recorded-58b2ac44.tables.json.gz"))).toString("utf8")) as { tables: Record<string, DataTable> };

/** The world as it was recorded, with the tables it pinned. */
function worldOf(r: Recorded): WorldDoc {
  return { ...r.world, tables: Object.fromEntries(Object.keys(r.world.pins.tables).flatMap((id) => (kept.tables[id] ? [[id, kept.tables[id]] as const] : []))) };
}

/** How many of a recorded chat's events one turn carries. */
const PER_TURN = 12;

describe("a ledger recorded on an earlier build, folded through the store", () => {
  test.each(recorded.map((r) => [r.name, r] as const))("%s ends where today's reducers end", (_name, r) => {
    const world = worldOf(r);
    expect(hashJson(world)).toBe(r.worldHash);
    const reg = registry();
    // Today: every event validated and applied in order, from the world's own start.
    const direct = initialState(world, r.worldHash, reg);
    for (const e of r.events) {
      const ctx = reg.context(world, direct);
      expect(validateEvent(reg, e, ctx)).toBeNull();
      applyEvent(reg, e, direct, ctx);
    }
    // The store: the same events as turns of changes, one reply after another.
    const { s, store } = testStore({ world, snapshotEvery: 5 });
    s.createChat({ id: "c", revision: r.worldHash });
    for (let i = 0; i * PER_TURN < r.events.length; i++) {
      const t = s.beginTurn({ chat: "c", kind: "normal" });
      const { changes } = s.addChanges(t.id, engine(...r.events.slice(i * PER_TURN, (i + 1) * PER_TURN)));
      expect(changes.every((c) => c.applied)).toBe(true);
      s.tieTurn(t.id, { message: `m${i}`, hash: hashOf(`reply ${i}`), date: i });
    }
    const ours = s.headState("c").state.world;
    expect(hashJson(ours)).toBe(hashJson(direct));
    expect(ours.clock).toBe(r.clock);
    expect(ours.accounts).toEqual(r.balances);
    expect(objOf(objOf(objOf(ours.packs.economy).holdings).quotes)).toEqual(r.quotes);
    // A cold start, from the nearest snapshot, ends in the same place.
    store.dropCaches();
    expect(hashJson(s.headState("c").state.world)).toBe(hashJson(direct));
  });
});
