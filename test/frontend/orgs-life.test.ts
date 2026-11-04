// An organization's life in Play (ORG-SPEC §3.14, §4.2, §4.4, §4.5, §11 Phase 4 Life, lane L;
// assess-party §6.2), its trees walked without a DOM from what the orgs views read:
// - alerts under the Overview's headline, each with Open to its tab: Harrowmere's vacant Master,
//   Verity's delegation ending (it needs her), the shop's negative equity on Money (it needs Marcus);
// - Coming up above History: Marcus's invoice and paydays, Jordan's own payday only;
// - the Needs you dot on the Orgs home's rows, and Now's glance: the alerts that need you, then the
//   party's plan in a line, each opening its page on its tab;
// - the Plan tab between People and Rules: goals with their orders nested, status chips and who set
//   them; Add a goal, Give an order, Edit, Done, Drop, Reopen and Mark plan done, each a request that
//   plays, and an order's own people moving it along; the order a member is on, on the party's roster;
//   GM → Orgs' Plan, the same changes as GM edits.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { resolveEdit } from "../../src/engine/edits";
import { applyEffects } from "../../src/engine/effects";
import { readPass } from "../../src/engine/read-pass";
import { createRegistry } from "../../src/engine/registry-impl";
import { resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { advance } from "../../src/engine/simulate";
import { Working } from "../../src/engine/working";
import type { SheetRoute } from "../../src/frontend/app";
import { OverflowMenu } from "../../src/frontend/build/chrome";
import { Badge, Banner, Button, Card, Disclosure, ListRow, Section } from "../../src/frontend/components";
import type { OrgTabDef, OrgTabProps } from "../../src/frontend/registry";
import { buildCatalog } from "../../src/frontend/ui-registry";
import { orgLog } from "../../src/packs/orgs/core/log";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { decodeAlerts, decodeComing, decodeOrgList, decodeOrgPage, decodePlan } from "../../src/packs/orgs/ui/decode";
import { ALERT_TAB_IDS, ComingUp, comingValue, needsYouOf, OrgAlerts, OrgsGlanceCard, planGlanceLine } from "../../src/packs/orgs/ui/feed";
import { homeTree, OrgsHome } from "../../src/packs/orgs/ui/home";
import type { ChartNode } from "../../src/packs/orgs/ui/chart-model";
import orgsUi from "../../src/packs/orgs/ui/index";
import { OrgPage, orgTabs, type OrgPageProps } from "../../src/packs/orgs/ui/org";
import { OrgHistory, OrgOverview } from "../../src/packs/orgs/ui/overview";
import { PartyOverview, PartyRoster } from "../../src/packs/orgs/ui/party";
import { goalControls, goalDraft, orderControls, orderDraft, PlanBoard, PlanControls, PlanGoalForm, PlanOrderForm, PlanOrderItem, planChange, planOps, planProblem, statusChange, teamLine, type PlanBoardProps, type PlanDraft } from "../../src/packs/orgs/ui/plan";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import { ALERTS_SECTION, PLAN_SECTION, PLAN_TAB, type OrgPlanView, type PlanStatus } from "../../src/shared/org-feed";
import type { OrgView } from "../../src/shared/org-view";
import type { StateView } from "../../src/shared/state-view";
import { DEFAULT_CURRENCY, type WorldDoc } from "../../src/shared/world";
import { startState } from "../packs/support";
import type { Props } from "../support/tree";

const reg = createRegistry(ALL_PACKS);
const SHOP = "alder_automotive_co";
const THORNES = "household_thorne";
const PARTY = "party_pov";
const DANNY = "danny_okafor";
const MADDIE = "maddie_kowalczyk";
const DAY = 1440;

function starter(id: string, name: string, pov: string, edit?: (world: WorldDoc) => void): Working {
  const make = STARTER_WORLDS[id];
  if (!make) throw new Error(`no ${id} starter`);
  const world: WorldDoc = make(id.slice(0, 2), name);
  world.pov = pov;
  edit?.(world);
  return new Working(reg, world, startState(world, reg));
}

function effect(w: Working, type: string, args: JsonObject): void {
  const out = applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) });
  if (out.rejected.length > 0) throw new Error(out.rejected.map((r) => r.rejection.reason).join("; "));
}

