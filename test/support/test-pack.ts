// A small pack and world for the ledger suite. Its events have real preconditions, so rebased
// views drop entries (an item never bought can't be used) and Keep conversions matter.
//
// User text drives planning: `buy:<item>:<price>`, `use:<item>`, `earn:<n>`, `roll`,
// `deposit:<n>` and `pay:<n>` (postings on Sam's account), `shop:<item>:<price>` (a posting and
// the item as one event group), anything else is a plain turn. Reply text drives reading:
// `[found:<n>]`, `[lose:<item>]`, `[pay:<n>]`.
//
// The pack guards the core `post` the way economy does: an own account never goes
// below zero, so a payment rebased onto a poorer branch is dropped, not folded negative.

import { hashJson } from "../../src/shared/hash";
import type { JsonObject } from "../../src/shared/json";
import { isRecord } from "../../src/shared/json";
import type { LedgerEvent, PackEvent } from "../../src/shared/ledger";
import { defaultTiers } from "../../src/shared/tiers";
import type { WorldDoc } from "../../src/shared/world";
import { DEFAULT_CURRENCY, WORLD_FORMAT } from "../../src/shared/world";
import type { EventTypeDef, PackDef } from "../../src/engine/registry";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../src/engine/events";
import { createRng } from "../../src/engine/rng";
import type { WorldState } from "../../src/engine/state";
import type { TurnModel } from "../../src/engine/ledger/journal";
import { planTurn } from "../../src/engine/turn";

export const POV = "sam";

function owned(state: Readonly<WorldState>): Record<string, boolean> {
  const slice = state.packs.test;
  const items = slice && isRecord(slice.owned) ? slice.owned : {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(items)) if (v === true) out[k] = true;
  return out;
}

function setOwned(state: WorldState, item: string, value: boolean): void {
  const slice: JsonObject = state.packs.test ?? { owned: {} };
  const items: JsonObject = isRecord(slice.owned) ? { ...(slice.owned as JsonObject) } : {};
  if (value) items[item] = true;
  else delete items[item];
  state.packs.test = { ...slice, owned: items };
}

function cash(state: Readonly<WorldState>): number {
  const v = state.entities[POV]?.fields.cash;
  return typeof v === "number" ? v : 0;
}

function str(e: PackEvent, key: string): string {
  const v = e.data[key];
  return typeof v === "string" ? v : "";
}

function num(e: PackEvent, key: string): number {
  const v = e.data[key];
  return typeof v === "number" ? v : 0;
}

const buy: EventTypeDef<PackEvent> = {
  type: "test.buy",
  validate: (e, ctx) => {
    if (owned(ctx.state)[str(e, "item")]) return { code: "owned", reason: `already own ${str(e, "item")}` };
    // World-sensitive on purpose: revision 1 is lenient, so a `migrate` marker's fold order shows.
    return cash(ctx.state) >= num(e, "price") || ctx.world.lenientPricing ? null : { code: "declined", reason: `can't afford ${str(e, "item")}` };
  },
  apply: (e, state) => {
    const pov = state.entities[POV];
    if (pov) pov.fields.cash = cash(state) - num(e, "price");
    setOwned(state, str(e, "item"), true);
  },
  describe: (e) => `bought ${str(e, "item")}`,
};

const use: EventTypeDef<PackEvent> = {
  type: "test.use",
  validate: (e, ctx) => (owned(ctx.state)[str(e, "item")] ? null : { code: "not_owned", reason: `no ${str(e, "item")} to use` }),
  apply: (e, state) => {
    const slice = state.packs.test ?? { owned: {} };
    const uses = typeof slice.uses === "number" ? slice.uses : 0;
    state.packs.test = { ...slice, uses: uses + 1, last: str(e, "item") };
  },
  describe: (e) => `used ${str(e, "item")}`,
};

const lose: EventTypeDef<PackEvent> = {
  type: "test.lose",
  validate: (e, ctx) => (owned(ctx.state)[str(e, "item")] ? null : { code: "not_owned", reason: `no ${str(e, "item")} to lose` }),
  apply: (e, state) => setOwned(state, str(e, "item"), false),
  describe: (e) => `lost ${str(e, "item")}`,
};

/** Sam's account balance in cents (core postings). */
export function balanceOf(state: Readonly<WorldState>, account: string = POV): number {
  return state.accounts[account] ?? 0;
}

/** A posting between Sam's account and the outside: positive amounts pay in. */
function posting(amount: number, memo: string): LedgerEvent {
  return { type: "post", lines: [{ account: POV, amount }, { account: `${EXTERNAL_ACCOUNT_PREFIX}${amount >= 0 ? "job" : "shop"}`, amount: -amount }], memo };
}

