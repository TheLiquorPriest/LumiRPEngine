// The stand-in Lumiverse's prompt (`lumiverse.ts` calls it for each generation), assembled in Lumiverse's
// order: the preset's blocks, with the chat's visible history at its history marker and queued sends joined
// in it, lore at the preset's World Info markers or just before and after the history, the pool of "at
// marker" lore inside the block that asks for it, and in-history blocks spliced in; then the prompt's end
// as Lumiverse makes it, the preset's completion settings over it all; and the breakdown Lumiverse keeps of
// it. What it copies from Lumiverse's source (staging at a70f4ed2) says the file and lines; paths are
// Lumiverse's `src/`. It resolves no macro but `{{wi_marker}}`, `{{outlet::name}}` and a secret mark in lore.

import type { WI_MARKERS } from "./db";
import type { Entry, Placement } from "./lore";
import { indexInChat, type ChatMessage } from "./rows";
import { stripClosingTags, textOf, type LlmMessage, type LlmPart, type Role } from "./steps";

export interface Block {
  id: string;
  name: string;
  role: Role;
  content: string;
  /** Spliced into the chat history this many messages from its end, not as history: a block placed "in history". */
  depth?: number;
  /**
   * The marker it is, where it is one (`PromptBlock.marker`): `chat_history` places the chat's history, `world_info_before` and
   * `world_info_after` the lore of their position (`services/prompt-assembly.service.ts:3161`, `:3491-3561`), their content not sent. Any other
   * of the twelve (`VALID_WI_MARKERS`, `services/world-books.service.ts:177-190`) is a block that sends its content as it is and that a
   * position-7 entry pinned to it by `wi_marker` stands beside. A stand-in preset that marks no block `chat_history` has its history
   * after its last block.
   */
  marker?: (typeof WI_MARKERS)[number];
}

/** A preset, with the parts of its `prompts` the stand-in reads. */
export interface Preset {
  id: string;
  name: string;
  blocks: Block[];
  /** "Collapse into single user message". */
  collapse?: boolean;
  /** The reply's start the preset gives (`prompts.completionSettings.assistantPrefill`). */
  assistantPrefill?: string;
  /** An impersonation's start, in place of `assistantPrefill` where set (`completionSettings.assistantImpersonation`). */
  assistantImpersonation?: string;
  /** "Continue prefill": a continue's message and an impersonation's prompt end the prompt as a reply to go on with (`completionSettings.continuePrefill`). */
  continuePrefill?: boolean;
  parameters?: Record<string, unknown>;
  /**
   * Put after a continued message's text, in the prompt and when the continue is saved (`prompts.completionSettings.continuePostfix`);
   * absent, none (`services/generate.service.ts:1975-1977`). Lumiverse's default preset says one space itself (`auth/default-preset.ts:316`).
   */
  continuePostfix?: string;
  /** The line that asks the model to go on with a continued message (`prompts.promptBehavior.continueNudge`): absent, Lumiverse's own; empty, none. */
  continueNudge?: string;
  /** "Squash system messages": a system message joins the system message before it (`completionSettings.squashSystemMessages`). */
  squashSystemMessages?: boolean;
  /** "Use system prompt": off, every system message is sent as the user's (`completionSettings.useSystemPrompt`); absent, on. */
  useSystemPrompt?: boolean;
  /** Names (`completionSettings.namesBehavior`): 0 none, 1 the speaker's name beside each user and assistant message, 2 written at the start of its text. */
  namesBehavior?: 0 | 1 | 2;
  /** The preset's own metadata (`presets.metadata`): each extension is handed only its own namespace of it, `metadata[<its identifier>]` (`spindle/preset-metadata-context.ts`). */
  metadata?: Record<string, unknown>;
}

/** Lumiverse's own continue nudge, for a preset that sets none (`services/prompt-behavior.ts:10`). */
export const CONTINUE_NUDGE = "[Continue your last message without repeating its original content.]";

export type GenerationType = "normal" | "swipe" | "regenerate" | "continue" | "impersonate";

/** What the assembly is told of the generation whose prompt it ends. */
export interface Ending {
  type: GenerationType;
  /** The user's "Start Reply With": the connection's own where it binds one, an empty one included, else the user's setting (`services/prompt-assembly.service.ts:4130-4137`). */
  promptBias: string;
  /** A continue's message, where Lumiverse found one (`continueMessageId`), and the postfix resolved for it (`continuePostfix`). */
  continueMessageId?: string;
  continuePostfix?: string;
  /**
   * The names `namesBehavior` writes (`services/prompt-assembly.service.ts:7186-7208`): the persona's for the user's messages, else
   * "User", and the character's for the assistant's.
   */
  names: { user: string; character: string };
  /**
   * What the World Info chain gave about where the activated lore goes (`services/prompt-assembly.service.ts:2472-2491`): the entries it placed in
   * the chat's history, by entry, and the extension whose `outputOrder: "insertion"` it carries, by entry.
   */
  world?: { placements: ReadonlyMap<string, Placement>; insertionOrder: ReadonlyMap<string, string> };
}

