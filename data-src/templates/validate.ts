/// <reference types="bun-types" />
// Validates the neutral starter templates in this folder: shape, unique ids, cross-references,
// plausibility (routes, schedules, money, gear weights, Modern US table links) and secret leaks.
//
//   bun data-src/templates/validate.ts [file.json ...]    (default: every template here)
//
// Reads `src/packs/*/core/tables/modern-us/` for the Modern US checks. Exits 1 on any error.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { compile } from "../../src/engine/expr";
import type { Node } from "../../src/engine/expr";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";

type Rec = Record<string, unknown>;

const HERE = import.meta.dir;
const ROOT = resolve(HERE, "../..");

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const rec = (v: unknown): Rec => (isRec(v) ? v : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const recs = (v: unknown): Rec[] => list(v).filter(isRec);

const PRESETS: Record<string, string> = { "fantasy-town": "story", "mystery-manor": "grounded", "modern-slice-of-life": "simulation" };
const MODES = ["walk", "road", "offroad", "water"];
const TIERS = ["pov", "principal", "supporting", "background"];
const TRACK_KINDS = ["quest", "secret", "puzzle", "agenda"];
const VISIBILITY = ["public", "known_by", "secret"];
const SLOTS = ["head", "face", "neck", "torso_base", "torso_mid", "torso_outer", "full_body", "hands", "wrist", "waist", "legs", "underwear", "socks", "feet", "back", "shoulder", "hand_held", "pocket", "pocket_or_bag", "none"];
const SHARED_SLOTS = ["pocket", "pocket_or_bag", "hand_held", "none"];
/** Effect types the conversion step understands, with the arguments that name ids. */
const EFFECTS: Record<string, string[]> = {
  pay: ["from", "to"], give_item: ["item", "to"], reveal_item: ["item"], assign_vehicle: ["vehicle", "to"], flag_overdue: ["vehicle"], move: ["who", "place"],
  regard: ["who", "toward"], reveal: ["track", "to"], advance: ["track"], set_route: ["route"], set_flag: ["flag"], set_weather: ["region"],
  schedule_override: ["who", "place"], set_scene: ["place"], price_modifier: ["scope"], payroll: ["employer"], note: [],
};
/** Engine effect types an action may use directly, with the arguments that name ids. */
const ENGINE_EFFECTS: Record<string, string[]> = { set: ["entity"], add: ["entity"], move: ["entity", "to"], link: ["from", "to"], "gear.transfer": ["item", "to"], "gear.lend": ["item", "to"], "gear.give": ["item", "from", "to"] };
const BUILTIN_FUNCTIONS = ["min", "max", "clamp", "floor", "ceil", "round", "abs", "field", "rel", "has_rel", "rel_count", "rel_field", "stage", "since", "place", "at", "level", "knows", "fired", "attempts", "revealed", "band", "next_time", "today_at", "hours", "days", "holiday", "count_at"];
const BARE_NAMES = ["pov", "here", "self", "level", "stage", "clock", "minute", "hour", "day", "weekday", "date", "month", "year", "daypart"];
const WEALTH = ["broke", "poor", "modest", "comfortable", "rich", "wealthy"];
const GEAR_CATEGORIES = ["carried", "clothing", "household", "recreation", "tool"];
const PRICE_CATEGORIES = ["groceries_staples", "groceries_baskets", "meals_out", "coffee", "alcohol", "clothing", "electronics", "tools_hardware", "household_goods", "personal_care", "medical", "entertainment", "transport", "fuel", "vehicle_services", "lodging", "utilities", "subscriptions", "gifts"];
const engine = createRegistry(ALL_PACKS);
const BANNED = ["fuck", "shit", "cunt", "porn", "erotic", "nude", "rape"];

class Findings {
  errors: string[] = [];
  warnings: string[] = [];
  error(message: string): void {
    this.errors.push(message);
  }
  warn(message: string): void {
    this.warnings.push(message);
  }
}

interface Tables {
  rows(id: string): Rec | undefined;
}

function tables(): Tables {
  const cache: Record<string, Rec | undefined> = {};
  return {
    rows(id) {
      if (!(id in cache)) {
        const [pack, local] = id.split(".");
        const path = join(ROOT, "src", "packs", pack ?? "", "core", "tables", "modern-us", `${local}.json`);
        cache[id] = existsSync(path) ? rec(rec(JSON.parse(readFileSync(path, "utf8"))).rows) : undefined;
      }
      return cache[id];
    },
  };
}

function minutes(value: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text(value));
  if (!m) return null;
  const total = Number(m[1]) * 60 + Number(m[2]);
  return total <= 1440 && Number(m[2]) < 60 ? total : null;
}

function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Walks every string in a value, with its path. */
function* strings(value: unknown, path = ""): Generator<[string, string]> {
  if (typeof value === "string") yield [path, value];
  else if (Array.isArray(value)) for (const [i, item] of value.entries()) yield* strings(item, `${path}[${i}]`);
  else if (isRec(value)) for (const [key, item] of Object.entries(value)) yield* strings(item, path ? `${path}.${key}` : key);
}

