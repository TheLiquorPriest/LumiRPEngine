// Money a party only manages pays for its holder, never for them (DESIGN §25.1): a business's or a
// trust's money, by an account of it or by the party itself, run by someone whose own it isn't. The
// work module's Riverton, with a family trust where a test needs one.

import { describe, expect, test } from "bun:test";
import type { FinanceView } from "../../../src/shared/finance";
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

  test("nor does it go into an account the manager may spend by a role of their own, unless the money is partly theirs: the café's custodian can't sweep its savings into the till he has a card on, nor a trustee pay the trust's money into an account he's custodian of", () => {
    const custodian = setup((wd) => {
      Object.assign(wd.entities.daybreak!.fields, { owners: [{ party: "you", role: "custodian" }, { party: "maya", role: "beneficiary", share: 100 }] });
      wd.entities.db_operating!.fields.owners = [{ party: "daybreak", role: "owner" }, { party: "you", role: "authorized_user" }];
      wd.entities.db_savings = account("db_savings", "daybreak", "savings", 5_000_000);
    }).w;
    expect(refusal(act(custodian, "economy.flow_create", { who: "you", label: "Top up the till", from: "db_savings", to: "db_operating", ...once }))).toContain("db_savings pays for Daybreak Café, not for Alex Rivera");
    const { w } = trustee((wd) => {
      wd.entities.jordan_kept = entity("jordan_kept", "account", "Jordan's savings", { owners: [{ party: "you", role: "custodian" }, { party: "jordan", role: "beneficiary", share: 100 }], product: "savings", opening: 0 });
    });
    expect(refusal(act(w, "economy.flow_create", { who: "you", label: "Grant", from: "trust_acct", to: "jordan_kept", ...once }))).toContain("Trust account pays for Chen Family Trust, not for Alex Rivera");
  });

  test("his interests run as deep as whose money is: a trustee who owns Brightline, which owns the café, pays the trust's money into neither", () => {
    const { w } = trustee((wd) => {
      Object.assign(wd.entities.brightline!.fields, { owners: [{ party: "you", role: "owner", share: 100 }] });
      Object.assign(wd.entities.daybreak!.fields, { owners: [{ party: "brightline", role: "owner", share: 100 }] });
    });
    for (const to of ["bl_operating", "db_operating"]) expect(refusal(act(w, "economy.flow_create", { who: "you", label: "Consulting", from: "trust_acct", to, ...once }))).toContain("Trust account pays for Chen Family Trust, not for Alex Rivera");
  });
});

