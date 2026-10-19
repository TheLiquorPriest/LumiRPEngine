// The money foundation's rules (DESIGN §25), folded: who may pay from what, what a flow's
// shortfall policies do, what the statement cycle carries, and what the player may see. Each block
// pins one rule against the books a timelapse leaves.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import type { EntityDef, WorldDoc } from "../../../src/shared/world";
import { lintWorld } from "../../../src/engine/authoring";
import { calendarOf, dateAt } from "../../../src/engine/calendar";
import { materializeAll } from "../../../src/engine/materialize";
import { createRegistry, type Registry } from "../../../src/engine/registry-impl";
import { resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { move } from "../../../src/packs/economy/core/pay";
import { ALL_PACKS } from "../../../src/packs/index";
import { modernUsWorld } from "../riverton";
import { startState, trialBalance } from "../support";

const reg: Registry = createRegistry(ALL_PACKS);
const DAY = 1440;

function entity(id: string, kind: string, fields: JsonObject): EntityDef {
  return { id, kind, name: id.replace(/_/g, " "), tier: "background", fields, relations: [] };
}

/** Riverton at Money 4, the POV's money opened, and anyone in `also` opened too. */
function setup(patch: (w: WorldDoc) => void = () => undefined, also: string[] = []): Working {
  const world = modernUsWorld("w", "Riverton");
  patch(world);
  const w = new Working(reg, world, startState(world));
  materializeAll(reg, w, world.pov, "run");
  for (const id of also) materializeAll(reg, w, id, "run");
  return w;
}

function lapse(w: Working, days: number): void {
  const out = runTimelapse(reg, w, { type: "duration", minutes: days * DAY }, { runSeed: "run", overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } });
  if ("code" in out) throw new Error(out.reason);
}

function dataOf(w: Working, type: string): JsonObject[] {
  return w.events.flatMap((e) => (e.type === type && "data" in e ? [e.data] : []));
}

function flowRuns(w: Working, flow: string): JsonObject[] {
  return dataOf(w, "economy.flow_run").filter((d) => d.flow === flow);
}

const mayaChecking = (world: WorldDoc): void => {
  world.entities.maya_checking = entity("maya_checking", "account", { owners: [{ party: "maya", role: "owner" }], product: "checking", opening: 500_000 });
};