/** The reader's own action, as the tab's request plays it. */
function play(w: Working, change: { action: string; params: JsonObject } | null, actor = "pov"): void {
  if (!change) throw new Error("no change");
  const res = resolveAction(reg, w, { action: change.action, params: change.params, actor }, createRng(`${change.action}:${w.events.length}`));
  if (!res.ok || res.rejected.length > 0) throw new Error(res.failed?.reason ?? res.rejected.map((r) => r.rejection.reason).join("; "));
}

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

function planOf(w: Working, org = PARTY): OrgPlanView {
  const plan = decodePlan(page(w, org).sections[PLAN_SECTION]);
  if (!plan) throw new Error(`no plan for ${org}`);
  return plan;
}

/** The pack's own components, drawn one level further wherever they appear; the shared components stay as elements, their props read. */
const OWN: readonly unknown[] = [OrgOverview, OrgAlerts, ComingUp, PartyOverview, PartyRoster, PlanBoard, PlanOrderItem, PlanControls];

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

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

function marked(node: unknown, attr: string, value?: string): VNode<Props> {
  const found = elements(node).filter((v) => attr in v.props && (value === undefined || v.props[attr] === value));
  const [one] = found;
  if (found.length !== 1 || !one) throw new Error(`${found.length} elements carry ${attr}`);
  return one;
}

/** Each list row as [title, subtitle, value]. */
function rows(node: unknown): unknown[][] {
  return find(node, ListRow).map((p) => [p.title, p.subtitle, p.value]);
}

const SectionStub = (props: OrgTabProps) => props.section as unknown as VNode;
/** The orgs pack's own tabs, with the economy's Money, Ownership and Taxes as lane M registers them. */
const DEFS: OrgTabDef[] = buildCatalog([
  orgsUi,
  {
    id: "economy",
    register(r) {
      r.orgTab({ id: "economy.money", label: "Money", order: 40, section: "money", component: SectionStub });
      r.orgTab({ id: "economy.ownership", label: "Ownership", order: 60, section: "ownership", component: SectionStub });
      r.orgTab({ id: "economy.taxes", label: "Taxes", order: 70, section: "taxes", component: SectionStub });
    },
  },
]).orgTabs as OrgTabDef[];

function pageRig(org: OrgView, tab = "overview") {
  const opened: SheetRoute[] = [];
  const tabs: string[] = [];
  const props: OrgPageProps = { org, figure: null, defs: DEFS, tab, panelId: "p", onTab: (id) => tabs.push(id), onBack: () => undefined, chatId: "c", state: { currency: DEFAULT_CURRENCY } as unknown as StateView, send: () => Promise.reject(new Error("no backend")), open: (route) => opened.push(route) };
  return { tree: OrgPage(props), opened, tabs };
}

/** What the Overview draws, in order: each part by its component, a Section by its title. */
function overviewParts(tree: unknown): string[] {
  const root = marked(tree, "data-lre-org-overview");
  const kids = [root.props.children].flat(3).filter((k): k is VNode<Props> => typeof k === "object" && k !== null && "type" in k);
  const named = new Map<unknown, string>([
    [OrgAlerts, "Alerts"],
    [ComingUp, "Coming up"],
    [OrgHistory, "History"],
    [PartyOverview, "Party"],
  ]);
  return kids.map((k) => named.get(k.type) ?? (k.type === Section ? `Section: ${textOf(k.props.title) || "headline"}` : String(k.type)));
}

/** Harrowmere as `pov` reads it once Sir Alaric has died with succession off: the Master's seat stays vacant. */
function vacantHarrowmere(pov: string): Working {
  const w = starter("mystery_manor", "Harrowmere", pov, (world) => {
    world.packs.orgs = { version: 1, config: { succession: false } };
  });
  effect(w, "life", { entity: "sir_alaric", to: "dead" });
  advance(reg, w, w.state.clock + 12 * 60, { runSeed: "life", mode: "turn" });
  return w;
}

