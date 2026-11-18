// Combat pack (DESIGN §11): fights as a world's ruleset defines them (`ruleset.combat`), all data:
// initiative, the action economy, the HP pool, who is down, the sides and when it's over. This pack
// owns the fight under way (`state.packs.combat`): its events, its effects, the formulas that read
// it, the Encounter card and the turns around the POV's (engine/turn calls `combat.round`; the
// engine's resolve asks `combat.spend` what a combat action costs). A world without combat rules
// never sees any of it: its combat actions aren't offered and nothing here runs.
//
// Events (all concrete; the fold never rolls):
//   combat.start     {encounter, place, order: [{id, side, init, left}]}   initiative rolled at the effect
//   combat.turn      {encounter, round, turn, actor, reset}                 the next turn and its refills (a new round extends or restarts the calm)
//   combat.spend     {encounter, who, cost}                                 a combat action's cost
//   combat.act       {encounter, actor, action, label, target?, outcome?}  who did what (Journal, the card's log); an attack breaks the round's calm
//   combat.down      {encounter, entity, down}                              re-checked against the down rule
//   combat.end       {encounter, reason, winner, rounds}                    `over` re-checks the end rule, `left` that the POV
//                                                                           isn't where the fight is, `stalemate` the calm
//   combat.decision  {key, choice}                                          an `npc.choose` pick for a turn
//
// Effects: `combat.start {foes?}` (ids, a selector, or everyone hostile here), `combat.end
// {winner?}`, `combat.end_turn {who?}` and `combat.spend {who?, cost}`. The pack also defines the `hostile`
// relation type the default sides rule reads (symmetric, so both sides hold it).

