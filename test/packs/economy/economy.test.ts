import { describe, expect, test } from "bun:test";
import { hashJson } from "../../../src/shared/hash";
import type { PostEvent } from "../../../src/shared/ledger";
import type { WorldDoc } from "../../../src/shared/world";
import { applyEffects } from "../../../src/engine/effects";
import { applyMarker } from "../../../src/engine/events";
import { materializeAll } from "../../../src/engine/materialize";
import { createRegistry, type Registry } from "../../../src/engine/registry-impl";
import { createRng } from "../../../src/engine/rng";
import type { WorldState } from "../../../src/engine/state";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { playerLines } from "../../../src/engine/player-events";
import { coarsen } from "../../../src/engine/simulate";
import { paramCandidates, resolveAction } from "../../../src/engine/resolve";
import { payMethodOf } from "../../../src/packs/economy/core/index";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { modernUsWorld } from "../riverton";
import { bandByLabel, priceOf } from "../../../src/packs/economy/core/model";
import type { ReadContext } from "../../../src/engine/registry";
import { fold, startState, trialBalance } from "../support";

const worthOf = (w: Working, who: string): number => w.ctx.query("economy.net_worth")(w.ctx, who) ?? 0;
const bandOf = (w: Working, who: string): string => w.ctx.query("wealth")(w.ctx, who);

/** The POV's money as the Money panel shows it. */
const moneyView = (ctx: ReadContext) => ctx.query("economy.finance")(ctx, ctx.world.pov, true);

const reg: Registry = createRegistry(ALL_PACKS);

function setup(patch: (w: WorldDoc) => void = () => undefined): { world: WorldDoc; w: Working; s0: WorldState } {
  const world = modernUsWorld("w", "Riverton");
  patch(world);
  const s0 = startState(world);
  const w = new Working(reg, world, s0);
  materializeAll(reg, w, world.pov, "run");
  return { world, w, s0 };
}

function lapse(w: Working, minutes: number, overrides = { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } as const) {
  const out = runTimelapse(reg, w, { type: "duration", minutes }, { runSeed: "run", overrides });
  if ("code" in out) throw new Error(out.reason);
  return out;
}

function posts(w: Working, memo: RegExp): PostEvent[] {
  return w.events.filter((e): e is PostEvent => e.type === "post" && memo.test(e.memo));
}

