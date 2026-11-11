// The checks family (AGENT-LOOP-PLAN §6; INC1-SPEC R3a): an action's odds against the chat's head,
// as the palette reads them (`actionOdds`: the ready check the roll reads too, so the odds are the
// real odds). An action's arguments are read as the action takes them, each person, thing or place
// resolved among those the view may name, so one it can't see reads as one that doesn't exist.
//
// Any action by anyone: why not as the engine has it (a requirement as its formula), the exact chance
// of each outcome, the dice, the modifier, the DC, advantage, whom it is rolled against, and what the
// adjudication policy makes of it (`verdictOf`).

import { checkView, policyOf } from "../../../../engine/adjudication";
import { own } from "../../../../engine/pack-kit";
import { actionOdds } from "../../../../engine/resolve";
import type { EntityId } from "../../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../../shared/json";
import { parseMoneyInput } from "../../../../shared/money";
import type { ActionDef, ParamDef } from "../../../../shared/world";
import type { ToolOutcome } from "../../runtime";
import type { ToolDefinition } from "../registry";
import type { ToolReadView, ViewRef } from "../read-view";
import { type Resolved, resolveEntity, resolvePerson, resolvePlace } from "../resolve";
import { missing } from "../propose";
import { actionEnum, argGiven, badValue, jsonObject, needText, objectArg, objectSchema, text, textArg } from "../schema";

const ODDS = "checks_odds";

/** An action's odds as `checks_odds` gives them. */
export interface OddsAnswer {
  action: { id: string; label: string };
  actor: ViewRef | null;
  /** Whether it can be tried now. */
  available: boolean;
  /** Why it can't: the engine's reason (a requirement as its formula; `hard` when it is its author's hard lock). */
  why?: string;
  hard?: true;
  /** The minutes it takes. */
  minutes: number;
  /** The chance of each outcome, in percent. */
  odds?: Record<string, number>;
  /** How the palette words the check: no roll needed, too hard to try, advantage or disadvantage, the DC. */
  detail?: string;
  /** The check's dice, modifier and DC, advantage or disadvantage, and whom it is rolled against. */
  dice?: string;
  modifier?: number;
  dc?: number;
  advantage?: "advantage" | "disadvantage";
  opponent?: ViewRef;
  /** Under `everyone` and `gm`: what the adjudication policy makes of the check (`roll` false: it isn't rolled, for `why`), its chance of success in percent and the outcomes that count as one. */
  verdict?: { roll: boolean; why: string | null; outcome: string | null; chance: number | null; pass: string[] };
}

/** A probability as a percentage, to a tenth. */
export function percent(p: number): number {
  return Math.round(p * 1000) / 10;
}

/** The actions a call may name: every action of the packs and of the world (the world's own over a pack's of the same id). */
function namable(view: ToolReadView): ActionDef[] {
  const all = new Map<string, ActionDef>(view.registry.actions);
  for (const [id, a] of Object.entries(view.world.actions)) all.set(id, a);
  return [...all.values()];
}

/**
 * An argument as the action takes it (`prepare`, engine/resolve.ts), from what the call wrote: a ref
 * resolved among what the view may name (a place for a place's, else any entity), a list of refs
 * each so, a number, an amount in the world's currency or a yes or no read from its text; any other,
 * and one the action doesn't take, as given.
 */
function paramValue(view: ToolReadView, def: ParamDef | undefined, given: JsonValue): { value: JsonValue } | { refused: ToolOutcome } {
  const said = typeof given === "string" ? given.trim() : "";
  if (!def || said === "") return { value: given };
  switch (def.type) {
    case "ref": {
      const r = def.ref === "place" ? resolvePlace(view, said) : resolveEntity(view, said);
      return "refused" in r ? r : { value: r.id };
    }
    case "list": {
      if (def.ref === undefined) return { value: given };
      const ids: string[] = [];
      for (const part of said.split(",").map((p) => p.trim())) {
        if (part === "") continue;
        const r = resolveEntity(view, part);
        if ("refused" in r) return r;
        ids.push(r.id);
      }
      return { value: ids.join(",") };
    }
    case "number":
    case "duration":
      return { value: Number.isFinite(Number(said)) ? Number(said) : given };
    case "money":
      return { value: parseMoneyInput(said, view.world.currency) ?? given };
    case "bool":
      return { value: said === "true" ? true : said === "false" ? false : given };
    default:
      return { value: given };
  }
}

