// The palette the player picks from: each action's options, priced and judged now, and the
// timelapse's. Pure, over a world, its state and the registry; built an action a step
// (`paletteSteps`), so the state view lets RPE's thread go between them.

import { checkView, policyOf } from "../../engine/adjudication";
import { identifiers } from "../../engine/expr";
import { actsFor } from "../../engine/org";
import { offeredActions } from "../../engine/offered";
import { optionalQuery } from "../../engine/pack-kit";
import type { Registry } from "../../engine/registry-impl";
import { actionOdds, companionCandidates, paramCandidates } from "../../engine/resolve";
import { kindIs, scopeEnv } from "../../engine/scope";
import type { WorldState } from "../../engine/state";
import { clockPaused } from "../../engine/time";
import { storyLocked } from "../../engine/visibility";
import { combatEntries, paletteEncounter } from "../../packs/combat/core/index";
import type { EntityId } from "../../shared/ids";
import type { JsonObject } from "../../shared/json";
import { routineSettingsOf } from "../../shared/routines";
import type { PaletteEntry, PaletteOption, PaletteView, TimelapseView } from "../../shared/state-view";
import { paramChoices, paramLabel } from "../../engine/param-words";
import { playsOffstage } from "../../shared/offstage";
import { type ActionDef, requirementExpr, type WorldDoc } from "../../shared/world";

/** The palette's timelapse action; its params are `{target, overrides}`. */
export const TIMELAPSE_ACTION = "timelapse";
const GROUPS: Record<string, PaletteEntry["group"]> = { buy: "buy", purchase: "buy", pay: "pay", transfer: "transfer", drive: "drive", lend: "lend" };

function groupOf(action: ActionDef): PaletteEntry["group"] {
  const last = action.id.split(".").at(-1) ?? action.id;
  for (const [key, group] of Object.entries(GROUPS)) if (last.startsWith(key)) return group;
  return "action";
}

/** Why a palette option is off, for the player: an unmet requirement isn't spelled as its expression, only in its own words when it has some (`why`). */
function unavailable(failed: { code: string; reason: string; words?: string } | null | undefined): string {
  if (!failed) return "Not available";
  return failed.code === "requirement" ? (failed.words ?? "Not possible here and now") : failed.reason;
}

/** The palette, built whole. */
export function palette(world: WorldDoc, state: WorldState, registry: Registry): PaletteView {
  const built = paletteSteps(world, state, registry);
  for (const step of built.steps) step();
  return built.done();
}

