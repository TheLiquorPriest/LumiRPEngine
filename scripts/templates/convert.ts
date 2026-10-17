// Neutral starter template (`lre-template/v1`) -> `lre-world-v1` document, against the landed pack
// kinds, relations, effects and formulas. Pure and deterministic: the same template and packs give
// the same bytes. What the engine has no home for yet is listed in DEFERRED.

import { REALISM_PRESETS } from "../../src/backend/settings-store";
import { calendarOf, clockOfLocal } from "../../src/engine/calendar";
import type { Calendar } from "../../src/engine/calendar";
import { compile } from "../../src/engine/expr";
import type { PackDef } from "../../src/engine/registry";
import type { Registry } from "../../src/engine/registry-impl";
import { DEFAULT_SYMBOL } from "../../src/packs/economy/core/model";
import { hashJson } from "../../src/shared/hash";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { DataTable, TableRow } from "../../src/shared/tables";
import { defaultTiers, leadTierOf } from "../../src/shared/tiers";
import type { ActionDef, EffectSpec, EntityDef, FieldDef, GridDef, KindDef, LoreEntryDef, Objective, PackConfig, PlaceDef, Recurrence, RelationInstance, RuleDef, RuleTrigger, ScheduleDef, StageDef, TrackDef, WorldDoc } from "../../src/shared/world";
import { ENGINE_VERSION, WORLD_FORMAT } from "../../src/shared/world";
import type { TplAccount, TplBlock, TplCharacter, TplEffect, TplItem, TplKit, TplRule, TplStage, TplVehicle, Template } from "./template";

/** Template content the engine has no home for yet (see data-src/templates/README.md). */
export const DEFERRED = [
  "storm durations beyond weather.set's minutes (the explicit clearing rules stand; `weather.set` could hold a storm `until` a flag)",
  "agenda and secret-track objectives (narrative to-dos; only quest and puzzle objectives are checkable)",
] as const;

export interface ConvertEnv {
  packs: readonly PackDef[];
  registry: Registry;
  /** Every pack's default tables (`defaultTables`). */
  tables: Record<string, DataTable>;
}

type Fields = JsonObject;

const GREGORIAN_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TABLE_WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ACCOUNT_TYPE: Record<string, string> = { purse: "cash", till: "cash", strongbox: "cash", cash: "cash", checking: "checking", savings: "savings", card: "card", loan: "loan", brokerage: "brokerage" };
/** How long a scripted move holds someone in place before their schedule takes over again. */
const MOVE_HOLD_MINUTES = 180;

interface Ctx {
  tpl: Template;
  env: ConvertEnv;
  cal: Calendar;
  weekdays: string[];
  names: Map<string, string>;
  places: Set<string>;
  hidden: Map<string, TplItem>;
  containers: Set<string>;
  accountOwner: Map<string, string>;
  regardPairs: Set<string>;
  climateRegions: Map<string, string>;
  classes: Map<string, string>;
}

function str(v: JsonValue | undefined, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: JsonValue | undefined, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function put(target: Fields, key: string, value: JsonValue | undefined): void {
  if (value !== undefined) target[key] = value;
}

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

// ---------------------------------------------------------------- formulas and text

/** `story.x` -> `flag('x')`, `@1934-10-26T21:30` -> the clock reading, and a syntax check. */
function formula(c: Ctx, source: string, path: string): string {
  const out = source
    .replace(/@(-?\d{1,6}-\d{2}-\d{2}T\d{2}:\d{2})/g, (_, iso: string) => String(clockOfLocal(c.cal, iso)))
    .replace(/\bstory\.([a-z][a-z0-9_]*)/g, (_, name: string) => `flag('${name}')`);
  try {
    compile(out);
  } catch (e) {
    fail(path, `formula does not parse: ${out} (${e instanceof Error ? e.message : "?"})`);
  }
  return out;
}

/** Effect-argument values: formulas (a leading `=`) are rewritten, everything else is literal. */
function value(c: Ctx, v: JsonValue, path: string): JsonValue {
  if (typeof v === "string") return v.startsWith("=") ? `=${formula(c, v.slice(1), path)}` : v;
  if (Array.isArray(v)) return v.map((x, i) => value(c, x, `${path}[${i}]`));
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, value(c, x, `${path}.${k}`)]));
  return v;
}

/** Player-facing text: `[[id]]` becomes the thing's name. */
function plain(c: Ctx, text: string): string {
  return text.replace(/\[\[([a-z0-9_.:]+)\]\]/g, (_, id: string) => c.names.get(id) ?? id.split(/[.:]/).pop() ?? id);
}

function members(c: Ctx, id: string): string[] {
  return c.tpl.groups[id] ?? [id];
}

function ownerOf(c: Ctx, id: string): string {
  return c.accountOwner.get(id) ?? id;
}

// ---------------------------------------------------------------- items and effects

interface ItemParts {
  fields: Fields;
  holder: string | null;
  place: string | null;
  worn: string | null;
}