/** One entry of the assembly's breakdown (`AssemblyBreakdownEntry`). */
export interface BreakdownEntry {
  type: string;
  name: string;
  role?: string;
  content?: string;
  blockId?: string;
  messageCount?: number;
  firstMessageIndex?: number;
  marker?: string;
  /** Its tokens are already counted in the block that holds its text (`:3846`). */
  excludeFromTotal?: boolean;
  /** The text its tokens are counted from where that is not its `content`: a block that expands `{{wi_marker}}` counts only its wrapper (`:1507-1532`). */
  tokenCountContent?: string;
  /** Its block expanded `{{wi_marker}}`, so the "WI At Marker" rows count in the total and this entry counts only its wrapper (`attributeExpandedMarkerWorldInfoTokens`, `:1507-1520`). */
  attributesWorldInfoMarkerTokens?: boolean;
}

export interface Assembled {
  prompt: LlmMessage[];
  breakdown: BreakdownEntry[];
}

/** `appendTextToMessage` (`services/prompt-assembly.service.ts:720-735`): the text after the last text part, or as a part of its own. */
function withText(message: LlmMessage, text: string): LlmMessage {
  if (text === "") return message;
  if (typeof message.content === "string") return { ...message, content: message.content + text };
  const parts = [...message.content];
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!;
    if (part.type !== "text") continue;
    parts[i] = { ...part, text: part.text + text };
    return { ...message, content: parts };
  }
  return { ...message, content: [...parts, { type: "text", text }] };
}

/**
 * `mergeConsecutiveUserMessages` (`services/prompt-assembly.service.ts:6754-6843`), in place over the `count` messages from
 * `start`: two user messages in a row (sends queued while a reply was written) become one, their texts joined by a blank line
 * and their pictures after the text, history if either was, with the first source either names (its id and its number). The
 * second message's id never reaches an interceptor. Gives how many messages the stretch holds now. (The stand-in makes none
 * of Lumiverse's memory summaries, which this leaves alone.)
 */
export function mergeQueuedUserMessages(result: LlmMessage[], start: number, count: number): number {
  let remaining = count;
  let i = start;
  while (i < start + remaining - 1) {
    const a = result[i]!;
    const b = result[i + 1]!;
    if (a.role !== "user" || b.role !== "user") {
      i++;
      continue;
    }
    const text = `${textOf(a)}\n\n${textOf(b)}`;
    const media = [a, b].flatMap((m) => (typeof m.content === "string" ? [] : m.content.filter((p) => p.type !== "text")));
    const merged: LlmMessage = { role: "user", content: media.length > 0 ? [{ type: "text", text }, ...media] : text };
    if (a.__chatHistorySource === true || b.__chatHistorySource === true) {
      merged.__chatHistorySource = true;
      if (a.__contextAnchorProtected === true || b.__contextAnchorProtected === true) merged.__contextAnchorProtected = true;
      const source = [a, b].find((m) => typeof m.__sourceMessageId === "string" && typeof m.__sourceIndexInChat === "number");
      if (source !== undefined) {
        merged.__sourceMessageId = source.__sourceMessageId;
        merged.__sourceIndexInChat = source.__sourceIndexInChat;
      }
    }
    if (a.__worldInfoSource === true || b.__worldInfoSource === true) merged.__worldInfoSource = true;
    result[i] = merged;
    result.splice(i + 1, 1);
    remaining--;
  }
  return remaining;
}

/**
 * `applyCompletionSettings` (`services/prompt-assembly.service.ts:7129-7231`), in place, in one pass: with "Squash system
 * messages" a system message joins the message before it when that one began as a system message, after a blank line, its other
 * marks gone with it (a continue's nudge never joins); with "Use system prompt" off a system message goes as the user's; names 1
 * set each user and assistant message's `name`, and names 2 write it at the start of its first text. A message that began as a
 * system message keeps the mark Lumiverse gives it (`_fromSystem`), which the interceptors are handed with the rest.
 */
