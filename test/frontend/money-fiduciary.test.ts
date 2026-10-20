// What the money hub offers someone who manages money that isn't theirs (DESIGN §25.1), on the work
// module's Riverton as the engine serves it: each case the backend's fiduciary tests play, with
// the hub refusing, or leaving out, exactly what the action refuses, and offering what it takes.

import { describe, expect, test } from "bun:test";
import type { FinanceView } from "../../src/shared/finance";
import type { JsonObject } from "../../src/shared/json";
import type { PaletteView } from "../../src/shared/state-view";
import type { WorldDoc } from "../../src/shared/world";
import type { Working } from "../../src/engine/working";
import { decodeFinanceView } from "../../src/packs/economy/ui/decode";
import { autopaySources, findAccount, flowControls, flowTargets, hireable, jobControls, payeeProblem } from "../../src/packs/economy/ui/layout";
import { account, act, entity, lapse, setup } from "../packs/economy/work-world";

/** The player's money as the hub draws it, through the JSON the panel receives. */
function hub(w: Working): FinanceView {
  const v = decodeFinanceView(JSON.parse(JSON.stringify(w.ctx.query("economy.finance")(w.ctx, "you", true))));
  if (!v) throw new Error("the hub can't draw the player's money");
  return v;
}

/** Riverton's people, as the palette's Pay offers them. */
const PALETTE: PaletteView = { entries: [{ action: "pay", label: "Pay", group: "pay", options: ["maya", "rosa", "jordan"].map((id) => ({ label: id, params: { to: id } })) }], timelapse: null };

/** Whether the backend refuses the effect. */
function refuses(w: Working, type: string, args: JsonObject): boolean {
  return act(w, type, args).rejected.length > 0;
}

/**
 * Each payee, typed or picked, against a standing payment from `payers`: whether the hub refuses it
 * (`payeeProblem`), which must be what `refused` says and what the backend does with `effect`.
 */
function payees(w: Working, v: FinanceView, payers: readonly string[], refused: Readonly<Record<string, boolean>>, effect: (to: string) => [string, JsonObject]): void {
  const names = Object.keys(refused);
  const byHub = names.map((to) => payeeProblem(v, payers, to) !== null);
  expect(Object.fromEntries(names.map((to, i) => [to, byHub[i]]))).toEqual(refused);
  expect(names.map((to) => refuses(w, ...effect(to)))).toEqual(byHub);
}

/** The Chen family trust, the player its trustee for Maya, with an account of its own. */
function trust(wd: WorldDoc): void {
  wd.entities.family_trust = entity("family_trust", "trust", "Chen Family Trust", { owners: [{ party: "you", role: "trustee" }, { party: "maya", role: "beneficiary", share: 100 }] }, "principal");
  wd.entities.trust_acct = entity("trust_acct", "account", "Trust account", { owners: [{ party: "family_trust", role: "owner" }], product: "checking", opening: 5_000_000 });
}

/** A household the player shares with Rosa, and with Maya too when `maya`. */
function household(wd: WorldDoc, maya = false): void {
  wd.entities.home = entity("home", "household", "The household", {});
  for (const id of maya ? ["you", "rosa", "maya"] : ["you", "rosa"]) wd.entities[id]?.relations.push({ type: "member_of", to: "home" });
}

describe("a business or a trust paying as itself pays for itself, in the hub as in the backend", () => {
  test("a trustee editing the trust's own allowance is offered its beneficiary and anyone else, never himself, his accounts or his name", () => {
    const { w } = setup((wd) => {
      trust(wd);
      wd.entities.trust_allowance = entity("trust_allowance", "flow", "Maya's allowance", { flow_kind: "transfer", from: "family_trust", to: "maya_checking", amount_cents: 100_000, every: "day", shortfall: "skip", status: "active" });
    });
    const v = hub(w);
    expect(v.flows.find((f) => f.id === "trust_allowance")).toMatchObject({ editable: true, payer: "family_trust" });
    const to = flowTargets(v, PALETTE, ["family_trust"]).map((t) => t.id);
    expect(to).toEqual(["maya", "rosa", "jordan"]);
    payees(w, v, ["family_trust"], { checking: true, savings: true, you: true, "Alex Rivera": true, " YOU ": true, maya_checking: false, maya: false, "Harbor Parts": false }, (payee) => ["economy.flow_update", { who: "you", flow: "trust_allowance", to: payee }]);
  });
});

