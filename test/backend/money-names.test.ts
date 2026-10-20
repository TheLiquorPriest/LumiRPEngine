// The player's money view names everyone outside the world in words (DESIGN §25.11): the
// foundation's and the modules' own payees ("Federal tax", "Property upkeep", "Sales tax
// (Michigan)"), an outside employer by its place, a managed property's tenants, and an author's
// own payees as written, naming only what the player may see. Each journal line names the other
// side of its own payment (§25.6): who it paid, or who paid it. Port Alder chats on the fake host,
// as Play → Money decodes them.

import { describe, expect, test } from "bun:test";
import type { FinanceView } from "../../src/shared/finance";
import { endableLeases } from "../../src/packs/economy/ui/layout";
import { invoiceAction, tradeAction, transferAction } from "../../src/packs/economy/ui/requests";
import { MoneyChat } from "../support/money-chat";

/** Every name a view gives a side of money: its flows' two ends and its transactions' other parties. */
function namesIn(view: FinanceView): string[] {
  return [...view.flows.flatMap((f) => [f.from, f.to]), ...view.accounts.flatMap((a) => a.transactions.flatMap((t) => (t.counterparty === null ? [] : [t.counterparty])))];
}

function flow(view: FinanceView, id: string): { from: string; to: string } {
  const f = view.flows.find((x) => x.id === id);
  if (!f) throw new Error(`no flow ${id} in ${view.name}'s money`);
  return { from: f.from, to: f.to };
}

describe("the player's money view names outside payees in words", () => {
  test("a homeowner's property costs and a business's sales tax name who they pay, an author's payees read as written, and no side is a key", async () => {
    const chat = await MoneyChat.start({ pov: "marcus_delgado" });
    // Past Tuesday the 15th, when the house's upkeep is paid.
    await chat.timelapse(2 * 1440);
    const view = await chat.hub();
    expect(flow(view, "property_tax:prop_marcus_home").to).toBe("Property tax (Michigan)");
    expect(flow(view, "property_insurance:prop_marcus_home").to).toBe("Property insurance");
    expect(flow(view, "property_upkeep:prop_marcus_home").to).toBe("Property upkeep");
    expect(flow(view, "esttax:marcus_delgado").to).toBe("Federal tax");
    expect(flow(view, "salestax:alder_automotive_co").to).toBe("Sales tax (Michigan)");
    expect(flow(view, "insurance:shop_tow_truck").to).toBe("Insurer");
    expect(flow(view, "flow_shop_lease").to).toBe("Harbor Realty");
    expect(flow(view, "bill_marcus_shop_electric").to).toBe("Alder Light & Power");
    const upkeep = view.accounts.flatMap((a) => a.transactions).find((t) => t.memo === "Upkeep, Marcus's house");
    expect(upkeep?.counterparty).toBe("Property upkeep");
    expect(namesIn(view).filter((n) => n.includes(":"))).toEqual([]);
  });

  test("an outside employer reads as the place the job names, and a managed property's tenants as outside tenants", async () => {
    const jess = await (await MoneyChat.start({ pov: "jess_kowalczyk" })).hub();
    expect(jess.jobs.map((j) => j.employer)).toEqual(["The Rusty Anchor"]);
    expect(flow(jess, "pay:job_jess_kowalczyk").from).toBe("The Rusty Anchor");
    expect(namesIn(jess).filter((n) => n.includes(":"))).toEqual([]);
    const helen = await (await MoneyChat.start({ pov: "helen_kowalczyk" })).hub();
    const leases = helen.flows.filter((f) => f.id.startsWith("lease:prop_harbor_114:"));
    expect(leases.length).toBeGreaterThan(0);
    expect(leases.map((f) => f.from)).toEqual(leases.map(() => "Outside tenant"));
    expect(namesIn(helen).filter((n) => n.includes(":"))).toEqual([]);
  });

  test("the player's vehicles are insured by an insurer, not a key", async () => {
    const view = await (await MoneyChat.start()).hub();
    expect(flow(view, "insurance:pov_truck").to).toBe("Insurer");
    expect(namesIn(view).filter((n) => n.includes(":"))).toEqual([]);
  });
});

