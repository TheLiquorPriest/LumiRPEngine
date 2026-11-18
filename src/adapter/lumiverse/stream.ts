// A reply as an OpenAI-compatible connection gives it to Lumiverse (STANDALONE-PLAN §4.2, §10.7):
// streamed as server-sent events, or whole when the request asked for no stream. Lumiverse reads each
// `data:` line as one JSON chunk until `[DONE]`, and skips every other line (`llm/provider-sse.ts:25-72`);
// takes `delta.content` as the reply and the first reasoning key it meets (`reasoning_content` here) as
// its thinking; gathers `delta.tool_calls` by index; needs a `finish_reason` before the stream ends
// (`llm/providers/openai-compatible.ts:233-303`); and turns a chunk carrying `error` into the
// generation's error (`provider-sse.ts:11-21`).
//
// A long turn is kept alive by what the turn shows in the thinking block: its progress lines, and its agents' thinking as RPH gives it
// (`progress.thinking`). Lumiverse ends a generation that has given it no reply or thinking text for ten minutes, checked every minute
// (`services/generation/active-generation-registry.ts:140-158`); only a chunk with text resets that clock (`services/generate.service.ts:3866-3873`).
// RPH writes a progress line after `progress.silenceSeconds` seconds of nothing shown, at most 540 (its own settings), so one reaches
// Lumiverse inside every ten minutes; the stream adds none of its own. Comment lines go out more often, which Lumiverse skips: they keep
// the connection itself busy.

import type { Clock } from "rp-harness/contract";

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** A tool call of a reply passed through: its id, the tool's name, and its arguments as JSON text. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Where a reply is written: thinking, the reply's own text, and its end. Calls after the end are ignored. */
export interface ReplyStream {
  reasoning(text: string): void;
  content(text: string): void;
  /** A short line saying what the turn is doing, put in the thinking block on a line of its own. */
  progress(line: string): void;
  toolCalls(calls: readonly ToolCall[]): void;
  finish(end?: { reason?: string; usage?: Usage }): void;
  /**
   * Ends the reply with `message`, which the player's notice shows. Once thinking has gone out, Lumiverse keeps the empty message after
   * the notice is gone (the turn lane takes it away only where `lumiverse.reply.removeEmpty` is on), and `kept` goes into its thinking,
   * where the message shows why: a line with no error's or provider's words in it, since what is kept in the thinking can reach a later
   * prompt. Without `kept`, nothing more goes into the thinking.
   */
  error(message: string, kept?: string): void;
}

export interface ReplyMeta {
  /** The reply's id in its chunks. */
  id: string;
  model: string;
  /** Seconds since the epoch. */
  created: number;
}

export interface StreamLife {
  clock: Pick<Clock, "now" | "setTimeout" | "clearTimeout">;
  /** A turn of RPE's: a reply that ends in an error puts its kept line in the thinking. False for a request passed through, whose thinking is the model's. */
  turn: boolean;
  /** How long the stream may send nothing at all before a comment line; `COMMENT_MS` when not said. */
  commentMs?: number;
}

/** The default of `lumiverse.stream.commentSeconds`: under the ten seconds Bun's server lets a connection idle by default. */
export const COMMENT_MS = 5_000;

/** Writes a reply: `run` is given the stream and a signal that aborts when Lumiverse stops listening; when it returns without ending the reply, the reply ends there. */
export type ReplyRun = (out: ReplyStream, signal: AbortSignal) => Promise<void>;

/** A progress line as one line: the thinking block holds it on a line of its own. */
const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, " ").trim();

