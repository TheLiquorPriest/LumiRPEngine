// DESIGN §13 lint coverage in the engine and packs: refs, types, cycles, unreachable stages,
// expressions, unbalanced postings, frozen predicates and double-booked commitments.
import { describe, expect, test } from "bun:test";
import { calendarOf, clockOfLocal } from "../../src/engine/calendar";
import { createRegistry } from "../../src/engine/registry-impl";
import { lintStructure } from "../../src/engine/world-lint";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "./riverton";

const reg = createRegistry(ALL_PACKS);

describe("§13 lint", () => {
  test("the Riverton fixture has no structural errors", () => {
    expect(lintStructure(modernUsWorld("w", "R"), reg).filter((i) => i.severity === "error")).toEqual([]);
  });

  test("each structural problem is reported in plain language at its path", () => {
    const w = modernUsWorld("w", "R");
    w.entities.you!.fields.employer = "nowhere";
    w.entities.you!.fields.wealth = 7;
    w.entities.maya!.relations.push({ type: "knows", to: "ghost" });
    w.entities.phone!.relations = [{ type: "in", to: "wallet" }];
    w.entities.wallet!.relations = [{ type: "in", to: "phone" }];
    w.schedules.maya_place!.slots[0]!.value = "moon";
    w.kinds.loop_a = { id: "loop_a", label: "A", extends: "loop_b", fields: {} };
    w.kinds.loop_b = { id: "loop_b", label: "B", extends: "loop_a", fields: {} };
    w.tracks.first_week!.stages.orphan = { label: "Never reached", next: [] };
    w.tracks.first_week!.stages.settled!.next = [{ to: "nowhere", when: "at(pov, " }];
    w.actions.persuade!.outcomes.agree!.push({ type: "post", args: { lines: [{ account: "checking", amount: -500 }, { account: "cash", amount: 400 }] } });
    w.realism.levels.vehicles = 1;
    w.rules.low_fuel = { id: "low_fuel", on: { tick: "turn" }, when: "truck.fuel_pct < 10", do: [] };
    const issues = lintStructure(w, reg);
    const at = (code: string): string[] => issues.filter((i) => i.code === code).map((i) => i.path).sort();
    expect(at("refs")).toEqual(["entities.maya.relations", "entities.you.fields.employer", "schedules.maya_place.slots", "tracks.first_week.stages.settled.next"]);
    expect(at("types")).toEqual(expect.arrayContaining(["entities.you.fields.wealth", "tracks.first_week.stages.settled"]));
    expect(at("cycles")).toEqual(["entities.phone.relations", "entities.wallet.relations", "kinds.loop_a.extends", "kinds.loop_b.extends"]);
    expect(at("unreachable_stage")).toEqual(["tracks.first_week.stages.orphan"]);
    expect(at("unbalanced_posting")).toEqual(["actions.persuade.outcomes.agree.1"]);
    expect(issues.find((i) => i.code === "frozen_predicate" && i.path === "rules.low_fuel")?.message).toContain("fuel_pct");
    expect(issues.every((i) => i.message.length > 10 && !i.message.includes("undefined"))).toBe(true);
  });

  test("double-booked commitments: an appointment inside a shift, and two appointments that overlap", () => {
    const w = modernUsWorld("w", "R");
    const cal = calendarOf(w);
    w.entities.maya!.fields.appointments = [
      { at: clockOfLocal(cal, "2026-10-21T10:00"), minutes: 60, label: "Dentist" },
      { at: clockOfLocal(cal, "2026-10-21T10:30"), minutes: 30, label: "Bank" },
    ];
    const messages = reg.lints.filter((l) => l.code === "castlife.double_booking").flatMap((l) => l.check(w)).map((i) => i.message);
    expect(messages).toEqual(expect.arrayContaining(["Maya Chen is double-booked: Dentist and Bank overlap.", "Maya Chen is double-booked: Dentist falls in maya_shift.", "Maya Chen is double-booked: Bank falls in maya_shift."]));
  });
});
