// Build → Things (ITEMS-SPEC §10.1, lane F) on Port Alder: the read `lre.things` answers (every thing
// with its size, where and whose; by owner; a thing's page; a person's groups; search through the
// resolver; the catalog's types), the draft changes the pages make (Add a thing's four fields, Move,
// Give, Lend, Remove), Problems' too-big-to-carry fix, and the pages' rows, trees and sections walked
// as rendered trees (no DOM), as the other pages' tests do.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { lintWorld, migrateWorld } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { buildContext, findThingIds, personThings, thingPage, thingsList, thingTypes } from "../../src/engine/thing-view";
import { IssueLine } from "../../src/frontend/build/check";
import { WorldContent } from "../../src/frontend/build/build";
import { OwnerList, PersonGroups, PlaceTree, SizeChoices, ThingChips, ThingRowView, TreeRows, UseSection, searchTypes, whereWords } from "../../src/frontend/build/things";
import { entityGroups, giveOps, lendOps, moveOps, newThing, ownerCounts, placeSections, removeOps } from "../../src/frontend/build/things-model";
import { Button, IconButton, ListRow } from "../../src/frontend/components";
import { cannotHold, searchWhere, whereIndex, whereLabel } from "../../src/frontend/things/where";
import type { JsonObject } from "../../src/shared/json";
import { applyPatch } from "../../src/shared/json-patch";
import type { LintIssue } from "../../src/shared/protocol";
import type { ThingRow } from "../../src/shared/thing-view";
import { presumedLine, whoseWords } from "../../src/shared/thing-view";
import type { WorldDoc } from "../../src/shared/world";
import { ALL_PACKS } from "../../src/packs/index";
import { Rig } from "../support/rig";
import { propsOf, type Props } from "../support/tree";

const reg = createRegistry(ALL_PACKS);
const portAlder = migrateWorld(await Bun.file(new URL("../../src/packs/starters/modern_slice_of_life.json", import.meta.url)).json());

function ctxOf(world: WorldDoc = portAlder) {
  const ctx = buildContext(reg, world);
  if (!ctx) throw new Error("the world can't start a chat");
  return ctx;
}

