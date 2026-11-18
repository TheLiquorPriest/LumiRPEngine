// Weather pack (DESIGN §9.3): a climate per region. Each region entity steps once per slot with its
// process seed: it keeps its state with the climate's persistence, else draws from the season's
// weights. Weather is reproducible and identical whatever the segmentation of the time that passes.
//
// Climates use the template shape (`packs.weather.config.climates`, keyed by `id` or `region`):
// `{label, states: [{id, label, effects: {travelTimeMultiplier: {mode: x}, closes: [mode]}}],
//   seasons: [{label, months: [1..12], weights: {state: w}, tempC: [lo, hi]}], persist?}`.
// A region entity names its climate in `climate` (built-ins: temperate, tropical, cold).
//
// Level contract (domain `weather`, read at the POV):
//   0  off
//   1  season mood only (no simulation)
//   2  climate states for the POV's region
//   3  regional climates: every region steps; temperatures
//   4  effects: travel-time multipliers, closed travel modes and weather alerts (interrupt class `weather`)

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId, PlaceId } from "../../../shared/ids";
import type { FieldFixTarget } from "../../../shared/state-view";
import type { LedgerEvent } from "../../../shared/ledger";
import type { KindDef } from "../../../shared/world";
import { formatTemperature } from "../../../shared/world";
import { chatDraftOf, draftEvent } from "../../../engine/world-draft";
import { baseWorld } from "../../../engine/places-in-play";
import { calendarOf, dateAt, dayPartAt } from "../../../engine/calendar";
import { ENGINE_EVENTS } from "../../../engine/engine-pack";
import { signalOf } from "../../../engine/notices";
import { labelOf, numOf, objOf, strOf, own } from "../../../engine/pack-kit";
import type { PackDef, ReadContext, Rejection } from "../../../engine/registry";
import type { Rng } from "../../../engine/rng";
import { evalExpr, kindIs, placeOfEntity, scopeEnv, truthy } from "../../../engine/scope";
import { passMemo } from "../../../engine/read-pass";
import { say, orOf } from "../../../shared/lines";

export type Season = "winter" | "spring" | "summer" | "autumn";

export interface ClimateState {
  id: string;
  label: string;
  /** Travel-time multiplier per travel mode (Weather level 4). */
  travel: Record<string, number>;
  /** Travel modes closed while this state holds (Weather level 4). */
  closes: string[];
}

export interface ClimateSeason {
  label: string;
  /** Calendar months (1-based) this season covers. */
  months: number[];
  weights: Record<string, number>;
  temp: [number, number];
}

export interface Climate {
  label: string;
  states: ClimateState[];
  seasons: ClimateSeason[];
  /** Chance per slot that the current state holds before a fresh draw. */
  persist: number;
}

/** Default persistence: weather changes on about a third of slots. */
export const DEFAULT_PERSIST = 0.7;

const state = (id: string, label: string, factor: number, closes: string[] = []): ClimateState => ({ id, label, travel: factor === 1 ? {} : { walk: factor, road: factor, offroad: factor, water: factor }, closes });
const BASE_STATES: ClimateState[] = [state("clear", "Clear", 1), state("cloudy", "Overcast", 1), state("rain", "Rain", 1.15), state("storm", "A storm", 1.6, ["water"]), state("fog", "Fog", 1.2), state("snow", "Snow", 1.5)];

