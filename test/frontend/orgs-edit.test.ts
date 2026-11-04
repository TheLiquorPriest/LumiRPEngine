// An organization's editors (ORG-SPEC §4.4, §6.1, §6.3, §11 Phase 2, lane G2) on Port Alder, the
// views as the engine builds them and the trees walked without a DOM:
// - People's Hire someone and Admit a member by power, and a member's sheet with each control it
//   may use, every one played through the engine as its action;
// - Rules' Add position, Edit, Delegate… and Revoke, by power;
// - Live 1: in GM → Orgs, Rules adds Shop foreman and People appoints Jordan; Play's People then
//   offers him Hire someone, and hiring Jess into the position plays;
// - Live 2: the GM records Marcus's delegation to Jordan ($200 a payment, until a date), which Play's
//   Overview and Rules show;
// - GM → Orgs: Play's editors open the GM's sheets; a person's every way of belonging;
// - Build → Organizations: the list by type, a new organization's kind, and Live 6: Head Mechanic
//   with the staff powers and a $300 limit, saved into Alder Automotive's positions with no error; a
//   position's and a delegation's account limits kept through a save.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { resolveEdit } from "../../src/engine/edits";
import { buildGmWorld } from "../../src/engine/gm-view";
import { materializeAll, materializeIfNeeded } from "../../src/engine/materialize";
import { readPass } from "../../src/engine/read-pass";
import { createRegistry } from "../../src/engine/registry-impl";
import { resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import type { SheetRoute } from "../../src/frontend/app";
import type { GmSectionProps } from "../../src/frontend/registry";
import { delegationLinkOps, groupKinds, newOrgKind, orgRows, orgTypeOfKind, positionsWith } from "../../src/frontend/build/organizations";
import { Button, ListRow, Section } from "../../src/frontend/components";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { ORG_LINTS } from "../../src/packs/orgs/core/lint";
import { decodeOrgPage } from "../../src/packs/orgs/ui/decode";
import { appointAction, delegationDraft, delegationEditOps, givable, hireAction, isGmPage, memberControls, newcomers, orgEditOf, orgEditRoute, payoutAction, payoutOps, payoutProblem, peopleControls, positionArgs, positionDraft, positionEditOps, positionOfView, positionProblem, rulesControls, titleAction, type OrgAction } from "../../src/packs/orgs/ui/edit";
import { GmOwners, gmPage, gmSheetFor, jobTitleOps, type GmOrgSheet } from "../../src/packs/orgs/ui/gm";
import { MemberDetails } from "../../src/packs/orgs/ui/member";
import { OrgPeople } from "../../src/packs/orgs/ui/people";
import { OrgRules } from "../../src/packs/orgs/ui/rules";
import type { JsonValue } from "../../src/shared/json";
import { applyPatch } from "../../src/shared/json-patch";
import { positionsIn } from "../../src/shared/org";
import type { OrgView } from "../../src/shared/org-view";
import type { EditOp } from "../../src/shared/protocol";
import type { GmView } from "../../src/shared/state-view";
import { DEFAULT_CURRENCY, playedKinds, type WorldDoc } from "../../src/shared/world";
import { startState } from "../packs/support";
import type { Props } from "../support/tree";

const reg = createRegistry(ALL_PACKS);
const SHOP = "alder_automotive_co";
const HOUSEHOLD = "household_kowalczyk";
const USD = DEFAULT_CURRENCY;

function portAlder(pov: string): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  world.pov = pov;
  return new Working(reg, world, startState(world, reg));
}

/** A GM edit applied, as GM → Orgs sends it. */
function edit(w: Working, ops: EditOp[]): void {
  const out = resolveEdit(reg, w.world, w.state, ops, { gm: true, runSeed: "orgs-edit" });
  if ("rejection" in out && out.rejection) throw new Error(`refused: ${out.rejection.reason}`);
  for (const e of "events" in out ? out.events : []) {
    const refused = w.apply(e);
    if (refused) throw new Error(`dropped: ${refused.reason}`);
  }
}

