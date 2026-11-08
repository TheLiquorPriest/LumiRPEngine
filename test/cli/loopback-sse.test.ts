// The loopback relay against core's reader (DEPTH-PLAN §9.2 B1): what the relay answers for a call's
// chunks reads, through Lumiverse staging's own SSE parser and Custom provider (vendored in
// core-staging/), as the reply core keeps. One reasoning key from the first chunk on, no chunk with
// both reasoning and content, one JSON object per `data:` line, a finish reason, then `[DONE]`;
// refusals and failures as core's provider errors; keep-alive comments, and progress lines into the
// thinking block while nothing else flows.

import { describe, expect, test } from "bun:test";
import { LreError } from "../../src/cli/connection";
import type { CallFields, CallRequestType, OutOfReach, RelayLink, RelaySettings } from "../../src/cli/loopback-relay";
import { RELAY_DEFAULTS, Relay } from "../../src/cli/loopback-relay";
import type { LoopbackChunk, LoopbackResultBodies } from "../../src/shared/loopback";
import type { CoreChunk } from "./core-staging/llm/openai-stream";
import { coreGenerate, coreStream } from "./core-staging/llm/openai-stream";
import { ProviderRequestError } from "./core-staging/utils/provider-errors";

type Sent = { type: CallRequestType; fields: Record<string, unknown> };

/** LumiRPEngine as the relay's link sees it, in memory: what was asked, and what it answers. */
class MemoryLink implements RelayLink {
  up = true;
  out: OutOfReach | null = null;
  refused: string | null = null;
  readonly sent: Sent[] = [];
  answer = (type: CallRequestType, _fields: Record<string, unknown>): unknown => {
    switch (type) {
      case "lre.loopback.begin":
        return { turn: "turn-1" };
      case "lre.loopback.passthrough":
        return { accepted: true };
      case "lre.loopback.models":
        return { models: [{ id: "lre-narrator" }] };
      case "lre.loopback.abort":
        return { aborted: true };
      case "lre.loopback.ack":
        return { done: true };
      default:
        return { last: null };
    }
  };

  async request<T extends CallRequestType>(type: T, fields: CallFields<T>): Promise<LoopbackResultBodies[T]> {
    const asked = fields as unknown as Record<string, unknown>;
    this.sent.push({ type, fields: asked });
    return this.answer(type, asked) as LoopbackResultBodies[T];
  }

  of(type: CallRequestType): Record<string, unknown>[] {
    return this.sent.filter((s) => s.type === type).map((s) => s.fields);
  }
}

function rig(): { link: MemoryLink; relay: Relay; clock: { now: number } } {
  const clock = { now: 1_700_000_000_000 };
  let ids = 0;
  const link = new MemoryLink();
  const settings: RelaySettings = { ...RELAY_DEFAULTS, listen: "127.0.0.1", port: 7861, mode: "user" };
  const relay = new Relay(link, settings, { now: () => clock.now, id: () => `${(++ids).toString(16).padStart(8, "0")}${"a".repeat(24)}`, log: () => undefined, fingerprint: async () => "fp" });
  return { link, relay, clock };
}

const MESSAGES = [{ role: "system", content: "LumiRPEngine's narrator." }, { role: "user", content: "[lre: the story so far]" }];

function post(relay: Relay, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Response> {
  return relay.fetch(new Request("http://127.0.0.1:7861/v1/chat/completions", { method: "POST", headers: { host: "127.0.0.1:7861", authorization: "Bearer lk_test_key", "content-type": "application/json", ...headers }, body: JSON.stringify({ model: "lre-narrator", messages: MESSAGES, ...body }) }));
}

function push(relay: Relay, call: string, chunks: readonly LoopbackChunk[], order: readonly number[] = chunks.map((_, i) => i + 1)): void {
  for (const seq of order) {
    const chunk = chunks[seq - 1];
    if (chunk !== undefined) relay.chunk({ lre: 1, type: "lre.loopback.chunk", call, seq, chunk });
  }
}

async function until(done: () => boolean, ms = 2_000): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await Bun.sleep(2);
  }
}

