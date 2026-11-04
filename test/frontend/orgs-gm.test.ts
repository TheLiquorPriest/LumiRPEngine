// GM → Orgs (ORG-SPEC §6.1, §11 Phase 1, lane G1) on Port Alder, the GM view as the engine builds
// it (`orgs.gm`) and its trees walked without a DOM:
// - every organization, the party first, as the GM sees it, and the list's search, type chips and a
//   person's filter;
// - the page: OrgPage with the packs' tabs, then Who may…, History and Fields, and People's GM parts
//   by type;
// - Live 3: Alder Automotive → People, Jordan made a joint owner, and Play's page then holds Money,
//   Ownership and Taxes; an owner holding two classes has a row each, and a save rewrites its own;
// - Live 4: the Kowalczyks → People, Add a member: Jordan, who then belongs there in Play's Orgs;
// - a member's link fields and Remove; a job added at the shop and ended;
// - Who may…'s chain of bases and its reason; History; Fields.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { resolveEdit } from "../../src/engine/edits";
import { buildGmWorld } from "../../src/engine/gm-view";
import { readPass } from "../../src/engine/read-pass";
import { createRegistry } from "../../src/engine/registry-impl";
import { Working } from "../../src/engine/working";
import { Button, Empty, ListRow, Section, Tabs } from "../../src/frontend/components";
import { Chip, RefPicker } from "../../src/frontend/build/form-kit";
import { FieldRow } from "../../src/frontend/gm/entity";
import { ActionRow } from "../../src/frontend/gm/ui";
import type { GmSectionProps, OrgTabDef, OrgTabProps } from "../../src/frontend/registry";
import { buildCatalog } from "../../src/frontend/ui-registry";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { decodeOrgList, decodeOrgPage } from "../../src/packs/orgs/ui/decode";
import { decodeGmOrgs, GmJobs, GmMembers, GmOrgFields, GmOrgHistory, GmOrgsList, GmOwners, gmPage, gmPageDefs, jobAddOps, jobEndOps, jobsOf, memberOps, memberRemoveOps, ownerOps, ownerRemoveOps, ownersOf, WhoMay, type GmOrgSheet, type GmOrgsListProps } from "../../src/packs/orgs/ui/gm";
import { OrgPage } from "../../src/packs/orgs/ui/org";
import type { OrgGmView } from "../../src/shared/org-view";
import type { EditOp } from "../../src/shared/protocol";
import type { GmView, StateView } from "../../src/shared/state-view";
import { DEFAULT_CURRENCY } from "../../src/shared/world";
import { startState } from "../packs/support";
import type { Props } from "../support/tree";

const reg = createRegistry(ALL_PACKS);
const SHOP = "alder_automotive_co";
const HOUSEHOLD = "household_kowalczyk";

/** Port Alder at chat start, as Jordan plays it, with the edits a test sends applied. */
function chat(): { w: Working; edit(ops: EditOp[]): void; gm(): GmView } {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  const w = new Working(reg, world, startState(world, reg));
  return {
    w,
    edit(ops) {
      const out = resolveEdit(reg, w.world, w.state, ops, { gm: true, runSeed: "orgs-gm" });
      if ("rejection" in out && out.rejection) throw new Error(`refused: ${out.rejection.reason}`);
      for (const e of "events" in out ? out.events : []) {
        const refused = w.apply(e);
        if (refused) throw new Error(`dropped: ${refused.reason}`);
      }
    },
    gm: () => ({ ...readPass(() => buildGmWorld(reg, w.world, w.state)), edits: [], refused: [], minds: {} as GmView["minds"] }),
  };
}

function entryOf(gm: GmView, id: string): OrgGmView {
  const entry = gm.orgs.find((o) => o.page.id === id);
  if (!entry) throw new Error(`no ${id} in GM → Orgs`);
  return entry;
}

/** A panel of Jordan's state view, in one read pass. */
function panel(w: Working, id: string): unknown {
  const view = reg.views.find((v) => v.panel === id);
  if (!view) throw new Error(`no panel ${id}`);
  return readPass(() => view.build(w.ctx, { mapDisplay: null }));
}