/** The reader's action, played through the engine as its editor sends it; "" when it played, else why not. */
function play(w: Working, actor: string, a: OrgAction): string {
  const res = resolveAction(reg, w, { action: a.action, params: a.params, actor }, createRng(`${a.action}:${w.events.length}`));
  return res.failed?.reason ?? res.rejected.map((r) => r.rejection.reason).join("; ");
}

function page(w: Working, org: string): OrgView {
  const view = reg.views.find((v) => v.panel === "orgs.org");
  if (!view) throw new Error("no orgs.org panel");
  const out = decodeOrgPage(
    readPass(() => view.build(w.ctx, { mapDisplay: null })),
    org,
  );
  if (!out) throw new Error(`no page for ${org}`);
  return out;
}

function gmView(w: Working): GmView {
  return { ...readPass(() => buildGmWorld(reg, w.world, w.state)), edits: [], refused: [], held: [], minds: {} as GmView["minds"] };
}

function elements(node: unknown): VNode<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node) || !("type" in node)) return [];
  const v = node as VNode<Props>;
  return [v, ...Object.values(v.props).flatMap(elements)];
}

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

function buttons(node: unknown): string[] {
  return elements(node)
    .filter((v) => v.type === Button)
    .map((v) => textOf(v.props.children));
}

function person(org: OrgView, id: string) {
  const p = org.people.find((x) => x.id === id);
  if (!p) throw new Error(`${id} isn't on ${org.name}'s page`);
  return p;
}

/** Shop foreman as Live 1 has it: the staff and money powers it names, $500 a payment. */
const foreman = { ...positionDraft(null, USD), title: "Shop foreman", powers: ["staff.hire" as const, "staff.pay" as const, "money.view" as const, "money.spend" as const], payment: "500" };

describe("routes", () => {
  test("an editor's route names its organization, form and target, and reads back", () => {
    const route = orgEditRoute(SHOP, "member", "danny_okafor");
    expect(route.kind).toBe("org_edit");
    expect(orgEditOf(route.id)).toEqual({ org: SHOP, form: "member", id: "danny_okafor" });
    expect(orgEditOf(orgEditRoute("odd/id", "position").id)).toEqual({ org: "odd/id", form: "position", id: null });
    expect(orgEditOf("nonsense")).toBeNull();
  });
});

