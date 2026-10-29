// Authoring tools shared by the backend, the background lane and the command line's local engine (DESIGN §13):
// world-document checks and migration, lint, Playtest turns, Check world days and the Sheet
// Designer's preview. Pure and deterministic: no packages, no host, no clock.

import type { EntityId, WorldId } from "../shared/ids";
import { hasOwn, isRecord } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { macroHazards } from "../shared/macros";
import type { LintIssue } from "../shared/protocol";
import type { SheetSectionView } from "../shared/state-view";
import type { SheetSkill } from "../shared/inferred";
import { currentSignals, hasRetiredSignal, knownSignal, PURPOSE_PLACEHOLDERS, STEP_OUTPUTS, STEP_PLACEHOLDERS } from "../shared/steps";
import { MIND_PURPOSES } from "../shared/minds";
import { defaultTiers, leadTierOf, tierOf } from "../shared/tiers";
import type { ActionDef, WorldCurrency, WorldDoc } from "../shared/world";
import type { DataTable } from "../shared/tables";
import { builtInSectionsOf, DEFAULT_SECTIONS, sectionTemplateProblem } from "../shared/sections";
import { compileMaps } from "../shared/maps";
import { DEFAULT_CURRENCY, ENGINE_VERSION, isHardLock, readSectionFeed, requirementExpr, SECTION_FEED_KEYS, WORLD_FORMAT } from "../shared/world";
import { applyEvent, validateEvent } from "./events";
import { identifiers } from "./expr";
import type { Registry } from "./registry-impl";
import { worldSkills } from "./inferred";
import { buildEntitySheet } from "./ruleset";
import type { InterpretOutput, TurnPipeline } from "./steps";
import type { WorldState } from "./state";
import { findLeaks, readsStory, unrevealedSecrets } from "./visibility";
import { lintLore } from "./lore-lint";
import { lintStructure } from "./world-lint";
import { initialState } from "./world-state";
import { authorLines, playerLines } from "./player-events";
import { typedIntent } from "./typed-intent";
import { migrateMoney } from "./money-migrate";
import { MINDS_SLOT } from "../shared/minds";
import { sourceOf } from "./feed";

// ---------------------------------------------------------------- documents

/** A minimal valid world: one POV person in one place, the default tiers, Story realism, the Modern US calendar. */
export function blankWorld(id: WorldId, name: string): WorldDoc {
  return {
    format: WORLD_FORMAT,
    id,
    name,
    engineVersion: ENGINE_VERSION,
    packs: {},
    pins: { generators: {}, tables: {} },
    kinds: { person: { id: "person", label: "Person", fields: {} } },
    relations: {},
    entities: { you: { id: "you", kind: "person", name: "You", tier: "principal", fields: {}, relations: [] } },
    places: { home: { id: "home", name: "Home", fields: {} } },
    routes: {},
    grids: {},
    maps: {},
    rules: {},
    actions: {},
    checks: {},
    calendar: {
      system: "gregorian",
      epoch: "2026-01-01T00:00",
      timeZone: "America/New_York",
      dayParts: [
        { id: "night", label: "Night", start: "00:00" },
        { id: "morning", label: "Morning", start: "06:00" },
        { id: "afternoon", label: "Afternoon", start: "12:00" },
        { id: "evening", label: "Evening", start: "18:00" },
      ],
      holidays: [],
    },
    schedules: {},
    tracks: {},
    tables: {},
    realism: {
      preset: "story",
      levels: { money: 1, gear: 1, vehicles: 1, castlife: 1, relationships: 1, space: 2, calendar: 2, weather: 1, sheets: 1 },
      tierCaps: { principal: {}, supporting: {}, background: {} },
    },
    time: {
      sceneTicks: { conversation: 2, action: 1, exploration: 10, downtime: 30 },
      interrupts: { invitation: "stop", bill: "note", decline: "stop", incident: "stop", quest: "stop", rule: "note", arrival: "stop", overdue: "note", needs: "ignore", weather: "ignore" },
      speedThrough: { sleep: { mode: "offer", thresholdMinutes: 30 } },
      montage: "key",
      unitCap: { agentDays: 600, events: 5000 },
    },
    sections: {},
    steps: {},
    suppressed: [],
    lore: {},
    loreIndex: { terms: {}, topics: {} },
    seedMode: "fresh",
    lenientPricing: false,
    currency: { ...DEFAULT_CURRENCY },
    pov: "you",
    tiers: defaultTiers(),
    classifications: {},
    start: { place: "home", at: "2026-01-01T08:00" },
  };
}