export function applyCompletionSettings(result: LlmMessage[], preset: Pick<Preset, "squashSystemMessages" | "useSystemPrompt" | "namesBehavior">, names: Ending["names"]): void {
  const namesBehavior = preset.namesBehavior ?? 0;
  let write = 0;
  for (let read = 0; read < result.length; read++) {
    let msg = result[read]!;
    const isSystem = msg.role === "system";
    const prev = write > 0 ? result[write - 1]! : undefined;
    if (preset.squashSystemMessages === true && isSystem && msg.__continueNudge !== true && prev?._fromSystem === true) {
      // The text before takes the joining message's text only where that is one text (`:7166-7172`).
      const before = typeof prev.content === "string" ? prev.content : (prev.content.find((p) => p.type === "text")?.text ?? "");
      result[write - 1] = { ...prev, content: `${before}\n\n${typeof msg.content === "string" ? msg.content : ""}` };
      continue;
    }
    if (preset.useSystemPrompt === false && isSystem) msg = { ...msg, role: "user" };
    if (isSystem) msg._fromSystem = true;
    if (namesBehavior !== 0 && (msg.role === "user" || msg.role === "assistant")) {
      const name = msg.role === "user" ? names.user : names.character;
      if (namesBehavior === 1) msg = { ...msg, name };
      else if (typeof msg.content === "string") msg = { ...msg, content: `${name}: ${msg.content}` };
      else {
        const parts = [...msg.content];
        const at = parts.findIndex((p) => p.type === "text");
        const part = parts[at];
        if (part?.type === "text") parts[at] = { type: "text", text: `${name}: ${part.text}` };
        msg = { ...msg, content: parts };
      }
    }
    result[write] = msg;
    write++;
  }
  result.length = write;
}

/** One activated entry as the assembly places it: its text after the macro pass, its role, and the label it is named by. */
interface PlacedLore {
  content: string;
  role: Role;
  label: string;
}

/** A position-7 entry pinned beside the block whose marker it names (`WorldInfoCache.pinnedMarkers`, `services/world-info-activation.service.ts:994-1005`). */
interface PinnedLore extends PlacedLore {
  marker: string;
  side: "before" | "after";
}

/** A position-4 entry (`WorldInfoCache.depth`): this many messages from the end of the prompt. */
interface DepthLore extends PlacedLore {
  depth: number;
}

/** An entry an interceptor placed in the chat's history (`RuntimeWorldInfoChatPlacementEntry`, `services/prompt-assembly.service.ts:403-411`). */
interface RuntimeLore {
  id: string;
  content: string;
  label: string;
  orderValue: number;
  placement: Placement;
}

/** Every bucket the activated lore goes into (`WorldInfoCache`, `services/world-info-activation.service.ts:912-939`), and what an interceptor placed. */
interface Lore {
  before: PlacedLore[];
  after: PlacedLore[];
  anBefore: PlacedLore[];
  anAfter: PlacedLore[];
  depth: DepthLore[];
  emBefore: PlacedLore[];
  emAfter: PlacedLore[];
  atMarker: PlacedLore[];
  pinned: PinnedLore[];
  runtime: RuntimeLore[];
  /** The text each outlet gives where `{{outlet::name}}` stands (`resolveWorldInfoOutlets`, `:4701-4794`). */
  outlets: Record<string, string>;
}

/** A block, or a marker's lore, waiting to be spliced into the history (`pendingDepthBlocks`, `:3054-3064`). */
interface InHistory {
  role: Role;
  depth: number;
  content: string;
  tokenCountContent?: string;
  attributesWorldInfoMarkerTokens?: boolean;
  name: string;
  blockId: string;
  worldInfo: boolean;
}

/**
 * `{{wi_marker}}` and its alias `{{wiMarker}}`, in any case, bare or with `::` and arguments it ignores (`macros/definitions/primitives.ts:159-171`;
 * the registry folds a name's case, `macros/MacroRegistry.ts:25-68`), and the way Lumiverse looks for it before it counts a block
 * (`WI_MARKER_MACRO_RE`, `services/prompt-assembly.service.ts:1500`).
 */
const WI_MARKER = /\{\{\s*wi_?marker\s*(?:::[^{}]*)?\}\}/gi;
const WI_MARKER_USED = /\{\{\s*wi_?marker\s*(?:\}\}|::)/i;
/** `{{outlet::name}}` (`macros/definitions/primitives.ts:126-140`): its name trimmed and folded to lower case; what has none gives nothing. */
const OUTLET = /\{\{\s*outlet\s*::([^{}]*)\}\}/gi;

/** What a text becomes under the macros the stand-in knows: an outlet's text where one stands, the "at marker" pool where `{{wi_marker}}` does. */
function expandMacros(text: string, outlets: Record<string, string>, pool: string): string {
  return text.replace(OUTLET, (_all, args: string) => outlets[args.split("::")[0]!.trim().toLowerCase()] ?? "").replace(WI_MARKER, () => pool);
}