describe("what a manager does for the money's own holder, the hub offers", () => {
  test("the café's owner tops up its operating account from its savings, though he holds a card on it, which the hub names as the café's; his own accounts it doesn't pay", () => {
    const { w } = setup((wd) => {
      Object.assign(wd.entities.daybreak?.fields ?? {}, { owners: [{ party: "you", role: "owner", share: 100 }] });
      if (wd.entities.db_operating) wd.entities.db_operating.fields.owners = [{ party: "daybreak", role: "owner" }, { party: "you", role: "authorized_user" }];
      wd.entities.db_savings = account("db_savings", "daybreak", "savings", 5_000_000);
    });
    const v = hub(w);
    expect(findAccount(v, "db_savings")).toMatchObject({ manages: true, spends: false });
    const to = flowTargets(v, PALETTE, ["db_savings"]);
    expect(to.find((t) => t.id === "db_operating")?.label).toBe("db_operating (Daybreak Café's)");
    expect(to.map((t) => t.id)).not.toContain("checking");
    // Each payment its own name: one named alike would be the same flow.
    payees(w, v, ["db_savings"], { db_operating: false, checking: true, savings: true, maya: false, "Alex Rivera": true }, (payee) => ["economy.flow_create", { who: "you", label: `Move to ${payee}`, from: "db_savings", to: payee, amount: 100_000, every: "week", weekday: 1 }]);
  });

  test("a custodian is offered the custodial savings for a custodial card's autopay, never his own checking", () => {
    const custodial: JsonObject[] = [{ party: "you", role: "custodian" }, { party: "maya", role: "beneficiary", share: 100 }];
    const { w } = setup((wd) => {
      wd.entities.kid_savings = entity("kid_savings", "account", "Maya's savings", { owners: custodial, product: "savings", opening: 300_000 });
      wd.entities.kid_card = entity("kid_card", "account", "Maya's card", { owners: custodial, product: "credit_card", opening: -5_000 });
    });
    const v = hub(w);
    const card = findAccount(v, "kid_card");
    if (!card) throw new Error("no custodial card in the view");
    const offered = autopaySources(v, card).map((a) => a.id);
    expect(offered).toEqual(["kid_savings"]);
    const sources = ["kid_savings", "checking", "savings"];
    expect(sources.map((from) => !refuses(w, "economy.set_autopay", { who: "you", account: "kid_card", mode: "full", from }))).toEqual(sources.map((from) => offered.includes(from)));
  });
});

