// LumiAH's runtime beside the backend the engine mounts, as a chat the engine plays needs it: the real
// runtime (`createRuntime`, the core's own harness in it, made for the runtime) linked to the real
// backend `mountHarness` builds into the engine, over the rig's fake Lumiverse. What a runtime asks of
// Lumiverse itself is made up here: its HTTP routes (the session, the user's connections, a stop) and
// the event socket its link travels, which Lumiverse carries between the runtime and the backend like
// a page's messages. Nothing here is a model: every agent's call reaches the seat's `script`, as on
// the built-in bed (`lumiah-bed.ts`).
//
// A reply runs as Lumiverse runs one on a chat whose connection is the runtime's loopback: the
// generation starts (the engine's guard asks whether the harness can play it), the interceptors
// answer (LumiAH's tags the request), the request goes to the loopback, the reply is read as it
// streams, and Lumiverse saves it (or keeps what was written, on a Stop) and says it ended.

import { createHarness } from "lumi-ah/core";
import { LINK, RUNTIME_DEFAULTS, type RuntimeTuning } from "lumi-ah/link";
import { createRuntime, type Http, type HttpReply, type OpenSocket, type Runtime } from "lumi-ah/runtime";
import type { HostGenerationType } from "../../src/backend/host";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { Generation } from "./fake-host";
import { type Bed, lumiahBed } from "./lumiah-bed";
import type { Rig } from "./rig";

/** Where the fake Lumiverse is, and where the runtime serves its loopback. */
const BASE = "http://127.0.0.1:7860";
const PORT = 7871;

/** The extension's id in this Lumiverse (its database id), which the socket's frames are addressed by. */
const EXTENSION_ID = "ext-lumirpengine";

/** The user's session token, which the runtime signs in with. */
const TOKEN = "session-token-bed";

/** The runtime's timings for a test: nothing waits, so a test takes no longer than its work. */
const FAST: RuntimeTuning = { ...RUNTIME_DEFAULTS, traceMs: 0, resendMs: 20, reconnectMs: 5, reconnectMaxMs: 20, stopGraceMs: 0 };

const reply = (status: number, body: unknown): HttpReply => ({ status, header: () => null, text: typeof body === "string" ? body : JSON.stringify(body) });

let sessions = 0;

/** What a reply came to, as Lumiverse read it from the loopback. */
export interface Replied {
  generation: Generation;
  /** The reply's text as it reached Lumiverse, its pieces in order. */
  content: string;
  /** What went to the reply's thinking block. */
  reasoning: string;
  status: number;
  /** The error the loopback answered with, in its own words; null when it answered a reply. */
  error: { message: string; code: string } | null;
  finish: string | null;
}

/** LumiAH's runtime linked to the backend the engine mounts, and the test's hands on both. */
export interface RuntimeBed extends Bed {
  runtime: Runtime;
  /** The loopback key, once minted. */
  key: string;
  /** Every piece of every reply as it reached Lumiverse, in order. */
  pieces: string[];
  /**
   * One reply in a chat whose connection is the runtime's, as Lumiverse runs it (see the header):
   * `type` the kind of generation, `signal` Lumiverse's Stop. Halted before its request (the guard
   * stopped it), it comes back with nothing read.
   */
  reply(chatId: string, options?: { type?: HostGenerationType; signal?: AbortSignal }): Promise<Replied>;
}

/**
 * The engine's rig with LumiAH's backend mounted in it and a runtime linked to that backend, set up
 * as a player sets one up: the runtime registered and linked, and the loopback key minted, which has
 * the runtime make the chat's loopback connection. The returned bed closes the runtime with itself.
 */