describe("economy: ledger and level contract", () => {
  test("materialization posts authored opening balances from the owner's external account", () => {
    const { w } = setup();
    expect(w.state.accounts.checking).toBe(214000);
    expect(w.state.accounts.card).toBe(-38000);
    expect(w.state.accounts["economy.external:you"]).toBe(-(8400 + 214000 + 650000 - 38000));
    expect(trialBalance(w.state)).toBe(0);
    // Net worth is the accounts and the pickup, at a midsize pickup's typical used price.
    expect(worthOf(w, "you")).toBe(8400 + 214000 + 650000 - 38000 + 3_000_000);
  });

  test("a card statement shows interest and a minimum payment; autopay pays the minimum on the due date", () => {
    const { w } = setup();
    lapse(w, 20 * 1440); // past Nov 3 (statement day 3)
    const st = w.events.find((e) => e.type === "economy.statement");
    expect(st && "data" in st ? st.data : null).toMatchObject({ account: "card", interest: 0, closing: 38000, minimum: 3500 }); // a first statement is in its grace period: the opening balance carries no interest yet
    const view = moneyView(reg.context(w.world, w.state));
    expect(view.accounts.find((a) => a.id === "card")?.due).toMatchObject({ label: expect.stringContaining("Minimum due"), cents: 3500 });
    lapse(w, 26 * 1440); // past the due date (Nov 28)
    expect(posts(w, /autopay/).some((p) => p.lines.some((l) => l.account === "card" && l.amount === 3500))).toBe(true);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("every party posts at its own level: L4 ↔ L1 transfers go through the external economy and move the L1 band", () => {
    const { world, w } = setup((wd) => {
      wd.entities.maya!.levels = { money: 1 };
    });
    expect(w.ctx.levelOf("maya", "money")).toBe(1);
    const give = applyEffects(reg, w, [{ type: "economy.transfer", args: { from: "you", to: "maya", cents: 300000, memo: "Gift" } }], { bindings: {}, rng: createRng("t") });
    expect(give.rejected).toEqual([]);
    expect(w.state.accounts["economy.external:maya"]).toBe(300000);
    expect(bandOf(w, "maya")).toBe("modest"); // poor (typical $450) + $3,000 crosses into modest
    const back = applyEffects(reg, w, [{ type: "economy.transfer", args: { from: "maya", to: "you", cents: 100000, memo: "Repay" } }], { bindings: {}, rng: createRng("u") });
    expect(back.rejected).toEqual([]);
    expect(trialBalance(w.state)).toBe(0);
    // an L1 party can't spend past its band's notional worth
    const tooMuch = applyEffects(reg, w, [{ type: "economy.transfer", args: { from: "maya", to: "you", cents: 50_000_000, memo: "Too much" } }], { bindings: {}, rng: createRng("v") });
    expect(tooMuch.rejected[0]?.rejection.code).toBe("declined");
    void world;
  });

  test("demote → spend → promote keeps the totals and restores nothing stale (L23)", () => {
    const { w } = setup();
    const worth = worthOf(w, "you");
    const materialized = structuredClone(w.state.materialized);
    applyMarker(w.state, { kind: "resolve", domain: "money", scope: { all: true }, to: 2 });
    const spent = applyEffects(reg, w, [{ type: "economy.buy", args: { payer: "you", item: "eggs_large", qty: 2 } }], { bindings: {}, rng: createRng("buy") });
    expect(spent.rejected).toEqual([]);
    const cost = worth - worthOf(w, "you");
    expect(cost).toBeGreaterThan(0);
    applyMarker(w.state, { kind: "resolve", domain: "money", scope: { all: true }, to: 1 });
    applyEffects(reg, w, [{ type: "economy.transfer", args: { from: "you", to: "jordan", cents: 2500, memo: "Coffee money" } }], { bindings: {}, rng: createRng("l1") });
    applyMarker(w.state, { kind: "resolve", domain: "money", scope: { all: true }, to: 4 });
    materializeAll(reg, w, "you", "run");
    expect(w.state.materialized).toEqual(materialized);
    expect(worthOf(w, "you")).toBe(worth - cost - 2500);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("promotion from a band changed at level 1 lands inside that band (L24)", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      const { w } = setup((wd) => {
        wd.realism.levels.money = 1;
      });
      // Jordan (comfortable, no accounts) spends down at level 1.
      const spend = applyEffects(reg, w, [{ type: "economy.transfer", args: { from: "jordan", to: "you", cents: 5_000_000, memo: "Big purchase" } }], { bindings: {}, rng: createRng("s") });
      expect(spend.rejected).toEqual([]);
      expect(bandOf(w, "jordan")).toBe("modest");
      applyMarker(w.state, { kind: "resolve", domain: "money", scope: { all: true }, to: 3 });
      const events = materializeAll(reg, w, "jordan", seed);
      expect(events.map((e) => e.domain)).toEqual(["gear", "money"]);
      const band = bandByLabel("modest");
      const worth = worthOf(w, "jordan");
      expect(worth).toBeGreaterThanOrEqual(band.min);
      expect(worth).toBeLessThan(band.max);
      expect(trialBalance(w.state)).toBe(0);
    }
  });

  test("a 30-day timelapse keeps the books balanced, and the Montage money equals the ledger", () => {
    // The player's job as a migrated world has it: the occupation's pay, from Brightline.
    const { w, s0 } = setup((wd) => void (wd.entities.job_you = { id: "job_you", kind: "job", name: "Office clerk", tier: "background", fields: { worker: "you", employer: "brightline", occupation: "office_clerk", status: "active" }, relations: [] }));
    const start = structuredClone(w.state);
    const out = lapse(w, 30 * 1440);
    expect(out.result.to - start.clock).toBe(30 * 1440);
    expect(trialBalance(w.state)).toBe(0);
    const delta = (id: string): number => (w.state.accounts[id] ?? 0) - (start.accounts[id] ?? 0);
    for (const m of out.montage.money) expect(m.in - m.out).toBe(delta(m.account));
    expect(posts(w, /^Payroll/).length).toBeGreaterThanOrEqual(2);
    // re-folding the whole run from the start state gives the same books
    expect(hashJson(fold(reg, w.world, s0, w.events).accounts)).toBe(hashJson(w.state.accounts));
  });
});

describe("economy: pricing and declines", () => {
  test("catalog prices scale by region and vary within the band, deterministically", () => {
    const { w } = setup();
    const ctx = reg.context(w.world, w.state);
    const base = priceOf(ctx, { catalog: "milk_whole" });
    expect(base?.unitCents).toBe(Math.round(410 * 0.93));
    const a = priceOf(ctx, { catalog: "milk_whole" }, createRng("p"));
    const b = priceOf(ctx, { catalog: "milk_whole" }, createRng("p"));
    expect(a).toEqual(b);
    for (const seed of ["1", "2", "3", "4", "5", "6"]) {
      const p = priceOf(ctx, { category: "electronics" }, createRng(seed));
      expect(p!.unitCents).toBeGreaterThanOrEqual(p!.band.min);
      expect(p!.unitCents).toBeLessThanOrEqual(p!.band.max);
    }
  });

  test("lenient worlds accept a narrated price inside the band and clamp one outside it", () => {
    const { w } = setup();
    const ctx = reg.context(w.world, w.state);
    const inside = priceOf(ctx, { catalog: "milk_whole", narrated: 500 });
    expect([inside?.unitCents, inside?.clamped]).toEqual([500, false]);
    const outside = priceOf(ctx, { catalog: "milk_whole", narrated: 5 });
    expect([outside?.unitCents, outside?.clamped]).toEqual([Math.round(300 * 0.93), true]);
  });

  test("a purchase beyond what's available is declined and posts nothing", () => {
    const { w } = setup();
    const before = structuredClone(w.state.accounts);
    const r = applyEffects(reg, w, [{ type: "economy.buy", args: { payer: "you", category: "lodging", qty: 400 } }], { bindings: {}, rng: createRng("d") });
    expect(r.rejected[0]?.rejection.code).toBe("declined");
    expect(w.state.accounts).toEqual(before);
  });

  test("a narrated purchase spawns the item and the card pays when cash is short", () => {
    const { w } = setup();
    const r = applyEffects(reg, w, [{ type: "economy.buy", args: { payer: "you", item: "earbuds_wireless", method: "card" } }], { bindings: {}, rng: createRng("h") });
    expect(r.rejected).toEqual([]);
    expect(w.state.accounts.card).toBeLessThan(-38000);
    expect(r.applied.some((e) => e.type === "spawn")).toBe(true);
  });

  test("a purchase naming a loan or brokerage account as its source is paid the usual way, at every money level", () => {
    for (const level of [1, 2, 4] as const) {
      const { w } = setup((wd) => {
        wd.entities.loan = { id: "loan", kind: "account", name: "Auto loan", tier: "background", fields: { owner: "you", type: "loan", institution: "Lakeshore CU", opening: -1740000 }, relations: [] };
        wd.entities.brokerage = { id: "brokerage", kind: "account", name: "Brokerage", tier: "background", fields: { owner: "you", type: "brokerage", institution: "Fidelity", opening: 500000 }, relations: [] };
      });
      applyMarker(w.state, { kind: "resolve", domain: "money", scope: { all: true }, to: level });
      for (const from of ["loan", "brokerage"]) {
        const before = structuredClone(w.state.accounts);
        const r = applyEffects(reg, w, [{ type: "economy.buy", args: { payer: "you", item: "earbuds_wireless", from } }], { bindings: {}, rng: createRng(`${level}${from}`) });
        expect(r.rejected).toEqual([]);
        expect([level, from, w.state.accounts.loan, w.state.accounts.brokerage]).toEqual([level, from, before.loan, before.brokerage]);
        expect(["cash", "checking", "card", "savings"].some((id) => w.state.accounts[id] !== before[id])).toBe(true);
      }
    }
  });

  test("Buy pays the way the player says: a credit card, a debit card from checking, cash", () => {
    const { w } = setup();
    const delta = (said: string | undefined): Record<string, number> => {
      const before = structuredClone(w.state.accounts);
      const r = resolveAction(reg, w, { action: "buy", params: { item: "earbuds_wireless", ...(said ? { method: said } : {}) } }, createRng(`buy:${said ?? ""}`));
      expect([r.ok, r.rejected]).toEqual([true, []]);
      return Object.fromEntries(["cash", "checking", "card"].map((a) => [a, (w.state.accounts[a] ?? 0) - (before[a] ?? 0)]));
    };
    const card = delta("with my credit card");
    expect([card.card < 0, card.cash, card.checking]).toEqual([true, 0, 0]);
    const debit = delta("my debit card");
    expect([debit.checking < 0, debit.cash, debit.card]).toEqual([true, 0, 0]);
    expect([payMethodOf("savings"), payMethodOf("in cash"), payMethodOf("Visa"), payMethodOf("whatever")]).toEqual(["savings", "cash", "credit", "auto"]);
  });

  test("a narrated purchase whose payer names an account, or a way of paying, is paid by the holder from it", () => {
    const { w } = setup();
    const purchase = reg.proposals.get("purchase");
    if (!purchase) throw new Error("no purchase channel");
    const delta = (payer: string): Record<string, number> => {
      const before = structuredClone(w.state.accounts);
      const p = { type: "purchase", payer, item: "earbuds_wireless" };
      expect(purchase.validate(p, w.ctx)).toBeNull();
      expect(applyEffects(reg, w, purchase.toEffects(p, w.ctx), { bindings: {}, rng: createRng(`p:${payer}`) }).rejected).toEqual([]);
      return Object.fromEntries(["cash", "checking", "card"].map((a) => [a, (w.state.accounts[a] ?? 0) - (before[a] ?? 0)]));
    };
    const checking = delta("checking");
    expect([checking.checking < 0, checking.cash, checking.card]).toEqual([true, 0, 0]);
    const card = delta("card");
    expect([card.card < 0, card.cash, card.checking]).toEqual([true, 0, 0]);
    const debit = delta("debit card");
    expect([debit.checking < 0, debit.cash, debit.card]).toEqual([true, 0, 0]);
    expect(purchase.validate({ type: "purchase", payer: "nobody_here", item: "earbuds_wireless" }, w.ctx)?.code).toBe("missing_entity");
  });

  test("a narrated purchase whose payer names a card the POV carries is paid that way; an unowned thing can't pay", () => {
    const { w } = setup();
    const purchase = reg.proposals.get("purchase");
    if (!purchase) throw new Error("no purchase channel");
    const thing = (id: string, name: string, owner: string | null): void => {
      w.state.entities[id] = { kind: "item", name, tier: "background", fields: owner ? { owner } : {}, relations: owner ? [{ type: "in", to: "wallet" }] : [], levels: {}, agent: false };
    };
    thing("pov_debit_card", "Debit card", "you");
    thing("pov_credit_card", "Credit card", "you");
    thing("rock", "A smooth rock", null);
    const delta = (payer: string): Record<string, number> => {
      const before = structuredClone(w.state.accounts);
      const p = { type: "purchase", payer, item: "earbuds_wireless" };
      expect(purchase.validate(p, w.ctx)).toBeNull();
      expect(applyEffects(reg, w, purchase.toEffects(p, w.ctx), { bindings: {}, rng: createRng(`p:${payer}`) }).rejected).toEqual([]);
      return Object.fromEntries(["cash", "checking", "card"].map((a) => [a, (w.state.accounts[a] ?? 0) - (before[a] ?? 0)]));
    };
    const debit = delta("pov_debit_card");
    expect([debit.checking < 0, debit.cash, debit.card]).toEqual([true, 0, 0]);
    const credit = delta("pov_credit_card");
    expect([credit.card < 0, credit.cash, credit.checking]).toEqual([true, 0, 0]);
    expect(purchase.validate({ type: "purchase", payer: "rock", item: "earbuds_wireless" }, w.ctx)?.code).toBe("bad_payer");
  });

  test("a narrated transfer takes its sum as cents (already minor units) or else as amount, in minor units", () => {
    const { w } = setup();
    const transfer = reg.proposals.get("transfer");
    if (!transfer) throw new Error("no transfer channel");
    const mine = (): number => ["cash", "checking", "card", "savings"].reduce((a, id) => a + (w.state.accounts[id] ?? 0), 0);
    const cases: [Record<string, string | number>, number][] = [
      [{ type: "transfer", from: "you", to: "rosa", amount: 2000 }, 2000],
      [{ type: "transfer", from: "you", to: "rosa", cents: 1500 }, 1500],
      [{ type: "transfer", from: "you", to: "rosa", amount: 2000, cents: 20 }, 20],
    ];
    for (const [p, sum] of cases) {
      const before = mine();
      expect(transfer.validate(p, w.ctx)).toBeNull();
      expect(applyEffects(reg, w, transfer.toEffects(p, w.ctx), { bindings: {}, rng: createRng("t") }).rejected).toEqual([]);
      expect(before - mine()).toBe(sum);
    }
    expect(transfer.validate({ type: "transfer", from: "you", to: "rosa", amount: 0 }, w.ctx)?.code).toBe("bad_amount");
  });

  test("Pay card offers only the POV's cards and loans, and refuses anything else", () => {
    const { world, w } = setup();
    const payCard = reg.actions.get("pay_card");
    const options = payCard ? paramCandidates(reg, world, w.state, payCard, "card") : [];
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((id) => ["card", "loan"].includes(String(w.state.entities[id]?.fields.type)))).toBe(true);
    expect(options).not.toContain("cash");
    const wrong = applyEffects(reg, w, [{ type: "economy.pay_card", args: { card: "cash", cents: 1000 } }], { bindings: {}, rng: createRng("p") });
    expect(wrong.rejected[0]?.rejection.code).toBe("not_a_liability");
  });
});
