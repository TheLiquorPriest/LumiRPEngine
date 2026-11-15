// The stand-in Lumiverse's World Info (`lumiverse.ts` calls it for each prompt): the context its World Info
// interceptors are given and their chain, run as Lumiverse runs them before lore activates; activation as
// Lumiverse works it out (`services/world-info-activation.service.ts`): the keyword scan over every message,
// hidden ones included, constant entries, the sticky, cooldown and delay counts kept in the chat's metadata,
// probability, recursion, groups, the order and the budget; the vector hits merged in and duplicates dropped
// (`services/prompt-assembly.service.ts:4846-5072`); and what Lumiverse tells of the result, each entry as
// `keyword` or `vector` only. What it copies from Lumiverse's source (staging at a70f4ed2) says the file and
// lines; paths are Lumiverse's `src/`. Its own: the vector search, which a test scripts (`VectorSearch`),
// since the stand-in has no embeddings; and Lumiverse's activation cache (`:197-356`), of which it keeps
// nothing, so a probability or a group is drawn afresh at every generation.

import { quietTimer, type Registration, type WorldInfoHandler } from "./host";
import { indexInChat, type Chat, type ChatMessage } from "./rows";
import type { Role } from "./steps";

export interface Entry {
  id: string;
  book: string;
  content: string;
  comment?: string;
  keys?: string[];
  constant?: boolean;
  disabled?: boolean;
  extensions?: Record<string, unknown>;
  /**
   * Where Lumiverse puts it (`world_book_entries.position`, `services/world-info-activation.service.ts:971-1021`): 0 at the
   * preset's "World Info Before" marker, else just before the history; 1 at "World Info After", else just after it; 7 in the pool a
   * block's `{{wi_marker}}` takes. Absent, 0. The stand-in places no other position.
   */
  position?: 0 | 1 | 7;
  /** The role it is sent with where no marker block gives one (`normalizeRole`, `:1049-1052`): absent, system. */
  role?: Role;
  // The columns activation reads, named as Lumiverse stores them, each absent as its table's default (`db/baseline.sql:1070-1096`).
  /**
   * Its stable id, which its counts in `chat.metadata.wi_state` are keyed by. Lumiverse gives every entry a random one of its own,
   * never its id (`services/world-books.service.ts:842`, `:1757`); the stand-in gives one so when it first holds the chat.
   */
  uid?: string;
  keysecondary?: string[];
  /** With secondary keys, they decide by `selective_logic`: 0 all of them, 1 none of them, 2 any of them, 3 not all of them. */
  selective?: boolean;
  selective_logic?: 0 | 1 | 2 | 3;
  case_sensitive?: boolean;
  match_whole_words?: boolean;
  use_regex?: boolean;
  /** How many of the newest messages its keys are looked for in; absent, the user's `globalScanDepth`. */
  scan_depth?: number | null;
  /** Default 10. */
  priority?: number;
  /** Default 100. */
  order_value?: number;
  /** A percentage, default 100, drawn only with `use_probability` (default on). */
  probability?: number;
  use_probability?: boolean;
  group_name?: string;
  group_override?: boolean;
  /** Default 100. */
  group_weight?: number;
  prevent_recursion?: boolean;
  exclude_recursion?: boolean;
  delay_until_recursion?: boolean;
  sticky?: number;
  cooldown?: number;
  delay?: number;
  vectorized?: boolean;
  /** The vector query searches an entry only once it is indexed (`services/world-book-vector-state.ts:24-30`); absent, "not_enabled". */
  vector_index_status?: string;
}

/** Where a book is attached for the chat (`services/world-info-sources.service.ts`); "peer", a multiplayer peer's. */
export type BookSource = "character" | "persona" | "chat" | "global" | "peer";

/**
 * What a World Info interceptor is told of the generation (`services/prompt-assembly.service.ts:2282-2313`):
 * the chat's messages the prompt is built from, hidden ones included with no mark of it, each with its text,
 * the number Lumiverse stored for it (`index_in_chat`, `:2304`: a delete leaves a gap) and the swipe it shows,
 * a greeting marked as one (`:2289-2305`).
 */
export function worldInfoContext(chat: Chat, messages: readonly ChatMessage[]): Record<string, unknown> {
  return {
    purpose: "prompt",
    chatId: chat.id,
    characterId: chat.character.id,
    messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, is_user: m.role === "user", is_greeting: m.greeting !== undefined, ...(m.greeting !== undefined ? { greeting_index: m.greeting } : {}), swipe_id: m.swipeId ?? 0, index_in_chat: indexInChat(m) })),
    chatTurn: messages.length,
    chatMetadata: chat.metadata ?? {},
    activationSettings: { globalScanDepth: null, maxRecursionPasses: 0 },
  };
}

