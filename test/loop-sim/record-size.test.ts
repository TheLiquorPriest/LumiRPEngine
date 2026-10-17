// Record size (DESIGN §4.3, §18.5): a dense timelapse segment — Riverton plus 17 more LOD1 agents,
// every interrupt at `note`, running to the 600 agent-day unit cap — records at most 32 KB after
// coarsening, folds to exactly the raw fold's state, and its Montage matches the record.
import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import { hashJson } from "../../src/shared/hash";
import { DOMAINS, type DomainId, type Level } from "../../src/shared/ids";
import { REALISM_PRESETS } from "../../src/engine/realism";
import { coarsen } from "../../src/engine/simulate";
import { runTimelapse } from "../../src/engine/time";
import { planTurn, timelapseIntent } from "../../src/engine/turn";
import { Working } from "../../src/engine/working";
import { modernUsWorld } from "../packs/riverton";
import { fold, startState } from "../packs/support";
import { reg } from "./harness";

const RECORD_CAP = 32 * 1024;

function denseWorld(preset: "simulation" | "level4"): WorldDoc {
  const world = modernUsWorld("w_dense", "Riverton dense");
  if (preset === "level4") world.realism = { preset: "custom", levels: Object.fromEntries(DOMAINS.map((d) => [d, 4])) as Record<DomainId, Level>, tierCaps: { principal: {}, supporting: {}, background: {} } };
  else world.realism = { preset, ...structuredClone(REALISM_PRESETS[preset]) };
  const maya = world.entities.maya;
  if (!maya) throw new Error("no Maya in Riverton");
  for (let i = 0; i < 17; i++) world.entities[`agent_${i}`] = { ...structuredClone(maya), id: `agent_${i}`, name: `Agent ${i}` };
  return world;
}

const ALL_NOTE_OVERRIDES = (world: WorldDoc): Record<string, string> => Object.fromEntries(Object.keys(world.time.interrupts).map((k) => [k, "note"]));

/** Money in and out per account, as the Montage counts it, from a list of postings. */
function moneyOf(events: readonly LedgerEvent[], accounts: ReadonlySet<string>): Record<string, { in: number; out: number }> {
  const out: Record<string, { in: number; out: number }> = {};
  for (const e of events) {
    if (e.type !== "post") continue;
    for (const l of e.lines) {
      if (!accounts.has(l.account)) continue;
      const m = out[l.account] ?? { in: 0, out: 0 };
      if (l.amount >= 0) m.in += l.amount;
      else m.out -= l.amount;
      out[l.account] = m;
    }
  }
  return out;
}

describe("a 600 agent-day timelapse segment records ≤ 32 KB, exactly", () => {
  for (const preset of ["simulation", "level4"] as const) {
    test(`${preset}: the coarsened record is small, folds exactly, and the Montage matches it`, () => {
      const world = denseWorld(preset);
      const s0 = startState(world);
      const plan = planTurn({ registry: reg, world, state: s0, runSeed: "bench", seed: "s1", kind: "normal", userTexts: [""], intent: timelapseIntent({ type: "duration", minutes: 30 * 1440 }, ALL_NOTE_OVERRIDES(world)) });
      // The unit cap ends the segment near 28 days for 20 agents plus the POV.
      expect(plan.elapsedMinutes).toBeGreaterThanOrEqual(27 * 1440);
      expect(JSON.stringify(plan.events).length).toBeLessThanOrEqual(RECORD_CAP);

      // Exactness: the same segment uncoarsened folds to the state the record folds to.
      const w = new Working(reg, world, s0);
      const raw = runTimelapse(reg, w, { type: "duration", minutes: plan.elapsedMinutes }, { runSeed: "bench", overrides: ALL_NOTE_OVERRIDES(world) });
      if ("code" in raw) throw new Error(raw.reason);
      const coarse = coarsen(reg, world, s0, w.events);
      expect(coarse.length).toBeLessThan(w.events.length / 10);
      expect(hashJson(fold(reg, world, s0, coarse))).toBe(hashJson(w.state));

      // The Montage the turn shows is built from its record: money per account equals the record's postings.
      const recorded = fold(reg, world, s0, plan.events);
      const accounts = new Set((plan.montage?.money ?? []).map((m) => m.account));
      const fromRecord = moneyOf(plan.events, accounts);
      for (const m of plan.montage?.money ?? []) expect({ in: m.in, out: m.out }).toEqual(fromRecord[m.account] ?? { in: 0, out: 0 });
      expect(recorded.clock).toBe(s0.clock + plan.elapsedMinutes);
    });
  }
});
