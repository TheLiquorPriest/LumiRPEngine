// The money hub's work and asset controls end to end (DESIGN §7, §26, §27): jobs, businesses and
// invoices, trades and options, property and leases. Each control is offered where the hub's
// layout offers it, its request is built as the hub builds it and goes over the protocol to the
// backend on the shipped packs, plays as the player's turn or applies as the GM's edit, and the view
// the hub draws next shows what it did. Port Alder at Simulation (Money 4) unless a test sets
// another level.

import { describe, expect, test } from "bun:test";
import type { FinanceView, HoldingView } from "../../src/shared/finance";
import { accountControls, autopaySources, businessAccounts, businessControls, endableLeases, findAccount, flowControls, holdingControls, hubTabs, invoiceControls, jobControls, knownPeople, moveSources, propertyControls, ROUTE_ELSEWHERE, routePick, transferTargets, viewAccounts } from "../../src/packs/economy/ui/layout";
import {
  autopayAction,
  distributeAction,
  drawAction,
  exerciseAction,
  hireAction,
  invoiceAction,
  invoiceIssueAction,
  jobEndAction,
  jobSpawnOps,
  leaseEndAction,
  leaseStartAction,
  newIdFor,
  propertyBuyAction,
  propertySellAction,
  propertySpawnOps,
  raiseAction,
  routeAction,
  routeOps,
  setPriceOps,
  stakeSellAction,
  tradeAction,
  transferAction,
  type ActionBody,
  type TradeForm,
} from "../../src/packs/economy/ui/requests";
import { accepted, account, MoneyChat, refusal } from "../support/money-chat";

const CHECKING = "acct_pov_checking";
const SAVINGS = "acct_pov_savings";
const BROKERAGE = "acct_pov_brokerage";
const JOB = "job_pov_mechanic";
const SHOP = "alder_automotive_co";
const SHOP_ACCOUNT = "acct_marcus_shop";
/** The shop's lift loan, the shop's alone: no one holds a role on it but the shop. */
const LIFT_LOAN = "acct_alder_lift_loan";
const MARCUS = "marcus_delgado";
const MARCUS_CHECKING = "acct_marcus_checking";
const MARCUS_MORTGAGE = "acct_marcus_mortgage";
const DANNY = "danny_okafor";
const DANNY_CHECKING = "acct_danny_checking";
/** Dale has an account, but no job, property or household. */
const DALE = "dale_whitcomb";
const KOWALCZYKS = "household_kowalczyk";
const INDEX = "hold_pov_index";
const LKFR = "hold_pov_lkfr";
/** Marcus's house on Birch Lane, and the POV's rent on 114 Harbor Street. */
const HOUSE = "prop_marcus_home";
const RENT = "bill_rent";
const TODAY = "2026-09-14";

function find<T extends { id: string }>(items: readonly T[], id: string): T {
  const item = items.find((x) => x.id === id);
  if (!item) throw new Error(`no ${id} among ${items.map((x) => x.id).join(", ") || "nothing"}`);
  return item;
}

function holdings(view: FinanceView): HoldingView[] {
  if (!view.investments) throw new Error(`${view.name} has no investments`);
  return view.investments.holdings;
}

/** The POV a 40% owner of Alder Automotive beside Marcus, as the GM's ✎ on its owners sets it. */
async function partner(chat: MoneyChat): Promise<void> {
  accepted(await chat.edit([{ op: "set", entity: SHOP, field: "owners", value: [{ party: MARCUS, role: "owner", share: 60 }, { party: "pov", role: "owner", share: 40 }] }]));
}

/** A trade as the hub's trade form fills it in. */
function trade(chat: MoneyChat, form: Partial<TradeForm>): ActionBody {
  const body = tradeAction({ side: "buy", holding: "", asset: "", account: "", qty: null, amount: "", from: "", to: "", option: null, ...form }, chat.currency);
  if (typeof body === "string") throw new Error(body);
  return body;
}

/** Birch Lane put up for sale by the GM (its asking price, a ✎ field) and bought by the POV: $35,000 the GM adds to savings goes down, a 30-year mortgage for the rest. */
async function buyHouse(chat: MoneyChat): Promise<void> {
  accepted(await chat.edit([{ op: "set", entity: HOUSE, field: "asking_price", value: chat.cents("350000") }, { op: "adjust", account: SAVINGS, cents: chat.cents("35000") }]));
  expect(await chat.play(propertyBuyAction(HOUSE, chat.cents("350000"), { from: SAVINGS, down: chat.cents("35000"), termMonths: 360 }))).toContain("done");
}

