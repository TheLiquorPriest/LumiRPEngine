// A listed company's Ownership in Orgs (DESIGN §27.10 Listing): the section as the page sends it
// decodes whole (its market, the reader's market acts, the cap table's holders on the market), and
// the tab draws a Market section with the ticker and float, the cap table's public rows, and List on
// the market (or Offer more units), Sell on the market and Take it off the market; GM → Orgs draws
// the GM's own forms in its place.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { readPass } from "../../src/engine/read-pass";
import { createRegistry } from "../../src/engine/registry-impl";
import { resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { materializeAll } from "../../src/engine/materialize";
import { Working } from "../../src/engine/working";
import { ListRow, Section } from "../../src/frontend/components";
import type { GmSectionProps } from "../../src/frontend/registry";
import { decodeOwnership } from "../../src/packs/economy/ui/decode";
import type { HubNav } from "../../src/packs/economy/ui/nav";
import { OrgOwnership } from "../../src/packs/economy/ui/ownership";
import { decodeOrgPage } from "../../src/packs/orgs/ui/decode";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import type { OwnershipView } from "../../src/shared/finance";
import type { JsonObject } from "../../src/shared/json";
import type { OrgView } from "../../src/shared/org-view";
import { DEFAULT_CURRENCY } from "../../src/shared/world";
import { startState } from "../packs/support";
import type { Props } from "../support/tree";

const reg = createRegistry(ALL_PACKS);
const EMR = "ellis_mobile_repair_co";
const NAV: HubNav = { page: null, open: () => undefined, back: () => undefined, elsewhere: () => undefined, frame: "gm", backLabel: null };

function act(w: Working, actor: string, action: string, params: JsonObject): string {
  const r = resolveAction(reg, w, { action, actor, params }, createRng(`${action}:${actor}:${w.events.length}`), { runSeed: "listing-ui" });
  return [r.failed?.reason ?? null, ...r.rejected.map((x) => x.rejection.reason)].filter((x) => x !== null).join("; ");
}

/** Port Alder with Ellis Mobile Repair listed (500 units at $2) and Danny holding 60 of them, as Jordan's Orgs page sends it. */
function listedPage(): { org: OrgView; section: OwnershipView } {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  const w = new Working(reg, world, startState(world, reg));
  for (const id of ["pov", "danny_okafor"]) materializeAll(reg, w, id, "listing-ui");
  expect(act(w, "pov", "org_found", { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from: "acct_pov_savings", units: 1000 })).toBe("");
  expect(act(w, "pov", "org_restructure", { org: EMR, structure: "c_corp" })).toBe("");
  expect(act(w, "pov", "shares_list", { business: EMR, units: 500, price: 200 })).toBe("");
  expect(act(w, "danny_okafor", "trade", { side: "buy", asset: `stock:${EMR}`, qty: 60 })).toBe("");
  const view = reg.views.find((v) => v.panel === "orgs.org");
  if (!view) throw new Error("no orgs.org panel");
  const org = decodeOrgPage(readPass(() => view.build(w.ctx, { mapDisplay: null })), EMR);
  const section = org ? decodeOwnership(org.sections.ownership) : null;
  if (!org || !section) throw new Error("no Ownership on Ellis Mobile Repair's page");
  return { org, section };
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

/** The forms' summaries: every folded form (`Form`, a Disclosure) by its summary. */
function summaries(node: unknown): unknown[] {
  return elements(node)
    .filter((v) => typeof v.props.summary === "string")
    .map((v) => v.props.summary);
}

describe("a listed company's Ownership", () => {
  test("decodes its market, the reader's acts and the holders on the market", () => {
    const { section } = listedPage();
    expect(section.listing).toMatchObject({ asset: `stock:${EMR}`, symbol: "EMR", price: 200, float: 500, held: 60, available: 440, marketCap: 300_000 });
    expect(section.market).toEqual({ list: null, delist: null, offer: null, units: 999 });
    expect(section.owners.filter((o) => o.public === true).map((o) => [o.name, o.units])).toEqual([
      ["Danny Okafor", 60],
      ["The public", 440],
    ]);
    expect(section.valuation?.market).toEqual({ price: 200, units: 1500 });
  });

  test("Play draws its Market with the forms, and the cap table's public rows", () => {
    const { org, section } = listedPage();
    const tree = OrgOwnership({ org, section, reader: null, nav: NAV, currency: DEFAULT_CURRENCY, act: () => undefined });
    expect(find(tree, Section).map((p) => p.title)).toContain("Market");
    expect(summaries(tree)).toEqual(expect.arrayContaining(["Offer more units", "Sell on the market", "Take it off the market"]));
    const publicRow = find(tree, ListRow).find((p) => p.title === "The public");
    expect(publicRow?.subtitle).toBe("on the market · 440 units");
    expect(publicRow?.icon).toBe("globe");
  });

  test("GM → Orgs draws the GM's own List and Take it off the market", () => {
    const { org, section } = listedPage();
    const gm = { busy: false, currency: DEFAULT_CURRENCY, edit: async () => true } as unknown as GmSectionProps;
    const tree = OrgOwnership({ org, section: { ...section, market: null, acts: null }, reader: null, nav: NAV, currency: DEFAULT_CURRENCY, gm });
    expect(find(tree, Section).map((p) => p.title)).toContain("Market");
    const drawn = elements(tree).find((v) => typeof v.type === "function" && v.type.name === "GmMarket");
    expect(drawn).toBeDefined();
    expect(summaries(drawn ? (drawn.type as (p: Props) => unknown)(drawn.props) : null)).toEqual(["GM: offer more units", "GM: take it off the market"]);
  });
});
