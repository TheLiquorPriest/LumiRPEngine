// The checks family (plan §6.8, found by search): `checks_odds`, an action's odds on the state at the
// call's turn, as today's palette reads them (`engine/resolve.ts` `actionOdds`: the ready check the
// roll reads too, so the odds are the real odds). Any action by anyone: whether it can be tried now
// and, when not, the engine's code for why; the chance of each outcome; the dice, the modifier, the
// DC, advantage and whom it is rolled against; and what the world's adjudication policy makes of it.
// It changes nothing, and its answer is data.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import { parseMoneyInput } from "../../shared/money";
import type { ActionDef, ParamDef } from "../../shared/world";
import { policyFor } from "../../engine/adjudication";
import { offeredActions } from "../../engine/offered";
import { own } from "../../engine/pack-kit";
import { actionOdds } from "../../engine/resolve";
import { OBJECT, TEXT, type ToolSpec } from "../kit";
import { isUnread, named, type Unread } from "../ops";
import type { Reading } from "../reading";
import { textOf } from "../texts";
import { foundIn, type ReadDef, readTool } from "./run";

const FAMILY = "checks";

/** A probability in percent, to a tenth. */
function percent(p: number): number {
  return Math.round(p * 1000) / 10;
}

/** Every action a call may name: the packs', less the tabletop rules' while they are off in this chat, and the world's own over a pack's of the same id. */
function actionsOf(r: Reading): Map<string, ActionDef> {
  return offeredActions(r.registry, r.ctx);
}

/**
 * An argument as the action takes it (today's `prepare`), from what the call wrote: a name found as
 * a place or as someone or something, a list of names each found, a number, an amount in the
 * world's coin, or a yes or no; any other, and one the action does not take, as given.
 */
function paramValue(r: Reading, field: string, def: ParamDef | undefined, given: JsonValue): JsonValue | Unread {
  const said = typeof given === "string" ? given.trim() : "";
  if (!def || said === "") return given;
  switch (def.type) {
    case "ref": {
      const f = foundIn(r, field, said, def.ref === "place" ? "place" : "entity");
      return isUnread(f) ? f : f.id;
    }
    case "list": {
      if (def.ref === undefined) return given;
      const ids: string[] = [];
      for (const part of said.split(",").map((p) => p.trim())) {
        if (part === "") continue;
        const f = foundIn(r, field, part, "entity");
        if (isUnread(f)) return f;
        ids.push(f.id);
      }
      return ids.join(",");
    }
    case "number":
    case "duration":
      return Number.isFinite(Number(said)) ? Number(said) : given;
    case "money":
      return parseMoneyInput(said, r.world.currency) ?? given;
    case "bool":
      return said === "true" ? true : said === "false" ? false : given;
    default:
      return given;
  }
}

const odds: ReadDef = {
  name: "checks_odds",
  family: FAMILY,
  properties: { action: TEXT, actor: TEXT, params: OBJECT },
  required: ["action"],
  example: { action: "attempt", actor: "bram", params: { stat: "strength", difficulty: "hard" } },
  read(r, args, reply) {
    const actions = actionsOf(r);
    const action = actions.get(String(args.action).trim());
    if (!action) return { line: "unreadable", fields: { field: "action", value: JSON.stringify(args.action), choices: textOf([...actions.keys()].sort()) } };
    let actor = r.doc.pov;
    if (args.actor !== undefined && args.actor !== null && args.actor !== "") {
      const who = foundIn(r, "actor", args.actor, "person");
      if (isUnread(who)) return who;
      actor = who.id;
    }
    if (actor === "") return { line: "needs_field", fields: { field: "actor" } };
    const given = args.params ?? {};
    if (!isRecord(given)) return { line: "unreadable", fields: { field: "params", value: JSON.stringify(given), wants: r.lines.line("wants_fields") ?? "" } };
    const params: JsonObject = {};
    for (const [name, value] of Object.entries(given)) {
      const v = paramValue(r, name, own(action.params, name), value as JsonValue);
      if (isUnread(v)) return v;
      params[name] = v;
    }
    const a = actionOdds(r.registry, r.world, r.state.world, { action, actor, params });
    const c = a.check;
    const v = a.verdict;
    // What the policy makes of it when nothing rolls, its advantage and its DC: each a named line of the answers' file, never code's words.
    const rolls = !v || v.roll;
    const retry = policyFor(r.world, r.state.world, action, actor).retry;
    const says: Record<string, string> = {};
    if (v && !v.roll) {
      const name = v.why === "retry" ? (retry === "once" ? "odds_retry_once" : "odds_retry") : v.why === "impossible" ? "odds_impossible" : v.why === "story" ? "odds_story" : "odds_no_roll";
      const said = r.lines.line(name, { chance: v.chance === null ? "" : Math.round(v.chance * 100) });
      if (said !== undefined && said.trim() !== "") says.verdict = said;
    }
    if (c && rolls && c.advantage !== 0) {
      const said = r.lines.line(c.advantage > 0 ? "odds_advantage" : "odds_disadvantage");
      if (said !== undefined && said.trim() !== "") says.advantage = said;
    }
    if (c && rolls && c.dc !== null && c.opponent === null) {
      const said = r.lines.line("odds_dc", { dc: c.dc });
      if (said !== undefined && said.trim() !== "") says.dc = said;
    }
    reply.data({
      odds: {
        action: `${action.label} [${action.id}]`,
        actor: named(r, actor),
        available: a.available,
        ...(a.failed ? { why: a.failed.code, ...("hard" in a.failed && a.failed.hard === true ? { hard: true } : {}) } : {}),
        minutes: a.duration,
        ...(a.odds ? { chances: Object.fromEntries(Object.entries(a.odds).map(([outcome, p]) => [outcome, percent(p)])) } : {}),
        ...(c ? { dice: c.notation, modifier: a.modifier, ...(c.dc !== null ? { dc: c.dc } : {}), ...(c.advantage !== 0 ? { advantage: c.advantage } : {}), ...(c.opponent ? { opponent: named(r, c.opponent) } : {}) } : {}),
        ...(v ? { verdict: { roll: v.roll, why: v.why, outcome: v.outcome, chance: v.chance === null ? null : percent(v.chance), pass: v.pass } } : {}),
        ...(a.lines ? { lines: a.lines.map((l) => ({ ...(l.n !== undefined ? { attack: l.n } : {}), ...(l.who !== undefined ? { who: named(r, l.who) } : {}), modifier: l.modifier, against: l.against, chances: Object.fromEntries(Object.entries(l.chances).map(([outcome, p]) => [outcome, percent(p)])), ...(l.threat !== undefined ? { threat: percent(l.threat) } : {}) })) } : {}),
        ...(a.missing !== undefined ? { missing: a.missing } : {}),
        ...(Object.keys(says).length > 0 ? { says } : {}),
      },
    });
    return undefined;
  },
};

/** The checks family. */
export const CHECK_TOOLS: readonly ToolSpec[] = [readTool(odds)];