/**
 * A world made from nothing, as Build and the command line make one: the minimal world with every pack's
 * default table copied in and pinned at its revision, as the starter templates carry them, so it
 * prices, pays and dresses as a world made from a template does.
 */
export function newBlankWorld(id: WorldId, name: string, registry: Pick<Registry, "tables">): WorldDoc {
  const world = blankWorld(id, name);
  const tables: Record<string, DataTable> = {};
  for (const [tid, def] of registry.tables) if (def.defaults) tables[tid] = structuredClone(def.defaults);
  return { ...world, tables, pins: { ...world.pins, tables: Object.fromEntries(Object.entries(tables).map(([tid, t]) => [tid, t.revision])) } };
}

/** A document that has the shape of `lre-world-v1` (enough to load and lint it). */
export function isWorldDoc(v: unknown): v is WorldDoc {
  return isRecord(v) && v.format === WORLD_FORMAT && typeof v.id === "string" && isRecord(v.entities) && isRecord(v.places) && typeof v.pov === "string";
}

/** Collections every document has, each an object keyed by id. */
const COLLECTIONS = ["packs", "kinds", "relations", "entities", "places", "routes", "grids", "rules", "actions", "checks", "schedules", "tracks", "tables", "sections", "steps"] as const;
/**
 * Collections checked only when present: those documents written before them lack, which
 * `migrateWorld` adds (empty, or the default tiers), and routines, which a world may simply not have.
 */
const LATER_COLLECTIONS = ["maps", "lore", "classifications", "tiers", "routines"] as const;
/** Parts every document has. */
const PARTS = ["pins", "calendar", "realism", "time", "start"] as const;
/**
 * Parts a document may leave out: `migrateWorld` fills the currency (Modern US) and the lore lookup
 * table (empty), and a world without a ruleset, map settings, minds config, lore pins, routine
 * settings, section wording or narrator default plays by the defaults.
 */
const OPTIONAL_PARTS = ["currency", "loreIndex", "ruleset", "mapSettings", "minds", "lorePins", "routineSettings", "sectionTemplates", "narrator"] as const;

/**
 * Shape checks for an untrusted document, before `migrateWorld` and `lintWorld` read it: every
 * collection an object of objects, every part an object, the scalar parts of the right kind. The
 * published schema (`schemas/lre-world-v1.schema.json`) checks everything inside them.
 */
