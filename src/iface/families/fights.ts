// Fights (the skill `combat`): an encounter between the sides the call names, read, and ended, as the
// combat pack (`packs/combat`) records one. A fight is exactly the fighters named, at the place named or
// where they all stand; nobody joins by code, no initiative is rolled unless the call asks, no winner is
// decided, and a world with no combat rules records the fight all the same. A world rule that hears a
// fight's start or end is listed in the answer and not run. A fight started while one is on, or ended when
// none is, changes nothing and the answer says so.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { optionalService } from "../../engine/pack-kit";
import type { ReadContext } from "../../engine/registry";
import { rulesHearing } from "../../engine/rules";
import { placeOfEntity } from "../../engine/scope";
import { canFight, encounterOf, rulesOf } from "../../packs/combat/core/model";
import { buildEncounterView } from "../../packs/combat/core/view";
import type { StoreState } from "../../store/types";
import { oneOf, TEXT, TEXTS, YES_NO } from "../kit";
import { find, findOptional, isUnread, named, notOneOf, type OpContext, type Unread } from "../ops";
import { effectChange, notApplicable, readTool, type WriteDef, writeTool } from "./run";

const FAMILY = "fights";

/** The two sides of an encounter, as the combat pack names them. */
const SIDES = ["party", "foes"] as const;

/** The encounter as the game master's view of it has it (who fights on which side, the initiative order, whose turn, the round), or null when no fight is on. */
function fightView(ctx: ReadContext): JsonValue {
  return (buildEncounterView(ctx, { gm: true }) as unknown as JsonValue) ?? null;
}

/** The fight as the state recorded stands, for the answer, with the world rules that hear what the call recorded (listed, none of them run). */
function fightAfter(o: OpContext, heard: JsonObject[]): (state: StoreState) => JsonObject {
  return (state) => ({ fight: fightView(o.reading.registry.context(o.reading.doc, state.world)), ...(heard.length > 0 ? { rules_heard: heard } : {}) });
}

/** The people one side of a call names, as ids; the line that says a side is missing, or a name is not read, otherwise. */
function sideOf(o: OpContext, field: string): string[] | Unread {
  const said = o.args[field];
  if (!Array.isArray(said) || said.length === 0) return { line: "needs", fields: { n: o.n, op: o.op, fields: [field] } };
  const ids: string[] = [];
  for (const one of said) {
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
  properties: { with: TEXTS, foes: TEXTS, at: TEXT, order: TEXTS, roll_initiative: YES_NO },
  required: ["with", "foes"],
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
    const ranking: string[] = [];
    for (const one of Array.isArray(o.args.order) ? o.args.order : []) {
      const found = find(o, "order", "person", false, one);
      if (isUnread(found)) return found;
      if (![...party, ...foes].includes(found.id)) return notOneOf(o, "order", one, [...party, ...foes]);
      ranking.push(found.id);
    }
    const heard: JsonObject[] = [];
    o.after(fightAfter(o, heard));
    const from = w.events.length;
    if (encounterOf(w.state) !== null) {
      o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, w.world.pov) });
      o.draft.record(o.n, o.op, "engine", o.prov, from);
      return undefined;
    }
    const refused = effectChange(o, { type: "combat.start", args: { with: party, foes, ...(at !== undefined ? { at: at.id } : {}), ...(ranking.length > 0 ? { order: ranking } : {}), ...(o.args.roll_initiative === true ? { roll_initiative: true } : {}) } });
    if (refused !== null) return notApplicable(o, refused.code);
    // What the fight left out of order is said, not mended: nobody is moved, healed or dropped.
    const rules = rulesOf(w.world);
    const fight = encounterOf(w.state);
    const place = fight?.place ?? null;
    if (rules === null) o.reply.report("no_combat_rules", { n: o.n, op: o.op });
    if (place === null) o.reply.report("nowhere", { n: o.n, op: o.op });
    for (const f of fight?.order ?? []) {
      if (place !== null && placeOfEntity(w.state, f.id) !== place) o.reply.report("not_here", { n: o.n, op: o.op, who: named(o.reading, f.id), place: named(o.reading, place) });
      if (rules !== null && !canFight(w.ctx, rules, f.id)) o.reply.report("cannot_fight", { n: o.n, op: o.op, who: named(o.reading, f.id) });
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
  properties: { winner: oneOf(SIDES), break_off: YES_NO },
  required: [],
  example: { winner: "party", source: { from: "prose", message: "m-0502" } },
  run(o) {
    const w = o.draft.w;
    const winner = o.args.winner;
    if (winner !== undefined && winner !== null && !SIDES.some((s) => s === winner)) return notOneOf(o, "winner", winner, SIDES);
    const from = w.events.length;
    const heard: JsonObject[] = [];
    o.after(fightAfter(o, heard));
    if (encounterOf(w.state) === null) {
      o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, w.world.pov) });
      o.draft.record(o.n, o.op, "engine", o.prov, from);
      return undefined;
    }
    if (o.args.break_off === true) {
      const breakOff = optionalService(w.ctx, "combat.break_off");
      // The combat pack is always loaded where a fight is on: its service missing is the engine's fault, not the story's.
      if (!breakOff) throw new Error("the combat pack's break_off service is not registered");
      breakOff(w, o.draft.seed(o.n));
      if (encounterOf(w.state) !== null) o.reply.line("fight_still_on", { n: o.n, op: o.op });
      else o.reply.line("fight_broke_off", { n: o.n, op: o.op });
    } else {
      const refused = effectChange(o, { type: "combat.end", args: typeof winner === "string" ? { winner } : {} });
      if (refused !== null) return notApplicable(o, refused.code);
    }
    heard.push(...hearing(o, from));
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

const read = readTool({
  name: "fight_read",
  family: FAMILY,
  properties: {},
  required: [],
  example: {},
  read(r, _args, reply) {
    reply.data({ fight: fightView(r.ctx) });
    return undefined;
  },
});

/** The family's tools, as RPH's search finds them. */
export const FIGHT_TOOLS = [writeTool(start), read, writeTool(end)];
