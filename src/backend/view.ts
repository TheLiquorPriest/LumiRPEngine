// The state view (ARCHITECTURE §4; DESIGN §12): everything the frontend renders for one chat,
// computed from the fold. Pack panels come from the registry's views (POV-filtered by the packs),
// drawn as the player chose to see the chat (the map's display); chips are the stored ones plus
// those derived from records (Re-read edit, Retry, Keep report) and the card for a turn kept from a
// reply that failed.

import type { ChatId, EntityId, MessageId, PackId, PanelId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { deepFreeze, hasOwn, isRecord } from "../shared/json";
import { formatMoney, requirementExpr } from "../shared/world";
import { bandTiers } from "../shared/tiers";
import type { ChatRun, EventRef, HeldWrite, JournalNote, KeepLine, LedgerEvent, PostEntry, Rec } from "../shared/ledger";
import type { CallMeterView, Chip, ControlsView, HudView, PaletteEntry, PaletteOption, PaletteView, PendingMark, SceneView, StateView, TimelapseView } from "../shared/state-view";
import type { GenerateAs } from "../shared/protocol";
import { narratorViewOf, type NarratorView } from "../shared/settings";
import { chatFeed, sourceOf, worldFeed } from "../engine/feed";
import { compactSpan, paramLabel, spanText } from "../engine/action-words";
import { sectionsOf } from "./book";
import type { ActionDef, MapDisplay, WorldDoc } from "../shared/world";
import { tableChoices } from "../shared/tables";
import { routineSettingsOf } from "../shared/routines";
import { checkView, policyOf } from "../engine/adjudication";
import { calendarMonths, calendarOf, dayPartAt, formatClock, formatStamp, placeOffset } from "../engine/calendar";
import { ENGINE_EVENTS } from "../engine/engine-pack";
import { clockPaused, DEFAULT_SCENE_TYPE, ENGINE_SCENE_TYPES, placeSceneType, sceneType } from "../engine/time";
import { identifiers } from "../engine/expr";
import type { ChainMessage, FoldOutput } from "../engine/ledger/chain";
import { keepsPassages, type LedgerCore } from "../engine/ledger/journal";
import { activeRecord, isLive, turnPath } from "../engine/ledger/path";
import { actsFor } from "../engine/org";
import { optionalQuery, own } from "../engine/pack-kit";
import { knownSubjects, playerDrop, playerLines, povMayKnow, UNSEEN_DROP } from "../engine/player-events";
import { playedWorld } from "../engine/places-in-play";
import { withPov } from "../shared/character-engine";
import type { ReadContext } from "../engine/registry";
import { readPass } from "../engine/read-pass";
import { claimsOf, presetOf } from "../engine/realism";
import { inferredOf, worldSkills } from "../engine/inferred";
import { levelFloors, type Registry } from "../engine/registry-impl";
import { actionOdds, companionCandidates, paramCandidates } from "../engine/resolve";
import { isGone, kindIs, placeOfEntity, scopeEnv } from "../engine/scope";
import { povLife } from "../engine/life";
import type { WorldState } from "../engine/state";
import { definitionsLag } from "../engine/upgrade";
import { canSeeEntity, canSeePlace, findLeaks, playerTrack, povPlace, storyLocked, unrevealedSecrets, unrevealedTruths } from "../engine/visibility";
import { knownPlaceRefs } from "../engine/character";
import { combatEntries, paletteEncounter } from "../packs/combat/core/index";
import { thingsConfigOf } from "../shared/things";
import type { ChatKnowledgePrefs } from "./chat-knowledge-prefs";
import type { StoredChip } from "./chips";
import type { ReplyFailure } from "./ledger-io";
import { OFFSTAGE_TEXT_ID, type PromptTexts } from "../shared/prompts";
import { TELL_LABEL, type OffstageSettings } from "../shared/offstage";
import { renderPrompt } from "./prompts";
import { chatCashRule, toggles } from "../packs/economy/core/pay";
import { FEATURE_DEFS } from "../shared/finance";
import { turnFrame } from "./turn-frame";
import { gmKeyOf } from "./gm-memo";
import type { DiagStep } from "../shared/diagnostics";
import { unfaithfulChip, unreachedChip } from "../shared/passage";
import { beatOf, STORY_BEAT } from "../shared/story";

/** The palette's timelapse action; its params are `{target, overrides}`. */
export const TIMELAPSE_ACTION = "timelapse";

export function notWorldView(chatId: ChatId): StateView {
  return { v: 1, chatId, worldId: null, revision: null, status: "not_world", hud: null, scene: null, chips: [], replyClocks: {}, journal: [], keepReport: [], pending: [], panels: {}, palette: null, controls: null, meter: null, packs: {}, currency: null };
}

const GROUPS: Record<string, PaletteEntry["group"]> = { buy: "buy", purchase: "buy", pay: "pay", transfer: "transfer", drive: "drive", lend: "lend" };

function groupOf(action: ActionDef): PaletteEntry["group"] {
  const last = action.id.split(".").at(-1) ?? action.id;
  for (const [key, group] of Object.entries(GROUPS)) if (last.startsWith(key)) return group;
  return "action";
}

/** A record's clock advance in minutes (its elapsed time, timelapse included). */
export function clockMinutes(events: readonly LedgerEvent[]): number {
  let m = 0;
  for (const e of events) if (e.type === "clock") m += e.minutes;
  return m;
}

/**
 * The scene types the POV may know of (DESIGN §7): the engine's own and those of the places the POV
 * can see. A world's tick says nothing of who may know a type, so one only a hidden place has, or
 * only an action sets, is never named, whatever tick the world gives it.
 */
function knownSceneTypes(registry: Registry, world: WorldDoc, state: Readonly<WorldState>): Set<string> {
  return new Set([...ENGINE_SCENE_TYPES, ...Object.values(world.places).flatMap((p) => (p.sceneType && canSeePlace(registry, world, state, world.pov, p.id) ? [p.sceneType] : []))]);
}

function hud(world: WorldDoc, state: WorldState, panels: Record<PanelId, JsonValue>, ctx: ReadContext): HudView {
  const cal = calendarOf(world);
  const pov = world.pov;
  const placeId = placeOfEntity(state, pov);
  // The pill and the ✎ name the POV's place as every player surface does: one it can't see is
  // "Somewhere", with no id.
  const shown = povPlace(ctx.registry, world, state);
  const offset = placeOffset(world, state.clock, placeId);
  const money = ctx.levelOf(pov, "money");
  const economy = panels["economy.money"];
  const band = isRecord(economy) && typeof economy.band === "string" ? economy.band : null;
  // The economy pack's panel knows the POV's cash accounts; without it, the POV's account or cash field.
  const panelCash = isRecord(economy) && isRecord(economy.cash) ? economy.cash : null;
  const cents = panelCash && typeof panelCash.cents === "number" ? panelCash.cents : (state.accounts[pov] ?? (typeof state.entities[pov]?.fields.cash === "number" ? Number(state.entities[pov]?.fields.cash) : null));
  const weatherPanel = panels["weather.weather"] ?? panels["weather.now"];
  const weather = isRecord(weatherPanel) && typeof weatherPanel.label === "string" ? weatherPanel.label : null;
  const fixes: HudView["fixes"] = {};
  // The clock's ✎ (DESIGN §12) sets a date and a time of day in the world's calendar, starting from
  // now as the pill reads it, local to the POV's place; it needs the calendar, as a Timelapse does.
  if (ctx.levelOf(pov, "calendar") >= 1) fixes.time = { type: "time", value: formatStamp(cal, state.clock, offset), ...calendarMonths(cal) };
  if (placeId) {
    // The ✎ offers the places the POV may see; a hidden one, even where it stands, is never offered,
    // nor named in another's path or as its parent (`knownPlaceRefs`), for the place sheet.
    const seen = (id: string): boolean => canSeePlace(ctx.registry, world, state, pov, id);
    const options = Object.values(world.places).filter((p) => seen(p.id));
    fixes.place = { entity: pov, field: "place", type: "ref", value: shown?.id ?? null, options: options.map((p) => ({ value: p.id, label: p.name })), places: knownPlaceRefs(world, seen) };
  }
  // Cash from the economy panel is the POV's cash accounts: its ✎ posts a correction to them
  // (`lre.fix`), so it needs one. Without the panel's cash, the ✎ sets the cash field the pill shows.
  const cashAccount = isRecord(economy) && Array.isArray(economy.accounts) && economy.accounts.some((a) => isRecord(a) && a.kind === "cash");
  if (money >= 2 && cents !== null && (typeof panelCash?.cents !== "number" || cashAccount)) fixes.cash = { entity: pov, field: "cash", type: "money", value: cents, min: 0 };
  // Weather lives on the region over the player; the weather pack knows its climate's states.
  const weatherFix = optionalQuery(ctx, "weather.fix")?.(ctx) ?? null;
  if (weatherFix) fixes.weather = weatherFix;
  // The scene type lives in the POV's `scene` field, which wins over its place's default until an
  // action, a rule or another fix sets it; "" goes back to following the place. The ✎ offers the
  // scene types the POV may know of (`knownSceneTypes`), and only those: it doesn't name the place
  // default's type, or count a pinned one as current, when that is another type.
  const pinned = state.entities[pov]?.fields.scene;
  if (state.entities[pov]) {
    const types = knownSceneTypes(ctx.registry, world, state);
    const label = (type: string) => `${type.charAt(0).toUpperCase()}${type.slice(1).replace(/_/g, " ")}`;
    const placeDefault = placeSceneType(world, state);
    const value = typeof pinned !== "string" || pinned === "" ? "" : types.has(pinned) ? pinned : null;
    fixes.scene = { entity: pov, field: "scene", type: "text", value, options: [{ value: "", label: types.has(placeDefault) ? `Place default (${label(placeDefault)})` : "Place default" }, ...[...types].map((type) => ({ value: type, label: label(type) }))] };
  }
  return {
    // Paused as the engine reads it: for the scene it was paused in, so a scene change shows the clock running.
    clock: { minutes: state.clock, label: formatClock(cal, state.clock, offset), dayPart: dayPartAt(cal, state.clock + offset).label, paused: clockPaused(world, state), scale: state.time.scale },
    place: shown,
    weather,
    cash: money === 0 ? null : money === 1 ? (band ? { band } : panelCash && typeof panelCash.band === "string" ? { band: panelCash.band } : null) : cents === null ? null : { cents },
    fixes,
  };
}

function scene(world: WorldDoc, state: WorldState, headElapsed: number, registry: Registry): SceneView {
  const placeId = placeOfEntity(state, world.pov);
  const present: SceneView["present"] = [];
  for (const [id, e] of Object.entries(state.entities)) {
    if (id === world.pov || placeOfEntity(state, id) !== placeId || placeId === null || isGone(state, id)) continue;
    // Authored kinds extend `person` (the starters' `character`). Someone the POV can't see (secret,
    // or `known_by` and not known) isn't listed, even standing right there. A body stays listed where
    // it lies, with its life state as the POV knows it.
    if (!kindIs(registry, world, e.kind, "person") || !canSeeEntity(registry, world, state, world.pov, id)) continue;
    const life = povLife(world, state, id);
    present.push({ id, name: e.name, label: world.kinds[e.kind]?.label ?? e.kind, ...(life ? { life: life.label } : {}) });
  }
  // The scene in force as the player reads it: a type the POV may not know of (one only a hidden
  // place has or only an action sets, whether the POV stands in that place or is pinned to it)
  // reads as the engine's default scene. Display only: the clock still paces by the type in force.
  const type = sceneType(world, state);
  return { placeId: povPlace(registry, world, state)?.id ?? null, sceneType: knownSceneTypes(registry, world, state).has(type) ? type : DEFAULT_SCENE_TYPE, present, elapsed: headElapsed };
}

/** Why a palette option is off, for the player: an unmet requirement isn't spelled as its expression, only in its own words when it has some (`why`). */
function unavailable(failed: { code: string; reason: string; words?: string } | null | undefined): string {
  if (!failed) return "Not available";
  return failed.code === "requirement" ? (failed.words ?? "Not possible here and now") : failed.reason;
}


export function palette(world: WorldDoc, state: WorldState, registry: Registry): PaletteView {
  const actions = new Map<string, ActionDef>();
  for (const [id, a] of registry.actions) actions.set(id, a);
  for (const [id, a] of Object.entries(world.actions)) actions.set(id, a);
  const entries: PaletteEntry[] = [];
  const ctx = registry.context(world, state);
  const env = scopeEnv({ reg: registry, ctx, bindings: { self: world.pov, actor: world.pov } });
  const retry = policyOf(world, state).retry;
  // Paying as (ORG-SPEC §3.6): the organizations the POV may spend for, worked out once, for Pay and Buy.
  let spendsFor: { id: EntityId; name: string }[] | undefined;
  const payingFor = (): { id: EntityId; name: string }[] => (spendsFor ??= actsFor(ctx, world.pov, "money.spend").map((id) => ({ id, name: state.entities[id]?.name ?? id })));
  for (const action of actions.values()) {
    // Combat actions are the combat pack's Combat tab (below), and only where the world's ruleset has combat.
    if (action.id === TIMELAPSE_ACTION || action.combat) continue;
    // A step the story hasn't come to isn't an option yet (DESIGN §11): listed, even locked, it would tell what lies ahead.
    if (storyLocked(env, action)) continue;
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
    // A text param naming a table row (Use a skill, Make a save): one option per row, with its odds.
    const rowParam = refParam === undefined ? Object.entries(action.params).find(([, p]) => p.type === "text" && !p.optional && p.table !== undefined) : undefined;
    const rows = rowParam ? tableChoices(own(world.tables, rowParam[1].table ?? "")).slice(0, 24) : [];
    for (const row of rows) {
      const params: JsonObject = { [rowParam?.[0] ?? ""]: row.key };
      const odds = actionOdds(registry, world, state, { action, params });
      options.push({
        label: row.label,
        params,
        ...checkView(odds, retry),
        ...(odds.duration > 0 ? { minutes: odds.duration } : {}),
        ...(odds.available ? {} : { disabled: unavailable(odds.failed) }),
      });
    }
    const targets = offers.length > 0 || stats.length > 0 || rows.length > 0 ? [] : refParam ? paramCandidates(registry, world, state, action, refParam) : [null];
    // A second required ref (Drive's destination, Lend's borrower) is a nested pick.
    const secondParam = refParam ? Object.entries(action.params).find(([name, p]) => name !== refParam && p.type === "ref" && !p.optional)?.[0] : undefined;
    // Its candidates are the same for every first pick, so they are found once.
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
        const seconds = (secondCandidates ??= paramCandidates(registry, world, state, action, secondParam)).filter((id) => id !== target).slice(0, 12);
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
    if (options.length === 0) continue;
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
    });
  }
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
}

