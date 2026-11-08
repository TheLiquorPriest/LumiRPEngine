// An OpenAI-compatible request body, as core's Custom connection posts it (DEPTH-PLAN F4), read as a
// quiet call on the user's own connection: its messages (tool calls and tool results included), its
// tools and `tool_choice`, its sampling parameters and answer room. And where a loopback turn's
// sections go in a prompt (§3.12): for that prompt alone, the World Info interceptor gives each engine
// entry the turn fills a mark of its own as its text (`LoopbackBridge.marked`), so core places the
// mark wherever it places the entry: at a chat depth, before the character, or at a preset's
// `{{outlet::lre_<slot>}}` inside its block. The narrator's prompt puts each section in its entry's
// mark (`fillMarks`); a section whose mark the prompt doesn't hold (World Info's budget left it out,
// or the turn's book was made after the prompt) goes where today's book would have put it: at its
// chat depth inside the history span, counted from the latest message, else in one system message
// just before the history span. A chat that isn't on depth narrates from the final body so placed,
// its history whole (`withSections`); one on depth from its short context (`short-context.ts`).

import type { JsonObject, JsonValue } from "../../shared/json";
import { isRecord } from "../../shared/json";
import type { LoopbackToolCall } from "../../shared/loopback";
import type { SamplingParams } from "../../shared/settings";
import type { DepthNarratorSampling } from "../../shared/depth-settings";
import type { QuietMessage, QuietPart, QuietTool, QuietToolCall, WorldInfoCandidate } from "../host";
import { sortEntries } from "../book";
import { NARRATOR_OUTLET, outletOf } from "../preset-binding";

/** A message part's text: a string as it is, a list of parts as its text parts joined (images and audio don't reach a quiet call). */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((p) => (isRecord(p) && (p.type === "text" || p.type === "input_text") && typeof p.text === "string" ? p.text : "")).join("");
}

/** A tool call's arguments as an object: OpenAI sends them as JSON text. */
function argsOf(raw: unknown): JsonObject {
  if (isRecord(raw)) return raw as JsonObject;
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? (parsed as JsonObject) : {};
  } catch {
    return {};
  }
}

/**
 * The body's messages as quiet-call messages: system (and `developer`) messages as system, an
 * assistant's tool calls as its `tool_use` parts and its `reasoning_content` as its reasoning, and
 * each run of tool results as one user message of `tool_result` parts, as the host's providers take
 * them back.
 */
export function quietMessages(raw: unknown): QuietMessage[] {
  const out: QuietMessage[] = [];
  for (const m of Array.isArray(raw) ? raw : []) {
    if (!isRecord(m)) continue;
    const text = textOf(m.content);
    if (m.role === "tool") {
      const part: QuietPart = { type: "tool_result", toolUseId: typeof m.tool_call_id === "string" ? m.tool_call_id : "", content: text };
      const last = out.at(-1);
      if (last?.role === "user" && last.parts !== undefined && last.parts.every((p) => p.type === "tool_result")) {
        last.parts.push(part);
        last.content = `${last.content}\n${text}`;
      } else out.push({ role: "user", content: text, parts: [part] });
      continue;
    }
    if (m.role === "assistant") {
      const reasoning = typeof m.reasoning_content === "string" && m.reasoning_content !== "" ? m.reasoning_content : undefined;
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls.filter(isRecord) : [];
      const parts: QuietPart[] = calls.map((c, i) => {
        const fn = isRecord(c.function) ? c.function : {};
        return { type: "tool_use", id: typeof c.id === "string" ? c.id : `call_${i}`, name: typeof fn.name === "string" ? fn.name : "", input: argsOf(fn.arguments) };
      });
      out.push({ role: "assistant", content: text, ...(parts.length > 0 ? { parts: [...(text !== "" ? [{ type: "text" as const, text }] : []), ...parts] } : {}), ...(reasoning ? { reasoning } : {}) });
      continue;
    }
    out.push({ role: m.role === "system" || m.role === "developer" ? "system" : "user", content: text });
  }
  return out;
}