/** `normalizePromptBlockText` (`services/prompt-assembly.service.ts:6999-7001`): runs of blank lines folded to one, the ends trimmed. */
const normalizeBlockText = (text: string): string => text.replace(/\n{3,}/g, "\n\n").trim();

/** `getWorldInfoEntryLabel` (`services/world-info-activation.service.ts:1036-1047`): the comment, else the primary keys, else the secondary keys, each trimmed and the empty ones left out, else the entry's id's first eight characters. */
function entryLabel(e: Entry): string {
  const comment = e.comment?.trim();
  if (comment) return comment;
  const primary = (e.keys ?? []).map((k) => k.trim()).filter((k) => k !== "");
  if (primary.length > 0) return primary.join(", ");
  const secondary = (e.keysecondary ?? []).map((k) => k.trim()).filter((k) => k !== "");
  if (secondary.length > 0) return secondary.join(", ");
  return `(unnamed entry ${e.id.slice(0, 8)})`;
}

/** `getRuntimeWorldInfoEntryLabel` (`:516-526`): the comment, else every key, primary then secondary, trimmed, else the id's first eight characters. */
function runtimeLabel(e: Entry): string {
  const comment = e.comment?.trim();
  if (comment) return comment;
  const keys = [...(e.keys ?? []), ...(e.keysecondary ?? [])].map((k) => k.trim()).filter((k) => k !== "");
  return keys.length > 0 ? keys.join(", ") : `(unnamed entry ${e.id.slice(0, 8)})`;
}

/**
 * `orderWorldInfoForOutput` (`services/world-info-output-order.ts`): the entries each extension asked to have in `insertion` order
 * (by `order_value`, equal ones as they came, the last of them first before the reverse puts it right) keep the places they took among
 * the activated entries and are put in that order within them; entries placed in the history are left out of it.
 */
function orderForOutput(entries: readonly Entry[], insertionOrder: ReadonlyMap<string, string>, placed: ReadonlySet<string>): Entry[] {
  if (insertionOrder.size === 0) return [...entries];
  const groups = new Map<string, { indices: number[]; entries: Entry[] }>();
  entries.forEach((entry, index) => {
    const extension = insertionOrder.get(entry.id);
    if (extension === undefined || placed.has(entry.id)) return;
    const group = groups.get(extension) ?? { indices: [], entries: [] };
    group.indices.push(index);
    group.entries.push(entry);
    groups.set(extension, group);
  });
  const ordered = [...entries];
  for (const group of groups.values()) {
    if (group.entries.length < 2) continue;
    group.entries.sort((a, b) => (b.order_value ?? 100) - (a.order_value ?? 100)).reverse();
    group.indices.forEach((at, k) => {
      ordered[at] = group.entries[k]!;
    });
  }
  return ordered;
}

/**
 * `resolveWorldInfoOutlets` (`services/prompt-assembly.service.ts:4701-4794`): every entry that names an outlet gives its text to it, those
 * of one outlet joined by a blank line; each outlet's text then goes through the macros, an outlet naming another read again, up to five times.
 */
function resolveOutlets(entries: readonly Entry[]): Record<string, string> {
  const templates = new Map<string, string>();
  for (const e of entries) {
    const name = typeof e.outlet_name === "string" ? e.outlet_name.trim().toLowerCase() : "";
    if (name === "" || e.content.trim() === "") continue;
    templates.set(name, templates.has(name) ? `${templates.get(name)}\n\n${e.content}` : e.content);
  }
  let resolved: Record<string, string> = Object.fromEntries(templates);
  for (let pass = 0; pass < 5 && templates.size > 0; pass++) {
    const next: Record<string, string> = {};
    for (const [name, template] of templates) next[name] = stripClosingTags(expandMacros(template, resolved, ""));
    const changed = Object.keys(next).some((name) => next[name] !== resolved[name]);
    resolved = next;
    if (!changed) break;
  }
  return resolved;
}

/**
 * The activated entries by where they go (`bucketByPosition`, `services/world-info-activation.service.ts:952-1022`): 0 before, 1 after, 2 and 3
 * around the first history message, 4 at its depth, 5 and 6 as 2 and 3, 7 in the "at marker" pool or, with a marker named, pinned beside its
 * block, 8 in none; each named by its label, then each text through the macro pass (`services/prompt-assembly.service.ts:2994-3025`),
 * which strips a lone secret mark (the stand-in's `stripClosingTags`) and gives an outlet's text where `{{outlet::name}}` stands, an entry left
 * with no text dropped (`:3026`, `pruneEmptyWorldInfoCacheEntries`). The scan that activated them read their raw text
 * (`services/world-info-activation.service.ts:753-758`), so stripping a mark here changes no entry's activation. An entry an interceptor
 * placed in the history leaves the buckets (`:2472-2491`); the entries are ordered for output first (`:2479-2483`).
 */
