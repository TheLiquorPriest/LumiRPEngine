// Import from lore and Refine (DESIGN §9.7, §13; PlanChatUI-B5): what the job's agent proposes through `world_propose` (people, places,
// routes, and entities of every pack's kinds: accounts, items, vehicles, factions, regions…) is checked against the draft and the
// registry (kinds, field types, references), normalized and deduplicated deterministically. He reviews them; accepted ones go to the
// draft on his Apply. Moved from the previous extension's `proposals.ts`; its prompt is the agents' definitions and briefs now, and
// what the agent is given of the world's kinds is data (`kindsGiven`).

import { hasOwn, isRecord, safeKey } from "../../shared/json";
import type { JsonObject, JsonValue } from "../../shared/json";
import type { JobProposal } from "../../shared/jobs";
import { neutralizeMacros } from "../../shared/macros";
import type { DataTable } from "../../shared/tables";
import { spawnTierOf, tierOf, tiersInOrder } from "../../shared/tiers";
import { overlayKind } from "../../shared/world";
import type { FieldDef, KindDef, WorldDoc } from "../../shared/world";
import type { Registry } from "../../engine/registry-impl";
import { say } from "../../engine/lines";

export type ProposalMode = "import" | "refine";

const COLLECTIONS: Record<string, "entities" | "places" | "routes"> = { entities: "entities", places: "places", routes: "routes" };
const TRAVEL_MODES = ["walk", "road", "offroad", "water"] as const;

/** A kind as the world plays it: its own over the pack's of the same id (`overlayKind`), else whichever defines it. */
function kindOf(world: WorldDoc, registry: Registry, id: string): KindDef | undefined {
  // Own keys only: a proposed "constructor", "__proto__" or "toString" is no kind.
  const mine = hasOwn(world.kinds, id) ? world.kinds[id] : undefined;
  const pack = registry.kinds.get(id);
  return mine && pack ? overlayKind(pack, mine) : (mine ?? pack);
}

/** A kind's fields, inherited ones included (nearest definition wins). */
export function fieldsOf(world: WorldDoc, registry: Registry, kindId: string): Record<string, FieldDef> {
  const chain: KindDef[] = [];
  for (let k = kindOf(world, registry, kindId), guard = 0; k && guard < 16; k = k.extends ? kindOf(world, registry, k.extends) : undefined, guard++) chain.unshift(k);
  return Object.assign({}, ...chain.map((k) => k.fields)) as Record<string, FieldDef>;
}

/** A field's type as the agent is given it: an enum with its values, a ref with what it names, money in minor units. */
function fieldType(f: FieldDef): string {
  if (f.type === "enum" && f.values) return `enum(${f.values.join("|")})`;
  if (f.type === "ref") return `ref${f.ref ? `(${f.ref})` : ""}`;
  if (f.type === "money") return "money(integer minor units)";
  return f.type;
}

/**
 * What the agent of an import or a refine is given of the world, as data: its id, name and POV, its tiers in order, and every kind it
 * may propose, by pack, each with what it extends and its fields (its own first) with their types.
 */
export function kindsGiven(world: WorldDoc, registry: Registry): JsonObject {
  const ids = new Set([...registry.kinds.keys(), ...Object.keys(world.kinds)]);
  const kinds: JsonObject[] = [];
  for (const id of [...ids].sort()) {
    const k = kindOf(world, registry, id);
    if (!k) continue;
    const all = fieldsOf(world, registry, id);
    const order = [...Object.keys(k.fields), ...Object.keys(all).filter((f) => !(f in k.fields))];
    kinds.push({ kind: id, pack: k.pack ?? "world", ...(k.extends ? { extends: k.extends } : {}), fields: Object.fromEntries(order.map((f) => [f, fieldType(all[f] ?? { type: "text" })])) });
  }
  return { world: world.id, name: world.name, pov: world.pov, tiers: tiersInOrder(world).map(([id, t]) => ({ tier: id, label: t.label })), kinds };
}

