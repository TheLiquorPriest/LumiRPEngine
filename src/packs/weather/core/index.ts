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
import { calendarOf, dateAt, dayPartAt } from "../../../engine/calendar";
import { ENGINE_EVENTS } from "../../../engine/engine-pack";
import { labelOf, numOf, objOf, strOf, own } from "../../../engine/pack-kit";
import type { PackDef, ReadContext, Rejection } from "../../../engine/registry";
import type { Rng } from "../../../engine/rng";
import { evalExpr, kindIs, placeOfEntity, scopeEnv, truthy } from "../../../engine/scope";

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

const MOOD: Record<Season, string> = { winter: "a cold winter", spring: "a mild spring", summer: "a warm summer", autumn: "a crisp autumn" };

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
  /** "Light rain, 12 °C" (level 1: the season's mood). */
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

function climateOf(ctx: Pick<ReadContext, "world" | "state">, region: EntityId): Climate {
  const id = strOf(own(ctx.state.entities, region)?.fields.climate, "temperate");
  const custom = ctx.world.packs.weather?.config.climates;
  const authored = Array.isArray(custom) ? custom.map((c) => objOf(c)).find((c) => strOf(c.id, strOf(c.region)) === id) : undefined;
  return authored ? parseClimate(authored) : (own(CLIMATES, id) ?? (CLIMATES.temperate as Climate));
}

function climateSeason(climate: Climate, month: number): ClimateSeason | null {
  return climate.seasons.find((s) => s.months.includes(month)) ?? climate.seasons[0] ?? null;
}

/** The region over a place: its `region` field or an ancestor's, else the first region entity. */
export function regionOf(ctx: Pick<ReadContext, "world" | "state" | "registry">, place: PlaceId | null): EntityId | null {
  let cur = place ?? undefined;
  for (let guard = 0; cur && guard < 32; guard++) {
    const r = own(ctx.world.places, cur)?.fields.region;
    if (typeof r === "string" && own(ctx.state.entities, r)) return r;
    cur = own(ctx.world.places, cur)?.parent;
  }
  return Object.keys(ctx.state.entities).sort().find((id) => kindIs(ctx.registry, ctx.world, own(ctx.state.entities, id)?.kind ?? "", "region")) ?? null;
}

/** The current climate state at a place's region, with its effects; null when there is none. */
function stateAt(ctx: ReadContext, place: PlaceId | null): ClimateState | null {
  const region = regionOf(ctx, place);
  if (!region) return null;
  const id = strOf(own(ctx.state.entities, region)?.fields.weather);
  return climateOf(ctx, region).states.find((s) => s.id === id) ?? null;
}

export function buildWeatherView(ctx: ReadContext): WeatherView {
  const level = ctx.levelOf(ctx.world.pov, "weather");
  const season = seasonAt(ctx);
  const here = placeOfEntity(ctx.state, ctx.world.pov);
  const region = regionOf(ctx, here);
  const e = region ? own(ctx.state.entities, region) : undefined;
  if (level <= 1 || !e) return { level, label: level === 0 ? "" : MOOD[season], region: e?.name ?? null, season, sky: null, tempC: null, closed: [] };
  const st = stateAt(ctx, here);
  const sky = strOf(e.fields.weather, "clear");
  const temp = level >= 3 && typeof e.fields.temp_c === "number" ? Math.round(e.fields.temp_c) : null;
  const word = st?.label ?? sky;
  return { level, label: `${word.charAt(0).toUpperCase()}${word.slice(1)}${temp !== null ? `, ${temp} °C` : ""}`, region: e.name, season, sky, tempC: temp, closed: level >= 4 ? (st?.closes ?? []) : [] };
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
    if (level >= 4 && next !== cur && st && st.closes.length > 0) out.push({ type: ENGINE_EVENTS.signal, data: { class: "weather", text: `${st.label} over ${e.name}: ${st.closes.join(", ")} travel is closed.` } });
  }
  return out;
}

