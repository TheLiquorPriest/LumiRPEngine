// An organization's page in Play (ORG-SPEC §4.3, §4.4, §11 Phase 2, lane P), its trees walked without
// a DOM from what the orgs views read on Port Alder:
// - the header's overflow: Rename only where the reader holds `org.govern` and it is in the world,
//   Leave only where they belong by a link of their own (never on the party, an owner sells, staff
//   quit), Open in GM always; each item does what it says, and the page draws it as its overflow;
// - the Overview's History: the latest five lines, newest first, with when and who, and More with
//   how many more, which shows them all.

import { describe, expect, test } from "bun:test";
import { h, type VNode } from "preact";
import { readPass } from "../../src/engine/read-pass";
import { createRegistry } from "../../src/engine/registry-impl";
import { resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import { OverflowMenu, type MenuItem } from "../../src/frontend/build/chrome";
import { Button, ListRow, PageHeader } from "../../src/frontend/components";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { decodeOrgPage } from "../../src/packs/orgs/ui/decode";
import { OrgPage, orgMenu, type OrgMenuActions } from "../../src/packs/orgs/ui/org";
import { HISTORY_SHOWN, OrgHistory, OrgHistoryList, OrgOverview } from "../../src/packs/orgs/ui/overview";
import { ORG_ACTIONS } from "../../src/shared/org";
import type { OrgView } from "../../src/shared/org-view";
import type { StateView } from "../../src/shared/state-view";
import type { WorldDoc } from "../../src/shared/world";
import { startState } from "../packs/support";
import type { Props } from "../support/tree";

const reg = createRegistry(ALL_PACKS);
const SHOP = "alder_automotive_co";
const HOUSEHOLD = "household_kowalczyk";
const PARTY = "party_pov";

/** Port Alder as `pov` sees it at chat start, with the world changes a test makes. */
function portAlder(pov: string, patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  world.pov = pov;
  patch(world);
  return new Working(reg, world, startState(world, reg));
}

/** An organization's page as the `orgs.org` view builds it for the POV, in one read pass. */
function page(w: Working, org: string): OrgView {
  const view = reg.views.find((v) => v.panel === "orgs.org");
  if (!view) throw new Error("no orgs.org panel");
  const decoded = decodeOrgPage(readPass(() => view.build(w.ctx, { mapDisplay: null })), org);
  if (!decoded) throw new Error(`no page for ${org}`);
  return decoded;
}

/** The overflow's items for a page, and what pressing each did. */
function menuOf(org: OrgView): { items: MenuItem[]; pressed: string[] } {
  const pressed: string[] = [];
  const actions: OrgMenuActions = { rename: () => pressed.push("rename"), leave: () => pressed.push("leave"), openInGm: () => pressed.push("gm") };
  return { items: orgMenu(org, actions), pressed };
}

const labels = (org: OrgView): string[] => menuOf(org).items.map((i) => i.label);

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

/** The words under an element's children, in order. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

describe("the header's overflow", () => {
  test("Jordan's Alder Automotive, where he is staff with no powers: only Open in GM (staff quit their job)", () => {
    const org = page(portAlder("pov"), SHOP);
    expect(org.people.find((p) => p.you)?.hows).not.toContain("member");
    expect(labels(org)).toEqual(["Open in GM"]);
  });

  test("Marcus's, which he owns: Rename, as he governs it, but no Leave (an owner sells)", () => {
    const org = page(portAlder("marcus_delgado"), SHOP);
    expect(org.you.powers.some((p) => p.power === "org.govern")).toBe(true);
    expect(org.people.find((p) => p.you)?.hows).not.toContain("member");
    const { items, pressed } = menuOf(org);
    expect(items.map((i) => [i.label, i.danger === true])).toEqual([
      ["Rename", false],
      ["Open in GM", false],
    ]);
    for (const item of items) item.onSelect();
    expect(pressed).toEqual(["rename", "gm"]);
  });

  test("Helen's household, which she heads and belongs to by her own link: Rename, Leave (in the danger colour) and Open in GM, each doing its own", () => {
    const org = page(portAlder("helen_kowalczyk"), HOUSEHOLD);
    expect(org.people.find((p) => p.you)?.hows).toContain("member");
    const { items, pressed } = menuOf(org);
    expect(items.map((i) => [i.label, i.danger === true])).toEqual([
      ["Rename", false],
      ["Leave", true],
      ["Open in GM", false],
    ]);
    for (const item of items) item.onSelect();
    expect(pressed).toEqual(["rename", "leave", "gm"]);
  });

  test("Leave is for a member by a link of their own: without org.govern, a member has Leave but no Rename", () => {
    const helen = page(portAlder("helen_kowalczyk"), HOUSEHOLD);
    expect(labels({ ...helen, you: { ...helen.you, powers: helen.you.powers.filter((p) => p.power !== "org.govern") } })).toEqual(["Leave", "Open in GM"]);
    // Someone else's link never offers it.
    expect(labels({ ...helen, people: helen.people.map((p) => ({ ...p, you: false })) })).toEqual(["Rename", "Open in GM"]);
  });

  test("the party: no Rename before it has an entity, though its leader governs it; once it has one, Rename; never Leave", () => {
    const party = page(portAlder("pov"), PARTY);
    expect(party.type).toBe("party");
    expect(party.exists).toBe(false);
    expect(party.you.powers.some((p) => p.power === "org.govern")).toBe(true);
    expect(labels(party)).toEqual(["Open in GM"]);
    const named = { ...party, exists: true };
    expect(labels(named)).toEqual(["Rename", "Open in GM"]);
    // Even a member by a link of their own leaves the party from its own page's controls, not here.
    expect(labels({ ...named, people: named.people.map((p) => (p.you ? { ...p, hows: [...p.hows, "member" as const] } : p)) })).toEqual(["Rename", "Open in GM"]);
  });

  test("the page draws the overflow it is given in its header, and none without one (GM → Orgs)", () => {
    const org = page(portAlder("marcus_delgado"), SHOP);
    const props = { org, figure: null, defs: [], tab: "overview", panelId: "p", onTab: () => undefined, onBack: () => undefined, chatId: "c", state: {} as StateView, send: () => Promise.reject(new Error("no backend")), open: () => undefined };
    const { items } = menuOf(org);
    const header = find(OrgPage({ ...props, menu: items }), PageHeader)[0];
    const overflow = find(header?.actions, OverflowMenu);
    expect(overflow.map((m) => [m.label, (m.items as MenuItem[]).map((i) => i.label)])).toEqual([["Alder Automotive: more", ["Rename", "Open in GM"]]]);
    expect(find(OrgPage(props), OverflowMenu)).toEqual([]);
    // Rename's form, while it is open, sits under the header.
    const form = h("span", { "data-form": "rename" });
    expect(elements(OrgPage({ ...props, menu: items, above: form })).some((v) => v.props["data-form"] === "rename")).toBe(true);
  });
});

describe("the Overview's History", () => {
  /** Marcus renames the shop `n` times, each a line of its History. */
  function renamed(n: number): OrgView {
    const w = portAlder("marcus_delgado");
    for (let i = 1; i <= n; i += 1) {
      const r = resolveAction(reg, w, { action: ORG_ACTIONS.rename, params: { org: SHOP, name: `Alder Automotive ${i}` } }, createRng(`rename:${i}`));
      expect(r.rejected).toEqual([]);
    }
    return page(w, SHOP);
  }

  test("the Overview draws its History from the page, and none while it has no line", () => {
    const org = renamed(7);
    expect(org.history).toHaveLength(7);
    const overview = OrgOverview({ org, figure: null, open: () => undefined });
    expect(find(overview, OrgHistory).map((p) => p.lines)).toEqual([org.history]);
    expect(find(OrgOverview({ org: { ...org, history: [] }, figure: null, open: () => undefined }), OrgHistory)).toEqual([]);
  });

  test("the latest five lines, newest first, each with when and who; More (2) shows them all", () => {
    const org = renamed(7);
    const newest = org.history[0];
    expect(newest?.text).toContain("Alder Automotive 7");
    expect(newest?.by?.name).toBe("Marcus Delgado");
    let more = 0;
    const first = OrgHistoryList({ lines: org.history, all: false, onMore: () => (more += 1) });
    expect(find(first, ListRow).map((p) => [p.title, p.subtitle])).toEqual(org.history.slice(0, HISTORY_SHOWN).map((l) => [l.text, `${l.at} · Marcus Delgado`]));
    const button = find(first, Button);
    expect(button.map((b) => textOf(b.children))).toEqual(["More (2)"]);
    (button[0]?.onClick as () => void)();
    expect(more).toBe(1);
    const all = OrgHistoryList({ lines: org.history, all: true, onMore: () => (more += 1) });
    expect(find(all, ListRow).map((p) => p.title)).toEqual(org.history.map((l) => l.text));
    expect(find(all, Button)).toEqual([]);
  });

  test("with five lines or fewer, no More", () => {
    const org = renamed(HISTORY_SHOWN);
    const tree = OrgHistoryList({ lines: org.history, all: false, onMore: () => undefined });
    expect(find(tree, ListRow)).toHaveLength(HISTORY_SHOWN);
    expect(find(tree, Button)).toEqual([]);
  });
});