/**
 * The check a call names, as the action takes it: the action among every one there is, who takes it
 * (the player character when the call names no one) and its arguments (`paramValue`); or the answer
 * that says what the call got wrong. What a harness turn reads of an attempt before it is played
 * (`checks_stakes`) and the attempt it plays read their call through this too, so the check that is
 * rolled is the one these odds are of.
 */
export function checkCall(view: ToolReadView, tool: string, args: JsonObject): { action: ActionDef; actor: EntityId; params: JsonObject } | ToolOutcome {
  const said = needText(view, tool, args, "action");
  if (typeof said !== "string") return said;
  const named = textArg(args, "actor");
  const r: Resolved = named === null ? { id: view.pov } : resolvePerson(view, named);
  if ("refused" in r) return r.refused;
  const actions = view.read(() => namable(view));
  const action = actions.find((a) => a.id === said);
  if (!action) return badValue(view, tool, "action", said, actions.map((a) => a.id).sort());
  const params: JsonObject = {};
  const given = objectArg(args, "params");
  if (argGiven(args, "params") && given === null) return missing(view, tool, "params");
  for (const [name, value] of Object.entries(given ?? {})) {
    const v = paramValue(view, own(action.params, name), value);
    if ("refused" in v) return v.refused;
    params[name] = v.value;
  }
  return { action, actor: r.id, params };
}

/** An action's odds as `checks_odds` answers them. */
export function oddsAnswer(view: ToolReadView, action: ActionDef, actor: EntityId, params: JsonObject): OddsAnswer {
  const a = actionOdds(view.registry, view.world, view.state, { action, actor, params });
  const shown = checkView(a, policyOf(view.world, view.state).retry);
  const c = a.check;
  const exact: [string, number][] = Object.entries(a.odds ?? {});
  const v = a.verdict;
  return {
    action: { id: action.id, label: action.label },
    actor: view.entity(actor),
    available: a.available,
    why: a.failed ? a.failed.reason : undefined,
    hard: a.failed?.hard === true ? true : undefined,
    minutes: a.duration,
    odds: exact.length > 0 ? Object.fromEntries(exact.map(([outcome, p]) => [outcome, percent(p)])) : undefined,
    detail: shown.detail,
    dice: c?.notation,
    modifier: c ? a.modifier : undefined,
    dc: c?.dc ?? undefined,
    advantage: c && c.advantage !== 0 ? (c.advantage > 0 ? "advantage" : "disadvantage") : undefined,
    opponent: c?.opponent ? (view.entity(c.opponent) ?? undefined) : undefined,
    verdict: v ? { roll: v.roll, why: v.why, outcome: v.outcome, chance: v.chance === null ? null : percent(v.chance), pass: v.pass } : undefined,
  };
}

/** The checks family, in the order of its texts (`shared/agent-tools-read.ts`). */
export const CHECKS_TOOLS: readonly ToolDefinition[] = [
  {
    name: ODDS,
    family: "checks",
    tier: "read",
    // The action is a free id when the world as the agent may name it holds none (`schemaWorld`), checked against every action there is.
    parameters: (world) => objectSchema({ action: text(actionEnum(world)), actor: text(), params: jsonObject() }, ["action"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      const call = checkCall(view, ODDS, args);
      if (!("action" in call)) return call;
      return view.answer(view.read(() => oddsAnswer(view, call.action, call.actor, call.params)));
    },
  },
];
