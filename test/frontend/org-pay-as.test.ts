// Pay as… on an organization's Money tab (ORG-SPEC §3.6, §4.4, §11 Phase 2 Live 2), its trees
// walked without a DOM:
// - whom it shows to: only a reader holding money.spend for the organization whose palette's Pay
//   offers to pay as it, its limits those of the position or the delegation the power rests on;
// - its page: whom (the palette's Pay's people), how much, held in the limit's words over it, and Go
//   sending Pay with the organization as Paying as;
// - Live 2 on Port Alder: with Marcus's delegation to Jordan ($200 a payment, until Friday) recorded
//   by the GM, Orgs → Alder Automotive → Money → Pay as… pays Dale $150 from the shop, played as a
//   turn, and Accounts → Activity shows "Paid by Jordan Ellis for Alder Automotive"; $250 is refused
//   in the limit's words; past Friday, Pay as… and the Money tab are gone.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { calendarOf, clockAt, dateAt } from "../../src/engine/calendar";
import { Button, ListRow } from "../../src/frontend/components";
import { decodeFinanceView } from "../../src/packs/economy/ui/decode";
import { ActionPage, AmountField, SelectField } from "../../src/packs/economy/ui/forms";
import type { PlayerControls } from "../../src/packs/economy/ui/hub";
import { ALL_ACTIVITY } from "../../src/packs/economy/ui/layout";
import { TxnRow, TxnRows } from "../../src/packs/economy/ui/lines";
import type { HubNav } from "../../src/packs/economy/ui/nav";
import type { ActionBody } from "../../src/packs/economy/ui/requests";
import { OrgMoney, PayAsPage, payAsOf, type PayAs } from "../../src/packs/economy/ui/orgs";
import { STARTER_WORLDS } from "../../src/packs/index";
import { decodeOrgPage } from "../../src/packs/orgs/ui/decode";
import type { FinanceView, JournalLine } from "../../src/shared/finance";
import type { OrgView } from "../../src/shared/org-view";
import type { PaletteEntry, PaletteView, StateView } from "../../src/shared/state-view";
import { DEFAULT_CURRENCY } from "../../src/shared/world";
import { accepted, MoneyChat } from "../support/money-chat";
import type { Props } from "../support/tree";

const USD = DEFAULT_CURRENCY;
const SHOP = "alder_automotive_co";
const noop = (): void => undefined;
const nav: HubNav = { page: null, open: noop, back: noop, elsewhere: noop, frame: "play", backLabel: null };
const frame = { onSegment: noop, filter: ALL_ACTIVITY, onFilter: noop, now: null, panelId: "p" };

/** Every element a tree draws, its components drawn in turn (those with hooks left as they are). */
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

/** The props of the one element of `type` in a tree. */
function one(tree: unknown, type: unknown): Props {
  const found = elements(tree).filter((e) => e.type === type);
  if (found.length !== 1) throw new Error(`${found.length} of them`);
  return found[0]?.props ?? {};
}

/** The player's controls, recording what they send. */
function recording(palette: PaletteView | null, sent: ActionBody[]): PlayerControls {
  return { mode: "player", busy: false, currency: USD, palette, act: (body) => (sent.push(body), Promise.resolve(true)) };
}

const pay: PaletteEntry = {
  action: "pay",
  label: "Pay",
  group: "pay",
  options: [
    { label: "Dale Whitcomb", params: { to: "dale_whitcomb" }, person: true },
    { label: "Danny Okafor", params: { to: "danny_okafor" }, person: true },
  ],
  amount: { param: "amount", min: 0, max: null },
  acting: { param: "as", label: "Paying as", options: [{ id: SHOP, name: "Alder Automotive" }] },
};
const palette: PaletteView = { entries: [pay], timelapse: null };

function shopPage(over: Partial<OrgView["you"]> = {}, positions: OrgView["positions"] = []): OrgView {
  return {
    id: SHOP,
    name: "Alder Automotive",
    type: "company",
    kind: "Business",
    structure: "LLC",
    badge: "Company · LLC",
    level: 3,
    exists: true,
    ended: null,
    you: { belongs: true, title: "Mechanic", position: null, since: null, reportsTo: [], powers: [], delegations: [], through: [], ...over },
    runBy: [],
    people: [],
    hidden: { count: 0, ids: [] },
    positions,
    delegations: [],
    defaultPosition: null,
    dues: null,
    history: [],
    candidates: [],
    sections: {},
    above: [],
    below: [],
    belowHidden: 0,
    trust: null,
    nonprofit: false,
  };
}

const marcus = { id: "marcus_delgado", name: "Marcus Delgado" };
const delegated = shopPage({
  powers: [
    { power: "money.view", basis: "delegate", id: marcus.id, words: "see its money" },
    { power: "money.spend", basis: "delegate", id: marcus.id, words: "spend its money" },
  ],
  delegations: [{ who: { id: "pov", name: "Jordan Ellis" }, powers: ["money.spend"], limits: { payment: 20000 }, until: "Fri 9 Oct 2026", by: marcus }],
});

