// Fights (the skill `combat`): encounters between the sides a call names, read, and ended, as the combat
// pack (`packs/combat`) records them. A fight is exactly the fighters named, at the place named or where
// they all stand; nobody joins by code, no initiative is rolled unless the call asks, no winner is decided,
// and a world with no combat rules records the fight all the same. Several fights run at once, each by its
// id at its place; a start that names a fight under way (by its id, or the place it is at) adds the fighters
// named to it. A world rule that hears a fight's start, join or end is listed in the answer and not run.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { optionalService } from "../../engine/pack-kit";
import type { ReadContext } from "../../engine/registry";
import { rulesHearing } from "../../engine/rules";
import { placeOfEntity } from "../../engine/scope";
import { canFight, fightById, fightsOf, rulesOf, type Encounter } from "../../packs/combat/core/model";
import { buildEncounterView } from "../../packs/combat/core/view";
import type { StoreState } from "../../store/types";
import { oneOf, TEXT, TEXTS, YES_NO } from "../kit";
import { find, findOptional, isUnread, named, notOneOf, type OpContext, type Unread } from "../ops";
import { effectChange, notApplicable, readTool, type WriteDef, writeTool } from "./run";
import { isOn as rulesOn } from "../../packs/d20/core/model";

const FAMILY = "fights";

/** The two sides of an encounter, as the combat pack names them. */
const SIDES = ["party", "foes"] as const;

/** The fights under way as the game master's view of each has it (the fight's id and place, who fights on which side, the order, whose turn, the round), the one named or all. */
function fightViews(ctx: ReadContext, only?: string): JsonValue {
  return fightsOf(ctx.state).flatMap((f) => (only === undefined || f.id === only ? (buildEncounterView(ctx, { gm: true, fight: f.id }) ?? []) : [])) as unknown as JsonValue;
}

/** The fights as the state recorded stands, for the answer, with the world rules that hear what the call recorded (listed, none of them run). */
export function fightAfter(o: OpContext, heard: JsonObject[]): (state: StoreState) => JsonObject {
  return (state) => ({ fights: fightViews(o.reading.registry.context(o.reading.doc, state.world)), ...(heard.length > 0 ? { rules_heard: heard } : {}) });
}

/** The fights under way as the answer lists them, each by its id and its place. */
function listed(r: { nameOf(id: string): string }, fights: readonly Encounter[]): string {
  return fights.map((f) => (f.place === null ? f.id : `${f.id} at ${r.nameOf(f.place)} [${f.place}]`)).join("; ");
}

/** The line that says a fight is not under way, with the fights that are: the fight named by an id, or the line that says which to name when several are. */
export function noSuchFight(o: OpContext, said: JsonValue | undefined, fights: readonly Encounter[]): Unread {
  const ids = fights.map((f) => f.id);
  if (said === undefined || said === null || said === "") return { line: "which_fight", fields: { n: o.n, op: o.op, fights: listed(o.reading, fights) }, data: { field: "fight", choices: ids } };
  return { line: "unknown_fight", fields: { n: o.n, op: o.op, fight: typeof said === "string" ? said : JSON.stringify(said), fights: fights.length === 0 ? "none" : listed(o.reading, fights) }, data: { field: "fight", choices: ids } };
}

/** The people one side of a call names, as ids (none when it names none); the line that says a name is not read otherwise. */
function sideOf(o: OpContext, field: string): string[] | Unread {
  const ids: string[] = [];
  for (const one of Array.isArray(o.args[field]) ? o.args[field] : []) {
    const found = find(o, field, "person", false, one);
    if (isUnread(found)) return found;
    ids.push(found.id);
  }
  return ids;
}

/** The world rules that hear what a call recorded since `from`, as data: each one's id, the effects it names and its beat's hint; none is run. */
function hearing(o: OpContext, from: number): JsonObject[] {
  return rulesHearing(o.reading.registry, o.draft.w, o.draft.w.events.slice(from)).map((r) => ({ rule: r.id, effects: r.do.map((e) => e.type), ...(r.beat !== undefined ? { hint: r.beat.hint } : {}) }));
}

