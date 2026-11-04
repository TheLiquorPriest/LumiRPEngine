// The starters' organizations (ORG-SPEC §11 Phase 2, Data; lane H): Alder Automotive's Mechanic
// position; the Thornes with their Master, their staff in the Butler's, the Housekeeper's and the
// Housemaid's positions, Lady Honoria's and Julian Ashcombe's delegations, and the Thorne Trust;
// Brindlemere's ferry crew, the Crooked Kettle and the Reeve's office. Each starter lints clean of
// every organization problem.

import { describe, expect, test } from "bun:test";
import { lintWorld } from "../../../src/engine/authoring";
import { businessAt, headOf, jobsAt, mayAct, orgPower, orgPowers, orgTitle, orgTypeOf, placeEntry, positionsOf, trading } from "../../../src/engine/org";
import { Working } from "../../../src/engine/working";
import { ownersIn } from "../../../src/shared/finance";
import type { WorldDoc } from "../../../src/shared/world";
import { STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";
import { registry } from "./play";

function start(id: string): Working {
  const world = (STARTER_WORLDS[id] as (id: string, name: string) => WorldDoc)("w", id);
  return new Working(registry, world, startState(world));
}

describe("every starter's organizations lint clean", () => {
  for (const id of Object.keys(STARTER_WORLDS)) {
    test(id, () => {
      const w = start(id);
      const issues = lintWorld(w.world, registry).filter((i) => i.code.startsWith("orgs."));
      // Port Alder's Helen heads the Kowalczyks by her title: information, never a problem.
      expect(issues.map((i) => [i.severity, i.code])).toEqual(id === "modern_slice_of_life" ? [["info", "orgs.head_title"]] : []);
    });
  }
});

describe("Port Alder: Alder Automotive's positions", () => {
  const w = start("modern_slice_of_life");
  const SHOP = "alder_automotive_co";

  test("both mechanics' jobs hold its Mechanic position, which carries no power of its own", () => {
    expect(positionsOf(w.ctx, SHOP)).toEqual([{ id: "mechanic", title: "Mechanic", powers: [], seats: 0, scope: "org", successor: "vacant" }]);
    expect(jobsAt(w.ctx, SHOP).map((job) => [w.state.entities[job]?.fields.worker, w.state.entities[job]?.fields.position])).toEqual([
      ["danny_okafor", "mechanic"],
      ["pov", "mechanic"],
    ]);
    expect(orgTitle(w.ctx, "pov", SHOP)).toBe("Mechanic");
    expect(orgTitle(w.ctx, "danny_okafor", SHOP)).toBe("Mechanic");
    expect(orgPowers(w.ctx, "pov", SHOP)).toEqual([]);
  });
});

describe("Harrowmere: the Thornes and the Thorne Trust", () => {
  const w = start("mystery_manor");
  const THORNES = "household_thorne";
  const TRUST = "thorne_trust";

  test("the Thornes are a household of Sir Alaric, Lady Honoria and Captain Rupert, Sir Alaric its Master", () => {
    expect([orgTypeOf(w.ctx, THORNES), w.world.entities[THORNES]?.name]).toEqual(["household", "The Thornes"]);
    expect(headOf(w.ctx, THORNES)).toBe("sir_alaric");
    expect(orgPower(w.ctx, "sir_alaric", THORNES, "delegate")).toEqual({ basis: "position", id: "head" });
    expect(orgPowers(w.ctx, "sir_alaric", THORNES)).toHaveLength(21);
    expect(["sir_alaric", "lady_honoria", "rupert_thorne"].map((who) => orgTitle(w.ctx, who, THORNES))).toEqual(["Master of Harrowmere", "Lady of the house", "Heir"]);
  });

  test("its positions: the Master, whom Captain Rupert succeeds; the Butler and the Housekeeper under him; the Housemaid under the Housekeeper", () => {
    expect(positionsOf(w.ctx, THORNES).map((p) => [p.id, p.title, p.reports_to ?? null, p.seats, p.successor])).toEqual([
      ["head", "Master", null, 1, "rupert_thorne"],
      ["butler", "Butler", "head", 1, "vacant"],
      ["housekeeper", "Housekeeper", "head", 1, "vacant"],
      ["housemaid", "Housemaid", "housekeeper", 0, "vacant"],
    ]);
    expect(positionsOf(w.ctx, THORNES).find((p) => p.id === "housekeeper")?.powers).toEqual(["assets.use", "assets.dispose", "orders.give"]);
  });

  test("its staff are employed by the household, each job in its position, paid weekly on Friday", () => {
    expect(
      jobsAt(w.ctx, THORNES).map((job) => {
        const f = w.state.entities[job]?.fields ?? {};
        return [f.worker, f.position, f.title, f.basis, f.pay_every, f.pay_weekday];
      }),
    ).toEqual([
      ["gideon_pell", "butler", "Butler", "salary", "weekly", 5],
      ["mrs_marsh", "housekeeper", "Cook and housekeeper", "salary", "weekly", 5],
      ["nell_sparrow", "housemaid", "Housemaid", "salary", "weekly", 5],
    ]);
    // The household holds an account of its own to pay them from.
    expect(ownersIn(w.state.entities.acct_thorne_household?.fields ?? {}).map((o) => o.party)).toEqual([THORNES]);
  });

  test("Sir Alaric lets Lady Honoria spend the household's money, without limit, and hire, dismiss and pay its staff", () => {
    for (const power of ["money.spend", "staff.hire", "staff.fire", "staff.pay"] as const) expect([power, orgPower(w.ctx, "lady_honoria", THORNES, power)]).toEqual([power, { basis: "delegate", id: "sir_alaric" }]);
    expect(mayAct(w.ctx, "lady_honoria", THORNES, "money.spend", { amount: 1_000_000 })).toEqual({ ok: true, grant: { basis: "delegate", id: "sir_alaric" } });
    // Spending implies seeing the money it reaches; governing the household stays Sir Alaric's.
    expect(orgPower(w.ctx, "lady_honoria", THORNES, "money.view")).toEqual({ basis: "delegate", id: "sir_alaric" });
    expect(orgPower(w.ctx, "lady_honoria", THORNES, "org.govern")).toBeNull();
    expect(orgPower(w.ctx, "lady_honoria", THORNES, "delegate")).toBeNull();
  });

  test("Julian Ashcombe acts for the household over its property and sees its money, and no more", () => {
    expect(orgPower(w.ctx, "julian_ashcombe", THORNES, "property.manage")).toEqual({ basis: "delegate", id: "sir_alaric" });
    expect(orgPower(w.ctx, "julian_ashcombe", THORNES, "money.view")).toEqual({ basis: "delegate", id: "sir_alaric" });
    expect(orgPower(w.ctx, "julian_ashcombe", THORNES, "money.spend")).toBeNull();
    const link = w.state.entities.julian_ashcombe?.relations.find((r) => r.type === "acts_for");
    expect([link?.to, link?.fields?.by, link?.until]).toEqual([THORNES, "sir_alaric", undefined]);
  });

  test("the Thorne Trust: Sir Alaric and Julian Ashcombe its trustees, Lady Honoria and Captain Rupert its beneficiaries", () => {
    expect(orgTypeOf(w.ctx, TRUST)).toBe("trust");
    expect(ownersIn(w.state.entities[TRUST]?.fields ?? {}).map((o) => [o.party, o.role])).toEqual([
      ["sir_alaric", "trustee"],
      ["julian_ashcombe", "trustee"],
      ["lady_honoria", "beneficiary"],
      ["rupert_thorne", "beneficiary"],
    ]);
    expect(orgPower(w.ctx, "julian_ashcombe", TRUST, "money.spend")).toEqual({ basis: "owner" });
    expect(orgPower(w.ctx, "rupert_thorne", TRUST, "money.view")).toEqual({ basis: "owner" });
    expect(orgPower(w.ctx, "rupert_thorne", TRUST, "money.spend")).toBeNull();
    expect(ownersIn(w.state.entities.acct_thorne_trust?.fields ?? {}).map((o) => o.party)).toEqual([TRUST]);
  });
});

describe("Brindlemere: the ferry, the Crooked Kettle and the Reeve's office", () => {
  const w = start("fantasy_town");

  test("the Reeve's office: Hollis Garrow holds its Reeve of Brindlemere, and the town strongbox is the office's", () => {
    expect(orgTypeOf(w.ctx, "reeves_office")).toBe("group");
    expect(orgTitle(w.ctx, "hollis_garrow", "reeves_office")).toBe("Reeve of Brindlemere");
    expect(orgPower(w.ctx, "hollis_garrow", "reeves_office", "money.spend")).toEqual({ basis: "position", id: "reeve" });
    expect(orgPower(w.ctx, "hollis_garrow", "reeves_office", "shares.manage")).toBeNull();
    expect(ownersIn(w.state.entities.acct_hollis_strongbox?.fields ?? {}).map((o) => o.party)).toEqual(["reeves_office"]);
    expect(w.state.entities.reeves_strongbox?.fields.owner).toBe("reeves_office");
    // The market dues and hearth taxes are paid into it.
    expect(["bill_kettle_market_dues", "bill_marta_hearth_tax", "bill_joss_hearth_tax", "bill_wren_hearth_tax"].map((f) => w.state.entities[f]?.fields.to)).toEqual(Array(4).fill("acct_hollis_strongbox"));
  });

  test("the Wend Ferry's crew: Tamsin Reed, its Ferrywoman, and Pip Marlow, a ferry hand under her", () => {
    expect(orgTypeOf(w.ctx, "ferry_crew")).toBe("group");
    expect(positionsOf(w.ctx, "ferry_crew").map((p) => [p.id, p.reports_to ?? null, p.seats])).toEqual([
      ["ferrywoman", null, 1],
      ["ferry_hand", "ferrywoman", 0],
    ]);
    expect(orgTitle(w.ctx, "tamsin_reed", "ferry_crew")).toBe("Ferrywoman");
    expect(orgTitle(w.ctx, "pip_marlow", "ferry_crew")).toBe("Ferry hand");
    expect(orgPower(w.ctx, "tamsin_reed", "ferry_crew", "members.admit")).toEqual({ basis: "position", id: "ferrywoman" });
    expect(orgPower(w.ctx, "pip_marlow", "ferry_crew", "members.admit")).toBeNull();
  });

  test("the Crooked Kettle: Odo Kettleby's inn, trading at its place at every hour, open to all on the Reaping Feast too, with its till its own", () => {
    expect(orgTypeOf(w.ctx, "kettle_inn")).toBe("company");
    expect(orgPower(w.ctx, "odo_kettleby", "kettle_inn", "money.spend")).toEqual({ basis: "owner" });
    expect(businessAt(w.ctx, "crooked_kettle")).toBe("kettle_inn");
    expect(ownersIn(w.state.entities.acct_kettle_till?.fields ?? {}).map((o) => o.party)).toEqual(["kettle_inn"]);
    // An inn its lodgers come back to at any hour: open round the clock (these three days before the Reaping Feast, a day off).
    for (let h = 0; h < 3 * 24; h++) expect([h, trading(w.ctx, "kettle_inn", w.state.clock + h * 60)]).toEqual([h, true]);
    // The town keeps the Feast there: its entry stays public through the day off, as at every other hour.
    for (let h = 0; h < 10 * 24; h++) expect([h, placeEntry(w.ctx, "crooked_kettle", w.state.clock + h * 60)]).toEqual([h, "public"]);
  });
});
