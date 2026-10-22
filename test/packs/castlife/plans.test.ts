// The castlife planner and characters' own plans (DESIGN §24.8): plans laid into their windows and
// lived at their times off screen, settled by events, occasions shaping the day, needs following the
// plan, invitations from plans, Stance leaving the minded to the Minds section, and a mind's own plans
// from an older chat driving none of it.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { Fidelity, MindPlan } from "../../../src/shared/minds";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockAt, dateAt, dayIndexOf, formatTimeOfDay, parseHHMM } from "../../../src/engine/calendar";
import type { PlanOption } from "../../../src/engine/plan-day";
import { createRegistry } from "../../../src/engine/registry-impl";
import { ALL_NOTE, advance, catchUp } from "../../../src/engine/simulate";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
// The occasion-shaped template is what earlier builds planned with; it now lays only the days their recorded need events fold against.
import { buildCastView, legacyDayOptions as dayOptions, dayPlan, needValue, stanceLines } from "../../../src/packs/castlife/core/index";
import { readCharacter } from "../../../src/packs/minds/core/state";
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
  return { id, what: "Move money before the audit", kind: "errand", when: { from: at(w, 0, "10:00"), to: at(w, 0, "11:00") }, where: "bank", with: [], priority: 3, status: "open", made: w.state.clock, source: "memory", closed: null, reason: null, ...patch };
}

/** Applies recorded events, as a turn's minds would leave them; every one must apply. */
function record(w: Working, events: LedgerEvent[]): void {
  const dropped = w.dropped.length;
  w.applyAll(events);
  expect(w.dropped.slice(dropped)).toEqual([]);
}