function controls(world: WorldDoc, state: WorldState, sceneType: string, registry: Registry, knowledge: ViewInput["knowledge"], offstage: OffstageSettings): ControlsView {
  return {
    // The chat's own preset: a new chat may start from the user's settings, and This chat changes it.
    realism: { preset: presetOf(state.realism), levels: { ...state.realism.levels }, tierCaps: structuredClone(state.realism.tierCaps), bandTiers: bandTiers(world), floors: levelFloors(world), claims: claimsOf(world, state) },
    adjudication: policyOf(world, state),
    inferred: inferredOf(world, state),
    skills: worldSkills(registry, world, state),
    sections: sectionsOf(world).map((s) => ({ id: s.id, label: s.label, world: worldFeed(s), chat: chatFeed(state)[s.id] ?? null })),
    // One row per source, as `include` names them; a source with no words of its own reads as its name.
    sources: [...new Map(registry.renderers.map((r) => [sourceOf(r), { id: sourceOf(r), slot: r.slot, label: r.label ?? sourceOf(r).replace(/_/g, " ") }])).values()],
    time: {
      sceneType,
      sceneTicks: { ...state.time.sceneTicks },
      scale: state.time.scale,
      paused: clockPaused(world, state),
      interrupts: { ...state.time.interrupts },
      speedThrough: structuredClone(state.time.speedThrough),
      montage: state.time.montage,
      unitCap: { ...state.time.unitCap },
    },
    knowledge: {
      tracking: { chat: knowledge.chat.knowledge ?? null, user: knowledge.tracking },
      narrator: { chat: knowledge.chat.narrator ?? null, world: narratorViewOf(world.narrator), user: knowledge.narrator },
    },
    things: { tidy: { chat: knowledge.chat.tidy ?? null, world: thingsConfigOf(world).tidy.auto } },
    cash: cashControls(registry, world, state),
    offstage,
  };
}

