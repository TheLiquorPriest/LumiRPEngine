// Import from lore and Build/Refine with AI (DESIGN §9.7, §13): the helper proposes world edits
// per pack — people, places, routes, and entities of every pack's kinds (accounts, items,
// vehicles, factions, regions…) — under strict rules like extraction's; each proposal is then
// checked against the world and the registry (kinds, field types, references), normalized and
// deduplicated deterministically. The player reviews them; accepted ones go to the draft.

import { hasOwn, isRecord, safeKey } from "../shared/json";
import type { JsonObject, JsonValue } from "../shared/json";
import { neutralizeMacros } from "../shared/macros";
import type { JobProposal, WorldCollection } from "../shared/protocol";
import type { DataTable } from "../shared/tables";
import { spawnTierOf, tierOf, tiersInOrder } from "../shared/tiers";
import type { FieldDef, KindDef, WorldDoc } from "../shared/world";
import type { Registry } from "../engine/registry-impl";

/** Bounds: lore entries per call, calls per import, characters per entry, proposals per call and per job. */
export const IMPORT_CHUNK = 6;
export const IMPORT_MAX_CALLS = 12;
export const ENTRY_MAX_CHARS = 1500;
export const PROPOSALS_PER_CALL = 15;
export const PROPOSALS_MAX = 120;
/**
 * The least a proposal call may answer in, in tokens: up to 15 proposals with their fields, after a
 * reasoning model's thinking, need more than a step's 8,192, and a reply cut off reads as no JSON.
 */
export const PROPOSAL_MAX_TOKENS = 16_384;

export type ProposalMode = "import" | "refine";

const COLLECTIONS: Record<string, "entities" | "places" | "routes"> = { entities: "entities", places: "places", routes: "routes" };
const TRAVEL_MODES = ["walk", "road", "offroad", "water"] as const;

/** Strict rules shared by both jobs (the extraction lesson, DESIGN §9.4: precision needs them). */
export const PROPOSAL_STRICT_RULES = [
  "Propose only what the text states. Never invent numbers, prices, balances, distances or times; leave a field out instead.",
  "Use only the kinds and fields listed below; any other field is dropped.",
  "Reference only ids that exist in the world or that you propose in the same answer.",
  "Never propose the POV entity or change its tier.",
  `At most ${PROPOSALS_PER_CALL} proposals. Ids are lowercase snake_case and stable (the same thing always gets the same id).`,
  "confidence is 0..1: 0.9+ only when the text states it outright; add a short note when you are unsure.",
].join("\n- ");

function kindOf(world: WorldDoc, registry: Registry, id: string): KindDef | undefined {
  // Own keys only: a proposed "constructor", "__proto__" or "toString" is no kind.
  return (hasOwn(world.kinds, id) ? world.kinds[id] : undefined) ?? registry.kinds.get(id);
}

/** A kind's fields, inherited ones included (nearest definition wins). */
export function fieldsOf(world: WorldDoc, registry: Registry, kindId: string): Record<string, FieldDef> {
  const chain: KindDef[] = [];
  for (let k = kindOf(world, registry, kindId), guard = 0; k && guard < 16; k = k.extends ? kindOf(world, registry, k.extends) : undefined, guard++) chain.unshift(k);
  return Object.assign({}, ...chain.map((k) => k.fields)) as Record<string, FieldDef>;
}

function fieldLabel(id: string, f: FieldDef): string {
  if (f.type === "enum" && f.values) return `${id}:enum(${f.values.join("|")})`;
  if (f.type === "ref") return `${id}:ref${f.ref ? `(${f.ref})` : ""}`;
  if (f.type === "money") return `${id}:money(integer minor units)`;
  return `${id}:${f.type}`;
}