/** Every element anywhere in a tree, under its children and every prop that holds elements. */
function elements(node: unknown): VNode<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node) || !("type" in node)) return [];
  const v = node as VNode<Props>;
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

function rows(node: unknown): unknown[][] {
  return find(node, ListRow).map((p) => [p.title, p.subtitle, p.value]);
}

function click(tree: unknown, text: string): void {
  const found = find(tree, Button).filter((p) => textOf(p.children) === text);
  if (found.length !== 1) throw new Error(`${found.length} buttons say ${text}`);
  (found[0]?.onClick as () => void)();
}

/** The GM section's props over `gm`, keeping each edit it is asked to send. */
function sectionOf(gm: GmView): { section: GmSectionProps; sent: EditOp[][] } {
  const sent: EditOp[][] = [];
  const section: GmSectionProps = {
    chatId: "c",
    gm,
    currency: DEFAULT_CURRENCY,
    reloadKey: "",
    busy: false,
    edit: (ops) => {
      sent.push(ops);
      return Promise.resolve(true);
    },
    reload: () => Promise.resolve(),
    changed: () => Promise.resolve(),
    send: () => Promise.reject(new Error("no backend")),
  };
  return { section, sent };
}

function bodyOf(gm: GmView, id: string) {
  const { section, sent } = sectionOf(gm);
  const opened: GmOrgSheet[] = [];
  return { props: { entry: entryOf(gm, id), section, open: (s: GmOrgSheet) => opened.push(s) }, sent, opened };
}

const Stub = (props: OrgTabProps) => props.section as unknown as VNode;
const GmStub = () => null;
/** The economy's tabs as lane M registers them, Money with a GM component. */
const ECONOMY_TABS = buildCatalog([
  {
    id: "economy",
    register(r) {
      r.orgTab({ id: "economy.money", label: "Money", order: 40, section: "money", component: Stub, gm: GmStub });
      r.orgTab({ id: "economy.ownership", label: "Ownership", order: 60, section: "ownership", component: Stub });
      r.orgTab({ id: "economy.taxes", label: "Taxes", order: 70, section: "taxes", component: Stub });
      r.orgTab({ id: "economy.payroll", label: "Payroll", order: 30, section: "payroll", within: "people", component: Stub });
    },
  },
]).orgTabs as OrgTabDef[];

function pageTree(entry: OrgGmView, tab = "overview") {
  return OrgPage({ org: gmPage(entry.page), figure: null, defs: gmPageDefs(entry.page, ECONOMY_TABS), tab, panelId: "p", onTab: () => undefined, onBack: () => undefined, chatId: "c", state: {} as StateView, send: () => Promise.reject(new Error("no backend")), open: () => undefined });
}

