// A turn's provenance (DEPTH-PLAN §3.8, §9.0): behind the loopback the chat's connection is
// `lre-narrator`, so every model call a depth turn makes is reported as it is answered (role,
// connection, model, the provider's request id where it gave one, tokens, how long it took, a room
// the provider capped), and the turn inspector and the finish chunk's usage list them. A call whose
// answer its stage's parse didn't keep whole (`Reading`) is reported again with the fields and the
// answer as written, for the inspector's record alone, as is the call's own reasoning where its
// provider gave it. One wrapper around the turn's port does it,
// so no stage reports its own calls.

import type { LoopbackModelCall } from "../../../shared/loopback";
import { noteMisread, type CallMisread } from "../../../shared/misread";
import { ProviderRefusal } from "../../depth-model-host";
import type { ModelPort } from "../port";
import type { TurnSink } from "./contract";

/** `port`, each answered call reported to `sink.call`, and its misread fields to `sink.misread`; a call its provider refused is reported with what it spent, then fails as it would; a call that fails otherwise or is stopped is not reported. */
export function reporting(port: ModelPort, sink: Pick<TurnSink, "call" | "misread">, now: () => number = Date.now): ModelPort {
  return async (role, messages, opts) => {
    const started = now();
    const answer = await port(role, messages, opts).catch((error: unknown) => {
      if (error instanceof ProviderRefusal && error.usage) sink.call({ role, connection: error.call?.connection ?? "", model: error.call?.model ?? "", requestId: null, promptTokens: error.usage.tokensIn, completionTokens: error.usage.tokensOut, ms: Math.max(0, now() - started) });
      throw error;
    });
    const call: LoopbackModelCall = {
      role,
      connection: answer.call?.connection ?? "",
      model: answer.call?.model ?? "",
      requestId: answer.call?.requestId ?? null,
      ...(answer.usage ? { promptTokens: answer.usage.tokensIn, completionTokens: answer.usage.tokensOut } : {}),
      ms: Math.max(0, now() - started),
      ...(answer.capped ? { capped: answer.capped } : {}),
      ...(answer.reasoning ? { reasoning: answer.reasoning } : {}),
    };
    sink.call(call);
    let kept: CallMisread | null = null;
    const inner = answer.misread;
    return {
      ...answer,
      misread: (fields) => {
        inner?.(fields);
        if (!kept) {
          kept = { fields: [], count: 0, raw: answer.text };
          sink.misread?.(call, kept);
        }
        noteMisread(kept, fields);
      },
    };
  };
}
