// Lumiverse's steps on a reply's text before it is saved, copied from its source (staging at a70f4ed2; paths are Lumiverse's `src/`): the thinking a model puts in
// delimiters moved out of the reply, the half word at the end of a stream trimmed, the response scripts, the macros of the saved message, and what a stopped or failed
// reply closes and keeps. The scripts and the macros are the stand-in's own small set: a script is one regular expression and its replacement, and a macro is one of
// `{{user}}`, `{{char}}` and `{{newline}}`. Lumiverse's own healing of formatting (`utils/format-healing.ts`) is not modelled.

/** The delimiters of thinking a model writes in its reply (`utils/reasoning-strip.ts:5-8`, `:90-95`). */
export interface ReasoningDelimiters {
  prefix: string;
  suffix: string;
}

const TRAILING_NEWLINE_RUN_RE = /(?:\n[ \t\f\v]*)+$/;
const LEADING_NEWLINE_RUN_RE = /^(?:[ \t\f\v]*\n)+/;

const countNewlines = (value: string): number => value.match(/\n/g)?.length ?? 0;
const hasVisibleText = (value: string): boolean => /\S/.test(value);

/** `joinContentAroundExtractedReasoning` (`utils/reasoning-strip.ts:30-58`). */
function joinAround(before: string, after: string): string {
  const beforeMatch = before.match(TRAILING_NEWLINE_RUN_RE);
  const afterMatch = after.match(LEADING_NEWLINE_RUN_RE);
  if (!beforeMatch && !afterMatch) return before + after;
  const beforeBody = beforeMatch ? before.slice(0, before.length - beforeMatch[0].length) : before;
  const afterBody = afterMatch ? after.slice(afterMatch[0].length) : after;
  const visibleBefore = hasVisibleText(beforeBody);
  const visibleAfter = hasVisibleText(afterBody);
  if (beforeMatch && afterMatch) return beforeBody + "\n".repeat(visibleBefore && visibleAfter ? Math.max(countNewlines(beforeMatch[0]), countNewlines(afterMatch[0])) : 0) + afterBody;
  if (beforeMatch && !visibleAfter) return beforeBody;
  if (afterMatch && !visibleBefore) return afterBody;
  return before + after;
}

/** `resolveReasoningDelimiters` (`utils/reasoning-strip.ts:84-95`): the user's `reasoningSettings`, `<think>` where it sets none, a newline at either end dropped. */
export function resolveReasoningDelimiters(value?: { prefix?: unknown; suffix?: unknown } | null): ReasoningDelimiters {
  const normal = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback).replace(/^\n+|\n+$/g, "");
  return { prefix: normal(value?.prefix, "<think>\n"), suffix: normal(value?.suffix, "\n</think>") };
}

/** `extractDelimitedReasoning` (`utils/reasoning-strip.ts:109-135`): every delimited stretch moved out of the text, an unclosed one to its end. */
export function extractDelimitedReasoning(content: string, d: ReasoningDelimiters): { cleaned: string; reasoning: string } {
  if (!content || !d.prefix || !d.suffix || !content.includes(d.prefix)) return { cleaned: content, reasoning: "" };
  let cleaned = content;
  let reasoning = "";
  let at = cleaned.indexOf(d.prefix);
  while (at !== -1) {
    const end = cleaned.indexOf(d.suffix, at + d.prefix.length);
    if (end !== -1) {
      reasoning += cleaned.slice(at + d.prefix.length, end);
      cleaned = joinAround(cleaned.slice(0, at), cleaned.slice(end + d.suffix.length));
    } else {
      reasoning += cleaned.slice(at + d.prefix.length);
      cleaned = joinAround(cleaned.slice(0, at), "");
      break;
    }
    at = cleaned.indexOf(d.prefix);
  }
  return { cleaned, reasoning };
}

/** `closeUnterminatedDelimitedReasoning` (`utils/reasoning-strip.ts:101-107`): a last opening with no closing after it is closed. */
export function closeUnterminatedDelimitedReasoning(content: string, d: ReasoningDelimiters): string {
  if (!content || !d.prefix || !d.suffix) return content;
  const open = content.lastIndexOf(d.prefix);
  if (open === -1) return content;
  return content.indexOf(d.suffix, open + d.prefix.length) === -1 ? content + d.suffix : content;
}

/** `trimIncompleteTrailingWord` (`utils/trim-incomplete-word.ts`): a stream that ends on a word loses it; a space or punctuation at its end is a finished one. */
export function trimIncompleteTrailingWord(content: string): string {
  if (!content || /\s$/u.test(content)) return content;
  if (!/[\p{L}\p{N}\p{M}]$/u.test(content)) return content;
  const segments = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(content)];
  const last = segments.at(-1);
  if (last?.isWordLike && last.index + last.segment.length === content.length) return content.slice(0, last.index).trimEnd();
  return content.replace(/[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M}'’_-]*$/u, "").trimEnd();
}