export function shapeIssues(doc: unknown): LintIssue[] {
  const issues: LintIssue[] = [];
  const err = (path: string, message: string): void => {
    issues.push({ severity: "error", path, code: "shape", message });
  };
  if (!isRecord(doc)) return [{ severity: "error", path: "", code: "shape", message: "not a JSON object" }];
  const collection = (key: string): void => {
    const value = doc[key];
    if (!isRecord(value)) return err(key, `${key} must be an object`);
    for (const [id, item] of Object.entries(value)) if (!isRecord(item)) err(`${key}.${id}`, `each of ${key} must be an object`);
  };
  if (doc.format !== WORLD_FORMAT) err("format", `format must be ${WORLD_FORMAT}`);
  if (typeof doc.id !== "string" || doc.id === "") err("id", "the world needs an id");
  if (typeof doc.name !== "string") err("name", "the world needs a name");
  if (doc.engineVersion !== undefined && typeof doc.engineVersion !== "string") err("engineVersion", "engineVersion must be text");
  if (typeof doc.pov !== "string") err("pov", "the world needs a POV entity id");
  for (const key of COLLECTIONS) collection(key);
  for (const key of LATER_COLLECTIONS) if (doc[key] !== undefined) collection(key);
  for (const key of PARTS) if (!isRecord(doc[key])) err(key, `${key} must be an object`);
  for (const key of OPTIONAL_PARTS) if (doc[key] !== undefined && !isRecord(doc[key])) err(key, `${key} must be an object`);
  if (!Array.isArray(doc.suppressed)) err("suppressed", "suppressed must be a list");
  if (doc.seedMode !== "fresh" && doc.seedMode !== "same_roll") err("seedMode", "seedMode must be fresh or same_roll");
  if (typeof doc.lenientPricing !== "boolean") err("lenientPricing", "lenientPricing must be true or false");
  if (doc.spawnTier !== undefined && typeof doc.spawnTier !== "string") err("spawnTier", "spawnTier must be a tier id");
  if (doc.spawnCap !== undefined && typeof doc.spawnCap !== "number") err("spawnCap", "spawnCap must be a number");
  // The world's own life states, when it has any: an object of objects, as a collection is.
  if (doc.lifeStates !== undefined) collection("lifeStates");
  return issues;
}

function isCurrency(v: unknown): v is WorldCurrency {
  return isRecord(v) && typeof v.code === "string" && typeof v.symbol === "string" && typeof v.minorUnit === "string" && typeof v.decimals === "number" && typeof v.format === "string";
}

export function currencyOf(v: unknown): WorldCurrency | null {
  return isCurrency(v) ? { code: v.code, symbol: v.symbol, minorUnit: v.minorUnit, decimals: v.decimals, format: v.format } : null;
}

/** Step purposes earlier builds had: `select` (lore selection) and `contradiction` (the check of a reply against the engine's facts, retired when the story and the user's directives came to win, DESIGN D36). */
const RETIRED_PURPOSES: readonly string[] = ["select", "contradiction"];

/**
 * Brings an older `lre-world-v1` document up to this engine: documents written before `currency`,
 * `lore`, `loreIndex`, `classifications`, `maps` or `tiers` existed (and templates without them) get
 * Modern US money, no lore, an empty lookup table (a malformed one keeps its well-formed half), no
 * classifications, no maps and the three default tiers, whose ids are the band ids their entities
 * already name; a POV still on the legacy `pov` tier moves to the lead tier (the POV is `pov`, never
 * capped whatever its tier); step templates for a retired purpose (`RETIRED_PURPOSES`) are dropped,
 * and so is a retired purpose a secret lore entry's audience or the step lore pins name, which
 * nothing reads or edits any more; a template's retired signal reads as the one that stands for it
 * (`classifier` as `typed_input`); and the economy pack's old `unpricedCapCents` becomes
 * `unpricedCap` (the same minor units; a set `unpricedCap` wins). A world
 * without a `ruleset` keeps none: every part of one is optional, and nothing reads a missing one;
 * one without a `spawnCap` keeps none too and plays at the default 24. Lore entries need nothing
 * else: their new fields are optional, and one without a source was authored. Last, the maps
 * compile into the places, grids and routes they own (`compileMaps`). Revisions are immutable, so
 * this runs whenever one is read. Returns the same object when nothing changes.
 */