/** The reply streamed as server-sent events. */
export function streamedReply(run: ReplyRun, meta: ReplyMeta, signal: AbortSignal, life: StreamLife): Response {
  const encoder = new TextEncoder();
  const stop = new AbortController();
  const both = AbortSignal.any([signal, stop.signal]);
  const { clock } = life;
  const commentMs = life.commentMs ?? COMMENT_MS;
  let ended = false;
  let control: ReadableStreamDefaultController<Uint8Array> | null = null;
  /** Whether the thinking written so far ends a line: a progress line starts on a line of its own. */
  let lineEnded = true;
  /** Whether thinking text went out: Lumiverse then keeps the message even when the reply ends in an error. */
  let thought = false;
  let idle: unknown = null;

  const send = (text: string): void => {
    try {
      control?.enqueue(encoder.encode(text));
    } catch {
      // The reader has gone: what is left of the reply has nowhere to go.
    }
    armComment();
  };
  const chunk = (delta: Record<string, unknown>, finish: string | null, usage?: Usage): string =>
    `data: ${JSON.stringify({ id: meta.id, object: "chat.completion.chunk", created: meta.created, model: meta.model, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;

  function armComment(): void {
    if (idle !== null) clock.clearTimeout(idle);
    idle = ended ? null : clock.setTimeout(() => send(": keep-alive\n\n"), commentMs);
  }
  function thinking(text: string): void {
    lineEnded = text.endsWith("\n");
    thought = true;
    send(chunk({ reasoning_content: text }, null));
  }
  /** Ends the reply with an error Lumiverse shows. */
  const fail = (message: string): void => {
    if (ended) return;
    send(`data: ${JSON.stringify({ error: { message, type: "server_error" } })}\n\n`);
    end();
  };
  const end = (): void => {
    ended = true;
    if (idle !== null) clock.clearTimeout(idle);
    idle = null;
    try {
      control?.close();
    } catch {
      // Already closed by the reader.
    }
  };

  const out: ReplyStream = {
    reasoning(text) {
      // No empty piece is written: Lumiverse drops a chunk with no text before it counts it (`llm/providers/openai-compatible.ts:278`).
      if (!ended && text !== "") thinking(text);
    },
    content(text) {
      if (ended || text === "") return;
      send(chunk({ content: text }, null));
    },
    progress(line) {
      const text = oneLine(line);
      if (ended || text === "") return;
      thinking(`${lineEnded ? "" : "\n"}${text}\n`);
    },
    toolCalls(calls) {
      if (ended || calls.length === 0) return;
      send(chunk({ tool_calls: calls.map((c, index) => ({ index, id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) }, null));
    },
    finish(e) {
      if (ended) return;
      send(chunk({}, e?.reason ?? "stop", e?.usage));
      send("data: [DONE]\n\n");
      end();
    },
    error(message, kept) {
      if (ended) return;
      const text = oneLine(kept ?? "");
      if (thought && life.turn && text !== "") thinking(`${lineEnded ? "" : "\n"}${text}\n`);
      fail(message);
    },
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      control = controller;
      armComment();
      void run(out, both).then(
        () => out.finish(),
        (error: unknown) => fail(error instanceof Error ? error.message : String(error)),
      );
    },
    cancel() {
      ended = true;
      if (idle !== null) clock.clearTimeout(idle);
      stop.abort(new Error("Lumiverse stopped reading the reply"));
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

/** The reply whole, as one completion, for a request that asked for no stream. Progress lines go into its thinking, each on a line of its own. */
export async function wholeReply(run: ReplyRun, meta: ReplyMeta, signal: AbortSignal): Promise<Response> {
  let content = "";
  let reasoning = "";
  let usage: Usage | undefined;
  let reason = "stop";
  const calls: ToolCall[] = [];
  let failed: string | null = null;
  let ended = false;
  const out: ReplyStream = {
    reasoning(text) {
      if (!ended) reasoning += text;
    },
    content(text) {
      if (!ended) content += text;
    },
    progress(line) {
      const text = oneLine(line);
      if (!ended && text !== "") reasoning += `${reasoning === "" || reasoning.endsWith("\n") ? "" : "\n"}${text}\n`;
    },
    toolCalls(list) {
      if (!ended) calls.push(...list);
    },
    finish(e) {
      if (ended) return;
      usage = e?.usage;
      reason = e?.reason ?? (calls.length > 0 ? "tool_calls" : "stop");
      ended = true;
    },
    error(message) {
      if (ended) return;
      failed = message;
      ended = true;
    },
  };
  try {
    await run(out, signal);
  } catch (error) {
    out.error(error instanceof Error ? error.message : String(error));
  }
  out.finish();
  if (failed !== null) return new Response(JSON.stringify({ error: { message: failed, type: "server_error" } }), { status: 500, headers: { "content-type": "application/json" } });
  const message = {
    role: "assistant",
    content: content === "" && calls.length > 0 ? null : content,
    ...(reasoning !== "" ? { reasoning_content: reasoning } : {}),
    ...(calls.length > 0 ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) } : {}),
  };
  return new Response(
    JSON.stringify({ id: meta.id, object: "chat.completion", created: meta.created, model: meta.model, choices: [{ index: 0, message, finish_reason: reason }], ...(usage ? { usage } : {}) }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
