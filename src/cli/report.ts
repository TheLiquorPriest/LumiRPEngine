// How tool answers are made: every answer is text (JSON for data), and an error result says what
// to do; and what they report of the engine's findings: lint in severity order, the host macro
// hazards a change brought in, and what a world holds.

import worldSchemaJson from "../../schemas/lre-world-v1.schema.json";
import { macrosIn } from "../engine/authoring";
import { isRecord } from "../shared/json";
import type { LintIssue } from "../shared/protocol";
import type { WorldDoc } from "../shared/world";
import { checkSchema, MAP_SCHEMA, pathText } from "./local-engine";
import type { Schema } from "./local-engine";
import { isCollection } from "./diff";

// A JSON module's inferred type spells out every node, which `Schema` describes in general.
const WORLD_SCHEMA = worldSchemaJson as unknown as Schema;

/**
 * Where a world departs from the published schema, as warnings naming the path: lint doesn't
 * know every key, so a misspelled one (`lifeKnowBy`) reads as nothing there, and only this says so.
 */
export function schemaIssues(world: unknown): LintIssue[] {
  return checkSchema(WORLD_SCHEMA, world, [MAP_SCHEMA]).map((p) => ({ severity: "warning", path: pathText(p.path), code: "schema", message: p.message }));
}

/**
 * One tool's answer. `isError`: the call was refused or failed (MCP's tool error). `failed`: the
 * call worked and found the world failing (a check with errors), which the command line exits 1 on.
 */
export interface ToolResult {
  text: string;
  isError?: true;
  failed?: true;
}

const RANK: Record<LintIssue["severity"], number> = { error: 0, warning: 1, info: 2 };

export interface LintSummary {
  errors: number;
  warnings: number;
  infos: number;
  /** The first issues, errors first. */
  first: LintIssue[];
  /** How many more there are beyond `first`. */
  more: number;
}

export function lintSummary(issues: readonly LintIssue[], shown = 12): LintSummary {
  const sorted = [...issues].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  return {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    infos: issues.filter((i) => i.severity === "info").length,
    first: sorted.slice(0, shown),
    more: Math.max(0, sorted.length - shown),
  };
}

export interface Hazard {
  path: string;
  macro: string;
}

/**
 * The host macro hazards in `after`'s lore, section templates and step templates that `before`
 * didn't have at the same path: what this change brought in, which Lumiverse would act on when
 * it builds a prompt (shared/macros.ts). All of them when there is no `before`.
 */
export function newHazards(before: WorldDoc | null, after: WorldDoc): Hazard[] {
  const had = new Set((before === null ? [] : macrosIn(before)).map((h) => `${h.path}\u0000${h.macro}`));
  return macrosIn(after).filter((h) => !had.has(`${h.path}\u0000${h.macro}`));
}

/** How many items each collection of a world holds (the empty ones left out). */
export function contentsOf(world: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(world)) return out;
  for (const [key, value] of Object.entries(world)) {
    if (isCollection(key) && isRecord(value) && Object.keys(value).length > 0) out[key] = Object.keys(value).length;
  }
  return out;
}

/** How many entities of each kind a world holds, most first: accounts, cards, flows, jobs and households are entities, so a count of entities alone hides them. */
export function entityKindsOf(world: unknown): Record<string, number> {
  const counts = new Map<string, number>();
  const entities = isRecord(world) && isRecord(world.entities) ? Object.values(world.entities) : [];
  for (const entity of entities) {
    const kind = isRecord(entity) && typeof entity.kind === "string" ? entity.kind : "(no kind)";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  // From entries, so a kind named like a prototype key (`__proto__`) stays a plain count.
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

/** A tool's data, as the text of its answer. */
export function json(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}