/** Built-in climates in the template shape; worlds add their own under `packs.weather.config.climates`. */
export const CLIMATES: Record<string, Climate> = {
  temperate: {
    label: "Temperate",
    states: BASE_STATES,
    persist: DEFAULT_PERSIST,
    seasons: [
      { label: "Winter", months: [12, 1, 2], weights: { clear: 25, cloudy: 35, snow: 25, rain: 5, fog: 7, storm: 3 }, temp: [-6, 4] },
      { label: "Spring", months: [3, 4, 5], weights: { clear: 35, cloudy: 30, rain: 25, storm: 3, fog: 5, snow: 2 }, temp: [4, 17] },
      { label: "Summer", months: [6, 7, 8], weights: { clear: 55, cloudy: 22, rain: 13, storm: 7, fog: 3 }, temp: [16, 29] },
      { label: "Autumn", months: [9, 10, 11], weights: { clear: 30, cloudy: 35, rain: 25, storm: 3, fog: 6, snow: 1 }, temp: [4, 16] },
    ],
  },
  tropical: {
    label: "Tropical",
    states: BASE_STATES,
    persist: DEFAULT_PERSIST,
    seasons: [
      { label: "Dry", months: [12, 1, 2, 3, 4], weights: { clear: 60, cloudy: 25, rain: 12, storm: 3 }, temp: [22, 31] },
      { label: "Wet", months: [5, 6, 7, 8, 9, 10, 11], weights: { clear: 30, cloudy: 25, rain: 33, storm: 12 }, temp: [24, 32] },
    ],
  },
  cold: {
    label: "Cold",
    states: BASE_STATES,
    persist: DEFAULT_PERSIST,
    seasons: [
      { label: "Winter", months: [11, 12, 1, 2, 3], weights: { clear: 25, cloudy: 30, snow: 35, storm: 7, fog: 3 }, temp: [-22, -8] },
      { label: "Spring", months: [4, 5], weights: { clear: 30, cloudy: 30, snow: 15, rain: 20, fog: 5 }, temp: [-5, 8] },
      { label: "Summer", months: [6, 7, 8], weights: { clear: 40, cloudy: 30, rain: 25, fog: 5 }, temp: [6, 19] },
      { label: "Autumn", months: [9, 10], weights: { clear: 25, cloudy: 35, snow: 15, rain: 20, fog: 5 }, temp: [-6, 6] },
    ],
  },
};

/** A season as a phrase (the lines `feed_mood_*`). */
const mood = (season: Season): string => say(`feed_mood_${season}`);

export const REGION: KindDef = {
  id: "region",
  label: "Weather region",
  pack: "weather",
  fields: {
    climate: { type: "text", label: "Climate", default: "temperate" },
    weather: { type: "text", label: "Weather", default: "clear", domain: "weather", level: 2, bound: { mode: "never" } },
    temp_c: { type: "number", label: "Temperature (°C)", domain: "weather", level: 3, bound: { mode: "never" } },
    weather_hold: { type: "number", label: "Weather held until", domain: "weather", level: 2, locked: true },
    weather_hold_until: { type: "text", label: "Weather held until (condition)", domain: "weather", level: 2, locked: true },
  },
};

export interface WeatherView {
  level: number;
  /** "Light rain, 54 °F" (level 1: the season's mood); the world keeps °C, the player reads °F. */
  label: string;
  region: string | null;
  season: Season;
  /** The climate state id (`clear`, `gale`, …), or null below level 2. */
  sky: string | null;
  tempC: number | null;
  /** Travel modes closed by the weather (level 4). */
  closed: string[];
}

declare module "../../../engine/registry" {
  interface QueryMap {
    /** Travel-time multiplier for a mode at a place from its region's weather (1 below Weather level 4). */
    "weather.travel_factor": (ctx: ReadContext, place: PlaceId, mode: string) => number;
    /** Travel modes the weather closes at a place (none below Weather level 4). */
    "weather.closed_modes": (ctx: ReadContext, place: PlaceId) => string[];
    /** The weather state over a place's region, or null when weather isn't simulated there. */
    "weather.sky": (ctx: ReadContext, place: PlaceId) => string | null;
    /**
     * The HUD's ✎ weather fix: the `weather` field of the region over the player, with its climate's
     * states as options; null below Weather 2 (no simulated state to correct) or without a region.
     */
    "weather.fix": (ctx: ReadContext) => FieldFixTarget | null;
    /** The season at a time (the calendar's month), or null with Weather off: the day planner's occasions read it (DESIGN §24.8). */
    "weather.season": (ctx: ReadContext, at: number) => Season | null;
    /** Whether the sky over a place keeps people in (its state slows or closes travel), or null below Weather 2 (DESIGN §24.8). */
    "weather.foul": (ctx: ReadContext, place: PlaceId) => boolean | null;
  }
}

export function seasonAt(ctx: Pick<ReadContext, "world" | "state">, clock = ctx.state.clock): Season {
  const cal = calendarOf(ctx.world);
  const d = dateAt(cal, clock);
  const months = ctx.world.calendar.system === "custom" ? Math.max(1, ctx.world.calendar.custom?.monthLengths.length ?? 12) : 12;
  const m = Math.floor(((d.month - 1) * 12) / months);
  return m === 11 || m <= 1 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "autumn";
}

