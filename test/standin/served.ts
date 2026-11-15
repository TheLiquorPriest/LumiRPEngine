// What the stand-in Lumiverse's HTTP routes (`http.ts`) serve from its rows: the pages, the mappers that
// shape a stored row as Lumiverse's services hand it to a route, and a dry run's answer. Each says the
// file and lines it copies (staging at a70f4ed2; paths are Lumiverse's `src/`). What is the stand-in's own
// says so: its token count (a character is a quarter of a token, which Lumiverse's own tokenizer
// falls back to where it has none for the model, `services/tokenizer.service.ts:583-586`).

import type { Connection, Outcome } from "./lumiverse";
import type { LlmMessage, LlmPart } from "./steps";
import { textOf } from "./steps";

// ---------------------------------------------------------------- pages

/** A list's page: at most 1000 rows, 50 where no limit is asked (`types/pagination.ts:13-14`). */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 1000;

export interface Pagination {
  limit: number;
  offset: number;
}

/** `parseStrictInteger` (`utils/strict-integer.ts:1-7`): a whole base-10 integer, or none. */
export function parseStrictInteger(value: string | null | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** `parsePagination` (`services/pagination.ts:27-47`): a limit not an integer is the default, one past either end is clamped; an offset not a non-negative integer is 0. */
export function parsePagination(rawLimit: string | null | undefined, rawOffset?: string | null, defaultLimit: number = DEFAULT_LIMIT): Pagination {
  const asked = parseStrictInteger(rawLimit);
  const limit = asked === undefined ? defaultLimit : Math.min(Math.max(asked, 1), MAX_LIMIT);
  const at = parseStrictInteger(rawOffset);
  return { limit, offset: at !== undefined && at >= 0 ? at : 0 };
}

/** `PaginatedResult` (`types/pagination.ts:6-11`). */
export function pageOf<T>(data: T[], total: number, pagination: Pagination): { data: T[]; total: number; limit: number; offset: number } {
  return { data, total, limit: pagination.limit, offset: pagination.offset };
}

export const parsed = (text: unknown, fallback: unknown): unknown => {
  if (typeof text !== "string") return fallback;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fallback;
  }
};

const isPlain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** `parseMetadataObject` (`db/chat-operations.ts:81-90`): a chat's metadata as an object, `{}` for what is not one. */
export function rowMetadata(value: unknown): Record<string, unknown> {
  const metadata = parsed(value, {});
  return isPlain(metadata) ? metadata : {};
}

// ---------------------------------------------------------------- messages

type Row = Record<string, unknown>;

/** The per-swipe arrays a light list leaves out (`services/chats.service.ts:416-426`). */
const SWIPE_SCOPED = ["promptActivationBySwipe", "reasoningBySwipe", "reasoningDurationBySwipe", "tokenCountBySwipe", "generationMetricsBySwipe", "generationOutcomeBySwipe", "usageBySwipe", "reasoningCarrierBySwipe", "variableStateBySwipe"] as const;

function padded<T>(value: unknown, count: number, keep: (entry: unknown) => T | null): (T | null)[] {
  const out = Array.isArray(value) ? value.slice(0, count).map(keep) : [];
  while (out.length < count) out.push(null);
  return out;
}

const text = (entry: unknown): string | null => (typeof entry === "string" && entry.length > 0 ? entry : null);
const duration = (entry: unknown): number | null => (typeof entry === "number" && Number.isFinite(entry) && entry >= 0 ? entry : null);
const count = (entry: unknown): number | null => (typeof entry === "number" && Number.isFinite(entry) && entry > 0 ? entry : null);
const object = (entry: unknown): Record<string, unknown> | null => (isPlain(entry) ? entry : null);

