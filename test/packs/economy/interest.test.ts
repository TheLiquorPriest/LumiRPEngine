// Interest (DESIGN §25.4, §25.12), folded: from Money 3 deposit accounts earn their APY, loans bill
// theirs with their payment, and a card charges its APR on a balance carried from one statement day
// to the next even where statements don't run (none on a first period or a balance paid in full);
// each account's page says what its interest comes to.

import { describe, expect, test } from "bun:test";
import type { AccountView } from "../../../src/shared/finance";
import type { WorldDoc } from "../../../src/shared/world";
import { materializeAll } from "../../../src/engine/materialize";
import { createRegistry, type Registry } from "../../../src/engine/registry-impl";
import { resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { journalOf } from "../../../src/packs/economy/core/journal";
import { ALL_PACKS } from "../../../src/packs/index";
import { modernUsWorld } from "../riverton";
import { startState, trialBalance } from "../support";

const reg: Registry = createRegistry(ALL_PACKS);
const DAY = 1440;

/** Riverton with everyone at Money `level` (no tier caps), a 9 % car loan, the card's autopay off unless `patch` says. */
function setup(level: number, patch: (w: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("w", "Riverton");
  world.realism.levels.money = level as never;
  world.realism.tierCaps = { principal: {}, supporting: {}, background: {} } as never;
  world.entities.loan = { id: "loan", kind: "account", name: "Car loan", tier: "background", fields: { owner: "you", type: "loan", apr_pct: 9, due_day: 10, autopay: "minimum", autopay_from: "checking", payment: 30_000, months_left: 36, opening: -1_000_000 }, relations: [] };
  Object.assign(world.entities.card!.fields, { autopay: "none" });
  patch(world);
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

/** Lets `days` pass as the player would: a Timelapse to then, continued past each stop at the unit cap. */
function lapse(w: Working, days: number): void {
  const to = w.state.clock + days * DAY;
  for (;;) {
    const out = runTimelapse(reg, w, { type: "duration", minutes: to - w.state.clock }, { runSeed: "run", overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } });
    if ("code" in out) throw new Error(out.reason);
    if (out.result.stop !== "cap" || w.state.clock >= to) return;
  }
}

function interestLines(w: Working, account: string): number[] {
  return journalOf(w.state, account)
    .filter((j) => j.kind === "interest")
    .map((j) => j.cents);
}

function accountView(w: Working, id: string): AccountView {
  const found = w.ctx.query("economy.finance")(w.ctx, "you", true).accounts.find((a) => a.id === id);
  if (!found) throw new Error(`no account ${id} in the view`);
  return found;
}

describe("interest runs from Money 3", () => {
  test("a savings account earns its APY on the 1st of each month", () => {
    const w = setup(3);
    lapse(w, 50); // 16 Oct to 5 Dec: the 1st of November and of December
    const lines = interestLines(w, "savings");
    expect(lines).toHaveLength(2);
    // 0.4 % a year on $6,500.00: a twelfth of it each month, the second on the first's interest too.
    expect(lines[0]).toBe(Math.round((650_000 * 0.4) / 100 / 12));
    expect(lines[1]).toBe(Math.round(((650_000 + (lines[0] ?? 0)) * 0.4) / 100 / 12));
    expect(trialBalance(w.state)).toBe(0);
  });

  test("a loan bills a month's interest with each payment, so two payments leave what amortizing leaves", () => {
    const w = setup(3);
    lapse(w, 60); // bills on 10 November and 10 December, autopay paying each
    const first = Math.round((1_000_000 * 9) / 100 / 12);
    const second = Math.round(((1_000_000 + first - 30_000) * 9) / 100 / 12);
    expect(interestLines(w, "loan")).toEqual([-first, -second]);
    expect(w.state.accounts.loan).toBe(-(1_000_000 + first - 30_000 + second - 30_000));
    expect(trialBalance(w.state)).toBe(0);
  });

  test("a card without statements charges its APR on its statement day on what was still owed from the last one, and never on a first period", () => {
    const w = setup(3);
    expect(w.ctx.query("economy.finance")(w.ctx, "you", true).features).not.toContain("statements");
    lapse(w, 20); // past 3 November, the first statement day: a first period is in grace
    expect(interestLines(w, "card")).toEqual([]);
    lapse(w, 30); // past 3 December: the $380.00 owed on 3 November is still owed
    expect(interestLines(w, "card")).toEqual([-Math.round((38_000 * 22) / 100 / 12)]);
    // No statement closed for the card (a loan's bill is a statement of its own).
    expect(w.events.some((e) => e.type === "economy.statement" && "data" in e && e.data.account === "card")).toBe(false);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("a card paid down charges interest only on what was left of the last statement day's balance", () => {
    const w = setup(3, (world) => Object.assign(world.entities.card!.fields, { autopay: "fixed", autopay_cents: 10_000, autopay_from: "checking" }));
    lapse(w, 50); // 3 November: $100.00 paid of the $380.00; 3 December: interest on the $280.00 left
    expect(interestLines(w, "card")).toEqual([-Math.round((28_000 * 22) / 100 / 12)]);
  });

  test("a card paid in full on each statement day is never charged interest, new purchases included", () => {
    const w = setup(3, (world) => Object.assign(world.entities.card!.fields, { autopay: "full", autopay_from: "checking" }));
    lapse(w, 25); // the first statement day, and the balance paid on it
    expect(w.apply({ type: "post", lines: [{ account: "card", amount: -20_000 }, { account: "economy.external:bike_shop", amount: 20_000 }], memo: "Bought a bike" })).toBeNull();
    lapse(w, 70);
    expect(interestLines(w, "card")).toEqual([]);
    expect(w.state.accounts.card).toBe(0);
  });

  test("cash drawn on a card without statements runs the cash-advance rate from the day it was drawn, grace or not", () => {
    const w = setup(3);
    const drawn = w.state.clock;
    const r = resolveAction(reg, w, { action: "move_money", params: { from: "card", to: "checking", amount: 100_000 } }, createRng("advance"));
    expect([r.ok, r.rejected]).toEqual([true, []]);
    // Fees don't run at Money 3, so nothing but the cash moved.
    expect(w.state.accounts.card).toBe(-38_000 - 100_000);
    lapse(w, 20); // 3 November: a first period, so only the cash advance is charged
    const close = journalOf(w.state, "card").find((j) => j.memo === "Visa card cash advance interest");
    expect(close?.cents).toBe(-Math.round((100_000 * (Number(close?.at) - drawn) * 27) / 100 / (365 * 1440)));
    expect(interestLines(w, "card")).toHaveLength(1);
  });

  test("below Money 3, or with interest switched off, nothing earns or charges interest", () => {
    for (const w of [setup(2), setup(3, (world) => Object.assign(world.packs.economy!.config, { features: { interest: false } }))]) {
      lapse(w, 50);
      expect(["savings", "checking", "card", "loan"].flatMap((a) => interestLines(w, a))).toEqual([]);
    }
  });
});

describe("an account's interest, as its page shows it", () => {
  test("a savings account: the APY, how it's worked out, this year's, the last and about what the next comes to", () => {
    const w = setup(3);
    lapse(w, 50);
    const [first = 0, second = 0] = interestLines(w, "savings");
    const interest = accountView(w, "savings").interest;
    expect(interest).toMatchObject({ way: "earns", ratePct: 0.4, thisYear: first + second, last: { cents: second } });
    expect(interest?.basis).toContain("1st");
    expect(interest?.last?.at).toContain("Dec");
    // If nothing changes, the next is a twelfth of the year's on what's there now.
    expect(interest?.next?.at).toContain("Jan");
    expect(interest?.next?.cents).toBe(Math.round((w.state.accounts.savings! * 0.4) / 100 / 12));
  });

  test("a card: the APR, what it charged this year, and the next charge on what's still owed, none in grace", () => {
    const w = setup(3);
    lapse(w, 20);
    // The first statement day was in grace; the $380.00 owed then is still owed, so the next charges it.
    expect(accountView(w, "card").interest).toMatchObject({ way: "charges", ratePct: 22, thisYear: 0, last: null, next: { cents: Math.round((38_000 * 22) / 100 / 12) } });
    expect(accountView(w, "card").interest?.next?.at).toContain("Dec");
    lapse(w, 30);
    const charged = Math.round((38_000 * 22) / 100 / 12);
    expect(accountView(w, "card").interest).toMatchObject({ thisYear: charged, last: { cents: charged } });
  });

  test("a loan: the APR and the next bill's interest on what it owes", () => {
    const w = setup(3);
    lapse(w, 30);
    const owed = -(w.state.accounts.loan ?? 0);
    expect(accountView(w, "loan").interest).toMatchObject({ way: "charges", ratePct: 9, thisYear: Math.round((1_000_000 * 9) / 100 / 12), next: { cents: Math.round((owed * 9) / 100 / 12) } });
  });

  test("where interest doesn't run there is no interest block", () => {
    const w = setup(3, (world) => Object.assign(world.packs.economy!.config, { features: { interest: false } }));
    expect(accountView(w, "savings").interest).toBeNull();
    expect(accountView(w, "card").interest).toBeNull();
  });
});