export function migrateWorld(stored: WorldDoc): WorldDoc {
  const doc = migrateMoney(stored);
  const currency: unknown = doc.currency;
  const lore: unknown = doc.lore;
  const loreIndex: unknown = doc.loreIndex;
  const indexed = isRecord(loreIndex) && isRecord(loreIndex.terms) && isRecord(loreIndex.topics);
  const classifications: unknown = doc.classifications;
  const maps: unknown = doc.maps;
  const steps: unknown = doc.steps;
  const hasTiers = isRecord(doc.tiers);
  const tiers = hasTiers ? doc.tiers : defaultTiers();
  const retiredPurpose = (purpose: unknown): boolean => typeof purpose === "string" && RETIRED_PURPOSES.includes(purpose);
  const retired = isRecord(steps) ? Object.entries(steps).flatMap(([id, t]) => (isRecord(t) && retiredPurpose(t.purpose) ? [id] : [])) : [];
  const resignaled = isRecord(steps) ? Object.entries(steps).flatMap(([id, t]) => (isRecord(t) && !retiredPurpose(t.purpose) && Array.isArray(t.signals) && hasRetiredSignal(t.signals.filter((s): s is string => typeof s === "string")) ? [id] : [])) : [];
  const readers = isRecord(lore) ? Object.entries(lore).flatMap(([id, l]) => (isRecord(l) && Array.isArray(l.audience) && l.audience.some(retiredPurpose) ? [id] : [])) : [];
  const lorePins: unknown = doc.lorePins;
  const pinned = isRecord(lorePins) && isRecord(lorePins.steps) && Object.keys(lorePins.steps).some(retiredPurpose);
  const pov = hasOwn(doc.entities, doc.pov) ? doc.entities[doc.pov] : undefined;
  const legacyPov = pov?.tier === "pov" && !tierOf({ tiers }, "pov");
  const economy: unknown = isRecord(doc.packs) ? doc.packs.economy : undefined;
  const config = isRecord(economy) && isRecord(economy.config) ? economy.config : null;
  const oldCap = config !== null && "unpricedCapCents" in config;
  if (isCurrency(currency) && isRecord(lore) && indexed && isRecord(classifications) && isRecord(maps) && hasTiers && retired.length === 0 && resignaled.length === 0 && readers.length === 0 && !pinned && !legacyPov && !oldCap) return compileMaps(doc);
  const out: WorldDoc = { ...doc, currency: isCurrency(currency) ? currency : { ...DEFAULT_CURRENCY }, lore: isRecord(lore) ? doc.lore : {}, classifications: isRecord(classifications) ? doc.classifications : {}, maps: isRecord(maps) ? doc.maps : {}, tiers };
  if (!indexed) out.loreIndex = { terms: isRecord(loreIndex) && isRecord(loreIndex.terms) ? doc.loreIndex.terms : {}, topics: isRecord(loreIndex) && isRecord(loreIndex.topics) ? doc.loreIndex.topics : {} };
  if (retired.length > 0 || resignaled.length > 0) {
    out.steps = { ...doc.steps };
    for (const id of retired) delete out.steps[id];
    for (const id of resignaled) {
      const t = out.steps[id];
      if (t) out.steps[id] = { ...t, signals: currentSignals(t.signals) };
    }
  }
  if (readers.length > 0) {
    out.lore = { ...out.lore };
    for (const id of readers) {
      const l = out.lore[id];
      if (l) out.lore[id] = { ...l, audience: (l.audience ?? []).filter((p) => !retiredPurpose(p)) };
    }
  }
  if (pinned && doc.lorePins) out.lorePins = { ...doc.lorePins, steps: Object.fromEntries(Object.entries(doc.lorePins.steps).filter(([p]) => !retiredPurpose(p))) };
  if (pov && legacyPov) out.entities = { ...doc.entities, [doc.pov]: { ...pov, tier: leadTierOf(out) } };
  const pack = out.packs.economy;
  if (oldCap && config !== null && pack) {
    const { unpricedCapCents: cents, ...rest } = config;
    out.packs = { ...out.packs, economy: { ...pack, config: { ...rest, ...(typeof cents === "number" && rest.unpricedCap === undefined ? { unpricedCap: cents } : {}) } } };
  }
  return compileMaps(out);
}

