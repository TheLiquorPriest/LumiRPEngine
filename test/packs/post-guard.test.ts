// Ledger 1.10: postings re-validate against the state they fold on. From Money 2 a payment can't
// take cash, checking or savings below zero or a card past its limit (the `post` guard), and a
// payment is one atomic unit with its history line and what it bought, so a rebased view that
// can't afford it drops all of them instead of folding the wallet negative.
import { describe, expect, test } from "bun:test";
import type { LedgerEvent, PostingLine } from "../../src/shared/ledger";
import { applyValidUnits, EXTERNAL_ACCOUNT_PREFIX } from "../../src/engine/events";
import { materializeAll } from "../../src/engine/materialize";
import { createRegistry } from "../../src/engine/registry-impl";
import { resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import type { WorldState } from "../../src/engine/state";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { buildMoneyView } from "../../src/packs/economy/core/view";
import { modernUsWorld } from "./riverton";
import { startState } from "./support";

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
    const history = buildMoneyView(branch.ctx).recent.length;
    const items = Object.keys(branch.state.entities).length;
    const applied = applyValidUnits(reg, events, branch.state, (s) => reg.context(branch.world, s));
    expect(applied.filter((e) => e.type !== "clock")).toEqual([]);
    expect(branch.state.accounts.cash).toBe(100);
    expect(buildMoneyView(branch.ctx).recent.length).toBe(history);
    expect(Object.keys(branch.state.entities).length).toBe(items);
  });
});
