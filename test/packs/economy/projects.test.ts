// Production projects (DESIGN §26.5), folded through the work module's test world: steps in their
// dependencies' order at exact instants, business days, each cost posted once, a shortfall that
// waits and then goes on, a pause, 90 days at once against 90 days one by one, the unlock that makes
// a well and starts its royalty on the completion day, each unlock its own unit, what nothing made
// took written off as a project ends, two things one step makes sharing its cost, the story's note
// within its bounds, Undo, and a reader's Projects naming no one they can't see.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import type { LedgerEvent, PackEvent } from "../../../src/shared/ledger";
import { PROJECT_EVENTS, PROJECT_NOTE, type ProjectsView } from "../../../src/shared/projects";
import { revenueOf, royaltyMonth, type RevenueModel } from "../../../src/shared/revenue";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import { eventUnits, tiesOf } from "../../../src/engine/events";
import { objOf } from "../../../src/engine/pack-kit";
import { Working } from "../../../src/engine/working";
import { depreciationIn } from "../../../src/packs/economy/core/books";
import { projectOf, projectRunOf } from "../../../src/packs/economy/core/projects";
import { startState } from "../support";
import { act, entity, ext, lapse, line, packEvents, posts, reg, setup } from "./work-world";

const DAY = 1440;

/** A depot: a survey, then foundations (two business days, paid at the end) beside a delivery (paid half and half), then the handover once both are done. */
const DEPOT: JsonObject[] = [
  { id: "survey", name: "Survey", days: 3, cost: 100_000 },
  { id: "foundations", name: "Foundations", business_days: 2, cost: 50_000, paid: "end", after: ["survey"] },
  { id: "delivery", name: "Delivery", days: 1, cost: 20_000, paid: "split", after: ["survey"] },
  { id: "handover", name: "Handover", days: 0, after: ["foundations", "delivery"] },
];

const ROYALTY: JsonObject = { type: "royalty", unit: "bbl", production: { qi: 1000, di_pct: 24, b: 0 }, price: 7000, share_pct: 12.5, deductions_pct: 2, severance_pct: 4.6, lag_months: 0 };

/** One step drilling a well for five days, which makes it and starts its royalty. */
const WELL: JsonObject[] = [
  {
    id: "drill",
    name: "Drilling",
    days: 5,
    cost: 1_000_000,
    capitalize: true,
    unlocks: [{ make: { name: "Oil well", life_months: 120, value: "cost", fields: { property_type: "mineral", reserves: 50_000 } } }, { name: "Oil sales", stream: { from: "Purchaser", every: "month", days: [25], revenue: [ROYALTY] } }],
  },
];

const steps = (w: Working, phase?: string): PackEvent[] => packEvents(w, PROJECT_EVENTS.step).filter((e) => phase === undefined || e.data.phase === phase);
const doneAt = (w: Working): Record<string, number> => Object.fromEntries(steps(w, "done").map((e) => [String(e.data.step), Number(e.data.at)]));
const start = (w: Working, args: JsonObject) => act(w, "economy.project_start", args);
/** The project a start made: the one project entity in the state. */
const madeProject = (w: Working): string => Object.keys(w.state.entities).find((id) => w.state.entities[id]?.kind === "project") ?? "";
const at = (w: Working, local: string): number => clockOfLocal(calendarOf(w.world), local);
/** Time run on to a local instant, where a start then lands: the world's accounts are open by then (its first slot opens them). */
function goTo(w: Working, local: string): number {
  lapse(w, at(w, local) - w.state.clock);
  return w.state.clock;
}

/** A record folded again unit by unit, as a rebased view folds it: a unit any member of which fails drops whole, and so does every unit tied to one dropped. */
function foldUnits(w: Working, events: readonly LedgerEvent[]): void {
  const dropped = new Set<string>();
  for (const [from, to] of eventUnits(events)) {
    const unit = events.slice(from, to);
    const group = unit[0]?.group;
    const mark = w.mark();
    if (tiesOf(unit).some((g) => dropped.has(g)) || unit.some((e) => w.apply(e) !== null)) {
      w.restore(mark);
      if (group !== undefined) dropped.add(group);
    }
  }
}