/** Sections the turn itself fills, besides the packs' renderers: the Outcome, the Montage, the Outline, Scene's elapsed time and the minds. */
const TURN_FED_SECTIONS: Record<string, true> = { outcome: true, montage: true, outline: true, scene: true, [MINDS_SLOT]: true };

/** What an action about a door or a container says it does, in its label, description or ways of saying it. */
const LOCK_WORDS = /\b(?:open|unlock\w*|unbolt|unseal|lock(?:ed|s)?|doors?|gates?|hatch|trapdoor|safe|vault|chest|strongbox|lockbox|locker|cabinet|trunk|drawer|case|box)\b/i;

/** A requirement that the actor carry something, with what it names: a key's shape when that is a thing's id, not a param. */
const CARRIES = /\bcarries\(\s*(?:self|actor|pov)\s*,\s*'?([A-Za-z_][A-Za-z0-9_]*)'?\s*\)/;

/**
 * A requirement that reads like a lock but isn't marked hard (DESIGN §11): on an action about a door
 * or a container, one that the actor carries one named thing, or that the story has come somewhere
 * (`stage`, `flag`, `since`) reading one of the action's params. A typed attempt that misses a plain
 * requirement plays as plain roleplay, so such a lock opens to anyone who types it. A suggestion
 * only: the author knows what is locked, and a `not …` guard (a step not taken yet) is no lock. A
 * story step that reads none of the params hides its action until the story gets there
 * (`storyLocked`), so it is never suggested: a hard lock would list the action, locked, and tell the
 * player the step exists.
 */
function softLocks(id: string, action: ActionDef): LintIssue[] {
  if (!LOCK_WORDS.test([action.label, action.description ?? "", ...(action.lexicon ?? [])].join(" "))) return [];
  return action.requires.flatMap((req, i): LintIssue[] => {
    const expr = requirementExpr(req);
    const key = CARRIES.exec(expr)?.[1];
    const keyed = key !== undefined && !hasOwn(action.params, key);
    const story = readsStory(expr);
    const hides = story && identifiers(expr).every((name) => !hasOwn(action.params, name));
    if (isHardLock(req) || /^\s*not\b/.test(expr) || hides || !(story || keyed)) return [];
    return [{ severity: "info", path: `actions.${id}.requires.${i}`, code: "soft_lock", message: `"${action.label}" reads like a lock, but this requirement isn't marked hard: a typed attempt that misses it plays as plain roleplay, and the reply can tell it working. Mark it a hard lock if the attempt should fail instead.` }];
  });
}

