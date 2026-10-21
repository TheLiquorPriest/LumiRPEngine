// A routine's blocks as days are laid and lived (DESIGN §8, §24.8): a fixed block at its time, a
// flexible one where its window has room, a floating one on that many days a week, an optional one on
// some days by the world's seed, and someone with no routine planning only from the story, their
// commitments and their basic needs. In play every block of an agent's day is lived at its own start;
// in a Timelapse a Background character off screen lives the day at slot steps, as net state, and at
// its minute only where the POV could meet them (observable fidelity). However a run's time is cut,
// it lands the same, and the folds replay what it recorded.

import { describe, expect, test } from "bun:test";
import type { RoutineBlock } from "../../../src/shared/routines";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockAt, parseHHMM } from "../../../src/engine/calendar";
import { advance, catchUp } from "../../../src/engine/simulate";
import type { Working } from "../../../src/engine/working";
import { dayPlan } from "../../../src/packs/castlife/core/index";
import { routineGmView } from "../../../src/packs/castlife/core/view";
import { at, fixed, foldBoth, gmEdit, gmPlan, held, lapse, pin, record, reg, routine, town, whereabouts, withRoutines, YOU } from "./town";

/** Rosa (Cast life 3, a Background character) with `blocks` as her own routine, and none of Riverton's place schedule. */
function rosa(blocks: RoutineBlock[], patch: (w: WorldDoc) => void = () => undefined): Working {
  return town((wd) => {
    delete wd.schedules.rosa_routine;
    withRoutines(wd, [routine("r_rosa", "rosa", blocks)]);
    patch(wd);
  });
}

const GARAGE = fixed("garage", "09:00", 480, { place: "garage" }, { label: "Opens the garage", activity: "work", days: { weekdays: [1, 2, 3, 4, 5] } });
const PUB = fixed("pub", "19:00", 120, { place: "pub" }, { label: "Friday at the Anchor", activity: "drinks", days: { weekdays: [5] } });

/** The days among `days` whose plan lays the block. */
function daysWith(w: Working, who: string, block: string, days: readonly number[]): number[] {
  return days.filter((d) => dayPlan(w.ctx, who, d).blocks.some((b) => b.option === `routine:${block}`));
}

