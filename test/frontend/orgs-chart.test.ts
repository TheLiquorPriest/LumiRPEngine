// The Org Chart (item 8; `packs/orgs/ui/chart-model.ts`), its trees built from what the orgs views
// read on Port Alder, with Alder Automotive's positions laid out by the test:
// - Reporting: three levels of `reports_to`; a position reporting to one it doesn't define is a root;
//   a loop is broken at the first position of it, marked; holders, those unknown and vacant seats
//   under each; staff, members, owners by role and delegations after;
// - past depth 4 a tree re-roots at a row ("Show from here"), with the path to it;
// - each row's menu by power: the founder (every power), an officer holding only `members.appoint`,
//   staff with none, and GM → Orgs' page (everything);
// - Ownership and control: the chain up to the ultimate parent, a holding with its stake and
//   Controlled, the reader's own row current, and those the reader doesn't know counted.

import { describe, expect, test } from "bun:test";
import { readPass } from "../../src/engine/read-pass";
import { createRegistry } from "../../src/engine/registry-impl";
import { Working } from "../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { CHART_DEPTH, controlChain, controlTree, defaultOpen, hasChart, reportingParents, reportingTree, rerooted, rowMenu, rowPress, treeRows, type ChartNode } from "../../src/packs/orgs/ui/chart-model";
import { decodeOrgPage } from "../../src/packs/orgs/ui/decode";
import { orgEditRoute } from "../../src/packs/orgs/ui/edit";
import { gmPage } from "../../src/packs/orgs/ui/gm";
import type { JsonValue } from "../../src/shared/json";
import type { OrgView } from "../../src/shared/org-view";
import type { WorldDoc } from "../../src/shared/world";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);
const SHOP = "alder_automotive_co";
const TOWING = "alder_towing_co";