describe("a flow's fallback is the payer's own", () => {
  test("flow_create refuses a fallback that's an outside name or someone else's account", () => {
    const w = setup(mayaChecking, ["maya"]);
    for (const fallback of ["Lottery", "maya_checking"]) {
      resolveAction(reg, w, { action: "flow_create", params: { label: `Top up ${fallback}`, from: "checking", to: "savings", amount: 300_000, every: "day", shortfall: "fallback", fallback } }, createRng(`fb:${fallback}`));
    }
    expect(Object.values(w.state.entities).filter((e) => e.kind === "flow")).toEqual([]);
  });

  test("an authored flow never falls back on outside money or a stranger's account", () => {
    const w = setup((world) => {
      mayaChecking(world);
      world.entities.mint = entity("mint", "flow", { flow_kind: "transfer", from: "checking", to: "savings", amount_cents: 1_000_000, every: "day", shortfall: "fallback", fallback: "Lottery", status: "active" });
      world.entities.drain = entity("drain", "flow", { flow_kind: "transfer", from: "checking", to: "savings", amount_cents: 300_000, once: "2026-10-17T09:00", shortfall: "fallback", fallback: "maya_checking", status: "active" });
    }, ["maya"]);
    const [savings, maya] = [w.state.accounts.savings ?? 0, w.state.accounts.maya_checking ?? 0];
    lapse(w, 3);
    expect(w.state.accounts.savings ?? 0).toBe(savings);
    expect(w.state.accounts.maya_checking ?? 0).toBe(maya);
    expect(w.state.accounts["economy.external:lottery"] ?? 0).toBe(0);
    expect(flowRuns(w, "drain").map((r) => r.outcome)).toEqual(["declined"]);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("the payer's own savings carries a payment checking can't cover", () => {
    const w = setup((world) => {
      world.entities.rent = entity("rent", "flow", { flow_kind: "bill", from: "checking", to: "Landlord", amount_cents: 300_000, once: "2026-10-17T09:00", shortfall: "fallback", fallback: "savings", status: "active" });
    });
    const [checking, savings] = [w.state.accounts.checking ?? 0, w.state.accounts.savings ?? 0];
    lapse(w, 2);
    expect(flowRuns(w, "rent").map((r) => r.outcome)).toEqual(["fallback"]);
    expect([w.state.accounts.checking, w.state.accounts.savings]).toEqual([checking, savings - 300_000]);
  });

  test("lint: a fallback that names nothing in the world is an error", () => {
    const world = modernUsWorld("w", "Riverton");
    world.entities.mint = entity("mint", "flow", { flow_kind: "transfer", from: "checking", to: "savings", amount_cents: 1000, every: "day", shortfall: "fallback", fallback: "Lottery", status: "active" });
    expect(lintWorld(world, reg).filter((i) => i.path === "entities.mint.fields.fallback")).toEqual([expect.objectContaining({ severity: "error" })]);
  });
});

describe("the player's money view never names or sends someone they can't see", () => {
  const secret = (world: WorldDoc): void => {
    world.entities.viktor = { id: "viktor", kind: "person", name: "Viktor Kane", tier: "supporting", visibility: "secret", fields: { place: "cafe", wealth: "rich" }, relations: [] } as EntityDef;
    world.entities.joint = entity("joint", "account", { owners: [{ party: "you", role: "joint" }, { party: "maya", role: "joint" }], product: "checking", opening: 150_000 });
    world.entities.shared = entity("shared", "account", { owners: [{ party: "you", role: "joint" }, { party: "viktor", role: "joint" }], product: "savings", opening: 10_000 });
    world.entities.viktor_checking = entity("viktor_checking", "account", { owners: [{ party: "viktor", role: "owner" }], product: "checking", opening: 10_000 });
    world.entities.hush = entity("hush", "flow", { flow_kind: "transfer", from: "joint", to: "viktor", amount_cents: 20_000, once: "2026-10-17T09:00", shortfall: "skip", status: "active" });
  };

  test("a hidden payee, co-owner and flow side reach the player as \"someone\", with no id", () => {
    const w = setup(secret);
    lapse(w, 2);
    expect(flowRuns(w, "hush").map((r) => r.outcome)).toEqual(["paid"]);
    const view = w.ctx.query("economy.finance")(w.ctx, "you", true);
    expect(JSON.stringify(view).toLowerCase()).not.toContain("viktor");
    const shared = view.accounts.find((a) => a.id === "shared");
    expect(shared?.owners.find((o) => o.name === "someone")?.party).toBeNull();
    const joint = view.accounts.find((a) => a.id === "joint");
    expect(joint?.transactions.find((t) => t.cents === -20_000)?.counterparty).toBe("someone");
    const hush = view.flows.find((f) => f.id === "hush");
    expect([hush?.to, hush?.spec, hush?.payer]).toEqual(["someone", null, "joint"]);
  });

  test("the GM sees every name and id", () => {
    const w = setup(secret);
    lapse(w, 2);
    const view = w.ctx.query("economy.finance")(w.ctx, "you", false);
    expect(view.accounts.find((a) => a.id === "shared")?.owners.map((o) => o.party)).toEqual(["you", "viktor"]);
    expect(view.accounts.find((a) => a.id === "joint")?.transactions.find((t) => t.cents === -20_000)?.counterparty).toBe("Viktor Kane");
    expect(view.flows.find((f) => f.id === "hush")?.spec?.to).toBe("viktor");
  });
});

describe("a late payment counts toward what was past due", () => {
  test("the past-due minimum paid late isn't asked for again, and the next minimum paid on time keeps the card current", () => {
    const w = setup((world) => {
      world.entities.card!.fields.autopay = "none";
    });
    const statements = (): JsonObject[] => dataOf(w, "economy.statement").filter((s) => s.account === "card");
    const pay = (cents: number): void => {
      const out = move(w.ctx, "checking", "card", cents, "Card payment");
      if ("code" in out) throw new Error(out.reason);
      w.applyAll(out);
    };
    lapse(w, 44); // past the 28 Nov due date of the 3 Nov statement, unpaid
    expect(dataOf(w, "economy.delinquency").map((d) => d.stage)).toEqual(["late"]);
    pay(Number(statements()[0]?.minimum));
    lapse(w, 6); // the 3 Dec statement
    const dec = statements().at(-1);
    expect(dec?.past_due).toBe(0);
    pay(Number(dec?.minimum));
    lapse(w, 24); // past 28 Dec
    expect(dataOf(w, "economy.delinquency").map((d) => d.stage)).toEqual(["late", "current"]);
  });
});

describe("a loan's autopay pays its bills, never before the first", () => {
  test("a loan taken this morning isn't repaid by its own autopay; its first bill is paid at the minimum", () => {
    const w = setup((world) => {
      world.realism.levels.money = 3;
    });
    resolveAction(reg, w, { action: "apply_credit", params: { product: "loan", amount: 100_000 } }, createRng("loan"));
    const loan = Object.keys(w.state.entities).find((id) => w.state.entities[id]?.kind === "account" && w.state.entities[id]?.fields.product === "loan");
    if (!loan) throw new Error("no loan");
    lapse(w, 1);
    expect(w.state.accounts[loan]).toBe(-100_000);
    lapse(w, 31);
    const bills = dataOf(w, "economy.statement").filter((s) => s.account === loan);
    const paid = flowRuns(w, `autopay:${loan}`).filter((r) => r.outcome === "paid");
    expect(bills).toHaveLength(1);
    expect(paid.map((r) => r.cents)).toEqual([bills[0]?.minimum]);
  });

  test("with no due day, autopay falls on the product's statement day, as the bill does", () => {
    const w = setup((world) => {
      world.packs.economy!.config.products = { fleet_loan: { class: "loan", label: "Fleet loan", statement_day: 20 } };
      world.entities.fleet = entity("fleet", "account", { owners: [{ party: "you", role: "owner" }], product: "fleet_loan", opening: -60_000, apr_pct: 6, term_months: 6, months_left: 6, autopay: "minimum", autopay_from: "checking" });
    });
    lapse(w, 40);
    const cal = calendarOf(w.world);
    const days = (rows: JsonObject[]): number[] => rows.map((r) => dateAt(cal, Number(r.at)).day);
    const bills = dataOf(w, "economy.statement").filter((s) => s.account === "fleet");
    expect(bills.length).toBeGreaterThan(0);
    expect(days(bills).every((d) => d === 20)).toBe(true);
    expect(days(flowRuns(w, "autopay:fleet"))).toEqual(days(bills));
  });
});

describe("a flow into overdraft follows the account's overdraft policy", () => {
  const big = entity("big", "flow", { flow_kind: "bill", from: "checking", to: "Landlord", amount_cents: 250_000, once: "2026-10-17T09:00", shortfall: "overdraft", status: "active" });

  test("a fee policy pays the gap up to its limit and charges the overdraft fee", () => {
    const w = setup((world) => {
      Object.assign(world.entities.checking!.fields, { overdraft: "fee", overdraft_limit: 100_000 });
      world.entities.big = big;
    });
    lapse(w, 2);
    const fees = w.events.filter((e) => e.type === "economy.txn" && "data" in e && e.data.category === "overdraft");
    expect(fees).toHaveLength(1);
    expect(w.state.accounts.checking).toBe(214_000 - 250_000 - 2700);
    expect(trialBalance(w.state)).toBe(0);
  });

  test("a linked policy draws the gap from the linked account, and checking doesn't go below nothing", () => {
    const w = setup((world) => {
      Object.assign(world.entities.checking!.fields, { overdraft: "linked", overdraft_link: "savings" });
      world.entities.big = big;
    });
    const savings = w.state.accounts.savings ?? 0;
    lapse(w, 2);
    expect(w.state.accounts.checking).toBe(0);
    expect(w.state.accounts.savings).toBe(savings - (250_000 - 214_000));
  });
});

describe("a flow into credit pays at most what it owes", () => {
  test("a fixed autopay larger than the balance pays the balance, then nothing while the card owes nothing", () => {
    const w = setup((world) => {
      Object.assign(world.entities.card!.fields, { autopay: "fixed", autopay_cents: 100_000, autopay_from: "checking" });
    });
    lapse(w, 45);
    const runs = flowRuns(w, "autopay:card");
    expect(runs.map((r) => [r.outcome, r.cents])).toEqual([["paid", 38_000]]);
    expect(w.state.accounts.card).toBe(0);
  });

  test("a standing payment to a paid-off card doesn't run", () => {
    const w = setup((world) => {
      world.entities.card!.fields.opening = 0;
      world.entities.card!.fields.autopay = "none";
      world.entities.extra = entity("extra", "flow", { flow_kind: "card_payment", from: "checking", to: "card", amount_cents: 5_000, every: "week", weekdays: [1], shortfall: "skip", status: "active" });
    });
    lapse(w, 10);
    expect(flowRuns(w, "extra")).toEqual([]);
    expect(w.state.accounts.card ?? 0).toBe(0);
  });
});