/** `normalizeStoredMessageExtra` (`services/chats.service.ts:262-403`): the single-swipe keys folded into the per-swipe arrays, each array as long as the swipes. */
function normalizedExtra(extra: Record<string, unknown>, swipeCount: number, legacySwipe: number): Record<string, unknown> {
  const swipes = Math.max(1, swipeCount);
  const legacy = Number.isInteger(legacySwipe) && legacySwipe >= 0 && legacySwipe < swipes ? legacySwipe : 0;
  const out: Record<string, unknown> = { ...extra };
  if (Array.isArray(out.variableStateBySwipe)) out.variableStateBySwipe = padded(out.variableStateBySwipe, swipes, object);
  if (out.spindle_metadata !== undefined) {
    // `normalizeSpindleMessageMetadata` (`utils/message-metadata.ts:1-8`).
    const metadata = out.spindle_metadata;
    if (isPlain(metadata) && Array.isArray(metadata.preset_contexts)) {
      const contexts = metadata.preset_contexts as unknown[];
      out.spindle_metadata = { ...metadata, preset_contexts: Array.from({ length: swipes }, (_, i) => contexts[i] ?? null) };
    }
  }
  const reasoning = padded(out.reasoningBySwipe, swipes, text);
  const reasoningDuration = padded(out.reasoningDurationBySwipe, swipes, duration);
  const tokenCount = padded(out.tokenCountBySwipe, swipes, count);
  const metrics = padded(out.generationMetricsBySwipe, swipes, object);
  const outcome = padded(out.generationOutcomeBySwipe, swipes, object);
  const usage = padded(out.usageBySwipe, swipes, object);
  const carrier = padded(out.reasoningCarrierBySwipe, swipes, object);
  const activation = padded(out.promptActivationBySwipe, swipes, object);
  if (out.generationOutcome === null) outcome[legacy] = null;
  else if (isPlain(out.generationOutcome)) outcome[legacy] = out.generationOutcome;
  if (out.promptActivation === null) activation[legacy] = null;
  else if (isPlain(out.promptActivation)) activation[legacy] = out.promptActivation;
  if (out.reasoning === null) reasoning[legacy] = null;
  else if (typeof out.reasoning === "string") reasoning[legacy] = out.reasoning.length > 0 ? out.reasoning : null;
  if (out.reasoningDuration === null) reasoningDuration[legacy] = null;
  else if (typeof out.reasoningDuration === "number" && Number.isFinite(out.reasoningDuration) && out.reasoningDuration >= 0) reasoningDuration[legacy] = out.reasoningDuration;
  if (out.tokenCount === null) tokenCount[legacy] = null;
  else if (typeof out.tokenCount === "number" && Number.isFinite(out.tokenCount) && out.tokenCount > 0) tokenCount[legacy] = out.tokenCount;
  if (out.generationMetrics === null) metrics[legacy] = null;
  else if (isPlain(out.generationMetrics)) metrics[legacy] = out.generationMetrics;
  if (out.usage === null) usage[legacy] = null;
  else if (isPlain(out.usage)) usage[legacy] = out.usage;
  if (out.reasoningCarrier === null) carrier[legacy] = null;
  else if (isPlain(out.reasoningCarrier)) carrier[legacy] = out.reasoningCarrier;
  for (const key of ["generationOutcome", "promptActivation", "reasoning", "reasoningDuration", "tokenCount", "generationMetrics", "usage", "reasoningCarrier"]) delete out[key];
  const set = (key: string, entries: unknown[]): void => {
    if (entries.some((e) => e !== null)) out[key] = entries;
    else delete out[key];
  };
  set("generationOutcomeBySwipe", outcome);
  set("promptActivationBySwipe", activation);
  set("reasoningBySwipe", reasoning);
  set("reasoningDurationBySwipe", reasoningDuration);
  set("tokenCountBySwipe", tokenCount);
  set("generationMetricsBySwipe", metrics);
  set("usageBySwipe", usage);
  set("reasoningCarrierBySwipe", carrier);
  return out;
}

