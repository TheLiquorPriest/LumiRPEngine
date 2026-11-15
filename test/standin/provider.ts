// A plain OpenAI-compatible model for the stand-in Lumiverse to call: the server a connection's `base` points at, answering at `<base>/chat/completions` as the
// stand-in posts to it (`lumiverse.ts`). A test scripts what it says and when: the delays to its first thinking, to its first word, between its chunks, and to its
// end, streamed as server-sent events or answered whole as the request asks (`stream`, `llm/providers/openai-compatible.ts:466-517`). The delays run on the clock the
// test gives, which is the host's own where the test moves one (`FakeClock`), or the process's where it wants them to pass in real time. What it sends is what a
// provider's stream is made of for Lumiverse's reader (`llm/provider-sse.ts:25-72`, `llm/providers/openai-compatible.ts:233-303`): a first chunk with the role and
// no text, one chunk for each piece of text, a chunk with the finish reason, one with the usage, and `[DONE]`. Its own, the test's invention: the words.

import type { HostClock, Server } from "./host";

/** What one request is answered with. A delay is in milliseconds, and where it is left out it is nought. */
export interface PlainReply {
  /** The reply's words, one chunk each. */
  words: readonly string[];
  /** The thinking, one chunk each, sent as `reasoning_content`. */
  thinking?: readonly string[];
  /** From the request to the first chunk of thinking. */
  toThinking?: number;
  /** From the request to the first word; where it is left out, one `between` after the last thinking, or at once with no thinking. */
  toWord?: number;
  /** From one chunk to the next of its kind. */
  between?: number;
  /** From the last chunk to the end: the finish reason, the usage and `[DONE]`; a reply asked for whole is answered then. */
  toEnd?: number;
  /**
   * While it waits, a stream sends a comment line and a chunk with no text this often, as providers do to keep a connection busy. Lumiverse reads neither as
   * text, so neither keeps a generation from its ten minutes of silence. A reply asked for whole sends none.
   */
  keepAlive?: number;
  finishReason?: string;
  usage?: Record<string, unknown>;
  /**
   * How the reply ends: `finish` (the default) with its finish reason, the usage and `[DONE]`; `drop`, the connection closing with no finish reason, as when the model's server goes down
   * (Lumiverse then fails the generation with "closed before a terminal response was received"); or `{ error }`, a chunk that carries an error (`llm/provider-sse.ts:11-21`), or for a reply
   * asked for whole, a 500.
   */
  ending?: "finish" | "drop" | { error: string };
}

/** When each chunk of a reply comes, in milliseconds from the request, and when its end does. */
export function schedule(reply: PlainReply): { chunks: { at: number; kind: "reasoning" | "content"; text: string }[]; endsAt: number } {
  const between = reply.between ?? 0;
  const chunks: { at: number; kind: "reasoning" | "content"; text: string }[] = [];
  const thinking = reply.thinking ?? [];
  const toThinking = reply.toThinking ?? 0;
  thinking.forEach((text, i) => chunks.push({ at: toThinking + i * between, kind: "reasoning", text }));
  const toWord = reply.toWord ?? (thinking.length === 0 ? 0 : toThinking + (thinking.length - 1) * between + between);
  reply.words.forEach((text, i) => chunks.push({ at: toWord + i * between, kind: "content", text }));
  chunks.sort((a, b) => a.at - b.at);
  return { chunks, endsAt: (chunks.at(-1)?.at ?? 0) + (reply.toEnd ?? 0) };
}

export class ScriptedProvider {
  /** What each request carried, in order: its body and its headers. */
  readonly calls: { body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  private readonly replies: PlainReply[];

  /** Each request takes the next reply; the last is given again to every request after it. */
  constructor(
    private readonly clock: HostClock,
    ...replies: PlainReply[]
  ) {
    if (replies.length === 0) throw new Error("a scripted provider needs a reply");
    this.replies = replies;
  }

  /** Put at the origin of a connection's `base`: `lv.servers.set(origin, provider.server)`. */
  readonly server: Server = async (request) => {
    if (!new URL(request.url).pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 });
    const body = (await request.clone().json()) as Record<string, unknown>;
    this.calls.push({ body, headers: Object.fromEntries(request.headers.entries()) });
    const reply = this.replies[Math.min(this.calls.length - 1, this.replies.length - 1)]!;
    return body.stream === false ? await this.whole(reply, request.signal) : this.streamed(reply, request.signal);
  };