describe("projects: steps and their instants", () => {
  test("steps start as the steps they come after are done, and end their days of work later; business days skip the weekend", () => {
    const { w } = setup();
    const t0 = goTo(w, "2026-10-19T08:00");
    expect(start(w, { org: "brightline", name: "Depot", steps: DEPOT }).rejected).toEqual([]);
    lapse(w, 9 * DAY);
    // Monday 08:00: the survey ends Thursday 08:00 and the delivery Friday's; the foundations' two business days run Thursday 08:00 to Monday 08:00 over the weekend; the handover then.
    expect(doneAt(w)).toEqual({ survey: t0 + 3 * DAY, delivery: t0 + 4 * DAY, foundations: t0 + 7 * DAY, handover: t0 + 7 * DAY });
    expect(at(w, "2026-10-26T08:00")).toBe(t0 + 7 * DAY);
    const p = projectOf(w.ctx, madeProject(w));
    expect(p?.status).toBe("done");
    expect(p?.run.ended).toBe(t0 + 7 * DAY);
  });

  test("a business-day step started on a Friday morning counts the rest of Friday, then Monday", () => {
    const { w } = setup();
    goTo(w, "2026-10-23T08:00");
    expect(start(w, { org: "brightline", name: "Shed", steps: [{ id: "frame", name: "Frame", days: 0 }, { id: "roof", name: "Roof", business_days: 1, after: ["frame"] }] }).rejected).toEqual([]);
    lapse(w, 5 * DAY);
    expect(doneAt(w)).toEqual({ frame: at(w, "2026-10-23T08:00"), roof: at(w, "2026-10-26T08:00") });
  });

  test("each cost posts once, at its own end of its step, to the contractors", () => {
    const { w } = setup();
    goTo(w, "2026-10-19T08:00");
    start(w, { org: "brightline", name: "Depot", steps: DEPOT });
    lapse(w, 20 * DAY);
    const paid = posts(w, /^Depot: /);
    expect(paid.map((p) => [p.memo, line(p, "bl_operating"), line(p, ext("contractors"))])).toEqual([
      ["Depot: Survey", -100_000, 100_000],
      ["Depot: Delivery (first half)", -10_000, 10_000],
      ["Depot: Delivery (the rest)", -10_000, 10_000],
      ["Depot: Foundations", -50_000, 50_000],
    ]);
    // Nothing more after it is done.
    lapse(w, 20 * DAY);
    expect(posts(w, /^Depot: /).length).toBe(4);
    // Its costs are expensed: nothing here depreciates.
    const cats = packEvents(w, "economy.txn").filter((e) => String(e.data.memo).startsWith("Depot: ")).map((e) => e.data.category);
    expect(new Set(cats)).toEqual(new Set(["project"]));
  });

  test("a step the account can't pay waits, with an alert, and starts once the money is there", () => {
    const { w } = setup();
    goTo(w, "2026-10-19T08:00");
    // The café's operating account holds $2,000; the fit-out wants $5,000 up front.
    expect(start(w, { org: "daybreak", name: "Patio", steps: [{ id: "fitout", name: "Fit-out", days: 2, cost: 500_000 }] }).rejected).toEqual([]);
    const id = madeProject(w);
    expect(steps(w, "wait").map((e) => e.data)).toEqual([{ project: id, step: "fitout", phase: "wait", at: w.state.clock, cents: 500_000, side: "start" }]);
    lapse(w, 2 * DAY);
    // Still waiting, recorded once, nothing paid.
    expect(steps(w, "wait").length).toBe(1);
    expect(steps(w, "start")).toEqual([]);
    expect(posts(w, /^Patio/)).toEqual([]);
    const section = reg.orgSections.find((s) => s.id === "projects");
    const view = section?.build(w.ctx, "daybreak", null) as unknown as ProjectsView;
    expect(view.projects[0]?.now).toBe("Fit-out: waiting for $5,000.00 to start");
    expect(view.projects[0]?.steps[0]?.state).toBe("waiting");
    // The owner puts money in; the next slot's end it starts, paid once, and two days on it is done.
    const deposit = w.state.clock;
    expect(w.apply({ type: "post", lines: [{ account: ext("owner"), amount: -1_000_000 }, { account: "db_operating", amount: 1_000_000 }], memo: "Owner's money" })).toBeNull();
    lapse(w, DAY);
    const [started] = steps(w, "start");
    expect(Number(started?.data.at)).toBeGreaterThan(deposit);
    expect(posts(w, /^Patio: Fit-out$/).map((p) => line(p, "db_operating"))).toEqual([-500_000]);
    lapse(w, 3 * DAY);
    expect(doneAt(w).fitout).toBe(Number(started?.data.at) + 2 * DAY);
    expect(projectRunOf(w.state, id).steps.fitout?.wait).toBeUndefined();
  });

  test("a pause stops a step's clock and keeps its work left; a resume finishes it that much later", () => {
    const { w } = setup();
    start(w, { org: "brightline", name: "Barn", steps: [{ id: "build", name: "Build", days: 3 }] });
    const id = madeProject(w);
    lapse(w, DAY);
    expect(act(w, "economy.project_pause", { project: id }).rejected).toEqual([]);
    expect(projectRunOf(w.state, id).steps.build?.left).toBe(2 * DAY);
    lapse(w, 5 * DAY);
    expect(steps(w, "done")).toEqual([]);
    const resumed = w.state.clock;
    expect(act(w, "economy.project_resume", { project: id }).rejected).toEqual([]);
    lapse(w, 3 * DAY);
    expect(doneAt(w).build).toBe(resumed + 2 * DAY);
  });

  test("90 days at once leave what 90 days one by one leave", () => {
    const run = (chunks: number): { events: LedgerEvent[]; record: unknown } => {
      const { w } = setup();
      goTo(w, "2026-10-19T08:00");
      start(w, { org: "brightline", template: "water_well", name: "Ranch water" });
      for (let i = 0; i < chunks; i++) lapse(w, (90 / chunks) * DAY);
      const id = madeProject(w);
      const mine = w.events.filter((e) => (e.type.startsWith("economy.project") && objOf((e as PackEvent).data).project === id) || (e.type === "post" && /^(Ranch water|Water sales)/.test(e.memo)));
      return { events: mine.map((e) => ({ ...e, group: undefined, tiedTo: undefined })), record: projectRunOf(w.state, id) };
    };
    const once = run(1);
    const daily = run(90);
    expect(once.events.length).toBeGreaterThan(6);
    expect(daily.events).toEqual(once.events);
    expect(daily.record).toEqual(once.record);
  });
});