function placedLore(active: readonly Entry[], world: Ending["world"]): Lore {
  const requested = world?.placements ?? new Map<string, Placement>();
  const runtime = active
    .filter((e) => requested.has(e.id))
    .map((e): RuntimeLore => ({ id: e.id, content: e.content, label: runtimeLabel(e), orderValue: e.order_value ?? 100, placement: requested.get(e.id)! }))
    .sort((a, b) => b.orderValue - a.orderValue)
    .reverse();
  const runtimeIds = new Set(runtime.map((r) => r.id));
  const output = orderForOutput(active, world?.insertionOrder ?? new Map<string, string>(), runtimeIds);
  const outlets = resolveOutlets(output);
  const placed: Lore = { before: [], after: [], anBefore: [], anAfter: [], depth: [], emBefore: [], emAfter: [], atMarker: [], pinned: [], runtime: [], outlets };
  const text = (raw: string): string => stripClosingTags(expandMacros(raw, outlets, ""));
  for (const e of output) {
    if (runtimeIds.has(e.id) || e.content.trim() === "") continue;
    const content = text(e.content);
    if (content.trim() === "") continue;
    const lore: PlacedLore = { content, role: e.role ?? "system", label: entryLabel(e) };
    switch (e.position ?? 0) {
      case 1:
        placed.after.push(lore);
        break;
      case 2:
        placed.anBefore.push(lore);
        break;
      case 3:
        placed.anAfter.push(lore);
        break;
      case 4:
        placed.depth.push({ ...lore, depth: e.depth ?? 4 });
        break;
      case 5:
        placed.emBefore.push(lore);
        break;
      case 6:
        placed.emAfter.push(lore);
        break;
      case 7:
        if (typeof e.wi_marker === "string" && e.wi_marker.length > 0) placed.pinned.push({ ...lore, marker: e.wi_marker, side: e.wi_marker_side === "before" ? "before" : "after" });
        else placed.atMarker.push(lore);
        break;
      case 8:
        break;
      default:
        placed.before.push(lore);
    }
  }
  for (const r of runtime) {
    const content = text(r.content);
    if (content.trim() !== "") placed.runtime.push({ ...r, content });
  }
  return placed;
}

/** `injectWorldInfoAt` (`services/prompt-assembly.service.ts:6582-6610`): each entry spliced in from `insertAt` on, flagged, and named by the position and its label; how many went in. */
function injectLoreAt(prompt: LlmMessage[], breakdown: BreakdownEntry[], entries: readonly PlacedLore[], insertAt: number, name: string): number {
  let at = Math.max(0, Math.min(insertAt, prompt.length));
  for (const e of entries) {
    prompt.splice(at, 0, { role: e.role, content: e.content, __worldInfoSource: true });
    breakdown.push({ type: "world_info", name: `${name}: ${e.label}`, role: e.role, content: e.content });
    at++;
  }
  return entries.length;
}

/** `pushPinnedMarkerEntries` (`:6618-6632`): the entries pinned beside a block, flagged, after what is in the prompt, named `WI @ <marker>: <label>`. */
function pushPinned(prompt: LlmMessage[], breakdown: BreakdownEntry[], entries: readonly PinnedLore[]): void {
  for (const e of entries) {
    prompt.push({ role: e.role, content: e.content, __worldInfoSource: true });
    breakdown.push({ type: "world_info", name: `WI @ ${e.marker}: ${e.label}`, role: e.role, content: e.content });
  }
}

/**
 * `insertRuntimeWorldInfoIntoTaggedHistory` (`services/prompt-assembly.service.ts:425-487`), in place: each entry in turn counted from the start or
 * the end of the history messages as they stand (the ones placed before it among them), and spliced in; with no history, at `fallbackIndex`.
 */
function insertRuntime(prompt: LlmMessage[], entries: readonly RuntimeLore[], fallbackIndex: number): void {
  const history = new Set<LlmMessage>(prompt.filter((m) => m.__chatHistorySource === true));
  const fallback = Math.max(0, Math.min(Math.trunc(fallbackIndex), prompt.length));
  for (const entry of entries) {
    const places: number[] = [];
    prompt.forEach((m, i) => {
      if (history.has(m)) places.push(i);
    });
    const span = places.length;
    const start = entry.placement.direction === "from_start" ? entry.placement.depth : span - entry.placement.depth;
    // `Array.splice` takes a negative start as an offset from the end.
    const boundary = start < 0 ? Math.max(span + start, 0) : Math.min(start, span);
    const at = span === 0 ? fallback : boundary === span ? places[span - 1]! + 1 : places[boundary]!;
    const message: LlmMessage = { role: entry.placement.role, content: entry.content, __worldInfoSource: true, __runtimeWorldInfoPlacementId: entry.id };
    prompt.splice(at, 0, message);
    history.add(message);
  }
}

