// Money's pages (segments, detail pages, action pages): a page survives the trip through a Play
// sheet's id with whose money it is, the POV's account page is an `account` sheet, Now's glance
// picks its rows by the clock and never by words, a line opens the flow or account it names, and
// an amount the engine can't know ahead reads in words, never as $0.00.

import { describe, expect, test } from "bun:test";
import type { AccountView, FinanceView, FlowView, IndexView, InterestView, PerformanceView, UpcomingLine } from "../../src/shared/finance";
import { isRecord } from "../../src/shared/json";
import { DEFAULT_CURRENCY } from "../../src/shared/world";
import { ListRow } from "../../src/frontend/components";
import { InterestSection } from "../../src/packs/economy/ui/accounts";
import { MarketSection, PerformanceSection, Sparkline } from "../../src/packs/economy/ui/assets";
import { lineTarget, upcomingValue } from "../../src/packs/economy/ui/hub";
import { GLANCE_AHEAD_MINUTES, glanceLines, possessive } from "../../src/packs/economy/ui/layout";
import { actionPage, detailPage, Note, sectionPage } from "../../src/packs/economy/ui/nav";
import { pageOf, routeOf } from "../../src/packs/economy/ui/routes";

function view(over: Partial<FinanceView> = {}): FinanceView {
  return { party: "pov", name: "You", partyKind: "person", level: 3, detail: false, features: ["flows"], band: null, opened: true, cash: { cents: 4600 }, overview: { netWorth: 1, assets: 1, liabilities: 0, breakdown: [], cashFlow: null, upcoming: [], alerts: [] }, accounts: [], cards: [], flows: [], jobs: [], businesses: [], investments: null, properties: [], credit: null, household: null, recent: [], notes: [], payPrefs: [], paysFor: [], ownKeys: ["pov", "you"], ...over };
}

function account(id: string, name: string): AccountView {
  return { id, name, class: "checking", classLabel: "Checking", product: { id: "checking", label: "Checking" }, institution: null, status: "open", cents: 0, available: null, owners: [], role: "owner", manages: true, spends: true, autopayFrom: [], fallbacks: [], limit: null, interest: null, terms: [], autopay: null, due: null, statements: [], cards: [], pending: [], holds: [], transactions: [], securedBy: null, loan: null };
}

function flow(id: string, label: string): FlowView {
  return { id, label, kind: "bill", from: "Checking", to: "Landlord", amount: "$1.00", cents: 100, schedule: "monthly", next: null, shortfall: "skip", status: "active", category: null, link: null, editable: true, source: "entity", payer: null, payee: null, direction: "out", whose: null, done: 0, missed: 0, deferred: 0, spec: { id, label, kind: "bill", from: "chk", to: "landlord", amount: { fixed: 100 }, schedule: { every: "month" }, shortfall: "skip", status: "active", source: "entity" } };
}

const checking = account("chk", "Checking");
const rent = flow("flow_rent", "Rent");

describe("a page as a Play sheet", () => {
  test("every page comes back from its sheet's id whole with whose money it is, ids with colons, slashes and bars included", () => {
    for (const party of ["pov", "alder_automotive_co", "a|b:c/d#e"]) {
      for (const page of [sectionPage("alerts"), sectionPage("credit", "report"), detailPage("flow", "invoice:inv1"), actionPage("account", "chk", "pay"), actionPage("business", "shop/1", "pay", "inv:2/a"), actionPage("flows", "new")]) {
        const route = routeOf(page, party, party === "pov");
        expect(route.kind).toBe("money");
        expect(pageOf(route.kind, route.id)).toEqual({ party, page });
      }
    }
  });

  test("the POV's account page is the account sheet for that account; its actions, and an organization's account page, are money sheets", () => {
    expect(routeOf(detailPage("account", "chk"), "pov", true)).toEqual({ kind: "account", id: "chk" });
    expect(pageOf("account", "chk")).toEqual({ party: null, page: detailPage("account", "chk") });
    expect(routeOf(actionPage("account", "chk", "pay"), "pov", true).kind).toBe("money");
    const theirs = routeOf(detailPage("account", "acct_shop"), "alder_automotive_co", false);
    expect(theirs).toEqual({ kind: "money", id: "alder_automotive_co|detail:account/acct_shop" });
    expect(pageOf(theirs.kind, theirs.id)).toEqual({ party: "alder_automotive_co", page: detailPage("account", "acct_shop") });
  });

  test("an id that names no page, or no one's money, is none", () => {
    expect(pageOf("account", "")).toBeNull();
    expect(pageOf("money", "accounts")).toBeNull();
    expect(pageOf("money", "detail:account/chk")).toBeNull();
    expect(pageOf("money", "|detail:account/chk")).toBeNull();
    expect(pageOf("money", "pov|detail:")).toBeNull();
    expect(pageOf("money", "pov|sideways:accounts")).toBeNull();
    expect(pageOf("money", "pov|detail:flow/%E0%A4%A")).toBeNull();
    expect(pageOf("money", "%E0%A4%A|detail:flow/f1")).toBeNull();
    expect(pageOf("person", "pov|section:alerts")).toBeNull();
  });
});