describe("Play → Money → Jobs and Businesses: each control plays as the player's turn", () => {
  test("Quit ends the POV's job: it shows as ended with no payday ahead, and offers nothing more", async () => {
    const chat = await MoneyChat.start();
    const before = await chat.hub();
    expect(jobControls(before, find(before.jobs, JOB), null)).toEqual(["quit"]);
    expect(await chat.play(jobEndAction(JOB))).toContain("done");
    const after = await chat.hub();
    const job = find(after.jobs, JOB);
    expect(job.status).toBe("ended");
    expect(job.nextPay).toBeNull();
    expect(jobControls(after, job, null)).toEqual([]);
  });

  test("A partner hires someone the POV knows, gives them a raise and lets them go; the payroll shows each step", async () => {
    const chat = await MoneyChat.start();
    // The POV works at the shop but holds no role on it, so it isn't theirs to run.
    expect((await chat.hub()).businesses).toEqual([]);
    await partner(chat);
    const view = await chat.hub();
    const shop = find(view.businesses, SHOP);
    expect(businessControls(view, shop)).toEqual(["hire", "invoice", "draw", "distribute", "stake"]);
    // On the payroll the POV's own job is theirs to quit and, as a partner, to change.
    expect(jobControls(view, find(shop.employees, JOB), shop)).toEqual(["quit", "raise", "let_go"]);
    const hire = knownPeople((await chat.state()).palette).find((p) => p.id !== MARCUS && !shop.employees.some((j) => j.workerId === p.id));
    if (!hire) throw new Error("the POV knows no one to hire");
    const body = hireAction({ business: SHOP, worker: hire.id, title: "Apprentice", basis: "hourly", rate: "18", hoursPerWeek: 20, payEvery: "weekly" }, chat.currency);
    if (!body) throw new Error("the hire form isn't complete");
    expect(await chat.play(body)).toContain("done");
    const hired = await chat.hub();
    const job = find(hired.businesses, SHOP).employees.find((j) => j.workerId === hire.id);
    if (!job) throw new Error(`${hire.label} isn't on the payroll`);
    expect(job).toMatchObject({ title: "Apprentice", worker: hire.label, pay: "$18.00 an hour", payEvery: "weekly", status: "active" });
    expect(job.nextPay).not.toBeNull();
    expect(jobControls(hired, job, find(hired.businesses, SHOP))).toEqual(["raise", "let_go"]);
    expect(await chat.play(raiseAction(job.id, chat.cents("20")))).toContain("done");
    expect(find(find((await chat.hub()).businesses, SHOP).employees, job.id).pay).toBe("$20.00 an hour");
    expect(await chat.play(jobEndAction(job.id))).toContain("done");
    expect(find((await chat.hub()).businesses, SHOP).employees.map((j) => j.id)).not.toContain(job.id);
  });

  test("Issue an invoice bills someone the POV knows or an outside name; Void cancels one", async () => {
    const chat = await MoneyChat.start();
    await partner(chat);
    expect(await chat.play(invoiceIssueAction(SHOP, { id: DANNY }, chat.cents("420"), "Brake job", 14))).toContain("done");
    expect(await chat.play(invoiceIssueAction(SHOP, { name: "Harbor Mutual" }, chat.cents("99"), "Claim", null))).toContain("done");
    const view = await chat.hub();
    const shop = find(view.businesses, SHOP);
    const danny = shop.invoices.find((i) => i.customer === DANNY && i.memo === "Brake job");
    const mutual = shop.invoices.find((i) => i.customer === "Harbor Mutual");
    expect(danny).toMatchObject({ customerName: "Danny Okafor", cents: 42000, state: "open", dueAt: "Mon 28 Sep 2026, 00:00" });
    // Without a term the shop's own (30 days) applies.
    expect(mutual).toMatchObject({ customerName: "Harbor Mutual", memo: "Claim", cents: 9900, state: "open", dueAt: "Wed 14 Oct 2026, 00:00" });
    if (!mutual) throw new Error("no invoice to Harbor Mutual");
    expect(invoiceControls(view, shop, mutual)).toEqual(["void"]);
    expect(await chat.play(invoiceAction(mutual.id, "void"))).toContain("done");
    const after = await chat.hub();
    const voided = find(find(after.businesses, SHOP).invoices, mutual.id);
    expect(voided.state).toBe("void");
    expect(invoiceControls(after, find(after.businesses, SHOP), voided)).toEqual([]);
  });

  test("Owner's draw and Pay out profit move the shop's money to its owners; with no profit since the last payout there's nothing to pay", async () => {
    const chat = await MoneyChat.start();
    await partner(chat);
    const checking = account(await chat.hub(), CHECKING).cents;
    const shop = account(await chat.party(MARCUS), SHOP_ACCOUNT).cents;
    const marcus = account(await chat.party(MARCUS), MARCUS_CHECKING).cents;
    expect(await chat.play(drawAction(SHOP, chat.cents("500")))).toContain("done");
    expect(account(await chat.hub(), CHECKING).cents).toBe(checking + 50000);
    expect(account(await chat.party(MARCUS), SHOP_ACCOUNT).cents).toBe(shop - 50000);
    expect(await chat.play(distributeAction(SHOP, null))).toContain("has no profit to distribute");
    expect(await chat.play(distributeAction(SHOP, chat.cents("1000")))).toContain("done");
    // By share: 40% to the POV's deposit account, 60% to Marcus's.
    expect(account(await chat.hub(), CHECKING).cents).toBe(checking + 50000 + 40000);
    const after = await chat.party(MARCUS);
    expect(account(after, MARCUS_CHECKING).cents).toBe(marcus + 60000);
    expect(account(after, SHOP_ACCOUNT).cents).toBe(shop - 150000);
  });

  test("Where the POV's profit goes: routed to savings the next payout lands there, and the GM's routing sends it back", async () => {
    const chat = await MoneyChat.start();
    await partner(chat);
    const before = await chat.hub();
    expect(await chat.play(routeAction({ business: SHOP }, SAVINGS))).toContain("done");
    expect(await chat.play(distributeAction(SHOP, chat.cents("1000")))).toContain("done");
    const routed = await chat.hub();
    expect(account(routed, SAVINGS).cents).toBe(account(before, SAVINGS).cents + 40000);
    expect(account(routed, CHECKING).cents).toBe(account(before, CHECKING).cents);
    accepted(await chat.edit(routeOps({ business: SHOP }, "pov", "")));
    expect(await chat.play(distributeAction(SHOP, chat.cents("1000")))).toContain("done");
    const back = await chat.hub();
    expect(account(back, CHECKING).cents).toBe(account(before, CHECKING).cents + 40000);
    expect(account(back, SAVINGS).cents).toBe(account(routed, SAVINGS).cents);
  });

  test("Sell a stake: Danny pays for 10% of the shop and becomes an owner beside the POV and Marcus", async () => {
    const chat = await MoneyChat.start();
    await partner(chat);
    const checking = account(await chat.hub(), CHECKING).cents;
    const danny = account(await chat.party(DANNY), DANNY_CHECKING).cents;
    expect(await chat.play(stakeSellAction(SHOP, 10, chat.cents("1000"), DANNY))).toContain("done");
    const view = await chat.hub();
    expect(find(view.businesses, SHOP).owners.map((o) => [o.party, o.share])).toEqual([
      [MARCUS, 60],
      ["pov", 30],
      [DANNY, 10],
    ]);
    expect(account(view, CHECKING).cents).toBe(checking + 100000);
    const dannyView = await chat.party(DANNY);
    expect(account(dannyView, DANNY_CHECKING).cents).toBe(danny - 100000);
    expect(find(dannyView.businesses, SHOP).role).toBe("owner");
  });

  test("Pay now settles an invoice billed to the POV before it falls due, from Flows or from the shop's books", async () => {
    const chat = await MoneyChat.start();
    // The GM bills the POV for a tune-up (a new invoice entity, with its declared fields).
    const invoice = "inv_pov_tuneup";
    accepted(
      await chat.edit([
        { op: "spawn", kind: "invoice", name: "Truck tune-up", id: invoice },
        { op: "set", entity: invoice, field: "business", value: SHOP },
        { op: "set", entity: invoice, field: "customer", value: "pov" },
        { op: "set", entity: invoice, field: "cents", value: chat.cents("180") },
        { op: "set", entity: invoice, field: "memo", value: "Truck tune-up" },
        { op: "set", entity: invoice, field: "due", value: "2026-09-28" },
        { op: "set", entity: invoice, field: "state", value: "open" },
      ]),
    );
    const view = await chat.hub();
    const flow = view.flows.find((f) => f.source === "invoice" && f.link?.id === invoice);
    if (!flow) throw new Error("the invoice isn't among the POV's flows");
    expect(flow.next).toBe("Mon 28 Sep 2026, 09:00");
    expect(flowControls(view, flow)).toEqual(["pay_now"]);
    // A partner sees it in the shop's books too, theirs to pay and to void.
    await partner(chat);
    const partnered = await chat.hub();
    const shop = find(partnered.businesses, SHOP);
    expect(invoiceControls(partnered, shop, find(shop.invoices, invoice))).toEqual(["void", "pay"]);
    expect(await chat.play(invoiceAction(invoice, "pay"))).toContain("done");
    const paid = await chat.hub();
    expect(account(paid, CHECKING).cents).toBe(account(view, CHECKING).cents - 18000);
    expect(paid.flows.some((f) => f.link?.id === invoice)).toBe(false);
    expect(find(find(paid.businesses, SHOP).invoices, invoice).state).toBe("paid");
  });
});