/** Structural checks every world must pass, plus the registry's lint rules. */
export function lintWorld(world: WorldDoc, registry: Registry): LintIssue[] {
  const issues: LintIssue[] = [];
  const err = (path: string, code: string, message: string): void => {
    issues.push({ severity: "error", path, code, message });
  };
  if (world.format !== WORLD_FORMAT) err("format", "format", `format must be ${WORLD_FORMAT}`);
  if (!world.entities[world.pov]) err("pov", "missing_pov", `the POV entity "${world.pov}" does not exist`);
  if (!world.places[world.start.place]) err("start.place", "missing_place", `the start place "${world.start.place}" does not exist`);
  const c = world.currency;
  if (!Number.isInteger(c.decimals) || c.decimals < 0 || c.decimals > 6) err("currency.decimals", "currency", "decimals must be a whole number from 0 to 6");
  if (c.format.trim() === "") err("currency.format", "currency", "the currency needs a display format");
  for (const [id, e] of Object.entries(world.entities)) {
    if (e.id !== id) err(`entities.${id}.id`, "id_mismatch", "the id must match its key");
    if (!world.kinds[e.kind] && !registry.kinds.has(e.kind)) err(`entities.${id}.kind`, "unknown_kind", `unknown kind "${e.kind}"`);
  }
  for (const [id, p] of Object.entries(world.places)) {
    if (p.parent && !world.places[p.parent]) err(`places.${id}.parent`, "missing_place", `unknown parent place "${p.parent}"`);
  }
  for (const [id, r] of Object.entries(world.routes)) {
    if (!world.places[r.from]) err(`routes.${id}.from`, "missing_place", `unknown place "${r.from}"`);
    if (!world.places[r.to]) err(`routes.${id}.to`, "missing_place", `unknown place "${r.to}"`);
  }
  const warn = (path: string, code: string, message: string): void => {
    issues.push({ severity: "warning", path, code, message });
  };
  for (const [id, a] of Object.entries(world.actions)) {
    if (!a.check && Object.keys(a.outcomes).some((o) => o !== "default")) warn(`actions.${id}.check`, "no_check", `"${a.label}" has outcomes other than default but no check, so only "default" ever applies`);
    issues.push(...softLocks(id, a));
  }
  issues.push(...lintLore(world));
  // Section templates wrap engine values: the only macro they may hold is the engine's `{{lines}}`;
  // no escape sentinel or `<user>`-style shorthand either.
  for (const [id, s] of Object.entries(world.sections)) {
    if (macroHazards(s.template, ["{{lines}}"]).length > 0) err(`sections.${id}.template`, "section_macro", `"${s.label}" may use only {{lines}}; any other macro, control character or <user>/<char>/<bot> would act beside engine values`);
  }
  // The world's wording of a built-in section: a text holding `{{lines}}` and no other macro, for a
  // built-in section the world has without listing it (one it lists uses its own template).
  const builtIn = new Set(builtInSectionsOf(world).map((s) => s.id));
  for (const [id, text] of Object.entries(world.sectionTemplates ?? {})) {
    const path = `sectionTemplates.${id}`;
    const label = DEFAULT_SECTIONS[id]?.label ?? id;
    if (typeof text !== "string") {
      err(path, "section_template", `the wording of "${label}" must be text`);
      continue;
    }
    const problem = hasOwn(DEFAULT_SECTIONS, id) ? sectionTemplateProblem(text) : `there is no built-in section "${id}"`;
    if (problem !== null) err(path, "section_template", `"${label}": ${problem}`);
    if (macroHazards(text, ["{{lines}}"]).length > 0) err(path, "section_macro", `"${label}" may use only {{lines}}; any other macro, control character or <user>/<char>/<bot> would act beside engine values`);
    if (hasOwn(DEFAULT_SECTIONS, id) && !builtIn.has(id)) warn(path, "section_template_unused", `"${label}" is the world's own section, so its own template is used and this wording isn't`);
  }
  // A section only the engine's renderers (its own slot's, or its `include`'s) or the turn itself
  // fill: one neither feeds is skipped every turn, without a word (DESIGN §6, §6.11).
  const sources = new Set(registry.renderers.map((r) => sourceOf(r)));
  for (const [id, s] of Object.entries(world.sections)) {
    const feed = readSectionFeed(Object.fromEntries(SECTION_FEED_KEYS.flatMap((k) => (s[k] !== undefined ? [[k, s[k]]] : []))));
    if (!feed) {
      err(`sections.${id}`, "section_feed", `"${s.label}": enabled is on or off, maxTokens and maxLines are whole numbers from 1, include is a list of sources, scope is player, scene or gm`);
      continue;
    }
    for (const source of feed.include ?? []) if (!sources.has(source)) warn(`sections.${id}.include`, "section_source", `"${s.label}" includes "${source}", which no pack renders`);
    const fed = feed.include ? feed.include.some((source) => sources.has(source)) : registry.renderers.some((r) => r.slot === id);
    if (!hasOwn(TURN_FED_SECTIONS, id) && !fed) warn(`sections.${id}`, "section_unfed", `"${s.label}" has nothing to fill it: no pack renders a section with the id "${id}"${feed.include ? " or one it includes" : ""}, so it never goes in`);
  }
  // World step templates (DESIGN §5.2): an output their purpose uses, known signals, engine placeholders
  // (with those only some steps are given), and some text. A blank minds template is the minds lint's.
  for (const [id, t] of Object.entries(world.steps)) {
    if (t.id !== id) err(`steps.${id}.id`, "id_mismatch", "the id must match its key");
    if (!(STEP_OUTPUTS[t.purpose] ?? []).includes(t.output)) warn(`steps.${id}.output`, "step_output", `a ${t.purpose} template can't produce ${t.output}; it would never run`);
    for (const s of t.signals) if (!knownSignal(s)) warn(`steps.${id}.signals`, "unknown_signal", `unknown signal "${s}"`);
    if (t.template.trim() === "" && !(MIND_PURPOSES as readonly string[]).includes(t.purpose)) warn(`steps.${id}.template`, "step_blank", `this ${t.purpose} template is blank: it takes the place of the built-in instructions with none`);
    const known: readonly string[] = [...STEP_PLACEHOLDERS, ...(PURPOSE_PLACEHOLDERS[t.purpose] ?? [])];
    for (const m of t.template.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)) if (!known.includes((m[1] ?? "").toLowerCase())) warn(`steps.${id}.template`, "unknown_placeholder", `{{${m[1] ?? ""}}} isn't an engine placeholder for a ${t.purpose} step; it renders empty`);
  }
  issues.push(...lintStructure(world, registry));
  for (const rule of registry.lints) issues.push(...rule.check(world, registry));
  return issues;
}

