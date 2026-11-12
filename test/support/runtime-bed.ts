// LumiAH's runtime beside the backend the engine mounts, as a chat the engine plays needs it: the real
// runtime (`createRuntime`, the core's own harness in it) linked to the real backend `mountHarness`
// builds into the engine, over the rig's fake Lumiverse. What a runtime asks of Lumiverse itself is made
// up here: its HTTP routes (the session, the user's connections, a stop, and the chat routes its own
// copy of a chat reads, answered from the very rows the seat's host reads: `lumiverse-rows.ts`) and the
// event socket its link travels, which Lumiverse carries between the runtime and the backend like a
// page's messages; and Lumiverse's proxy reaches the runtime's loopback server, once a test grants
// `cors_proxy`. The runtime's copy never asks for a world book (the mount gives LumiAH none): the bed
// answers such a request as for a book that isn't there, and keeps it among the requests, where a test
// finds it.
//
// The runtime calls its agents' models itself, on its own connections, through its own model layer:
// the bed sets the runtime up as a player does (its loopback key minted, which has it make the chat's
// loopback connection in Lumiverse, and one connection of its own made on its Runtime page), and the
// layer's providers answer from the seat's `script` (`runtime-models.ts`). Nothing here is a model.
//
// A reply runs as Lumiverse runs one on a chat whose connection is the runtime's loopback: the
// generation starts (the engine's guard asks whether the harness can play it), the interceptors
// answer (LumiAH's tags the request), the request goes to the loopback, the reply is read as it
// streams, and Lumiverse saves it (or keeps what was written, on a Stop) and says it ended.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "lumi-ah/core";
import { LINK, RUNTIME_DEFAULTS, type RuntimeTuning } from "lumi-ah/link";
import { createRuntime, createUpdate, type Http, type HttpReply, type OpenSocket, type Runtime, type RuntimeConfig, type RuntimeDeps, type Update, type UpdateDeps } from "lumi-ah/runtime";
import type { HostGenerationType } from "../../src/backend/host";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { Generation } from "./fake-host";
import { type Bed, lumiahBed, type Seat } from "./lumiah-bed";
import type { Rig } from "./rig";
import { lumiverseRows } from "./lumiverse-rows";
import { scriptedModels } from "./runtime-models";

/** Where the fake Lumiverse is, and where the engine's runtime serves its loopback (a second runtime a test links serves on a port of its own). */
const BASE = "http://127.0.0.1:7860";
const PORT = 7871;

/** The engine's id in this Lumiverse (its database id), which the socket's frames are addressed by. */
const EXTENSION_ID = "ext-lumirpengine";

/** The user's session token, which the runtime signs in with. */
const TOKEN = "session-token-bed";

/** The runtime's own connection, as a player makes it on the Runtime page: the first, so its default, which every agent runs on unless Settings names another. Its key is made up. */
const CONNECTION = { name: "Main", provider: "openai", auth: "key", model: "test-model" } as const;
const KEY = "sk-bed-made-up-0123456789abcdef";

/** The runtime's timings for a test: nothing waits, so a test takes no longer than its work. */
const FAST: RuntimeTuning = { ...RUNTIME_DEFAULTS, traceMs: 0, reconnectMs: 5, reconnectMaxMs: 20, stopGraceMs: 0 };

const reply = (status: number, body: unknown): HttpReply => ({ status, header: () => null, text: typeof body === "string" ? body : JSON.stringify(body) });

let sessions = 0;

/** The runtimes' own folders (`RuntimeDeps.dir`): each is taken away once its runtime has closed, and any left when the process ends. */
const folders = new Set<string>();
process.once("exit", () => {
  for (const dir of folders) rmSync(dir, { recursive: true, force: true });
});

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

