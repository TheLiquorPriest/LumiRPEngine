// A fight played a round at a time (the skill `combat`): what each fighter did, as the agents decided it, is
// recorded in the order the call gives, and after each the fight goes on to the next turn, a new round once
// everyone has had theirs. Code decides nothing of a fighter's choice and rolls nothing (a roll is cited by its
// id, from `roll`). What the world's fight rules would turn away is reported and recorded all the same: a fighter
// who acts more than once in a round, one who acts out of the order, a blow at someone beyond the map's reach.
// Where the fight is on a grid that counts rounds, the clock moves by those rounds, in seconds.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import type { LedgerEvent } from "../../shared/ledger";
import { mapSettingsOf } from "../../shared/maps";
import type { ReadContext } from "../../engine/registry";
import { nextTurn } from "../../packs/combat/core/flow";
import { fightById, fighterOf, fightsOf, rulesOf, type Encounter } from "../../packs/combat/core/model";
import { groundAt, roundsTime, spotOf } from "../../packs/space/core/grid-model";
import { reach } from "../../packs/space/core/positions";
import { TEXT } from "../kit";
import { find, isUnread, named, notAs, notOneOf, type OpContext } from "../ops";
import { fightAfter, noSuchFight } from "./fights";
import { notApplicable, type WriteDef, writeTool } from "./run";

const FAMILY = "fights";

/** One fighter's action as the call gives it. */
interface Act {
  who: string;
  did: string;
  to: string | null;
  result: string | null;
  roll: string | null;
}

/** The turn after the current one, as the fight's rules count it; with no rules, the next in the order. */
function turnAfter(ctx: ReadContext, enc: Encounter): LedgerEvent | null {
  const rules = rulesOf(ctx.world);
  if (rules !== null) return nextTurn(ctx, rules, enc);
  const n = enc.order.length;
  const next = enc.order[(enc.turn + 1) % n];
  return next === undefined ? null : { type: "combat.turn", data: { encounter: enc.id, round: enc.round + (enc.turn + 1 >= n ? 1 : 0), turn: (enc.turn + 1) % n, actor: next.id, reset: {} } };
}

/** Whether `a` stands on a grid with `b` and `b` is beyond `a`'s reach there; false where the map cannot say. */
function beyondReach(ctx: ReadContext, a: string, b: string): boolean {
  if (!mapSettingsOf(ctx.world).grid.movement) return false;
  const [sa, sb] = [spotOf(ctx.world, ctx.state, a), spotOf(ctx.world, ctx.state, b)];
  return sa !== null && sb !== null && sa.scope === sb.scope && !reach(ctx, a, b);
}

/** The actions of the call, each read: who acts is in the fight, who it is aimed at is someone or something recorded. Or what could not be read. */
function actsOf(o: OpContext, fight: Encounter): Act[] | ReturnType<typeof notAs> {
  const out: Act[] = [];
  for (const raw of Array.isArray(o.args.actions) ? o.args.actions : []) {
    if (!isRecord(raw)) return notAs(o, "actions", raw, "fight_action");
    const who = find(o, "actions.who", "person", false, raw.who);
    if (isUnread(who)) return who;
    if (fighterOf(fight, who.id) === undefined) return notOneOf(o, "actions.who", raw.who ?? null, fight.order.map((f) => named(o.reading, f.id)));
    const did = typeof raw.did === "string" ? raw.did.trim() : "";
    if (did === "") return { line: "needs", fields: { n: o.n, op: o.op, fields: ["actions.did"] } };
    let to: string | null = null;
    if (raw.to !== undefined && raw.to !== null && raw.to !== "") {
      const target = find(o, "actions.to", "entity", false, raw.to);
      if (isUnread(target)) return target;
      to = target.id;
    }
    const text = (v: JsonValue | undefined): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
    out.push({ who: who.id, did, to, result: text(raw.result), roll: text(raw.roll) });
  }
  return out;
}

const round: WriteDef = {
  name: "fight_round",
  family: FAMILY,
  lane: "engine",
  properties: {
    fight: TEXT,
    actions: { type: "array", minItems: 1, items: { type: "object", required: ["who", "did"], properties: { who: TEXT, did: TEXT, to: TEXT, result: TEXT, roll: TEXT } } },
  },
  required: ["actions"],
  example: { actions: [{ who: "Mara", did: "swings her axe", to: "Grey wolf", result: "hit, 5 damage", roll: "roll-0011" }, { who: "Grey wolf", did: "bites at her arm", to: "Mara", result: "miss" }], source: { from: "prose", message: "m-0503" } },
  run(o) {
    const w = o.draft.w;
    const under = fightsOf(w.state);
    const said = o.args.fight;
    const fight = said === undefined || said === null || said === "" ? (under.length === 1 ? under[0] : null) : fightById(w.state, String(said));
    if (!fight) return noSuchFight(o, said, under);
    const acts = actsOf(o, fight);
    if (!Array.isArray(acts)) return acts;
    o.after(fightAfter(o, []));
    const from = w.events.length;
    const rounds0 = fight.round;
    for (const act of acts) {
      const enc = fightById(w.state, fight.id);
      if (enc === null) break;
      // What the fight's rules would turn away is said, and the act is recorded all the same.
      // The fight's own log holds the acts of this round already made, this call's earlier ones among them.
      const before = enc.log.filter((l) => l.round === enc.round && l.actor === act.who).length;
      const whose = enc.order[enc.turn]?.id;
      if (before > 0) o.reply.report("acted_twice", { n: o.n, op: o.op, who: named(o.reading, act.who), round: enc.round, times: before + 1 });
      if (whose !== undefined && whose !== act.who) o.reply.report("out_of_turn", { n: o.n, op: o.op, who: named(o.reading, act.who), whose: named(o.reading, whose) });
      if (act.to !== null && beyondReach(w.ctx, act.who, act.to)) o.reply.report("out_of_reach", { n: o.n, op: o.op, who: named(o.reading, act.who), target: named(o.reading, act.to) });
      const data: JsonObject = { encounter: enc.id, actor: act.who, action: act.did, label: act.did, ...(act.to !== null ? { target: act.to } : {}), ...(act.result !== null ? { outcome: act.result } : {}), ...(act.roll !== null ? { roll: act.roll } : {}) };
      const done = o.draft.applyAll([{ type: "combat.act", data }]);
      if (done) return notApplicable(o, done.code);
      const now = fightById(w.state, fight.id);
      const next = now === null ? null : turnAfter(w.ctx, now);
      if (next !== null) {
        const moved = o.draft.applyAll([next]);
        if (moved) return notApplicable(o, moved.code);
      }
    }
    // Where the fight is on a grid that counts rounds, the rounds that went by are seconds on the clock; on any other, a fight takes no clock time.
    const after = fightById(w.state, fight.id);
    const rounds = after === null ? 0 : after.round - rounds0;
    const ground = rounds > 0 && fight.place !== null ? groundAt(w.ctx, fight.place) : null;
    const took = ground === null ? null : roundsTime(ground.drawn.scale, rounds);
    if (took !== null) {
      const moved = o.draft.applyAll([{ type: "clock", minutes: took.seconds / 60, cause: "action" }]);
      if (moved) return notApplicable(o, moved.code);
      o.reply.line("rounds_clock", { n: o.n, op: o.op, rounds, one: rounds === 1, seconds: took.seconds });
    }
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

/** The round tool, as RPH's search finds it. */
export const ROUND_TOOLS = [writeTool(round)];
