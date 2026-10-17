// Combat pack (DESIGN §11): fights as a world's ruleset defines them (`ruleset.combat`), all data:
// initiative, the action economy, the HP pool, who is down, the sides and when it's over. This pack
// owns the fight under way (`state.packs.combat`): its events, its effects, the formulas that read
// it, the Encounter card and the turns around the POV's (engine/turn calls `combat.round`; the
// engine's resolve asks `combat.spend` what a combat action costs). A world without combat rules
// never sees any of it: its combat actions aren't offered and nothing here runs.
//
// Events (all concrete; the fold never rolls):
//   combat.start     {encounter, place, order: [{id, side, init, left}]}   initiative rolled at the effect
//   combat.turn      {encounter, round, turn, actor, reset}                 the next turn and its refills
//   combat.spend     {encounter, who, cost}                                 a combat action's cost
//   combat.act       {encounter, actor, action, label, target?, outcome?}  who did what (Journal, the card's log)
//   combat.down      {encounter, entity, down}                              re-checked against the down rule
//   combat.end       {encounter, reason, winner, rounds}                    `over` re-checks the end rule
//   combat.decision  {key, choice}                                          an `npc.choose` pick for a turn
//
// Effects: `combat.start {foes?}` (ids, a selector, or everyone hostile here), `combat.end
// {winner?}`, `combat.end_turn {who?}` and `combat.spend {who?, cost}`.