/** The World Info chain (`spindle/world-info-interceptor.ts:206-407`), each handler behind its worker call (`spindle/worker-host.ts:4927-4955`). */
export async function worldInfoChain(registrations: readonly Registration<WorldInfoHandler>[], entries: readonly Entry[], ctx: Record<string, unknown>, userId: string, limit: { timeoutMs: number; log: string[] }): Promise<Entry[]> {
  const disabledByChain = new Set<string>();
  const enabledByChain = new Set<string>();
  const contentOverrides = new Map<string, string>();
  const candidateIds = new Set(entries.map((e) => e.id));
  let working: Entry[] = [...entries];
  const rebuildWorking = (): Entry[] =>
    entries.map((e) => {
      const isDisabled = disabledByChain.has(e.id);
      const wantsEnable = !isDisabled && enabledByChain.has(e.id) && e.disabled === true;
      const newContent = contentOverrides.get(e.id);
      if (!isDisabled && !wantsEnable && newContent === undefined) return e;
      return { ...e, ...(isDisabled ? { disabled: true } : {}), ...(wantsEnable ? { disabled: false } : {}), ...(newContent !== undefined ? { content: newContent } : {}) };
    });
  for (const registration of registrations) {
    const dto = { ...ctx, userId, entries: working.map((e) => ({ id: e.id, world_book_id: e.book, comment: e.comment ?? "", disabled: e.disabled === true, constant: e.constant === true, extensions: e.extensions ?? {}, key: e.keys ?? [], keysecondary: [], content: e.content })) };
    // The worker's call: a throw reaches the host as no result (`spindle/worker-runtime.ts:4970-4993`), and past the limit the host goes on without one (`spindle/worker-host.ts:4937-4943`).
    const call = registration.handler(structuredClone(dto)).catch((error: unknown) => {
      registration.ext.logs.push(`World-info interceptor error: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    });
    const waited = Promise.withResolvers<undefined>();
    const timer = quietTimer(limit.timeoutMs, () => {
      limit.log.push("World-info interceptor timed out after 10s; skipping");
      waited.resolve(undefined);
    });
    const result = await Promise.race([call, waited.promise]);
    clearTimeout(timer);
    if (!result) continue;
    const copy = structuredClone(result);
    for (const id of copy.disabled ?? []) disabledByChain.add(id);
    for (const id of copy.enabled ?? []) enabledByChain.add(id);
    for (const m of copy.mutated ?? []) if (candidateIds.has(m.id) && m.content !== undefined) contentOverrides.set(m.id, m.content);
    working = rebuildWorking();
  }
  return working;
}

// ---------------------------------------------------------------- the user's settings and the counts

/** The user's `worldInfoSettings` (`services/world-info-activation.service.ts:33-49`). */
export interface WorldInfoSettings {
  forceCaseSensitive: boolean;
  forceMatchWholeWords: boolean;
  /** How many of the newest messages an entry with no depth of its own is scanned in; null, all of them. */
  globalScanDepth: number | null;
  maxRecursionPasses: number;
  /** At most this many entries activate, every constant one kept (0: no cap). */
  maxActivatedEntries: number;
  /** At most this many tokens of lore, at four characters a token, every constant entry kept (0: no cap). */
  maxTokenBudget: number;
  /** An entry below this priority does not activate, unless it is constant (0: none left out). */
  minPriority: number;
}

/** Lumiverse's defaults (`:51-59`). */
export const DEFAULT_WORLD_INFO_SETTINGS: WorldInfoSettings = { forceCaseSensitive: false, forceMatchWholeWords: false, globalScanDepth: null, maxRecursionPasses: 3, maxActivatedEntries: 0, maxTokenBudget: 0, minPriority: 0 };

/** `normalizeWorldInfoSettings` (`:66-99`). */
export function normalizeWorldInfoSettings(input: Partial<WorldInfoSettings> = {}): WorldInfoSettings {
  const whole = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback);
  const depth = input.globalScanDepth;
  return {
    forceCaseSensitive: input.forceCaseSensitive === true,
    forceMatchWholeWords: input.forceMatchWholeWords === true,
    globalScanDepth: typeof depth === "number" && Number.isFinite(depth) && depth > 0 ? Math.floor(depth) : DEFAULT_WORLD_INFO_SETTINGS.globalScanDepth,
    maxRecursionPasses: whole(input.maxRecursionPasses, DEFAULT_WORLD_INFO_SETTINGS.maxRecursionPasses),
    maxActivatedEntries: whole(input.maxActivatedEntries, DEFAULT_WORLD_INFO_SETTINGS.maxActivatedEntries),
    maxTokenBudget: whole(input.maxTokenBudget, DEFAULT_WORLD_INFO_SETTINGS.maxTokenBudget),
    minPriority: whole(input.minPriority, DEFAULT_WORLD_INFO_SETTINGS.minPriority),
  };
}

/** One entry's counts in `chat.metadata.wi_state`, keyed by its `uid` (`:15-26`). */
export interface WiEntryState {
  stickyLeft: number;
  cooldownLeft: number;
  delayCount: number;
  active: boolean;
}

export type WiState = Record<string, WiEntryState>;

/** An entry with every column activation reads, each defaulted as Lumiverse's table defaults it (`db/baseline.sql:1070-1096`). */
interface Row {
  entry: Entry;
  id: string;
  uid: string;
  book: string;
  content: string;
  comment: string;
  key: string[];
  keysecondary: string[];
  constant: boolean;
  disabled: boolean;
  position: number;
  selective: boolean;
  selective_logic: number;
  case_sensitive: boolean;
  match_whole_words: boolean;
  use_regex: boolean;
  scan_depth: number | null;
  priority: number;
  order_value: number;
  probability: number;
  use_probability: boolean;
  group_name: string;
  group_override: boolean;
  group_weight: number;
  prevent_recursion: boolean;
  exclude_recursion: boolean;
  delay_until_recursion: boolean;
  sticky: number;
  cooldown: number;
  delay: number;
  vectorized: boolean;
  vector_index_status: string;
}

function rowOf(e: Entry): Row {
  if (e.uid === undefined) throw new Error(`the stand-in has not given entry ${e.id} a uid`);
  return {
    entry: e,
    id: e.id,
    uid: e.uid,
    book: e.book,
    content: e.content,
    comment: e.comment ?? "",
    key: e.keys ?? [],
    keysecondary: e.keysecondary ?? [],
    constant: e.constant === true,
    disabled: e.disabled === true,
    position: e.position ?? 0,
    selective: e.selective === true,
    selective_logic: e.selective_logic ?? 0,
    case_sensitive: e.case_sensitive === true,
    match_whole_words: e.match_whole_words === true,
    use_regex: e.use_regex === true,
    scan_depth: e.scan_depth ?? null,
    priority: e.priority ?? 10,
    order_value: e.order_value ?? 100,
    probability: e.probability ?? 100,
    use_probability: e.use_probability ?? true,
    group_name: e.group_name ?? "",
    group_override: e.group_override === true,
    group_weight: e.group_weight ?? 100,
    prevent_recursion: e.prevent_recursion === true,
    exclude_recursion: e.exclude_recursion === true,
    delay_until_recursion: e.delay_until_recursion === true,
    sticky: e.sticky ?? 0,
    cooldown: e.cooldown ?? 0,
    delay: e.delay ?? 0,
    vectorized: e.vectorized === true,
    vector_index_status: e.vector_index_status ?? "not_enabled",
  };
}

/** `estimateWorldInfoEntryTokens` (`:557-559`): four characters a token. */
const tokensOf = (content: string): number => Math.ceil(content.length / 4);

// ---------------------------------------------------------------- what the scan does not read

// `utils/world-info-scan-exclusion.ts`, whole: markup in a message that hides its text from the keyword scan and the vector
// query (`<wi-exclude>…</wi-exclude>`, `!--WI_EXCLUDE_START--!` … `!--WI_EXCLUDE_END--!`, any element whose opening tag carries a
// `wi-exclude` attribute), blanked to spaces of the same length.

type Span = [start: number, end: number];

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  excluded: boolean;
  /** Index just past `>`, or -1 when the tag never closes. */
  end: number;
}

const EXCLUSION_HINT = /wi[-_]exclude/i;
const MARKER = /!--WI_EXCLUDE_(START|END)--!/g;
const TAG_NAME = /\/?([a-zA-Z][\w:-]*)/y;
const ATTRIBUTE = /[\s/]*(?:([^\s/>=][^\s/>=]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|(["'])|[^\s>]*))?)?/y;
const NON_WHITESPACE = /\S/;
const VOID_ELEMENTS: Record<string, true> = { area: true, base: true, br: true, col: true, embed: true, hr: true, img: true, input: true, link: true, meta: true, source: true, track: true, wbr: true };
const RAW_TEXT_END: Record<string, RegExp> = {
  iframe: /<\/iframe(?=[\s/>])/gi,
  noembed: /<\/noembed(?=[\s/>])/gi,
  noframes: /<\/noframes(?=[\s/>])/gi,
  noscript: /<\/noscript(?=[\s/>])/gi,
  script: /<\/script(?=[\s/>])/gi,
  style: /<\/style(?=[\s/>])/gi,
  textarea: /<\/textarea(?=[\s/>])/gi,
  title: /<\/title(?=[\s/>])/gi,
  xmp: /<\/xmp(?=[\s/>])/gi,
};

/** Marker regions nest by depth; an unclosed START runs to the end of the text. */
function findMarkerSpans(text: string): Span[] {
  const spans: Span[] = [];
  let depth = 0;
  let start = 0;
  for (const marker of text.matchAll(MARKER)) {
    if (marker[1] === "START") {
      if (depth++ === 0) start = marker.index;
    } else if (depth > 0 && --depth === 0) {
      spans.push([start, marker.index + marker[0].length]);
    }
  }
  if (depth > 0) spans.push([start, text.length]);
  return spans;
}

/** The tag the `<` at `start` opens, or null; a tag that never closes owns the rest of the text. */
function readTag(text: string, start: number): Tag | null {
  TAG_NAME.lastIndex = start + 1;
  const name = TAG_NAME.exec(text);
  if (!name) return null;
  const tag: Tag = { name: name[1]!.toLowerCase(), closing: name[0].startsWith("/"), selfClosing: false, excluded: false, end: -1 };
  let index = TAG_NAME.lastIndex;
  for (;;) {
    ATTRIBUTE.lastIndex = index;
    const attribute = ATTRIBUTE.exec(text);
    if (!attribute) return tag;
    if (attribute[1]?.toLowerCase() === "wi-exclude") tag.excluded = true;
    if (attribute[2] !== undefined) return tag;
    index = ATTRIBUTE.lastIndex;
    if (index >= text.length) return tag;
    if (text[index] === ">") {
      tag.selfClosing = attribute[1] === undefined && attribute[0].endsWith("/");
      tag.end = index + 1;
      return tag;
    }
    if (attribute[0].length === 0) index++;
  }
}

/** Excluded element spans: same-name tags nest by depth, comments and raw-text bodies are skipped, anything unclosed owns the rest. */
function findElementSpans(text: string): Span[] {
  const spans: Span[] = [];
  let open: { name: string; start: number; depth: number } | null = null;
  let cursor = text.indexOf("<");
  while (cursor !== -1) {
    if (text.startsWith("<!--", cursor)) {
      const close = text.indexOf("-->", cursor + 4);
      if (close === -1) break;
      cursor = text.indexOf("<", close + 3);
      continue;
    }
    const tag = readTag(text, cursor);
    if (tag === null) {
      cursor = text.indexOf("<", cursor + 1);
      continue;
    }
    if (open) {
      if (tag.name === open.name && tag.end !== -1) {
        if (tag.closing) {
          if (--open.depth === 0) {
            spans.push([open.start, tag.end]);
            open = null;
          }
        } else if (!tag.selfClosing) {
          open.depth++;
        }
      }
    } else if (!tag.closing && (tag.name === "wi-exclude" || tag.excluded)) {
      if (tag.end !== -1 && (tag.selfClosing || Object.hasOwn(VOID_ELEMENTS, tag.name))) spans.push([cursor, tag.end]);
      else open = { name: tag.name, start: cursor, depth: 1 };
    }
    if (tag.end === -1) break;
    let next = tag.end;
    if (!tag.closing && !tag.selfClosing && Object.hasOwn(RAW_TEXT_END, tag.name)) {
      const rawTextEnd = RAW_TEXT_END[tag.name]!;
      rawTextEnd.lastIndex = tag.end;
      const close = rawTextEnd.exec(text);
      if (!close) break;
      next = close.index;
    }
    cursor = text.indexOf("<", next);
  }
  if (open) spans.push([open.start, text.length]);
  return spans;
}

/** Each span replaced with spaces of its UTF-16 length. */
function blankSpans(text: string, spans: Span[]): string {
  if (spans.length === 0) return text;
  let result = "";
  let cursor = 0;
  for (const [start, end] of spans) {
    result += text.slice(cursor, start) + " ".repeat(end - start);
    cursor = end;
  }
  return result + text.slice(cursor);
}

/** The text World Info scans for one message: "" when nothing but whitespace is left. */
export function maskWorldInfoScanExclusions(content: string): string {
  if (!EXCLUSION_HINT.test(content)) return content;
  const unmarked = blankSpans(content, findMarkerSpans(content));
  const masked = blankSpans(unmarked, findElementSpans(unmarked));
  if (masked === content) return content;
  return NON_WHITESPACE.test(masked) ? masked : "";
}

// ---------------------------------------------------------------- the keyword scan

/** The keys each entry has matched so far, by `uid` and the key's place among its keys (`ScanState`, `services/world-info-matcher.service.ts:150-160`). */
interface Hits {
  primary: Map<string, Set<number>>;
  secondary: Map<string, Set<number>>;
}

/** A text lower-cased for the scan, with where in the original each of its units starts and ends. */
interface Folded {
  text: string;
  start: number[];
  end: number[];
}

/** `foldWithOriginalOffsets` (`services/world-info-matcher.service.ts:30-48`): each code point lower-cased on its own. */
function fold(value: string): Folded {
  let text = "";
  const start: number[] = [];
  const end: number[] = [];
  for (let i = 0; i < value.length; ) {
    const width = value.codePointAt(i)! > 0xffff ? 2 : 1;
    const folded = value.slice(i, i + width).toLowerCase();
    text += folded;
    for (let k = 0; k < folded.length; k++) {
      start.push(i);
      end.push(i + width);
    }
    i += width;
  }
  return { text, start, end };
}

const isWordChar = (code: number): boolean => (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;

/** `verifyWordBoundary` (`:122-130`): a word starts at `start` and ends at `last`, the place of its last character. */
function onWordEdges(text: string, start: number, last: number): boolean {
  const before = start > 0 && isWordChar(text.charCodeAt(start - 1));
  const after = last + 1 < text.length && isWordChar(text.charCodeAt(last + 1));
  return isWordChar(text.charCodeAt(start)) !== before && isWordChar(text.charCodeAt(last)) !== after;
}

/**
 * `WorldInfoMatcher.scanChunk` (`:169-279`) without its automaton, which finds the same keys: each key of each entry in `scope`
 * (all, with none) looked for in the text, folded unless the entry or the user's setting is case-sensitive, and only at a word's
 * edges where whole words are asked for; a regex entry's key as a regular expression, case-folded the same way, its first match
 * counting and one that does not compile matching nothing (`:296-340`).
 */
function scan(entries: readonly Row[], chunk: string, hits: Hits, settings: WorldInfoSettings, scope?: ReadonlySet<string>): void {
  if (chunk === "") return;
  let folded: Folded | undefined;
  for (const e of entries) {
    if (scope !== undefined && !scope.has(e.uid)) continue;
    const caseSensitive = settings.forceCaseSensitive || e.case_sensitive;
    const whole = (settings.forceMatchWholeWords || e.match_whole_words) && !e.use_regex;
    for (const role of ["primary", "secondary"] as const) {
      const keys = role === "primary" ? e.key : e.keysecondary;
      keys.forEach((key, index) => {
        if (key === "" || hits[role].get(e.uid)?.has(index) === true) return;
        let found = false;
        if (e.use_regex) {
          let regex: RegExp | null;
          try {
            regex = new RegExp(key, caseSensitive ? "g" : "gi");
          } catch {
            regex = null;
          }
          found = regex !== null && regex.exec(chunk) !== null;
        } else {
          if (!caseSensitive) folded ??= fold(chunk);
          const text = caseSensitive ? chunk : folded!.text;
          const pattern = caseSensitive ? key : fold(key).text;
          for (let at = text.indexOf(pattern); at !== -1 && !found; at = text.indexOf(pattern, at + 1)) {
            if (!whole) found = true;
            else if (caseSensitive) found = onWordEdges(chunk, at, at + pattern.length - 1);
            else found = onWordEdges(chunk, folded!.start[at]!, folded!.end[at + pattern.length - 1]! - 1);
          }
        }
        if (!found) return;
        const set = hits[role].get(e.uid) ?? new Set<number>();
        set.add(index);
        hits[role].set(e.uid, set);
      });
    }
  }
}

/** `shouldActivate` (`:359-377`): a primary key matched, and the secondary keys as `selective_logic` asks. */
function keysHold(e: Row, hits: Hits): boolean {
  if ((hits.primary.get(e.uid)?.size ?? 0) === 0) return false;
  if (!e.selective || e.keysecondary.length === 0) return true;
  const count = hits.secondary.get(e.uid)?.size ?? 0;
  switch (e.selective_logic) {
    case 0:
      return count === e.keysecondary.length;
    case 1:
      return count === 0;
    case 2:
      return count > 0;
    case 3:
      return count < e.keysecondary.length;
    default:
      return true;
  }
}

// ---------------------------------------------------------------- activation

/** How an entry activated, as Lumiverse works it out (`ActivationProvenance`, `spindle/activation-provenance.ts:38-48`) and does not tell (AuFacts-14). */
export type Activation = { id: string; origin: "constant" | "sticky" | "vector" } | { id: string; origin: "keyword"; pass: number; primary: string[]; secondary: string[] };

type Provenance = { origin: "constant" | "sticky" } | { origin: "keyword"; pass: number; primary: string[]; secondary: string[] };

/** `applyWorldInfoGroupLogic` (`services/world-info-activation.service.ts:893-948`): entries of one group compete, an override winning by priority, else one drawn by weight; those of no group come first. */
function groupLogic(entries: readonly Row[], random: () => number): Row[] {
  const groups = new Map<string, Row[]>();
  const result: Row[] = [];
  for (const e of entries) {
    if (e.group_name === "") result.push(e);
    else groups.set(e.group_name, [...(groups.get(e.group_name) ?? []), e]);
  }
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]!);
      continue;
    }
    const overrides = group.filter((e) => e.group_override);
    if (overrides.length > 0) {
      result.push(overrides.sort((a, b) => b.priority - a.priority)[0]!);
      continue;
    }
    const total = group.reduce((n, e) => n + (e.group_weight || 1), 0);
    let roll = random() * total;
    for (const e of group) {
      roll -= e.group_weight || 1;
      if (roll <= 0) {
        result.push(e);
        break;
      }
    }
  }
  return result;
}

interface Finalized {
  entries: Row[];
  activatedBeforeBudget: number;
  activatedAfterBudget: number;
  evictedByBudget: number;
  estimatedTokens: number;
}

/**
 * `finalizeActivatedWorldInfoEntries` (`:514-547`) and `enforceBudget` (`:584-630`): groups, an entry with no text left out, the
 * order (priority, highest first, then `order_value`), then the cap on entries and the token budget, each keeping every constant
 * entry first and taking the rest in that order, a later smaller entry still fitting where a larger one did not.
 */
function finalize(entries: readonly Row[], settings: WorldInfoSettings, options: { random: () => number; skipGroupLogic?: boolean; preserveOrder?: boolean }): Finalized {
  const grouped = options.skipGroupLogic === true ? [...entries] : groupLogic(entries, options.random);
  const insertable = grouped.filter((e) => e.content.trim() !== "");
  if (options.preserveOrder !== true) insertable.sort((a, b) => (b.priority !== a.priority ? b.priority - a.priority : a.order_value - b.order_value));
  let kept = insertable;
  if (settings.maxActivatedEntries > 0 && kept.length > settings.maxActivatedEntries) {
    const constants = kept.filter((e) => e.constant);
    kept = [...constants, ...kept.filter((e) => !e.constant).slice(0, Math.max(0, settings.maxActivatedEntries - constants.length))];
  }
  if (settings.maxTokenBudget > 0) {
    let total = 0;
    const within: Row[] = [];
    for (const e of kept) {
      if (!e.constant) continue;
      total += tokensOf(e.content);
      within.push(e);
    }
    for (const e of kept) {
      if (e.constant) continue;
      const tokens = tokensOf(e.content);
      if (total + tokens > settings.maxTokenBudget) continue;
      total += tokens;
      within.push(e);
    }
    kept = within;
  }
  return { entries: kept, activatedBeforeBudget: insertable.length, activatedAfterBudget: kept.length, evictedByBudget: insertable.length - kept.length, estimatedTokens: kept.reduce((n, e) => n + tokensOf(e.content), 0) };
}

/** The matched keys of an entry, in their order. */
const keysAt = (keys: readonly string[], hit: ReadonlySet<number> | undefined): string[] => keys.filter((_, i) => hit?.has(i) === true);

/**
 * `activateWorldInfo` (`:370-512`), in its order: counts of entries no longer among the candidates dropped; disabled entries and
 * those below the minimum priority (constants excepted) left out; constants on; cooldowns counted down, each blocking its entry;
 * the keyword scan over every message the prompt is built from, hidden ones included (`:733-762`), then recursion passes over the
 * text of what activated, each match through its delay and its probability, setting its sticky count; a counted entry that matched
 * nothing losing its delay; sticky entries still in their window back on, a cooldown starting as the window closes; then groups,
 * the order and the budget. `wiState` is changed in place, as Lumiverse changes it.
 */
function activateKeywords(entries: readonly Row[], messages: readonly ChatMessage[], wiState: WiState, settings: WorldInfoSettings, random: () => number) {
  const uids = new Set(entries.map((e) => e.uid));
  for (const uid of Object.keys(wiState)) if (!uids.has(uid)) delete wiState[uid];
  let evictedByMinPriority = 0;
  const candidates = entries.filter((e) => {
    if (e.disabled) return false;
    if (settings.minPriority > 0 && e.priority < settings.minPriority && !e.constant) {
      evictedByMinPriority++;
      return false;
    }
    return true;
  });
  const constants = candidates.filter((e) => e.constant);
  const conditional = candidates.filter((e) => !e.constant);
  const activated: Row[] = [...constants];
  const provenance = new Map<string, Provenance>(constants.map((e) => [e.id, { origin: "constant" }]));
  const blocked = new Set<string>();
  const matched = new Set<string>();
  const delayCounted = new Set<string>();
  for (const e of conditional) {
    const state = wiState[e.uid];
    if (state === undefined || state.cooldownLeft <= 0) continue;
    state.cooldownLeft--;
    state.active = false;
    blocked.add(e.uid);
  }
  const activatedUids = new Set(constants.map((e) => e.uid));
  // `scanBaseState` (`:733-762`): one scan of each message for every depth entries ask, scan-exclusion markup blanked.
  const hits: Hits = { primary: new Map(), secondary: new Map() };
  const byDepth = new Map<number | null, Set<string>>();
  for (const e of conditional) {
    if (e.key.length === 0) continue;
    const depth = e.scan_depth ?? settings.globalScanDepth;
    byDepth.set(depth, (byDepth.get(depth) ?? new Set<string>()).add(e.uid));
  }
  for (const [depth, scope] of byDepth) {
    const selected = depth === null || depth <= 0 || depth >= messages.length ? messages : messages.slice(-depth);
    for (const m of selected) scan(conditional, maskWorldInfoScanExclusions(m.content), hits, settings, scope);
  }
  // `runAhoCorasickPasses` (`:779-865`).
  let recursionPassesUsed = 0;
  let newContent = constants.filter((e) => e.content !== "" && !e.prevent_recursion && !e.vectorized).map((e) => e.content);
  for (let pass = 0; pass <= settings.maxRecursionPasses; pass++) {
    if (pass > 0) {
      if (newContent.length === 0) break;
      for (const chunk of newContent) scan(conditional, chunk, hits, settings);
      newContent = [];
    }
    let activatedThisPass = false;
    for (const e of conditional) {
      if (activatedUids.has(e.uid) || blocked.has(e.uid)) continue;
      if (pass === 0 && e.delay_until_recursion) continue;
      if (pass > 0 && (e.exclude_recursion || e.vectorized)) continue;
      if (e.key.length === 0 || !keysHold(e, hits)) continue;
      const state = (wiState[e.uid] ??= { stickyLeft: 0, cooldownLeft: 0, delayCount: 0, active: false });
      matched.add(e.uid);
      if (e.delay > 0 && !delayCounted.has(e.uid)) {
        state.delayCount++;
        delayCounted.add(e.uid);
      }
      if (e.delay > 0 && state.delayCount < e.delay) continue;
      if (e.use_probability && e.probability < 100 && random() * 100 >= e.probability) continue;
      state.active = true;
      state.delayCount = 0;
      if (e.sticky > 0) state.stickyLeft = e.sticky;
      activated.push(e);
      activatedUids.add(e.uid);
      provenance.set(e.id, { origin: "keyword", pass, primary: keysAt(e.key, hits.primary.get(e.uid)), secondary: keysAt(e.keysecondary, hits.secondary.get(e.uid)) });
      activatedThisPass = true;
      if (e.content !== "" && !e.prevent_recursion && !e.vectorized) newContent.push(e.content);
    }
    if (activatedThisPass && pass > 0) recursionPassesUsed = pass;
    if (!activatedThisPass && (pass > 0 || newContent.length === 0 || pass >= settings.maxRecursionPasses)) break;
  }
  // `handleNoMatch` (`:875-885`).
  for (const e of conditional) {
    if (activatedUids.has(e.uid) || blocked.has(e.uid) || matched.has(e.uid)) continue;
    const state = wiState[e.uid];
    if (state === undefined) continue;
    if (state.active && state.stickyLeft <= 0) {
      state.active = false;
      state.delayCount = 0;
    }
    if (e.delay > 0) state.delayCount = 0;
  }
  for (const e of conditional) {
    if (activated.includes(e)) continue;
    const state = wiState[e.uid];
    if (state === undefined || state.stickyLeft <= 0) continue;
    state.stickyLeft--;
    state.active = true;
    activated.push(e);
    provenance.set(e.id, { origin: "sticky" });
    if (state.stickyLeft === 0 && e.cooldown > 0) state.cooldownLeft = e.cooldown;
  }
  const finalized = finalize(activated, settings, { random });
  const surviving = new Set(finalized.entries.map((e) => e.id));
  for (const id of [...provenance.keys()]) if (!surviving.has(id)) provenance.delete(id);
  return { finalized, provenance, totalCandidates: candidates.length, evictedByMinPriority, recursionPassesUsed };
}

// ---------------------------------------------------------------- the vector hits

/** What the scripted embedder gives for an entry it finds: how far its text is from the query, and the score Lumiverse's ranking gives it. */
export interface VectorHit {
  id: string;
  distance: number;
  finalScore: number;
}

/**
 * A test's own vector search, standing for Lumiverse's embeddings, its index, its hybrid search and its scoring
 * (`services/prompt-assembly.service.ts:5772-5860`): given the query Lumiverse builds and the entries it would search, the hits.
 * What Lumiverse then does with them, the stand-in does.
 */
export type VectorSearch = (query: string, candidates: readonly Entry[]) => readonly VectorHit[];

/** The user's embeddings settings the ranking reads (`services/embeddings.service.ts:296-306`), with Lumiverse's defaults (`:720-734`). */
export interface EmbeddingSettings {
  topK: number;
  similarityThreshold: number;
  rerankCutoff: number;
  hybridWeightMode: "keyword_first" | "balanced" | "vector_first";
}

export const DEFAULT_EMBEDDING_SETTINGS: EmbeddingSettings = { topK: 4, similarityThreshold: 0, rerankCutoff: 0, hybridWeightMode: "balanced" };

interface VectorPick {
  entry: Row;
  distance: number;
  finalScore: number;
}

/**
 * The vector query (`selectWorldInfoVectorQueryMessages`, `formatWorldInfoVectorQueryMessage`, `:5096-5150`): the messages not hidden
 * whose text is not blank once scan-exclusion markup is blanked, the newest `globalScanDepth` of them, each as
 * `[USER | name]: text` or `[CHARACTER | name]: text`, one a line, the last 24,000 characters kept (`:5078-5086`).
 */
function vectorQuery(messages: readonly ChatMessage[], depth: number | null, names: { user: string; character: string }): string {
  const visible = messages.filter((m) => !m.hidden && maskWorldInfoScanExclusions(m.content).trim() !== "");
  const chosen = depth === null ? visible : visible.slice(-depth);
  const text = chosen.map((m) => `[${m.role === "user" ? "USER" : "CHARACTER"} | ${m.role === "user" ? names.user : names.character}]: ${maskWorldInfoScanExclusions(m.content)}`).join("\n").trim();
  return text.length <= 24_000 ? text : text.slice(-24_000);
}

/**
 * `collectVectorActivatedWorldInfoDetailed` (`:5588-5935`) around the scripted search: no book attached, no entry vectorized,
 * enabled, with text and indexed, or no embeddings, and nothing is searched, with Lumiverse's own line saying why; else the hits
 * for searchable entries only, each at its nearest, then the ranking's last steps (`services/world-info-vector-ranking.ts:1840-1893`):
 * the distance threshold, the order, the rerank cutoff, and no more than the top K.
 */
function vectorPicks(entries: readonly Row[], messages: readonly ChatMessage[], settings: WorldInfoSettings, search: VectorSearch | null, embedding: EmbeddingSettings, names: { user: string; character: string }) {
  const started = performance.now();
  const books = new Set(entries.map((e) => e.book));
  const eligible = entries.filter((e) => e.vectorized && !e.disabled && e.content.trim() !== "" && e.vector_index_status === "indexed");
  const result = { picks: [] as VectorPick[], queryPreview: "", eligibleCount: eligible.length, hitsBeforeThreshold: 0, hitsAfterThreshold: 0, thresholdRejected: 0, hitsAfterRerankCutoff: 0, rerankRejected: 0, topK: 0, blockerMessages: [] as string[], timingsMs: { queryBuild: 0, queryEmbed: 0, search: 0, ranking: 0, total: 0 } };
  const done = (blocked?: Partial<typeof result>): typeof result => ({ ...result, ...blocked, timingsMs: { ...result.timingsMs, total: performance.now() - started } });
  if (books.size === 0) return done({ eligibleCount: 0, blockerMessages: ["No attached world books are active for this chat."] });
  if (eligible.length === 0) return done({ blockerMessages: ["This chat has no indexed, vector-enabled, non-disabled, non-empty lorebook entries to search."] });
  result.topK = Math.max(1, embedding.topK || 4);
  // With no embeddings connection the stand-in reads as Lumiverse's default embeddings config does (`services/embeddings.service.ts:720-734`, `services/prompt-assembly.service.ts:5662-5675`).
  if (search === null) return done({ blockerMessages: ["Embeddings are disabled, so lorebooks will use keyword matching only.", "No embedding API key is configured.", "Embeddings have not been tested yet, so dimensions are still unknown."] });
  const query = vectorQuery(messages, settings.globalScanDepth, names);
  result.timingsMs.queryBuild = performance.now() - started;
  result.queryPreview = query;
  if (query === "") return done({ blockerMessages: ["The current chat does not have enough visible recent text to build a vector query."] });
  const searchStarted = performance.now();
  const byId = new Map(eligible.map((e) => [e.id, e]));
  const nearest = new Map<string, VectorPick>();
  for (const hit of search(query, eligible.map((e) => e.entry))) {
    const entry = byId.get(hit.id);
    if (entry === undefined) continue;
    const had = nearest.get(entry.id);
    if (had === undefined || hit.distance < had.distance) nearest.set(entry.id, { entry, distance: hit.distance, finalScore: hit.finalScore });
  }
  result.timingsMs.search = performance.now() - searchStarted;
  const rankingStarted = performance.now();
  const vectorFirst = embedding.hybridWeightMode === "vector_first";
  // Vector First keeps only hits with a distance (`world-info-vector-ranking.ts:1840-1843`).
  const pooled = [...nearest.values()].filter((p) => !vectorFirst || Number.isFinite(p.distance));
  const passed = embedding.similarityThreshold > 0 ? pooled.filter((p) => (Number.isFinite(p.distance) ? p.distance <= embedding.similarityThreshold : p.finalScore > 0)) : [...pooled];
  passed.sort((a, b) => {
    if (vectorFirst && a.distance !== b.distance) return a.distance - b.distance;
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (b.entry.priority !== a.entry.priority) return b.entry.priority - a.entry.priority;
    return a.entry.order_value - b.entry.order_value;
  });
  const reranked = embedding.rerankCutoff > 0 ? passed.filter((p) => p.finalScore >= embedding.rerankCutoff) : passed;
  Object.assign(result, { picks: reranked.slice(0, result.topK), hitsBeforeThreshold: pooled.length, hitsAfterThreshold: passed.length, thresholdRejected: pooled.length - passed.length, hitsAfterRerankCutoff: reranked.length, rerankRejected: passed.length - reranked.length });
  result.timingsMs.ranking = performance.now() - rankingStarted;
  return done();
}

// ---------------------------------------------------------------- the merge, and what is told

/** `VECTOR_PRIORITY_BOOST_*` and `vectorPriorityBoost` (`services/prompt-assembly.service.ts:4805-4817`). */
function vectorPriorityBoost(score: number | undefined): number {
  if (typeof score !== "number" || !Number.isFinite(score) || score <= 0) return 0;
  return Math.max(0, Math.min(20, Math.round(score * 10)));
}

type Sources = Map<string, { source: "keyword" | "vector"; score?: number }>;

/** `SOURCE_PRECEDENCE` (`services/world-info-dedup.service.ts:35-44`). */
const SOURCE_PRECEDENCE: Record<string, number> = { character: 4, persona: 3, chat: 2, global: 1, peer: 0 };

/** `compareEntryPrecedence` (`:271-304`): a constant entry, then the higher priority, then the nearer book, then (Vector First) the nearer hit, then a keyword match. */
function precedence(a: Row, b: Row, sources: Sources, books: ReadonlyMap<string, { source: BookSource }>, retrieval?: (a: Row, b: Row) => number): number {
  if (a.constant && !b.constant) return -1;
  if (!a.constant && b.constant) return 1;
  if (b.priority !== a.priority) return b.priority - a.priority;
  const sourceRank = (e: Row): number => SOURCE_PRECEDENCE[books.get(e.book)?.source ?? ""] ?? 0;
  if (sourceRank(b) !== sourceRank(a)) return sourceRank(b) - sourceRank(a);
  if (retrieval) return retrieval(a, b);
  const sa = sources.get(a.id)?.source;
  const sb = sources.get(b.id)?.source;
  if (sa === "keyword" && sb !== "keyword") return -1;
  if (sb === "keyword" && sa !== "keyword") return 1;
  return 0;
}

/** `normalizeContent` (`:310-316`). */
const normalized = (s: string): string => s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();

/**
 * `deduplicateWorldInfoEntries` (`services/world-info-dedup.service.ts:59-104`): within each position, entries of the same text, then
 * of the same text once letter case, punctuation and spacing are set aside, then of text at least 30 characters long sharing 85% of
 * its words (each of two letters or more), keep the one of highest precedence; a constant entry is never dropped.
 */
function dedupe(entries: readonly Row[], sources: Sources, books: ReadonlyMap<string, { source: BookSource }>, retrieval?: (a: Row, b: Row) => number): { entries: Row[]; removed: string[] } {
  if (entries.length <= 1) return { entries: [...entries], removed: [] };
  const removed = new Set<string>();
  const byPosition = new Map<number, Row[]>();
  for (const e of entries) byPosition.set(e.position, [...(byPosition.get(e.position) ?? []), e]);
  const resolve = (dupes: Row[]): void => {
    const [, ...rest] = [...dupes].sort((a, b) => precedence(a, b, sources, books, retrieval));
    for (const loser of rest) if (!loser.constant) removed.add(loser.id);
  };
  for (const group of byPosition.values()) {
    if (group.length <= 1) continue;
    for (const keyOf of [(e: Row): string => e.content, (e: Row): string => normalized(e.content)]) {
      const byKey = new Map<string, Row[]>();
      for (const e of group) {
        if (removed.has(e.id) || e.content.trim() === "") continue;
        const key = keyOf(e);
        if (key === "") continue;
        byKey.set(key, [...(byKey.get(key) ?? []), e]);
      }
      for (const dupes of byKey.values()) if (dupes.length > 1) resolve(dupes);
    }
    const words = (s: string): Set<string> => new Set(normalized(s).split(" ").filter((w) => w.length >= 2));
    const eligible = group.filter((e) => !removed.has(e.id) && e.content.length >= 30).map((entry) => ({ entry, words: words(entry.content) }));
    for (let i = 0; i < eligible.length; i++) {
      if (removed.has(eligible[i]!.entry.id)) continue;
      for (let j = i + 1; j < eligible.length; j++) {
        if (removed.has(eligible[j]!.entry.id)) continue;
        const [a, b] = [eligible[i]!, eligible[j]!];
        let shared = 0;
        for (const w of a.words.size <= b.words.size ? a.words : b.words) if ((a.words.size <= b.words.size ? b.words : a.words).has(w)) shared++;
        const union = a.words.size + b.words.size - shared;
        const similarity = a.words.size === 0 && b.words.size === 0 ? 1 : union === 0 ? 1 : shared / union;
        if (similarity < 0.85 || (a.entry.constant && b.entry.constant)) continue;
        const loser = precedence(a.entry, b.entry, sources, books, retrieval) <= 0 ? b.entry : a.entry;
        if (!loser.constant) removed.add(loser.id);
      }
    }
  }
  return { entries: entries.filter((e) => !removed.has(e.id)), removed: [...removed] };
}

/** An activated entry as Lumiverse tells it (`ActivatedWorldInfoEntry`, `llm/types.ts:417-427`; filled at `services/prompt-assembly.service.ts:5053-5069`). */
export interface ActivatedWorldInfoEntry {
  id: string;
  comment: string;
  keys: string[];
  /** Only these two: a constant entry and a sticky one are "keyword" too. */
  source: "keyword" | "vector";
  score: number | undefined;
  bookId: string;
  bookSource: BookSource | undefined;
  bookName: string | undefined;
  estimatedTokens: number;
}

/** What activation gives a generation. */
export interface Lore {
  /** The entries, in the order the prompt places them, each position keeping it (`bucketByPosition`, `services/world-info-activation.service.ts:952-1022`). */
  entries: Entry[];
  /** What Lumiverse tells of each, in that order: the event's entries and, projected, the interceptors' (`services/generate.service.ts:1217-1220`, `:2868-2879`). */
  told: ActivatedWorldInfoEntry[];
  /** The event's `stats` (`services/prompt-assembly.service.ts:2563-2597`). */
  stats: Record<string, unknown>;
  /** How each activated, as Lumiverse works it out and does not tell. */
  activated: Activation[];
}

export interface LoreInput {
  /** The entries as the World Info chain left them, each with its `uid`. */
  entries: readonly Entry[];
  /** The messages the prompt is built from, hidden ones included. */
  messages: readonly ChatMessage[];
  /** The chat's `wi_state`, changed in place. */
  wiState: WiState;
  settings: Partial<WorldInfoSettings>;
  random: () => number;
  vector: VectorSearch | null;
  embedding: EmbeddingSettings;
  /** Each book's name and where it is attached (`bookNameMap`, `bookSourceMap`). */
  books: ReadonlyMap<string, { name: string; source: BookSource }>;
  /** The speakers' names the vector query writes. */
  names: { user: string; character: string };
}

/**
 * The lore of a generation as Lumiverse's assembly works it out (`services/prompt-assembly.service.ts:2342-2597`): the keyword
 * activation; the vector hits; the two merged (`selectMergedWorldInfoEntries`, `:4846-5013`: keyword entries first, a vector hit
 * of an entry already on taking nothing from it unless the mode is Vector First, one below the minimum priority left out;
 * duplicates dropped; groups drawn again; with a budget, the order by priority, a vector hit's score raising its own, and the
 * budget again); and what Lumiverse tells of the result (`mergeActivatedWorldInfoEntries`, `:5015-5094`).
 */
export function activateLore(input: LoreInput): Lore {
  const settings = normalizeWorldInfoSettings(input.settings);
  const rows = input.entries.map(rowOf);
  const keyword = activateKeywords(rows, input.messages, input.wiState, settings, input.random);
  const vector = vectorPicks(rows, input.messages, settings, input.vector, input.embedding, input.names);
  const mergeStarted = performance.now();
  const vectorFirst = input.embedding.hybridWeightMode === "vector_first";
  const merged: Row[] = [];
  const sources: Sources = new Map();
  for (const e of keyword.finalized.entries) {
    if (sources.has(e.id)) continue;
    merged.push(e);
    sources.set(e.id, { source: "keyword" });
  }
  const pickOf = new Map(vector.picks.map((p) => [p.entry.id, p]));
  for (const p of vector.picks) {
    const had = sources.get(p.entry.id);
    if (had !== undefined) {
      if (had.source === "keyword" && vectorFirst && !p.entry.constant) sources.set(p.entry.id, { source: "vector", score: p.finalScore });
      continue;
    }
    if (settings.minPriority > 0 && p.entry.priority < settings.minPriority && !p.entry.constant) continue;
    merged.push(p.entry);
    sources.set(p.entry.id, { source: "vector", score: p.finalScore });
  }
  const byRetrieval = (a: Row, b: Row): number => {
    const va = sources.get(a.id)?.source === "vector" ? pickOf.get(a.id) : undefined;
    const vb = sources.get(b.id)?.source === "vector" ? pickOf.get(b.id) : undefined;
    if (va && !vb) return -1;
    if (vb && !va) return 1;
    if (va && vb) {
      if (va.distance !== vb.distance) return va.distance - vb.distance;
      if (va.finalScore !== vb.finalScore) return vb.finalScore - va.finalScore;
    }
    return 0;
  };
  const deduped = dedupe(merged, sources, input.books, vectorFirst ? byRetrieval : undefined);
  for (const id of deduped.removed) sources.delete(id);
  const selected = groupLogic(deduped.entries, input.random);
  const hasBudget = settings.maxActivatedEntries > 0 || settings.maxTokenBudget > 0;
  const boosted = new Map<string, number>();
  if (hasBudget) {
    for (const e of selected) {
      const s = sources.get(e.id);
      boosted.set(e.id, e.priority + (s?.source === "vector" ? vectorPriorityBoost(s.score) : 0));
    }
  }
  const competition = [...selected].sort((a, b) => {
    if (vectorFirst) {
      const order = byRetrieval(a, b);
      if (order !== 0) return order;
    }
    const pa = boosted.get(a.id) ?? a.priority;
    const pb = boosted.get(b.id) ?? b.priority;
    return pb !== pa ? pb - pa : a.order_value - b.order_value;
  });
  const finalized = finalize(hasBudget || vectorFirst ? competition : selected, settings, { random: input.random, skipGroupLogic: true, preserveOrder: true });
  const told: ActivatedWorldInfoEntry[] = finalized.entries.map((e) => {
    const s = sources.get(e.id);
    const book = input.books.get(e.book);
    return { id: e.id, comment: e.comment || "", keys: e.key, source: s?.source ?? "keyword", score: s?.score, bookId: e.book, bookSource: book?.source, bookName: book?.name, estimatedTokens: tokensOf(e.content) };
  });
  const mergeMs = performance.now() - mergeStarted;
  const keywordActivated = told.filter((e) => e.source === "keyword").length;
  const activated = finalized.entries.map((e): Activation => {
    if (sources.get(e.id)?.source === "vector") return { id: e.id, origin: "vector" };
    const p = keyword.provenance.get(e.id) ?? { origin: "keyword", pass: 0, primary: [], secondary: [] };
    return { id: e.id, ...p };
  });
  const stats = {
    totalCandidates: keyword.totalCandidates,
    activatedBeforeBudget: finalized.activatedBeforeBudget,
    activatedAfterBudget: finalized.activatedAfterBudget,
    evictedByBudget: finalized.evictedByBudget,
    evictedByMinPriority: keyword.evictedByMinPriority,
    estimatedTokens: finalized.estimatedTokens,
    recursionPassesUsed: keyword.recursionPassesUsed,
    keywordActivated,
    vectorActivated: told.length - keywordActivated,
    totalActivated: finalized.entries.length,
    deduplicated: deduped.removed.length,
    queryPreview: vector.queryPreview,
    vectorRetrieval: {
      eligibleCount: vector.eligibleCount,
      hitsBeforeThreshold: vector.hitsBeforeThreshold,
      hitsAfterThreshold: vector.hitsAfterThreshold,
      thresholdRejected: vector.thresholdRejected,
      hitsAfterRerankCutoff: vector.hitsAfterRerankCutoff,
      rerankRejected: vector.rerankRejected,
      topK: vector.topK,
      blockerMessages: vector.blockerMessages,
      timingsMs: { ...vector.timingsMs, merge: mergeMs, total: vector.timingsMs.total + mergeMs },
    },
  };
  return { entries: finalized.entries.map((e) => e.entry), told, stats, activated };
}
