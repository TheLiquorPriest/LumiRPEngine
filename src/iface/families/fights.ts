// Fights (the skill `combat`): an encounter started with its foes, read, and ended, as today's fight
// tools do through the combat pack (`packs/combat`): its effects start and end an encounter, the
// initiative it rolls sets the order, and a world rule hears both. Nothing here rolls or rules. A
// fight started while one is on, or ended when none is, changes nothing and the answer says so.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { applyEffects } from "../../engine/effects";
import { optionalService } from "../../engine/pack-kit";
import type { ReadContext } from "../../engine/registry";
import { createRng } from "../../engine/rng";
import { runRulesOnEvents } from "../../engine/rules";
import { encounterOf, rulesOf } from "../../packs/combat/core/model";
import { buildEncounterView } from "../../packs/combat/core/view";
import type { StoreState } from "../../store/types";
import { oneOf, TEXTS, YES_NO } from "../kit";
import { find, isUnread, named, notOneOf, type OpContext } from "../ops";
import { notApplicable, readTool, type WriteDef, writeTool } from "./run";

const FAMILY = "fights";

/** The two sides of an encounter, as the combat pack names them. */
const SIDES = ["party", "foes"] as const;

/** The encounter as the game master's view of it has it (who fights on which side, the initiative order, whose turn, the round), or null when no fight is on. */
function fightView(ctx: ReadContext): JsonValue {
  return (buildEncounterView(ctx, { gm: true }) as unknown as JsonValue) ?? null;
}

/** The fight as the state recorded stands, for the answer. */
function fightAfter(o: OpContext): (state: StoreState) => JsonObject {
  return (state) => ({ fight: fightView(o.reading.registry.context(o.reading.doc, state.world)) });
}

const start: WriteDef = {
  name: "fight_start",
  family: FAMILY,
  lane: "engine",
  properties: { foes: TEXTS },
  required: ["foes"],
  example: { foes: ["Grey wolf"], source: { from: "prose", message: "m-0501" } },
  run(o) {
    const w = o.draft.w;
    if (rulesOf(w.world) === null) return notApplicable(o, "no_combat");
    const pov = w.world.pov;
    const foes: string[] = [];
    for (const said of Array.isArray(o.args.foes) ? o.args.foes : []) {
      const foe = find(o, "foes", "person", false, said);
      if (isUnread(foe)) return foe;
      foes.push(foe.id);
    }
    const from = w.events.length;
    o.after(fightAfter(o));
    if (encounterOf(w.state) !== null) {
      o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, pov) });
      o.draft.record(o.n, o.op, "engine", o.prov, from);
      return undefined;
    }
    const seed = o.draft.seed(o.n);
    // Whoever the fight takes in fights as recorded: detail nobody recorded is filled in only when an agent asks for it (`fill_in_detail`).
    const out = applyEffects(o.reading.registry, w, [{ type: "combat.start", args: { foes } }], { bindings: { self: pov }, rng: createRng(seed), literal: true });
    const refused = out.rejected[0]?.rejection;
    if (refused !== undefined) return notApplicable(o, refused.code);
    runRulesOnEvents(o.reading.registry, w, out.applied, { seed });
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
    o.after(fightAfter(o));
    if (encounterOf(w.state) === null) {
      o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, w.world.pov) });
      o.draft.record(o.n, o.op, "engine", o.prov, from);
      return undefined;
    }
    const seed = o.draft.seed(o.n);
    if (o.args.break_off === true) optionalService(w.ctx, "combat.break_off")?.(w, seed);
    else {
      const out = applyEffects(o.reading.registry, w, [{ type: "combat.end", args: typeof winner === "string" ? { winner } : {} }], { bindings: { self: w.world.pov }, rng: createRng(seed), literal: true });
      const refused = out.rejected[0]?.rejection;
      if (refused !== undefined) return notApplicable(o, refused.code);
      // A world rule may hear a fight's end (an award, say), as it hears one the round records.
      runRulesOnEvents(o.reading.registry, w, out.applied, { seed });
    }
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