describe("A business's own accounts on its page, for whoever runs it", () => {
  test("Marcus sees the shop's checking and its lift loan and sets the loan's autopay from its page; an employee sees none", async () => {
    const owner = await MoneyChat.start({ pov: MARCUS });
    const view = await owner.hub();
    const shop = find(view.businesses, SHOP);
    // He holds the shop's checking as an authorized user; the lift loan he only runs, as the shop's owner, so it isn't among his own accounts.
    const listed = businessAccounts(view, shop);
    expect(listed.shown.map((a) => a.id).sort()).toEqual([LIFT_LOAN, SHOP_ACCOUNT].sort());
    expect(listed.others).toEqual([]);
    expect(view.accounts.map((a) => a.id)).not.toContain(LIFT_LOAN);
    const loan = find(listed.shown, LIFT_LOAN);
    expect(loan).toMatchObject({ name: "Lift loan", role: null, manages: true, loan: { payment: 119956 }, autopay: { mode: "fixed", from: SHOP_ACCOUNT } });
    expect(loan.cents).toBeLessThan(0);
    // Its page offers the autopay row and nothing to spend; the autopay page pays from the shop's checking.
    expect(accountControls(view, loan)).toEqual(["autopay"]);
    expect(autopaySources(view, loan).map((a) => a.id)).toContain(SHOP_ACCOUNT);
    expect(await owner.play(autopayAction(LIFT_LOAN, "minimum", SHOP_ACCOUNT, null))).toContain("done");
    const after = await owner.hub();
    expect(findAccount(after, LIFT_LOAN)?.autopay).toMatchObject({ mode: "minimum", from: SHOP_ACCOUNT });
    // The GM's Money tab draws his business page the same way.
    const gm = await owner.party(MARCUS);
    expect(businessAccounts(gm, find(gm.businesses, SHOP)).shown.map((a) => a.id)).toContain(LIFT_LOAN);

    // Jordan works at the shop but holds no role on it: no business page, and none of its accounts.
    const employee = await MoneyChat.start();
    const theirs = await employee.hub();
    expect(theirs.businesses).toEqual([]);
    expect(viewAccounts(theirs).map((a) => a.id)).not.toContain(LIFT_LOAN);
    expect(viewAccounts(theirs).map((a) => a.id)).not.toContain(SHOP_ACCOUNT);
  });
});

