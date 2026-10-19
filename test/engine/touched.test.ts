// The touched record (DESIGN §4.3 `migrate`): what applied events wrote of entities' definitions,
// kept inside event apply, names only.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import { blankWorld, migrateWorld } from "../../src/engine/authoring";
import { applyEvent, applyMarker, coreEventTypes, EXTERNAL_ACCOUNT_PREFIX, validateEvent } from "../../src/engine/events";
import { own } from "../../src/engine/pack-kit";
import type { CoreRegistry, EventTypeDef, Touch } from "../../src/engine/registry";
import { createRegistry } from "../../src/engine/registry-impl";
import type { WorldState } from "../../src/engine/state";
import { touchedAspect, touchedField, touchedRelation } from "../../src/engine/touched";
import { initialState } from "../../src/engine/world-state";
import { ALL_PACKS } from "../../src/packs/index";
import { baseWorld, fold, POV, startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

/** The base world with a checking account for Sam. */
function world(): WorldDoc {
  const w = baseWorld();
  w.entities.acct = { id: "acct", kind: "account", name: "Sam's checking", tier: "background", fields: { owner: POV, type: "checking", opening: 5000 }, relations: [] };
  return w;
}

function played(events: Parameters<typeof fold>[3]): WorldState {
  const w = world();
  return fold(reg, w, startState(w, reg), events);
}

describe("the touched record", () => {
  test("names the fields, relations, levels, new entities and balances applied events wrote, never values", () => {
    const state = played([
      { type: "set", entity: "dev", field: "place", value: "home" },
      { type: "add", entity: POV, field: "cash", delta: -10 },
      { type: "link", rel: "knows", from: POV, to: "dev" },
      { type: "spawn", entity: { id: "coin", kind: "person", name: "Coin", tier: "background", fields: {}, relations: [] } },
      { type: "engine.entity", data: { entity: "dev", tier: "supporting" } },
      { type: "post", lines: [{ account: "acct", amount: -300 }, { account: `${EXTERNAL_ACCOUNT_PREFIX}shop`, amount: 300 }], memo: "Bought a lamp" },
    ]);
    applyMarker(state, { kind: "resolve", domain: "money", scope: { entity: POV }, to: 2 });
    expect(touchedField(state, "dev", "place")).toBe(true);
    expect(touchedField(state, "dev", "home")).toBe(false);
    expect(touchedField(state, POV, "cash")).toBe(true);
    expect(touchedRelation(state, POV, "knows", "dev")).toBe(true);
    expect(touchedAspect(state, "coin", "spawned")).toBe(true);
    expect(touchedAspect(state, "dev", "tier")).toBe(true);
    expect(touchedAspect(state, "dev", "agent")).toBe(false);
    expect(touchedAspect(state, POV, "levels")).toBe(true);
    expect(touchedAspect(state, "acct", "posted")).toBe(true);
    // Names only: none of the values written is in it.
    for (const value of ['"home"', "supporting", "lamp"]) expect(JSON.stringify(state.packs.engine?.touched)).not.toContain(value);
  });

  test("a change that went back to where it was still counts", () => {
    const state = played([
      { type: "add", entity: "dev", field: "cash", delta: 5 },
      { type: "add", entity: "dev", field: "cash", delta: -5 },
    ]);
    expect(state.entities.dev?.fields.cash).toBe(900);
    expect(touchedField(state, "dev", "cash")).toBe(true);
  });

  test("a materialization's opening posting leaves the balance untouched; its generated detail counts", () => {
    const state = played([
      {
        type: "materialize",
        entity: POV,
        domain: "money",
        generatorVersion: 1,
        tablesRevision: "t",
        events: [
          { type: "post", lines: [{ account: "acct", amount: 5000 }, { account: `${EXTERNAL_ACCOUNT_PREFIX}${POV}`, amount: -5000 }], memo: "Opening balances" },
          { type: "set", entity: POV, field: "skill", value: 3 },
        ],
      },
    ]);
    expect(touchedAspect(state, "acct", "posted")).toBe(false);
    expect(touchedField(state, POV, "skill")).toBe(true);
  });
});

/** Every event type the engine and its packs register, as each pack registers it. */
function registeredTypes(): string[] {
  const types = coreEventTypes(() => reg).map((d) => d.type);
  const recorder = new Proxy({} as CoreRegistry, { get: (_target, key) => (key === "event" ? (d: EventTypeDef) => void types.push(d.type) : () => undefined) });
  for (const pack of ALL_PACKS) pack.register(recorder);
  return types;
}

/** A world where every event type has something to act on: an inn on a grid, accounts, a route, a quest and a fight. */
function everythingWorld(): WorldDoc {
  const w = blankWorld("w_all", "Everything");
  w.mapSettings = { display: "knowledge", grid: { movement: true, sightRadius: 3 } };
  Object.assign(w.kinds.person?.fields ?? {}, { hp: { type: "number", pool: { max: "max_hp" } }, max_hp: { type: "number", default: 6 } });
  w.places.town = { id: "town", name: "Saltmarsh", fields: {} };
  w.places.inn = { id: "inn", name: "The Gull", parent: "town", fields: {} };
  w.routes.lane = { id: "lane", from: "home", to: "inn", modes: {}, bidirectional: true };
  w.maps.inn_ground = {
    id: "inn_ground",
    scope: "inn",
    layout: ["############", "#ttttt#kkkk#", "#ttttt+kkkk#", "#ttttt#kkkk#", "############"],
    legend: { t: { place: "taproom" }, k: { place: "kitchen" } },
    places: [
      { id: "taproom", name: "Taproom" },
      { id: "kitchen", name: "Kitchen" },
    ],
  };
  w.start = { ...w.start, place: "taproom" };
  Object.assign(w.entities.you?.fields ?? {}, { place: "taproom" });
  w.entities.dev = { id: "dev", kind: "person", name: "Dev", tier: "principal", fields: { place: "home" }, relations: [], agent: true };
  w.entities.rat = { id: "rat", kind: "person", name: "Rat", tier: "background", fields: { place: "taproom", max_hp: 3 }, relations: [] };
  w.entities.acct = { id: "acct", kind: "account", name: "Checking", tier: "background", fields: { owner: "you", type: "checking" }, relations: [] };
  w.entities.card = { id: "card", kind: "account", name: "Card", tier: "background", fields: { owner: "you", type: "card" }, relations: [] };
  w.entities.shop = { id: "shop", kind: "business", name: "Taproom", tier: "background", fields: { place: "taproom", owners: [{ party: "dev", role: "owner", share: 100 }] }, relations: [] };
  w.entities.job_dev = { id: "job_dev", kind: "job", name: "Barkeep", tier: "background", fields: { worker: "dev", employer: "shop", basis: "hourly", rate: 1500 }, relations: [] };
  w.entities.inv = { id: "inv", kind: "invoice", name: "Ale delivery", tier: "background", fields: { business: "shop", customer: "you", cents: 1000, due: "2026-01-01" }, relations: [] };
  w.tracks.heist = { id: "heist", kind: "quest", label: "The heist", start: "idea", visibility: "public", stages: { idea: { label: "An idea", next: [] }, on: { label: "Underway", next: [] } } };
  w.checks.initiative = { id: "initiative", dice: "d20" };
  w.ruleset = { combat: { initiative: "initiative", economy: { action: { label: "Action" } }, hp: "hp" } };
  return migrateWorld(w);
}

/** One event of every registered type, in an order where each applies to the state the ones before it leave. */
const EVERY_TYPE: LedgerEvent[] = [
  { type: "set", entity: "you", field: "mood", value: "calm" },
  { type: "add", entity: "you", field: "stress", delta: 5 },
  { type: "post", lines: [{ account: "acct", amount: 500 }, { account: `${EXTERNAL_ACCOUNT_PREFIX}job`, amount: -500 }], memo: "Paid in" },
  { type: "link", rel: "knows", from: "you", to: "dev" },
  { type: "unlink", rel: "knows", from: "you", to: "dev" },
  { type: "spawn", entity: { id: "coin", kind: "item", name: "Coin", tier: "background", fields: {}, relations: [] } },
  { type: "stage", track: "heist", to: "on" },
  { type: "clock", minutes: 5, cause: "tick" },
  { type: "materialize", entity: "dev", domain: "gear", generatorVersion: 1, tablesRevision: "t", events: [{ type: "set", entity: "dev", field: "kit", value: "rope" }] },
  { type: "timelapse", from: 0, to: 60, target: { type: "duration", minutes: 60 }, stoppedBy: null, segment: 0 },
  { type: "engine.fired", data: { rule: "closing_time" } },
  { type: "engine.signal", data: { class: "invitation", text: "Dev waves you over" } },
  { type: "engine.note", data: { text: "A note" } },
  { type: "engine.beat", data: { text: "A beat" } },
  { type: "engine.caught", data: { agent: "dev", slot: 3 } },
  { type: "engine.cursor", data: { rr: 1 } },
  { type: "engine.choice", data: { key: "dev:evening", choice: "rest" } },
  { type: "engine.attempt", data: { track: "heist", stage: "on", correct: false } },
  { type: "engine.revealed", data: { track: "heist", stage: "on" } },
  { type: "engine.pause", data: { scene: null } },
  { type: "engine.check", data: { actor: "you", check: "initiative", outcome: "success" } },
  { type: "engine.entity", data: { entity: "dev", tier: "supporting", agent: false, levels: { money: 2 } } },
  { type: "engine.class", data: { entity: "dev", class: {}, tags: ["regular"], was: {} } },
  { type: "engine.life", data: { entity: "dev", to: "dying" } },
  { type: "engine.told", data: { entity: "dev", who: ["you"] } },
  { type: "engine.observed", data: { people: {} } },
  { type: "engine.adjudged", data: { actor: "you", action: "climb", outcome: "success", rolled: true } },
  { type: "space.pos", data: { entity: "you", at: { scope: "inn", x: 4, y: 3 }, from: { scope: "inn", x: 3, y: 2 } } },
  { type: "space.route", data: { route: "lane", open: false } },
  { type: "economy.anchor", data: { entity: "dev", band: "comfortable", typical: 3000, base: 2000 } },
  { type: "economy.txn", data: { memo: "Rent", lines: [{ account: "acct", amount: -100 }] } },
  { type: "economy.note", data: { entity: "dev", class: "bill", text: "Rent is due" } },
  { type: "economy.modifier", data: { id: "sale", mult: 0.5 } },
  { type: "economy.statement", data: { account: "card", closing: 100, interest: 0, minimum: 10, due: 2000 } },
  { type: "economy.card_paid", data: { account: "card", cents: 10 } },
  { type: "economy.delinquency", data: { account: "card", stage: "30", past_due: 10, lates: 1, penalty: false } },
  { type: "economy.flow_run", data: { flow: "flow_rent", label: "Rent", at: 0, outcome: "paid", cents: 100, state: {} } },
  { type: "economy.hold", data: { id: "h1", account: "acct", cents: 10, until: 2000, kind: "deposit", memo: "Cash deposit" } },
  { type: "economy.settle", data: { account: "card", upto: 2000 } },
  { type: "economy.credit", data: { person: "dev", at: 0, kind: "inquiry" } },
  { type: "economy.score", data: { person: "dev", score: 700, factors: {} } },
  { type: "economy.spend", data: { card: "card", day: 0, purchase: 10, atm: 0 } },
  { type: "economy.open", data: { accounts: ["acct"] } },
  { type: "economy.status", data: { account: "acct", status: "frozen" } },
  { type: "economy.accrue", data: { account: "acct", at: 0 } },
  { type: "economy.decline", data: { reason: "no funds" } },
  { type: "economy.payslip", data: { job: "job_dev", worker: "dev", through: 1440, gross: 12000, taxes: 1200, deductions: 0, net: 10800, minutes: 480, shifts: 1, year: 2026, month: 1, fica: 12000, pretax: 0, business: "shop", cost: 12000 } },
  { type: "economy.timesheet", data: { job: "job_dev", minutes: 480, days: [0], since: 0 } },
  { type: "economy.commission", data: { job: "job_dev", cents: 5000, since: 0 } },
  { type: "economy.sale", data: { business: "shop", cents: 1000, tax: 60, cogs: 400, takings: 1060, payer: "you", memo: "Ale", category: "drinks" } },
  { type: "economy.remit", data: { business: "shop", what: "sales_tax", cents: 60 } },
  { type: "economy.invoice_paid", data: { invoice: "inv", business: "shop", customer: "you", cents: 1000 } },
  { type: "economy.payout", data: { business: "shop", cents: 5000, kind: "draw", party: "dev" } },
  { type: "economy.estimated_tax", data: { party: "dev", periods: ["2026-1"], cents: 500 } },
  { type: "relationships.regard", data: { from: "you", to: "dev", deltas: { warmth: 5 } } },
  { type: "castlife.need", data: { entity: "you", need: "hunger", delta: 10 } },
  { type: "castlife.decision", data: { key: "dev:evening", choice: "rest" } },
  { type: "castlife.invitation", data: { agent: "dev", place: "home", at: 100, text: "Drinks?" } },
  { type: "story.flag", data: { name: "met_dev", value: true } },
  { type: "combat.start", data: { encounter: "e1", place: "taproom", order: [{ id: "you", side: "party", init: 15, left: { action: 1 } }, { id: "rat", side: "foes", init: 5, left: { action: 1 } }] } },
  { type: "combat.spend", data: { encounter: "e1", who: "you", cost: { action: 1 } } },
  { type: "combat.act", data: { encounter: "e1", actor: "you", action: "strike", label: "Strike", target: "rat", outcome: "hit" } },
  { type: "set", entity: "rat", field: "hp", value: 0 },
  { type: "combat.down", data: { encounter: "e1", entity: "rat", down: true } },
  { type: "combat.turn", data: { encounter: "e1", round: 1, turn: 1, actor: "rat", reset: {} } },
  { type: "combat.decision", data: { key: "rat:turn", choice: "flee" } },
  { type: "combat.end", data: { encounter: "e1", reason: "over" } },
  // Minds write only their own slice, never an entity's definition.
  { type: "minds.round", data: { at: 0, on: true } },
  { type: "minds.mind", data: { entity: "dev", at: 0, place: "home", level: "near", moment: "turn", reason: "first", monologue: "m", depiction: "d", intent: "i", reactions: [], plans: [{ id: "p1", what: "Meet you", kind: "meet", when: { from: 60, to: 120 }, where: null, with: ["you"], priority: 3, status: "open", made: 0, source: "mind", closed: null, reason: null }], mood: null, interrupt: null, withheld: false } },
  { type: "minds.plan", data: { entity: "dev", plan: "p1", status: "done", at: 120, reason: null } },
  { type: "minds.plan_edit", data: { entity: "dev", plan: "p1", value: null } },
  { type: "minds.memory", data: { entity: "dev", at: 0, notes: [{ id: "n1", text: "n", salience: 3, at: 0 }], commitments: [{ id: "c1", kind: "promise", with: ["you"], text: "t", due: null, status: "open", made: 0, closed: null }], resolved: [], plans: [], told: [{ to: ["you"], what: "w" }], summary: "s" } },
  { type: "minds.note_edit", data: { entity: "dev", note: "n1", value: null } },
  { type: "minds.commitment", data: { entity: "dev", commitment: "c1", status: "kept", at: 10, reason: null } },
  { type: "minds.commitment_edit", data: { entity: "dev", commitment: "c1", value: null } },
  { type: "minds.presence", data: { msg: null, at: 0, place: "taproom", who: ["you"], saw: ["a fight"] } },
  { type: "minds.consolidated", data: { entity: "dev", at: 0, notes: [], summary: "s2" } },
  { type: "minds.pin", data: { entity: "dev", level: "live" } },
  { type: "minds.refresh", data: { entity: "dev" } },
  { type: "minds.skip", data: { from: 0, to: 60, beats: [{ at: 30, reason: "r", source: "scan" }] } },
];

/** What an event wrote of entities' definitions: each field, relation (by type and target), tier, agent flag, level overrides, classes and tags and life state that changed, each new entity and each own account's balance. */
function written(before: Readonly<WorldState>, after: Readonly<WorldState>): Touch[] {
  const out: Touch[] = [];
  const differs = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b);
  for (const [id, e] of Object.entries(after.entities)) {
    const was = own(before.entities, id);
    if (!was) {
      out.push({ entity: id, aspect: "spawned" });
      continue;
    }
    for (const f of new Set([...Object.keys(was.fields), ...Object.keys(e.fields)])) if (differs(own(was.fields, f), own(e.fields, f))) out.push({ entity: id, field: f });
    for (const key of new Set([...was.relations, ...e.relations].map((r) => `${r.type}\u0000${r.to}`))) {
      const [rel = "", to = ""] = key.split("\u0000");
      if (differs(was.relations.filter((x) => x.type === rel && x.to === to), e.relations.filter((x) => x.type === rel && x.to === to))) out.push({ entity: id, rel, to });
    }
    if (was.tier !== e.tier) out.push({ entity: id, aspect: "tier" });
    if (was.agent !== e.agent) out.push({ entity: id, aspect: "agent" });
    if (differs(was.levels, e.levels)) out.push({ entity: id, aspect: "levels" });
    if (differs([was.class, was.tags], [e.class, e.tags])) out.push({ entity: id, aspect: "class" });
    if (was.life !== e.life) out.push({ entity: id, aspect: "life" });
    if (own(before.accounts, id) !== own(after.accounts, id)) out.push({ entity: id, aspect: "posted" });
  }
  return out;
}

describe("the event types", () => {
  test("every type that writes an entity's definition records it in the touched record, so an Upgrade keeps it", () => {
    const types = registeredTypes();
    expect(types.filter((t) => !EVERY_TYPE.some((e) => e.type === t))).toEqual([]);
    const world = everythingWorld();
    const state = initialState(world, "r", reg);
    const problems: string[] = [];
    for (const event of EVERY_TYPE) {
      const rejection = validateEvent(reg, event, reg.context(world, state));
      if (rejection) problems.push(`${event.type} doesn't apply here: ${rejection.reason}`);
      const before = structuredClone(state);
      applyEvent(reg, event, state, reg.context(world, state));
      for (const t of written(before, state)) {
        // A materialization's opening postings are the authored balance itself, never play's.
        if (event.type === "materialize" && "aspect" in t && t.aspect === "posted") continue;
        const recorded = "field" in t ? touchedField(state, t.entity, t.field) : "rel" in t ? touchedRelation(state, t.entity, t.rel, t.to) : touchedAspect(state, t.entity, t.aspect);
        if (!recorded) problems.push(`${event.type} wrote ${JSON.stringify(t)} without touching it`);
      }
    }
    expect(problems).toEqual([]);
  });
});
