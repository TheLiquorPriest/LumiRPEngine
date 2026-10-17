// The neutral starter-template shape (`lre-template/v1`, data-src/templates/README.md), as far as the
// converter reads it. The files are checked by data-src/templates/validate.ts before they get here.

import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { Band, Visibility } from "../../src/shared/ids";
import type { DateRule } from "../../src/shared/world";

export interface TplEffect {
  type: string;
  text?: string;
  args: JsonObject;
}

export interface TplBlock {
  days: string[];
  start: string;
  end: string;
  place: string;
  activity: string;
  /** A school term or season: the block runs only from `from` to `until` (inclusive local dates), except on the named holidays. */
  term?: { from: string; until: string; except?: string[] };
}

export interface TplRegard {
  toward: string;
  axes: Record<string, number>;
}

export interface TplJob {
  employer: string | null;
  occupation: string | null;
  hourlyCents?: number;
  hoursPerWeek?: number;
  payFrequency?: string;
  payday?: string;
  depositTo?: string;
  shiftPattern?: string;
  selfEmployed?: boolean;
  retired?: boolean;
  tipped?: boolean;
  estimatedAnnualIncomeCents?: number;
  incomeMonthlyCents?: number;
}

export interface TplCharacter {
  id: string;
  name: string;
  /** `pov` marks the point-of-view character; everyone else names a band (the converted world's default tiers). */
  tier: "pov" | Band;
  agent?: boolean;
  age?: number;
  role: string;
  summary: string;
  traits?: string[];
  home?: string;
  location?: string;
  wealth: string;
  sheet?: Record<string, number>;
  schedule?: TplBlock[];
  regard?: TplRegard[];
  agenda?: string;
  goals?: { label: string; steps: string[] };
  occupation?: string | null;
  job?: TplJob;
  /** Away trips and vacations: date-times in the world's local clock; `place` is where the person goes. */
  trips?: { from: string; until: string; place: string; label: string }[];
}

export interface TplPlace {
  id: string;
  name: string;
  parent?: string;
  timeZone?: string;
  sceneType?: string;
  visibility?: Visibility;
  tags?: string[];
  description: string;
  grid?: string;
  cell?: { x: number; y: number };
}

export interface TplRoute {
  id: string;
  from: string;
  to: string;
  bidirectional: boolean;
  secret?: boolean;
  modes: Record<string, { minutes: number; distanceKm?: number; terrain?: string }>;
}

export interface TplGrid {
  id: string;
  place: string;
  width: number;
  height: number;
  cellMeters?: number;
  legend: Record<string, { terrain: string; blocked?: boolean; blockedFor?: string[] }>;
  rows: string[];
  zones: Record<string, number[][]>;
}

export interface TplItem {
  id: string;
  name: string;
  description: string;
  owner?: string;
  in?: string;
  worn?: boolean;
  slot?: string;
  weightG?: number;
  capacityL?: number;
  maxLoadKg?: number;
  fixed?: boolean;
  hidden?: boolean;
  visibility?: Visibility;
  tags?: string[];
  tableItem?: string;
  tableContainer?: string;
  /** A `gear.items` category sampled into the container when it is first opened at Gear 2 or more. */
  stock?: "carried" | "clothing" | "household" | "recreation" | "tool";
  /** Realism depth for the thing itself (default `background`); a stocked container needs one the preset doesn't cap below Gear 2. */
  tier?: "supporting" | "background";
}

/** A row of the world's `gear.items` table; `category` is the table's own enum. */
export interface TplGearItem {
  id: string;
  name: string;
  category: "carried" | "clothing" | "household" | "recreation" | "tool";
  weightG: number;
  volumeL: number;
  priceBand: { min: number; typical: number; max: number };
}

export interface TplKit {
  id: string;
  name: string;
  container: string;
  owner?: string;
  pieceCount: number;
  tableKit?: string;
  pieces?: { name: string; qty: number }[];
  overrides: { piece: string; note: string }[];
}

export interface TplVehicle {
  id: string;
  name: string;
  kind?: string;
  class?: string;
  year?: number;
  owner?: string;
  location: string;
  homeBase?: string;
  fuelFraction?: number;
  odometerMiles?: number;
  engineHours?: number;
  condition?: number;
  lastOilChangeMiles?: number;
  assignedTo?: { to: string; until: string } | null;
  spec?: Record<string, JsonValue>;
  description: string;
}

export interface TplAccount {
  id: string;
  name: string;
  kind: string;
  owner: string;
  institution?: string;
  container?: string;
  balance?: number;
  owedCents?: number;
  limitCents?: number;
  principalCents?: number;
  remainingMonths?: number;
  paymentCents?: number;
  aprPct?: number;
  statementDay?: number;
  dueDay?: number;
  autopay?: string;
  /** Brokerage: market value of the holdings at the start, in cents (the converter turns it into units at the symbol's starting price). */
  holdingsCents?: number;
  /** Brokerage: the symbol held; defaults to the finance table's broad US equity index. */
  symbol?: string;
}

