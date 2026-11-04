// Any party employs (ORG-SPEC §3.7, §3.8, §11 Phase 2 Employers), on the starter worlds and Riverton:
// Nell Sparrow, the Thornes' housemaid, is paid from the household's own account on her payday, at
// the household's Money level (its family's, though it is a background entity), and at Money 4 the
// household pays the employer's FICA share; changing Alder Automotive's pay schedule moves Jordan's
// and Danny's cadence in one unit and pays through the change once, no day twice, for hours and for
// a salary; a person and the party employ too; a position's powers decide hiring, leave, hours and
// appointments within its scope, and the self-dealing guard holds for a household's Head; dues flow
// from each member, a share out pays members equally (the party's core and companions only), and
// no organization has living costs.

import { describe, expect, test } from "bun:test";
import type { Level } from "../../../src/shared/ids";
import type { JsonObject } from "../../../src/shared/json";
import type { LedgerEvent, PackEvent, PostEvent } from "../../../src/shared/ledger";
import type { RelationInstance, WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockOfLocal } from "../../../src/engine/calendar";
import { applyEffects, type EffectOutcome } from "../../../src/engine/effects";
import { materializeAll } from "../../../src/engine/materialize";
import { membersOfOrg, orgTitle } from "../../../src/engine/org";
import { createRegistry } from "../../../src/engine/registry-impl";
import { createRng } from "../../../src/engine/rng";
import { isMemberOf } from "../../../src/engine/selector";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { readJob, workIn } from "../../../src/packs/economy/core/employment";
import { startState } from "../support";
import { account, CLERK, entity, setup } from "./work-world";

const reg = createRegistry(ALL_PACKS);
const DAY = 1440;
const HOUSEHOLD = "household_thorne";
const SHOP = "alder_automotive_co";

function starter(id: "modern_slice_of_life" | "mystery_manor", patch: (world: WorldDoc) => void): { world: WorldDoc; w: Working } {
  const make = STARTER_WORLDS[id];
  if (!make) throw new Error(`no starter ${id}`);
  const world = make("t", id);
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  materializeAll(reg, w, world.pov, "run");
  return { world, w };
}

function lapse(w: Working, minutes: number): void {
  const out = runTimelapse(reg, w, { type: "duration", minutes }, { runSeed: "run", overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } });
  if ("code" in out) throw new Error(out.reason);
}

function act(w: Working, type: string, args: JsonObject, seed = type): EffectOutcome {
  return applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(seed) });
}

const refusal = (out: EffectOutcome): string => out.rejected.map((r) => r.rejection.reason).join("; ");
const packEvents = (w: Working, type: string): PackEvent[] => w.events.filter((e: LedgerEvent): e is PackEvent => e.type === type);
const paid = (w: Working, job: string): JsonObject[] => packEvents(w, "economy.payslip").map((e) => e.data).filter((d) => d.job === job && typeof d.gross === "number" && d.gross > 0);
const runs = (w: Working, flow: string): PackEvent[] => packEvents(w, "economy.flow_run").filter((e) => e.data.flow === flow);
const postsSince = (w: Working, from: number): PostEvent[] => w.events.slice(from).filter((e): e is PostEvent => e.type === "post");
const payrollFrom = (w: Working, account: string, to: string): PostEvent | undefined => w.events.find((e): e is PostEvent => e.type === "post" && /^Payroll/.test(e.memo) && lineOf(e, account) < 0 && lineOf(e, to) > 0);
const lineOf = (p: PostEvent | undefined, account: string): number => p?.lines.find((l) => l.account === account)?.amount ?? 0;
const memberOf = (to: string, fields: JsonObject = {}): RelationInstance => ({ type: "member_of", to, fields });

/** Lane H's ids for the Thornes (feat/org-data): Gideon's and Nell's jobs and the household's own account. */
const GIDEON_JOB = "job_gideon_pell";
const NELL_JOB = "job_nell_sparrow";
const ACCOUNT = "acct_thorne_household";
const NELL = "economy.external:nell_sparrow";

