// Merging companies (ORG-SPEC §3.13, Phase 5, lane Z; acceptance M1-M4 in the lane's design) on Port
// Alder. Ellis Towing (Jordan's, with Danny holding a fifth) folds into Ellis Mobile Repair at the
// ratio of their values a unit: its holders get Ellis Mobile Repair's units with their basis carried
// over, and its account, its driver's job in its Driver position, its property and its member move
// over; it is dissolved as merged, and a payment made to it is the survivor's to take. A parent
// absorbing the subsidiary it owns issues nothing and keeps its consolidated cash. Bought for cash
// and kept, Alder Automotive becomes Ellis Mobile Repair's subsidiary with its staff and accounts
// its own, and Marcus realises his gain. Merging a company with itself, a dissolved one, without the
// votes or a listed one is refused.

import { describe, expect, test } from "bun:test";
import type { OwnershipView } from "../../../src/shared/finance";
import type { EntityId } from "../../../src/shared/ids";
import type { JsonObject, JsonValue } from "../../../src/shared/json";
import type { LedgerEvent, PostEvent } from "../../../src/shared/ledger";
import type { OrgView } from "../../../src/shared/org-view";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockOfLocal, dateAt } from "../../../src/engine/calendar";
import { applyEffects } from "../../../src/engine/effects";
import { materializeAll } from "../../../src/engine/materialize";
import { positionsOf } from "../../../src/engine/org";
import { readPass } from "../../../src/engine/read-pass";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { basisRecord, gainsIn } from "../../../src/packs/economy/core/records";
import { orgHistory } from "../../../src/packs/orgs/core/log";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const DANNY = "danny_okafor";
const JESS = "jess_kowalczyk";
const MARCUS = "marcus_delgado";
const SAVINGS = "acct_pov_savings";
const EMR = "ellis_mobile_repair_co";
const TOW = "ellis_towing_co";
const SHOP = "alder_automotive_co";

function portAlder(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  for (const id of [JORDAN, DANNY, MARCUS, JESS, SHOP]) materializeAll(reg, w, id, "merging");
  return w;
}

function act(w: Working, actor: string, action: string, params: JsonObject): Resolution {
  return resolveAction(reg, w, { action, actor, params }, createRng(`${action}:${actor}:${w.events.length}`), { runSeed: "merging" });
}

function why(r: Resolution): string {
  return [r.failed?.reason ?? null, ...r.rejected.map((x) => x.rejection.reason)].filter((x) => x !== null).join("; ");
}

function gm(w: Working, type: string, args: Record<string, JsonValue>): string {
  return applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) }).rejected.map((r) => r.rejection.reason).join("; ");
}

function field(w: Working, id: string, f: string): JsonValue | undefined {
  return w.state.entities[id]?.fields[f];
}

function till(w: Working, business: string): string {
  return String(field(w, business, "operating_account") ?? "");
}

function lapseTo(w: Working, local: string): void {
  const to = clockOfLocal(calendarOf(w.world), local);
  for (let guard = 0; w.state.clock < to && guard < 64; guard++) {
    const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: "merging", overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } });
    if ("code" in out) throw new Error(out.reason);
  }
}

/** A section of an organization's page as Jordan reads it. */
function section<T>(w: Working, org: EntityId, id: string): T {
  const view = reg.views.find((v) => v.panel === "orgs.org");
  if (!view) throw new Error("no orgs.org panel");
  const pages = readPass(() => view.build(w.ctx, { mapDisplay: null })) as unknown as Record<string, OrgView>;
  const built = pages[org]?.sections[id];
  if (!built) throw new Error(`no ${id} on ${org}'s page`);
  return built as unknown as T;
}

/** Ellis Mobile Repair: Jordan's, $2,000 in 1,000 units (worth $2.00 a unit). */
function emr(w: Working): void {
  expect(why(act(w, JORDAN, "org_found", { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from: SAVINGS, units: 1000 }))).toBe("");
}

/** Ellis Towing: Jordan's $500 in 1,000 units, Danny buying 250 at $0.50 (worth $0.50 a unit); a Driver position Jess is hired into; a lot it owns; Danny a member. */
function towing(w: Working): void {
  expect(why(act(w, JORDAN, "org_found", { type: "company", name: "Ellis Towing", amount: 50_000, from: SAVINGS, units: 1000 }))).toBe("");
  expect(why(act(w, JORDAN, "shares_issue", { business: TOW, to: DANNY, units: 250, price: 50 }))).toBe("");
  expect(gm(w, "orgs.position", { org: TOW, title: "Driver", id: "driver", powers: ["assets.use"] })).toBe("");
  expect(gm(w, "economy.hire", { business: TOW, worker: JESS, title: "Driver", position: "driver", basis: "hourly", rate: 1800, hours_per_week: 10 })).toBe("");
  expect(w.apply({ type: "spawn", entity: { id: "prop_tow_lot", kind: "property", name: "The tow lot", tier: "background", fields: { owners: [{ party: TOW, role: "owner", share: 100 }], place: "alder_automotive", value: 5_000_000 }, relations: [] } } as LedgerEvent)).toBeNull();
  expect(w.apply({ type: "link", rel: "member_of", from: DANNY, to: TOW, fields: { role: "Dispatcher" } })).toBeNull();
}