describe("money a manager only manages is judged where it lands, however its payee is named", () => {
  type Patch = NonNullable<Parameters<typeof setup>[0]>;
  const both = (...patches: Patch[]): Patch => (wd) => patches.forEach((p) => p(wd));
  /** The café, which the player runs as custodian for Maya, holding an authorized user's card on its till. */
  const cafeForMaya: Patch = (wd) => {
    Object.assign(wd.entities.daybreak!.fields, { owners: [{ party: "you", role: "custodian" }, { party: "maya", role: "beneficiary", share: 100 }] });
    wd.entities.db_operating!.fields.owners = [{ party: "daybreak", role: "owner" }, { party: "you", role: "authorized_user" }];
    wd.entities.db_savings = account("db_savings", "daybreak", "savings", 5_000_000);
  };
  /** Rosa keeps no account but one the player is custodian of, so whatever is paid her lands there. */
  const rosaKept: Patch = (wd) => {
    delete wd.entities.rosa_checking;
    wd.entities.rosa_kept = entity("rosa_kept", "account", "Rosa's account", { owners: [{ party: "you", role: "custodian" }, { party: "rosa", role: "beneficiary", share: 100 }], product: "checking", opening: 0 });
  };
  /** A family trust the player is trustee of for `beneficiary`. */
  const trustFor = (beneficiary: string): Patch => (wd) => {
    wd.entities.family_trust = entity("family_trust", "trust", "Chen Family Trust", { owners: [{ party: "you", role: "trustee" }, { party: beneficiary, role: "beneficiary", share: 100 }] }, "principal");
    wd.entities.trust_acct = entity("trust_acct", "account", "Trust account", { owners: [{ party: "family_trust", role: "owner" }], product: "checking", opening: 5_000_000 });
  };
  const pay = (w: ReturnType<typeof setup>["w"], from: string, to: string) => act(w, "economy.flow_create", { who: "you", label: `Pay ${to}`, from, to, amount: 100_000, every: "day" });

  test("paid to someone by name, it lands in their deposit account, judged as that account would be: the café's custodian pays its savings neither to the café, whose till he holds a card on, nor to Rosa, whose account he's custodian of", () => {
    const { w } = setup(both(cafeForMaya, rosaKept));
    for (const to of ["daybreak", "db_operating", "rosa", "rosa_kept"]) expect([to, refusal(pay(w, "db_savings", to))]).toEqual([to, "db_savings pays for Daybreak Café, not for Alex Rivera"]);
    expect(refusal(pay(w, "db_savings", "maya"))).toBe("");
  });

  test("nor does a trustee pay Rosa by name what he may not pay into her account", () => {
    const { w } = setup(both(trustFor("maya"), rosaKept));
    for (const to of ["rosa", "rosa_kept"]) expect([to, refusal(pay(w, "trust_acct", to))]).toEqual([to, "Trust account pays for Chen Family Trust, not for Alex Rivera"]);
    expect(refusal(pay(w, "trust_acct", "maya"))).toBe("");
  });

  test("a parent who is trustee of his daughter's trust and custodian of her account pays her from it, by name or into the account alike, though never himself", () => {
    const { w } = setup(
      both(trustFor("rosa"), rosaKept, (wd) => {
        wd.entities.home = entity("home", "household", "The household", {});
        for (const id of ["you", "rosa"]) wd.entities[id]!.relations.push({ type: "member_of", to: "home" });
      }),
    );
    expect(refusal(pay(w, "trust_acct", "rosa_kept"))).toBe("");
    expect(refusal(pay(w, "trust_acct", "rosa"))).toBe("");
    expect(refusal(pay(w, "trust_acct", "checking"))).toBe("Trust account pays for Chen Family Trust, not for Alex Rivera");
    lapse(w, 2 * DAY);
    expect(w.state.accounts.rosa_kept ?? 0).toBeGreaterThan(0);
  });

  test("an invoice's payment lands in its business's till: Brightline's custodian pays from Brightline no invoice of a café whose till he holds a card on, nor bills Brightline for a café he runs for Maya", () => {
    const brightlineForJordan: Patch = (wd) => Object.assign(wd.entities.brightline!.fields, { owners: [{ party: "you", role: "custodian" }, { party: "jordan", role: "beneficiary", share: 100 }] });
    const { w } = setup(
      both(brightlineForJordan, (wd) => {
        Object.assign(wd.entities.daybreak!.fields, { owners: [{ party: "rosa", role: "owner", share: 100 }] });
        wd.entities.db_operating!.fields.owners = [{ party: "daybreak", role: "owner" }, { party: "you", role: "authorized_user" }];
        wd.entities.inv_supplies = entity("inv_supplies", "invoice", "Supplies", { business: "daybreak", customer: "brightline", cents: 300_000, memo: "Supplies", issued: "2026-09-01", due: "2026-10-30", state: "open" });
      }),
    );
    lapse(w, DAY);
    const brightline = w.state.accounts.bl_operating ?? 0;
    expect(refusal(act(w, "economy.invoice_pay", { invoice: "inv_supplies", by: "you" }))).toBe("Brightline Logistics pays for itself, not for Alex Rivera");
    expect(w.state.accounts.bl_operating).toBe(brightline);
    const billing = setup(both(brightlineForJordan, cafeForMaya)).w;
    expect(refusal(act(billing, "economy.invoice_issue", { business: "daybreak", customer: "brightline", cents: 300_000, memo: "Catering", by: "you" }))).toBe("Alex Rivera runs Brightline Logistics for others, so can't bill it for Daybreak Café");
  });

  test("a worker's pay lands in their deposit account: the café's custodian neither hires Rosa into the account he's custodian of nor raises her there, though he hires Maya", () => {
    const { w } = setup(
      both(cafeForMaya, rosaKept, (wd) => {
        wd.entities.job_rosa_cafe = entity("job_rosa_cafe", "job", "Rosa's café shifts", { worker: "rosa", employer: "daybreak", title: "Barista", basis: "hourly", rate: 1_800, hours: "contract", hours_per_week: 10, pay_every: "weekly", start: "2026-01-05" });
      }),
    );
    const hire = (worker: string) => act(w, "economy.hire", { business: "daybreak", worker, title: "Barista", basis: "hourly", rate: 1_800, pay_every: "weekly", by: "you" });
    const why = "Alex Rivera runs Daybreak Café for others, so can't pay Rosa Delgado into Rosa's account, which Alex Rivera may spend";
    expect(refusal(hire("rosa"))).toBe(why);
    expect(refusal(act(w, "economy.job_raise", { job: "job_rosa_cafe", rate: 4_000, by: "you" }))).toBe(why);
    expect(refusal(hire("maya"))).toBe("");
    // The hub names her among those he may neither hire nor raise there.
    const page = (w.ctx.query("economy.finance")(w.ctx, "you", true) as FinanceView).businesses.find((b) => b.id === "daybreak");
    expect(page?.selfDealing).toEqual(["you", "rosa"]);
  });

  test("the hub is told so by the same rule: the café's savings may go neither to the café nor to Rosa, by name or account, but to Maya", () => {
    const { w } = setup(both(cafeForMaya, rosaKept));
    const savings = (w.ctx.query("economy.finance")(w.ctx, "you", true) as FinanceView).paysFor.find((p) => p.from === "db_savings")?.to ?? [];
    expect(savings).toEqual(expect.arrayContaining(["daybreak", "db_operating", "rosa", "rosa_kept"]));
    expect(savings).not.toContain("maya");
    expect(savings).not.toContain("maya_checking");
  });
});