/** The Thornes' positions as lane H authors them, the Butler's staff powers reaching only those below him. */
const POSITIONS: JsonObject[] = [
  { id: "head", title: "Master", powers: ["members.admit", "members.remove", "members.appoint", "staff.hire", "staff.fire", "staff.pay", "money.view", "money.spend", "money.manage", "money.invoice", "money.payout", "money.borrow", "assets.use", "assets.assign", "assets.dispose", "property.manage", "property.trade", "shares.manage", "org.govern", "orders.give", "delegate"], successor: "rupert_thorne" },
  { id: "butler", title: "Butler", powers: ["staff.hire", "staff.pay", "members.appoint"], scope: "below", reports_to: "head" },
  { id: "housekeeper", title: "Housekeeper", powers: [], reports_to: "butler" },
  { id: "housemaid", title: "Housemaid", powers: [], seats: 0, reports_to: "housekeeper" },
];

/**
 * Harrowmere's Thornes as an employer: lane H's household, its Master and Lady Honoria, Gideon Pell
 * the Butler and Nell Sparrow the Housemaid on weekly salaries paid on Fridays, and the household's
 * own account, added here as H shapes them while the starter lacks them. The world's Money is
 * raised as GM → This chat → Realism raises it, while the household stays a background entity,
 * capped at 1.
 */
function thornes(money: Level, extra: (world: WorldDoc) => void = () => undefined): { world: WorldDoc; w: Working } {
  return starter("mystery_manor", (world) => {
    world.realism.levels.money = money;
    const e = world.entities;
    if (!e[HOUSEHOLD]) {
      const pay = { occupation: "housekeeper", basis: "salary", pay_every: "weekly", pay_weekday: 5, start: "1931-03-02" };
      e[HOUSEHOLD] = entity(HOUSEHOLD, "household", "The Thornes", { positions: POSITIONS });
      e.sir_alaric!.relations.push(memberOf(HOUSEHOLD, { position: "head" }));
      e.lady_honoria!.relations.push(memberOf(HOUSEHOLD));
      e[GIDEON_JOB] = entity(GIDEON_JOB, "job", "Gideon Pell's place", { ...pay, worker: "gideon_pell", employer: HOUSEHOLD, title: "Butler", position: "butler", rate: 18_000 });
      e[NELL_JOB] = entity(NELL_JOB, "job", "Nell Sparrow's place", { ...pay, worker: "nell_sparrow", employer: HOUSEHOLD, title: "Housemaid", position: "housemaid", rate: 8_640 });
      e[ACCOUNT] = entity(ACCOUNT, "account", "The Thornes' household account", { owners: [{ party: HOUSEHOLD, role: "owner" }], product: "checking", opening: 15_360 });
    }
    extra(world);
  });
}

/** The employer's share of FICA on a paycheck: Social Security and Medicare, each rounded, as much as the worker's pay withheld. */
const ficaOn = (gross: number): number => Math.round((gross * 6.2) / 100) + Math.round((gross * 1.45) / 100);