export interface TplBill {
  id: string;
  payer: string;
  /** A character (the money lands in their account) or an outside counterparty named in words. */
  payee: string;
  label: string;
  amountCents: number;
  /** `month` (day 1-28) or `week` (day 0-6, the calendar's weekday). */
  every: string;
  day: number;
  /** The payer's account it is paid from; omitted for a payer without accounts, who pays out of their means. */
  from?: string;
}

export interface TplStage {
  label: string;
  cue?: string;
  truth?: string;
  leakTerms?: string[];
  objectives?: string[];
  objectiveExprs?: string[];
  next?: { to: string; when: string; expr: string }[];
  gate?: string;
  gateExpr?: string;
  fail?: { to: string; when: string; expr: string };
  effects?: TplEffect[];
  rewards?: TplEffect[];
  hints?: string[];
  answer?: { expect: string[]; normalize: boolean; decision?: { threshold: number } };
  priority?: number;
}

export interface TplTrack {
  id: string;
  kind: "quest" | "secret" | "puzzle" | "agenda";
  label: string;
  owner?: string;
  start: string;
  visibility: Visibility;
  stages: Record<string, TplStage>;
}

export interface TplRule {
  id: string;
  on: { event: string } | { tick: "turn" | "slot" | "day" } | { enter: string } | { at: string };
  when: string;
  whenExpr?: string;
  once?: boolean;
  cooldownMinutes?: number;
  interrupt?: boolean;
  beat?: { hint: string; weight?: number };
  handledBy?: string;
  do: TplEffect[];
}

export interface TplAction {
  id: string;
  label: string;
  params?: Record<string, { type: string; ref?: string; label?: string }>;
  requires: string[];
  duration: number;
  lexicon: string[];
  observable: string;
  effects: TplEffect[];
}

export interface TplClue {
  id: string;
  label: string;
  kind: string;
  track: string;
  where: string;
  finds: string;
  redHerring?: boolean;
  item?: string;
  action: { label: string };
  requiresExpr: string;
  reveals: string[];
}

export interface TplClimate {
  region: string;
  label: string;
  appliesTo?: string[];
  states: { id: string; label: string; effects: JsonObject }[];
  seasons: { label: string; months: number[]; weights: Record<string, number>; tempC: [number, number] }[];
}

/** A public World Book entry about a place, person, item or event (never secret truth). */
export interface TplLore {
  id: string;
  title: string;
  category: string;
  /** The place or entity the entry is about. */
  about?: string | null;
  keys: string[];
  text: string;
}

export interface Template {
  id: string;
  name: string;
  dataPack: string | null;
  region: string | null;
  realism: { preset: "story" | "grounded" | "simulation" };
  currency: { code: string; symbol: string; minorUnit: string; decimals: number; format: string };
  calendar: {
    system: "gregorian" | "custom";
    timeZone: string;
    dayParts: { id: string; label: string; start: string }[];
    holidays: { id: string; label: string; rule: DateRule; dayOff: boolean }[];
    inheritHolidays?: string;
    custom?: { monthLengths: number[]; monthNames: string[]; weekdayNames: string[] };
  };
  start: { place: string; at: string };
  time: {
    sceneTypes: { id: string; tickMinutes: number }[];
    montage: "key" | "day" | "week";
    speedThrough: Record<string, { mode: "offer" | "auto"; thresholdMinutes: number }>;
    interrupts?: Record<string, string>;
  };
  flags: { id: string; description: string; default: boolean | number | string; type?: "bool" | "number" | "text" }[];
  regard: { axes: { id: string; label: string; min: number; max: number }[]; bands: { label: string; min?: number; max?: number }[] };
  sheets: { scale: [number, number]; stats: { id: string; label: string }[]; derived: Record<string, { label: string; formula: string }> };
  places: TplPlace[];
  routes: TplRoute[];
  grids: TplGrid[];
  characters: TplCharacter[];
  items: TplItem[];
  containers: TplItem[];
  kits: TplKit[];
  vehicles: TplVehicle[];
  accounts: TplAccount[];
  bills?: TplBill[];
  prices?: { id: string; name: string; unit: string; category: string; band: { min: number; typical: number; max: number } }[];
  /** Price bands for every `economy.categories` row, in the world's own base units, for a world with no data pack (replaces the Modern US bands in cents). */
  categories?: Record<string, { name: string; basis: string; band: { min: number; typical: number; max: number } }>;
  /** Items a container's `stock` samples from, for a world with its own era (replaces the Modern US `gear.items`). */
  gearItems?: TplGearItem[];
  tracks: TplTrack[];
  clues?: TplClue[];
  rules: TplRule[];
  actions: TplAction[];
  groups: Record<string, string[]>;
  lore: TplLore[];
  weather: { climates: TplClimate[] };
}