/** A climate from the template shape. */
export function parseClimate(raw: JsonObject): Climate {
  const states: ClimateState[] = (Array.isArray(raw.states) ? raw.states : []).map((s) => {
    const o = objOf(s);
    const effects = objOf(o.effects);
    const travel: Record<string, number> = {};
    for (const [mode, x] of Object.entries(objOf(effects.travelTimeMultiplier))) if (typeof x === "number") travel[mode] = x;
    const closes = Array.isArray(effects.closes) ? effects.closes.filter((m): m is string => typeof m === "string") : [];
    return { id: strOf(o.id), label: strOf(o.label, strOf(o.id)), travel, closes };
  });
  const seasons: ClimateSeason[] = (Array.isArray(raw.seasons) ? raw.seasons : []).map((s) => {
    const o = objOf(s);
    const weights: Record<string, number> = {};
    for (const [k, w] of Object.entries(objOf(o.weights))) if (typeof w === "number" && w > 0) weights[k] = w;
    const t = Array.isArray(o.tempC) ? o.tempC : [];
    return { label: strOf(o.label), months: Array.isArray(o.months) ? o.months.filter((m): m is number => typeof m === "number") : [], weights, temp: [numOf(t[0], 10), numOf(t[1], 20)] };
  });
  return { label: strOf(raw.label, "Climate"), states, seasons, persist: numOf(raw.persist, DEFAULT_PERSIST) };
}

/** Each authored climate as parsed, beside the world's own record of it: a world's records never change, so each is parsed once. */
const parsedClimates = new WeakMap<JsonObject, Climate>();

export function climateOf(ctx: Pick<ReadContext, "world" | "state">, region: EntityId): Climate {
  const id = strOf(own(ctx.state.entities, region)?.fields.climate, "temperate");
  const custom = ctx.world.packs.weather?.config.climates;
  const authored = Array.isArray(custom) ? custom.map((c) => objOf(c)).find((c) => strOf(c.id, strOf(c.region)) === id) : undefined;
  if (!authored) return own(CLIMATES, id) ?? (CLIMATES.temperate as Climate);
  let climate = parsedClimates.get(authored);
  if (!climate) {
    climate = parseClimate(authored);
    parsedClimates.set(authored, climate);
  }
  return climate;
}

function climateSeason(climate: Climate, month: number): ClimateSeason | null {
  return climate.seasons.find((s) => s.months.includes(month)) ?? climate.seasons[0] ?? null;
}

/** The region over a place: its `region` field or an ancestor's, else the first region entity. Kept for the read pass, as a travel search asks it of every place. */
export function regionOf(ctx: Pick<ReadContext, "world" | "state" | "registry">, place: PlaceId | null): EntityId | null {
  return passMemo([ctx.state, ctx.state.entities, ctx.world], `weather.region\u0000${place ?? "\u0001"}`, () => {
    let cur = place ?? undefined;
    for (let guard = 0; cur && guard < 32; guard++) {
      const r = own(ctx.world.places, cur)?.fields.region;
      if (typeof r === "string" && own(ctx.state.entities, r)) return r;
      cur = own(ctx.world.places, cur)?.parent;
    }
    return passMemo([ctx.state, ctx.state.entities, ctx.world], "weather.region", () => Object.keys(ctx.state.entities).sort().find((id) => kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "region")) ?? null);
  });
}

/** The region a place says is its own: its `region` field or an ancestor's, with no default after it; null when none does. */
export function ownRegionOf(ctx: Pick<ReadContext, "world" | "state">, place: PlaceId | null): EntityId | null {
  let cur = place ?? undefined;
  for (let guard = 0; cur && guard < 32; guard++) {
    const r = own(ctx.world.places, cur)?.fields.region;
    if (typeof r === "string" && own(ctx.state.entities, r)) return r;
    cur = own(ctx.world.places, cur)?.parent;
  }
  return null;
}

/** The weather a place has of its own, else that of the nearest place above it that has its own: a climate state's id; null when none up the line says any. */
export function placeWeatherAt(ctx: Pick<ReadContext, "world">, place: PlaceId | null): string | null {
  let cur = place ?? undefined;
  for (let guard = 0; cur && guard < 32; guard++) {
    const def = own(ctx.world.places, cur);
    const said = def?.fields.weather;
    if (typeof said === "string" && said !== "") return said;
    cur = def?.parent;
  }
  return null;
}

/**
 * What a weather call's target comes to: the region entity whose weather it sets or clears (one named, the one a place says is its own, or
 * the world's first for the world itself), and the place named when it is one. A place with no region of its own has none: the weather is
 * kept on the place itself. `states` are the climate's there, the world's first region's (else the temperate one) for a place with none.
 */
