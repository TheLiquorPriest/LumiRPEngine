// How Lumiverse's Custom (OpenAI-compatible) provider reads an answer, from origin/staging 8e0f3945:
// openai-compatible.ts's generateStream loop and generate's parse (with splitMirroredReasoning), and
// generation-stop.ts's describeGenerationStop. The logic is core's, line for line, around a Response
// instead of its fetch, typed where core reads `any`; left out are the request observer, the
// response-activity callback and OpenRouter's reasoning_details, which the loopback never sends.

import { incompleteStream, readProviderSse, throwIfProviderError } from "./provider-sse";

const DISPLAY = "Custom (OpenAI-compatible)";

interface GenerationStopDetails {
  type: string;
  category?: string;
  explanation?: string;
}

/** A completed transport can still contain a truncated or blocked generation. */
export function describeGenerationStop(reason: string | undefined, details?: GenerationStopDetails | null): string | undefined {
  const code = details?.type === "refusal" && (!reason || ["stop", "completed"].includes(reason.toLowerCase())) ? "refusal" : reason?.toLowerCase();
  const explanation = details?.explanation ? ` ${details.explanation}` : "";
  if (details?.type === "blocked_prompt") {
    return `The provider blocked the prompt (${details.category || reason}).${explanation}`;
  }
  switch (code) {
    case "length":
    case "max_tokens":
    case "max_output_tokens":
      return "The response reached its output token limit before finishing. Reasoning can also count toward this limit. Increase the response token limit or lower reasoning effort." + explanation;
    case "refusal":
      return `The provider declined the response${details?.category ? ` (${details.category})` : ""}.${explanation || " No explanation was provided."}`;
    case "content_filter":
    case "safety":
    case "blocklist":
    case "prohibited_content":
    case "spii":
    case "image_safety":
    case "image_prohibited_content":
    case "escalation":
      return `The provider stopped the response because of a content filter (${reason}).${explanation}`;
    case "recitation":
    case "image_recitation":
      return `The provider stopped the response because it may reproduce protected material (${reason}).${explanation}`;
    case "language":
      return `The provider stopped the response because of an unsupported language.${explanation}`;
    case "malformed_function_call":
    case "unexpected_tool_call":
    case "too_many_tool_calls":
    case "missing_thought_signature":
      return `The provider could not complete the tool call (${reason}).${explanation}`;
    case "error":
    case "failed":
    case "incomplete":
    case "cancelled":
    case "other":
    case "image_other":
    case "no_image":
    case "malformed_response":
    case "finish_reason_unspecified":
      return `The provider did not complete the response (${reason}).${explanation}`;
  }
  if (details && ["failed", "incomplete"].includes(details.type)) {
    return `The provider did not complete the response (${reason || details.type}).${explanation}`;
  }
  return undefined;
}

function splitMirroredReasoning(content: unknown, reasoning: unknown): { content: string; reasoning?: string } {
  const resolvedContent = typeof content === "string" ? content : "";
  const resolvedReasoning = typeof reasoning === "string" && reasoning.length > 0 ? reasoning : undefined;
  if (!resolvedReasoning || !resolvedContent) {
    return { content: resolvedContent, reasoning: resolvedReasoning };
  }
  if (resolvedContent === resolvedReasoning) {
    return { content: "", reasoning: resolvedReasoning };
  }
  const trimmedContent = resolvedContent.trim();
  const trimmedReasoning = resolvedReasoning.trim();
  if (trimmedContent && trimmedContent === trimmedReasoning) {
    return { content: "", reasoning: resolvedReasoning };
  }
  return { content: resolvedContent, reasoning: resolvedReasoning };
}