/** The palette as steps, one an action, each of which the caller takes in turn (in one read pass), then `done` for what it comes to. */
export function paletteSteps(world: WorldDoc, state: WorldState, registry: Registry): { steps: (() => void)[]; done(): PaletteView } {
  const entries: PaletteEntry[] = [];
  const ctx = registry.context(world, state);
  const actions = offeredActions(registry, ctx);
  const env = scopeEnv({ reg: registry, ctx, bindings: { self: world.pov, actor: world.pov } });
  const retry = policyOf(world, state).retry;
  // Paying as (ORG-SPEC §3.6): the organizations the POV may spend for, worked out once, for Pay and Buy.
  let spendsFor: { id: EntityId; name: string }[] | undefined;
  const payingFor = (): { id: EntityId; name: string }[] => (spendsFor ??= actsFor(ctx, world.pov, "money.spend").map((id) => ({ id, name: state.entities[id]?.name ?? id })));
  const add = (action: ActionDef): void => {
    // Combat actions are the combat pack's Combat tab (below), and only where the world's ruleset has combat.
    if (action.id === TIMELAPSE_ACTION || action.combat) return;
    // A step the story hasn't come to isn't an option yet (DESIGN §11): listed, even locked, it would tell what lies ahead.
    if (storyLocked(env, action)) return;
    const refParam = Object.entries(action.params).find(([, p]) => p.type === "ref" && !p.optional)?.[0];
    const amountParam = Object.entries(action.params).find(([, p]) => p.type === "money")?.[0];
    const options: PaletteEntry["options"] = [];
    // Buy (DESIGN §12 "Buy (catalog)"): one option per offer where the POV is, priced.
    const offers = groupOf(action) === "buy" && action.params.item?.type === "text" ? (optionalQuery(ctx, "economy.offers")?.(ctx, world.pov) ?? []) : [];
    for (const offer of offers) {
      const params: JsonObject = { item: offer.item };
      const odds = actionOdds(registry, world, state, { action, params });
      options.push({
        label: offer.name,
        params,
        cents: offer.cents,
        detail: offer.category,
        ...(odds.duration > 0 ? { minutes: odds.duration } : {}),
        ...(odds.available ? {} : { disabled: unavailable(odds.failed) }),
      });
    }
    // Attempt (sheets): one option per stat, with its odds.
    const stats = action.id === "attempt" && action.params.stat?.type === "text" ? (optionalQuery(ctx, "sheets.stats")?.(ctx) ?? []) : [];
    for (const stat of stats) {
      const params: JsonObject = { stat: stat.id };
      const odds = actionOdds(registry, world, state, { action, params });
      options.push({
        label: stat.label,
        params,
        ...checkView(odds, retry),
        ...(odds.duration > 0 ? { minutes: odds.duration } : {}),
        ...(odds.available ? {} : { disabled: unavailable(odds.failed) }),
      });
    }
    // A text param that takes one of a list (a table's rows: Use a skill, Make a save; or a game system's: Apply for credit's products):
    // one option per choice, by the name a person is shown for it (`paramChoices`, which a press that leaves it out is told too), with its odds.
    const rowParam = refParam === undefined ? Object.entries(action.params).find(([, p]) => p.type === "text" && !p.optional && (p.table !== undefined || p.choices !== undefined)) : undefined;
    const rows = rowParam ? paramChoices(ctx, rowParam[1], world.pov).slice(0, 24) : [];
    for (const row of rows) {
      const params: JsonObject = { [rowParam?.[0] ?? ""]: row.value };
      const odds = actionOdds(registry, world, state, { action, params });
      options.push({
        label: row.label,
        params,
        ...checkView(odds, retry),
        ...(odds.duration > 0 ? { minutes: odds.duration } : {}),
        ...(odds.available ? {} : { disabled: unavailable(odds.failed) }),
      });
    }
    // At most 24 first picks are shown, so no more are looked for (on a long-played chat a place holds hundreds of things).
    const targets = offers.length > 0 || stats.length > 0 || rows.length > 0 ? [] : refParam ? paramCandidates(registry, world, state, action, refParam, world.pov, 24) : [null];
    // A second required ref (Drive's destination, Lend's borrower) is a nested pick.
    const secondParam = refParam ? Object.entries(action.params).find(([name, p]) => name !== refParam && p.type === "ref" && !p.optional)?.[0] : undefined;
    // Its candidates are the same for every first pick, so they are found once: 12 shown, and one more for the first pick itself.
    let secondCandidates: string[] | undefined;
    // Take from a kit (gear): the pieces still in a kit are its second pick, with how many are left.
    const kitStatus = action.id === "take_piece" && action.params.piece?.type === "text" ? optionalQuery(ctx, "gear.kit_status") : undefined;
    const nameOf = (id: string): string => state.entities[id]?.name ?? world.places[id]?.name ?? id;
    // A number the action needs (Lend's days: optional only because a said end can stand in for it,
    // so a requirement reads it) gets an input pre-filled with 1, and a free amount (Pay, Invest) one
    // currency unit: options are judged with them, so a target isn't "needs amount".
    const numberParam = Object.entries(action.params).find(([name, p]) => p.type === "number" && (!p.optional || action.requires.some((req) => identifiers(requirementExpr(req)).includes(name))))?.[0];
    const nominal: JsonObject = { ...(numberParam ? { [numberParam]: 1 } : {}), ...(amountParam && offers.length === 0 ? { [amountParam]: 10 ** world.currency.decimals } : {}) };
    const pick = (params: JsonObject, label: string): PaletteOption => {
      const odds = actionOdds(registry, world, state, { action, params: { ...nominal, ...params } });
      return {
        label,
        params,
        ...checkView(odds, retry),
        ...(odds.duration > 0 ? { minutes: odds.duration } : {}),
        ...(odds.available ? {} : { disabled: unavailable(odds.failed) }),
      };
    };
    for (const target of targets.slice(0, 24)) {
      const params: JsonObject = refParam && target ? { [refParam]: target } : {};
      if (secondParam && target) {
        const seconds = (secondCandidates ??= paramCandidates(registry, world, state, action, secondParam, world.pov, 13)).filter((id) => id !== target).slice(0, 12);
        const next = seconds.map((id) => {
          const final = pick({ ...params, [secondParam]: id }, nameOf(id));
          return { ...final, params: { [secondParam]: id } };
        });
        if (next.length > 0) options.push({ label: nameOf(target), params, next: { param: secondParam, label: paramLabel(action, secondParam, world, registry), options: next } });
        continue;
      }
      if (kitStatus && target) {
        const pieces = (kitStatus(ctx, target)?.pieces ?? []).filter((p) => p.present > 0).slice(0, 12);
        const next = pieces.map((p) => {
          const final = pick({ ...params, piece: p.name }, `${p.name} (${p.present} left)`);
          return { ...final, params: { piece: p.name } };
        });
        if (next.length > 0) options.push({ label: nameOf(target), params, next: { param: "piece", label: paramLabel(action, "piece", world, registry), options: next } });
        continue;
      }
      // A person is marked as one, for a picker that takes only people (the Money panel's tenant, buyer and hire).
      const person = target !== null && kindIs(registry, world, state.entities[target]?.kind ?? "", "person");
      options.push({ ...pick(params, target ? nameOf(target) : action.label), ...(person ? { person: true as const } : {}) });
    }
    if (options.length === 0) return;
    // Who comes along (Go's With): the scene's people the POV can see, ticked in the sheet.
    const peopleParam = Object.entries(action.params).find(([, p]) => p.type === "list" && p.ref !== undefined)?.[0];
    const company = peopleParam ? companionCandidates(registry, world, state, action, peopleParam).map((id) => ({ id, name: nameOf(id) })) : [];
    // Paying as (Pay's and Buy's `as`): You, or an organization the POV may spend for, when there is one.
    const actingParam = Object.entries(action.params).find(([, p]) => p.type === "ref" && p.acting === "money.spend")?.[0];
    const acting = actingParam ? payingFor() : [];
    // Offers carry their price; a free amount would double it.
    entries.push({
      action: action.id,
      label: action.label,
      group: groupOf(action),
      options,
      ...(amountParam && offers.length === 0 ? { amount: { param: amountParam, min: 0, max: null } } : {}),
      ...(numberParam ? { number: { param: numberParam, label: paramLabel(action, numberParam, world, registry), min: 1, max: null, default: 1 } } : {}),
      ...(peopleParam && company.length > 0 ? { people: { param: peopleParam, label: paramLabel(action, peopleParam, world, registry), options: company } } : {}),
      ...(actingParam && acting.length > 0 ? { acting: { param: actingParam, label: "Paying as", options: acting } } : {}),
      // A press with no words of one that manages is done at once, as the taps route does it (`playsOffstage`); any other waits for his next message.
      ...(playsOffstage(action.id, {}, action.mechanical === true) ? { atOnce: true as const } : {}),
    });
  };
  const done = (): PaletteView => {
    entries.push(...combatEntries(ctx));
    entries.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
    const calendar = ctx.levelOf(world.pov, "calendar");
    const timelapse: TimelapseView = {
      action: TIMELAPSE_ACTION,
      // A fight's rounds take no clock time, so neither does skipping ahead in one (DESIGN §11).
      blocked: calendar < 1 ? "Calendar is off" : clockPaused(world, state) ? "Resume the clock first" : optionalQuery(ctx, "combat.engaged")?.(ctx, world.pov) === true ? "Not during a fight" : null,
      durations: [30, 60, 180, 480, 1440, 10080],
      until: [
        ...world.calendar.dayParts.map((d) => ({ label: d.label, target: { type: "day_part" as const, dayPart: d.id } })),
        { label: "Next shift", target: { type: "shift" as const } },
        { label: "Next commitment", target: { type: "commitment" as const } },
        { label: "Next interruption", target: { type: "interrupt" as const } },
      ],
      interrupts: { ...state.time.interrupts },
      dayParts: calendar === 1,
      followRoutine: routineSettingsOf(world).paletteFollowsRoutine,
    };
    const encounter = paletteEncounter(ctx);
    return { entries, timelapse, ...(encounter ? { encounter } : {}) };
  };
  return { steps: [...actions.values()].map((action) => () => add(action)), done };
}