describe("The GM view's Jobs and Businesses: each control applies as the GM's edit", () => {
  test("Add a job gives the POV a second job; End the job ends it; an invoice's state and a business's field take the GM's values", async () => {
    const chat = await MoneyChat.start();
    const id = newIdFor("job", "Jordan Ellis Tow driver", new Set((await chat.gm()).fields.keys()));
    accepted(await chat.edit(jobSpawnOps(id, "Tow driver at Alder Automotive", { worker: "pov", employer: SHOP, title: "Tow driver", basis: "hourly", rate: chat.cents("20"), pay_every: "weekly" })));
    expect(find((await chat.hub()).jobs, id)).toMatchObject({ title: "Tow driver", employer: "Alder Automotive", pay: "$20.00 an hour", status: "active" });
    accepted(await chat.edit([{ op: "set", entity: id, field: "status", value: "ended" }]));
    expect(find((await chat.hub()).jobs, id).status).toBe("ended");
    accepted(await chat.edit([{ op: "set", entity: "inv_dale_trailer", field: "state", value: "paid" }]));
    expect(find(find((await chat.party(MARCUS)).businesses, SHOP).invoices, "inv_dale_trailer").state).toBe("paid");
    const gm = await chat.gm();
    expect(gm.fields.get(SHOP)).toContain("invoice_days");
    accepted(await chat.edit([{ op: "set", entity: SHOP, field: "invoice_days", value: 45 }]));
    expect((await chat.gm()).values.get(SHOP)?.invoice_days).toBe(45);
  });

  test("for someone with no job, property or household, the GM still has Jobs, Properties and Household to add one in", async () => {
    const chat = await MoneyChat.start();
    const dale = await chat.party(DALE);
    expect([dale.jobs, dale.properties, dale.household]).toEqual([[], [], null]);
    expect(hubTabs(dale, "gm").map((t) => t.id)).toEqual(expect.arrayContaining(["jobs", "properties", "household"]));
    const taken = new Set((await chat.gm()).fields.keys());
    // Add a job, as its form sends it.
    const job = newIdFor("job", "Dale Whitcomb Driver", taken);
    accepted(await chat.edit(jobSpawnOps(job, "Driver at Alder Automotive", { worker: DALE, employer: SHOP, title: "Driver", basis: "hourly", rate: chat.cents("19"), pay_every: "weekly" })));
    expect(find((await chat.party(DALE)).jobs, job)).toMatchObject({ title: "Driver", employer: "Alder Automotive", pay: "$19.00 an hour", status: "active" });
    // Add a property: Dale its whole owner, at its value.
    const cabin = newIdFor("prop", "The lake cabin", taken);
    accepted(await chat.edit(propertySpawnOps(cabin, "The lake cabin", DALE, chat.cents("185000"))));
    expect(find((await chat.party(DALE)).properties, cabin)).toMatchObject({ name: "The lake cabin", share: 100, value: 18500000 });
    // Add to a household: Dale joins the Kowalczyks.
    accepted(await chat.edit([{ op: "link", rel: "member_of", from: DALE, to: KOWALCZYKS }]));
    const joined = await chat.party(DALE);
    expect(joined.household?.id).toBe(KOWALCZYKS);
    expect(joined.household?.members.map((m) => m.id)).toContain(DALE);
  });
});

