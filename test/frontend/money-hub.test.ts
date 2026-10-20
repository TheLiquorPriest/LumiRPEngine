// The money dashboards' logic (DESIGN §25): the view as it arrives, which sections and books show
// at each realism level, which controls a party's roles allow, and the exact request every control
// sends.

import { describe, expect, test } from "bun:test";
import { featureOn, FINANCE_FEATURES, ROLE_RIGHTS, type AccountView, type BusinessView, type CardView, type FinanceView, type Flow, type FlowView, type HoldingView, type PropertyView } from "../../src/shared/finance";
import type { Level } from "../../src/shared/ids";
import type { JsonObject } from "../../src/shared/json";
import { isRecord } from "../../src/shared/json";
import { DEFAULT_CURRENCY, type WorldDoc } from "../../src/shared/world";
import { materializeAll } from "../../src/engine/materialize";
import { createRegistry } from "../../src/engine/registry-impl";
import { Working } from "../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { startState } from "../packs/support";
import { ListRow } from "../../src/frontend/components";
import { decodeFinanceView } from "../../src/packs/economy/ui/decode";
import { accountBlocks, accountControls, businessControls, cardControls, creditBlocks, endableLeases, flowControls, flowSources, holdingControls, householdRows, hubTabs, invoiceControls, investmentBlocks, overviewBlocks, propertyControls, transferTargets, workBlocks } from "../../src/packs/economy/ui/layout";
import { OwnerRows } from "../../src/packs/economy/ui/lines";
import { gmFixture } from "../../dev/preview/fixtures";
import {
  actionRequest,
  autopayAction,
  autopayOps,
  blankFlowForm,
  cardAction,
  cashAction,
  closeAccountOps,
  exerciseAction,
  fieldOps,
  flowEditOps,
  flowFormOf,
  flowFormProblem,
  flowSpawnOps,
  flowUpdateAction,
  flowCreateAction,
  hireAction,
  invoiceIssueAction,
  newIdFor,
  payCardAction,
  payPrefsAction,
  routeAction,
  routeOps,
  setPriceOps,
  tradeAction,
  transferAction,
} from "../../src/packs/economy/ui/requests";

const USD = DEFAULT_CURRENCY;

/** An account in the party's view; whether they manage it follows their own role unless a test says (a business's account its owner runs). */
function account(over: Partial<AccountView> & Pick<AccountView, "id" | "class">): AccountView {
  const role = over.role === undefined ? "owner" : over.role;
  return { name: over.id, classLabel: "", product: { id: over.class, label: "" }, institution: null, status: "open", cents: 0, available: null, owners: [{ party: "pov", name: "You", role: "owner", share: 100 }], role: "owner", manages: role !== null && ROLE_RIGHTS[role].manage, limit: null, aprPct: null, apyPct: null, terms: [], autopay: null, due: null, statements: [], cards: [], pending: [], holds: [], transactions: [], securedBy: null, loan: null, ...over };
}

function card(over: Partial<CardView> & Pick<CardView, "id" | "account">): CardView {
  return { name: over.id, network: "debit", state: "active", holder: "You", holderId: "pov", last4: "4421", item: null, dailyPurchaseLimit: null, dailyAtmLimit: null, spentToday: 0, ...over };
}

function view(over: Partial<FinanceView> = {}): FinanceView {
  return { party: "pov", name: "You", partyKind: "person", level: 3, detail: false, features: ["flows", "cards"], band: "comfortable", opened: true, cash: { cents: 4600 }, overview: { netWorth: 100000, assets: 120000, liabilities: 20000, breakdown: [], cashFlow: null, upcoming: [], alerts: [] }, accounts: [], cards: [], flows: [], jobs: [], businesses: [], investments: null, properties: [], credit: null, household: null, recent: [], notes: [], payPrefs: [], ...over };
}

const cash = account({ id: "wallet", class: "cash", cents: 4600 });
const checking = account({ id: "chk", class: "checking", cents: 124018, available: 124018 });
const savings = account({ id: "sav", class: "savings", cents: 350000 });
const visa = account({ id: "visa", class: "credit_card", cents: -41255, limit: 120000, available: 78745, autopay: { mode: "minimum", from: "chk", fromName: "Checking", cents: null }, statements: [{ at: "Oct 1", closing: 41255, interest: 0, fees: 0, minimum: 3500, due: "Oct 28", paid: 0, apr: 22, stage: "current", state: "open" }], terms: [{ label: "APR", value: "22%" }], holds: [{ id: "h1", cents: 3211, until: "Oct 20", kind: "authorization", memo: "Shell" }] });