/** `projectActiveSwipeExtra` (`services/chats.service.ts:405-478`): the shown swipe's values at the top of `extra`, the arrays kept beside them. */
function projectedExtra(extra: Record<string, unknown>, swipe: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...extra };
  const at = (key: string): unknown => (Array.isArray(extra[key]) ? (extra[key] as unknown[])[swipe] : null);
  const put = (key: string, from: string, ok: (v: unknown) => boolean): void => {
    const value = at(from);
    if (ok(value)) out[key] = value;
    else delete out[key];
  };
  put("generationOutcome", "generationOutcomeBySwipe", isPlain);
  put("promptActivation", "promptActivationBySwipe", isPlain);
  put("reasoning", "reasoningBySwipe", (v) => typeof v === "string" && v.length > 0);
  put("reasoningDuration", "reasoningDurationBySwipe", (v) => typeof v === "number" && Number.isFinite(v) && v >= 0);
  put("tokenCount", "tokenCountBySwipe", (v) => typeof v === "number" && Number.isFinite(v) && v > 0);
  put("generationMetrics", "generationMetricsBySwipe", isPlain);
  put("usage", "usageBySwipe", isPlain);
  put("reasoningCarrier", "reasoningCarrierBySwipe", isPlain);
  return out;
}

/** `rowToMessage` (`services/chats.service.ts:512-535`): lists parsed, `is_user` a boolean, `extra` normalized and projected to the swipe shown. */
export function rowToMessage(row: Row): Record<string, unknown> {
  const swipes = parsed(row.swipes, [row.content ?? ""]);
  const list = Array.isArray(swipes) ? swipes : [row.content ?? ""];
  const swipeId = typeof row.swipe_id === "number" ? row.swipe_id : 0;
  const stored = normalizedExtra(isPlain(parsed(row.extra, {})) ? (parsed(row.extra, {}) as Record<string, unknown>) : {}, list.length, swipeId);
  const dates = parsed(row.swipe_dates || "[]", []);
  return {
    ...row,
    is_user: !!row.is_user,
    swipes: list,
    swipe_dates: Array.isArray(dates) ? dates : [],
    extra: projectedExtra(stored, swipeId),
    parent_message_id: row.parent_message_id || null,
    branch_id: row.branch_id || null,
  };
}

/** `rowToMessageLight` (`services/chats.service.ts:540-557`): the swipes not shown null (`swipes.length` kept), the per-swipe arrays left out of `extra`. */
export function rowToMessageLight(row: Row): Record<string, unknown> {
  const message = rowToMessage(row);
  const swipes = message.swipes as unknown[];
  if (swipes.length > 1) {
    const shown = typeof message.swipe_id === "number" && message.swipe_id >= 0 && message.swipe_id < swipes.length ? message.swipe_id : 0;
    const light: unknown[] = new Array(swipes.length).fill(null);
    light[shown] = swipes[shown] ?? null;
    message.swipes = light;
  }
  const extra = { ...(message.extra as Record<string, unknown>) };
  for (const key of SWIPE_SCOPED) delete extra[key];
  message.extra = extra;
  return message;
}

// ---------------------------------------------------------------- the rows of the other reads

const ENTRY_OUTLET_KEYS = ["outlet_name", "outletName"];
const ENTRY_MARKER_KEYS = ["wi_marker", "wiMarker"];
const ENTRY_SIDE_KEYS = ["wi_marker_side", "wiMarkerSide"];
/** The markers a pinned entry may name (`services/world-books.service.ts:177-190`). */
const VALID_WI_MARKERS: Record<string, true> = {
  chat_history: true,
  world_info_before: true,
  world_info_after: true,
  char_description: true,
  char_personality: true,
  persona_description: true,
  scenario: true,
  dialogue_examples: true,
  main_prompt: true,
  enhance_definitions: true,
  jailbreak: true,
  nsfw_prompt: true,
};

const trimmedText = (value: unknown): string | null => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);

/** `rowToBook` (`services/world-books.service.ts:271-283`): named fields, no `user_id`. */
export function rowToBook(row: Row): Record<string, unknown> {
  return { id: row.id, name: row.name, description: row.description, folder: row.folder ?? "", metadata: parsed(row.metadata, {}), created_at: row.created_at, updated_at: row.updated_at };
}