/** The answer read twice: by core's provider loop, and as the wire's text. */
async function read(res: Response): Promise<{ chunks: CoreChunk[]; raw: string; error: unknown }> {
  const body = res.body;
  if (body === null) throw new Error("no body");
  const [forCore, forText] = body.tee();
  const chunks: CoreChunk[] = [];
  let error: unknown = null;
  const reading = (async () => {
    try {
      for await (const c of coreStream(new Response(forCore))) chunks.push(c);
    } catch (e) {
      error = e;
    }
  })();
  const raw = await new Response(forText).text();
  await reading;
  return { chunks, raw, error };
}

/** The wire's events: each one line, a comment or a `data:` line holding one JSON object or [DONE]. */
function events(raw: string): ({ comment: string } | { data: Record<string, unknown> } | { done: true })[] {
  expect(raw.endsWith("\n\n")).toBe(true);
  return raw
    .slice(0, -2)
    .split("\n\n")
    .map((event) => {
      expect(event.includes("\n")).toBe(false);
      if (event.startsWith(": ")) return { comment: event.slice(2) };
      expect(event.startsWith("data: ")).toBe(true);
      const payload = event.slice(6);
      if (payload === "[DONE]") return { done: true as const };
      const data: unknown = JSON.parse(payload);
      expect(typeof data === "object" && data !== null && !Array.isArray(data)).toBe(true);
      return { data: data as Record<string, unknown> };
    });
}

function deltaOf(data: Record<string, unknown>): Record<string, unknown> | null {
  const choices = data.choices;
  const first = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined;
  return first !== undefined && typeof first.delta === "object" && first.delta !== null ? (first.delta as Record<string, unknown>) : null;
}

const TURN: LoopbackChunk[] = [
  { kind: "progress", text: "The author is setting the scene" },
  { kind: "reasoning", text: "Mira notices the envelope" },
  { kind: "reasoning", text: "; she asks about it." },
  { kind: "content", text: "Mira looks up." },
  { kind: "progress", text: "Checking the passage against its beat" },
  { kind: "content", text: " She smiles." },
  {
    kind: "finish",
    finish: "stop",
    usage: {
      promptTokens: 1200,
      completionTokens: 300,
      totalTokens: 1500,
      calls: [
        { role: "author", connection: "conn-author", model: "deepseek-v4-flash", requestId: "req-1" },
        { role: "narrator", connection: "conn-narrator", model: "deepseek-v4-flash", requestId: null, promptTokens: 800, completionTokens: 200 },
      ],
    },
  },
];