describe("M1: one company folded into another", () => {
  test("Ellis Towing into Ellis Mobile Repair at the ratio of their values: units with basis carried; its account, staff, position, property and members move; it is dissolved as merged", () => {
    const w = portAlder();
    emr(w);
    towing(w);
    const towAccount = till(w, TOW);
    const towCash = w.state.accounts[towAccount] ?? 0;
    expect(towCash).toBe(62_500);
    const r = act(w, JORDAN, "org_merge", { org: TOW, into: EMR });
    expect(why(r)).toBe("");
    // One unit.
    const group = r.events[0]?.group;
    expect(r.events.every((e) => e.group === group)).toBe(true);
    // Ellis Towing is worth its $625 and its $50,000 lot, $40.50 a unit, against Ellis Mobile Repair's $2.00: 20.25 units each.
    expect(field(w, EMR, "owners")).toEqual([
      { party: JORDAN, role: "owner", share: 80.7586, units: 21250 },
      { party: DANNY, role: "owner", share: 19.2414, units: 5063 },
    ]);
    // Its account is Ellis Mobile Repair's now.
    expect(field(w, towAccount, "owners")).toEqual([
      { party: EMR, role: "owner" },
      { party: JORDAN, role: "authorized_user" },
    ]);
    expect(w.state.accounts[towAccount]).toBe(towCash);
    // Jess drives for Ellis Mobile Repair, in its Driver position.
    const job = Object.keys(w.state.entities).find((id) => w.state.entities[id]?.kind === "job" && w.state.entities[id]?.fields.worker === JESS && w.state.entities[id]?.fields.employer === EMR) ?? "";
    expect(job).not.toBe("");
    expect(field(w, job, "position")).toBe("driver");
    expect(positionsOf(w.ctx, EMR).map((p) => p.id)).toContain("driver");
    // The lot, and Danny's membership.
    expect(field(w, "prop_tow_lot", "owners")).toEqual([{ party: EMR, role: "owner", share: 100 }]);
    expect(w.state.entities[DANNY]?.relations.some((x) => x.type === "member_of" && x.to === EMR && x.fields?.role === "Dispatcher")).toBe(true);
    expect(w.state.entities[DANNY]?.relations.some((x) => x.type === "member_of" && x.to === TOW)).toBe(false);
    // Dissolved as merged.
    expect(field(w, TOW, "merged_into")).toBe(EMR);
    expect(typeof field(w, TOW, "dissolved")).toBe("string");
    expect(field(w, TOW, "owners")).toEqual([]);
    // A share swap realises nothing; Danny's $125 basis is in his Ellis Mobile Repair units.
    expect(basisRecord(w.state, EMR, DANNY)?.basis).toBe(12_500);
    const year = Number(String(field(w, TOW, "dissolved")).slice(0, 4));
    expect(gainsIn(w.state, DANNY, year).short + gainsIn(w.state, DANNY, year).long).toBe(0);
    expect(orgHistory(w.state, EMR)[0]?.text).toMatch(/^(Took in Ellis Towing|Jess Kowalczyk came over from Ellis Towing)/);
    expect(orgHistory(w.state, TOW)[0]?.text).toBe("Merged into Ellis Mobile Repair, and dissolved");
  });

  test("a ratio said is the one used", () => {
    const w = portAlder();
    emr(w);
    towing(w);
    expect(gm(w, "orgs.merge", { org: TOW, into: EMR, ratio: 1 })).toBe("");
    expect(field(w, EMR, "owners")).toEqual([
      { party: JORDAN, role: "owner", share: 88.8889, units: 2000 },
      { party: DANNY, role: "owner", share: 11.1111, units: 250 },
    ]);
  });

  test("a payment made to it is Ellis Mobile Repair's: Danny's retainer and a split of his bill repointed, and October's retainer lands in its account", () => {
    const w = portAlder();
    emr(w);
    towing(w);
    const flows: [string, string, JsonObject][] = [
      ["flow_tow_retainer", "Towing retainer", { to: TOW, amount_cents: 20_000 }],
      ["flow_tow_split", "Storage, half to Ellis Towing", { to: "Harbor Storage", amount_cents: 4_000, splits: [{ to: TOW, pct: 50 }] }],
    ];
    for (const [id, name, fields] of flows) expect(w.apply({ type: "spawn", entity: { id, kind: "flow", name, tier: "background", fields: { flow_kind: "bill", from: "acct_danny_checking", every: "month", days: [1], status: "active", ...fields }, relations: [] } } as LedgerEvent)).toBeNull();
    expect(gm(w, "orgs.merge", { org: TOW, into: EMR })).toBe("");
    expect(field(w, "flow_tow_retainer", "to")).toBe(EMR);
    expect(field(w, "flow_tow_split", "splits")).toEqual([{ to: EMR, pct: 50 }]);
    // 1 October: the retainer is paid into Ellis Mobile Repair's own account, not an outside one in Ellis Towing's name.
    lapseTo(w, "2026-10-01T12:00");
    const retainer = w.events.filter((e): e is PostEvent => e.type === "post" && e.lines.some((l) => l.account === "acct_danny_checking" && l.amount === -20_000));
    expect(retainer.map((p) => p.lines.filter((l) => l.amount > 0))).toEqual([[{ account: till(w, EMR), amount: 20_000 }]]);
  });
});

