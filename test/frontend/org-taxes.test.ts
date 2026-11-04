// An organization's Taxes and Payroll in Orgs for Phase 5 (ORG-SPEC §3.11; DESIGN §26.3), drawn from
// the views the engine builds on Port Alder at Money 4 and read back as they arrive: after a payday,
// Alder Automotive's Taxes shows FUTA and SUTA (each rate on its wage base, this year's accrued, the
// deposits Due next) and its Payroll two rows; GM → Orgs gives St Brendan's Church an exempt status
// with one org op, and its Taxes then says so; Jordan's Taxes of the church has Donate, played as the
// `donate` action and counted as received; Harbor Holdings' Taxes lists the corporation its
// consolidated return would include, File one plays `tax_consolidate`, once elected the group's
// figures show with Stop, Harbor Towing's Taxes reads filed by its parent, and the GM's Stop is one
// org op.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import type { TaxesView } from "../../src/shared/finance";
import type { TaxesExtra } from "../../src/shared/tax-year";
import type { EntityId } from "../../src/shared/ids";
import type { JsonValue } from "../../src/shared/json";
import { ORG_POWERS } from "../../src/shared/org";
import type { OrgView } from "../../src/shared/org-view";
import type { EditOp } from "../../src/shared/protocol";
import type { StateView } from "../../src/shared/state-view";
import { DEFAULT_CURRENCY, formatMoney } from "../../src/shared/world";
import { Button, ListRow, Row, Section } from "../../src/frontend/components";
import { calendarOf, clockOfLocal } from "../../src/engine/calendar";
import { resolveEdit } from "../../src/engine/edits";
import { applyEffects } from "../../src/engine/effects";
import { materializeAll } from "../../src/engine/materialize";
import { readPass } from "../../src/engine/read-pass";
import { createRegistry } from "../../src/engine/registry-impl";
import { resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { runTimelapse } from "../../src/engine/time";
import { Working } from "../../src/engine/working";
import { unemploymentTotals } from "../../src/packs/economy/core/unemployment";
import { decodePayroll, decodeTaxes } from "../../src/packs/economy/ui/decode";
import { OrgPayroll } from "../../src/packs/economy/ui/orgs";
import type { ActionBody } from "../../src/packs/economy/ui/requests";
import { DonateForm, GmOrgTaxesTab, GmStatus, OrgTaxes, taxesActs, taxesGm, type TaxesActs, type TaxesGm } from "../../src/packs/economy/ui/taxes";
import { orgHistory } from "../../src/packs/orgs/core/log";
import { buildOrgView } from "../../src/packs/orgs/core/view";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { startState } from "../packs/support";
import type { Props } from "../support/tree";

const reg = createRegistry(ALL_PACKS);
const USD = DEFAULT_CURRENCY;
const JORDAN = "pov";
const SAVINGS = "acct_pov_savings";
const SHOP = "alder_automotive_co";
const CHURCH = "st_brendans_church";

const money = (cents: number): string => formatMoney(cents, USD);

/** Port Alder at Money 4, with St Brendan's Church: a group with an account of its own, not exempt yet, Jordan its warden (every power). */
function portAlder(): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  world.realism.levels.money = 4;
  world.entities[CHURCH] = { id: CHURCH, kind: "group", name: "St Brendan's Church", tier: "background", fields: { positions: [{ id: "warden", title: "Warden", powers: [...ORG_POWERS], seats: 1, scope: "org", successor: "vacant" }] }, relations: [] };
  world.entities.acct_church = { id: "acct_church", kind: "account", name: "Checking", tier: "background", fields: { product: "checking", owners: [{ party: CHURCH, role: "owner", share: 100 }], opening: 0 }, relations: [] };
  const pov = world.entities[JORDAN];
  if (!pov) throw new Error("no Jordan");
  world.entities[JORDAN] = { ...pov, relations: [...pov.relations, { type: "member_of", to: CHURCH, fields: { position: "warden" } }] };
  const w = new Working(reg, world, startState(world, reg));
  materializeAll(reg, w, JORDAN, "org-taxes");
  return w;
}

function lapseTo(w: Working, local: string): void {
  const to = clockOfLocal(calendarOf(w.world), local);
  for (let guard = 0; w.state.clock < to && guard < 64; guard++) {
    const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: "org-taxes", overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } });
    if ("code" in out) throw new Error(out.reason);
  }
}

/** An organization's page as the GM sees it, read back as it arrives. */
function gmPage(w: Working, id: EntityId): OrgView {
  const page = readPass(() => buildOrgView(w.ctx, id, null));
  if (!page) throw new Error(`no organization ${id}`);
  return JSON.parse(JSON.stringify(page)) as OrgView;
}