describe("an outside name says only what the player may see", () => {
  test("someone hidden from the player, named inside an outside key, reads as someone, as they would by id", async () => {
    const chat = await MoneyChat.start({ secret: ["danny_okafor"] });
    for (const [label, to] of [["By id", "danny_okafor"], ["To his bank", "bank:danny_okafor"], ["As his employer", "employer:danny_okafor"]]) {
      expect(await chat.play({ action: "flow_create", params: { label, from: "acct_pov_checking", to, amount: 500, every: "once", once: "2026-09-14T10:00" } })).toContain("done");
    }
    await chat.timelapse(1440);
    const view = await chat.hub();
    const lines = view.accounts.flatMap((a) => a.transactions);
    for (const label of ["By id", "To his bank", "As his employer"]) {
      expect(view.flows.find((f) => f.label === label)).toMatchObject({ to: "someone", spec: null });
      expect(lines.find((t) => t.memo === label)?.counterparty).toBe("someone");
    }
    expect(JSON.stringify((await chat.state()).panels["economy.money"])).not.toContain("Danny");
  });
});

describe("an id or a link that would name someone hidden reaches the player under a stand-in", () => {
  test("Danny's job, where Marcus can't see him, is the shop's Mechanic: its payroll links it by title and employer under the id its row on the shop's page has, and nothing on his money names Danny", async () => {
    const chat = await MoneyChat.start({ pov: "marcus_delgado", secret: ["danny_okafor"] });
    const view = await chat.hub();
    const pay = view.flows.find((f) => f.label === "Pay: Mechanic" && f.to === "someone");
    expect(pay?.link?.name).toBe("Mechanic at Alder Automotive");
    const row = view.businesses.find((b) => b.id === "alder_automotive_co")?.employees.find((j) => j.worker === "an employee");
    expect(row?.id).toBe(pay?.link?.id ?? "");
    expect(view.overview?.upcoming.some((u) => u.flow === pay?.id)).toBe(true);
    expect(JSON.stringify((await chat.state()).panels["economy.money"]).toLowerCase()).not.toContain("danny");
    // The GM's views name him.
    const gm = await chat.party("marcus_delgado");
    expect(gm.flows.find((f) => f.id === "pay:job_danny_mechanic")?.link).toEqual({ id: "job_danny_mechanic", name: "Danny's job at Alder Automotive" });
  });

  test("Jess's share into the household account is coming up on Helen's money, where she can't see Jess, without Jess's account", async () => {
    // Her job is named for her, so it's secret with her.
    const chat = await MoneyChat.start({ pov: "helen_kowalczyk", secret: ["jess_kowalczyk", "job_jess_kowalczyk"] });
    const upcoming = (await chat.hub()).overview?.upcoming ?? [];
    const share = upcoming.filter((u) => u.label === "Household share, 1A");
    expect(share.length).toBeGreaterThan(0);
    expect(share.map((u) => [u.account, u.flow?.startsWith("hidden:")])).toEqual(share.map(() => [null, true]));
    expect(JSON.stringify(upcoming).toLowerCase()).not.toContain("jess");
  });

  test("a lease of a tenant Helen can't see keeps its id, as she ends it by its id from her building's page", async () => {
    const chat = await MoneyChat.start({ pov: "helen_kowalczyk", secret: ["danny_okafor"] });
    const view = await chat.hub();
    const harbor = view.properties.find((p) => p.id === "prop_harbor_114");
    if (!harbor) throw new Error("Helen's building isn't on her money");
    expect(view.flows.find((f) => f.id === "bill_danny_rent")).toMatchObject({ from: "someone", spec: null });
    expect(endableLeases(view, harbor)).toContain("bill_danny_rent");
  });
});

describe("a label or a memo names only what the player may see", () => {
  test("with the shop's lift loan secret, its autopay reaches Marcus's money as a loan's, in his standing payments, what's coming up and the line it posts, while the GM's views name it", async () => {
    const chat = await MoneyChat.start({ pov: "marcus_delgado", secret: ["acct_alder_lift_loan"] });
    // Past the 15th, when the autopay first runs.
    await chat.timelapse(2 * 1440);
    const view = await chat.hub();
    expect(view.flows.filter((f) => f.label === "Loan autopay").length).toBe(1);
    expect(view.overview?.upcoming.some((u) => u.label === "Loan autopay")).toBe(true);
    expect(view.accounts.find((a) => a.id === "acct_marcus_shop")?.transactions.some((t) => t.memo === "Loan autopay")).toBe(true);
    expect(JSON.stringify((await chat.state()).panels["economy.money"])).not.toContain("Lift loan");
    expect((await chat.party("marcus_delgado")).flows.map((f) => f.label)).toContain("Lift loan autopay");
  });
});