/** `splitManagedEntryExtensions` (`services/world-books.service.ts:219-233`): the managed keys (an outlet's name, a marker, its side) lifted out of an entry's `extensions`. */
function splitExtensions(raw: unknown): { extensions: Record<string, unknown>; outlet: string | null; marker: string | null; side: "before" | "after" | null } {
  const value = parsed(raw, {});
  const next: Record<string, unknown> = isPlain(value) ? { ...value } : {};
  const outlet = trimmedText(next.outlet_name ?? next.outletName);
  const markerRaw = next.wi_marker ?? next.wiMarker;
  const marker = typeof markerRaw === "string" && VALID_WI_MARKERS[markerRaw.trim().toLowerCase()] === true ? markerRaw.trim().toLowerCase() : null;
  const sideRaw = next.wi_marker_side ?? next.wiMarkerSide;
  const side = typeof sideRaw === "string" && ["before", "after"].includes(sideRaw.trim().toLowerCase()) ? (sideRaw.trim().toLowerCase() as "before" | "after") : null;
  for (const key of [...ENTRY_OUTLET_KEYS, ...ENTRY_MARKER_KEYS, ...ENTRY_SIDE_KEYS]) delete next[key];
  return { extensions: next, outlet, marker, side };
}

/** `rowToEntry` (`services/world-books.service.ts:343-374`): lists parsed, flags booleans, the managed extensions lifted out, and the revision the row holds. */
export function rowToEntry(row: Row): Record<string, unknown> {
  const { extensions, outlet, marker, side } = splitExtensions(row.extensions);
  const status = ["not_enabled", "pending", "indexed", "error"].includes(String(row.vector_index_status)) ? row.vector_index_status : row.vectorized && !row.disabled && String(row.content ?? "").trim() !== "" ? "pending" : "not_enabled";
  const tags = parsed(row.tags, []);
  return {
    ...row,
    folder: typeof row.folder === "string" ? row.folder.trim() : "",
    tags: Array.isArray(tags) ? [...new Set(tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean))] : [],
    outlet_name: outlet,
    wi_marker: marker,
    wi_marker_side: side,
    key: parsed(row.key, []),
    keysecondary: parsed(row.keysecondary, []),
    role: row.role || null,
    selective: !!row.selective,
    constant: !!row.constant,
    disabled: !!row.disabled,
    group_override: !!row.group_override,
    case_sensitive: !!row.case_sensitive,
    match_whole_words: !!row.match_whole_words,
    use_regex: !!row.use_regex,
    prevent_recursion: !!row.prevent_recursion,
    exclude_recursion: !!row.exclude_recursion,
    delay_until_recursion: !!row.delay_until_recursion,
    use_probability: !!row.use_probability,
    vectorized: !!row.vectorized,
    vector_index_status: status,
    vector_indexed_at: row.vector_indexed_at ?? null,
    vector_index_error: row.vector_index_error || null,
    scan_depth: row.scan_depth ?? null,
    automation_id: row.automation_id || null,
    extensions,
  };
}

/** `rowToCharacter` (`services/characters.service.ts:584-597`): lists parsed, no `deleting`, the library scope written into `extensions` (`db/character-operations.ts:23-25`). */
export function rowToCharacter(row: Row): Record<string, unknown> {
  const { deleting: _deleting, ...rest } = row;
  const scope = row.library_scope === "shared" ? "shared" : "mine";
  const extensions = parsed(row.extensions, {});
  return {
    ...rest,
    library_scope: scope,
    avatar_path: row.avatar_path || null,
    image_id: row.image_id || null,
    folder: row.folder || "",
    tags: parsed(row.tags, []),
    alternate_greetings: parsed(row.alternate_greetings, []),
    extensions: { ...(isPlain(extensions) ? extensions : {}), _lumiverse_library_scope: scope },
  };
}