/** A Taxes section as it arrives, decoded; it must read back whole, the year close's parts with it. */
function decoded(section: JsonValue | undefined): TaxesView & TaxesExtra {
  const raw = JSON.parse(JSON.stringify(section ?? null)) as unknown;
  const view = decodeTaxes(raw);
  if (!view) throw new Error("no taxes section");
  expect(view).toEqual(raw as TaxesView & TaxesExtra);
  return view;
}

/** Jordan's own Taxes of an organization, through the Orgs panel. */
function jordanTaxes(w: Working, id: EntityId): TaxesView {
  const view = reg.views.find((v) => v.panel === "orgs.org");
  if (!view) throw new Error("no orgs.org panel");
  const pages = readPass(() => view.build(w.ctx, { mapDisplay: null })) as unknown as Record<string, OrgView>;
  return decoded(pages[id]?.sections.taxes);
}

/** Jordan's Taxes controls on an organization, each request played as his turn; `played` keeps them. */
function jordanActs(w: Working, org: EntityId): { acts: TaxesActs; played: ActionBody[] } {
  const played: ActionBody[] = [];
  const acts = taxesActs(org, {
    busy: false,
    act: (body) => {
      played.push(body);
      const r = resolveAction(reg, w, { action: body.action, actor: JORDAN, params: body.params }, createRng(`${body.action}:${w.events.length}`), { runSeed: "org-taxes" });
      return Promise.resolve(!r.failed && r.rejected.length === 0);
    },
  });
  return { acts, played };
}

/** The GM's Taxes controls, keeping each edit they send. */
function gmControls(): { gm: { busy: boolean; edit(ops: EditOp[]): Promise<boolean> }; sent: EditOp[][] } {
  const sent: EditOp[][] = [];
  return {
    gm: {
      busy: false,
      edit: (ops) => {
        sent.push(ops);
        return Promise.resolve(true);
      },
    },
    sent,
  };
}

/** Applies a GM edit as the host does. */
function edit(w: Working, ops: readonly EditOp[]): void {
  const out = resolveEdit(reg, w.world, w.state, ops, { gm: true, runSeed: "org-taxes" });
  if ("rejection" in out && out.rejection) throw new Error(`refused: ${out.rejection.reason}`);
  for (const e of "events" in out ? out.events : []) {
    const refused = w.apply(e);
    if (refused) throw new Error(`dropped: ${refused.reason}`);
  }
}

// ---------------------------------------------------------------- walking the trees

/** Every element of a tree, each component drawn where it draws without hooks; one with hooks (a form) stays an element whose props are read. */
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

function find(node: unknown, type: unknown): Props[] {
  return elements(node)
    .filter((v) => v.type === type)
    .map((v) => v.props);
}

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

const rows = (tree: unknown): unknown[][] => find(tree, Row).map((p) => [p.k, p.v, p.sub]);
const listRows = (tree: unknown): unknown[][] => find(tree, ListRow).map((p) => [p.title, p.subtitle, p.value]);

function click(tree: unknown, text: string): void {
  const found = find(tree, Button).filter((p) => textOf(p.children) === text);
  if (found.length !== 1) throw new Error(`${found.length} buttons say ${text}`);
  (found[0]?.onClick as () => void)();
}

// ---------------------------------------------------------------- the tests

describe("FUTA and SUTA", () => {
  test("after a Money 4 payday Alder Automotive's Taxes shows each rate on its base, this year's figures and the deposits due; its Payroll two rows", () => {
    const w = portAlder();
    lapseTo(w, "2026-09-19T08:00");
    const year = unemploymentTotals(w.state, SHOP, 2026);
    expect(year.futa).toBeGreaterThan(0);
    expect(year.suta).toBeGreaterThan(0);
    const page = gmPage(w, SHOP);
    const tree = OrgTaxes({ section: decoded(page.sections.taxes), currency: USD });
    expect(find(tree, Section).map((p) => p.title)).toContain("Unemployment taxes");
    // Michigan: FUTA 6% less the 5.4% credit on the first $7,000, SUTA 2.7% on the first $9,500.
    expect(rows(tree)).toEqual(
      expect.arrayContaining([
        ["Federal unemployment tax (FUTA)", "0.6%", "6% less a 5.4% credit for its state tax; on the first $7,000.00 of each worker's pay a year"],
        ["State unemployment tax (SUTA)", "2.7%", "on the first $9,500.00 of each worker's pay a year"],
        ["Federal unemployment tax (FUTA)", money(year.futa), undefined],
        ["State unemployment tax (SUTA)", money(year.suta), undefined],
      ]),
    );
    // Due next: FUTA's deposit (under $500 it carries) and SUTA's quarter, on the last day of October, a Saturday, rolled to the Monday.
    expect(listRows(tree)).toEqual(expect.arrayContaining([["Federal unemployment tax (FUTA)", "2 Nov 2026", money(0)], ["State unemployment tax (SUTA)", "2 Nov 2026", money(year.suta)]]));

    const payroll = decodePayroll(JSON.parse(JSON.stringify(page.sections.payroll ?? null)));
    if (!payroll) throw new Error("no payroll section");
    expect(listRows(OrgPayroll({ org: page, section: payroll, reader: null, nav: null, currency: USD }))).toEqual(
      expect.arrayContaining([
        ["FUTA this year", "Federal unemployment tax: 0.6% on the first $7,000.00 of each worker's pay", money(year.futa)],
        ["SUTA this year", "State unemployment tax: 2.7% on the first $9,500.00 of each worker's pay", money(year.suta)],
      ]),
    );
  });
});