const start: WriteDef = {
  name: "fight_start",
  family: FAMILY,
  lane: "engine",
  properties: { with: TEXTS, foes: TEXTS, at: TEXT, fight: TEXT, order: TEXTS, roll_initiative: YES_NO },
  required: [],
  example: { with: ["Mara"], foes: ["Grey wolf"], at: "Old mill", source: { from: "prose", message: "m-0501" } },
  run(o) {
    const w = o.draft.w;
    const party = sideOf(o, "with");
    if (isUnread(party)) return party;
    const foes = sideOf(o, "foes");
    if (isUnread(foes)) return foes;
    const both = party.find((id) => foes.includes(id));
    if (both !== undefined) return { line: "named_both", fields: { n: o.n, op: o.op, who: named(o.reading, both) } };
    const at = findOptional(o, "at", "place");
    if (at !== undefined && isUnread(at)) return at;
    const fighters = [...party, ...foes];
    const ranking: string[] = [];
    for (const one of Array.isArray(o.args.order) ? o.args.order : []) {
      const found = find(o, "order", "person", false, one);
      if (isUnread(found)) return found;
      if (!fighters.includes(found.id)) return notOneOf(o, "order", one, fighters);
      ranking.push(found.id);
    }
    // A fight named by its id, or one under way at the place the call gives or the fighters all stand at, is joined; any other start is a fight of its own.
    const under = fightsOf(w.state);
    const places = new Set(fighters.map((id) => placeOfEntity(w.state, id)));
    const place = at?.id ?? (places.size === 1 ? ([...places][0] ?? null) : null);
    const said = o.args.fight;
    const joined = said === undefined || said === null || said === "" ? (place === null ? undefined : under.find((f) => f.place === place)) : fightById(w.state, String(said));
    if (joined === null) return noSuchFight(o, said, under);
    for (const [field, side] of [["with", party], ["foes", foes]] as const) if (side.length === 0 && (joined === undefined || fighters.length === 0)) return { line: "needs", fields: { n: o.n, op: o.op, fields: [field] } };
    const heard: JsonObject[] = [];
    o.after(fightAfter(o, heard));
    const from = w.events.length;
    const args: JsonObject = { with: party, foes };
    if (ranking.length > 0) args.order = ranking;
    // Under the world's tabletop rules, initiative is rolled from the sheet unless the call gives the order or says not to.
    if (o.args.roll_initiative === true || (o.args.roll_initiative === undefined && ranking.length === 0 && rulesOn(w.ctx))) args.roll_initiative = true;
    if (joined !== undefined) args.fight = joined.id;
    else if (at !== undefined) args.at = at.id;
    const refused = effectChange(o, { type: joined === undefined ? "combat.start" : "combat.join", args });
    if (refused !== null) return notApplicable(o, refused.code);
    // What the fight left out of order is said, not mended: nobody is moved, healed or dropped.
    const rules = rulesOf(w.world);
    const fight = fightById(w.state, joined?.id ?? fightsOf(w.state).find((f) => !under.some((u) => u.id === f.id))?.id ?? "");
    const fightPlace = fight?.place ?? null;
    if (joined !== undefined) o.reply.report("joined", { n: o.n, op: o.op, fight: joined.id, who: fighters.map((id) => named(o.reading, id)).join(", ") });
    else {
      if (rules === null) o.reply.report("no_combat_rules", { n: o.n, op: o.op });
      if (fightPlace === null) o.reply.report("nowhere", { n: o.n, op: o.op });
    }
    for (const id of fighters) {
      if (fightPlace !== null && placeOfEntity(w.state, id) !== fightPlace) o.reply.report("not_here", { n: o.n, op: o.op, who: named(o.reading, id), place: named(o.reading, fightPlace) });
      if (rules !== null && !canFight(w.ctx, rules, id)) o.reply.report("cannot_fight", { n: o.n, op: o.op, who: named(o.reading, id) });
    }
    heard.push(...hearing(o, from));
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

const end: WriteDef = {
  name: "fight_end",
  family: FAMILY,
  lane: "engine",
  properties: { fight: TEXT, winner: oneOf(SIDES), break_off: YES_NO },
  required: [],
  example: { winner: "party", source: { from: "prose", message: "m-0502" } },
  run(o) {
    const w = o.draft.w;
    const winner = o.args.winner;
    if (winner !== undefined && winner !== null && !SIDES.some((s) => s === winner)) return notOneOf(o, "winner", winner, SIDES);
    const from = w.events.length;
    const heard: JsonObject[] = [];
    o.after(fightAfter(o, heard));
    const under = fightsOf(w.state);
    if (under.length === 0) {
      o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, w.world.pov) });
      o.draft.record(o.n, o.op, "engine", o.prov, from);
      return undefined;
    }
    // With several fights on, the call names the one it ends.
    const said = o.args.fight;
    const ended = said === undefined || said === null || said === "" ? (under.length === 1 ? under[0] : null) : fightById(w.state, String(said));
    if (!ended) return noSuchFight(o, said, under);
    if (o.args.break_off === true) {
      const breakOff = optionalService(w.ctx, "combat.break_off");
      // The combat pack is always loaded where a fight is on: its service missing is the engine's fault, not the story's.
      if (!breakOff) throw new Error("the combat pack's break_off service is not registered");
      breakOff(w, o.draft.seed(o.n), ended.id);
      if (fightById(w.state, ended.id) !== null) o.reply.line("fight_still_on", { n: o.n, op: o.op });
      else o.reply.line("fight_broke_off", { n: o.n, op: o.op });
    } else {
      const refused = effectChange(o, { type: "combat.end", args: { fight: ended.id, ...(typeof winner === "string" ? { winner } : {}) } });
      if (refused !== null) return notApplicable(o, refused.code);
    }
    // Under the tabletop rules, who took part, and the call that gives experience for what was overcome (`act award`): told, never run.
    if (rulesOn(w.ctx) && fightById(w.state, ended.id) === null) {
      const party = ended.order.filter((f) => f.side === "party").map((f) => named(o.reading, f.id));
      const foes = ended.order.filter((f) => f.side === "foes").map((f) => named(o.reading, f.id));
      const first = ended.order.find((f) => f.side === "party");
      if (first !== undefined && foes.length > 0) {
        const others = ended.order.filter((f) => f.side === "party" && f.id !== first.id).map((f) => o.reading.nameOf(f.id));
        const call = { op: "act", action: "award", who: o.reading.nameOf(first.id), params: { overcame: ended.order.filter((f) => f.side === "foes").map((f) => o.reading.nameOf(f.id)), ...(others.length > 0 ? { also: others } : {}) } };
        o.reply.line("d20_fight_award", { n: o.n, op: o.op, party: party.join(", "), foes: foes.join(", "), call: JSON.stringify(call) });
      }
    }
    heard.push(...hearing(o, from));
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

const read = readTool({
  name: "fight_read",
  family: FAMILY,
  properties: { fight: TEXT },
  required: [],
  example: {},
  read(r, args, reply) {
    const said = args.fight;
    if (said !== undefined && said !== null && said !== "") {
      if (fightById(r.ctx.state, String(said)) === null) {
        const under = fightsOf(r.ctx.state);
        return { line: "unknown_fight", fields: { fight: String(said), fights: under.length === 0 ? "none" : listed(r, under) }, data: { field: "fight", choices: under.map((f) => f.id) } };
      }
      reply.data({ fights: fightViews(r.ctx, String(said)) });
      return undefined;
    }
    reply.data({ fights: fightViews(r.ctx) });
    return undefined;
  },
});

/** The family's tools, as RPH's search finds them. */
export const FIGHT_TOOLS = [writeTool(start), read, writeTool(end)];