describe("every organization", () => {
  const gm = chat().gm();

  test("the party first, then each in id order, as the GM sees it: every member named, every pack's section built", () => {
    expect(gm.orgs.map((o) => [o.page.id, o.page.type])).toEqual([
      ["party_pov", "party"],
      [SHOP, "company"],
      [HOUSEHOLD, "household"],
    ]);
    const shop = entryOf(gm, SHOP).page;
    expect(shop.people.map((p) => [p.name, p.title])).toEqual([
      ["Danny Okafor", "Mechanic"],
      ["Marcus Delgado", "Owner"],
      ["Jordan Ellis", "Mechanic"],
    ]);
    expect(shop.hidden.count).toBe(0);
    expect(Object.keys(shop.sections).sort()).toEqual(["money", "orgs.alerts", "orgs.coming", "orgs.plan", "ownership", "payroll", "premises", "taxes"]);
    // The GM is no reader: no place of theirs on any page.
    expect(gm.orgs.every((o) => !o.page.you.belongs && o.page.you.powers.length === 0)).toBe(true);
  });

  test("the GM view's organizations read back as they were built; one this build can't read is left out", () => {
    const raw = JSON.parse(JSON.stringify(gm.orgs)) as unknown[];
    expect(decodeGmOrgs([...raw, { page: 4 }, null])).toEqual(gm.orgs);
    expect(decodeGmOrgs(null)).toEqual([]);
  });

  function list(over: Partial<GmOrgsListProps> = {}) {
    const opened: string[] = [];
    const types: (string | null)[] = [];
    const props: GmOrgsListProps = { orgs: gm.orgs, query: "", type: null, person: null, onQuery: () => undefined, onType: (t) => types.push(t), onClearPerson: () => undefined, onOpen: (id) => opened.push(id), ...over };
    return { tree: GmOrgsList(props), opened, types };
  }

  test("grouped by type, the party first, each row opening its page", () => {
    const { tree, opened } = list();
    expect(find(tree, Section).map((p) => p.title)).toEqual(["Party (1)", "Households (1)", "Companies (1)"]);
    expect(rows(tree)).toEqual([
      ["Your party", "Party · 1 person", undefined],
      ["The Kowalczyks", "Household · 3 people", undefined],
      ["Alder Automotive", "Company · LLC · 3 people", undefined],
    ]);
    for (const row of find(tree, ListRow)) (row.onClick as () => void)();
    expect(opened).toEqual(["party_pov", HOUSEHOLD, SHOP]);
  });

  test("search, a type chip and a person's filter narrow it", () => {
    expect(rows(list({ query: "kowal" }).tree).map((r) => r[0])).toEqual(["The Kowalczyks"]);
    expect(rows(list({ query: "zzz" }).tree)).toEqual([]);
    expect(textOf(find(list({ query: "zzz" }).tree, Empty)[0]?.children)).toBe("No organization matches.");
    expect(rows(list({ type: "company" }).tree).map((r) => r[0])).toEqual(["Alder Automotive"]);
    expect(rows(list({ person: { id: "danny_okafor", name: "Danny Okafor" } }).tree).map((r) => r[0])).toEqual(["Alder Automotive"]);
    const { tree, types } = list({ type: "company" });
    const chips = find(tree, Chip);
    expect(chips.map((c) => textOf(c.children))).toEqual(["Party", "Households", "Companies"]);
    for (const chip of chips) (chip.onToggle as () => void)();
    // The pressed one lets go; another takes its place.
    expect(types).toEqual(["party", "household", null]);
  });
});

describe("an organization's page in GM", () => {
  const gm = chat().gm();

  test("the packs' tabs, then Rules, Who may…, History and Fields; People holds the GM's parts by type", () => {
    const shop = entryOf(gm, SHOP);
    expect(find(pageTree(shop), Tabs)[0]?.tabs).toEqual(["Overview", "People", "Money", "Ownership", "Taxes", "Rules", "Who may…", "History", "Fields"].map((label) => expect.objectContaining({ label })));
    const parts = (entry: OrgGmView) => elements(pageTree(entry, "people")).flatMap((v) => (typeof v.props["data-lre-org-part"] === "string" ? [v.props["data-lre-org-part"]] : []));
    expect(parts(shop)).toEqual(["orgs.gm_members", "orgs.gm_owners", "orgs.gm_jobs", "economy.payroll"]);
    expect(parts(entryOf(gm, HOUSEHOLD))).toEqual(["orgs.gm_members"]);
    expect(parts(entryOf(gm, "party_pov"))).toEqual([]);
  });

  test("a pack's tab with a GM component is drawn by it; one without, by its Play component", () => {
    const shop = entryOf(gm, SHOP).page;
    const drawn = gmPageDefs(shop, ECONOMY_TABS);
    expect(drawn.find((d) => d.id === "economy.money")?.component).not.toBe(Stub);
    expect(drawn.find((d) => d.id === "economy.taxes")?.component).toBe(Stub);
    // One wrapper per def: the tab keeps its state from one render to the next.
    expect(gmPageDefs(shop, ECONOMY_TABS).find((d) => d.id === "economy.money")?.component).toBe(drawn.find((d) => d.id === "economy.money")?.component);
  });

  test("Fields: every field it declares, each with ✎; the party before it has an entity has none", () => {
    const { section } = sectionOf(gm);
    const tree = GmOrgFields({ org: entryOf(gm, SHOP).page, section });
    expect(find(tree, FieldRow).length).toBe(gm.entities.find((e) => e.id === SHOP)?.fields.length ?? -1);
    expect(find(tree, FieldRow).map((p) => p.field)).toContainEqual(expect.objectContaining({ id: "owners" }));
    expect(textOf(find(GmOrgFields({ org: entryOf(gm, "party_pov").page, section }), Empty)[0]?.children)).toBe("It isn't in the world yet: its fields come with it.");
  });

  test("History: this chat's edits in force that name it, newest first", () => {
    const edits: GmView["edits"] = [
      { messageId: "m3", seq: 2, lines: ["Alder Automotive's owners: Marcus Delgado, Jordan Ellis"], undo: "chip" },
      { messageId: "m2", seq: 1, lines: ["Rosie Alvarez's mood: tense"], undo: null },
    ];
    const tree = GmOrgHistory({ org: entryOf(gm, SHOP).page, gm: { ...gm, edits } });
    expect(find(tree, ActionRow).map((p) => textOf(p.title))).toEqual(["Alder Automotive's owners: Marcus Delgado, Jordan Ellis"]);
    expect(textOf(find(GmOrgHistory({ org: entryOf(gm, HOUSEHOLD).page, gm: { ...gm, edits } }), Empty)[0]?.children)).toBe("No edits in force name it.");
  });
});