describe("Play: People, a member's sheet and Rules, by power", () => {
  test("Marcus may hire and admit at Alder Automotive; Jordan may neither, and his rows only open sheets", () => {
    const marcus = page(portAlder("marcus_delgado"), SHOP);
    expect(peopleControls(marcus)).toEqual({ hire: true, admit: true, payout: false });
    const opened: SheetRoute[] = [];
    const tree = OrgPeople({ org: marcus, ownership: null, open: (r) => opened.push(r) });
    expect(buttons(tree).slice(0, 2)).toEqual(["Hire someone", "Admit a member"]);
    for (const b of elements(tree).filter((v) => v.type === Button)) (b.props.onClick as () => void)();
    expect(opened.slice(0, 2)).toEqual([orgEditRoute(SHOP, "hire"), orgEditRoute(SHOP, "admit")]);
    expect(newcomers(marcus, "hire").map((c) => c.id)).toContain("priya_nair");
    expect(newcomers(marcus, "hire").map((c) => c.id)).not.toContain("danny_okafor");
    expect(peopleControls(page(portAlder("pov"), SHOP))).toEqual({ hire: false, admit: false, payout: false });
  });

  test("Danny's sheet as Marcus reads it: his position, powers and job, and every staff control; Jordan's own sheet as he reads it offers his title", () => {
    const marcus = page(portAlder("marcus_delgado"), SHOP);
    const danny = person(marcus, "danny_okafor");
    expect(memberControls(marcus, danny)).toEqual(["appoint", "title", "delegate", "raise", "hours", "leave", "let_go"]);
    const details = MemberDetails({ org: marcus, person: danny, job: null });
    expect(elements(details).filter((v) => v.type === ListRow).map((v) => v.props.title)).toEqual(["None of its powers", "Status"]);
    const jordan = page(portAlder("pov"), SHOP);
    expect(memberControls(jordan, person(jordan, "pov"))).toEqual(["title"]);
    expect(memberControls(jordan, person(jordan, "danny_okafor"))).toEqual([]);
  });

  test("each staff control plays as Marcus's action: a new title on Danny's job, out of his position, a raise, hours, leave and back, then let go", () => {
    const w = portAlder("marcus_delgado");
    const org = page(w, SHOP);
    const danny = person(org, "danny_okafor");
    expect(titleAction(org, danny, "Lead mechanic")).toEqual({ action: "job_title", params: { job: "job_danny_mechanic", title: "Lead mechanic" } });
    expect(play(w, "marcus_delgado", titleAction(org, danny, "Lead mechanic"))).toBe("");
    // His position's title still heads his row (§3.3); the job's own title is the job's.
    expect(w.state.entities.job_danny_mechanic?.fields.title).toBe("Lead mechanic");
    expect(play(w, "marcus_delgado", appointAction(org, danny, ""))).toBe("");
    expect(person(page(w, SHOP), "danny_okafor").position).toBeNull();
    const steps: OrgAction[] = [
      { action: "job_raise", params: { job: "job_danny_mechanic", rate: 2900 } },
      { action: "job_hours", params: { job: "job_danny_mechanic", hours_per_week: 32 } },
      { action: "job_leave", params: { job: "job_danny_mechanic" } },
    ];
    for (const a of steps) expect(play(w, "marcus_delgado", a)).toBe("");
    const onLeave = person(page(w, SHOP), "danny_okafor");
    expect(onLeave.status).toBe("leave");
    expect(memberControls(page(w, SHOP), onLeave)).toContain("back");
    expect(play(w, "marcus_delgado", { action: "job_return", params: { job: "job_danny_mechanic" } })).toBe("");
    expect(play(w, "marcus_delgado", { action: "job_end", params: { job: "job_danny_mechanic" } })).toBe("");
    // Jordan, who appoints for no one, can't retitle Danny's job; his own he may.
    const j = portAlder("pov");
    expect(play(j, "pov", { action: "job_title", params: { job: "job_danny_mechanic", title: "Boss" } })).not.toBe("");
    expect(play(j, "pov", { action: "job_title", params: { job: "job_pov_mechanic", title: "Mechanic II" } })).toBe("");
  });

  test("Rules as Marcus reads them: Add position, Edit on Mechanic and Delegate…; as Jordan, none of them", () => {
    const marcus = page(portAlder("marcus_delgado"), SHOP);
    expect(rulesControls(marcus)).toEqual({ positions: true, delegate: true, dues: false });
    const opened: SheetRoute[] = [];
    const tree = OrgRules({ org: marcus, currency: USD, open: (r) => opened.push(r) });
    expect(buttons(tree)).toEqual(["Add position", "Edit", "Delegate…"]);
    for (const b of elements(tree).filter((v) => v.type === Button)) (b.props.onClick as () => void)();
    expect(opened).toEqual([orgEditRoute(SHOP, "position"), orgEditRoute(SHOP, "position", "mechanic"), orgEditRoute(SHOP, "delegate")]);
    expect(buttons(OrgRules({ org: page(portAlder("pov"), SHOP), currency: USD, open: () => undefined }))).toEqual([]);
    expect(rulesControls(page(portAlder("helen_kowalczyk"), HOUSEHOLD)).dues).toBe(true);
  });

  test("a position's draft: its problems, and what saving it sends, clearing what was cleared", () => {
    const marcus = page(portAlder("marcus_delgado"), SHOP);
    const positions = marcus.positions.filter((p) => !p.implied).map(positionOfView);
    expect(positionProblem({ ...foreman, title: "Mechanic" }, positions, USD)).toBe("It has a position Mechanic already.");
    expect(positionProblem({ ...foreman, seats: "-1" }, positions, USD)).toBe("Seats is a whole number: 0 for any number.");
    expect(positionProblem({ ...positionDraft(positions[0] ?? null, USD), reportsTo: "mechanic" }, positions, USD)).toBe("A position can't report to itself.");
    expect(positionArgs(SHOP, foreman, null, USD)).toEqual({ org: SHOP, title: "Shop foreman", powers: "staff.hire,staff.pay,money.view,money.spend", seats: 1, scope: "org", payment: 50000, successor: "vacant", default: false });
    const before = { id: "shop_foreman", title: "Shop foreman", powers: [], seats: 1, scope: "org" as const, successor: "vacant", reports_to: "mechanic", limits: { payment: 50000 } };
    expect(positionArgs(SHOP, { ...positionDraft(before, USD), powers: [], reportsTo: "", payment: "" }, before, USD)).toMatchObject({ id: "shop_foreman", powers: ",", no_report: true, payment: 0 });
  });
});

