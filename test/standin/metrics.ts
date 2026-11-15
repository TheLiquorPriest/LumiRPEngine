// What Lumiverse works out about a reply after it has told that it ended (`services/generation/metrics.ts`; `services/generate.service.ts:4325-4426`; paths are Lumiverse's
// `src/`): the reply's token count, and its timings, the first thing the model sent, the first reply text, and how long it took. They come on a later task, as
// `GENERATION_METRICS_READY`. The timings are read off the host's clock, so a test that moves a clock moves them.

/** What the stream's life gives the timings (`GenerationTimingSource`, `services/generation/metrics.ts:70-83`): moments on the host's clock. */
export interface Timing {
  /** When the generation began to stream (`markStreamingStarted`, `services/generation-pool.service.ts:157-162`). */
  streamingStartedAt: number;
  /** The first chunk with thinking or reply text (`firstTokenAt`). */
  firstTokenAt?: number;
  /** The first reply text with something visible in it (`firstContentTokenAt`). */
  firstContentTokenAt?: number;
  /** When the provider's stream came to its end (`responseStoppedAt`). */
  responseStoppedAt?: number;
  /** When the generation was told as ended (`completedAt`). */
  completedAt?: number;
  wasStreaming: boolean;
}

/** `resolveGenerationTokenCounts` (`services/generation/metrics.ts:38-76`): the provider's completion count where it gave one, else the count worked out here. */
export function resolveGenerationTokenCounts(
  providerCompletionTokenCount: unknown,
  calculated: { messageTokenCount?: number; responseTokenCount?: number },
  options: { hasReasoning?: boolean; hasDelimitedReasoning?: boolean; providerRaw?: Record<string, unknown> },
): { messageTokenCount?: number; responseTokenCount?: number } {
  const provided = typeof providerCompletionTokenCount === "number" && Number.isFinite(providerCompletionTokenCount) && providerCompletionTokenCount > 0 ? Math.floor(providerCompletionTokenCount) : undefined;
  const details = options.providerRaw?.completion_tokens_details ?? options.providerRaw?.output_tokens_details;
  const reasoningTokens = typeof details === "object" && details !== null ? (("reasoning_tokens" in details ? details.reasoning_tokens : undefined) ?? ("thinking_tokens" in details ? details.thinking_tokens : undefined)) : undefined;
  let providerResponse: number | undefined;
  if (options.hasDelimitedReasoning !== true) {
    if (provided !== undefined && typeof reasoningTokens === "number" && Number.isInteger(reasoningTokens) && reasoningTokens >= 0 && reasoningTokens <= provided) providerResponse = provided - reasoningTokens;
    else if (options.hasReasoning !== true && reasoningTokens === undefined) providerResponse = provided;
  }
  return { messageTokenCount: provided ?? calculated.messageTokenCount, responseTokenCount: providerResponse ?? calculated.responseTokenCount };
}

/** `calculateGenerationTimingMetrics` (`services/generation/metrics.ts:85-120`): how long it streamed, the wait for the first token, the speed over the reply's own stretch. */
export function timingMetrics(source: Timing, responseTokenCount: number | undefined, observedAt: number): { durationMs: number; wasStreaming: boolean; ttft?: number; tps?: number } {
  const end = source.completedAt ?? observedAt;
  const durationMs = source.streamingStartedAt ? Math.max(0, end - source.streamingStartedAt) : 0;
  let ttft: number | undefined;
  let tps: number | undefined;
  if (source.wasStreaming && source.streamingStartedAt) {
    if (source.firstTokenAt !== undefined) ttft = Math.max(0, source.firstTokenAt - source.streamingStartedAt);
    if (source.firstContentTokenAt !== undefined && source.responseStoppedAt !== undefined && responseTokenCount !== undefined && responseTokenCount > 1) {
      const seconds = (source.responseStoppedAt - source.firstContentTokenAt) / 1000;
      if (seconds > 0) tps = Math.round((responseTokenCount / seconds) * 10) / 10;
    }
  }
  return { durationMs, wasStreaming: source.wasStreaming, ...(ttft !== undefined ? { ttft } : {}), ...(tps !== undefined ? { tps } : {}) };
}
