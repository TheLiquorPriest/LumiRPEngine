// The money's presses and what each one records: every kind of event the economy's out-of-play actions record is taken back by its Undo,
// and the world reads as it did before the press (balances, holdings, property, standing payments, cards, invoices, jobs, shares, notes
// and the books the press wrote). Each step plays an action as a panel presses it, takes it back at once and compares the two worlds; a step
// marked `keep` is played again afterwards, so the next one finds what it needs. The people, accounts and businesses are the starter
// world's own, which are invented.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import { action, pressed, type Rig, rig } from "../../play/undo-rig";

interface Step {
  /** What the press is, for the failure's message. */
  label: string;
  id: string;
  params: JsonObject;
  /** Pressed again after its Undo, to leave what it makes there for the steps after. */
  keep?: true;
}

/** Each step pressed and taken back: it applied, its Undo said nothing was left, and the world is what it was. */
async function play(r: Rig, steps: readonly Step[]): Promise<void> {
  for (const step of steps) {
    const done = await pressed(r, action(step.id, step.params));
    expect(done.tap.applied, `${step.label}: ${done.tap.words}`).toBe(true);
    expect(done.undo?.words, `${step.label}: the Undo`).toBe("");
    expect(done.differs, `${step.label}: what the Undo gave back`).toEqual([]);
    if (step.keep) expect((await r.tap(action(step.id, step.params))).applied, `${step.label}: again`).toBe(true);
  }
}