describe("an exempt organization", () => {
  test("GM → Orgs: the status picker offers the table's statuses; Set the status is one org op, and its Taxes then says so", () => {
    const w = portAlder();
    const { gm, sent } = gmControls();
    const props = { chatId: "c", state: {} as StateView, send: () => Promise.reject(new Error("no backend")), open: () => undefined, gm: { chatId: "c", gm: {} as never, currency: USD, reloadKey: "", reload: () => Promise.resolve(), changed: () => Promise.resolve(), send: () => Promise.reject(new Error("no backend")), ...gm } };
    // A group at Money 3 and up: the GM sees its Taxes to give it a status.
    const page = gmPage(w, CHURCH);
    const before = GmOrgTaxesTab({ ...props, org: page, section: page.sections.taxes ?? null });
    expect(textOf(find(before, Section).find((s) => s.title === "Tax-exempt")?.children)).toContain("Not exempt: it pays its taxes as any organization does.");
    const [picker] = find(before, GmStatus);
    expect(picker?.statuses).toEqual([
      { id: "charity", name: "Charity or nonprofit", code: "501(c)(3)" },
      { id: "church", name: "Church or religious organization", code: "501(c)(3)" },
      { id: "club", name: "Social club", code: "501(c)(7)" },
      { id: "private_foundation", name: "Private foundation", code: "501(c)(3)" },
    ]);
    expect(picker?.current).toBe("");
    (picker?.gm as TaxesGm).status("church");
    expect(sent).toEqual([[{ op: "org", change: { do: "tax_status", org: CHURCH, status: "church" } }]]);
    edit(w, sent[0] ?? []);
    expect(orgHistory(w.state, CHURCH)[0]?.text).toBe("Exempt from income tax as Church or religious organization");

    const exempt = gmPage(w, CHURCH);
    const after = GmOrgTaxesTab({ ...props, org: exempt, section: exempt.sections.taxes ?? null });
    expect(rows(after)).toEqual(
      expect.arrayContaining([
        ["Exempt as", "Church or religious organization", "IRC 501(c)(3): it pays no income tax"],
        ["Donations to it", "Deductible", "a person's gifts come off their income tax"],
        ["Unemployment taxes it owes", "Neither", undefined],
        ["Exempt from income tax", undefined, "by its status: it pays none on its profit, and none passes to its owners"],
      ]),
    );
    expect(find(after, GmStatus)[0]?.current).toBe("church");
    // The GM's own view has no reader's controls.
    expect(find(after, DonateForm)).toEqual([]);
    // Not exempt again: none, as one op.
    (find(after, GmStatus)[0]?.gm as TaxesGm).status(null);
    expect(sent[1]).toEqual([{ op: "org", change: { do: "tax_status", org: CHURCH, status: null } }]);
  });

  test("Play: Jordan's Taxes of the church says it's exempt, with Donate, played as the donate action; the gift shows as received", async () => {
    const w = portAlder();
    expect(applyEffects(reg, w, [{ type: "economy.tax_status", args: { org: CHURCH, status: "church" } }], { bindings: {}, rng: createRng("status") }).rejected).toEqual([]);
    const { acts, played } = jordanActs(w, CHURCH);
    const section = jordanTaxes(w, CHURCH);
    expect(section.statuses).toBeNull();
    const tree = OrgTaxes({ section, currency: USD, acts });
    expect(find(tree, Section).map((p) => p.title)).toEqual(["Tax-exempt", "Donate", "Income tax", "Due next", "This year, 2026", "Last year, 2025"]);
    expect(find(tree, GmStatus)).toEqual([]);
    const [donate] = find(tree, DonateForm);
    expect(donate?.exempt).toEqual({ status: "church", name: "Church or religious organization", code: "501(c)(3)", deductible: true, futa: false, suta: false });
    expect(await (donate?.acts as TaxesActs).donate(2_500)).toBe(true);
    expect(played).toEqual([{ action: "donate", params: { to: CHURCH, amount: 2_500 } }]);
    expect(rows(OrgTaxes({ section: jordanTaxes(w, CHURCH), currency: USD, acts }))).toContainEqual(["Donations received", money(2_500), undefined]);
  });
});