export function weatherTarget(ctx: Pick<ReadContext, "world" | "state" | "registry">, target: string): { region: EntityId | null; place: PlaceId | null; states: ClimateState[] } {
  const place = own(ctx.world.places, target) ? target : null;
  const region = own(ctx.state.entities, target) ? target : place !== null ? ownRegionOf(ctx, place) : regionOf(ctx, null);
  const climateRegion = region ?? (place !== null ? regionOf(ctx, place) : null);
  return { region, place, states: (climateRegion !== null ? climateOf(ctx, climateRegion) : (CLIMATES.temperate as Climate)).states };
}

/** The state the season most likely gives that closes and slows nothing, from the region's own climate table; none when the climate lists none. */
export function calmStateOf(ctx: Pick<ReadContext, "world" | "state">, region: EntityId): string | undefined {
  const climate = climateOf(ctx, region);
  const season = climateSeason(climate, dateAt(calendarOf(ctx.world), ctx.state.clock).month);
  const calm = climate.states.filter((s) => s.closes.length === 0 && Object.keys(s.travel).length === 0).map((s) => s.id);
  return Object.entries(season?.weights ?? {}).filter(([id]) => calm.includes(id)).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? calm[0];
}

/** The current climate state over a place: its own weather's, else the nearest place above it that has its own, else its region's, with its effects; null when there is none. */
export function stateAt(ctx: ReadContext, place: PlaceId | null): ClimateState | null {
  return passMemo([ctx.state, ctx.state.entities, ctx.world], `weather.state\u0000${place ?? "\u0001"}`, () => {
    const region = regionOf(ctx, place);
    const placed = placeWeatherAt(ctx, place);
    if (!region && placed === null) return null;
    const id = placed ?? strOf(own(ctx.state.entities, region ?? "")?.fields.weather);
    return (region ? climateOf(ctx, region) : (CLIMATES.temperate as Climate)).states.find((s) => s.id === id) ?? null;
  });
}

export function buildWeatherView(ctx: ReadContext): WeatherView {
  const level = ctx.levelOf(ctx.world.pov, "weather");
  const season = seasonAt(ctx);
  const here = placeOfEntity(ctx.state, ctx.world.pov);
  const region = regionOf(ctx, here);
  const e = region ? own(ctx.state.entities, region) : undefined;
  const placed = level >= 2 ? placeWeatherAt(ctx, here) : null;
  const name = e?.name ?? (placed !== null ? (own(ctx.world.places, here ?? "")?.name ?? null) : null);
  if (level <= 1 || (!e && placed === null)) return { level, label: level === 0 ? "" : mood(season), region: name, season, sky: null, tempC: null, closed: [] };
  const st = stateAt(ctx, here);
  const sky = placed ?? strOf(e?.fields.weather, "clear");
  const heat = e?.fields.temp_c;
  const raw = level >= 3 && typeof heat === "number" ? heat : null;
  const temp = raw === null ? null : Math.round(raw);
  const word = st?.label ?? sky;
  return { level, label: `${word.charAt(0).toUpperCase()}${word.slice(1)}${raw !== null ? `, ${formatTemperature(raw)}` : ""}`, region: name, season, sky, tempC: temp, closed: level >= 4 ? (st?.closes ?? []) : [] };
}