/** Where cash needs a machine (GM → This chat → Money): the chat's own rule beside the world's switch, at the player character's Money level; null where money is off. */
function cashControls(registry: Registry, world: WorldDoc, state: WorldState): ControlsView["cash"] {
  const level = registry.context(world, state).levelOf(world.pov, "money");
  if (!(level > 0)) return null;
  const set = toggles(world).atm;
  return { chat: chatCashRule(state), world: typeof set === "boolean" ? set : null, level, usual: FEATURE_DEFS.atm.on };
}

/** Turns in the Journal (D8: player-known results), oldest first; the latest 100. */
const JOURNAL_TURNS = 100;

/**
 * A turn's player-facing lines, as its change chip lists them and its Journal entry keeps them: at
 * most 8, and past that money, quest and signal lines first (`playerLines`), so a long timelapse's
 * payday, card interest and statement stay in both.
 */
export function turnLines(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, events: readonly LedgerEvent[]): string[] {
  return playerLines(registry, world, state, world.pov, events, 8);
}

/**
 * A depth reply's beats as its change chip lists them (LIVE3 lane 1b), each one that reached the
 * player character `pov`, in the order the scene decided them, by what reached him: his own point of
 * view where he has one (a reach in part, or a stranger in a beat he had whole), else what there was
 * to sense with the words said. A beat's texts are blobs, read before the build (`beatTextHashes`):
 * one whose text wasn't read, or that never reached him, isn't listed. None is capped, so the chip
 * counts every beat it lists.
 */
export function beatLines(events: readonly LedgerEvent[], pov: EntityId, texts: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const e of events) {
    const b = e.type === STORY_BEAT && "data" in e ? beatOf(e.data) : null;
    const x = b?.exposure.find((r) => r.who === pov);
    if (!b || !x) continue;
    const surface = x.reach === "whole" ? texts.get(b.surface) : undefined;
    const quotes = b.quotes ? texts.get(b.quotes) : undefined;
    const line = (x.pov !== undefined ? texts.get(x.pov) : surface !== undefined ? `${surface}${quotes ? ` “${quotes}”` : ""}` : undefined)?.trim();
    if (line && !out.includes(line)) out.push(line);
  }
  return out;
}

/** The texts the head reply's change chip words its beats with (`beatLines`), by hash: each beat's surface, its words and every point of view of it. */
export function beatTextHashes(core: LedgerCore, observed: readonly ChainMessage[]): string[] {
  const head = core.chain(observed).findLast((m) => !m.isUser);
  const rec = head ? activeRecord(head, core.journal.tombstones) : null;
  const out = new Set<string>();
  for (const e of rec?.events ?? []) {
    const b = e.type === STORY_BEAT && "data" in e ? beatOf(e.data) : null;
    if (!b) continue;
    out.add(b.surface);
    if (b.quotes) out.add(b.quotes);
    for (const x of b.exposure) if (x.pov) out.add(x.pov);
  }
  return [...out];
}

/** How a ✎ fix of the time moved the clock, in words ("Clock moved on 2 h 15 min", "Clock set back 3 h"); null for a fix that moved none. */
export function clockFixLine(events: readonly LedgerEvent[]): string | null {
  let minutes = clockMinutes(events);
  for (const e of events) if (e.type === ENGINE_EVENTS.rewind && "data" in e && typeof e.data.minutes === "number") minutes -= e.data.minutes;
  return minutes > 0 ? `Clock moved on ${compactSpan(minutes)}` : minutes < 0 ? `Clock set back ${compactSpan(-minutes)}` : null;
}

/**
 * A ✎ fix's or GM edit's lines, as its chip and its Journal line word them: how a fix of the time
 * moved the clock first, then the changes the POV may see (`turnLines`).
 */
export function fixLines(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, events: readonly LedgerEvent[]): string[] {
  const clock = clockFixLine(events);
  return [...(clock ? [clock] : []), ...turnLines(registry, world, state, events)];
}

/** The chip of a ✎ fix or GM edit on a swipe's record, by its entry's seq: its Undo (`lre.chip`) finds the entry by it. */
export function fixChip(messageId: string, swipeId: number, seq: number): string {
  return `fix:${messageId}:${swipeId}:${seq}`;
}

/** How many people and things the line for an unseen fix names; past that it counts them. */
const UNSEEN_NAMES = 3;

/**
 * A ✎ fix's or GM edit's chip line when the POV may see none of its changes: who it was about, as
 * far as the POV knows them ("About Sam Reyes"), never where they went or what was set; with no one
 * the POV knows, that it happened behind the scenes. An agent's dry run under the player
 * character's knowledge says the same of a change it can't see (`agents/tools/writer.ts`).
 */
