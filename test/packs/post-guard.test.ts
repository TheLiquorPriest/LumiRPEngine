// Ledger 1.10: postings re-validate against the state they fold on. From Money 2 a payment can't
// take cash, checking or savings below zero or a card past its limit (the `post` guard), and a
// payment is one atomic unit with its history line and what it bought, so a rebased view that
// can't afford it drops all of them instead of folding the wallet negative. A payment the story
// made (`overdraw`, DESIGN §9.5) is the one that folds past what its account covers.
import { describe, expect, test } from "bun:test";
import type { LedgerEvent, PostingLine } from "../../src/shared/ledger";
import { applyEffects } from "../../src/engine/effects";
import { applyValidUnits, EXTERNAL_ACCOUNT_PREFIX } from "../../src/engine/events";
import { materializeAll } from "../../src/engine/materialize";
import { createRegistry } from "../../src/engine/registry-impl";
import { resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import type { WorldState } from "../../src/engine/state";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import type { ReadContext } from "../../src/engine/registry";
import { modernUsWorld } from "./riverton";
import { startState } from "./support";

/** The POV's money as the Money panel shows it. */
const moneyView = (ctx: ReadContext) => ctx.query("economy.finance")(ctx, ctx.world.pov, true);

const reg = createRegistry(ALL_PACKS);
const shop = `${EXTERNAL_ACCOUNT_PREFIX}shop`;

function setup(): Working {
  const world = modernUsWorld("g", "R");
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

/** The `post` event's validation, own check plus guards, as every fold runs it. */
function check(w: Working, account: string, cents: number, to = shop): string | null {
  const lines: PostingLine[] = [
    { account, amount: -cents },
    { account: to, amount: cents },
  ];
  return reg.get("post")?.validate({ type: "post", lines, memo: "Payment" }, w.ctx)?.code ?? null;
}

describe("posting guard and payment units (ledger 1.10)", () => {
  test("a payment the account can't cover is refused at fold time, at Money 2 and up", () => {
    const w = setup();
    const cash = w.state.accounts.cash ?? 0;
    expect(cash).toBeGreaterThan(0);
    expect(check(w, "cash", cash)).toBeNull();
    expect(check(w, "cash", cash + 8400)).toBe("declined");
    expect(check(w, "checking", (w.state.accounts.checking ?? 0) + 1)).toBe("declined");
    w.state.realism.levels.money = 1;
    expect(check(w, "cash", cash + 8400)).toBeNull();
  });

  test("a card charge past the limit is refused; the bank's own interest is not", () => {
    const w = setup();
    const room = Number(w.state.entities.card?.fields.limit ?? 0) + (w.state.accounts.card ?? 0);
    expect(room).toBeGreaterThan(0);
    expect(check(w, "card", room)).toBeNull();
    expect(check(w, "card", room + 1)).toBe("declined");
    expect(check(w, "card", room + 5000, `${EXTERNAL_ACCOUNT_PREFIX}bank:card`)).toBeNull();
  });

  test("on a branch that can't afford it, a cash purchase folds out whole: no negative wallet, no history line, no item", () => {
    const w = setup();
    const before: WorldState = structuredClone(w.state);
    const bought = resolveAction(reg, w, { action: "buy", params: { item: "milk_whole", method: "cash" } }, createRng("b"));
    expect(bought.rejected).toEqual([]);
    const events: LedgerEvent[] = bought.events;
    expect(new Set(events.filter((e) => e.type !== "clock").map((e) => e.group)).size).toBe(1);
    // The other branch: the wallet holds $1.
    const branch = new Working(reg, w.world, before);
    const cash = branch.state.accounts.cash ?? 0;
    branch.apply({ type: "post", lines: [{ account: "cash", amount: -(cash - 100) }, { account: shop, amount: cash - 100 }], memo: "Spent elsewhere" });
    const history = moneyView(branch.ctx).recent.length;
    const items = Object.keys(branch.state.entities).length;
    const applied = applyValidUnits(reg, events, branch.state, (s) => reg.context(branch.world, s));
    expect(applied.filter((e) => e.type !== "clock")).toEqual([]);
    expect(branch.state.accounts.cash).toBe(100);
    expect(moneyView(branch.ctx).recent.length).toBe(history);
    expect(Object.keys(branch.state.entities).length).toBe(items);
  });

  test("a payment the story made (`overdraw`) folds past what its account covers; the same posting without it doesn't", () => {
    const w = setup();
    const lines: PostingLine[] = [
      { account: "checking", amount: -((w.state.accounts.checking ?? 0) + 5000) },
      { account: shop, amount: (w.state.accounts.checking ?? 0) + 5000 },
    ];
    expect(reg.get("post")?.validate({ type: "post", lines, memo: "Payment" }, w.ctx)?.code).toBe("declined");
    expect(reg.get("post")?.validate({ type: "post", lines, memo: "Payment", overdraw: true }, w.ctx)).toBeNull();
  });

  test("a narrated purchase nothing covers goes on the payer's last way that can run a debt, and Pay another way moves it to savings", () => {
    const w = setup();
    // $10 in cash, $20 in checking and $30 left on the Visa; savings as it starts.
    const adjust = w.ctx.service("economy.adjust");
    for (const [account, to] of [["cash", 1000], ["checking", 2000], ["card", -397000]] as const) {
      const events = adjust(w.ctx, account, to - (w.state.accounts[account] ?? 0));
      if (!Array.isArray(events)) throw new Error(events.reason);
      for (const e of events) expect(w.apply(e)).toBeNull();
    }
    const savings = w.state.accounts.savings ?? 0;
    const purchase = reg.proposals.get("purchase");
    const p = { type: "purchase", item: "brass compass", price: 16500 };
    const bought = applyEffects(reg, w, purchase?.toEffects(p, w.ctx) ?? [], { bindings: {}, rng: createRng("c") });
    expect(bought.rejected).toEqual([]);
    const post = bought.applied.find((e) => e.type === "post" && e.memo === "Bought brass compass");
    const charged = post?.type === "post" ? -(post.lines.find((l) => l.account === "card")?.amount ?? 0) : 0;
    expect(post).toMatchObject({ overdraw: true });
    expect(charged).toBeGreaterThan(3000);
    expect(w.state.accounts.card).toBe(-397000 - charged);
    expect([w.state.accounts.cash, w.state.accounts.checking]).toEqual([1000, 2000]);
    expect(Object.values(w.state.entities).some((e) => e.name === "brass compass" && e.fields.owner === "you")).toBe(true);
    expect(w.ctx.query("economy.paid_from")(w.ctx, bought.applied, "you")).toEqual({ name: "Visa card", credit: true, cents: 397000 + charged, over: charged - 3000, total: charged });
    expect(moneyView(w.ctx).overview?.alerts.map((a) => a.text)).toContain(`Visa card is over its limit by $${((charged - 3000) / 100).toFixed(2)}.`);
    const way = w.ctx.service("economy.other_way")(w.ctx, bought.applied);
    if ("code" in way) throw new Error(way.reason);
    expect(way.from).toBe("savings");
    for (const e of way.repay) expect(w.apply(e)).toBeNull();
    expect(moneyView(w.ctx).overview?.alerts.some((a) => a.text.includes("over its limit"))).toBe(false);
    expect([w.state.accounts.card, w.state.accounts.savings]).toEqual([-397000, savings - charged]);
  });
});