describe("projects: what a step brings about", () => {
  test("the well is made on the completion day with what it cost for depreciation, and its royalty starts that day, the first in exact cents", () => {
    const { w } = setup((wd) => {
      wd.entities.brightline!.fields = { ...wd.entities.brightline!.fields, depreciation: "straight_line" };
    });
    const t0 = goTo(w, "2026-10-17T08:00");
    start(w, { org: "brightline", name: "Well No. 3", steps: WELL });
    const id = madeProject(w);
    lapse(w, at(w, "2026-10-26T00:00") - w.state.clock);
    const done = at(w, "2026-10-22T08:00");
    expect(done).toBe(t0 + 5 * DAY);
    expect(doneAt(w).drill).toBe(done);
    const made = projectRunOf(w.state, id).made ?? [];
    expect(made.length).toBe(1);
    const well = w.state.entities[made[0]!];
    expect(well?.kind).toBe("property");
    expect(well?.fields).toMatchObject({ owners: [{ party: "brightline", role: "owner" }], value: 1_000_000, capital_cost: 1_000_000, life_months: 120, in_service: "2026-10-22", built_by: id, property_type: "mineral", reserves: 50_000 });
    // Its cost was capital spending, never an expense.
    expect(packEvents(w, "economy.txn").filter((e) => String(e.data.memo).startsWith("Well No. 3")).map((e) => e.data.category)).toEqual(["capex"]);
    // The stream: from the completion day, linked to the well; October's 25th pays the 10 days it produced.
    const flow = Object.values(w.state.entities).find((e) => e.kind === "flow" && e.fields.link === made[0]);
    expect(flow?.fields).toMatchObject({ start: "2026-10-22", status: "active", to: "brightline" });
    const [royalty] = posts(w, /^Oil sales$/);
    expect(line(royalty!, "bl_operating")).toBe(royaltyMonth(revenueOf([ROYALTY]) as RevenueModel, 0, 10 / 31, 7000).gross);
  });

  test("without depreciation the well's cost is expensed, and it records no capital cost", () => {
    const { w } = setup();
    goTo(w, "2026-10-17T08:00");
    start(w, { org: "brightline", name: "Well No. 4", steps: WELL });
    lapse(w, 6 * DAY);
    const made = projectRunOf(w.state, madeProject(w)).made ?? [];
    const well = w.state.entities[made[0]!];
    expect(well?.fields.value).toBe(1_000_000);
    expect(well?.fields.capital_cost).toBeUndefined();
    expect(packEvents(w, "economy.txn").filter((e) => String(e.data.memo).startsWith("Well No. 4")).map((e) => e.data.category)).toEqual(["project"]);
  });

  test("a template's steps are copied into the project, which pays its first step at once", () => {
    const { w } = setup();
    goTo(w, "2026-10-17T08:00");
    expect(start(w, { org: "brightline", template: "oil_well" }).rejected).toEqual([]);
    const p = projectOf(w.ctx, madeProject(w));
    expect(p?.def.name).toBe("Oil well");
    expect(p?.def.template).toBe("oil_well");
    expect(p?.def.steps.map((s) => s.id)).toEqual(["permits", "site", "drill", "complete", "hookup"]);
    expect(posts(w, /^Oil well: Permits and survey$/).map((p) => line(p, ext("drilling_contractors")))).toEqual([2_500_000]);
    expect(start(w, { org: "brightline", template: "no_such" }).rejected.map((r) => r.rejection.code)).toEqual(["no_template"]);
  });

  test("regression: an unlock setting a field of the thing the step just made finds it made, each unlock its own unit tied to the completion, and the record folds the same again", () => {
    const { world, w } = setup();
    goTo(w, "2026-10-17T08:00");
    const drill: JsonObject = { ...WELL[0], unlocks: [...(WELL[0]?.unlocks as JsonObject[]), { set: { entity: "made", field: "condition", value: "producing" } }] };
    start(w, { org: "brightline", name: "Well No. 5", steps: [drill] });
    lapse(w, 6 * DAY);
    const [well] = projectRunOf(w.state, madeProject(w)).made ?? [];
    expect(w.state.entities[well ?? ""]?.fields).toMatchObject({ property_type: "mineral", condition: "producing" });
    expect(Object.values(w.state.entities).filter((e) => e.kind === "flow" && e.fields.link === well)).toHaveLength(1);
    // The well, its stream and the field: three units, each tied to the completion.
    const done = steps(w, "done")[0]?.group ?? "";
    expect(new Set(w.events.filter((e) => e.tiedTo?.includes(done)).map((e) => e.group)).size).toBe(3);
    const again = new Working(reg, world, startState(world));
    foldUnits(again, w.events);
    expect(again.state.entities[well ?? ""]?.fields.condition).toBe("producing");
  });

  test("regression: what a project capitalized that nothing it made took is written off in its party's books as it ends, dropped part-way or done with a step after its make", () => {
    const depreciating = (wd: WorldDoc): void => {
      wd.entities.brightline!.fields = { ...wd.entities.brightline!.fields, depreciation: "straight_line" };
    };
    const drill: JsonObject = { id: "drill", name: "Drilling", days: 5, cost: 1_000_000, capitalize: true };
    const make = [{ make: { name: "Oil well", life_months: 120 } }];
    // Dropped once the drilling is done and the completion has paid its first half: both written off that month, the payments still capital spending.
    const dropped = setup(depreciating).w;
    goTo(dropped, "2026-10-17T08:00");
    start(dropped, { org: "brightline", name: "Well No. 6", steps: [drill, { id: "complete", name: "Completion", days: 5, cost: 400_000, paid: "split", capitalize: true, after: ["drill"], unlocks: make }] });
    const id = madeProject(dropped);
    lapse(dropped, 6 * DAY);
    expect(act(dropped, "economy.project_drop", { project: id }).rejected).toEqual([]);
    expect(projectRunOf(dropped.state, id)).toMatchObject({ status: "dropped", capex: 0 });
    expect(depreciationIn(dropped.state, "brightline", "2026-10").depreciation).toBe(1_200_000);
    expect(packEvents(dropped, "economy.txn").filter((e) => String(e.data.memo).startsWith("Well No. 6")).map((e) => e.data.category)).toEqual(["capex", "capex"]);
    // Done, with a capitalized hookup after the drilling made the well: the well's cost is the drilling's, the hookup's written off as it ends.
    const done = setup(depreciating).w;
    goTo(done, "2026-10-17T08:00");
    start(done, { org: "brightline", name: "Well No. 7", steps: [{ ...drill, unlocks: make }, { id: "hookup", name: "Hookup", days: 2, cost: 300_000, capitalize: true, after: ["drill"] }] });
    lapse(done, 8 * DAY);
    const run = projectRunOf(done.state, madeProject(done));
    expect([run.status, run.capex]).toEqual(["done", 0]);
    expect(done.state.entities[run.made?.[0] ?? ""]?.fields.capital_cost).toBe(1_000_000);
    expect(depreciationIn(done.state, "brightline", "2026-10").depreciation).toBe(300_000);
  });

  test("regression: the things one step makes share what it capitalized, the first taking the odd cent, so together they take it once and the project holds none", () => {
    const { w } = setup((wd) => {
      wd.entities.brightline!.fields = { ...wd.entities.brightline!.fields, depreciation: "straight_line" };
    });
    goTo(w, "2026-10-17T08:00");
    const unlocks = [{ make: { name: "Oil well", life_months: 120 } }, { make: { name: "Tank battery", life_months: 60 } }];
    start(w, { org: "brightline", name: "Well No. 8", steps: [{ id: "drill", name: "Drilling", days: 5, cost: 1_000_001, capitalize: true, unlocks }] });
    lapse(w, 6 * DAY);
    const run = projectRunOf(w.state, madeProject(w));
    expect([run.status, run.built, run.capex]).toEqual(["done", 0, 0]);
    expect((run.made ?? []).map((id) => [w.state.entities[id]?.name, w.state.entities[id]?.fields.value, w.state.entities[id]?.fields.capital_cost])).toEqual([
      ["Oil well", 500_001, 500_001],
      ["Tank battery", 500_000, 500_000],
    ]);
    // Nothing is left over to write off.
    expect(depreciationIn(w.state, "brightline", "2026-10").depreciation).toBe(0);
  });
});