function stepRegions(slot: { start: number }, ctx: ReadContext, rng: (entity: EntityId) => Rng): LedgerEvent[] {
  const level = ctx.levelOf(ctx.world.pov, "weather");
  const home = regionOf(ctx, placeOfEntity(ctx.state, ctx.world.pov));
  const out: LedgerEvent[] = [];
  const cal = calendarOf(ctx.world);
  const month = dateAt(cal, slot.start).month;
  const part = dayPartAt(cal, slot.start).id;
  for (const id of Object.keys(ctx.state.entities).sort()) {
    const e = own(ctx.state.entities, id);
    if (!e || !kindIs(ctx.registry, ctx.world, e.kind, "region")) continue;
    if (level < 3 && id !== home) continue;
    const g = rng(id);
    const climate = climateOf(ctx, id);
    const season = climateSeason(climate, month);
    if (!season) continue;
    const cur = strOf(e.fields.weather, "clear");
    // A scripted state holds until its time passes or its `until` condition comes true (then the climate takes over).
    const until = strOf(e.fields.weather_hold_until);
    const ends = until !== "" && truthy(evalExpr(until, scopeEnv({ reg: ctx.registry, ctx, bindings: {} }), false));
    if (ends) out.push({ type: "set", entity: id, field: "weather_hold_until", value: "" }, { type: "set", entity: id, field: "weather_hold", value: 0 });
    const held = !ends && (numOf(e.fields.weather_hold, -Infinity) > slot.start || until !== "");
    const keep = g.next() < climate.persist && (own(season.weights, cur) ?? 0) > 0;
    const options = Object.entries(season.weights).map(([value, weight]) => ({ value, weight }));
    const next = held || keep || options.length === 0 ? cur : g.weighted(options);
    if (next !== cur) out.push({ type: "set", entity: id, field: "weather", value: next });
    if (level >= 3) {
      const [lo, hi] = season.temp;
      const warm = part === "afternoon" ? 1 : part === "morning" || part === "evening" ? 0.55 : 0.1;
      const st = climate.states.find((s) => s.id === next);
      const wet = st && (st.closes.length > 0 || Object.keys(st.travel).length > 0) ? -2 : 0;
      const t = Math.round((lo + (hi - lo) * warm + wet + (g.next() * 4 - 2)) * 10) / 10;
      if (t !== numOf(e.fields.temp_c, NaN)) out.push({ type: "set", entity: id, field: "temp_c", value: t });
    }
    const st = climate.states.find((s) => s.id === next);
    if (level >= 4 && next !== cur && st && st.closes.length > 0) out.push(...signalOf("weather", "weather_closes", { state: st.label, place: e.name, closes: st.closes.join(", ") }));
  }
  return out;
}

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/** A place's own weather written (a state, or none to take it off), as the chat's own draft of the place carries it, the way `set` writes a place's value. */
function placeWeather(ctx: Pick<ReadContext, "world" | "state">, place: PlaceId, state: string): LedgerEvent {
  const def = own(ctx.world.places, place);
  const fields: JsonObject = { ...(def?.fields ?? {}) };
  if (state === "") delete fields.weather;
  else fields.weather = state;
  return draftEvent(baseWorld(ctx.world), chatDraftOf(ctx.state), { collection: "places", id: place, value: { ...(def as unknown as JsonObject), fields } });
}