function reject(code: string, reason: string): Rejection {
  return { code, reason };
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
      const region = regionOf(ctx, typeof place === "string" && place !== "" ? place : placeOfEntity(ctx.state, ctx.world.pov));
      return region ? strOf(own(ctx.state.entities, region)?.fields.weather, "clear") : "";
    });
    r.formula("season", (ctx) => seasonAt(ctx));

    // Scripted weather (template `set_weather`): the region (an entity or a place under it) takes the
    // state, held for `minutes` and/or `until` a condition (an Expr) comes true.
    r.effect({
      type: "weather.set",
      args: ["region", "state", "minutes?", "until?"],
      resolve(a, ctx) {
        const target = strOf(a.region);
        const region = own(ctx.state.entities, target) ? target : regionOf(ctx, own(ctx.world.places, target) ? target : null);
        if (!region) return reject("missing_region", `no weather region for ${labelOf(ctx, target)}`);
        const st = strOf(a.state);
        if (!climateOf(ctx, region).states.some((s) => s.id === st)) return reject("bad_state", `no weather state ${st.replace(/_/g, " ")}`);
        const out: LedgerEvent[] = [{ type: "set", entity: region, field: "weather", value: st }];
        if (typeof a.minutes === "number" && a.minutes > 0) out.push({ type: "set", entity: region, field: "weather_hold", value: ctx.state.clock + Math.round(a.minutes) });
        if (typeof a.until === "string" && a.until.trim() !== "") out.push({ type: "set", entity: region, field: "weather_hold_until", value: a.until });
        return out;
      },
    });
    // Ends a scripted state now (a rule's `clear`): the hold lifts and the sky turns to `state`, else the season's likeliest calm state.
    r.effect({
      type: "weather.clear",
      args: ["region", "state?"],
      resolve(a, ctx) {
        const target = strOf(a.region);
        const region = own(ctx.state.entities, target) ? target : regionOf(ctx, own(ctx.world.places, target) ? target : null);
        if (!region) return reject("missing_region", `no weather region for ${labelOf(ctx, target)}`);
        const climate = climateOf(ctx, region);
        const season = climateSeason(climate, dateAt(calendarOf(ctx.world), ctx.state.clock).month);
        const calm = climate.states.filter((s) => s.closes.length === 0 && Object.keys(s.travel).length === 0).map((s) => s.id);
        const likeliest = Object.entries(season?.weights ?? {}).filter(([id]) => calm.includes(id)).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0];
        const st = strOf(a.state) || likeliest || calm[0] || strOf(own(ctx.state.entities, region)?.fields.weather, "clear");
        if (!climate.states.some((s) => s.id === st)) return reject("bad_state", `no weather state ${st.replace(/_/g, " ")}`);
        return [
          { type: "set", entity: region, field: "weather", value: st },
          { type: "set", entity: region, field: "weather_hold", value: 0 },
          { type: "set", entity: region, field: "weather_hold_until", value: "" },
        ];
      },
    });

    r.process({ id: "weather.climate", domain: "weather", minLevel: 2, step: (slot, ctx, rng) => stepRegions(slot, ctx, rng) });

    r.renderer({
      slot: "scene",
      render(ctx) {
        const v = buildWeatherView(ctx);
        if (v.level === 0 || v.label === "") return [];
        if (v.level === 1) return [`Season: ${v.label}.`];
        return [`Weather: ${v.label.toLowerCase()}.${v.closed.length > 0 ? ` No ${v.closed.join(" or ")} travel.` : ""}`];
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
          for (let m = 1; m <= 12; m++) if (covered.filter((x) => x === m).length !== 1) issues.push({ severity: "warning" as const, code: "weather.climates", message: `Climate ${key}: month ${m} is covered ${covered.filter((x) => x === m).length} times.`, path: `packs.weather.config.climates.${key}` });
          for (const s of c.seasons) for (const id of Object.keys(s.weights)) if (!c.states.some((x) => x.id === id)) issues.push({ severity: "error" as const, code: "weather.climates", message: `Climate ${key}, ${s.label}: unknown state ${id}.`, path: `packs.weather.config.climates.${key}` });
        }
        return issues;
      },
    });
  },
};

export default weatherPack;