describe("Live 1: the GM makes Jordan Shop foreman, and he hires Jess into it", () => {
  test("Rules adds the position, People appoints him; Play's People offers him Hire someone, and the hire plays with its position", () => {
    const w = portAlder("pov");
    edit(w, positionEditOps(SHOP, foreman, null, USD));
    const job = gmView(w).entities.find((e) => e.id === "job_pov_mechanic");
    if (!job) throw new Error("no job for Jordan");
    edit(w, jobTitleOps(job, "Mechanic", "shop_foreman"));
    const org = page(w, SHOP);
    expect(person(org, "pov").position?.title).toBe("Shop foreman");
    expect(person(org, "pov").powers.map((p) => [p.power, p.basis, p.id])).toEqual(expect.arrayContaining([["staff.hire", "position", "shop_foreman"]]));
    expect(peopleControls(org).hire).toBe(true);
    expect(buttons(OrgPeople({ org, ownership: null, open: () => undefined }))[0]).toBe("Hire someone");
    const hire = hireAction(org, { worker: "jess_kowalczyk", title: "Receptionist", position: "shop_foreman", basis: "hourly", rate: "17", hours: "20", every: "" }, USD);
    expect(hire).toEqual({ action: "job_hire", params: { business: SHOP, worker: "jess_kowalczyk", title: "Receptionist", position: "shop_foreman", basis: "hourly", rate: 1700, hours_per_week: 20 } });
    if (!hire) throw new Error("the hire isn't complete");
    expect(play(w, "pov", hire)).toBe("");
    const jess = person(page(w, SHOP), "jess_kowalczyk");
    expect([jess.title, jess.position?.id, w.state.entities[jess.job ?? ""]?.fields.title]).toEqual(["Shop foreman", "shop_foreman", "Receptionist"]);
  });
});

describe("Live 2: the GM records Marcus's delegation to Jordan", () => {
  test("$200 a payment until a date, granted by Marcus: Jordan's page shows it and what it lets him do", () => {
    const w = portAlder("pov");
    edit(w, delegationEditOps(SHOP, { ...delegationDraft("pov", null, USD), powers: ["money.spend"], payment: "200", until: "2026-12-31", by: "marcus_delgado" }, USD));
    const org = page(w, SHOP);
    expect(org.you.delegations.map((d) => [d.powers, d.limits, d.by?.name])).toEqual([[["money.spend"], { payment: 20000 }, "Marcus Delgado"]]);
    expect(org.you.delegations[0]?.until).toContain("2026");
    expect(person(org, "pov").powers.find((p) => p.power === "money.spend")).toEqual({ power: "money.spend", basis: "delegate", id: "marcus_delgado", words: "spend its money" });
    expect(givable(org)).toEqual(expect.arrayContaining(["money.spend"]));
  });
});