describe("Now's money glance", () => {
  const soon = (clock: number, at: string): UpcomingLine => ({ at, clock, label: at, cents: -100, flow: null, account: null });

  test("problems come first, then warnings, then what's due within three days by the clock; notes don't show", () => {
    const now = 1000;
    const v = view({
      overview: {
        netWorth: 1,
        assets: 1,
        liabilities: 0,
        breakdown: [],
        cashFlow: null,
        alerts: [
          { tone: "warn", text: "Visa is frozen." },
          { tone: "info", text: "Payday was Friday." },
          { tone: "neg", text: "Checking is overdrawn." },
        ],
        // The words say "Tomorrow" and "Today"; only the clock counts.
        upcoming: [soon(now + 60, "Tomorrow"), soon(now + GLANCE_AHEAD_MINUTES, "Fri 09:00"), soon(now + GLANCE_AHEAD_MINUTES + 1, "Today")],
      },
    });
    expect(glanceLines(v, now).map((l) => (l.kind === "alert" ? l.alert.text : l.line.at))).toEqual(["Checking is overdrawn.", "Visa is frozen.", "Tomorrow", "Fri 09:00"]);
  });

  test("without a clock only the alerts show, and nothing shows without an overview", () => {
    const v = view({ overview: { netWorth: 1, assets: 1, liabilities: 0, breakdown: [], cashFlow: null, alerts: [{ tone: "warn", text: "Rent was missed." }], upcoming: [soon(1, "Soon")] } });
    expect(glanceLines(v, null).map((l) => l.kind)).toEqual(["alert"]);
    expect(glanceLines(view({ overview: null }), 0)).toEqual([]);
  });
});

describe("what a money line opens", () => {
  test("its flow's page when the view holds the flow, a property's costs and a household's included; else its account's; else nothing", () => {
    const v = view({ accounts: [checking], flows: [rent] });
    expect(lineTarget(v, "flow_rent", "chk")?.page).toEqual(detailPage("flow", "flow_rent"));
    expect(lineTarget(v, "autopay:visa", "chk")?.page).toEqual(detailPage("account", "chk"));
    expect(lineTarget(v, null, "gone")).toBeNull();
    const tax = flow("flow_tax", "Property tax");
    const owned = view({ properties: [{ id: "house", name: "House", place: null, owners: [], share: 100, value: 1, equity: 1, mortgage: null, leases: [], costs: [tax], route: null }] });
    expect(lineTarget(owned, "flow_tax", null)?.name).toBe("Property tax");
  });
});

describe("what a money line shows", () => {
  const due = (flowId: string | null, cents: number): UpcomingLine => ({ at: "Fri 09:00", clock: 1, label: "Due", cents, flow: flowId, account: null });

  test("a 0 is the flow's own figure, muted, where the money stays the party's, and its words where it can't be known ahead", () => {
    const saving = { ...flow("flow_save", "Savings"), amount: "$50.00", cents: 5000 };
    const payroll = { ...flow("job:pay", "Payday"), amount: "worked out each time", cents: null };
    const v = view({ flows: [rent, saving, payroll] });
    expect(upcomingValue(v, due("flow_save", 0), DEFAULT_CURRENCY)).toEqual({ value: "$50.00", tone: "muted" });
    const words = upcomingValue(v, due("job:pay", 0), DEFAULT_CURRENCY);
    expect(words.tone).toBeUndefined();
    expect(isRecord(words.value) && isRecord(words.value.props) ? words.value.props.children : null).toBe("worked out each time");
    // Anything else is the signed figure, a 0 that names no flow the view holds included.
    expect(upcomingValue(v, due("flow_rent", -99500), DEFAULT_CURRENCY)).toEqual({ value: "-$995.00", tone: "neg" });
    expect(upcomingValue(v, due("flow_rent", 6124), DEFAULT_CURRENCY)).toEqual({ value: "+$61.24", tone: "pos" });
    expect(upcomingValue(v, due(null, 0), DEFAULT_CURRENCY)).toEqual({ value: "$0.00", tone: "pos" });
  });

  test("an owner's name: a household's is its family's, a plural", () => {
    expect(possessive("Marcus Delgado", false)).toBe("Marcus Delgado's");
    expect(possessive("Marcus", false)).toBe("Marcus's");
    expect(possessive("The Kowalczyks", true)).toBe("The Kowalczyks'");
    expect(possessive("Unit 2B", true)).toBe("Unit 2B's");
  });
});

