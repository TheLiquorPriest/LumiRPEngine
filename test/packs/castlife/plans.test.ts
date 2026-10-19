// The castlife planner and characters' own plans (DESIGN §24.8): plans laid into their windows and
// lived at their times off screen, settled by events, occasions shaping the day, needs following the
// plan, invitations from plans, and Stance leaving the minded to the Minds section.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { Fidelity, MindPlan } from "../../../src/shared/minds";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockAt, dateAt, dayIndexOf, parseHHMM } from "../../../src/engine/calendar";
import { createRegistry } from "../../../src/engine/registry-impl";
import { ALL_NOTE } from "../../../src/engine/simulate";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { buildCastView, dayOptions, dayPlan, needValue, stanceLines } from "../../../src/packs/castlife/core/index";
import { birthdayOn } from "../../../src/packs/castlife/core/occasions";
import { modernUsWorld } from "../riverton";
import { fold, startState } from "../support";

const reg = createRegistry(ALL_PACKS);

/** Riverton (it starts Friday 16 October 2026 at 07:30), with a bank. */
function riverton(patch: (w: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("w", "R");
  world.places.bank = { id: "bank", name: "Riverton Savings Bank", parent: "riverton", sceneType: "conversation", fields: {} };
  patch(world);
  return new Working(reg, world, startState(world));
}

/** A clock reading: `day` days after the epoch (0 is Friday), at `hhmm`. */
function at(w: Working, day: number, hhmm: string): number {
  return clockAt(calendarOf(w.world), day, parseHHMM(hhmm));
}

function plan(w: Working, id: string, patch: Partial<MindPlan>): MindPlan {
  return { id, what: "Move money before the audit", kind: "errand", when: { from: at(w, 0, "10:00"), to: at(w, 0, "11:00") }, where: "bank", with: [], priority: 3, status: "open", made: w.state.clock, source: "mind", closed: null, reason: null, ...patch };
}

/** Applies recorded events, as a turn's minds would leave them; every one must apply. */
function record(w: Working, events: LedgerEvent[]): void {
  const dropped = w.dropped.length;
  w.applyAll(events);
  expect(w.dropped.slice(dropped)).toEqual([]);
}

const pin = (entity: string, level: Fidelity): LedgerEvent => ({ type: "minds.pin", data: { entity, level } });
const planEdit = (entity: string, p: MindPlan): LedgerEvent => ({ type: "minds.plan_edit", data: { entity, plan: p.id, value: JSON.parse(JSON.stringify(p)) } });

function lapse(w: Working, to: number): void {
  const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: "seed", overrides: ALL_NOTE });
  if ("code" in out) throw new Error(out.reason);
}

function outcomes(w: Working): LedgerEvent[] {
  return w.events.filter((e) => e.type === "minds.plan");
}

describe("castlife: characters' own plans", () => {
  test("a recorded plan takes the NPC to the bank at its time, off screen, and is marked done once it has passed", () => {
    const w = riverton();
    record(w, [pin("jordan", "live"), planEdit("jordan", plan(w, "p1", {}))]);
    lapse(w, at(w, 0, "10:30"));
    expect([w.state.entities.jordan?.fields.place, w.state.entities.jordan?.fields.activity]).toEqual(["bank", "errand"]);
    // Every player surface shows the plan's kind, never its own words.
    expect(dayPlan(w.ctx, "jordan").blocks.find((b) => b.start === at(w, 0, "10:00"))).toMatchObject({ label: "Errand", option: "plan:p1", reasons: ["their own plan"], fixed: true });
    w.apply({ type: "set", entity: "you", field: "place", value: "bank" });
    const cast = JSON.stringify(buildCastView(w.ctx).people.find((p) => p.id === "jordan"));
    expect(cast).toContain("Errand");
    expect(cast).not.toContain("audit");
    lapse(w, at(w, 0, "13:00"));
    expect(w.state.entities.jordan?.fields.place).toBe("office");
    expect(outcomes(w)).toEqual([{ type: "minds.plan", data: { entity: "jordan", plan: "p1", status: "done", at: at(w, 0, "11:00"), reason: null } }]);
    expect(w.ctx.query("minds.plans")(w.ctx, "jordan")).toEqual([]);
    expect(fold(reg, w.world, startState(w.world), w.events)).toEqual(w.state);
  });

  test("a plan's moves don't depend on how the time is cut", () => {
    const setup = (): Working => {
      const w = riverton();
      record(w, [pin("jordan", "live"), planEdit("jordan", plan(w, "p1", {}))]);
      return w;
    };
    const whole = setup();
    lapse(whole, at(whole, 0, "15:00"));
    const cut = setup();
    for (const t of ["10:15", "11:30", "15:00"]) lapse(cut, at(cut, 0, t));
    expect(cut.state.entities).toEqual(whole.state.entities);
    expect(cut.state.packs.minds).toEqual(whole.state.packs.minds);
  });

  test("a Far character's routine bends only for a strong plan; a Background one follows routine only", () => {
    const run = (level: Fidelity | null, priority: number): { place: unknown; outcome: unknown } => {
      const w = riverton();
      record(w, [...(level ? [pin("jordan", level)] : []), planEdit("jordan", plan(w, "p1", { priority }))]);
      lapse(w, at(w, 0, "10:30"));
      const place = w.state.entities.jordan?.fields.place;
      lapse(w, at(w, 0, "13:00"));
      const first = outcomes(w)[0];
      return { place, outcome: first && "data" in first ? first.data : null };
    };
    expect(run("far", 3)).toMatchObject({ place: "office", outcome: { status: "dropped", reason: "no time for it" } });
    expect(run("far", 4)).toMatchObject({ place: "bank", outcome: { status: "done" } });
    expect(run(null, 5)).toMatchObject({ place: "office", outcome: { status: "dropped", reason: "routine only" } });
  });

  test("a plan with a wide window lands in its kind's hours where routine leaves room", () => {
    const w = riverton();
    record(w, [pin("jordan", "live"), planEdit("jordan", plan(w, "p2", { priority: 2, when: { from: at(w, 0, "00:00"), to: at(w, 1, "23:59") } }))]);
    const laid = w.ctx.query("castlife.commitments")(w.ctx, "jordan", at(w, 0, "00:00"), at(w, 2, "00:00")).filter((c) => c.kind === "plan");
    expect(laid).toEqual([{ start: at(w, 1, "09:00"), end: at(w, 1, "09:45"), activity: "errand", place: "bank", kind: "plan", label: "Errand", plan: "p2" }]);
  });

  test("an NPC's needs follow what their plan has them do: a plan through the lunch hour leaves them hungry", () => {
    const hunger = (withPlan: boolean): number => {
      const w = riverton();
      record(w, [pin("jordan", "live"), ...(withPlan ? [planEdit("jordan", plan(w, "p3", { kind: "visit", where: "park", when: { from: at(w, 1, "11:00"), to: at(w, 1, "15:00") } }))] : [])]);
      return needValue(w.ctx, "jordan", "hunger", at(w, 1, "15:00"));
    };
    expect(hunger(true) - hunger(false)).toBeGreaterThanOrEqual(10);
  });

  test("with minds on, invitations come from plans with the POV and the formula is silent", () => {
    const w = riverton((wd) => {
      wd.entities.maya?.relations.push({ type: "regard", to: "you", fields: { warmth: 60, trust: 50, respect: 40, t: 0 } });
    });
    record(w, [{ type: "minds.round", data: { at: w.state.clock, on: true } }, pin("maya", "live"), planEdit("maya", plan(w, "p4", { what: "Ask Alex about the letter", kind: "meet", where: "cafe", with: ["you"], when: { from: at(w, 0, "18:00"), to: at(w, 0, "19:30") } }))]);
    lapse(w, at(w, 0, "20:00"));
    const invites = w.events.flatMap((e) => (e.type === "castlife.invitation" && "data" in e ? [e.data] : []));
    expect(invites).toEqual([{ agent: "maya", place: "cafe", at: at(w, 0, "18:00"), text: "Maya Chen invites you to Daybreak Café at 18:00.", key: "maya:plan:p4" }]);
  });
});

