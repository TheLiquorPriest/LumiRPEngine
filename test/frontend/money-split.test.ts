// The Money split (ORG-SPEC §5, §11 Phase 1, lane M), its trees walked without a DOM:
// - the segments by Money level: Summary alone at 1, with no row; Accounts from 2; In & out, and
//   Assets where property runs, from 3; Credit at 4; Port Alder's Jordan shows all five;
// - §5.2's moves, walked row by row: every control id of accountControls, flowControls,
//   jobControls, businessControls, invoiceControls, propertyControls and holdingControls is reached
//   within three levels from where the table puts it, Me → Money's segments or an organization's
//   tabs in Orgs, as Play opens each page; and no Businesses or Household page is left in Money;
// - Port Alder: Jordan's Income opens his job with its payslip; as a member of the Kowalczyks his
//   In & out has the household's row, which opens Orgs; as a joint owner of Alder Automotive he
//   finds Money, Ownership, Taxes and Payroll in Orgs, and hires Jess from People's Hire someone
//   (Payroll has no Hire of its own) and issues an invoice from Money, each played as a turn as it
//   was from Money.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { FINANCE_FEATURES, featureOn, type AccountView, type BusinessView, type FinanceView, type FlowView, type HoldingView, type JobView, type PropertyView } from "../../src/shared/finance";
import type { Level } from "../../src/shared/ids";
import { isRecord, type JsonValue } from "../../src/shared/json";
import type { OrgView } from "../../src/shared/org-view";
import type { PaletteView } from "../../src/shared/state-view";
import { DEFAULT_CURRENCY, type WorldDoc } from "../../src/shared/world";
import type { SheetRoute } from "../../src/frontend/app";
import { ListRow, Section, Tabs } from "../../src/frontend/components";
import { materializeAll } from "../../src/engine/materialize";
import { readPass } from "../../src/engine/read-pass";
import { createRegistry } from "../../src/engine/registry-impl";
import { Working } from "../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { decodeFinanceView, decodeOwnership, decodePayroll, decodeTaxes } from "../../src/packs/economy/ui/decode";
import { MoneyHub, type PlayerControls, type Reader } from "../../src/packs/economy/ui/hub";
import { accountControls, ALL_ACTIVITY, businessControls, flowControls, holdingControls, invoiceControls, jobControls, moneySegments, propertyControls, type MoneySegment } from "../../src/packs/economy/ui/layout";
import { Gone, sectionPage, type Elsewhere, type HubNav } from "../../src/packs/economy/ui/nav";
import { OrgMoney, OrgPayroll, orgNav } from "../../src/packs/economy/ui/orgs";
import { OrgOwnership } from "../../src/packs/economy/ui/ownership";
import { OrgTaxes } from "../../src/packs/economy/ui/taxes";
import { HubPageView } from "../../src/packs/economy/ui/pages";
import { invoiceIssueAction } from "../../src/packs/economy/ui/requests";
import { hireAction, newcomers, peopleControls } from "../../src/packs/orgs/ui/edit";
import { pageOf, routeFrom, routeOf } from "../../src/packs/economy/ui/routes";
import { sheetMoney } from "../../src/packs/economy/ui/sheet";
import { startState } from "../packs/support";
import { accepted, MoneyChat } from "../support/money-chat";
import type { Props } from "../support/tree";

const USD = DEFAULT_CURRENCY;
const TOP = FINANCE_FEATURES.filter((f) => featureOn(4, f));
const noop = (): void => undefined;

// ---------------------------------------------------------------- views

function account(over: Partial<AccountView> & Pick<AccountView, "id" | "class">): AccountView {
  return { name: over.id, classLabel: "", product: { id: over.class, label: "" }, institution: null, status: "open", cents: 0, available: null, owners: [{ party: "pov", name: "You", role: "owner", share: 100 }], role: "owner", manages: true, spends: true, autopayFrom: [], fallbacks: [], limit: null, interest: null, terms: [], autopay: null, due: null, statements: [], cards: [], pending: [], holds: [], transactions: [], securedBy: null, loan: null, ...over };
}

