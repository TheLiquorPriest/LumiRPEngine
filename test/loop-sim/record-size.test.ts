// Record size (DESIGN §4.3, §9.6, §18.5): a dense timelapse segment — Riverton plus 17 more LOD1
// agents, everyone (the POV too) living a full world routine on top of the basic needs, every
// interrupt at `note`, running to the unit cap — records at most 32 KB after coarsening, folds to
// exactly the raw fold's state, and its Montage matches the record.
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
  // A dense day for everyone, the POV included (DESIGN §8): coffee out, a walk, errands three days a
  // week, drinks most evenings. Everyone meets the POV at the café, the park and the office, so those
  // blocks are lived at their minute (observable fidelity) and the unit cap's events end the segment
  // before its agent-days do (§9.6).
  world.routines = {
    daily: {
      id: "daily",
      label: "Daily",
      blocks: [
        { id: "coffee", label: "Coffee", activity: "leisure", kind: "flexible", window: { from: "07:00", to: "09:00" }, minutes: 30, place: { place: "cafe" } },
        { id: "walk", label: "A walk", activity: "leisure", kind: "flexible", window: { from: "10:00", to: "16:00" }, minutes: 60, place: { place: "park" } },
        { id: "errands", label: "Errands", activity: "errands", kind: "flexible", window: { from: "13:00", to: "17:00" }, minutes: 45, perWeek: 3, place: { place: "office" } },
        { id: "drinks", label: "Drinks", activity: "socialize", kind: "optional", window: { from: "18:00", to: "21:00" }, minutes: 90, chance: 0.6, place: { place: "cafe" } },
      ],
    },
  };
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

describe("a dense timelapse segment run to the unit cap records ≤ 32 KB, exactly", () => {
  for (const preset of ["simulation", "level4"] as const) {
    test(`${preset}: the coarsened record is small, folds exactly, and the Montage matches it`, () => {
      const world = denseWorld(preset);
      const s0 = startState(world);
      const plan = planTurn({ registry: reg, world, state: s0, runSeed: "bench", seed: "s1", kind: "normal", userTexts: [""], intent: timelapseIntent({ type: "duration", minutes: 30 * 1440 }, ALL_NOTE_OVERRIDES(world)) });
      // The unit cap's 5,000 events end the segment after 23 days for 20 agents plus the POV (33,390
      // minutes when measured), before its 600 agent-days: a denser world stops sooner (§9.6).
      expect(plan.elapsedMinutes).toBeGreaterThanOrEqual(23 * 1440);
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
