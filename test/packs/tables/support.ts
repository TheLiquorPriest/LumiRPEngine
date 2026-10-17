// Fixtures for the table-build tests: the real sources, safe copies, a path-based mutator and a
// helper that returns a build's findings instead of throwing.

import { buildTables, readSources } from "../../../scripts/tables/build";
import type { Sources } from "../../../scripts/tables/build";
import { TableBuildError } from "../../../scripts/tables/issues";
import type { Issue } from "../../../scripts/tables/issues";
import { MAPPINGS } from "../../../scripts/tables/mappings";
import { isRecord } from "../../../src/shared/json";
import type { JsonValue } from "../../../src/shared/json";
import type { TableMapping } from "../../../src/shared/tables";

/** The real `data-src` files, read once. Never mutate; use `cloneSources`. */
export const BASE_SOURCES: Sources = readSources();

export function cloneSources(): Sources {
  return structuredClone(BASE_SOURCES);
}

export function cloneMappings(): TableMapping[] {
  return structuredClone([...MAPPINGS]);
}

/** A step into JSON: an object key, an array index, or the array element with this `id`. */
export type Step = string | number | { id: string };

function child(parent: JsonValue, step: Step): JsonValue {
  if (typeof step === "object") {
    const found = Array.isArray(parent) ? parent.find((element) => isRecord(element) && element.id === step.id) : undefined;
    if (found === undefined) throw new Error(`no element with id ${step.id}`);
    return found;
  }
  if (typeof step === "number" && Array.isArray(parent)) return parent[step];
  if (typeof step === "string" && isRecord(parent) && Object.hasOwn(parent, step)) return parent[step];
  throw new Error(`cannot step into ${JSON.stringify(step)}`);
}

/** Sets (or, with `undefined`, deletes) the value at `path` inside one source file. */
export function mutate(sources: Sources, file: string, path: Step[], value: JsonValue | undefined): void {
  const parent = path.slice(0, -1).reduce(child, sources[file]);
  const last = path[path.length - 1];
  if (typeof last === "string" && isRecord(parent)) {
    if (value === undefined) delete parent[last];
    else parent[last] = value;
  } else if (typeof last === "number" && Array.isArray(parent) && value !== undefined) {
    parent[last] = value;
  } else {
    throw new Error(`cannot set ${JSON.stringify(last)}`);
  }
}

/** Reads a value at `path` inside one source file. */
export function read(sources: Sources, file: string, path: Step[]): JsonValue {
  return path.reduce(child, sources[file]);
}

/** Every finding of a build, empty when it succeeds. */
export function issuesOf(sources: Sources, mappings: readonly TableMapping[] = MAPPINGS): Issue[] {
  try {
    buildTables(sources, mappings);
    return [];
  } catch (error) {
    if (error instanceof TableBuildError) return [...error.issues];
    throw error;
  }
}

/** The part of a finding a test asserts on. */
export function brief(issues: readonly Issue[]): { rule: string; table: string; row: string | null; column: string | null }[] {
  return issues.map(({ rule, table, row, column }) => ({ rule, table, row, column }));
}