/**
 * `insertBlocksIntoTaggedHistory` (`services/prompt-assembly.service.ts:378-402`), in place: every block's place found first, by
 * counting back `depth` history messages (`resolveChatHistoryInsertionIndex`, `:357-376`), then each spliced in from the last
 * place back, the later block first where two share a place, so they keep the preset's order; a marker's lore keeps its flag.
 */
function insertIntoHistory(messages: LlmMessage[], blocks: readonly InHistory[]): void {
  const history = messages.flatMap((m, i) => (m.__chatHistorySource === true ? [i] : []));
  const placeOf = (depth: number): number => {
    if (history.length === 0) return messages.length;
    const from = Math.max(0, history.length - Math.max(0, depth));
    return from >= history.length ? history.at(-1)! + 1 : history[from]!;
  };
  const placements = blocks.map((block, order) => ({ block, order, at: placeOf(block.depth) }));
  placements.sort((a, b) => b.at - a.at || b.order - a.order);
  for (const { block, at } of placements) messages.splice(at, 0, { role: block.role, content: block.content, ...(block.worldInfo ? { __worldInfoSource: true } : {}) });
}

/** The prompt for these messages, each history message carrying the number Lumiverse stored for it (`:229-231`, `:3361`, `:3398`). */
export function assemble(preset: Preset, active: readonly Entry[], messages: readonly ChatMessage[], ending: Ending): Assembled {
  const breakdown: BreakdownEntry[] = [];
  const prompt: LlmMessage[] = [];
  const lore = placedLore(active, ending.world);
  const pending: InHistory[] = [];
  let firstChatIdx = -1;
  let chatHistoryCount = 0;
  let hasWiBefore = false;
  let hasWiAfter = false;
  const blocks = preset.blocks.some((b) => b.marker === "chat_history") ? preset.blocks : [...preset.blocks, { id: "", name: "Chat History", role: "system" as const, content: "", marker: "chat_history" as const }];
  // Lore pinned beside a marker block, by the marker's id and the side (`pinnedByMarker`, `:3092-3106`). The "after" ones of a block are put in
  // at the top of the next turn of the loop, so they follow all that the block put in, and the last block's after the loop.
  const pinnedBy = (marker: string, side: "before" | "after"): PinnedLore[] => lore.pinned.filter((p) => p.marker === marker && p.side === side);
  let pendingPinnedAfter: PinnedLore[] | null = null;
  // The "at marker" pool, joined by a blank line (`:3034-3041`).
  const pool = lore.atMarker.map((e) => e.content).join("\n\n");
  // The assembly loop (`services/prompt-assembly.service.ts:3110-3664`), block by block in the preset's order.
  for (const block of blocks) {
    if (pendingPinnedAfter !== null) {
      pushPinned(prompt, breakdown, pendingPinnedAfter);
      pendingPinnedAfter = null;
    }
    // A second World Info marker of one kind is skipped (`:3147-3148`), before any lore is pinned beside it.
    if ((block.marker === "world_info_before" && hasWiBefore) || (block.marker === "world_info_after" && hasWiAfter)) continue;
    if (block.marker !== undefined) {
      pushPinned(prompt, breakdown, pinnedBy(block.marker, "before"));
      const after = pinnedBy(block.marker, "after");
      if (after.length > 0) pendingPinnedAfter = after;
    }
    if (block.marker === "chat_history") {
      // The chat's history (`:3236-3463`): its visible messages, each flagged with its id and number, then queued sends joined before
      // anything is spliced into it. Its breakdown entry is pushed with the count before the join, and read again at the end.
      firstChatIdx = prompt.length;
      let count = 0;
      for (const m of messages) {
        if (m.hidden) continue;
        const content: string | LlmPart[] = m.images ? [{ type: "text", text: m.content }, ...m.images.map((i) => ({ type: "image" as const, ...i }))] : m.content;
        prompt.push({ role: m.role, content, __chatHistorySource: true, __sourceMessageId: m.id, __sourceIndexInChat: indexInChat(m) });
        count++;
      }
      breakdown.push({ type: "chat_history", name: "Chat History", messageCount: count, firstMessageIndex: firstChatIdx });
      chatHistoryCount = mergeQueuedUserMessages(prompt, firstChatIdx, count);
      continue;
    }
    if (block.marker === "world_info_before" || block.marker === "world_info_after") {
      // A World Info marker (`:3491-3561`): its position's lore here, each entry a flagged message in the marker's role, or spliced
      // into the history where the marker is placed there; named by the position and its label, with no block id.
      const before = block.marker === "world_info_before";
      if (before) hasWiBefore = true;
      else hasWiAfter = true;
      for (const entry of before ? lore.before : lore.after) {
        const name = `${before ? "World Info Before" : "World Info After"}: ${entry.label}`;
        if (block.depth !== undefined) pending.push({ role: block.role, depth: Math.max(0, block.depth), content: entry.content, name, blockId: block.id, worldInfo: true });
        else {
          prompt.push({ role: block.role, content: entry.content, __worldInfoSource: true });
          breakdown.push({ type: "world_info", name, role: block.role, content: entry.content });
        }
      }
      continue;
    }
    // A block's own text (`:3600-3663`): its `{{wi_marker}}` taking the "at marker" lore and its `{{outlet::name}}` an outlet's text (`:3034-3041`),
    // lore inside the block's text with no flag of its own; runs of blank lines folded and the ends trimmed, and a block left with no text not sent
    // (`:3638-3663`). One that expands the pool counts only its wrapper, the text with an empty pool (`evaluatePromptBlockTokenCountContent`, `:1500-1515`).
    const content = normalizeBlockText(expandMacros(block.content, lore.outlets, pool));
    if (content === "") continue;
    const usesPool = WI_MARKER_USED.test(block.content);
    const tokenCountContent = usesPool ? normalizeBlockText(expandMacros(block.content, lore.outlets, "")) : undefined;
    if (block.depth !== undefined) pending.push({ role: block.role, depth: Math.max(0, block.depth), content, ...(usesPool ? { tokenCountContent, attributesWorldInfoMarkerTokens: true } : {}), name: block.name, blockId: block.id, worldInfo: false });
    else {
      prompt.push({ role: block.role, content });
      breakdown.push({ type: "block", name: block.name, role: block.role, content, ...(usesPool ? { tokenCountContent, attributesWorldInfoMarkerTokens: true } : {}), blockId: block.id });
    }
  }
  // The final block's lore pinned after it.
  if (pendingPinnedAfter !== null) pushPinned(prompt, breakdown, pendingPinnedAfter);
  // Lore of a position with no marker in the preset (`:3728-3756`): "before" just before the history, "after" just after it, 2 and 3 and 5 and 6 around
  // its first message, 4 at its depth from the end, then what an interceptor placed in the history (`:3759-3836`), each named by the position and its label.
  // Each position reads the history's first place as the ones before it left it: only "before" and the "AN before" entries move it.
  if (!hasWiBefore && lore.before.length > 0) firstChatIdx += injectLoreAt(prompt, breakdown, lore.before, firstChatIdx, "World Info Before (auto)");
  if (!hasWiAfter && lore.after.length > 0) injectLoreAt(prompt, breakdown, lore.after, firstChatIdx + chatHistoryCount, "World Info After (auto)");
  if (lore.anBefore.length > 0) firstChatIdx += injectLoreAt(prompt, breakdown, lore.anBefore, firstChatIdx, "WI AN Before");
  if (lore.anAfter.length > 0) injectLoreAt(prompt, breakdown, lore.anAfter, firstChatIdx + 1, "WI AN After");
  if (lore.emBefore.length > 0) injectLoreAt(prompt, breakdown, lore.emBefore, firstChatIdx, "WI EM Before");
  if (lore.emAfter.length > 0) injectLoreAt(prompt, breakdown, lore.emAfter, firstChatIdx + 1, "WI EM After");
  for (const e of lore.depth) {
    prompt.splice(Math.max(0, prompt.length - e.depth), 0, { role: e.role, content: e.content, __worldInfoSource: true });
    breakdown.push({ type: "world_info", name: `WI Depth ${e.depth}: ${e.label}`, role: e.role, content: e.content });
  }
  insertRuntime(prompt, lore.runtime, firstChatIdx);
  for (const e of lore.runtime) breakdown.push({ type: "world_info", name: `WI Chat Depth ${e.placement.direction} ${e.placement.depth}: ${e.label}`, role: e.placement.role, content: e.content });
  // The "at marker" lore, named in the breakdown, its tokens counted in the block that holds it (`:3838-3847`).
  for (const e of lore.atMarker) breakdown.push({ type: "world_info", name: `WI At Marker: ${e.label}`, role: e.role, content: e.content, marker: "wi_marker", excludeFromTotal: true });
  // In-history blocks and markers spliced in, then named (`:3881-3902`).
  insertIntoHistory(prompt, pending);
  for (const p of pending) {
    if (p.worldInfo) breakdown.push({ type: "world_info", name: p.name, role: p.role, content: p.content });
    else breakdown.push({ type: "block", name: p.name, role: p.role, content: p.content, ...(p.attributesWorldInfoMarkerTokens === true ? { tokenCountContent: p.tokenCountContent, attributesWorldInfoMarkerTokens: true } : {}), blockId: p.blockId });
  }
  // A block that expanded the pool counts only its wrapper, so the pool's rows count (`attributeExpandedMarkerWorldInfoTokens`, `:1522-1533`); the
  // exclusion stays where the macro was in no block that was sent.
  if (breakdown.some((e) => e.attributesWorldInfoMarkerTokens === true)) for (const e of breakdown) if (e.type === "world_info" && e.marker === "wi_marker") delete e.excludeFromTotal;
  // A continue's nudge, without "Continue prefill" (`services/prompt-assembly.service.ts:3987-4008`): marked, so that it is moved to stand
  // after the continued message below.
  if (ending.type === "continue" && preset.continuePrefill !== true) {
    const nudge = preset.continueNudge ?? CONTINUE_NUDGE;
    if (nudge !== "") {
      prompt.push({ role: "system", content: nudge, __continueNudge: true });
      breakdown.push({ type: "utility", name: "Continue Nudge", role: "system", content: nudge });
    }
  }
  // The prefill (`services/prompt-assembly.service.ts:4120-4198`): the user's "Start Reply With", unless it is blank, then the preset's
  // start, as one partial assistant message, and nothing at all when both are empty. A continue has none: its own message is the reply
  // it goes on with. An impersonation has one only with "Continue prefill" on, the preset's impersonation start where it sets one. The
  // stand-in resolves no macros in them, and its connections are custom ones, which take no reasoning prefill (`:4164-4181`).
  const startsReply = ending.type !== "impersonate" || preset.continuePrefill === true;
  const prefill: string[] = [];
  if (startsReply && ending.type !== "continue" && ending.promptBias.trim() !== "") prefill.push(ending.promptBias);
  const presetStart = ending.type === "continue" || !startsReply ? "" : ending.type === "impersonate" && preset.assistantImpersonation ? preset.assistantImpersonation : (preset.assistantPrefill ?? "");
  if (presetStart !== "") prefill.push(presetStart);
  if (prefill.length > 0) {
    const text = prefill.join("");
    prompt.push({ role: "assistant", content: text, partial: true });
    breakdown.push({ type: "utility", name: "Assistant Prefill", role: "assistant", content: text });
  }
  // The preset's completion settings, over the whole prompt before any interceptor sees it (`:4210`).
  applyCompletionSettings(prompt, preset, ending.names);
  // `finalizeContinuePrompt` (`:742-775`, called at `:4314-4338`): the continued message, the newest assistant history message with the
  // continued message's id (or the newest of all, where Lumiverse found none), leaves the history: the postfix is appended, it is a
  // partial reply with "Continue prefill" on, it loses its history mark and keeps its other keys, its source among them, and it goes
  // last, the nudge after it. Where it is not in the history (hidden, or no assistant's), nothing moves.
  if (ending.type === "continue") {
    let at = -1;
    for (let i = prompt.length - 1; i >= 0; i--) {
      const m = prompt[i]!;
      if (m.role !== "assistant" || m.__chatHistorySource !== true) continue;
      if (ending.continueMessageId !== undefined && m.__sourceMessageId !== ending.continueMessageId) continue;
      at = i;
      break;
    }
    if (at >= 0) {
      const [found] = prompt.splice(at, 1);
      const moved: LlmMessage = { ...withText(found!, ending.continuePostfix ?? ""), ...(preset.continuePrefill === true ? { partial: true } : {}) };
      delete moved.__chatHistorySource;
      delete moved.__contextAnchorProtected;
      prompt.push(moved);
      const nudge = prompt.findIndex((m) => m.__continueNudge === true);
      if (nudge >= 0) prompt.push(...prompt.splice(nudge, 1));
      breakdown.push({ type: "utility", name: "Continue Target", role: "assistant", content: textOf(moved) });
    }
  }
  // The chat history's bounds read again from where its messages ended up (`:4415-4442`).
  const historyEntry = breakdown.find((e) => e.type === "chat_history");
  if (historyEntry !== undefined) {
    const first = prompt.findIndex((m) => m.__chatHistorySource === true);
    historyEntry.firstMessageIndex = first >= 0 ? first : undefined;
    historyEntry.messageCount = prompt.filter((m) => m.__chatHistorySource === true).length;
  }
  return { prompt, breakdown };
}