export function unseenFixLine(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, events: readonly LedgerEvent[]): string {
  const names = knownSubjects(registry, world, state, world.pov, events);
  if (names.length === 0) return "Behind the scenes";
  const more = names.length - UNSEEN_NAMES;
  return `About ${names.slice(0, UNSEEN_NAMES).join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

/** An event's ref as a key, to match `Rec.undone` and the fold's drop notes. */
function refKey(ref: EventRef): string {
  return ref.in === "events" ? `e:${ref.index}` : `p:${ref.seq}:${ref.index}`;
}

/**
 * What a folded record applied (DESIGN §4.3 Fold): its events, and after them its live `post`
 * entries' by `seq`, without the undone ones and those a rebased view dropped (a Keep conversion
 * applies, so it stays); a record that folded nothing (paused) applied none. ✎ fixes and GM edits
 * come apart from the rest (`fixes`, each still holding an event), since each is its own Journal
 * line and Undo chip; one a rebased view worked out again holds what it applied there (the fold's
 * `resolved`), so one already so there reads as nothing made. The change chip and the Journal list
 * these, so an undone purchase, or one an earlier switch dropped, isn't shown as made. A fix an
 * agent wrote keeps its `agent` (role, key, label, knowledge), which the workspace's provenance reads.
 * `agents` lists the agents' writes that stand on the record, in order, each with what it applied:
 * one worked out to nothing where it landed (already so) too, and none undone or dropped, so the
 * agents' writer finds a role's latest write for its retry check. `pre` counts the leading `events`
 * the turn planned before its reply (its actions and processes); the rest are the reply's read.
 */
export function appliedEvents(rec: Rec, fold: FoldOutput, index: number): { events: LedgerEvent[]; pre: number; post: LedgerEvent[]; fixes: { seq: number; events: LedgerEvent[]; by?: NonNullable<PostEntry["by"]>; gm?: true; agent?: NonNullable<PostEntry["agent"]> }[]; agents: { seq: number; events: LedgerEvent[]; agent: NonNullable<PostEntry["agent"]> }[] } {
  const result = fold.messages[index];
  // A bare record folds as a plain message, and its live entries apply all the same.
  if (!result || (result.fold !== "on_path" && result.fold !== "view" && result.fold !== "plain")) return { events: [], pre: 0, post: [], fixes: [], agents: [] };
  const skipped = new Set(rec.undone.map(refKey));
  for (const n of fold.notes) if (n.kind === "dropped" && n.messageId === result.id && n.ref && "in" in n.ref) skipped.add(refKey(n.ref));
  const resolved = new Map(fold.resolved.filter((r) => r.messageId === result.id).map((r) => [r.seq, r.events]));
  const recPath = turnPath(rec);
  const live = rec.post
    .filter((p) => isLive(p.at, result.parentPath, recPath))
    .sort((a, b) => a.seq - b.seq)
    .map((p) => ({ seq: p.seq, kind: p.kind, events: resolved.get(p.seq) ?? p.events.filter((_, i) => !skipped.has(refKey({ in: "post", seq: p.seq, index: i }))), ...(p.by ? { by: p.by } : {}), ...(p.gm ? { gm: p.gm } : {}), ...(p.agent ? { agent: p.agent } : {}), standing: !Array.from({ length: Math.max(1, p.events.length) }, (_, i) => refKey({ in: "post", seq: p.seq, index: i })).every((k) => skipped.has(k)) }));
  const events = rec.events.filter((_, i) => !skipped.has(refKey({ in: "events", index: i })));
  return {
    events,
    pre: rec.events.slice(0, rec.pre).filter((_, i) => !skipped.has(refKey({ in: "events", index: i }))).length,
    post: live.filter((p) => p.kind !== "fix").flatMap((p) => p.events),
    fixes: live.filter((p) => p.kind === "fix" && p.events.length > 0).map((p) => ({ seq: p.seq, events: p.events, ...(p.by ? { by: p.by } : {}), ...(p.gm ? { gm: p.gm } : {}), ...(p.agent ? { agent: p.agent } : {}) })),
    agents: live.flatMap((p) => (p.kind === "fix" && p.agent && p.standing ? [{ seq: p.seq, events: p.events, agent: p.agent }] : [])),
  };
}

/**
 * Whether anything was done on reply `index` of `chain` (the journal's) after its entry `seq`
 * (DESIGN §11): a later live entry on its record that an Undo hasn't taken back whole, or a later
 * marker on its message that folds after the record's events (a setting, an Upgrade). Tell or Don't
 * tell takes the entry back and makes it again last, so only one nothing came after can change: made
 * again after a later change, it would undo that change (a pause made again after its resume pauses
 * the payment again).
 */
export function doneAfter(chain: readonly ChainMessage[], fold: FoldOutput, rec: Rec, index: number, seq: number): boolean {
  const parent = fold.messages[index]?.parentPath;
  if (parent === undefined) return true;
  const recPath = turnPath(rec);
  const undone = new Set(rec.undone.map(refKey));
  // An entry stands while one of its refs (its first, for one with no events of its own) isn't undone.
  if (rec.post.some((p) => p.seq > seq && isLive(p.at, parent, recPath) && Array.from({ length: Math.max(1, p.events.length) }, (_, i) => refKey({ in: "post", seq: p.seq, index: i })).some((k) => !undone.has(k)))) return true;
  // A marker up to `markersApplied` folds before the record's events, so before every entry.
  return (chain[index]?.ledger?.markers ?? []).some((mk) => mk.seq > Math.max(seq, rec.markersApplied) && isLive(mk.at, parent, recPath));
}

/** An action done off screen with a change after it (`doneAfter`): its chip says why its Tell or Don't tell is gone. */
export const TELL_FIXED = "Something changed after it, so whether it's told can't change now";

/**
 * The Journal's turn entries: what each folded turn applied, in player-facing lines (only events
 * the POV may see, about things it has met, worded with labels, leak-checked). They are `note`
 * entries, each followed by a `fix` note per ✎ fix or GM edit the player may see, and per action
 * the player did off screen (DESIGN §11), which reads as itself where it changed nothing they see
 * (a standing payment set up, someone hired); the fold's own notes follow them. The latest `keep` of
 * them, of the replies from chain index `start` on: read back to front, so a window reads only the
 * turns it shows, however long the chat (each turn's entries are its own, read against the head).
 */
function turnNotes(chain: readonly ChainMessage[], fold: FoldOutput, core: LedgerCore, registry: Registry, world: WorldDoc, state: WorldState, keep = JOURNAL_TURNS, start = 0): JournalNote[] {
  const turns: JournalNote[][] = [];
  let count = 0;
  for (let i = chain.length - 1; i >= Math.max(0, start) && count < keep; i--) {
    const m = chain[i];
    if (!m || m.isUser) continue;
    const rec = activeRecord(m, core.journal.tombstones);
    if (!rec) continue;
    const own: JournalNote[] = [];
    const applied = appliedEvents(rec, fold, i);
    const lines = turnLines(registry, world, state, [...applied.events, ...applied.post]);
    const minutes = clockMinutes(rec.events);
    if (minutes > 0 && fold.messages[i]?.fold !== "plain") lines.push(`${spanText(minutes)} passed`);
    if (lines.length > 0) own.push({ kind: "note", messageId: m.id, ref: null, text: lines.join(" · ") });
    for (const fix of applied.fixes) {
      const seen = fixLines(registry, world, state, fix.events);
      const fixed = seen.length > 0 || !fix.by || fix.by.action === "hint" ? seen : [fix.by.label];
      // Who made it, for the main agent's digest (DESIGN §11): the player out of play, told or not, or the GM (an edit, a review card's Apply).
      const source = fix.by ? (fix.by.told !== undefined ? "told" : "untold") : fix.gm || fix.agent ? "gm" : undefined;
      if (fixed.length > 0) own.push({ kind: "fix", messageId: m.id, ref: { in: "post", seq: fix.seq, index: 0 }, text: fixed.join(" · "), ...(source ? { source } : {}) });
    }
    turns.push(own);
    count += own.length;
  }
  return turns.reverse().flat().slice(-keep);
}

/**
 * Every turn's Journal entries on the chain before `index` (`turnNotes`, none left out), from chain
 * index `start` on, as the player sees them at that point: the main agent's digest of what changed
 * since its last turn, which reads none before that turn.
 */
export function journalNotes(core: LedgerCore, observed: readonly ChainMessage[], index: number, registry: Registry, start = 0): JournalNote[] {
  const prefix = observed.slice(0, Math.max(0, index));
  const fold = core.fold(prefix);
  const world = core.playedAt(fold.state);
  if (!world) return [];
  return turnNotes(core.chain(prefix), fold, core, registry, world, fold.state, Number.POSITIVE_INFINITY, start);
}

/**
 * What the player did off screen before a turn and told to the story (DESIGN §11): each told fix on
 * the record of the reply the turn follows, standing (an undone one tells nothing), oldest first, as
 * recorded (`by.told`, the Outcome's words). `index` is where the turn's reply is in `observed` (its
 * length for a new reply), so a Re-run of the turn tells them again and the next turn, which follows
 * another reply, doesn't.
 */
export function toldOffstage(core: LedgerCore, observed: readonly ChainMessage[], index: number): string[] {
  const prefix = observed.slice(0, Math.max(0, index));
  const chain = core.chain(prefix);
  const at = chain.findLastIndex((m) => !m.isUser);
  const m = chain[at];
  const rec = m ? activeRecord(m, core.journal.tombstones) : null;
  if (!m || !rec || !rec.post.some((p) => p.kind === "fix" && p.by?.told !== undefined)) return [];
  return appliedEvents(rec, core.fold(prefix), at).fixes.flatMap((f) => (f.by?.told !== undefined && f.by.told !== "" ? [f.by.told] : []));
}

/**
 * The Outcome's lines a turn leads with (DESIGN §6.2, §11): one per told off-screen fix before it
 * (`toldOffstage`), in the text `outcome.offstage` of the turn's prompt set. Recorded with the turn's
 * other Outcome lines, so a Re-narrate tells them as the turn did.
 */
export function offstageLines(core: LedgerCore, observed: readonly ChainMessage[], index: number, texts: PromptTexts): string[] {
  return toldOffstage(core, observed, index).map((what) => renderPrompt(OFFSTAGE_TEXT_ID, texts, { what }));
}

/** An out-of-play action's words for the Outcome (`by.told`): what it was, with its picks, then what it changed as the player saw it. */
export function toldWords(what: string, changes: readonly string[]): string {
  const said = what.trim().replace(/[.\s]+$/, "");
  return changes.length > 0 ? `${said}. What changed: ${changes.join("; ")}` : said;
}

/** Turns `{{recent}}` holds (DESIGN §5.2). */
const RECENT_TURNS = 5;

/** `{{recent}}` as last made for each ledger and registry, by the fold's key of the chain it was made from (Settings → Speed → Reuse built views): a few chains each, the oldest let go. */
const recentMemo = new WeakMap<LedgerCore, WeakMap<Registry, Map<string, readonly string[]>>>();
const RECENT_KEPT = 8;

/**
 * `{{recent}}` for a model step (DESIGN §5.2): the Journal's latest turn lines before `index` in the
 * chain, oldest first, as the player sees them at that point (worded and filtered by `turnNotes`
 * against the state there, so nothing the POV hadn't seen by then). With `reuse` (Reuse built
 * views; a turn's own setting, else on), the lines made for a chain whose fold has the same key are
 * given again: equal keys fold to equal outputs, so they read the same.
 */
export function recentLines(core: LedgerCore, observed: readonly ChainMessage[], index: number, registry: Registry, reuse = turnFrame()?.settings.perf.reuseViews ?? true): string[] {
  const prefix = observed.slice(0, Math.max(0, index));
  const keys = reuse ? core.foldKeys(prefix) : null;
  const key = keys ? `${keys.steps.at(-1) ?? keys.root}\u0000${JSON.stringify(core.journal.tombstones)}` : null;
  const byRegistry = key === null ? undefined : recentMemo.get(core)?.get(registry);
  const known = key === null ? undefined : byRegistry?.get(key);
  if (known) return [...known];
  const fold = core.fold(prefix);
  const world = core.playedAt(fold.state);
  if (!world) return [];
  const lines = turnNotes(core.chain(prefix), fold, core, registry, world, fold.state, RECENT_TURNS).map((n) => n.text);
  if (key !== null) {
    const byCore = recentMemo.get(core) ?? new WeakMap<Registry, Map<string, readonly string[]>>();
    const map = byCore.get(registry) ?? new Map<string, readonly string[]>();
    map.delete(key);
    map.set(key, Object.freeze([...lines]));
    if (map.size > RECENT_KEPT) map.delete(map.keys().next().value ?? "");
    byCore.set(registry, map);
    recentMemo.set(core, byCore);
  }
  return lines;
}

/**
 * Overdue use grants the POV is party to (DESIGN §8 Gear: "on expiry the thing stays where it is, is
 * flagged overdue"): lent out, with Take back; or borrowed, with Give back. From the head state.
 */
function overdueChips(messageId: string, ctx: ReadContext, state: Readonly<WorldState>, world: WorldDoc): Chip[] {
  const overdue = optionalQuery(ctx, "gear.overdue");
  if (!overdue) return [];
  const pov = world.pov;
  const owners = new Set<EntityId>([pov]);
  for (const e of Object.values(state.entities)) if (e.fields.overdue === true && typeof e.fields.owner === "string") owners.add(e.fields.owner);
  const name = (id: EntityId | null): string => (id ? (state.entities[id]?.name ?? id) : "its owner");
  const out: Chip[] = [];
  for (const owner of owners) {
    for (const g of overdue(ctx, owner)) {
      if (g.owner === pov) out.push({ id: `overdue:${g.thing}:${g.borrower}`, kind: "overdue", messageId, label: `Overdue: ${name(g.thing)}`, detail: `${name(g.borrower)} still has it; the loan ran out.`, actions: [{ id: "reclaim", label: "Take it back", style: "primary" }], expires: "never" });
      else if (g.borrower === pov) out.push({ id: `overdue:${g.thing}:${g.borrower}`, kind: "overdue", messageId, label: `Overdue: ${name(g.thing)}`, detail: `It was due back to ${name(g.owner)}.`, actions: [{ id: "return", label: "Give it back", style: "primary" }], expires: "never" });
    }
  }
  return out;
}

/**
 * The Keep report chip's count and detail: one row per dropped group (its members drop and convert
 * as one unit), else per identical line, counted.
 */
export function keepSummary(lines: readonly { messageId?: string; status: string; text: string; group?: string }[]): { count: number; detail: string } {
  const rows = new Map<string, { text: string; n: number }>();
  for (const k of lines) {
    const key = `${k.messageId ?? ""}\u0000${k.status}\u0000${k.group === undefined ? `t:${k.text}` : `g:${k.group}`}`;
    const row = rows.get(key);
    if (row) row.n++;
    else rows.set(key, { text: `${k.status}: ${k.text}`, n: 1 });
  }
  return { count: rows.size, detail: [...rows.values()].map((r) => (r.n > 1 ? `${r.text} (${r.n} linked changes)` : r.text)).join("\n") };
}

/**
 * Drop notes and Keep lines as the player sees them: a validator's reason names
 * places, people and tracks the POV may not know, so each is worded by `playerDrop` from the event
 * it refers to (its player line, or "A change no longer applies"). Inert lines are fixed text. The
 * members of one dropped group carry the group and its lead line (the first that isn't neutral), so
 * they show as one row; in the Journal they are one "dropped" note, at the first member's place,
 * with "(N linked changes)" when the group has more than one.
 */
export function playerDrops(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, recordOf: (messageId: string) => Rec | null, notes: readonly JournalNote[], keep: readonly KeepLine[]): { notes: JournalNote[]; keep: KeepLine[] } {
  const eventAt = (messageId: string, ref: EventRef | { marker: number } | null): LedgerEvent | undefined => {
    if (!ref || "marker" in ref) return undefined;
    const rec = recordOf(messageId);
    if (!rec) return undefined;
    return ref.in === "events" ? rec.events[ref.index] : rec.post.find((p) => p.seq === ref.seq)?.events[ref.index];
  };
  const worded = (messageId: string, ref: EventRef | { marker: number } | null, reason: string): string => playerDrop(registry, world, state, world.pov, eventAt(messageId, ref), reason).text;
  const lines = keep.map((k): KeepLine => {
    if (k.status === "inert") return k;
    const group = eventAt(k.messageId, k.ref)?.group;
    return { ...k, text: worded(k.messageId, k.ref, k.text), ...(group !== undefined ? { group } : {}) };
  });
  const lead = new Map<string, string>();
  for (const k of lines) {
    if (k.group === undefined) continue;
    const key = `${k.messageId}\u0000${k.status}\u0000${k.group}`;
    if (!lead.has(key) || (lead.get(key) === UNSEEN_DROP && k.text !== UNSEEN_DROP)) lead.set(key, k.text);
  }
  // Journal: a dropped group's notes become one, led like its Keep row.
  const journal: JournalNote[] = [];
  const groups = new Map<string, { at: number; text: string; n: number }>();
  for (const n of notes) {
    if (n.kind !== "dropped" && n.kind !== "not_carried") {
      journal.push(n);
      continue;
    }
    const note = { ...n, text: worded(n.messageId, n.ref, n.text) };
    const group = n.kind === "dropped" ? eventAt(n.messageId, n.ref)?.group : undefined;
    const key = `${n.messageId}\u0000${group ?? ""}`;
    const row = group === undefined ? undefined : groups.get(key);
    if (group !== undefined && !row) groups.set(key, { at: journal.length, text: note.text, n: 1 });
    if (!row) {
      journal.push(note);
      continue;
    }
    row.n++;
    if (row.text === UNSEEN_DROP && note.text !== UNSEEN_DROP) row.text = note.text;
  }
  for (const row of groups.values()) {
    const first = journal[row.at];
    if (first) journal[row.at] = { ...first, text: row.n > 1 ? `${row.text} (${row.n} linked changes)` : row.text };
  }
  return {
    notes: journal,
    keep: lines.map((k) => (k.group === undefined ? k : { ...k, text: lead.get(`${k.messageId}\u0000${k.status}\u0000${k.group}`) ?? k.text })),
  };
}

/** What a refused held write was, for its notice (post entries are worded by their kind). */
const REFUSED_WHAT: Record<Exclude<HeldWrite["kind"], "post">, string> = { marker: "A settings change", keep: "Keep", discard: "Discard", reread: "A re-read", retry_read: "A re-read", undo: "An undo" };

/**
 * The card for a turn kept from a reply that failed (DESIGN §5.1), on the chat's last message while
 * the turn lasts. Retry the reply starts it as the turn's reply started (`as`): Lumiverse's
 * Regenerate, or its Continue for a Continue; a new reply after a reply only the player's own Send
 * can start, so that card says to press it and has no Retry button, since a Regenerate would roll the
 * reply before it again. Re-run the engine drops the turn first, so the engine runs again. The
 * provider's error stays in Diagnostics.
 */
export function replyFailedChip(turn: string, failed: ReplyFailure, as: GenerateAs, messageId: MessageId): Chip {
  const why = failed === "error" ? " Diagnostics says why it failed." : "";
  const retry = as === "send" ? "Press Send, with nothing typed, to write it again from that same turn" : "Retry the reply writes it again from that same turn";
  const rerun = as === "send" ? "Re-run the engine drops it, so your Send runs the turn again." : "Re-run the engine runs the turn again, then the reply.";
  return {
    id: `reply_failed:${turn}`,
    kind: "reply_failed",
    messageId,
    label: failed === "error" ? "The reply failed" : "The reply came back empty",
    detail: `The engine's work for this turn is kept. ${retry}: the same reading, plan, minds and sections, with no engine calls first. ${rerun}${why}`,
    actions: [
      ...(as === "send" ? [] : [{ id: as, label: "Retry the reply", style: "primary" as const }]),
      { id: "rerun", label: "Re-run the engine" },
      { id: "diagnostics", label: "Diagnostics" },
    ],
    as,
    expires: "next_send",
  };
}