describe("alerts under the Overview's headline (ORG-SPEC §3.14, §4.4)", () => {
  test("Lady Honoria's Thornes: Master is vacant, with Open to People; it doesn't need her, who may not appoint", () => {
    const org = page(vacantHarrowmere("lady_honoria"), THORNES);
    const { tree, tabs } = pageRig(org);
    expect(overviewParts(tree).slice(0, 2)).toEqual(["Alerts", "Section: Your place here"]);
    expect(find(tree, Banner).map((b) => [b.tone, b.title, textOf(b.children)])).toEqual([["warn", undefined, "Master is vacant."]]);
    const open = find(marked(tree, "data-lre-org-alert", "vacancy:head"), Button);
    expect(open.map((b) => [textOf(b.children), b.label])).toEqual([["Open", "Open People"]]);
    (open[0]?.onClick as () => void)();
    expect(tabs).toEqual(["people"]);
  });

  test("a delegation ending within 3 days needs its delegate: Needs you, no Open (it is about the Overview); the home's row says so, and Now lists it", () => {
    const w = vacantHarrowmere("verity_lorne");
    effect(w, "orgs.delegate", { org: THORNES, to: "verity_lorne", powers: "money.view", until: w.state.clock + 2 * DAY });
    const org = page(w, THORNES);
    const alert = decodeAlerts(org.sections[ALERTS_SECTION]).find((a) => a.kind === "delegation_ending");
    expect(alert).toMatchObject({ needsYou: true, tab: "overview", short: "your delegation ends soon" });
    const banner = find(marked(pageRig(org).tree, "data-lre-org-alert", alert?.id ?? ""), Banner)[0];
    expect([banner?.title, textOf(banner?.children)]).toEqual(["Needs you", alert?.text]);
    expect(banner?.actions).toBeUndefined();
    // The home: Needs you on the Thornes' row, and on no other.
    const pages = panel(w, "orgs.org");
    const needs = needsYouOf(pages);
    expect(needs.map((n) => [n.org, n.name, n.alert.short])).toEqual([[THORNES, "The Thornes", "your delegation ends soon"]]);
    const list = decodeOrgList(panel(w, "orgs.list"));
    if (!list) throw new Error("the home didn't read");
    const flagged = (needing?: ReadonlySet<string>) => homeTree([...list.belong, ...list.known], needing).flatMap(function all(n): ChartNode[] {
      return [n, ...n.children.flatMap(all)];
    }).filter((n) => n.badges.some((b) => b.text === "Needs you"));
    expect(flagged(new Set(needs.map((n) => n.org))).map((n) => n.label)).toEqual(["The Thornes"]);
    expect(flagged()).toEqual([]);
    expect(find(OrgsHome({ list, onOpen: () => undefined, needs: new Set(needs.map((n) => n.org)) }), ListRow).filter((r) => r.badge !== undefined)).toEqual([]);
    // Now: "The Thornes: your delegation ends soon", opening its page.
    const opened: [string, string][] = [];
    const glance = OrgsGlanceCard({ needs, plan: null, onOpen: (o, tab) => opened.push([o, tab]) });
    expect(rows(glance)).toEqual([["The Thornes: your delegation ends soon", undefined, undefined]]);
    for (const r of find(glance, ListRow)) (r.onClick as () => void)();
    expect(opened).toEqual([[THORNES, "overview"]]);
  });

  test("Marcus's shop: negative equity two months running needs him, with Open to Money; Coming up comes above History", () => {
    const w = starter("modern_slice_of_life", "Port Alder", "marcus_delgado");
    w.apply(orgLog(w.ctx, SHOP, "Marcus Delgado set the shop's hours", { by: "marcus_delgado" }));
    const org = page(w, SHOP);
    const { tree, tabs } = pageRig(org);
    expect(find(tree, Banner).map((b) => [b.tone, b.title, textOf(b.children)])).toEqual([["neg", "Needs you", expect.stringMatching(/^Negative equity two months running: it owes \$[\d,]+\.\d\d more than it owns\.$/)]]);
    const open = find(marked(tree, "data-lre-org-alert", "negative_equity"), Button)[0];
    expect(open?.label).toBe("Open Money");
    (open?.onClick as () => void)();
    expect(tabs).toEqual(["economy.money"]);
    expect(ALERT_TAB_IDS.money).toBe("economy.money");
    // Coming up: the invoice due in and the paydays, soonest first, after his place and before History.
    expect(overviewParts(tree)).toEqual(["Alerts", "Section: Your place here", "Section: What you may do", "Coming up", "History"]);
    expect(rows(marked(tree, "data-lre-org-coming"))).toEqual([
      ["Invoice due in: Trailer brakes", "Wed 16 Sep 2026, 9:00 AM", undefined],
      ["Payday: 2 paychecks", "Fri 18 Sep 2026, 9:00 AM", undefined],
    ]);
  });

  test("Jordan, who can't see the shop's money: only his own payday is coming up, and no alert", () => {
    const org = page(starter("modern_slice_of_life", "Port Alder", "pov"), SHOP);
    expect(decodeComing(org.sections["orgs.coming"]).map((c) => [c.kind, c.text])).toEqual([["payday", "Your payday"]]);
    const { tree } = pageRig(org);
    expect(find(tree, Banner)).toEqual([]);
    expect(overviewParts(tree)).toEqual(["Section: Your place here", "Section: What you may do", "Coming up"]);
    // An amount known ahead is signed; one that isn't (a payroll's) shows none.
    expect(comingValue({ kind: "invoice", at: "", clock: 0, text: "", cents: 12_345 })).toEqual({ value: "+$123.45", tone: "pos" });
    expect(comingValue({ kind: "dues", at: "", clock: 0, text: "", cents: -2_000 })).toEqual({ value: "-$20.00", tone: "neg" });
    expect(comingValue({ kind: "payday", at: "", clock: 0, text: "", cents: 0 })).toEqual({});
  });
});