function payAsPage(payAs: PayAs, to: string, amount: string, sent: ActionBody[] = []) {
  return PayAsPage({ org: delegated, payAs, chatId: "c1", to, amount, onTo: noop, onAmount: noop, controls: recording(palette, sent), nav });
}

describe("whom Pay as… shows to", () => {
  test("a reader without money.spend there, or whose palette's Pay doesn't offer to pay as it, has none", () => {
    expect(payAsOf(shopPage({ powers: [{ power: "money.view", basis: "member", id: null, words: "see its money" }] }), palette)).toBeNull();
    expect(payAsOf(delegated, null)).toBeNull();
    expect(payAsOf(delegated, { entries: [{ ...pay, acting: undefined }], timelapse: null })).toBeNull();
    expect(payAsOf(delegated, { entries: [{ ...pay, acting: { param: "as", label: "Paying as", options: [{ id: "household_delgado", name: "The Delgados" }] } }], timelapse: null })).toBeNull();
  });

  test("by delegation, with its limits; by position, with the position's; as owner, with none", () => {
    expect(payAsOf(delegated, palette)).toEqual({ entry: pay, limits: { payment: 20000 } });
    const foreman: OrgView["positions"][number] = { id: "shop_foreman", title: "Shop foreman", powers: ["money.spend"], seats: 1, filled: 1, reportsTo: null, scope: "org", limits: { payment: 50000 }, successor: "next", successorId: null, joinsIn: false, implied: false, holders: ["pov"], hidden: 0 };
    expect(payAsOf(shopPage({ powers: [{ power: "money.spend", basis: "position", id: "shop_foreman", words: "spend its money" }] }, [foreman]), palette)?.limits).toEqual({ payment: 50000 });
    expect(payAsOf(shopPage({ powers: [{ power: "money.spend", basis: "owner", id: null, words: "spend its money" }] }), palette)?.limits).toBeNull();
  });

  test("the Money tab shows Pay as… above its segments only when it's offered, and it opens the page", () => {
    const money: FinanceView = { party: SHOP, name: "Alder Automotive", partyKind: "business", level: 3, detail: false, features: [], band: null, opened: true, cash: null, overview: null, accounts: [], cards: [], flows: [], jobs: [], businesses: [], investments: null, properties: [], credit: null, household: null, recent: [], notes: [], payPrefs: [], paysFor: [], ownKeys: [] };
    const buttons = (tree: unknown) => elements(tree).filter((e) => e.type === Button && e.props.children === "Pay as…");
    expect(buttons(OrgMoney({ ...frame, segment: "summary", view: money, reader: null, nav, currency: USD }))).toHaveLength(0);
    let opened = 0;
    const shown = buttons(OrgMoney({ ...frame, segment: "summary", view: money, reader: null, nav, currency: USD, onPayAs: () => opened++ }));
    expect(shown).toHaveLength(1);
    (shown[0]?.props.onClick as () => void)();
    expect(opened).toBe(1);
  });
});

describe("Pay as…'s page", () => {
  const payAs: PayAs = { entry: pay, limits: { payment: 20000 } };

  test("whom from the palette's Pay, how much, and what it's held for", () => {
    const select = one(payAsPage(payAs, "", ""), SelectField);
    expect([select.label, select.value, select.options]).toEqual(["Pay", "", [{ value: "dale_whitcomb", label: "Dale Whitcomb" }, { value: "danny_okafor", label: "Danny Okafor" }]]);
    expect(one(payAsPage(payAs, "", ""), AmountField).label).toBe("Amount");
    expect(one(payAsPage(payAs, "", "150"), ActionPage).problem).toBe("Pick whom to pay.");
    expect(one(payAsPage(payAs, "dale_whitcomb", ""), ActionPage).problem).toBe("Type the amount.");
    const page = one(payAsPage(payAs, "dale_whitcomb", "150"), ActionPage);
    expect([page.title, page.subtitle, page.go, page.problem]).toEqual(["Pay as Alder Automotive", "From its money, up to $200.00 a payment", "Pay $150.00 as Alder Automotive", null]);
  });

  test("over the limit, it asks for approval instead, in the limit's words", async () => {
    const over = one(payAsPage(payAs, "dale_whitcomb", "250"), ActionPage);
    expect([over.go, over.problem]).toEqual(["Ask for approval to pay $250.00", null]);
    expect(elements(payAsPage(payAs, "dale_whitcomb", "250")).some((e) => e.type === "span" && String(e.props.children).startsWith("Over your limit of $200.00 a payment for Alder Automotive: it goes to whoever holds the power above you"))).toBe(true);
    const sent: ActionBody[] = [];
    expect(await (one(payAsPage(payAs, "dale_whitcomb", "250", sent), ActionPage).submit as () => Promise<boolean>)()).toBe(true);
    expect(sent).toEqual([{ action: "pay", params: { to: "dale_whitcomb", amount: 25000, as: SHOP, ask: true } }]);
    expect(one(payAsPage({ entry: pay, limits: null }, "dale_whitcomb", "250"), ActionPage).go).toBe("Pay $250.00 as Alder Automotive");
  });

  test("Go sends Pay with the organization as Paying as", async () => {
    const sent: ActionBody[] = [];
    expect(await (one(payAsPage(payAs, "dale_whitcomb", "150", sent), ActionPage).submit as () => Promise<boolean>)()).toBe(true);
    expect(sent).toEqual([{ action: "pay", params: { to: "dale_whitcomb", amount: 15000, as: SHOP } }]);
  });
});

