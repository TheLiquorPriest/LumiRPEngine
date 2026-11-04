// Loans between parties (DESIGN §25.4): `economy.lend` opens the lender's note and the borrower's
// loan and moves the cash in one unit that sums to zero; the loan's interest posts against the note,
// equal and opposite; its autopay pays it and the day's sweep lands the payment with the lender the
// same day; a payoff closes both; a note is an asset but never cash; a missed payment takes no late
// fee; and a parent lending to the company it controls leaves the consolidated figures as they were.

import { describe, expect, test } from "bun:test";
import type { OwnershipView } from "../../../src/shared/finance";
import type { JsonObject, JsonValue } from "../../../src/shared/json";
import type { PostEvent } from "../../../src/shared/ledger";
import type { OrgView } from "../../../src/shared/org-view";
import { calendarOf, dateAt } from "../../../src/engine/calendar";
import { materializeAll } from "../../../src/engine/materialize";
import { readPass } from "../../../src/engine/read-pass";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { journalOf } from "../../../src/packs/economy/core/journal";
import { statusOf } from "../../../src/packs/economy/core/model";
import { STARTER_WORLDS } from "../../../src/packs/index";
import { startState, trialBalance } from "../support";
import { act, reg, setup } from "./work-world";

const DAY = 1440;

/** Riverton at Money 4: Brightline (with $500,000) lends Daybreak Café $1,000 at 12 % over a year. */
function lent(args: JsonObject = {}): { w: Working; note: string; loan: string } {
  const { w } = setup((wd) => void (wd.realism.levels.money = 4 as never));
  const out = act(w, "economy.lend", { who: "brightline", to: "daybreak", cents: 100_000, apr: 12, months: 12, ...args });
  expect(out.rejected.map((r) => r.rejection.reason)).toEqual([]);
  const ids = Object.keys(w.state.entities);
  const note = ids.find((id) => w.state.entities[id]?.fields.product === "note") ?? "";
  const loan = ids.find((id) => w.state.entities[id]?.fields.note === note) ?? "";
  return { w, note, loan };
}

/** Lets `days` pass as the player would, past each stop at the unit cap. */
function lapse(w: Working, days: number): void {
  const to = w.state.clock + days * DAY;
  for (let guard = 0; w.state.clock < to && guard < 64; guard++) {
    const out = runTimelapse(reg, w, { type: "duration", minutes: to - w.state.clock }, { runSeed: "notes", overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } });
    if ("code" in out) throw new Error(out.reason);
  }
}

const balanceOf = (w: Working, account: string): number => w.state.accounts[account] ?? 0;