/**
 * Chips derived from the records: Re-read edit, Retry read, Retry (empty reply), degraded, Keep
 * report, what changed (on a depth reply, each beat that reached the player character by its text,
 * from `texts`, `beatLines`), elapsed, overdue, a correction's Undo, a refused write's notice, a
 * depth reply's unfaithful rendering and its text no scene decided. On a chat on depth (`depth`)
 * nothing reads a reply into canon (DEPTH-PLAN §1.3): no Re-read edit or Retry read is offered
 * there, nor anywhere for a depth scene's record, whose rendering stays as it streamed.
 */
function derivedChips(chain: readonly ChainMessage[], fold: FoldOutput, keepReport: readonly KeepLine[], core: LedgerCore, registry: Registry, world: WorldDoc, depth: boolean, texts: ReadonlyMap<string, string>): Chip[] {
  const chips: Chip[] = [];
  const headIndex = chain.findLastIndex((m) => !m.isUser);
  chain.forEach((m, i) => {
    if (m.isUser) return;
    const rec: Rec | null = activeRecord(m, core.journal.tombstones);
    if (!rec) return;
    const fold_ = fold.messages[i]?.fold;
    if (rec.accepted && !depth && (fold_ === "on_path" || fold_ === "plain") && !keepsPassages(rec)) {
      chips.push({ id: `reread:${m.id}:${m.swipeId}`, kind: "reread", messageId: m.id, label: "Re-read edit", detail: "The engine kept the world as simulated. Re-read this text to update it.", actions: [{ id: "reread", label: "Re-read edit", style: "primary" }], expires: "never" });
    }
    if (i !== headIndex) return;
    const text = m.swipes[m.swipeId] ?? "";
    // A record read elsewhere never folds as stored, so a read of it is always refused: no chip leads there.
    if (rec.status === "stopped" && !rec.readElsewhere && !depth && !keepsPassages(rec)) chips.push({ id: `retry_read:${m.id}:${m.swipeId}`, kind: "retry_read", messageId: m.id, label: "Retry read", detail: "The reply stopped early; read what was saved.", actions: [{ id: "retry_read", label: "Retry read" }], expires: "never" });
    // Text of the reply no scene decided, which nothing read (`Rec.unread`): none of it is canon.
    if (rec.unread === "reply") chips.push({ id: `not_canon:${m.id}:${m.swipeId}`, kind: "untracked", messageId: m.id, label: "Not canon", detail: "No scene played this reply on depth, and nothing read it into the story: none of what it tells happened beyond what its turn decided.", actions: [], expires: "never" });
    else if (rec.unread === "continue") chips.push({ id: `not_canon:${m.id}:${m.swipeId}`, kind: "untracked", messageId: m.id, label: "What Continue added isn't canon", detail: "On depth a scene doesn't carry on a reply yet: the narrator wrote on from the reply's last words with nothing decided for it, and nothing read it into the story.", actions: [], expires: "never" });
    // A reply nothing read on depth is Not canon, above, which says what its record is: no Not fully simulated beside it.
    if (rec.status === "degraded" && text.trim() === "") chips.push({ id: `retry:${m.id}:${m.swipeId}`, kind: "retry", messageId: m.id, label: "Retry", detail: "The narrator returned an empty reply.", actions: [{ id: "regenerate", label: "Retry", style: "primary" }], expires: "next_send" });
    else if (rec.status === "degraded" && rec.unread !== "reply") chips.push({ id: `degraded:${m.id}:${m.swipeId}`, kind: "degraded", messageId: m.id, label: "Not fully simulated", detail: "Part of this turn ran engine-only.", actions: [], expires: "next_send" });
    const minutes = clockMinutes(rec.events);
    if (minutes > 0) chips.push({ id: `elapsed:${m.id}:${m.swipeId}`, kind: "elapsed", messageId: m.id, label: minutes >= 60 ? `+${Math.floor(minutes / 60)} h ${minutes % 60} min` : `+${minutes} min`, actions: [], expires: "next_send" });
    // Re-narrate/Re-run (P3, §12; Build C item 1): the choice sets the next swipe's mode, with what the player asks of the new telling when they say, then the UI swipes. On depth the author reads it too, among the player's signals (DEPTH-PLAN §3.9, §4.5); elsewhere only the narrator does.
    if (rec.seed !== "" && rec.path !== "") {
      const ask = { type: "text" as const, label: "What should change?", value: "", optional: true as const };
      const detail = depth ? "Re-narrate tells this turn again: the same beats, new prose. Re-run plays the scene again from the same moment. Either may take a word on what should change: the narrator reads it, and so does the author, who on a Re-run sets the scene by it." : "Re-narrate tells this turn again: the same outcome, new prose. Re-run the turn with the engine plays it again, with a fresh roll. Either may take a word on what should change, which only the narrator reads.";
      chips.push({ id: `swipe_option:${m.id}:${m.swipeId}`, kind: "swipe_option", messageId: m.id, label: "Swipe as…", detail, actions: [{ id: "renarrate", label: "Re-narrate…", input: ask }, { id: "rerun", label: depth ? "Re-run the scene" : "Re-run the turn with the engine", input: ask }], expires: "next_send" });
    }
    // A depth reply that doesn't render its beats faithfully (DEPTH-PLAN §1.3, §1.4): a passage that streamed though its check failed, where it departs, and the moments the narrator couldn't render, with Re-narrate.
    const unfaithful = unfaithfulChip(m.id, m.swipeId, [...rec.events, ...rec.post.filter((e) => e.kind === "cont").flatMap((e) => e.events)]);
    if (unfaithful) chips.push(unfaithful);
    // A depth reply nothing of whose turn reached the player character but his own beats (LIVE3c L3c-5): its quiet passage tells where he is, and this says nothing reached him.
    const unreached = unreachedChip(m.id, m.swipeId, rec.events, (id) => own(fold.state.entities, id)?.name ?? own(world.entities, id)?.name ?? id);
    if (unreached) chips.push(unreached);
    const state = fold.state;
    const ctx = registry.context(world, state);
    const applied = appliedEvents(rec, fold, i);
    const lines = [...turnLines(registry, world, state, applied.events), ...beatLines(applied.events, world.pov, texts)];
    // One change: the label says it all; several: "N changes" with the list as detail, every line it lists counted.
    if (lines.length > 0) chips.push({ id: `change:${m.id}:${m.swipeId}`, kind: "change", messageId: m.id, label: lines.length === 1 ? (lines[0] ?? "Changed") : `${lines.length} changes`, ...(lines.length > 1 ? { detail: lines.join("\n") } : {}), actions: [], expires: "next_send" });
    // Each ✎ fix or GM edit on the head, with Undo, worded for the player (DESIGN §12): what the POV
    // may see of it, else who it was about as far as the POV knows them. Another person's moves and
    // doings are never worded for the player, and a mind or a section's settings has no player line.
    for (const fix of applied.fixes) {
      const fixed = fixLines(registry, world, state, fix.events);
      // A mechanical action of the player's (DESIGN §11), or a hint they opened, is named as theirs,
      // never as a correction: its label says what they did, so nothing they can't see is summed up.
      const detail = fixed.length > 0 ? fixed.join(" · ") : fix.by ? null : unseenFixLine(registry, world, state, fix.events);
      // An out-of-play action's chip on the head says whether the story hears of it, and changes that
      // until the next turn while it is the last thing done there (DESIGN §11); one with a change after
      // it (`doneAfter`) says why it can't.
      const offstage = fix.by && i === headIndex && fix.by.action !== "hint" ? fix.by : null;
      const told = offstage ? (offstage.told !== undefined ? "Told in the next reply" : "Not told to the story") : null;
      const settled = offstage !== null && doneAfter(chain, fold, rec, i, fix.seq);
      const shown = [detail, told, settled ? TELL_FIXED : null].filter((s): s is string => s !== null).join(" · ");
      const tell = offstage && !settled ? [offstage.told !== undefined ? { id: "untell", label: "Don't tell" } : { id: "tell", label: TELL_LABEL }] : [];
      chips.push({ id: fixChip(m.id, m.swipeId, fix.seq), kind: "fix", messageId: m.id, label: fix.by?.label ?? (fix.gm ? "GM edit" : "Corrected"), ...(shown !== "" ? { detail: shown } : {}), actions: [...tell, { id: "undo", label: "Undo", style: "danger" }], expires: "next_send" });
    }
    chips.push(...overdueChips(m.id, ctx, state, world));
  });
  const lines = keepReport.filter((k) => k.status !== "converted");
  const first = lines[0];
  if (first) {
    const summary = keepSummary(lines);
    chips.push({
      id: `keep:${first.messageId}:${first.parentPath.slice(0, 8)}`,
      kind: "keep_report",
      messageId: first.messageId,
      label: `Keep report (${summary.count})`,
      detail: summary.detail,
      actions: [{ id: "open", label: "Review" }],
      expires: "never",
    });
  }
  for (const pause of core.journal.pauses) {
    chips.push({
      id: `pause:${pause.messageId}`,
      kind: "keep_report",
      messageId: pause.messageId,
      label: "Edited message: keep or discard later turns?",
      detail: "Keep replays later turns over the edited text; Discard drops them.",
      actions: [
        { id: "keep", label: "Keep", style: "primary" },
        { id: "discard", label: "Discard", style: "danger" },
      ],
      expires: "never",
    });
  }
  // A write held during a reply that couldn't be made once it finished (P2): told, never silent.
  const headId = chain.findLast((m) => !m.isUser)?.id ?? "";
  for (const r of core.journal.refused ?? []) {
    const first = r.write.kind === "post" ? r.write.entry.events[0] : undefined;
    const what = r.write.kind !== "post" ? REFUSED_WHAT[r.write.kind] : r.write.entry.kind === "fix" ? "Your correction" : r.write.entry.kind === "materialize" ? "Opened detail" : "A confirmed change";
    chips.push({
      id: `refused:${r.write.id}`,
      kind: "refused",
      messageId: r.messageId !== null && chain.some((m) => m.id === r.messageId) ? r.messageId : headId,
      label: `${what} didn't apply after the reply`,
      ...(first ? { detail: playerDrop(registry, world, fold.state, world.pov, first, r.reason).text } : {}),
      actions: [{ id: "dismiss", label: "Dismiss" }],
      expires: "never",
    });
  }
  return chips;
}