function itemParts(c: Ctx, item: TplItem, kind: "item" | "container"): ItemParts {
  const fields: Fields = { description: item.description };
  const row = item.tableItem ? c.env.tables["gear.items"]?.rows[item.tableItem] : item.tableContainer ? c.env.tables["gear.containers"]?.rows[item.tableContainer] : undefined;
  put(fields, "owner", item.owner);
  put(fields, "weight_g", item.weightG ?? (typeof row?.weight_g === "number" ? row.weight_g : typeof row?.empty_weight_g === "number" ? row.empty_weight_g : undefined));
  if (row && typeof row.volume_l === "number") fields.volume_l = row.volume_l;
  if (row && typeof row.category === "string") fields.category = row.category;
  put(fields, "catalog", item.tableItem ?? item.tableContainer);
  if (item.slot) fields.slot = item.slot;
  if (item.fixed) fields.fixed = true;
  if (item.stock) fields.stock = item.stock;
  if (item.tags && item.tags.length > 0) fields.tags = item.tags;
  if (kind === "container") {
    put(fields, "capacity_l", item.capacityL ?? (typeof row?.capacity_l === "number" ? row.capacity_l : undefined));
    put(fields, "max_load_kg", item.maxLoadKg ?? (typeof row?.max_load_kg === "number" ? row.max_load_kg : undefined));
  }
  const inside = item.in ?? null;
  const place = inside !== null && c.places.has(inside) ? inside : null;
  const holder = inside !== null && place === null ? inside : null;
  return { fields, holder, place, worn: item.worn === true && holder !== null ? (item.slot ?? "pocket") : null };
}

function relationsOf(parts: ItemParts): RelationInstance[] {
  const out: RelationInstance[] = [];
  if (parts.holder) out.push({ type: "in", to: parts.holder });
  if (parts.worn && parts.holder) out.push({ type: "worn_by", to: parts.holder, fields: { slot: parts.worn } });
  return out;
}

function spawnEffect(c: Ctx, item: TplItem): EffectSpec {
  const kind = c.containers.has(item.id) ? "container" : "item";
  const parts = itemParts(c, item, kind);
  const args: JsonObject = { id: item.id, kind, name: item.name, tier: "background", fields: parts.fields };
  if (parts.place) args.place = parts.place;
  if (parts.holder) args.relations = [{ type: "in", to: parts.holder }];
  return { type: "spawn", args };
}

function regionEntity(c: Ctx, place: string): string {
  const parents = new Map(c.tpl.places.map((p) => [p.id, p.parent]));
  let cur: string | undefined = place;
  for (let guard = 0; cur && guard < 32; guard++) {
    const hit = c.climateRegions.get(cur);
    if (hit) return hit;
    cur = parents.get(cur);
  }
  return c.climateRegions.values().next().value ?? fail("weather", `no climate covers ${place}`);
}

function effects(c: Ctx, list: readonly TplEffect[], path: string): EffectSpec[] {
  const out: EffectSpec[] = [];
  list.forEach((e, i) => {
    const at = `${path}[${i}]`;
    const a = e.args;
    switch (e.type) {
      case "pay":
        out.push({ type: "economy.transfer", args: { from: ownerOf(c, str(a.from)), to: ownerOf(c, str(a.to)), cents: num(a.amount), memo: str(a.memo, "Payment") } });
        break;
      case "give_item":
        out.push({ type: "gear.transfer", args: { item: str(a.item), to: str(a.to) } });
        break;
      case "reveal_item": {
        const item = c.hidden.get(str(a.item));
        if (item) out.push(spawnEffect(c, item));
        break;
      }
      case "assign_vehicle":
        out.push({ type: "gear.lend", args: { item: str(a.vehicle), to: str(a.to), until: clockOfLocal(c.cal, str(a.until)) } });
        break;
      case "flag_overdue":
        out.push({ type: "signal", args: { class: "overdue", text: e.text ?? "A loan is overdue.", entity: str(a.vehicle) } });
        break;
      case "move":
        // `{entity, to}` is the engine's own move; `{who, place}` is a person (or group) heading somewhere for a while.
        if (a.entity !== undefined) out.push({ type: "move", args: { entity: str(a.entity), to: str(a.to) } });
        else for (const who of members(c, str(a.who))) out.push({ type: "castlife.override", args: { who, place: str(a.place), minutes: num(a.minutes, MOVE_HOLD_MINUTES) } });
        break;
      case "schedule_override":
        for (const who of members(c, str(a.who))) out.push({ type: "castlife.override", args: { who, place: str(a.place), activity: str(a.activity), minutes: num(a.minutes, 60) } });
        break;
      case "regard": {
        const from = members(c, str(a.who));
        const to = members(c, str(a.toward));
        const grouped = from.length > 1 && to.length > 1;
        for (const f of from) for (const t of to) if (f !== t && (!grouped || c.regardPairs.has(`${f}>${t}`))) out.push({ type: "relationships.adjust", args: { from: f, to: t, axis: str(a.axis), delta: num(a.delta), why: e.text ?? "story" } });
        break;
      }
      case "reveal":
      case "payroll":
        break;
      case "price_modifier": {
        // The template's `scope` names a place (a market's stalls) or a price category; the engine takes both.
        const scope = str(a.scope);
        const place = c.places.has(scope) ? scope : str(a.place);
        out.push({ type: "economy.price_modifier", args: { ...(place !== "" ? { place } : {}), scope: place !== "" && c.places.has(scope) ? "all" : scope || "all", percent: num(a.percent), ...(a.minutes !== undefined ? { minutes: num(a.minutes) } : {}) } });
        break;
      }
      case "advance":
        out.push({ type: "stage", args: { track: str(a.track), to: str(a.stage) } });
        break;
      case "set_route":
        out.push({ type: "space.set_route", args: { route: str(a.route), open: a.open === true } });
        break;
      case "set_flag":
        out.push({ type: "story.flag", args: { name: str(a.flag), value: value(c, a.value ?? true, at) } });
        break;
      case "set_weather":
        out.push({ type: "weather.set", args: { region: regionEntity(c, str(a.region)), state: str(a.state), minutes: num(a.minutes, 180) } });
        break;
      case "set_scene":
        out.push({ type: "set", args: { entity: "pov", field: "scene", value: str(a.sceneType) } });
        break;
      case "note":
        out.push({ type: "note", args: { text: plain(c, str(a.text, e.text ?? "")) } });
        break;
      default:
        out.push({ type: e.type, args: value(c, a, at) as JsonObject });
    }
  });
  return out;
}