/** A lore entry's title: its comment, else its keys. */
export function entryTitle(e: { comment: string; keys: readonly string[] }): string {
  return (e.comment || e.keys.join(", ")).trim();
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/**
 * The row of a table a text best names (DESIGN §9.7 gap-fill): the most words shared with the row's
 * id and its title or name; ties go to the row id first in order. Null when no word is shared.
 */
export function matchRow(table: DataTable, text: string): string | null {
  return matchRowIn([table], text);
}

/** `matchRow` over several tables at once: a tie goes to the earlier table, then to the row id first in order. */
function matchRowIn(tables: readonly DataTable[], text: string): string | null {
  const wanted = new Set(words(text));
  if (wanted.size === 0) return null;
  let best: string | null = null;
  let score = 0;
  for (const table of tables) {
    for (const id of Object.keys(table.rows).sort()) {
      const row = table.rows[id] ?? {};
      const label = [row.title, row.name, row.label].find((v): v is string => typeof v === "string") ?? "";
      const have = new Set([...words(id.replace(/_/g, " ")), ...words(label)]);
      const shared = [...wanted].filter((w) => have.has(w)).length;
      if (shared > score) {
        best = id;
        score = shared;
      }
    }
  }
  return best;
}

/** The gear tables, which say what a thing is (its weight, its slot, whether it is a part built into a vehicle), before the price catalog says what it costs. */
const THING_TABLES = ["gear.items", "gear.containers", "gear.kits"] as const;

/** Proposal checks for Import: resolving a proposal's cited source to a `bookId/entryId` back-link. */
export interface ImportSources {
  linkOf: (source: string) => string | null;
}

/** Reads a `world_propose` call's `proposals` as raw proposals (shape only; `checkProposals` validates them). A malformed proposal is skipped on its own. */
export function readProposals(raw: JsonValue | undefined, source: string): JobProposal[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: JobProposal[] = [];
  list.forEach((p, i) => {
    if (!isRecord(p)) return;
    // Own keys only: `"collection": "constructor"` is no collection.
    const collection = typeof p.collection === "string" && hasOwn(COLLECTIONS, p.collection) ? COLLECTIONS[p.collection] : undefined;
    const key = typeof p.key === "string" ? p.key : isRecord(p.value) && typeof p.value.id === "string" ? p.value.id : null;
    if (typeof collection !== "string" || !key || !isRecord(p.value)) return;
    out.push({
      id: `${source}:${i}`,
      collection,
      key,
      value: JSON.parse(JSON.stringify(p.value)) as JsonValue,
      source: typeof p.source === "string" ? p.source : source,
      confidence: typeof p.confidence === "number" ? Math.min(1, Math.max(0, p.confidence)) : 0.5,
      ...(typeof p.note === "string" ? { note: p.note } : {}),
    });
  });
  return out;
}

const SNAKE = /^[a-z][a-z0-9_]{0,63}$/;

/** A key as an id: lowercase snake_case, at most 64 characters, never starting with a digit. Routine proposals name their ids the same way. */
export function snake(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "x$1")
    .slice(0, 64);
}

function fieldValue(def: FieldDef, value: JsonValue, known: (id: string) => boolean): JsonValue | undefined {
  switch (def.type) {
    case "number":
    case "duration":
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    case "money":
      return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
    case "text":
    case "date":
    case "dice":
      return typeof value === "string" ? value : undefined;
    case "bool":
      return typeof value === "boolean" ? value : undefined;
    case "enum":
      return typeof value === "string" && (def.values ?? []).includes(value) ? value : undefined;
    case "ref":
      return typeof value === "string" && known(value) ? value : undefined;
    case "list":
      return Array.isArray(value) ? value : undefined;
  }
}

/** Lines of Build's jobs part filled in (`guidance/.prompts/build-jobs.md`); undefined where the part has no such line. */
export type Say = (line: string, fields?: Record<string, string | number>) => string | undefined;

/** One reason proposals were dropped: its name (the part's line `dropped_<why>`), what fills the line, and how many it dropped. */
export interface Drop {
  why: string;
  fields: Record<string, string | number>;
  count: number;
}

