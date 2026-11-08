// What tool answers report of the engine's findings: lint before and after a change, the host
// macro hazards a change brought in, and what a world holds. How an answer is made (text, JSON for
// data, lint in severity order) is shared/tool-answer.ts, which LumiRPEngine's own tools use too.

import worldSchemaJson from "../../schemas/lre-world-v1.schema.json";
import { macrosIn } from "../engine/authoring";
import { isRecord } from "../shared/json";
import type { LintIssue } from "../shared/protocol";
import type { WorldDoc } from "../shared/world";
import { MAP_SCHEMA } from "../shared/maps";
import { checkSchema, pathText, type Schema } from "../shared/schema-check";
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

/** What lint found before and after a change: the issues after brought in, those it no longer has, and how many it kept. */
export interface LintDiff {
  introduced: LintIssue[];
  fixed: LintIssue[];
  kept: number;
}

const issueKey = (i: LintIssue, words: boolean): string => `${i.severity}\u0000${i.code}\u0000${i.path}${words ? `\u0000${i.message}` : ""}`;

/**
 * Lint of two versions of a world, the older first (the head and the draft: what's new since the
 * last save; a draft before and after an edit). An issue is the same one when its severity, code and
 * path match, its words first where several do, since a count in the words moves with the world;
 * each is matched once. In the engine's order.
 */
export function lintDiff(before: readonly LintIssue[], after: readonly LintIssue[]): LintDiff {
  const open = new Set(after.keys());
  const match = (issues: readonly LintIssue[], words: boolean): LintIssue[] => {
    const waiting = new Map<string, number[]>();
    for (const i of open) {
      const key = issueKey(after[i] as LintIssue, words);
      waiting.set(key, [...(waiting.get(key) ?? []), i]);
    }
    return issues.filter((issue) => {
      const at = waiting.get(issueKey(issue, words))?.shift();
      if (at === undefined) return true;
      open.delete(at);
      return false;
    });
  };
  const fixed = match(match(before, true), false);
  const introduced = after.filter((_, i) => open.has(i));
  return { introduced, fixed, kept: after.length - introduced.length };
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