describe("the loopback's SSE in core's reader", () => {
  test("a turn's chunks, out of order and repeated, read as one reasoning key, the reply, its finish and usage, then [DONE]", async () => {
    const { link, relay } = rig();
    const res = await post(relay, { stream: true, lre_turn: "tok_live", temperature: 0.8 });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const [begin] = link.of("lre.loopback.begin");
    // The token comes out of the body; the rest goes to LumiRPEngine as core sent it, key beside it.
    expect(begin).toEqual({ call: expect.any(String), token: "tok_live", key: "lk_test_key", body: { model: "lre-narrator", messages: MESSAGES, stream: true, temperature: 0.8 } });
    const call = String(begin?.call);
    await Bun.sleep(0);
    // 2 before 1 and 5 before 4 are gaps, each asked for again; 3 twice is one.
    push(relay, call, TURN, [2, 1, 3, 3, 5, 4, 6, 7]);
    expect(link.of("lre.loopback.resend")).toEqual([
      { call, from: 1 },
      { call, from: 4 },
    ]);
    const { chunks, raw, error } = await read(res);
    expect(error).toBeNull();

    const reasoning = chunks.map((c) => c.reasoning ?? "").join("");
    expect(reasoning).toBe("The author is setting the scene\nMira notices the envelope; she asks about it.\nChecking the passage against its beat\n");
    expect(chunks.map((c) => c.token).join("")).toBe("Mira looks up. She smiles.");
    const last = chunks.at(-1);
    expect(last?.finish_reason).toBe("stop");
    expect(last?.usage?.total_tokens).toBe(1500);
    expect(last?.usage?.provider_raw.lre_turn).toBe("turn-1");
    expect(last?.usage?.provider_raw.lre_calls).toEqual([
      { role: "author", connection: "conn-author", model: "deepseek-v4-flash", request_id: "req-1" },
      { role: "narrator", connection: "conn-narrator", model: "deepseek-v4-flash", request_id: null, prompt_tokens: 800, completion_tokens: 200 },
    ]);

    const wire = events(raw);
    const data = wire.flatMap((e) => ("data" in e ? [e.data] : []));
    // The key is `reasoning` from the first chunk on, and `reasoning_content` never appears.
    expect(deltaOf(data[0] ?? {})).toEqual({ role: "assistant", reasoning: "" });
    expect(raw.includes("reasoning_content")).toBe(false);
    for (const d of data) {
      const delta = deltaOf(d) ?? {};
      expect(typeof delta.reasoning === "string" && delta.reasoning !== "" && typeof delta.content === "string" && delta.content !== "").toBe(false);
    }
    const finishes = data.filter((d) => (d.choices as { finish_reason: unknown }[] | undefined)?.[0]?.finish_reason != null);
    expect(finishes.length).toBe(1);
    // finish, then usage, then [DONE], and nothing after.
    expect(wire.at(-1)).toEqual({ done: true });
    expect("usage" in (data.at(-1) ?? {})).toBe(true);
    expect(data.indexOf(finishes[0] ?? {})).toBe(data.length - 2);
    // The terminal chunk is acked, and the call is over.
    expect(link.of("lre.loopback.ack")).toEqual([{ call, seq: 7 }]);
    expect(relay.count).toBe(0);
  });

  test("tool calls stream as core assembles them, and stream off answers one completion core parses", async () => {
    const { link, relay } = rig();
    const tools = [{ type: "function", function: { name: "roll_dice", description: "Roll dice", parameters: { type: "object", properties: { sides: { type: "number" } } } } }];
    const res = await post(relay, { stream: true, tools, tool_choice: "auto" });
    // No turn token: passthrough, tools and all.
    const [through] = link.of("lre.loopback.passthrough");
    expect(through?.body).toEqual({ model: "lre-narrator", messages: MESSAGES, stream: true, tools, tool_choice: "auto" });
    push(relay, String(through?.call), [
      { kind: "tool_calls", calls: [{ index: 0, id: "call_1", name: "roll_dice", arguments: '{"sides":' }] },
      { kind: "tool_calls", calls: [{ index: 0, arguments: "20}" }] },
      { kind: "finish", finish: "tool_calls" },
    ]);
    const { chunks, error } = await read(res);
    expect(error).toBeNull();
    expect(chunks.at(-1)).toMatchObject({ finish_reason: "tool_calls", tool_calls: [{ name: "roll_dice", args: { sides: 20 }, call_id: "call_1" }] });

    const answering = post(relay, { stream: false });
    await until(() => link.of("lre.loopback.passthrough").length === 2);
    const second = String(link.of("lre.loopback.passthrough")[1]?.call);
    push(relay, second, [
      { kind: "reasoning", text: "Summing up chapter two." },
      { kind: "content", text: "Mira found the letter." },
      { kind: "finish", finish: "stop", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, calls: [{ role: "narrator", connection: "conn-narrator", model: "deepseek-v4-flash", requestId: "req-9" }] } },
    ]);
    const answer = await answering;
    expect(answer.status).toBe(200);
    const body: unknown = await answer.json();
    expect(coreGenerate(body)).toEqual({ content: "Mira found the letter.", reasoning: "Summing up chapter two.", finish_reason: "stop", tool_calls: undefined });
    expect((body as { usage: Record<string, unknown> }).usage).toMatchObject({ total_tokens: 15, lre_calls: [{ role: "narrator", request_id: "req-9" }] });
  });

  test("a refused turn, a failing one, and a request without a key reach core as the provider's errors", async () => {
    const { link, relay } = rig();
    link.answer = (type) => {
      if (type === "lre.loopback.begin") throw new LreError("conflict", "LumiRPEngine couldn't match this reply to its turn: its token was used already.", []);
      return { last: null };
    };
    const refused = await read(await post(relay, { stream: true, lre_turn: "tok_used" }));
    expect(refused.error).toBeInstanceOf(ProviderRequestError);
    expect((refused.error as ProviderRequestError).detail).toBe("LumiRPEngine couldn't match this reply to its turn: its token was used already.");
    expect((refused.error as ProviderRequestError).code).toBe("conflict");
    // Refused before it started: nothing to abort.
    expect(link.of("lre.loopback.abort")).toEqual([]);

    const failing = rig();
    const res = await post(failing.relay, { stream: true, lre_turn: "tok_live" });
    const call = String(failing.link.of("lre.loopback.begin")[0]?.call);
    push(failing.relay, call, [
      { kind: "content", text: "Mira" },
      { kind: "error", message: "The narrator's connection failed (503).", code: "unavailable" },
    ]);
    const failed = await read(res);
    expect(failed.chunks.map((c) => c.token).join("")).toBe("Mira");
    expect((failed.error as ProviderRequestError).detail).toBe("The narrator's connection failed (503).");

    const nonStream = rig();
    nonStream.link.answer = link.answer;
    const json = await post(nonStream.relay, { stream: false, lre_turn: "tok_used" });
    expect(json.status).toBe(409);
    expect(((await json.json()) as { error: { message: string } }).error.message).toContain("couldn't match this reply");

    const keyless = await post(relay, { stream: true }, { authorization: "" });
    expect(keyless.status).toBe(401);
    expect(((await keyless.json()) as { error: { code: string } }).error.code).toBe("invalid_api_key");
    // A browser never drives it.
    expect((await post(relay, { stream: true }, { origin: "http://evil.example" })).status).toBe(403);
  });

  test("a quiet stream gets comments, then a progress line into the thinking block each minute while LumiRPEngine is reachable", async () => {
    const { link, relay, clock } = rig();
    const res = await post(relay, { stream: true, lre_turn: "tok_live" });
    const call = String(link.of("lre.loopback.begin")[0]?.call);
    await Bun.sleep(0);
    clock.now += 5_000;
    relay.tick();
    clock.now += 56_000;
    relay.tick();
    push(relay, call, [{ kind: "progress", text: "The author is setting the scene" }]);
    clock.now += 61_000;
    relay.tick();
    // Out of reach: only comments, no claim that anything progresses.
    link.up = false;
    link.out = { since: clock.now, why: "down" };
    clock.now += 61_000;
    relay.tick();
    link.up = true;
    link.out = null;
    push(relay, call, [{ kind: "progress", text: "The author is setting the scene" }, { kind: "content", text: "Mira looks up." }, { kind: "finish", finish: "stop" }], [2, 3]);
    const { chunks, raw, error } = await read(res);
    expect(error).toBeNull();
    expect(chunks.map((c) => c.reasoning ?? "").join("")).toBe("Still working (1 min)\nThe author is setting the scene\nThe author is setting the scene (1 min)\n");
    expect(chunks.map((c) => c.token).join("")).toBe("Mira looks up.");
    expect(events(raw).filter((e) => "comment" in e)).toEqual([{ comment: "keep-alive" }, { comment: "keep-alive" }]);
  });
});