/** The parts read off the head state, kept under the fold's state key and the map display: the world it is in, the packs' panels and the HUD. */
interface StateParts {
  key: string;
  world: WorldDoc;
  revision: string;
  lag: string | null;
  panels: Readonly<Record<PanelId, JsonValue>>;
  hud: HudView;
}

/** The parts read off the chain's fold, kept under its key with the journal's pauses and refused writes: the scene, the chips its records give, each reply's clock, the Journal and the Keep report. */
interface ChainParts {
  key: string;
  scene: SceneView;
  chips: readonly Chip[];
  replyClocks: Record<string, string>;
  journal: JournalNote[];
  keepReport: KeepLine[];
}

/**
 * What one chat's state views share from one build to the next (DESIGN §9.6), kept with the chat's
 * open ledger (`Runtime`), so it goes when the ledger does. Each part is kept frozen under the keys
 * of what it was made from: the head state's (`LedgerFold.keys`), the chain's, and the state the
 * narrator sees (`LedgerCore.renderKey`). A build after a change that left them as they were (a
 * message sent, a turn's status, a stored chip) makes none of them again and folds nothing, and a
 * view sent before shares them, so the push copies and compares only what changed.
 */
export class ViewMemo {
  state: StateParts | null = null;
  chain: ChainParts | null = null;
  palette: { key: string; palette: PaletteView } | null = null;
  controls: { key: string; controls: ControlsView } | null = null;
}

