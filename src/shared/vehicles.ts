// Vehicles as the engine, the agents and the UI share them (DESIGN §9.3): the class domains, a class
// as the vehicle picker lists it, what a made vehicle is made with (`vehicles.spawn`), how words name
// a class (`matchVehicleClass`, which `vehicles.priced`, `vehicles.named` and the Curator's reads use), and whether a
// world flies at all (`worldHasAir`: aircraft travel only over routes the world authors for the air).
// Pure.

import type { EntityId, PlaceId } from "./ids";
import { isRecord, type JsonObject } from "./json";
import type { DataTable, TableRow } from "./tables";
import type { WorldDoc } from "./world";

/** Where a class goes: roads, off-road trails, water, or the air (authored air routes only). */
export const VEHICLE_DOMAINS = ["road", "offroad", "marine", "air"] as const;
export type VehicleDomain = (typeof VEHICLE_DOMAINS)[number];

/** How the picker and the Curator's reads head each domain's classes. */
export const VEHICLE_DOMAIN_LABEL: Readonly<Record<VehicleDomain, string>> = { road: "On the road", offroad: "Off road", marine: "On the water", air: "In the air" };

/** A class row's domain: one of the four, else road. */
export function vehicleDomainOf(row: Readonly<TableRow> | undefined): VehicleDomain {
  const d = row?.domain;
  return d === "offroad" || d === "marine" || d === "air" ? d : "road";
}

/** What a made vehicle says about itself: the vehicle kind's own fields, each optional. */
export interface VehicleDetails {
  make?: string;
  model?: string;
  year?: number;
  colour?: string;
  plate?: string;
  odometer_mi?: number;
  engine_hours?: number;
  condition?: number;
  fuel_pct?: number;
  /** What it would sell for, when the story or the GM says; else its class's typical used price. */
  value?: number;
  /** Its free specs, as the story or the owner tells them (`vehicleSpecsOf`). */
  specs?: VehicleSpec[];
}

/** One of a vehicle's free specs: a label and its value ("Engine": "5.0L V8", "Seats": "5"). */
export interface VehicleSpec {
  label: string;
  value: string;
}

/** At most this many specs a vehicle keeps. */
export const VEHICLE_SPECS_MAX = 24;
/** At most this many characters a spec's label, or its value, keeps. */
export const VEHICLE_SPEC_TEXT_MAX = 80;

/** Specs from outside data (a field, a fix, a tool's arguments): each with a label and a value, trimmed and capped; null when it isn't a list. */
export function vehicleSpecsOf(v: unknown): VehicleSpec[] | null {
  if (!Array.isArray(v)) return null;
  const words = (x: unknown): string => (typeof x === "string" ? x : typeof x === "number" && Number.isFinite(x) ? String(x) : "").replace(/\s+/g, " ").trim().slice(0, VEHICLE_SPEC_TEXT_MAX);
  const out: VehicleSpec[] = [];
  for (const s of v) {
    if (out.length >= VEHICLE_SPECS_MAX) break;
    if (!isRecord(s)) continue;
    const label = words(s.label);
    const value = words(s.value);
    if (label !== "" && value !== "") out.push({ label, value });
  }
  return out;
}

/** A spec as a line tells it: "Engine: 5.0L V8". */
export function specWords(spec: VehicleSpec): string {
  return `${spec.label}: ${spec.value}`;
}

/** The detail keys a make or a purchase may set, in the order the vehicle kind lists them. */
export const VEHICLE_DETAIL_KEYS = ["make", "model", "year", "colour", "plate", "odometer_mi", "engine_hours", "condition", "fuel_pct", "value"] as const satisfies readonly (keyof VehicleDetails)[];

/** A vehicle to make (`vehicles.spawn`): its class, whose it is, where it stands (or what holds it) and its home base. */
export interface VehicleSpawn {
  /** A `vehicles.classes` row id. */
  class: string;
  /** Its name; absent, its make and model, else the class's short name. */
  name?: string;
  owner: EntityId | null;
  place?: PlaceId | null;
  /** A vehicle it rides on (a car on a hauler), in place of a place. */
  holder?: EntityId | null;
  /** Its home base; absent, the owner's home, else where it stands. */
  home?: PlaceId | null;
  /** New from a dealer: no miles, full condition, the class's new price. */
  new?: boolean;
  details?: VehicleDetails;
  /** Disambiguates spawns that share every other input. */
  salt?: string;
  /** Fields it is made with as given (a purchase's `got` and `made`). */
  fields?: JsonObject;
}

/** One class as the vehicle picker lists it, with the make, model and year a new pick starts from. */
export interface VehicleClassChoice {
  id: string;
  name: string;
  domain: VehicleDomain;
  make?: string;
  model?: string;
  year?: number;
  /** The class's typical used price, in minor units. */
  priceCents?: number;
}

/** What the picker hands back: the class and the make, model and year as the player left them. */
export interface VehiclePick {
  id: string;
  name: string;
  domain: VehicleDomain;
  make: string;
  model: string;
  year: number;
}

/** What words buy (`vehicles.priced`): the class they name, a name for the vehicle, whether it is new, and the class's band and typical price for it. */
export interface VehiclePrice {
  class: string;
  name: string;
  new: boolean;
  band: { min: number; typical: number; max: number };
  cents: number;
}

/** The vehicles pack's world config (`packs.vehicles.config`): yearly registration is derived only where it is on (DESIGN §25.5). */
export interface VehiclesConfig {
  registration: boolean;
}

