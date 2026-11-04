// Play → Orgs (ORG-SPEC §4, §11 Phase 1, lane U), its trees walked without a DOM from what the orgs
// views read on Port Alder:
// - the home: the party card, Alder Automotive under Companies with Jordan's title, the Kowalczyks
//   under Known organizations;
// - Alder Automotive's page: its badge and Jordan's title, Overview, People and Rules with no Money,
//   its first line "Mechanic since 12 Jan 2026; Marcus Delgado runs it", Marcus (Owner), Danny
//   (Mechanic) and Jordan (Mechanic) in People, and someone hidden counted;
// - Marcus's page: the packs' tabs (`r.orgTab`) in order with their sections, and People's part;
// - Helen's household: her implied Head in the chart and in Rules;
// - the party's page from its roster;
// - the person sheet's Organizations, and Cast's Your groups opening Orgs.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { readPass } from "../../src/engine/read-pass";
import { createRegistry } from "../../src/engine/registry-impl";
import { Working } from "../../src/engine/working";
import type { SheetRoute } from "../../src/frontend/app";
import { Badge, Button, Card, Disclosure, Empty, ListRow, PageHeader, Row, Section, Tabs } from "../../src/frontend/components";
import type { OrgTabDef, OrgTabProps } from "../../src/frontend/registry";
import { buildCatalog } from "../../src/frontend/ui-registry";
import { decodeCastView, YourGroups } from "../../src/packs/castlife/ui/panel";
import { personOrgs } from "../../src/packs/castlife/ui/person";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { decodeOrgList, decodeOrgPage } from "../../src/packs/orgs/ui/decode";
import orgsUi from "../../src/packs/orgs/ui/index";
import { OrgsHome, partyLines, StartSomething } from "../../src/packs/orgs/ui/home";
import { OrgPage, orgTabs, type OrgPageProps } from "../../src/packs/orgs/ui/org";
import { OrgOverview, PersonRow } from "../../src/packs/orgs/ui/overview";
import { PartyControls, PartyOffers, PartyOverview, PartyRoster, PartyTiers } from "../../src/packs/orgs/ui/party";
import { orgEditRoute } from "../../src/packs/orgs/ui/edit";
import { OrgPeople } from "../../src/packs/orgs/ui/people";
import { OrgRules } from "../../src/packs/orgs/ui/rules";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { OrgView } from "../../src/shared/org-view";
import type { PartySectionView } from "../../src/shared/party";
import type { StateView } from "../../src/shared/state-view";
import { DEFAULT_CURRENCY, type WorldDoc } from "../../src/shared/world";
import { startState } from "../packs/support";
import type { Props } from "../support/tree";

const reg = createRegistry(ALL_PACKS);
const SHOP = "alder_automotive_co";
const HOUSEHOLD = "household_kowalczyk";

/** Port Alder as `pov` sees it at chat start, with the world changes a test makes. */
function portAlder(pov: string, patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  world.pov = pov;
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

/** A panel's view as the state view builds it, in one read pass. */
function panel(w: Working, id: string): JsonValue {
  const view = reg.views.find((v) => v.panel === id);
  if (!view) throw new Error(`no panel ${id}`);
  return readPass(() => view.build(w.ctx, { mapDisplay: null }));
}

function page(w: Working, org: string): OrgView {
  const view = decodeOrgPage(panel(w, "orgs.org"), org);
  if (!view) throw new Error(`no page for ${org}`);
  return view;
}

/** The orgs pack's own components, drawn one level further wherever they appear; the shared components stay as elements, their props read. */
const OWN: readonly unknown[] = [OrgOverview, OrgPeople, OrgRules, PersonRow, YourGroups, PartyOverview, PartyRoster, PartyOffers];

/** Every element anywhere in a tree, under its children and every prop that holds elements, the pack's own components drawn. */
function elements(node: unknown): VNode<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node) || !("type" in node)) return [];
  const v = node as VNode<Props>;
  if (OWN.includes(v.type)) return [v, ...elements((v.type as (p: Props) => unknown)(v.props))];
  return [v, ...Object.values(v.props).flatMap(elements)];
}

