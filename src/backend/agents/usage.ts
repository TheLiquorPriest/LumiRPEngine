// Token usage per agent call (AGENT-LOOP-PLAN §3.2; INC1-SPEC R1): what a call sent (and how much
// of it the provider read from its cache) and what it wrote (and how much of that was reasoning),
// read per provider from the usage Lumiverse passes on, the provider's own fields in
// `provider_raw`. A count a provider never reports is the runtime's estimate, flagged as one: the
// host passes no cached count for Gemini or OpenAI's Responses API, and Anthropic bills thinking
// as output without saying how much.

import type { JsonObject } from "../../shared/json";
import { isRecord } from "../../shared/json";
import { tokensOf } from "../book";
import type { QuietMessage, QuietTool } from "../host";

export type UsageField = "in" | "cachedIn" | "out" | "reasoningOut";

/** One call's tokens: `in` (of which `cachedIn` read from the cache) and `out` (of which `reasoningOut` reasoning). */
export interface CallUsage {
  in: number;
  cachedIn: number;
  out: number;
  reasoningOut: number;
  /** The counts the provider didn't report, which hold the runtime's estimate. */
  estimated: UsageField[];
}

/** The runtime's own estimate of a call, for whatever its provider doesn't report: the prompt, the answer and its reasoning. */
export interface UsageEstimate {
  in: number;
  out: number;
  reasoningOut: number;
}

/** A message's text as the estimate counts it: its text, or each part's text, call and result. */
function messageText(m: QuietMessage): string {
  if (!m.parts) return m.content;
  return m.parts.map((p) => (p.type === "text" ? p.text : p.type === "tool_use" ? `${p.name} ${JSON.stringify(p.input)}` : p.content)).join("\n");
}

/** A call's prompt as estimated before it is sent: every message, and each tool's name, description and schema. */
export function promptTokens(messages: readonly QuietMessage[], tools: readonly QuietTool[]): number {
  let tokens = 0;
  for (const m of messages) tokens += tokensOf(messageText(m));
  for (const t of tools) tokens += tokensOf(`${t.name} ${t.description} ${JSON.stringify(t.parameters)}`);
  return tokens;
}

/** A reported count: a finite number of zero or more, else none. */
function count(o: unknown, key: string): number | undefined {
  if (!isRecord(o)) return undefined;
  const v = o[key];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/**
 * A call's usage from the host's `usage` (`prompt_tokens`, `completion_tokens`, `total_tokens`,
 * and the provider's own in `provider_raw`) by its connection's provider; `estimate` fills each
 * count it lacks, listed in `estimated`.
 * - Anthropic: `input_tokens` leaves out what was read from the cache and written to it, which the
 *   host's prompt tokens add back; `cache_read_input_tokens` is the cached part. Thinking is billed
 *   as output and never reported apart, so the reasoning is always an estimate.
 * - Gemini (Google, Vertex): the host passes the prompt and candidate counts and the total, which
 *   also holds the thoughts, so the thoughts are the rest; it passes no cached count.
 * - Everything else is OpenAI-compatible: the provider's usage object whole, its cached tokens under
 *   `prompt_tokens_details.cached_tokens` (DeepSeek: `prompt_cache_hit_tokens`; some routers
 *   `cache_read_input_tokens` or `cached_tokens`) and its reasoning under
 *   `completion_tokens_details.reasoning_tokens`. OpenAI's own Responses route passes only the two
 *   counts.
 */
export function parseUsage(raw: JsonObject | undefined, provider: string | null, estimate: UsageEstimate): CallUsage {
  const estimated: UsageField[] = [];
  const guess = (field: UsageField, value: number): number => {
    estimated.push(field);
    return value;
  };
  const prompt = count(raw, "prompt_tokens");
  const completion = count(raw, "completion_tokens");
  const own = raw && isRecord(raw.provider_raw) ? raw.provider_raw : {};
  if (provider === "anthropic") {
    const fresh = count(own, "input_tokens");
    const read = count(own, "cache_read_input_tokens");
    const sent = prompt ?? (fresh === undefined ? undefined : fresh + (read ?? 0) + (count(own, "cache_creation_input_tokens") ?? 0));
    const out = count(own, "output_tokens") ?? completion;
    return { in: sent ?? guess("in", estimate.in), cachedIn: read ?? guess("cachedIn", 0), out: out ?? guess("out", estimate.out + estimate.reasoningOut), reasoningOut: guess("reasoningOut", estimate.reasoningOut), estimated };
  }
  if (provider === "google" || provider === "google_vertex") {
    const total = count(raw, "total_tokens");
    const thoughts = total !== undefined && prompt !== undefined && completion !== undefined ? Math.max(0, total - prompt - completion) : undefined;
    return {
      in: prompt ?? guess("in", estimate.in),
      cachedIn: guess("cachedIn", 0),
      out: completion !== undefined ? completion + (thoughts ?? 0) : guess("out", estimate.out + estimate.reasoningOut),
      reasoningOut: thoughts ?? guess("reasoningOut", estimate.reasoningOut),
      estimated,
    };
  }
  const promptDetails = isRecord(own.prompt_tokens_details) ? own.prompt_tokens_details : {};
  const completionDetails = isRecord(own.completion_tokens_details) ? own.completion_tokens_details : {};
  const cached = count(promptDetails, "cached_tokens") ?? count(own, "prompt_cache_hit_tokens") ?? count(own, "cache_read_input_tokens") ?? count(own, "cached_tokens");
  const reasoning = count(completionDetails, "reasoning_tokens") ?? count(own, "reasoning_tokens");
  return {
    in: prompt ?? guess("in", estimate.in),
    cachedIn: cached ?? guess("cachedIn", 0),
    out: completion ?? guess("out", estimate.out + estimate.reasoningOut),
    reasoningOut: reasoning ?? guess("reasoningOut", estimate.reasoningOut),
    estimated,
  };
}

/** An agent's usage so far, or one send's: its calls and tool rounds, its tokens, and how long its calls took. */
export interface AgentUsage {
  calls: number;
  toolTurns: number;
  in: number;
  cachedIn: number;
  out: number;
  reasoningOut: number;
  /** Some of the counts are the runtime's estimate. */
  estimated: boolean;
  ms: number;
}

export function emptyUsage(): AgentUsage {
  return { calls: 0, toolTurns: 0, in: 0, cachedIn: 0, out: 0, reasoningOut: 0, estimated: false, ms: 0 };
}

/** Adds one call's usage to each tally. */
export function addCall(call: CallUsage, ms: number, ...tallies: AgentUsage[]): void {
  for (const t of tallies) {
    t.calls += 1;
    t.in += call.in;
    t.cachedIn += call.cachedIn;
    t.out += call.out;
    t.reasoningOut += call.reasoningOut;
    t.estimated ||= call.estimated.length > 0;
    t.ms += ms;
  }
}