// ---------------------------------------------------------------- tracks, rules, actions

function objectives(c: Ctx, stage: TplStage, path: string): Objective[] | undefined {
  if (!stage.objectives || !stage.objectiveExprs) return undefined;
  return stage.objectives.map((label, i) => ({ label: plain(c, label), when: formula(c, stage.objectiveExprs?.[i] ?? "false", `${path}.objectives[${i}]`) }));
}

function stageDef(c: Ctx, trackId: string, stageId: string, s: TplStage): StageDef {
  const path = `tracks.${trackId}.stages.${stageId}`;
  const out: StageDef = { label: s.label, next: (s.next ?? []).map((n, i) => ({ to: n.to, when: formula(c, n.expr, `${path}.next[${i}]`) })) };
  const obj = objectives(c, s, path);
  if (obj) out.objectives = obj;
  if (s.effects && s.effects.length > 0) out.effects = effects(c, s.effects, `${path}.effects`);
  if (s.gateExpr) out.gate = formula(c, s.gateExpr, `${path}.gate`);
  if (s.fail) out.fail = { when: formula(c, s.fail.expr, `${path}.fail`), to: s.fail.to };
  if (s.rewards && s.rewards.length > 0) out.rewards = effects(c, s.rewards, `${path}.rewards`);
  if (s.cue) out.cue = plain(c, s.cue);
  if (s.truth) out.truth = s.truth;
  if (s.answer) out.answer = { expect: s.answer.expect, normalize: s.answer.normalize, ...(s.answer.decision ? { decision: s.answer.decision } : {}) };
  if (s.hints && s.hints.length > 0) out.hints = s.hints.map((h) => plain(c, h));
  if (s.priority !== undefined) out.priority = s.priority;
  return out;
}

function trackDef(c: Ctx, t: Template["tracks"][number]): TrackDef {
  const out: TrackDef = { id: t.id, kind: t.kind, label: t.label, start: t.start, stages: {}, visibility: t.visibility };
  if (t.owner) out.owner = t.owner;
  for (const [id, s] of Object.entries(t.stages)) out.stages[id] = stageDef(c, t.id, id, s);
  return out;
}

function ruleTrigger(c: Ctx, r: TplRule): RuleTrigger {
  const on = r.on;
  if ("tick" in on || "enter" in on) return on;
  if ("at" in on) return { at: `clock >= ${clockOfLocal(c.cal, on.at)}` };
  return fail(`rules.${r.id}.on`, `event triggers have no engine events; use a tick and a formula (${on.event})`);
}

function ruleDef(c: Ctx, r: TplRule): RuleDef {
  const out: RuleDef = { id: r.id, on: ruleTrigger(c, r), do: effects(c, r.do, `rules.${r.id}.do`) };
  if (r.when !== "always") out.when = formula(c, r.whenExpr ?? fail(`rules.${r.id}`, "needs whenExpr"), `rules.${r.id}.when`);
  if (r.once) out.once = true;
  if (r.cooldownMinutes !== undefined) out.cooldownMinutes = r.cooldownMinutes;
  if (r.interrupt) out.interrupt = true;
  if (r.beat) out.beat = r.beat;
  return out;
}

