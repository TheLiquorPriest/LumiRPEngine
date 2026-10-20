// The money foundation's rules (DESIGN §25), folded: who may pay from what, what a flow's
// shortfall policies do, what the statement cycle carries, and what the player may see. Each block
// pins one rule against the books a timelapse leaves.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import type { EntityDef, WorldDoc } from "../../../src/shared/world";
import { lintWorld } from "../../../src/engine/authoring";
import { calendarOf, dateAt } from "../../../src/engine/calendar";
import { applyEffects } from "../../../src/engine/effects";
import { applyValidUnits } from "../../../src/engine/events";
import { materializeAll } from "../../../src/engine/materialize";
import { optionalService } from "../../../src/engine/pack-kit";
import { playerLines } from "../../../src/engine/player-events";
import { createRegistry, type Registry } from "../../../src/engine/registry-impl";
import { resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { runTimelapse } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { closeAccount, setStatus, withdraw } from "../../../src/packs/economy/core/actions";
import { flowOfEntity } from "../../../src/packs/economy/core/flows";
import { statusOf } from "../../../src/packs/economy/core/model";
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

describe("a shared flow's shares pay together or not at all", () => {
  const rent = (opening: number) => (world: WorldDoc): void => {
    world.entities.joint = entity("joint", "account", { owners: [{ party: "you", role: "joint" }, { party: "maya", role: "joint" }], product: "checking", opening });
    world.entities.rent = entity("rent", "flow", { flow_kind: "rent", from: "joint", to: "Landlord", amount_cents: 200_000, shares: [{ party: "you", pct: 60, from: "joint" }, { party: "maya", pct: 40, from: "joint" }], every: "month", days: [1], shortfall: "skip", status: "active" });
  };

  // The rent itself, not the returned-item fee a bounced rent brings.
  const rentLines = (w: Working): JsonObject[] => dataOf(w, "economy.txn").filter((t) => t.flow === "rent" && t.kind !== "fee");

  test("two shares from one account that covers only the first are skipped whole, and nothing moves", () => {
    const w = setup(rent(150_000));
    lapse(w, 17);
    expect(flowRuns(w, "rent").map((r) => [r.outcome, r.cents])).toEqual([["skipped", 0]]);
    expect(w.state.accounts["economy.external:landlord"] ?? 0).toBe(0);
    expect(rentLines(w)).toEqual([]);
  });

  test("an account that covers both pays the whole rent, each share on its own line", () => {
    const w = setup(rent(250_000));
    lapse(w, 17);
    expect(flowRuns(w, "rent").map((r) => [r.outcome, r.cents])).toEqual([["paid", 200_000]]);
    expect(w.state.accounts["economy.external:landlord"]).toBe(200_000);
    expect(rentLines(w).map((t) => t.lines)).toEqual([[{ account: "joint", amount: -120_000 }], [{ account: "joint", amount: -80_000 }]]);
  });
});

describe("what a module's flow defers is paid with its next occurrence", () => {
  test("a property tax instalment that can't be paid is added to the next one", () => {
    const w = setup((world) => {
      world.entities.checking!.fields.opening = 0;
      world.entities.savings!.fields.opening = 0;
      delete world.entities.card;
      world.entities.cabin = { id: "cabin", kind: "property", name: "The cabin", tier: "background", fields: { place: "apartment", owners: [{ party: "you", role: "owner", share: 100 }], value: 30_000_000, tax_pct: 1.2, tax_installments: 12, appreciation_pct: 0, volatility_pct: 0 }, relations: [] };
    });
    lapse(w, 18); // the 1 Nov instalment finds nothing to pay with
    const add = optionalService(w.ctx, "economy.adjust")?.(w.ctx, "checking", 1_000_000);
    if (!add || "code" in add) throw new Error("no adjust");
    w.applyAll(add);
    lapse(w, 30);
    expect(flowRuns(w, "property_tax:cabin").map((r) => [r.outcome, r.cents])).toEqual([
      ["deferred", 0],
      ["paid", 60_000],
    ]);
    expect(trialBalance(w.state)).toBe(0);
  });
});

describe("Custom toggles decide what the money view shows and how shares split", () => {
  const features = (world: WorldDoc, set: JsonObject): void => {
    world.packs.economy!.config.features = set;
  };
  const finance = (w: Working) => w.ctx.query("economy.finance")(w.ctx, "you", true);

  test("statements and credit turned off at Money 4 leave the view with no statements, due line or credit report", () => {
    const w = setup((world) => features(world, { credit: false }));
    lapse(w, 20); // the card's 3 Nov statement closes
    expect(finance(w).accounts.find((a) => a.id === "card")?.statements.length).toBeGreaterThan(0);
    // The author turns statements off later: what closed stays in the books, out of the view.
    features(w.world, { credit: false, statements: false });
    const view = finance(w);
    const card = view.accounts.find((a) => a.id === "card");
    expect([card?.statements, card?.due, view.credit]).toEqual([[], null, null]);
  });

  test("a feature turned on below Money 4 shows itself without turning on full detail", () => {
    const w = setup((world) => {
      world.realism.levels.money = 3;
      features(world, { holds: true });
    });
    const view = finance(w);
    expect(view.detail).toBe(false);
    expect(view.features).toContain("holds");
  });

  test("with household shares off, a shared flow is paid whole by its payer and the view has no household", () => {
    const w = setup((world) => {
      features(world, { households: false });
      world.entities.home = { id: "home", kind: "household", name: "Our place", tier: "background", fields: {}, relations: [] };
      world.entities.you!.relations.push({ type: "member_of", to: "home" });
      world.entities.joint = entity("joint", "account", { owners: [{ party: "you", role: "joint" }, { party: "maya", role: "joint" }], product: "checking", opening: 250_000 });
      world.entities.rent = entity("rent", "flow", { flow_kind: "rent", from: "joint", to: "Landlord", amount_cents: 200_000, shares: [{ party: "you", pct: 60, from: "joint" }, { party: "maya", pct: 40, from: "joint" }], every: "month", days: [1], shortfall: "skip", status: "active" });
    });
    lapse(w, 17);
    const rent = dataOf(w, "economy.txn").filter((t) => t.flow === "rent");
    expect(rent.map((t) => t.lines)).toEqual([[{ account: "joint", amount: -200_000 }]]);
    expect(finance(w).household).toBeNull();
  });
});

describe("one check decides which accounts a payment may use", () => {
  // Done: the action went through and none of its effects was refused.
  const act = (w: Working, action: string, params: JsonObject): boolean => {
    const r = resolveAction(reg, w, { action, params }, createRng(`${action}:${JSON.stringify(params)}`));
    return r.ok && r.rejected.length === 0;
  };

  test("nothing is moved or paid in cash into a closed account, where it couldn't come out", () => {
    const w = setup();
    expect(act(w, "move_money", { from: "savings", to: "checking", amount: w.state.accounts.savings ?? 0 })).toBe(true);
    w.applyAll([{ type: "economy.status", data: { account: "savings", status: "closed" } }]);
    expect(act(w, "move_money", { from: "checking", to: "savings", amount: 50_000 })).toBe(false);
    expect(act(w, "deposit_cash", { account: "savings", amount: 1_000 })).toBe(false);
    expect(w.state.accounts.savings ?? 0).toBe(0);
  });

  test("a CD takes nothing in after it opens, and a retirement account gives nothing out here but takes money in", () => {
    const w = setup((world) => {
      world.entities.cd = entity("cd", "account", { owners: [{ party: "you", role: "owner" }], product: "cd", opening: 100_000 });
      world.entities.ira = entity("ira", "account", { owners: [{ party: "you", role: "owner" }], product: "retirement", opening: 500_000 });
    });
    expect(act(w, "move_money", { from: "checking", to: "cd", amount: 10_000 })).toBe(false);
    expect(act(w, "move_money", { from: "ira", to: "checking", amount: 10_000 })).toBe(false);
    expect(act(w, "move_money", { from: "checking", to: "ira", amount: 10_000 })).toBe(true);
    expect([w.state.accounts.cd, w.state.accounts.ira]).toEqual([100_000, 510_000]);
  });
});

describe("a lender extends no more than the applicant's score earns", () => {
  const apply = (w: Working, params: JsonObject): void => {
    resolveAction(reg, w, { action: "apply_credit", params }, createRng(`credit:${JSON.stringify(params)}`));
  };
  const opened = (w: Working, cls: string): JsonObject[] => Object.values(w.state.entities).flatMap((e) => (e.kind === "account" && e.fields.product === cls ? [e.fields] : []));
  const declines = (w: Working): string[] => dataOf(w, "engine.signal").flatMap((d) => (d.class === "decline" ? [String(d.text)] : []));

  test("an unsecured loan larger than a lender lends is declined and pays nothing out; one within it is paid out", () => {
    const w = setup();
    const checking = w.state.accounts.checking ?? 0;
    apply(w, { product: "loan", amount: 10_000_000_000 });
    expect([opened(w, "loan"), w.state.accounts.checking]).toEqual([[], checking]);
    expect(declines(w).at(-1)).toContain("more than a lender would lend");
    apply(w, { product: "loan", amount: 2_000_000 });
    expect(opened(w, "loan")).toHaveLength(1);
    expect(w.state.accounts.checking).toBe(checking + 2_000_000);
  });

  test("below Money 4, without credit reports, the same ceiling holds", () => {
    const w = setup((world) => {
      world.realism.levels.money = 3;
    });
    apply(w, { product: "loan", amount: 10_000_000_000 });
    expect(opened(w, "loan")).toEqual([]);
  });

  test("a charge card applied for with no amount gets a limit it can be used to", () => {
    const w = setup();
    apply(w, { product: "charge_card" });
    const [charge] = opened(w, "charge_card");
    expect(Number(charge?.limit)).toBeGreaterThan(0);
  });
});

describe("an outside payee is one outside account whoever pays it", () => {
  test("a person's payment and an account's to the same outside payee land in the same outside account", () => {
    const w = setup((world) => {
      const bills: [string, string, string][] = [
        ["by_person", "you", "tax:federal"],
        ["by_account", "checking", "tax:federal"],
        ["by_id", "you", "economy.external:tax:federal"],
        ["gym_person", "you", "Harbor_Gym"],
        ["gym_account", "checking", "Harbor Gym"],
      ];
      for (const [id, from, to] of bills) world.entities[id] = entity(id, "flow", { flow_kind: "bill", from, to, amount_cents: 1_000, once: "2026-10-17T09:00", shortfall: "skip", status: "active" });
    });
    lapse(w, 2);
    const outside = Object.entries(w.state.accounts).filter(([id, cents]) => id.startsWith("economy.external:") && cents !== 0 && /tax|gym/.test(id));
    expect(Object.fromEntries(outside)).toEqual({ "economy.external:tax:federal": 3_000, "economy.external:harbor_gym": 2_000 });
  });
});

describe("a standing payment can be renamed and have its limits cleared", () => {
  const gym = (world: WorldDoc): void => {
    world.entities.gym = { ...entity("gym", "flow", { flow_kind: "subscription", from: "checking", to: "Harbor Gym", amount_cents: 4_000, every: "month", days: [5], end: "2027-06-30", count: 12, category: "fitness", shortfall: "skip", status: "active" }), name: "Harbor Gym" };
  };

  test("the player's change renames it and clears its end and count, and it runs past them", () => {
    const w = setup(gym);
    const r = resolveAction(reg, w, { action: "flow_update", params: { flow: "gym", label: "Gym", clear: "end,count" } }, createRng("rename"));
    expect([r.ok, r.rejected]).toEqual([true, []]);
    const flow = flowOfEntity(w.ctx, "gym");
    expect([flow?.label, flow?.end, flow?.count, flow?.category]).toEqual(["Gym", undefined, undefined, "fitness"]);
  });

  test("a change can't clear what isn't clearable, or change and clear one field at once", () => {
    const w = setup(gym);
    const changes: JsonObject[] = [
      { flow: "gym", clear: "amount" },
      { flow: "gym", end: "2027-12-31", clear: "end" },
    ];
    for (const params of changes) {
      const r = resolveAction(reg, w, { action: "flow_update", params }, createRng(JSON.stringify(params)));
      expect(r.ok && r.rejected.length === 0).toBe(false);
    }
    expect(flowOfEntity(w.ctx, "gym")?.end).toBe("2027-06-30");
  });

  test("the GM renames anyone's standing payment and clears its fallback with economy.flow_edit", () => {
    const w = setup((world) => {
      mayaChecking(world);
      world.entities.rent = { ...entity("rent", "flow", { flow_kind: "rent", from: "maya_checking", to: "Landlord", amount_cents: 90_000, every: "month", days: [1], shortfall: "fallback", fallback: "maya", status: "active" }), name: "Rent" };
    }, ["maya"]);
    const out = applyEffects(reg, w, [{ type: "economy.flow_edit", args: { flow: "rent", name: "Maya's rent", clear: "fallback" } }], { bindings: {}, rng: createRng("gm") });
    expect(out.rejected).toEqual([]);
    const flow = flowOfEntity(w.ctx, "rent");
    expect([flow?.label, flow?.fallback]).toEqual(["Maya's rent", undefined]);
  });
});

describe("only a role that manages an account runs standing payments from it", () => {
  const authorized = (world: WorldDoc): void => {
    world.entities.checking!.fields.owners = [
      { party: "you", role: "owner" },
      { party: "maya", role: "authorized_user" },
    ];
    delete world.entities.checking!.fields.owner;
    world.entities.save = entity("save", "flow", { flow_kind: "transfer", from: "checking", to: "savings", amount_cents: 5_000, every: "week", weekdays: [1], shortfall: "skip", status: "active" });
  };
  const done = (w: Working, actor: string, action: string, params: JsonObject): boolean => {
    const r = resolveAction(reg, w, { action, actor, params }, createRng(`${actor}:${action}`));
    return r.ok && r.rejected.length === 0;
  };

  test("an authorized user can't set up, change or pause a standing payment out of the primary's checking", () => {
    const w = setup(authorized, ["maya"]);
    expect(done(w, "maya", "flow_create", { label: "To me", from: "checking", to: "maya", amount: 5_000, every: "week" })).toBe(false);
    expect(done(w, "maya", "flow_update", { flow: "save", amount: 1 })).toBe(false);
    expect(done(w, "maya", "flow_pause", { flow: "save" })).toBe(false);
    expect(Object.values(w.state.entities).filter((e) => e.kind === "flow").map((e) => [e.fields.amount_cents, e.fields.status])).toEqual([[5_000, "active"]]);
  });

  test("the owner still can", () => {
    const w = setup(authorized, ["maya"]);
    expect(done(w, "you", "flow_pause", { flow: "save" })).toBe(true);
  });
});

describe("a card is paid from the payer's own account", () => {
  const shared = (role: "authorized_user" | "joint") => (world: WorldDoc): void => {
    mayaChecking(world);
    world.entities.card!.fields.owners = [
      { party: "you", role: "owner" },
      { party: "maya", role },
    ];
    delete world.entities.card!.fields.owner;
  };
  const pay = (w: Working, params: JsonObject): boolean => {
    const r = resolveAction(reg, w, { action: "pay_card", actor: "maya", params }, createRng(`pay:${JSON.stringify(params)}`));
    return r.ok && r.rejected.length === 0;
  };

  test("an authorized user's payment comes out of their own checking, not the primary's", () => {
    const w = setup(shared("authorized_user"), ["maya"]);
    const [checking, maya, card] = [w.state.accounts.checking, w.state.accounts.maya_checking ?? 0, w.state.accounts.card ?? 0];
    expect(pay(w, { card: "card", amount: 1_000 })).toBe(true);
    expect([w.state.accounts.checking, w.state.accounts.maya_checking, w.state.accounts.card]).toEqual([checking, maya - 1_000, card + 1_000]);
  });

  test("a joint holder can't name the other holder's own account to pay from", () => {
    const w = setup(shared("joint"), ["maya"]);
    const checking = w.state.accounts.checking;
    expect(pay(w, { card: "card", from: "checking", amount: 1_000 })).toBe(false);
    expect(w.state.accounts.checking).toBe(checking);
  });
});

describe("a returned-payment fee is charged only when the money wasn't there", () => {
  const gym = (world: WorldDoc): void => {
    world.entities.gym = entity("gym", "flow", { flow_kind: "bill", from: "checking", to: "Harbor Gym", amount_cents: 5_000, every: "day", shortfall: "skip", status: "active" });
  };
  const fees = (w: Working): JsonObject[] => dataOf(w, "economy.txn").filter((t) => t.category === "nsf");

  test("a flow from a closed account is declined with no fee on it", () => {
    const w = setup(gym);
    w.applyAll([{ type: "economy.status", data: { account: "checking", status: "closed" } }]);
    lapse(w, 3);
    expect(flowRuns(w, "gym").length).toBeGreaterThan(0);
    expect(fees(w)).toEqual([]);
  });

  test("a flow an open account can't cover bounces with the fee", () => {
    const w = setup((world) => {
      gym(world);
      world.entities.checking!.fields.opening = 1_000;
    });
    lapse(w, 1);
    expect(fees(w).length).toBeGreaterThan(0);
  });
});

describe("a cash withdrawal's fees never let the cash past the funds check", () => {
  test("a withdrawal the account can no longer cover is dropped whole at the fold, fees and all", () => {
    const w = setup((world) => {
      world.entities.debit = entity("debit", "card", { account: "checking", holder: "you", network: "debit", state: "active" });
      const place = world.places[String(world.entities.you!.fields.place ?? world.start.place)]!;
      place.fields = { ...place.fields, atm: { bank: "Lakeside Bank", fee: 300, limit: 20_000 } };
    });
    const out = withdraw(w.ctx, "you", "checking", 20_000);
    if ("code" in out) throw new Error(out.reason);
    // The fees and the cash are two postings in one unit.
    expect(out.flatMap((e) => (e.type === "economy.txn" && "data" in e ? [e.data.kind] : []))).toEqual(["fee", "withdrawal"]);
    // Another posting drains checking first, as a rebased view would see it.
    const drain = optionalService(w.ctx, "economy.adjust")?.(w.ctx, "checking", -(w.state.accounts.checking ?? 0) + 1_000);
    if (!drain || "code" in drain) throw new Error("no adjust");
    w.applyAll(drain);
    expect(applyValidUnits(reg, out, w.state, (s) => reg.context(w.world, s))).toEqual([]);
    expect(w.state.accounts.checking).toBe(1_000);
  });
});

describe("a payment waiting to be retried outlives the occurrences after it", () => {
  test("a week's transfer that bounced is retried after the next week's goes through, and both are paid", () => {
    const w = setup((world) => {
      world.entities.save = entity("save", "flow", { flow_kind: "transfer", from: "checking", to: "savings", amount_cents: 300_000, every: "week", weekdays: [1], shortfall: "retry", retry_days: 10, retries: 2, status: "active" });
    });
    const savings = w.state.accounts.savings ?? 0;
    lapse(w, 4); // Mon 19 Oct bounces; its retry is 29 Oct
    const add = optionalService(w.ctx, "economy.adjust")?.(w.ctx, "checking", 500_000);
    if (!add || "code" in add) throw new Error("no adjust");
    w.applyAll(add);
    lapse(w, 11); // Mon 26 Oct pays, and the retry on the 29th pays the 19th's
    expect(flowRuns(w, "save").map((r) => r.outcome)).toEqual(["retry", "paid", "paid"]);
    expect(w.state.accounts.savings).toBe(savings + 600_000);
  });
});

describe("someone else's credit is theirs alone", () => {
  test("the player's lines carry their own monthly score, never a known NPC's", () => {
    const w = setup((world) => {
      world.entities.maya_card = entity("maya_card", "account", { owners: [{ party: "maya", role: "owner" }], product: "credit_card", limit: 300_000, opening: -50_000 });
      world.entities.you!.relations.push({ type: "knows", to: "maya" });
    }, ["maya"]);
    const start = w.events.length;
    lapse(w, 17); // past 1 Nov, when scores are worked out
    const scores = w.events.slice(start).filter((e) => e.type === "economy.score");
    expect(new Set(scores.flatMap((e) => ("data" in e ? [e.data.person] : [])))).toEqual(new Set(["you", "maya"]));
    expect(playerLines(reg, w.world, w.state, "you", scores, 20)).toHaveLength(1);
  });
});

describe("a partial payment pays what the payer's own way of paying can", () => {
  test("living costs with a little in checking and a lot in savings pay part from checking and leave savings alone", () => {
    const w = setup((world) => {
      world.entities.rosa_checking = entity("rosa_checking", "account", { owners: [{ party: "rosa", role: "owner" }], product: "checking", opening: 3_000 });
      world.entities.rosa_savings = entity("rosa_savings", "account", { owners: [{ party: "rosa", role: "owner" }], product: "savings", opening: 1_000_000 });
    }, ["rosa"]);
    lapse(w, 4); // Monday 19 Oct
    const [run] = flowRuns(w, "living:rosa");
    expect(run?.outcome).toBe("partial");
    expect(Number(run?.cents)).toBeGreaterThan(0);
    expect(w.state.accounts.rosa_savings).toBe(1_000_000);
  });
});

describe("an account isn't closed with money still to come into it", () => {
  const rosa = (world: WorldDoc): void => {
    world.entities.rosa_checking = entity("rosa_checking", "account", { owners: [{ party: "rosa", role: "owner" }], product: "checking", opening: 195_000 });
  };

  test("an account whose opening hasn't posted can't be closed, and the opening lands in it open", () => {
    const w = setup(rosa);
    for (const close of [closeAccount(w.ctx, "rosa_checking"), setStatus(w.ctx, "rosa_checking", "closed")]) expect("code" in close && close.code).toBe("not_empty");
    lapse(w, 1);
    expect(w.state.accounts.rosa_checking).toBe(195_000);
    expect(statusOf(w.state, "rosa_checking")).toBe("open");
  });

  test("once it's emptied it closes", () => {
    const w = setup(rosa, ["rosa"]);
    const empty = optionalService(w.ctx, "economy.adjust")?.(w.ctx, "rosa_checking", -(w.state.accounts.rosa_checking ?? 0));
    if (!empty || "code" in empty) throw new Error("no adjust");
    w.applyAll(empty);
    const close = closeAccount(w.ctx, "rosa_checking");
    if ("code" in close) throw new Error(close.reason);
    w.applyAll(close);
    expect(statusOf(w.state, "rosa_checking")).toBe("closed");
  });
});
