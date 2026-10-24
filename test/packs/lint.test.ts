// DESIGN §13 lint coverage in the engine and packs: refs, types, cycles, unreachable stages,
// expressions, unbalanced postings, frozen predicates, double-booked commitments and player claims.
import { describe, expect, test } from "bun:test";
import { calendarOf, clockOfLocal } from "../../src/engine/calendar";
import { createRegistry } from "../../src/engine/registry-impl";
import { lintStructure } from "../../src/engine/world-lint";
import { ALL_PACKS } from "../../src/packs/index";
import { derivedClaimCap } from "../../src/packs/economy/core/model";
import { formatMoney } from "../../src/shared/world";
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

  test("a quest condition naming an id the world doesn't have is warned at its stage", () => {
    const w = modernUsWorld("w", "R");
    const at = (): string[] => lintStructure(w, reg).filter((i) => i.code === "unknown_condition_ref").map((i) => i.path);
    expect(at()).toEqual([]);
    w.tracks.first_week!.stages.coffee!.objectives = ["carries(pov, 'phnoe') and at('maya', 'cafe') and knows(pov, 'maya')"];
    expect(at()).toEqual(["tracks.first_week.stages.coffee"]);
    w.tracks.first_week!.stages.coffee!.objectives = ["carries(pov, 'phone') and at('maya', 'cafee') or knows(pov, 'jordann')"];
    expect(at()).toEqual(["tracks.first_week.stages.coffee", "tracks.first_week.stages.coffee"]);
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

  test("player claims: a claim param's place, the world's default policy and the claim cap are checked where they sit", () => {
    const w = modernUsWorld("w", "R");
    const at = (code: string): string[] => lintStructure(w, reg).filter((i) => i.code === code).map((i) => `${i.severity} ${i.path}`).sort();
    const capLint = (): string[] => reg.lints.filter((l) => l.code === "economy.claim_cap").flatMap((l) => l.check(w)).map((i) => `${i.severity} ${i.path}: ${i.message}`);
    w.actions.light = { id: "light", label: "Light up", params: { lighter: { type: "ref", ref: "item", claim: "held" }, smoke: { type: "ref", ref: "item", claim: "here" } }, requires: [], outcomes: { default: [] }, duration: "1" };
    w.realism.claims = { mode: "ask", capped: true };
    w.packs.economy = { ...w.packs.economy, config: { ...(w.packs.economy?.config ?? {}), claimCap: 2500 } };
    expect([at("claims"), capLint()]).toEqual([[], []]);
    // Read from outside data, a document can say anything; lint names each wrong value.
    const light = w.actions.light;
    Object.assign(light.params.lighter ?? {}, { claim: "pocket" });
    light.params.note = { type: "text", claim: "held" };
    Object.assign(w.realism, { claims: { mode: "maybe", capped: true } });
    expect(at("claims")).toEqual(["error actions.light.params.lighter.claim", "error realism.claims", "warning actions.light.params.note.claim"]);
    Object.assign(w.realism, { claims: { mode: "real", capped: "yes" } });
    expect(at("claims")).toEqual(["error actions.light.params.lighter.claim", "warning actions.light.params.note.claim", "warning realism.claims.capped"]);
    const fallback = formatMoney(derivedClaimCap(w), w.currency);
    for (const bad of [0, -100, "25"]) {
      w.packs.economy!.config.claimCap = bad;
      expect(capLint()).toEqual([`warning packs.economy.config.claimCap: The claim cap should be a whole number of cents above zero; a capped Make it real asks first above the default, ${fallback}.`]);
    }
    w.packs.economy!.config.claimCap = 2499.6;
    expect(capLint()[0]).toEndWith(`asks first above ${formatMoney(2500, w.currency)}, rounded.`);
  });
});