describe("Play → Money → Investments: each trade plays as the player's turn", () => {
  test("Buy more pays from the account the player picks; the brokerage's own cash can't cover it", async () => {
    const chat = await MoneyChat.start();
    const view = await chat.hub();
    expect(holdingControls(view, find(holdings(view), LKFR))).toEqual(["buy", "sell"]);
    // "Pay from" offers the POV's accounts that hold money.
    expect(moveSources(view).map((a) => a.id)).toEqual(expect.arrayContaining([CHECKING, SAVINGS, BROKERAGE]));
    expect(account(view, BROKERAGE).cents).toBe(0);
    expect(await chat.play(trade(chat, { holding: LKFR, qty: 5 }))).toContain("can't cover");
    expect(await chat.play(trade(chat, { holding: LKFR, qty: 5, from: CHECKING }))).toContain("done");
    const after = await chat.hub();
    expect(find(holdings(after), LKFR).qty).toBe(17);
    expect(account(after, CHECKING).cents).toBe(account(view, CHECKING).cents - 5 * 4200);
  });

  test("Sell part of the index fund and its cash stays in the brokerage; sell the rest and it goes where the player says", async () => {
    const chat = await MoneyChat.start();
    const view = await chat.hub();
    expect(await chat.play(trade(chat, { side: "sell", holding: INDEX, qty: 10 }))).toContain("done");
    const part = await chat.hub();
    expect(find(holdings(part), INDEX).qty).toBe(21.25);
    expect(account(part, BROKERAGE).cents).toBe(100000);
    // "The money goes to" offers the POV's other accounts.
    expect(transferTargets(part, "").map((a) => a.id)).toContain(CHECKING);
    expect(await chat.play(trade(chat, { side: "sell", holding: INDEX, to: CHECKING }))).toContain("done");
    const all = await chat.hub();
    expect(holdings(all).map((h) => h.id)).not.toContain(INDEX);
    expect(account(all, CHECKING).cents).toBe(account(view, CHECKING).cents + 212500);
    expect(account(all, BROKERAGE).cents).toBe(100000);
  });

  test("Buy something new: a fund on the market, by amount, opens a holding in the brokerage", async () => {
    const chat = await MoneyChat.start();
    const view = await chat.hub();
    expect((view.investments?.market ?? []).map((m) => m.asset)).toContain("glbd");
    expect(await chat.play(trade(chat, { asset: "glbd", account: BROKERAGE, amount: "500", from: SAVINGS }))).toContain("done");
    const after = await chat.hub();
    const fund = holdings(after).find((h) => h.asset.id === "glbd");
    expect(fund).toMatchObject({ account: BROKERAGE, qty: 10, price: 5000 });
    expect(account(after, SAVINGS).cents).toBe(account(view, SAVINGS).cents - 50000);
  });

  test("Exercise: an LKFR call bought from checking becomes 100 shares at the strike, paid from the account the player picks", async () => {
    const chat = await MoneyChat.start();
    expect(await chat.play(transferAction(SAVINGS, CHECKING, chat.cents("3000")))).toContain("done");
    expect(await chat.play(trade(chat, { asset: "lkfr", account: BROKERAGE, qty: 1, from: CHECKING, option: { right: "call", strike: "40", expiry: "2026-12-18" } }))).toContain("done");
    const view = await chat.hub();
    const call = holdings(view).find((h) => h.option !== null);
    if (!call) throw new Error("no call among the holdings");
    expect(call.asset.id).toBe("opt:lkfr:call:4000:2026-12-18");
    expect(call.option).toMatchObject({ right: "call", strike: 4000, expiry: "2026-12-18", inTheMoney: true });
    expect(holdingControls(view, call)).toEqual(["buy", "sell", "exercise"]);
    // The brokerage's cash can't pay the strike: 100 shares at $40.
    expect(await chat.play(exerciseAction(call.id, null))).toContain("can't cover $4,000.00");
    expect(await chat.play(exerciseAction(call.id, null, { from: CHECKING }))).toContain("done");
    const after = await chat.hub();
    expect(holdings(after).map((h) => h.id)).not.toContain(call.id);
    expect(find(holdings(after), LKFR).qty).toBe(112);
    expect(account(after, CHECKING).cents).toBe(account(view, CHECKING).cents - 400000);
  });

  test("Distributions go to: reinvested, an account, or back to the usual place", async () => {
    const chat = await MoneyChat.start();
    expect(find(holdings(await chat.hub()), LKFR).route).toEqual({ to: null, reinvest: false });
    expect(await chat.play(routeAction({ holding: LKFR }, "reinvest"))).toContain("done");
    expect(find(holdings(await chat.hub()), LKFR).route?.reinvest).toBe(true);
    expect(await chat.play(routeAction({ holding: LKFR }, SAVINGS))).toContain("done");
    expect(find(holdings(await chat.hub()), LKFR).route).toEqual({ to: SAVINGS, reinvest: false });
    expect(await chat.play(routeAction({ holding: LKFR }, ""))).toContain("done");
    expect(find(holdings(await chat.hub()), LKFR).route).toEqual({ to: null, reinvest: false });
  });
});