describe("castlife: occasions", () => {
  test("a birthday or a holiday changes the day's options", () => {
    const w = riverton((wd) => {
      wd.calendar.holidays.push({ id: "harvest_fair", label: "Harvest Fair", rule: { type: "fixed", month: 10, day: 19 }, dayOff: true });
    });
    const ids = (day: number): string[] => dayOptions(w.ctx, "rosa", at(w, day, "00:00")).map((o) => o.id);
    expect(ids(1)).not.toContain("birthday");
    w.apply({ type: "set", entity: "rosa", field: "birthday", value: "10-17" });
    expect(ids(1)).toContain("birthday");
    expect(dayPlan(w.ctx, "rosa", 1).blocks.some((b) => b.label === "Birthday")).toBe(true);
    // A holiday that's a day off brings its own option and a slow morning; Tuesday is ordinary.
    const monday = dayOptions(w.ctx, "rosa", at(w, 3, "00:00"));
    expect(monday.find((o) => o.id === "holiday:harvest_fair")?.label).toBe("Harvest Fair");
    expect(monday.find((o) => o.id === "breakfast")?.window).toEqual({ from: at(w, 3, "07:00"), to: at(w, 3, "11:00") });
    expect(dayOptions(w.ctx, "rosa", at(w, 4, "00:00")).find((o) => o.id === "breakfast")?.window).toEqual({ from: at(w, 4, "06:00"), to: at(w, 4, "10:00") });
    expect(dayPlan(w.ctx, "rosa", 3).blocks.some((b) => b.label === "Harvest Fair")).toBe(true);
  });

  test("a 29 February birthday falls on the 28th in a common year, and an unreadable one is flagged", () => {
    const world = modernUsWorld("w", "R");
    const cal = calendarOf(world);
    expect(birthdayOn(cal, "02-29", dateAt(cal, clockAt(cal, dayIndexOf(cal, 2027, 2, 28), 0)))).toBe(true);
    expect(birthdayOn(cal, "02-29", dateAt(cal, clockAt(cal, dayIndexOf(cal, 2028, 2, 28), 0)))).toBe(false);
    if (world.entities.rosa) world.entities.rosa.fields.birthday = "31/12";
    if (world.entities.maya) world.entities.maya.fields.birthday = "1994-02-29";
    const issues = reg.lints.flatMap((rule) => rule.check(world)).filter((i) => i.code === "castlife.birthday");
    expect(issues.map((i) => i.path)).toEqual(["entities.rosa.fields.birthday"]);
  });
});

describe("castlife: Stance and minds", () => {
  test("Stance leaves out the people the Minds section tells of", () => {
    const w = riverton();
    w.apply({ type: "set", entity: "maya", field: "place", value: "apartment" });
    expect(stanceLines(w.ctx).some((l) => l.startsWith("Maya Chen"))).toBe(true);
    record(w, [
      { type: "minds.round", data: { at: w.state.clock, on: true } },
      { type: "minds.mind", data: { entity: "maya", at: w.state.clock, place: "apartment", level: "live", moment: "turn", reason: "live", monologue: "I should say something.", depiction: "fidgets with her keys", intent: "Ask about the rent.", reactions: [], plans: [], mood: null, interrupt: null, withheld: false } },
    ]);
    expect(stanceLines(w.ctx).some((l) => l.startsWith("Maya Chen"))).toBe(false);
  });
});
