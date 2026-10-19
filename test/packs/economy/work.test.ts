import { describe, expect, test } from "bun:test";
import { hashJson } from "../../../src/shared/hash";
import type { Level } from "../../../src/shared/ids";
import type { JsonObject } from "../../../src/shared/json";
import type { LedgerEvent, PackEvent, PostEvent } from "../../../src/shared/ledger";
import type { EntityDef, WorldDoc } from "../../../src/shared/world";
import { applyEffects } from "../../../src/engine/effects";
import { materializeAll } from "../../../src/engine/materialize";
import { createRegistry, type Registry } from "../../../src/engine/registry-impl";
import { createRng } from "../../../src/engine/rng";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { bracketTax, federalTables, filingStatusOf, salesTaxOn, salesTaxPct } from "../../../src/packs/economy/core/taxes";
import { modernUsWorld } from "../riverton";
import { fold, startState, trialBalance } from "../support";

const reg: Registry = createRegistry(ALL_PACKS);
const ext = (id: string): string => `economy.external:${id}`;

function entity(id: string, kind: string, name: string, fields: JsonObject, tier: EntityDef["tier"] = "background"): EntityDef {
  return { id, kind, name, tier, fields, relations: [] };
}

function account(id: string, owner: string, product: string, opening: number): EntityDef {
  return entity(id, "account", id, { owners: [{ party: owner, role: "owner" }], product, opening });
}

/**
 * Riverton with Brightline as a business that keeps its own books (Jordan owns it) and the café
 * as Daybreak's, each with an operating account; the player, Maya and Rosa bank at checking accounts.
 */
function setup(patch: (w: WorldDoc) => void = () => undefined): { world: WorldDoc; w: Working } {
  const world = modernUsWorld("w", "Riverton");
  const add = (e: EntityDef): void => void (world.entities[e.id] = e);
  const bl = world.entities.brightline!;
  bl.tier = "principal";
  bl.fields = { ...bl.fields, places: ["office"], owners: [{ party: "jordan", role: "owner", share: 100 }], operating_account: "bl_operating", late_fee_pct: 1.5, invoice_days: 30 };
  add(account("bl_operating", "brightline", "business_checking", 50_000_000));
  add(entity("daybreak", "business", "Daybreak Café", { place: "cafe", places: ["cafe"], owners: [{ party: "maya", role: "owner", share: 100 }], operating_account: "db_operating", collects_sales_tax: true, margin_pct: 60 }, "principal"));
  add(account("db_operating", "daybreak", "business_checking", 200_000));
  add(account("maya_checking", "maya", "checking", 40_000));
  add(account("rosa_checking", "rosa", "checking", 90_000));
  patch(world);
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return { world, w };
}

function lapse(w: Working, minutes: number) {
  const out = runTimelapse(reg, w, { type: "duration", minutes }, { runSeed: "run", overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } });
  if ("code" in out) throw new Error(out.reason);
  return out;
}

function act(w: Working, type: string, args: JsonObject, seed = type) {
  return applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(seed) });
}

const packEvents = (w: Working, type: string): PackEvent[] => w.events.filter((e: LedgerEvent): e is PackEvent => e.type === type);
const payslips = (w: Working, job: string): JsonObject[] => packEvents(w, "economy.payslip").map((e) => e.data).filter((d) => d.job === job);
const paid = (w: Working, job: string): JsonObject[] => payslips(w, job).filter((d) => typeof d.gross === "number" && d.gross > 0);
const posts = (w: Working, memo: RegExp): PostEvent[] => w.events.filter((e): e is PostEvent => e.type === "post" && memo.test(e.memo));
const line = (p: PostEvent, account: string): number => p.lines.find((l) => l.account === account)?.amount ?? 0;
/** The payroll postings that pay into an account. */
const paychecks = (w: Working, into: string): PostEvent[] => posts(w, /^Payroll/).filter((p) => line(p, into) > 0);

/** The player's salaried clerk job at Brightline, paid every other Friday. */
const CLERK: JsonObject = { worker: "you", employer: "brightline", workplace: "office", title: "Office clerk", occupation: "office_clerk", basis: "salary", rate: 3_740_000, pay_every: "biweekly", pay_anchor: "2026-10-23", start: "2025-01-05" };