export const testPack: PackDef = {
  id: "test",
  label: "Ledger test pack",
  version: 1,
  domain: null,
  requires: [],
  register(r) {
    r.event(buy);
    r.event(use);
    r.event(lose);
    r.guard({
      type: "post",
      validate: (e, ctx) => {
        if (e.type !== "post") return null;
        for (const line of e.lines) {
          if (line.account.startsWith(EXTERNAL_ACCOUNT_PREFIX) || line.amount >= 0) continue;
          if (balanceOf(ctx.state, line.account) + line.amount < 0) return { code: "declined", reason: `${line.account} can't cover ${-line.amount}` };
        }
        return null;
      },
    });
    // One slot renderer and two extraction channels, for the backend tests.
    r.renderer({ slot: "scene", render: (ctx) => [`${ctx.state.entities[POV]?.name ?? POV} has $${cash(ctx.state)}.`] });
    r.proposal({
      type: "condition",
      boundField: "money",
      validate: (p, ctx) => (typeof p.entity === "string" && ctx.state.entities[p.entity] && p.field === "cash" && typeof p.delta === "number" ? null : { code: "bad", reason: "only cash changes" }),
      toEffects: (p) => [{ type: "add", args: { entity: p.entity ?? POV, field: "cash", delta: p.delta ?? 0 } }],
    });
    r.proposal({
      type: "regard",
      boundField: "text",
      validate: (p, ctx) => (typeof p.from === "string" && ctx.state.entities[p.from] ? null : { code: "bad", reason: "unknown character" }),
      toEffects: (p) => [{ type: "set", args: { entity: p.from ?? POV, field: "mood", value: typeof p.delta === "number" && p.delta > 0 ? "warm" : "cold" } }],
    });
    // Narrated purchases: declined when cash can't cover the price, unless paid from savings. A
    // proposal's price is in minor units (cents); Sam's cash is whole dollars.
    const dollars = (p: { price?: unknown }): number => (typeof p.price === "number" ? p.price / 100 : 0);
    r.proposal({
      type: "purchase",
      boundField: "money",
      validate: (p, ctx) => {
        const price = dollars(p);
        return p.method === "savings" || cash(ctx.state) >= price ? null : { code: "declined", reason: `Sam doesn't have $${price}` };
      },
      toEffects: (p) => (p.method === "savings" ? [{ type: "set", args: { entity: POV, field: "detail", value: "paid from savings" } }] : [{ type: "add", args: { entity: POV, field: "cash", delta: -dollars(p) } }]),
    });
  },
};

/** Open day-plan ties for agents flagged `tie` (the call-count tests), reported as castlife does. */
export const tieStubPack: PackDef = {
  id: "castlife",
  label: "Cast life ties (test stub)",
  version: 1,
  domain: null,
  requires: [],
  register(r) {
    r.query("castlife.tie_zones", (ctx) =>
      Object.entries(ctx.state.entities)
        .filter(([, e]) => e.fields.tie === true)
        .map(([id]) => ({ key: `${id}:tie`, agent: id, options: ["work", "rest"] })),
    );
    const decision: EventTypeDef<PackEvent> = { type: "castlife.decision", validate: (e) => (str(e, "key") !== "" && str(e, "choice") !== "" ? null : { code: "bad_event", reason: "decision needs key and choice" }), apply: () => undefined, describe: () => "" };
    r.event(decision);
  },
};

/**
 * The fight a combat world adds: a rat at home, HP, an initiative check, Strike (an attack) and
 * Flee (ends the fight), and combat rules with one Action a turn.
 */
function addCombat(world: WorldDoc): void {
  Object.assign(world.kinds.person?.fields ?? {}, { hp: { type: "number", pool: { max: "max_hp" } }, max_hp: { type: "number", default: 6 } });
  world.entities.rat = { id: "rat", kind: "person", name: "Rat", tier: "background", fields: { place: "home", max_hp: 3 }, relations: [] };
  world.checks.initiative = { id: "initiative", dice: "d20" };
  world.actions.strike = {
    id: "strike",
    label: "Strike",
    params: { target: { type: "ref", ref: "person" } },
    requires: ["is_foe(self, target)", "not is_down(target)"],
    check: { id: "strike", dice: "d20", dc: "10", bands: [{ outcome: "miss", margin: { max: -1 } }, { outcome: "hit", margin: { min: 0 } }] },
    outcomes: { hit: [{ type: "add", args: { entity: "target", field: "hp", delta: "=-roll('1d4')" } }], miss: [] },
    duration: "0",
    combat: { cost: { action: 1 }, role: "attack" },
  };
  world.actions.flee = { id: "flee", label: "Flee", params: {}, requires: [], outcomes: { default: [{ type: "combat.end", args: {} }] }, duration: "0", combat: { cost: {} } };
  world.ruleset = { combat: { initiative: "initiative", economy: { action: { label: "Action" } }, hp: "hp" } };
}