describe("The GM view's Investments: each control applies as the GM's edit", () => {
  test("Set its price moves a security's value; an option takes its price from its underlying; the GM routes a holding's dividends", async () => {
    const chat = await MoneyChat.start();
    accepted(await chat.edit(setPriceOps("lkfr", chat.cents("50"))));
    expect(find(holdings(await chat.hub()), LKFR)).toMatchObject({ price: 5000, value: 12 * 5000 });
    expect(await chat.play(trade(chat, { asset: "lkfr", account: BROKERAGE, qty: 1, from: CHECKING, option: { right: "call", strike: "40", expiry: "2026-12-18" } }))).toContain("done");
    const call = holdings(await chat.hub()).find((h) => h.option !== null);
    if (!call) throw new Error("no call among the holdings");
    expect(refusal(await chat.edit(setPriceOps(call.asset.id, chat.cents("5"))))).toContain("is priced from lkfr");
    accepted(await chat.edit(routeOps({ holding: LKFR }, "pov", SAVINGS)));
    expect(find(holdings(await chat.hub()), LKFR).route).toEqual({ to: SAVINGS, reinvest: false });
  });
});

describe("Play → Money → Properties: each control plays as the player's turn", () => {
  test("Buy: once the GM puts Birch Lane up for sale, the POV buys it with a down payment and a mortgage, and Marcus is paid what's his", async () => {
    const chat = await MoneyChat.start();
    // Marcus's house isn't the POV's business until it's for sale.
    expect((await chat.hub()).properties.map((p) => p.id)).not.toContain(HOUSE);
    accepted(await chat.edit([{ op: "set", entity: HOUSE, field: "asking_price", value: chat.cents("350000") }, { op: "adjust", account: SAVINGS, cents: chat.cents("35000") }]));
    const listed = await chat.hub();
    const forSale = find(listed.properties, HOUSE);
    expect(forSale.forSale).toBe(35000000);
    expect(propertyControls(listed, forSale)).toEqual(["buy"]);
    const marcus = await chat.party(MARCUS);
    const owed = -account(marcus, MARCUS_MORTGAGE).cents;
    expect(await chat.play(propertyBuyAction(HOUSE, chat.cents("349000")))).toContain("the sellers want $350,000.00");
    // The lender decides the mortgage: it wants 3 % down, and lends only for the terms it offers.
    expect(await chat.play(propertyBuyAction(HOUSE, chat.cents("350000"), { from: SAVINGS, down: chat.cents("3000"), termMonths: 360 }))).toContain("a lender wants at least $10,500.00 down");
    expect(await chat.play(propertyBuyAction(HOUSE, chat.cents("350000"), { from: SAVINGS, down: chat.cents("35000"), termMonths: 100 }))).toContain("lenders offer mortgages over 15, 20 or 30 years");
    expect(await chat.play(propertyBuyAction(HOUSE, chat.cents("350000"), { from: SAVINGS, down: chat.cents("35000"), termMonths: 360 }))).toContain("done");
    const view = await chat.hub();
    const house = find(view.properties, HOUSE);
    expect(house.share).toBe(100);
    expect(house.forSale).toBeNull();
    // The mortgage shown is the POV's new one, not Marcus's paid-off loan.
    expect(house.mortgage).toMatchObject({ id: `${HOUSE}:mortgage`, owed: 31500000, monthsLeft: 360 });
    expect(propertyControls(view, house)).toEqual(["let", "sell"]);
    expect(account(view, SAVINGS).cents).toBe(account(listed, SAVINGS).cents - 3500000);
    expect(account(view, `${HOUSE}:mortgage`).cents).toBe(-31500000);
    // The loan pays the sellers; none of it lands in the buyer's own accounts.
    expect(account(view, CHECKING).cents).toBe(account(listed, CHECKING).cents);
    const sold = await chat.party(MARCUS);
    expect(account(sold, MARCUS_MORTGAGE).cents).toBe(0);
    expect(account(sold, MARCUS_CHECKING).cents).toBe(account(marcus, MARCUS_CHECKING).cents + 35000000 - owed);
  });

  test("Let it: the rent goes where the POV routed it, Danny pays it, and End stops the lease today", async () => {
    const chat = await MoneyChat.start();
    await buyHouse(chat);
    expect(await chat.play(routeAction({ property: HOUSE }, SAVINGS))).toContain("done");
    expect((await chat.gm()).values.get(HOUSE)?.rent_to).toBe(SAVINGS);
    expect(await chat.play(leaseStartAction(HOUSE, DANNY, chat.cents("1500"), { months: 12, day: 1 }))).toContain("done");
    const view = await chat.hub();
    const lease = `lease:${HOUSE}:${DANNY}`;
    expect(find(view.properties, HOUSE).leases.find((l) => l.flow === lease)).toEqual({ flow: lease, tenant: "Danny Okafor", rent: 150000, start: TODAY, end: "2027-09-13", state: "let" });
    expect(endableLeases(view, find(view.properties, HOUSE))).toEqual([lease]);
    expect(find(view.flows, lease)).toMatchObject({ to: "Your savings account", amount: "$1,500.00" });
    // Danny pays it from his checking, his deposit account.
    expect(find((await chat.party(DANNY)).flows, lease)).toMatchObject({ from: "Danny's checking", next: "Thu 1 Oct 2026, 09:00" });
    expect(await chat.play(leaseEndAction(lease))).toContain("done");
    expect(find((await chat.hub()).properties, HOUSE).leases.find((l) => l.flow === lease)?.end).toBe(TODAY);
    // The GM's routing puts the rent back in checking.
    accepted(await chat.edit(routeOps({ property: HOUSE }, "pov", CHECKING)));
    expect((await chat.gm()).values.get(HOUSE)?.rent_to).toBe(CHECKING);
  });

  test("Sell: a buyer who can't pay is refused; sold to an outside buyer, the mortgage is paid off from the price and the rest lands in checking", async () => {
    const chat = await MoneyChat.start();
    await buyHouse(chat);
    const before = await chat.hub();
    expect(await chat.play(propertySellAction(HOUSE, chat.cents("360000"), { buyer: DANNY }))).toContain("doesn't have $360,000.00");
    // An outside buyer pays no more than it is worth: the GM's ✎ puts its value at $360,000 first.
    accepted(await chat.edit([{ op: "set", entity: HOUSE, field: "value", value: chat.cents("360000") }]));
    expect(await chat.play(propertySellAction(HOUSE, chat.cents("360000")))).toContain("done");
    const after = await chat.hub();
    expect(after.properties.map((p) => p.id)).not.toContain(HOUSE);
    expect(account(after, `${HOUSE}:mortgage`).cents).toBe(0);
    expect(account(after, CHECKING).cents).toBe(account(before, CHECKING).cents + 36000000 - 31500000);
  });

  test("A tenant gives notice: End the lease on the POV's rent ends it today", async () => {
    const chat = await MoneyChat.start();
    const view = await chat.hub();
    const rent = find(view.flows, RENT);
    expect(rent.link?.id).toBe("prop_harbor_114");
    expect(flowControls(view, rent)).toEqual(["edit", "pause", "end_lease", "delete"]);
    expect(await chat.play(leaseEndAction(RENT))).toContain("done");
    expect(find((await chat.hub()).flows, RENT).spec?.end).toBe(TODAY);
  });
});

