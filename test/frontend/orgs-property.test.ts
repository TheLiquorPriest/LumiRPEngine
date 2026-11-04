// An organization's Property tab and GM → Places' entry (ORG-SPEC §3.9, §4.4, §6.1, §11 Phase 2
// Access, lane X) on Port Alder, their trees walked without a DOM:
// - Play: Alder Automotive's Property between People and Rules, its premises in words; Change entry
//   for Marcus (property.manage), not for Jordan; the form's request plays and the tab shows it;
// - GM → Orgs: the GM's form with the keys, one edit with its History line on the shop;
// - GM → Places (Live 4's route): Marcus's house, 12 Birch Lane, whose it is, set to owner only by
//   one edit; Jordan then has no leave there.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { resolveEdit } from "../../src/engine/edits";
import { withoutLeave } from "../../src/engine/entry";
import { buildGmWorld } from "../../src/engine/gm-view";
import { readPass } from "../../src/engine/read-pass";
import { createRegistry } from "../../src/engine/registry-impl";
import { resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import { Badge, Button, ListRow, Row } from "../../src/frontend/components";
import { GmPage } from "../../src/frontend/gm/ui";
import { PlaceEntryPage, PlacesList } from "../../src/frontend/gm/sections";
import { entryDraft, EntryForm, entryOps, PremiseRows, type EntryDraft } from "../../src/frontend/place-entry";
import type { OrgTabDef } from "../../src/frontend/registry";
import { buildCatalog } from "../../src/frontend/ui-registry";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { decodeOrgPage } from "../../src/packs/orgs/ui/decode";
import orgsUi from "../../src/packs/orgs/ui/index";
import { orgTabs } from "../../src/packs/orgs/ui/org";
import { decodePremises, orgEntryParams, Premises, type PremisesProps } from "../../src/packs/orgs/ui/property";
import type { PremisesView } from "../../src/shared/org-view";
import type { EditOp } from "../../src/shared/protocol";
import type { GmView } from "../../src/shared/state-view";
import type { WorldDoc } from "../../src/shared/world";
import { startState } from "../packs/support";
import type { Props } from "../support/tree";

const reg = createRegistry(ALL_PACKS);
const SHOP = "alder_automotive_co";
const SHOP_PLACE = "alder_automotive";
const HOUSE = "birch_lane_12";

function portAlder(pov: string, patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  world.pov = pov;
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

function premisesOf(w: Working): PremisesView {
  const view = reg.views.find((v) => v.panel === "orgs.org");
  if (!view) throw new Error("no orgs.org panel");
  const page = decodeOrgPage(readPass(() => view.build(w.ctx, { mapDisplay: null })), SHOP);
  const premises = decodePremises(page?.sections.premises);
  if (!premises) throw new Error("no premises");
  return premises;
}

function gmOf(w: Working): GmView {
  return { ...readPass(() => buildGmWorld(reg, w.world, w.state)), edits: [], refused: [], held: [], minds: {} as GmView["minds"] };
}

function edit(w: Working, ops: EditOp[]): void {
  const out = resolveEdit(reg, w.world, w.state, ops, { gm: true, runSeed: "orgs-property" });
  if ("rejection" in out && out.rejection) throw new Error(`refused: ${out.rejection.reason}`);
  for (const e of "events" in out ? out.events : []) {
    const refused = w.apply(e);
    if (refused) throw new Error(`dropped: ${refused.reason}`);
  }
}

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

const buttons = (tree: unknown): string[] => find(tree, Button).map((p) => textOf(p.children));
const rows = (tree: unknown): unknown[][] => find(tree, Row).map((p) => [p.k, p.v]);

function premisesTree(view: PremisesView, over: Partial<PremisesProps> = {}) {
  const drafts: (EntryDraft | null)[] = [];
  const tree = Premises({ view, draft: null, keys: false, busy: false, onDraft: (d) => drafts.push(d), onSave: () => undefined, ...over });
  return { tree, drafts };
}

describe("Play: Alder Automotive → Property", () => {
  test("its tab sits between People and Rules, shown while the page holds its premises", () => {
    const defs = buildCatalog([orgsUi]).orgTabs as OrgTabDef[];
    const view = reg.views.find((v) => v.panel === "orgs.org");
    const page = decodeOrgPage(readPass(() => view?.build(portAlder("pov").ctx, { mapDisplay: null })), SHOP);
    if (!page) throw new Error("no page");
    expect(orgTabs(page, defs).map((t) => t.label)).toEqual(["Overview", "People", "Chart", "Property", "Rules"]);
    expect(orgTabs({ ...page, sections: {} }, defs).map((t) => t.label)).toEqual(["Overview", "People", "Chart", "Rules"]);
  });

  test("the shop in words; Jordan, a mechanic, may not change its entry", () => {
    const view = premisesOf(portAlder("pov"));
    expect(view.canChange).toBe(false);
    const { tree } = premisesTree(view);
    expect(find(tree, PremiseRows).map((p) => p.place)).toEqual(view.places);
    const [first] = view.places;
    if (!first) throw new Error("no place");
    expect(rows(PremiseRows({ place: first }))).toEqual([
      ["Who may enter", "Customers while it trades; staff only after hours"],
      ["Now", "Staff only now"],
      ["Hours", "Mon to Sat, 9:00 AM to 5:00 PM"],
      ["Keys", "None"],
    ]);
    expect(buttons(tree)).toEqual([]);
  });

  test("Marcus changes it to staff only: the form, its request, and the tab after it plays", () => {
    const w = portAlder("marcus_delgado");
    const view = premisesOf(w);
    const place = view.places[0];
    if (!place) throw new Error("no place");
    const { tree, drafts } = premisesTree(view);
    const change = find(tree, Button).find((p) => textOf(p.children) === "Change entry");
    (change?.onClick as () => void)();
    expect(drafts).toEqual([{ place: SHOP_PLACE, entry: "default", keys: "" }]);
    // Open: the form, without the keys; Save only once it changes something.
    const open = premisesTree(view, { draft: drafts[0] ?? null }).tree;
    const [form] = find(open, EntryForm);
    expect(form?.keys).toBe(false);
    const unchanged = EntryForm({ place, draft: entryDraft(place), keys: false, busy: false, onDraft: () => undefined, onSave: () => undefined, onCancel: () => undefined });
    expect(find(unchanged, Button).map((p) => [textOf(p.children), p.disabled])).toEqual([
      ["Save", true],
      ["Cancel", false],
    ]);
    expect(find(unchanged, "option").map((p) => textOf(p.children))).toEqual(["As the world has it", "Owner only", "Members only", "Staff only", "Customers", "Anyone"]);
    expect(find(unchanged, "input")).toEqual([]);
    const params = orgEntryParams(SHOP, place, { ...entryDraft(place), entry: "staff" });
    expect(params).toEqual({ org: SHOP, place: SHOP_PLACE, entry: "staff" });
    expect(orgEntryParams(SHOP, place, entryDraft(place))).toBeNull();
    const done = resolveAction(reg, w, { action: "org_entry", actor: "marcus_delgado", params: params ?? {} }, createRng("t"));
    expect(done.ok).toBe(true);
    const after = premisesOf(w);
    expect(after.places.map((p) => [p.playEntry, p.words, p.now])).toEqual([["staff", "Staff only", "Staff only now"]]);
    expect(find(premisesTree(after).tree, Badge).map((p) => textOf(p.children))).toEqual(["Changed in play"]);
    // Opened again, the form starts from what play set.
    expect(entryDraft(after.places[0] ?? place).entry).toBe("staff");
  });

  test("a shape it isn't reads as none", () => {
    const view = premisesOf(portAlder("pov"));
    expect(decodePremises(JSON.parse(JSON.stringify(view)))).toEqual(view);
    expect(decodePremises(null)).toBeNull();
    expect(decodePremises({ places: [{ name: "no id" }, 3], canChange: "yes" })).toEqual({ places: [], canChange: false });
  });
});

describe("GM → Orgs → Alder Automotive → Property", () => {
  test("the GM's form has the keys, and its change is one edit with the shop's History line", () => {
    const w = portAlder("pov");
    const gm = gmOf(w);
    const page = gm.orgs.find((o) => o.page.id === SHOP)?.page;
    const view = decodePremises(page?.sections.premises);
    const place = view?.places[0];
    if (!view || !place) throw new Error("no premises");
    expect(view.canChange).toBe(true);
    const open = premisesTree(view, { keys: true, draft: entryDraft(place) }).tree;
    expect(find(open, EntryForm)[0]?.keys).toBe(true);
    const form = EntryForm({ place, draft: { ...entryDraft(place), keys: "shop_key" }, keys: true, busy: false, onDraft: () => undefined, onSave: () => undefined, onCancel: () => undefined });
    expect(find(form, "input").map((p) => p["aria-label"])).toEqual(["Keys to Alder Automotive"]);
    const ops = entryOps(place, { ...entryDraft(place), keys: "shop_key" }, SHOP);
    expect(ops).toEqual([{ op: "effect", effect: "orgs.entry", args: { place: SHOP_PLACE, keys: "shop_key", org: SHOP } }]);
    edit(w, ops);
    const after = decodePremises(gmOf(w).orgs.find((o) => o.page.id === SHOP)?.page.sections.premises);
    expect(after?.places.map((p) => [p.keysSet, p.keys, p.inPlay, p.playEntry])).toEqual([[["shop_key"], ["shop key"], true, null]]);
    // Cleared, the keys are none over the world's; default puts the world's back.
    const cleared = after?.places[0];
    if (!cleared) throw new Error("no place");
    expect(entryOps(cleared, { ...entryDraft(cleared), keys: "" })).toEqual([{ op: "effect", effect: "orgs.entry", args: { place: SHOP_PLACE, keys: "none" } }]);
    expect(entryOps(cleared, { ...entryDraft(cleared), keys: "default" })).toEqual([{ op: "effect", effect: "orgs.entry", args: { place: SHOP_PLACE, keys: "default" } }]);
  });
});

describe("GM → Places: Marcus's house (Live 4's route)", () => {
  test("12 Birch Lane opens whose it is; set to owner only by one edit, Jordan has no leave there", () => {
    const w = portAlder("pov", (world) => {
      const marcus = world.entities.marcus_delgado;
      if (marcus) marcus.fields.place = SHOP_PLACE;
    });
    const gm = gmOf(w);
    const opened: string[] = [];
    const list = PlacesList({ gm, onOpen: (id) => opened.push(id) });
    const row = find(list, ListRow).find((p) => p.title === "12 Birch Lane");
    expect([row?.subtitle, row?.chevron]).toEqual(["In Port Alder", true]);
    (row?.onClick as () => void)();
    expect(opened).toEqual([HOUSE]);
    const entry = gm.places.find((p) => p.id === HOUSE)?.entry;
    if (!entry) throw new Error("no entry for 12 Birch Lane");
    expect([entry.owners, entry.words, entry.inPlay]).toEqual([["Marcus Delgado"], "Anyone", false]);
    const draft: EntryDraft = { ...entryDraft(entry), entry: "owner" };
    const page = PlaceEntryPage({ name: "12 Birch Lane", entry, draft, busy: false, onDraft: () => undefined, onSave: () => undefined, onBack: () => undefined });
    expect(find(page, GmPage).map((p) => [p.title, p.subtitle])).toEqual([["12 Birch Lane", "Marcus Delgado's"]]);
    expect(find(page, EntryForm).map((p) => p.keys)).toEqual([true]);
    expect(withoutLeave(w.ctx, "pov", HOUSE)).toBe(false);
    const ops = entryOps(entry, draft);
    expect(ops).toEqual([{ op: "effect", effect: "orgs.entry", args: { place: HOUSE, entry: "owner" } }]);
    edit(w, ops);
    const after = gmOf(w);
    const set = after.places.find((p) => p.id === HOUSE)?.entry;
    expect([set?.entry, set?.playEntry, set?.words, set?.inPlay]).toEqual(["owner", "owner", "Owner only", true]);
    expect(find(PlacesList({ gm: after, onOpen: () => undefined }), ListRow).find((p) => p.title === "12 Birch Lane")?.subtitle).toBe("In Port Alder · Owner only");
    expect(withoutLeave(w.ctx, "pov", HOUSE)).toBe(true);
  });
});