/** `rowToPersona` (`db/persona-operations.ts:4-21`). */
export function rowToPersona(row: Row): Record<string, unknown> {
  return {
    ...row,
    title: row.title || "",
    subjective_pronoun: row.subjective_pronoun || "",
    objective_pronoun: row.objective_pronoun || "",
    possessive_pronoun: row.possessive_pronoun || "",
    reflexive_pronoun: row.reflexive_pronoun || "",
    possessive_pronoun_standalone: row.possessive_pronoun_standalone || "",
    folder: row.folder || "",
    avatar_path: row.avatar_path || null,
    image_id: row.image_id || null,
    attached_world_book_id: row.attached_world_book_id || null,
    is_default: !!row.is_default,
    is_narrator: !!row.is_narrator,
    metadata: parsed(row.metadata, {}),
  };
}

/** `rowToPreset` (`services/presets.service.ts:75-92`): named fields, no `user_id`. */
export function rowToPreset(row: Row): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    engine: row.engine,
    parameters: parsed(row.parameters, {}),
    prompt_order: parsed(row.prompt_order, []),
    prompts: parsed(row.prompts, {}),
    metadata: parsed(row.metadata, {}),
    cache_revision: row.cache_revision ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** `getSetting` (`services/settings.service.ts:23-27`): `{key, value, updated_at}`, the value parsed. */
export function rowToSetting(row: Row): Record<string, unknown> {
  return { key: row.key, value: parsed(row.value, null), updated_at: row.updated_at };
}

// ---------------------------------------------------------------- a dry run

/** The stand-in's own count: a character is a quarter of a token, which Lumiverse's own counter falls back to where the model has no tokenizer (`services/tokenizer.service.ts:583-586`, named "approximate"). */
export const approximateTokens = (content: string): number => Math.ceil(content.length / 4);

/** `describeContentForDisplay` (`llm/types.ts:117-168`): the text with a bracketed placeholder for each other part, and a count of each kind. */
function describeContent(content: string | LlmPart[]): { text: string; contentParts: { type: string; count: number }[] } {
  if (typeof content === "string") return { text: content, contentParts: [] };
  const counts = new Map<string, number>();
  const body = content
    .map((part) => {
      if (part.type === "text") return part.text;
      counts.set(part.type, (counts.get(part.type) ?? 0) + 1);
      return `[${part.type}: ${part.mime_type}]`;
    })
    .join("\n");
  return { text: body, contentParts: [...counts.entries()].map(([type, n]) => ({ type, count: n })) };
}

/** What the answer of a dry run needs besides the generation's outcome. */
export interface DryRunSource {
  outcome: Outcome;
  connection: Connection;
  /** The chat's stored messages by id, as Lumiverse's `rowToMessage` serves them (`generate.service.ts:3105-3108`). */
  sourceMessages: ReadonlyMap<string, Record<string, unknown>>;
  /** The user's `reasoningSettings` (`generate.service.ts:3110-3111`). */
  reasoningSettings: { keepInHistory?: number } | null;
  includeRequestMessages: boolean;
}

/** `resolveDryRunMessageReasoning` (`services/generation/reasoning.ts:77-88`) for the parts the stand-in's prompt carries: the stored message's own reasoning, else the message's `reasoning_content`. */
function reasoningOf(message: LlmMessage, source: Record<string, unknown> | undefined): string | undefined {
  const keep = (v: unknown): string | undefined => (typeof v === "string" && v.trim().length > 0 ? v : undefined);
  const extra = source?.extra;
  return keep(isPlain(extra) ? extra.reasoning : undefined) ?? keep(message.reasoning_content);
}

/**
 * `buildDryRunDisplayMessages` (`services/generation/reasoning.ts:107-160`): each message with its content flattened to text, a count of
 * its other parts, its reasoning where it has some that its text does not hold, the `keepInHistory` limit on the history messages'. What
 * the stand-in leaves out: the reasoning written into a history message's own text between the user's delimiters, which Lumiverse moves
 * out of the display (the stand-in's saved text moves none, `services/generate.service.ts:4073-4085`).
 */