describe("GM → Orgs", () => {
  test("Play's editors open the GM's sheets, and the GM's page gives every Rules control", () => {
    expect(gmSheetFor(orgEditRoute(SHOP, "member", "pov"))).toEqual({ kind: "person", who: "pov" });
    expect(gmSheetFor(orgEditRoute(SHOP, "position", "mechanic"))).toEqual({ kind: "position", id: "mechanic" });
    expect(gmSheetFor(orgEditRoute(SHOP, "delegate"))).toEqual({ kind: "delegation", who: null });
    expect(gmSheetFor(orgEditRoute(SHOP, "hire"))).toEqual({ kind: "job", id: null });
    expect(gmSheetFor({ kind: "person", id: "pov" })).toBeNull();
    const entry = gmView(portAlder("pov")).orgs.find((o) => o.page.id === SHOP);
    if (!entry) throw new Error("no shop in GM → Orgs");
    const org = gmPage(entry.page);
    expect(isGmPage(org)).toBe(true);
    expect(rulesControls(org)).toEqual({ positions: true, delegate: true, dues: false });
    expect(peopleControls(org)).toEqual({ hire: false, admit: false, payout: false });
    expect(memberControls(org, person(org, "pov"))).toEqual([]);
  });
});

describe("a trust's People and payout (DESIGN §29.7)", () => {
  const TRUST = "thorne_trust";
  /** Harrowmere at Money 3, where a payout is an action, its money open. */
  function manor(pov: string): Working {
    const make = STARTER_WORLDS.mystery_manor;
    if (!make) throw new Error("no Harrowmere starter");
    const world = make("mm", "Harrowmere");
    world.pov = pov;
    world.realism.levels.money = 3;
    const w = new Working(reg, world, startState(world, reg));
    materializeAll(reg, w, pov, "run");
    // Its money opens as anyone's does when the story first reads it.
    materializeIfNeeded(reg, w, TRUST, "money", "run");
    return w;
  }
  const titles = (tree: unknown): unknown[] => elements(tree).filter((v) => v.type === Section).map((v) => v.props.title);

  test("a trustee reads Trustees and beneficiaries and pays a stated amount out by share; a beneficiary may not", () => {
    const w = manor("sir_alaric");
    const org = page(w, TRUST);
    expect(peopleControls(org)).toEqual({ hire: true, admit: false, payout: true });
    const opened: SheetRoute[] = [];
    const tree = OrgPeople({ org, ownership: null, open: (r) => opened.push(r) });
    expect(titles(tree)).toContain("Trustees and beneficiaries");
    expect(buttons(tree)).toEqual(["Hire someone", "Pay out to its beneficiaries"]);
    for (const b of elements(tree).filter((v) => v.type === Button)) (b.props.onClick as () => void)();
    expect(opened.slice(0, 2)).toEqual([orgEditRoute(TRUST, "hire"), orgEditRoute(TRUST, "payout")]);
    expect(orgEditOf(orgEditRoute(TRUST, "payout").id)).toEqual({ org: TRUST, form: "payout", id: null });
    // A trust pays out what it holds, so it asks how much.
    expect(payoutProblem("", USD)).not.toBeNull();
    expect(payoutAction(TRUST, "", USD)).toBeNull();
    const payout = payoutAction(TRUST, "100", USD);
    expect(payout).toEqual({ action: "distribute_profit", params: { business: TRUST, amount: 10_000 } });
    if (!payout) throw new Error("no payout");
    const before = w.state.accounts.acct_thorne_trust ?? 0;
    expect(play(w, "sir_alaric", payout)).toBe("");
    expect(w.state.accounts.acct_thorne_trust).toBe(before - 10_000);
    expect(peopleControls(page(manor("lady_honoria"), TRUST)).payout).toBe(false);
  });

  test("GM → Orgs: the trust's owners offer Pay out, Play's route opens the GM's sheet, and the GM's edit pays out", () => {
    const w = manor("sir_alaric");
    expect(gmSheetFor(orgEditRoute(TRUST, "payout"))).toEqual({ kind: "payout" });
    const gm = gmView(w);
    const entry = gm.orgs.find((o) => o.page.id === TRUST);
    if (!entry) throw new Error("no trust in GM → Orgs");
    const section: GmSectionProps = { chatId: "c", gm, currency: USD, reloadKey: "", busy: false, edit: () => Promise.resolve(true), reload: () => Promise.resolve(), changed: () => Promise.resolve(), send: () => Promise.reject(new Error("no backend")) };
    const opened: GmOrgSheet[] = [];
    const tree = GmOwners({ entry, section, open: (s) => opened.push(s) });
    const pay = elements(tree).find((v) => v.type === Button && textOf(v.props.children) === "Pay out to its beneficiaries");
    (pay?.props.onClick as () => void)();
    expect(opened).toEqual([{ kind: "payout" }]);
    expect(payoutOps(TRUST, "50", USD)).toEqual([{ op: "effect", effect: "economy.distribute", args: { business: TRUST, cents: 5_000 } }]);
    const before = w.state.accounts.acct_thorne_trust ?? 0;
    edit(w, payoutOps(TRUST, "50", USD));
    expect(w.state.accounts.acct_thorne_trust).toBe(before - 5_000);
  });
});