function flow(over: Partial<FlowView> & Pick<FlowView, "id">): FlowView {
  const label = over.label ?? over.id;
  return { label, kind: "bill", from: "Checking", to: "Landlord", amount: "$10.00", cents: 1000, schedule: "monthly", next: null, shortfall: "skip", status: "active", category: null, link: null, editable: true, source: "entity", payer: "pov", done: 0, missed: 0, deferred: 0, spec: { id: over.id, label, kind: "bill", from: "chk", to: "landlord", amount: { fixed: 1000 }, schedule: { every: "month" }, shortfall: "skip", status: "active", source: "entity" }, ...over };
}

function job(over: Partial<JobView> & Pick<JobView, "id" | "workerId">): JobView {
  return { title: "Mechanic", employer: "The Shop", employerId: "shop", worker: over.workerId === "pov" ? "You" : "Danny", basis: "hourly", pay: "$23.50 an hour", rate: 2350, payEvery: "biweekly", schedule: "every other Friday", nextPay: "Fri 6 Nov", grossPerPeriod: 188000, status: "active", hours: null, lastPay: null, deductions: [], splits: [], spec: { worker: over.workerId, employer: "shop", basis: "hourly", rate: 2350, pay_every: "biweekly" }, ...over };
}

function view(over: Partial<FinanceView> = {}): FinanceView {
  return { party: "pov", name: "You", partyKind: "person", level: 3, detail: false, features: ["flows", "cards"], band: "comfortable", opened: true, cash: { cents: 4600 }, overview: { netWorth: 100000, assets: 120000, liabilities: 20000, breakdown: [], cashFlow: null, upcoming: [], alerts: [] }, accounts: [], cards: [], flows: [], jobs: [], businesses: [], investments: null, properties: [], credit: null, household: null, recent: [], notes: [], payPrefs: [], paysFor: [], ownKeys: ["pov", "you"], ...over };
}

const cash = account({ id: "wallet", class: "cash", cents: 4600 });
const checking = account({ id: "chk", class: "checking", cents: 124018, available: 124018 });
const savings = account({ id: "sav", class: "savings", cents: 350000 });
const visa = account({ id: "visa", class: "credit_card", cents: -41255, limit: 120000, autopay: { mode: "minimum", from: "chk", fromName: "Checking", cents: null } });

const ownJob = job({ id: "job_pov", workerId: "pov" });
const dannyJob = job({ id: "job_danny", workerId: "danny", worker: "Danny" });

const invoices: BusinessView["invoices"] = [
  { id: "inv_dale", business: "shop", customer: "dale", cents: 42000, memo: "Brake job", issued: 0, due: 1, state: "open", customerName: "Dale", issuedAt: "Mon 2 Nov", dueAt: "Mon 16 Nov" },
  { id: "inv_mine", business: "shop", customer: "pov", cents: 9900, memo: "Oil change", issued: 0, due: 1, state: "open", customerName: "You", issuedAt: "Mon 2 Nov", dueAt: "Mon 16 Nov" },
];

/** The shop as its owner's view holds it: theirs to run, an LLC, with someone on its payroll and two open invoices. */
const shop: BusinessView = {
  id: "shop",
  name: "The Shop",
  role: "owner",
  mayDraw: true,
  selfDealing: [],
  owners: [{ party: "pov", name: "You", role: "owner", share: 100 }],
  accounts: ["acct_shop"],
  managed: [account({ id: "acct_shop", class: "checking", cents: 500000, role: null, manages: true, spends: false, owners: [{ party: "shop", name: "The Shop", role: "owner", share: 100 }] })],
  places: [{ id: "shop_floor", name: "The Shop floor" }],
  books: { period: "2026", revenue: 900000, expenses: 300000, payroll: 200000, taxes: 0, profit: 400000, lines: [] },
  months: [],
  sales: [],
  invoices,
  employees: [dannyJob],
  taxes: [{ label: "Sales tax", cents: 1200, due: "Mon 30 Nov" }],
  route: { to: null, reinvest: false },
};

