// The Encounter card's view model (`combat.encounter`, DESIGN §11) and the palette's Combat tab: the
// initiative order with whose turn it is, HP as the POV may see it (its own exactly; anyone else's as
// the rules and visibility allow), conditions, the POV's economy, and its combat actions with their
// targets and exact odds (the engine's `actionOdds`). Someone the POV can't see is never named. The
// GM's version shows everyone, exactly.

import type { JsonObject } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { PaletteEncounter, PaletteEntry, PaletteOption } from "../../../shared/state-view";
import type { ActionDef, WorldDoc } from "../../../shared/world";
import { checkView, policyFor } from "../../../engine/adjudication";
import { labelOf, optionalQuery, own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { actionOdds, paramCandidates } from "../../../engine/resolve";
import { isGone, scopeEnv } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { canSeeEntity, storyLocked } from "../../../engine/visibility";
import { combatActions, hpSeen, targetParam } from "./flow";
import { budgetCount, DOWN_CONDITION, encounterOf, fighterOf, povLeft, rulesOf, standing, type Encounter, type Side } from "./model";

export interface EncounterRow {
  /** Null for someone the POV can't see. */
  id: EntityId | null;
  name: string;
  side: Side;
  you: boolean;
  current: boolean;
  down: boolean;
  /** Gone, or no longer where the fight is. */
  out: boolean;
  /** The initiative it rolled; null for someone the POV can't see. */
  init: number | null;
  hp: { current: number; max: number | null } | null;
  /** The wound band, where HP isn't shown exactly. */
  wound: string | null;
  conditions: string[];
}

export interface EncounterView {
  gm: boolean;
  round: number;
  /** Whose turn it is, as the POV names them ("you", a name, or "someone"). */
  turn: string;
  yours: boolean;
  order: EncounterRow[];
  /** What the POV has left of each budget. */
  economy: PaletteEncounter["economy"];
  /** The POV's combat actions now, with targets and exact odds; empty in the GM's view. */
  actions: PaletteEntry[];
  /** This round's and the last round's acts, oldest first. */
  log: string[];
}

function nameOf(ctx: ReadContext, id: EntityId, gm: boolean): string | null {
  if (id === ctx.world.pov) return "you";
  return gm || canSeeEntity(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id) ? labelOf(ctx, id) : null;
}

function optionOf(ctx: ReadContext, action: ActionDef, params: JsonObject, label: string): PaletteOption {
  const odds = actionOdds(ctx.registry, ctx.world, ctx.state, { action, params });
  return {
    label,
    params,
    // As every other check reads: an attack the policy settles without a roll shows no dice odds.
    ...checkView(odds, policyFor(ctx.world, ctx.state, action, ctx.world.pov).retry),
    ...(odds.duration > 0 ? { minutes: odds.duration } : {}),
    ...(odds.available ? {} : { disabled: odds.failed?.code === "requirement" ? "Not possible here and now" : (odds.failed?.reason ?? "Not available") }),
  };
}

/**
 * Whether an action suits the fight's state for the POV (DESIGN §11): a combat action that starts a
 * fight only when none is under way for the POV (one it has left is over for it, though its end is
 * written on the next turn), any other only in a fight the POV is in; any other action always. The
 * Combat tab, interpret's catalog and typed text all read it.
 */
export function fightOffers(world: Pick<WorldDoc, "pov">, state: Readonly<WorldState>, action: Pick<ActionDef, "combat">): boolean {
  if (!action.combat) return true;
  const enc = encounterOf(state);
  const fighting = enc !== null && !povLeft(state, world, enc);
  return action.combat.start === true ? !fighting : fighting;
}

/**
 * The POV's combat actions (DESIGN §11), grouped "combat" for the palette: in a fight, each one but
 * a starting one, against each standing participant the POV can see (or none); outside a fight,
 * the ones that start one, against whoever the action's own filters offer. An action the fight's
 * state rules out (`fightOffers`: a start in a fight, an attack outside one) isn't listed, nor one
 * that is a step the story hasn't come to (`storyLocked`), as anywhere actions are listed.
 */
export function combatEntries(ctx: ReadContext): PaletteEntry[] {
  const found = encounterOf(ctx.state);
  // A fight the POV has left is over for it: the tab offers what it offers outside one.
  const enc = found && !povLeft(ctx.state, ctx.world, found) ? found : null;
  const env = scopeEnv({ reg: ctx.registry, ctx, bindings: { self: ctx.world.pov, actor: ctx.world.pov } });
  const entries: PaletteEntry[] = [];
  for (const action of combatActions(ctx.registry, ctx.world)) {
    const param = targetParam(action);
    if (!fightOffers(ctx.world, ctx.state, action) || param === undefined || storyLocked(env, action)) continue;
    const targets = param === null ? [null] : enc ? enc.order.filter((f) => f.id !== ctx.world.pov && standing(ctx, enc, f) && canSeeEntity(ctx.registry, ctx.world, ctx.state, ctx.world.pov, f.id)).map((f) => f.id) : paramCandidates(ctx.registry, ctx.world, ctx.state, action, param).slice(0, 24);
    const options = targets.map((t) => optionOf(ctx, action, param !== null && t !== null ? { [param]: t } : {}, t !== null ? labelOf(ctx, t) : action.label));
    if (options.length > 0) entries.push({ action: action.id, label: action.label, group: "combat", options });
  }
  return entries;
}

/** The fight as the palette heads its Combat tab: round, whose turn, and the POV's economy; null without one, or once the POV has left it. */
export function paletteEncounter(ctx: ReadContext): PaletteEncounter | null {
  const rules = rulesOf(ctx.world);
  const enc = encounterOf(ctx.state);
  if (!rules || !enc || povLeft(ctx.state, ctx.world, enc)) return null;
  const current = enc.order[enc.turn]?.id;
  const me = fighterOf(enc, ctx.world.pov);
  return {
    round: enc.round,
    turn: current ? (nameOf(ctx, current, false) ?? "someone") : "no one",
    yours: current === ctx.world.pov,
    // A budget that isn't one (a hand-edited file; lint says so) has nothing to show.
    economy: Object.entries(rules.economy).flatMap(([id, def]) => (isRecord(def) ? [{ id, label: typeof def.label === "string" && def.label !== "" ? def.label : id, left: me?.left[id] ?? 0, of: budgetCount(ctx, def, ctx.world.pov) }] : [])),
  };
}

function logLines(ctx: ReadContext, enc: Encounter, gm: boolean): string[] {
  return enc.log.map((e) => {
    const who = nameOf(ctx, e.actor, gm) ?? "someone";
    const target = e.target ? ` → ${nameOf(ctx, e.target, gm) ?? "someone"}` : "";
    return `${who.charAt(0).toUpperCase()}${who.slice(1)}: ${e.action}${target}${e.outcome ? ` (${e.outcome.replace(/_/g, " ")})` : ""}`;
  });
}

/**
 * The Encounter card (DESIGN §11), as the POV sees it or, with `gm`, everything; null without a
 * fight, and for the player once the POV has left it. Down reads the fight itself, at any Sheets
 * level; the down condition the Sheets pack shows from Sheets 4 isn't listed beside it again.
 */
export function buildEncounterView(ctx: ReadContext, opts: { gm?: boolean } = {}): EncounterView | null {
  const rules = rulesOf(ctx.world);
  const enc = encounterOf(ctx.state);
  const gm = opts.gm === true;
  if (!rules || !enc || (!gm && povLeft(ctx.state, ctx.world, enc))) return null;
  const head = paletteEncounter(ctx);
  const conditionsOf = optionalQuery(ctx, "sheets.conditions");
  const downCondition = typeof rules.down?.condition === "string" && rules.down.condition.trim() !== "" ? rules.down.condition : DOWN_CONDITION;
  const order = enc.order.map((f, i): EncounterRow => {
    const name = nameOf(ctx, f.id, gm);
    const seen = name === null ? null : hpSeen(ctx, rules, f.id, gm);
    return {
      id: name === null ? null : f.id,
      name: name === null ? "someone" : f.id === ctx.world.pov ? "You" : name,
      side: f.side,
      you: f.id === ctx.world.pov,
      current: i === enc.turn,
      down: f.down,
      out: !f.down && !standing(ctx, enc, f),
      init: name === null ? null : f.init,
      hp: seen && "current" in seen ? seen : null,
      wound: seen && "wound" in seen && seen.wound !== "" ? seen.wound : null,
      conditions: name === null || isGone(ctx.state, f.id) || !own(ctx.state.entities, f.id) ? [] : (conditionsOf?.(ctx, f.id) ?? []).filter((c) => !(f.down && c === downCondition)),
    };
  });
  const current = enc.order[enc.turn]?.id;
  return {
    gm,
    round: enc.round,
    turn: current ? (nameOf(ctx, current, gm) ?? "someone") : "no one",
    yours: current === ctx.world.pov,
    order,
    economy: head?.economy ?? [],
    actions: gm ? [] : combatEntries(ctx),
    log: logLines(ctx, enc, gm),
  };
}