describe("Build → Organizations", () => {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  const doc: WorldDoc = { ...world, kinds: playedKinds(Object.fromEntries(reg.kinds), world.kinds) };

  test("the list by type, and a new organization's kind", () => {
    const rows = orgRows(doc);
    expect(rows.company.map((r) => r.id)).toContain(SHOP);
    expect(rows.household.map((r) => r.id)).toContain(HOUSEHOLD);
    expect(orgTypeOfKind(doc, "business")).toBe("company");
    expect(orgTypeOfKind(doc, "person")).toBeNull();
    expect(groupKinds(doc).map((k) => k.id)[0]).toBe("group");
    expect(groupKinds(doc).map((k) => k.id)).not.toContain("household");
    expect([newOrgKind("company", ""), newOrgKind("group", "faction"), newOrgKind("household", "x")]).toEqual(["business", "faction", "household"]);
  });

  test("Live 6: Head Mechanic, with the staff powers and a $300 limit, saved into Alder Automotive's positions; the world lints with no error", () => {
    const shop = world.entities[SHOP];
    if (!shop) throw new Error("no shop");
    const draft = { ...positionDraft(null, USD), title: "Head Mechanic", powers: ["staff.hire" as const, "staff.fire" as const, "staff.pay" as const], payment: "300" };
    const before = positionsIn(shop.fields.positions);
    expect(positionProblem(draft, before, USD)).toBeNull();
    const next = positionsWith(before, draft, USD);
    expect(next.at(-1)).toEqual({ id: "head_mechanic", title: "Head Mechanic", powers: ["staff.hire", "staff.fire", "staff.pay"], seats: 1, limits: { payment: 30000 } });
    const edited: WorldDoc = { ...world, entities: { ...world.entities, [SHOP]: { ...shop, fields: { ...shop.fields, positions: next } } } };
    const issues = ORG_LINTS.flatMap((rule) => rule.check(edited, reg));
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(positionsWith(positionsIn(next), { ...draft, id: "head_mechanic" }, USD, true)).toEqual(JSON.parse(JSON.stringify(before)) as JsonValue[]);
  });

  test("a position's and a delegation's limit to one account stay through a save, which writes each whole", () => {
    const before = positionsIn([{ id: "buyer", title: "Buyer", powers: ["money.spend"], limits: { payment: 20000, accounts: ["acct_marcus_shop"] } }]);
    const draft = { ...positionDraft(before[0] ?? null, USD), payment: "250" };
    expect(positionsWith(before, draft, USD)).toEqual([{ id: "buyer", title: "Buyer", powers: ["money.spend"], seats: 1, limits: { payment: 25000, accounts: ["acct_marcus_shop"] } }]);
    const delegation = { ...delegationDraft("pov", { powers: ["money.spend"], payment: 20000, accounts: ["acct_marcus_shop"], by: "marcus_delgado" }, USD), payment: "250" };
    expect(delegationLinkOps(doc, SHOP, 2, delegation)).toEqual([{ op: "replace", path: "/entities/pov/relations/2", value: { type: "acts_for", to: SHOP, fields: { powers: ["money.spend"], payment: 25000, accounts: ["acct_marcus_shop"], by: "marcus_delgado" } } }]);
    // One with no such limit writes none.
    expect(delegationLinkOps(doc, SHOP, null, { ...delegation, accounts: null })).toEqual([{ op: "add", path: "/entities/pov/relations/-", value: { type: "acts_for", to: SHOP, fields: { powers: ["money.spend"], payment: 25000, by: "marcus_delgado" } } }]);
  });
});