describe("a loan between parties", () => {
  test("origination opens a note and a loan and moves the cash, every posting summing to zero", () => {
    const { w, note, loan } = lent();
    expect(w.state.entities[note]).toMatchObject({ kind: "account", name: "Loan to Daybreak Café", fields: { owners: [{ party: "brightline", role: "owner" }], loan } });
    expect(w.state.entities[loan]).toMatchObject({ kind: "account", name: "Loan from Brightline Logistics", fields: { owners: [{ party: "daybreak", role: "owner" }], product: "loan", apr_pct: 12, months_left: 12, autopay: "minimum", autopay_from: "db_operating" } });
    const posts = w.events.filter((e): e is PostEvent => e.type === "post" && /^(Lent|Borrowed) /.test(e.memo));
    expect(posts).toHaveLength(2);
    for (const p of posts) expect(p.lines.reduce((a, l) => a + l.amount, 0)).toBe(0);
    expect([balanceOf(w, note), balanceOf(w, loan), balanceOf(w, "bl_operating"), balanceOf(w, "db_operating")]).toEqual([100_000, -100_000, 50_000_000 - 100_000, 200_000 + 100_000]);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("a note is an asset, never cash: it counts in the lender's net worth as loans made, and nothing pays from it or into it", () => {
    const { w: before } = setup((wd) => void (wd.realism.levels.money = 4 as never));
    const worth = before.ctx.query("economy.finance")(before.ctx, "brightline", false).overview?.netWorth;
    const { w, note } = lent();
    const view = w.ctx.query("economy.finance")(w.ctx, "brightline", false);
    expect(view.overview?.netWorth).toBe(worth);
    expect(view.overview?.breakdown).toContainEqual({ label: "Loans made", cents: 100_000 });
    expect(view.accounts.find((a) => a.id === note)?.class).toBe("note");
    expect(act(w, "economy.move", { from: note, to: "bl_operating", cents: 1000 }).rejected.map((r) => r.rejection.reason).join()).toContain("can't be drawn on");
    expect(act(w, "economy.move", { from: "bl_operating", to: note, cents: 1000 }).rejected.length).toBe(1);
    expect(balanceOf(w, note)).toBe(100_000);
  });

  test("its interest posts against the note, equal and opposite, and its autopay reaches the lender the same day", () => {
    const { w, note, loan } = lent();
    const cal = calendarOf(w.world);
    lapse(w, 32); // past the first bill on the 16th of next month, its autopay and that night's sweep
    const interest = (account: string) => journalOf(w.state, account).filter((j) => j.kind === "interest");
    expect(interest(loan).map((j) => j.cents)).toEqual([-1000]);
    expect(interest(note).map((j) => [j.cents, j.at])).toEqual([[1000, interest(loan)[0]?.at]]);
    const paid = journalOf(w.state, loan).filter((j) => j.cents > 0 && j.category === "transfer");
    expect(paid.map((j) => j.cents)).toEqual([8885]);
    const landed = journalOf(w.state, "bl_operating").filter((j) => /payment received/.test(j.memo));
    expect(landed.map((j) => j.cents)).toEqual([8885]);
    expect(dateAt(cal, landed[0]?.at ?? 0).dayIndex).toBe(dateAt(cal, paid[0]?.at ?? -DAY).dayIndex);
    // The note holds what the loan owes: principal and interest, less the payment.
    expect([balanceOf(w, note), balanceOf(w, loan)]).toEqual([100_000 + 1000 - 8885, -(100_000 + 1000 - 8885)]);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("a missed payment takes no late fee and reports nothing: what isn't paid is still owed", () => {
    const { w, loan } = lent();
    expect(act(w, "economy.set_autopay", { account: loan, mode: "none", who: "daybreak" }).rejected).toEqual([]);
    lapse(w, 34);
    expect(journalOf(w.state, loan).filter((j) => j.kind === "fee")).toEqual([]);
    expect(w.events.filter((e) => e.type === "economy.delinquency" && "data" in e && (e.data as JsonObject).account === loan)).toEqual([]);
    expect(w.events.filter((e) => e.type === "economy.credit" && "data" in e && (e.data as JsonObject).account === loan)).toEqual([]);
    expect(balanceOf(w, loan)).toBe(-101_000);
  });

  test("a payoff closes both, the lender paid in full that night", () => {
    const { w, note, loan } = lent();
    expect(act(w, "economy.pay_card", { card: loan, who: "daybreak" }).rejected).toEqual([]);
    expect(balanceOf(w, loan)).toBe(0);
    lapse(w, 1);
    expect([balanceOf(w, note), balanceOf(w, "bl_operating")]).toEqual([0, 50_000_000]);
    expect([statusOf(w.state, note), statusOf(w.state, loan)]).toEqual(["paid_off", "paid_off"]);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("lending more than the account holds, or to oneself, is refused", () => {
    const { w } = setup((wd) => void (wd.realism.levels.money = 4 as never));
    expect(act(w, "economy.lend", { who: "daybreak", to: "brightline", cents: 10_000_000 }).rejected.map((r) => r.rejection.reason).join()).toContain("no account with");
    expect(act(w, "economy.lend", { who: "brightline", to: "brightline", cents: 1000 }).rejected.map((r) => r.rejection.reason).join()).toContain("can't lend to itself");
  });
});

// ---------------------------------------------------------------- a parent and its subsidiary (Port Alder)

const JORDAN = "pov";
const SAVINGS = "acct_pov_savings";
const EMR = "ellis_mobile_repair_co";
const TOW = "ellis_towing_co";

function portAlder(): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  const w = new Working(reg, world, startState(world, reg));
  materializeAll(reg, w, JORDAN, "notes");
  return w;
}

function play(w: Working, action: string, params: Record<string, JsonValue>): Resolution {
  return resolveAction(reg, w, { action, actor: JORDAN, params }, createRng(`${action}:${w.events.length}`), { runSeed: "notes" });
}

function why(r: Resolution): string {
  return [r.failed?.reason ?? null, ...r.rejected.map((x) => x.rejection.reason)].filter((x) => x !== null).join("; ");
}

function ownership(w: Working, org: string): OwnershipView {
  const view = reg.views.find((v) => v.panel === "orgs.org");
  if (!view) throw new Error("no orgs.org panel");
  const pages = readPass(() => view.build(w.ctx, { mapDisplay: null })) as unknown as Record<string, OrgView>;
  return pages[org]?.sections.ownership as unknown as OwnershipView;
}

describe("a loan within a group", () => {
  test("Ellis Mobile Repair lends Ellis Towing $300: the consolidated cash, profit and net worth are as they were", () => {
    const w = portAlder();
    expect(why(play(w, "org_found", { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from: SAVINGS, units: 1000 }))).toBe("");
    expect(why(play(w, "org_found", { type: "company", name: "Ellis Towing", amount: 50_000, as: EMR }))).toBe("");
    const before = ownership(w, EMR).consolidated;
    const worth = (party: string) => w.ctx.query("economy.finance")(w.ctx, party, false).overview?.netWorth;
    const worths = [worth(EMR), worth(TOW)];
    expect(why(play(w, "lend_money", { to: TOW, amount: 30_000, apr: 6, months: 12, as: EMR }))).toBe("");
    expect(ownership(w, EMR).consolidated).toEqual(before);
    expect([worth(EMR), worth(TOW)]).toEqual(worths);
    expect(trialBalance(w.state)).toBe(0);
  });
});