/** Port Alder with Danny a companion and Maddie core in Jordan's party; a goal for today with an order for Danny, and a standing order for Maddie. */
function partyPlan(): { w: Working; goal: string; sweep: string; signs: string } {
  const w = starter("modern_slice_of_life", "Port Alder", "pov");
  effect(w, "orgs.party_tier", { who: DANNY, tier: "companion" });
  effect(w, "orgs.party_tier", { who: MADDIE, tier: "core" });
  play(w, { action: "org_goal", params: { org: PARTY, text: "Get the shop ready for the inspection", window: "today" } });
  const goal = planOf(w).goals[0]?.id ?? "";
  play(w, { action: "org_order", params: { org: PARTY, to: DANNY, text: "Sweep the bays and stack the tyres", goal, where: "alder_automotive" } });
  play(w, { action: "org_order", params: { org: PARTY, to: MADDIE, text: "Paint the new signs" } });
  const plan = planOf(w);
  return { w, goal, sweep: plan.goals[0]?.orders[0]?.id ?? "", signs: plan.orders[0]?.id ?? "" };
}

function board(view: OrgPlanView, over: Partial<PlanBoardProps> = {}) {
  const drafts: (PlanDraft | null)[] = [];
  const statuses: [string, PlanStatus][] = [];
  const saved: PlanDraft[] = [];
  const tree = PlanBoard({ view, draft: null, busy: false, onDraft: (d) => drafts.push(d), onSave: (d) => saved.push(d), onStatus: (id, s) => statuses.push([id, s]), ...over });
  return { tree, drafts, statuses, saved };
}

/** An item's controls as [the button's label, the menu's labels]. */
function controls(node: unknown): [string | null, string[]] {
  const button = find(node, Button).find((b) => b.icon === "check");
  const menu = find(node, OverflowMenu)[0];
  return [button ? textOf(button.children) : null, ((menu?.items ?? []) as { label: string }[]).map((i) => i.label)];
}