describe("money a manager only manages reaches none of their own interests, in the hub as in the backend", () => {
  /** A trustee who owns the café and shares a household, editing a payment from the trust's account the trustee's view doesn't hold. */
  function trustee(maya: boolean) {
    return setup((wd) => {
      trust(wd);
      household(wd, maya);
      Object.assign(wd.entities.daybreak?.fields ?? {}, { owners: [{ party: "you", role: "owner", share: 100 }] });
      wd.entities.trust_help = entity("trust_help", "flow", "Maya's help", { flow_kind: "transfer", from: "trust_acct", to: "maya_checking", amount_cents: 100_000, every: "month", shortfall: "skip", status: "active" });
    }).w;
  }
  const update = (payee: string): [string, JsonObject] => ["economy.flow_update", { who: "you", flow: "trust_help", to: payee }];

  test("the trust's money pays its beneficiary and anyone else, never his café, his household or what's theirs, picked or typed", () => {
    const w = trustee(false);
    const v = hub(w);
    expect(findAccount(v, "trust_acct")).toBeNull();
    expect(flowTargets(v, PALETTE, ["trust_acct"]).map((t) => t.id)).toEqual(["maya", "jordan"]);
    payees(w, v, ["trust_acct"], { db_operating: true, daybreak: true, rosa: true, home: true, "The household": true, checking: true, maya_checking: false, maya: false, jordan: false, "Harbor Parts": false }, update);
    // Rosa's checking isn't on his money, and the hub's list of where the trust's money may not go names nothing his money doesn't: typed by its id, the hub can't tell, and the backend refuses it.
    expect(payeeProblem(v, ["trust_acct"], "rosa_checking")).toBeNull();
    expect(refuses(w, ...update("rosa_checking"))).toBe(true);
  });

  test("a trust pays its beneficiary though she's of the trustee's household; the rest of it, it doesn't", () => {
    const w = trustee(true);
    const v = hub(w);
    expect(flowTargets(v, PALETTE, ["trust_acct"]).map((t) => t.id)).toEqual(["maya", "jordan"]);
    payees(w, v, ["trust_acct"], { maya_checking: false, maya: false, rosa: true }, update);
  });

  test("Brightline's custodian, who owns the café, isn't offered Pay now on the café's invoice to Brightline; the café pays Brightline's as it likes", () => {
    const { w } = setup((wd) => {
      Object.assign(wd.entities.brightline?.fields ?? {}, { owners: [{ party: "you", role: "custodian" }, { party: "jordan", role: "beneficiary", share: 100 }] });
      Object.assign(wd.entities.daybreak?.fields ?? {}, { owners: [{ party: "you", role: "owner", share: 100 }] });
      wd.entities.inv_consulting = entity("inv_consulting", "invoice", "Consulting", { business: "daybreak", customer: "brightline", cents: 3_000_000, memo: "Consulting", issued: "2026-09-01", due: "2026-10-30", state: "open" });
      wd.entities.inv_courier = entity("inv_courier", "invoice", "Courier", { business: "brightline", customer: "daybreak", cents: 50_000, memo: "Courier", issued: "2026-09-01", due: "2026-10-30", state: "open" });
    });
    lapse(w, 1440);
    const v = hub(w);
    const invoice = (id: string) => {
      const f = v.flows.find((x) => x.source === "invoice" && x.link?.id === id);
      if (!f) throw new Error(`no flow for ${id}`);
      return f;
    };
    expect(flowControls(v, invoice("inv_consulting"))).toEqual([]);
    expect(refuses(w, "economy.invoice_pay", { invoice: "inv_consulting", by: "you" })).toBe(true);
    expect(flowControls(v, invoice("inv_courier"))).toEqual(["pay_now"]);
    expect(refuses(w, "economy.invoice_pay", { invoice: "inv_courier", by: "you" })).toBe(false);
  });

  test("a custodian of the café isn't offered his household to hire, nor Raise on his own job there; an owner is offered both", () => {
    const hire = (worker: string): JsonObject => ({ business: "daybreak", worker, title: "Barista", basis: "hourly", rate: 1_800, pay_every: "weekly", by: "you" });
    const people = PALETTE.entries[0]?.options.map((o) => ({ value: String(o.params.to), label: o.label })) ?? [];
    for (const role of ["custodian", "owner"] as const) {
      const { w } = setup((wd) => {
        household(wd);
        Object.assign(wd.entities.daybreak?.fields ?? {}, { owners: role === "owner" ? [{ party: "you", role, share: 100 }] : [{ party: "you", role }, { party: "maya", role: "beneficiary", share: 100 }] });
        wd.entities.job_you_cafe = entity("job_you_cafe", "job", "Your café shifts", { worker: "you", employer: "daybreak", title: "Barista", basis: "hourly", rate: 1_800, hours: "contract", hours_per_week: 10, pay_every: "weekly", start: "2026-01-05" });
      });
      const v = hub(w);
      const cafe = v.businesses.find((b) => b.id === "daybreak");
      const job = cafe?.employees.find((j) => j.id === "job_you_cafe");
      if (!cafe || !job) throw new Error("no café or job in the view");
      const offered = hireable(cafe, people).map((p) => p.value);
      const raise = jobControls(v, job, cafe).includes("raise");
      expect([role, offered, raise]).toEqual(role === "owner" ? [role, ["maya", "rosa", "jordan"], true] : [role, ["maya", "jordan"], false]);
      expect(people.map((p) => !refuses(w, "economy.hire", hire(p.value)))).toEqual(people.map((p) => offered.includes(p.value)));
      expect(!refuses(w, "economy.job_raise", { job: "job_you_cafe", rate: 4_000, by: "you" })).toBe(raise);
    }
  });
});