  /** A reply asked for whole: one answer, at the end's moment. */
  private async whole(reply: PlainReply, signal: AbortSignal): Promise<Response> {
    const { endsAt } = schedule(reply);
    const arrived = Promise.withResolvers<void>();
    const timer = this.clock.setTimeout(arrived.resolve, endsAt);
    const onAbort = (): void => {
      this.clock.clearTimeout(timer);
      arrived.reject(signal.reason ?? new DOMException("This operation was aborted", "AbortError"));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    try {
      await arrived.promise;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (typeof reply.ending === "object") return Response.json({ error: { message: reply.ending.error } }, { status: 500 });
    return Response.json({
      id: "scripted",
      object: "chat.completion",
      created: 0,
      model: "scripted",
      choices: [{ index: 0, message: { role: "assistant", content: reply.words.join(""), ...(reply.thinking !== undefined ? { reasoning_content: reply.thinking.join("") } : {}) }, finish_reason: reply.finishReason ?? "stop" }],
      ...(reply.usage !== undefined ? { usage: reply.usage } : {}),
    });
  }

  /** A reply streamed: its headers at once, then each chunk at its moment. A stop on the request ends the stream with its reason. */
  private streamed(reply: PlainReply, signal: AbortSignal): Response {
    const { chunks, endsAt } = schedule(reply);
    const clock = this.clock;
    const encoder = new TextEncoder();
    const timers = new Set<unknown>();
    const chunk = (delta: Record<string, unknown>, finish: string | null = null): string => `data: ${JSON.stringify({ id: "scripted", object: "chat.completion.chunk", created: 0, model: "scripted", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    let over = false;
    let onAbort: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const send = (text: string): void => {
          if (!over) controller.enqueue(encoder.encode(text));
        };
        const at = (ms: number, run: () => void): void => {
          const timer = clock.setTimeout(() => {
            timers.delete(timer);
            if (!over) run();
          }, ms);
          timers.add(timer);
        };
        const stop = (): void => {
          over = true;
          for (const timer of timers) clock.clearTimeout(timer);
          timers.clear();
        };
        send(chunk({ role: "assistant", content: "" }));
        for (const c of chunks) at(c.at, () => send(chunk(c.kind === "reasoning" ? { reasoning_content: c.text } : { content: c.text })));
        if (reply.keepAlive !== undefined && reply.keepAlive > 0) {
          const every = reply.keepAlive;
          const tick = (waited: number): void => {
            if (waited >= endsAt) return;
            at(every, () => {
              send(`: keep-alive\n\n${chunk({ content: "" })}`);
              tick(waited + every);
            });
          };
          tick(0);
        }
        at(endsAt, () => {
          const ending = reply.ending ?? "finish";
          if (ending === "drop") {
            stop();
            controller.close();
            return;
          }
          if (typeof ending === "object") {
            send(`data: ${JSON.stringify({ error: { message: ending.error, type: "server_error" } })}\n\n`);
            stop();
            controller.close();
            return;
          }
          send(chunk({}, reply.finishReason ?? "stop"));
          if (reply.usage !== undefined) send(`data: ${JSON.stringify({ id: "scripted", object: "chat.completion.chunk", created: 0, model: "scripted", choices: [], usage: reply.usage })}\n\n`);
          send("data: [DONE]\n\n");
          stop();
          controller.close();
        });
        onAbort = () => {
          stop();
          try {
            controller.error(signal.reason ?? new DOMException("This operation was aborted", "AbortError"));
          } catch {
            // The reader had already gone.
          }
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      },
      cancel: () => {
        over = true;
        for (const timer of timers) clock.clearTimeout(timer);
        timers.clear();
        if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
}