describe("projects: the story's note, and Undo", () => {
  test("a note sets a step back up to 30 days, or adds to its cost up to the narrated-price cap", () => {
    const { w } = setup();
    start(w, { org: "brightline", name: "Barn", steps: [{ id: "build", name: "Build", days: 10, cost: 100_000, paid: "end" }] });
    const id = madeProject(w);
    const end = Number(steps(w, "start")[0]?.data.end);
    const note = (args: JsonObject) => act(w, "economy.project_note", { project: id, text: "The rain came", ...args }).rejected.map((r) => r.rejection.code);
    expect(note({ days: 31 })).toEqual(["bad_days"]);
    expect(note({ days: 0 })).toEqual(["bad_note"]);
    expect(note({ cents: 1_000_000_000 })).toEqual(["bad_amount"]);
    expect(note({ days: 3, text: "" })).toEqual(["bad_note"]);
    expect(note({ days: 3, cents: 25_000 })).toEqual([]);
    expect(projectRunOf(w.state, id).steps.build).toMatchObject({ end: end + 3 * DAY, delay: 3, extra: 25_000 });
    // The GM's may go further.
    expect(note({ days: 40, source: "gm" })).toEqual([]);
    // The reply's read proposes the same within the story's bounds.
    const channel = reg.proposals.get(PROJECT_NOTE);
    expect(channel?.validate({ type: PROJECT_NOTE, project: id, days: 45, text: "x" }, w.ctx)?.code).toBe("bad_days");
    expect(channel?.validate({ type: PROJECT_NOTE, project: id, days: 2, text: "The crane broke down" }, w.ctx)).toBeNull();
    expect(channel?.toEffects({ type: PROJECT_NOTE, project: id, days: 2, text: "The crane broke down" }, w.ctx)).toEqual([{ type: "economy.project_note", args: { project: id, step: "build", days: 2, cents: 0, text: "The crane broke down", source: "story" } }]);
    lapse(w, 60 * DAY);
    // The extra cost is paid with the step's own at its end.
    expect(posts(w, /^Barn: Build$/).map((p) => line(p, "bl_operating"))).toEqual([-125_000]);
    expect(doneAt(w).build).toBe(end + 43 * DAY);
  });

  test("a note on a done step, or on a dropped project, is refused", () => {
    const { w } = setup();
    start(w, { org: "brightline", name: "Shed", steps: [{ id: "frame", name: "Frame", days: 1 }, { id: "roof", name: "Roof", days: 5, after: ["frame"] }] });
    const id = madeProject(w);
    lapse(w, 2 * DAY);
    expect(act(w, "economy.project_note", { project: id, step: "frame", days: 2, text: "Late" }).rejected.map((r) => r.rejection.code)).toEqual(["done"]);
    expect(act(w, "economy.project_drop", { project: id }).rejected).toEqual([]);
    expect(act(w, "economy.project_note", { project: id, days: 2, text: "Late" }).rejected.map((r) => r.rejection.code)).toEqual(["bad_status"]);
    lapse(w, 10 * DAY);
    expect(doneAt(w).roof).toBeUndefined();
  });

  test("undoing the start takes the project away, and every step and payment that followed it drops", () => {
    const { world, w } = setup();
    goTo(w, "2026-10-19T08:00");
    const before = w.events.length;
    start(w, { org: "brightline", name: "Depot", steps: DEPOT });
    const started = w.events.slice(before);
    lapse(w, 10 * DAY);
    expect(doneAt(w).handover).toBeDefined();
    // The same record folded again without the start, unit by unit: what came after it no longer holds.
    const again = new Working(reg, world, startState(world));
    foldUnits(again, w.events.filter((e) => !started.includes(e)));
    expect(Object.values(again.state.entities).some((e) => e.kind === "project")).toBe(false);
    expect(again.events.some((e) => e.type === PROJECT_EVENTS.step || (e.type === "post" && e.memo.startsWith("Depot")))).toBe(false);
    expect(again.state.accounts.bl_operating).toBe(w.state.accounts.bl_operating! + 170_000);
  });
});