describe("money a manager only manages goes into no account they may spend themselves unless some of it is theirs, in the hub as in the backend", () => {
  test("the café's custodian isn't offered the till he has a card on for its savings; its owner, whose money it partly is, is", () => {
    for (const role of ["custodian", "owner"] as const) {
      const { w } = setup((wd) => {
        Object.assign(wd.entities.daybreak?.fields ?? {}, { owners: role === "owner" ? [{ party: "you", role, share: 100 }] : [{ party: "you", role }, { party: "maya", role: "beneficiary", share: 100 }] });
        if (wd.entities.db_operating) wd.entities.db_operating.fields.owners = [{ party: "daybreak", role: "owner" }, { party: "you", role: "authorized_user" }];
        wd.entities.db_savings = account("db_savings", "daybreak", "savings", 5_000_000);
      });
      const v = hub(w);
      expect([role, flowTargets(v, PALETTE, ["db_savings"]).some((t) => t.id === "db_operating")]).toEqual([role, role === "owner"]);
      payees(w, v, ["db_savings"], { db_operating: role === "custodian", checking: true, maya: false, jordan: false }, (payee) => ["economy.flow_create", { who: "you", label: `Sweep to ${payee}`, from: "db_savings", to: payee, amount: 100_000, every: "week", weekday: 1 }]);
    }
  });

  test("a trustee editing the trust's payment isn't offered an account he's custodian of, by account or by its holder's name, though its worth is someone else's", () => {
    const { w } = setup((wd) => {
      trust(wd);
      wd.entities.jordan_kept = entity("jordan_kept", "account", "Jordan's savings", { owners: [{ party: "you", role: "custodian" }, { party: "jordan", role: "beneficiary", share: 100 }], product: "savings", opening: 0 });
      wd.entities.trust_help = entity("trust_help", "flow", "Maya's help", { flow_kind: "transfer", from: "trust_acct", to: "maya_checking", amount_cents: 100_000, every: "month", shortfall: "skip", status: "active" });
    });
    const v = hub(w);
    expect(findAccount(v, "jordan_kept")).toMatchObject({ role: "custodian", spends: true });
    expect(flowTargets(v, PALETTE, ["trust_acct"]).map((t) => t.id)).toEqual(["maya", "rosa"]);
    payees(w, v, ["trust_acct"], { jordan_kept: true, jordan: true, maya_checking: false }, (payee) => ["economy.flow_update", { who: "you", flow: "trust_help", to: payee }]);
  });
});

describe("money wholly its manager's own pays what else they own, never them or their household, in the hub as in the backend", () => {
  /** Brightline, the player's outright or half Jordan's, and the café the player's outright, which bills Brightline; Rosa shares the player's home. */
  function companies(half: boolean): Working {
    const { w } = setup((wd) => {
      household(wd);
      Object.assign(wd.entities.brightline?.fields ?? {}, { owners: half ? [{ party: "you", role: "owner", share: 50 }, { party: "jordan", role: "owner", share: 50 }] : [{ party: "you", role: "owner", share: 100 }] });
      Object.assign(wd.entities.daybreak?.fields ?? {}, { owners: [{ party: "you", role: "owner", share: 100 }] });
      wd.entities.inv_catering = entity("inv_catering", "invoice", "Catering", { business: "daybreak", customer: "brightline", cents: 300_000, memo: "Catering", issued: "2026-09-01", due: "2026-10-30", state: "open" });
    });
    lapse(w, 1440);
    return w;
  }
  const pay = (payee: string): [string, JsonObject] => ["economy.flow_create", { who: "you", label: `Pay ${payee}`, from: "bl_operating", to: payee, amount: 100_000, every: "week", weekday: 1 }];
  /** Pay now on the café's invoice to Brightline, as the hub offers it and as the backend takes it. */
  function payNow(w: Working, v: FinanceView): [boolean, boolean] {
    const f = v.flows.find((x) => x.source === "invoice" && x.link?.id === "inv_catering");
    if (!f) throw new Error("no flow for the café's invoice");
    return [flowControls(v, f).includes("pay_now"), !refuses(w, "economy.invoice_pay", { invoice: "inv_catering", by: "you" })];
  }

  test("owning both outright, the player is offered Pay now on the café's invoice to Brightline, and the café among Brightline's payees; never himself or his household", () => {
    const w = companies(false);
    const v = hub(w);
    expect(flowTargets(v, PALETTE, ["bl_operating"]).map((t) => t.id)).toEqual(["db_operating", "maya", "jordan"]);
    payees(w, v, ["bl_operating"], { db_operating: false, daybreak: false, checking: true, rosa: true, home: true, "Alex Rivera": true, jordan: false }, pay);
    expect(payNow(w, v)).toEqual([true, true]);
  });

  test("with Jordan holding half of Brightline, its money pays nothing else of the player's, and the café's invoice to it has no Pay now", () => {
    const w = companies(true);
    const v = hub(w);
    expect(flowTargets(v, PALETTE, ["bl_operating"]).map((t) => t.id)).toEqual(["maya", "jordan"]);
    payees(w, v, ["bl_operating"], { db_operating: true, daybreak: true, checking: true, rosa: true, jordan: false }, pay);
    expect(payNow(w, v)).toEqual([false, false]);
  });
});