/** The kinds the helper may propose, grouped by pack, with their fields. */
export function kindCatalog(world: WorldDoc, registry: Registry): string {
  const ids = new Set([...registry.kinds.keys(), ...Object.keys(world.kinds)]);
  const byPack = new Map<string, string[]>();
  for (const id of [...ids].sort()) {
    const k = kindOf(world, registry, id);
    if (!k) continue;
    const pack = k.pack ?? "world";
    // The kind's own fields first (they say what it is), then inherited ones.
    const all = fieldsOf(world, registry, id);
    const order = [...Object.keys(k.fields), ...Object.keys(all).filter((f) => !(f in k.fields))];
    const fields = order
      .slice(0, 16)
      .map((f) => fieldLabel(f, all[f] ?? { type: "text" }))
      .join(", ");
    byPack.set(pack, [...(byPack.get(pack) ?? []), `${id}${k.extends ? ` (a ${k.extends})` : ""}: ${fields || "no fields"}`]);
  }
  return [...byPack].map(([pack, kinds]) => `[${pack}] ${kinds.join("; ")}`).join("\n");
}

/** The world's name, POV, entities and places (the first 60 of each), as the helper's prompts name them. */
export function worldSummary(world: WorldDoc): string {
  const ents = Object.values(world.entities)
    .slice(0, 60)
    .map((e) => `${e.id}:${e.kind}:${e.name}`)
    .join(", ");
  const places = Object.values(world.places)
    .slice(0, 60)
    .map((p) => `${p.id}:${p.name}`)
    .join(", ");
  return `World "${world.name}". POV: ${world.pov}. Entities: ${ents || "none"}. Places: ${places || "none"}.`;
}

/** The proposal shapes; an entity's tier is one of the world's own (DESIGN §9.1). */
function shapes(world: WorldDoc): string {
  const tiers = tiersInOrder(world)
    .map(([id, t]) => `"${id}" (${t.label})`)
    .join("|");
  return `Shapes: entities {id, kind, name, tier (${tiers}), fields: {...}, relations?: [{type, to}], agent?: boolean}; places {id, name, parent?, sceneType?, fields: {}}; routes {id, from, to, modes: {walk?|road?|offroad?|water?: {minutes, distanceKm?}}, bidirectional}.`;
}

/** The reply's shape, in the prompt and in the retry's reminder. */
const OUTPUT = '{"proposals":[{"collection":"entities"|"places"|"routes","key":string,"value":{...},"confidence":number,"note"?:string,"source":string}]}';

export function proposalSystem(mode: ProposalMode, world: WorldDoc, registry: Registry): string {
  const task =
    mode === "import"
      ? "You turn roleplay lore entries into structured world data for a simulation engine."
      : "You help an author build a world for a simulation roleplay engine. Propose concrete additions or changes that do what the author asks; keep existing ids for changes.";
  return `${task}\n${worldSummary(world)}\nKinds by pack:\n${kindCatalog(world, registry)}\n${shapes(world)}\nRules:\n- ${PROPOSAL_STRICT_RULES}\nOutput JSON only: ${OUTPUT}${mode === "import" ? '; "source" is the id after "source:" in the heading of the entry the proposal comes from' : ""}.`;
}

/** Added to the request for the one retry, when a reply had nothing usable (`replyProblem`). */
export function proposalRetry(mode: ProposalMode): string {
  const empty = mode === "import" ? "Each entry above describes something; propose what it states." : 'If there is nothing to propose, reply {"proposals":[]}.';
  return `Your last reply had no usable proposals (it was empty, not valid JSON, or not in this shape). Reply with JSON only, in this shape: ${OUTPUT}. ${empty}`;
}

/** A reply in the proposals shape. */
export function isProposalReply(raw: JsonValue | null): raw is JsonObject & { proposals: JsonValue[] } {
  return isRecord(raw) && Array.isArray(raw.proposals);
}

/**
 * Why a helper reply can't be used as proposals, or null when it can: empty or not JSON, JSON of
 * another shape, a list none of whose proposals is readable, or, for Import (whose lore always has
 * text), an empty list. Such a reply gets the one retry.
 */
export function replyProblem(raw: JsonValue | null, mode: ProposalMode): string | null {
  if (raw === null) return "empty or not JSON";
  if (!isProposalReply(raw)) return "JSON in another shape";
  if (raw.proposals.length === 0) return mode === "import" ? "an empty list for lore with text" : null;
  return readProposals(raw, "check").length === 0 ? `none of its ${raw.proposals.length} proposal(s) readable` : null;
}