/** A runtime linked to one seat's backend, and the test's hands on it. */
export interface Linked {
  runtime: Runtime;
  /** The loopback key, once minted. */
  key: string;
  /** The runtime's own connection, its default, by its id: what Settings may name for an agent. */
  connection: string;
  /** Every piece of every reply as it reached Lumiverse, in order. */
  pieces: string[];
  /** Every frame the backend sent the runtime over its link, in order: answers and pushes. */
  received: unknown[];
  /** Every request the runtime made of Lumiverse's HTTP routes, in order, as `METHOD path?query`. */
  asked: string[];
  /**
   * One reply in a chat whose connection is the runtime's, as Lumiverse runs it (see the header):
   * `type` the kind of generation, `signal` Lumiverse's Stop. Halted before its request (the guard
   * stopped it), it comes back with nothing read.
   */
  reply(chatId: string, options?: { type?: HostGenerationType; signal?: AbortSignal }): Promise<Replied>;
  /** Stops the runtime: what it saved goes to the extension's storage first while its link is up; its folder goes once it has closed. */
  close(): void;
}

/** LumiAH's runtime linked to the backend the engine mounts, and the test's hands on both. */
export interface RuntimeBed extends Bed, Linked {}

/**
 * The runtime's update, as `lumiah serve` builds one, for a runtime set up before it could update
 * itself: it records no file it was set up from, so every offer is refused with words and nothing on
 * the disk is touched.
 */
function updateOf(config: RuntimeConfig, build: string, busy: () => boolean): Update {
  const installed = `/home/${config.name}/.local/share/lumiah/lumiah.js`;
  let saved: ReturnType<UpdateDeps["config"]> = { ...config, memory: "1G", autoUpdate: true, source: null, service: null };
  return createUpdate({
    config: () => saved,
    save: (change) => {
      saved = { ...saved, ...change };
    },
    configPath: `/home/${config.name}/.config/lumiah/${config.name}.json`,
    build,
    bun: null,
    self: installed,
    installed,
    service: null,
    platform: "linux",
    container: false,
    env: {},
    uid: 1000,
    files: { read: () => null, write: () => undefined, mode: () => null, rename: () => undefined, remove: () => undefined, real: (path) => path },
    run: async () => ({ code: 0, out: "", err: "" }),
    leave: () => undefined,
    busy,
    now: () => Date.now(),
    log: () => undefined,
    name: () => "LumiRPEngine",
    owner: () => ({ name: "LumiRPEngine" }),
    buildStartMs: () => 30_000,
    handedOver: false,
    waitingCopy: () => null,
  });
}

/**
 * A runtime linked to `seat`'s backend, set up as a player sets one up: registered and linked, its
 * loopback key minted (it makes the chat's loopback connection), and its own connection made on its
 * Runtime page. `at`: where it serves (`port`), the extension's id in Lumiverse (`extensionId`) and
 * the runtime's name, for a second extension's runtime beside the engine's; and where its reads of
 * chats go (`reads`: its own copy unless said, as a runtime runs).
 */