/** Every host macro hazard a world carries in lore content and templates, by path (an import lists them for review). */
export function macrosIn(world: WorldDoc): { path: string; macro: string }[] {
  const out: { path: string; macro: string }[] = [];
  const scan = (path: string, text: string): void => {
    for (const macro of macroHazards(text, ["{{lines}}"])) out.push({ path, macro });
  };
  for (const [id, l] of Object.entries(world.lore)) scan(`lore.${id}.content`, l.content);
  for (const [id, s] of Object.entries(world.sections)) scan(`sections.${id}.template`, s.template);
  for (const [id, text] of Object.entries(world.sectionTemplates ?? {})) if (typeof text === "string") scan(`sectionTemplates.${id}`, text);
  for (const [id, t] of Object.entries(world.steps)) scan(`steps.${id}.template`, t.template);
  return out;
}

// ---------------------------------------------------------------- Playtest and Check world

export interface PlaytestTurn {
  user: string;
  reply: string;
  notes: string[];
}

export interface PlaytestStep {
  turn: PlaytestTurn;
  state: WorldState;
}

/** Applies events in order, keeping each that validates; returns the dropped ones' reasons. */
function applyAll(registry: Registry, world: WorldDoc, state: WorldState, events: readonly LedgerEvent[]): string[] {
  const dropped: string[] = [];
  for (const e of events) {
    const ctx = registry.context(world, state);
    const rejection = validateEvent(registry, e, ctx);
    if (rejection) {
      dropped.push(`dropped ${e.type}: ${rejection.reason}`);
      continue;
    }
    applyEvent(registry, e, state, ctx);
  }
  return dropped;
}

export function playtestStart(registry: Registry, world: WorldDoc, revision: string): WorldState {
  return initialState(world, revision, registry);
}

/**
 * One Playtest turn on `state`: engine-only (no model calls, narrator or extraction). The typed text
 * becomes an action by its lexicon and the names it says (`typedIntent`), and the reply is what the
 * player would see of the turn.
 */