describe("Levels: the work and asset controls follow the features running for the POV", () => {
  test("At Money 3 property and work run but investments don't: holdings show without trades and a stake doesn't sell", async () => {
    const chat = await MoneyChat.start();
    await partner(chat);
    accepted(await chat.edit([{ op: "set", entity: HOUSE, field: "asking_price", value: chat.cents("350000") }]));
    await chat.level(3);
    const view = await chat.hub();
    expect(view.features).toContain("property");
    expect(view.features).not.toContain("investments");
    expect(holdingControls(view, find(holdings(view), LKFR))).toEqual([]);
    expect(businessControls(view, find(view.businesses, SHOP))).toEqual(["hire", "invoice", "draw", "distribute"]);
    expect(propertyControls(view, find(view.properties, HOUSE))).toEqual(["buy"]);
    expect(await chat.play(trade(chat, { holding: LKFR, qty: 1, from: CHECKING }))).not.toContain("done");
    expect(find(holdings(await chat.hub()), LKFR).qty).toBe(12);
  });

  test("At Money 2 nothing here is an action: jobs, the shop, holdings and property only show, and no flows run", async () => {
    const chat = await MoneyChat.start();
    await partner(chat);
    await chat.level(2);
    const view = await chat.hub();
    expect(jobControls(view, find(view.jobs, JOB), null)).toEqual([]);
    for (const b of view.businesses) expect(businessControls(view, b)).toEqual([]);
    for (const h of view.investments?.holdings ?? []) expect(holdingControls(view, h)).toEqual([]);
    for (const p of view.properties) expect(propertyControls(view, p)).toEqual([]);
    expect(view.flows).toEqual([]);
    expect(await chat.play(jobEndAction(JOB))).not.toContain("done");
    expect(find((await chat.hub()).jobs, JOB).status).toBe("active");
  });
});