describe("any party employs: a household", () => {
  test("Nell is paid from the Thornes' own account on her payday, at the household's level, and at Money 4 the household pays the employer's FICA share", () => {
    const { world, w } = thornes(4);
    // Friday 26 October 1934, 16:40; the next payday is Friday 2 November.
    lapse(w, 7 * DAY);
    expect(runs(w, `pay:${NELL_JOB}`).map((e) => [e.data.at, e.data.outcome])).toEqual([[clockOfLocal(calendarOf(world), "1934-11-02T09:00"), "paid"]]);
    const gross = paid(w, NELL_JOB)[0]?.gross as number;
    expect(gross).toBeGreaterThan(0);
    // The household pays the gross and, an employer at Money 4, its own share of FICA beside it.
    const post = payrollFrom(w, ACCOUNT, NELL);
    expect(ficaOn(gross)).toBeGreaterThan(0);
    expect(-lineOf(post, ACCOUNT)).toBe(gross + ficaOn(gross));
    expect(lineOf(post, "economy.external:tax:federal")).toBeGreaterThanOrEqual(2 * ficaOn(gross));
    // It isn't a company: no books keep its payroll; its journal does.
    expect(packEvents(w, "economy.payslip").find((e) => e.data.job === NELL_JOB)?.data.business).toBeUndefined();
  });

  test("below Money 4 Nell is paid all the same, and the household adds no share", () => {
    const { w } = thornes(3);
    lapse(w, 7 * DAY);
    expect(-lineOf(payrollFrom(w, ACCOUNT, NELL), ACCOUNT)).toBe(paid(w, NELL_JOB)[0]?.gross as number);
  });

  test("the Thornes' people: Gideon and Nell are its staff, as Butler and Housemaid, after its members, and work for it without belonging to it", () => {
    const { w } = thornes(4);
    const rows = membersOfOrg(w.ctx, HOUSEHOLD);
    expect(rows.filter((r) => r.who === "gideon_pell" || r.who === "nell_sparrow").map((r) => [r.who, r.how, r.position])).toEqual([
      ["gideon_pell", "staff", "butler"],
      ["nell_sparrow", "staff", "housemaid"],
    ]);
    expect(rows.findIndex((r) => r.how === "staff")).toBeGreaterThan(rows.findLastIndex((r) => r.how === "member"));
    expect(["gideon_pell", "nell_sparrow"].map((who) => orgTitle(w.ctx, who, HOUSEHOLD))).toEqual(["Butler", "Housemaid"]);
    expect(orgTitle(w.ctx, "sir_alaric", HOUSEHOLD)).toStartWith("Master");
    expect([isMemberOf(w.ctx, "nell_sparrow", HOUSEHOLD), isMemberOf(w.ctx, "lady_honoria", HOUSEHOLD)]).toEqual([false, true]);
  });

  test("the Butler hires into the positions below his own, decides their leave and hours, and appoints them; not into his own, nor without a position", () => {
    const { w } = thornes(4, (world) => {
      world.entities[HOUSEHOLD]!.fields.positions = POSITIONS;
      world.entities.betty = { ...world.entities.nell_sparrow!, id: "betty", name: "Betty Rowe", relations: [] };
    });
    expect(refusal(act(w, "economy.hire", { business: HOUSEHOLD, worker: "betty", title: "Scullery maid", position: "housemaid", basis: "hourly", rate: 5, hours: "contract", hours_per_week: 50, by: "gideon_pell" }))).toBe("");
    const job = Object.values(w.state.entities).find((e) => e.kind === "job" && e.fields.worker === "betty");
    expect([job?.fields.employer, job?.fields.position, job?.fields.pay_every]).toEqual([HOUSEHOLD, "housemaid", "weekly"]);
    expect(refusal(act(w, "economy.hire", { business: HOUSEHOLD, worker: "rupert_thorne", position: "butler", by: "gideon_pell" }, "own"))).toBe("Butler isn't below Butler at The Thornes");
    expect(refusal(act(w, "economy.hire", { business: HOUSEHOLD, worker: "rupert_thorne", by: "gideon_pell" }, "none"))).toBe("Butler hires and appoints only into the positions below it at The Thornes");
    // Verity Lorne, the secretary, holds no basis there: she decides none of it.
    expect(refusal(act(w, "economy.job_leave", { job: NELL_JOB, leave: true, by: "verity_lorne" }))).toBe("The Thornes: you may not set staff pay, hours, schedules and leave");
    expect(refusal(act(w, "economy.job_leave", { job: NELL_JOB, leave: true, by: "gideon_pell" }, "leave"))).toBe("");
    expect(readJob(w.ctx, NELL_JOB)?.status).toBe("leave");
    expect(refusal(act(w, "economy.job_leave", { job: NELL_JOB, leave: false, by: "gideon_pell" }, "back"))).toBe("");
    expect(refusal(act(w, "economy.job_hours", { job: NELL_JOB, hours_per_week: 48, by: "gideon_pell" }))).toBe("");
    expect(readJob(w.ctx, NELL_JOB)?.hoursPerWeek).toBe(48);
    // Nell moves up to Housekeeper, below the Butler: his to fill. Her title follows the position she holds now, before her job's own words.
    expect(refusal(act(w, "economy.job_position", { job: NELL_JOB, position: "housekeeper", by: "gideon_pell" }))).toBe("");
    expect(w.state.entities[NELL_JOB]?.fields.position).toBe("housekeeper");
    expect(orgTitle(w.ctx, "nell_sparrow", HOUSEHOLD)).toBe("Housekeeper");
  });

  test("a week on leave pays nothing; back from it, the next week pays in full", () => {
    const control = thornes(4).w;
    lapse(control, 7 * DAY);
    const week = paid(control, NELL_JOB)[0]?.gross as number;
    const { w } = thornes(4);
    expect(refusal(act(w, "economy.job_leave", { job: NELL_JOB, leave: true }))).toBe("");
    lapse(w, 7 * DAY);
    expect(paid(w, NELL_JOB)).toEqual([]);
    expect(refusal(act(w, "economy.job_leave", { job: NELL_JOB, leave: false }, "back"))).toBe("");
    lapse(w, 7 * DAY);
    expect(paid(w, NELL_JOB).map((d) => d.gross)).toEqual([week]);
  });
});