describe("a routine's blocks", () => {
  test("a fixed block is lived at its time on the days it's on, and its end hands them back", () => {
    const w = rosa([GARAGE, PUB]);
    // Off screen in a Timelapse she's where her routine has her at each slot step (observable
    // fidelity, DESIGN §8): the garage at noon, home at six; Friday's Anchor, from seven to nine,
    // starts and ends inside the evening slot and leaves no trace.
    const friday: string[] = [];
    for (const t of ["12:00", "18:00", "21:15"]) {
      lapse(w, at(w, 0, t));
      friday.push(`${t} ${String(whereabouts(w, "rosa")[0])}`);
    }
    expect(friday).toEqual(["12:00 garage", "18:00 apartment_hall", "21:15 apartment_hall"]);
    // Where the POV could meet her, the Anchor is lived at seven.
    const met = rosa([GARAGE, PUB]);
    lapse(met, at(met, 0, "18:00"));
    record(met, [{ type: "set", entity: YOU, field: "place", value: "pub" }]);
    held(met, at(met, 0, "19:30"));
    expect(whereabouts(met, "rosa")).toEqual(["pub", "drinks"]);
    // The GM sees it laid at its time, from her routine.
    const laid = routineGmView(w.ctx, "rosa", 0).day.blocks.find((b) => b.origin.type === "routine" && b.origin.block === "pub");
    expect(laid).toMatchObject({ from: "19:00", to: "21:00", place: "pub" });
    // Saturday (day 1) is none of their days.
    const saturday: string[] = [];
    for (const t of ["09:30", "19:30"]) {
      lapse(w, at(w, 1, t));
      saturday.push(`${t} ${String(whereabouts(w, "rosa")[0])}`);
    }
    expect(saturday).toEqual(["09:30 apartment_hall", "19:30 apartment_hall"]);
  });

  test("a flexible block goes where its window has room: after a meeting that takes its start", () => {
    const walk: RoutineBlock = { id: "walk", label: "A walk by the river", activity: "leisure", kind: "flexible", window: { from: "14:00", to: "18:00" }, minutes: 60, place: { place: "park" } };
    // Where the POV could meet her, at the river (observable fidelity, DESIGN §8: off screen in a
    // Timelapse a Background character lives the day at slot steps), she comes at the walk's start:
    // at two, or after a meeting that takes it, at half past three. The scene then keeps her there.
    const run = (meeting: boolean): string[] => {
      const w = rosa([walk], (wd) => {
        const r = wd.entities.rosa;
        if (r && meeting) r.fields.appointments = [{ at: clockAt(calendarOf(wd), 0, parseHHMM("14:00")), minutes: 90, place: "bank", label: "Loan meeting" }];
      });
      lapse(w, at(w, 0, "12:00"));
      record(w, [{ type: "set", entity: YOU, field: "place", value: "park" }]);
      const seen: string[] = [];
      for (const t of ["14:30", "15:45"]) {
        held(w, at(w, 0, t));
        seen.push(`${t} ${String(whereabouts(w, "rosa")[0])}`);
      }
      return seen;
    };
    expect(run(false)).toEqual(["14:30 park", "15:45 park"]);
    expect(run(true)).toEqual(["14:30 apartment_hall", "15:45 park"]);
  });

  test("a floating block falls on that many days of each week, the same days however often the week is planned", () => {
    const gym: RoutineBlock = { id: "gym", label: "The gym", activity: "exercise", kind: "flexible", window: { from: "06:30", to: "08:00" }, minutes: 45, place: { place: "gym" }, perWeek: 3 };
    // Weeks run Sunday to Saturday: day 2 is Sunday 18 October.
    const weeks = [2, 9, 16].map((sunday) => Array.from({ length: 7 }, (_, i) => sunday + i));
    const picked = weeks.map((week) => daysWith(rosa([gym]), "rosa", "gym", week));
    expect(picked.map((days) => days.length)).toEqual([3, 3, 3]);
    expect(weeks.map((week) => daysWith(rosa([gym]), "rosa", "gym", week))).toEqual(picked);
    // A floating block floats: the weeks don't all pick the same weekdays.
    expect(new Set(picked.map((days) => days.map((d) => (d - 2) % 7).join(","))).size).toBeGreaterThan(1);
    // On a day it falls on she is at the gym while it's laid, in its window; on another, at home
    // then. The POV waits at the gym, so she's lived there at her minute (observable fidelity).
    const on = picked[0]?.[0] ?? 0;
    const off = weeks[0]?.find((d) => !picked[0]?.includes(d)) ?? 0;
    const laid = dayPlan(rosa([gym]).ctx, "rosa", on).blocks.find((b) => b.option === "routine:gym");
    const minute = (laid?.start ?? 0) - at(rosa([gym]), on, "00:00") + 10;
    expect(minute >= parseHHMM("06:30") && minute - 10 <= parseHHMM("08:00")).toBe(true);
    const seen = [on, off].map((day) => {
      const w = rosa([gym]);
      lapse(w, at(w, day, "00:00"));
      record(w, [{ type: "set", entity: YOU, field: "place", value: "gym" }]);
      held(w, at(w, day, "00:00") + minute);
      return whereabouts(w, "rosa")[0];
    });
    expect(seen).toEqual(["gym", "apartment_hall"]);
  });

  test("an optional block happens on some of its days and not others, by the world's seed, the same every time", () => {
    const swim = (chance: number): RoutineBlock => ({ id: "swim", label: "A swim", activity: "exercise", kind: "optional", window: { from: "18:00", to: "20:00" }, minutes: 60, place: { place: "lake" }, chance });
    const month = Array.from({ length: 28 }, (_, d) => d);
    const some = daysWith(rosa([swim(0.5)]), "rosa", "swim", month);
    expect(some.length).toBeGreaterThan(0);
    expect(some.length).toBeLessThan(month.length);
    expect(daysWith(rosa([swim(0.5)]), "rosa", "swim", month)).toEqual(some);
    // A sure block is on every day; a likelier one on at least as many.
    expect(daysWith(rosa([swim(1)]), "rosa", "swim", month)).toEqual(month);
    expect(daysWith(rosa([swim(0.9)]), "rosa", "swim", month).length).toBeGreaterThanOrEqual(some.length);
  });

  test("someone with no routine plans only from the story, their commitments and their basic needs", () => {
    const grounded = /^(routine:(sleep|sleep:carried|breakfast|lunch|dinner)|idle|schedule:.*|plan:.*|fixed:.*)$/;
    // No routine data at all: everyone's days are their schedules and basic needs, never an outing.
    const plain = town();
    const options = ["maya", "jordan", "rosa"].flatMap((who) => [0, 1, 2, 3].flatMap((d) => dayPlan(plain.ctx, who, d).blocks.map((b) => b.option)));
    expect(options.filter((o) => !grounded.test(o))).toEqual([]);
    // Rosa follows no routine in this chat: her garage and her walk are gone, her meeting and the
    // story's plan for her stay.
    const w = rosa([GARAGE, PUB, { id: "walk", label: "A walk", activity: "leisure", kind: "flexible", window: { from: "14:00", to: "18:00" }, minutes: 60, place: { place: "park" } }], (wd) => {
      const r = wd.entities.rosa;
      if (r) r.fields.appointments = [{ at: clockAt(calendarOf(wd), 0, parseHHMM("14:00")), minutes: 90, place: "bank", label: "Loan meeting" }];
    });
    record(w, [pin("rosa", "far"), gmPlan(w, "rosa", { id: "tyres", kind: "errand", where: "market", priority: 4, when: { from: at(w, 0, "16:00"), to: at(w, 0, "16:45") } })]);
    const before = dayPlan(w.ctx, "rosa", 0).blocks.map((b) => b.option);
    expect(before).toEqual(expect.arrayContaining(["routine:garage", "routine:pub", "plan:tyres", "fixed:Loan meeting"]));
    gmEdit(w, [{ op: "routine_follow", entity: "rosa", mode: "off" }]);
    const after = dayPlan(w.ctx, "rosa", 0).blocks.map((b) => b.option);
    expect(after.filter((o) => !grounded.test(o))).toEqual([]);
    expect(after).toEqual(expect.arrayContaining(["routine:breakfast", "routine:dinner", "plan:tyres", "fixed:Loan meeting"]));
    lapse(w, at(w, 0, "16:30"));
    expect(whereabouts(w, "rosa")).toEqual(["market", "errand"]);
  });
});