describe("projects: who may", () => {
  test("someone without the power to spend an organization's money can't start one for it", () => {
    const { w } = setup();
    expect(start(w, { org: "brightline", name: "Depot", steps: DEPOT, by: "rosa" }).rejected.map((r) => r.rejection.code)).toEqual(["not_owner"]);
    expect(start(w, { org: "brightline", name: "Depot", steps: DEPOT, by: "jordan" }).rejected).toEqual([]);
  });

  test("steps that wait on each other in a ring are refused", () => {
    const { w } = setup();
    const ring = [{ id: "a", name: "A", days: 1, after: ["b"] }, { id: "b", name: "B", days: 1, after: ["a"] }];
    expect(start(w, { org: "brightline", name: "Loop", steps: ring }).rejected.map((r) => r.rejection.code)).toEqual(["bad_steps"]);
  });
});

describe("projects: what its reader sees", () => {
  test("regression: the Projects section names no one and nothing its reader can't see: a crew member, a flow it starts and an entity it sets are someone or something to them, named for the GM", () => {
    // Rosa and her rent are secret; Jordan, Brightline's owner, reads its projects.
    const { w } = setup((wd) => {
      wd.entities.rosa = { ...wd.entities.rosa!, visibility: "secret" };
      wd.entities.rosa_rent = { ...entity("rosa_rent", "flow", "Rosa's rent", { from: "rosa", to: "jordan", amount: 50_000, every: "month", status: "planned" }), visibility: "secret" };
    });
    start(w, { org: "brightline", name: "Office fit-out", steps: [{ id: "fit", name: "Fit-out", days: 10, crew: { size: 2, role: "fitters", who: ["maya", "rosa"] }, unlocks: [{ flow: "rosa_rent" }, { set: { entity: "rosa_rent", field: "amount", value: 60_000 } }] }] });
    const section = reg.orgSections.find((s) => s.id === "projects");
    const read = (viewer: string | null) => {
      const step = (section?.build(w.ctx, "brightline", viewer) as unknown as ProjectsView).projects[0]?.steps[0];
      return [step?.crew, step?.unlocks];
    };
    expect(read("jordan")).toEqual(["2 fitters, Maya Chen, someone", ["Starts something", "Sets something's amount"]]);
    expect(read(null)).toEqual(["2 fitters, Maya Chen, Rosa Delgado", ["Starts Rosa's rent", "Sets Rosa's rent's amount"]]);
  });
});

describe("projects: the narrator", () => {
  test("a project the player character follows is told where it stands, and the latitude", () => {
    const { w } = setup((wd) => {
      wd.entities.brightline!.fields = { ...wd.entities.brightline!.fields, owners: [{ party: "you", role: "owner", share: 100 }] };
    });
    start(w, { org: "brightline", name: "Depot", steps: [{ id: "dig", name: "Digging", days: 30 }] });
    lapse(w, 11 * DAY + 60);
    const renderer = reg.renderers.find((r) => r.source === "projects");
    const lines = renderer?.render(w.ctx) ?? [];
    expect(lines[0]).toContain("Depot: Digging: day 12 of 30");
    expect(lines.at(-1)).toContain("never say a step is done before its day");
  });
});
