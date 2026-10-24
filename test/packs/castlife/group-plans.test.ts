// Group plans (DESIGN §24.8): a plan with others in it is one plan everyone in it holds, under one id,
// each living it as the planner does for them; accepting an invitation books it in the player
// character's day; and a mind reads its own plans by default, within their own limit.

import { describe, expect, test } from "bun:test";
import { plansFrom } from "../../../src/backend/minds";
import { sectionTokens } from "../../../src/backend/book";
import { mindContext, type MindContextReport } from "../../../src/backend/minds-context";
import type { JsonObject } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import { DEFAULT_MIND_READS, DEFAULT_MINDS_MEMORY, MINDS_EVENTS, type MindPlan, type MindsReads } from "../../../src/shared/minds";
import { calendarOf, formatStamp } from "../../../src/engine/calendar";
import { resolveEdit } from "../../../src/engine/edits";
import { resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import type { Working } from "../../../src/engine/working";
import { dayPlan } from "../../../src/packs/castlife/core/index";
import { readCharacter } from "../../../src/packs/minds/core/state";
import { fold, startState } from "../support";
import { at, gmPlan, lapse, pin, record, reg, town, whereabouts, YOU } from "./town";

/** Riverton with Rosa no agent: she has a mind's plans but lives no day of her own. Maya and Jordan are Far. */
function riverton(): Working {
  const w = town((wd) => {
    const rosa = wd.entities.rosa;
    if (rosa) rosa.agent = false;
  });
  record(w, [pin("maya", "far"), pin("jordan", "far")]);
  return w;
}

/** What Maya's memory of the turn takes from it: drinks at the Anchor tonight, 19:00 to 21:00, with `others` (names, as the model writes them). */
function drinks(w: Working, others: string[]): MindPlan[] {
  const cal = calendarOf(w.world);
  return plansFrom(reg, w.world, w.state, "maya", [{ what: "Drinks at the Anchor after work", kind: "meet", when: { from: formatStamp(cal, at(w, 0, "19:00")), to: formatStamp(cal, at(w, 0, "21:00")) }, where: "The Anchor", with: others }]);
}

/** The `minds.memory` event a memory of the turn records for `who`, with `plans`. */
function memory(w: Working, who: string, plans: MindPlan[]): LedgerEvent {
  return { type: MINDS_EVENTS.memory, data: { entity: who, at: w.state.clock, notes: [], commitments: [], resolved: [], plans: JSON.parse(JSON.stringify(plans)), told: [], summary: null } };
}

/** Each person's copy of plan `id`, as `[status, with]`, or null when they don't hold it. */
function held(w: Working, people: string[], id: string): ([string, string[]] | null)[] {
  return people.map((who) => {
    const p = readCharacter(w.state, who).plans.find((x) => x.id === id);
    return p ? [p.status, [...p.with].sort()] : null;
  });
}

function gm(w: Working, ops: JsonObject[]): void {
  const out = resolveEdit(reg, w.world, w.state, ops as never, { gm: true, runSeed: "seed" });
  if ("rejection" in out) throw new Error(out.rejection.reason);
  record(w, out.events);
}

describe("one plan shared by everyone in it", () => {
  test("a plan with two companions is in all three people's plans under one id, and lived by the agents among them", () => {
    const w = riverton();
    const [plan] = drinks(w, ["Jordan Price", "Rosa Delgado"]);
    if (!plan) throw new Error("no plan");
    record(w, [memory(w, "maya", [plan])]);
    expect(held(w, ["maya", "jordan", "rosa"], plan.id)).toEqual([
      ["open", ["jordan", "rosa"]],
      ["open", ["maya", "rosa"]],
      ["open", ["jordan", "maya"]],
    ]);
    lapse(w, at(w, 0, "20:00"));
    // Maya and Jordan, agents, are there; Rosa, who lives no day of her own, isn't moved by it.
    expect([whereabouts(w, "maya")[0], whereabouts(w, "jordan")[0], whereabouts(w, "rosa")[0]]).toEqual(["pub", "pub", "apartment_hall"]);
    lapse(w, at(w, 1, "00:30"));
    const settled = ["maya", "jordan", "rosa"].map((who) => readCharacter(w.state, who).plans.find((p) => p.id === plan.id));
    expect(settled.map((p) => [p?.status, p?.reason])).toEqual([
      ["done", null],
      ["done", null],
      ["dropped", "routine only"],
    ]);
  });

  test("a replay folds the shared plan and its living exactly as played", () => {
    const w = riverton();
    const [plan] = drinks(w, ["Jordan Price", "Rosa Delgado"]);
    if (!plan) throw new Error("no plan");
    record(w, [memory(w, "maya", [plan])]);
    lapse(w, at(w, 1, "00:30"));
    // From the one recorded memory, the fold gives each of the three their copy, settled as they lived it.
    const replayed = fold(reg, w.world, startState(w.world), w.events);
    expect(replayed).toEqual(w.state);
    expect(["maya", "jordan", "rosa"].map((who) => readCharacter(replayed, who).plans.find((p) => p.id === plan.id)?.status)).toEqual(["done", "done", "dropped"]);
  });

  test("a GM edit of a shared plan reaches everyone in it, each keeping how they settled it, and a delete takes it from them all", () => {
    const w = riverton();
    const [plan] = drinks(w, ["Jordan Price", "Rosa Delgado"]);
    if (!plan) throw new Error("no plan");
    record(w, [memory(w, "maya", [plan])]);
    // From Jordan's page: an hour later, and Rosa out of it.
    gm(w, [{ op: "mind_memory", entity: "jordan", part: "plan", id: plan.id, value: { when: { from: at(w, 0, "20:00"), to: at(w, 0, "22:00") }, with: ["maya"] } }]);
    expect(held(w, ["maya", "jordan", "rosa"], plan.id)).toEqual([["open", ["jordan"]], ["open", ["maya"]], null]);
    expect(readCharacter(w.state, "maya").plans.find((p) => p.id === plan.id)?.when.from).toBe(at(w, 0, "20:00"));
    gm(w, [{ op: "mind_memory", entity: "maya", part: "plan", id: plan.id, value: null }]);
    expect(held(w, ["maya", "jordan"], plan.id)).toEqual([null, null]);
  });

  test("a plan shared with someone at the cap of open plans keeps their list within it", () => {
    const w = riverton();
    const many = Array.from({ length: 24 }, (_, i) => gmPlan(w, "jordan", { id: `own${i}`, what: `Errand ${i}`, when: { from: at(w, 1, "09:00") + i * 60, to: at(w, 1, "09:30") + i * 60 } }));
    record(w, many);
    const [plan] = drinks(w, ["Jordan Price"]);
    if (!plan) throw new Error("no plan");
    record(w, [memory(w, "maya", [plan])]);
    const open = readCharacter(w.state, "jordan").plans.filter((p) => p.status === "open");
    expect([open.length, open.some((p) => p.id === plan.id)]).toEqual([24, true]);
  });
});

describe("accepting an invitation", () => {
  test("books it in the player character's day, with the people in its plan, and accepting again books nothing more", () => {
    const w = riverton();
    const [plan] = drinks(w, ["Alex Rivera", "Jordan Price"]);
    if (!plan) throw new Error("no plan");
    record(w, [memory(w, "maya", [plan])]);
    // Maya's plan asks the player character along, as its ask records it.
    const meet = at(w, 0, "19:00");
    record(w, [{ type: "castlife.invitation", data: { agent: "maya", place: "pub", at: meet, text: "Maya Chen invites you to The Anchor at 19:00.", key: `plan:${plan.id}`, origin: `plan:${plan.id}` } }]);
    const accept = () => resolveAction(reg, w, { action: "accept_invitation", params: { host: "maya" } }, createRng("accept"));
    accept();
    const booked = (w.state.entities[YOU]?.fields.appointments ?? []) as JsonObject[];
    expect(booked).toEqual([expect.objectContaining({ at: meet, minutes: 120, place: "pub", with: ["maya", "jordan"] })]);
    expect(dayPlan(w.ctx, YOU, 0).blocks.some((b) => b.start === meet && b.end === meet + 120 && b.place === "pub")).toBe(true);
    accept();
    expect((w.state.entities[YOU]?.fields.appointments as JsonObject[]).length).toBe(1);
  });
});

describe("a mind reads its own plans", () => {
  const context = (w: Working, reads: MindsReads = DEFAULT_MIND_READS, report?: MindContextReport, who = "maya"): string =>
    mindContext({ reg, world: w.world, state: w.state, who, memory: DEFAULT_MINDS_MEMORY, messages: [], hideJson: true, reads, moment: { kind: "turn", at: w.state.clock, reason: "", user: "", reply: "" } }, report);
  const plansOf = (text: string): string[] => (/## Your plans\n((?:- .*\n?)*)/.exec(text)?.[1] ?? "").trim().split("\n").filter((l) => l !== "");

  test("by default, soonest first, within their own limit, and none while it's off", () => {
    const w = riverton();
    record(w, [
      gmPlan(w, "maya", { id: "late", what: "Return Jordan's ladder", kind: "errand", where: "bank", when: { from: at(w, 0, "16:00"), to: at(w, 0, "17:00") } }),
      gmPlan(w, "maya", { id: "soon", what: "Lunch with Rosa", kind: "meet", where: "pub", with: ["rosa"], when: { from: at(w, 0, "12:00"), to: at(w, 0, "13:00") } }),
    ]);
    const all = plansOf(context(w));
    expect([all.length, all[0]?.includes("Lunch with Rosa"), all[1]?.includes("Return Jordan's ladder")]).toEqual([2, true, true]);
    const report: MindContextReport = { pinned: [], activated: [] };
    // Room for the soonest line alone: lines are kept whole, one that doesn't fit left out.
    const cut = plansOf(context(w, { ...DEFAULT_MIND_READS, plans: { on: true, tokens: sectionTokens(all[0] ?? "") } }, report));
    expect([cut, report.plans]).toEqual([[all[0]], { given: 1, left: 1 }]);
    expect(plansOf(context(w, { ...DEFAULT_MIND_READS, plans: { on: false, tokens: 400 } }))).toEqual([]);
  });

  test("a shared plan another's memory recorded reaches their mind by its kind, time, place and people, never that memory's words", () => {
    const w = riverton();
    record(w, [memory(w, "maya", drinks(w, ["Jordan Price"]))]);
    const [maya, jordan] = [plansOf(context(w)), plansOf(context(w, DEFAULT_MIND_READS, undefined, "jordan"))];
    expect([maya[0]?.includes("Drinks at the Anchor after work"), jordan.length, jordan[0]?.includes("Drinks at the Anchor"), jordan[0]?.includes("The Anchor"), jordan[0]?.includes("Maya Chen")]).toEqual([true, 1, false, true, true]);
  });
});
