// The studio seam (DESIGN §15, D23): what a studio built on Warp Studio needs to author worlds for
// this engine without a host — load, validate, lint, Check world, Playtest, migrate, the format
// and engine versions, and the schema reader for the published schemas. Pure (pack cores and the
// engine only; lint-enforced) and exported through the package `exports` map as
// `lumi-rp-engine/studio`. docs/STUDIO.md is its manual.

import { hashJson } from "./shared/hash";
import { isRecord } from "./shared/json";
import type { JsonValue } from "./shared/json";
import type { LintIssue } from "./shared/protocol";
import type { SheetSectionView } from "./shared/state-view";
import { MAP_SCHEMA } from "./shared/maps";
import { checkSchema, pathText, type JsonPath, type Schema, type SchemaProblem } from "./shared/schema-check";
import type { MapDoc, RulesetDef, StudioState, WorldDoc } from "./shared/world";
import { ENGINE_VERSION, EXPORT_FORMAT, WORLD_FORMAT } from "./shared/world";
import { channelId, chatsChannel, engineEndpoint, ENGINE_EXTENSION, offerEndpoint, readOffer, STATE_EVENT, STATE_REQUEST_EVENT, STUDIO_EXTENSION, STUDIO_INBOUND, STUDIO_INSTALLED_EVENT, STUDIO_OFFER_EVENT, worldChannel, worldsChannel } from "./shared/studio-bridge";
import type { StudioChats, StudioChatSummary, StudioInstalled, StudioOffer, StudioWorldEntry, StudioWorldList, StudioWorldRead } from "./shared/studio-bridge";
import { blankWorld, checkWorldDay, isWorldDoc, lintWorld, migrateWorld, playtestStart, playtestTurn, previewSheet, shapeIssues, type PlaytestTurn } from "./engine/authoring";
import { createRegistry, type Registry } from "./engine/registry-impl";
import type { WorldState } from "./engine/state";
import { planTurn, postTurn, timelapseIntent } from "./engine/turn";
import { ALL_PACKS } from "./packs/index";

export { checkSchema, ENGINE_VERSION, EXPORT_FORMAT, MAP_SCHEMA, pathText, WORLD_FORMAT };
/** Shape checks for an untrusted document, before `migrate` and `lint` read it (the backend's patches are checked the same way). */
export { shapeIssues as validate };
export type { JsonPath, LintIssue, MapDoc, PlaytestTurn, RulesetDef, Schema, SchemaProblem, SheetSectionView, StudioState, WorldDoc };
// The Studio bridge contract (docs/STUDIO.md "The Studio bridge"): endpoint names, payloads and window events.
export { channelId, chatsChannel, engineEndpoint, ENGINE_EXTENSION, offerEndpoint, readOffer, STATE_EVENT, STATE_REQUEST_EVENT, STUDIO_EXTENSION, STUDIO_INBOUND, STUDIO_INSTALLED_EVENT, STUDIO_OFFER_EVENT, worldChannel, worldsChannel };
export type { StudioChats, StudioChatSummary, StudioInstalled, StudioOffer, StudioWorldEntry, StudioWorldList, StudioWorldRead };

/** Every pack this engine ships, by id, with its version. */
export const PACK_VERSIONS: Readonly<Record<string, number>> = Object.fromEntries(ALL_PACKS.map((p) => [p.id, p.version]));

let registry: Registry | null = null;
function registryOf(): Registry {
  registry ??= createRegistry(ALL_PACKS);
  return registry;
}

const pipeline = { plan: planTurn, post: postTurn };

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
  const shape = shapeIssues(value);
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

/** The export file `lre.world export` writes and Import reads: `{format: "lre-world-export-v1", world}`. */
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

/** The `lre-state-v1` window event payload the frontend announces for a studio to discover (DESIGN §15), with the ways a world comes in. */
export function studioState(): StudioState {
  return { engineVersion: ENGINE_VERSION, worldFormat: WORLD_FORMAT, packs: { ...PACK_VERSIONS }, inbound: [...STUDIO_INBOUND] };
}