function find(node: unknown, type: unknown): Props[] {
  return elements(node)
    .filter((v) => v.type === type)
    .map((v) => v.props);
}

/** The words under an element's children, in order. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

/** Each list row as [title, subtitle, value]. */
function rows(node: unknown): unknown[][] {
  return find(node, ListRow).map((p) => [p.title, p.subtitle, p.value]);
}

/** The one element carrying `attr` (with `value`, when given). */
function marked(node: unknown, attr: string, value?: string): VNode<Props> {
  const found = elements(node).filter((v) => attr in v.props && (value === undefined || v.props[attr] === value));
  const [one] = found;
  if (found.length !== 1 || !one) throw new Error(`${found.length} elements carry ${attr}`);
  return one;
}

const SectionStub = (props: OrgTabProps) => props.section as unknown as VNode;
/** The economy's tabs as lane M registers them: Money, Ownership and Taxes as tabs, Payroll a part of People. */
const ECONOMY_TABS: OrgTabDef[] = buildCatalog([
  {
    id: "economy",
    register(r) {
      r.orgTab({ id: "economy.taxes", label: "Taxes", order: 70, section: "taxes", component: SectionStub });
      r.orgTab({ id: "economy.money", label: "Money", order: 40, section: "money", component: SectionStub });
      r.orgTab({ id: "economy.ownership", label: "Ownership", order: 60, section: "ownership", component: SectionStub });
      r.orgTab({ id: "economy.payroll", label: "Payroll", order: 30, section: "payroll", within: "people", component: SectionStub });
    },
  },
]).orgTabs as OrgTabDef[];

/** A page as the sheet draws it, with what it was asked to open and which tab it was asked for. */
function pageRig(org: OrgView, tab = "overview", figure: string | null = null) {
  const opened: SheetRoute[] = [];
  const tabs: string[] = [];
  const props: OrgPageProps = { org, figure, defs: ECONOMY_TABS, tab, panelId: "p", onTab: (id) => tabs.push(id), onBack: () => undefined, chatId: "c", state: {} as StateView, send: () => Promise.reject(new Error("no backend")), open: (route) => opened.push(route) };
  return { tree: OrgPage(props), opened, tabs };
}

