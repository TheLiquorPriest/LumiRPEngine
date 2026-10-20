// The money hub's pages (overview, section rows, detail pages, action pages): a page survives the
// trip through a Play sheet's id, an account's page is an `account` sheet, Now's glance picks its
// rows by the clock and never by words, a line opens the flow or account it names, and an amount
// the engine can't know ahead reads in words, never as $0.00.

import { describe, expect, test } from "bun:test";
import type { AccountView, FinanceView, FlowView, UpcomingLine } from "../../src/shared/finance";
import { isRecord } from "../../src/shared/json";
import { DEFAULT_CURRENCY } from "../../src/shared/world";
import { lineTarget, upcomingValue } from "../../src/packs/economy/ui/hub";
import { GLANCE_AHEAD_MINUTES, glanceLines, possessive } from "../../src/packs/economy/ui/layout";
import { actionPage, detailPage, sectionPage } from "../../src/packs/economy/ui/nav";
import { pageOf, routeOf } from "../../src/packs/economy/ui/routes";

function view(over: Partial<FinanceView> = {}): FinanceView {
  return { party: "pov", name: "You", partyKind: "person", level: 3, detail: false, features: ["flows"], band: null, opened: true, cash: { cents: 4600 }, overview: { netWorth: 1, assets: 1, liabilities: 0, breakdown: [], cashFlow: null, upcoming: [], alerts: [] }, accounts: [], cards: [], flows: [], jobs: [], businesses: [], investments: null, properties: [], credit: null, household: null, recent: [], notes: [], payPrefs: [], ...over };
}

function account(id: string, name: string): AccountView {
  return { id, name, class: "checking", classLabel: "Checking", product: { id: "checking", label: "Checking" }, institution: null, status: "open", cents: 0, available: null, owners: [], role: "owner", manages: true, limit: null, aprPct: null, apyPct: null, terms: [], autopay: null, due: null, statements: [], cards: [], pending: [], holds: [], transactions: [], securedBy: null, loan: null };
}

function flow(id: string, label: string): FlowView {
  return { id, label, kind: "bill", from: "Checking", to: "Landlord", amount: "$1.00", cents: 100, schedule: "monthly", next: null, shortfall: "skip", status: "active", category: null, link: null, editable: true, source: "entity", payer: null, done: 0, missed: 0, deferred: 0, spec: { id, label, kind: "bill", from: "chk", to: "landlord", amount: { fixed: 100 }, schedule: { every: "month" }, shortfall: "skip", status: "active", source: "entity" } };
}

const checking = account("chk", "Checking");
const rent = flow("flow_rent", "Rent");

describe("a page as a Play sheet", () => {
  test("every page comes back from its sheet's id whole, ids with colons and slashes included", () => {
    for (const page of [sectionPage("accounts"), detailPage("flow", "invoice:inv1"), actionPage("account", "chk", "pay"), actionPage("business", "shop/1", "pay", "inv:2/a"), actionPage("flows", "new")]) {
      const route = routeOf(page);
      expect(route.kind).toBe("money");
      expect(pageOf(route.kind, route.id)).toEqual(page);
    }
  });

  test("an account's page is the account sheet for that account; its actions stay money sheets", () => {
    expect(routeOf(detailPage("account", "chk"))).toEqual({ kind: "account", id: "chk" });
    expect(pageOf("account", "chk")).toEqual(detailPage("account", "chk"));
    expect(routeOf(actionPage("account", "chk", "pay")).kind).toBe("money");
  });

  test("an id that names no page is none", () => {
    expect(pageOf("account", "")).toBeNull();
    expect(pageOf("money", "accounts")).toBeNull();
    expect(pageOf("money", "detail:")).toBeNull();
    expect(pageOf("money", "sideways:accounts")).toBeNull();
    expect(pageOf("money", "detail:flow/%E0%A4%A")).toBeNull();
    expect(pageOf("person", "section:accounts")).toBeNull();
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
    expect(possessive("Silas", false)).toBe("Silas's");
    expect(possessive("The Kowalczyks", true)).toBe("The Kowalczyks'");
    expect(possessive("Unit 2B", true)).toBe("Unit 2B's");
  });
});