describe("Who may…", () => {
  const gm = chat().gm();
  const answer = (id: string, who: string, power: string) => WhoMay({ entry: entryOf(gm, id), gm, who, power, onWho: () => undefined, onPower: () => undefined });

  test("the chain of bases: Marcus as owner, Helen as the Kowalczyks' Head by her title, Jess by a member's default", () => {
    const steps = (tree: unknown) => find(tree, ActionRow).map((p) => textOf(p.title));
    expect(steps(answer(SHOP, "marcus_delgado", "staff.hire"))).toEqual(["Marcus Delgado is an owner of Alder Automotive", "An owner who manages it holds every power"]);
    expect(find(answer(SHOP, "marcus_delgado", "staff.hire"), Section)[0]?.title).toBe("Yes: Marcus Delgado may hire staff");
    expect(steps(answer(HOUSEHOLD, "helen_kowalczyk", "money.spend"))).toEqual(["Helen Kowalczyk holds Head at The Kowalczyks", "Head holds every power"]);
    expect(steps(answer(HOUSEHOLD, "jess_kowalczyk", "money.view"))).toEqual(["Jess Kowalczyk is a member of The Kowalczyks", "A household's members may see its money by default"]);
    expect(entryOf(gm, HOUSEHOLD).may.find((m) => m.who.id === "jess_kowalczyk")?.powers.map((p) => p.power)).toEqual(["money.view", "assets.use"]);
  });

  test("or the reason: Jordan, staff at the shop, holds none of its powers", () => {
    const tree = answer(SHOP, "pov", "staff.hire");
    expect(find(tree, Section)[0]?.title).toBe("No: Jordan Ellis may not hire staff");
    expect(textOf(tree)).toContain("No owner role, position, delegation or member's default at Alder Automotive gives them that.");
    expect(entryOf(gm, SHOP).may.map((m) => m.who.id)).toEqual(["marcus_delgado"]);
  });

  test("a power alone lists who holds it; a person alone, all they may do; pickers for both", () => {
    expect(find(answer(HOUSEHOLD, "", "money.view"), ActionRow).map((p) => textOf(p.title))).toEqual(["Helen Kowalczyk", "Jess Kowalczyk", "Maddie Kowalczyk"]);
    expect(find(answer(HOUSEHOLD, "jess_kowalczyk", ""), ActionRow).map((p) => textOf(p.title))).toEqual(["see its money", "use its things"]);
    const pickers = find(answer(SHOP, "", ""), RefPicker);
    expect(pickers.map((p) => p.label)).toEqual(["Person", "Power"]);
    expect(pickers[0]?.options).toContainEqual(expect.objectContaining({ value: "jess_kowalczyk" }));
    expect((pickers[1]?.options as unknown[]).length).toBe(21);
    expect(textOf(find(answer(SHOP, "", ""), Empty)[0]?.children)).toBe("Pick a person, a power, or both.");
  });
});