describe("money wholly a manager's own keeps no one else's interest", () => {
  test("the owner of Brightline and the café outright bills and pays between them, though he pays himself from neither but by a draw", () => {
    const { w } = setup((wd) => {
      Object.assign(wd.entities.brightline!.fields, { owners: [{ party: "you", role: "owner", share: 100 }] });
      Object.assign(wd.entities.daybreak!.fields, { owners: [{ party: "you", role: "owner", share: 100 }] });
    });
    lapse(w, DAY);
    expect(refusal(act(w, "economy.invoice_issue", { business: "daybreak", customer: "brightline", cents: 300_000, memo: "Catering", by: "you" }))).toBe("");
    const invoice = Object.keys(w.state.entities).find((id) => w.state.entities[id]?.kind === "invoice" && w.state.entities[id]?.fields.customer === "brightline") ?? "";
    const cafe = w.state.accounts.db_operating ?? 0;
    expect(refusal(act(w, "economy.invoice_pay", { invoice, by: "you" }))).toBe("");
    expect((w.state.accounts.db_operating ?? 0) - cafe).toBe(300_000);
    const once = { amount: 300_000, every: "once", once: "2026-10-18T09:00" };
    expect(refusal(act(w, "economy.flow_create", { who: "you", label: "Catering", from: "bl_operating", to: "db_operating", ...once }))).toBe("");
    // What he takes out for himself goes by a draw, which the books and the taxes see.
    expect(refusal(act(w, "economy.flow_create", { who: "you", label: "Pay me", from: "bl_operating", to: "checking", ...once }))).toContain("pays for Brightline Logistics, not for Alex Rivera");
  });

  test("where someone else holds a share of the payer, its money still pays nothing else of the manager's", () => {
    const { w } = setup((wd) => {
      Object.assign(wd.entities.brightline!.fields, { owners: [{ party: "you", role: "owner", share: 50 }, { party: "jordan", role: "owner", share: 50 }] });
      Object.assign(wd.entities.daybreak!.fields, { owners: [{ party: "you", role: "owner", share: 100 }] });
    });
    expect(refusal(act(w, "economy.flow_create", { who: "you", label: "Catering", from: "bl_operating", to: "db_operating", amount: 300_000, every: "once", once: "2026-10-18T09:00" }))).toContain("pays for Brightline Logistics, not for Alex Rivera");
  });
});

