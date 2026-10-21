// The state view (ARCHITECTURE §4; DESIGN §12): everything the frontend renders for one chat,
// computed from the fold. Pack panels come from the registry's views (POV-filtered by the packs),
// drawn as the player chose to see the chat (the map's display); chips are the stored ones plus
// those derived from records (Re-read edit, Retry, Keep report).

import type { ChatId, EntityId, PackId, PanelId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { bandTiers } from "../shared/tiers";
import type { ChatRun, EventRef, HeldWrite, JournalNote, KeepLine, LedgerEvent, Rec } from "../shared/ledger";
import type { CallMeterView, Chip, ControlsView, HudView, PaletteEntry, PaletteOption, PaletteView, PendingMark, SceneView, StateView, TimelapseView } from "../shared/state-view";
import type { ActionDef, MapDisplay, WorldDoc } from "../shared/world";
import { tableChoices } from "../shared/tables";
import { routineSettingsOf } from "../shared/routines";
import { checkView, policyOf } from "../engine/adjudication";
import { calendarMonths, calendarOf, dayPartAt, formatClock, formatStamp, placeOffset } from "../engine/calendar";
import { ENGINE_EVENTS } from "../engine/engine-pack";
import { clockPaused, DEFAULT_SCENE_TYPE, ENGINE_SCENE_TYPES, placeSceneType, sceneType } from "../engine/time";
import { identifiers } from "../engine/expr";
import type { ChainMessage, FoldOutput } from "../engine/ledger/chain";
import type { LedgerCore } from "../engine/ledger/journal";
import { activeRecord, isLive, turnPath } from "../engine/ledger/path";
import { optionalQuery, own } from "../engine/pack-kit";
import { playerDrop, playerLines, UNSEEN_DROP } from "../engine/player-events";
import type { ReadContext } from "../engine/registry";
import { readPass } from "../engine/read-pass";
import { claimsOf, presetOf } from "../engine/realism";
import { inferredOf, worldSkills } from "../engine/inferred";
import { levelFloors, type Registry } from "../engine/registry-impl";
import { actionOdds, paramCandidates } from "../engine/resolve";
import { isGone, kindIs, placeOfEntity } from "../engine/scope";
import { povLife } from "../engine/life";
import type { WorldState } from "../engine/state";
import { definitionsLag } from "../engine/upgrade";
import { canSeeEntity, canSeePlace, findLeaks, povPlace, unrevealedTruths } from "../engine/visibility";
import { combatEntries, paletteEncounter } from "../packs/combat/core/index";
import type { StoredChip } from "./chips";

/** The palette's timelapse action; its params are `{target, overrides}`. */
export const TIMELAPSE_ACTION = "timelapse";

export function notWorldView(chatId: ChatId): StateView {
  return { v: 1, chatId, worldId: null, revision: null, status: "not_world", hud: null, scene: null, chips: [], journal: [], keepReport: [], pending: [], panels: {}, palette: null, controls: null, meter: null, packs: {}, currency: null };
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

/** A game-time span, compact: "45 min", "8 h 55 min", "3 d 4 h" (chip labels). */
export function compactSpan(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const rest = total % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
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
    // The ✎ offers the places the POV may see; a hidden one, even where it stands, is never offered.
    const options = Object.values(world.places).filter((p) => canSeePlace(ctx.registry, world, state, pov, p.id));
    fixes.place = { entity: pov, field: "place", type: "ref", value: shown?.id ?? null, options: options.map((p) => ({ value: p.id, label: p.name })) };
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

/** Why a palette option is off, for the player: an unmet requirement isn't spelled as its expression. */
function unavailable(failed: { code: string; reason: string } | null | undefined): string {
  if (!failed) return "Not available";
  return failed.code === "requirement" ? "Not possible here and now" : failed.reason;
}

/** A param's label for a palette step: its own, else its ref kind's ("Person"), else its name in words ("Days"). */
function paramLabel(action: ActionDef, name: string, world: WorldDoc, registry: Registry): string {
  const def = action.params[name];
  if (def?.label) return def.label;
  const kind = def?.ref ? (world.kinds[def.ref] ?? registry.kinds.get(def.ref)) : undefined;
  if (kind?.label) return kind.label;
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function palette(world: WorldDoc, state: WorldState, registry: Registry): PaletteView {
  const actions = new Map<string, ActionDef>();
  for (const [id, a] of registry.actions) actions.set(id, a);
  for (const [id, a] of Object.entries(world.actions)) actions.set(id, a);
  const entries: PaletteEntry[] = [];
  const ctx = registry.context(world, state);
  const retry = policyOf(world, state).retry;
  for (const action of actions.values()) {
    // Combat actions are the combat pack's Combat tab (below), and only where the world's ruleset has combat.
    if (action.id === TIMELAPSE_ACTION || action.combat) continue;
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
    // Take from a kit (gear): the pieces still in a kit are its second pick, with how many are left.
    const kitStatus = action.id === "take_piece" && action.params.piece?.type === "text" ? optionalQuery(ctx, "gear.kit_status") : undefined;
    const nameOf = (id: string): string => state.entities[id]?.name ?? world.places[id]?.name ?? id;
    // A number the action needs (Lend's days: optional only because a said end can stand in for it,
    // so a requirement reads it) gets an input pre-filled with 1, and a free amount (Pay, Invest) one
    // currency unit: options are judged with them, so a target isn't "needs amount".
    const numberParam = Object.entries(action.params).find(([name, p]) => p.type === "number" && (!p.optional || action.requires.some((req) => identifiers(req).includes(name))))?.[0];
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
        const seconds = paramCandidates(registry, world, state, action, secondParam).filter((id) => id !== target).slice(0, 12);
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
      options.push(pick(params, target ? nameOf(target) : action.label));
    }
    if (options.length === 0) continue;
    // Offers carry their price; a free amount would double it.
    entries.push({
      action: action.id,
      label: action.label,
      group: groupOf(action),
      options,
      ...(amountParam && offers.length === 0 ? { amount: { param: amountParam, min: 0, max: null } } : {}),
      ...(numberParam ? { number: { param: numberParam, label: paramLabel(action, numberParam, world, registry), min: 1, max: null, default: 1 } } : {}),
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

function controls(world: WorldDoc, state: WorldState, sceneType: string, registry: Registry): ControlsView {
  return {
    // The chat's own preset: a new chat may start from the user's settings, and This chat changes it.
    realism: { preset: presetOf(state.realism), levels: { ...state.realism.levels }, tierCaps: structuredClone(state.realism.tierCaps), bandTiers: bandTiers(world), floors: levelFloors(world), claims: claimsOf(world, state) },
    adjudication: policyOf(world, state),
    inferred: inferredOf(world, state),
    skills: worldSkills(registry, world, state),
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
  };
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

/** How a ✎ fix of the time moved the clock, in words ("Clock moved on 2 h 15 min", "Clock set back 3 h"); null for a fix that moved none. */
export function clockFixLine(events: readonly LedgerEvent[]): string | null {
  let minutes = clockMinutes(events);
  for (const e of events) if (e.type === ENGINE_EVENTS.rewind && "data" in e && typeof e.data.minutes === "number") minutes -= e.data.minutes;
  return minutes > 0 ? `Clock moved on ${compactSpan(minutes)}` : minutes < 0 ? `Clock set back ${compactSpan(-minutes)}` : null;
}

/**
 * A ✎ fix's or GM edit's lines, as its Corrected chip and its Journal line word them: how a fix of
 * the time moved the clock first, then the changes the POV may see (`turnLines`).
 */
export function fixLines(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, events: readonly LedgerEvent[]): string[] {
  const clock = clockFixLine(events);
  return [...(clock ? [clock] : []), ...turnLines(registry, world, state, events)];
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
 * line and Undo chip. The change chip and the Journal list these, so an undone purchase, or one an
 * earlier switch dropped, isn't shown as made.
 */
export function appliedEvents(rec: Rec, fold: FoldOutput, index: number): { events: LedgerEvent[]; post: LedgerEvent[]; fixes: { seq: number; events: LedgerEvent[] }[] } {
  const result = fold.messages[index];
  // A bare record folds as a plain message, and its live entries apply all the same.
  if (!result || (result.fold !== "on_path" && result.fold !== "view" && result.fold !== "plain")) return { events: [], post: [], fixes: [] };
  const skipped = new Set(rec.undone.map(refKey));
  for (const n of fold.notes) if (n.kind === "dropped" && n.messageId === result.id && n.ref && "in" in n.ref) skipped.add(refKey(n.ref));
  const recPath = turnPath(rec);
  const live = rec.post
    .filter((p) => isLive(p.at, result.parentPath, recPath))
    .sort((a, b) => a.seq - b.seq)
    .map((p) => ({ seq: p.seq, kind: p.kind, events: p.events.filter((_, i) => !skipped.has(refKey({ in: "post", seq: p.seq, index: i }))) }));
  return {
    events: rec.events.filter((_, i) => !skipped.has(refKey({ in: "events", index: i }))),
    post: live.filter((p) => p.kind !== "fix").flatMap((p) => p.events),
    fixes: live.filter((p) => p.kind === "fix" && p.events.length > 0).map((p) => ({ seq: p.seq, events: p.events })),
  };
}

/**
 * The Journal's turn entries: what each folded turn applied, in player-facing lines (only events
 * the POV may see, about things it has met, worded with labels, leak-checked). They are `note`
 * entries, each followed by a `fix` note per ✎ fix or GM edit the player may see; the fold's own
 * notes follow them.
 */
function turnNotes(chain: readonly ChainMessage[], fold: FoldOutput, core: LedgerCore, registry: Registry, world: WorldDoc, state: WorldState): JournalNote[] {
  const out: JournalNote[] = [];
  chain.forEach((m, i) => {
    if (m.isUser) return;
    const rec = activeRecord(m, core.journal.tombstones);
    if (!rec) return;
    const applied = appliedEvents(rec, fold, i);
    const lines = turnLines(registry, world, state, [...applied.events, ...applied.post]);
    const minutes = clockMinutes(rec.events);
    if (minutes > 0 && fold.messages[i]?.fold !== "plain") lines.push(`${spanText(minutes)} passed`);
    if (lines.length > 0) out.push({ kind: "note", messageId: m.id, ref: null, text: lines.join(" · ") });
    for (const fix of applied.fixes) {
      const fixed = fixLines(registry, world, state, fix.events);
      if (fixed.length > 0) out.push({ kind: "fix", messageId: m.id, ref: { in: "post", seq: fix.seq, index: 0 }, text: fixed.join(" · ") });
    }
  });
  return out.slice(-JOURNAL_TURNS);
}

/** Turns `{{recent}}` holds (DESIGN §5.2). */
const RECENT_TURNS = 5;

/**
 * `{{recent}}` for a model step (DESIGN §5.2): the Journal's latest turn lines before `index` in the
 * chain, oldest first, as the player sees them at that point (worded and filtered by `turnNotes`
 * against the state there, so nothing the POV hadn't seen by then).
 */
export function recentLines(core: LedgerCore, observed: readonly ChainMessage[], index: number, registry: Registry): string[] {
  const prefix = observed.slice(0, Math.max(0, index));
  const fold = core.fold(prefix);
  const world = core.worldAt(fold.state.revision);
  if (!world) return [];
  return turnNotes(core.chain(prefix), fold, core, registry, world, fold.state)
    .slice(-RECENT_TURNS)
    .map((n) => n.text);
}

/** A game-time span in words: "45 min", "2.5 hours", "30 days". */
export function spanText(minutes: number): string {
  if (minutes >= 1440) return `${Math.round((minutes / 1440) * 10) / 10} ${minutes === 1440 ? "day" : "days"}`;
  if (minutes >= 60) return `${Math.round((minutes / 60) * 10) / 10} ${minutes === 60 ? "hour" : "hours"}`;
  return `${minutes} min`;
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

/** Chips derived from the records: Re-read edit, Retry read, Retry (empty reply), degraded, Keep report, what changed, elapsed, overdue, a correction's Undo, a refused write's notice. */
function derivedChips(chain: readonly ChainMessage[], fold: FoldOutput, keepReport: readonly KeepLine[], core: LedgerCore, registry: Registry, world: WorldDoc): Chip[] {
  const chips: Chip[] = [];
  const headIndex = chain.findLastIndex((m) => !m.isUser);
  chain.forEach((m, i) => {
    if (m.isUser) return;
    const rec: Rec | null = activeRecord(m, core.journal.tombstones);
    if (!rec) return;
    const fold_ = fold.messages[i]?.fold;
    if (rec.accepted && (fold_ === "on_path" || fold_ === "plain")) {
      chips.push({ id: `reread:${m.id}:${m.swipeId}`, kind: "reread", messageId: m.id, label: "Re-read edit", detail: "The engine kept the world as simulated. Re-read this text to update it.", actions: [{ id: "reread", label: "Re-read edit", style: "primary" }], expires: "never" });
    }
    if (i !== headIndex) return;
    const text = m.swipes[m.swipeId] ?? "";
    // A record read elsewhere never folds as stored, so a read of it is always refused: no chip leads there.
    if (rec.status === "stopped" && !rec.readElsewhere) chips.push({ id: `retry_read:${m.id}:${m.swipeId}`, kind: "retry_read", messageId: m.id, label: "Retry read", detail: "The reply stopped early; read what was saved.", actions: [{ id: "retry_read", label: "Retry read" }], expires: "never" });
    if (rec.status === "degraded" && text.trim() === "") chips.push({ id: `retry:${m.id}:${m.swipeId}`, kind: "retry", messageId: m.id, label: "Retry", detail: "The narrator returned an empty reply.", actions: [{ id: "regenerate", label: "Retry", style: "primary" }], expires: "next_send" });
    else if (rec.status === "degraded") chips.push({ id: `degraded:${m.id}:${m.swipeId}`, kind: "degraded", messageId: m.id, label: "Not fully simulated", detail: "Part of this turn ran engine-only.", actions: [], expires: "next_send" });
    const minutes = clockMinutes(rec.events);
    if (minutes > 0) chips.push({ id: `elapsed:${m.id}:${m.swipeId}`, kind: "elapsed", messageId: m.id, label: minutes >= 60 ? `+${Math.floor(minutes / 60)} h ${minutes % 60} min` : `+${minutes} min`, actions: [], expires: "next_send" });
    // Re-narrate/Re-run (P3, §12): the choice sets the next swipe's mode, then the UI swipes.
    if (rec.seed !== "" && rec.path !== "") chips.push({ id: `swipe_option:${m.id}:${m.swipeId}`, kind: "swipe_option", messageId: m.id, label: "Swipe as…", detail: "Re-narrate keeps this turn's outcome and rewrites the prose; Re-run rolls the turn again.", actions: [{ id: "renarrate", label: "Re-narrate" }, { id: "rerun", label: "Re-run" }], expires: "next_send" });
    const state = fold.state;
    const ctx = registry.context(world, state);
    const applied = appliedEvents(rec, fold, i);
    const lines = turnLines(registry, world, state, applied.events);
    // One change: the label says it all; several: "N changes" with the list as detail.
    if (lines.length > 0) chips.push({ id: `change:${m.id}:${m.swipeId}`, kind: "change", messageId: m.id, label: lines.length === 1 ? (lines[0] ?? "Changed") : `${lines.length} changes`, ...(lines.length > 1 ? { detail: lines.join("\n") } : {}), actions: [], expires: "next_send" });
    // Each ✎ fix or GM edit on the head: "Corrected …" with Undo, worded for the player (DESIGN §12).
    for (const fix of applied.fixes) {
      const fixed = fixLines(registry, world, state, fix.events);
      chips.push({ id: `fix:${m.id}:${m.swipeId}:${fix.seq}`, kind: "fix", messageId: m.id, label: "Corrected", detail: fixed.length > 0 ? fixed.join(" · ") : "something you haven't come across", actions: [{ id: "undo", label: "Undo", style: "danger" }], expires: "next_send" });
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
  // A write held during a reply that no longer applied once it finished (P2): told, never silent.
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
}

export function buildView(input: ViewInput): StateView {
  const { core, observed, registry } = input;
  const chain = core.chain(observed);
  const fold = core.fold(observed);
  const state = fold.state;
  const world = input.world(state.revision) ?? input.world(input.run.revision);
  if (!world) return notWorldView(input.chatId);
  // Judged against what the next turn acts on: before the first record, that includes the starting
  // markers (the world's defaults, the user's settings filling in), which the head fold doesn't hold yet.
  const next = core.renderState(observed)?.state ?? state;
  // Everything else only reads the folded states, many times over: one read pass (DESIGN §9.6).
  return readPass(() => {
    const ctx = registry.context(world, state);
    const panels: Record<PanelId, JsonValue> = {};
    const prefs = { mapDisplay: input.mapDisplay ?? null };
    for (const view of registry.views) {
      try {
        panels[view.panel] = view.build(ctx, prefs);
      } catch (error) {
        panels[view.panel] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    const head = chain.findLast((m) => !m.isUser);
    const headRec = head ? activeRecord(head, core.journal.tombstones) : null;
    const sceneView = scene(world, state, headRec ? clockMinutes(headRec.events) : 0, registry);
    const pending: PendingMark[] = core.journal.held.map((h) => ({ panel: "*", entity: h.write.kind === "post" ? povEntity(world) : null }));
    const packs: Record<PackId, number> = {};
    for (const pack of registry.packs) packs[pack.id] = pack.version;
    // A swipe's chips show only while that swipe is displayed (switching back shows them again).
    const shown = input.stored.filter((c) => c.swipeId === undefined || chain.find((m) => m.id === c.messageId)?.swipeId === c.swipeId);
    const recordOf = (messageId: string): Rec | null => {
      const m = chain.find((x) => x.id === messageId);
      return m ? activeRecord(m, core.journal.tombstones) : null;
    };
    const drops = playerDrops(registry, world, state, recordOf, fold.notes, fold.keepReport);
    const chips: Chip[] = [...shown.map(({ payload: _payload, ...chip }) => chip), ...derivedChips(chain, fold, drops.keep, core, registry, world)];
    const lag = definitionsLag(state);
    return {
      v: 1,
      chatId: input.chatId,
      worldId: input.run.worldId,
      revision: state.revision,
      ...(lag !== null ? { definitionsFrom: lag } : {}),
      status: core.journal.pauses.length > 0 ? "paused" : core.inFlight ? "in_flight" : "idle",
      hud: hud(world, state, panels, ctx),
      scene: sceneView,
      chips,
      journal: [...turnNotes(chain, fold, core, registry, world, state), ...drops.notes],
      keepReport: drops.keep,
      pending,
      panels,
      palette: palette(world, next, registry),
      controls: controls(world, next, sceneView.sceneType, registry),
      meter: input.meter,
      packs,
      currency: world.currency,
    };
  });
}

function povEntity(world: WorldDoc): EntityId {
  return world.pov;
}
