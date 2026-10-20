// Money a party only manages pays for its holder, never for them (DESIGN §25.1): a business's or a
// trust's money, by an account of it or by the party itself, run by someone whose own it isn't. The
// work module's Riverton, with a family trust where a test needs one.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import { account, act, entity, lapse, setup } from "./work-world";

const DAY = 1440;

/** Why the effects were refused, or "" when they weren't. */
function refusal(out: ReturnType<typeof act>): string {
  return out.rejected.map((r) => r.rejection.reason).join("; ");
}

describe("a business or a trust paying as a party pays for itself, whatever its manager's role on it", () => {
  test("a trustee can't redirect the trust's own allowance to himself or set one up to pay him, though he may change what it pays its beneficiary", () => {
    const { w } = setup((wd) => {
      wd.entities.family_trust = entity("family_trust", "trust", "Chen Family Trust", { owners: [{ party: "you", role: "trustee" }, { party: "maya", role: "beneficiary", share: 100 }] }, "principal");
      wd.entities.trust_acct = entity("trust_acct", "account", "Trust account", { owners: [{ party: "family_trust", role: "owner" }], product: "checking", opening: 5_000_000 });
      wd.entities.trust_allowance = entity("trust_allowance", "flow", "Maya's allowance", { flow_kind: "transfer", from: "family_trust", to: "maya_checking", amount_cents: 100_000, every: "day", shortfall: "skip", status: "active" });
    });
    expect(refusal(act(w, "economy.flow_update", { who: "you", flow: "trust_allowance", to: "checking" }))).toContain("Chen Family Trust pays for itself");
    expect(refusal(act(w, "economy.flow_create", { who: "you", label: "Pay me", from: "family_trust", to: "checking", amount: 100_000, every: "day" }))).toContain("Chen Family Trust pays for itself");
    expect(refusal(act(w, "economy.flow_update", { who: "you", flow: "trust_allowance", amount: 150_000 }))).toBe("");
    expect(w.state.entities.trust_allowance?.fields).toMatchObject({ to: "maya_checking", amount_cents: 150_000 });
  });

  test("a custodian of the café can't fall back on the café as a party, which would pay him from savings he holds no role on", () => {
    const { w } = setup((wd) => {
      Object.assign(wd.entities.daybreak!.fields, { owners: [{ party: "you", role: "custodian" }, { party: "maya", role: "beneficiary", share: 100 }] });
      wd.entities.db_operating!.fields.owners = [{ party: "daybreak", role: "owner" }, { party: "you", role: "authorized_user" }];
      wd.entities.db_savings = account("db_savings", "daybreak", "savings", 5_000_000);
    });
    expect(refusal(act(w, "economy.flow_create", { who: "you", label: "Top up", from: "db_operating", to: "checking", amount: 1_000_000, every: "day", shortfall: "fallback", fallback: "daybreak" }))).toContain("Daybreak Café pays for itself");
    lapse(w, 2 * DAY);
    expect(w.state.accounts.db_savings).toBe(5_000_000);
  });
});

describe("what a manager does for the money's own holder still plays", () => {
  test("the café's owner moves its savings into its own operating account, though he holds an authorized user's card on that account; his own checking it still doesn't pay", () => {
    const { w } = setup((wd) => {
      Object.assign(wd.entities.daybreak!.fields, { owners: [{ party: "you", role: "owner", share: 100 }] });
      wd.entities.db_operating!.fields.owners = [{ party: "daybreak", role: "owner" }, { party: "you", role: "authorized_user" }];
      wd.entities.db_savings = account("db_savings", "daybreak", "savings", 5_000_000);
    });
    expect(refusal(act(w, "economy.flow_create", { who: "you", label: "Top up the till", from: "db_savings", to: "db_operating", amount: 100_000, every: "week", weekday: 1 }))).toBe("");
    expect(refusal(act(w, "economy.flow_create", { who: "you", label: "Pay me", from: "db_savings", to: "checking", amount: 100_000, every: "week", weekday: 1 }))).toContain("pays for Daybreak Café");
  });

  test("a custodian sets a custodial card's autopay from the custodial savings, which is the child's money, though never from his own checking", () => {
    const custodial: JsonObject[] = [{ party: "you", role: "custodian" }, { party: "maya", role: "beneficiary", share: 100 }];
    const { w } = setup((wd) => {
      wd.entities.kid_savings = entity("kid_savings", "account", "Maya's savings", { owners: custodial, product: "savings", opening: 300_000 });
      wd.entities.kid_card = entity("kid_card", "account", "Maya's card", { owners: custodial, product: "credit_card", opening: -5_000 });
    });
    expect(refusal(act(w, "economy.set_autopay", { who: "you", account: "kid_card", mode: "full", from: "kid_savings" }))).toBe("");
    expect(w.state.entities.kid_card?.fields.autopay_from).toBe("kid_savings");
    expect(refusal(act(w, "economy.set_autopay", { who: "you", account: "kid_card", mode: "full", from: "checking" }))).toContain("Maya's card is paid from Maya");
  });
});

