// Put it to a vote on a company's Ownership (ORG-SPEC Phase 5) for winding up, merging, listing and
// taking it off the market, as for issuing shares and the rest. Port Alder: Ellis Mobile Repair, a C
// corporation whose votes are Jordan 40 %, Danny 35 % and Priya 25 %, and Ellis Towing, Jordan's
// alone. Jordan's Play tab offers each where his votes alone fall short, its words saying so, and
// each sends its action with `vote`; GM → Orgs decides alone, with nothing to put to a vote.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { Button } from "../../src/frontend/components";
import { applyEffects } from "../../src/engine/effects";
import { buildGmWorld } from "../../src/engine/gm-view";
import { materializeAll } from "../../src/engine/materialize";
import { readPass } from "../../src/engine/read-pass";
import { createRegistry } from "../../src/engine/registry-impl";
import { resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import { decodeOwnership } from "../../src/packs/economy/ui/decode";
import type { HubNav } from "../../src/packs/economy/ui/nav";
import { asAction, DecideButton, MergePart, OrgOwnership, WindingPart } from "../../src/packs/economy/ui/ownership";
import { decodeOrgPage } from "../../src/packs/orgs/ui/decode";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import type { OwnershipView } from "../../src/shared/finance";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { OrgOp } from "../../src/shared/org-ops";
import type { OrgView } from "../../src/shared/org-view";
import { DEFAULT_CURRENCY } from "../../src/shared/world";
import { startState } from "../packs/support";
import { propsOf, type Props } from "../support/tree";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const DANNY = "danny_okafor";
const PRIYA = "priya_nair";
const SAVINGS = "acct_pov_savings";
const EMR = "ellis_mobile_repair_co";
const TOW = "ellis_towing_co";
const NAV: HubNav = { page: null, open: () => undefined, back: () => undefined, elsewhere: () => undefined, frame: "gm", backLabel: null };

function played(w: Working, action: string, params: JsonObject): void {
  const r = resolveAction(reg, w, { action, actor: JORDAN, params }, createRng(`${action}:${w.events.length}`), { runSeed: "ownership-vote" });
  expect([r.failed?.reason ?? null, ...r.rejected.map((x) => x.rejection.reason)].filter((x) => x !== null)).toEqual([]);
}

function gmEffect(w: Working, type: string, args: Record<string, JsonValue>): void {
  expect(applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) }).rejected.map((r) => r.rejection.reason)).toEqual([]);
}

/** Ellis Mobile Repair (Jordan's $2,000 in 1,000 units, Danny's 875 and Priya's 625 given by the GM, made a C corporation by the GM) and Ellis Towing, Jordan's alone. */
function portAlder(): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  const w = new Working(reg, world, startState(world, reg));
  for (const id of [JORDAN, DANNY, PRIYA]) materializeAll(reg, w, id, "ownership-vote");
  played(w, "org_found", { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from: SAVINGS, units: 1000 });
  gmEffect(w, "economy.shares_issue", { business: EMR, to: DANNY, units: 875, price: 0 });
  gmEffect(w, "economy.shares_issue", { business: EMR, to: PRIYA, units: 625, price: 0 });
  gmEffect(w, "orgs.restructure", { org: EMR, structure: "c_corp" });
  played(w, "org_found", { type: "company", name: "Ellis Towing", amount: 50_000, from: SAVINGS, units: 1000 });
  return w;
}

/** Ellis Mobile Repair's page and Ownership as Jordan reads them in Play. */
function playPage(w: Working): { org: OrgView; section: OwnershipView } {
  const view = reg.views.find((v) => v.panel === "orgs.org");
  if (!view) throw new Error("no orgs.org panel");
  const org = decodeOrgPage(readPass(() => view.build(w.ctx, { mapDisplay: null })), EMR);
  const section = org ? decodeOwnership(org.sections.ownership ?? null) : null;
  if (!org || !section) throw new Error("no Ownership on Ellis Mobile Repair's page");
  return { org, section };
}

/** Ellis Mobile Repair's Ownership as GM → Orgs draws it. */
function gmSection(w: Working): OwnershipView {
  const entry = readPass(() => buildGmWorld(reg, w.world, w.state)).orgs.find((o) => o.page.id === EMR);
  const section = entry ? decodeOwnership(entry.page.sections.ownership ?? null) : null;
  if (!section) throw new Error("no Ownership in GM → Orgs");
  return section;
}

function elements(node: unknown): VNode<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node) || !("type" in node)) return [];
  const v = node as VNode<Props>;
  return [v, ...Object.values(v.props).flatMap(elements)];
}

/** The tab's own pieces by their component's name (the folded forms and their fields). */
function named(tree: unknown, name: string): VNode<Props>[] {
  return elements(tree).filter((v) => typeof v.type === "function" && v.type.name === name);
}

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

