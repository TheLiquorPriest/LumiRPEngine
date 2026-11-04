// Shares (ORG-SPEC §11 Phase 3, §3.10) on Port Alder. Jordan founds Ellis Mobile Repair, an LLC,
// with $2,000 from his savings counted in 1,000 units: one unit, which a rebased view without the
// savings drops whole. Issuing 250 units to Danny at $2 rewrites both rows' shares from the units,
// lands $500 in the company's account and gives Danny a $500 basis; buying them back at the value a
// unit realises his gain and leaves Jordan with all of it. An issue by a holder of 40 % of the votes
// is refused; a sale moves units; classes weigh the votes; and a company that counts no units (Alder
// Automotive) sells, pays out and shares its worth exactly as before.

import { describe, expect, test } from "bun:test";
import { ownersIn, worthShares } from "../../../src/shared/finance";
import type { JsonObject, JsonValue } from "../../../src/shared/json";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, dateAt } from "../../../src/engine/calendar";
import { applyEffects } from "../../../src/engine/effects";
import { applyValidUnits } from "../../../src/engine/events";
import { materializeAll } from "../../../src/engine/materialize";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction, type Resolution } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import type { WorldState } from "../../../src/engine/state";
import { Working } from "../../../src/engine/working";
import { basisRecord, gainsIn } from "../../../src/packs/economy/core/records";
import { votesIn } from "../../../src/packs/economy/core/shares";
import { orgHistory } from "../../../src/packs/orgs/core/log";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const JORDAN = "pov";
const DANNY = "danny_okafor";
const MARCUS = "marcus_delgado";
const SAVINGS = "acct_pov_savings";
const EMR = "ellis_mobile_repair_co";
const SHOP = "alder_automotive_co";

function portAlder(patch: (world: WorldDoc) => void = () => undefined): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  patch(world);
  const w = new Working(reg, world, startState(world, reg));
  for (const id of [JORDAN, DANNY, MARCUS, SHOP]) materializeAll(reg, w, id, "shares");
  return w;
}

function act(w: Working, actor: string, action: string, params: JsonObject): Resolution {
  return resolveAction(reg, w, { action, actor, params }, createRng(`${action}:${actor}:${w.events.length}`), { runSeed: "shares" });
}

/** Why it didn't play: the requirement or the effect's refusal; "" when it played. */
function why(r: Resolution): string {
  return [r.failed?.reason ?? null, ...r.rejected.map((x) => x.rejection.reason)].filter((x) => x !== null).join("; ");
}

function gm(w: Working, type: string, args: Record<string, JsonValue>): string {
  return applyEffects(reg, w, [{ type, args }], { bindings: {}, rng: createRng(`${type}:${w.events.length}`) }).rejected.map((r) => r.rejection.reason).join("; ");
}

function owners(w: Working, id: string): JsonValue {
  return w.state.entities[id]?.fields.owners ?? null;
}

/** Ellis Mobile Repair, founded by Jordan with $2,000 from his savings in 1,000 units. */
function founded(w: Working): Resolution {
  const r = act(w, JORDAN, "org_found", { type: "company", name: "Ellis Mobile Repair", amount: 200_000, from: SAVINGS, units: 1000 });
  expect(why(r)).toBe("");
  return r;
}

function account(w: Working, business: string): string {
  return String(w.state.entities[business]?.fields.operating_account ?? "");
}