function actionDef(c: Ctx, a: Template["actions"][number]): ActionDef {
  return {
    id: a.id,
    label: a.label,
    params: Object.fromEntries(Object.entries(a.params ?? {}).map(([k, p]) => [k, { type: p.type as FieldDef["type"], ...(p.ref ? { ref: p.ref } : {}), ...(p.label ? { label: p.label } : {}) }])),
    requires: a.requires.map((x, i) => formula(c, x, `actions.${a.id}.requires[${i}]`)),
    outcomes: { default: effects(c, a.effects, `actions.${a.id}.effects`) },
    duration: String(a.duration),
    lexicon: a.lexicon,
    observable: a.observable,
  };
}

/** A clue is found by an action: it requires the clue's condition and that the clue is not yet found. */
function clueAction(c: Ctx, clue: NonNullable<Template["clues"]>[number]): ActionDef {
  const found: TplEffect[] = [{ type: "set_flag", args: { flag: clue.id, value: true } }];
  for (const id of clue.reveals) {
    if (!c.hidden.has(id)) fail(`clues.${clue.id}`, `reveals ${id}, which is not a hidden item`);
    found.push({ type: "reveal_item", args: { item: id } });
  }
  found.push({ type: "note", args: { text: clue.finds } });
  return {
    id: `find_${clue.id.replace(/^clue_/, "")}`,
    label: clue.action.label,
    params: {},
    requires: [formula(c, clue.requiresExpr, `clues.${clue.id}.requires`), formula(c, `not story.${clue.id}`, `clues.${clue.id}`)],
    outcomes: { default: effects(c, found, `clues.${clue.id}`) },
    duration: clue.kind === "testimony" ? "15" : "10",
    observable: "looks around",
  };
}

// ---------------------------------------------------------------- places, grids, calendar

function placeDef(c: Ctx, p: Template["places"][number]): PlaceDef {
  const fields: Fields = { description: p.description };
  if (p.tags && p.tags.length > 0) fields.tags = p.tags;
  const region = c.climateRegions.get(p.id) ?? appliesRegion(c, p.id);
  if (region) fields.region = region;
  const out: PlaceDef = { id: p.id, name: p.name, fields };
  if (p.parent) out.parent = p.parent;
  if (p.timeZone) out.timeZone = p.timeZone;
  if (p.sceneType) out.sceneType = p.sceneType;
  const grid = c.tpl.grids.find((g) => g.place === p.id);
  if (grid) out.grid = grid.id;
  if (p.cell) out.cell = p.cell;
  if (p.visibility && p.visibility !== "public") out.visibility = p.visibility;
  return out;
}

function appliesRegion(c: Ctx, place: string): string | undefined {
  const cl = c.tpl.weather.climates.find((x) => x.appliesTo?.includes(place));
  return cl ? c.climateRegions.get(cl.region) : undefined;
}

function gridDef(g: Template["grids"][number]): GridDef {
  const terrain: string[] = [];
  const blocked: number[] = [];
  g.rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const def = g.legend[ch];
      terrain.push(def?.terrain ?? "unknown");
      if (def?.blocked === true) blocked.push(y * g.width + x);
    });
  });
  const zones: Record<string, number[]> = {};
  for (const [name, rects] of Object.entries(g.zones)) {
    const cells = new Set<number>();
    for (const [x = 0, y = 0, w = 0, h = 0] of rects) for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.add((y + dy) * g.width + x + dx);
    zones[name] = [...cells].sort((a, b) => a - b);
  }
  const out: GridDef = { id: g.id, width: g.width, height: g.height, terrain, blocked, zones };
  if (g.cellMeters !== undefined) out.cellMeters = g.cellMeters;
  return out;
}

function holidaysFromTable(table: DataTable | undefined): Template["calendar"]["holidays"] {
  if (!table) return [];
  return Object.entries(table.rows).map(([id, r]) => {
    const month = num(r.month);
    const rule = r.rule_type === "fixed" ? ({ type: "fixed", month, day: num(r.day) } as const) : ({ type: "nth_weekday", month, weekday: TABLE_WEEKDAYS.indexOf(str(r.weekday)), n: num(r.n) } as const);
    return { id, label: str(r.name, id), rule, dayOff: r.federal_paid_day_off === true };
  });
}

// ---------------------------------------------------------------- entities

function scaled(v: number, scale: [number, number]): number {
  const [lo, hi] = scale;
  return Math.max(3, Math.min(18, Math.round(3 + ((v - lo) * 15) / (hi - lo))));
}