describe("the Plan tab (assess-party §6.2, for any organization)", () => {
  test("its tab sits between People and Rules on the party's page, and among the economy's after People on the shop's", () => {
    const { w } = partyPlan();
    expect(orgTabs(page(w, PARTY), DEFS).map((t) => t.label)).toEqual(["Overview", "People", "Plan", "Rules"]);
    const marcus = starter("modern_slice_of_life", "Port Alder", "marcus_delgado");
    expect(orgTabs(page(marcus, SHOP), DEFS).map((t) => t.label)).toEqual(["Overview", "People", "Chart", "Plan", "Money", "Projects", "Property", "Ownership", "Taxes", "Decisions", "Rules"]);
    // A page draws the tab's component over its section; a shape it isn't reads as none.
    const drawn = pageRig(page(w, PARTY), PLAN_TAB).tree;
    expect(marked(drawn, "data-lre-org-tab").props["data-lre-org-tab"]).toBe(PLAN_TAB);
    expect(decodePlan(JSON.parse(JSON.stringify(planOf(w))))).toEqual(planOf(w));
    expect(decodePlan(null)).toBeNull();
  });

  test("Jordan's plan: the goal's card with its order nested, the standing order apart, each with its status, team, place and who set it", () => {
    const { w, sweep, signs } = partyPlan();
    const view = planOf(w);
    const { tree } = board(view);
    expect(find(tree, Card).map((c) => [c.title, find(c.aside, Badge).map((b) => textOf(b.children))])).toEqual([["Get the shop ready for the inspection", ["Open"]]]);
    const goal = marked(tree, "data-lre-plan-goal");
    expect(textOf(find(goal, "span").find((s) => textOf(s.children).startsWith("By"))?.children)).toBe("By Today");
    const order = marked(goal, "data-lre-plan-order", sweep);
    expect(find(order, "strong").map((s) => textOf(s.children))).toEqual(["Sweep the bays and stack the tyres"]);
    expect(find(order, Badge).map((b) => textOf(b.children))).toEqual(["Open"]);
    expect(find(order, "span").map((s) => textOf(s.children))).toEqual(["Danny Okafor", "At Alder Automotive · Standing order", expect.stringMatching(/^Set by you .*, on the plan$/)]);
    expect(textOf(find(marked(tree, "data-lre-plan-orders"), Section)[0]?.title)).toBe("Other orders");
    expect(find(marked(tree, "data-lre-plan-order", signs), "span").map((s) => textOf(s.children)).slice(0, 2)).toEqual(["Maddie Kowalczyk", "Standing order"]);
    // Jordan gives orders: Done first, the rest under ⋯; the goal: Give an order for it, Edit, Done and Drop.
    expect(controls(order)).toEqual(["Done", ["Under way", "Blocked", "Edit", "Drop"]]);
    expect(controls(elements(goal).filter((v) => v.type === PlanControls).at(-1))).toEqual([null, ["Give an order for it", "Edit", "Done", "Drop"]]);
    const signsView = view.orders[0];
    if (!signsView) throw new Error("no standing order");
    expect(teamLine({ ...signsView, to: [{ id: "a", name: "Danny" }, { id: "b", name: "Jess" }], lead: { id: "a", name: "Danny" } })).toBe("Danny (leads) and Jess");
  });

  test("Done plays, Mark plan done follows once its orders are done, and the goal done goes to Closed with Reopen", () => {
    const { w, goal, sweep } = partyPlan();
    const first = board(planOf(w));
    (find(marked(first.tree, "data-lre-plan-order", sweep), Button).find((b) => b.icon === "check")?.onClick as () => void)();
    expect(first.statuses).toEqual([[sweep, "done"]]);
    play(w, statusChange(PARTY, sweep, "done"));
    const done = planOf(w);
    expect(done.goals[0]?.ordersDone).toBe(true);
    const doneGoal = done.goals[0];
    if (!doneGoal?.orders[0]) throw new Error("no goal with its order");
    expect(goalControls(doneGoal).map((c) => c.label)).toEqual(["Mark plan done", "Give an order for it", "Edit", "Drop"]);
    // A done order stays under its goal, with Reopen.
    expect(orderControls(doneGoal.orders[0]).map((c) => c.label)).toEqual(["Reopen"]);
    const second = board(done);
    (find(marked(second.tree, "data-lre-plan-goal", goal), Button).find((b) => textOf(b.children) === "Mark plan done")?.onClick as () => void)();
    expect(second.statuses).toEqual([[goal, "done"]]);
    play(w, statusChange(PARTY, goal, "done"));
    const closed = board(planOf(w));
    expect(find(closed.tree, Card)).toEqual([]);
    const list = find(marked(closed.tree, "data-lre-plan-closed"), Disclosure)[0];
    expect(textOf(list?.summary)).toBe("Closed (2)");
    expect(rows(list?.children).map((r) => r[0])).toEqual(["Get the shop ready for the inspection", "Sweep the bays and stack the tyres"]);
    (find(list?.children, Button).find((b) => b.label === "Reopen Get the shop ready for the inspection")?.onClick as () => void)();
    expect(closed.statuses).toEqual([[goal, "open"]]);
    play(w, statusChange(PARTY, goal, "open"));
    expect(planOf(w).goals.map((g) => g.status)).toEqual(["open"]);
  });

  test("Add a goal and Give an order open their forms; each saves as the reader's action, an edit sending only what changed", () => {
    const { w, sweep } = partyPlan();
    const view = planOf(w);
    const { tree, drafts } = board(view);
    for (const b of find(marked(tree, "data-lre-plan-add"), Button)) (b.onClick as () => void)();
    expect(drafts).toEqual([goalDraft(null), orderDraft(null)]);
    // A new goal's form sits at the top; Save waits for its words, and a date that reads.
    const open = board(view, { draft: goalDraft(null) }).tree;
    expect(find(open, PlanGoalForm).map((f) => (f.draft as PlanDraft).kind)).toEqual(["goal"]);
    expect(planProblem(goalDraft(null))).toBe("Say what the goal is.");
    const paint: PlanDraft = { ...goalDraft(null), text: "Paint the van", by: "date", date: "20 Sep" };
    expect(planProblem(paint)).toBe("By when: a date, as YYYY-MM-DD.");
    const change = planChange(PARTY, { ...paint, date: "2026-09-20" }, view);
    expect(change).toEqual({ action: "org_goal", params: { org: PARTY, text: "Paint the van", window: "2026-09-20" } });
    play(w, change);
    expect(planOf(w).goals.map((g) => [g.text, g.window])).toEqual([
      ["Get the shop ready for the inspection", "Today"],
      ["Paint the van", "2026-09-20"],
    ]);
    // An order: for whom, at least one; who leads, one of them; a time that reads.
    const order = { ...orderDraft(null), text: "Fetch the paint" };
    expect(planProblem(order)).toBe("Choose whom it is for.");
    expect(planProblem({ ...order, to: [DANNY], when: "tonight" })).toBe("When: a date and time, as YYYY-MM-DD HH:MM, or nothing for a standing order.");
    const fetch = planChange(PARTY, { ...order, to: [DANNY, MADDIE], lead: MADDIE, when: "2026-09-15 17:00" }, planOf(w));
    expect(fetch).toEqual({ action: "org_order", params: { org: PARTY, to: `${DANNY},${MADDIE}`, lead: MADDIE, when: "2026-09-15 17:00", text: "Fetch the paint" } });
    play(w, fetch);
    const given = planOf(w).orders.find((o) => o.text === "Fetch the paint");
    expect([given?.to.map((t) => t.name), given?.lead?.name, given?.when]).toEqual([["Danny Okafor", "Maddie Kowalczyk"], "Maddie Kowalczyk", expect.stringContaining("5:00 PM")]);
    // Edit starts from the order as it is, and sends only what changed.
    const was = planOf(w).goals[0]?.orders.find((o) => o.id === sweep);
    if (!was) throw new Error("no order");
    expect(orderDraft(was)).toMatchObject({ id: sweep, to: [DANNY], lead: "", where: "alder_automotive", when: "", text: "Sweep the bays and stack the tyres" });
    expect(planChange(PARTY, orderDraft(was), planOf(w))).toBeNull();
    const edited = planChange(PARTY, { ...orderDraft(was), text: "Sweep the bays" }, planOf(w));
    expect(edited).toEqual({ action: "org_order", params: { org: PARTY, id: sweep, text: "Sweep the bays" } });
    play(w, edited);
    expect(planOf(w).goals[0]?.orders.map((o) => [o.text, o.where])).toEqual([["Sweep the bays", "Alder Automotive"]]);
    // The form being edited stands in for the order on the board.
    const editing = board(planOf(w), { draft: orderDraft(planOf(w).goals[0]?.orders[0] ?? null) }).tree;
    expect(find(editing, PlanOrderForm).map((f) => (f.draft as PlanDraft).id)).toEqual([sweep]);
    expect(() => marked(editing, "data-lre-plan-order", sweep)).toThrow();
  });

  test("Danny, a companion, moves his own order along or refuses it, but may not change it; someone outside the party sees no plan", () => {
    const { w, sweep } = partyPlan();
    const mine = (w.ctx.registry.orgSections.find((d) => d.id === PLAN_SECTION)?.build(w.ctx, PARTY, DANNY) ?? null) as unknown as OrgPlanView | null;
    const order = mine?.goals[0]?.orders[0];
    if (!order) throw new Error("Danny sees no order");
    expect([order.mine, order.mayStatus, order.mayEdit, order.edit, mine?.mayGive]).toEqual([true, true, false, null, false]);
    expect(orderControls(order).map((c) => c.label)).toEqual(["Done", "Under way", "Blocked", "Refuse"]);
    expect(find(PlanOrderItem({ order, busy: false, onControl: () => undefined }), Badge).map((b) => textOf(b.children))).toEqual(["Open", "Yours"]);
    expect(find(board(mine).tree, Button).map((b) => textOf(b.children))).not.toContain("Add a goal");
    play(w, statusChange(PARTY, sweep, "under_way"), DANNY);
    expect(planOf(w).goals[0]?.orders[0]?.status).toBe("under_way");
    expect(() => play(w, statusChange(PARTY, sweep, "dropped"), DANNY)).toThrow();
    expect(w.ctx.registry.orgSections.find((d) => d.id === PLAN_SECTION)?.build(w.ctx, PARTY, "marcus_delgado")).toBeNull();
  });

  test("the party's roster shows the order each member is on, and Now gives the plan in a line, opening the Plan", () => {
    const { w } = partyPlan();
    const party = page(w, PARTY);
    const roster = rows(marked(pageRig(party).tree, "data-lre-party-roster"));
    expect(roster).toEqual([
      ["Maddie Kowalczyk", expect.stringContaining("On: Paint the new signs"), expect.any(String)],
      ["Danny Okafor", expect.stringContaining("On: Sweep the bays and stack the tyres"), expect.any(String)],
    ]);
    const line = planGlanceLine(party);
    const away = party.people.filter((p) => !p.you && !p.here).map((p) => p.name.split(" ")[0]);
    expect(line).toBe(away.length > 0 ? `Plan: 0 of 2 done · ${away.join(" and ")} away` : "Plan: 0 of 2 done");
    const opened: [string, string][] = [];
    const glance = OrgsGlanceCard({ needs: [], plan: { org: PARTY, line: line ?? "" }, onOpen: (o, tab) => opened.push([o, tab]) });
    expect(rows(glance).map((r) => r[0])).toEqual([line]);
    (find(glance, ListRow)[0]?.onClick as () => void)();
    expect(opened).toEqual([[PARTY, PLAN_TAB]]);
    expect(planGlanceLine({ ...party, sections: {} })).toBeNull();
  });

  test("GM → Orgs' Plan: each change is one edit of the effect it plays, as the GM's", () => {
    const { w, signs } = partyPlan();
    const ops = planOps(statusChange(PARTY, signs, "blocked"));
    expect(ops).toEqual([{ op: "effect", effect: "orgs.plan_status", args: { org: PARTY, id: signs, status: "blocked" } }]);
    const out = resolveEdit(reg, w.world, w.state, ops, { gm: true, runSeed: "orgs-life" });
    if ("rejection" in out && out.rejection) throw new Error(out.rejection.reason);
    for (const e of "events" in out ? out.events : []) w.apply(e);
    const blocked = planOf(w).orders.find((o) => o.id === signs);
    if (!blocked) throw new Error("no order");
    expect(blocked.status).toBe("blocked");
    expect(orderControls(blocked).map((c) => c.label)).toEqual(["Done", "Under way", "Edit", "Drop"]);
    expect(planOps({ action: "elsewhere", params: {} })).toEqual([]);
  });
});