describe("lint quick fixes (§6.4)", () => {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const lintOf = (w: WorldDoc) => ORG_LINTS.flatMap((rule) => rule.check(w, reg));
  const fixed = (w: WorldDoc, code: string): WorldDoc => {
    const issue = lintOf(w).find((i) => i.code === code);
    if (!issue?.fix) throw new Error(`no fix for ${code}`);
    return applyPatch(w as unknown as JsonValue, issue.fix.ops) as unknown as WorldDoc;
  };

  test("Helen heads the Kowalczyks by her title: the fix writes the Head position and has her hold it, and the note goes", () => {
    const world = make("pa", "Port Alder");
    const after = fixed(world, "orgs.head_title");
    expect(positionsIn(after.entities[HOUSEHOLD]?.fields.positions).map((p) => [p.id, p.powers.length, p.seats])).toEqual([["head", 21, 1]]);
    expect(after.entities.helen_kowalczyk?.relations.find((r) => r.to === HOUSEHOLD)?.fields).toEqual({ role: "head", position: "head" });
    expect(lintOf(after).map((i) => i.code)).not.toContain("orgs.head_title");
  });

  test("a job in a position its employer lacks, more holders than seats, and a report up the line to itself each mend in one press", () => {
    const world = make("pa", "Port Alder");
    const shop = world.entities[SHOP];
    const job = world.entities.job_danny_mechanic;
    if (!shop || !job) throw new Error("no shop");
    job.fields.position = "chief";
    shop.fields.positions = [
      { id: "mechanic", title: "Mechanic", powers: [], seats: 1, reports_to: "lead" },
      { id: "lead", title: "Lead", powers: ["staff.hire", "flying"], seats: 1, reports_to: "mechanic" },
    ];
    const codes = lintOf(world).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["orgs.job_position", "orgs.reports_cycle", "orgs.power_unknown"]));
    expect(fixed(world, "orgs.job_position").entities.job_danny_mechanic?.fields.position).toBeUndefined();
    expect(positionsIn(fixed(world, "orgs.power_unknown").entities[SHOP]?.fields.positions)[1]?.powers).toEqual(["staff.hire"]);
    const once = fixed(world, "orgs.reports_cycle");
    expect(lintOf(once).map((i) => i.code)).not.toContain("orgs.reports_cycle");
    job.fields.position = "mechanic";
    shop.fields.positions = [{ id: "mechanic", title: "Mechanic", powers: [], seats: 1 }];
    expect(positionsIn(fixed(world, "orgs.seats").entities[SHOP]?.fields.positions)[0]?.seats).toBe(2);
  });
});
