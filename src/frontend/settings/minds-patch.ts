// Settings → Minds as `lre.settings.set` merge patches (DESIGN §24.6). A cadence change (on or off,
// the Live limit, refresh, which levels get memory notes, the section budget, the skip caps) is part
// of the Model use preset, so it makes the preset Custom, as a step change does; prompts and memory
// overrides are the user's own and leave the preset alone. `null` deletes a key: a prompt or a memory
// override set back to null reads the built-in prompt, or the world's memory setting, again.

import type { JsonObject } from "../../shared/json";
import type { Fidelity, MindPurpose, MindsMemoryConfig, MindsSettings } from "../../shared/minds";
import { FIDELITIES, MIND_PROMPT_DEFAULTS, MIND_PROMPT_MAX, MINDS_RANGES } from "../../shared/minds";

/** The fields a Model use preset sets; changing one makes the preset Custom. */
export type MindsPolicy = Partial<Pick<MindsSettings, "enabled" | "liveLimit" | "farRefreshMinutes" | "refreshLimit" | "memoryLevels" | "tokens">> & {
  nearRefresh?: Partial<MindsSettings["nearRefresh"]>;
  skip?: Partial<MindsSettings["skip"]>;
};

export function mindsPolicyPatch(change: MindsPolicy): JsonObject {
  const minds: JsonObject = {};
  if (change.enabled !== undefined) minds.enabled = change.enabled;
  if (change.liveLimit !== undefined) minds.liveLimit = change.liveLimit;
  if (change.farRefreshMinutes !== undefined) minds.farRefreshMinutes = change.farRefreshMinutes;
  if (change.refreshLimit !== undefined) minds.refreshLimit = change.refreshLimit;
  if (change.tokens !== undefined) minds.tokens = change.tokens;
  if (change.memoryLevels !== undefined) minds.memoryLevels = FIDELITIES.filter((f) => f !== "background" && change.memoryLevels?.includes(f));
  if (change.nearRefresh) minds.nearRefresh = { ...change.nearRefresh };
  if (change.skip) minds.skip = { ...change.skip };
  return { modelUse: { preset: "custom" }, minds };
}

/** The levels that get memory notes with one level turned on or off. */
export function withMemoryLevel(levels: readonly Fidelity[], level: Fidelity, on: boolean): Fidelity[] {
  return FIDELITIES.filter((f) => f !== "background" && (f === level ? on : levels.includes(f)));
}

/**
 * The patch saving a prompt, or null when the text can't be saved (over `MIND_PROMPT_MAX`). Empty,
 * or the built-in word for word, saves no override (null), so the built-in keeps any later update.
 */
export function mindsPromptPatch(purpose: MindPurpose, text: string | null): JsonObject | null {
  if (text !== null && text.length > MIND_PROMPT_MAX) return null;
  const own = text === null || text.trim() === "" || text.trim() === MIND_PROMPT_DEFAULTS[purpose].trim() ? null : text;
  return { minds: { prompts: { [purpose]: own } } };
}

/** One memory tunable, as Settings (a user override) and Build (the world's default) show it. */
export interface MemoryField {
  part: keyof MindsMemoryConfig;
  key: string;
  label: string;
  /** Absent: a switch. */
  range?: readonly [number, number];
  integer?: boolean;
  step?: number;
}

export const MEMORY_FIELDS: readonly MemoryField[] = [
  { part: "witness", key: "show", label: "Witness log lines a mind sees", range: MINDS_RANGES.show, integer: true },
  { part: "recall", key: "recent", label: "Recall: latest turns they were there for", range: MINDS_RANGES.show, integer: true },
  { part: "recall", key: "relevant", label: "Recall: turns that best match the moment", range: MINDS_RANGES.show, integer: true },
  { part: "recall", key: "tokens", label: "Recall: tokens it may take", range: MINDS_RANGES.recallTokens, integer: true, step: 100 },
  { part: "notes", key: "show", label: "Notes a mind sees", range: MINDS_RANGES.show, integer: true },
  { part: "notes", key: "keep", label: "Notes kept before the oldest are folded", range: MINDS_RANGES.keep, integer: true },
  { part: "commitments", key: "show", label: "Open commitments a mind sees", range: MINDS_RANGES.show, integer: true },
  { part: "salience", key: "halfLifeDays", label: "A note's salience halves every (days)", range: MINDS_RANGES.halfLifeDays, step: 1 },
  { part: "salience", key: "floor", label: "Under this salience a note has faded", range: MINDS_RANGES.floor, step: 0.1 },
  { part: "consolidate", key: "enabled", label: "Fold faded and surplus notes into the summary" },
  { part: "consolidate", key: "periodDays", label: "Fold a character's notes at most every (days)", range: MINDS_RANGES.periodDays, step: 0.5 },
];

/** A memory field's value in a config. */
export function memoryValue(config: Readonly<MindsMemoryConfig>, field: MemoryField): number | boolean {
  const part = config[field.part] as unknown as Record<string, number | boolean>;
  return part[field.key] ?? 0;
}

/** A user's memory override as set (undefined: the world's applies). */
export function memoryOverride(memory: MindsSettings["memory"], field: MemoryField): number | boolean | undefined {
  const part = memory[field.part] as Record<string, number | boolean> | undefined;
  return part?.[field.key];
}

/** The patch overriding one memory tunable for this user, or with null going back to the world's; null when the value is outside its range. */
export function memoryOverridePatch(field: MemoryField, value: number | boolean | null): JsonObject | null {
  if (typeof value === "number") {
    const [lo, hi] = field.range ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
    if (!field.range || !Number.isFinite(value) || value < lo || value > hi || (field.integer && !Number.isInteger(value))) return null;
  } else if (typeof value === "boolean" && field.range) return null;
  return { minds: { memory: { [field.part]: { [field.key]: value } } } };
}
