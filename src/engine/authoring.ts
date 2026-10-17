// Authoring tools shared by the backend, the background lane and the studio seam (DESIGN §13, §15):
// world-document checks and migration, lint, Playtest turns and Check world days. Pure and
// deterministic: no packages, no host, no clock.

import type { WorldId } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { macroHazards } from "../shared/macros";
import type { LintIssue } from "../shared/protocol";
import { knownSignal, STEP_OUTPUTS, STEP_PLACEHOLDERS } from "../shared/steps";
import type { WorldCurrency, WorldDoc } from "../shared/world";
import { DEFAULT_CURRENCY, ENGINE_VERSION, WORLD_FORMAT } from "../shared/world";
import { applyEvent, validateEvent } from "./events";
import type { Registry } from "./registry-impl";
import type { InterpretOutput, TurnPipeline } from "./steps";
import type { WorldState } from "./state";
import { findLeaks, unrevealedTruths } from "./visibility";
import { lintStructure } from "./world-lint";
import { initialState } from "./world-state";
import { authorLines, playerLines } from "./player-events";
import { typedIntent } from "./typed-intent";

// ---------------------------------------------------------------- documents

/** A minimal valid world: one POV person in one place, Story realism, the Modern US calendar. */
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
    entities: { you: { id: "you", kind: "person", name: "You", tier: "pov", fields: {}, relations: [] } },
    places: { home: { id: "home", name: "Home", fields: {} } },
    routes: {},
    grids: {},
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
    seedMode: "fresh",
    lenientPricing: false,
    currency: { ...DEFAULT_CURRENCY },
    pov: "you",
    start: { place: "home", at: "2026-01-01T08:00" },
  };
}

/** A document that has the shape of `lre-world-v1` (enough to load and lint it). */
export function isWorldDoc(v: unknown): v is WorldDoc {
  return isRecord(v) && v.format === WORLD_FORMAT && typeof v.id === "string" && isRecord(v.entities) && isRecord(v.places) && typeof v.pov === "string";
}

function isCurrency(v: unknown): v is WorldCurrency {
  return isRecord(v) && typeof v.code === "string" && typeof v.symbol === "string" && typeof v.minorUnit === "string" && typeof v.decimals === "number" && typeof v.format === "string";
}

export function currencyOf(v: unknown): WorldCurrency | null {
  return isCurrency(v) ? { code: v.code, symbol: v.symbol, minorUnit: v.minorUnit, decimals: v.decimals, format: v.format } : null;
}

/**
 * Brings an older `lre-world-v1` document up to this engine: documents written before `currency`
 * or `lore` existed (and templates without them) get Modern US money and no lore, and step
 * templates for the retired `select` purpose (lore selection) are dropped. Returns the same object
 * when nothing changes.
 */
export function migrateWorld(doc: WorldDoc): WorldDoc {
  const currency: unknown = doc.currency;
  const lore: unknown = doc.lore;
  const steps: unknown = doc.steps;
  const retired = isRecord(steps) ? Object.entries(steps).flatMap(([id, t]) => (isRecord(t) && t.purpose === "select" ? [id] : [])) : [];
  if (isCurrency(currency) && isRecord(lore) && retired.length === 0) return doc;
  const out: WorldDoc = { ...doc, currency: isCurrency(currency) ? currency : { ...DEFAULT_CURRENCY }, lore: isRecord(lore) ? doc.lore : {} };
  if (retired.length > 0) {
    out.steps = { ...doc.steps };
    for (const id of retired) delete out.steps[id];
  }
  return out;
}

/** Structural checks every world must pass, plus the registry's lint rules. */
export function lintWorld(world: WorldDoc, registry: Registry): LintIssue[] {
  const issues: LintIssue[] = [];
  const err = (path: string, code: string, message: string): void => {
    issues.push({ severity: "error", path, code, message });
  };
  if (world.format !== WORLD_FORMAT) err("format", "format", `format must be ${WORLD_FORMAT}`);
  if (!world.entities[world.pov]) err("pov", "missing_pov", `the POV entity "${world.pov}" does not exist`);
  else if (world.entities[world.pov]?.tier !== "pov") err(`entities.${world.pov}.tier`, "pov_tier", "the POV entity must have tier pov");
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
  }
  // Lore holds cue text only; a secret's truth lives in its track (DESIGN §4.2, §7).
  const truths: string[] = [];
  for (const t of Object.values(world.tracks)) for (const s of Object.values(t.stages)) if (s.truth && s.truth.trim().length >= 12) truths.push(s.truth.trim().toLowerCase());
  for (const [id, l] of Object.entries(world.lore)) {
    if (l.id !== id) err(`lore.${id}.id`, "id_mismatch", "the id must match its key");
    for (const link of l.links) if (!world.entities[link] && !world.places[link]) warn(`lore.${id}.links`, "missing_ref", `"${link}" is not an entity or place`);
    if (truths.some((t) => l.content.toLowerCase().includes(t))) err(`lore.${id}.content`, "secret_truth", `"${l.title}" carries a secret's truth; lore holds cue text only`);
    if (l.secret && !l.gate) warn(`lore.${id}.gate`, "no_gate", `secret lore "${l.title}" has no gate, so it can never be revealed`);
  }
  // Section templates wrap engine values: the only macro they may hold is the engine's `{{lines}}`;
  // no escape sentinel or `<user>`-style shorthand either.
  for (const [id, s] of Object.entries(world.sections)) {
    if (macroHazards(s.template, ["{{lines}}"]).length > 0) err(`sections.${id}.template`, "section_macro", `"${s.label}" may use only {{lines}}; any other macro, control character or <user>/<char>/<bot> would act beside engine values`);
  }
  // World step templates (DESIGN §5.2): an output their purpose uses, known signals, engine placeholders.
  for (const [id, t] of Object.entries(world.steps)) {
    if (t.id !== id) err(`steps.${id}.id`, "id_mismatch", "the id must match its key");
    if (!(STEP_OUTPUTS[t.purpose] ?? []).includes(t.output)) warn(`steps.${id}.output`, "step_output", `a ${t.purpose} template can't produce ${t.output}; it would never run`);
    for (const s of t.signals) if (!knownSignal(s)) warn(`steps.${id}.signals`, "unknown_signal", `unknown signal "${s}"`);
    for (const m of t.template.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)) if (!(STEP_PLACEHOLDERS as readonly string[]).includes((m[1] ?? "").toLowerCase())) warn(`steps.${id}.template`, "unknown_placeholder", `{{${m[1] ?? ""}}} isn't an engine placeholder; it renders empty`);
  }
  issues.push(...lintStructure(world, registry));
  for (const rule of registry.lints) issues.push(...rule.check(world));
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

export function playtestStart(world: WorldDoc, revision: string): WorldState {
  return initialState(world, revision);
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
  const secrets = unrevealedTruths(world, next);
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

/** Stamps the engine version the document was last written by. */
export function stamped(world: WorldDoc): WorldDoc {
  return { ...world, engineVersion: ENGINE_VERSION };
}
