// Winding up and merging on a company's Ownership tab (ORG-SPEC §3.13, §4.4, Phase 5 lane Z), its
// trees walked without a DOM from the section Port Alder builds for Jordan: Ellis Mobile Repair's
// Wind up with its reckoning (cash, payouts by share) and Merge with the company he decides for;
// once begun, the page's banner and Finish with Merge gone; once dissolved, the banner and no
// Ownership left to act on; and the player's ops played as the org_wind_up and org_merge actions.

import { describe, expect, test } from "bun:test";
import { decodeOwnership } from "../../src/packs/economy/ui/decode";
import { asAction, MergePart, OrgOwnership, WindingPart } from "../../src/packs/economy/ui/ownership";
import type { HubNav } from "../../src/packs/economy/ui/nav";
import { decodeOrgPage } from "../../src/packs/orgs/ui/decode";
import { OrgPage } from "../../src/packs/orgs/ui/org";
import { Banner } from "../../src/frontend/components";
import { readPass } from "../../src/engine/read-pass";
import { createRegistry } from "../../src/engine/registry-impl";
import { resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { materializeAll } from "../../src/engine/materialize";
import { Working } from "../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import type { OwnershipView } from "../../src/shared/finance";
import type { JsonObject } from "../../src/shared/json";
import type { OrgOp } from "../../src/shared/org-ops";
import type { OrgView } from "../../src/shared/org-view";
import type { StateView } from "../../src/shared/state-view";
import { DEFAULT_CURRENCY } from "../../src/shared/world";
import { startState } from "../packs/support";
import { propsOf } from "../support/tree";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const EMR = "ellis_mobile_repair_co";
const TOW = "ellis_towing_co";

function portAlder(): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  const w = new Working(reg, world, startState(world, reg));
  materializeAll(reg, w, JORDAN, "ownership-wind");
  return w;
}

function act(w: Working, action: string, params: JsonObject): void {
  const r = resolveAction(reg, w, { action, actor: JORDAN, params }, createRng(`${action}:${w.events.length}`), { runSeed: "ownership-wind" });
  expect([r.failed?.reason ?? null, ...r.rejected.map((x) => x.rejection.reason)].filter((x) => x !== null)).toEqual([]);
}

/** A company's page as Jordan reads it, and its Ownership while he may read one. */
function page(w: Working, org = EMR): { org: OrgView; section: OwnershipView | null } {
  const view = reg.views.find((v) => v.panel === "orgs.org");
  if (!view) throw new Error("no orgs.org panel");
  const built = decodeOrgPage(readPass(() => view.build(w.ctx, { mapDisplay: null })), org);
  if (!built) throw new Error(`no page for ${org}`);
  return { org: built, section: decodeOwnership(built.sections.ownership ?? null) };
}

/** The banner the page draws over its tabs, its title in words; null for none. */
function banner(org: OrgView): string | null {
  const tree = OrgPage({ org, figure: null, defs: [], tab: "overview", panelId: "p", onTab: () => undefined, onBack: () => undefined, chatId: "c", state: { currency: DEFAULT_CURRENCY } as unknown as StateView, send: () => Promise.reject(new Error("no backend")), open: () => undefined });
  const found = propsOf(tree, Banner)[0];
  return found ? String(found.title) : null;
}

const nav: HubNav = { page: null, open: () => undefined, back: () => undefined, elsewhere: () => undefined, frame: "gm", backLabel: null };

describe("the Ownership tab's winding up and merging", () => {
  test("Jordan's company: Wind up with its reckoning, Merge with the company he decides for, and the ops they send played as actions", () => {
    const w = portAlder();
    act(w, "org_found", { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from: "acct_pov_savings", units: 1000 });
    act(w, "org_found", { type: "company", name: "Ellis Towing", amount: 50_000, from: "acct_pov_savings" });
    const { org, section } = page(w);
    if (!section) throw new Error("no Ownership");
    const sent: OrgOp[] = [];
    const tree = OrgOwnership({ org, section, reader: null, nav, change: (op) => sent.push(op) });
    const [winding] = propsOf(tree, WindingPart);
    expect(winding?.winding).toMatchObject({ since: null, dissolved: null, why: null, cash: 200_000, short: 0, payouts: [{ party: JORDAN, name: "Jordan Ellis", share: 100, cents: 200_000 }] });
    expect(typeof winding?.change).toBe("function");
    const [merge] = propsOf(tree, MergePart);
    expect(merge?.merge).toMatchObject({ why: null, units: 1000, with: [{ id: TOW, name: "Ellis Towing" }] });
    expect(banner(org)).toBeNull();
    // The player's ops play as the org actions.
    const played: [string, JsonObject][] = [];
    const change = asAction((action, params) => played.push([action, params]));
    change({ do: "wind_up", org: EMR, stage: "all", property: "sell" });
    change({ do: "merge", org: TOW, into: EMR, ratio: 0.25, keep: true });
    expect(played).toEqual([
      ["org_wind_up", { org: EMR, stage: "all", property: "sell" }],
      ["org_merge", { org: TOW, into: EMR, ratio: 0.25, keep: true }],
    ]);
  });

  test("begun: the page's banner says since when, Wind up becomes Finish and Merge is gone; dissolved: the banner, and no Ownership to act on", () => {
    const w = portAlder();
    act(w, "org_found", { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from: "acct_pov_savings", units: 1000 });
    act(w, "org_wind_up", { org: EMR, stage: "begin" });
    const begun = page(w);
    if (!begun.section) throw new Error("no Ownership while it winds up");
    expect(banner(begun.org)).toMatch(/^Winding up since /);
    const tree = OrgOwnership({ org: begun.org, section: begun.section, reader: null, nav, change: () => undefined });
    expect(propsOf(tree, WindingPart).map((p) => (p.winding as { since: string | null }).since)).toEqual([begun.org.ended?.winding ?? null]);
    expect(propsOf(tree, MergePart)).toEqual([]);

    act(w, "org_wind_up", { org: EMR, stage: "finish" });
    const ended = page(w);
    expect(banner(ended.org)).toMatch(/^Dissolved on /);
    expect(ended.section).toBeNull();
    // Jordan, whom its History names, still reads it.
    expect(ended.org.history.map((l) => l.text)).toEqual(expect.arrayContaining(["Dissolved"]));
  });
});
