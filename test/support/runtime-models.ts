// The models behind a runtime a bed links (`runtime-bed.ts`): the runtime's own model layer
// (`createModelLayer`), as `lumiah serve` makes it, with its providers stood in for by ones that answer
// from the seat's script. Every agent's call reaches the layer as the core makes it; the call is kept in
// the seat's `calls`, the seat's `script` gives its answer, and the layer then calls the connection's
// provider as it would any other, which streams that answer back the way a provider streams one: its
// reasoning, then its text a word at a time, then its tool calls. Nothing reaches the network.
//
// The runtime's connections are its own, made on its Runtime page (`runtime-bed.ts` makes the one the
// bed's chats run on); a call whose connection is the runtime's runs on it, and any other on the
// runtime's default, as the layer decides.

import { AsyncLocalStorage } from "node:async_hooks";
import type { Api, AssistantMessage, AssistantMessageEventStream, Context, Model, Provider, SimpleStreamOptions, StopReason, Usage } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream, createProvider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { ModelRequest } from "lumi-ah/core";
import { createModelLayer, type ModelLayer, type ModelLayerDeps } from "lumi-ah/runtime";
import type { Answer, Seat } from "./lumiah-bed";

/** One scripted answer, read: text alone is its content. */
type Scripted = Exclude<Answer, string>;

/** The answer of the call a provider is asked for, set around each of the layer's calls. */
const playing = new AsyncLocalStorage<Scripted>();

/** What a provider reports an answer spent: 120 tokens in and 30 out, as a small call does. */
const USAGE: Usage = { input: 120, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 150, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/** Streams one scripted answer as a provider does: it starts, its reasoning, its text in pieces, its tool calls, and its end, or its failure in the provider's words. */
async function play(out: AssistantMessageEventStream, model: Model<Api>, options: SimpleStreamOptions | undefined, answer: Scripted): Promise<void> {
  const calls = answer.toolCalls ?? [];
  const stopReason: StopReason = calls.length > 0 ? "toolUse" : "stop";
  const message: AssistantMessage = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: USAGE, stopReason, timestamp: Date.now() };
  const partial = (): AssistantMessage => ({ ...message, content: [...message.content] });
  out.push({ type: "start", partial: partial() });
  if (answer.reasoning !== undefined) {
    const at = message.content.length;
    message.content.push({ type: "thinking", thinking: answer.reasoning });
    out.push({ type: "thinking_start", contentIndex: at, partial: partial() });
    out.push({ type: "thinking_delta", contentIndex: at, delta: answer.reasoning, partial: partial() });
    out.push({ type: "thinking_end", contentIndex: at, content: answer.reasoning, partial: partial() });
  }
  const content = answer.content ?? "";
  if (content !== "") {
    const at = message.content.length;
    message.content.push({ type: "text", text: content });
    out.push({ type: "text_start", contentIndex: at, partial: partial() });
    for (const piece of content.match(/\S+\s*|\s+/g) ?? [content]) {
      if (options?.signal?.aborted) break;
      out.push({ type: "text_delta", contentIndex: at, delta: piece, partial: partial() });
      // A provider's next piece takes at least a turn of the event loop.
      await Promise.resolve();
    }
    out.push({ type: "text_end", contentIndex: at, content, partial: partial() });
  }
  for (const call of calls) {
    const at = message.content.length;
    const block = { type: "toolCall" as const, id: call.callId, name: call.name, arguments: call.args, ...(call.thoughtSignature !== undefined ? { thoughtSignature: call.thoughtSignature } : {}) };
    message.content.push(block);
    out.push({ type: "toolcall_start", contentIndex: at, partial: partial() });
    out.push({ type: "toolcall_end", contentIndex: at, toolCall: block, partial: partial() });
  }
  if (answer.error !== undefined) {
    const failed: AssistantMessage = { ...message, stopReason: "error", errorMessage: answer.error };
    out.push({ type: "error", reason: "error", error: failed });
    out.end(failed);
    return;
  }
  out.push({ type: "done", reason: stopReason === "toolUse" ? "toolUse" : "stop", message });
  out.end(message);
}

/** A provider the runtime offers, with its own catalogue and sign-in, answering each call with the answer the call was scripted. */
function standIn(real: Provider): Provider {
  const streams = (model: Model<Api>, _context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream => {
    const out = createAssistantMessageEventStream();
    const answer = playing.getStore();
    if (answer === undefined) throw new Error("a provider was asked for a call the bed's model layer didn't make");
    void play(out, model, options, answer).catch((error: unknown) => {
      const failed: AssistantMessage = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: USAGE, stopReason: "error", errorMessage: error instanceof Error ? error.message : String(error), timestamp: Date.now() };
      out.push({ type: "error", reason: "error", error: failed });
      out.end(failed);
    });
    return out;
  };
  return createProvider({ id: real.id, name: real.name, auth: real.auth, models: [...real.getModels()], api: { stream: streams, streamSimple: streams } });
}

/** The seat's answer for a call, which keeps the call first; a call its signal ends before the answer comes rejects with the signal's reason. */
async function scripted(seat: Pick<Seat, "script" | "calls">, request: ModelRequest, signal: AbortSignal): Promise<Scripted> {
  seat.calls.push(request);
  signal.throwIfAborted();
  const ended = Promise.withResolvers<never>();
  signal.addEventListener("abort", () => ended.reject(signal.reason instanceof Error ? signal.reason : new Error("the call was ended")), { once: true });
  ended.promise.catch(() => undefined);
  const answer = await Promise.race([Promise.resolve().then(() => seat.script(request)), ended.promise]);
  return typeof answer === "string" ? { content: answer } : answer;
}

/**
 * What builds a bed's runtime's model layer (`RuntimeDeps.models`): the real layer over the runtime's
 * folder, its OpenAI and Anthropic providers answering from `seat`'s script, each call kept in the
 * seat's `calls`.
 */
export function scriptedModels(seat: Pick<Seat, "script" | "calls">): (deps: ModelLayerDeps) => ModelLayer {
  return (deps) => {
    const layer = createModelLayer({ ...deps, providers: [standIn(openaiProvider()), standIn(anthropicProvider())] });
    return {
      ...layer,
      models: {
        call: async (request, signal, onDelta) => {
          const answer = await scripted(seat, request, signal);
          return playing.run(answer, () => layer.models.call(request, signal, onDelta));
        },
        ended: (session) => layer.models.ended?.(session),
      },
    };
  };
}