describe("the Orgs home", () => {
  test("Jordan's: his party alone, Alder Automotive (Mechanic) under Companies, the Kowalczyks folded under Known organizations; each row opens its page", () => {
    const list = decodeOrgList(panel(portAlder("pov"), "orgs.list"));
    if (!list) throw new Error("the home didn't read");
    const opened: string[] = [];
    const tree = OrgsHome({ list, onOpen: (id) => opened.push(id) });
    expect(marked(tree, "data-lre-orgs-party").props["data-lre-orgs-party"]).toBe("party_pov");
    expect(rows(marked(tree, "data-lre-orgs-party"))).toEqual([["Your party", "Just you", undefined]]);
    expect(find(tree, Section).map((s) => s.title)).toEqual([undefined, "Companies"]);
    expect(rows(marked(tree, "data-lre-orgs-group", "company"))).toEqual([["Alder Automotive", undefined, "Mechanic"]]);
    expect(find(tree, Empty)).toEqual([]);
    const known = find(marked(tree, "data-lre-orgs-known"), Disclosure)[0];
    expect(textOf(known?.summary)).toBe("Known organizations 1");
    expect(rows(known?.children)).toEqual([["The Kowalczyks", "Household · You know Helen Kowalczyk, Jess Kowalczyk and Maddie Kowalczyk", undefined]]);
    for (const row of find(tree, ListRow)) (row.onClick as () => void)();
    expect(opened).toEqual(["party_pov", SHOP, HOUSEHOLD]);
  });

  test("Marcus's row shows the month's profit he may see; with nothing to list, the home says so under the party", () => {
    const list = decodeOrgList(panel(portAlder("marcus_delgado"), "orgs.list"));
    if (!list) throw new Error("the home didn't read");
    expect(rows(marked(OrgsHome({ list, onOpen: () => undefined }), "data-lre-orgs-group", "company"))[0]).toEqual(["Alder Automotive", expect.stringMatching(/^(Profit|Loss) this month: \$/), "Owner"]);
    const alone = OrgsHome({ list: { ...list, belong: [], known: [] }, onOpen: () => undefined });
    expect(find(alone, Empty).map((p) => textOf(p.children))).toEqual(["You don't belong to any organization yet."]);
    expect(find(alone, Disclosure)).toEqual([]);
  });

  test("the party card: who is in it by first name, then by tier, and who is here and away", () => {
    const party = (members: { name: string; tier: "core" | "companion" | "hired" | "ally"; here: boolean }[], hidden = 0) => partyLines({ id: "party_pov", name: "Your party", exists: false, members: members.map((m, i) => ({ id: `p${i}`, ...m })), hidden, purse: null });
    expect(party([])).toEqual({ who: "Just you", where: null });
    expect(party([{ name: "Danny Okafor", tier: "companion", here: true }])).toEqual({ who: "Danny · 1 companion", where: "1 here" });
    expect(
      party(
        [
          { name: "Danny Okafor", tier: "core", here: true },
          { name: "Maddie Kowalczyk", tier: "companion", here: false },
          { name: "Jess", tier: "companion", here: false },
          { name: "Priya Shah", tier: "hired", here: true },
        ],
        2,
      ),
    ).toEqual({ who: "Danny, Maddie, Jess and 3 others · 1 core member · 2 companions · 1 hired hand", where: "2 here · 2 away" });
  });

  test("the party card's purse line opens the party; Start something… offers a company, a group of the world's kinds and Name your party where the home can play", () => {
    const list = decodeOrgList(panel(portAlder("pov"), "orgs.list"));
    if (!list) throw new Error("the home didn't read");
    const opened: string[] = [];
    const act = () => undefined;
    const home = OrgsHome({ list: { ...list, party: { ...list.party, purse: "$60.00" } }, onOpen: (id) => opened.push(id), act, currency: DEFAULT_CURRENCY });
    const card = find(marked(home, "data-lre-orgs-party"), ListRow);
    expect(card.map((p) => [p.title, p.value])).toEqual([
      ["Your party", undefined],
      ["Purse", "$60.00"],
    ]);
    (card[1]?.onClick as () => void)();
    expect(opened).toEqual(["party_pov"]);
    const start = find(home, StartSomething)[0];
    expect([start?.act, start?.currency]).toEqual([act, DEFAULT_CURRENCY]);
    expect(list.start.company.why).toBeNull();
    expect(list.start.group?.kinds.map((k) => k.id)).toEqual(expect.arrayContaining(["faction", "family"]));
    // Read only, the home offers nothing to start.
    expect(find(OrgsHome({ list, onOpen: () => undefined }), StartSomething)).toEqual([]);
  });
});