/** A folded form by its summary, drawn one level down: its help words. */
function formText(tree: unknown, summary: string): { vote: unknown; text: string } {
  const form = named(tree, "Form").find((v) => v.props.summary === summary);
  if (!form) throw new Error(`no form ${summary}`);
  return { vote: form.props.vote, text: textOf((form.type as (p: Props) => unknown)(form.props)) };
}

const ASKED = "You may put it to a vote: it is done if the vote passes.";

describe("Put it to a vote for winding up, merging, listing and taking it off the market", () => {
  test("Play: Jordan's views say his votes fall short, the tab offers a vote, and each sends its action with `vote`", () => {
    const w = portAlder();
    const { org, section } = playPage(w);
    expect(section.winding).toMatchObject({ vote: true, why: "Winding up Ellis Mobile Repair needs more than half the votes; Jordan Ellis holds 40%", cash: 200_000 });
    // Copies: matching asymmetric matchers against the decoded section would write them into it.
    expect(structuredClone(section.merge)).toMatchObject({ vote: true, with: [expect.objectContaining({ id: TOW })] });
    expect(structuredClone(section.market)).toMatchObject({ voteList: true, list: expect.stringContaining("Listing Ellis Mobile Repair needs more than half the votes") });

    const sent: [string, JsonObject][] = [];
    const act = (action: string, params: JsonObject): void => void sent.push([action, params]);
    const tree = OrgOwnership({ org, section, reader: null, nav: NAV, currency: DEFAULT_CURRENCY, act, change: asAction(act) });
    const listing = formText(tree, "List on the market");
    expect(listing.vote).toBe(true);
    expect(listing.text).toContain(`Listing Ellis Mobile Repair needs more than half the votes; Jordan Ellis holds 40%. ${ASKED}`);
    const [listForm] = named(tree, "ListForm");
    expect(listForm?.props.vote).toBe(true);
    (listForm?.props.go as (params: JsonObject, vote: boolean) => void)({ units: 500, price: 200 }, true);
    const [winding] = propsOf(tree, WindingPart);
    (winding?.change as (op: OrgOp, vote?: boolean) => void)({ do: "wind_up", org: EMR, stage: "all", property: "distribute" }, true);
    const [merge] = propsOf(tree, MergePart);
    expect(merge?.merge).toMatchObject({ vote: true });
    (merge?.change as (op: OrgOp, vote?: boolean) => void)({ do: "merge", org: EMR, into: TOW }, true);
    expect(sent).toEqual([
      ["shares_list", { business: EMR, units: 500, price: 200, vote: true }],
      ["org_wind_up", { org: EMR, stage: "all", property: "distribute", vote: true }],
      ["org_merge", { org: EMR, into: TOW, vote: true }],
    ]);
  });

  test("a decision's button reads Put it to a vote (or its own words) where the votes fall short, and asks for the vote", () => {
    const asked: boolean[] = [];
    const [button] = propsOf(DecideButton({ ok: true, vote: true, label: "Wind it up", variant: "danger", onGo: (vote) => asked.push(vote) }), Button);
    expect([textOf(button?.children), button?.variant, button?.disabled]).toEqual(["Put it to a vote", "danger", false]);
    (button?.onClick as () => void)();
    expect(asked).toEqual([true]);
    expect(textOf(propsOf(DecideButton({ ok: true, vote: true, label: "Finish and dissolve", voteLabel: "Put finishing it to a vote", onGo: () => undefined }), Button)[0]?.children)).toBe("Put finishing it to a vote");
    expect(textOf(propsOf(DecideButton({ ok: true, vote: false, label: "Merge them", onGo: () => undefined }), Button)[0]?.children)).toBe("Merge them");
  });

  test("listed: Take it off the market offers a vote and sends shares_delist with `vote`; GM → Orgs decides alone", () => {
    const w = portAlder();
    const gm = gmSection(w);
    expect(gm.winding?.why ?? null).toBeNull();
    expect(gm.winding?.vote).toBeUndefined();
    expect(gm.merge).toMatchObject({ why: null });
    expect(gm.merge?.vote).toBeUndefined();
    expect(gm.market).toBeNull();

    // At its books a unit ($0.80 over its 2,500 units), the most the public pays.
    gmEffect(w, "economy.list", { business: EMR, units: 500, price: 80 });
    const { org, section } = playPage(w);
    expect(structuredClone(section.market)).toMatchObject({ voteDelist: true, delist: expect.stringContaining("Delisting Ellis Mobile Repair needs more than half the votes") });
    const sent: [string, JsonObject][] = [];
    const tree = OrgOwnership({ org, section, reader: null, nav: NAV, currency: DEFAULT_CURRENCY, act: (action, params) => void sent.push([action, params]) });
    const off = formText(tree, "Take it off the market");
    expect(off.vote).toBe(true);
    expect(off.text).toContain(ASKED);
    const [delist] = named(tree, "DelistForm");
    expect(delist?.props.vote).toBe(true);
    (delist?.props.go as (params: JsonObject, vote: boolean) => void)({}, true);
    expect(sent).toEqual([["shares_delist", { business: EMR, vote: true }]]);
  });
});