describe("the pay schedule", () => {
  test("changing Alder Automotive's moves Jordan's and Danny's cadence once, in one unit, and pays through the change with no day paid twice", () => {
    // Their hours counted by the week, so what each paycheck covers can be counted.
    const { world, w } = starter("modern_slice_of_life", (world) => {
      for (const id of ["job_pov_mechanic", "job_danny_mechanic"]) Object.assign(world.entities[id]!.fields, { hours: "contract", weeks_per_year: 52 });
    });
    const cal = calendarOf(world);
    // Monday 14 September 2026; Friday the 18th pays both, weekly.
    lapse(w, 5 * DAY);
    const before = w.events.length;
    expect(refusal(act(w, "economy.pay_schedule", { org: SHOP, every: "biweekly", anchor: "2026-10-02", by: "marcus_delgado" }))).toBe("");
    const sets = w.events.slice(before).filter((e) => e.type === "set");
    expect(sets.map((e) => (e.type === "set" ? [e.entity, e.field] : []))).toEqual([
      [SHOP, "payroll"],
      ["job_danny_mechanic", "pay_every"],
      ["job_danny_mechanic", "pay_anchor"],
      ["job_pov_mechanic", "pay_every"],
      ["job_pov_mechanic", "pay_anchor"],
    ]);
    expect(new Set(w.events.slice(before).map((e) => e.group)).size).toBe(1);
    // The same schedule again moves no job.
    const again = w.events.length;
    expect(refusal(act(w, "economy.pay_schedule", { org: SHOP, every: "biweekly", anchor: "2026-10-02", by: "marcus_delgado" }, "again"))).toBe("");
    expect(w.events.slice(again).filter((e) => e.type === "set" && e.entity !== SHOP)).toEqual([]);
    lapse(w, 28 * DAY);
    for (const job of ["job_pov_mechanic", "job_danny_mechanic"]) {
      expect(runs(w, `pay:${job}`).map((e) => e.data.at)).toEqual(["2026-09-18T09:00", "2026-10-02T09:00", "2026-10-16T09:00"].map((t) => clockOfLocal(cal, t)));
      // Each paycheck pays the work since the last one's through to its own day: the first after the change the two weeks to it, once.
      const slips = paid(w, job);
      expect(slips.map((s) => s.through)).toEqual(["2026-09-18T00:00", "2026-10-02T00:00", "2026-10-16T00:00"].map((t) => clockOfLocal(cal, t)));
      const held = readJob(w.ctx, job);
      if (!held) throw new Error(`no ${job}`);
      expect(slips.slice(1).map((s, i) => [s.minutes, workIn(w.ctx, held, slips[i]?.through as number, s.through as number).minutes])).toEqual(slips.slice(1).map((s) => [s.minutes, s.minutes]));
      expect(slips[1]?.minutes).toBeGreaterThan(slips[0]?.minutes as number);
    }
  });

  test("a salary moved from biweekly to semimonthly is paid only the days the last biweekly paycheck didn't pay", () => {
    const { world, w } = setup((wd) => void (wd.entities.job_clerk = entity("job_clerk", "job", "Office clerk", { ...CLERK, pay_roll: "none" })));
    const cal = calendarOf(world);
    // Riverton opens on Friday 16 October 2026; the clerk's biweekly Friday, the 23rd, pays through the 23rd.
    lapse(w, 12 * DAY);
    expect(paid(w, "job_clerk").map((d) => d.through)).toEqual([clockOfLocal(cal, "2026-10-24T00:00")]);
    expect(refusal(act(w, "economy.pay_schedule", { org: "brightline", every: "semimonthly", by: "jordan" }))).toBe("");
    lapse(w, 9 * DAY);
    // The semimonthly period to the 31st began on the 16th: the clerk is paid its 24th to 31st, 8 of its 16 days.
    expect(paid(w, "job_clerk").slice(1).map((d) => [d.through, d.gross])).toEqual([[clockOfLocal(cal, "2026-11-01T00:00"), Math.round(((3_740_000 / 24) * 8) / 16)]]);
  });

  test("a new hire joins the organization's pay schedule", () => {
    const { w } = setup((wd) => void (wd.entities.brightline!.fields.payroll = [{ every: "semimonthly", days: [15, -1] }]));
    expect(refusal(act(w, "economy.hire", { business: "brightline", worker: "rosa", title: "Courier", basis: "hourly", rate: 2000, hours: "contract", by: "jordan" }))).toBe("");
    const job = Object.values(w.state.entities).find((e) => e.kind === "job" && e.fields.worker === "rosa");
    expect([job?.fields.pay_every, job?.fields.pay_days]).toEqual(["semimonthly", [15, -1]]);
  });

  test("a position whose powers reach only those below it moves no one's pay schedule but theirs", () => {
    const { w } = setup((wd) => {
      Object.assign(wd.entities.brightline!.fields, { positions: [{ id: "foreman", title: "Foreman", powers: ["staff.pay"], scope: "below" }] });
      wd.entities.job_maya = entity("job_maya", "job", "Maya at Brightline", { worker: "maya", employer: "brightline", title: "Foreman", position: "foreman", basis: "hourly", rate: 2500, hours: "contract", pay_every: "weekly", pay_weekday: 5, start: "2025-01-06" });
    });
    expect(refusal(act(w, "economy.pay_schedule", { org: "brightline", every: "monthly", by: "maya" }))).toBe("Foreman reaches only the positions below it at Brightline Logistics, not every job there");
  });
});