describe("an organization's page", () => {
  test("Jordan's Alder Automotive: the header, Overview, People and Rules but no Money, and his place: Mechanic since 12 Jan 2026, run by Marcus", () => {
    const org = page(portAlder("pov"), SHOP);
    const { tree } = pageRig(org);
    expect(find(tree, PageHeader).map((p) => [p.title, p.subtitle])).toEqual([["Alder Automotive", "Company · LLC · Mechanic"]]);
    expect((find(tree, Tabs)[0]?.tabs as { label: string }[]).map((t) => t.label)).toEqual(["Overview", "People", "Rules"]);
    // No figure he may see heads it.
    expect(elements(tree).some((v) => "data-lre-org-headline" in v.props)).toBe(false);
    expect(find(tree, Section).map((s) => s.title)).toEqual(["Your place here", "What you may do"]);
    expect(textOf(marked(tree, "data-lre-org-place"))).toBe("Mechanic since 12 Jan 2026; Marcus Delgado runs it");
    expect(find(tree, Row)).toEqual([]);
    expect(rows(tree)).toEqual([["You hold none of its powers", undefined, undefined]]);
  });

  test("the Kowalczyks, whom Jordan only knows: who runs it heads the Overview, with no place of his; Helen holds its Head", () => {
    const org = page(portAlder("pov"), HOUSEHOLD);
    const overview = pageRig(org).tree;
    expect(find(overview, PageHeader).map((p) => [p.title, p.subtitle])).toEqual([["The Kowalczyks", "Household"]]);
    expect(find(marked(overview, "data-lre-org-headline"), "span").map((p) => textOf(p.children))).toEqual(["Helen Kowalczyk runs it"]);
    expect(find(overview, Section).map((s) => s.title)).toEqual([undefined]);
    expect(rows(marked(pageRig(org, "people").tree, "data-lre-org-position", "head"))).toEqual([["Helen Kowalczyk", "head", "Here"]]);
  });

  test("its People: Danny and Jordan in its Mechanic position, Marcus as its owner; each row opens that member's sheet, Jordan's own too", () => {
    const { tree, opened } = pageRig(page(portAlder("pov"), SHOP), "people");
    expect(find(marked(tree, "data-lre-org-position", "mechanic"), Section).map((s) => [s.title, s.aside])).toEqual([["Mechanic", "2 held"]]);
    expect(rows(marked(tree, "data-lre-org-position", "mechanic"))).toEqual([
      ["Danny Okafor", "Mechanic", "Here"],
      ["Jordan Ellis (you)", "Mechanic", undefined],
    ]);
    // Every staff member holds a position, so no one is left under Staff.
    expect(elements(tree).some((v) => v.props["data-lre-org-people"] === "staff")).toBe(false);
    expect(rows(marked(tree, "data-lre-org-people", "owners"))).toEqual([["Marcus Delgado", "Owner", "100%"]]);
    // Jordan may not see the ownership tab: no link to it.
    expect(find(marked(tree, "data-lre-org-people", "owners"), Button)).toEqual([]);
    // Jordan holds no power there: no Hire someone or Admit a member at the top.
    expect(elements(tree).some((v) => "data-lre-org-people-actions" in v.props)).toBe(false);
    for (const row of find(tree, ListRow)) (row.onClick as (() => void) | undefined)?.();
    expect(opened).toEqual([orgEditRoute(SHOP, "member", "danny_okafor"), orgEditRoute(SHOP, "member", "pov"), orgEditRoute(SHOP, "member", "marcus_delgado")]);
  });

  test("someone Jordan can't see is counted, never named", () => {
    const org = page(
      portAlder("pov", (world) => {
        const danny = world.entities.danny_okafor;
        if (danny) danny.visibility = "secret";
      }),
      SHOP,
    );
    const { tree } = pageRig(org, "people");
    expect(rows(tree).map((r) => r[0])).toEqual(["Jordan Ellis (you)", "And 1 other you don't know", "Marcus Delgado"]);
    expect(find(tree, "span").map((p) => textOf(p.children))).toEqual(["1 person you don't know belongs to it."]);
    expect(JSON.stringify(rows(tree))).not.toContain("Danny");
  });

  test("Jordan's Rules: its Mechanic position, which carries no power, and no delegation", () => {
    const { tree } = pageRig(page(portAlder("pov"), SHOP), "rules");
    expect(find(tree, Empty)).toEqual([]);
    expect(find(tree, Card).map((c) => c.title)).toEqual(["Mechanic"]);
    expect(find(tree, Row).map((r) => [r.k, r.v])).toEqual([
      ["May", "None"],
      ["Seats", "2 held"],
      ["When vacant", "Nobody: it stays vacant"],
    ]);
    expect(find(tree, Section).map((s) => s.title)).toEqual(["Positions"]);
  });

  test("Marcus's: the packs' tabs in their order, each drawing its own section; People's part follows the chart; Owners links to Ownership", () => {
    const org = page(portAlder("marcus_delgado"), SHOP);
    expect(Object.keys(org.sections)).toEqual(expect.arrayContaining(["money", "ownership", "taxes", "payroll"]));
    expect(orgTabs(org, ECONOMY_TABS).map((t) => t.label)).toEqual(["Overview", "People", "Money", "Ownership", "Taxes", "Rules"]);
    const money = pageRig(org, "economy.money").tree;
    expect(marked(money, "data-lre-org-tab").props["data-lre-org-tab"]).toBe("economy.money");
    expect(find(money, SectionStub).map((p) => p.section)).toEqual([org.sections.money]);
    // A part never makes a tab of its own; it shows at the foot of its tab.
    const people = pageRig(org, "people");
    expect(find(marked(people.tree, "data-lre-org-part", "economy.payroll"), Section).map((s) => s.title)).toEqual(["Payroll"]);
    expect(find(people.tree, SectionStub).map((p) => p.section)).toEqual([org.sections.payroll]);
    (find(marked(people.tree, "data-lre-org-people", "owners"), Button)[0]?.onClick as () => void)();
    expect(people.tabs).toEqual(["economy.ownership"]);
    // His place: every power, as owner; he runs it; the month's profit heads it.
    const list = decodeOrgList(panel(portAlder("marcus_delgado"), "orgs.list"));
    const figure = list?.belong.find((r) => r.id === SHOP)?.figure;
    if (!figure) throw new Error("Marcus sees no figure for the shop");
    expect(figure).toMatch(/^(Profit|Loss) this month: \$/);
    const overview = pageRig(org, "overview", figure).tree;
    expect(find(marked(overview, "data-lre-org-headline"), "span").map((p) => textOf(p.children))).toEqual([figure]);
    expect(textOf(marked(overview, "data-lre-org-place"))).toBe("Owner; you run it");
    expect(rows(overview)).toEqual([["Every power", undefined, "As owner"]]);
    // A tab the page doesn't show reads as Overview.
    expect(marked(pageRig(page(portAlder("pov"), SHOP), "economy.money").tree, "data-lre-org-tab").props["data-lre-org-tab"]).toBe("overview");
  });

  test("Helen's household: she holds its Head, in the chart and in Rules, and Jess and Maddie are its members", () => {
    const org = page(portAlder("helen_kowalczyk"), HOUSEHOLD);
    const people = pageRig(org, "people").tree;
    expect(find(people, Section).map((s) => [s.title, s.aside])).toEqual([
      ["Head", "1 of 1"],
      ["Members", undefined],
    ]);
    expect(rows(marked(people, "data-lre-org-position", "head"))).toEqual([["Helen Kowalczyk (you)", "head", undefined]]);
    expect(rows(marked(people, "data-lre-org-people", "members"))).toEqual([
      ["Jess Kowalczyk", "member", "Here"],
      ["Maddie Kowalczyk", "member", "Here"],
    ]);
    const rules = pageRig(org, "rules").tree;
    const head = marked(rules, "data-lre-org-rule", "head");
    expect(find(head, Card).map((c) => c.title)).toEqual(["Head"]);
    expect(find(head, Badge).map((b) => textOf(b.children))).toEqual(["Built in"]);
    expect(find(head, Row).map((r) => [r.k, r.v])).toEqual([
      ["May", "Every power"],
      ["Seats", "1 of 1"],
      ["When vacant", "Nobody: it stays vacant"],
    ]);
  });

  test("the party's page, before it has an entity: its Leader, and its roster by tier", () => {
    const w = portAlder("pov", (world) => {
      world.entities.danny_okafor?.relations.push({ type: "travels_with", to: "pov", fields: { tier: "companion", since: "2026-01-20" } });
    });
    const list = decodeOrgList(panel(w, "orgs.list"));
    if (!list) throw new Error("the home didn't read");
    expect(partyLines(list.party)).toEqual({ who: "Danny · 1 companion", where: "1 here" });
    const org = page(w, "party_pov");
    const overview = pageRig(org).tree;
    expect(find(overview, PageHeader).map((p) => [p.title, p.subtitle])).toEqual([["Your party", "Party · Leader"]]);
    expect(textOf(marked(overview, "data-lre-org-headline"))).toBe("1 here");
    expect(textOf(marked(overview, "data-lre-org-place"))).toBe("Leader; you run it");
    expect(find(overview, Section).map((s) => s.title)).toEqual([undefined, "Companions", "Your place here", "What you may do"]);
    expect(rows(find(overview, Section)[1]?.children)).toEqual([["Danny Okafor", "Since 20 Jan 2026", "Here"]]);
    const people = pageRig(org, "people").tree;
    expect(find(people, Section).map((s) => [s.title, s.aside])).toEqual([
      ["Leader", "1 of 1"],
      ["Companions", undefined],
    ]);
    expect(rows(marked(people, "data-lre-org-people", "companion"))).toEqual([["Danny Okafor", "Companion", "Here"]]);
  });

  test("the party's page as Jordan plays it: his controls, a hand whose job ended asked whether they leave, and what each tier means under Rules", () => {
    const w = portAlder("pov", (world) => {
      world.entities.jess_kowalczyk?.relations.push({ type: "travels_with", to: "pov", fields: { tier: "hired" } });
      world.entities.job_jess_party = { id: "job_jess_party", kind: "job", name: "Jess for the party", tier: "background", fields: { worker: "jess_kowalczyk", employer: "party_pov", status: "ended" }, relations: [] };
    });
    const org = page(w, "party_pov");
    const acted: [string, JsonObject][] = [];
    const props: OrgPageProps = { org, figure: null, defs: buildCatalog([orgsUi]).orgTabs as OrgTabDef[], tab: "overview", panelId: "p", onTab: () => undefined, onBack: () => undefined, chatId: "c", state: { currency: DEFAULT_CURRENCY } as unknown as StateView, send: () => Promise.reject(new Error("no backend")), open: () => undefined, act: (action, params) => acted.push([action, params]) };
    const overview = OrgPage(props);
    expect(rows(marked(overview, "data-lre-party-roster"))).toEqual([["Jess Kowalczyk", undefined, "Here"]]);
    const leave = find(marked(overview, "data-lre-party-offer", "jess_kowalczyk"), Button).find((b) => textOf(b.children) === "Leave the party");
    (leave?.onClick as (() => void) | undefined)?.();
    expect(acted).toEqual([["party_tier", { who: "jess_kowalczyk", tier: "out" }]]);
    const controls = find(overview, PartyControls)[0]?.section as PartySectionView | undefined;
    expect([controls?.can, controls?.candidates.some((c) => c.id === "danny_okafor")]).toEqual([{ manage: null, name: null, purse: null, hire: "Start a purse first: the party pays its hands from it", shareOut: "Start a purse first" }, true]);
    // Read only where nothing can play its controls, as GM → Orgs draws it.
    expect(find(OrgPage({ ...props, act: undefined }), PartyControls)).toEqual([]);
    const rules = OrgPage({ ...props, tab: "rules" });
    const tiers = find(rules, PartyTiers)[0];
    expect(rows(PartyTiers(tiers as unknown as OrgTabProps)).map((r) => r[0])).toEqual(["Core", "Companion", "Hired", "Ally"]);
  });
});

