// One id for each flow across a player's money view (DESIGN §25.11): its row, its coming-up lines
// and alerts, and the modules' references to it all send the id the row has, a stand-in included,
// and the view reads a flow's run by its own id. The work module's Riverton.

import { describe, expect, test } from "bun:test";
import type { FinanceView } from "../../../src/shared/finance";
import type { JsonObject } from "../../../src/shared/json";
import { act, CLERK, entity, lapse, setup } from "./work-world";

const DAY = 1440;

describe("every reference to a flow in the player's view meets its row", () => {
  test("a repayment from Rosa, whom the player can't see, still says it was missed, linked by the stand-in its row goes by", () => {
    const { w } = setup((wd) => {
      wd.entities.rosa!.visibility = "secret";
      wd.entities.rosa_checking!.fields.opening = 0;
      wd.entities.rosa_payback = entity("rosa_payback", "flow", "Repayment", { flow_kind: "transfer", from: "rosa_checking", to: "checking", amount_cents: 5_000, every: "day", shortfall: "skip", status: "active" });
    });
    lapse(w, 2 * DAY);
    const view = w.ctx.query("economy.finance")(w.ctx, "you", true) as FinanceView;
    const row = view.flows.find((f) => f.label === "Repayment");
    expect(row?.id.startsWith("hidden:")).toBe(true);
    expect(view.overview?.alerts.filter((a) => a.text === "Repayment was missed.").map((a) => a.flow)).toEqual([row?.id]);
  });

  test("a late invoice from a business the player can't see links its alert to the payment's row, by the row's stand-in", () => {
    const { w } = setup((wd) => {
      wd.entities.brightline!.visibility = "secret";
      wd.entities.inv_freight = entity("inv_freight", "invoice", "Freight", { business: "brightline", customer: "you", cents: 40_000, memo: "Freight", issued: "2026-09-01", due: "2026-10-01", state: "late" });
    });
    const view = w.ctx.query("economy.finance")(w.ctx, "you", true) as FinanceView;
    const row = view.flows.find((f) => f.source === "invoice");
    expect(row?.id.startsWith("hidden:")).toBe(true);
    expect(view.overview?.alerts.filter((a) => /Freight/.test(a.text)).map((a) => a.flow)).toEqual([row?.id]);
  });
});

describe("a refusal and a job's pay name only whom the player may see", () => {
  test("a custodial card can't be paid from the custodian's own checking, and the refusal names its debtor, whom the player can't see, as someone", () => {
    const custodial: JsonObject[] = [{ party: "you", role: "custodian" }, { party: "maya", role: "beneficiary", share: 100 }];
    const { w } = setup((wd) => {
      wd.entities.maya!.visibility = "secret";
      wd.entities.kid_card = entity("kid_card", "account", "The card", { owners: custodial, product: "credit_card", opening: -5_000 });
    });
    const why = act(w, "economy.set_autopay", { who: "you", account: "kid_card", mode: "full", from: "checking" }).rejected.map((r) => r.rejection.reason);
    expect(why).toEqual([expect.stringContaining("The card is paid from someone's own money")]);
    expect(why.join(" ")).not.toContain("Maya");
  });

  test("the player's own pay, half of it routed to Rosa's checking, says it goes to someone where they can't see her", () => {
    const { w } = setup((wd) => {
      wd.entities.rosa!.visibility = "secret";
      wd.entities.job_clerk = entity("job_clerk", "job", "Office clerk", { ...CLERK, splits: [{ to: "rosa_checking", pct: 50 }] });
    });
    const job = (w.ctx.query("economy.finance")(w.ctx, "you", true) as FinanceView).jobs.find((j) => j.id === "job_clerk");
    expect(job?.splits.map((s) => s.to)).toEqual(["someone"]);
    expect((w.ctx.query("economy.finance")(w.ctx, "you", false) as FinanceView).jobs.find((j) => j.id === "job_clerk")?.splits.map((s) => s.to)).toEqual(["rosa_checking"]);
  });
});

describe("a label or a memo names a hidden person by no word of their name", () => {
  test("Rosa's first name alone reads as someone on a label, what's coming up and the lines it posts, while a word somewhere the player sees is also called stays", () => {
    const daily = (id: string, label: string, from: string, to: string) => entity(id, "flow", label, { flow_kind: "transfer", from, to, amount_cents: 5_000, every: "day", shortfall: "skip", status: "active" });
    const { w } = setup((wd) => {
      wd.entities.rosa!.visibility = "secret";
      wd.places.deli = { id: "deli", name: "Delgado's Deli", parent: "riverton", fields: {} };
      wd.entities.rosa_share = daily("rosa_share", "Rosa's share of the rent", "rosa_checking", "checking");
      wd.entities.rosa_whole = daily("rosa_whole", "From Rosa Delgado", "rosa_checking", "checking");
      wd.entities.lunch = daily("lunch", "Lunch at Delgado's Deli", "checking", "Delgado's Deli");
    });
    lapse(w, 2 * DAY);
    const view = w.ctx.query("economy.finance")(w.ctx, "you", true) as FinanceView;
    const labels = view.flows.map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(["Someone's share of the rent", "From someone", "Lunch at Delgado's Deli"]));
    expect(view.overview?.upcoming.map((u) => u.label)).toEqual(expect.arrayContaining(["Someone's share of the rent", "From someone"]));
    expect(view.accounts.find((a) => a.id === "checking")?.transactions.map((t) => t.memo)).toEqual(expect.arrayContaining(["Someone's share of the rent", "From someone"]));
    expect(JSON.stringify(view)).not.toContain("Rosa");
    expect((w.ctx.query("economy.finance")(w.ctx, "you", false) as FinanceView).flows.map((f) => f.label)).toContain("Rosa's share of the rent");
  });
});