/** A part kept for later builds: its own copy, frozen, so nothing that reads it (or what it was read from) changes it. */
function kept<T>(part: T): T {
  return deepFreeze(structuredClone(part));
}

export interface ViewInput {
  chatId: ChatId;
  run: ChatRun;
  core: LedgerCore;
  observed: ChainMessage[];
  registry: Registry;
  world: (revision: string) => WorldDoc | undefined;
  stored: readonly StoredChip[];
  meter: CallMeterView | null;
  /** How the player chose to see the chat's map (`ChatPrefs`); null or absent follows the world. The map panel is built for it. */
  mapDisplay?: MapDisplay | null;
  /** The chat's own knowledge choices (`ChatKnowledge`), beside the user's: knowledge tracking and the narrator's knowledge. */
  knowledge: { chat: ChatKnowledgePrefs; tracking: boolean; narrator: NarratorView };
  /** Settings → Narrator → Out-of-play actions, the user's: what each confirm step's Tell switch starts from (`ControlsView.offstage`). */
  offstage: OffstageSettings;
  /** The chat is on depth (GM → This chat → Depth): nothing reads a reply into canon, so no Re-read edit or Retry read is offered (DEPTH-PLAN §1.3). */
  depth: boolean;
  /** What the chat's views share between builds (`ViewMemo`). */
  memo: ViewMemo;
  /** The head reply's beats' texts, by hash (`beatTextHashes`), read before the build: its change chip lists each beat that reached the player character by them (`beatLines`). Absent: it lists none. */
  beatTexts?: ReadonlyMap<string, string>;
  /**
   * Where the build's time went, filled as it goes: the fold, each pack panel (`panel:<id>`), and
   * the HUD, scene, chips, clocks, Journal, palette and controls it made, in order, each in ms. The
   * runtime keeps a slow one in the chat's diagnostics as `state view/<part>`.
   */
  parts?: DiagStep[];
}