describe("the money's presses are taken back whole", () => {
  test("a person's own accounts, cards, payments, standing payments, credit and trades", async () => {
    await play(await rig("pov"), [
      { label: "pay someone", id: "pay", params: { to: "danny_okafor", amount: 5000 } },
      { label: "move money between accounts", id: "move_money", params: { from: "acct_pov_savings", to: "acct_pov_auto_loan", amount: 5000 } },
      { label: "pay a card", id: "pay_card", params: { card: "acct_pov_card" } },
      { label: "freeze a card", id: "card_freeze", params: { card: "card_pov_debit" }, keep: true },
      { label: "unfreeze it", id: "card_unfreeze", params: { card: "card_pov_debit" } },
      { label: "report a card lost", id: "card_report_lost", params: { card: "card_pov_debit" } },
      { label: "replace a card", id: "card_replace", params: { card: "card_pov_debit" } },
      { label: "autopay", id: "set_autopay", params: { account: "acct_pov_card", mode: "minimum" } },
      { label: "name a standing payment", id: "flow_update", params: { flow: "bill_renters", label: "Renters policy" } },
      { label: "pause a standing payment", id: "flow_pause", params: { flow: "bill_rent" }, keep: true },
      { label: "resume it", id: "flow_resume", params: { flow: "bill_rent" } },
      { label: "delete it", id: "flow_delete", params: { flow: "bill_rent" } },
      { label: "a new standing payment", id: "flow_create", params: { label: "Zed", kind: "bill", from: "acct_pov_checking", to: "danny_okafor", amount: 5000, every: "month", day: 3 } },
      { label: "apply for credit", id: "apply_credit", params: { product: "credit_card" } },
      { label: "a trade", id: "trade", params: { side: "buy", holding: "hold_pov_index", asset: "bond", account: "acct_pov_savings", qty: 1, from: "acct_pov_checking" } },
      { label: "end a lease", id: "lease_end", params: { lease: "bill_rent" } },
      { label: "a donation", id: "donate", params: { to: "danny_okafor", amount: 5000 } },
    ]);
  });

  test("an employer's staff, invoices and a business's own books", async () => {
    await play(await rig("pov"), [
      { label: "end a job", id: "job_end", params: { job: "job_pov_mechanic" } },
      { label: "a raise", id: "job_raise", params: { job: "job_danny_mechanic", rate: 5000 } },
      { label: "hours", id: "job_hours", params: { job: "job_danny_mechanic", hours_per_week: 1 } },
      { label: "leave", id: "job_leave", params: { job: "job_pov_mechanic" }, keep: true },
      { label: "a return from leave", id: "job_return", params: { job: "job_pov_mechanic" } },
      { label: "a title", id: "job_title", params: { job: "job_pov_mechanic" } },
      { label: "a position", id: "job_position", params: { job: "job_pov_mechanic" } },
      { label: "issue an invoice", id: "invoice_issue", params: { business: "alder_automotive_co", customer: "pov", amount: 5000 } },
      { label: "void an invoice", id: "invoice_void", params: { invoice: "inv_road_commission" } },
    ]);
    await play(await rig("dale_whitcomb"), [{ label: "pay an invoice", id: "invoice_pay", params: { invoice: "inv_dale_trailer" } }]);
  });

  test("an owner's draws, property, shares, structure, projects and returns", async () => {
    const r = await rig("marcus_delgado");
    await play(r, [
      { label: "an owner's draw", id: "owner_draw", params: { business: "alder_automotive_co", amount: 5000 } },
      { label: "distribute profit", id: "distribute_profit", params: { business: "alder_automotive_co", amount: 5000 } },
      { label: "sell property", id: "property_sell", params: { property: "prop_marcus_home", price: 5000, buyer: "danny_okafor" } },
      { label: "list property", id: "property_list", params: { property: "prop_marcus_home", price: 5000 } },
      { label: "start a lease", id: "lease_start", params: { property: "prop_marcus_home", tenant: "pov", rent: 5000 } },
      { label: "sell a stake", id: "stake_sell", params: { business: "alder_automotive_co", share: 2, price: 5000, buyer: "pov" } },
      { label: "issue shares", id: "shares_issue", params: { business: "alder_automotive_co", to: "nora_whitfield", units: 10 }, keep: true },
      { label: "a class of shares", id: "shares_classes", params: { business: "alder_automotive_co", label: "Preferred", class: "pref", votes: 0 } },
      { label: "buy shares back", id: "shares_buy_back", params: { business: "alder_automotive_co", from: "nora_whitfield", units: 2, price: 5000 } },
      { label: "a pay schedule", id: "org_pay_schedule", params: { org: "alder_automotive_co", every: "weekly", weekday: 5 } },
      { label: "start a project", id: "project_start", params: { org: "alder_automotive_co", template: "building", name: "Shop expansion" } },
      { label: "restructure", id: "org_restructure", params: { org: "alder_automotive_co", structure: "c_corp" }, keep: true },
      { label: "file a consolidated return", id: "tax_consolidate", params: { org: "alder_automotive_co" } },
    ]);
    await play(await rig("helen_kowalczyk"), [{ label: "route distributions", id: "route_distributions", params: { property: "prop_harbor_114" } }]);
  });

  test("a corporation's consent dividend, listing, winding up and merger", async () => {
    const r = await rig("pov");
    await play(r, [{ label: "found a corporation", id: "org_found", params: { type: "company", name: "Zed Corp", structure: "c_corp", amount: 100000 }, keep: true }]);
    const corp = Object.entries(r.world().entities).find(([, e]) => e.name === "Zed Corp" && e.fields.gone !== true)?.[0] ?? "";
    expect(corp).not.toBe("");
    await play(r, [
      { label: "a consent dividend", id: "consent_dividend", params: { org: corp, amount: 5000 } },
      { label: "a consolidated return", id: "tax_consolidate", params: { org: corp } },
      { label: "issue shares at a price", id: "shares_issue", params: { business: corp, to: "danny_okafor", units: 10, price: 5000 }, keep: true },
      { label: "wind up", id: "org_wind_up", params: { org: corp, stage: "begin", property: "sell" } },
      { label: "start a project", id: "project_start", params: { org: corp, template: "building", name: "Zed Hall" } },
      { label: "found another", id: "org_found", params: { type: "company", name: "Zed Two", structure: "llc", amount: 50000 }, keep: true },
    ]);
    const two = Object.entries(r.world().entities).find(([, e]) => e.name === "Zed Two" && e.fields.gone !== true)?.[0] ?? "";
    await play(r, [{ label: "merge them", id: "org_merge", params: { org: two, into: corp } }]);
  });
});
