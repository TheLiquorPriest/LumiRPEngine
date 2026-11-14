// A reply as an OpenAI-compatible connection gives it to Lumiverse (STANDALONE-PLAN §4.2, §10.7):
// streamed as server-sent events, or whole when the request asked for no stream. Lumiverse reads each
// `data:` line as one JSON chunk until `[DONE]`, and skips every other line (`llm/provider-sse.ts:25-72`);
// takes `delta.content` as the reply and the first reasoning key it meets (`reasoning_content` here) as
// its thinking; gathers `delta.tool_calls` by index; needs a `finish_reason` before the stream ends
// (`llm/providers/openai-compatible.ts:233-303`); and turns a chunk carrying `error` into the
// generation's error (`provider-sse.ts:11-21`).
//
// A long turn is kept alive. Lumiverse ends a generation that has given it no reply or thinking text
// for ten minutes, checked every minute (`services/generation/active-generation-registry.ts:140-153`);
// only a chunk with text resets that clock (`services/generate.service.ts:3866-3873`), and an empty
// one is not even passed on (`openai-compatible.ts:284-286`). So while a turn is silent the stream
// restates its latest progress line in the thinking block, a line of its own, inside every
// `keepAliveMs`. The words are the turn's own, from a file: no text of the stream's is ever shown.
// Comment lines go out more often still, which Lumiverse skips: they keep the connection itself busy.

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
  /** A short line saying what the turn is doing, put in the thinking block on a line of its own; restated while the turn is otherwise silent. */
  progress(line: string): void;
  toolCalls(calls: readonly ToolCall[]): void;
  finish(end?: { reason?: string; usage?: Usage }): void;
  error(message: string): void;
}

export interface ReplyMeta {
  /** The reply's id in its chunks. */
  id: string;
  model: string;
  /** Seconds since the epoch. */
  created: number;
}

/** Keeping a silent stream alive: the line restated when no progress line was given yet (from a file), and how long silence may last. */
export interface KeepAlive {
  everyMs: number;
  line: string;
}

export interface StreamLife {
  clock: Pick<Clock, "now" | "setTimeout" | "clearTimeout">;
  /** Null for a reply that is no turn of RPE's (a request passed through): its silence is the model's, and nothing is put in its thinking. */
  keepAlive: KeepAlive | null;
  /** How long the stream may send nothing at all before a comment line; `COMMENT_MS` when not said. */
  commentMs?: number;
}

/** Fixed: inside Lumiverse's ten minutes, with room for its one-minute check and the time a line takes to reach it. */
export const KEEP_ALIVE_MS = 8 * 60 * 1000;
/** Fixed: under the ten seconds Bun's server lets a connection idle by default. */
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
  let latest: string | null = null;
  let silence: unknown = null;
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
  /** Text reached Lumiverse: its clock starts again, and so does this one. */
  function armSilence(): void {
    if (silence !== null) clock.clearTimeout(silence);
    silence = ended || life.keepAlive === null ? null : clock.setTimeout(restate, life.keepAlive.everyMs);
  }
  function restate(): void {
    silence = null;
    if (ended || life.keepAlive === null) return;
    thinking(`${lineEnded ? "" : "\n"}${latest ?? oneLine(life.keepAlive.line)}\n`);
  }
  function thinking(text: string): void {
    lineEnded = text.endsWith("\n");
    send(chunk({ reasoning_content: text }, null));
    armSilence();
  }
  const end = (): void => {
    ended = true;
    for (const t of [silence, idle]) if (t !== null) clock.clearTimeout(t);
    silence = idle = null;
    try {
      control?.close();
    } catch {
      // Already closed by the reader.
    }
  };

  const out: ReplyStream = {
    reasoning(text) {
      if (!ended && text !== "") thinking(text);
    },
    content(text) {
      if (ended || text === "") return;
      send(chunk({ content: text }, null));
      armSilence();
    },
    progress(line) {
      const text = oneLine(line);
      if (ended || text === "") return;
      latest = text;
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
    error(message) {
      if (ended) return;
      send(`data: ${JSON.stringify({ error: { message, type: "server_error" } })}\n\n`);
      end();
    },
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      control = controller;
      armComment();
      armSilence();
      void run(out, both).then(
        () => out.finish(),
        (error: unknown) => out.error(error instanceof Error ? error.message : String(error)),
      );
    },
    cancel() {
      ended = true;
      for (const t of [silence, idle]) if (t !== null) clock.clearTimeout(t);
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