describe("the hub is told, by the same rule, where money its reader only manages may not go", () => {
  test("the trust's allowance, on its trustee's money, may pay its beneficiary but not him or his checking; his own names are his keys", () => {
    const { w } = setup((wd) => {
      wd.entities.family_trust = entity("family_trust", "trust", "Chen Family Trust", { owners: [{ party: "you", role: "trustee" }, { party: "maya", role: "beneficiary", share: 100 }] }, "principal");
      wd.entities.trust_acct = entity("trust_acct", "account", "Trust account", { owners: [{ party: "family_trust", role: "owner" }], product: "checking", opening: 5_000_000 });
      wd.entities.trust_allowance = entity("trust_allowance", "flow", "Maya's allowance", { flow_kind: "transfer", from: "family_trust", to: "maya_checking", amount_cents: 100_000, every: "day", shortfall: "skip", status: "active" });
    });
    const view = w.ctx.query("economy.finance")(w.ctx, "you", true) as FinanceView;
    const trust = view.paysFor.find((p) => p.from === "family_trust")?.to ?? [];
    expect(trust).toEqual(expect.arrayContaining(["you", "checking"]));
    expect(trust).not.toContain("maya_checking");
    // What the hub refuses agrees with the actions.
    for (const to of trust) expect(refusal(act(w, "economy.flow_create", { who: "you", label: "Test", from: "family_trust", to, amount: 100, every: "day" }))).toContain("pays for itself");
    expect(view.ownKeys).toEqual(["you", "alex_rivera"]);
  });

  test("a business page names whom its custodian may neither hire nor raise there, and no one for its owner", () => {
    const custodian = setup((wd) => Object.assign(wd.entities.daybreak!.fields, { owners: [{ party: "you", role: "custodian" }, { party: "maya", role: "beneficiary", share: 100 }] })).w;
    const page = (w: typeof custodian) => (w.ctx.query("economy.finance")(w.ctx, "you", true) as FinanceView).businesses.find((b) => b.id === "daybreak");
    expect(page(custodian)?.selfDealing).toEqual(["you"]);
    const owner = setup((wd) => Object.assign(wd.entities.daybreak!.fields, { owners: [{ party: "you", role: "owner", share: 100 }] })).w;
    expect(page(owner)?.selfDealing).toEqual([]);
  });

  test("the café's custodian is told its savings may not go into the till he has a card on, and its owner that they may", () => {
    const till = (role: "custodian" | "owner") => {
      const { w } = setup((wd) => {
        Object.assign(wd.entities.daybreak!.fields, { owners: role === "owner" ? [{ party: "you", role: "owner", share: 100 }] : [{ party: "you", role: "custodian" }, { party: "maya", role: "beneficiary", share: 100 }] });
        wd.entities.db_operating!.fields.owners = [{ party: "daybreak", role: "owner" }, { party: "you", role: "authorized_user" }];
        wd.entities.db_savings = account("db_savings", "daybreak", "savings", 5_000_000);
      });
      return (w.ctx.query("economy.finance")(w.ctx, "you", true) as FinanceView).paysFor.find((p) => p.from === "db_savings")?.to ?? [];
    };
    expect(till("custodian")).toContain("db_operating");
    expect(till("owner")).not.toContain("db_operating");
  });
});