/** Revision `variant` of the test world; variant 1 starts richer and prices leniently. With `combat`, it has a fight to pick. */
export function testWorld(variant = 0, seedMode: WorldDoc["seedMode"] = "fresh", combat = false): WorldDoc {
  const world: WorldDoc = {
    format: WORLD_FORMAT,
    id: "world-test",
    name: `Test world ${variant}`,
    engineVersion: "0.0.0",
    packs: { test: { version: 1, config: {} } },
    pins: { generators: {}, tables: {} },
    kinds: { person: { id: "person", label: "Person", fields: { cash: { type: "money" }, mood: { type: "text" }, detail: { type: "text" } } } },
    relations: {},
    entities: {
      [POV]: { id: POV, kind: "person", name: "Sam", tier: "principal", fields: { cash: 100 + variant * 10, mood: "fine" }, relations: [] },
      dev: { id: "dev", kind: "person", name: "Dev", tier: "principal", fields: { cash: 50 }, relations: [], agent: true },
    },
    places: { home: { id: "home", name: "Home", fields: {} } },
    routes: {},
    grids: {},
    maps: {},
    rules: {},
    actions: {},
    checks: {},
    calendar: { system: "gregorian", epoch: "2026-10-16T06:00", timeZone: "America/New_York", dayParts: [{ id: "morning", label: "Morning", start: "06:00" }], holidays: [] },
    schedules: {},
    tracks: {},
    tables: {},
    realism: {
      preset: "story",
      levels: { money: 1, gear: 1, vehicles: 1, castlife: 1, relationships: 1, space: 2, calendar: 2, weather: 1, sheets: 1 },
      tierCaps: { principal: {}, supporting: {}, background: {} },
    },
    time: {
      // A half-minute action tick, as the starters write it: a marker plays it as a whole minute.
      sceneTicks: { conversation: 2, action: 0.5, exploration: 10, downtime: 30 },
      interrupts: { invitation: "stop", bill: "note", decline: "stop", incident: "stop", quest: "stop", rule: "ignore", arrival: "stop", overdue: "ignore", needs: "ignore", weather: "ignore" },
      speedThrough: { sleep: { mode: "offer", thresholdMinutes: 30 } },
      montage: "key",
      unitCap: { agentDays: 600, events: 5000 },
    },
    sections: {},
    steps: {},
    suppressed: [],
    lore: {},
    loreIndex: { terms: {}, topics: {} },
    seedMode,
    lenientPricing: variant === 1,
    currency: { ...DEFAULT_CURRENCY },
    pov: POV,
    tiers: defaultTiers(),
    classifications: {},
    start: { place: "home", at: "2026-10-16T07:00" },
  };
  if (combat) addCombat(world);
  return world;
}

/** Two revisions, so Upgrade (`migrate`) markers have somewhere to go. */
export function testWorlds(seedMode: WorldDoc["seedMode"] = "fresh", combat = false): Map<string, WorldDoc> {
  const map = new Map<string, WorldDoc>();
  for (const variant of [0, 1]) {
    const world = testWorld(variant, seedMode, combat);
    map.set(hashJson(world), world);
  }
  return map;
}

/** A fight's texts, planned by the engine itself: the act, everyone else's turns, who fell and the end. */
const FIGHT_INTENTS: Record<string, { action: string; params: Record<string, string> }> = {
  fight: { action: "fight", params: { target: "rat" } },
  strike: { action: "strike", params: { target: "rat" } },
  end_turn: { action: "end_turn", params: {} },
  flee: { action: "flee", params: {} },
};

export const testModel: TurnModel = {
  plan({ state, ctx, seed, kind, userTexts }) {
    const text = userTexts.at(-1) ?? "";
    const events: LedgerEvent[] = [{ type: "clock", minutes: 2, cause: "tick" }];
    const [verb, a, b] = text.split(":");
    const fight = verb !== undefined && Object.hasOwn(FIGHT_INTENTS, verb) ? FIGHT_INTENTS[verb] : undefined;
    if (fight) return planTurn({ registry: ctx.registry, world: ctx.world, state, runSeed: "test", seed, kind, userTexts, intent: { ...fight, probabilities: { [fight.action]: 1 } } }).events;
    if (verb === "buy" && a) events.push({ type: "test.buy", data: { item: a, price: Number(b ?? "0") || 0 } });
    else if (verb === "use" && a) events.push({ type: "test.use", data: { item: a } });
    else if (verb === "earn") events.push({ type: "add", entity: POV, field: "cash", delta: Number(a ?? "0") || 0 });
    else if (verb === "roll") events.push({ type: "add", entity: POV, field: "cash", delta: createRng(seed).next() < 0.5 ? 10 : -10 });
    else if (verb === "deposit") events.push(posting(Number(a ?? "0") || 0, "deposit"));
    else if (verb === "pay") events.push(posting(-(Number(a ?? "0") || 0), "payment"));
    // A purchase paid from the account: the posting and the item are one group (they land together).
    else if (verb === "shop" && a) events.push({ ...posting(-(Number(b ?? "0") || 0), `bought ${a}`), group: `shop:${a}` }, { type: "test.buy", data: { item: a, price: 0 }, group: `shop:${a}` });
    return events;
  },
  read({ text }) {
    const events: LedgerEvent[] = [];
    for (const m of text.matchAll(/\[found:(\d+)\]/g)) events.push({ type: "add", entity: POV, field: "cash", delta: Number(m[1]) });
    for (const m of text.matchAll(/\[lose:(\w+)\]/g)) events.push({ type: "test.lose", data: { item: m[1] ?? "" } });
    for (const m of text.matchAll(/\[pay:(\d+)\]/g)) events.push(posting(-Number(m[1]), "fee"));
    return events;
  },
};