function minuteOf(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/** Where a character is, and doing what, at the world's start (the calendar's epoch is the start date). */
function startBlock(c: Ctx, ch: TplCharacter): { place: string; activity: string } | null {
  const day = c.cal.system.weekday(c.cal.epochAbs);
  const minute = minuteOf(c.tpl.start.at.slice(11));
  const date = c.tpl.start.at.slice(0, 10);
  for (const b of ch.schedule ?? []) {
    if (b.term && (date < b.term.from || date > b.term.until)) continue;
    if (b.days.some((d) => c.weekdays.indexOf(d) === day) && minute >= minuteOf(b.start) && minute < minuteOf(b.end)) return { place: b.place, activity: b.activity };
  }
  return null;
}

function characterEntity(c: Ctx, ch: TplCharacter): EntityDef {
  const fields: Fields = { description: ch.summary, role: ch.role };
  put(fields, "age", ch.age);
  if (ch.traits && ch.traits.length > 0) fields.traits = ch.traits;
  const start = ch.tier === "pov" ? null : startBlock(c, ch);
  put(fields, "place", ch.tier === "pov" ? ch.location : (start?.place ?? ch.home));
  put(fields, "home", ch.home);
  if (ch.trips && ch.trips.length > 0) fields.trips = ch.trips.map((t) => ({ from: clockOfLocal(c.cal, t.from), until: clockOfLocal(c.cal, t.until), place: t.place, label: t.label }));
  fields.activity = start?.activity ?? "idle";
  fields.wealth = ch.wealth;
  for (const [stat, v] of Object.entries(ch.sheet ?? {})) fields[stat] = scaled(v, c.tpl.sheets.scale);
  if (c.tpl.region) fields.region = c.tpl.region;
  const job = ch.job;
  if (job) {
    put(fields, "occupation", job.occupation ?? undefined);
    put(fields, "employer", job.employer ?? undefined);
    put(fields, "hourly_cents", job.hourlyCents);
    put(fields, "hours_per_week", job.hoursPerWeek);
    put(fields, "pay_frequency", job.payFrequency ?? (job.occupation ? undefined : "monthly"));
    put(fields, "payday", job.payday);
    put(fields, "deposit_to", job.depositTo);
    put(fields, "annual_income_cents", job.estimatedAnnualIncomeCents ?? (job.incomeMonthlyCents ? job.incomeMonthlyCents * 12 : undefined));
    put(fields, "shift_pattern", job.shiftPattern);
  }
  const bills = (c.tpl.bills ?? []).filter((b) => b.payer === ch.id).map((b) => ({ label: b.label, payee: b.payee, amountCents: b.amountCents, every: b.every, day: b.day, ...(b.from ? { from: b.from } : {}) }));
  if (bills.length > 0) fields.bills = bills;
  const relations: RelationInstance[] = (ch.regard ?? []).map((r) => ({ type: "regard", to: r.toward, fields: { ...r.axes, t: 0 } }));
  // A template marks its point of view with the `pov` tier; the world's POV is `pov` itself and is
  // never capped, so it takes the lead tier.
  const out: EntityDef = { id: ch.id, kind: "character", name: ch.name, tier: ch.tier === "pov" ? leadTierOf({ tiers: defaultTiers() }) : ch.tier, fields, relations };
  if (ch.agent) out.agent = true;
  return out;
}

function itemEntity(c: Ctx, item: TplItem, kind: "item" | "container" | "kit", kit?: TplKit): EntityDef {
  const parts = itemParts(c, item, kind === "kit" ? "container" : kind);
  if (kit) {
    if (kit.tableKit) parts.fields.kit = kit.tableKit;
    else {
      parts.fields.pieces = (kit.pieces ?? []).map((p) => ({ name: p.name, qty: p.qty }));
      parts.fields.piece_count = kit.pieceCount;
    }
    if (kit.overrides.length > 0) parts.fields.taken = Object.fromEntries(kit.overrides.map((o) => [o.piece, 1]));
  }
  if (parts.place) parts.fields.place = parts.place;
  return { id: item.id, kind, name: item.name, tier: item.tier ?? "background", fields: parts.fields, relations: relationsOf(parts) };
}

function vehicleEntity(c: Ctx, v: TplVehicle): EntityDef {
  const fields: Fields = { description: v.description, place: v.location };
  put(fields, "owner", v.owner);
  put(fields, "class", v.class ?? c.classes.get(v.id));
  fields.status = "ok";
  fields.fuel_pct = Math.round((v.fuelFraction ?? 1) * 100);
  put(fields, "odometer_mi", v.odometerMiles);
  put(fields, "engine_hours", v.engineHours);
  put(fields, "home", v.homeBase ?? v.location);
  put(fields, "last_service", v.lastOilChangeMiles);
  put(fields, "condition", v.condition);
  put(fields, "year", v.year);
  return { id: v.id, kind: "vehicle", name: v.name, tier: "background", fields, relations: [] };
}

/** A symbol's price before the economy pack's market process has moved it (`priceOfSymbol`'s default). */
const STARTING_SYMBOL_PRICE = 100;

function accountEntity(a: TplAccount): EntityDef {
  const type = ACCOUNT_TYPE[a.kind] ?? fail(`accounts.${a.id}`, `unknown account kind ${a.kind}`);
  const fields: Fields = { owner: a.owner, type };
  if (type === "brokerage") {
    // Holdings are units of the symbol; the economy pack prices a symbol at 100 until its first market step, and a test pins the match.
    fields.symbol = a.symbol ?? DEFAULT_SYMBOL;
    fields.units = (a.holdingsCents ?? 0) / 100 / STARTING_SYMBOL_PRICE;
  }
  put(fields, "institution", a.institution);
  fields.opening = type === "card" ? -(a.owedCents ?? 0) : type === "loan" ? -(a.principalCents ?? 0) : (a.balance ?? 0);
  put(fields, "limit", a.limitCents);
  put(fields, "apr_pct", a.aprPct);
  put(fields, "statement_day", a.statementDay);
  put(fields, "due_day", a.dueDay);
  put(fields, "autopay", a.autopay);
  put(fields, "remaining_months", a.remainingMonths);
  put(fields, "payment", a.paymentCents);
  const relations: RelationInstance[] = a.container ? [{ type: "in", to: a.container }] : [];
  return { id: a.id, kind: "account", name: a.name, tier: "background", fields, relations };
}

// ---------------------------------------------------------------- schedules

function schedules(c: Ctx): Record<string, ScheduleDef> {
  const out: Record<string, ScheduleDef> = {};
  for (const ch of c.tpl.characters) {
    // Blocks on the same weekdays and in the same term share a schedule; a term adds `from`, `until` and `except` to its recurrence.
    const groups = new Map<string, { days: number[]; term: TplBlock["term"]; blocks: TplBlock[] }>();
    for (const b of ch.schedule ?? []) {
      const days = [...new Set(b.days.map((d) => c.weekdays.indexOf(d)))].sort((x, y) => x - y);
      const key = `${days.join(",")}|${b.term ? JSON.stringify(b.term) : ""}`;
      const group = groups.get(key) ?? { days, term: b.term, blocks: [] };
      group.blocks.push(b);
      groups.set(key, group);
    }
    let n = 0;
    for (const { days, term, blocks } of groups.values()) {
      n += 1;
      const recurrence: Recurrence = { every: "week", weekdays: days, ...(term ? { from: term.from, until: term.until, ...(term.except && term.except.length > 0 ? { except: [...term.except] } : {}) } : {}) };
      out[`${ch.id}_place_${n}`] = { id: `${ch.id}_place_${n}`, owner: ch.id, target: "place", recurrence, slots: blocks.map((b) => ({ start: b.start, end: b.end, value: b.place })), pack: "castlife" };
      out[`${ch.id}_activity_${n}`] = { id: `${ch.id}_activity_${n}`, owner: ch.id, target: "activity", recurrence, slots: blocks.map((b) => ({ start: b.start, end: b.end, value: b.activity })), pack: "castlife" };
    }
  }
  return out;
}

// ---------------------------------------------------------------- tables

function retable(table: DataTable): DataTable {
  return { ...table, revision: hashJson({ schema: table.schema, columns: table.columns, rows: table.rows }) };
}

const NO_BAND = { min: 0, typical: 0, max: 0 };

function vehicleClassRow(v: TplVehicle, prices: Map<string, { min: number; typical: number; max: number }>): { id: string; row: TableRow } {
  const spec = v.spec ?? {};
  const type = str(spec.type, v.kind ?? "vehicle");
  const id = type.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  const motor = typeof spec.milesPerGallon === "number";
  const marine = v.kind === "ferry" || v.kind === "boat";
  const price = prices.get(id) ?? NO_BAND;
  const row: TableRow = {
    name: type.charAt(0).toUpperCase() + type.slice(1),
    domain: marine ? "marine" : "road",
    fuel_type: motor ? "gasoline" : v.kind === "mount" ? "feed" : "none",
    factor_guide: marine ? "marine" : "road",
    consumption_unit: motor ? "mpg" : "gal_per_h",
    consumption: motor ? { combined: num(spec.milesPerGallon) } : { cruise_planing: 0, normal_trail: 0 },
    price_new_cents: price,
    price_used_cents: price,
    insurance_liability_cents_per_month: 0,
    insurance_full_cents_per_month: 0,
    registration_cents_per_year: NO_BAND,
    annual_maintenance_cents_per_year: 0,
    maintenance: {},
    passengers: num(spec.passengers, num(spec.capacityPeople, 1)),
    cargo_l: 0,
    payload_kg: num(spec.capacityKg, num(spec.carryKg, num(spec.drawKg, 0))),
    notes: v.description,
  };
  if (motor) row.tank_capacity_gal = num(spec.tankGallons, 10);
  return { id, row };
}

/** The world's copy of every default table, pinned by revision. Non-modern worlds swap in their own prices and vehicle classes. */
function worldTables(c: Ctx): { tables: Record<string, DataTable>; pins: Record<string, string> } {
  const tables: Record<string, DataTable> = structuredClone(c.env.tables);
  const tpl = c.tpl;
  if (tpl.dataPack === null) {
    const catalog = tables["economy.catalog"];
    if (catalog && tpl.prices) {
      const rows: Record<string, TableRow> = {};
      for (const p of tpl.prices) rows[p.id.replace(/^pr_/, "")] = { name: p.name, category: p.category, unit: p.unit, price_cents: p.band };
      tables["economy.catalog"] = { ...catalog, rows };
    }
    // The Modern US item table has smartphones and LED bulbs: a world with its own era swaps in the template's items.
    const gear = tables["gear.items"];
    if (gear && tpl.gearItems) {
      const rows: Record<string, TableRow> = {};
      for (const g of tpl.gearItems) rows[g.id] = { name: g.name, category: g.category, equip_slot: "none", weight_g: g.weightG, volume_l: g.volumeL, price_cents: g.priceBand };
      tables["gear.items"] = { ...gear, rows };
    }
    const classes = tables["vehicles.classes"];
    if (classes) {
      const rows = { ...classes.rows };
      const prices = new Map((tpl.prices ?? []).map((p) => [p.id.replace(/^pr_/, ""), p.band]));
      for (const v of tpl.vehicles) {
        const made = vehicleClassRow(v, prices);
        rows[made.id] = made.row;
        c.classes.set(v.id, made.id);
      }
      const fuel = classes.columns.fuel_type;
      const columns = fuel ? { ...classes.columns, fuel_type: { ...fuel, values: [...(fuel.values ?? []), "feed", "none"] } } : classes.columns;
      tables["vehicles.classes"] = { ...classes, columns, rows };
    }
  }
  const pins: Record<string, string> = {};
  for (const id of Object.keys(tables).sort()) {
    const fresh = retable(tables[id] ?? fail("tables", id));
    tables[id] = fresh;
    pins[id] = fresh.revision;
  }
  return { tables, pins };
}

// ---------------------------------------------------------------- the document

function context(tpl: Template, env: ConvertEnv): Ctx {
  const calDef = { system: tpl.calendar.system, epoch: `${tpl.start.at.slice(0, 10)}T00:00`, timeZone: tpl.calendar.timeZone, dayParts: [], holidays: [], ...(tpl.calendar.custom ? { custom: tpl.calendar.custom } : {}) };
  const names = new Map<string, string>();
  for (const x of [...tpl.places, ...tpl.characters, ...tpl.items, ...tpl.containers, ...tpl.vehicles, ...tpl.accounts]) names.set(x.id, x.name);
  for (const t of tpl.tracks) names.set(t.id, t.label);
  const regardPairs = new Set<string>();
  for (const ch of tpl.characters) for (const r of ch.regard ?? []) regardPairs.add(`${ch.id}>${r.toward}`);
  const all = [...tpl.items, ...tpl.containers];
  return {
    tpl,
    env,
    cal: calendarOf({ calendar: calDef }),
    weekdays: tpl.calendar.custom?.weekdayNames ?? GREGORIAN_WEEKDAYS,
    names,
    places: new Set(tpl.places.map((p) => p.id)),
    hidden: new Map(all.filter((i) => i.hidden === true || i.visibility === "secret").map((i) => [i.id, i])),
    containers: new Set(tpl.containers.map((x) => x.id)),
    accountOwner: new Map(tpl.accounts.map((a) => [a.id, a.owner])),
    regardPairs,
    climateRegions: new Map(tpl.weather.climates.map((cl) => [cl.region, `region_${cl.region}`])),
    classes: new Map(),
  };
}

/** The template's public World Book entries as `WorldDoc.lore`; a link is kept only to something that exists in the world. */
function loreEntries(c: Ctx, entities: Record<string, EntityDef>): Record<string, LoreEntryDef> {
  const out: Record<string, LoreEntryDef> = {};
  for (const l of c.tpl.lore) {
    const about = l.about ?? "";
    const links: string[] = [];
    if (about !== "") {
      if (entities[about] || c.places.has(about)) links.push(about);
      else if (!c.hidden.has(about)) fail(`lore.${l.id}`, `is about "${about}", which is neither an entity nor a place`);
    }
    out[l.id] = { id: l.id, title: l.title, content: plain(c, l.text), keys: [...l.keys], links };
  }
  return out;
}

export function convertTemplate(tpl: Template, env: ConvertEnv): WorldDoc {
  const c = context(tpl, env);
  const preset = REALISM_PRESETS[tpl.realism.preset];
  const holidays = [...(tpl.calendar.inheritHolidays ? holidaysFromTable(env.tables["calendar.holidays"]) : []), ...tpl.calendar.holidays];
  const { tables, pins } = worldTables(c);

  const entities: Record<string, EntityDef> = {};
  const add = (e: EntityDef): void => {
    if (entities[e.id]) fail(`entities.${e.id}`, "duplicate entity id");
    entities[e.id] = e;
  };
  for (const ch of tpl.characters) add(characterEntity(c, ch));
  const kitOf = new Map(tpl.kits.map((k) => [k.container, k]));
  for (const x of tpl.containers) if (!c.hidden.has(x.id)) add(itemEntity(c, x, kitOf.has(x.id) ? "kit" : "container", kitOf.get(x.id)));
  for (const x of tpl.items) if (!c.hidden.has(x.id)) add(itemEntity(c, x, "item"));
  for (const v of tpl.vehicles) add(vehicleEntity(c, v));
  for (const a of tpl.accounts) add(accountEntity(a));
  for (const cl of tpl.weather.climates) add({ id: `region_${cl.region}`, kind: "region", name: cl.label, tier: "background", fields: { climate: cl.region, weather: "clear" }, relations: [] });
  for (const v of tpl.vehicles) {
    const grant = v.assignedTo;
    if (grant) entities[grant.to]?.relations.push({ type: "uses", to: v.id, until: clockOfLocal(c.cal, grant.until) });
  }

  const stats = tpl.sheets.stats;
  const characterKind: KindDef = {
    id: "character",
    label: "Character",
    extends: "person",
    fields: {
      description: { type: "text", label: "Description" },
      role: { type: "text", label: "Role" },
      age: { type: "number", label: "Age", min: 0 },
      traits: { type: "list", of: "text", label: "Traits" },
      ...Object.fromEntries(stats.map((s) => [s.id, { type: "number" as const, label: s.label, min: 3, max: 18, default: 10, domain: "sheets" as const, level: 2 as const }])),
    },
  };

  const packs: Record<string, PackConfig> = {};
  for (const pack of env.packs) packs[pack.id] = { version: pack.version, config: {} };
  const config = (id: string, body: JsonObject): void => {
    const p = packs[id];
    if (p) p.config = body;
  };
  config("weather", { climates: tpl.weather.climates as unknown as JsonValue });
  config("relationships", { axes: tpl.regard.axes, bands: tpl.regard.bands });
  config("sheets", { stats: stats.map((s) => ({ id: s.id, label: s.label, min: 3, max: 18, default: 10 })), derived: tpl.sheets.derived });
  config("story", { flags: Object.fromEntries(tpl.flags.filter((f) => f.default !== false && f.default !== 0 && f.default !== "").map((f) => [f.id, f.default])) });
  config("space", { closedRoutes: tpl.routes.filter((r) => r.secret === true).map((r) => r.id) });

  // Climate regions: the root place of each climate (and its appliesTo places) points at the region entity.
  const generators: Record<string, number> = {};
  for (const [domain, def] of env.registry.materializers) generators[domain] = def.version;

  const time = {
    sceneTicks: Object.fromEntries(tpl.time.sceneTypes.map((s) => [s.id, s.tickMinutes])),
    interrupts: { invitation: "stop", bill: "note", decline: "stop", incident: "stop", quest: "stop", rule: "note", arrival: "stop", overdue: "note", needs: "ignore", weather: "ignore", ...tpl.time.interrupts } as WorldDoc["time"]["interrupts"],
    speedThrough: tpl.time.speedThrough,
    montage: tpl.time.montage,
    unitCap: { agentDays: 600, events: 5000 },
  };

  const actions: Record<string, ActionDef> = {};
  for (const a of tpl.actions) actions[a.id] = actionDef(c, a);
  for (const clue of tpl.clues ?? []) {
    const made = clueAction(c, clue);
    actions[made.id] = made;
  }
  const rules: Record<string, RuleDef> = {};
  for (const r of tpl.rules) if (!r.handledBy) rules[r.id] = ruleDef(c, r);
  const tracks: Record<string, TrackDef> = {};
  for (const t of tpl.tracks) tracks[t.id] = trackDef(c, t);
  const routes: WorldDoc["routes"] = {};
  for (const r of tpl.routes) routes[r.id] = { id: r.id, from: r.from, to: r.to, modes: r.modes, bidirectional: r.bidirectional };
  const grids: WorldDoc["grids"] = {};
  for (const g of tpl.grids) grids[g.id] = gridDef(g);

  return {
    format: WORLD_FORMAT,
    id: tpl.id.replace(/-/g, "_"),
    name: tpl.name,
    engineVersion: ENGINE_VERSION,
    packs,
    pins: { generators, tables: pins },
    kinds: { character: characterKind },
    relations: {},
    entities,
    places: Object.fromEntries(tpl.places.map((p) => [p.id, placeDef(c, p)])),
    routes,
    grids,
    rules,
    actions,
    checks: {},
    calendar: {
      system: tpl.calendar.system,
      epoch: `${tpl.start.at.slice(0, 10)}T00:00`,
      timeZone: tpl.calendar.timeZone,
      dayParts: tpl.calendar.dayParts,
      holidays: holidays.map((h) => ({ id: h.id, label: h.label, rule: h.rule, dayOff: h.dayOff })),
      ...(tpl.calendar.custom ? { custom: { monthLengths: tpl.calendar.custom.monthLengths, monthNames: tpl.calendar.custom.monthNames, weekdayNames: tpl.calendar.custom.weekdayNames } } : {}),
    },
    schedules: schedules(c),
    tracks,
    tables,
    realism: { preset: tpl.realism.preset, levels: { ...preset.levels }, tierCaps: structuredClone(preset.tierCaps) },
    time,
    sections: {},
    steps: {},
    suppressed: [],
    lore: loreEntries(c, entities),
    seedMode: "fresh",
    lenientPricing: false,
    currency: { ...tpl.currency },
    pov: "pov",
    tiers: defaultTiers(),
    start: { place: tpl.start.place, at: tpl.start.at },
  };
}