export function vehiclesConfigOf(world: Pick<WorldDoc, "packs">): VehiclesConfig {
  const raw = Object.prototype.hasOwnProperty.call(world.packs ?? {}, "vehicles") ? world.packs.vehicles?.config : undefined;
  return { registration: isRecord(raw) && raw.registration === true };
}

/** A class's name without its parenthesis ("Compact car (Civic / Corolla class)" → "Compact car"). */
export function shortClassName(name: string): string {
  const cut = name.replace(/\s*\(.*\)\s*$/, "").trim();
  return cut === "" ? name.trim() : cut;
}

/** How old a used class price reads it (DESIGN §9.3 tables: about 3-5 years), as the picker's default year. */
export const USED_VEHICLE_AGE_YEARS = 4;

/**
 * A world's classes as the picker lists them, by domain then the table's order: each with its row's
 * make and model and a used one's year (`year` less `USED_VEHICLE_AGE_YEARS`); aircraft only where the
 * world flies (`air`).
 */
export function vehicleClassChoices(table: Pick<DataTable, "rows"> | undefined, opts: { year: number; air: boolean }): VehicleClassChoice[] {
  const out: VehicleClassChoice[] = [];
  for (const domain of VEHICLE_DOMAINS) {
    if (domain === "air" && !opts.air) continue;
    for (const [id, row] of Object.entries(table?.rows ?? {})) {
      if (!row || vehicleDomainOf(row) !== domain) continue;
      const used = row.price_used_cents;
      const price = isRecord(used) && typeof used.typical === "number" && Number.isFinite(used.typical) ? Math.round(used.typical) : undefined;
      out.push({
        id,
        name: typeof row.name === "string" && row.name.trim() !== "" ? row.name : id,
        domain,
        ...(typeof row.make === "string" ? { make: row.make } : {}),
        ...(typeof row.model === "string" ? { model: row.model } : {}),
        ...(Number.isFinite(opts.year) ? { year: Math.round(opts.year) - USED_VEHICLE_AGE_YEARS } : {}),
        ...(price !== undefined ? { priceCents: price } : {}),
      });
    }
  }
  return out;
}

/** Whether a world flies: a route, or a map's link, with an `air` leg. */
export function worldHasAir(world: Pick<WorldDoc, "routes"> & { readonly maps?: WorldDoc["maps"] }): boolean {
  for (const r of Object.values(world.routes ?? {})) if (r && isRecord(r.modes) && r.modes.air !== undefined) return true;
  for (const m of Object.values(world.maps ?? {})) if (m?.links?.some((l) => l.mode === "air")) return true;
  return false;
}

/** Words as the matcher reads them: lower case, hyphens and punctuation as spaces, a plural's `s` dropped. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w !== "")
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/** Whether `phrase`'s words run, in order and together, inside `words`. */
function within(words: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > words.length) return false;
  for (let i = 0; i + phrase.length <= words.length; i++) if (phrase.every((w, j) => words[i + j] === w)) return true;
  return false;
}

/** Whether `phrase`'s words are the last of `words`, or the last before a model number ("Cessna 172"). */
function ends(words: readonly string[], phrase: readonly string[]): boolean {
  let bare = words.length;
  while (bare > 0 && /^\d+$/.test(words[bare - 1] ?? "")) bare--;
  return phrase.length > 0 && [words.length, bare].some((end) => phrase.length <= end && phrase.every((w, j) => words[end - phrase.length + j] === w));
}

/**
 * The class words name (`vehicles.priced`, DESIGN §9.5): the row whose id, short name or one of its
 * `aliases` runs inside the words with the most words, a tie to the table's first; null when none.
 * `ending`: only a name that ends the words, or ends them before a model number, as a purchase's
 * main noun names what it buys (`vehicles.named`: "flatbed truck", "jet ski", never "plane ticket").
 */
export function matchVehicleClass(words: string, table: Pick<DataTable, "rows"> | undefined, opts: { ending?: boolean } = {}): string | null {
  const said = tokens(words);
  if (said.length === 0) return null;
  const fits = opts.ending === true ? ends : within;
  let best: { id: string; size: number } | null = null;
  for (const [id, row] of Object.entries(table?.rows ?? {})) {
    if (!row) continue;
    const names = [id.replace(/_/g, " "), typeof row.name === "string" ? shortClassName(row.name) : "", ...(Array.isArray(row.aliases) ? row.aliases.filter((a): a is string => typeof a === "string") : [])];
    for (const name of names) {
      const phrase = tokens(name);
      if (fits(said, phrase) && (best === null || phrase.length > best.size)) best = { id, size: phrase.length };
    }
  }
  return best?.id ?? null;
}

/** Whether words say the vehicle is new from a dealer ("a new pickup", "brand-new"), not used. */
export function saysNew(words: string): boolean {
  const said = tokens(words);
  if (said.some((w) => w === "used" || w === "secondhand" || w === "second" || w === "pre" || w === "old")) return false;
  return said.includes("new");
}

/** A name a bought vehicle goes by from the words ("a used flatbed truck" → "Flatbed truck"), else the class's short name. */
export function vehicleNameFrom(words: string, className: string): string {
  const cut = words
    .trim()
    .replace(/^(?:an?|the|my|our|his|her|their|one)\s+/i, "")
    .replace(/^(?:brand[\s-]new|new|used|second[\s-]hand|pre[\s-]owned|old)\s+/i, "")
    .trim();
  const name = cut === "" || /^[a-z0-9_]+$/.test(cut) && cut.includes("_") ? shortClassName(className) : cut;
  return name.charAt(0).toUpperCase() + name.slice(1);
}
