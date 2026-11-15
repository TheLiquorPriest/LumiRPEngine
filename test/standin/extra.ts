// A message's `extra` as Lumiverse stores it and shows it (`services/chats.service.ts:262-400`, `:2863-2920`; paths are Lumiverse's `src/`): the fields that belong to one swipe
// (a reply's thinking, its carrier for the next prompt, how it ended, its usage) are kept in arrays by swipe, `reasoningBySwipe` and the like, and the message shows the ones of
// the swipe on display at the top. Only these fields are modelled; every other key of `extra` is kept as it is.

/** The fields a swipe has of its own (`SWIPE_SCOPED_EXTRA_KEYS`, `:2866-2875`), and what each is stored in. */
const SCOPED = {
  promptActivation: "promptActivationBySwipe",
  reasoning: "reasoningBySwipe",
  reasoningDuration: "reasoningDurationBySwipe",
  tokenCount: "tokenCountBySwipe",
  generationMetrics: "generationMetricsBySwipe",
  generationOutcome: "generationOutcomeBySwipe",
  usage: "usageBySwipe",
  reasoningCarrier: "reasoningCarrierBySwipe",
} as const;

export const SWIPE_SCOPED_EXTRA_KEYS = Object.keys(SCOPED) as (keyof typeof SCOPED)[];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** What each field accepts to be stored (`:288-345`): a thinking that is not empty, a time that is not negative, a count above nought, else an object. */
function fits(key: keyof typeof SCOPED, value: unknown): boolean {
  if (key === "reasoning") return typeof value === "string" && value.length > 0;
  if (key === "reasoningDuration") return typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (key === "tokenCount") return typeof value === "number" && Number.isFinite(value) && value > 0;
  return isObject(value);
}

/** An array of one entry per swipe, short ones padded with null (`:243-260`). */
function entries(value: unknown, count: number): unknown[] {
  const list = Array.isArray(value) ? value.slice(0, count) : [];
  while (list.length < count) list.push(null);
  return list;
}

/**
 * `normalizeStoredMessageExtra` (`:262-400`): each swipe-scoped field at the top is folded into its array at the swipe it was written for (`legacySwipeId`), null clearing the
 * entry; an array with nothing in it is dropped.
 */
export function normalizeStoredExtra(extra: Record<string, unknown> | null | undefined, swipeCount: number, legacySwipeId: number): Record<string, unknown> {
  const count = Math.max(1, swipeCount);
  const at = Number.isInteger(legacySwipeId) && legacySwipeId >= 0 && legacySwipeId < count ? legacySwipeId : 0;
  const out: Record<string, unknown> = { ...(extra ?? {}) };
  for (const key of SWIPE_SCOPED_EXTRA_KEYS) {
    const list = entries(out[SCOPED[key]], count);
    if (out[key] === null) list[at] = null;
    else if (fits(key, out[key])) list[at] = out[key];
    delete out[key];
    if (list.some((entry) => entry !== null)) out[SCOPED[key]] = list;
    else delete out[SCOPED[key]];
  }
  return out;
}

/** `projectActiveSwipeExtra` (`:402-470`): the message shows the fields of the swipe on display at the top, the arrays beside them. */
export function projectActiveSwipeExtra(stored: Record<string, unknown>, swipeId: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...stored };
  for (const key of SWIPE_SCOPED_EXTRA_KEYS) {
    const list = stored[SCOPED[key]];
    const value = Array.isArray(list) ? list[swipeId] : null;
    if (fits(key, value)) out[key] = value;
    else delete out[key];
  }
  return out;
}

/**
 * `removeSwipeScopedExtraEntry` (`:482-580`): the entry of the swipe taken out of every per-swipe list, `variableStateBySwipe` and the `preset_contexts` of the extensions' metadata
 * included; a list left with nothing in it is dropped (the variable records and the contexts are kept as lists).
 */
export function removeSwipeScopedEntry(extra: Record<string, unknown> | null | undefined, swipeCount: number, legacySwipeId: number, removed: number): Record<string, unknown> {
  const normalized = normalizeStoredExtra(extra, swipeCount, legacySwipeId);
  const without = (list: unknown[]): unknown[] => list.filter((_, at) => at !== removed);
  if (Array.isArray(normalized.variableStateBySwipe)) normalized.variableStateBySwipe = without(normalized.variableStateBySwipe);
  const metadata = normalized.spindle_metadata;
  if (isObject(metadata) && Array.isArray(metadata.preset_contexts)) normalized.spindle_metadata = { ...metadata, preset_contexts: without(metadata.preset_contexts) };
  for (const key of SWIPE_SCOPED_EXTRA_KEYS) {
    const name = SCOPED[key];
    const list = normalized[name];
    if (!Array.isArray(list)) continue;
    const left = without(list);
    if (left.some((entry) => entry !== null)) normalized[name] = left;
    else delete normalized[name];
  }
  return normalized;
}

/**
 * `preserveSwipeScopedExtraArrays` (`:638-652`): an `extra` sent whole keeps the stored `variableStateBySwipe` whatever it carries, and each per-swipe list it leaves out
 * (`undefined`) as it was stored.
 */
export function keepStoredSwipeArrays(incoming: Record<string, unknown>, stored: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...incoming };
  if (stored.variableStateBySwipe !== undefined) merged.variableStateBySwipe = stored.variableStateBySwipe;
  else delete merged.variableStateBySwipe;
  for (const key of SWIPE_SCOPED_EXTRA_KEYS) {
    const name = SCOPED[key];
    if (merged[name] === undefined && stored[name] !== undefined) merged[name] = stored[name];
  }
  return merged;
}