describe("living a day", () => {
  test("a day's moves don't depend on how its time is cut, and both folds replay them", () => {
    const day = (): Working => rosa([GARAGE, PUB, fixed("call", "13:20", 25, { place: "cafe" }, { label: "Coffee with a supplier", activity: "work" })]);
    const whole = day();
    lapse(whole, at(whole, 1, "02:00"));
    const cut = day();
    for (const t of ["09:10", "13:27", "13:50", "19:05", "21:20"]) lapse(cut, at(cut, 0, t));
    lapse(cut, at(cut, 1, "02:00"));
    expect(cut.state.entities).toEqual(whole.state.entities);
    expect(cut.state.packs.castlife).toEqual(whole.state.packs.castlife);
    // The run's events, as its turn records them, fold to where it ended in both folds.
    const folded = foldBoth(whole.world, whole.events);
    expect(folded.state.entities).toEqual(whole.state.entities);
    expect(folded.state.packs).toEqual(whole.state.packs);
  });

  test("a catch-up lives a Background character's routine too: blocks it passed over aren't taken for the story", () => {
    const w = rosa([GARAGE, fixed("evening", "18:00", 180, { place: "pub" }, { label: "Evening at the Anchor", activity: "drinks" })]);
    // A turn takes the clock past six while Rosa falls behind (dinner at five isn't lived); the
    // catch-up then steps her slot by slot, and her evening still starts at the Anchor.
    advance(reg, w, at(w, 0, "18:30"), { runSeed: "seed", mode: "turn" });
    catchUp(reg, w, { runSeed: "seed", agents: 8 });
    expect(whereabouts(w, "rosa")).toEqual(["pub", "drinks"]);
  });
});