export function playtestTurn(registry: Registry, pipeline: TurnPipeline, world: WorldDoc, state: WorldState, user: string, runSeed: string, index: number): PlaytestStep {
  const next = structuredClone(state);
  const intent = typedIntent(registry, world, next, user);
  const plan = pipeline.plan({ registry, world, state: next, runSeed, seed: `${runSeed}:playtest:${index}`, kind: "normal", userTexts: [user], intent });
  const notes = applyAll(registry, world, next, plan.events);
  const post = pipeline.post({ registry, world, state: next, runSeed, seed: `${runSeed}:playtest:${index}:post`, appliedMinutes: plan.elapsedMinutes, extracted: [] });
  notes.push(...applyAll(registry, world, next, post));
  const lines = playerLines(registry, world, next, world.pov, [...plan.events, ...post], 40);
  const action = intent?.action ? [`read as ${registry.actions.get(intent.action)?.label ?? world.actions[intent.action]?.label ?? intent.action}`] : ["not an action"];
  return { turn: { user, reply: lines.length > 0 ? lines.join("\n") : "(nothing changed)", notes: [`+${plan.elapsedMinutes} min`, ...action, ...notes] }, state: next };
}

/** Check world's timelapse length per step: one day. */
export const CHECK_DAY_MINUTES = 24 * 60;

/**
 * One Check world day: a one-day timelapse with every interrupt class at `note`, so processes,
 * agents, tracks and rules all run. Reports dropped events, failures and narrator-facing leaks; the
 * transcript is the author's view of the day: every event, unmet people's and secrets included,
 * worded with names like Playtest's (no ids or bookkeeping).
 */
export function checkWorldDay(registry: Registry, pipeline: TurnPipeline, world: WorldDoc, state: WorldState, runSeed: string, day: number, intent: InterpretOutput): PlaytestStep {
  const next = structuredClone(state);
  const label = `Day ${day + 1}`;
  const notes: string[] = [];
  let events: LedgerEvent[] = [];
  try {
    const plan = pipeline.plan({ registry, world, state: next, runSeed, seed: `${runSeed}:check:${day}`, kind: "normal", userTexts: [`(Timelapse: ${label})`], intent });
    notes.push(...applyAll(registry, world, next, plan.events));
    const post = pipeline.post({ registry, world, state: next, runSeed, seed: `${runSeed}:check:${day}:post`, appliedMinutes: plan.elapsedMinutes, extracted: [] });
    notes.push(...applyAll(registry, world, next, post));
    events = [...plan.events, ...post];
    notes.unshift(`+${plan.elapsedMinutes} min, ${events.length} events`);
  } catch (error) {
    notes.push(`failed: ${error instanceof Error ? error.message : String(error)}`);
    return { turn: { user: label, reply: "(the simulation failed)", notes }, state };
  }
  const secrets = unrevealedSecrets(registry, world, next);
  const ctx = registry.context(world, next);
  for (const r of registry.renderers) {
    try {
      for (const line of r.render(ctx)) for (const leak of findLeaks(line, secrets)) notes.push(`leak in ${r.slot}: "${leak}"`);
    } catch (error) {
      notes.push(`section ${r.slot} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const lines = authorLines(registry, world, next, events, 40);
  return { turn: { user: label, reply: lines.length > 0 ? lines.join("\n") : "(nothing happened)", notes }, state: next };
}

/**
 * The Sheet Designer's preview (DESIGN §11, §13): a world's designed sheet as an entity (the POV by
 * default) has it when a chat starts, so derived fields, pools and progressions read their
 * authored values. Null when the world designs no sheet; nothing is recorded.
 */
export function previewSheet(registry: Registry, world: WorldDoc, entity: EntityId = world.pov): SheetSectionView[] | null {
  return buildEntitySheet(registry.context(world, initialState(world, "preview", registry)), entity);
}

/** The skills a world's sheet has as a chat starts (DESIGN §11 inferred checks): what Build's skills list may name. Nothing is recorded. */
export function previewSkills(registry: Registry, world: WorldDoc): SheetSkill[] {
  return worldSkills(registry, world, initialState(world, "preview", registry));
}

/** Stamps the engine version the document was last written by. */
export function stamped(world: WorldDoc): WorldDoc {
  return { ...world, engineVersion: ENGINE_VERSION };
}