export const weatherPack: PackDef = {
  id: "weather",
  label: "Weather",
  version: 1,
  domain: "weather",
  requires: ["space"],
  register(r) {
    r.kind(REGION);
    r.query("weather.sky", (ctx, place) => {
      if (ctx.levelOf(ctx.world.pov, "weather") < 2) return null;
      const placed = placeWeatherAt(ctx, place);
      if (placed !== null) return placed;
      const region = regionOf(ctx, place);
      return region ? strOf(own(ctx.state.entities, region)?.fields.weather) || null : null;
    });
    r.query("weather.travel_factor", (ctx, place, mode) => (ctx.levelOf(ctx.world.pov, "weather") < 4 ? 1 : (own(stateAt(ctx, place)?.travel ?? {}, mode) ?? 1)));
    r.query("weather.closed_modes", (ctx, place) => (ctx.levelOf(ctx.world.pov, "weather") < 4 ? [] : (stateAt(ctx, place)?.closes ?? [])));
    r.query("weather.season", (ctx, at) => (ctx.levelOf(ctx.world.pov, "weather") < 1 ? null : seasonAt(ctx, at)));
    // The test the temperature reads as wet: any travel effect at all, whatever the level shows of it.
    r.query("weather.foul", (ctx, place) => {
      if (ctx.levelOf(ctx.world.pov, "weather") < 2) return null;
      const st = stateAt(ctx, place);
      return st ? st.closes.length > 0 || Object.keys(st.travel).length > 0 : null;
    });
    // A fix is a plain `set` on the region, so it holds until the climate's own step next changes the
    // sky (each slot keeps it with the climate's persistence); under a scripted hold, until that ends.
    r.query("weather.fix", (ctx) => {
      if (ctx.levelOf(ctx.world.pov, "weather") < 2) return null;
      const region = regionOf(ctx, placeOfEntity(ctx.state, ctx.world.pov));
      if (!region) return null;
      return { entity: region, field: "weather", type: "text", value: strOf(own(ctx.state.entities, region)?.fields.weather, "clear"), options: climateOf(ctx, region).states.map((s) => ({ value: s.id, label: s.label })) };
    });
    r.formula("weather", (ctx, place) => {
      const at = typeof place === "string" && place !== "" ? place : placeOfEntity(ctx.state, ctx.world.pov);
      const placed = placeWeatherAt(ctx, at);
      if (placed !== null) return placed;
      const region = regionOf(ctx, at);
      return region ? strOf(own(ctx.state.entities, region)?.fields.weather, "clear") : "";
    });
    r.formula("season", (ctx) => seasonAt(ctx));

    // Scripted weather (template `set_weather`): the region (an entity, or one a place says is its own) takes the
    // state, held for `minutes` and/or `until` a condition (an Expr) comes true. A place with no region of its own
    // keeps the weather itself, as its own value; any state the call names is kept as named.
    r.effect({
      type: "weather.set",
      args: ["region", "state", "minutes?", "until?"],
      resolve(a, ctx) {
        const target = strOf(a.region);
        const { region, place } = weatherTarget(ctx, target);
        const st = strOf(a.state);
        if (st === "") return reject("bad_args", say("why_weather_set_needs_a_state"));
        const out: LedgerEvent[] = [];
        if (place !== null && (region === null || own(ctx.world.places, place)?.fields.weather !== undefined)) out.push(placeWeather(ctx, place, st));
        if (region !== null) {
          out.push({ type: "set", entity: region, field: "weather", value: st });
          if (typeof a.minutes === "number" && a.minutes > 0) out.push({ type: "set", entity: region, field: "weather_hold", value: ctx.state.clock + Math.round(a.minutes) });
          if (typeof a.until === "string" && a.until.trim() !== "") out.push({ type: "set", entity: region, field: "weather_hold_until", value: a.until });
        }
        return out.length > 0 ? out : reject("missing_region", say("why_no_weather_region_for_target", { target: labelOf(ctx, target) }));
      },
    });
    // Ends a scripted state now (a rule's `clear`): the hold lifts, the sky turns to `state` when one is given and stays as it was
    // when none is (a caller that wants a state picks it). A place's own weather is taken off, so it takes its parents' again.
    r.effect({
      type: "weather.clear",
      args: ["region", "state?"],
      resolve(a, ctx) {
        const target = strOf(a.region);
        const { region, place } = weatherTarget(ctx, target);
        const st = strOf(a.state);
        const out: LedgerEvent[] = [];
        if (place !== null && own(ctx.world.places, place)?.fields.weather !== undefined) out.push(placeWeather(ctx, place, st));
        if (region !== null) {
          if (st !== "") out.push({ type: "set", entity: region, field: "weather", value: st });
          out.push({ type: "set", entity: region, field: "weather_hold", value: 0 }, { type: "set", entity: region, field: "weather_hold_until", value: "" });
        }
        if (out.length > 0) return out;
        return place !== null ? reject("no_change", say("why_place_has_no_weather_of_its_own", { place: labelOf(ctx, place) })) : reject("missing_region", say("why_no_weather_region_for_target", { target: labelOf(ctx, target) }));
      },
    });

    r.process({ id: "weather.climate", domain: "weather", minLevel: 2, step: (slot, ctx, rng) => stepRegions(slot, ctx, rng) });

    r.renderer({
      slot: "scene",
      // A section's `include` picks it by this name (DESIGN §6.11).
      source: "weather",
      label: "The weather",
      render(ctx) {
        const v = buildWeatherView(ctx);
        if (v.level === 0 || v.label === "") return [];
        if (v.level === 1) return [say("feed_season_label", { label: v.label })];
        return [say("feed_weather_closed", { weather: v.label.toLowerCase(), closed: v.closed.length > 0 ? orOf(v.closed) : undefined })];
      },
    });
    r.view({ panel: "weather.now", build: (ctx) => buildWeatherView(ctx) as unknown as JsonValue });

    r.lint({
      code: "weather.climates",
      check(world) {
        const issues = [];
        const custom = world.packs.weather?.config.climates;
        for (const raw of Array.isArray(custom) ? custom : []) {
          const c = parseClimate(objOf(raw));
          const key = strOf(objOf(raw).id, strOf(objOf(raw).region));
          const covered = c.seasons.flatMap((s) => s.months);
          for (let m = 1; m <= 12; m++) if (covered.filter((x) => x === m).length !== 1) issues.push({ severity: "warning" as const, code: "weather.climates", message: say("lint_climate_key_month_m_is_covered_coveredcount", { key: key, m: m, coveredCount: covered.filter((x) => x === m).length }), path: `packs.weather.config.climates.${key}` });
          for (const s of c.seasons) for (const id of Object.keys(s.weights)) if (!c.states.some((x) => x.id === id)) issues.push({ severity: "error" as const, code: "weather.climates", message: say("lint_climate_key_s_unknown_state_id", { key: key, s: s.label, id: id }), path: `packs.weather.config.climates.${key}` });
        }
        return issues;
      },
    });
  },
};

export default weatherPack;