/** Why proposals were dropped, counted per reason and its fields (a job that ends with none says why). */
export type DropCounts = Map<string, Drop>;

/** Counts `count` more proposals dropped for `why`. */
export function addDrop(drops: DropCounts, why: string, fields: Record<string, string | number> = {}, count = 1): void {
  const key = `${why}\0${JSON.stringify(fields)}`;
  const known = drops.get(key);
  if (known) known.count += count;
  else drops.set(key, { why, fields, count });
}

/** The part's line `line` filled with `fields`; where the part has no such line, its name and the fields' values, as data. */
export function sayOr(say: Say, line: string, fields: Record<string, string | number> = {}): string {
  return say(line, fields) ?? [line, ...Object.values(fields)].join(" ");
}

/** What a job's end says of the proposals dropped, in the part's `proposed_nothing` and `dropped_summary` lines; null when none was. */
export function dropSummary(raw: number, kept: number, drops: DropCounts, say: Say): string | null {
  if (kept > 0 && drops.size === 0) return null;
  if (raw === 0) return say("proposed_nothing") ?? null;
  const reasons = [...drops.values()].sort((a, b) => b.count - a.count).map((d) => `${d.count} ${sayOr(say, `dropped_${d.why}`, d.fields)}`);
  return say("dropped_summary", { dropped: raw - kept, proposed: raw, reasons: reasons.join("; ") }) ?? JSON.stringify({ dropped: raw - kept, proposed: raw, reasons });
}

/**
 * The kind a kind-less entity proposal takes: the world's one base kind, the only root kind (it
 * extends no kind this world has) that other kinds build on, as `thing` is under people, items,
 * vehicles and businesses. A root nothing builds on (an account, a region) is a kind of its own,
 * not a base. Null when there is no such kind or more than one.
 */
function baseKind(world: WorldDoc, registry: Registry): string | null {
  const bases = new Set<string>();
  for (const id of new Set([...registry.kinds.keys(), ...Object.keys(world.kinds)])) {
    const parent = kindOf(world, registry, id)?.extends;
    const root = parent ? kindOf(world, registry, parent) : undefined;
    if (parent && root && !(root.extends && kindOf(world, registry, root.extends))) bases.add(parent);
  }
  return bases.size === 1 ? ([...bases][0] ?? null) : null;
}

/**
 * Validates and normalizes proposals against the draft and the registry, then dedupes them (same collection and key: the later stands,
 * so the agent's fix replaces what it fixed; same kind and name as another proposal or an existing entity: dropped), at most `max` kept
 * (`build.jobs.maxProposals`). Import never changes existing ids; Refine may. Fields a kind lacks, or values of the wrong type, are dropped
 * with a note; a proposal whose kind or references don't resolve is dropped. Each kept proposal names its pack for review grouping.
 */
