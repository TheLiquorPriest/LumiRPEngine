// Plans reach the world (DEPTH-PLAN §4.4): a plan a character's own agent writes with a time goes
// through the minds pack's plans to the Cast life planner, which lays it into the character's day
// and settles it off screen, exactly as the memory step's plans are; one restated stays as it stands,
// one with no time read stays a thought in its plans file, and a remembered scene takes up its takes,
// which no rule ever cuts before (§4.1: a mind nearing a bound asks for its remembering).

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { WorldDoc } from "../../../src/shared/world";
import { agentPlan, mindFileWrite, mindLivedEvent, mindPath, mindTakeEvent, TAKES_KEPT, takesOf } from "../../../src/shared/character-engine";
import { calendarOf, clockAt, parseHHMM } from "../../../src/engine/calendar";
import { createRegistry } from "../../../src/engine/registry-impl";
import { ALL_NOTE } from "../../../src/engine/simulate";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { readCharacter } from "../../../src/packs/minds/core/state";
import { modernUsWorld } from "../riverton";
import { fold, startState } from "../support";

const reg = createRegistry(ALL_PACKS);

/** Riverton (it starts Friday 16 October 2026 at 07:30), with a bank. */
function riverton(): Working {
  const world: WorldDoc = modernUsWorld("w", "R");
  world.places.bank = { id: "bank", name: "Riverton Savings Bank", parent: "riverton", sceneType: "conversation", fields: {} };
  return new Working(reg, world, startState(world));
}

const at = (w: Working, day: number, hhmm: string): number => clockAt(calendarOf(w.world), day, parseHHMM(hhmm));

function record(w: Working, events: readonly LedgerEvent[]): void {
  const dropped = w.dropped.length;
  w.applyAll(events);
  expect(w.dropped.slice(dropped)).toEqual([]);
}

function lapse(w: Working, to: number): void {
  const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: "seed", overrides: ALL_NOTE });
  if ("code" in out) throw new Error(out.reason);
}

/** Jordan's agent remembering a scene in which he settled on a bank errand at ten. */
function plansWrite(w: Working, text: string, plans: Parameters<typeof mindFileWrite>[0]["plans"]): LedgerEvent[] {
  return mindFileWrite({ who: "jordan", path: mindPath("jordan", "plans"), at: w.state.clock, mode: "remember", lived: [], about: [], ...(plans ? { plans } : {}) }, text).events as LedgerEvent[];
}

describe("plans an agent writes reach the Cast life planner", () => {
  test("a plan with a time takes him to the bank at its time, off screen, and is marked done once it has passed", () => {
    const w = riverton();
    const errand = { what: "Move money before the audit", kind: "errand" as const, when: at(w, 0, "10:00"), until: at(w, 0, "11:00"), where: "bank" };
    record(w, plansWrite(w, "- The bank at ten, before the audit.", [errand]));
    // The planner reads it as his own plan, in force; a character whose agent keeps its mind lives it as a Near one does.
    expect(w.ctx.query("minds.plans")(w.ctx, "jordan").map((p) => [p.what, p.kind, p.source, p.status, p.where])).toEqual([["Move money before the audit", "errand", "agent", "open", "bank"]]);
    expect(w.ctx.query("minds.tier")(w.ctx, "jordan")).toBe("near");
    lapse(w, at(w, 0, "10:30"));
    expect([w.state.entities.jordan?.fields.place, w.state.entities.jordan?.fields.activity]).toEqual(["bank", "errand"]);
    lapse(w, at(w, 0, "13:00"));
    expect(w.ctx.query("minds.plans")(w.ctx, "jordan").map((p) => p.status)).toEqual(["done"]);
    // Restated in a later write, it is the same plan, left as the planner settled it.
    record(w, plansWrite(w, "- The bank at ten, done.", [errand]));
    expect(readCharacter(w.state, "jordan").plans.map((p) => [p.source, p.status])).toEqual([["agent", "done"]]);
    expect(fold(reg, w.world, startState(w.world), w.events)).toEqual(w.state);
  });

  test("a plan with no time read stays a thought; a shared one is everyone's in it, in its writer's words; a payment needs its amount and its payee", () => {
    const w = riverton();
    record(w, plansWrite(w, "- Call my sister some evening.", [{ what: "call my sister", when: "some evening" }]));
    expect(w.ctx.query("minds.plans")(w.ctx, "jordan")).toEqual([]);
    const from = at(w, 1, "19:00");
    expect(agentPlan("jordan", w.state.clock, { what: "dinner with Rosa", kind: "meet", when: from, with: ["rosa"] })).toMatchObject({ shared: true, by: "jordan", with: ["rosa"], when: { from, to: from + 60 } });
    expect(agentPlan("jordan", w.state.clock, { what: "pay Rosa back", kind: "pay", when: from, with: ["rosa"] })).toBeNull();
    expect(agentPlan("jordan", w.state.clock, { what: "pay Rosa back", kind: "pay", when: from, with: ["rosa"], cents: 2000 })).toMatchObject({ kind: "pay", cents: 2000 });
    expect(agentPlan("jordan", from + 61, { what: "dinner", when: from })).toBeNull();
  });

  test("remembering a scene takes up the takes it remembered", () => {
    const w = riverton();
    record(w, [mindLivedEvent({ who: "jordan", beats: ["b1"], at: 10, mode: "play" }) as LedgerEvent, mindTakeEvent({ who: "jordan", at: 10, lived: ["b1"], take: "She's lying to me." }).event as LedgerEvent]);
    expect(takesOf(w.state, "jordan")).toHaveLength(1);
    record(w, [mindLivedEvent({ who: "jordan", beats: ["b1"], at: 11, mode: "catch-up" }) as LedgerEvent]);
    expect(takesOf(w.state, "jordan")).toHaveLength(1);
    record(w, [mindLivedEvent({ who: "jordan", beats: ["b1"], at: 12, mode: "remember" }) as LedgerEvent]);
    expect(takesOf(w.state, "jordan")).toEqual([]);
  });

  test("no rule cuts a mind's takes: past TAKES_KEPT, the count that calls its remembering, every one stays, the first included", () => {
    const w = riverton();
    record(w, Array.from({ length: TAKES_KEPT + 1 }, (_, i) => mindTakeEvent({ who: "jordan", at: 10 + i, lived: ["b1"], take: `Take ${i}.` }).event as LedgerEvent));
    const kept = takesOf(w.state, "jordan");
    expect(kept).toHaveLength(TAKES_KEPT + 1);
    expect(kept[0]?.at).toBe(10);
    expect(kept.at(-1)?.at).toBe(10 + TAKES_KEPT);
  });
});