/** `fn`'s value, with how long it took added to `parts` as `name` (nothing kept without `parts`). */
function timedPart<T>(parts: DiagStep[] | undefined, name: string, fn: () => T): T {
  if (!parts) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    parts.push({ name, ms: performance.now() - t0 });
  }
}

export function buildView(input: ViewInput): StateView {
  const { core, observed, registry, memo } = input;
  const journal = core.journal;
  const keys = core.foldKeys(observed);
  const stateKey = `${keys.state}\u0000${input.run.revision}\u0000${JSON.stringify(input.mapDisplay ?? null)}`;
  const chainKey = `${keys.steps.at(-1) ?? keys.root}\u0000${input.run.revision}\u0000${JSON.stringify(journal.pauses)}\u0000${JSON.stringify(journal.refused ?? [])}\u0000${input.depth}\u0000${input.beatTexts?.size ?? 0}`;
  const stateHit = memo.state?.key === stateKey ? memo.state : null;
  const chainHit = memo.chain?.key === chainKey ? memo.chain : null;
  // Folded only when a part kept doesn't stand for the chat as it is now.
  let fold: FoldOutput | null = null;
  const folded = (): FoldOutput => (fold ??= timedPart(input.parts, "fold", () => core.fold(observed)));
  const head = stateHit ? null : folded().state;
  const doc = head ? (input.world(head.revision) ?? input.world(input.run.revision)) : undefined;
  // The world as the head state plays it (ITEMS-SPEC §6.2): with the places it made, and the player
  // character the player last switched to as its point of view (D-10).
  const world = stateHit?.world ?? (head && doc ? withPov(playedWorld(doc, head), head) : undefined);
  if (!world) return notWorldView(input.chatId);
  // The palette and the controls are judged against what the next turn acts on: before the first
  // record, that includes the starting markers (the world's defaults, the user's settings filling
  // in), which the head fold doesn't hold yet; while a planned turn is in flight, its plan.
  const paletteKey = `${core.renderKey(observed, keys)}\u0000${stateKey}`;
  const controlsKey = (sceneType: string): string => `${paletteKey}\u0000${sceneType}\u0000${JSON.stringify(input.knowledge)}\u0000${JSON.stringify(input.offstage)}`;
  const paletteHit = memo.palette?.key === paletteKey ? memo.palette : null;
  const controlsHit = chainHit && memo.controls?.key === controlsKey(chainHit.scene.sceneType) ? memo.controls : null;
  let next: WorldState | null = null;
  const nextState = (): WorldState => (next ??= timedPart(input.parts, "render", () => core.renderState(observed, false, fold ?? undefined)?.state) ?? folded().state);
  if (!chainHit) folded();
  if (!paletteHit || !controlsHit) nextState();
  // Everything else only reads the folded states, many times over: one read pass (DESIGN §9.6).
  return readPass(() => {
    let parts = stateHit;
    if (!parts) {
      const state = folded().state;
      const ctx = registry.context(world, state);
      const panels: Record<PanelId, JsonValue> = {};
      const prefs = { mapDisplay: input.mapDisplay ?? null };
      for (const view of registry.views) {
        timedPart(input.parts, `panel:${view.panel}`, () => {
          try {
            panels[view.panel] = view.build(ctx, prefs);
          } catch (error) {
            panels[view.panel] = { error: error instanceof Error ? error.message : String(error) };
          }
        });
      }
      parts = memo.state = { key: stateKey, world, revision: state.revision, lag: definitionsLag(state), panels: kept(panels), hud: kept(timedPart(input.parts, "hud", () => hud(world, state, panels, ctx))) };
    }
    let read = chainHit;
    if (!read) {
      const out = folded();
      const state = out.state;
      const chain = core.chain(observed);
      const last = chain.findLast((m) => !m.isUser);
      const lastRec = last ? activeRecord(last, journal.tombstones) : null;
      const recordOf = (messageId: string): Rec | null => {
        const m = chain.find((x) => x.id === messageId);
        return m ? activeRecord(m, journal.tombstones) : null;
      };
      const drops = timedPart(input.parts, "drops", () => playerDrops(registry, world, state, recordOf, out.notes, out.keepReport));
      read = memo.chain = {
        key: chainKey,
        scene: kept(timedPart(input.parts, "scene", () => scene(world, state, lastRec ? clockMinutes(lastRec.events) : 0, registry))),
        chips: kept(timedPart(input.parts, "chips", () => derivedChips(chain, out, drops.keep, core, registry, world, input.depth, input.beatTexts ?? new Map()))),
        replyClocks: kept(timedPart(input.parts, "clocks", () => replyClocks(chain, out, core, world, state))),
        journal: kept([...timedPart(input.parts, "journal", () => turnNotes(chain, out, core, registry, world, state)), ...drops.notes]),
        keepReport: kept(drops.keep),
      };
    }
    const sceneType = read.scene.sceneType;
    const shownPalette = paletteHit ?? (memo.palette = { key: paletteKey, palette: kept(timedPart(input.parts, "palette", () => palette(world, nextState(), registry))) });
    const shownControls = controlsHit ?? (memo.controls = { key: controlsKey(sceneType), controls: kept(timedPart(input.parts, "controls", () => controls(world, nextState(), sceneType, registry, input.knowledge, input.offstage))) });
    const pending: PendingMark[] = journal.held.map((h) => ({ panel: "*", entity: h.write.kind === "post" ? povEntity(world) : null }));
    const packs: Record<PackId, number> = {};
    for (const pack of registry.packs) packs[pack.id] = pack.version;
    // A swipe's chips show only while that swipe is displayed (switching back shows them again).
    const shown = input.stored.filter((c) => c.swipeId === undefined || observed.find((m) => m.id === c.messageId)?.swipeId === c.swipeId);
    return {
      v: 1,
      chatId: input.chatId,
      worldId: input.run.worldId,
      revision: parts.revision,
      ...(parts.lag !== null ? { definitionsFrom: parts.lag } : {}),
      status: journal.pauses.length > 0 ? "paused" : core.inFlight ? "in_flight" : "idle",
      hud: parts.hud,
      scene: read.scene,
      chips: [...shown.map(({ payload: _payload, ...chip }) => chip), ...read.chips],
      replyClocks: read.replyClocks,
      journal: read.journal,
      keepReport: read.keepReport,
      pending,
      // A record of its own: the runtime adds the inspector's panel to it.
      panels: { ...parts.panels },
      palette: shownPalette.palette,
      controls: shownControls.controls,
      meter: input.meter,
      packs,
      currency: world.currency,
      // Moves only when what the GM view reads does (not on a status flip), so the GM page reloads on it alone.
      gmKey: gmKeyOf(core, observed, keys),
    };
  });
}

/** Each reply the engine ran, by its shown swipe, with the world's date and time once its turn folded, local to where the POV is now (as the HUD reads it). */
function replyClocks(chain: readonly ChainMessage[], fold: FoldOutput, core: LedgerCore, world: WorldDoc, state: Readonly<WorldState>): Record<string, string> {
  const cal = calendarOf(world);
  const place = placeOfEntity(state, world.pov);
  const out: Record<string, string> = {};
  chain.forEach((m, i) => {
    const clock = fold.messages[i]?.clock ?? null;
    if (m.isUser || clock === null || !activeRecord(m, core.journal.tombstones)) return;
    out[m.id] = formatClock(cal, clock, placeOffset(world, clock, place));
  });
  return out;
}

function povEntity(world: WorldDoc): EntityId {
  return world.pov;
}