import type { JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import { hashParts } from "../../../shared/hash";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import type { ActionDef } from "../../../shared/world";
import { checkOf, readyCheck, rollCheck } from "../../../engine/checks";
import type { Value } from "../../../engine/expr";
import { labelOf, mutableSlice, numOf, objOf, own, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EffectContext, EventTypeDef, PackDef, ReadContext, Rejection } from "../../../engine/registry";
import type { Rng } from "../../../engine/rng";
import { placeOfEntity, truthy } from "../../../engine/scope";
import { selectorMatches } from "../../../engine/selector";
import { knownBySelector } from "../../../engine/visibility";
import type { Working } from "../../../engine/working";
import { fightChoices, nextTurn, openRound, spendFor, type FightRound } from "./flow";
import { canFight, downHolds, encounterOf, endHolds, fighterOf, fits, fullEconomy, LOG_CAP, offTurnCost, PACK, readFor, rulesOf, standing, standingOn, winnerOf, writeEncounter, type Encounter, type Fighter, type Side } from "./model";
import { buildEncounterView, type EncounterView } from "./view";

declare module "../../../engine/registry" {
  interface ServiceMap {
    /** What a combat action costs its actor now (`combat.spend` events), or why it can't be taken; nothing for other actions. */
    "combat.spend": (ctx: ReadContext, actor: EntityId, action: Pick<ActionDef, "combat">) => LedgerEvent[] | Rejection;
    /** Opens a fight's part of a turn before the POV's action; its `after` runs the rest. Null without combat rules. */
    "combat.round": (w: Working, rng: Rng) => FightRound | null;
  }
  interface QueryMap {
    /** The `npc.choose` questions before the POV's next turn: each participant acting first, with its legal options by key and their labels. */
    "combat.choices": (ctx: ReadContext) => { key: string; agent: EntityId; options: string[]; labels: Record<string, string> }[];
    /** The fight as the GM sees it; null without one. */
    "combat.gm": (ctx: ReadContext) => EncounterView | null;
  }
}

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/** The fight an event names, when it is the one under way. */
function current(e: PackEvent, ctx: Pick<ReadContext, "state">): Encounter | Rejection {
  const enc = encounterOf(ctx.state);
  if (!enc) return reject("no_fight", "no fight is under way");
  return enc.id === strOf(e.data.encounter) ? enc : reject("other_fight", "that was another fight");
}

function counts(v: JsonValue | undefined): Record<string, number> | null {
  if (!isRecord(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    out[k] = n;
  }
  return out;
}

/** A `combat.start` event's initiative order, or null when it isn't one. */
function orderOf(v: JsonValue | undefined): Fighter[] | null {
  if (!Array.isArray(v)) return null;
  const out: Fighter[] = [];
  for (const f of v) {
    const left = isRecord(f) ? counts(f.left) : null;
    if (!isRecord(f) || typeof f.id !== "string" || (f.side !== "party" && f.side !== "foes") || typeof f.init !== "number" || !left) return null;
    out.push({ id: f.id, side: f.side, init: f.init, down: false, left });
  }
  return out;
}

/** Whether `self` is hostile to `other`: the rules' formula, else a `hostile` relation either way. */
function hostile(ctx: ReadContext, formula: string | undefined, self: EntityId, other: EntityId): boolean {
  return truthy(readFor(ctx, formula ?? "has_rel(self, 'hostile', other) or has_rel(other, 'hostile', self)", { self, other }, false));
}

/** The foes an effect names: an id, a list of ids, or a selector over who is here; null for "everyone hostile". */
function namedFoes(ctx: ReadContext, v: JsonValue | undefined, here: readonly EntityId[]): EntityId[] | Rejection | null {
  if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
  if (isRecord(v)) {
    // A selector as the visibility reader reads one: a constraint it doesn't know names no one.
    const selector = knownBySelector(v);
    return selector ? here.filter((id) => selectorMatches(ctx.registry, ctx.world, ctx.state, selector, id)) : reject("bad_args", "the foes are ids or a selector");
  }
  const ids = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string" && x !== "");
  const away = ids.find((id) => !here.includes(id));
  return away !== undefined ? reject("not_here", `${labelOf(ctx, away)} isn't here to fight`) : ids;
}

/**
 * The `combat.start` effect (DESIGN §11): the POV and whoever is with it against the foes named
 * (ids or a selector over who is here), else everyone here hostile to it. Someone allied with the
 * POV joins its side; someone allied with a foe, or hostile to the POV, joins the foes. Everyone
 * rolls initiative (forked by id), and the order is highest first, then the tie-break, then the
 * POV, its side, and id order. Everyone starts with every budget full.
 */
function startFight(a: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection {
  const rules = rulesOf(ctx.world);
  if (!rules) return reject("no_combat", "this world has no combat");
  if (encounterOf(ctx.state)) return reject("in_fight", "a fight is already under way");
  const pov = ctx.world.pov;
  const place = placeOfEntity(ctx.state, pov);
  if (place === null) return reject("nowhere", "there's nowhere to fight");
  if (!canFight(ctx, rules, pov)) return reject("cannot_fight", "you can't fight here");
  const here = Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => id !== pov && placeOfEntity(ctx.state, id) === place && canFight(ctx, rules, id));
  const named = namedFoes(ctx, a.foes, here);
  if (named !== null && !Array.isArray(named)) return named;
  const foes = new Set(named ?? here.filter((id) => hostile(ctx, rules.sides?.hostile, id, pov)));
  if (foes.size === 0) return reject("no_foes", "there's no one to fight here");
  if (foes.has(pov)) return reject("bad_args", "you can't fight yourself");
  const ally = (self: EntityId, other: EntityId): boolean => rules.sides?.ally !== undefined && truthy(readFor(ctx, rules.sides.ally, { self, other }, false));
  const party = new Set([pov, ...here.filter((id) => !foes.has(id) && ally(id, pov))]);
  const sworn = [...foes];
  for (const id of here) if (!party.has(id) && !foes.has(id) && (sworn.some((f) => ally(id, f)) || hostile(ctx, rules.sides?.hostile, id, pov))) foes.add(id);
  const init = checkOf(ctx.world, rules.initiative);
  if (!init) return reject("no_initiative", "the initiative check is missing");
  const rolled: { id: EntityId; side: Side; init: number; tie: number }[] = [];
  for (const id of [...party, ...[...foes].sort()]) {
    const ready = readyCheck(ctx.registry, ctx, init, { self: id, actor: id });
    if ("code" in ready) return ready;
    const roll = rollCheck(ready, ctx.rng.fork(`init:${id}`));
    const tie = rules.tieBreak !== undefined ? Number(readFor(ctx, rules.tieBreak, { self: id }, 0)) : ready.modifier;
    rolled.push({ id, side: party.has(id) ? "party" : "foes", init: roll.total, tie: Number.isFinite(tie) ? tie : 0 });
  }
  rolled.sort((x, y) => y.init - x.init || y.tie - x.tie || Number(y.id === pov) - Number(x.id === pov) || Number(y.side === "party") - Number(x.side === "party") || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const order = rolled.map((r) => ({ id: r.id, side: r.side, init: r.init, left: fullEconomy(ctx, rules, r.id) }));
  return [{ type: "combat.start", data: { encounter: hashParts(ctx.rng.seed, "encounter").slice(0, 12), place, order } }];
}

function describeSide(e: PackEvent, side: Side): string {
  const order = Array.isArray(e.data.order) ? e.data.order : [];
  return order.flatMap((f) => (isRecord(f) && f.side === side && typeof f.id === "string" ? [f.id] : [])).join(", ");
}

const events: EventTypeDef<PackEvent>[] = [
  {
    type: "combat.start",
    validate(e, ctx) {
      if (!rulesOf(ctx.world)) return reject("no_combat", "this world has no combat");
      if (encounterOf(ctx.state)) return reject("in_fight", "a fight is already under way");
      const order = orderOf(e.data.order);
      if (strOf(e.data.encounter) === "" || !order) return reject("bad_event", "a fight needs an id and an initiative order");
      if (new Set(order.map((f) => f.id)).size !== order.length) return reject("bad_event", "someone is in the fight twice");
      const missing = order.find((f) => !own(ctx.state.entities, f.id));
      if (missing) return reject("missing_entity", `no ${labelOf(ctx, missing.id)}`);
      if (order.find((f) => f.id === ctx.world.pov)?.side !== "party" || !order.some((f) => f.side === "foes")) return reject("bad_event", "a fight is the POV's side against foes");
      return null;
    },
    apply(e, state) {
      delete mutableSlice(state, PACK).decisions;
      writeEncounter(state, { id: strOf(e.data.encounter), place: typeof e.data.place === "string" ? e.data.place : null, round: 1, turn: 0, order: orderOf(e.data.order) ?? [], log: [] });
    },
    describe: (e) => `A fight: ${describeSide(e, "party")} against ${describeSide(e, "foes")}`,
  },
  {
    type: "combat.turn",
    validate(e, ctx) {
      const enc = current(e, ctx);
      if ("code" in enc) return enc;
      const round = e.data.round;
      const turn = e.data.turn;
      if (typeof round !== "number" || typeof turn !== "number" || !Number.isInteger(round) || !Number.isInteger(turn)) return reject("bad_event", "a turn needs a round and a place in the order");
      if (enc.order[turn]?.id !== strOf(e.data.actor)) return reject("bad_turn", "that isn't who goes there");
      if (round < enc.round || (round === enc.round && turn <= enc.turn)) return reject("bad_turn", "turns only move on");
      const reset = objOf(e.data.reset);
      for (const [id, budgets] of Object.entries(reset)) if (!fighterOf(enc, id) || !counts(budgets)) return reject("bad_event", "a refill names a participant and its budgets");
      return null;
    },
    apply(e, state) {
      const enc = encounterOf(state);
      if (!enc) return;
      const round = numOf(e.data.round, enc.round);
      const reset = objOf(e.data.reset);
      writeEncounter(state, {
        ...enc,
        round,
        turn: numOf(e.data.turn, enc.turn),
        order: enc.order.map((f) => ({ ...f, left: { ...f.left, ...(counts(own(reset, f.id)) ?? {}) } })),
        log: enc.log.filter((l) => l.round >= round - 1),
      });
    },
    describe: (e) => `${strOf(e.data.actor)}'s turn`,
  },
  {
    type: "combat.spend",
    validate(e, ctx) {
      const enc = current(e, ctx);
      if ("code" in enc) return enc;
      const rules = rulesOf(ctx.world);
      const who = strOf(e.data.who);
      const f = fighterOf(enc, who);
      const cost = counts(e.data.cost);
      if (!rules || !f || !cost || Object.values(cost).some((n) => n <= 0)) return reject("bad_event", "a spend needs a participant and what it spends");
      if (!standing(ctx.state, enc, f)) return reject("down", `${labelOf(ctx, who)} is out of the fight`);
      if (enc.order[enc.turn]?.id !== who && !offTurnCost(rules, cost)) return reject("not_your_turn", `it isn't ${labelOf(ctx, who)}'s turn`);
      return fits(cost, f.left) ? null : reject("spent", `${labelOf(ctx, who)} has nothing like that left`);
    },
    apply(e, state) {
      const enc = encounterOf(state);
      const cost = counts(e.data.cost) ?? {};
      if (enc) writeEncounter(state, { ...enc, order: enc.order.map((f) => (f.id !== strOf(e.data.who) ? f : { ...f, left: Object.fromEntries(Object.entries(f.left).map(([b, n]) => [b, n - (cost[b] ?? 0)])) })) });
    },
    describe: (e) => `${strOf(e.data.who)} spends ${Object.keys(objOf(e.data.cost)).join(", ")}`,
  },
  {
    type: "combat.act",
    validate(e, ctx) {
      const enc = current(e, ctx);
      if ("code" in enc) return enc;
      return fighterOf(enc, strOf(e.data.actor)) ? null : reject("not_fighting", `${labelOf(ctx, strOf(e.data.actor))} isn't in this fight`);
    },
    apply(e, state) {
      const enc = encounterOf(state);
      if (!enc) return;
      const entry = { round: enc.round, actor: strOf(e.data.actor), action: strOf(e.data.label, strOf(e.data.action)), target: typeof e.data.target === "string" ? e.data.target : null, outcome: typeof e.data.outcome === "string" ? e.data.outcome : null };
      writeEncounter(state, { ...enc, log: [...enc.log, entry].slice(-LOG_CAP) });
    },
    describe: (e) => `${strOf(e.data.actor)}: ${strOf(e.data.label, strOf(e.data.action))}${typeof e.data.target === "string" ? ` → ${e.data.target}` : ""}${typeof e.data.outcome === "string" ? ` (${e.data.outcome.replace(/_/g, " ")})` : ""}`,
  },
  {
    type: "combat.down",
    validate(e, ctx) {
      const enc = current(e, ctx);
      if ("code" in enc) return enc;
      const rules = rulesOf(ctx.world);
      const who = strOf(e.data.entity);
      if (!rules || !fighterOf(enc, who) || typeof e.data.down !== "boolean") return reject("bad_event", "a fall names a participant");
      // Re-read against the state, so a view where the blow never landed drops it.
      return downHolds(ctx, rules, who) === e.data.down ? null : reject("not_down", e.data.down ? `${labelOf(ctx, who)} isn't down` : `${labelOf(ctx, who)} is still down`);
    },
    apply(e, state) {
      const enc = encounterOf(state);
      if (enc) writeEncounter(state, { ...enc, order: enc.order.map((f) => (f.id === strOf(e.data.entity) ? { ...f, down: e.data.down === true } : f)) });
    },
    describe: (e) => `${strOf(e.data.entity)}: ${e.data.down === true ? "down" : "back up"}`,
  },
  {
    type: "combat.end",
    validate(e, ctx) {
      const enc = current(e, ctx);
      if ("code" in enc) return enc;
      const rules = rulesOf(ctx.world);
      if (e.data.reason === "over" && (!rules || !endHolds(ctx, rules, enc))) return reject("not_over", "the fight isn't over");
      return null;
    },
    apply: (_e, state) => writeEncounter(state, null),
    describe: (e) => `The fight is over${e.data.winner === "party" ? ": your side won" : e.data.winner === "foes" ? ": your side lost" : ""}`,
  },
  {
    type: "combat.decision",
    validate: (e) => (strOf(e.data.key) !== "" && strOf(e.data.choice) !== "" ? null : reject("bad_event", "a decision needs a key and a choice")),
    apply: (e, state) => {
      sliceRecord(state, PACK, "decisions")[strOf(e.data.key)] = strOf(e.data.choice);
    },
    describe: (e) => `decided ${strOf(e.data.choice)}`,
  },
];

function fighterArg(ctx: ReadContext, v: Value | undefined): { enc: Encounter; f: Fighter } | null {
  const enc = encounterOf(ctx.state);
  const f = enc && typeof v === "string" ? fighterOf(enc, v) : undefined;
  return enc && f ? { enc, f } : null;
}

export const combatPack: PackDef = {
  id: PACK,
  label: "Combat",
  version: 1,
  domain: null,
  requires: [],
  register(r) {
    for (const def of events) r.event<PackEvent>(def);

    r.effect({ type: "combat.start", args: ["foes?"], resolve: (a, ctx) => startFight(a, ctx) });
    r.effect({
      type: "combat.end",
      args: ["winner?"],
      resolve(a, ctx) {
        const enc = encounterOf(ctx.state);
        if (!enc) return reject("no_fight", "no fight is under way");
        const winner = a.winner === "party" || a.winner === "foes" ? a.winner : winnerOf(ctx.state, enc);
        return [{ type: "combat.end", data: { encounter: enc.id, reason: "effect", winner, rounds: enc.round } }];
      },
    });
    r.effect({
      type: "combat.end_turn",
      args: ["who?"],
      resolve(a, ctx) {
        const rules = rulesOf(ctx.world);
        const enc = encounterOf(ctx.state);
        const who = strOf(a.who) || ctx.world.pov;
        if (!rules || !enc) return reject("no_fight", "no fight is under way");
        if (enc.order[enc.turn]?.id !== who) return reject("not_your_turn", who === ctx.world.pov ? "it isn't your turn" : `it isn't ${labelOf(ctx, who)}'s turn`);
        const next = nextTurn(ctx, rules, enc);
        return next ? [next] : reject("no_one", "no one is left to take a turn");
      },
    });
    r.effect({ type: "combat.spend", args: ["who?", "cost"], resolve: (a, ctx) => spendFor(ctx, strOf(a.who) || ctx.world.pov, { combat: { cost: counts(a.cost) ?? {} } }) });

    r.service("combat.spend", spendFor);
    r.service("combat.round", openRound);
    r.query("combat.choices", fightChoices);
    r.query("combat.gm", (ctx) => buildEncounterView(ctx, { gm: true }));

    // What formulas read of the fight: a requirement `is_foe(self, target)` keeps an attack to foes.
    r.formula("can_fight", (ctx, e) => {
      const rules = rulesOf(ctx.world);
      return rules !== null && typeof e === "string" && canFight(ctx, rules, e);
    });
    r.formula("in_encounter", (ctx, e) => fighterArg(ctx, e) !== null);
    r.formula("is_foe", (ctx, a, b) => {
      const x = fighterArg(ctx, a);
      const y = fighterArg(ctx, b);
      return x !== null && y !== null && x.f.side !== y.f.side;
    });
    r.formula("is_ally", (ctx, a, b) => {
      const x = fighterArg(ctx, a);
      const y = fighterArg(ctx, b);
      return x !== null && y !== null && x.f.side === y.f.side;
    });
    r.formula("is_down", (ctx, e) => fighterArg(ctx, e)?.f.down === true);
    r.formula("has_turn", (ctx, e) => {
      const hit = fighterArg(ctx, e);
      return hit !== null && hit.enc.order[hit.enc.turn]?.id === hit.f.id;
    });
    r.formula("standing", (ctx, side) => {
      const enc = encounterOf(ctx.state);
      return enc && (side === "party" || side === "foes") ? standingOn(ctx.state, enc, side).length : 0;
    });
    r.formula("encounter_round", (ctx) => encounterOf(ctx.state)?.round ?? 0);
    r.formula("budget_left", (ctx, e, budget) => own(fighterArg(ctx, e)?.f.left ?? {}, String(budget ?? "")) ?? 0);

    // A fight's own actions; only worlds with combat rules offer them (`offersAction`).
    r.action({
      id: "fight",
      label: "Fight",
      pack: PACK,
      params: { target: { type: "ref", label: "Opponent" } },
      requires: ["can_fight(target)"],
      combat: { cost: {}, start: true },
      outcomes: { default: [{ type: "combat.start", args: { foes: "target" } }] },
      duration: "0",
      lexicon: ["start a fight", "pick a fight", "draw my weapon"],
      observable: "starts a fight",
    });
    r.action({
      id: "end_turn",
      label: "End turn",
      pack: PACK,
      params: {},
      requires: [],
      combat: { cost: {} },
      outcomes: { default: [{ type: "combat.end_turn", args: { who: "self" } }] },
      duration: "0",
      lexicon: ["end my turn", "end turn"],
    });

    r.view({ panel: "combat.encounter", build: (ctx) => buildEncounterView(ctx) as unknown as JsonValue });
  },
};

export default combatPack;

export type { EncounterRow, EncounterView } from "./view";
export { combatEntries, paletteEncounter } from "./view";