describe("M2: a parent absorbing its subsidiary", () => {
  test("Ellis Mobile Repair takes in its own Ellis Towing: no units issued, its consolidated cash kept", () => {
    const w = portAlder((world) => {
      const pov = world.entities[JORDAN];
      if (pov) pov.levels = { ...pov.levels, money: 4 };
    });
    emr(w);
    expect(why(act(w, JORDAN, "org_found", { type: "company", name: "Ellis Towing", amount: 50_000, as: EMR }))).toBe("");
    const before = section<OwnershipView>(w, EMR, "ownership").consolidated?.cash ?? null;
    const owners = field(w, EMR, "owners");
    expect(why(act(w, JORDAN, "org_merge", { org: TOW, into: EMR }))).toBe("");
    expect(field(w, EMR, "owners")).toEqual(owners);
    const cash = [till(w, EMR), String(field(w, TOW, "operating_account"))].reduce((a, id) => a + (w.state.accounts[id] ?? 0), 0);
    expect(cash).toBe(before ?? 200_000);
    expect(field(w, TOW, "merged_into")).toBe(EMR);
  });
});

describe("M3: bought for cash, kept as a subsidiary", () => {
  test("Ellis Mobile Repair buys Alder Automotive for $1,000: Marcus paid and his gain realised; Alder Automotive its own with its staff and accounts", () => {
    const w = portAlder();
    emr(w);
    const marcus = w.state.accounts.acct_marcus_checking ?? 0;
    expect(gm(w, "orgs.merge", { org: SHOP, into: EMR, cash: 100_000, keep: true })).toBe("");
    expect(field(w, SHOP, "owners")).toEqual([{ party: EMR, role: "owner", share: 100, units: 1000 }]);
    expect(w.state.accounts.acct_marcus_checking).toBe(marcus + 100_000);
    expect(w.state.accounts[till(w, EMR)]).toBe(100_000);
    expect(field(w, "acct_marcus_shop", "owners")).toEqual([
      { party: SHOP, role: "owner" },
      { party: MARCUS, role: "authorized_user" },
    ]);
    expect(field(w, "job_pov_mechanic", "employer")).toBe(SHOP);
    expect(field(w, SHOP, "dissolved")).toBeUndefined();
    expect(basisRecord(w.state, SHOP, EMR)?.basis).toBe(100_000);
    // Marcus put in nothing the story recorded: the $1,000 is all gain.
    const year = dateAt(calendarOf(w.world), w.state.clock).year;
    expect(gainsIn(w.state, MARCUS, year).short + gainsIn(w.state, MARCUS, year).long).toBe(100_000);
    expect(orgHistory(w.state, EMR)[0]?.text).toBe("Took over Alder Automotive as its subsidiary: its holders got $1,000.00");
  });
});

describe("M4: refusals", () => {
  test("with itself, a dissolved company, without the votes, or listed", () => {
    const w = portAlder();
    emr(w);
    towing(w);
    expect(gm(w, "orgs.merge", { org: EMR, into: EMR })).toBe("Ellis Mobile Repair can't merge with itself");
    expect(why(act(w, DANNY, "org_merge", { org: TOW, into: EMR }))).toBe("Merging Ellis Towing needs more than half the votes; Danny Okafor holds 20%");
    const listed = portAlder((world) => {
      const shop = world.entities[SHOP];
      if (shop) shop.fields.listing = { asset: "alder", float: 100 };
    });
    emr(listed);
    expect(gm(listed, "orgs.merge", { org: SHOP, into: EMR })).toBe("Alder Automotive is listed on the market: delist it first");
    expect(gm(w, "orgs.merge", { org: TOW, into: EMR })).toBe("");
    expect(gm(w, "orgs.merge", { org: TOW, into: EMR })).toMatch(/^Ellis Towing was dissolved on /);
  });
});
