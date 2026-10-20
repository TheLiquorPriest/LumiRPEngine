// The money foundation's acceptance (DESIGN §25), folded: one statement cycle that charges interest
// only on carried balances and escalates a missed payment; loans that finish at their term; flows
// and their shortfall policies; owners and roles; payment preferences; cash machines at the top
// level; overdraft policies; and older worlds migrated to the foundation's shapes.

import { describe, expect, test } from "bun:test";
import type { JournalLine } from "../../../src/shared/finance";
import type { JsonObject } from "../../../src/shared/json";
import type { LedgerEvent, PostEvent } from "../../../src/shared/ledger";
import type { EntityDef, WorldDoc } from "../../../src/shared/world";
import { lintWorld } from "../../../src/engine/authoring";
import { materializeAll } from "../../../src/engine/materialize";
import { migrateMoney } from "../../../src/engine/money-migrate";
import { createRegistry, type Registry } from "../../../src/engine/registry-impl";
import { resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { optionalService } from "../../../src/engine/pack-kit";
import { placeOfEntity } from "../../../src/engine/scope";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { withdraw } from "../../../src/packs/economy/core/actions";
import type { FinanceHooks } from "../../../src/packs/economy/core/module";
import { charge, isRejection } from "../../../src/packs/economy/core/pay";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { modernUsWorld } from "../riverton";
import { startState, trialBalance } from "../support";

const reg: Registry = createRegistry(ALL_PACKS);
const DAY = 1440;
const NO_MODULES: FinanceHooks = { fields: {}, flows: [], amounts: {}, worth: [], sales: [], views: [], summaries: [] };

function entity(id: string, kind: string, fields: JsonObject): EntityDef {
  return { id, kind, name: id.replace(/_/g, " "), tier: "background", fields, relations: [] };
}

function setup(patch: (w: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("w", "Riverton");
  patch(world);
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

function lapse(w: Working, days: number): void {
  const out = runTimelapse(reg, w, { type: "duration", minutes: days * DAY }, { runSeed: "run", overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } });
  if ("code" in out) throw new Error(out.reason);
}

/** One of the POV's accounts as the Money view shows it. */
function accountView(w: Working, id = ""): { cents: number; available: number | null } | undefined {
  return w.ctx.query("economy.finance")(w.ctx, "you", true).accounts.find((a) => a.id === id);
}

/** The lines of one of the POV's accounts as the Money view shows them, newest first. */
function accountLines(w: Working, id: string): JournalLine[] {
  return w.ctx.query("economy.finance")(w.ctx, "you", true).accounts.find((a) => a.id === id)?.transactions ?? [];
}

function dataOf(w: Working, type: string): JsonObject[] {
  return w.events.flatMap((e) => (e.type === type && "data" in e ? [e.data] : []));
}

describe("money foundation: one statement cycle", () => {
  test("a card paid in full every month is never charged interest", () => {
    const w = setup((world) => Object.assign(world.entities.card!.fields, { autopay: "statement", autopay_from: "checking" }));
    lapse(w, 25); // past the first statement (the 3rd)
    expect(w.apply({ type: "post", lines: [{ account: "card", amount: -20000 }, { account: "economy.external:bike_shop", amount: 20000 }], memo: "Bought a bike" })).toBeNull();
    lapse(w, 65);
    const statements = dataOf(w, "economy.statement").filter((s) => s.account === "card");
    expect(statements.length).toBeGreaterThanOrEqual(2);
    expect(statements.map((s) => s.interest)).toEqual(statements.map(() => 0));
    expect(w.state.accounts.card).toBe(0);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("a missed payment brings a late fee, then the penalty APR and delinquency, and the score drops", () => {
    const w = setup((world) => {
      const card = world.entities.card!.fields;
      card.autopay = "none";
      delete card.autopay_from;
    });
    lapse(w, 130);
    const fees = w.events.filter((e) => e.type === "economy.txn" && "data" in e && e.data.kind === "fee" && JSON.stringify(e.data.lines).includes('"card"'));
    expect(fees.length).toBeGreaterThan(0);
    const stages = dataOf(w, "economy.delinquency").filter((d) => d.account === "card");
    expect(stages.map((d) => d.stage)).toContain("30");
    expect(stages.some((d) => d.penalty === true)).toBe(true);
    const scores = dataOf(w, "economy.score")
      .filter((d) => d.person === "you")
      .map((d) => Number(d.score));
    expect(scores.length).toBeGreaterThanOrEqual(2);
    expect(scores[scores.length - 1]).toBeLessThan(scores[0] ?? 0);
  });

  test("a loan pays on its due day and finishes at its term", () => {
    const w = setup((world) => {
      world.entities.loan = entity("loan", "account", { owners: [{ party: "you", role: "owner" }], product: "loan", institution: "Riverton Savings", opening: -90000, apr_pct: 6, term_months: 3, months_left: 3, due_day: 5, autopay: "minimum", autopay_from: "checking" });
    });
    lapse(w, 120);
    expect(w.state.accounts.loan).toBe(0);
    const payments = w.events.filter((e): e is PostEvent => e.type === "post" && e.lines.some((l) => l.account === "loan" && l.amount > 0));
    expect(payments).toHaveLength(3);
  });

  test("a bank's interest names the bank on the account's lines: by its name, or as a bank where it has none", () => {
    const w = setup();
    lapse(w, 40);
    const banks = (account: string): (string | null)[] => [...new Set(accountLines(w, account).filter((t) => t.kind === "interest").map((t) => t.counterparty))];
    expect(banks("checking")).toEqual(["Riverton Credit Union"]);
    expect(banks("savings")).toEqual(["Bank"]);
  });
});

describe("money foundation: flows, owners and payment", () => {
  test("a standing transfer the account can't cover follows its shortfall policy", () => {
    const flow = (shortfall: string): EntityDef => entity("to_savings", "flow", { flow_kind: "transfer", from: "checking", to: "savings", amount_cents: 500000, every: "month", days: [1], shortfall, status: "active" });
    const runs = (shortfall: string): JsonObject[] => {
      const w = setup((world) => {
        world.entities.to_savings = flow(shortfall);
      });
      lapse(w, 25);
      return dataOf(w, "economy.flow_run").filter((d) => d.flow === "to_savings");
    };
    const skipped = runs("skip");
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped[0]?.cents).toBe(0);
    const partial = runs("partial");
    expect(Number(partial[0]?.cents)).toBeGreaterThan(0);
    expect(Number(partial[0]?.cents)).toBeLessThan(500000);
  });

  test("a joint account is spendable by both owners; a custodial account counts toward its beneficiary", () => {
    const joint = (world: WorldDoc): void => {
      world.entities.joint = entity("joint", "account", { owners: [{ party: "you", role: "joint" }, { party: "maya", role: "joint" }], product: "checking", opening: 120000 });
    };
    const w = setup((world) => {
      joint(world);
      world.entities.custodial = entity("custodial", "account", { owners: [{ party: "you", role: "custodian" }, { party: "jordan", role: "beneficiary" }], product: "savings", opening: 50000 });
    });
    // The custodial savings are Jordan's worth, not their custodian's.
    const worth = (x: Working, who: string): number | null => x.ctx.query("economy.net_worth")(x.ctx, who);
    expect(worth(w, "jordan")).toBe(50000);
    expect(worth(w, "you")).toBe(worth(setup(joint), "you"));
    // Either owner's payment comes out of the joint account.
    for (const who of ["you", "maya"]) {
      const before = w.state.accounts.joint ?? 0;
      const paid = charge(NO_MODULES, w.ctx, who, 1000, "Groceries", { source: "joint", counterparty: "market" });
      if (isRejection(paid)) throw new Error(paid.reason);
      expect(w.applyAll(paid).length).toBe(paid.length);
      expect(w.state.accounts.joint).toBe(before - 1000);
    }
  });

  test("payment preferences pick the instrument: cash for small amounts, the credit card above them", () => {
    const w = setup((world) => {
      world.entities.you!.fields.pay_prefs = [{ use: "cash", max: 2000 }, { use: "credit" }];
    });
    // Cash takes a till: an in-person sale where the payer is.
    const sale = { place: placeOfEntity(w.state, "you"), item: "coffee" };
    const buy = (cents: number, memo: string): void => {
      const paid = charge(NO_MODULES, w.ctx, "you", cents, memo, { method: "auto", kind: "purchase", sale });
      if (isRejection(paid)) throw new Error(paid.reason);
      expect(w.applyAll(paid).length).toBe(paid.length);
    };
    const [cash, card] = [w.state.accounts.cash ?? 0, w.state.accounts.card ?? 0];
    buy(1500, "Bought a coffee");
    expect([w.state.accounts.cash, w.state.accounts.card]).toEqual([cash - 1500, card]);
    buy(5000, "Bought a lamp");
    expect([w.state.accounts.cash, w.state.accounts.card]).toEqual([cash - 1500, card - 5000]);
  });

  test("at the top level cash comes from a machine, with its limit and fees; below it, money moves freely", () => {
    const debit = entity("debit", "card", { account: "checking", holder: "you", network: "debit", state: "active" });
    // The world places a machine, but not here: no cash.
    const none = setup((world) => {
      world.entities.debit = debit;
      world.places.bank_lobby = { id: "bank_lobby", name: "Bank lobby", fields: { atm: { bank: "Lakeside Bank", fee: 300, limit: 20000 } } };
    });
    expect(withdraw(none.ctx, "you", "checking", 5000)).toMatchObject({ code: "no_atm" });
    // A world that places no machine or branch at all leaves banking offstage: cash moves freely even at the top level.
    const offstage = setup((world) => {
      world.entities.debit = debit;
    });
    const loose = withdraw(offstage.ctx, "you", "checking", 5000);
    if ("code" in loose) throw new Error(loose.reason);
    const had = offstage.state.accounts.checking ?? 0;
    offstage.applyAll(loose);
    expect(had - (offstage.state.accounts.checking ?? 0)).toBe(5000);
    const atm = setup((world) => {
      world.entities.debit = debit;
      const place = world.places[String(world.entities.you!.fields.place ?? world.start.place)]!;
      place.fields = { ...place.fields, atm: { bank: "Lakeside Bank", fee: 300, limit: 20000 } };
    });
    expect(withdraw(atm.ctx, "you", "checking", 30000)).toMatchObject({ code: "over_limit" });
    const out = withdraw(atm.ctx, "you", "checking", 5000);
    if ("code" in out) throw new Error(out.reason);
    const before = atm.state.accounts.checking ?? 0;
    atm.applyAll(out);
    expect(before - (atm.state.accounts.checking ?? 0)).toBe(5000 + 300 + 473);
    const below = setup((world) => {
      world.entities.you!.levels = { money: 3 };
    });
    const free = withdraw(below.ctx, "you", "checking", 5000);
    if ("code" in free) throw new Error(free.reason);
    const was = below.state.accounts.checking ?? 0;
    below.applyAll(free);
    expect(was - (below.state.accounts.checking ?? 0)).toBe(5000);
  });

  test("an overdraft follows the account's policy: declined, or paid with its fee up to the limit", () => {
    const declined = setup((world) => Object.assign(world.entities.checking!.fields, { overdraft: "decline" }));
    expect(charge(NO_MODULES, declined.ctx, "you", 250000, "Bought a laptop", { method: "auto", source: "checking" })).toMatchObject({ code: expect.any(String) });
    const paid = setup((world) => Object.assign(world.entities.checking!.fields, { overdraft: "fee", overdraft_limit: 100000 }));
    const out = charge(NO_MODULES, paid.ctx, "you", 250000, "Bought a laptop", { method: "auto", source: "checking" });
    if ("code" in out) throw new Error(out.reason);
    paid.applyAll(out);
    expect(paid.state.accounts.checking).toBe(214000 - 250000 - 2700);
    expect(trialBalance(paid.state)).toBe(0);
  });
});

describe("money foundation: authoring and settings", () => {
  test("a flow or a job naming an id that isn't in the world is a lint warning; an outside payee's name isn't", () => {
    const world = modernUsWorld("w", "Riverton");
    world.entities.power = entity("power", "flow", { flow_kind: "bill", from: "acct_pov_chequing", to: "Lakeshore Electric", amount_cents: 5000, every: "month", days: [1], shortfall: "skip", status: "active" });
    world.entities.clerk = entity("clerk", "job", { worker: "you", employer: "brightline_co", occupation: "office_clerk", status: "active" });
    const issues = lintWorld(world, reg).filter((i) => i.code === "economy.accounts");
    expect(issues.filter((i) => i.path === "entities.power.fields.from")).toEqual([expect.objectContaining({ severity: "warning", message: expect.stringContaining('"acct_pov_chequing" names no entity') })]);
    expect(issues.filter((i) => i.path === "entities.power.fields.to")).toEqual([]);
    expect(issues.filter((i) => i.path === "entities.clerk.fields.employer")).toEqual([expect.objectContaining({ severity: "warning" })]);
  });

  test("payment preferences set by the action arrive as JSON text and are kept as tiers", () => {
    const w = setup();
    const r = resolveAction(reg, w, { action: "set_pay_prefs", params: { tiers: JSON.stringify([{ use: "cash", max: 2000 }, { use: "credit" }]) } }, createRng("prefs"));
    expect([r.ok, r.rejected]).toEqual([true, []]);
    expect(w.state.entities.you?.fields.pay_prefs).toEqual([{ use: "cash", max: 2000 }, { use: "credit" }]);
  });

  test("a one-off flow ends once it has run", () => {
    const w = setup((world) => {
      world.entities.gift = entity("gift", "flow", { flow_kind: "transfer", from: "checking", to: "savings", amount_cents: 1000, once: "2026-10-25T09:00", shortfall: "skip", status: "active" });
    });
    lapse(w, 15);
    expect(dataOf(w, "economy.flow_run").filter((d) => d.flow === "gift")).toHaveLength(1);
    expect(w.ctx.query("economy.finance")(w.ctx, "you", true).flows.find((f) => f.id === "gift")?.status).toBe("ended");
  });
});

describe("money foundation: accounts before they open", () => {
  test("an unopened account shows its opening as available, and a GM correction on it opens it first", () => {
    const world = modernUsWorld("w", "Riverton");
    const w = new Working(reg, world, startState(world));
    const view = (id: string): ReturnType<typeof accountView> => accountView(w, id);
    expect(view("checking")).toMatchObject({ cents: 214000, available: 214000 });
    expect(view("card")?.available).toBe(400000 - 38000);
    const adjust = optionalService(w.ctx, "economy.adjust");
    const out = adjust?.(w.ctx, "checking", -100000);
    if (!out || "code" in out) throw new Error(out?.reason ?? "no adjust service");
    w.applyAll(out);
    expect(w.state.accounts.checking).toBe(114000);
    expect(trialBalance(w.state)).toBe(0);
  });
});

describe("money foundation: older worlds", () => {
  test("an old account, its owner's bills and pay migrate to owners, a product, flows and a job", () => {
    const world = modernUsWorld("w", "Riverton");
    const card = world.entities.card!.fields;
    delete card.owners;
    delete card.product;
    Object.assign(card, { owner: "you", type: "card", autopay: "minimum from checking" });
    Object.assign(world.entities.you!.fields, { occupation: "auto_mechanic", employer: "garage", hourly_cents: 2350, hours_per_week: 40, pay_frequency: "weekly", payday: "Friday", deposit_to: "checking", bills: [{ label: "Rent", payee: "Landlord", amountCents: 99500, every: "month", day: 1, from: "checking" }] });
    const out = migrateMoney(world);
    expect(out.entities.card!.fields).toMatchObject({ owners: [{ party: "you", role: "owner" }], product: "credit_card", autopay: "minimum", autopay_from: "checking" });
    expect(out.entities.card!.fields.owner).toBeUndefined();
    const flows = Object.values(out.entities).filter((e) => e.kind === "flow");
    expect(flows.map((f) => f.fields)).toContainEqual(expect.objectContaining({ from: "checking", to: "Landlord", amount_cents: 99500, every: "month", days: [1] }));
    const job = Object.values(out.entities).find((e) => e.kind === "job" && e.fields.worker === "you");
    expect(job?.fields).toMatchObject({ employer: "garage", basis: "hourly", rate: 2350, pay_every: "weekly", pay_weekday: 5, splits: [{ to: "checking", pct: 100 }] });
    expect(out.entities.you!.fields.bills).toBeUndefined();
    expect(out.entities.you!.fields.hourly_cents).toBeUndefined();
    expect(migrateMoney(out)).toBe(out);
  });

  test("an old brokerage's units become a holding of its symbol, and the symbol an asset", () => {
    const world = modernUsWorld("w", "Riverton");
    world.entities.fund = entity("fund", "account", { owner: "you", type: "brokerage", symbol: "broad_us_equity_index", units: 31.25, opening: 0 });
    const out = migrateMoney(world);
    expect(out.entities.fund?.fields.units).toBeUndefined();
    expect(out.entities["fund:broad_us_equity_index"]).toMatchObject({ kind: "holding", fields: { account: "fund", asset: "broad_us_equity_index", lots: [{ qty: 31.25, cost: 312500 }] } });
    expect(out.packs.economy?.config.assets).toMatchObject({ broad_us_equity_index: { class: "fund", price: 10000, model: "broad_us_equity_index" } });
    expect(migrateMoney(out)).toBe(out);
  });

  test("the starters are built migrated: owners lists and products, no bills or payroll fields, nothing left to migrate", () => {
    for (const [id, make] of Object.entries(STARTER_WORLDS)) {
      const world = (make as (id: string, name: string) => WorldDoc)("s", id);
      for (const e of Object.values(world.entities)) {
        if (e.kind === "account") {
          expect(e.fields.owner).toBeUndefined();
          expect(e.fields.type).toBeUndefined();
          expect(Array.isArray(e.fields.owners)).toBe(true);
        }
        expect(e.fields.bills).toBeUndefined();
        expect(e.fields.hourly_cents).toBeUndefined();
      }
      expect(migrateMoney(world)).toBe(world);
    }
  });

  test("a chat's older journal events, which named only who was paid, still read: money in names whoever in the world paid it, and no line names its own holder", () => {
    const w = setup((world) => void (world.entities.maya_checking = entity("maya_checking", "account", { owners: [{ party: "maya", role: "owner" }], product: "checking", opening: 0 })));
    // As an older build recorded them: the player paying Maya back, and a shop's refund that named the player, the side paid, on its one line in the world.
    const older = (memo: string, lines: PostEvent["lines"], counterparty: string): LedgerEvent[] => [
      { type: "post", lines, memo },
      { type: "economy.txn", data: { memo, kind: "payment", counterparty, lines: lines.filter((l) => !l.account.startsWith("economy.external:")).map((l) => ({ account: l.account, amount: l.amount })) } },
    ];
    const events = [...older("Dinner, her half", [{ account: "checking", amount: -4_000 }, { account: "maya_checking", amount: 4_000 }], "maya"), ...older("Refund", [{ account: "economy.external:market", amount: -1_500 }, { account: "checking", amount: 1_500 }], "you")];
    for (const e of events) expect(w.apply(e)).toBeNull();
    const lines = (party: string, account: string): (string | null)[][] | undefined => w.ctx.query("economy.finance")(w.ctx, party, false).accounts.find((a) => a.id === account)?.transactions.filter((t) => t.kind === "payment").map((t) => [t.memo, t.counterparty]);
    expect(lines("you", "checking")).toEqual([["Refund", null], ["Dinner, her half", "Maya Chen"]]);
    expect(lines("maya", "maya_checking")).toEqual([["Dinner, her half", w.state.entities.you?.name ?? "you"]]);
  });
});