const stock: HoldingView = { id: "h_stock", account: null, asset: { id: "acme", label: "Acme Corp", class: "security", symbol: "ACME" }, qty: 10, price: 1000, value: 10000, cost: 9000, gain: 1000, lots: [], option: null, route: null, performance: null };
const call: HoldingView = { ...stock, id: "h_call", asset: { id: "acme_call", label: "Acme call", class: "option", symbol: null }, option: { right: "call", underlying: "Acme Corp", strike: 900, expiry: "2027-01-15", inTheMoney: true } };

function property(over: Partial<PropertyView> & Pick<PropertyView, "id">): PropertyView {
  return { name: over.id, place: null, owners: [], share: 100, value: 30000000, equity: 30000000, mortgage: null, leases: [], costs: [], route: null, ...over };
}

/** The POV's own money, with something for every control: accounts to pay, move and cash out; standing payments active, paused and under a lease; an invoice billed to them; their own job and the shop they run; holdings, an option among them; a property of theirs and one for sale; a credit report. */
const pov = view({
  level: 4,
  detail: true,
  features: TOP,
  accounts: [cash, checking, savings, visa],
  flows: [
    flow({ id: "flow_gym", label: "Gym" }),
    flow({ id: "flow_paused", label: "Paused savings", status: "paused" }),
    flow({ id: "flow_rent", label: "Rent", kind: "rent", link: { id: "lease_2b", name: "Unit 2B" } }),
    flow({ id: "invoice:inv_brightline", label: "Brightline invoice", source: "invoice", editable: false, link: { id: "inv_brightline", name: "Brightline" }, spec: null }),
  ],
  jobs: [ownJob],
  businesses: [shop],
  investments: { value: 20000, cost: 18000, unrealised: 2000, realised: 0, holdings: [stock, call], market: [{ asset: "tmkt", label: "Total Market", class: "fund", symbol: "TMKT", price: 1000 }], accounts: [] },
  properties: [property({ id: "house" }), property({ id: "lot", share: 0, forSale: 5000000 })],
  credit: { person: "pov", score: 712, band: "good", tier: "prime", asOf: "Oct 1", factors: null, history: [], utilisationPct: 34, ageMonths: 50, onTimePct: 100, accounts: [], inquiries: [], marks: [], offers: [{ product: "visa_gold", label: "Visa Gold", class: "credit_card", aprPct: 22, limit: 500000 }] },
});

/** The shop's own money (its Money tab's section): its account, its trade, and itself, with its books, invoices and payroll. */
const shopMoney = view({ party: "shop", name: "The Shop", partyKind: "business", level: 4, detail: true, features: TOP, band: null, accounts: [account({ id: "acct_shop", class: "checking", cents: 500000, owners: [{ party: "shop", name: "The Shop", role: "owner", share: 100 }] })], flows: [flow({ id: "suppliers:shop", label: "Suppliers", source: "business", editable: false, payer: "shop", spec: null })], businesses: [{ ...shop, role: null, mayDraw: false }], ownKeys: [] });

function orgPage(over: Partial<OrgView> & Pick<OrgView, "id" | "name" | "type">): OrgView {
  return { kind: "Business", structure: null, badge: "Company", level: 4, exists: true, ended: null, you: { belongs: true, title: "Owner", position: null, since: null, reportsTo: [], powers: [], delegations: [] }, runBy: [], people: [], hidden: { count: 0, ids: [] }, positions: [], delegations: [], defaultPosition: null, dues: null, history: [], candidates: [], sections: {}, ...over };
}

const shopPage = orgPage({
  id: "shop",
  name: "The Shop",
  type: "company",
  sections: {
    money: JSON.parse(JSON.stringify(shopMoney)) as JsonValue,
    ownership: { structure: "llc", owners: [{ party: "pov", name: "You", role: "owner", share: 100 }], classes: null, units: null, decidePct: 50, valuation: null, parents: [], children: [], consolidated: null, role: "owner", mayDraw: true, route: { to: null, reinvest: false }, votes: 100, acts: null },
    taxes: { income: "owners", years: [{ year: 2026, salesCollected: 1200, salesRemitted: 0, withheld: 0, employerShare: 0, income: 0, property: 0 }], salesHeld: 1200, incomeSoFar: null, taxedTo: [{ name: "You", share: 100 }], untaxed: [], due: [{ label: "Sales tax", cents: 1200, at: "20 Nov 2026" }], pending: null },
    payroll: { headcount: 1, payroll: 200000, employees: JSON.parse(JSON.stringify([dannyJob])) as JsonValue },
  },
});

