// N3 lane A4, money and org fixes: a loan entered in credit, corrections kept out of the books and
// In & out, one worth for companies and trusts, unpaid titles, a trust's payout, a business's site,
// In & out's direction and whose, and an organization with no account. The work module's Riverton.

import { describe, expect, test } from "bun:test";
import type { FinanceView } from "../../../src/shared/finance";
import type { JsonObject } from "../../../src/shared/json";
import type { OrgAlertView } from "../../../src/shared/org-feed";
import { lintWorld } from "../../../src/engine/authoring";
import { businessAt } from "../../../src/engine/org";
import { materializeIfNeeded } from "../../../src/engine/materialize";
import { optionalService } from "../../../src/engine/pack-kit";
import type { Working } from "../../../src/engine/working";
import { orgAlerts } from "../../../src/packs/orgs/core/feed";
import { resolveEdit } from "../../../src/engine/edits";
import { openAccountOps, openProducts } from "../../../src/packs/economy/ui/accounts";
import { activityOf, ALL_ACTIVITY, flowKept } from "../../../src/packs/economy/ui/layout";
import { account, act, entity, lapse, payslips, posts, reg, setup } from "./work-world";

const DAY = 1440;
const view = (w: Working, party: string, player = false): FinanceView => w.ctx.query("economy.finance")(w.ctx, party, player) as FinanceView;
const TRUST_OWNERS: JsonObject[] = [{ party: "jordan", role: "trustee" }, { party: "maya", role: "beneficiary", share: 60 }, { party: "rosa", role: "beneficiary", share: 40 }];

describe("a loan entered in credit", () => {
  test("lint warns with a Fix that makes it owed, nothing on a loan is available, and its page warns it is in credit", () => {
    const { world, w } = setup((wd) => {
      wd.entities.car_loan = entity("car_loan", "account", "Car loan", { owners: [{ party: "you", role: "owner" }], product: "loan", opening: 500_000 });
    });
    const issues = lintWorld(world, reg);
    const issue = issues.find((i) => i.path === "entities.car_loan.fields.opening");
    expect(issue?.severity).toBe("warning");
    expect(issue?.fix?.ops).toEqual([{ op: "add", path: "/entities/car_loan/fields/opening", value: -500_000 }]);
    expect(issues.some((i) => i.path === "entities.car_loan.fields.due_day" && i.severity === "info")).toBe(true);
    const v = view(w, "you");
    expect(v.accounts.find((a) => a.id === "car_loan")?.available).toBeNull();
    expect(v.overview?.alerts.some((a) => a.account === "car_loan" && /in credit by/.test(a.text))).toBe(true);
  });
});

describe("a correction is bookkeeping", () => {
  test("a GM's money into a business's account is badged in Activity, out of its In, and out of its cash flow", () => {
    const { w } = setup();
    const events = optionalService(w.ctx, "economy.adjust")?.(w.ctx, "bl_operating", 100_000);
    expect(Array.isArray(events)).toBe(true);
    if (Array.isArray(events)) w.applyAll(events);
    const v = view(w, "brightline");
    expect(activityOf(v, ALL_ACTIVITY).lines.some((l) => l.category === "correction")).toBe(true);
    expect(activityOf(v, { ...ALL_ACTIVITY, direction: "in" }).lines.some((l) => l.category === "correction")).toBe(false);
    expect(v.overview?.cashFlow?.byCategory.some((c) => c.category === "correction")).toBe(false);
  });
});

describe("one worth for companies and trusts", () => {
  test("a company's net worth counts what it is owed, and a beneficiary counts their share of a trust", () => {
    const { w } = setup((wd) => {
      wd.entities.family_trust = entity("family_trust", "trust", "Ellis Family Trust", { owners: TRUST_OWNERS }, "principal");
      wd.entities.ft_account = account("ft_account", "family_trust", "trust", 1_000_000);
      wd.entities.inv_open = entity("inv_open", "invoice", "Consulting", { business: "brightline", customer: "rosa", cents: 30_000, memo: "Consulting", issued: "2026-10-01", due: "2026-11-30", state: "open" });
    });
    expect(view(w, "brightline").overview?.breakdown.some((l) => l.label === "Owed to it" && l.cents === 30_000)).toBe(true);
    expect(view(w, "maya").overview?.breakdown.some((l) => l.label.startsWith("Ellis Family Trust") && l.cents === 600_000)).toBe(true);
  });
});