export async function runtimeBed(rig: Rig): Promise<RuntimeBed> {
  const bed = lumiahBed(rig);
  const userId = rig.host.userId;
  const generating = new Map<string, { chatId: string; stop: AbortController }>();
  const keys = new Map<string, string>();
  let made = 0;

  const http: Http = async (request) => {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.headers.Authorization !== `Bearer ${TOKEN}`) return reply(401, { error: "Unauthorized" });
    if (path === "/api/v1/spindle" && request.method === "GET") return reply(200, { extensions: [{ id: EXTENSION_ID, identifier: bed.base.identifier, version: "0.0.1", enabled: true, status: "running" }] });
    if (path === "/api/v1/ws-ticket" && request.method === "POST") return reply(200, { ticket: `ticket-${++made}` });
    if (path === "/api/auth/get-session") return reply(200, { session: { expiresAt: "2099-01-01T00:00:00.000Z" }, user: { id: userId } });
    if (path === "/api/v1/connections" && request.method === "GET") return reply(200, { data: bed.connections.map((c) => ({ id: c.id, name: c.name, provider: c.provider, api_url: c.url, model: c.model })) });
    if (path === "/api/v1/connections" && request.method === "POST") {
      const body: unknown = JSON.parse(request.body ?? "{}");
      const text = (key: string): string => (isRecord(body) && typeof body[key] === "string" ? body[key] : "");
      const connection = { id: `conn-loop-${++made}`, name: text("name"), provider: text("provider"), url: text("api_url"), model: text("model"), isDefault: false, metadata: {} };
      bed.connections.push(connection);
      if (text("api_key") !== "") keys.set(connection.id, text("api_key"));
      return reply(201, { id: connection.id, name: connection.name, provider: connection.provider, api_url: connection.url, model: connection.model });
    }
    const key = /^\/api\/v1\/connections\/([^/]+)\/api-key$/.exec(path);
    if (key !== null && request.method === "PUT") {
      const body: unknown = JSON.parse(request.body ?? "{}");
      keys.set(decodeURIComponent(key[1] ?? ""), isRecord(body) && typeof body.api_key === "string" ? body.api_key : "");
      return reply(200, { ok: true });
    }
    if (path === "/api/v1/generate/stop" && request.method === "POST") {
      const body: unknown = JSON.parse(request.body ?? "{}");
      const said = (name: string): string => (isRecord(body) && typeof body[name] === "string" ? body[name] : "");
      // The generation named; else, as Lumiverse does for an id it no longer knows, whatever runs in the chat.
      const held = generating.get(said("generation_id")) ?? [...generating.values()].find((g) => g.chatId === said("chat_id"));
      held?.stop.abort();
      return reply(200, { stopped: held !== undefined });
    }
    return reply(404, { error: "Not found" });
  };

  // The event socket: the runtime's frames reach the backend as a session's messages, and what the backend sends that session comes back on the socket.
  const openSocket: OpenSocket = (url, events) => {
    const session = new URL(url).searchParams.get("frontend_session") ?? `runtime-${++sessions}`;
    let open = true;
    bed.outlet(session, (message) => {
      if (open) events.message(JSON.stringify({ event: "SPINDLE_FRONTEND_MSG", payload: { extensionId: EXTENSION_ID, data: message } }));
    });
    queueMicrotask(() => events.message(JSON.stringify({ event: "CONNECTED" })));
    const shut = (): void => {
      if (!open) return;
      open = false;
      bed.closeSession(session);
    };
    return {
      send: (text) => {
        if (!open) return;
        const message = JSON.parse(text) as { type?: string; extensionId?: string; payload?: unknown };
        if (message.type === "SPINDLE_BACKEND_MSG" && message.extensionId === EXTENSION_ID) bed.deliver(message.payload, session);
      },
      close: shut,
    };
  };

  // The runtime registers with the backend from a session of its own, as `lumiah up` does.
  const registering = `register-${++sessions}`;
  const registered = Promise.withResolvers<{ relay: string; secret: string }>();
  bed.outlet(registering, (message) => {
    const frame = isRecord(message) ? message : {};
    if (frame.link !== LINK || frame.id !== "register") return;
    const body = isRecord(frame.body) ? frame.body : {};
    if (frame.type === "result" && typeof body.relay === "string" && typeof body.secret === "string") registered.resolve({ relay: body.relay, secret: body.secret });
    else registered.reject(new Error(`the runtime's registration was refused: ${String(frame.message)}`));
  });
  bed.deliver({ link: LINK, id: "register", type: "register", name: "bed", build: bed.env.build, host: "bed-box", listen: "127.0.0.1", port: PORT }, registering);
  const { relay, secret } = await registered.promise;
  bed.closeSession(registering);

  let held = secret;
  const runtime = createRuntime(
    { name: "bed", base: BASE, extension: bed.base.identifier, listen: "127.0.0.1", port: PORT, relay, secret, session: { username: "bed", token: TOKEN, savedAt: 0 }, tuning: FAST },
    {
      http,
      openSocket,
      now: () => Date.now(),
      log: (text) => void bed.logs.push(`runtime: ${text}`),
      build: bed.env.build,
      ran: { bun: null, script: "lumiah.js", unit: null },
      host: "bed-box",
      credentials: () => ({ username: "bed", token: TOKEN, savedAt: 0 }),
      secret: () => held,
      rotated: (next) => {
        held = next;
      },
      keepTuning: () => undefined,
      harness: (harnessHost, settings, extension) => createHarness(harnessHost, { settings, extension, place: "runtime" }),
      writerConnection: () => null,
    },
  );
  // The runtime's own clockwork, which `lumiah serve` runs every second, runs here every few milliseconds.
  const ticker = setInterval(() => runtime.tick(), 5);
  const close = bed.close;

  const out: RuntimeBed = Object.assign(bed, {
    runtime,
    key: "",
    pieces: [] as string[],
    async reply(chatId: string, options: { type?: HostGenerationType; signal?: AbortSignal } = {}): Promise<Replied> {
      const generation = await rig.host.begin(chatId, { type: options.type ?? "normal" });
      const nothing: Replied = { generation, content: "", reasoning: "", status: 0, error: null, finish: null };
      if (generation.halted !== undefined) return nothing;
      const stop = new AbortController();
      const stopped = (): void => stop.abort();
      if (options.signal?.aborted === true) stopped();
      else options.signal?.addEventListener("abort", stopped, { once: true });
      generating.set(generation.id, { chatId, stop });
      const loopback = bed.connections.find((c) => c.url.endsWith(`:${PORT}/v1`));
      const body: JsonObject = { model: loopback?.model ?? "", stream: true, messages: bed.prompt(generation.id).map((m) => ({ role: m.role, content: m.text })), temperature: 0.8, max_tokens: 600, ...(bed.parameters(generation.id) as JsonObject) };
      const read = await post(runtime.fetch, body, out.key, stop.signal, (piece) => void out.pieces.push(piece)).finally(() => {
        generating.delete(generation.id);
        options.signal?.removeEventListener("abort", stopped);
      });
      // Stop: Lumiverse keeps what was written. A failure: what streamed is kept, and the end says why. Else the reply is saved whole.
      if (stop.signal.aborted) await rig.host.stop(generation, read.content);
      else if (read.error !== null || read.status !== 200) await rig.host.finish(generation, read.content, { error: read.error?.message ?? `status ${read.status}` });
      else await rig.host.finish(generation, read.content);
      return { generation, ...read };
    },
    close() {
      clearInterval(ticker);
      runtime.shutdown();
      runtime.close();
      close();
    },
  });
  await runtime.link.connect();
  // Pieces of a reply aren't held back: each reaches Lumiverse as it is released.
  await bed.page("lah.settings.set", { set: [{ path: ["transport", "streams", "coalesceMs"], value: 0 }], reset: [] });
  const minted = await bed.page<{ key: string | null; connection: { id: string } | null }>("lah.key", { op: "mint" });
  if (minted.key === null || minted.connection === null) throw new Error(`the runtime didn't make the loopback connection; the backend's log:\n${bed.logs.slice(-12).join("\n")}`);
  out.key = minted.key;
  return out;
}