/** A lore entry's title: its comment, else its keys. */
export function entryTitle(e: { comment: string; keys: readonly string[] }): string {
  return (e.comment || e.keys.join(", ")).trim();
}

/** The lore text for one import call, entries capped in length; each heading names its source id. */
export function loreChunk(entries: readonly { id: string; comment: string; keys: string[]; content: string }[]): string {
  return entries.map((e) => `### ${entryTitle(e) || e.id} (source: ${e.id})\n${e.content.slice(0, ENTRY_MAX_CHARS)}`).join("\n\n");
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
  const wanted = new Set(words(text));
  if (wanted.size === 0) return null;
  let best: string | null = null;
  let score = 0;
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
  return best;
}

/** Proposal checks for Import: resolving a proposal's cited source to a `bookId/entryId` back-link. */
export interface ImportSources {
  linkOf: (source: string) => string | null;
}

/** Parses a reply into raw proposals (shape only; `checkProposals` validates them). A malformed proposal is skipped on its own. */
export function readProposals(raw: JsonValue | null, source: string): JobProposal[] {
  const list = isProposalReply(raw) ? raw.proposals.slice(0, PROPOSALS_PER_CALL) : [];
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

/** Why proposals were dropped, counted per reason (a job that ends with none says why). */
export type DropCounts = Map<string, number>;

export function dropSummary(raw: number, kept: number, drops: DropCounts): string | null {
  if (kept > 0 && drops.size === 0) return null;
  if (raw === 0) return "The helper proposed nothing (or its reply wasn't valid JSON).";
  const reasons = [...drops.entries()].sort((a, b) => b[1] - a[1]).map(([why, n]) => `${n} ${why}`);
  return `${raw - kept} of ${raw} proposal(s) dropped: ${reasons.join("; ")}.`;
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
 * Validates and normalizes proposals against the world and the registry, then dedupes them
 * (same collection and key: the most confident wins; same kind and name as another proposal or an
 * existing entity: dropped). Import never changes existing ids; Refine may. Fields a kind lacks,
 * or values of the wrong type, are dropped with a note; a proposal whose kind or references don't
 * resolve is dropped. Each kept proposal names its pack for review grouping.
 */
export function checkProposals(world: WorldDoc, registry: Registry, raw: readonly JobProposal[], mode: ProposalMode, sources?: ImportSources, drops: DropCounts = new Map()): JobProposal[] {
  const drop = (why: string): void => {
    drops.set(why, (drops.get(why) ?? 0) + 1);
  };
  const byKey = new Map<string, JobProposal>();
  for (const p of raw) {
    const key = SNAKE.test(p.key) ? p.key : snake(p.key);
    if (!key || !safeKey(key)) {
      drop("had no usable id");
      continue;
    }
    const id = `${p.collection}:${key}`;
    const prior = byKey.get(id);
    if (!prior || p.confidence > prior.confidence) byKey.set(id, { ...p, key });
    if (prior) drop("repeated another proposal");
  }
  const proposedPlaces = new Set([...byKey.values()].filter((p) => p.collection === "places").map((p) => p.key));
  const proposedEntities = new Set([...byKey.values()].filter((p) => p.collection === "entities").map((p) => p.key));
  const placeKnown = (id: string): boolean => hasOwn(world.places, id) || proposedPlaces.has(id);
  const known = (id: string): boolean => hasOwn(world.entities, id) || hasOwn(world.places, id) || proposedEntities.has(id) || proposedPlaces.has(id);
  const names = new Set(Object.values(world.entities).map((e) => `${e.kind}:${e.name.trim().toLowerCase()}`));
  const fallbackKind = baseKind(world, registry);
  const out: JobProposal[] = [];
  for (const p of byKey.values()) {
    if (out.length >= PROPOSALS_MAX) {
      drop(`were past the ${PROPOSALS_MAX}-proposal limit`);
      continue;
    }
    const exists = hasOwn(world[p.collection] as Record<string, unknown>, p.key);
    if (exists && mode === "import") {
      drop("already exist in the world");
      continue;
    }
    if (p.collection === "entities" && p.key === world.pov) {
      drop("named the player character");
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
        drop(`used a kind this world doesn't have (${stated || "none"})`);
        continue;
      }
      if (assumeKind) notes.push(`assumed kind: ${kindId} (the lore named none)`);
      if (name === "") {
        drop("had no name");
        continue;
      }
      const nameKey = `${kindId}:${name.toLowerCase()}`;
      if (!exists && names.has(nameKey)) {
        drop("duplicated an existing name");
        continue;
      }
      names.add(nameKey);
      pack = kind.pack ?? "world";
      const defs = fieldsOf(world, registry, kindId);
      const fields: JsonObject = {};
      for (const [f, raw] of Object.entries(isRecord(v.fields) ? v.fields : {})) {
        const def = safeKey(f) && hasOwn(defs, f) ? defs[f] : undefined;
        const checked = def ? fieldValue(def, raw, known) : undefined;
        if (checked === undefined) notes.push(`dropped field ${f}`);
        else fields[f] = checked;
      }
      const relations = (Array.isArray(v.relations) ? v.relations : []).filter((r): r is JsonObject => isRecord(r) && typeof r.type === "string" && typeof r.to === "string" && known(r.to) && (hasOwn(world.relations, r.type) || registry.relations.has(r.type)));
      // Gap-fill (DESIGN §9.7): a table-backed field the lore left out, or named loosely, takes the
      // best-matching row (from the given text, else the entity's name), marked assumed for review.
      const assumed: string[] = [];
      for (const [f, def] of Object.entries(defs)) {
        const table = def.table && hasOwn(world.tables, def.table) ? world.tables[def.table] : undefined;
        if (!table || def.type !== "text" || def.derived) continue;
        const given = fields[f];
        if (typeof given === "string" && hasOwn(table.rows, given)) continue;
        const row = matchRow(table, typeof given === "string" && given.trim() !== "" ? given : name);
        if (!row) {
          if (given !== undefined) notes.push(`${f} "${String(given)}" matches no ${table.label} row`);
          continue;
        }
        fields[f] = row;
        assumed.push(f);
        notes.push(`assumed ${f}: ${row}`);
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
        drop("had no name");
        continue;
      }
      const parent = typeof v.parent === "string" && v.parent !== p.key && placeKnown(v.parent) ? v.parent : undefined;
      if (typeof v.parent === "string" && !parent) notes.push(`dropped unknown parent ${v.parent}`);
      const base = exists ? world.places[p.key] : undefined;
      const link = sources?.linkOf(p.source) ?? null;
      const linked = [...new Set([...(base?.sources ?? []), ...(link ? [link] : [])])];
      const proposed: JsonObject = { id: p.key, name, fields: isRecord(v.fields) ? v.fields : {}, ...(parent ? { parent } : {}), ...(typeof v.sceneType === "string" ? { sceneType: v.sceneType } : {}), ...(linked.length > 0 ? { sources: linked } : {}) };
      value = base ? { ...(JSON.parse(JSON.stringify(base)) as JsonObject), ...proposed, fields: { ...base.fields, ...(isRecord(v.fields) ? v.fields : {}) } } : proposed;
    } else {
      const from = typeof v.from === "string" ? v.from : "";
      const to = typeof v.to === "string" ? v.to : "";
      if (!placeKnown(from) || !placeKnown(to) || from === to) {
        drop("joined places that don't exist");
        continue;
      }
      const modes: JsonObject = {};
      const rawModes = isRecord(v.modes) ? v.modes : {};
      for (const m of TRAVEL_MODES) {
        const leg = rawModes[m];
        if (isRecord(leg) && typeof leg.minutes === "number" && leg.minutes > 0) modes[m] = { minutes: Math.round(leg.minutes), ...(typeof leg.distanceKm === "number" ? { distanceKm: leg.distanceKm } : {}) };
      }
      if (Object.keys(modes).length === 0) {
        drop("had no travel time");
        continue;
      }
      value = { id: p.key, from, to, modes, bidirectional: v.bidirectional !== false };
    }
    out.push({ ...p, value, pack, ...(notes.length > 0 ? { note: notes.join("; ") } : {}) });
  }
  return out;
}