describe("money a manager only manages reaches none of their own interests", () => {
  /** A family trust the player is trustee of for Maya, and a household the player shares with Rosa. */
  function trustee(patch: Parameters<typeof setup>[0] = () => undefined) {
    return setup((wd) => {
      wd.entities.family_trust = entity("family_trust", "trust", "Chen Family Trust", { owners: [{ party: "you", role: "trustee" }, { party: "maya", role: "beneficiary", share: 100 }] }, "principal");
      wd.entities.trust_acct = entity("trust_acct", "account", "Trust account", { owners: [{ party: "family_trust", role: "owner" }], product: "checking", opening: 5_000_000 });
      wd.entities.home = entity("home", "household", "The household", {});
      for (const id of ["you", "rosa"]) wd.entities[id]!.relations.push({ type: "member_of", to: "home" });
      patch?.(wd);
    });
  }
  const once = { amount: 2_000_000, every: "once", once: "2026-10-17T09:00" };

  test("a trustee can't pay the trust's money into a business he owns or to someone of his household, though it pays its beneficiary", () => {
    const { w } = trustee((wd) => Object.assign(wd.entities.daybreak!.fields, { owners: [{ party: "you", role: "owner", share: 100 }] }));
    expect(refusal(act(w, "economy.flow_create", { who: "you", label: "Consulting", from: "trust_acct", to: "db_operating", ...once }))).toContain("Trust account pays for Chen Family Trust");
    expect(refusal(act(w, "economy.flow_create", { who: "you", label: "Consulting", from: "trust_acct", to: "daybreak", ...once }))).toContain("pays for Chen Family Trust");
    expect(refusal(act(w, "economy.flow_create", { who: "you", label: "Help", from: "trust_acct", to: "rosa_checking", ...once }))).toContain("pays for Chen Family Trust");
    expect(refusal(act(w, "economy.flow_create", { who: "you", label: "Allowance", from: "trust_acct", to: "maya_checking", ...once }))).toBe("");
  });

  test("a trust pays its beneficiary though she's of the trustee's household", () => {
    const { w } = trustee((wd) => wd.entities.maya!.relations.push({ type: "member_of", to: "home" }));
    expect(refusal(act(w, "economy.flow_create", { who: "you", label: "Allowance", from: "trust_acct", to: "maya_checking", ...once }))).toBe("");
    expect(refusal(act(w, "economy.flow_create", { who: "you", label: "Help", from: "trust_acct", to: "rosa_checking", ...once }))).toContain("pays for Chen Family Trust");
  });

  test("Brightline's custodian, who owns the café, can't bill Brightline for the café, nor pay the café's invoice as Brightline's custodian", () => {
    const { w } = setup((wd) => {
      Object.assign(wd.entities.brightline!.fields, { owners: [{ party: "you", role: "custodian" }, { party: "jordan", role: "beneficiary", share: 100 }] });
      Object.assign(wd.entities.daybreak!.fields, { owners: [{ party: "you", role: "owner", share: 100 }] });
      wd.entities.inv_consulting = entity("inv_consulting", "invoice", "Consulting", { business: "daybreak", customer: "brightline", cents: 3_000_000, memo: "Consulting", issued: "2026-09-01", due: "2026-10-30", state: "open" });
    });
    lapse(w, DAY);
    expect(refusal(act(w, "economy.invoice_issue", { business: "daybreak", customer: "brightline", cents: 3_000_000, memo: "More consulting", by: "you" }))).toContain("runs Brightline Logistics for others");
    const brightline = w.state.accounts.bl_operating ?? 0;
    expect(refusal(act(w, "economy.invoice_pay", { invoice: "inv_consulting", by: "you" }))).toContain("Brightline Logistics pays for itself");
    expect(w.state.accounts.bl_operating).toBe(brightline);
    // The café bills someone else as it likes.
    expect(refusal(act(w, "economy.invoice_issue", { business: "daybreak", customer: "rosa", cents: 50_000, memo: "Catering", by: "you" }))).toBe("");
  });

  test("a custodian puts neither himself on the café's payroll nor up his own pay there; an owner hires himself as he likes", () => {
    const custodian = setup((wd) => {
      Object.assign(wd.entities.daybreak!.fields, { owners: [{ party: "you", role: "custodian" }, { party: "maya", role: "beneficiary", share: 100 }] });
      wd.entities.job_you_cafe = entity("job_you_cafe", "job", "Your café shifts", { worker: "you", employer: "daybreak", title: "Barista", basis: "hourly", rate: 1_800, hours: "contract", hours_per_week: 10, pay_every: "weekly", start: "2026-01-05" });
    }).w;
    expect(refusal(act(custodian, "economy.hire", { business: "daybreak", worker: "you", title: "General manager", basis: "salary", rate: 20_000_000, pay_every: "weekly", by: "you" }))).toContain("runs Daybreak Café for others");
    expect(refusal(act(custodian, "economy.job_raise", { job: "job_you_cafe", rate: 4_000, by: "you" }))).toContain("can't set their own pay");
    expect(refusal(act(custodian, "economy.hire", { business: "daybreak", worker: "rosa", title: "Barista", basis: "hourly", rate: 1_800, pay_every: "weekly", by: "you" }))).toBe("");
    const owner = setup((wd) => Object.assign(wd.entities.daybreak!.fields, { owners: [{ party: "you", role: "owner", share: 100 }] })).w;
    expect(refusal(act(owner, "economy.hire", { business: "daybreak", worker: "you", title: "General manager", basis: "salary", rate: 20_000_000, pay_every: "weekly", by: "you" }))).toBe("");
  });
});