describe("any party employs: a person, and the party", () => {
  test("Jordan hires Rosa for himself, and pays her from his own checking account", () => {
    const { w } = setup((wd) => void (wd.entities.jordan_checking = account("jordan_checking", "jordan", "checking", 2_000_000)));
    expect(refusal(act(w, "economy.hire", { business: "jordan", worker: "rosa", title: "Housekeeper", basis: "hourly", rate: 1500, hours: "contract", hours_per_week: 20, pay_every: "weekly", by: "jordan" }))).toBe("");
    const job = Object.keys(w.state.entities).find((id) => w.state.entities[id]?.kind === "job" && w.state.entities[id]?.fields.worker === "rosa") ?? "";
    expect([readJob(w.ctx, job)?.party, readJob(w.ctx, job)?.business]).toEqual(["jordan", null]);
    lapse(w, 8 * DAY);
    expect(payrollFrom(w, "jordan_checking", "rosa_checking")).toBeDefined();
  });

  test("the party, once it has a purse, hires a hand its leader chooses, and pays from the purse", () => {
    const { w } = setup((wd) => {
      wd.entities.party_you = entity("party_you", "party", "Your party", { leader: "you" });
      wd.entities.purse = account("purse", "party_you", "checking", 500_000);
    });
    expect(refusal(act(w, "economy.hire", { business: "party_you", worker: "rosa", title: "Hand", basis: "hourly", rate: 1500, hours: "contract", hours_per_week: 20, pay_every: "weekly", by: "you" }))).toBe("");
    expect(refusal(act(w, "economy.hire", { business: "party_you", worker: "maya", by: "jordan" }, "stranger"))).toBe("Your party: you may not hire staff");
    lapse(w, 8 * DAY);
    expect(payrollFrom(w, "purse", "rosa_checking")).toBeDefined();
  });
});

describe("the self-dealing guard holds for every employer", () => {
  test("Helen, the Kowalczyks' Head, runs their money for them all: she can't put her daughter on its payroll", () => {
    const { w } = starter("modern_slice_of_life", () => undefined);
    expect(refusal(act(w, "economy.hire", { business: "household_kowalczyk", worker: "maddie_kowalczyk", title: "Babysitter", by: "helen_kowalczyk" }))).toContain("so can't put Maddie Kowalczyk on its payroll");
  });
});