/** Every money feature that runs at the top level unless a toggle turns it off. */
const TOP = FINANCE_FEATURES.filter((f) => featureOn(4, f));

const reg = createRegistry(ALL_PACKS);

/** The POV's money in Port Alder at a Money level with the world's toggles, as the backend builds it and the hub decodes it. */
function portAlderMoney(level: Level, toggles: JsonObject): FinanceView {
  const world = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("pa", "Port Alder");
  world.realism.levels.money = level;
  world.packs.economy = { ...world.packs.economy, config: { ...(world.packs.economy?.config ?? {}), features: toggles } };
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  const decoded = decodeFinanceView(JSON.parse(JSON.stringify(w.ctx.query("economy.finance")(w.ctx, world.pov, true))));
  if (!decoded) throw new Error("the hub can't draw the POV's money");
  return decoded;
}

function accountIn(v: FinanceView, id: string): AccountView {
  const a = v.accounts.find((x) => x.id === id);
  if (!a) throw new Error(`no ${id} in the view`);
  return a;
}

describe("the view as it arrives", () => {
  test("a party's view decodes field for field, and anything else is no view", () => {
    const v = view({ accounts: [checking, visa], cards: [card({ id: "debit1", account: "chk" })], recent: [{ id: "t1", at: "Tue 07:40", memo: "Coffee", cents: -325, account: "Visa", accountId: "visa", kind: "purchase", category: "dining", counterparty: "Rosie's", card: null, status: "posted" }] });
    expect(decodeFinanceView(JSON.parse(JSON.stringify(v)))).toEqual(v);
    // The panel's view before the foundation (a band and accounts, no party) is no money hub view.
    expect(decodeFinanceView({ level: 3, band: null, accounts: [] })).toBeNull();
    expect(decodeFinanceView(null)).toBeNull();
  });

  test("values a newer backend might send read as the nearest known ones; entries without an id are dropped", () => {
    const raw = JSON.parse(JSON.stringify(view({ accounts: [visa] }))) as Record<string, unknown>;
    raw.accounts = [{ ...visa, class: "space_bank", status: "orbiting" }, { name: "no id" }];
    raw.features = ["flows", "teleport"];
    const decoded = decodeFinanceView(raw);
    expect(decoded?.accounts.map((a) => [a.id, a.class, a.status])).toEqual([["visa", "checking", "open"]]);
    expect(decoded?.features).toEqual(["flows"]);
  });

  test("household members the player can't see arrive without ids and still keep their own parts and rows", () => {
    const home = view({ partyKind: "household", household: { id: "home", name: "Unit 2B", accounts: [], flows: [], members: [{ id: "pov", name: "You", role: "", share: 40 }, { id: null, name: "someone", role: "", share: 35 }, { id: null, name: "someone", role: "", share: 25 }], monthly: { total: 100000, parts: [{ id: "pov", name: "You", cents: 40000 }, { id: null, name: "someone", cents: 35000 }, { id: null, name: "someone", cents: 25000 }] } } });
    const decoded = decodeFinanceView(JSON.parse(JSON.stringify(home)));
    if (!decoded?.household) throw new Error("no household");
    const rows = householdRows(decoded.household);
    expect(rows.map((r) => [r.id, r.cents])).toEqual([
      ["pov", 40000],
      [null, 35000],
      [null, 25000],
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  });

  test("owners the player can't see, masked as null or as an empty id, still get rows of their own", () => {
    // The keys of the rows a component draws, read off its tree (no DOM needed).
    const rowKeys = (node: unknown): unknown[] => (Array.isArray(node) ? node.flatMap(rowKeys) : !isRecord(node) || !isRecord(node.props) ? [] : node.type === ListRow ? [node.key] : rowKeys(node.props.children));
    const owners = [
      { party: "marcus", name: "Marcus", role: "owner" as const, share: 60 },
      { party: null, name: "someone", role: "owner" as const, share: 20 },
      { party: "", name: "an owner", role: "owner" as const, share: 10 },
      { party: "", name: "an owner", role: "owner" as const, share: 10 },
    ];
    const keys = rowKeys(OwnerRows({ owners }));
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
  });
});

describe("realism gating", () => {
  test("Money 0 shows nothing, Money 1 only the overview's band; a party shows only the sections it has", () => {
    expect(hubTabs(view({ level: 0 }), "player")).toEqual([]);
    expect(hubTabs(view({ level: 1, accounts: [checking] }), "player").map((t) => t.id)).toEqual(["overview"]);
    expect(hubTabs(view({ accounts: [checking] }), "player").map((t) => t.id)).toEqual(["overview", "accounts", "flows"]);
    const full = view({ level: 4, detail: true, accounts: [checking], investments: { value: 1, cost: 1, unrealised: 0, realised: 0, holdings: [] }, credit: { person: "pov", score: 712, band: "good", tier: "prime", asOf: "Oct 1", factors: null, history: [], utilisationPct: 34, ageMonths: 50, onTimePct: 100, accounts: [], inquiries: [], marks: [], offers: [] } });
    expect(hubTabs(full, "player").map((t) => t.id)).toEqual(["overview", "accounts", "flows", "investments", "credit"]);
  });

  test("a household that holds no account itself shows its members, with no empty Accounts or Flows tab", () => {
    const household = { id: "home", name: "The Kowalczyks", members: [{ id: "helen", name: "Helen", role: "head", share: 60 }], accounts: [], flows: [], monthly: { total: 52000, parts: [{ id: "helen", name: "Helen", cents: 31200 }] } };
    expect(hubTabs(view({ partyKind: "household", household }), "player").map((t) => t.id)).toEqual(["overview", "household"]);
    expect(hubTabs(view({ partyKind: "household" }), "player").map((t) => t.id)).toEqual(["overview"]);
  });

  test("the GM also gets the sections it adds to while they're empty: a person's Jobs, Properties, and a person's Household from Money 3", () => {
    expect(hubTabs(view({ accounts: [checking] }), "gm").map((t) => t.id)).toEqual(["overview", "accounts", "flows", "jobs", "properties", "household"]);
    // Below Money 3 a household doesn't show, so there's nothing to add to; a business holds no job.
    expect(hubTabs(view({ level: 2, features: [], accounts: [checking] }), "gm").map((t) => t.id)).toEqual(["overview", "accounts", "jobs", "properties"]);
    expect(hubTabs(view({ partyKind: "business", accounts: [checking] }), "gm").map((t) => t.id)).toEqual(["overview", "accounts", "flows", "properties"]);
    // A band and no accounts yet: what the GM adds wouldn't show.
    expect(hubTabs(view({ overview: null, cash: { band: "modest" } }), "gm").map((t) => t.id)).toEqual(["overview"]);
  });

  test("below the top level an account shows its balance and a few lines, never its terms, statements, pending lines or holds", () => {
    const simple = accountBlocks(view({ accounts: [visa] }), visa);
    expect(simple).toMatchObject({ terms: false, statements: false, pending: false, holds: false, owners: false, transactions: 5 });
    const full = accountBlocks(view({ level: 4, detail: true, features: TOP, accounts: [visa] }), visa);
    expect(full).toMatchObject({ terms: true, statements: true, holds: true, owners: true, transactions: 40 });
  });

  test("a feature the world switches on shows its own detail below the top level and nothing more; one switched off is gone at the top level too", () => {
    const low = portAlderMoney(3, { flows: true, daily_limits: true });
    expect([low.level, low.detail]).toEqual([3, false]);
    expect(accountBlocks(low, accountIn(low, "acct_pov_card"))).toMatchObject({ cardLimits: true, terms: false, pending: false, holds: false, transactions: 5 });
    expect(overviewBlocks(low)).toMatchObject({ cashFlowByCategory: false, cashFlowAhead: false, upcoming: 5, recent: 5 });
    expect(workBlocks(low)).toMatchObject({ deductions: false, books: false, sales: false });
    const top = portAlderMoney(4, { daily_limits: false, capital_gains: false });
    expect([top.level, top.detail]).toEqual([4, true]);
    expect(accountBlocks(top, accountIn(top, "acct_pov_card"))).toMatchObject({ cardLimits: false, transactions: 40 });
    expect(investmentBlocks(top)).toEqual({ lots: false, gains: false, income: true });
  });

  test("the preview's GM money views carry the books and features the engine gives each party's level", () => {
    const money = gmFixture().money;
    expect(money.map((m) => m.level).sort()).toEqual([2, 4]);
    for (const m of money) {
      expect(m.detail).toBe(m.level >= 4);
      expect(m.features).toEqual(FINANCE_FEATURES.filter((f) => featureOn(m.level, f)));
    }
  });

  test("a shared account names its owners at any level", () => {
    const joint = account({ id: "joint", class: "checking", owners: [{ party: "pov", name: "You", role: "joint", share: 50 }, { party: "mara", name: "Mara", role: "joint", share: 50 }], role: "joint" });
    expect(accountBlocks(view({ accounts: [joint] }), joint).owners).toBe(true);
  });

  test("the overview, investments, credit and work show their detail only at the top level", () => {
    expect(overviewBlocks(view())).toEqual({ assets: false, breakdown: false, cashFlowByCategory: false, cashFlowAhead: false, upcoming: 5, recent: 5 });
    expect(overviewBlocks(view({ level: 4, detail: true }))).toEqual({ assets: true, breakdown: true, cashFlowByCategory: true, cashFlowAhead: true, upcoming: 20, recent: 20 });
    expect(investmentBlocks(view())).toEqual({ lots: false, gains: false, income: false });
    expect(investmentBlocks(view({ features: ["capital_gains"] }))).toEqual({ lots: true, gains: true, income: false });
    expect(creditBlocks(view())).toEqual({ factors: false, report: false, history: 0 });
    expect(workBlocks(view({ level: 4, detail: true, features: TOP }))).toEqual({ withholding: true, deductions: true, books: true, sales: true, taxes: true });
    expect(workBlocks(view())).toEqual({ withholding: false, deductions: false, books: false, sales: false, taxes: false });
  });
});

describe("what a party's roles allow", () => {
  const all = view({ accounts: [cash, checking, savings, visa] });

  test("an owner transfers and handles cash at a bank account, pays what a card owes and sets its autopay", () => {
    expect(accountControls(all, checking)).toEqual(["transfer", "withdraw", "deposit"]);
    expect(accountControls(all, visa)).toEqual(["pay", "autopay"]);
    // Cash moves by Withdraw and Deposit, never as a transfer target.
    expect(transferTargets(all, "chk").map((a) => a.id)).toEqual(["sav"]);
  });

  test("a beneficiary can't spend, a closed account offers nothing, and Money 1 has no controls", () => {
    const custodial = account({ id: "kid", class: "savings", role: "beneficiary" });
    expect(accountControls(view({ accounts: [cash, checking, custodial] }), custodial)).toEqual([]);
    const closed = account({ id: "old", class: "checking", status: "closed" });
    expect(accountControls(view({ accounts: [checking, closed] }), closed)).toEqual([]);
    expect(accountControls(view({ level: 1, accounts: [cash, checking, savings] }), checking)).toEqual([]);
  });

  test("a standing payment comes from an account the party manages: never cash, nor one an authorized user only spends from", () => {
    const shared = account({ id: "mom", class: "checking", role: "authorized_user" });
    expect(flowSources(view({ accounts: [cash, checking, savings, shared] })).map((s) => s.id)).toEqual(["chk", "sav"]);
  });

  test("a card's holder changes its state as the state allows; someone else's card on an account they don't manage, never", () => {
    const v = view({ accounts: [checking] });
    expect(cardControls(v, card({ id: "c", account: "chk" }))).toEqual(["freeze", "lost", "replace"]);
    expect(cardControls(v, card({ id: "c", account: "chk", state: "frozen" }))).toEqual(["unfreeze", "lost", "replace"]);
    expect(cardControls(v, card({ id: "c", account: "chk", state: "lost" }))).toEqual(["replace"]);
    expect(cardControls(v, card({ id: "c", account: "chk", state: "cancelled" }))).toEqual([]);
    const theirs = account({ id: "theirs", class: "checking", role: "authorized_user" });
    expect(cardControls(view({ accounts: [theirs] }), card({ id: "c", account: "theirs", holderId: "mara" }))).toEqual([]);
  });

  test("an account the party runs for a business they own is theirs to manage, though their own role on it only spends", () => {
    const till = account({ id: "shop", class: "business_checking", role: "authorized_user", manages: true });
    const line = account({ id: "line", class: "line_of_credit", role: "authorized_user", manages: true, cents: -5000, autopay: { mode: "none", from: null, fromName: null, cents: null } });
    const v = view({ accounts: [checking, till, line] });
    expect(flowSources(v).map((s) => s.id)).toEqual(["chk", "shop"]);
    expect(accountControls(v, line)).toContain("autopay");
    expect(cardControls(v, card({ id: "c", account: "shop", holderId: "danny" }))).toEqual(["freeze", "lost", "replace"]);
  });

  const shop = (role: BusinessView["role"]): BusinessView => ({ id: "shop", name: "The shop", role, owners: [], accounts: [], places: [], books: { period: "Oct", revenue: 0, expenses: 0, payroll: 0, taxes: 0, profit: 0, lines: [] }, months: [], sales: [], invoices: [], employees: [], taxes: [], route: null });
  const flow = (over: Partial<FlowView> & Pick<FlowView, "id" | "spec">): FlowView => ({ label: over.id, kind: "bill", from: "", to: "", amount: "", cents: null, schedule: "", next: null, shortfall: "skip", status: "active", category: null, link: null, payer: over.spec?.from ?? null, editable: false, source: "entity", done: 0, missed: 0, deferred: 0, ...over });
  const bill = (from: string): Flow => ({ id: "invoice:inv1", label: "Invoice", kind: "bill", from, to: "theirs", amount: { fixed: 5000 }, schedule: { once: "2026-10-01T09:00" }, shortfall: "skip", status: "active", source: "invoice" });

  test("an invoice billed to the party or to a business they run is theirs to pay now; one billed to someone else isn't", () => {
    const runs = view({ level: 3, businesses: [shop("trustee")] });
    const link = { id: "inv1", name: "Invoice" };
    expect(flowControls(runs, flow({ id: "invoice:inv1", source: "invoice", link, spec: bill("pov") }))).toEqual(["pay_now"]);
    expect(flowControls(runs, flow({ id: "invoice:inv1", source: "invoice", link, spec: bill("shop") }))).toEqual(["pay_now"]);
    expect(flowControls(view({ level: 3, businesses: [shop("beneficiary")] }), flow({ id: "invoice:inv1", source: "invoice", link, spec: bill("shop") }))).toEqual([]);
    // Below Money 3 an invoice isn't an action; it's paid when it falls due.
    expect(flowControls(view({ level: 2 }), flow({ id: "invoice:inv1", source: "invoice", link, spec: bill("pov") }))).toEqual([]);
  });

  test("someone who only shares in a business's worth sells a stake where investments run, and runs nothing", () => {
    expect(businessControls(view({ level: 4, features: ["investments"] }), shop("beneficiary"))).toEqual(["stake"]);
    expect(businessControls(view({ level: 3 }), shop("beneficiary"))).toEqual([]);
    expect(businessControls(view({ level: 3 }), shop("trustee"))).toEqual(["hire", "invoice", "draw", "distribute"]);
    const invoice = { id: "inv1", business: "shop", customer: "pov", cents: 5000, memo: "", issued: 0, due: 0, state: "paid" as const, customerName: "You", issuedAt: "", dueAt: "" };
    expect(invoiceControls(view({ level: 3 }), shop("owner"), invoice)).toEqual([]);
    expect(invoiceControls(view({ level: 3 }), shop("owner"), { ...invoice, state: "late" })).toEqual(["void", "pay"]);
  });

  test("a holding trades only in an account the party may spend from; an option exercises only where options run", () => {
    const holding = (over: Partial<HoldingView>): HoldingView => ({ id: "h", account: "brk", asset: { id: "acme", label: "Acme", class: "security", symbol: "ACME" }, qty: 1, price: 100, value: 100, cost: 100, gain: 0, lots: [], option: null, route: null, ...over });
    const mine = account({ id: "brk", class: "brokerage" });
    const kids = account({ id: "brk", class: "brokerage", role: "beneficiary" });
    const call = { right: "call" as const, underlying: "Acme", strike: 90, expiry: "2026-12-18", inTheMoney: true };
    expect(holdingControls(view({ features: ["investments"], accounts: [mine] }), holding({}))).toEqual(["buy", "sell"]);
    expect(holdingControls(view({ features: ["investments"], accounts: [kids] }), holding({}))).toEqual([]);
    expect(holdingControls(view({ features: ["investments"], accounts: [mine] }), holding({ option: call }))).toEqual(["buy", "sell"]);
    expect(holdingControls(view({ features: ["investments", "options"], accounts: [mine] }), holding({ option: call }))).toEqual(["buy", "sell", "exercise"]);
    expect(holdingControls(view({ features: [], accounts: [mine] }), holding({}))).toEqual([]);
  });

  test("an owner ends a lease their books carry; outside tenants of a managed property come and go on their own", () => {
    const duplex: PropertyView = { id: "duplex", name: "The duplex", place: null, owners: [], share: 100, value: 1, equity: 1, forSale: null, mortgage: null, costs: [], route: null, leases: [
      { flow: "lease:duplex:mara", tenant: "Mara", rent: 120000, start: "2026-01-01", end: "2026-12-31", state: "let" },
      { flow: "lease:duplex:u2:1", tenant: "Outside tenant", rent: 110000, start: "2026-01-01", end: "2026-12-31", state: "let" },
      { flow: "", tenant: "", rent: 110000, start: null, end: null, state: "vacant" },
    ] };
    const books = view({ features: ["property"], flows: [flow({ id: "lease:duplex:mara", kind: "rent", spec: { ...bill("mara"), id: "lease:duplex:mara", source: "entity" } })] });
    expect(propertyControls(books, duplex)).toEqual(["let", "sell"]);
    expect(endableLeases(books, duplex)).toEqual(["lease:duplex:mara"]);
    expect(endableLeases({ ...books, features: [] }, duplex)).toEqual([]);
    expect(propertyControls(books, { ...duplex, share: 0 })).toEqual([]);
    expect(propertyControls(books, { ...duplex, share: 0, forSale: 30000000 })).toEqual(["buy"]);
  });
});

describe("the requests the controls send", () => {
  test("a player's control is an action from the palette, without words to judge", () => {
    expect(actionRequest("c1", transferAction("chk", "sav", 5000))).toEqual({ type: "lre.action", chatId: "c1", action: "move_money", params: { from: "chk", to: "sav", amount: 5000 }, source: "palette" });
    expect(payCardAction("visa", "chk", null)).toEqual({ action: "pay_card", params: { card: "visa", from: "chk" } });
    expect(payCardAction("visa", null, 3500)).toEqual({ action: "pay_card", params: { card: "visa", amount: 3500 } });
    expect(cashAction("withdraw", "chk", 2000)).toEqual({ action: "withdraw_cash", params: { account: "chk", amount: 2000 } });
    expect(cardAction("c", "lost")).toEqual({ action: "card_report_lost", params: { card: "c" } });
  });

  test("autopay sends the account it pays from only when it pays, and a fixed amount only for fixed; the GM sets only what changes", () => {
    expect(autopayAction("visa", "none", "chk", null)).toEqual({ action: "set_autopay", params: { account: "visa", mode: "none" } });
    expect(autopayAction("visa", "fixed", "chk", 10000)).toEqual({ action: "set_autopay", params: { account: "visa", mode: "fixed", from: "chk", amount: 10000 } });
    expect(autopayOps("visa", visa.autopay, "full", "chk", null)).toEqual([{ op: "set", entity: "visa", field: "autopay", value: "full" }]);
  });

  const rent: Flow = { id: "flow_rent", label: "Rent", kind: "rent", from: "chk", to: "landlord", amount: { fixed: 99500 }, schedule: { every: "week", weekdays: [5] }, shortfall: "skip", status: "active", source: "entity" };

  test("a flow form says what's missing before it can go", () => {
    expect(flowFormProblem(blankFlowForm("chk"), USD, true)).toBe("Give it a name.");
    const weekly = { ...blankFlowForm("chk"), label: "Allowance", to: "sav", amount: "20", every: "week" as const };
    expect(flowFormProblem(weekly, USD, true)).toBe("Pick a weekday.");
    expect(flowFormProblem({ ...weekly, weekday: 1, shortfall: "fallback" }, USD, true)).toBe("Pick the account that pays when this one can't.");
    expect(flowFormProblem({ ...weekly, weekday: 1 }, USD, true)).toBeNull();
  });

  test("a new flow sends its schedule's own parts; a one-off sends when it happens", () => {
    const monthly = { ...blankFlowForm("chk"), label: "Savings", to: "sav", amount: "250", day: -1 };
    expect(flowCreateAction(monthly, USD)).toEqual({ action: "flow_create", params: { label: "Savings", kind: "transfer", from: "chk", to: "sav", every: "month", shortfall: "skip", amount: 25000, interval: 1, day: -1 } });
    const once = { ...monthly, label: "Gift", every: "once" as const, start: "2026-12-24", at: "18:00" };
    expect(flowCreateAction(once, USD).params).toEqual({ label: "Gift", kind: "transfer", from: "chk", to: "sav", every: "once", shortfall: "skip", amount: 25000, once: "2026-12-24T18:00" });
  });

  test("an edit sends only what changed, and a schedule whole when any of it changes", () => {
    const form = flowFormOf(rent, USD);
    expect(form.amount).toBe("995.00");
    expect(flowUpdateAction(rent, form, USD)).toBeNull();
    expect(flowUpdateAction(rent, { ...form, amount: "1050" }, USD)).toEqual({ action: "flow_update", params: { flow: "flow_rent", amount: 105000 } });
    expect(flowUpdateAction(rent, { ...form, weekday: 1 }, USD)).toEqual({ action: "flow_update", params: { flow: "flow_rent", every: "week", interval: 1, weekday: 1 } });
  });

  test("an edit back to every time sends an interval of 1, with the schedule whole; so does the GM's", () => {
    const fortnightly: Flow = { ...rent, schedule: { every: "week", interval: 2, weekdays: [5], at: "07:30" } };
    const form = flowFormOf(fortnightly, USD);
    expect(flowUpdateAction(fortnightly, { ...form, interval: 1 }, USD)?.params).toEqual({ flow: "flow_rent", every: "week", interval: 1, weekday: 5, at: "07:30" });
    expect(flowEditOps(fortnightly, form, USD)).toEqual([]);
    expect(flowEditOps(fortnightly, { ...form, interval: 1 }, USD)).toEqual([{ op: "set", entity: "flow_rent", field: "interval", value: 1 }]);
  });

  test("an edit renames, and names the optional parts it empties; the GM's goes by its flow edit", () => {
    const dated: Flow = { ...rent, schedule: { every: "week", weekdays: [5], at: "07:30" }, end: "2027-06-30", count: 12, category: "housing" };
    const form = flowFormOf(dated, USD);
    expect(flowUpdateAction(dated, { ...form, label: "Room rent" }, USD)?.params).toEqual({ flow: "flow_rent", label: "Room rent" });
    expect(flowUpdateAction(dated, { ...form, at: "", end: "", count: null, category: "" }, USD)?.params).toEqual({ flow: "flow_rent", clear: "at,end,count,category" });
    expect(flowEditOps(dated, { ...form, label: "Room rent", end: "", count: null }, USD)).toEqual([{ op: "effect", effect: "economy.flow_edit", args: { flow: "flow_rent", name: "Room rent", clear: "end,count" } }]);
  });

  test("the GM's change sets the declared fields and empties what an old schedule shape held", () => {
    const form = flowFormOf(rent, USD);
    expect(flowEditOps(rent, { ...form, every: "month", day: 1 }, USD)).toEqual([
      { op: "set", entity: "flow_rent", field: "every", value: "month" },
      { op: "set", entity: "flow_rent", field: "days", value: [1] },
      { op: "set", entity: "flow_rent", field: "weekdays", value: [] },
    ]);
    const gift: Flow = { ...rent, id: "flow_gift", schedule: { once: "2026-12-24T18:00" } };
    const ops = flowEditOps(gift, { ...flowFormOf(gift, USD), every: "month", day: 24 }, USD);
    expect(ops).toContainEqual({ op: "set", entity: "flow_gift", field: "once", value: "" });
    expect(ops).toContainEqual({ op: "set", entity: "flow_gift", field: "every", value: "month" });
  });

  test("the GM's new flow is spawned and set in one edit, under an id no one has", () => {
    const id = newIdFor("flow", "Rent!", new Set(["flow_rent"]));
    expect(id).toBe("flow_rent_2");
    const ops = flowSpawnOps(id, { ...blankFlowForm("chk"), label: "Rent", to: "landlord", amount: "995" }, USD);
    expect(ops[0]).toEqual({ op: "spawn", kind: "flow", name: "Rent", id: "flow_rent_2" });
    expect(ops).toContainEqual({ op: "set", entity: "flow_rent_2", field: "amount_cents", value: 99500 });
    expect(ops).toContainEqual({ op: "set", entity: "flow_rent_2", field: "status", value: "active" });
  });

  test("a trade names what it buys or sells and how much, where a buy pays from and a sale's money goes; an option needs its strike and expiry", () => {
    const base = { side: "buy" as const, holding: "", asset: "", account: "", qty: null, amount: "", from: "", to: "", option: null };
    expect(tradeAction({ ...base, side: "sell" }, USD)).toBe("Pick what to sell.");
    expect(tradeAction({ ...base, asset: "vti", account: "brk", amount: "500" }, USD)).toEqual({ action: "trade", params: { side: "buy", asset: "vti", account: "brk", amount: 50000 } });
    expect(tradeAction({ ...base, holding: "h1", qty: 5, from: "chk", to: "sav" }, USD)).toEqual({ action: "trade", params: { side: "buy", holding: "h1", qty: 5, from: "chk" } });
    expect(tradeAction({ ...base, side: "sell", holding: "h1", from: "chk", to: "sav" }, USD)).toEqual({ action: "trade", params: { side: "sell", holding: "h1", to: "sav" } });
    expect(tradeAction({ ...base, asset: "vti", qty: 1, option: { right: "call", strike: "300", expiry: "2027-01" } }, USD)).toBe("An option needs a strike and an expiry date.");
    expect(tradeAction({ ...base, asset: "vti", qty: 1, option: { right: "put", strike: "300", expiry: "2027-01-15" } }, USD)).toEqual({ action: "trade", params: { side: "buy", asset: "vti", qty: 1, right: "put", strike: 30000, expiry: "2027-01-15" } });
    expect(exerciseAction("opt", null, { from: "chk" })).toEqual({ action: "exercise_option", params: { holding: "opt", from: "chk" } });
    expect(exerciseAction("opt", 2)).toEqual({ action: "exercise_option", params: { holding: "opt", qty: 2 } });
  });

  test("work, credit, routing and payment preferences send the params their actions take", () => {
    expect(hireAction({ business: "alder", worker: "dev", title: " Mechanic ", basis: "hourly", rate: "23.50", hoursPerWeek: 40, payEvery: "biweekly" }, USD)).toEqual({ action: "job_hire", params: { business: "alder", worker: "dev", title: "Mechanic", basis: "hourly", rate: 2350, hours_per_week: 40, pay_every: "biweekly" } });
    expect(hireAction({ business: "alder", worker: "dev", title: "", basis: "", rate: "lots", hoursPerWeek: null, payEvery: "" }, USD)).toBeNull();
    expect(invoiceIssueAction("alder", { id: "mara" }, 42000, "Brake job", null)).toEqual({ action: "invoice_issue", params: { business: "alder", customer: "mara", amount: 42000, memo: "Brake job" } });
    expect(invoiceIssueAction("alder", { name: " Harbor Mutual " }, 9900, "", 30)).toEqual({ action: "invoice_issue", params: { business: "alder", customer_name: "Harbor Mutual", amount: 9900, days: 30 } });
    expect(routeAction({ property: "duplex" }, "chk")).toEqual({ action: "route_distributions", params: { property: "duplex", to: "chk" } });
    expect(payPrefsAction([{ use: "credit", max: 50000, categories: [] }, { use: "cash", except: ["dining"] }])).toEqual({ action: "set_pay_prefs", params: { tiers: JSON.stringify([{ use: "credit", max: 50000 }, { use: "cash", except: ["dining"] }]) } });
  });

  test("the GM's field edits set what changed (a reference left empty is cleared); its other controls run the GM effects", () => {
    expect(fieldOps("acct", { limit: 100, apr_pct: 22, overdraft_link: "sav" }, { limit: 150, apr_pct: 22, overdraft_link: undefined }, new Set(["overdraft_link"]))).toEqual([
      { op: "set", entity: "acct", field: "limit", value: 150 },
      { op: "set", entity: "acct", field: "overdraft_link", value: null },
    ]);
    expect(setPriceOps("vti", 31250)).toEqual([{ op: "effect", effect: "economy.set_price", args: { asset: "vti", price: 31250 } }]);
    expect(routeOps({ property: "duplex" }, "helen", "sav")).toEqual([{ op: "effect", effect: "economy.route", args: { property: "duplex", party: "helen", to: "sav" } }]);
    expect(closeAccountOps("old")).toEqual([{ op: "effect", effect: "economy.close_account", args: { account: "old" } }]);
  });
});