describe("unpaid titles and a trust's payout", () => {
  test("an unpaid job has no payslip; a raise starts pay from the raise", () => {
    const { w } = setup((wd) => {
      wd.entities.job_director = entity("job_director", "job", "Director", { worker: "maya", employer: "brightline", title: "Director", basis: "salary", pay_every: "none", start: "2025-01-05" });
    });
    lapse(w, 40 * DAY);
    expect(payslips(w, "job_director")).toEqual([]);
    const r = act(w, "economy.job_raise", { job: "job_director", rate: 5_200_000 });
    expect(r.rejected).toEqual([]);
    lapse(w, 40 * DAY);
    const slips = payslips(w, "job_director").filter((s) => typeof s.gross === "number" && s.gross > 0);
    expect(slips.length).toBeGreaterThan(0);
    // A whole month's salary at most: nothing back to the job's start.
    for (const s of slips) expect(Number(s.gross)).toBeLessThanOrEqual(Math.ceil(5_200_000 / 12) + 1);
  });

  test("a trust pays a stated amount out to its beneficiaries by share, and asks for an amount", () => {
    const { w } = setup((wd) => {
      wd.entities.family_trust = entity("family_trust", "trust", "Ellis Family Trust", { owners: TRUST_OWNERS }, "principal");
      wd.entities.ft_account = account("ft_account", "family_trust", "trust", 1_000_000);
    });
    // Its money opens as anyone's does when the story first reads it.
    materializeIfNeeded(reg, w, "family_trust", "money", "run");
    expect(act(w, "economy.distribute", { business: "family_trust", cents: 10_000, by: "jordan" }).rejected).toEqual([]);
    const paid = posts(w, /^Trust distribution/)[0];
    expect(paid?.lines.find((l) => l.account === "ft_account")?.amount).toBe(-10_000);
    expect(paid?.lines.find((l) => l.account === "maya_checking")?.amount).toBe(6_000);
    expect(paid?.lines.find((l) => l.account === "rosa_checking")?.amount).toBe(4_000);
    expect(act(w, "economy.distribute", { business: "family_trust", by: "jordan" }).rejected.map((x) => x.rejection.code)).toEqual(["bad_amount"]);
  });
});

describe("a business trades within its own building or site", () => {
  test("a business whose place is the whole town takes no purchase made in another building", () => {
    const { w } = setup((wd) => {
      wd.entities.townco = entity("townco", "business", "Riverton Holdings", { places: ["riverton"], owners: [{ party: "jordan", role: "owner", share: 100 }] });
    });
    expect(businessAt(w.ctx, "cafe")).toBe("daybreak");
    expect(businessAt(w.ctx, "park")).toBeNull();
    expect(businessAt(w.ctx, "riverton")).toBe("townco");
  });
});

describe("In & out reads whose money a flow is", () => {
  test("a bill of a company the player runs reads Out, whose the company", () => {
    const { w } = setup((wd) => {
      wd.entities.brightline!.fields.owners = [{ party: "you", role: "owner", share: 100 }];
      wd.entities.bl_rent = entity("bl_rent", "flow", "Office rent", { flow_kind: "rent", from: "bl_operating", to: "Landlord", amount_cents: 200_000, every: "month", days: [1], shortfall: "skip", status: "active" });
    });
    const rent = view(w, "you", true).flows.find((f) => f.label === "Office rent");
    expect(rent?.direction).toBe("out");
    expect(rent?.whose?.id).toBe("brightline");
    expect(rent ? flowKept(rent, { ...ALL_ACTIVITY, direction: "in" }) : null).toBe(false);
    expect(rent ? flowKept(rent, { ...ALL_ACTIVITY, direction: "out", whose: "brightline" }) : null).toBe(true);
  });
});

describe("an organization with no account", () => {
  test("lint offers to open one, and its page alerts no_account", () => {
    const { world, w } = setup((wd) => {
      wd.entities.lemonade = entity("lemonade", "business", "Lemonade Stand", { places: ["park"], owners: [{ party: "you", role: "owner", share: 100 }] }, "principal");
    });
    const issue = lintWorld(world, reg).find((i) => i.code === "economy.no_account" && i.path === "entities.lemonade");
    expect(issue?.fix?.ops[0]?.path).toBe("/entities/lemonade_checking");
    const alerts: OrgAlertView[] = orgAlerts(w.ctx, "lemonade", "you") ?? [];
    expect(alerts.map((a) => a.kind)).toContain("no_account");
  });

  test("GM → Orgs → Money's Open an account opens an empty business checking it owns, and the alert goes", () => {
    const { w } = setup((wd) => {
      wd.entities.lemonade = entity("lemonade", "business", "Lemonade Stand", { places: ["park"], owners: [{ party: "you", role: "owner", share: 100 }] }, "principal");
    });
    expect(openProducts("business")).toEqual(["business_checking", "checking", "savings"]);
    expect(openProducts("trust")[0]).toBe("trust");
    const out = resolveEdit(reg, w.world, w.state, openAccountOps("lemonade", "business_checking", ""), { gm: true, runSeed: "open" });
    if (!("events" in out)) throw new Error(out.rejection.reason);
    w.applyAll(out.events);
    const opened = view(w, "lemonade").accounts;
    expect(opened.map((a) => [a.name, a.class, a.cents])).toEqual([["Lemonade Stand checking", "business_checking", 0]]);
    expect((orgAlerts(w.ctx, "lemonade", "you") ?? []).map((a) => a.kind)).not.toContain("no_account");
    // A player can't run it: it is the GM's.
    const played = resolveEdit(reg, w.world, w.state, openAccountOps("lemonade", "savings", "Rainy day"), { gm: false, runSeed: "open" });
    expect("rejection" in played ? played.rejection.code : null).toBe("not_editable");
  });
});