export async function linkRuntime(rig: Rig, seat: Seat, at: { port?: number; extensionId?: string; name?: string; reads?: RuntimeDeps["reads"] } = {}): Promise<Linked> {
  const port = at.port ?? PORT;
  const extensionId = at.extensionId ?? EXTENSION_ID;
  const name = at.name ?? "bed";
  const userId = rig.host.userId;
  const generating = new Map<string, { chatId: string; stop: AbortController }>();
  const keys = new Map<string, string>();
  const received: unknown[] = [];
  const asked: string[] = [];
  const rows = lumiverseRows(rig.host);
  let made = 0;

  const http: Http = async (request) => {
    const url = new URL(request.url);
    const path = url.pathname;
    asked.push(`${request.method} ${path}${url.search}`);
    if (request.headers.Authorization !== `Bearer ${TOKEN}`) return reply(401, { error: "Unauthorized" });
    if (path === "/api/v1/spindle" && request.method === "GET") return reply(200, { extensions: [{ id: extensionId, identifier: seat.base.identifier, version: "0.0.1", enabled: true, status: "running" }] });
    if (path === "/api/v1/ws-ticket" && request.method === "POST") return reply(200, { ticket: `ticket-${++made}` });
    if (path === "/api/auth/get-session") return reply(200, { session: { expiresAt: "2099-01-01T00:00:00.000Z" }, user: { id: userId } });
    if (path === "/api/v1/connections" && request.method === "GET") return reply(200, { data: seat.connections.map((c) => ({ id: c.id, name: c.name, provider: c.provider, api_url: c.url, model: c.model })) });
    if (path === "/api/v1/connections" && request.method === "POST") {
      const body: unknown = JSON.parse(request.body ?? "{}");
      const text = (key: string): string => (isRecord(body) && typeof body[key] === "string" ? body[key] : "");
      const connection = { id: `conn-loop-${name}-${++made}`, name: text("name"), provider: text("provider"), url: text("api_url"), model: text("model"), isDefault: false, metadata: {} };
      seat.connections.push(connection);
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
      const said = (field: string): string => (isRecord(body) && typeof body[field] === "string" ? body[field] : "");
      // The generation named; else, as Lumiverse does for an id it no longer knows, whatever runs in the chat.
      const held = generating.get(said("generation_id")) ?? [...generating.values()].find((g) => g.chatId === said("chat_id"));
      held?.stop.abort();
      return reply(200, { stopped: held !== undefined });
    }
    // The chat routes the runtime's copy of a chat reads, as its signed-in user.
    const chat = request.method === "GET" ? rows.route(url, userId) : null;
    if (chat !== null) return reply(chat.status, chat.body);
    if (path.startsWith("/api/v1/world-books/")) return reply(404, { error: "World book not found" });
    return reply(404, { error: "Not found" });
  };

  // The event socket: the runtime's frames reach the backend as a session's messages, and what the backend sends that session comes back on the socket.
  const openSocket: OpenSocket = (url, events) => {
    const session = new URL(url).searchParams.get("frontend_session") ?? `runtime-${++sessions}`;
    let open = true;
    seat.outlet(session, (message) => {
      if (!open) return;
      received.push(message);
      events.message(JSON.stringify({ event: "SPINDLE_FRONTEND_MSG", payload: { extensionId, data: message } }));
    });
    queueMicrotask(() => events.message(JSON.stringify({ event: "CONNECTED" })));
    const shut = (): void => {
      if (!open) return;
      open = false;
      seat.closeSession(session);
    };
    return {
      send: (text) => {
        if (!open) return;
        const message = JSON.parse(text) as { type?: string; extensionId?: string; payload?: unknown };
        if (message.type === "SPINDLE_BACKEND_MSG" && message.extensionId === extensionId) seat.deliver(message.payload, session);
      },
      close: shut,
    };
  };

  // The runtime registers with the backend from a session of its own, as `lumiah up` does.
  const registering = `register-${++sessions}`;
  const registered = Promise.withResolvers<{ relay: string; secret: string }>();
  seat.outlet(registering, (message) => {
    const frame = isRecord(message) ? message : {};
    if (frame.link !== LINK || frame.id !== "register") return;
    const body = isRecord(frame.body) ? frame.body : {};
    if (frame.type === "result" && typeof body.relay === "string" && typeof body.secret === "string") registered.resolve({ relay: body.relay, secret: body.secret });
    else registered.reject(new Error(`the runtime's registration was refused: ${String(frame.message)}`));
  });
  seat.deliver({ link: LINK, id: "register", type: "register", name, build: seat.env.build, host: "bed-box", listen: "127.0.0.1", port }, registering);
  const { relay, secret } = await registered.promise;
  seat.closeSession(registering);

  const dir = mkdtempSync(join(tmpdir(), "lre-runtime-"));
  folders.add(dir);
  let held = secret;
  const config: RuntimeConfig = { name, base: BASE, extension: seat.base.identifier, listen: "127.0.0.1", port, relay, secret, session: { username: name, token: TOKEN, savedAt: 0 }, tuning: FAST };
  const runtime = createRuntime(config, {
    http,
    openSocket,
    now: () => Date.now(),
    log: (text) => void seat.logs.push(`runtime: ${text}`),
    build: seat.env.build,
    ran: { bun: null, script: "lumiah.js", unit: null },
    host: "bed-box",
    dir,
    models: scriptedModels(seat),
    credentials: () => ({ username: name, token: TOKEN, savedAt: 0 }),
    secret: () => held,
    rotated: (next) => {
      held = next;
    },
    keepTuning: () => undefined,
    // Where a setting of the core's is changed, as the runtime names it from the extension it links to: its words for a wait that ran out say it.
    harness: (harnessHost, settings, extension, place) => createHarness(harnessHost, { settings, extension, place }),
    ...(at.reads !== undefined ? { reads: at.reads } : {}),
    writerConnection: () => null,
    update: (busy) => updateOf(config, seat.env.build, busy),
  });
  // Lumiverse's proxy reaches the runtime's loopback server on this machine.
  seat.serve(`http://127.0.0.1:${port}`, (request) => runtime.fetch(request));
  // The runtime's own clockwork, which `lumiah serve` runs every second, runs here every few milliseconds.
  const ticker = setInterval(() => runtime.tick(), 5);

  const linked: Linked = {
    runtime,
    key: "",
    connection: "",
    pieces: [],
    received,
    asked,
    async reply(chatId, options = {}) {
      const generation = await rig.host.begin(chatId, { type: options.type ?? "normal" });
      const nothing: Replied = { generation, content: "", reasoning: "", status: 0, error: null, finish: null };
      if (generation.halted !== undefined) return nothing;
      const stop = new AbortController();
      const stopped = (): void => stop.abort();
      if (options.signal?.aborted === true) stopped();
      else options.signal?.addEventListener("abort", stopped, { once: true });
      generating.set(generation.id, { chatId, stop });
      const loopback = seat.connections.find((c) => c.url.endsWith(`:${port}/v1`));
      const body: JsonObject = { model: loopback?.model ?? "", stream: true, messages: seat.prompt(generation.id).map((m) => ({ role: m.role, content: m.text })), temperature: 0.8, max_tokens: 600, ...(seat.parameters(generation.id) as JsonObject) };
      const read = await post(runtime.fetch, port, body, linked.key, stop.signal, (piece) => void linked.pieces.push(piece)).finally(() => {
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
      void runtime
        .close()
        .catch(() => undefined)
        .finally(() => {
          rmSync(dir, { recursive: true, force: true });
          folders.delete(dir);
        });
    },
  };
  await runtime.link.connect();
  const minted = await seat.page<{ key: string | null; connection: { id: string } | null }>("lah.key", { op: "mint" });
  if (minted.key === null || minted.connection === null) throw new Error(`the runtime didn't make the loopback connection; the backend's log:\n${seat.logs.slice(-12).join("\n")}`);
  linked.key = minted.key;
  const own = await seat.page<{ saved: { id: string } }>("lah.connections.save", { connection: { ...CONNECTION }, key: KEY });
  linked.connection = own.saved.id;
  return linked;
}

/**
 * The engine's rig with LumiAH's backend mounted in it and a runtime linked to that backend, set up
 * as a player sets one up (`linkRuntime`; `reads`, where its reads of chats go). The returned bed
 * closes the runtime with itself.
 */
export async function runtimeBed(rig: Rig, options: { reads?: RuntimeDeps["reads"] } = {}): Promise<RuntimeBed> {
  const bed = lumiahBed(rig);
  const linked = await linkRuntime(rig, bed, options);
  const closeSeat = bed.close;
  return Object.assign(bed, linked, {
    close() {
      linked.close();
      closeSeat();
    },
  });
}

/**
 * One request to the loopback endpoint at `port`, as Lumiverse's provider code sends one, read to its
 * end: a streamed completion piece by piece, an error in its own words. An aborted request gives what
 * came before the abort.
 */
async function post(fetch: Runtime["fetch"], port: number, body: JsonObject, key: string, signal: AbortSignal, onPiece: (text: string) => void): Promise<Omit<Replied, "generation">> {
  const out: Omit<Replied, "generation"> = { content: "", reasoning: "", status: 0, error: null, finish: null };
  type Wire = { error?: { message?: string; code?: string }; choices?: { delta?: { content?: string; reasoning?: string }; message?: { content?: string }; finish_reason?: string | null }[] };
  try {
    const response = await fetch(new Request(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", host: `127.0.0.1:${port}` }, body: JSON.stringify(body), signal }));
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