/** The body's tools (`[{type: "function", function: {name, description, parameters}}]`) as a quiet call offers them. */
export function quietTools(raw: unknown): QuietTool[] {
  return (Array.isArray(raw) ? raw : []).flatMap((t): QuietTool[] => {
    if (!isRecord(t)) return [];
    const fn = isRecord(t.function) ? t.function : t;
    if (typeof fn.name !== "string" || fn.name === "") return [];
    return [{ name: fn.name, description: typeof fn.description === "string" ? fn.description : "", parameters: isRecord(fn.parameters) ? (fn.parameters as JsonObject) : { type: "object", properties: {} } }];
  });
}

const SAMPLING_KEYS = ["temperature", "top_p", "top_k", "frequency_penalty", "presence_penalty"] as const satisfies readonly (keyof SamplingParams)[];

/** The body's sampling parameters, as the preset set them (DEPTH-PLAN §3.13). */
export function samplingOf(body: JsonObject): SamplingParams {
  const out: SamplingParams = {};
  for (const key of SAMPLING_KEYS) {
    const v = body[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

/** The answer room the body asks for; null when it names none. */
export function maxTokensOf(body: JsonObject): number | null {
  const v = body.max_tokens ?? body.max_completion_tokens;
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
}

/**
 * The narrator's sampling (DEPTH-PLAN §3.13): the preset's from the body, with each one the Narrator
 * row sets (Settings → Depth → Narrator) over it; and its answer room, the row's own, else the
 * body's, else null (the narrator's model's). One reading for a scene's narrator and one no scene plays.
 */
export function narratorSampling(body: JsonObject, own: Readonly<DepthNarratorSampling>): { params: SamplingParams; maxTokens: number | null } {
  return {
    params: { ...samplingOf(body), ...(own.temperature !== null ? { temperature: own.temperature } : {}), ...(own.topP !== null ? { top_p: own.topP } : {}) },
    maxTokens: own.maxTokens ?? maxTokensOf(body),
  };
}

/** The body's `tool_choice`, passed on only with tools to choose from. */
export function toolChoiceOf(body: JsonObject): JsonValue | undefined {
  return Array.isArray(body.tools) && body.tools.length > 0 && body.tool_choice !== undefined ? body.tool_choice : undefined;
}

/** A model's tool calls as OpenAI streams them: each whole, at its index. */
export function toolCallChunks(calls: readonly QuietToolCall[]): LoopbackToolCall[] {
  return calls.map((c, index) => ({ index, id: c.callId, name: c.name, arguments: JSON.stringify(c.args) }));
}

/** What the turn tagger saw of the assembled prompt (DEPTH-PLAN §3.5): how many messages, which came from the chat's history, and the first and last of those. */
export interface PromptShape {
  count: number;
  history: number[];
  first: string | null;
  last: string | null;
}

/** Where the chat's history runs in the final body, `start` to `end` (exclusive); null when none can be found. */
export function historySpan(messages: readonly QuietMessage[], shape: PromptShape | null): { start: number; end: number } | null {
  // Unchanged since the tagger saw it (no post-processing merged messages): its own indices.
  if (shape && shape.history.length > 0 && shape.count === messages.length) return { start: Math.min(...shape.history), end: Math.max(...shape.history) + 1 };
  // Else by the first and last history message's text.
  if (shape?.first != null && shape.last != null) {
    const start = messages.findIndex((m) => m.content === shape.first);
    const end = messages.findLastIndex((m) => m.content === shape.last);
    if (start >= 0 && end >= start) return { start, end: end + 1 };
  }
  // Else the chat's turns at the end: the last run of user and assistant messages.
  const end = messages.findLastIndex((m) => m.role !== "system") + 1;
  if (end === 0) return null;
  let start = end - 1;
  while (start > 0 && messages[start - 1]?.role !== "system") start--;
  return { start, end };
}

/** A section of today's engine for a loopback turn: the book entry it fills, and where today's book would put it. */
export interface PlacedSection {
  label: string;
  text: string;
  /** The engine-book entry the turn fills with it: its mark in a prompt shows where core placed it. */
  entry: string;
  /** At a chat depth (counted from the latest message) with its role, or with the others before the history. */
  at: { depth: number; role: "system" | "user" | "assistant" } | "front";
}

/** A mark's opening, which no text of a prompt holds but a mark. */
const MARK_OPEN = "⟦LumiRPEngine:";
const MARK = /⟦LumiRPEngine:([^⟧\s]*)⟧/g;

/** The text an engine entry holds in a loopback turn's prompt: unique to the entry, so core's World Info dedup keeps each, and free of macros, so it reaches the prompt as written. */
export function markOf(entry: string): string {
  return `${MARK_OPEN}${entry}⟧`;
}

/**
 * The engine entries a loopback turn fills, among a prompt's World Info candidates, chosen as the
 * engine run chooses them (`Runtime.deliver`): each section's outlet twin where an assembled block of
 * the preset holds its `{{outlet::lre_<slot>}}` (`outlets`), else the section's own entry; the
 * narrator rules' twin at `{{outlet::lre_narrator}}`, else their own entry.
 */
export function turnEntries(entries: readonly Pick<WorldInfoCandidate, "id" | "extensions">[], outlets: ReadonlySet<string>): string[] {
  const { found } = sortEntries(entries);
  const ids = [...found.slots].map(([slot, id]) => (outlets.has(outletOf(slot)) ? (found.twins.get(slot) ?? id) : id));
  const rules = found.narratorOutlet !== null && outlets.has(NARRATOR_OUTLET) ? found.narratorOutlet : found.narrator;
  return rules !== null ? [...ids, rules] : ids;
}

/**
 * The messages with each mark replaced by the text of the section that fills its entry, and the mark
 * of an entry no section fills taken out with the blank lines it leaves; a message that held nothing
 * but marks is dropped. `found`: the entries whose mark the messages held.
 */
export function fillMarks<M extends { content: string }>(messages: readonly M[], sections: readonly PlacedSection[]): { messages: M[]; found: Set<string> } {
  const texts = new Map(sections.map((s) => [s.entry, s.text]));
  const found = new Set<string>();
  const out: M[] = [];
  for (const m of messages) {
    if (!m.content.includes(MARK_OPEN)) {
      out.push(m);
      continue;
    }
    let emptied = false;
    let content = m.content.replace(MARK, (_whole, entry: string) => {
      found.add(entry);
      const text = texts.get(entry);
      if (text === undefined) emptied = true;
      return text ?? "";
    });
    if (emptied) content = content.replace(/\n{3,}/g, "\n\n").trim();
    if (content.trim() !== "") out.push({ ...m, content });
  }
  return { messages: out, found };
}

/** The narrator's prompt on a chat that isn't on depth: the final body, its sections in their marks, and the others placed as today's book would have placed them (see the header). */
export function withSections(messages: readonly QuietMessage[], shape: PromptShape | null, sections: readonly PlacedSection[]): QuietMessage[] {
  const filled = fillMarks(messages, sections);
  const out = filled.messages;
  const rest = sections.filter((s) => !filled.found.has(s.entry));
  const span = historySpan(out, shape);
  const start = span?.start ?? Math.max(0, out.findLastIndex((m) => m.role === "user"));
  const end = span?.end ?? out.length;
  const front = rest.filter((s) => s.at === "front").map((s) => s.text);
  const inserts = rest.flatMap((s, order) => (s.at === "front" ? [] : [{ at: Math.max(start, end - Math.max(0, s.at.depth)), message: { role: s.at.role, content: s.text } satisfies QuietMessage, order }]));
  if (front.length > 0) inserts.push({ at: start, message: { role: "system", content: front.join("\n\n") }, order: -1 });
  // Last place first, so each splice leaves the places before it as they were; at one place, in order.
  inserts.sort((a, b) => b.at - a.at || b.order - a.order);
  for (const i of inserts) out.splice(i.at, 0, i.message);
  return out;
}