interface ToolFragment {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface Delta {
  content?: string;
  refusal?: string;
  reasoning?: string;
  reasoning_content?: string;
  tool_calls?: ToolFragment[];
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/** The shape core's loop reads of each event (it reads them untyped). */
interface StreamEvent {
  choices?: { delta?: Delta; finish_reason?: string | null; native_finish_reason?: string }[];
  usage?: Usage;
}

export interface CoreUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  provider_raw: Record<string, unknown>;
}

export interface CoreChunk {
  token: string;
  reasoning?: string;
  finish_reason?: string;
  stop_details?: GenerationStopDetails;
  tool_calls?: { name: string; args: unknown; call_id: string }[];
  usage?: CoreUsage;
}

/** generateStream's loop over a response core fetched. */
export async function* coreStream(res: Response, signal?: AbortSignal): AsyncGenerator<CoreChunk, void, unknown> {
  let reasoningKey: "reasoning" | "reasoning_content" | null = null;
  const toolCallBuffer: { id: string; name: string; argsJson: string }[] = [];
  let finishReason: string | undefined;
  let nativeReason: string | undefined;
  let refusal = "";
  let finalUsage: CoreUsage | undefined;

  for await (const raw of readProviderSse(res, DISPLAY, signal)) {
    throwIfProviderError(raw, DISPLAY, "stream");
    const parsed = raw as StreamEvent;
    const choice = parsed.choices?.[0];
    const delta = choice?.delta;
    if (choice?.finish_reason && !describeGenerationStop(finishReason)) {
      finishReason = choice.finish_reason;
    }
    if (choice?.native_finish_reason) nativeReason = choice.native_finish_reason;
    if (typeof delta?.refusal === "string") refusal += delta.refusal;

    for (const tc of delta?.tool_calls ?? []) {
      const idx = tc.index ?? toolCallBuffer.length;
      if (!toolCallBuffer[idx]) toolCallBuffer[idx] = { id: tc.id ?? "", name: "", argsJson: "" };
      const held = toolCallBuffer[idx];
      if (tc.id && !held.id) held.id = tc.id;
      if (tc.function?.name) held.name += tc.function.name;
      if (tc.function?.arguments) held.argsJson += tc.function.arguments;
    }
    if (!reasoningKey) {
      if (delta?.reasoning !== undefined) reasoningKey = "reasoning";
      else if (delta?.reasoning_content !== undefined) reasoningKey = "reasoning_content";
    }
    const normalized = splitMirroredReasoning(delta?.content || delta?.refusal, reasoningKey ? delta?.[reasoningKey] : undefined);
    const usage = parsed.usage
      ? {
          prompt_tokens: parsed.usage.prompt_tokens || 0,
          completion_tokens: parsed.usage.completion_tokens || 0,
          total_tokens: parsed.usage.total_tokens || 0,
          provider_raw: { ...parsed.usage },
        }
      : undefined;
    if (usage) finalUsage = usage;
    if (normalized.content || normalized.reasoning || usage) yield { token: normalized.content, reasoning: normalized.reasoning, usage };
  }
  if (signal?.aborted) return;
  // Compatible endpoints may omit [DONE], but must still report a finish
  // reason. Wait through the usage-only chunk before emitting completion.
  if (!finishReason) throw incompleteStream(DISPLAY);
  const stopDetails = refusal ? { type: "refusal", explanation: refusal } : nativeReason ? { type: "finish_reason", category: nativeReason } : undefined;
  const failed = describeGenerationStop(finishReason, stopDetails);
  const toolCalls = !failed && toolCallBuffer.length > 0 ? toolCallBuffer.filter(Boolean).map((tc) => ({ name: tc.name, args: JSON.parse(tc.argsJson || "{}") as unknown, call_id: tc.id || crypto.randomUUID() })) : undefined;
  yield {
    token: "",
    finish_reason: toolCalls && ["stop", "tool_calls", "function_call"].includes(finishReason) ? "tool_calls" : finishReason,
    ...(stopDetails ? { stop_details: stopDetails } : {}),
    tool_calls: toolCalls,
    usage: finalUsage,
  };
}

interface Message {
  content?: string | null;
  refusal?: string;
  reasoning?: string;
  reasoning_content?: string;
  tool_calls?: { id?: string; name?: string; function?: { name?: string; arguments?: string | Record<string, unknown> } }[];
}

/** generate's parse of a non-stream answer's JSON. */
export function coreGenerate(data: unknown): { content: string; reasoning?: string; finish_reason: string; tool_calls?: { name: string; args: unknown; call_id: string }[] } {
  throwIfProviderError(data, DISPLAY, "generate");
  // Core reads the answer untyped; this is the shape it reads.
  const answer = data as { choices?: { message?: Message; finish_reason?: string; native_finish_reason?: string }[] };
  const choice = answer.choices?.[0];
  if (!choice) throw incompleteStream(DISPLAY);
  const refusal = choice.message?.refusal;
  const stopDetails = refusal ? { type: "refusal", explanation: refusal } : choice.native_finish_reason ? { type: "finish_reason", category: choice.native_finish_reason } : undefined;
  const finishReason = choice.finish_reason || "stop";
  const failed = describeGenerationStop(finishReason, stopDetails);
  const rawToolCalls = choice?.message?.tool_calls;
  const toolCalls =
    !failed && Array.isArray(rawToolCalls) && rawToolCalls.length > 0
      ? rawToolCalls.map((tc) => ({
          name: tc.function?.name || tc.name || "",
          args: typeof tc.function?.arguments === "string" ? (JSON.parse(tc.function.arguments) as unknown) : (tc.function?.arguments ?? {}),
          call_id: tc.id || crypto.randomUUID(),
        }))
      : undefined;
  const normalized = splitMirroredReasoning(choice?.message?.content || refusal, choice?.message?.reasoning || choice?.message?.reasoning_content);
  return { content: normalized.content, reasoning: normalized.reasoning, finish_reason: toolCalls && ["stop", "tool_calls", "function_call"].includes(finishReason) ? "tool_calls" : finishReason, tool_calls: toolCalls };
}