describe("founding Ellis Mobile Repair in units", () => {
  test("an LLC with $2,000 from his savings and 1,000 units, as one unit", () => {
    const w = portAlder();
    const before = structuredClone(w.state) as WorldState;
    const savings = w.state.accounts[SAVINGS] ?? 0;
    const r = founded(w);
    expect(owners(w, EMR)).toEqual([{ party: JORDAN, role: "owner", share: 100, units: 1000 }]);
    expect(w.state.entities[EMR]?.fields.structure).toBe("llc");
    expect(w.state.accounts[account(w, EMR)]).toBe(200_000);
    expect(w.state.accounts[SAVINGS]).toBe(savings - 200_000);
    // One unit: the spawns, the account's opening, the posting and the sets, with its History line.
    const group = r.events.find((e) => e.type === "spawn")?.group;
    expect(group).toBeDefined();
    const unit: LedgerEvent[] = r.events.filter((e) => e.group === group);
    expect(unit).toHaveLength(r.events.length);
    expect(unit.map((e) => e.type)).toEqual(expect.arrayContaining(["spawn", "post", "set", "orgs.log"]));
    expect(unit.filter((e) => e.type === "spawn").map((e) => (e.type === "spawn" ? e.entity.kind : ""))).toEqual(["business", "account"]);

    // A rebased view where his savings can't put the capital in drops all of it.
    const poor = new Working(reg, w.world, structuredClone(before));
    const left = poor.state.accounts[SAVINGS] ?? 0;
    expect(poor.apply({ type: "post", lines: [{ account: SAVINGS, amount: -left }, { account: "economy.external:elsewhere", amount: left }], memo: "Spent elsewhere" })).toBeNull();
    expect(applyValidUnits(reg, unit, poor.state, (s) => reg.context(poor.world, s))).toEqual([]);
    expect(poor.state.entities[EMR]).toBeUndefined();
    const rich = new Working(reg, w.world, structuredClone(before));
    expect(applyValidUnits(reg, unit, rich.state, (s) => reg.context(rich.world, s))).toHaveLength(unit.length);
    expect(rich.state.entities[EMR]?.fields.owners).toEqual(owners(w, EMR));
  });
});