describe("each journal line names the other side of its own payment", () => {
  const SHOP = "acct_marcus_shop";
  const CHECKING = "acct_pov_checking";

  /** The other side of each of an account's lines with this memo, newest first, as the view names it. */
  function others(view: FinanceView, account: string, memo: string | RegExp): (string | null)[] {
    const a = view.accounts.find((x) => x.id === account);
    if (!a) throw new Error(`no ${account} in ${view.name}'s money`);
    return a.transactions.filter((t) => (typeof memo === "string" ? t.memo === memo : memo.test(t.memo))).map((t) => t.counterparty);
  }

  // Both of the shop's invoices fall due on Tuesday the 15th, and Jordan owes for the trailer brakes.
  const invoices = { inv_road_commission: { due: "2026-09-15" }, inv_dale_trailer: { customer: "pov", due: "2026-09-15" } };

  test("on the shop's account Marcus reads who paid it: walk-in customers, an outside customer by name and Jordan by his, or someone where he can't see Jordan", async () => {
    const chat = await MoneyChat.start({ pov: "marcus_delgado", entities: invoices });
    await chat.timelapse(2 * 1440);
    const view = await chat.hub();
    expect(others(view, SHOP, "Walk-in takings")).toEqual(["Walk-in customers", "Walk-in customers"]);
    expect(others(view, SHOP, "Invoice: Fleet service")).toEqual(["Port Alder Road Commission"]);
    expect(others(view, SHOP, "Invoice: Trailer brakes")).toEqual(["Jordan Ellis"]);
    // The shop paying its own loan, and its opening, name no one.
    expect(others(view, SHOP, "Lift loan autopay")).toEqual([null]);
    expect(others(view, SHOP, "Opening balance")).toEqual([null]);

    const hidden = await MoneyChat.start({ pov: "marcus_delgado", entities: invoices, secret: ["pov"] });
    await hidden.timelapse(2 * 1440);
    expect(others(await hidden.hub(), SHOP, "Invoice: Trailer brakes")).toEqual(["someone"]);
  });

  test("Jordan's own lines name who he paid and who paid him, the shop's books name him, and money between his own accounts names no one", async () => {
    const chat = await MoneyChat.start({ entities: { inv_dale_trailer: { customer: "pov" } } });
    expect(await chat.play(invoiceAction("inv_dale_trailer", "pay"))).toContain("done");
    expect(await chat.play(transferAction(CHECKING, "acct_pov_savings", chat.cents("50")))).toContain("done");
    // Past his first payday, Friday the 18th.
    await chat.timelapse(5 * 1440);
    const view = await chat.hub();
    expect(others(view, CHECKING, "Invoice: Trailer brakes")).toEqual(["Alder Automotive"]);
    expect(others(view, CHECKING, /^Payroll/)).toEqual(["Alder Automotive"]);
    expect(others(view, CHECKING, "Transfer")).toEqual([null]);
    expect(others(view, "acct_pov_savings", "Transfer")).toEqual([null]);
    const shop = await chat.party("alder_automotive_co");
    expect(others(shop, SHOP, "Invoice: Trailer brakes")).toEqual(["Jordan Ellis"]);
    expect(others(shop, SHOP, /^Payroll/)).toEqual(expect.arrayContaining(["Jordan Ellis", "Danny Okafor"]));
  });

  test("on the Kowalczyks' joint account each of them reads the other's share in by name, and their own as no one", async () => {
    const JOINT = "acct_kowalczyk_household";
    for (const [pov, mine, theirs, them] of [
      ["helen_kowalczyk", "Household share", "Household share, 1A", "Jess Kowalczyk"],
      ["jess_kowalczyk", "Household share, 1A", "Household share", "Helen Kowalczyk"],
    ] as const) {
      const chat = await MoneyChat.start({ pov });
      // Both pay their shares in on the 1st of October; a timelapse stops where something interrupts it, so time passes until they're in.
      let view = await chat.hub();
      for (let i = 0; i < 12 && others(view, JOINT, theirs).length === 0; i++) {
        await chat.timelapse(4 * 1440);
        view = await chat.hub();
      }
      expect(others(view, JOINT, mine)).toEqual([null]);
      expect(others(view, JOINT, theirs)).toEqual([them]);
    }
  }, 120_000);

  test("a trade names the market it was made on, never its key", async () => {
    const chat = await MoneyChat.start();
    const buy = tradeAction({ side: "buy", holding: "", asset: "broad_us_equity_index", account: "acct_pov_brokerage", qty: null, amount: "100", from: CHECKING, to: "", option: null }, chat.currency);
    if (typeof buy === "string") throw new Error(buy);
    expect(await chat.play(buy)).toContain("done");
    const view = await chat.hub();
    expect(others(view, CHECKING, /^Bought/)).toEqual(["Market"]);
    expect(view.accounts.flatMap((a) => a.transactions.flatMap((t) => (t.counterparty?.includes(":") ? [t.counterparty] : [])))).toEqual([]);
  });
});
