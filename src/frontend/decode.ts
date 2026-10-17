// Defensive readers for view models that arrive as JSON (`StateView.panels`). A panel's decoder
// returns null when the shape is not what it renders; the shell then shows the generic view.

import { isRecord } from "../shared/json";

export type Obj = Record<string, unknown>;

export function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback;
}

export function optStr(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function optNum(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function bool(value: unknown): boolean {
  return value === true;
}

export function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.find((candidate) => candidate === value) ?? fallback;
}

/** Records in an array, each mapped; entries the mapper rejects are skipped. */
export function list<T>(value: unknown, item: (entry: Obj) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const mapped = item(entry);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function obj(value: unknown): Obj | null {
  return isRecord(value) ? value : null;
}
