// A payment the story made (DESIGN §9.5, §25.8, §25.10) on the Riverton fixture. When the engine
// chooses the account, cash and savings never go below zero: only a way that can run a debt takes a
// payment past what it covers, and with none a purchase is the payer's with nothing charged while a
// transfer moves nothing. The way the prose names takes the payment when it can run a debt, and Pay
// another way can move it back there. Pay another way puts the whole payment right, its overdraft
// fee and linked transfer included, and a fee alone past the limit doesn't read as nothing covering
// the payment. A rebased view never drops the payment for its overdraft link.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent, PostEvent } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import { applyEffects } from "../../src/engine/effects";
import { applyValidUnits, EXTERNAL_ACCOUNT_PREFIX } from "../../src/engine/events";
import { materializeAll } from "../../src/engine/materialize";
import { createRegistry } from "../../src/engine/registry-impl";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "./riverton";
import { startState } from "./support";

const reg = createRegistry(ALL_PACKS);
const SHOP = `${EXTERNAL_ACCOUNT_PREFIX}shop`;
const COMPASS: JsonObject = { type: "purchase", item: "brass compass", price: 16500 };

/** Riverton at Money 4 with `patch` made to its world, the POV's money opened. */
function setup(patch: (world: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("g", "R");
  patch(world);
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

/** The POV's accounts brought to these balances by GM corrections. */
function holding(w: Working, to: Partial<Record<"cash" | "checking" | "savings" | "card", number>>): void {
  const adjust = w.ctx.service("economy.adjust");
  for (const [account, cents] of Object.entries(to)) {
    const events = adjust(w.ctx, account, cents - (w.state.accounts[account] ?? 0));
    if (!Array.isArray(events)) throw new Error(events.reason);
    for (const e of events) expect(w.apply(e)).toBeNull();
  }
}

/** Accounts no payment can come from. */
const frozen =
  (...ids: string[]) =>
  (world: WorldDoc): void => {
    for (const id of ids) world.entities[id]!.fields.status = "frozen";
  };

/** Checking's overdraft policy. */
const overdraft =
  (fields: JsonObject) =>
  (world: WorldDoc): void => {
    Object.assign(world.entities.checking!.fields, fields);
  };

/** A narrated change applied through its channel, as a reply's read applies it. */
function narrated(w: Working, p: JsonObject) {
  return applyEffects(reg, w, reg.proposals.get(String(p.type))?.toEffects(p, w.ctx) ?? [], { bindings: {}, rng: createRng("c") });
}

/** What the compass drew from `account`. */
function drawn(events: readonly LedgerEvent[], account: string): number {
  const post = events.find((e): e is PostEvent => e.type === "post" && e.memo === "Bought brass compass");
  return -(post?.lines.find((l) => l.account === account)?.amount ?? 0);
}

function otherWay(w: Working, events: readonly LedgerEvent[]): { from: string; repay: LedgerEvent[] } {
  const way = w.ctx.service("economy.other_way")(w.ctx, events);
  if ("code" in way) throw new Error(way.reason);
  return way;
}

const owned = (w: Working): boolean => Object.values(w.state.entities).some((e) => e.name === "brass compass" && e.fields.owner === "you");

describe("a payment the story made never takes cash or savings below zero", () => {
  test("a move between the payer's own accounts that savings can't cover comes from a way that can run a debt, and savings stays as it was", () => {
    const w = setup();
    holding(w, { savings: 10000 });
    const was = { ...w.state.accounts };
    const moved = narrated(w, { type: "transfer", from: "savings", to: "checking", cents: 50000 });
    expect(moved.rejected).toEqual([]);
    expect(w.state.accounts.savings).toBe(10000);
    expect(w.state.accounts.checking).toBe((was.checking ?? 0) + 50000);
    // The Visa card paid it, as a cash advance with its fee.
    expect((was.card ?? 0) - (w.state.accounts.card ?? 0)).toBeGreaterThan(50000);
  });

  test("a payment to someone with nothing that covers it or can run a debt moves nothing, and says why for the player", () => {
    const w = setup(frozen("checking", "card"));
    holding(w, { cash: 1000, savings: 10000 });
    const paid = narrated(w, { type: "transfer", from: "you", to: "maya", cents: 50000 });
    expect(paid.rejected.map((r) => r.rejection)).toEqual([{ code: "no_way_to_pay", reason: "Alex Rivera has nothing that covers $500.00 or can run a debt, so nothing was paid" }]);
    expect([w.state.accounts.cash, w.state.accounts.savings]).toEqual([1000, 10000]);
  });

  test("with no way that can run a debt, a savings account that covers it pays", () => {
    const w = setup(frozen("checking", "card"));
    holding(w, { cash: 1000, savings: 60000 });
    const paid = narrated(w, { type: "transfer", from: "you", to: "maya", cents: 50000 });
    expect(paid.rejected).toEqual([]);
    expect([w.state.accounts.cash, w.state.accounts.savings]).toEqual([1000, 10000]);
  });

  test("a purchase with nothing that covers it or can run a debt is the payer's with nothing charged, and says what it would have cost", () => {
    const priced = setup();
    holding(priced, { cash: 1000, checking: 2000, card: -397000 });
    const cost = drawn(narrated(priced, COMPASS).applied, "card");
    expect(cost).toBeGreaterThan(16500);
    const w = setup(frozen("checking", "card"));
    holding(w, { cash: 1000, savings: 10000 });
    const bought = narrated(w, COMPASS);
    expect(bought.rejected).toEqual([]);
    expect(bought.applied.filter((e) => e.type === "post")).toEqual([]);
    expect([w.state.accounts.cash, w.state.accounts.savings]).toEqual([1000, 10000]);
    expect(owned(w)).toBe(true);
    expect(w.ctx.query("economy.paid_from")(w.ctx, bought.applied, "you")).toEqual({ unpaid: cost });
  });

  test("at Money 1 a payment the story made still overdraws, as that level always has", () => {
    const w = setup();
    holding(w, { savings: 10000 });
    w.state.realism.levels.money = 1;
    expect(narrated(w, { type: "transfer", from: "savings", to: "checking", cents: 50000 }).rejected).toEqual([]);
    expect(w.state.accounts.savings).toBe(-40000);
  });
});

describe("the way the story names", () => {
  test("a purchase paid with the debit card goes on checking, past what it holds, though the wallet covers it", () => {
    const w = setup();
    holding(w, { cash: 50000, checking: 2000, card: -397000 });
    const bought = narrated(w, { ...COMPASS, method: "debit card" });
    const total = drawn(bought.applied, "checking");
    expect(total).toBeGreaterThan(16500);
    expect([w.state.accounts.cash, w.state.accounts.checking, w.state.accounts.card]).toEqual([50000, 2000 - total, -397000]);
    expect(w.ctx.query("economy.paid_from")(w.ctx, bought.applied, "you")).toMatchObject({ name: "Checking", over: total - 2000 });
  });

  test("Pay another way moves a payment to the way the story named once that way covers it", () => {
    const w = setup();
    holding(w, { cash: 1000, checking: 2000, card: -397000 });
    const bought = narrated(w, { ...COMPASS, method: "cash" });
    // The wallet didn't cover it, so the card ran past its limit.
    const total = drawn(bought.applied, "card");
    expect(total).toBeGreaterThan(16500);
    holding(w, { cash: 50000 });
    const way = otherWay(w, bought.applied);
    expect(way.from).toBe("cash");
    for (const e of way.repay) expect(w.apply(e)).toBeNull();
    expect([w.state.accounts.cash, w.state.accounts.card]).toEqual([50000 - total, -397000]);
  });
});

describe("Pay another way puts the whole payment right", () => {
  test("the overdraft fee the payment brought goes back with it", () => {
    const w = setup((world) => {
      frozen("card")(world);
      overdraft({ overdraft: "fee", overdraft_limit: 10000 })(world);
    });
    holding(w, { cash: 1000, checking: 2000 });
    const savings = w.state.accounts.savings ?? 0;
    const bought = narrated(w, COMPASS);
    const total = drawn(bought.applied, "checking");
    const fee = -(bought.applied.find((e): e is PostEvent => e.type === "post" && e.memo === "Overdraft fee")?.lines.find((l) => l.account === "checking")?.amount ?? 0);
    expect(fee).toBeGreaterThan(0);
    expect(w.state.accounts.checking).toBe(2000 - total - fee);
    const way = otherWay(w, bought.applied);
    expect(way.from).toBe("savings");
    for (const e of way.repay) expect(w.apply(e)).toBeNull();
    expect([w.state.accounts.checking, w.state.accounts.savings]).toEqual([2000, savings - total]);
  });

  test("the transfer the overdraft link made goes back to the link", () => {
    const w = setup(overdraft({ overdraft: "linked", overdraft_link: "savings" }));
    holding(w, { cash: 1000, checking: 2000, savings: 5000, card: -100000 });
    const bought = narrated(w, { ...COMPASS, method: "debit card" });
    const total = drawn(bought.applied, "checking");
    expect([w.state.accounts.checking, w.state.accounts.savings]).toEqual([7000 - total, 0]);
    const way = otherWay(w, bought.applied);
    expect(way.from).toBe("card");
    for (const e of way.repay) expect(w.apply(e)).toBeNull();
    expect([w.state.accounts.checking, w.state.accounts.savings, w.state.accounts.card]).toEqual([2000, 5000, -100000 - total]);
  });

  test("when only the overdraft fee goes past the limit, the payment itself was covered", () => {
    const probe = setup();
    const total = drawn(narrated(probe, { ...COMPASS, method: "debit card" }).applied, "checking");
    const w = setup(overdraft({ overdraft: "fee", overdraft_limit: 10000 }));
    // $10.00 of the overdraft left after the compass: its fee takes checking past the limit.
    holding(w, { checking: total - 10000 + 1000 });
    const bought = narrated(w, { ...COMPASS, method: "debit card" });
    expect(drawn(bought.applied, "checking")).toBe(total);
    expect(w.state.accounts.checking).toBeLessThan(-10000);
    expect(w.ctx.query("economy.paid_from")(w.ctx, bought.applied, "you")).toMatchObject({ name: "Checking", over: 0, total });
  });
});

describe("a rebased view", () => {
  test("where the link can't spare its overdraft transfer any more, only the transfer drops: checking carries the whole overdraft, the compass stays, savings never goes below zero", () => {
    const w = setup((world) => {
      frozen("card")(world);
      overdraft({ overdraft: "linked", overdraft_link: "savings" })(world);
    });
    holding(w, { cash: 1000, checking: 2000, savings: 5000 });
    const before = structuredClone(w.state);
    const bought = narrated(w, COMPASS);
    expect(bought.rejected).toEqual([]);
    const total = drawn(bought.applied, "checking");
    // On its own path the link's $50.00 moves first, and checking takes the rest.
    expect([w.state.accounts.checking, w.state.accounts.savings]).toEqual([7000 - total, 0]);
    const transfer = bought.applied.filter((e) => e.type === "post" && e.memo.startsWith("Overdraft transfer"));
    expect(transfer).toHaveLength(1);
    const apart = bought.applied.filter((e) => e.group === transfer[0]?.group);
    // The transfer and its history line are a unit of their own; the payment, its line and the compass another.
    expect(apart).toHaveLength(2);
    expect(new Set(bought.applied.filter((e) => !apart.includes(e)).map((e) => e.group)).size).toBe(1);
    // The other branch: most of savings was spent before the reply.
    const branch = new Working(reg, w.world, before);
    expect(branch.apply({ type: "post", lines: [{ account: "savings", amount: -4000 }, { account: SHOP, amount: 4000 }], memo: "Spent elsewhere" })).toBeNull();
    const applied = applyValidUnits(reg, bought.applied, branch.state, (s) => reg.context(branch.world, s));
    expect(applied).toEqual(bought.applied.filter((e) => !apart.includes(e)));
    expect([branch.state.accounts.checking, branch.state.accounts.savings]).toEqual([2000 - total, 1000]);
    expect(owned(branch)).toBe(true);
  });
});