/** Alder Automotive's page as Jordan's Orgs reads it. */
function pageOf(state: StateView): OrgView | null {
  return decodeOrgPage(state.panels["orgs.org"], SHOP);
}

describe("Live 2: Jordan, by Marcus's delegation, pays a supplier from Orgs → Alder Automotive → Money → Pay as…", () => {
  test("$150 to Dale plays from the shop's money, and Activity names Jordan; $250 is refused in the limit's words; past Friday it's gone", async () => {
    const chat = await MoneyChat.start();
    const world = STARTER_WORLDS.modern_slice_of_life?.("pa", "Port Alder");
    if (!world) throw new Error("no Port Alder starter");
    const cal = calendarOf(world);
    const now = (await chat.state()).hud?.clock.minutes;
    if (now === undefined) throw new Error("no clock");
    const today = dateAt(cal, now);
    const friday = today.dayIndex + ((5 - today.weekday + 7) % 7);
    // The GM records Marcus's delegation: money.spend for the shop, up to $200 a payment, until the end of Friday.
    accepted(await chat.edit([{ op: "link", rel: "acts_for", from: "pov", to: SHOP, fields: { powers: ["money.spend"], payment: 20000, by: "marcus_delgado" }, until: clockAt(cal, friday + 1, 0) - 1 }]));
    const state = await chat.state();
    const page = pageOf(state);
    if (!page) throw new Error("Jordan sees no page for the shop");
    // The Money tab, shown through the delegation, with Pay as… on it.
    const money = decodeFinanceView(page.sections.money ?? null);
    if (!money) throw new Error("no Money tab through the delegation");
    const payAs = payAsOf(page, state.palette);
    if (!payAs) throw new Error("no Pay as… for Jordan");
    expect(payAs.limits).toEqual({ payment: 20000 });
    expect(elements(OrgMoney({ ...frame, segment: "summary", view: money, reader: null, nav, currency: chat.currency, onPayAs: noop })).some((e) => e.type === Button && e.props.children === "Pay as…")).toBe(true);
    const sent: ActionBody[] = [];
    const draw = (to: string, amount: string) => one(PayAsPage({ org: page, payAs, chatId: chat.chatId, to, amount, onTo: noop, onAmount: noop, controls: recording(state.palette, sent), nav }), ActionPage);
    // $250 is over the limit: the page asks for approval in its words, and Pay without asking is refused in them.
    expect(draw("dale_whitcomb", "250").go).toBe("Ask for approval to pay $250.00");
    expect(await chat.play({ action: "pay", params: { to: "dale_whitcomb", amount: chat.cents("250"), as: SHOP } })).toContain("Over your limit of $200.00 a payment for Alder Automotive");
    // $150 to Dale, the marina's owner, who sells parts.
    const go = draw("dale_whitcomb", "150");
    expect(go.problem).toBeNull();
    expect(await (go.submit as () => Promise<boolean>)()).toBe(true);
    const body = sent[0];
    if (!body) throw new Error("Pay as… sent nothing");
    expect(body).toEqual({ action: "pay", params: { to: "dale_whitcomb", amount: 15000, as: SHOP } });
    await chat.play(body);
    const after = pageOf(await chat.state());
    const paid = decodeFinanceView(after?.sections.money ?? null);
    if (!paid) throw new Error("no Money tab after paying");
    expect(paid.recent.find((t) => t.cents === -15000)?.by).toBe("Paid by Jordan Ellis for Alder Automotive");
    // Accounts → Activity lists it, its row saying so.
    const activity = elements(OrgMoney({ ...frame, segment: "accounts", view: paid, reader: null, nav, currency: chat.currency })).find((e) => e.type === TxnRows);
    const line = (activity?.props.lines as JournalLine[] | undefined)?.find((t) => t.cents === -15000);
    if (!line) throw new Error("Activity doesn't list the payment");
    expect(one(TxnRow({ line, currency: chat.currency, account: activity?.props.account === true }), ListRow).subtitle).toContain("Paid by Jordan Ellis for Alder Automotive");
    // Past Friday, the delegation has ended: no Pay as…, and no Money tab.
    await chat.timelapse(clockAt(cal, friday + 1, 9 * 60) - now);
    const later = await chat.state();
    const gone = pageOf(later);
    expect(gone?.sections.money).toBeUndefined();
    expect(gone ? payAsOf(gone, later.palette) : null).toBeNull();
  }, 120_000);
});