export function checkProposals(world: WorldDoc, registry: Registry, raw: readonly JobProposal[], mode: ProposalMode, max: number, sources?: ImportSources, drops: DropCounts = new Map()): JobProposal[] {
  const drop = (why: string, fields?: Record<string, string | number>): void => addDrop(drops, why, fields);
  const byKey = new Map<string, JobProposal>();
  for (const p of raw) {
    const key = SNAKE.test(p.key) ? p.key : snake(p.key);
    if (!key || !safeKey(key)) {
      drop("no_id");
      continue;
    }
    const id = `${p.collection}:${key}`;
    if (byKey.has(id)) drop("replaced");
    byKey.delete(id);
    byKey.set(id, { ...p, key });
  }
  const proposedPlaces = new Set([...byKey.values()].filter((p) => p.collection === "places").map((p) => p.key));
  const proposedEntities = new Set([...byKey.values()].filter((p) => p.collection === "entities").map((p) => p.key));
  const placeKnown = (id: string): boolean => hasOwn(world.places, id) || proposedPlaces.has(id);
  const known = (id: string): boolean => hasOwn(world.entities, id) || hasOwn(world.places, id) || proposedEntities.has(id) || proposedPlaces.has(id);
  const names = new Set(Object.values(world.entities).map((e) => `${e.kind}:${e.name.trim().toLowerCase()}`));
  const fallbackKind = baseKind(world, registry);
  const out: JobProposal[] = [];
  for (const p of byKey.values()) {
    if (out.length >= max) {
      drop("past_limit", { max });
      continue;
    }
    const exists = hasOwn(world[p.collection] as Record<string, unknown>, p.key);
    if (exists && mode === "import") {
      drop("exists");
      continue;
    }
    if (p.collection === "entities" && p.key === world.pov) {
      drop("player_character");
      continue;
    }
    const v = isRecord(p.value) ? p.value : {};
    const notes: string[] = p.note ? [p.note] : [];
    let value: JsonObject | null = null;
    let pack = "space";
    if (p.collection === "entities") {
      const stated = typeof v.kind === "string" ? v.kind : "";
      const base = exists ? world.entities[p.key] : undefined;
      // No kind (missing, null, "" or "none", and no kind of that id here): a change keeps the
      // entity's kind; a new entity takes the world's one base kind, marked assumed for review, and
      // with no single base kind it is dropped.
      const kindless = (v.kind === undefined || v.kind === null || (typeof v.kind === "string" && /^\s*(none)?\s*$/i.test(v.kind))) && !kindOf(world, registry, stated);
      const kindId = kindless ? (base?.kind ?? fallbackKind ?? stated) : stated;
      const assumeKind = base === undefined && kindId !== stated;
      const kind = kindOf(world, registry, kindId);
      // A proposed name reaches engine sections, chips and messages: never a host macro.
      const name = typeof v.name === "string" ? neutralizeMacros(v.name).trim() : "";
      if (!kind) {
        drop("unknown_kind", { kind: stated || "none" });
        continue;
      }
      if (assumeKind) notes.push(say("build_assumed_kind_kindid_the_lore_named", { kindId }));
      if (name === "") {
        drop("no_name");
        continue;
      }
      const nameKey = `${kindId}:${name.toLowerCase()}`;
      if (!exists && names.has(nameKey)) {
        drop("duplicate_name");
        continue;
      }
      names.add(nameKey);
      pack = kind.pack ?? "world";
      const defs = fieldsOf(world, registry, kindId);
      const fields: JsonObject = {};
      for (const [f, raw] of Object.entries(isRecord(v.fields) ? v.fields : {})) {
        const def = safeKey(f) && hasOwn(defs, f) ? defs[f] : undefined;
        const checked = def ? fieldValue(def, raw, known) : undefined;
        if (checked === undefined) notes.push(say("build_dropped_field_f", { f }));
        else fields[f] = checked;
      }
      const relations = (Array.isArray(v.relations) ? v.relations : []).filter((r): r is JsonObject => isRecord(r) && typeof r.type === "string" && typeof r.to === "string" && known(r.to) && (hasOwn(world.relations, r.type) || registry.relations.has(r.type)));
      // Gap-fill (DESIGN §9.7): a table-backed field the lore left out, or named loosely, takes the
      // best-matching row (from the given text, else the entity's name), marked assumed for review.
      const assumed: string[] = [];
      for (const [f, def] of Object.entries(defs)) {
        const table = def.table && hasOwn(world.tables, def.table) ? world.tables[def.table] : undefined;
        if (!table || def.type !== "text" || def.derived) continue;
        // A thing's catalog row names what it is first (DESIGN §9.7): "Truck bed" is the pickup bed the
        // gear tables declare a part built into a vehicle, never the price catalog's bed sheet set.
        const from = def.table === "economy.catalog" ? [...THING_TABLES.flatMap((t) => (hasOwn(world.tables, t) && world.tables[t] ? [world.tables[t]] : [])), table] : [table];
        const given = fields[f];
        if (typeof given === "string" && from.some((t) => hasOwn(t.rows, given))) continue;
        const row = matchRowIn(from, typeof given === "string" && given.trim() !== "" ? given : name);
        if (!row) {
          if (given !== undefined) notes.push(say("build_f_given_matches_no_label_row", { f, given: String(given), label: table.label }));
          continue;
        }
        fields[f] = row;
        assumed.push(f);
        notes.push(say("build_assumed_f_row", { f, row }));
      }
      // A tier the world doesn't have is the world's spawn tier for something new; a change keeps its own.
      const tier = typeof v.tier === "string" && tierOf(world, v.tier) ? v.tier : (base?.tier ?? spawnTierOf(world));
      const link = sources?.linkOf(p.source) ?? null;
      const linked = [...new Set([...(base?.sources ?? []), ...(link ? [link] : [])])];
      // An assumed kind stays marked until a change gives the entity another kind.
      const marked = [...new Set([...(assumeKind ? ["kind"] : []), ...(base?.assumed ?? []).filter((f) => (f === "kind" ? kindId === base?.kind : !hasOwn(isRecord(v.fields) ? v.fields : {}, f))), ...assumed])];
      const proposed: JsonObject = { id: p.key, kind: kindId, name, tier, fields, relations: relations.map((r) => ({ type: r.type, to: r.to })), ...(typeof v.agent === "boolean" ? { agent: v.agent } : {}), ...(linked.length > 0 ? { sources: linked } : {}), ...(marked.length > 0 ? { assumed: marked } : {}) };
      // A Refine change keeps what it doesn't mention (fields merge; relations stay unless given).
      value = base ? { ...(JSON.parse(JSON.stringify(base)) as JsonObject), ...proposed, fields: { ...base.fields, ...fields }, relations: relations.length > 0 ? proposed.relations : (JSON.parse(JSON.stringify(base.relations)) as JsonValue) } : proposed;
    } else if (p.collection === "places") {
      const name = typeof v.name === "string" ? neutralizeMacros(v.name).trim() : "";
      if (name === "") {
        drop("no_name");
        continue;
      }
      const parent = typeof v.parent === "string" && v.parent !== p.key && placeKnown(v.parent) ? v.parent : undefined;
      if (typeof v.parent === "string" && !parent) notes.push(say("build_dropped_unknown_parent_parent", { parent: v.parent }));
      const base = exists ? world.places[p.key] : undefined;
      const link = sources?.linkOf(p.source) ?? null;
      const linked = [...new Set([...(base?.sources ?? []), ...(link ? [link] : [])])];
      const proposed: JsonObject = { id: p.key, name, fields: isRecord(v.fields) ? v.fields : {}, ...(parent ? { parent } : {}), ...(typeof v.sceneType === "string" ? { sceneType: v.sceneType } : {}), ...(linked.length > 0 ? { sources: linked } : {}) };
      value = base ? { ...(JSON.parse(JSON.stringify(base)) as JsonObject), ...proposed, fields: { ...base.fields, ...(isRecord(v.fields) ? v.fields : {}) } } : proposed;
    } else {
      const from = typeof v.from === "string" ? v.from : "";
      const to = typeof v.to === "string" ? v.to : "";
      if (!placeKnown(from) || !placeKnown(to) || from === to) {
        drop("no_places");
        continue;
      }
      const modes: JsonObject = {};
      const rawModes = isRecord(v.modes) ? v.modes : {};
      for (const m of TRAVEL_MODES) {
        const leg = rawModes[m];
        if (isRecord(leg) && typeof leg.minutes === "number" && leg.minutes > 0) modes[m] = { minutes: Math.round(leg.minutes), ...(typeof leg.distanceKm === "number" ? { distanceKm: leg.distanceKm } : {}) };
      }
      if (Object.keys(modes).length === 0) {
        drop("no_travel_time");
        continue;
      }
      value = { id: p.key, from, to, modes, bidirectional: v.bidirectional !== false };
    }
    out.push({ ...p, value, pack, ...(notes.length > 0 ? { note: notes.join("; ") } : {}) });
  }
  return out;
}