function validate(t: Rec, file: string): { findings: Findings; counts: Record<string, number | string> } {
  const f = new Findings();
  const data = tables();
  const id = text(t.id);
  const modern = t.dataPack === "modern-us";
  const err = (m: string) => f.error(m);

  // ---------------------------------------------------------------- basics
  if (t.schema !== "lre-template/v1") err(`schema must be lre-template/v1`);
  if (id !== basename(file, ".json")) err(`id "${id}" does not match the file name`);
  for (const key of ["name", "blurb", "genre", "contentNotes"]) if (!text(t[key])) err(`missing ${key}`);
  const preset = text(rec(t.realism).preset);
  if (PRESETS[id] && preset !== PRESETS[id]) err(`realism preset is "${preset}", expected "${PRESETS[id]}"`);

  // ---------------------------------------------------------------- registry
  const registry = new Map<string, string>();
  const claim = (kind: string, value: unknown, where: string) => {
    const key = text(value);
    if (!key) return err(`${where}: empty id`);
    if (!/^[a-z][a-z0-9_]*$/.test(key)) err(`${where}: id "${key}" must be lower snake_case`);
    const earlier = registry.get(key);
    if (earlier) err(`${where}: id "${key}" is already used by a ${earlier}`);
    else registry.set(key, kind);
  };
  const collections: [string, string][] = [
    ["places", "place"], ["routes", "route"], ["grids", "grid"], ["characters", "character"], ["items", "item"], ["containers", "container"], ["kits", "kit"],
    ["vehicles", "vehicle"], ["accounts", "account"], ["tracks", "track"], ["rules", "rule"], ["actions", "action"], ["clues", "clue"], ["lore", "lore"], ["flags", "flag"], ["prices", "price"], ["bills", "bill"], ["gearItems", "gearItem"],
  ];
  for (const [key, kind] of collections) for (const [i, item] of recs(t[key]).entries()) claim(kind, item.id, `${key}[${i}]`);
  for (const group of Object.keys(rec(t.groups))) claim("group", group, `groups.${group}`);
  const kindOf = (value: unknown) => registry.get(text(value));
  const has = (value: unknown, ...kinds: string[]) => {
    const kind = kindOf(value);
    return kind !== undefined && (kinds.length === 0 || kinds.includes(kind));
  };
  const need = (where: string, value: unknown, ...kinds: string[]) => {
    if (!has(value, ...kinds)) err(`${where}: "${text(value)}" is not a known ${kinds.join("/") || "id"}`);
  };
  const flagIds = new Set(recs(t.flags).map((x) => text(x.id)));
  const trackStages = new Set<string>();
  for (const track of recs(t.tracks)) for (const stage of Object.keys(rec(track.stages))) trackStages.add(`${text(track.id)}.${stage}`);

  // ---------------------------------------------------------------- calendar and time
  const cal = rec(t.calendar);
  const custom = cal.system === "custom";
  const monthLengths = custom ? list(rec(cal.custom).monthLengths).map((n) => num(n) ?? 0) : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const weekdayNames = custom ? list(rec(cal.custom).weekdayNames).map(text) : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (custom) {
    if (monthLengths.length !== list(rec(cal.custom).monthNames).length) err("custom calendar: monthLengths and monthNames differ in length");
    const year = monthLengths.reduce((a, b) => a + b, 0);
    if (year % weekdayNames.length !== 0) err("custom calendar: the year is not a whole number of weeks, so weekdays would drift");
  }
  const parseDate = (value: unknown): { month: number; day: number; minute: number; weekday: string } | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text(value));
    if (!m) return null;
    const [year, month, day, hh, mm] = m.slice(1).map(Number) as [number, number, number, number, number];
    if (month < 1 || month > monthLengths.length || day < 1 || hh > 23 || mm > 59) return null;
    if (custom) {
      if (day > (monthLengths[month - 1] ?? 0)) return null;
      const index = monthLengths.slice(0, month - 1).reduce((a, b) => a + b, 0) + day - 1;
      return { month, day, minute: hh * 60 + mm, weekday: weekdayNames[index % weekdayNames.length] ?? "" };
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return { month, day, minute: hh * 60 + mm, weekday: weekdayNames[date.getUTCDay()] ?? "" };
  };
  if (!parseDate(cal.epoch)) err("calendar.epoch is not a valid date-time");
  if (!validTimeZone(text(cal.timeZone))) err(`calendar.timeZone "${text(cal.timeZone)}" is not a time zone`);
  let previous = -1;
  for (const part of recs(cal.dayParts)) {
    const start = minutes(part.start);
    if (start === null || start <= previous) err(`calendar.dayParts: "${text(part.id)}" has a bad or out-of-order start`);
    previous = start ?? previous;
  }
  for (const holiday of recs(cal.holidays)) {
    const rule = rec(holiday.rule);
    const month = num(rule.month) ?? 0;
    if (month < 1 || month > monthLengths.length) err(`holiday ${text(holiday.id)}: month out of range`);
    if (rule.type === "fixed" && (num(rule.day) ?? 0) > (monthLengths[month - 1] ?? 0)) err(`holiday ${text(holiday.id)}: day out of range`);
  }
  const start = rec(t.start);
  const startDate = parseDate(start.at);
  if (!startDate) err("start.at is not a valid date-time in the calendar");
  else if (startDate.weekday !== text(start.weekday)) err(`start.weekday says "${text(start.weekday)}" but ${text(start.at)} is a ${startDate.weekday}`);
  need("start.place", start.place, "place");
  const sceneTypes = recs(rec(t.time).sceneTypes);
  const sceneIds = new Set(sceneTypes.map((s) => text(s.id)));
  for (const required of ["conversation", "action", "exploration", "downtime"]) if (!sceneIds.has(required)) err(`time.sceneTypes lacks "${required}"`);
  for (const s of sceneTypes) if ((num(s.tickMinutes) ?? 0) <= 0) err(`scene type ${text(s.id)}: tickMinutes must be positive`);
  if (!sceneIds.has(text(start.scene))) err(`start.scene "${text(start.scene)}" is not a scene type`);

  // ---------------------------------------------------------------- places, routes, grids
  const places = recs(t.places);
  if (places.length < 8 || places.length > 20) err(`${places.length} places; expected 8-20`);
  const placeById = new Map(places.map((p) => [text(p.id), p]));
  const gridById = new Map(recs(t.grids).map((g) => [text(g.id), g]));
  for (const p of places) {
    const where = `place ${text(p.id)}`;
    if (p.parent !== undefined) need(`${where}.parent`, p.parent, "place");
    let hops = 0;
    for (let cur: Rec | undefined = p; cur?.parent !== undefined && hops < 20; hops++) cur = placeById.get(text(cur?.parent));
    if (hops >= 20) err(`${where}: parent chain is a cycle`);
    if (!sceneIds.has(text(p.sceneType))) err(`${where}: unknown sceneType "${text(p.sceneType)}"`);
    if (text(p.description).length < 40) err(`${where}: description is too short`);
    if (!VISIBILITY.includes(text(p.visibility))) err(`${where}: bad visibility`);
    if (text(t.dataPack) || text(cal.timeZone) !== "Etc/UTC") {
      const zone = text(p.timeZone) || text(placeById.get(text(p.parent))?.timeZone);
      if ((modern || text(cal.system) === "gregorian") && !zone && p.parent === undefined) err(`${where}: root places need a timeZone`);
      if (zone && !validTimeZone(zone)) err(`${where}: bad timeZone "${zone}"`);
    }
    if (p.grid !== undefined && !gridById.has(text(p.grid))) err(`${where}: unknown grid`);
  }
  const speeds = rec(t.travelSpeedKmh);
  const edges = new Map<string, string[]>();
  for (const r of recs(t.routes)) {
    const where = `route ${text(r.id)}`;
    need(`${where}.from`, r.from, "place");
    need(`${where}.to`, r.to, "place");
    const modes = rec(r.modes);
    if (Object.keys(modes).length === 0) err(`${where}: no modes`);
    for (const [mode, legValue] of Object.entries(modes)) {
      const leg = rec(legValue);
      const mins = num(leg.minutes) ?? 0;
      if (!MODES.includes(mode)) err(`${where}: unknown mode "${mode}"`);
      if (mins <= 0) err(`${where}.${mode}: minutes must be positive`);
      const km = num(leg.distanceKm);
      const range = list(speeds[mode]).map((n) => num(n) ?? 0);
      if (km !== null && mins > 0 && range.length === 2) {
        const kmh = km / (mins / 60);
        if (kmh < (range[0] ?? 0) || kmh > (range[1] ?? Infinity)) err(`${where}.${mode}: ${kmh.toFixed(1)} km/h is outside ${range.join("-")}`);
      }
    }
    if (!r.secret) {
      edges.set(text(r.from), [...(edges.get(text(r.from)) ?? []), text(r.to)]);
      if (r.bidirectional) edges.set(text(r.to), [...(edges.get(text(r.to)) ?? []), text(r.from)]);
    }
  }
  for (const p of places) {
    if (p.parent === undefined) continue;
    edges.set(text(p.id), [...(edges.get(text(p.id)) ?? []), text(p.parent)]);
    edges.set(text(p.parent), [...(edges.get(text(p.parent)) ?? []), text(p.id)]);
  }
  const reached = new Set<string>([text(start.place)]);
  for (const queue = [text(start.place)]; queue.length; ) {
    for (const next of edges.get(queue.shift() ?? "") ?? []) if (!reached.has(next)) (reached.add(next), queue.push(next));
  }
  const parents = new Set(places.map((p) => text(p.parent)).filter(Boolean));
  for (const p of places) {
    if (!reached.has(text(p.id)) && !parents.has(text(p.id)) && p.visibility !== "secret") err(`place ${text(p.id)} cannot be reached by any route from the start`);
  }
  let gridCells = 0;
  let blockedCells = 0;
  let zoneCount = 0;
  for (const g of gridById.values()) {
    const where = `grid ${text(g.id)}`;
    const w = num(g.width) ?? 0;
    const h = num(g.height) ?? 0;
    const rows = list(g.rows).map(text);
    const legend = rec(g.legend);
    if (rows.length !== h) err(`${where}: ${rows.length} rows, height says ${h}`);
    for (const [y, row] of rows.entries()) {
      if (row.length !== w) err(`${where}: row ${y} has ${row.length} cells, width says ${w}`);
      for (const ch of row) if (!(ch in legend)) err(`${where}: row ${y} uses "${ch}" which is not in the legend`);
    }
    const cellAt = (x: number, y: number) => rec(legend[rows[y]?.[x] ?? ""]);
    const walkable = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !cellAt(x, y).blocked && !list(cellAt(x, y).blockedFor).includes("walk");
    gridCells += w * h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cellAt(x, y).blocked) blockedCells++;
    const zones = rec(g.zones);
    zoneCount += Object.keys(zones).length;
    for (const [name, rects] of Object.entries(zones)) {
      for (const rect of list(rects)) {
        const [x, y, rw, rh] = list(rect).map((n) => num(n) ?? -1) as [number, number, number, number];
        if (x < 0 || y < 0 || rw < 1 || rh < 1 || x + rw > w || y + rh > h) err(`${where}: zone "${name}" has a rectangle outside the grid`);
      }
    }
    const owner = placeById.get(text(g.place));
    if (!owner || owner.grid !== g.id) err(`${where}: its place must name it as its grid`);
    const anchors: [string, number, number][] = [];
    for (const p of places) {
      if (p.cell === undefined) continue;
      const cell = rec(p.cell);
      if (p.parent !== g.place) continue;
      anchors.push([`place ${text(p.id)}`, num(cell.x) ?? -1, num(cell.y) ?? -1]);
    }
    for (const [place, c] of Object.entries(rec(g.exits))) {
      need(`${where}.exits`, place, "place");
      const [x, y] = list(isRec(c) ? c.cell : c).map((n) => num(n) ?? -1) as [number, number];
      if (isRec(c) && c.mode === "water") {
        const cell = rec(legend[rows[y]?.[x] ?? ""]);
        if (cell.terrain !== "water" || cell.blocked) err(`${where}: water exit ${place} (${x},${y}) is not on open water`);
      } else {
        anchors.push([`exit ${place}`, x, y]);
      }
    }
    for (const p of places) if (p.cell !== undefined && !gridById.has(text(placeById.get(text(p.parent))?.grid))) err(`place ${text(p.id)}: has a cell but its parent has no grid`);
    if (blockedCells === 0) err(`${where}: no blocked cells`);
    if (Object.keys(zones).length < 3) err(`${where}: fewer than 3 zones`);
    const first = anchors[0];
    const seen = new Set<string>();
    if (first && walkable(first[1], first[2])) {
      seen.add(`${first[1]},${first[2]}`);
      for (const queue: [number, number][] = [[first[1], first[2]]]; queue.length; ) {
        const [x, y] = queue.shift() ?? [0, 0];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (walkable(x + dx, y + dy) && !seen.has(`${x + dx},${y + dy}`)) (seen.add(`${x + dx},${y + dy}`), queue.push([x + dx, y + dy]));
        }
      }
    }
    for (const [label, x, y] of anchors) {
      if (!walkable(x, y)) err(`${where}: ${label} sits on a blocked or missing cell (${x},${y})`);
      else if (!seen.has(`${x},${y}`)) err(`${where}: ${label} (${x},${y}) cannot be walked to from the first anchor`);
    }
  }
  if (gridById.size !== 1) err(`${gridById.size} grids; expected exactly one`);

  // ---------------------------------------------------------------- characters
  const characters = recs(t.characters);
  const axes = recs(rec(t.regard).axes);
  const axisRange = new Map(axes.map((a) => [text(a.id), [num(a.min) ?? 0, num(a.max) ?? 0] as const]));
  const pov = characters.find((c) => c.id === t.pov || c.tier === "pov");
  if (!pov) err("no point-of-view character");
  const npcs = characters.filter((c) => c.tier !== "pov");
  if (npcs.length < 6 || npcs.length > 10) err(`${npcs.length} NPCs; expected 6-10`);
  const agents = characters.filter((c) => c.agent === true);
  if (agents.length < 2 || agents.length > 5) err(`${agents.length} agents; expected 2-5`);
  const trackById = new Map(recs(t.tracks).map((x) => [text(x.id), x]));
  let scheduleBlocks = 0;
  let regardPairs = 0;
  for (const c of characters) {
    const where = `character ${text(c.id)}`;
    if (!TIERS.includes(text(c.tier))) err(`${where}: bad tier`);
    need(`${where}.home`, c.home, "place");
    if (c.location !== undefined) need(`${where}.location`, c.location, "place");
    if (text(c.summary).length < 60) err(`${where}: summary is too short`);
    if (c.tier !== "pov" && list(c.traits).length < 2) err(`${where}: needs at least two traits`);
    if (c.tier !== "pov" && c.agent !== true) {
      const goals = rec(c.goals);
      if (!text(goals.label) || list(goals.steps).length < 2) err(`${where}: non-agent NPCs need goals with a label and at least two steps`);
    }
    if (c.agent === true) {
      const agenda = trackById.get(text(c.agenda));
      if (!agenda || agenda.kind !== "agenda" || agenda.owner !== c.id) err(`${where}: agents need an agenda track they own`);
    }
    const byDay = new Map<string, [number, number, string, string][]>();
    const holidayIds = new Set([...recs(cal.holidays).map((h) => text(h.id)), ...(cal.inheritHolidays ? Object.keys(data.rows("calendar.holidays") ?? {}) : [])]);
    for (const block of recs(c.schedule)) {
      scheduleBlocks++;
      const s = minutes(block.start);
      const e = minutes(block.end);
      need(`${where}.schedule`, block.place, "place");
      if (s === null || e === null || e <= s) err(`${where}: schedule block ${text(block.start)}-${text(block.end)} is invalid`);
      if (!text(block.activity)) err(`${where}: schedule block lacks an activity`);
      // A term runs between two local dates; blocks only conflict where their terms overlap.
      const term = rec(block.term);
      const [termFrom, termUntil] = block.term === undefined ? ["0000-00-00", "9999-99-99"] : [text(term.from), text(term.until)];
      if (block.term !== undefined) {
        for (const d of [termFrom, termUntil]) if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !parseDate(`${d}T00:00`)) err(`${where}: term date "${d}" is not a date in the calendar`);
        if (termFrom > termUntil) err(`${where}: term runs from ${termFrom} to ${termUntil}`);
        for (const h of list(term.except).map(text)) if (!holidayIds.has(h)) err(`${where}: term excepts "${h}", which is not a holiday`);
      }
      for (const day of list(block.days).map(text)) {
        if (!weekdayNames.includes(day)) err(`${where}: unknown weekday "${day}"`);
        for (const [a, b, from, until] of byDay.get(day) ?? []) if (s !== null && e !== null && s < b && a < e && termFrom <= until && from <= termUntil) err(`${where}: ${day} blocks overlap around ${text(block.start)}`);
        byDay.set(day, [...(byDay.get(day) ?? []), [s ?? 0, e ?? 0, termFrom, termUntil]]);
      }
    }
    for (const [i, trip] of recs(c.trips).entries()) {
      const tripFrom = parseDate(trip.from);
      const tripUntil = parseDate(trip.until);
      if (!tripFrom || !tripUntil || text(trip.from) >= text(trip.until)) err(`${where}.trips[${i}]: needs valid date-times with from before until`);
      need(`${where}.trips[${i}].place`, trip.place, "place");
      if (text(trip.label).length < 6) err(`${where}.trips[${i}]: needs a label`);
    }
    if (c.tier !== "pov" && c.tier !== "background" && recs(c.schedule).length < 2) err(`${where}: needs a weekly schedule`);
    const regards = recs(c.regard);
    if (c.tier !== "pov" && regards.length < 2) err(`${where}: needs at least two regard entries`);
    for (const r of regards) {
      regardPairs++;
      need(`${where}.regard`, r.toward, "character");
      for (const [axis, value] of Object.entries(rec(r.axes))) {
        const range = axisRange.get(axis);
        const n = num(value);
        if (!range || n === null || n < range[0] || n > range[1]) err(`${where}: regard toward ${text(r.toward)} has a bad "${axis}" value`);
      }
    }
    if (c.sheet !== undefined && Object.values(rec(c.sheet)).some((v) => (num(v) ?? 0) < 1 || (num(v) ?? 11) > 10)) err(`${where}: sheet values must be 1-10`);
  }

  // ---------------------------------------------------------------- Modern US links (jobs, region)
  if (modern) {
    const region = data.rows("economy.regions")?.[text(t.region)];
    if (!region) err(`region "${text(t.region)}" is not in economy.regions`);
    const occupations = data.rows("economy.occupations") ?? {};
    const shifts = data.rows("calendar.shifts") ?? {};
    for (const c of characters) {
      const job = rec(c.job);
      const occ = text(job.occupation);
      if (!occ) continue;
      const row = rec(occupations[occ]);
      const where = `character ${text(c.id)}`;
      if (!occupations[occ]) {
        err(`${where}: occupation "${occ}" is not in economy.occupations`);
        continue;
      }
      const median = num(row.median_cents_per_h) ?? 1;
      const hourly = num(job.hourlyCents) ?? 0;
      if (hourly < median * 0.6 || hourly > median * 1.8) err(`${where}: ${hourly}c/h is outside 0.6-1.8x the ${occ} median ${median}c/h`);
      if (row.pay_frequency !== job.payFrequency) err(`${where}: pay frequency "${text(job.payFrequency)}" differs from ${occ} (${text(row.pay_frequency)})`);
      if (row.schedule_pattern !== job.shiftPattern || !(text(job.shiftPattern) in shifts)) err(`${where}: shiftPattern differs from ${occ} (${text(row.schedule_pattern)})`);
      const hours = num(job.hoursPerWeek) ?? 0;
      if (hours < 8 || hours > 60) err(`${where}: hoursPerWeek ${hours} is implausible`);
      let weekly = 0;
      for (const block of recs(c.schedule)) {
        if (block.place === job.employer) weekly += ((minutes(block.end) ?? 0) - (minutes(block.start) ?? 0)) * list(block.days).length;
      }
      if (Math.abs(weekly / 60 - hours) > 8) f.warn(`${where}: scheduled ${(weekly / 60).toFixed(1)} h at work, job says ${hours} h/week`);
      const account = recs(t.accounts).find((a) => a.id === job.depositTo);
      if (!account || account.owner !== c.id) err(`${where}: depositTo must be an account they own`);
    }
    const rent = num(rec(region).median_rent_1br_cents_per_month) ?? 1;
    for (const bill of recs(t.bills)) {
      const where = `bill ${text(bill.id)}`;
      const amount = num(bill.amountCents) ?? 0;
      if (bill.catalogItem !== undefined) {
        const band = rec(rec(data.rows("economy.catalog")?.[text(bill.catalogItem)]).price_cents);
        if (!band.min || amount < (num(band.min) ?? 0) || amount > (num(band.max) ?? 0)) err(`${where}: ${amount}c is outside the catalog band for ${text(bill.catalogItem)}`);
      }
      if (bill.vehicleClass !== undefined && amount !== num(rec(data.rows("vehicles.classes")?.[text(bill.vehicleClass)]).insurance_full_cents_per_month)) err(`${where}: differs from the class's full-coverage insurance`);
      if (bill.loan !== undefined && amount !== num(recs(t.accounts).find((a) => a.id === bill.loan)?.paymentCents)) err(`${where}: differs from the loan's payment`);
      if (bill.usageKwh !== undefined && Math.abs((num(bill.usageKwh) ?? 0) * (num(bill.rateCentsPerKwh) ?? 0) - amount) > 1) err(`${where}: usage times rate does not equal the amount`);
      if (bill.kind === "rent" && (amount < rent * 0.5 || amount > rent * 1.5)) err(`${where}: rent ${amount}c is outside 0.5-1.5x the regional 1BR median ${rent}c`);
    }
  }

  // ---------------------------------------------------------------- bills
  for (const bill of recs(t.bills)) {
    const where = `bill ${text(bill.id)}`;
    const amount = num(bill.amountCents) ?? 0;
    need(`${where}.payer`, bill.payer, "character");
    // A payer that holds accounts pays from one of them; one without accounts names none and pays out of its means.
    if (bill.from !== undefined) {
      const account = recs(t.accounts).find((a) => a.id === bill.from);
      if (!account || account.owner !== bill.payer) err(`${where}: "from" must be an account the payer owns`);
    } else if (recs(t.accounts).some((a) => a.owner === bill.payer)) err(`${where}: the payer holds accounts, so "from" must name the one it pays from`);
    // Paid to a character (it lands in their account) or to an outside counterparty named in words.
    if (has(bill.payee) && !has(bill.payee, "character")) err(`${where}: payee "${text(bill.payee)}" is a ${kindOf(bill.payee)}; a bill is paid to a character or an outside counterparty`);
    if (bill.payee === bill.payer) err(`${where}: the payer can't pay itself`);
    if (!Number.isInteger(amount) || amount <= 0) err(`${where}: amount must be a positive integer of base units`);
    const day = num(bill.day) ?? -1;
    if (bill.every === "week" ? day < 0 || day > 6 : bill.every !== "month" || day < 1 || day > 28) err(`${where}: a bill is every "week" (day 0-6, the calendar's weekday) or every "month" (day 1-28)`);
  }

  // ---------------------------------------------------------------- gear
  const gearItems = data.rows("gear.items") ?? {};
  const gearContainers = data.rows("gear.containers") ?? {};
  const gearKits = data.rows("gear.kits") ?? {};
  const classes = data.rows("vehicles.classes") ?? {};
  const holderKinds = ["place", "character", "container", "item", "vehicle", "kit"];
  const wornSlots = new Map<string, number>();
  const loads = new Map<string, { g: number; l: number }>();
  const addLoad = (container: string, g: number, l: number) => loads.set(container, { g: (loads.get(container)?.g ?? 0) + g, l: (loads.get(container)?.l ?? 0) + l });
  for (const [collection, kind] of [["items", "item"], ["containers", "container"]] as const) {
    for (const item of recs(t[collection])) {
      const where = `${kind} ${text(item.id)}`;
      need(`${where}.in`, item.in, ...holderKinds);
      if (item.owner !== undefined) need(`${where}.owner`, item.owner, "character", "place");
      if (text(item.description).length < 20 && !item.hidden) err(`${where}: description is too short`);
      if (item.worn === true) {
        if (!SLOTS.includes(text(item.slot))) err(`${where}: bad slot "${text(item.slot)}"`);
        const key = `${text(item.in)}/${text(item.slot)}`;
        wornSlots.set(key, (wornSlots.get(key) ?? 0) + 1);
        if ((wornSlots.get(key) ?? 0) > 1 && !SHARED_SLOTS.includes(text(item.slot))) err(`${where}: slot "${text(item.slot)}" is already filled on ${text(item.in)}`);
      }
      const tableItem = text(item.tableItem);
      const tableContainer = text(item.tableContainer);
      if (tableItem && !gearItems[tableItem]) err(`${where}: tableItem "${tableItem}" is not in gear.items`);
      if (tableContainer && !gearContainers[tableContainer]) err(`${where}: tableContainer "${tableContainer}" is not in gear.containers`);
      const row = rec(tableItem ? gearItems[tableItem] : undefined);
      const grams = num(item.weightG) ?? num(row.weight_g) ?? num(rec(tableContainer ? gearContainers[tableContainer] : undefined).empty_weight_g) ?? 0;
      addLoad(text(item.in), grams, num(row.volume_l) ?? 0);
    }
  }
  for (const container of recs(t.containers)) {
    const row = rec(text(container.tableContainer) ? gearContainers[text(container.tableContainer)] : undefined);
    const maxKg = num(container.maxLoadKg) ?? num(row.max_load_kg);
    const liters = num(container.capacityL) ?? num(row.capacity_l);
    const load = loads.get(text(container.id));
    const kitLoad = recs(t.kits).filter((k) => k.container === container.id).reduce((a, k) => a + (num(rec(gearKits[text(k.tableKit)]).pieces_total_weight_g) ?? 0), 0);
    const kitLiters = recs(t.kits).filter((k) => k.container === container.id).reduce((a, k) => a + (num(rec(gearKits[text(k.tableKit)]).packed_volume_l) ?? 0), 0);
    if (maxKg !== null && ((load?.g ?? 0) + kitLoad) / 1000 > maxKg) err(`container ${text(container.id)}: carries ${(((load?.g ?? 0) + kitLoad) / 1000).toFixed(1)} kg, limit ${maxKg} kg`);
    if (liters !== null && (load?.l ?? 0) + kitLiters > liters) err(`container ${text(container.id)}: holds ${((load?.l ?? 0) + kitLiters).toFixed(2)} L, capacity ${liters} L`);
  }
  for (const kit of recs(t.kits)) {
    const where = `kit ${text(kit.id)}`;
    need(`${where}.container`, kit.container, "container");
    const table = text(kit.tableKit);
    const pieces = recs(kit.pieces);
    const count = pieces.reduce((a, p) => a + (num(p.qty) ?? 0), 0);
    if (table) {
      const row = rec(gearKits[table]);
      if (!gearKits[table]) err(`${where}: tableKit "${table}" is not in gear.kits`);
      else if (num(row.piece_count) !== num(kit.pieceCount)) err(`${where}: pieceCount ${text(String(kit.pieceCount))} differs from the table (${text(String(row.piece_count))})`);
      if (table === "mechanic_toolbox_45" && num(kit.pieceCount) !== 45) err(`${where}: the mechanic's toolbox must have 45 pieces`);
    } else if (count !== num(kit.pieceCount)) err(`${where}: pieces sum to ${count}, pieceCount says ${text(String(kit.pieceCount))}`);
  }
  for (const v of recs(t.vehicles)) {
    const where = `vehicle ${text(v.id)}`;
    need(`${where}.owner`, v.owner, "character", "place");
    need(`${where}.location`, v.location, "place");
    if (v.class !== undefined) {
      const row = rec(classes[text(v.class)]);
      if (!classes[text(v.class)]) err(`${where}: class "${text(v.class)}" is not in vehicles.classes`);
      const miles = num(v.odometerMiles);
      if (row.domain === "road" && (miles === null || miles < 0 || miles > 400000)) err(`${where}: odometer is implausible`);
      if (row.domain !== "road" && num(v.engineHours) === null) err(`${where}: marine and off-road classes need engineHours`);
      const oil = num(v.lastOilChangeMiles);
      if (oil !== null && (miles === null || oil > miles || miles - oil > 15000)) err(`${where}: lastOilChangeMiles is inconsistent with the odometer`);
    }
    const fuel = num(v.fuelFraction);
    if (fuel !== null && (fuel < 0 || fuel > 1)) err(`${where}: fuelFraction must be 0-1`);
    if (v.assignedTo != null) {
      need(`${where}.assignedTo`, rec(v.assignedTo).to, "character");
    }
  }
  const denominations = new Map(recs(rec(t.currency).denominations).map((d) => [text(d.id), num(d.value) ?? 0]));
  for (const a of recs(t.accounts)) {
    const where = `account ${text(a.id)}`;
    need(`${where}.owner`, a.owner, "character", "place");
    if (a.container !== undefined) need(`${where}.container`, a.container, "container");
    for (const field of ["balance", "owedCents", "limitCents", "principalCents", "paymentCents"]) {
      if (a[field] !== undefined && !Number.isInteger(a[field])) err(`${where}: ${field} must be an integer`);
    }
    if (a.coins !== undefined) {
      let sum = 0;
      for (const [d, count] of Object.entries(rec(a.coins))) {
        if (!denominations.has(d)) err(`${where}: unknown denomination "${d}"`);
        sum += (denominations.get(d) ?? 0) * (num(count) ?? 0);
      }
      if (sum !== a.balance) err(`${where}: coins sum to ${sum}, balance says ${text(String(a.balance))}`);
    }
    if (a.kind === "card" && (num(a.owedCents) ?? 0) > (num(a.limitCents) ?? 0)) err(`${where}: balance exceeds the limit`);
    if (a.kind === "loan") {
      const r = (num(a.aprPct) ?? 0) / 1200;
      const n = num(a.remainingMonths) ?? 1;
      const expected = ((num(a.principalCents) ?? 0) * r) / (1 - (1 + r) ** -n);
      if (Math.abs(expected - (num(a.paymentCents) ?? 0)) > expected * 0.015) err(`${where}: payment ${text(String(a.paymentCents))} is not near the amortized ${expected.toFixed(0)}`);
    }
    if (a.kind === "brokerage") {
      const holdings = num(a.holdingsCents);
      if (holdings === null || !Number.isInteger(holdings) || holdings <= 0) err(`${where}: a brokerage needs holdingsCents, its market value at the start in whole cents`);
      const symbol = text(a.symbol) || "broad_us_equity_index";
      if (!(symbol in rec(rec(rec(data.rows("economy.finance")).investing).values))) err(`${where}: symbol "${symbol}" is not in the finance table's investing recipes`);
    } else if (a.holdingsCents !== undefined || a.symbol !== undefined) err(`${where}: only a brokerage holds a symbol`);
  }
  for (const p of recs(t.prices)) {
    const band = rec(p.band);
    const [lo, mid, hi] = [num(band.min), num(band.typical), num(band.max)];
    if (lo === null || mid === null || hi === null || !(lo <= mid && mid <= hi)) err(`price ${text(p.id)}: band is not ordered`);
  }

  // ---------------------------------------------------------------- tracks
  const tracks = recs(t.tracks);
  const count = (kind: string) => tracks.filter((x) => x.kind === kind).length;
  if (count("quest") < 2) err("needs at least 2 quests");
  if (count("secret") < 1) err("needs at least 1 secret ladder");
  if (count("puzzle") < 1) err("needs at least 1 puzzle");
  let stageCount = 0;
  const leaks: string[] = [];
  const knownToPov = new Set(
    [...recs(t.rules).flatMap((r) => recs(r.do)), ...recs(t.actions).flatMap((a) => recs(a.effects)), ...tracks.flatMap((tr) => Object.values(rec(tr.stages)).flatMap((s) => [...recs(rec(s).effects), ...recs(rec(s).rewards)]))]
      .filter((e) => e.type === "link" && rec(e.args).rel === "knows" && rec(e.args).from === "pov")
      .map((e) => text(rec(e.args).to)),
  );
  for (const track of tracks) {
    const where = `track ${text(track.id)}`;
    const stages = rec(track.stages);
    stageCount += Object.keys(stages).length;
    if (!TRACK_KINDS.includes(text(track.kind))) err(`${where}: bad kind`);
    if (!VISIBILITY.includes(text(track.visibility))) err(`${where}: bad visibility`);
    if (!(text(track.start) in stages)) err(`${where}: start stage is missing`);
    if (track.owner !== undefined) {
      // An agenda belongs to a character; a puzzle's owner is the thing it is about, which the player must come to know (a `knows` link) before the puzzle shows in Quests.
      if (track.kind === "puzzle") {
        need(`${where}.owner`, track.owner, "character", "item", "container", "vehicle");
        if (track.visibility === "known_by" && !knownToPov.has(text(track.owner))) err(`${where}: the player is never linked as knowing "${text(track.owner)}" (a stage or rule effect {type: "link", rel: "knows", from: "pov"}), so the puzzle never shows in Quests`);
      } else need(`${where}.owner`, track.owner, "character");
    }
    if (track.kind === "puzzle" && track.visibility === "known_by" && track.owner === undefined) err(`${where}: a known_by puzzle needs an owner the player comes to know, or it never shows in Quests`);
    const targets = new Map<string, string[]>();
    let terminal = 0;
    let truths = 0;
    let answers = 0;
    for (const [stageId, raw] of Object.entries(stages)) {
      const stage = rec(raw);
      const next = recs(stage.next);
      if (next.length === 0) terminal++;
      targets.set(stageId, [...next.map((n) => text(n.to)), ...(isRec(stage.fail) ? [text(stage.fail.to)] : [])]);
      for (const n of next) {
        if (!(text(n.to) in stages)) err(`${where}.${stageId}: next → "${text(n.to)}" does not exist`);
        if (text(n.when).length < 10) err(`${where}.${stageId}: next lacks a plain-language condition`);
      }
      if (isRec(stage.fail) && !(text(stage.fail.to) in stages)) err(`${where}.${stageId}: fail → "${text(stage.fail.to)}" does not exist`);
      if (!text(stage.label)) err(`${where}.${stageId}: no label`);
      // A quest waits unseen on a bare start stage (no cue, objectives or answer) until its trigger; every other stage that can move on needs objectives.
      const bareStart = stageId === text(track.start) && !text(stage.cue) && list(stage.objectives).length === 0 && !isRec(stage.answer);
      if (track.kind === "quest" && next.length > 0 && list(stage.objectives).length === 0 && !bareStart) err(`${where}.${stageId}: quest stages need objectives`);
      if (text(stage.truth)) {
        truths++;
        const terms = list(stage.leakTerms).map(text);
        if (terms.length < 2) err(`${where}.${stageId}: secret truth needs at least two leakTerms`);
        for (const term of terms) {
          if (!text(stage.truth).toLowerCase().includes(term.toLowerCase())) err(`${where}.${stageId}: leakTerm "${term}" does not occur in the truth`);
          leaks.push(term);
        }
      }
      if (isRec(stage.answer)) {
        answers++;
        if (list(stage.answer.expect).length === 0) err(`${where}.${stageId}: answer.expect is empty`);
        if (list(stage.hints).length < 2) err(`${where}.${stageId}: a puzzle needs a hint ladder of at least two`);
        const threshold = num(rec(stage.answer.decision).threshold);
        if (isRec(stage.answer.decision) && (threshold === null || threshold <= 0 || threshold > 1)) err(`${where}.${stageId}: decision threshold must be in (0,1]`);
      }
      for (const effect of [...recs(stage.effects), ...recs(stage.rewards)]) checkEffect(effect, `${where}.${stageId}`);
    }
    const seen = new Set<string>([text(track.start)]);
    for (const queue = [text(track.start)]; queue.length; ) {
      for (const n of targets.get(queue.shift() ?? "") ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
    }
    for (const stageId of Object.keys(stages)) if (!seen.has(stageId)) err(`${where}: stage "${stageId}" cannot be reached from the start`);
    if (terminal === 0 && track.kind !== "agenda") err(`${where}: no terminal stage`);
    if (track.kind === "secret" && truths === 0) err(`${where}: a secret ladder needs a stage with a truth`);
    if (track.kind === "puzzle" && answers === 0) err(`${where}: a puzzle needs an answer check`);
    if (track.kind === "quest" && !Object.values(stages).some((s) => recs(rec(s).rewards).length > 0)) err(`${where}: a quest needs rewards`);
    if (track.kind === "quest" && !Object.values(stages).some((s) => text(rec(s).gate).length >= 10)) err(`${where}: a quest needs at least one gated stage`);
    if (Object.keys(stages).length < 2) err(`${where}: needs at least two stages`);
  }

  function checkEffect(effect: Rec, where: string, needText = true): void {
    const type = text(effect.type);
    const engineArgs = ENGINE_EFFECTS[type];
    if (engineArgs && !(type === "move" && effect.args !== undefined && rec(effect.args).who !== undefined)) {
      const args = rec(effect.args);
      for (const key of engineArgs) {
        if (key === "to" && type === "move") need(`${where}.to`, args.to, "place");
        else if (key === "flag") continue;
        else if (args[key] !== "pov") need(`${where}.${key}`, args[key], "character", "item", "container", "vehicle", "account", "place");
      }
      return;
    }
    const idArgs = EFFECTS[type];
    if (!idArgs) return err(`${where}: unknown effect type "${type}"`);
    if (needText && !text(effect.text)) err(`${where}: ${type} effect has no text`);
    const args = rec(effect.args);
    for (const key of idArgs) {
      if (key === "flag") {
        if (!flagIds.has(text(args.flag))) err(`${where}: flag "${text(args.flag)}" is not declared`);
      } else if (key === "to" && args.to === "pov") {
        // the player character
      } else if (key === "region" || key === "scope") {
        need(`${where}.${key}`, args[key], "place");
      } else if (key === "who" || key === "toward") {
        need(`${where}.${key}`, args[key], "character", "group");
      } else if (key === "to" || key === "from") {
        need(`${where}.${key}`, args[key], "character", "account", "place", "container", "item");
      } else if (key === "track") {
        need(`${where}.track`, args.track, "track");
        if (args.stage !== undefined && !trackStages.has(`${text(args.track)}.${text(args.stage)}`)) err(`${where}: stage "${text(args.stage)}" is not in ${text(args.track)}`);
      } else {
        need(`${where}.${key}`, args[key], key === "employer" ? "place" : key === "route" ? "route" : key === "item" ? "item" : key === "vehicle" ? "vehicle" : "place");
      }
    }
  }

  // ---------------------------------------------------------------- text references
  const checkRefs = (value: string, where: string) => {
    for (const m of value.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const ref = m[1] ?? "";
      if (ref.startsWith("flag:")) {
        if (!flagIds.has(ref.slice(5))) err(`${where}: [[${ref}]] is not a declared flag`);
      } else if (ref.includes(".")) {
        if (!trackStages.has(ref)) err(`${where}: [[${ref}]] is not a track stage`);
      } else if (!registry.has(ref)) err(`${where}: [[${ref}]] is not a known id`);
    }
  };
  for (const key of ["tracks", "rules", "clues"]) for (const [path, value] of strings(t[key], key)) checkRefs(value, path);

  // ---------------------------------------------------------------- rules and clues
  const rules = recs(t.rules);
  if (rules.length < 4 || rules.length > 12) err(`${rules.length} rules; expected 4-12`);
  for (const r of rules) {
    const where = `rule ${text(r.id)}`;
    const on = rec(r.on);
    const keys = Object.keys(on);
    if (keys.length !== 1 || !["tick", "enter", "at"].includes(keys[0] ?? "")) err(`${where}: "on" needs exactly one of tick, enter, at (the engine has no custom events)`);
    if (on.enter !== undefined) need(`${where}.on.enter`, on.enter, "place");
    if (on.tick !== undefined && !["turn", "slot", "day"].includes(text(on.tick))) err(`${where}: bad tick`);
    if (on.at !== undefined && !parseDate(on.at)) err(`${where}: "at" is not a valid date-time`);
    if (text(r.trigger).length < 15) err(`${where}: trigger needs a plain-language sentence`);
    if (!text(r.when)) err(`${where}: when is empty (use "always")`);
    if (recs(r.do).length === 0) err(`${where}: no effects`);
    for (const e of recs(r.do)) checkEffect(e, where);
  }
  for (const c of recs(t.clues)) {
    const where = `clue ${text(c.id)}`;
    need(`${where}.track`, c.track, "track");
    need(`${where}.where`, c.where, "place");
    if (c.item !== undefined) need(`${where}.item`, c.item, "item");
    if (c.stage === null || c.redHerring === true) {
      if (c.redHerring !== true) err(`${where}: a clue with no stage must be marked redHerring`);
    } else if (!trackStages.has(`${text(c.track)}.${text(c.stage)}`)) err(`${where}: stage "${text(c.stage)}" is not in ${text(c.track)}`);
    if (text(c.finds).length < 40 || text(c.requires).length < 10) err(`${where}: needs a requires condition and a finds text`);
  }

  // ---------------------------------------------------------------- formulas and actions (the engine's vocabulary)
  const clueIds = new Set(recs(t.clues).map((c) => text(c.id)));
  const storyNames = new Set([...flagIds, ...clueIds]);
  const functions = new Set([...BUILTIN_FUNCTIONS, ...engine.formulas.keys()]);
  const bareNames = new Set([...BARE_NAMES, ...[...registry.entries()].filter(([, k]) => ["character", "place", "item", "container", "vehicle", "account", "track"].includes(k)).map(([id]) => id)]);
  const ID_ARGS: Record<string, number[]> = { at: [0, 1], carries: [0, 1], since: [0], stage: [0], regard: [0, 1], fuel_pct: [0], field: [0], weather: [0], count_at: [0], has_item: [0, 1], place: [0] };
  const walk = (n: Node, where: string, params: ReadonlySet<string>): void => {
    if (n.k === "id") {
      if (!bareNames.has(n.path[0] ?? "") && !params.has(n.path[0] ?? "")) err(`${where}: unknown name "${n.path.join(".")}"`);
    } else if (n.k === "call") {
      if (!functions.has(n.name)) err(`${where}: unknown function ${n.name}()`);
      for (const [i, arg] of n.args.entries()) {
        if (arg.k === "str" && (ID_ARGS[n.name] ?? []).includes(i) && !registry.has(arg.v)) err(`${where}: ${n.name}() names "${arg.v}", which is not a known id`);
        walk(arg, where, params);
      }
    } else if (n.k === "un") walk(n.a, where, params);
    else if (n.k === "bin") (walk(n.a, where, params), walk(n.b, where, params));
    else if (n.k === "tern") (walk(n.c, where, params), walk(n.a, where, params), walk(n.b, where, params));
  };
  const formula = (source: unknown, where: string, params: ReadonlySet<string> = new Set()): void => {
    const src = text(source);
    if (!src) return err(`${where}: missing formula`);
    for (const m of src.matchAll(/\bstory\.([a-z][a-z0-9_]*)/g)) if (!storyNames.has(m[1] ?? "")) err(`${where}: story.${m[1]} is not a declared flag or clue`);
    for (const m of src.matchAll(/@(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/g)) if (!parseDate(m[1])) err(`${where}: @${m[1]} is not a date-time in the calendar`);
    for (const m of src.matchAll(/stage\('([a-z0-9_]+)'\)\s*[!=]=\s*'([a-z0-9_]+)'/g)) if (!trackStages.has(`${m[1]}.${m[2]}`)) err(`${where}: ${m[1]} has no stage ${m[2]}`);
    const plain = src.replace(/@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g, "0").replace(/\bstory\.[a-z][a-z0-9_]*/g, "flag('x')");
    try {
      walk(compile(plain).root, where, params);
    } catch (e) {
      err(`${where}: does not parse (${e instanceof Error ? e.message : "?"}): ${src}`);
    }
  };
  const argFormulas = (effect: Rec, where: string, params: ReadonlySet<string>): void => {
    for (const [key, value] of Object.entries(rec(effect.args))) if (typeof value === "string" && value.startsWith("=")) formula(value.slice(1), `${where}.${key}`, params);
  };
  for (const track of tracks) {
    for (const [stageId, raw] of Object.entries(rec(track.stages))) {
      const stage = rec(raw);
      const where = `track ${text(track.id)}.${stageId}`;
      for (const [i, n] of recs(stage.next).entries()) formula(n.expr, `${where}.next[${i}]`);
      if (stage.fail !== undefined) formula(rec(stage.fail).expr, `${where}.fail`);
      if (stage.gate !== undefined) formula(stage.gateExpr, `${where}.gate`);
      const objectives = list(stage.objectives);
      const exprs = list(stage.objectiveExprs);
      if (track.kind === "quest" || track.kind === "puzzle") {
        if (exprs.length !== objectives.length) err(`${where}: ${objectives.length} objectives but ${exprs.length} objectiveExprs`);
        for (const [i, e] of exprs.entries()) formula(e, `${where}.objectiveExprs[${i}]`);
      } else if (exprs.length > 0) err(`${where}: only quest and puzzle stages carry objectiveExprs`);
      for (const e of [...recs(stage.effects), ...recs(stage.rewards)]) argFormulas(e, where, new Set());
    }
  }
  for (const r of rules) {
    const where = `rule ${text(r.id)}`;
    if (r.handledBy !== undefined) {
      if (!["economy.bills", "economy.payroll"].includes(text(r.handledBy))) err(`${where}: unknown handledBy "${text(r.handledBy)}"`);
    } else if (text(r.when) !== "always") formula(r.whenExpr, `${where}.when`);
    for (const e of recs(r.do)) argFormulas(e, where, new Set());
  }
  for (const a of recs(t.actions)) {
    const where = `action ${text(a.id)}`;
    const params = new Set(Object.keys(rec(a.params)));
    if (text(a.label).length < 8) err(`${where}: needs a label`);
    if (!(num(a.duration) !== null && (num(a.duration) ?? 0) > 0)) err(`${where}: duration must be positive minutes`);
    if (list(a.lexicon).length === 0 || !text(a.observable)) err(`${where}: needs a lexicon and an observable label`);
    if (list(a.requires).length === 0) err(`${where}: needs at least one requirement`);
    for (const [i, r] of list(a.requires).entries()) formula(r, `${where}.requires[${i}]`, params);
    if (recs(a.effects).length === 0) err(`${where}: no effects`);
    for (const e of recs(a.effects)) {
      checkEffect(e, where, false);
      argFormulas(e, where, params);
    }
  }
  for (const c of recs(t.clues)) {
    const where = `clue ${text(c.id)}`;
    formula(c.requiresExpr, `${where}.requiresExpr`);
    if (text(rec(c.action).label).length < 8) err(`${where}: needs an action label`);
    for (const id of list(c.reveals)) if (!has(id, "item")) err(`${where}.reveals: "${text(id)}" is not an item`);
  }
  for (const ch of recs(t.characters)) if (!WEALTH.includes(text(ch.wealth))) err(`character ${text(ch.id)}: wealth must be one of ${WEALTH.join(", ")}`);
  const sheets = rec(t.sheets);
  for (const c of recs(t.characters)) for (const stat of Object.keys(rec(c.sheet))) if (!recs(sheets.stats).some((s) => text(s.id) === stat)) err(`character ${text(c.id)}: stat "${stat}" is not in sheets.stats`);
  for (const [id, d] of Object.entries(rec(sheets.derived))) if (!text(rec(d).label) || !text(rec(d).formula)) err(`sheets.derived.${id}: needs a label and a formula`);
  const currency = rec(t.currency);
  if (!text(currency.code) || !text(currency.symbol) || !text(currency.minorUnit) || !text(currency.format)) err("currency needs code, symbol, minorUnit and format");
  const decimals = num(currency.decimals);
  if (decimals === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 6) err("currency.decimals must be a whole number from 0 to 6");
  for (const m of text(currency.format).matchAll(/\{([a-z]+)\}/g)) if (!["sign", "symbol", "code", "amount", "major", "minor"].includes(m[1] ?? "")) err(`currency.format: unknown placeholder {${m[1]}}`);
  for (const price of recs(t.prices)) if (!PRICE_CATEGORIES.includes(text(price.category))) err(`price ${text(price.id)}: category "${text(price.category)}" is not an economy.categories row`);
  // A world with its own currency prices every category in it, and each of its prices sits inside its category's band.
  const categories = rec(t.categories);
  if (t.dataPack && Object.keys(categories).length > 0) err("categories replace the Modern US category bands; only a world with no data pack has its own");
  if (!t.dataPack) {
    for (const id of PRICE_CATEGORIES) {
      const cat = rec(categories[id]);
      const band = rec(cat.band);
      const [min, typical, max] = [num(band.min), num(band.typical), num(band.max)];
      if (!text(cat.name) || !text(cat.basis)) err(`categories.${id}: needs a name and a basis`);
      if (min === null || typical === null || max === null || !Number.isInteger(min) || !Number.isInteger(typical) || !Number.isInteger(max) || min < 0 || min > typical || typical > max) err(`categories.${id}: band needs whole base units with 0 ≤ min ≤ typical ≤ max`);
    }
    for (const id of Object.keys(categories)) if (!PRICE_CATEGORIES.includes(id)) err(`categories.${id}: not an economy.categories row`);
    for (const price of recs(t.prices)) {
      const band = rec(rec(categories[text(price.category)]).band);
      const own = rec(price.band);
      if ((num(own.min) ?? 0) < (num(band.min) ?? 0) || (num(own.max) ?? 0) > (num(band.max) ?? Infinity)) err(`price ${text(price.id)}: band ${num(own.min)}–${num(own.max)} is outside its category ${text(price.category)}'s ${num(band.min)}–${num(band.max)}`);
    }
  }

  // ---------------------------------------------------------------- stocked containers and the world's own items
  const ownItems = recs(t.gearItems);
  if (ownItems.length > 0 && t.dataPack) err("gearItems replace the world's gear.items table; only a world with no data pack has its own");
  const gearRows = ownItems.length > 0 ? ownItems.map((g) => ({ id: text(g.id), category: text(g.category) })) : Object.entries(gearItems).map(([id, row]) => ({ id, category: text(rec(row).category) }));
  for (const g of ownItems) {
    const where = `gearItem ${text(g.id)}`;
    if (!text(g.name)) err(`${where}: needs a name`);
    if (!GEAR_CATEGORIES.includes(text(g.category))) err(`${where}: category "${text(g.category)}" is not one of ${GEAR_CATEGORIES.join(", ")}`);
    if (!Number.isInteger(num(g.weightG)) || (num(g.weightG) ?? 0) <= 0) err(`${where}: weightG must be a positive whole number of grams`);
    if ((num(g.volumeL) ?? 0) <= 0) err(`${where}: volumeL must be positive`);
    const band = rec(g.priceBand);
    const [lo, mid, hi] = [num(band.min), num(band.typical), num(band.max)];
    if (lo === null || mid === null || hi === null || !Number.isInteger(lo) || !Number.isInteger(mid) || !Number.isInteger(hi) || lo < 1 || lo > mid || mid > hi) err(`${where}: priceBand needs whole minor units with 1 <= min <= typical <= max`);
  }
  for (const c of [...recs(t.containers), ...recs(t.items)]) {
    if (c.stock === undefined) continue;
    const where = `${text(c.id)}.stock`;
    if (!GEAR_CATEGORIES.includes(text(c.stock))) err(`${where}: "${text(c.stock)}" is not a gear.items category`);
    else if (gearRows.filter((g) => g.category === c.stock).length < 2) err(`${where}: fewer than two ${text(c.stock)} items to sample from`);
    if (c.tier !== undefined && !["supporting", "background"].includes(text(c.tier))) err(`${text(c.id)}.tier: must be supporting or background`);
  }

  // ---------------------------------------------------------------- weather
  const climates = recs(rec(t.weather).climates);
  if (climates.length === 0) err("no weather climate");
  const climateCovers = new Set(climates.flatMap((c) => [text(c.region), ...list(c.appliesTo).map(text)]));
  for (const p of places) if (p.parent === undefined && !climateCovers.has(text(p.id))) err(`root place ${text(p.id)} has no climate`);
  for (const climate of climates) {
    const where = `climate ${text(climate.region)}`;
    need(`${where}.region`, climate.region, "place");
    for (const extra of list(climate.appliesTo)) need(`${where}.appliesTo`, extra, "place");
    const states = new Set(recs(climate.states).map((s) => text(s.id)));
    const covered = new Set<number>();
    for (const season of recs(climate.seasons)) {
      for (const month of list(season.months).map((n) => num(n) ?? 0)) {
        if (covered.has(month)) err(`${where}: month ${month} is in two seasons`);
        covered.add(month);
      }
      for (const [state, weight] of Object.entries(rec(season.weights))) {
        if (!states.has(state)) err(`${where}: weight for unknown state "${state}"`);
        if ((num(weight) ?? 0) <= 0) err(`${where}: weights must be positive`);
      }
    }
    for (let m = 1; m <= monthLengths.length; m++) if (!covered.has(m)) err(`${where}: month ${m} has no season`);
  }

  // ---------------------------------------------------------------- lore and leaks
  const lore = recs(t.lore);
  if (lore.length < 12) err(`${lore.length} lore entries; expected at least 12`);
  for (const entry of lore) {
    const where = `lore ${text(entry.id)}`;
    if (text(entry.text).length < 120) err(`${where}: text is too short`);
    if (list(entry.keys).length === 0) err(`${where}: no keys`);
    if (entry.about !== undefined) need(`${where}.about`, entry.about);
  }
  for (const item of npcs) if (!lore.some((e) => e.about === item.id)) f.warn(`character ${text(item.id)} has no lore entry`);
  const visible: [string, string][] = [];
  for (const key of ["lore", "characters", "start"]) for (const [path, value] of strings(t[key], key)) visible.push([path, value]);
  for (const key of ["places", "items", "containers", "vehicles"]) {
    for (const [i, item] of recs(t[key]).entries()) {
      if (item.visibility === "secret" || item.hidden === true) continue;
      for (const [path, value] of strings(item, `${key}[${i}]`)) visible.push([path, value]);
    }
  }
  for (const [path, value] of [["blurb", text(t.blurb)] as [string, string]]) visible.push([path, value]);
  for (const [path, value] of visible) {
    const lower = value.toLowerCase();
    for (const term of leaks) if (lower.includes(term.toLowerCase())) err(`secret leak: "${term}" appears in ${path}`);
    for (const word of BANNED) if (new RegExp(`\\b${word}`, "i").test(lower)) err(`banned word "${word}" in ${path}`);
  }
  for (const [path, value] of strings(t)) if (/TODO|TBD|FIXME|lorem ipsum|placeholder/i.test(value) && !path.endsWith("note")) err(`placeholder text in ${path}`);

  const counts: Record<string, number | string> = {
    places: places.length, routes: recs(t.routes).length, "route modes": new Set(recs(t.routes).flatMap((r) => Object.keys(rec(r.modes)))).size,
    grids: gridById.size, "grid cells": gridCells, "blocked cells": blockedCells, zones: zoneCount,
    characters: `${npcs.length} NPCs + POV (${agents.length} agents)`, "schedule blocks": scheduleBlocks, "regard entries": regardPairs,
    items: recs(t.items).length, containers: recs(t.containers).length, kits: recs(t.kits).length, vehicles: recs(t.vehicles).length, accounts: recs(t.accounts).length,
    bills: recs(t.bills).length, prices: recs(t.prices).length,
    tracks: `${count("quest")} quests, ${count("secret")} secret, ${count("puzzle")} puzzle, ${count("agenda")} agenda (${stageCount} stages)`,
    clues: recs(t.clues).length, rules: rules.length, climates: climates.length, lore: lore.length, flags: flagIds.size, "unique ids": registry.size,
  };
  return { findings: f, counts };
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2).map((p) => resolve(p))
  : readdirSync(HERE).filter((n) => n.endsWith(".json")).map((n) => join(HERE, n));
let failed = false;
for (const file of files) {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const { findings, counts } = validate(rec(parsed), file);
  console.log(`\n${basename(file)} (${dirname(file) === HERE ? "templates" : dirname(file)})`);
  for (const [key, value] of Object.entries(counts)) console.log(`  ${key.padEnd(16)} ${value}`);
  for (const w of findings.warnings) console.log(`  warning: ${w}`);
  for (const e of findings.errors) console.log(`  ERROR: ${e}`);
  console.log(findings.errors.length === 0 ? "  OK: no errors" : `  FAILED: ${findings.errors.length} error(s)`);
  failed ||= findings.errors.length > 0;
}
process.exit(failed ? 1 : 0);