describe("Live 3: Alder Automotive → People, Jordan made a joint owner", () => {
  test("Owners lists Marcus and opens Add an owner; the save is one edit of its owners, Marcus kept", () => {
    const c = chat();
    const { props, opened } = bodyOf(c.gm(), SHOP);
    const tree = GmOwners(props);
    expect(rows(tree)).toEqual([["Marcus Delgado", "Owner", "100%"]]);
    click(tree, "Add an owner");
    (find(tree, ListRow)[0]?.onClick as () => void)();
    expect(opened).toEqual([
      { kind: "owner", party: null },
      { kind: "owner", party: "marcus_delgado" },
    ]);
    const owners = ownersOf(c.gm(), SHOP);
    const ops = ownerOps(SHOP, owners, { party: "pov", class: null }, "joint", 0);
    expect(ops).toEqual([{ op: "set", entity: SHOP, field: "owners", value: [...owners, { party: "pov", role: "joint", share: 0 }] }]);
    c.edit(ops);
    // Play → Orgs → Alder Automotive now has Money, Ownership and Taxes.
    const page = decodeOrgPage(panel(c.w, "orgs.org"), SHOP);
    expect(Object.keys(page?.sections ?? {})).toEqual(expect.arrayContaining(["money", "ownership", "taxes"]));
    const after = c.gm();
    expect(rows(GmOwners(bodyOf(after, SHOP).props))).toEqual([
      ["Marcus Delgado", "Owner", "100%"],
      ["Jordan Ellis", "Joint owner", "0%"],
    ]);
    expect(entryOf(after, SHOP).may.find((m) => m.who.id === "pov")?.powers.find((p) => p.power === "staff.hire")?.chain).toEqual(["Jordan Ellis is a joint owner of Alder Automotive", "An owner who manages it holds every power"]);
    // An owner's role and share change in place; No longer an owner takes them out.
    const two = ownersOf(after, SHOP);
    expect(ownerOps(SHOP, two, { party: "pov", class: null }, "joint", 50)[0]).toEqual({ op: "set", entity: SHOP, field: "owners", value: [two[0], { party: "pov", role: "joint", share: 50 }] });
    expect(ownerRemoveOps(SHOP, two, "pov")[0]).toEqual({ op: "set", entity: SHOP, field: "owners", value: [two[0]] });
  });
});

describe("an owner holding two classes", () => {
  test("Owners lists a row for each class, each opening that holding; a save rewrites that row alone, the other class kept", () => {
    const c = chat();
    c.edit([
      {
        op: "set",
        entity: SHOP,
        field: "owners",
        value: [
          { party: "marcus_delgado", role: "owner", share: 90, units: 900 },
          { party: "marcus_delgado", role: "owner", share: 10, units: 100, class: "preferred" },
        ],
      },
    ]);
    const { props, opened } = bodyOf(c.gm(), SHOP);
    const tree = GmOwners(props);
    expect(rows(tree)).toEqual([
      ["Marcus Delgado", "Owner", "90%"],
      ["Marcus Delgado", "Owner · preferred", "10%"],
    ]);
    for (const row of find(tree, ListRow)) (row.onClick as () => void)();
    expect(opened).toEqual([
      { kind: "owner", party: "marcus_delgado" },
      { kind: "owner", party: "marcus_delgado", class: "preferred" },
    ]);
    const held = ownersOf(c.gm(), SHOP);
    const ops = ownerOps(SHOP, held, { party: "marcus_delgado", class: "preferred" }, "owner", 12, { units: 120, class: "preferred" });
    expect(ops).toEqual([{ op: "set", entity: SHOP, field: "owners", value: [held[0], { party: "marcus_delgado", role: "owner", share: 12, units: 120, class: "preferred" }] }]);
    c.edit(ops);
    expect(ownersOf(c.gm(), SHOP)).toEqual([
      { party: "marcus_delgado", role: "owner", share: 90, units: 900 },
      { party: "marcus_delgado", role: "owner", share: 12, units: 120, class: "preferred" },
    ]);
    // The common holding saved: the preferred one stays as it is.
    expect(ownerOps(SHOP, ownersOf(c.gm(), SHOP), { party: "marcus_delgado", class: null }, "owner", 88)[0]).toEqual({
      op: "set",
      entity: SHOP,
      field: "owners",
      value: [
        { party: "marcus_delgado", role: "owner", share: 88, units: 900 },
        { party: "marcus_delgado", role: "owner", share: 12, units: 120, class: "preferred" },
      ],
    });
  });
});

