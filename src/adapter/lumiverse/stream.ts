// A reply as an OpenAI-compatible connection gives it to Lumiverse (STANDALONE-PLAN §4.2): streamed as
// server-sent events, or whole when the request asked for no stream. Lumiverse reads each `data:`
// line as one JSON chunk until `[DONE]` (`llm/provider-sse.ts:25-72`), takes `delta.content` as the
// reply and `delta.reasoning_content` as its thinking, needs a `finish_reason` before the stream ends
// (`openai-compatible.ts:244-303`), and turns a chunk carrying `error` into the generation's error
// (`provider-sse.ts:11-21`).

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Where a reply is written: thinking, the reply's own text, and its end. Calls after the end are ignored. */
export interface ReplyStream {
  reasoning(text: string): void;
  content(text: string): void;
  finish(usage?: Usage): void;
  error(message: string): void;
}

export interface ReplyMeta {
  /** The reply's id in its chunks. */
  id: string;
  model: string;
  /** Seconds since the epoch. */
  created: number;
}

/** Writes a reply: `run` is given the stream and a signal that aborts when Lumiverse stops listening; when it returns without ending the reply, the reply ends there. */
export type ReplyRun = (out: ReplyStream, signal: AbortSignal) => Promise<void>;

/** The reply streamed as server-sent events. */
export function streamedReply(run: ReplyRun, meta: ReplyMeta, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stop = new AbortController();
  const both = AbortSignal.any([signal, stop.signal]);
  let ended = false;
  let control: ReadableStreamDefaultController<Uint8Array> | null = null;
  const send = (text: string): void => {
    try {
      control?.enqueue(encoder.encode(text));
    } catch {
      // The reader has gone: what is left of the reply has nowhere to go.
    }
  };
  const chunk = (delta: Record<string, string>, finish: string | null, usage?: Usage): string =>
    `data: ${JSON.stringify({ id: meta.id, object: "chat.completion.chunk", created: meta.created, model: meta.model, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;
  const end = (): void => {
    ended = true;
    try {
      control?.close();
    } catch {
      // Already closed by the reader.
    }
  };
  const out: ReplyStream = {
    reasoning(text) {
      if (!ended && text !== "") send(chunk({ reasoning_content: text }, null));
    },
    content(text) {
      if (!ended && text !== "") send(chunk({ content: text }, null));
    },
    finish(usage) {
      if (ended) return;
      send(chunk({}, "stop", usage));
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
      void run(out, both).then(
        () => out.finish(),
        (error: unknown) => out.error(error instanceof Error ? error.message : String(error)),
      );
    },
    cancel() {
      ended = true;
      stop.abort(new Error("Lumiverse stopped reading the reply"));
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

/** The reply whole, as one completion, for a request that asked for no stream. */
export async function wholeReply(run: ReplyRun, meta: ReplyMeta, signal: AbortSignal): Promise<Response> {
  let content = "";
  let reasoning = "";
  let usage: Usage | undefined;
  let failed: string | null = null;
  let ended = false;
  const out: ReplyStream = {
    reasoning(text) {
      if (!ended) reasoning += text;
    },
    content(text) {
      if (!ended) content += text;
    },
    finish(u) {
      if (ended) return;
      usage = u;
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
  if (failed !== null) return new Response(JSON.stringify({ error: { message: failed, type: "server_error" } }), { status: 500, headers: { "content-type": "application/json" } });
  const message = { role: "assistant", content, ...(reasoning !== "" ? { reasoning_content: reasoning } : {}) };
  return new Response(
    JSON.stringify({ id: meta.id, object: "chat.completion", created: meta.created, model: meta.model, choices: [{ index: 0, message, finish_reason: "stop" }], ...(usage ? { usage } : {}) }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