describe("Where each payout goes: the hub's pickers open on the route in force", () => {
  test("a holding's dividends, a property's rent and the POV's profit share open on the usual place, then on where the POV routed each once the view reloads; another owner's account shows unnamed", async () => {
    const chat = await MoneyChat.start();
    await partner(chat);
    await buyHouse(chat);
    const before = await chat.hub();
    expect([routePick(find(holdings(before), LKFR).route), routePick(find(before.properties, HOUSE).route), routePick(find(before.businesses, SHOP).route)]).toEqual([" ", " ", " "]);
    expect(await chat.play(routeAction({ holding: LKFR }, SAVINGS))).toContain("done");
    expect(await chat.play(routeAction({ property: HOUSE }, SAVINGS))).toContain("done");
    expect(await chat.play(routeAction({ business: SHOP }, "reinvest"))).toContain("done");
    const after = await chat.hub();
    expect(find(holdings(after), LKFR).route).toEqual({ to: SAVINGS, reinvest: false });
    expect(find(after.properties, HOUSE).route).toEqual({ to: SAVINGS, reinvest: false });
    expect(find(after.businesses, SHOP).route).toEqual({ to: null, reinvest: true });
    expect([routePick(find(holdings(after), LKFR).route), routePick(find(after.properties, HOUSE).route), routePick(find(after.businesses, SHOP).route)]).toEqual([SAVINGS, SAVINGS, "reinvest"]);
    // The GM's view of the POV opens on the same routes.
    const gm = await chat.party("pov");
    expect([find(gm.properties, HOUSE).route, find(gm.businesses, SHOP).route]).toEqual([{ to: SAVINGS, reinvest: false }, { to: null, reinvest: true }]);
    // Owned with Marcus and routed by the GM to his checking, the POV's picker says only that it goes to another owner's account; Marcus's names it.
    accepted(await chat.edit([{ op: "set", entity: HOUSE, field: "owners", value: [{ party: "pov", role: "owner", share: 50 }, { party: MARCUS, role: "owner", share: 50 }] }, { op: "set", entity: HOUSE, field: "rent_to", value: MARCUS_CHECKING }]));
    const shared = find((await chat.hub()).properties, HOUSE).route;
    expect(shared).toEqual({ to: null, reinvest: false, elsewhere: true });
    expect(routePick(shared)).toBe(ROUTE_ELSEWHERE);
    expect(find((await chat.party(MARCUS)).properties, HOUSE).route).toEqual({ to: MARCUS_CHECKING, reinvest: false });
  });
});