describe("an account's interest", () => {
  /** The rows a component draws, read off its tree (no DOM needed): title, subtitle and value. */
  const rows = (node: unknown): unknown[][] => (Array.isArray(node) ? node.flatMap(rows) : !isRecord(node) || !isRecord(node.props) ? [] : node.type === ListRow ? [[node.props.title, node.props.subtitle, node.props.value]] : rows(node.props.children));

  test("what it earns at what rate and how, this year's, the last and about what the next comes to", () => {
    const earns: InterestView = { way: "earns", ratePct: 0.4, basis: "On the balance, paid on the 1st of each month", thisYear: 434, last: { cents: 217, at: "Tue 1 Dec" }, next: { cents: 218, at: "Fri 1 Jan" } };
    expect(rows(InterestSection({ interest: earns, currency: DEFAULT_CURRENCY }))).toEqual([
      ["Earns", "On the balance, paid on the 1st of each month", "0.4% APY"],
      ["Earned this year", undefined, "$4.34"],
      ["Last paid", "Tue 1 Dec", "$2.17"],
      ["Next paid", "Fri 1 Jan, if nothing changes before then", "about $2.18"],
    ]);
  });

  test("a card in grace says its next charge is nothing as things stand, and one never charged has no last", () => {
    const charges: InterestView = { way: "charges", ratePct: 22, basis: "On what's left of the balance owed", thisYear: 0, last: null, next: { cents: 0, at: "Thu 3 Dec" } };
    expect(rows(InterestSection({ interest: charges, currency: DEFAULT_CURRENCY }))).toEqual([
      ["Charges", "On what's left of the balance owed", "22% APR"],
      ["Charged this year", undefined, "$0.00"],
      ["Next charged", "Thu 3 Dec: nothing, as things stand", "about $0.00"],
    ]);
  });
});

describe("how prices have done", () => {
  /** What a component draws, its parts expanded (none of them keeps state): each row's title, subtitle, value and tone, each line's points and each note's words. */
  const drawn = (node: unknown): unknown[] => {
    if (Array.isArray(node)) return node.flatMap(drawn);
    if (!isRecord(node) || !isRecord(node.props)) return [];
    if (node.type === ListRow) return [[node.props.title, node.props.subtitle, node.props.value, node.props.valueTone]];
    if (node.type === Note) return [node.props.children];
    if (node.type === Sparkline) return [{ line: Array.isArray(node.props.values) ? node.props.values.length : 0 }];
    return typeof node.type === "function" ? drawn(node.type(node.props)) : drawn(node.props.children);
  };
  const months = ["2007-10", "2007-11", "2007-12", "2008-01", "2008-02", "2008-03", "2008-04", "2008-05", "2008-06", "2008-07", "2008-08", "2008-09", "2008-10"];

  test("the market: its last thirteen month-ends and today as a line, its month, year and twelve months, and that it moves as the market did", () => {
    const index: IndexView = { history: true, from: "2003-05", to: "2026-10", source: "Thrift Savings Plan, C Fund", points: [...months.map((at, i) => ({ at, level: 17.4 - i * 0.5 })), { at: "2008-11-14", level: 10.15 }], month: -8.703, year: -38.68, twelve: -36.07 };
    expect(drawn(MarketSection({ index }))).toEqual([
      { line: 14 },
      ["This month", undefined, "-8.7%", "neg"],
      ["This year", undefined, "-38.7%", "neg"],
      ["12 months", "to the end of 2008-10", "-36.1%", "neg"],
      "It moves as the stock market did: Thrift Savings Plan, C Fund, month-end closes 2003-05 to 2026-10.",
    ]);
  });

  test("outside the history's months the market says it walks", () => {
    const index: IndexView = { history: false, from: "2003-05", to: "2026-10", source: "Thrift Savings Plan, C Fund", points: [{ at: "2026-10", level: 122.38 }, { at: "2026-11-04", level: 123.01 }], month: 0.514, year: 0.04, twelve: 0 };
    expect(drawn(MarketSection({ index }))).toEqual([
      { line: 2 },
      ["This month", undefined, "+0.5%", "pos"],
      ["This year", undefined, "0.0%", undefined],
      ["12 months", "to the end of 2026-10", "0.0%", undefined],
      "Outside 2003-05 to 2026-10 the market walks at random, with the swings it had then (Thrift Savings Plan, C Fund).",
    ]);
  });

  test("a holding shows only the changes whose starting close was kept, and before its first month-end says when it will", () => {
    const young: PerformanceView = { points: [{ at: "2008-09", price: 9944.6515 }, { at: "2008-10", price: 8321.4786 }, { at: "2008-11-14", price: 7599.5593 }], month: -8.674, year: null, twelve: null };
    expect(drawn(PerformanceSection({ performance: young }))).toEqual([{ line: 3 }, ["This month", undefined, "-8.7%", "neg"]]);
    const fresh: PerformanceView = { points: [{ at: "2026-09-23", price: 10012 }], month: null, year: null, twelve: null };
    expect(drawn(PerformanceSection({ performance: fresh }))).toEqual(["How it has done shows once the market has closed a month with it."]);
  });

  test("a line runs across its box from the oldest value, scaled to its own range, in the colour of how it ended", () => {
    const up = Sparkline({ values: [10, 20, 15], label: "Its price" });
    expect(up?.props["data-tone"]).toBe("pos");
    expect(up?.props.children.props.points).toBe("0.00,30.00 50.00,2.00 100.00,16.00");
    expect(Sparkline({ values: [20, 10], label: "Its price" })?.props["data-tone"]).toBe("neg");
    expect(Sparkline({ values: [10], label: "Its price" })).toBeNull();
  });
});