/** One response script of the stand-in's own: a regular expression and what replaces it, on the reply (`ai_output`) or on its thinking (`reasoning`). */
export interface ResponseScript {
  find: string;
  flags?: string;
  replace: string;
  on?: "content" | "reasoning";
}

/** What the text steps read of the user's settings and the preset (`services/generate.service.ts:3447-3459`, `:4084-4116`). */
export interface TextSettings {
  /** The user's `reasoningSettings`: whether delimited thinking is moved out of the reply, and its delimiters. */
  cot: { autoParse: boolean; delimiters: ReasoningDelimiters };
  /** The preset's trimming of a stream's incomplete last word (`trimIncompleteWords`), which only a streamed reply meets. */
  trim: boolean;
  scripts: readonly ResponseScript[];
}

/** `processResponseText` (`services/generation/response-processing.ts:19-31`): the scripts on the reply, and on its thinking where it has any. */
function runScripts(content: string, reasoning: string, scripts: readonly ResponseScript[]): { content: string; reasoning: string } {
  const apply = (text: string, on: "content" | "reasoning"): string => scripts.filter((s) => (s.on ?? "content") === on).reduce((t, s) => t.replace(new RegExp(s.find, s.flags ?? "g"), s.replace), text);
  return { content: apply(content, "content"), reasoning: reasoning === "" ? reasoning : apply(reasoning, "reasoning") };
}

/**
 * What a reply that ended well is saved as (`services/generate.service.ts:4065-4116`): the thinking its delimiters mark moved out of the reply and put after the model's own
 * (`:4073-4085`), the half word at the end of a streamed reply trimmed, the authored prefill in front of it kept (`:3717-3722`, `:4092-4094`), then the scripts.
 * `content` holds the prefill and the model's text; `prefill` is the part of it that is authored.
 */
export function finishedText(from: { content: string; reasoning: string; prefill: string; streamed: boolean }, s: TextSettings): { content: string; reasoning: string; delimited: boolean } {
  let { content, reasoning } = from;
  let delimited = false;
  // What of the prefill is left as reply once the delimiters have taken their part of it: the length the trim leaves alone (`:3717-3722`).
  const kept = (s.cot.autoParse ? extractDelimitedReasoning(from.prefill, s.cot.delimiters).cleaned : from.prefill).length;
  if (s.cot.autoParse) {
    const extracted = extractDelimitedReasoning(content, s.cot.delimiters);
    if (extracted.reasoning) {
      delimited = true;
      content = extracted.cleaned;
      reasoning = (reasoning ? `${reasoning}\n` : "") + extracted.reasoning;
    }
  }
  if (from.streamed && s.trim) content = content.slice(0, kept) + trimIncompleteTrailingWord(content.slice(kept));
  return { ...runScripts(content, reasoning, s.scripts), delimited };
}

/**
 * What a reply that was stopped or failed is saved as (`persistPartialContent`, `services/generate.service.ts:3565-3600`): an opening of thinking with no closing is closed
 * (`:3570`), the half word trimmed, the scripts run. Lumiverse's stream has already moved delimited thinking out of the text as it came, so the stand-in does here
 * what its stream would have done: the delimited stretches go to the thinking.
 */
export function partialText(from: { content: string; reasoning: string; prefill: string; streamed: boolean }, s: TextSettings): { content: string; reasoning: string } {
  let { content, reasoning } = from;
  const kept = (s.cot.autoParse ? extractDelimitedReasoning(from.prefill, s.cot.delimiters).cleaned : from.prefill).length;
  if (s.cot.autoParse) {
    const extracted = extractDelimitedReasoning(closeUnterminatedDelimitedReasoning(content, s.cot.delimiters), s.cot.delimiters);
    if (extracted.reasoning) {
      content = extracted.cleaned;
      reasoning = (reasoning ? `${reasoning}\n` : "") + extracted.reasoning;
    }
  }
  if (from.streamed && s.trim) content = content.slice(0, kept) + trimIncompleteTrailingWord(content.slice(kept));
  return runScripts(content, reasoning, s.scripts);
}

/** The macros of the stand-in's own small set, resolved in a saved reply (`resolveMessageMacroContent`, `services/generate.service.ts:4227-4247`). */
export function resolveMacros(text: string, names: { user: string; char: string }): string {
  return text.replace(/\{\{\s*user\s*\}\}/gi, names.user).replace(/\{\{\s*char\s*\}\}/gi, names.char).replace(/\{\{\s*newline\s*\}\}/gi, "\n");
}