export function dryRunDisplayMessages(messages: readonly LlmMessage[], sources: ReadonlyMap<string, Record<string, unknown>>, keepInHistory: number): Record<string, unknown>[] {
  const shown = messages.map((message) => {
    const described = describeContent(message.content);
    const id = typeof message.__sourceMessageId === "string" ? message.__sourceMessageId : undefined;
    const reasoning = reasoningOf(message, id === undefined ? undefined : sources.get(id));
    const display: Record<string, unknown> = { ...message, content: described.text };
    if (described.contentParts.length > 0) display.contentParts = described.contentParts;
    if (reasoning !== undefined && described.text.trim() !== reasoning.trim()) display.reasoning = reasoning;
    return display;
  });
  if (keepInHistory === -1) return shown;
  let kept = 0;
  for (let i = shown.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.__chatHistorySource !== true || message.role !== "assistant" || shown[i]!.reasoning === undefined) continue;
    kept++;
    if (kept > keepInHistory) delete shown[i]!.reasoning;
  }
  return shown;
}

/**
 * `DryRunResult` (`services/generate.service.ts:424-486`, built at `:3243-3272`): the prompt as the display shows it, the breakdown without
 * the chat history, the parameters as they would go out (disabled penalties left out, the two internal keys gone, `:3213-3228`), the prefill,
 * the connection's model and provider, and the counts. There is no `presetId` or `presetName` at its top. The token count is the stand-in's own
 * (`approximateTokens`), the chat history's counted as one entry of the breakdown and then left out of what is listed (`:3202-3208`, `:316-325`);
 * the stats of memory, databanks and context clipping are given where the outcome has them (the stand-in makes none).
 */
export function dryRunResult(source: DryRunSource): Record<string, unknown> {
  const { outcome, connection } = source;
  const history = outcome.prompt.filter((m) => m.__chatHistorySource === true && (typeof m.content === "string" ? m.content.trim().length > 0 : m.content.length > 0));
  const chatHistoryTokens = history.reduce((n, m) => n + approximateTokens(textOf(m)), 0);
  const breakdown = outcome.breakdown ?? [];
  const entries = breakdown.map((e) => ({ name: e.name, type: e.type, tokens: approximateTokens(e.content ?? ""), ...(e.role ? { role: e.role } : {}), ...(e.blockId ? { blockId: e.blockId } : {}), excluded: e.excludeFromTotal === true }));
  const parameters: Record<string, unknown> = { ...(outcome.parameters ?? {}) };
  for (const key of ["frequency_penalty", "presence_penalty", "repetition_penalty"]) if (parameters[key] === undefined || parameters[key] === null || parameters[key] === 0) delete parameters[key];
  if (parameters.repetition_penalty === 1) delete parameters.repetition_penalty;
  delete parameters.max_context_length;
  delete parameters._include_usage;
  const prefill = breakdown.find((e) => e.type === "utility" && e.name === "Assistant Prefill")?.content;
  const stats = outcome.worldInfo.stats;
  return {
    ...(source.includeRequestMessages ? { request_messages: outcome.prompt } : {}),
    messages: dryRunDisplayMessages(outcome.prompt, source.sourceMessages, source.reasoningSettings?.keepInHistory ?? -1),
    breakdown: breakdown.map((e) => ({ ...e })),
    parameters,
    assistantPrefill: prefill,
    model: connection.model,
    provider: "custom",
    tokenCount: {
      total_tokens: chatHistoryTokens + entries.reduce((n, e) => (e.excluded ? n : n + e.tokens), 0),
      breakdown: entries.map(({ excluded: _excluded, ...e }) => e),
      tokenizer_id: null,
      tokenizer_name: "approximate",
    },
    chatHistoryTokens,
    ...(Object.keys(stats).length > 0 ? { worldInfoStats: stats } : {}),
    ...(outcome.contextClipStats !== undefined ? { contextClipStats: outcome.contextClipStats } : {}),
  };
}