const pin = (entity: string, level: Fidelity): LedgerEvent => ({ type: "minds.pin", data: { entity, level } });
const planEdit = (entity: string, p: MindPlan): LedgerEvent => ({ type: "minds.plan_edit", data: { entity, plan: p.id, value: JSON.parse(JSON.stringify(p)) } });
/** A mind as an older chat's ledger holds it: its answer carried plans of its own. */
const oldMind = (w: Working, entity: string, p: MindPlan): LedgerEvent[] => [
  { type: "minds.round", data: { at: w.state.clock, on: true } },
  { type: "minds.mind", data: { entity, at: w.state.clock, place: null, level: "live", moment: "turn", reason: "live", monologue: "m", depiction: "d", intent: "i", reactions: [], plans: [JSON.parse(JSON.stringify(p))], mood: null, interrupt: null, withheld: false } },
];

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
    // Off screen: a Far character, whose routine bends for a strong plan and takes him back after it.
    // Decision (issue #48, routine roles): a Far routine is informative by default, so the chat
    // enforces his here, as the GM would, for his routine to take him back.
    record(w, [pin("jordan", "far"), { type: "castlife.follow", data: { entity: "jordan", follow: { mode: null, awareness: null, role: "enforced" } } }, planEdit("jordan", plan(w, "p1", { priority: 4 }))]);
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
    expect(w.ctx.query("minds.plans")(w.ctx, "jordan").map((p) => p.status)).toEqual(["done"]);
    expect(fold(reg, w.world, startState(w.world), w.events)).toEqual(w.state);
  });

  test("a plan a mind made in an older chat takes them nowhere, asks no one and is never settled; the GM's still takes them", () => {
    // Off screen (a Far character), where a plan with the POV asks them along; an invitation passes
    // only between people who know each other, so Jordan knows the POV.
    const run = (events: (w: Working) => LedgerEvent[], level: Fidelity = "far"): { at: unknown; outcomes: LedgerEvent[]; invited: boolean; laid: number; held: string[] } => {
      const w = riverton((wd) => void wd.entities.jordan?.relations.push({ type: "knows", to: "you" }));
      record(w, [pin("jordan", level), ...events(w)]);
      lapse(w, at(w, 0, "10:30"));
      const place = w.state.entities.jordan?.fields.place;
      lapse(w, at(w, 0, "13:00"));
      return {
        at: place,
        outcomes: outcomes(w),
        invited: w.events.some((e) => e.type === "castlife.invitation"),
        laid: w.ctx.query("minds.plans")(w.ctx, "jordan").length,
        held: readCharacter(w.state, "jordan").plans.map((p) => `${p.id}:${p.source}:${p.status}`),
      };
    };
    // A meeting with the player character at the bank: the plan that would ask them along.
    const meet = (w: Working, source: MindPlan["source"]): MindPlan => plan(w, "p1", { kind: "meet", with: ["you"], priority: 5, source });
    const mind = run((w) => oldMind(w, "jordan", meet(w, "mind")));
    expect(mind).toEqual({ at: "office", outcomes: [], invited: false, laid: 0, held: ["p1:mind:open"] });
    const gm = run((w) => [planEdit("jordan", meet(w, "gm"))]);
    expect(gm).toMatchObject({ at: "bank", invited: true, laid: 1, held: ["p1:gm:done"] });
    // A Live character's still takes him, but asks no one along: his mind and the scene speak for him.
    expect(run((w) => [planEdit("jordan", meet(w, "gm"))], "live")).toMatchObject({ at: "bank", invited: false, laid: 1, held: ["p1:gm:done"] });
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

  test("a late catch-up settles plans as a timelapse does, each at its own time", () => {
    const setup = (): Working => {
      const w = riverton();
      record(w, [
        pin("jordan", "live"),
        planEdit("jordan", plan(w, "p1", {})),
        // A weak errand in his working hours: his routine leaves it no room.
        planEdit("jordan", plan(w, "p2", { priority: 2, when: { from: at(w, 0, "14:00"), to: at(w, 0, "15:00") } })),
      ]);
      return w;
    };
    const lapsed = setup();
    const settled: LedgerEvent[] = [
      { type: "minds.plan", data: { entity: "jordan", plan: "p1", status: "done", at: at(lapsed, 0, "11:00"), reason: null } },
      { type: "minds.plan", data: { entity: "jordan", plan: "p2", status: "dropped", at: at(lapsed, 0, "15:00"), reason: "no time for it" } },
    ];
    lapse(lapsed, at(lapsed, 0, "19:00"));
    expect(outcomes(lapsed)).toEqual(settled);
    // Turns move the clock without stepping him; the catch-up after them does, slot by slot.
    const late = setup();
    advance(reg, late, at(late, 0, "19:00"), { runSeed: "seed", mode: "turn" });
    expect(outcomes(late)).toEqual([]);
    expect(catchUp(reg, late, { runSeed: "seed", agents: 8 }).stepped.map((s) => s.agent)).toContain("jordan");
    expect(outcomes(late)).toEqual(settled);
    expect(fold(reg, late.world, startState(late.world), late.events)).toEqual(late.state);
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

  test("with minds on, invitations come from plans with the POV, none from the cast the story is about, and the formula is silent", () => {
    const invites = (level: Fidelity): unknown[] => {
      const w = riverton((wd) => {
        wd.entities.maya?.relations.push({ type: "regard", to: "you", fields: { warmth: 60, trust: 50, respect: 40, t: 0 } });
      });
      record(w, [{ type: "minds.round", data: { at: w.state.clock, on: true } }, pin("maya", level), planEdit("maya", plan(w, "p4", { what: "Ask Alex about the letter", kind: "meet", where: "cafe", with: ["you"], when: { from: at(w, 0, "18:00"), to: at(w, 0, "19:30") } }))]);
      lapse(w, at(w, 0, "20:00"));
      return w.events.flatMap((e) => (e.type === "castlife.invitation" && "data" in e ? [e.data] : []));
    };
    // Off screen (Far), her plan asks the POV along, its ground recorded with it.
    const w = riverton();
    expect(invites("far")).toEqual([{ agent: "maya", place: "cafe", at: at(w, 0, "18:00"), text: "Maya Chen invites you to Daybreak Café at 6:00 PM.", key: "maya:plan:p4", origin: "plan:p4" }]);
    // A Live or Near character's asks no one: their mind and the scene speak for them.
    expect(invites("live")).toEqual([]);
    expect(invites("near")).toEqual([]);
  });

  test("an invitation is asked at most 6 hours ahead, never before the day it's on, and names no place the POV can't see", () => {
    // Maya knows the POV: an invitation passes only between people who know each other.
    const w = riverton((wd) => void wd.entities.maya?.relations.push({ type: "regard", to: "you", fields: { warmth: 60, trust: 50, respect: 40, t: 0 } }));
    // Made on Friday morning, for Saturday (day 1): drinks at the café at 20:00, and a late one at Maya's flat, which the POV doesn't know, at 02:00.
    record(w, [
      { type: "minds.round", data: { at: w.state.clock, on: true } },
      pin("maya", "far"),
      planEdit("maya", plan(w, "drinks", { kind: "meet", where: "cafe", with: ["you"], priority: 4, when: { from: at(w, 1, "20:00"), to: at(w, 1, "21:30") } })),
      planEdit("maya", plan(w, "late", { kind: "meet", where: "maya_flat", with: ["you"], priority: 4, when: { from: at(w, 1, "02:00"), to: at(w, 1, "03:30") } })),
    ]);
    const asked = (): unknown[] => w.events.flatMap((e) => (e.type === "castlife.invitation" && "data" in e ? [[e.data.key, e.data.at, e.data.text]] : []));
    const late = ["maya:plan:late", at(w, 1, "02:00"), "Maya Chen invites you to meet up at 2:00 AM."];
    const drinks = ["maya:plan:drinks", at(w, 1, "20:00"), "Maya Chen invites you to Daybreak Café at 8:00 PM."];
    lapse(w, at(w, 0, "23:59"));
    expect(asked()).toEqual([]);
    lapse(w, at(w, 1, "00:01"));
    expect(asked()).toEqual([late]);
    lapse(w, at(w, 1, "13:59"));
    expect(asked()).toEqual([late]);
    lapse(w, at(w, 1, "14:01"));
    expect(asked()).toEqual([late, drinks]);
  });

  test("a plan's block holds its place and activity for its span: a routine edge inside it doesn't take the NPC back", () => {
    const w = riverton();
    // Jordan's work starts at 08:00; the errand that must happen takes the time up to 08:30 from it.
    // Decision (issue #48, routine roles): a Live routine is informative by default and moves no one,
    // so the chat enforces his here, as the GM would, to show the plan's hold against his routine.
    record(w, [pin("jordan", "live"), { type: "castlife.follow", data: { entity: "jordan", follow: { mode: null, awareness: null, role: "enforced" } } }, planEdit("jordan", plan(w, "early", { kind: "errand", where: "bank", priority: 5, when: { from: at(w, 0, "07:45"), to: at(w, 0, "08:30") } }))]);
    const seen: string[] = [];
    for (const t of ["07:50", "08:10", "08:25", "08:40"]) {
      lapse(w, at(w, 0, t));
      seen.push(`${t} ${String(w.state.entities.jordan?.fields.place)}/${String(w.state.entities.jordan?.fields.activity)}`);
    }
    expect(seen).toEqual(["07:50 bank/errand", "08:10 bank/errand", "08:25 bank/errand", "08:40 office/work_shift"]);
  });

  test("a wide plan goes around a stronger one and is lived there, and keeps its place once both are done", () => {
    const w = riverton();
    // Saturday (day 1), no work: a meeting at the café, and an errand any time from 10:00 to 18:00.
    record(w, [
      pin("jordan", "live"),
      planEdit("jordan", plan(w, "strong", { kind: "meet", where: "cafe", priority: 4, when: { from: at(w, 1, "10:00"), to: at(w, 1, "11:30") } })),
      planEdit("jordan", plan(w, "errand", { kind: "errand", where: "bank", priority: 2, when: { from: at(w, 1, "10:00"), to: at(w, 1, "18:00") } })),
    ]);
    const laid = (): unknown[] => w.ctx.query("castlife.commitments")(w.ctx, "jordan", at(w, 1, "00:00"), at(w, 2, "00:00")).flatMap((c) => (c.kind === "plan" ? [[c.plan, c.start, c.end]] : []));
    const placed = [["strong", at(w, 1, "10:00"), at(w, 1, "11:30")], ["errand", at(w, 1, "11:30"), at(w, 1, "12:15")]];
    expect(laid()).toEqual(placed);
    lapse(w, at(w, 1, "11:45"));
    expect([w.state.entities.jordan?.fields.place, w.state.entities.jordan?.fields.activity]).toEqual(["bank", "errand"]);
    lapse(w, at(w, 1, "19:00"));
    expect(outcomes(w).flatMap((e) => ("data" in e ? [[e.data.plan, e.data.status, e.data.at]] : []))).toEqual([["strong", "done", at(w, 1, "11:30")], ["errand", "done", at(w, 1, "12:15")]]);
    expect(laid()).toEqual(placed);
  });

  test("a plan a stronger one leaves no room for is dropped once its window has passed, never done", () => {
    const w = riverton((wd) => {
      const jordan = wd.entities.jordan;
      if (jordan) jordan.fields.appointments = [{ at: clockAt(calendarOf(wd), 1, parseHHMM("11:30")), minutes: 330, place: "office", label: "Stocktake" }];
    });
    record(w, [
      pin("jordan", "live"),
      planEdit("jordan", plan(w, "strong", { kind: "meet", where: "cafe", priority: 4, when: { from: at(w, 1, "10:00"), to: at(w, 1, "11:30") } })),
      planEdit("jordan", plan(w, "errand", { kind: "errand", where: "bank", priority: 2, when: { from: at(w, 1, "10:00"), to: at(w, 1, "17:00") } })),
    ]);
    lapse(w, at(w, 1, "19:00"));
    expect(outcomes(w).flatMap((e) => ("data" in e ? [[e.data.plan, e.data.status, e.data.at, e.data.reason]] : []))).toEqual([
      ["strong", "done", at(w, 1, "11:30"), null],
      ["errand", "dropped", at(w, 1, "17:00"), "no time for it"],
    ]);
  });

  test("a plan that's done keeps its day: the blocks it laid and the needs they met stay as they were", () => {
    const w = riverton();
    record(w, [pin("jordan", "live"), planEdit("jordan", plan(w, "visit", { kind: "visit", where: "park", when: { from: at(w, 1, "11:00"), to: at(w, 1, "15:00") } }))]);
    const saturday = (): string[] => dayPlan(w.ctx, "jordan", 1).blocks.map((b) => `${b.start}-${b.end} ${b.label}`);
    lapse(w, at(w, 1, "17:00"));
    const before = { blocks: saturday(), hunger: needValue(w.ctx, "jordan", "hunger", at(w, 1, "16:00")) };
    expect(before.blocks).toContain(`${at(w, 1, "11:00")}-${at(w, 1, "15:00")} A visit`);
    // The 18:00 step marks it done.
    lapse(w, at(w, 1, "19:00"));
    expect(outcomes(w).flatMap((e) => ("data" in e ? [e.data.status] : []))).toEqual(["done"]);
    expect({ blocks: saturday(), hunger: needValue(w.ctx, "jordan", "hunger", at(w, 1, "16:00")) }).toEqual(before);
  });

  test("a plan for now starts the moment after it was made, and its invitation is asked then", () => {
    const w = riverton((wd) => {
      wd.entities.maya?.relations.push({ type: "regard", to: "you", fields: { warmth: 60, trust: 50, respect: 40, t: 0 } });
    });
    const now = w.state.clock;
    // Maya is off screen (Far): a Live or Near character's plans ask no one along.
    record(w, [{ type: "minds.round", data: { at: now, on: true } }, pin("maya", "far"), pin("jordan", "live"), planEdit("jordan", plan(w, "now", { kind: "errand", where: "bank", priority: 4, when: { from: now, to: now + 45 } })), planEdit("maya", plan(w, "coffee", { kind: "meet", where: "cafe", with: ["you"], priority: 4, when: { from: now - 15, to: now + 90 } }))]);
    lapse(w, now + 10);
    expect([w.state.entities.jordan?.fields.place, w.state.entities.jordan?.fields.activity]).toEqual(["bank", "errand"]);
    const invites = w.events.flatMap((e) => (e.type === "castlife.invitation" && "data" in e ? [e.data] : []));
    expect(invites).toEqual([{ agent: "maya", place: "cafe", at: now + 1, text: `Maya Chen invites you to Daybreak Café at ${formatTimeOfDay(dateAt(calendarOf(w.world), now + 1).minuteOfDay)}.`, key: "maya:plan:coffee", origin: "plan:coffee" }]);
  });

  test("a minded character who isn't an LOD1 agent follows routine only: their plan isn't laid or lived, and it is dropped once its window has passed", () => {
    const w = riverton((wd) => {
      const jordan = wd.entities.jordan;
      if (jordan) jordan.agent = false;
    });
    record(w, [pin("jordan", "live"), planEdit("jordan", plan(w, "p1", {}))]);
    expect(w.ctx.query("castlife.commitments")(w.ctx, "jordan", at(w, 0, "00:00"), at(w, 1, "00:00")).some((c) => c.kind === "plan")).toBe(false);
    lapse(w, at(w, 0, "10:30"));
    expect(w.state.entities.jordan?.fields.place).toBe("office");
    lapse(w, at(w, 0, "13:00"));
    expect(outcomes(w)).toEqual([{ type: "minds.plan", data: { entity: "jordan", plan: "p1", status: "dropped", at: at(w, 0, "11:00"), reason: "routine only" } }]);
  });
});

describe("castlife: occasions", () => {
  test("a birthday or a holiday changes the day's options of the template older chats fold against; a day lays one only from a routine block that's on then", () => {
    const fair = (wd: WorldDoc): void => void wd.calendar.holidays.push({ id: "harvest_fair", label: "Harvest Fair", rule: { type: "fixed", month: 10, day: 19 }, dayOff: true });
    const w = riverton(fair);
    const ids = (day: number): string[] => dayOptions(w.ctx, "rosa", at(w, day, "00:00")).map((o) => o.id);
    expect(ids(1)).not.toContain("birthday");
    w.apply({ type: "set", entity: "rosa", field: "birthday", value: "10-17" });
    expect(ids(1)).toContain("birthday");
    // A day's plan lays neither on its own: nothing in the world or the story grounds a party or an outing.
    expect(dayPlan(w.ctx, "rosa", 1).blocks.some((b) => b.label === "Birthday")).toBe(false);
    // A holiday that's a day off brings its own option and a slow morning; Tuesday is ordinary.
    const monday = dayOptions(w.ctx, "rosa", at(w, 3, "00:00"));
    expect(monday.find((o) => o.id === "holiday:harvest_fair")?.label).toBe("Harvest Fair");
    expect(monday.find((o) => o.id === "breakfast")?.window).toEqual({ from: at(w, 3, "07:00"), to: at(w, 3, "11:00") });
    expect(dayOptions(w.ctx, "rosa", at(w, 4, "00:00")).find((o) => o.id === "breakfast")?.window).toEqual({ from: at(w, 4, "06:00"), to: at(w, 4, "10:00") });
    expect(dayPlan(w.ctx, "rosa", 3).blocks.some((b) => b.label === "Harvest Fair")).toBe(false);
    // Her routine's blocks for her birthday and the fair are laid on exactly those days.
    const grounded = riverton((wd) => {
      fair(wd);
      wd.entities.rosa!.fields.birthday = "10-17";
      wd.routines = {
        rosa_days: {
          id: "rosa_days",
          owner: "rosa",
          blocks: [
            { id: "birthday", label: "Birthday", activity: "socialize", kind: "fixed", at: "18:00", minutes: 150, days: { birthday: "own" } },
            { id: "fair", label: "Harvest Fair", activity: "leisure", kind: "fixed", at: "13:00", minutes: 180, days: { holidays: ["harvest_fair"] } },
          ],
        },
      };
    });
    const laid = (day: number, label: string): boolean => dayPlan(grounded.ctx, "rosa", day).blocks.some((b) => b.label === label);
    expect([laid(1, "Birthday"), laid(2, "Birthday")]).toEqual([true, false]);
    expect([laid(3, "Harvest Fair"), laid(4, "Harvest Fair")]).toEqual([true, false]);
  });

  test("the weekend makes a slow morning and more time out and with friends; an observance brings an evening of its own, but no day off", () => {
    const w = riverton((wd) => {
      wd.calendar.holidays.push({ id: "lantern_night", label: "Lantern Night", rule: { type: "fixed", month: 10, day: 20 }, dayOff: false });
    });
    const option = (day: number, id: string): PlanOption | undefined => dayOptions(w.ctx, "rosa", at(w, day, "00:00")).find((o) => o.id === id);
    const window = (day: number, from: string, to: string): { from: number; to: number } => ({ from: at(w, day, from), to: at(w, day, to) });
    const t = at(w, 0, "10:00");
    const worth = (o: PlanOption | undefined): number => (o === undefined ? Number.NaN : typeof o.utility === "number" ? o.utility : o.utility(t, []));
    // Friday (day 0) is a working day, Saturday (day 1) the weekend.
    expect([option(0, "breakfast")?.window, option(1, "breakfast")?.window]).toEqual([window(0, "06:00", "10:00"), window(1, "07:00", "11:00")]);
    expect([option(0, "leisure")?.window, option(1, "leisure")?.window]).toEqual([window(0, "09:00", "20:00"), window(1, "09:00", "22:00")]);
    expect([option(0, "socialize")?.window, option(1, "socialize")?.window]).toEqual([window(0, "17:00", "22:00"), window(1, "12:00", "23:00")]);
    for (const id of ["leisure", "socialize"]) {
      expect(worth(option(1, id)) - worth(option(0, id))).toBeCloseTo(1, 9);
      expect(option(1, id)?.reasons).toContain("a day off");
    }
    // Tuesday 20 October (day 4) is the observance: its evening, and an ordinary morning.
    expect(option(4, "holiday:lantern_night")).toMatchObject({ label: "Lantern Night", activity: "leisure", window: window(4, "17:00", "22:00") });
    expect(option(4, "breakfast")?.window).toEqual(window(4, "06:00", "10:00"));
    expect(option(3, "holiday:lantern_night")).toBeUndefined();
  });

  test("a close friend's birthday brings an evening at their place, without naming them; a friend who isn't close brings none", () => {
    const birthdays = (warmth: number): unknown[] => {
      const w = riverton((wd) => {
        wd.entities.rosa?.relations.push({ type: "regard", to: "maya", fields: { warmth, trust: warmth, respect: warmth, t: 0 } });
        const maya = wd.entities.maya;
        if (maya) maya.fields.birthday = "10-17";
      });
      return [0, 1, 2].flatMap((day) => dayOptions(w.ctx, "rosa", at(w, day, "00:00")).flatMap((o) => (o.id.startsWith("birthday") ? [[day, o.id, o.label, o.place, o.window]] : [])));
    };
    const w = riverton();
    // Maya's birthday is Saturday 17 October (day 1).
    expect(birthdays(60)).toEqual([[1, "birthday:maya", "A friend's birthday", "maya_flat", { from: at(w, 1, "17:00"), to: at(w, 1, "22:00") }]]);
    expect(birthdays(10)).toEqual([]);
  });

  test("summer draws people out to their time out and winter holds them back, at the same place; bad weather keeps them in", () => {
    const w = riverton();
    const cal = calendarOf(w.world);
    // Wednesdays, none of them a day off: in autumn (21 October), winter (13 January) and summer (14 July).
    const day = (y: number, m: number, d: number): number => clockAt(cal, dayIndexOf(cal, y, m, d), 0);
    const option = (start: number, id: string): PlanOption => {
      const o = dayOptions(w.ctx, "rosa", start).find((x) => x.id === id);
      if (!o) throw new Error(`no ${id}`);
      return o;
    };
    const t = at(w, 0, "10:00");
    const worth = (o: PlanOption): number => (typeof o.utility === "number" ? o.utility : o.utility(t, []));
    const [autumn, winter, summer] = [day(2026, 10, 21), day(2027, 1, 13), day(2027, 7, 14)].map((start) => option(start, "leisure"));
    if (!autumn || !winter || !summer) throw new Error("no leisure");
    expect(worth(summer) - worth(autumn)).toBeCloseTo(0.5, 9);
    expect(worth(winter) - worth(autumn)).toBeCloseTo(-0.5, 9);
    expect([autumn.reasons, winter.reasons, summer.reasons]).toEqual([["unwind"], ["unwind", "winter"], ["unwind", "summer"]]);
    expect([winter.place, summer.place]).toEqual([autumn.place, autumn.place]);
    expect(autumn.place).not.toBe("apartment_hall");
    const social = option(day(2026, 10, 21), "socialize");
    // Rain over Riverton: time out at home, less of it, and fewer friends seen.
    w.apply({ type: "set", entity: "region_riverton", field: "weather", value: "rain" });
    const wet = option(day(2026, 10, 21), "leisure");
    expect([wet.place, wet.reasons]).toEqual(["apartment_hall", ["unwind", "bad weather"]]);
    expect(worth(wet) - worth(autumn)).toBeCloseTo(-1, 9);
    expect(worth(option(day(2026, 10, 21), "socialize")) - worth(social)).toBeCloseTo(-0.5, 9);
  });

  test("a 29 February birthday falls on the 28th in a common year, and lint flags one that isn't a date of the world's calendar", () => {
    const world = modernUsWorld("w", "R");
    const cal = calendarOf(world);
    expect(birthdayOn(cal, "02-29", dateAt(cal, clockAt(cal, dayIndexOf(cal, 2027, 2, 28), 0)))).toBe(true);
    expect(birthdayOn(cal, "02-29", dateAt(cal, clockAt(cal, dayIndexOf(cal, 2028, 2, 28), 0)))).toBe(false);
    const flagged = (birthday: string): boolean => {
      const w = modernUsWorld("w", "R");
      if (w.entities.rosa) w.entities.rosa.fields.birthday = birthday;
      return reg.lints.flatMap((rule) => rule.check(w)).some((i) => i.code === "castlife.birthday" && i.path === "entities.rosa.fields.birthday");
    };
    const values = ["02-29", "1996-02-29", "10-17", "1990-11-30", "31/12", "Feb 3", "1994-02-29", "1993-02-29", "02-30", "04-31", "1990-11-31", "13-05", "99-01"];
    expect(values.filter(flagged)).toEqual(["31/12", "Feb 3", "1994-02-29", "1993-02-29", "02-30", "04-31", "1990-11-31", "13-05", "99-01"]);
    // A birthday that isn't a date is no occasion: "02-30" doesn't fall on the last of February.
    expect(birthdayOn(cal, "02-30", dateAt(cal, clockAt(cal, dayIndexOf(cal, 2028, 2, 29), 0)))).toBe(false);
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