/** The words a rendered tree shows, in order. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

const patched = (doc: WorldDoc, ops: Parameters<typeof applyPatch>[1]): WorldDoc => applyPatch(structuredClone(doc) as unknown as JsonObject, ops) as unknown as WorldDoc;

describe("the Things read", () => {
  test("every thing with its size, where it is and whose; by owner, the player character first", () => {
    const list = thingsList(ctxOf());
    const card = list.rows.find((r) => r.id === "pov_credit_card");
    expect(card?.size).toBe("pocket");
    expect(card?.where.map((s) => s.name)).toEqual(["Lakeshore County", "Port Alder", "114 Harbor Street", "Jordan Ellis", "Wallet"]);
    expect(card ? whoseWords(card.whose) : "").toBe("Jordan Ellis's");
    expect(card?.with).toBe("pov");
    expect(list.rows.find((r) => r.id === "relay_fuel_pump")?.size).toBe("builtin");
    expect(list.owners[0]?.owner?.id).toBe("pov");
    expect(list.owners[0] ? ownerCounts(list.owners[0]) : "").toBe("On them 8 · At home 5 · Elsewhere 5");
    // Nobody's presumed at a place: the property's owner at 114 Harbor Street, the business at the shop.
    const home = list.pick.where.find((c) => c.id === "harbor_street_114");
    expect(home ? presumedLine(home.presumes) : "").toBe("Presumed Helen Kowalczyk's, who own the property at 114 Harbor Street.");
    expect(list.pick.where.find((c) => c.id === "alder_automotive")?.presumes.owners.map((o) => o.id)).toEqual(["alder_automotive_co"]);
    expect(list.pick.parties[0]?.id).toBe("pov");
    expect(list.pick.parties.some((p) => p.is === "household")).toBe(true);
  });

  test("a thing's page: kept at, who may use it, what it holds; a person's groups; search through the resolver; types sized", () => {
    const ctx = ctxOf();
    const truck = thingPage(ctx, "pov_truck");
    expect(truck?.kept).toMatchObject({ set: true, owner: false });
    expect(truck?.kept.where.at(-1)?.name).toBe("114 Harbor Street");
    expect(truck?.use.map((c) => c.label)).toEqual(["Jordan Ellis · owner"]);
    expect(truck?.contents.map((c) => c.name)).toEqual(["Truck bed", "Truck glovebox"]);
    expect(thingPage(ctx, "pov")).toBeNull();
    const mine = personThings(ctx, "pov");
    expect(mine?.on.map((r) => r.id)).toContain("pov_keys");
    expect(mine?.home.map((r) => r.id)).toContain("pov_truck");
    expect(mine?.away.map((r) => r.id)).toContain("pov_toolbox");
    expect(personThings(ctx, "pov_truck")).toBeNull();
    expect(findThingIds(ctx, "Marcus's key")).toEqual(["shop_office_key"]);
    expect(findThingIds(ctx, "the keys")[0]).toBe("pov_keys");
    expect(findThingIds(ctx, "wal")).toEqual(["pov_wallet"]);
    const fridge = thingTypes(ctx).find((t) => t.id === "refrigerator");
    expect(fridge).toMatchObject({ table: "economy.catalog", size: "furniture" });
  });

  test("the backend answers lre.things from the draft, and refuses what isn't a thing", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const list = rig.body(await rig.send({ type: "lre.things", scope: "build", worldId, op: "list" })).list as { rows: ThingRow[] };
    expect(list.rows.some((r) => r.id === "pov_wallet")).toBe(true);
    expect((rig.body(await rig.send({ type: "lre.things", scope: "build", worldId, op: "find", words: "pontoon keys" })).found as string[])[0]).toBe("pontoon_keys");
    const missing = await rig.send({ type: "lre.things", scope: "build", worldId, op: "thing", entity: "pov" });
    expect(missing.type).toBe("lre.error");
  });
});

describe("Problems: too big to carry, with a fix", () => {
  test("a fridge on Jordan is a warning whose fix puts it at his home, and it lints clean after", () => {
    const world = structuredClone(portAlder);
    world.entities.fridge = { id: "fridge", kind: "item", name: "Refrigerator", tier: "background", fields: { catalog: "refrigerator" }, relations: [{ type: "in", to: "pov" }] };
    const issue = lintWorld(world, reg).find((i) => i.code === "gear.too_big" && i.path === "entities.fridge");
    expect(issue?.message).toBe("Refrigerator is on Jordan Ellis: too big to carry (Furniture; a person carries up to Armful). Put it at 114 Harbor Street?");
    expect(issue?.fix?.label).toBe("Put it at 114 Harbor Street");
    const fixed = patched(world, issue?.fix?.ops ?? []);
    expect(fixed.entities.fridge?.fields.place).toBe("harbor_street_114");
    expect(fixed.entities.fridge?.relations).toEqual([]);
    expect(lintWorld(fixed, reg).filter((i) => i.path === "entities.fridge")).toEqual([]);
    // The installed relay is part of the truck, never too big for it; an unsized authored thing is a note.
    expect(lintWorld(portAlder, reg).filter((i) => i.code === "gear.too_big")).toEqual([]);
    expect(lintWorld(portAlder, reg).find((i) => i.code === "gear.size_unknown" && i.path === "entities.spare_relay.fields.size")?.severity).toBe("info");
  });

  test("Problems' row offers Fix with the fix's words, and pressing it hands the fix on", () => {
    const issue: LintIssue = { severity: "warning", code: "gear.too_big", path: "entities.fridge", message: "Refrigerator is on Jordan Ellis: too big to carry.", fix: { label: "Put it at 114 Harbor Street", ops: [] } };
    let fixed: unknown = null;
    const row = IssueLine({ issue, where: "Entities › Refrigerator", onOpen: () => undefined, onFix: (f) => (fixed = f) });
    const fix = propsOf(row, Button).find((p) => p.label === "Put it at 114 Harbor Street");
    expect(textOf(fix?.children)).toBe("Fix");
    (fix?.onClick as () => void)();
    expect(fixed).toBe(issue.fix);
    expect(propsOf(IssueLine({ issue, where: "x" }), Button)).toEqual([]);
  });
});

describe("the draft changes the Things pages make", () => {
  test("Add a thing: four fields make a thing of its type, where it is and whose; a size for something else", () => {
    const ctx = ctxOf();
    const type = thingTypes(ctx).find((t) => t.id === "toolbox_20in");
    const row = type ? portAlder.tables[type.table]?.rows[type.id] : undefined;
    if (!type || !row) throw new Error("no toolbox type");
    const made = newThing(portAlder, { name: "Spare toolbox", type: { type, row }, size: null, where: { place: "alder_automotive" }, owner: "alder_automotive_co", kept: null });
    expect(made.id).toBe("spare_toolbox");
    expect(made.value).toMatchObject({ kind: "container", name: "Spare toolbox", fields: { catalog: "toolbox_20in", place: "alder_automotive", owner: "alder_automotive_co" }, relations: [] });
    const world = patched(portAlder, [{ op: "add", path: `/entities/${made.id}`, value: made.value }]);
    expect(lintWorld(world, reg).filter((i) => i.path.startsWith("entities.spare_toolbox") && i.severity !== "info")).toEqual([]);
    expect(thingsList(ctxOf(world)).rows.find((r) => r.id === "spare_toolbox")?.size).toBe("armful");
    const crate = newThing(portAlder, { name: "Crate", type: null, size: "heavy", where: { in: "pov_truck_bed" }, owner: null, kept: "owner" });
    expect(crate.value).toMatchObject({ kind: "item", fields: { size: "heavy", home: "owner" }, relations: [{ type: "in", to: "pov_truck_bed" }] });
  });

  test("Move, Give, Lend and Remove each change only what they say", () => {
    const moved = patched(portAlder, moveOps(portAlder, "pov_keys", { place: "harbor_street_114" }));
    expect(moved.entities.pov_keys?.fields.place).toBe("harbor_street_114");
    expect(moved.entities.pov_keys?.relations).toEqual([]);
    const given = patched(portAlder, giveOps(portAlder, "pov_pocketknife", "danny_okafor", true));
    expect(given.entities.pov_pocketknife?.fields.owner).toBe("danny_okafor");
    expect(given.entities.pov_pocketknife?.relations).toEqual([{ type: "in", to: "danny_okafor" }]);
    const lent = patched(portAlder, lendOps(portAlder, "pov_phone", "danny_okafor", true));
    expect(lent.entities.pov_phone?.fields.owner).toBe("pov");
    expect(lent.entities.danny_okafor?.relations.filter((r) => r.type === "uses")).toEqual([{ type: "uses", to: "pov_phone", fields: { basis: "loan" } }]);
    const gone = patched(portAlder, removeOps(portAlder, "pov_wallet"));
    expect(gone.entities.pov_wallet).toBeUndefined();
    for (const id of ["pov_id", "pov_debit_card", "pov_credit_card"]) expect(gone.entities[id]?.relations).toEqual([{ type: "in", to: "pov" }]);
  });

  test("the where picker: holders say whose they are and where; what can't take a thing says why", () => {
    const pick = thingsList(ctxOf()).pick;
    const wallet = pick.where.find((c) => c.id === "pov_wallet");
    const jordan = pick.where.find((c) => c.id === "pov");
    if (!wallet || !jordan) throw new Error("no choices");
    expect(whereLabel(wallet)).toBe("Wallet (Jordan Ellis's, on Jordan Ellis)");
    expect(cannotHold(jordan, "furniture")).toBe("Too big to carry: a person carries up to Armful");
    expect(cannotHold(wallet, "hand")).toBe("Takes things up to Pocket");
    expect(cannotHold(jordan, "pocket")).toBeNull();
    expect(searchWhere(whereIndex(pick.where), "harbor")[0]?.id).toBe("harbor_street_114");
  });
});

describe("the pages, rendered", () => {
  const list = thingsList(ctxOf());
  const rows = new Map(list.rows.map((r) => [r.id, r]));
  const wallet = rows.get("pov_wallet");
  if (!wallet) throw new Error("no wallet");

  test("a row: its name with what it holds, its chips (Built-in its size), Worn, Hidden until searched and a problem", () => {
    const row = ThingRowView({ row: wallet, onOpen: () => undefined });
    expect(textOf(row)).toContain("Wallet (3)");
    expect(textOf(ThingChips({ row: wallet }))).toBe("PocketJordan Ellis'sWorn");
    const relay = rows.get("relay_fuel_pump");
    if (!relay) throw new Error("no relay");
    expect(textOf(ThingChips({ row: { ...relay, hidden: true }, problem: "warning" }))).toBe("Built-inAlder Township Hall's (presumed)Hidden until searchedA problem");
    expect(whereWords(wallet)).toBe("On Jordan Ellis (at 114 Harbor Street)");
  });

  test("By place: each place headed by its path, what people carry under them, a holder's contents when opened", () => {
    const sections = placeSections(list.rows);
    const home = sections.find((s) => s.path.at(-1)?.id === "harbor_street_114");
    if (!home) throw new Error("no section");
    const tree = PlaceTree({ sections: [home], open: new Set(), problems: new Map(), onToggle: () => undefined, onOpen: () => undefined });
    expect(textOf(tree)).toContain("114 Harbor Street");
    const rendered = TreeRows({ nodes: home.nodes, depth: 0, open: new Set(["pov_wallet"]), problems: new Map(), onToggle: () => undefined, onOpen: () => undefined });
    expect(textOf(rendered)).toContain("On Jordan Ellis");
    // The wallet's cards show under it once it is open; the truck's parts stay folded.
    const nested = propsOf(rendered, TreeRows).map((p) => p.nodes as unknown[]);
    expect(nested.length).toBeGreaterThan(0);
    const place = placeSections(list.rows, { within: "harbor_street_114", people: false });
    expect(place.flatMap((s) => s.nodes).some((n) => "holder" in n)).toBe(false);
  });

  test("By owner: each owner's counts and Open; their things in buckets once opened", () => {
    let party = "";
    const tree = OwnerList({ groups: list.owners, rows, open: new Set(["pov"]), problems: new Map(), onToggle: () => undefined, onOpen: () => undefined, onParty: (p) => (party = p.id) });
    expect(textOf(tree)).toContain("On them 8 · At home 5 · Elsewhere 5");
    const shown = propsOf(tree, ThingRowView).map((p) => (p.row as ThingRow).id);
    expect(shown).toContain("pov_keys");
    expect(shown).not.toContain("shop_office_key");
    (propsOf(tree, Button).find((p) => p.label === "Open Jordan Ellis's page")?.onClick as () => void)();
    expect(party).toBe("pov");
  });

  test("Who may use it: grounds as chips, grants as rows with ×, unsaved grants marked", () => {
    let dropped = "";
    const section = UseSection({ chips: [{ basis: "member", label: "The Kowalczyks · members", who: ["Maddie Kowalczyk"] }], grants: [{ who: { id: "danny_okafor", name: "Danny Okafor", is: "person" }, basis: "assign", until: "Friday 6 November 2026, 18:00" }], added: [{ who: { id: "sam_reyes", name: "Sam Reyes", is: "person" }, basis: "assign" }], dropped: new Set(), people: [], adding: "", onAdding: () => undefined, onAdd: () => undefined, onDrop: (who) => (dropped = who) });
    const text = textOf(section);
    expect(text).toContain("The Kowalczyks · members");
    expect(text).toContain("may use it · until Friday 6 November 2026, 18:00");
    expect(text).toContain("not saved yet");
    (propsOf(section, IconButton).find((p) => p.label === "Stop Danny Okafor using it")?.onClick as () => void)();
    expect(dropped).toBe("danny_okafor");
  });

  test("a person's things in the Character page's groups, each with Move, Give, Lend and Remove", () => {
    const groups = personThings(ctxOf(), "pov");
    if (!groups) throw new Error("no groups");
    const tree = PersonGroups({ person: "pov", groups, problems: new Map(), menu: () => [{ label: "Move…", onSelect: () => undefined }, { label: "Give…", onSelect: () => undefined }, { label: "Lend…", onSelect: () => undefined }, { label: "Remove", onSelect: () => undefined }], onOpen: () => undefined });
    expect(textOf(tree)).toContain("On them");
    expect(textOf(tree)).toContain("At home");
    const keys = propsOf(tree, ThingRowView).find((p) => (p.row as ThingRow).id === "pov_keys");
    expect(keys?.sub).toBe("Worn · pocket");
    expect((keys?.menu as { label: string }[]).map((m) => m.label)).toEqual(["Move…", "Give…", "Lend…", "Remove"]);
  });

  test("the world home lists People, Organizations, Things and Money, and every entity under Advanced", () => {
    let went: unknown = null;
    const content = WorldContent({ doc: portAlder, packKinds: Object.fromEntries(reg.kinds), lint: [], worldId: "w", onGo: (r) => (went = r) });
    const rowsShown = propsOf(content, ListRow);
    const titles = rowsShown.map((p) => p.title);
    expect(titles.slice(0, 7)).toEqual(["People", "Organizations", "Things", "Money", "Kinds", "Classifications", "Relations"]);
    expect(titles).toContain("All entities");
    const lists = entityGroups({ ...portAlder, kinds: { ...Object.fromEntries(reg.kinds), ...portAlder.kinds } });
    expect(rowsShown.find((p) => p.title === "Things")?.value).toBe(lists.things.length);
    expect(lists.things.length).toBe(28);
    expect(lists.orgs).toEqual(["alder_automotive_co", "household_kowalczyk"]);
    expect(lists.money).not.toContain("alder_automotive_co");
    (rowsShown.find((p) => p.title === "Things")?.onClick as () => void)();
    expect(went).toEqual({ view: "entities", worldId: "w", group: "things" });
  });

  test("Add a thing's catalog search and sizes in words", () => {
    const types = thingTypes(ctxOf());
    expect(searchTypes(types, "fridge").length + searchTypes(types, "refrig").length).toBeGreaterThan(0);
    expect(searchTypes(types, "refrig")[0]?.name).toMatch(/^Refrigerator/);
    const sizes = SizeChoices({ value: "hand", onPick: () => undefined });
    expect(propsOf(sizes, "button").map((p) => p["data-lre-size-choice"])).toEqual(["pocket", "hand", "armful", "heavy", "furniture", "builtin"]);
    expect(propsOf(sizes, "button").find((p) => p["aria-checked"] === true)?.["data-lre-size-choice"]).toBe("hand");
  });
});
