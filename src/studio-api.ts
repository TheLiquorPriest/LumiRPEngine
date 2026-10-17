// The studio seam (DESIGN §15, D23): what a studio built on Warp Studio needs to author worlds for
// this engine without a host — load, validate, lint, Check world, Playtest, migrate, and the
// format and engine versions. Pure (pack cores and the engine only; lint-enforced) and exported
// through the package `exports` map as `lumi-rp-engine/studio`.

import { hashJson } from "./shared/hash";
import { isRecord } from "./shared/json";
import type { JsonValue } from "./shared/json";
import type { LintIssue } from "./shared/protocol";
import type { SheetSectionView } from "./shared/state-view";
import type { RulesetDef, StudioState, WorldDoc } from "./shared/world";
import { ENGINE_VERSION, WORLD_FORMAT } from "./shared/world";
import { blankWorld, checkWorldDay, isWorldDoc, lintWorld, migrateWorld, playtestStart, playtestTurn, previewSheet, type PlaytestTurn } from "./engine/authoring";
import { createRegistry, type Registry } from "./engine/registry-impl";
import type { WorldState } from "./engine/state";
import { planTurn, postTurn, timelapseIntent } from "./engine/turn";
import { ALL_PACKS } from "./packs/index";

export { ENGINE_VERSION, WORLD_FORMAT };
export type { LintIssue, PlaytestTurn, RulesetDef, SheetSectionView, StudioState, WorldDoc };

/** The export file wrapper `lre.world export` writes. */
export const EXPORT_FORMAT = "lre-world-export-v1";

/** Every pack this engine ships, by id, with its version. */
export const PACK_VERSIONS: Readonly<Record<string, number>> = Object.fromEntries(ALL_PACKS.map((p) => [p.id, p.version]));

let registry: Registry | null = null;
function registryOf(): Registry {
  registry ??= createRegistry(ALL_PACKS);
  return registry;
}

const pipeline = { plan: planTurn, post: postTurn };

const COLLECTIONS = ["packs", "kinds", "relations", "entities", "places", "routes", "grids", "rules", "actions", "checks", "schedules", "tracks", "tables", "sections", "steps"] as const;
/** Collections documents written before them lack; `migrate` adds them empty, so they're checked only when present. */
const LATER_COLLECTIONS = ["classifications"] as const;
const SINGLETONS = ["pins", "calendar", "realism", "time", "start", "currency"] as const;

/** Shape checks for an untrusted document: every collection and singleton part present. */
export function validate(doc: unknown): LintIssue[] {
  const issues: LintIssue[] = [];
  const err = (path: string, message: string): void => {
    issues.push({ severity: "error", path, code: "shape", message });
  };
  if (!isRecord(doc)) return [{ severity: "error", path: "", code: "shape", message: "not a JSON object" }];
  if (doc.format !== WORLD_FORMAT) err("format", `format must be ${WORLD_FORMAT}`);
  if (typeof doc.id !== "string" || doc.id === "") err("id", "the world needs an id");
  if (typeof doc.name !== "string") err("name", "the world needs a name");
  if (typeof doc.pov !== "string") err("pov", "the world needs a POV entity id");
  for (const key of COLLECTIONS) if (!isRecord(doc[key])) err(key, `${key} must be an object`);
  for (const key of LATER_COLLECTIONS) if (doc[key] !== undefined && !isRecord(doc[key])) err(key, `${key} must be an object`);
  for (const key of SINGLETONS) if (key !== "currency" && !isRecord(doc[key])) err(key, `${key} must be an object`);
  if (!Array.isArray(doc.suppressed)) err("suppressed", "suppressed must be a list");
  if (doc.seedMode !== "fresh" && doc.seedMode !== "same_roll") err("seedMode", "seedMode must be fresh or same_roll");
  if (typeof doc.lenientPricing !== "boolean") err("lenientPricing", "lenientPricing must be true or false");
  // The ruleset is optional (DESIGN §11); lint checks its parts.
  if (doc.ruleset !== undefined && !isRecord(doc.ruleset)) err("ruleset", "ruleset must be an object");
  return issues;
}

/** The Sheet Designer's preview: the world's designed sheet as an entity (the POV by default) starts with it; null without one. */
export function sheetPreview(world: WorldDoc, entity?: string): SheetSectionView[] | null {
  return previewSheet(registryOf(), world, entity);
}

export type LoadResult = { ok: true; world: WorldDoc; issues: LintIssue[] } | { ok: false; issues: LintIssue[] };

/** Loads a world from JSON text, a document, or an export file; migrates it to this engine and lints it. */
export function load(input: string | JsonValue): LoadResult {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch (error) {
      return { ok: false, issues: [{ severity: "error", path: "", code: "json", message: error instanceof Error ? error.message : String(error) }] };
    }
  }
  if (isRecord(value) && value.format === EXPORT_FORMAT) value = value.world;
  const shape = validate(value);
  if (shape.length > 0 || !isWorldDoc(value)) return { ok: false, issues: shape };
  const world = migrateWorld(value);
  return { ok: true, world, issues: lint(world) };
}

/** Brings a document written by an older engine up to this one (no-op when current). */
export function migrate(world: WorldDoc): WorldDoc {
  return migrateWorld(world);
}

/** Structural checks plus every pack's lint rules. */
export function lint(world: WorldDoc): LintIssue[] {
  return lintWorld(world, registryOf());
}

/** A new minimal world (one POV person in one place). */
export function newWorld(id: string, name: string): WorldDoc {
  return blankWorld(id, name);
}

/** The revision id a document would get when committed (its content hash). */
export function revisionOf(world: WorldDoc): string {
  return hashJson(world);
}

export function exportFile(world: WorldDoc): JsonValue {
  return JSON.parse(JSON.stringify({ format: EXPORT_FORMAT, world })) as JsonValue;
}

export interface RunResult {
  turns: PlaytestTurn[];
  lint: LintIssue[];
}

/** Playtest: typed turns through the engine with no narrator, from the world's start. */
export function playtest(world: WorldDoc, turns: readonly string[], runSeed = "studio"): RunResult {
  const reg = registryOf();
  let state: WorldState = playtestStart(reg, world, revisionOf(world));
  const out: PlaytestTurn[] = [];
  turns.forEach((user, i) => {
    const step = playtestTurn(reg, pipeline, world, state, user, runSeed, i);
    state = step.state;
    out.push(step.turn);
  });
  return { turns: out, lint: lint(world) };
}

/** Check world: `days` simulated days (1–14) from the start, every interrupt at `note`; drops, failures and leaks as notes. */
export function checkWorld(world: WorldDoc, days = 3, runSeed = "studio"): RunResult {
  const reg = registryOf();
  const overrides: Record<string, string> = {};
  for (const id of Object.keys(world.time.interrupts)) overrides[id] = "note";
  const intent = timelapseIntent({ type: "duration", minutes: 24 * 60 }, overrides);
  let state: WorldState = playtestStart(reg, world, revisionOf(world));
  const out: PlaytestTurn[] = [];
  const count = Math.max(1, Math.min(14, Math.floor(days)));
  for (let i = 0; i < count; i++) {
    const step = checkWorldDay(reg, pipeline, world, state, runSeed, i, intent);
    state = step.state;
    out.push(step.turn);
  }
  return { turns: out, lint: lint(world) };
}

/** The `lre-state-v1` window event payload the frontend announces for a studio to discover (DESIGN §15). */
export function studioState(inbound: readonly string[]): StudioState {
  return { engineVersion: ENGINE_VERSION, worldFormat: WORLD_FORMAT, packs: { ...PACK_VERSIONS }, inbound: [...inbound] };
}
