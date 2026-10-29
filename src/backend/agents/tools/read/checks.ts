// The checks family (AGENT-LOOP-PLAN §6; INC1-SPEC R3a): an action's odds against the chat's head,
// as the palette reads them (`actionOdds`: the ready check the roll reads too, so the odds are the
// real odds). An action's arguments are read as the action takes them, each person, thing or place
// resolved among those the view may name, so one it can't see reads as one that doesn't exist.
//
// - Under `pov` only what Play lets the player character try and see: an action Play lists (one
//   the world offers that isn't a step the story hasn't come to, `storyLocked`), tried by the player
//   character itself, since another's odds it can't know; why not as Play words it (`playerReason`),
//   the odds and detail as the palette shows them (`checkView`), and the dice, modifier and DC only
//   of a check no one opposes: an opponent's side of a roll is theirs.
// - Under `everyone` and `gm` any action by anyone: why not as the engine has it (a requirement as
//   its formula), the exact chance of each outcome, the dice, the modifier, the DC, advantage, whom
//   it is rolled against, and what the adjudication policy makes of it (`verdictOf`).

import { checkView, policyOf } from "../../../../engine/adjudication";
import { own } from "../../../../engine/pack-kit";
import { actionOdds } from "../../../../engine/resolve";
import { scopeEnv } from "../../../../engine/scope";
import { storyLocked } from "../../../../engine/visibility";
import { TOOL_NOTE } from "../../../../shared/agent-tools";
import type { EntityId } from "../../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../../shared/json";
import { parseMoneyInput } from "../../../../shared/money";
import { type ActionDef, offersAction, type ParamDef } from "../../../../shared/world";
import { playerReason } from "../../../requirement-words";
import type { ToolOutcome } from "../../runtime";
import type { ToolDefinition } from "../registry";
import type { ToolReadView, ViewRef } from "../read-view";
import { type Resolved, resolveEntity, resolvePerson, resolvePlace } from "../resolve";
import { missing } from "../propose";
import { actionEnum, badValue, jsonObject, needText, objectArg, objectSchema, text, textArg } from "../schema";

const ODDS = "checks_odds";

/** An action's odds as `checks_odds` gives them. */
interface OddsAnswer {
  action: { id: string; label: string };
  actor: ViewRef | null;
  /** Whether it can be tried now. */
  available: boolean;
  /** Why it can't: under `pov` as Play words it, else the engine's reason (a requirement as its formula; `hard` when it is its author's hard lock). */
  why?: string;
  hard?: true;
  /** The minutes it takes. */
  minutes: number;
  /** The chance of each outcome, in percent; under `pov` only where the palette shows them (a check the dice roll or the story decides). */
  odds?: Record<string, number>;
  /** How the palette words the check: no roll needed, too hard to try, advantage or disadvantage, the DC. */
  detail?: string;
  /** The check's dice, modifier and DC (under `pov` only of one no one opposes), advantage or disadvantage, and whom it is rolled against. */
  dice?: string;
  modifier?: number;
  dc?: number;
  advantage?: "advantage" | "disadvantage";
  opponent?: ViewRef;
  /** Under `everyone` and `gm`: what the adjudication policy makes of the check (`roll` false: it isn't rolled, for `why`), its chance of success in percent and the outcomes that count as one. */
  verdict?: { roll: boolean; why: string | null; outcome: string | null; chance: number | null; pass: string[] };
}

/** A probability as a percentage, to a tenth. */
function percent(p: number): number {
  return Math.round(p * 1000) / 10;
}

/**
 * The actions a call may name: every action of the packs and of the world (the world's own over a
 * pack's of the same id); under `pov` only those Play lists for the player character (the palette,
 * its Combat tab, interpret's catalog): each the world offers that isn't a step the story hasn't
 * come to.
 */
function namable(view: ToolReadView): ActionDef[] {
  const all = new Map<string, ActionDef>(view.registry.actions);
  for (const [id, a] of Object.entries(view.world.actions)) all.set(id, a);
  if (view.knowledge !== "pov") return [...all.values()];
  const env = scopeEnv({ reg: view.registry, ctx: view.ctx, bindings: { self: view.pov, actor: view.pov } });
  return [...all.values()].filter((a) => offersAction(view.world, a) && !storyLocked(env, a));
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

function oddsAnswer(view: ToolReadView, action: ActionDef, actor: EntityId, params: JsonObject): OddsAnswer {
  const a = actionOdds(view.registry, view.world, view.state, { action, actor, params });
  const shown = checkView(a, policyOf(view.world, view.state).retry);
  const pov = view.knowledge === "pov";
  const c = a.check;
  // An opponent's side of the roll (their dice, their modifier, their score as the DC) is theirs: the player character reads a check's numbers only when no one opposes it.
  const numbers = c && (!pov || c.opponent === null) ? c : null;
  // Under `pov` the odds as the palette shows them (`checkView`): only for a check the dice roll or the story decides.
  const exact: [string, number][] = pov ? (shown.odds ?? []).map((o) => [o.outcome, o.p]) : Object.entries(a.odds ?? {});
  const v = pov ? null : a.verdict;
  return {
    action: { id: action.id, label: action.label },
    actor: view.entity(actor),
    available: a.available,
    why: a.failed ? (pov ? playerReason(a.failed) : a.failed.reason) : undefined,
    hard: !pov && a.failed?.hard === true ? true : undefined,
    minutes: a.duration,
    odds: exact.length > 0 ? Object.fromEntries(exact.map(([outcome, p]) => [outcome, percent(p)])) : undefined,
    detail: shown.detail,
    dice: numbers?.notation,
    modifier: numbers ? a.modifier : undefined,
    dc: numbers?.dc ?? undefined,
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
    // Under `pov` the world as the agent may name it holds no actions (`schemaWorld`): the action is a free id, checked against those Play lists.
    parameters: (world) => objectSchema({ action: text(actionEnum(world)), actor: text(), params: jsonObject() }, ["action"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = needText(view, ODDS, args, "action");
      if (typeof said !== "string") return said;
      const named = textArg(args, "actor");
      const r: Resolved = named === null ? { id: view.pov } : resolvePerson(view, named);
      if ("refused" in r) return r.refused;
      // Another's odds are theirs: the player character can't know them.
      if (view.knowledge === "pov" && r.id !== view.pov) return view.refuse(TOOL_NOTE.hidden, { pov: view.name(view.pov) });
      const actions = view.read(() => namable(view));
      const action = actions.find((a) => a.id === said);
      if (!action) return badValue(view, ODDS, "action", said, actions.map((a) => a.id).sort());
      const params: JsonObject = {};
      const given = objectArg(args, "params");
      if (args.params !== undefined && given === null) return missing(view, ODDS, "params");
      for (const [name, value] of Object.entries(given ?? {})) {
        const v = paramValue(view, own(action.params, name), value);
        if ("refused" in v) return v.refused;
        params[name] = v.value;
      }
      return view.answer(view.read(() => oddsAnswer(view, action, r.id, params)));
    },
  },
];