describe("work: jobs and payroll", () => {
  test("a summer job pays only in its season", () => {
    const { w } = setup((world) => {
      world.entities.job_summer = entity("job_summer", "job", "Lifeguard", { worker: "rosa", employer: "Lake Erie marina", title: "Lifeguard", basis: "hourly", rate: 1600, hours: "contract", hours_per_week: 30, season_from: "06-01", season_to: "08-31", pay_every: "weekly", pay_weekday: 5, start: "2026-06-01" });
      world.entities.job_fall = entity("job_fall", "job", "Leaf crew", { worker: "rosa", employer: "Riverton parks", title: "Leaf crew", basis: "hourly", rate: 1600, hours: "contract", hours_per_week: 30, season_from: "10-01", season_to: "11-30", pay_every: "weekly", pay_weekday: 5, start: "2026-10-01" });
    });
    lapse(w, 21 * 1440);
    expect(paid(w, "job_summer")).toEqual([]);
    const fall = paid(w, "job_fall");
    expect(fall.length).toBeGreaterThanOrEqual(3);
    // A full week in season is 30 hours at $16.
    expect(fall.some((d) => d.gross === 30 * 1600)).toBe(true);
    const checks = paychecks(w, "rosa_checking");
    expect(checks.length).toBe(fall.length);
    expect(checks.every((p) => line(p, ext("employer:riverton_parks")) < 0)).toBe(true);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("a gig worker is paid each evening they work, with nothing withheld", () => {
    const { w } = setup((world) => {
      world.entities.job_gig = entity("job_gig", "job", "Courier", { worker: "maya", employer: "Dashway", title: "Courier", occupation: "food_delivery_courier", basis: "per_shift", rate: 9000, hours: "contract", shifts_per_week: 7, weeks_per_year: 52, pay_every: "per_job", contractor: true, start: "2026-01-01" });
    });
    const before = w.state.accounts.maya_checking ?? 0;
    lapse(w, 3 * 1440);
    const gigs = paychecks(w, "maya_checking");
    expect(gigs.length).toBe(3);
    for (const p of gigs) expect(p.lines).toEqual([{ account: ext("employer:dashway"), amount: -9000 }, { account: "maya_checking", amount: 9000 }]);
    expect((w.state.accounts.maya_checking ?? 0) - before).toBeGreaterThanOrEqual(3 * 9000 - 20_000);
    expect(paid(w, "job_gig").every((d) => d.taxes === 0 && d.contract === true)).toBe(true);
  });

  test("routing splits send a share of each paycheck to savings and the rest to checking", () => {
    const { w } = setup((world) => {
      world.entities.job_clerk = entity("job_clerk", "job", "Office clerk", { ...CLERK, splits: [{ to: "savings", pct: 10 }] });
    });
    lapse(w, 15 * 1440);
    const [p] = paychecks(w, "checking");
    if (!p) throw new Error("no paycheck");
    const [slip] = paid(w, "job_clerk");
    const net = slip?.net as number;
    expect(line(p, "savings")).toBe(Math.round(net / 10));
    expect(line(p, "checking")).toBe(net - Math.round(net / 10));
    expect(line(p, "bl_operating")).toBeLessThan(-(slip?.gross as number) + 1);
    expect(p.lines.reduce((a, l) => a + l.amount, 0)).toBe(0);
  });

  test("brackets withhold at the top level; below it the occupation's flat rate does", () => {
    const top = setup((world) => void (world.entities.job_clerk = entity("job_clerk", "job", "Office clerk", CLERK)));
    lapse(top.w, 15 * 1440);
    const ctx = reg.context(top.w.world, top.w.state);
    const t = federalTables(ctx);
    const filing = filingStatusOf(ctx, "you");
    const [slip] = paid(top.w, "job_clerk");
    const gross = slip?.gross as number;
    const federal = Math.round(bracketTax(t.brackets[filing], Math.max(0, gross * 26 - t.standardDeduction[filing])) / 26);
    const fica = Math.round((gross * t.socialSecurityPct) / 100) + Math.round((gross * t.medicarePct) / 100);
    const [p] = paychecks(top.w, "checking");
    // The employer adds its own half of FICA beside the worker's.
    expect(line(p!, ext("tax:federal"))).toBe(federal + 2 * fica);
    expect(line(p!, "bl_operating")).toBe(-(gross + fica));

    const flat = setup((world) => {
      world.entities.job_clerk = entity("job_clerk", "job", "Office clerk", CLERK);
      world.realism.levels.money = 3;
      world.packs.economy = { ...world.packs.economy, config: { ...(world.packs.economy?.config ?? {}), features: { withholding: true } } };
    });
    lapse(flat.w, 15 * 1440);
    const [flatSlip] = paid(flat.w, "job_clerk");
    const [q] = paychecks(flat.w, "checking");
    expect(line(q!, ext("tax:federal"))).toBe(Math.round(((flatSlip?.gross as number) * 14) / 100));
    expect(line(q!, "bl_operating")).toBe(-(flatSlip?.gross as number));
    expect(federal).not.toBe(Math.round((gross * 14) / 100));
  });

  test("hiring adds a payroll on the business's cycle; ending the job pays a last check and stops it", () => {
    const { w } = setup((world) => void (world.entities.job_clerk = entity("job_clerk", "job", "Office clerk", CLERK)));
    expect(act(w, "economy.hire", { business: "brightline", worker: "rosa", title: "Courier driver", basis: "hourly", rate: 2200, hours: "contract", hours_per_week: 40, by: "jordan" }).rejected).toEqual([]);
    const [jobId, job] = Object.entries(w.state.entities).find(([, e]) => e.kind === "job" && e.fields.worker === "rosa") ?? [];
    if (!jobId || !job) throw new Error("no job");
    // Rosa joins the clerk's biweekly Friday cycle.
    expect(job.fields).toMatchObject({ employer: "brightline", pay_every: "biweekly", pay_anchor: "2026-10-23" });
    lapse(w, 8 * 1440);
    const first = paid(w, jobId);
    expect(first.length).toBe(1);
    // From her first day (Fri 16 Oct) to the payday a week later: 40 hours a week, thinned to her occupation's weeks a year.
    const minutes = first[0]?.minutes as number;
    expect(minutes).toBeGreaterThan(40 * 60 * 0.9);
    expect(minutes).toBeLessThanOrEqual(40 * 60);
    expect(first[0]?.gross).toBe(Math.round((2200 * minutes) / 60));
    expect(paychecks(w, "rosa_checking").every((p) => line(p, "bl_operating") < 0)).toBe(true);
    expect(act(w, "economy.job_end", { job: jobId, by: "jordan" }).rejected).toEqual([]);
    lapse(w, 30 * 1440);
    const all = paid(w, jobId);
    expect(all.length).toBe(2);
    const last = all[1]!;
    // The last check covers through the job's last day, and nothing comes after.
    expect((last.minutes as number) > 0).toBe(true);
    expect(payslips(w, jobId).length).toBe(2);
    expect(paid(w, "job_clerk").length).toBeGreaterThanOrEqual(3);
    // A stranger can't hire for Brightline.
    expect(act(w, "economy.hire", { business: "brightline", worker: "maya", by: "you" }, "h2").rejected.length).toBe(1);
  });

  test("a 30-day timelapse pays the clerk twice or more, keeps the books balanced, and re-folds the same", () => {
    const { world, w } = setup((wd) => void (wd.entities.job_clerk = entity("job_clerk", "job", "Office clerk", CLERK)));
    const s0 = startState(world);
    lapse(w, 30 * 1440);
    expect(paychecks(w, "checking").length).toBeGreaterThanOrEqual(2);
    expect(trialBalance(w.state)).toBe(0);
    expect(hashJson(fold(reg, w.world, s0, w.events).accounts)).toBe(hashJson(w.state.accounts));
  });

  test("hourly pay on a named weekday: four Thursday paychecks of $940 gross land in savings, net of withholding", () => {
    const { w } = setup((world) => {
      world.entities.job_shop = entity("job_shop", "job", "Stock clerk", { worker: "you", employer: "Riverton Hardware", title: "Stock clerk", basis: "hourly", rate: 2350, hours: "contract", hours_per_week: 40, weeks_per_year: 52, pay_every: "weekly", pay_weekday: 4, splits: [{ to: "savings", pct: 100 }], start: "2025-01-01" });
    });
    const before = w.state.accounts.savings ?? 0;
    lapse(w, 28 * 1440);
    const pay = paychecks(w, "savings");
    expect(pay).toHaveLength(4);
    for (const p of pay) expect(line(p, ext("employer:riverton_hardware"))).toBe(-94_000);
    const net = paid(w, "job_shop").map((d) => d.net as number);
    expect(net.every((n) => n > 60_000 && n < 94_000)).toBe(true);
    // The Money panel names the paycheck with its gross and what was withheld.
    const ctx = reg.context(w.world, w.state);
    expect(ctx.query("economy.finance")(ctx, "you", true).recent.find((r) => r.memo.startsWith("Payroll"))?.memo).toMatch(/gross, .* withheld/);
    expect((w.state.accounts.savings ?? 0) - before).toBeGreaterThanOrEqual(net.reduce((a, n) => a + n, 0));
    expect(trialBalance(w.state)).toBe(0);
  });
});

describe("work: businesses", () => {
  test("sales tax applies only at the top level: at Money 3 a purchase costs its listed price, and the business neither collects nor remits", () => {
    const run = (level: Level) => {
      const { w } = setup((world) => {
        world.entities.you!.fields.place = "cafe";
        world.realism.levels.money = level;
      });
      expect(act(w, "economy.buy", { payer: "you", item: "latte_16oz", method: "debit" }).rejected).toEqual([]);
      const sale = packEvents(w, "economy.sale")[0]?.data ?? {};
      const bought = posts(w, /^Bought/)[0];
      lapse(w, 5 * 1440); // past the 20th, when collected tax is remitted
      return { sale, lines: bought?.lines ?? [], remitted: posts(w, /^Sales tax/).length };
    };
    const top = run(4);
    const cents = top.sale.cents as number;
    const tax = top.sale.tax as number;
    expect(tax).toBeGreaterThan(0);
    expect(top.lines).toEqual([{ account: "checking", amount: -(cents + tax) }, { account: "db_operating", amount: cents + tax }]);
    expect(top.remitted).toBe(1);
    const below = run(3);
    expect(below.sale).toMatchObject({ tax: 0 });
    const listed = below.sale.cents as number;
    expect(below.lines).toEqual([{ account: "checking", amount: -listed }, { account: "db_operating", amount: listed }]);
    expect(below.remitted).toBe(0);
  });

  test("a purchase at a business's place pays the business, with sales tax it remits on the 20th", () => {
    const { w } = setup((world) => void (world.entities.you!.fields.place = "cafe"));
    const ctx = reg.context(w.world, w.state);
    const before = w.state.accounts.db_operating ?? 0;
    expect(act(w, "economy.buy", { payer: "you", item: "latte_16oz", method: "debit" }).rejected).toEqual([]);
    const [sale] = packEvents(w, "economy.sale");
    const cents = sale?.data.cents as number;
    const tax = salesTaxOn(cents, salesTaxPct(ctx, "cafe"));
    expect(tax).toBeGreaterThan(0);
    expect(sale?.data).toMatchObject({ business: "daybreak", tax, payer: "you" });
    expect((w.state.accounts.db_operating ?? 0) - before).toBe(cents + tax);
    const after = reg.context(w.world, w.state);
    const books = after.query("economy.business_books")(after, "daybreak", w.state.clock - 1440, w.state.clock + 1);
    // The café's books: the price as revenue; the tax it holds and what it owes its suppliers (a 60% margin) as payables.
    expect(books).toMatchObject({ revenue: cents, payables: tax + Math.round((cents * 40) / 100) });
    lapse(w, 5 * 1440); // past the 20th
    const [remit] = posts(w, /^Sales tax/);
    expect(remit?.lines).toEqual([{ account: "db_operating", amount: -tax }, { account: ext("tax:sales:us"), amount: tax }]);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("an invoice is paid by its flow on the due date, or goes late and takes its fee", () => {
    const { w } = setup();
    expect(act(w, "economy.invoice_issue", { business: "brightline", customer: "rosa", cents: 60_000, memo: "Freight", days: 3, by: "jordan" }).rejected).toEqual([]);
    expect(act(w, "economy.invoice_issue", { business: "brightline", customer: "maya", cents: 5_000_000, memo: "Pallets", days: 3, by: "jordan" }, "i2").rejected).toEqual([]);
    const invoices = Object.values(w.state.entities).filter((e) => e.kind === "invoice");
    expect(invoices.length).toBe(2);
    const before = w.state.accounts.bl_operating ?? 0;
    lapse(w, 6 * 1440);
    const freight = Object.values(w.state.entities).find((e) => e.kind === "invoice" && e.fields.memo === "Freight");
    const pallets = Object.values(w.state.entities).find((e) => e.kind === "invoice" && e.fields.memo === "Pallets");
    expect(freight?.fields).toMatchObject({ state: "paid", paid: 60_000 });
    expect((w.state.accounts.bl_operating ?? 0) - before).toBeGreaterThanOrEqual(60_000);
    expect(pallets?.fields).toMatchObject({ state: "late", fees: 1, late_fee: Math.round((5_000_000 * 1.5) / 100) });
    expect(trialBalance(w.state)).toBe(0);
  });
});