/** Port Alder as `pov` sees it at chat start, with the world changes a test makes. */
function portAlder(pov: string, patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  world.pov = pov;
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

function pages(w: Working): JsonValue {
  const view = reg.views.find((v) => v.panel === "orgs.org");
  if (!view) throw new Error("no orgs.org panel");
  return readPass(() => view.build(w.ctx, { mapDisplay: null }));
}

function page(w: Working, org: string): OrgView {
  const view = decodeOrgPage(pages(w), org);
  if (!view) throw new Error(`no page for ${org}`);
  return view;
}

/** The shop's positions as the test lays them out: an owner's Manager over a Foreman over the Mechanics over an Apprentice over a Trainee, and Danny as Foreman, who may only appoint. */
function chain(world: WorldDoc): void {
  const shop = world.entities[SHOP];
  if (!shop) throw new Error("no shop");
  shop.fields.positions = [
    { id: "manager", title: "Manager", powers: ["org.govern", "members.appoint", "members.admit", "staff.hire"], seats: 1 },
    { id: "foreman", title: "Foreman", powers: ["members.appoint"], seats: 1, reports_to: "manager" },
    { id: "mechanic", title: "Mechanic", powers: [], seats: 0, reports_to: "foreman" },
    { id: "apprentice", title: "Apprentice", powers: [], seats: 2, reports_to: "mechanic" },
    { id: "trainee", title: "Trainee", powers: [], seats: 1, reports_to: "apprentice" },
  ];
  // Danny holds the Foreman's seat by his job there; Jordan stays a Mechanic.
  for (const e of Object.values(world.entities)) if (e.kind === "job" && e.fields.worker === "danny_okafor" && e.fields.employer === SHOP) e.fields.position = "foreman";
}

/** Every row of a tree, depth first. */
function all(nodes: readonly ChartNode[]): ChartNode[] {
  return nodes.flatMap((n) => [n, ...all(n.children)]);
}

function find(nodes: readonly ChartNode[], key: string): ChartNode {
  const n = all(nodes).find((x) => x.key === key);
  if (!n) throw new Error(`no row ${key}`);
  return n;
}

/** A row's menu ids, as its tree draws it at its depth. */
function menu(nodes: readonly ChartNode[], key: string): string[] {
  const row = treeRows(nodes, new Set(all(nodes).map((n) => n.key))).find((r) => r.node.key === key);
  if (!row) throw new Error(`row ${key} isn't drawn`);
  return rowMenu(row).map((a) => a.id);
}

describe("Reporting", () => {
  test("three levels of reports_to nest, with holders, the vacant seats and those under each", () => {
    const tree = reportingTree(page(portAlder("marcus_delgado", chain), SHOP));
    expect(tree.filter((n) => n.key.startsWith("p:")).map((n) => n.label)).toEqual(["Manager"]);
    const manager = find(tree, "p:manager");
    expect(manager.badges.map((b) => b.text)).toEqual(["Vacant"]);
    expect(manager.children.map((n) => n.key)).toEqual(["p:manager/vacant", "p:foreman"]);
    const foreman = find(tree, "p:foreman");
    expect([foreman.detail, foreman.children.map((n) => n.label)]).toEqual(["1 of 1", ["Danny Okafor", "Mechanic"]]);
    expect(find(tree, "p:foreman/h:danny_okafor").open).toEqual(orgEditRoute(SHOP, "member", "danny_okafor"));
    expect(find(tree, "p:mechanic").children.map((n) => n.label)).toEqual(["Jordan Ellis", "Apprentice"]);
    // The owner holds no position: he is under Owners, by role, with his share.
    expect(tree.filter((n) => n.key.startsWith("g:")).map((n) => [n.label, n.children.map((c) => [c.label, c.value])])).toEqual([["Owners", [["Marcus Delgado (you)", "100%"]]]]);
  });

  test("a position reporting to one it doesn't define is a root, and a loop is broken at its first position, marked", () => {
    const loop = portAlder("marcus_delgado", (world) => {
      chain(world);
      const shop = world.entities[SHOP];
      if (!shop || !Array.isArray(shop.fields.positions)) return;
      shop.fields.positions = [...shop.fields.positions, { id: "night", title: "Night shift", powers: [], seats: 1, reports_to: "ghost" }, { id: "a", title: "Desk A", powers: [], seats: 1, reports_to: "b" }, { id: "b", title: "Desk B", powers: [], seats: 1, reports_to: "a" }];
    });
    const org = page(loop, SHOP);
    const { parent, loops } = reportingParents(org.positions);
    expect([parent.get("night"), parent.get("a"), parent.get("b"), [...loops]]).toEqual([null, null, "a", ["a"]]);
    const tree = reportingTree(org);
    expect(tree.filter((n) => n.key.startsWith("p:")).map((n) => n.label)).toEqual(["Manager", "Night shift", "Desk A"]);
    expect(find(tree, "p:a").badges.map((b) => b.text)).toContain("Reports in a loop");
    expect(find(tree, "p:a").children.map((n) => n.key)).toEqual(["p:a/vacant", "p:b"]);
  });

  test("it opens two levels deep, draws four, and past four re-roots with the path to the row", () => {
    const tree = reportingTree(page(portAlder("marcus_delgado", chain), SHOP));
    expect(defaultOpen(tree)).toEqual(["p:manager", "g:owner:owner"]);
    const everything = new Set(all(tree).map((n) => n.key));
    const rows = treeRows(tree, everything);
    expect(Math.max(...rows.map((r) => r.depth))).toBe(CHART_DEPTH);
    // Manager 1, Foreman 2, Mechanic 3, Apprentice 4: its Trainee isn't drawn, and it re-roots instead.
    const apprentice = rows.find((r) => r.node.key === "p:apprentice");
    expect([apprentice?.depth, apprentice?.deep, apprentice?.open]).toEqual([4, true, false]);
    expect(rows.some((r) => r.node.key === "p:trainee")).toBe(false);
    if (!apprentice) throw new Error("no apprentice row");
    expect(rowMenu(apprentice).at(-1)).toEqual({ id: "reroot", label: "Show from here", icon: "branch", reroot: true });
    const from = rerooted(tree, "p:apprentice");
    expect(from.path.map((n) => n.label)).toEqual(["Manager", "Foreman", "Mechanic", "Apprentice"]);
    expect(treeRows(from.nodes, everything).map((r) => [r.node.label, r.depth])).toEqual([
      ["Apprentice", 1],
      ["2 vacant seats", 2],
      ["Trainee", 2],
      ["Vacant seat", 3],
    ]);
    // A row it no longer has puts the whole tree back.
    expect(rerooted(tree, "p:gone").nodes).toBe(tree);
  });
});

describe("menus by power", () => {
  test("the founder may add, edit, move and remove positions and fill their seats", () => {
    const tree = reportingTree(page(portAlder("marcus_delgado", chain), SHOP));
    expect(menu(tree, "p:manager")).toEqual(["edit", "under", "move", "remove", "appoint", "admit", "hire"]);
    expect(find(tree, "p:manager").actions.find((a) => a.id === "under")?.route).toEqual(orgEditRoute(SHOP, "under", "manager"));
    // A full position fills no seat; a vacant seat's row offers what fills it.
    expect(menu(tree, "p:foreman")).toEqual(["edit", "under", "move", "remove"]);
    expect(menu(tree, "p:manager/vacant")).toEqual(["appoint", "admit", "hire"]);
    expect(rowPress(treeRows(tree, new Set(["p:manager"])).find((r) => r.node.key === "p:manager/vacant") ?? (null as never))).toBe("menu");
  });

  test("an officer who may only appoint gets only Appoint; staff with no power get none; anyone opens a member", () => {
    const danny = reportingTree(page(portAlder("danny_okafor", chain), SHOP));
    expect(menu(danny, "p:manager")).toEqual(["appoint"]);
    expect(menu(danny, "p:manager/vacant")).toEqual(["appoint"]);
    const jordan = reportingTree(page(portAlder("pov", chain), SHOP));
    expect(menu(jordan, "p:manager")).toEqual([]);
    expect(menu(jordan, "p:manager/vacant")).toEqual([]);
    expect(menu(jordan, "p:foreman/h:danny_okafor")).toEqual(["open"]);
    const row = treeRows(jordan, new Set(all(jordan).map((n) => n.key))).find((r) => r.node.key === "p:foreman/h:danny_okafor");
    expect(row ? rowPress(row) : null).toBe("open");
  });

  test("GM → Orgs' page offers everything, as its parts do", () => {
    const tree = reportingTree(gmPage(page(portAlder("pov", chain), SHOP)));
    expect(menu(tree, "p:manager")).toEqual(["edit", "under", "move", "remove", "appoint", "admit", "hire"]);
    expect(menu(tree, "p:mechanic")).toEqual(["edit", "under", "move", "remove", "appoint", "admit", "hire"]);
  });
});

describe("Ownership and control", () => {
  /** Alder Towing, all of it held by the shop, and a trust the shop is trustee of for Marcus. */
  const group = (pov: string) =>
    portAlder(pov, (world) => {
      world.entities[TOWING] = { id: TOWING, kind: "business", name: "Alder Towing", tier: "background", fields: { owners: [{ party: SHOP, role: "owner", share: 100 }], structure: "llc" }, relations: [] };
      world.entities.alder_trust = { id: "alder_trust", kind: "trust", name: "Alder Trust", tier: "background", fields: { owners: [{ party: SHOP, role: "trustee" }, { party: "marcus_delgado", role: "beneficiary", share: 100 }] }, relations: [] };
    });

  test("the chain up to the ultimate parent, and what each holds under it, with its stake, Controlled and role", () => {
    const w = group("marcus_delgado");
    const all = pages(w);
    const pageOf = (id: string) => decodeOrgPage(all, id);
    const towing = page(w, TOWING);
    expect(hasChart(towing)).toBe(true);
    expect(controlChain(towing, pageOf).map((c) => c.id)).toEqual([SHOP, TOWING]);
    const tree = controlTree(towing, pageOf, SHOP, () => null);
    const top = tree[0];
    expect([top?.label, top?.current]).toEqual(["Alder Automotive", undefined]);
    const sub = find(tree, `o:${SHOP}/o:${TOWING}`);
    expect([sub.detail, sub.badges.map((b) => b.text), sub.current]).toEqual(["100%", ["Controlled"], true]);
    const trust = find(tree, `o:${SHOP}/o:alder_trust`);
    expect(trust.badges.map((b) => b.text)).toEqual(["Controlled", "Trustee"]);
    // Rooted at itself, only what it holds.
    expect(controlTree(towing, pageOf, TOWING, () => null).map((n) => [n.label, n.detail, n.children.length])).toEqual([["Alder Towing", "This organization", 0]]);
  });

  test("a holding the reader doesn't know is counted, never named", () => {
    const w = portAlder("pov", (world) => {
      world.entities[TOWING] = { id: TOWING, kind: "business", name: "Alder Towing", tier: "background", visibility: "secret", fields: { owners: [{ party: SHOP, role: "owner", share: 100 }] }, relations: [] };
    });
    const shop = page(w, SHOP);
    expect([shop.below.map((l) => l.id), shop.belowHidden]).toEqual([[], 1]);
    const tree = controlTree(shop, () => null, SHOP, () => null);
    expect(all(tree).map((n) => n.label)).toEqual(["Alder Automotive", "1 you don't know"]);
    expect(JSON.stringify(tree)).not.toContain("Towing");
  });
});