describe("Organizations elsewhere in Play", () => {
  test("the person sheet lists their place in each organization Jordan can see, by name", () => {
    const w = portAlder("pov", (world) => {
      world.entities.danny_okafor?.relations.push({ type: "travels_with", to: "pov", fields: { tier: "companion" } });
    });
    const pages = panel(w, "orgs.org");
    expect(personOrgs(pages, "danny_okafor")).toEqual([
      { id: SHOP, name: "Alder Automotive", badge: "Company · LLC", title: "Mechanic", position: null },
      { id: "party_pov", name: "Your party", badge: "Party", title: "Companion", position: null },
    ]);
    expect(personOrgs(pages, "helen_kowalczyk")).toEqual([{ id: HOUSEHOLD, name: "The Kowalczyks", badge: "Household", title: "head", position: null }]);
    expect(personOrgs(pages, "priya_nair")).toEqual([]);
    expect(personOrgs(null, "danny_okafor")).toEqual([]);
  });

  test("Cast's Your groups: each with Jordan's title there, opening its page in Orgs; one with no page opens nothing", () => {
    const w = portAlder("pov");
    const cast = decodeCastView(panel(w, "castlife.cast"));
    if (!cast) throw new Error("no cast");
    const opened: string[] = [];
    const tree = YourGroups({ groups: [...cast.mine, { id: "book_club", name: "Book club", kind: "Club" }], pages: panel(w, "orgs.org"), onOpen: (id) => opened.push(id) });
    expect(find(tree, ListRow).map((p) => [p.title, p.value, p.chevron])).toEqual([
      ["Alder Automotive", "Mechanic", true],
      ["Book club", "member", false],
    ]);
    for (const row of find(tree, ListRow)) (row.onClick as (() => void) | undefined)?.();
    expect(opened).toEqual([SHOP]);
  });
});