describe("a consolidated return", () => {
  const gmEffect = (w: Working, type: string, args: Record<string, JsonValue>): string => applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) }).rejected.map((r) => r.rejection.reason).join("; ");

  /** Jordan's Harbor Holdings and its own Harbor Towing, both C corporations: Holdings bills $5,000, Towing pays Alder Automotive $500. */
  function group(): { w: Working; holdings: EntityId; towing: EntityId } {
    const w = portAlder();
    expect(gmEffect(w, "orgs.found", { type: "company", name: "Harbor Holdings", structure: "c_corp", cents: 200_000, from: SAVINGS, by: JORDAN })).toBe("");
    const holdings = Object.keys(w.state.entities).find((id) => w.state.entities[id]?.name === "Harbor Holdings") ?? "";
    expect(gmEffect(w, "orgs.found", { type: "company", name: "Harbor Towing", structure: "c_corp", cents: 100_000, from: String(w.state.entities[holdings]?.fields.operating_account ?? ""), founder: holdings })).toBe("");
    const towing = Object.keys(w.state.entities).find((id) => w.state.entities[id]?.name === "Harbor Towing") ?? "";
    const invoice = (business: EntityId, args: Record<string, JsonValue>): void => {
      const before = new Set(Object.keys(w.state.entities));
      expect(gmEffect(w, "economy.invoice_issue", { business, cents: 0, ...args })).toBe("");
      const id = Object.keys(w.state.entities).find((e) => !before.has(e) && w.state.entities[e]?.kind === "invoice") ?? "";
      expect(gmEffect(w, "economy.invoice_pay", { invoice: id })).toBe("");
    };
    invoice(holdings, { customer_name: "Harbor Marina", cents: 500_000, memo: "Towing contract" });
    invoice(SHOP, { customer: towing, cents: 50_000, memo: "Truck repairs" });
    return { w, holdings, towing };
  }

  test("File one plays tax_consolidate; elected, the group's figures show with Stop, and the member's Taxes reads filed by its parent; the GM's Stop is one org op", () => {
    const { w, holdings, towing } = group();
    const { acts, played } = jordanActs(w, holdings);
    const open = OrgTaxes({ section: jordanTaxes(w, holdings), currency: USD, acts });
    expect(find(open, "div").find((p) => p["data-lre-taxes-consolidated"] !== undefined)?.["data-lre-taxes-consolidated"]).toBe("open");
    expect(listRows(open)).toContainEqual(["Harbor Towing", "100% of its votes", "100%"]);
    click(open, "File a consolidated return");
    expect(played).toEqual([{ action: "tax_consolidate", params: { org: holdings, elect: "yes" } }]);
    expect(w.state.entities[holdings]?.fields.consolidated_return).toBe(true);

    const section = jordanTaxes(w, holdings);
    const elected = OrgTaxes({ section, currency: USD, acts });
    expect(find(elected, "div").find((p) => p["data-lre-taxes-consolidated"] !== undefined)?.["data-lre-taxes-consolidated"]).toBe("elected");
    const tax = section.consolidation?.tax ?? -1;
    expect(rows(elected)).toEqual(expect.arrayContaining([["The group's profit this year", money(450_000), "losses offset"], ["The group's tax so far", money(tax), undefined]]));
    expect(find(elected, Button).map((p) => [textOf(p.children), p.disabled === true])).toContainEqual(["Stop filing one", false]);
    // Harbor Towing's Taxes, as the GM reads it: Jordan governs its parent, not it.
    expect(rows(OrgTaxes({ section: decoded(gmPage(w, towing).sections.taxes), currency: USD }))).toContainEqual([
      "Filed on a consolidated return",
      "Harbor Holdings",
      "its parent's return pays the group's federal tax and its state tax: it pays none of its own while included",
    ]);

    const { gm, sent } = gmControls();
    click(OrgTaxes({ section: decoded(gmPage(w, holdings).sections.taxes), currency: USD, gm: taxesGm(holdings, gm) }), "GM: stop filing one");
    expect(sent).toEqual([[{ op: "org", change: { do: "consolidate", org: holdings, elect: false } }]]);
    edit(w, sent[0] ?? []);
    expect(w.state.entities[holdings]?.fields.consolidated_return).toBe(false);
  });
});