describe("issuing and buying back", () => {
  test("250 units to Danny at $2: Jordan 1,000 (80 %), Danny 250 (20 %), $500 in the company's account, Danny's basis $500", () => {
    const w = portAlder();
    founded(w);
    const till = account(w, EMR);
    const danny = w.state.accounts.acct_danny_checking ?? 0;
    const issued = act(w, JORDAN, "shares_issue", { business: EMR, to: DANNY, units: 250, price: 200 });
    expect(why(issued)).toBe("");
    expect(owners(w, EMR)).toEqual([
      { party: JORDAN, role: "owner", share: 80, units: 1000 },
      { party: DANNY, role: "owner", share: 20, units: 250 },
    ]);
    expect(w.state.accounts[till]).toBe(250_000);
    expect(w.state.accounts.acct_danny_checking).toBe(danny - 50_000);
    expect(basisRecord(w.state, EMR, DANNY)?.basis).toBe(50_000);
    expect(orgHistory(w.state, EMR)[0]).toMatchObject({ text: "Issued 250 units to Danny Okafor at $2.00 a unit ($500.00)", by: JORDAN, power: "shares.manage" });
    // One unit: the payment, the owners set, the basis and the History line.
    const group = issued.events.find((e) => e.type === "economy.acquire")?.group;
    expect(issued.events.filter((e) => e.group === group).map((e) => e.type)).toEqual(expect.arrayContaining(["post", "set", "economy.acquire", "orgs.log"]));
  });

  test("buying back Danny's 250 at the value a unit realises his gain and leaves Jordan with all of it", () => {
    const w = portAlder();
    founded(w);
    expect(why(act(w, JORDAN, "shares_issue", { business: EMR, to: DANNY, units: 250, price: 200 }))).toBe("");
    // The GM values it at $5,000: $4 a unit.
    expect(w.apply({ type: "set", entity: EMR, field: "value", value: 500_000 })).toBeNull();
    const danny = w.state.accounts.acct_danny_checking ?? 0;
    const back = act(w, JORDAN, "shares_buy_back", { business: EMR, from: DANNY, units: 250 });
    expect(why(back)).toBe("");
    expect(back.events.find((e) => e.type === "economy.dispose")).toMatchObject({ data: { entity: EMR, party: DANNY, pct: 100, proceeds: 100_000 } });
    expect(w.state.accounts.acct_danny_checking).toBe(danny + 100_000);
    expect(w.state.accounts[account(w, EMR)]).toBe(150_000);
    expect(owners(w, EMR)).toEqual([{ party: JORDAN, role: "owner", share: 100, units: 1000 }]);
    const year = dateAt(calendarOf(w.world), w.state.clock).year;
    expect(gainsIn(w.state, DANNY, year).short).toBe(50_000);
    expect(basisRecord(w.state, EMR, DANNY)).toBeNull();
  });

  test("an issue by a holder with 40 % of the votes is refused: it needs more than half the votes", () => {
    const w = portAlder();
    founded(w);
    // The GM issues Danny 1,500 units at $1: Jordan holds 1,000 of 2,500.
    expect(gm(w, "economy.shares_issue", { business: EMR, to: DANNY, units: 1500, price: 100 })).toBe("");
    expect(votesIn(w.state, EMR)[JORDAN]).toBe(40);
    const refused = act(w, JORDAN, "shares_issue", { business: EMR, to: JORDAN, units: 100, price: 200 });
    expect(why(refused)).toContain("needs more than half the votes");
    expect(why(refused)).toBe("Issuing shares in Ellis Mobile Repair needs more than half the votes; Jordan Ellis holds 40%");
    expect(why(act(w, JORDAN, "shares_buy_back", { business: EMR, from: DANNY, units: 100 }))).toContain("needs more than half the votes");
    // Danny, with 60 %, may.
    expect(why(act(w, DANNY, "shares_issue", { business: EMR, to: DANNY, units: 100, price: 200 }))).toBe("");
  });

  test("a sale moves units, and classes weigh the votes", () => {
    const w = portAlder();
    founded(w);
    expect(why(act(w, JORDAN, "stake_sell", { business: EMR, units: 400, price: 80_000, buyer: DANNY }))).toBe("");
    expect(owners(w, EMR)).toEqual([
      { party: JORDAN, role: "owner", share: 60, units: 600 },
      { party: DANNY, role: "owner", share: 40, units: 400 },
    ]);
    // Danny's units into a class with no votes: Jordan holds all of them, Danny still 40 % of the worth.
    expect(why(act(w, JORDAN, "shares_classes", { business: EMR, label: "Non-voting", votes: 0, holder: DANNY }))).toBe("");
    expect(w.state.entities[EMR]?.fields.share_classes).toEqual([
      { id: "common", label: "Common", votes: 1 },
      { id: "non_voting", label: "Non-voting", votes: 0 },
    ]);
    expect(votesIn(w.state, EMR)).toEqual({ [JORDAN]: 100, [DANNY]: 0 });
    expect(worthShares(ownersIn(w.state.entities[EMR]?.fields ?? {}))).toEqual({ [JORDAN]: 60, [DANNY]: 40 });
  });
});

describe("a company that counts no units", () => {
  test("Alder Automotive sells, shares its worth and pays out exactly as before", () => {
    const w = portAlder();
    expect(why(act(w, MARCUS, "stake_sell", { business: SHOP, share: 25, price: 200_000, buyer: JORDAN }))).toBe("");
    expect(owners(w, SHOP)).toEqual([
      { party: MARCUS, role: "owner", share: 75 },
      { party: JORDAN, role: "owner", share: 25 },
    ]);
    expect(worthShares(ownersIn(w.state.entities[SHOP]?.fields ?? {}))).toEqual({ [MARCUS]: 75, [JORDAN]: 25 });
    expect(votesIn(w.state, SHOP)).toEqual({ [MARCUS]: 75, [JORDAN]: 25 });
    // A payout of $1,000 by share: $750 and $250.
    const paid = act(w, MARCUS, "distribute_profit", { business: SHOP, amount: 100_000 });
    expect(why(paid)).toBe("");
    const lines = paid.events.flatMap((e) => (e.type === "post" ? e.lines : []));
    expect(lines.filter((l) => l.amount > 0).map((l) => l.amount).sort((a, b) => a - b)).toEqual([25_000, 75_000]);
  });
});