const palette: PaletteView = { entries: [{ action: "pay", label: "Pay", options: [{ label: "Jess", params: { to: "jess" }, person: true }] }], timelapse: null } as unknown as PaletteView;
const player: PlayerControls = { mode: "player", busy: false, currency: USD, palette, act: () => Promise.resolve(true) };

// ---------------------------------------------------------------- walking the trees

/** Every element of a tree, each of its components drawn where it draws without hooks (what it draws stands for its props); one with hooks, a form or a list's Show all, stays an element whose props are read. */
function elements(node: unknown): VNode<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node) || !("type" in node)) return [];
  const v = node as VNode<Props>;
  if (typeof v.type === "function") {
    let drawn: unknown;
    try {
      drawn = (v.type as (p: Props) => unknown)(v.props);
    } catch {
      return [v, ...Object.values(v.props).flatMap(elements)];
    }
    return [v, ...elements(drawn)];
  }
  return [v, ...Object.values(v.props).flatMap(elements)];
}

type Draw = (open: (route: SheetRoute) => void, elsewhere: (to: Elsewhere) => void) => unknown;

/** What a tree opens when every row and button in it is pressed: the sheets it pushes and the places outside money it leads to. */
function pressed(draw: Draw): { routes: SheetRoute[]; away: Elsewhere[] } {
  const routes: SheetRoute[] = [];
  const away: Elsewhere[] = [];
  const tree = draw(
    (route) => routes.push(route),
    (to) => away.push(to),
  );
  for (const el of elements(tree)) if (typeof el.props.onClick === "function") (el.props.onClick as () => void)();
  return { routes, away };
}

/** The money a sheet draws for a route, as the money sheet finds it: the POV's own, or an organization's from its page. */
function shownBy(route: SheetRoute, own: FinanceView, orgs: readonly OrgView[]) {
  const at = pageOf(route.kind, route.id);
  return at ? sheetMoney(at, own, player, (id) => decodeFinanceView(orgs.find((o) => o.id === id)?.sections.money ?? null)) : null;
}

/** A page drawn as its sheet draws it, its navigator opening as the sheet's does. */
function sheetPage(route: SheetRoute, own: FinanceView, orgs: readonly OrgView[]): Draw | null {
  const shown = shownBy(route, own, orgs);
  if (!shown) return null;
  return (open, elsewhere) => HubPageView({ page: shown.page, view: shown.view, controls: shown.controls, reader: shown.reader, nav: { page: shown.page, open: (next) => open(routeFrom(shown.view.party, shown.own, shown.reader, next)), back: noop, elsewhere, frame: "play", backLabel: null } });
}

/** Whether a route's page draws (rather than showing as gone). */
function draws(route: SheetRoute, own: FinanceView, orgs: readonly OrgView[]): boolean {
  const page = sheetPage(route, own, orgs);
  return page !== null && (page(noop, noop) as VNode).type !== Gone;
}

/**
 * Every page a root reaches, pressing each row and button as Play opens them: the root (Me →
 * Money's segment, an organization's tab) is the first level, what it opens the second, what those
 * open the third, and nothing deeper is opened. Each page is named `head/id/control[/within]` with
 * whose money it is (`pov` or the organization), and kept only where it draws.
 */