describe("treasuries", () => {
  /** Riverton with the Delgados, a household of Jordan and Rosa that holds an account of its own. */
  function delgados(fields: JsonObject = {}, rosa: JsonObject = {}) {
    return setup((wd) => {
      wd.entities.delgados = entity("delgados", "household", "The Delgados", fields);
      wd.entities.delgados_account = account("delgados_account", "delgados", "checking", 100_000);
      wd.entities.jordan_checking = account("jordan_checking", "jordan", "checking", 2_000_000);
      wd.entities.jordan!.relations.push(memberOf("delgados"));
      wd.entities.rosa!.relations.push(memberOf("delgados", rosa));
    });
  }

  test("dues flow monthly from each member into the household's account; a member holding a position free of them owes none", () => {
    const { world, w } = delgados({ dues: [{ cents: 2_500, every: "month", day: 1 }], positions: [{ id: "treasurer", title: "Treasurer", powers: [], no_dues: true }] }, { position: "treasurer" });
    lapse(w, 17 * DAY);
    expect(runs(w, "dues:delgados:jordan").map((e) => [e.data.at, e.data.outcome])).toEqual([[clockOfLocal(calendarOf(world), "2026-11-01T09:00"), "paid"]]);
    expect(runs(w, "dues:delgados:rosa")).toEqual([]);
    expect(postsSince(w, 0).some((p) => lineOf(p, "delgados_account") === 2_500)).toBe(true);
  });

  test("dues a member can't pay carry to the next time", () => {
    const { w } = delgados({ dues: [{ cents: 50_000_000, every: "month", day: 1 }] });
    lapse(w, 17 * DAY);
    expect(runs(w, "dues:delgados:jordan").map((e) => e.data.outcome)).toEqual(["deferred"]);
  });

  test("setting dues: whoever governs it, or the GM; nothing ends them", () => {
    const { w } = delgados();
    expect(refusal(act(w, "economy.dues", { org: "delgados", cents: 1_000, every: "week", day: 5, by: "jordan" }))).toBe("The Delgados: you may not set its positions, rules and structure");
    expect(refusal(act(w, "economy.dues", { org: "delgados", cents: 1_000, every: "week", day: 5 }, "gm"))).toBe("");
    expect(w.state.entities.delgados?.fields.dues).toEqual([{ cents: 1_000, every: "week", day: 5 }]);
    expect(refusal(act(w, "economy.dues", { org: "delgados", cents: 0 }, "end"))).toBe("");
    expect(w.state.entities.delgados?.fields.dues).toBeNull();
  });

  test("a share out pays the household's members equally, the odd cents to the first, in one unit, and never more than it holds", () => {
    const { w } = delgados();
    // A day in, the household's account has opened (the money's first step at its level).
    lapse(w, DAY);
    const before = w.events.length;
    expect(refusal(act(w, "economy.share_out", { org: "delgados", cents: 1_001 }))).toBe("");
    const posts = postsSince(w, before);
    expect(posts.map((p) => [lineOf(p, "delgados_account"), lineOf(p, "jordan_checking"), lineOf(p, "rosa_checking")])).toEqual([
      [-501, 501, 0],
      [-500, 0, 500],
    ]);
    expect(new Set(posts.map((p) => p.group)).size).toBe(1);
    expect(refusal(act(w, "economy.share_out", { org: "delgados", cents: 10_000_000 }, "big"))).toBe("delgados_account doesn't have $100,000.00");
  });

  test("the party's share out pays its core members and companions equally, never its leader, hired hands or allies", () => {
    const { w } = setup((wd) => {
      wd.entities.party_you = entity("party_you", "party", "Your party", { leader: "you" });
      wd.entities.purse = account("purse", "party_you", "checking", 10_000);
      wd.entities.maya!.relations.push({ type: "travels_with", to: "you", fields: { tier: "companion" } });
      wd.entities.rosa!.relations.push({ type: "travels_with", to: "you", fields: {} });
      wd.entities.jordan!.relations.push({ type: "travels_with", to: "you", fields: { tier: "hired" } });
    });
    lapse(w, DAY);
    const before = w.events.length;
    expect(refusal(act(w, "economy.share_out", { org: "party_you", cents: 4_000, by: "you" }))).toBe("");
    expect(postsSince(w, before).map((p) => [-lineOf(p, "purse"), lineOf(p, "maya_checking"), lineOf(p, "rosa_checking")])).toEqual([
      [2_000, 2_000, 0],
      [2_000, 0, 2_000],
    ]);
  });

  test("no organization has living costs, though it holds money of its own", () => {
    const { w } = delgados();
    lapse(w, 7 * DAY);
    const living = new Set(packEvents(w, "economy.flow_run").map((e) => String(e.data.flow)).filter((f) => f.startsWith("living:")));
    expect([...living].some((f) => f === "living:delgados" || f === "living:brightline" || f === "living:daybreak")).toBe(false);
    expect(living.size).toBeGreaterThan(0);
  });
});
