// The adjudication policy's presets and its reader (DESIGN §11): when checks roll and who settles
// them. The engine applies it, the backend keeps it in settings and markers, and Build and Settings
// edit it. A policy's values are its own: a named preset fills in what it leaves out, and one whose
// values differ from its preset plays as Custom with them, as editing any value makes it Custom.

import { isRecord } from "./json";
import type { AdjudicationDef, AdjudicationPresetId, CheckAuthority, CheckTiming, DescriptionWeight, RetryRule } from "./world";

export const ADJUDICATION_PRESET_IDS: readonly AdjudicationPresetId[] = ["narrative", "balanced", "crunchy", "custom"];
export const ADJUDICATION_PRESET_LABEL: Readonly<Record<AdjudicationPresetId, string>> = { narrative: "Narrative-first", balanced: "Balanced", crunchy: "Crunchy", custom: "Custom" };
export const CHECK_TIMINGS: readonly CheckTiming[] = ["every", "risky", "marked", "never"];
export const DESCRIPTION_WEIGHTS: readonly DescriptionWeight[] = ["none", "bonus", "advantage", "dc"];
export const CHECK_AUTHORITIES: readonly CheckAuthority[] = ["mechanics", "hybrid", "narrative"];
export const RETRY_RULES: readonly RetryRule[] = ["free", "changed", "once"];

/** The ranges the whole-number values are kept in: the judge's scale, the close-call margin and the retry wait (a week). */
export const ADJUDICATION_BOUNDS = {
  descriptionMax: [1, 10],
  closeBy: [0, 20],
  retryAfter: [0, 10_080],
} as const;

/**
 * Crunchy is the engine as it has always played: every check rolls and the roll settles it, so a
 * world without a policy plays by it.
 */
export const ADJUDICATION_PRESETS: Readonly<Record<Exclude<AdjudicationPresetId, "custom">, Readonly<AdjudicationDef>>> = {
  narrative: {
    preset: "narrative",
    checks: "risky",
    riskyAt: 0.75,
    trivialAt: null,
    impossibleAt: null,
    // The judge reads the approach itself when it picks the outcome, so no roll is shifted.
    description: { weight: "none", max: 3, advantageAt: 2 },
    authority: "narrative",
    closeBy: 2,
    retry: "changed",
    retryAfter: 60,
  },
  balanced: {
    preset: "balanced",
    checks: "every",
    riskyAt: 0.75,
    trivialAt: 0.95,
    impossibleAt: 0.05,
    description: { weight: "bonus", max: 2, advantageAt: 2 },
    authority: "hybrid",
    closeBy: 2,
    retry: "changed",
    retryAfter: 60,
  },
  crunchy: {
    preset: "crunchy",
    checks: "every",
    riskyAt: 0.75,
    trivialAt: null,
    impossibleAt: null,
    description: { weight: "none", max: 2, advantageAt: 2 },
    authority: "mechanics",
    closeBy: 2,
    retry: "free",
    retryAfter: 60,
  },
};

/** A named preset's values, as a fresh object. */
export function presetAdjudication(id: Exclude<AdjudicationPresetId, "custom">): AdjudicationDef {
  return structuredClone(ADJUDICATION_PRESETS[id]) as AdjudicationDef;
}

/** The policy a world without one plays by. */
export function defaultAdjudication(): AdjudicationDef {
  return presetAdjudication("crunchy");
}

/**
 * Whether a policy plays exactly as checks always have: every check rolled and settled by the roll,
 * the player's words never counted and retries free. Such a policy records nothing of its own.
 */
export function plainRolling(p: AdjudicationDef): boolean {
  return p.checks === "every" && p.trivialAt === null && p.impossibleAt === null && p.description.weight === "none" && p.authority === "mechanics" && p.retry === "free";
}

/** A threshold: null switches it off; a missing or unreadable one is the fallback's. */
function threshold(v: unknown, fallback: number | null): number | null {
  return v === null ? null : typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

function whole(v: unknown, [lo, hi]: readonly [number, number], fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
}

function oneOf<T extends string>(v: unknown, values: readonly T[], fallback: T): T {
  return values.find((x) => x === v) ?? fallback;
}

/** Whether two policies play alike: every value the same, the preset's name aside. */
function samePlay(a: AdjudicationDef, b: AdjudicationDef): boolean {
  return (
    a.checks === b.checks &&
    a.riskyAt === b.riskyAt &&
    a.trivialAt === b.trivialAt &&
    a.impossibleAt === b.impossibleAt &&
    a.description.weight === b.description.weight &&
    a.description.max === b.description.max &&
    a.description.advantageAt === b.description.advantageAt &&
    a.authority === b.authority &&
    a.closeBy === b.closeBy &&
    a.retry === b.retry &&
    a.retryAfter === b.retryAfter
  );
}

/**
 * A policy from outside data (a world document, settings, a marker), or null when it isn't one.
 * Each value it sets that a policy can hold is kept, clamped into its range; the rest come from its
 * named preset, or Crunchy for `custom`. A named preset whose values all stay its own reads as that
 * preset; one that sets any of them otherwise plays as Custom with them, so a world's own rules
 * apply as written (lint names both, `lintAdjudication`).
 */
export function readAdjudication(raw: unknown): AdjudicationDef | null {
  if (!isRecord(raw)) return null;
  const preset = ADJUDICATION_PRESET_IDS.find((p) => p === raw.preset);
  if (!preset) return null;
  const base = ADJUDICATION_PRESETS[preset === "custom" ? "crunchy" : preset];
  const d = isRecord(raw.description) ? raw.description : {};
  const max = whole(d.max, ADJUDICATION_BOUNDS.descriptionMax, base.description.max);
  const read: AdjudicationDef = {
    preset: "custom",
    checks: oneOf(raw.checks, CHECK_TIMINGS, base.checks),
    riskyAt: threshold(raw.riskyAt, base.riskyAt) ?? base.riskyAt,
    trivialAt: threshold(raw.trivialAt, base.trivialAt),
    impossibleAt: threshold(raw.impossibleAt, base.impossibleAt),
    description: { weight: oneOf(d.weight, DESCRIPTION_WEIGHTS, base.description.weight), max, advantageAt: whole(d.advantageAt, [1, max], Math.min(max, base.description.advantageAt)) },
    authority: oneOf(raw.authority, CHECK_AUTHORITIES, base.authority),
    closeBy: whole(raw.closeBy, ADJUDICATION_BOUNDS.closeBy, base.closeBy),
    retry: oneOf(raw.retry, RETRY_RULES, base.retry),
    retryAfter: whole(raw.retryAfter, ADJUDICATION_BOUNDS.retryAfter, base.retryAfter),
  };
  return preset !== "custom" && samePlay(read, base) ? presetAdjudication(preset) : read;
}