describe("Live 4: the Kowalczyks → People, Add a member: Jordan", () => {
  test("Add a member is one member_of link; Jordan then belongs to the Kowalczyks in Play's Orgs", () => {
    const c = chat();
    const { props, opened } = bodyOf(c.gm(), HOUSEHOLD);
    const tree = GmMembers(props);
    expect(rows(tree).map((r) => r[0])).toEqual(["Helen Kowalczyk", "Jess Kowalczyk", "Maddie Kowalczyk"]);
    click(tree, "Add a member");
    expect(opened).toEqual([{ kind: "member", who: null }]);
    const ops = memberOps(HOUSEHOLD, "pov", { title: "", position: "", rank: "", since: "" });
    expect(ops).toEqual([{ op: "link", rel: "member_of", from: "pov", to: HOUSEHOLD }]);
    c.edit(ops);
    const home = decodeOrgList(panel(c.w, "orgs.list"));
    expect(home?.belong.map((r) => [r.id, r.type])).toContainEqual([HOUSEHOLD, "household"]);
    expect(home?.known.map((r) => r.id)).not.toContain(HOUSEHOLD);
    expect(rows(GmMembers(bodyOf(c.gm(), HOUSEHOLD).props)).map((r) => r[0])).toContain("Jordan Ellis");
  });

  test("a member's title, position, rank and since are their link's fields; Remove unlinks them", () => {
    const c = chat();
    const ops = memberOps(HOUSEHOLD, "pov", { title: "Lodger", position: "", rank: "2", since: "2026-01-12" });
    expect(ops).toEqual([{ op: "link", rel: "member_of", from: "pov", to: HOUSEHOLD, fields: { role: "Lodger", rank: 2, since: "2026-01-12" } }]);
    c.edit(ops);
    expect(rows(GmMembers(bodyOf(c.gm(), HOUSEHOLD).props)).find((r) => r[0] === "Jordan Ellis")?.[1]).toBe("Lodger · rank 2 · since 2026-01-12");
    expect(entryOf(c.gm(), HOUSEHOLD).page.people.find((p) => p.id === "pov")?.title).toBe("Lodger");
    c.edit(memberRemoveOps(HOUSEHOLD, "pov"));
    expect(entryOf(c.gm(), HOUSEHOLD).page.people.map((p) => p.id)).not.toContain("pov");
  });
});

describe("jobs at a company", () => {
  test("its jobs by worker, each opening its sheet; Add a job spawns one there, and End the job ends it", () => {
    const c = chat();
    const { props, opened } = bodyOf(c.gm(), SHOP);
    const tree = GmJobs(props);
    expect(rows(tree).map((r) => [r[0], r[1]])).toEqual([
      ["Danny Okafor", "Mechanic"],
      ["Jordan Ellis", "Mechanic"],
    ]);
    click(tree, "Add a job");
    (find(tree, ListRow)[0]?.onClick as () => void)();
    expect(opened[0]).toEqual({ kind: "job", id: null });
    expect(opened[1]).toMatchObject({ kind: "job" });
    const shop = entryOf(c.gm(), SHOP).page;
    const ops = jobAddOps(shop, "job_jess_mechanic", { worker: "jess_kowalczyk", title: "Apprentice", position: "", basis: "hourly", rate: 1800, every: "biweekly" });
    expect(ops[0]).toEqual({ op: "spawn", kind: "job", name: "Apprentice at Alder Automotive", id: "job_jess_mechanic" });
    c.edit(ops);
    const after = c.gm();
    expect(jobsOf(after, SHOP).map((j) => j.id)).toContain("job_jess_mechanic");
    expect(entryOf(after, SHOP).page.people.find((p) => p.id === "jess_kowalczyk")?.title).toBe("Apprentice");
    c.edit(jobEndOps("job_jess_mechanic"));
    expect(entryOf(c.gm(), SHOP).page.people.map((p) => p.id)).not.toContain("jess_kowalczyk");
    // An ended job is listed last, marked.
    expect(rows(GmJobs(bodyOf(c.gm(), SHOP).props)).at(-1)?.[0]).toBe("Jess Kowalczyk");
  });
});