import type { JsonObject, JsonValue } from "../../../shared/json";
import { say } from "../../../shared/lines";
import { isRecord } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import { hashParts } from "../../../shared/hash";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import type { ActionDef, CombatDef } from "../../../shared/world";
import { checkOf, readyCheck, rollCheck } from "../../../engine/checks";
import type { Value } from "../../../engine/expr";
import { labelOf, mutableSlice, numOf, objOf, optionalService, own, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { EffectContext, EventTypeDef, PackDef, ReadContext, Rejection } from "../../../engine/registry";
import type { Rng } from "../../../engine/rng";
import { placeOfEntity, truthy } from "../../../engine/scope";
import { selectorMatches } from "../../../engine/selector";
import { knownBySelector } from "../../../engine/visibility";
import type { Working } from "../../../engine/working";
import { BESTIARY_COLUMNS, BESTIARY_SCHEMA, BESTIARY_TABLE, emptyBestiary } from "./bestiary";
import { breakOff, fightChoices, hpLine, nextTurn, openRound, spendFor, type FightRound } from "./flow";
import { attacks, canFight, downHolds, encounterOf, endHolds, engaged, fighterOf, fightById, fightsOf, fits, fullEconomy, hpByFighter, LOG_CAP, offTurnCost, PACK, povLeft, readFor, removeEncounter, rulesOf, sameHp, stalemateRounds, stalledHolds, standing, standingOn, winnerOf, writeEncounter, type Encounter, type Fighter, type Side } from "./model";
import { buildEncounterView, fightOffers, type EncounterView } from "./view";

declare module "../../../engine/registry" {
  interface ServiceMap {
    /** What a combat action costs its actor now (`combat.spend` events), or why it can't be taken; nothing for other actions. */
    "combat.spend": (ctx: ReadContext, actor: EntityId, action: Pick<ActionDef, "combat">) => LedgerEvent[] | Rejection;
    /** Opens a fight's part of a turn before the POV's action; its `after` runs the rest. Null without combat rules. */
    "combat.round": (w: Working, rng: Rng) => FightRound | null;
    /** Ends the fight under way before a time skip the player asked for (`seed`: the run's), with the narrator's line for it; none without a fight. */
    "combat.break_off": (w: Working, seed: string, fight?: string) => string[];
  }
  interface QueryMap {
    /** The `npc.choose` questions before the POV's next turn: each participant acting first, with its legal options by key and their labels. */
    "combat.choices": (ctx: ReadContext) => { key: string; agent: EntityId; options: string[]; labels: Record<string, string> }[];
    /** The fight as the GM sees it; null without one. */
    "combat.gm": (ctx: ReadContext) => EncounterView | null;
    /** Every fight under way as the GM sees it, in the order they began; none without one. */
    "combat.fights": (ctx: ReadContext) => EncounterView[];
    /** A player's line for a change to someone else's HP that the POV sees as a wound band (`hpLine`): no number; undefined for any other event. */
    "combat.hp_line": (ctx: ReadContext, e: LedgerEvent) => string | null | undefined;
    /** Whether someone is in the fight under way, where it is fought: no day plan or schedule moves them, and the clock waits. */
    "combat.engaged": (ctx: ReadContext, id: EntityId) => boolean;
    /** Whether an action suits the fight's state for the POV (`fightOffers`): typed text reads only what the Combat tab and interpret offer. */
    "combat.offers": (ctx: ReadContext, action: Pick<ActionDef, "combat">) => boolean;
    /** The fight under way and its round as one key (`<encounter>:<round>`); null without one. A retry rule counts a new round as a change, since a fight takes no clock time. */
    "combat.round_key": (ctx: ReadContext) => string | null;
  }
}

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/** The fight an event names, when it is under way. */
function current(e: PackEvent, ctx: Pick<ReadContext, "state">): Encounter | Rejection {
  return fightById(ctx.state, strOf(e.data.encounter)) ?? reject("no_fight", say("why_that_fight_is_not_under_way"));
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

/** A `combat.start` event's order, or null when it isn't one: each fighter with its side, an initiative total when one was rolled, and what is left of its budgets. */
function orderOf(v: JsonValue | undefined): Fighter[] | null {
  if (!Array.isArray(v)) return null;
  const out: Fighter[] = [];
  for (const f of v) {
    const left = isRecord(f) ? counts(f.left) : null;
    if (!isRecord(f) || typeof f.id !== "string" || (f.side !== "party" && f.side !== "foes") || !(f.init === null || f.init === undefined || typeof f.init === "number") || !left) return null;
    out.push({ id: f.id, side: f.side, init: typeof f.init === "number" ? f.init : null, down: false, left });
  }
  return out;
}

/** Whether `self` is hostile to `other`: the rules' formula, else a `hostile` relation either way. */
function hostile(ctx: ReadContext, formula: string | undefined, self: EntityId, other: EntityId): boolean {
  return truthy(readFor(ctx, formula ?? "has_rel(self, 'hostile', other) or has_rel(other, 'hostile', self)", { self, other }, false));
}

/** The ids a call names for a side: one id or a list of them. */
function idsOf(v: JsonValue | undefined): EntityId[] {
  return (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]).filter((x): x is string => typeof x === "string" && x !== "");
}

/** The foes the player's own start names: an id, a list of ids, or a selector over who is here; null for "everyone hostile". */
function namedFoes(ctx: ReadContext, v: JsonValue | undefined, here: readonly EntityId[]): EntityId[] | Rejection | null {
  if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
  if (isRecord(v)) {
    // A selector as the visibility reader reads one: a constraint it doesn't know names no one.
    const selector = knownBySelector(v);
    return selector ? here.filter((id) => selectorMatches(ctx.registry, ctx.world, ctx.state, selector, id)) : reject("bad_args", say("why_the_foes_are_ids_or_a_selector"));
  }
  const ids = idsOf(v);
  const away = ids.find((id) => !here.includes(id));
  return away !== undefined ? reject("not_here", say("why_away_isnt_here_to_fight", { away: labelOf(ctx, away) })) : ids;
}

/**
 * The `combat.start` effect (DESIGN §11): a fight between the sides the call names (`with` and `foes`, ids), exactly those
 * fighters and no one else, at `at`, else where all of them stand, else at no place. Someone who stands elsewhere, has no hit
 * points or cannot act is in it all the same (the tool that starts it says so), and a world with no combat rules records
 * the fight with no budgets. The order is `order` (the fighters as the story ranks them), else as the call lists them, with
 * no initiative: the world's initiative check is rolled only when `roll_initiative` asks. A player's own start names no
 * `with` (the POV is the one side) and may name its foes by a selector or none (everyone here hostile to them).
 */
function startFight(a: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection {
  const rules = rulesOf(ctx.world);
  const pov = ctx.world.pov;
  const given = idsOf(a.with);
  const party = given.length > 0 ? given : [pov];
  let foes: EntityId[];
  if (given.length > 0) foes = idsOf(a.foes);
  else {
    if (fightsOf(ctx.state).some((f) => fighterOf(f, pov))) return reject("in_fight", say("why_a_fight_is_already_under_way"));
    const place = placeOfEntity(ctx.state, pov);
    if (place === null) return reject("nowhere", say("why_theres_nowhere_to_fight"));
    if (rules && !canFight(ctx, rules, pov)) return reject("cannot_fight", say("why_you_cant_fight_here"));
    const here = Object.keys(ctx.state.entities)
      .sort()
      .filter((id) => id !== pov && placeOfEntity(ctx.state, id) === place && (rules === null || canFight(ctx, rules, id)));
    const named = namedFoes(ctx, a.foes, here);
    if (named !== null && !Array.isArray(named)) return named;
    foes = named ?? here.filter((id) => hostile(ctx, rules?.sides?.hostile, id, pov));
  }
  if (foes.length === 0) return reject("no_foes", say("why_theres_no_one_to_fight_here"));
  const sides = sidesOf(ctx, party, foes);
  if ("code" in sides) return sides;
  const places = new Set(sides.fighters.map((id) => placeOfEntity(ctx.state, id)));
  const place = typeof a.at === "string" && own(ctx.world.places, a.at) ? a.at : places.size === 1 ? ([...places][0] ?? null) : null;
  const order = rankedOrder(a, ctx, rules, party, sides.fighters);
  if ("code" in order) return order;
  return [{ type: "combat.start", data: { encounter: hashParts(ctx.rng.seed, "encounter").slice(0, 12), place, order } }];
}

/** The fighters of two sides, each once; the refusal when someone is on both sides or is no one in the world. */
function sidesOf(ctx: ReadContext, party: readonly EntityId[], foes: readonly EntityId[]): { fighters: EntityId[] } | Rejection {
  const both = party.find((id) => foes.includes(id));
  if (both !== undefined) return { code: "bad_args", reason: say("why_both_is_named_on_both_sides", { both: labelOf(ctx, both) }), said: both };
  const absent = [...party, ...foes].find((id) => !own(ctx.state.entities, id));
  if (absent !== undefined) return reject("missing_entity", say("why_no_party", { party: labelOf(ctx, absent) }));
  return { fighters: [...new Set([...party, ...foes])] };
}

/**
 * The fighters as a fight records them, in the order the call ranks them (`order`, then the rest as the call lists
 * them), each with its budgets full. The world's initiative check is rolled for each only when `roll_initiative`
 * asks, and then it sets the order and is recorded; a world with no initiative check is answered with its checks.
 */
function rankedOrder(a: Record<string, JsonValue>, ctx: EffectContext, rules: CombatDef | null, party: readonly EntityId[], fighters: readonly EntityId[]): JsonObject[] | Rejection {
  const ranked = [...new Set([...idsOf(a.order).filter((id) => fighters.includes(id)), ...fighters])];
  const rolls = new Map<EntityId, { init: number; tie: number }>();
  if (a.roll_initiative === true) {
    const init = rules ? checkOf(ctx.world, rules.initiative) : null;
    if (!rules || !init) return { code: "no_initiative", reason: say("why_the_world_has_no_initiative_check"), choices: Object.keys(ctx.world.checks), said: "initiative" };
    for (const id of ranked) {
      const ready = readyCheck(ctx.registry, ctx, init, { self: id, actor: id });
      if ("code" in ready) return ready;
      const roll = rollCheck(ready, ctx.rng.fork(`init:${id}`));
      const tie = rules.tieBreak !== undefined ? Number(readFor(ctx, rules.tieBreak, { self: id }, 0)) : ready.modifier;
      rolls.set(id, { init: roll.total, tie: Number.isFinite(tie) ? tie : 0 });
    }
    const pov = ctx.world.pov;
    ranked.sort((x, y) => (rolls.get(y)?.init ?? 0) - (rolls.get(x)?.init ?? 0) || (rolls.get(y)?.tie ?? 0) - (rolls.get(x)?.tie ?? 0) || Number(y === pov) - Number(x === pov) || Number(party.includes(y)) - Number(party.includes(x)) || (x < y ? -1 : x > y ? 1 : 0));
  }
  return ranked.map((id): JsonObject => ({ id, side: party.includes(id) ? "party" : "foes", init: rolls.get(id)?.init ?? null, left: rules ? fullEconomy(ctx, rules, id) : {} }));
}

/**
 * The `combat.join` effect: the fighters a call names, on the sides it gives (`with`, `foes`), join the fight `fight`
 * names that is under way. No one else is added, none already in it is added again, and initiative is rolled for
 * them only when `roll_initiative` asks (they take their place among those who have one, else the end).
 */
function joinFight(a: Record<string, JsonValue>, ctx: EffectContext): LedgerEvent[] | Rejection {
  const enc = fightById(ctx.state, strOf(a.fight));
  if (!enc) return { code: "no_fight", reason: say("why_that_fight_is_not_under_way"), choices: fightsOf(ctx.state).map((f) => f.id), said: strOf(a.fight) };
  const party = idsOf(a.with);
  const foes = idsOf(a.foes);
  if (party.length + foes.length === 0) return reject("no_foes", say("why_no_one_is_named_to_join"));
  const sides = sidesOf(ctx, party, foes);
  if ("code" in sides) return sides;
  const already = sides.fighters.find((id) => fighterOf(enc, id));
  if (already !== undefined) return { code: "bad_args", reason: say("why_already_is_in_that_fight_already", { already: labelOf(ctx, already) }), said: already };
  const add = rankedOrder(a, ctx, rulesOf(ctx.world), party, sides.fighters);
  if ("code" in add) return add;
  return [{ type: "combat.join", data: { encounter: enc.id, add } }];
}

function describeSide(e: PackEvent, side: Side): string {
  const order = Array.isArray(e.data.order) ? e.data.order : [];
  return order.flatMap((f) => (isRecord(f) && f.side === side && typeof f.id === "string" ? [f.id] : [])).join(", ");
}

const events: EventTypeDef<PackEvent>[] = [
  {
    type: "combat.start",
    validate(e, ctx) {
      if (fightById(ctx.state, strOf(e.data.encounter))) return reject("in_fight", say("why_that_fight_is_already_under_way"));
      const order = orderOf(e.data.order);
      if (strOf(e.data.encounter) === "" || !order) return reject("bad_event", say("why_a_fight_needs_an_id_and_an"));
      if (new Set(order.map((f) => f.id)).size !== order.length) return reject("bad_event", say("why_someone_is_in_the_fight_twice"));
      const missing = order.find((f) => !own(ctx.state.entities, f.id));
      if (missing) return reject("missing_entity", say("why_no_party", { party: labelOf(ctx, missing.id) }));
      return null;
    },
    apply(e, state, ctx) {
      // Fights already under way keep what was decided for them.
      if (encounterOf(state) === null) delete mutableSlice(state, PACK).decisions;
      const order = orderOf(e.data.order) ?? [];
      const rules = rulesOf(ctx.world);
      writeEncounter(state, { id: strOf(e.data.encounter), place: typeof e.data.place === "string" ? e.data.place : null, round: 1, turn: 0, order, log: [], calm: { hp: rules ? hpByFighter(ctx, rules, order) : {}, rounds: 0, struck: false } }, ctx.world.pov);
    },
    describe: (e) => say("fight_start", { party: describeSide(e, "party"), foes: describeSide(e, "foes") }),
  },
  {
    type: "combat.join",
    validate(e, ctx) {
      const enc = current(e, ctx);
      if ("code" in enc) return enc;
      const add = orderOf(e.data.add);
      if (!add || add.length === 0) return reject("bad_event", say("why_a_join_names_who_joins_and_on"));
      const twice = add.find((f, i) => fighterOf(enc, f.id) !== undefined || add.findIndex((g) => g.id === f.id) !== i);
      if (twice) return reject("bad_event", say("why_id_is_in_the_fight_twice", { id: labelOf(ctx, twice.id) }));
      const missing = add.find((f) => !own(ctx.state.entities, f.id));
      return missing ? reject("missing_entity", say("why_no_party", { party: labelOf(ctx, missing.id) })) : null;
    },
    apply(e, state, ctx) {
      const enc = fightById(state, strOf(e.data.encounter));
      const added = orderOf(e.data.add) ?? [];
      if (!enc) return;
      const order = [...enc.order];
      let turn = enc.turn;
      for (const f of added) {
        const init = f.init;
        // One who rolled stands before the first who rolled lower; one who did not, last.
        const before = init === null ? -1 : order.findIndex((g) => g.init !== null && g.init < init);
        const index = before < 0 ? order.length : before;
        order.splice(index, 0, f);
        if (index <= turn) turn += 1;
      }
      const rules = rulesOf(ctx.world);
      writeEncounter(state, { ...enc, order, turn, calm: { ...enc.calm, hp: { ...enc.calm.hp, ...(rules ? hpByFighter(ctx, rules, added) : {}) } } });
    },
    describe: (e) => say("fight_join", { who: (Array.isArray(e.data.add) ? e.data.add : []).flatMap((f) => (isRecord(f) && typeof f.id === "string" ? [f.id] : [])).join(", ") }),
  },
  {
    type: "combat.turn",
    validate(e, ctx) {
      const enc = current(e, ctx);
      if ("code" in enc) return enc;
      const round = e.data.round;
      const turn = e.data.turn;
      if (typeof round !== "number" || typeof turn !== "number" || !Number.isInteger(round) || !Number.isInteger(turn)) return reject("bad_event", say("why_a_turn_needs_a_round_and_a"));
      if (enc.order[turn]?.id !== strOf(e.data.actor)) return reject("bad_turn", say("why_that_isnt_who_goes_there"));
      if (round < enc.round || (round === enc.round && turn <= enc.turn)) return reject("bad_turn", say("why_turns_only_move_on"));
      const reset = objOf(e.data.reset);
      for (const [id, budgets] of Object.entries(reset)) if (!fighterOf(enc, id) || !counts(budgets)) return reject("bad_event", say("why_a_refill_names_a_participant_and_its"));
      return null;
    },
    apply(e, state, ctx) {
      const enc = fightById(state, strOf(e.data.encounter));
      if (!enc) return;
      const round = numOf(e.data.round, enc.round);
      const reset = objOf(e.data.reset);
      const rules = rulesOf(ctx.world);
      // A new round ends the one under way: a calm one (no attack in it, everyone's HP as when the calm
      // began) makes the calm longer; anything else starts a new one.
      const now = round > enc.round && rules ? hpByFighter(ctx, rules, enc.order) : null;
      const calm = !now ? enc.calm : !enc.calm.struck && sameHp(now, enc.calm.hp) ? { hp: enc.calm.hp, rounds: enc.calm.rounds + (round - enc.round), struck: false } : { hp: now, rounds: 0, struck: false };
      writeEncounter(state, {
        ...enc,
        round,
        turn: numOf(e.data.turn, enc.turn),
        order: enc.order.map((f) => ({ ...f, left: { ...f.left, ...(counts(own(reset, f.id)) ?? {}) } })),
        log: enc.log.filter((l) => l.round >= round - 1),
        calm,
      });
    },
    describe: (e) => say("fight_turn", { actor: strOf(e.data.actor) }),
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
      if (!rules || !f || !cost || Object.values(cost).some((n) => n <= 0)) return reject("bad_event", say("why_a_spend_needs_a_participant_and_what"));
      if (!standing(ctx, enc, f)) return reject("down", say("why_actor_is_out_of_the_fight", { actor: labelOf(ctx, who) }));
      if (enc.order[enc.turn]?.id !== who && !offTurnCost(rules, cost)) return reject("not_your_turn", say("why_it_isnt_actor_s_turn", { actor: labelOf(ctx, who) }));
      return fits(cost, f.left) ? null : reject("spent", say("why_who_has_nothing_like_that_left", { who: labelOf(ctx, who) }));
    },
    apply(e, state) {
      const enc = fightById(state, strOf(e.data.encounter));
      const cost = counts(e.data.cost) ?? {};
      if (enc) writeEncounter(state, { ...enc, order: enc.order.map((f) => (f.id !== strOf(e.data.who) ? f : { ...f, left: Object.fromEntries(Object.entries(f.left).map(([b, n]) => [b, n - (cost[b] ?? 0)])) })) });
    },
    describe: (e) => say("fight_spend", { who: strOf(e.data.who), costs: Object.keys(objOf(e.data.cost)).join(", ") }),
  },
  {
    type: "combat.act",
    validate(e, ctx) {
      const enc = current(e, ctx);
      if ("code" in enc) return enc;
      return fighterOf(enc, strOf(e.data.actor)) ? null : reject("not_fighting", say("why_actor_isnt_in_this_fight", { actor: labelOf(ctx, strOf(e.data.actor)) }));
    },
    apply(e, state, ctx) {
      const enc = fightById(state, strOf(e.data.encounter));
      if (!enc) return;
      const target = typeof e.data.target === "string" ? e.data.target : null;
      const entry = { round: enc.round, actor: strOf(e.data.actor), action: strOf(e.data.label, strOf(e.data.action)), target, outcome: typeof e.data.outcome === "string" ? e.data.outcome : null };
      // An attack, hit or miss, keeps the round under way from counting toward a stalemate.
      const struck = enc.calm.struck || attacks(ctx, enc, entry.actor, strOf(e.data.action), target);
      writeEncounter(state, { ...enc, log: [...enc.log, entry].slice(-LOG_CAP), calm: { ...enc.calm, struck } });
    },
    describe: (e) => say("fight_act", { actor: strOf(e.data.actor), what: strOf(e.data.label, strOf(e.data.action)), ...(typeof e.data.target === "string" ? { target: e.data.target } : {}), ...(typeof e.data.outcome === "string" ? { outcome: e.data.outcome.replace(/_/g, " ") } : {}) }),
  },
  {
    type: "combat.down",
    validate(e, ctx) {
      const enc = current(e, ctx);
      if ("code" in enc) return enc;
      const rules = rulesOf(ctx.world);
      const who = strOf(e.data.entity);
      if (!rules || !fighterOf(enc, who) || typeof e.data.down !== "boolean") return reject("bad_event", say("why_a_fall_names_a_participant"));
      // Re-read against the state, so a view where the blow never landed drops it.
      return downHolds(ctx, rules, who) === e.data.down ? null : reject("not_down", e.data.down ? say("why_who_isnt_down", { who: labelOf(ctx, who) }) : say("why_who_is_still_down", { who: labelOf(ctx, who) }));
    },
    apply(e, state) {
      const enc = fightById(state, strOf(e.data.encounter));
      if (enc) writeEncounter(state, { ...enc, order: enc.order.map((f) => (f.id === strOf(e.data.entity) ? { ...f, down: e.data.down === true } : f)) });
    },
    describe: (e) => say(e.data.down === true ? "fight_down" : "fight_up", { who: strOf(e.data.entity) }),
  },
  {
    type: "combat.end",
    validate(e, ctx) {
      const enc = current(e, ctx);
      if ("code" in enc) return enc;
      const rules = rulesOf(ctx.world);
      if (e.data.reason === "over" && (!rules || !endHolds(ctx, rules, enc))) return reject("not_over", say("why_the_fight_isnt_over"));
      // Each re-reads the state, so a view where the POV stayed, or someone attacked or was hurt, keeps the fight.
      if (e.data.reason === "left" && !povLeft(ctx.state, ctx.world, enc)) return reject("not_left", say("why_you_are_still_in_the_fight"));
      if (e.data.reason === "stalemate" && (!rules || !stalledHolds(ctx, rules, enc))) return reject("not_stalemate", rules && stalemateRounds(rules) === 0 ? say("why_this_worlds_fights_never_peter_out") : say("why_someone_has_attacked_or_been_hurt_since"));
      return null;
    },
    apply: (e, state, ctx) => removeEncounter(state, strOf(e.data.encounter), ctx.world.pov),
    describe: (e) => say(e.data.reason === "left" ? "fight_left" : e.data.reason === "stalemate" ? "fight_stalemate" : e.data.reason === "skip" ? "fight_broke_off" : "fight_over", e.data.winner === "party" ? { won: true } : e.data.winner === "foes" ? { lost: true } : {}),
  },
  {
    type: "combat.decision",
    validate: (e) => (strOf(e.data.key) !== "" && strOf(e.data.choice) !== "" ? null : reject("bad_event", say("why_a_decision_needs_a_key_and_a"))),
    apply: (e, state) => {
      sliceRecord(state, PACK, "decisions")[strOf(e.data.key)] = strOf(e.data.choice);
    },
    describe: (e) => say("fight_decided", { choice: strOf(e.data.choice) }),
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
    // The bestiary: the world's own ordinary foes and strangers, shipped with no rows so every world has the table and Build's editor lists it.
    r.table({ id: BESTIARY_TABLE, schema: BESTIARY_SCHEMA, columns: BESTIARY_COLUMNS, defaults: emptyBestiary(), shipped: [] });

    r.effect({ type: "combat.start", args: ["with?", "foes?", "at?", "order?", "roll_initiative?"], resolve: (a, ctx) => startFight(a, ctx) });
    r.effect({ type: "combat.join", args: ["fight", "with?", "foes?", "order?", "roll_initiative?"], resolve: (a, ctx) => joinFight(a, ctx) });
    r.effect({
      type: "combat.end",
      args: ["winner?", "fight?"],
      resolve(a, ctx) {
        const enc = a.fight === undefined ? encounterOf(ctx.state) : fightById(ctx.state, strOf(a.fight));
        if (!enc) return { code: "no_fight", reason: say("why_no_fight_is_under_way"), choices: fightsOf(ctx.state).map((f) => f.id), said: strOf(a.fight) };
        // The winner is the call's; none given, none is recorded, though only one side stands.
        const winner = a.winner === "party" || a.winner === "foes" ? a.winner : null;
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
        if (!rules || !enc) return reject("no_fight", say("why_no_fight_is_under_way"));
        if (enc.order[enc.turn]?.id !== who) return reject("not_your_turn", who === ctx.world.pov ? say("why_it_isnt_your_turn") : say("why_it_isnt_actor_s_turn", { actor: labelOf(ctx, who) }));
        const next = nextTurn(ctx, rules, enc);
        if (!next) return reject("no_one", say("why_no_one_is_left_to_take_a"));
        // What the turn brings of itself by the world's tabletop rules, for whom it comes to (a dying fighter's roll, a length counted in turns).
        const actor = strOf(next.type === "combat.turn" && "data" in next ? next.data.actor : undefined);
        return [next, ...(optionalService(ctx, "d20.upkeep")?.(ctx, actor, ctx.rng.fork("upkeep")) ?? [])];
      },
    });
    r.effect({ type: "combat.spend", args: ["who?", "cost"], resolve: (a, ctx) => spendFor(ctx, strOf(a.who) || ctx.world.pov, { combat: { cost: counts(a.cost) ?? {} } }) });

    r.service("combat.spend", spendFor);
    r.service("combat.round", openRound);
    r.service("combat.break_off", breakOff);
    r.query("combat.choices", fightChoices);
    r.query("combat.gm", (ctx) => buildEncounterView(ctx, { gm: true }));
    r.query("combat.fights", (ctx) => fightsOf(ctx.state).flatMap((f) => buildEncounterView(ctx, { gm: true, fight: f.id }) ?? []));
    r.query("combat.hp_line", hpLine);
    r.query("combat.engaged", (ctx, id) => engaged(ctx.state, ctx.world, id));
    r.query("combat.offers", (ctx, action) => fightOffers(ctx.world, ctx.state, action));
    r.query("combat.round_key", (ctx) => {
      const enc = encounterOf(ctx.state);
      return enc ? `${enc.id}:${enc.round}` : null;
    });

    // Who is hostile to whom, as the default sides rule reads it (either way, as a link authored on one side only reads before a chat completes it).
    r.relation({ id: "hostile", label: "Hostile to", from: "*", to: "*", cardinality: "many_many", symmetric: true, fields: {}, pack: PACK });

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
      return enc && (side === "party" || side === "foes") ? standingOn(ctx, enc, side).length : 0;
    });
    r.formula("encounter_round", (ctx) => encounterOf(ctx.state)?.round ?? 0);
    r.formula("budget_left", (ctx, e, budget) => own(fighterArg(ctx, e)?.f.left ?? {}, String(budget ?? "")) ?? 0);
    // Whether someone in a fight under way has had a turn of theirs come in it (flat-footed until then, by a ruleset that says so); null for one in no fight.
    r.formula("has_acted", (ctx, e) => {
      const id = String(e ?? "");
      const enc = fightsOf(ctx.state).find((f) => fighterOf(f, id) !== undefined);
      if (!enc) return null;
      const at = enc.order.findIndex((f) => f.id === id);
      return enc.round > 1 || at <= enc.turn || enc.log.some((l) => l.actor === id);
    });

    // A fight's own actions; only worlds with combat rules offer them (`offersAction`).
    r.action({
      id: "fight",
      pack: PACK,
      params: { target: { type: "ref" } },
      requires: ["can_fight(target)"],
      combat: { cost: {}, start: true },
      outcomes: { default: [{ type: "combat.start", args: { foes: "target" } }] },
      duration: "0",
      lexicon: ["start a fight", "pick a fight", "draw my weapon"],
      observable: "starts a fight",
    });
    r.action({
      id: "end_turn",
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
export { combatEntries, fightOffers, paletteEncounter } from "./view";