/**
 * One request to the loopback endpoint, as Lumiverse's provider code sends one, read to its end: a
 * streamed completion piece by piece, an error in its own words. An aborted request gives what came
 * before the abort.
 */
async function post(fetch: Runtime["fetch"], body: JsonObject, key: string, signal: AbortSignal, onPiece: (text: string) => void): Promise<Omit<Replied, "generation">> {
  const out: Omit<Replied, "generation"> = { content: "", reasoning: "", status: 0, error: null, finish: null };
  type Wire = { error?: { message?: string; code?: string }; choices?: { delta?: { content?: string; reasoning?: string }; message?: { content?: string }; finish_reason?: string | null }[] };
  try {
    const response = await fetch(new Request(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", host: `127.0.0.1:${PORT}` }, body: JSON.stringify(body), signal }));
    out.status = response.status;
    if (response.headers.get("content-type")?.includes("text/event-stream") !== true) {
      const whole = (await response.json()) as Wire;
      if (whole.error) out.error = { message: whole.error.message ?? "", code: whole.error.code ?? "" };
      out.content = whole.choices?.[0]?.message?.content ?? "";
      out.finish = whole.choices?.[0]?.finish_reason ?? null;
      return out;
    }
    if (response.body === null) return out;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    const cancel = (): void => void reader.cancel().catch(() => undefined);
    signal.addEventListener("abort", cancel, { once: true });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      for (let at = buffered.indexOf("\n\n"); at >= 0; at = buffered.indexOf("\n\n")) {
        const event = buffered.slice(0, at);
        buffered = buffered.slice(at + 2);
        const data = event
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice(6);
        if (data === undefined || data === "[DONE]") continue;
        const piece = JSON.parse(data) as Wire;
        if (piece.error) out.error = { message: piece.error.message ?? "", code: piece.error.code ?? "" };
        const choice = piece.choices?.[0];
        if (choice?.delta?.content) {
          out.content += choice.delta.content;
          onPiece(choice.delta.content);
        }
        if (choice?.delta?.reasoning) out.reasoning += choice.delta.reasoning;
        if (choice?.finish_reason) out.finish = choice.finish_reason;
      }
    }
    signal.removeEventListener("abort", cancel);
  } catch (error) {
    if (!signal.aborted) throw error;
  }
  return out;
}