function reach(root: Draw, own: FinanceView, orgs: readonly OrgView[]): { pages: Set<string>; away: Elsewhere[] } {
  const pages = new Set<string>();
  const seen = new Set<string>();
  const first = pressed(root);
  const away = [...first.away];
  let frontier = first.routes;
  for (let level = 2; level <= 3 && frontier.length > 0; level += 1) {
    const next: SheetRoute[] = [];
    for (const route of frontier) {
      const key = `${route.kind}:${route.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const at = pageOf(route.kind, route.id);
      if (!at || !draws(route, own, orgs)) continue;
      pages.add(`${at.party ?? own.party}:${at.page.path.join("/")}`);
      const page = level < 3 ? sheetPage(route, own, orgs) : null;
      if (!page) continue;
      const opened = pressed(page);
      next.push(...opened.routes);
      away.push(...opened.away);
    }
    frontier = next;
  }
  return { pages, away };
}

const frame = { onSegment: noop, filter: ALL_ACTIVITY, onFilter: noop, now: null, garage: true, panelId: "p" };

/** Me → Money's segment, as the panel draws it over Play. */
function meMoney(own: FinanceView, segment: MoneySegment): Draw {
  return (open, elsewhere) => MoneyHub({ ...frame, segment, view: own, controls: player, nav: { page: null, open: (page) => open(routeOf(page, own.party, true)), back: noop, elsewhere, frame: "play", backLabel: null } });
}

/** An organization's tabs as its page in Orgs draws them, beside the POV's own money. */
function orgTabs(org: OrgView, own: FinanceView) {
  const reader: Reader = { view: own, controls: player };
  const nav = (open: (route: SheetRoute) => void, elsewhere: (to: Elsewhere) => void): HubNav => orgNav(org, reader, open, elsewhere);
  const money = decodeFinanceView(org.sections.money ?? null);
  const ownership = decodeOwnership(org.sections.ownership ?? null);
  const payroll = decodePayroll(org.sections.payroll ?? null);
  return {
    money: (segment: MoneySegment): Draw => (open, elsewhere) => (money ? OrgMoney({ ...frame, segment, view: money, reader, nav: nav(open, elsewhere), currency: USD }) : null),
    ownership: (): Draw => (open, elsewhere) => (ownership ? OrgOwnership({ org, section: ownership, reader, nav: nav(open, elsewhere) }) : null),
    payroll: (): Draw => (open, elsewhere) => (payroll ? OrgPayroll({ org, section: payroll, reader, nav: nav(open, elsewhere), currency: USD }) : null),
  };
}

/** Every page reached from each of a party's segments. */
function fromSegments(draw: (segment: MoneySegment) => Draw, money: FinanceView, own: FinanceView, orgs: readonly OrgView[]): Set<string> {
  return new Set(moneySegments(money, "player").flatMap((s) => [...reach(draw(s.id), own, orgs).pages]));
}

// ---------------------------------------------------------------- Port Alder

const reg = createRegistry(ALL_PACKS);

/** Port Alder as `pov` sees it at chat start (the authored levels unless `level` sets Money's), with the world changes a test makes. */
function portAlder(pov: string, patch: (world: WorldDoc) => void = () => undefined, level?: Level): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  world.pov = pov;
  if (level !== undefined) world.realism.levels.money = level;
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  materializeAll(reg, w, world.pov, "run");
  return w;
}

function povMoney(w: Working): FinanceView {
  const decoded = decodeFinanceView(JSON.parse(JSON.stringify(w.ctx.query("economy.finance")(w.ctx, w.world.pov, true))));
  if (!decoded) throw new Error("no money for the POV");
  return decoded;
}

function orgPages(w: Working): OrgView[] {
  const def = reg.views.find((v) => v.panel === "orgs.org");
  if (!def) throw new Error("no orgs.org panel");
  const pages = JSON.parse(JSON.stringify(readPass(() => def.build(w.ctx, { mapDisplay: null })))) as Record<string, OrgView>;
  return Object.values(pages);
}

// ---------------------------------------------------------------- the tests

describe("the segments by Money level", () => {
  const ids = (v: FinanceView) => moneySegments(v, "player").map((s) => s.id);
  const house = property({ id: "house" });

  test("Money 1 is Summary alone, with no row of segments", () => {
    const one = view({ level: 1, features: [], cash: { band: "modest" }, overview: null, band: "modest" });
    expect(ids(one)).toEqual(["summary"]);
    const tree = MoneyHub({ ...frame, segment: "summary", view: one, controls: player, nav: { page: null, open: noop, back: noop, elsewhere: noop, frame: "play", backLabel: null } });
    expect(elements(tree).filter((e) => e.type === Tabs)).toEqual([]);
  });

  test("Money 2 adds Accounts; Money 3 adds In & out, and Assets where property runs; Money 4 adds Credit", () => {
    expect(ids(view({ level: 2, features: [], accounts: [cash, checking] }))).toEqual(["summary", "accounts"]);
    const three = view({ level: 3, features: ["flows", "cards", "property"], accounts: [cash, checking], flows: [flow({ id: "flow_gym" })], properties: [house] });
    expect(ids(three)).toEqual(["summary", "accounts", "in_out", "assets"]);
    // Where property doesn't run, the view carries none, and there's no Assets.
    expect(ids({ ...three, features: ["flows", "cards"], properties: [] })).toEqual(["summary", "accounts", "in_out"]);
    const four = view({ ...three, level: 4, detail: true, features: TOP, credit: pov.credit });
    expect(moneySegments(four, "player").map((s) => s.label)).toEqual(["Summary", "Accounts", "In & out", "Assets", "Credit"]);
  });

  test("Port Alder's Jordan at its authored levels has all five, under a row; at Money 1, Summary alone", () => {
    expect(moneySegments(povMoney(portAlder("pov")), "player").map((s) => s.label)).toEqual(["Summary", "Accounts", "In & out", "Assets", "Credit"]);
    expect(ids(povMoney(portAlder("pov", undefined, 1)))).toEqual(["summary"]);
  });

  test("an organization's own money has its own segments: a company's Books, a household's In & out", () => {
    expect(ids(shopMoney)).toEqual(["summary", "accounts", "in_out", "books"]);
    const kowalczyks = orgPages(portAlder("helen_kowalczyk")).find((o) => o.id === "household_kowalczyk");
    const money = decodeFinanceView(kowalczyks?.sections.money ?? null);
    if (!money) throw new Error("Helen sees no money for her household");
    expect(ids(money)).toEqual(["summary", "in_out"]);
  });
});

describe("§5.2's moves: every control is reached within three levels from where the table puts it", () => {
  const orgs = [shopPage];
  const me = (segment: MoneySegment) => reach(meMoney(pov, segment), pov, orgs).pages;
  const tabs = orgTabs(shopPage, pov);
  const orgMoney = fromSegments(tabs.money, shopMoney, pov, orgs);
  const ownership = reach(tabs.ownership(), pov, orgs).pages;
  const payroll = reach(tabs.payroll(), pov, orgs).pages;
  const has = (pages: Set<string>, path: string) => expect([...pages]).toContain(`pov:${path}`);

  test("Accounts section; account, card, autopay, pay, transfer and cash pages → Accounts", () => {
    const pages = me("accounts");
    for (const a of pov.accounts) for (const c of accountControls(pov, a)) has(pages, `account/${a.id}/${c}`);
    expect(accountControls(pov, checking)).toEqual(["transfer", "withdraw", "deposit"]);
    expect(accountControls(pov, visa)).toEqual(["pay", "autopay"]);
    // Move money opens each control's page for the accounts that offer it.
    for (const c of ["transfer", "pay", "withdraw", "deposit"]) has(pages, `accounts/${c}`);
  });

  test("Flows section, flow pages and New → In & out → Standing payments; an invoice's Pay now → In & out → Invoices to pay", () => {
    const pages = me("in_out");
    const all = pov.flows.flatMap((f) => flowControls(pov, f).map((c) => `flow/${f.id}/${c}`));
    expect(new Set(all.map((p) => p.split("/").pop()))).toEqual(new Set(["edit", "pause", "resume", "end_lease", "delete", "pay_now"]));
    for (const path of all) has(pages, path);
    has(pages, "flows/new");
  });

  test("Jobs section, job page and Quit → In & out → Income; a payroll job's Raise and Let go → Orgs → People's Payroll", () => {
    expect(jobControls(pov, ownJob, null)).toEqual(["quit"]);
    has(me("in_out"), `job/${ownJob.id}/quit`);
    expect(jobControls(pov, dannyJob, shop)).toEqual(["raise", "let_go"]);
    for (const c of jobControls(pov, dannyJob, shop)) has(payroll, `job/${dannyJob.id}/${c}`);
  });

  test("the business's Issue an invoice, Owner's draw, Pay out profit and Sell a stake → Orgs → Money and Ownership; Payroll has no Hire", () => {
    expect(businessControls(pov, shop)).toEqual(["invoice", "draw", "distribute", "stake"]);
    // Hiring is People's Hire someone (orgs-edit.test).
    expect([...payroll].filter((p) => p.endsWith("/hire"))).toEqual([]);
    has(orgMoney, "business/shop/invoice");
    for (const c of ["draw", "distribute", "stake", "route"]) has(ownership, `business/shop/${c}`);
  });

  test("the business's invoices → Orgs → Money → In & out, with the reader's Void and Pay", () => {
    const [dale, mine] = invoices;
    if (!dale || !mine) throw new Error("no invoices");
    expect(invoiceControls(pov, shop, dale)).toEqual(["void"]);
    expect(invoiceControls(pov, shop, mine)).toEqual(["void", "pay"]);
    has(orgMoney, "business/shop/void/inv_dale");
    has(orgMoney, "business/shop/invoice/inv_mine");
    for (const c of invoiceControls(pov, shop, mine)) has(orgMoney, `business/shop/${c}/inv_mine`);
  });

  test("Investments section and pages → Assets → Investments; Properties → Assets → Property", () => {
    const pages = me("assets");
    for (const h of pov.investments?.holdings ?? []) for (const c of holdingControls(pov, h)) has(pages, `holding/${h.id}/${c}`);
    expect(holdingControls(pov, call)).toEqual(["buy", "sell", "exercise"]);
    has(pages, "investments/buy");
    for (const p of pov.properties) for (const c of propertyControls(pov, p)) has(pages, `property/${p.id}/${c}`);
    expect(pov.properties.flatMap((p) => propertyControls(pov, p))).toEqual(["let", "sell", "buy"]);
  });

  test("Credit → Credit", () => {
    const pages = me("credit");
    has(pages, "credit/apply/visa_gold");
  });

  test("the business's own pages: its accounts open as the reader's where they hold or run them, the rest as its own, read only", () => {
    // The shop's checking is the owner's to run (`managed`): it opens as theirs, with its controls.
    expect([...orgMoney]).toContain("pov:account/acct_shop");
    // Its trade is its own money's alone.
    expect([...orgMoney]).toContain("shop:flow/suppliers:shop");
    // Its own read-only pages offer nothing to do.
    expect([...orgMoney].filter((p) => p.startsWith("shop:") && p.split("/").length > 2)).toEqual([]);
  });

  test("a stake opens its organization's Ownership in Orgs; Money has no Businesses or Household page left", () => {
    const assets = reach(meMoney(pov, "assets"), pov, orgs);
    expect(assets.away).toContainEqual({ org: "shop", tab: "economy.ownership" });
    for (const head of ["businesses", "household", "jobs", "flows", "accounts", "investments", "properties"]) {
      const route = routeOf(sectionPage(head), pov.party, true);
      expect(draws(route, pov, orgs)).toBe(false);
    }
    expect(draws(routeOf({ type: "detail", path: ["business", "shop"] }, pov.party, true), pov, orgs)).toBe(false);
    const everywhere = new Set(moneySegments(pov, "player").flatMap((s) => [...me(s.id)]));
    expect([...everywhere].filter((p) => /^pov:(business|household)s?(\/[^/]+)?$/.test(p))).toEqual([]);
  });

  test("Taxes → Orgs → Taxes", () => {
    const taxes = decodeTaxes(shopPage.sections.taxes ?? null);
    if (!taxes) throw new Error("no taxes section");
    const rows = elements(OrgTaxes({ section: taxes, currency: USD })).filter((e) => e.type === ListRow);
    expect(rows.map((r) => [r.props.title, r.props.subtitle, r.props.value])).toEqual([
      ["You", "pays tax on its share", "100%"],
      ["Sales tax", "20 Nov 2026", "$12.00"],
    ]);
  });
});

describe("Port Alder", () => {
  test("In & out → Income → Mechanic at Alder Automotive opens the job and its payslip", () => {
    const own = povMoney(portAlder("pov"));
    const income = elements(meMoney(own, "in_out")(noop, noop)).filter((e) => e.type === ListRow && e.props.title === "Mechanic at Alder Automotive");
    expect(income).toHaveLength(1);
    const opened = pressed(meMoney(own, "in_out")).routes.find((r) => pageOf(r.kind, r.id)?.page.path.join("/") === "job/job_pov_mechanic");
    if (!opened) throw new Error("Income doesn't open the job");
    const page = sheetPage(opened, own, []);
    const sections = elements(page?.(noop, noop)).filter((e) => e.type === Section);
    expect(sections.map((s) => s.props.title)).toContain("Payslip");
  });

  test("a member of the Kowalczyks finds the household's row in In & out, with his share, and it opens the household in Orgs", () => {
    const w = portAlder("pov", (world) => {
      world.entities.pov?.relations.push({ type: "member_of", to: "household_kowalczyk" });
    });
    const own = povMoney(w);
    expect(own.household?.id).toBe("household_kowalczyk");
    expect(moneySegments(own, "player").map((s) => s.id)).toContain("in_out");
    const tree = meMoney(own, "in_out");
    const row = elements(tree(noop, noop)).find((e) => e.type === ListRow && e.props.title === "The Kowalczyks");
    expect(row?.props.subtitle).toBe("Your share of the shared costs");
    expect(pressed(tree).away).toContainEqual({ org: "household_kowalczyk" });
  });

  test("Jordan, joint owner of Alder Automotive, has Money, Ownership, Taxes and Payroll there, hires Jess from People and issues an invoice from Money, each played as a turn", async () => {
    const SHOP = "alder_automotive_co";
    const chat = await MoneyChat.start();
    // As GM → Orgs makes him one.
    accepted(await chat.edit([{ op: "set", entity: SHOP, field: "owners", value: [{ party: "marcus_delgado", role: "owner", share: 50 }, { party: "pov", role: "joint", share: 50 }] }]));
    const state = await chat.state();
    const pages = state.panels["orgs.org"];
    const page = isRecord(pages) ? (pages[SHOP] as unknown as OrgView | undefined) : undefined;
    if (!page) throw new Error("Jordan sees no page for the shop");
    expect(Object.keys(page.sections)).toEqual(expect.arrayContaining(["money", "ownership", "taxes", "payroll"]));
    const own = await chat.hub();
    const tabs = orgTabs(page, own);
    const payroll = reach(tabs.payroll(), own, [page]).pages;
    const money = fromSegments(tabs.money, decodeFinanceView(page.sections.money ?? null) ?? own, own, [page]);
    expect([...payroll].filter((p) => p.endsWith("/hire"))).toEqual([]);
    expect([...money]).toContain(`pov:business/${SHOP}/invoice`);
    // People's Hire someone is his, as an owner who runs it, and offers Jess.
    expect(peopleControls(page).hire).toBe(true);
    expect(newcomers(page, "hire").map((c) => c.id)).toContain("jess_kowalczyk");
    const hire = hireAction(page, { worker: "jess_kowalczyk", title: "Receptionist", position: "", basis: "hourly", rate: "17", hours: "20", every: "weekly" }, chat.currency);
    if (!hire) throw new Error("the hire form isn't complete");
    expect(await chat.play(hire)).toContain("done");
    expect(await chat.play(invoiceIssueAction(SHOP, { name: "Harbor Mutual" }, chat.cents("99"), "Claim", null))).toContain("done");
    const after = (await chat.hub()).businesses.find((b) => b.id === SHOP);
    expect(after?.employees.map((j) => j.workerId)).toContain("jess_kowalczyk");
    expect(after?.invoices.map((i) => i.customer)).toContain("Harbor Mutual");
  }, 60_000);
});
