// The loopback relay's server side (DEPTH-PLAN §3): an OpenAI-compatible endpoint for core's Custom
// connection. `POST /v1/chat/completions` becomes a call LumiRPEngine answers (a tagged request is
// a turn's `begin`, anything else `passthrough`), and the call's chunks become SSE or one JSON
// answer (loopback-sse.ts). `GET /v1/models` lists the loopback's model once the key checks out;
// `GET /healthz` says how the relay is. It holds no key, no story and makes no model call: the key
// each request carries goes to LumiRPEngine with it and is never kept.
//
// The handler takes and gives the web's Request and Response, so Bun.serve runs it (main.ts) and the
// tests call it directly. Time comes from `now()`, and `tick()` (every second) keeps streams alive,
// asks again after a gap, and gives up calls that stalled or whose link stayed down.

import type { JsonObject } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { AbortReason, LoopbackChunkPush, LoopbackRequest, LoopbackResultBodies, OpenCall, RelayMode } from "../shared/loopback";
import { LOOPBACK_MAX_BODY_BYTES, LOOPBACK_MODEL, SHARED_PASSTHROUGH_PER_MINUTE, TURN_PARAM, terminal } from "../shared/loopback";
import { LiveError, LreError } from "./connection";
import type { KeepAlive } from "./loopback-sse";
import { JsonAnswer, SSE_HEADERS, SseAnswer, errorJson, statusOf } from "./loopback-sse";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** The requests the relay sends for its calls; the link sends `hello` and `ping` itself. */
export type CallRequestType = Exclude<LoopbackRequest["type"], "lre.loopback.register" | "lre.loopback.hello" | "lre.loopback.ping">;
/** A request's own fields: the envelope and the secret are the link's. */
export type CallFields<T extends CallRequestType> = DistributiveOmit<Extract<LoopbackRequest, { type: T }>, "lre" | "type" | "reqId" | "secret">;

/**
 * Why LumiRPEngine is out of reach: the link down; LumiRPEngine silent (asked, unanswered, nothing
 * heard); stopped by Lumiverse (restart, update, disable); or crashed (Lumiverse reported an error,
 * then nothing heard), which Lumiverse never restarts by itself.
 */
export interface OutOfReach {
  since: number;
  why: "down" | "silent" | "stopped" | "crashed";
  /** A crash's words, as Lumiverse reported them. */
  detail?: string | null;
}

/** What the relay needs of its link to LumiRPEngine (loopback-link.ts). */
export interface RelayLink {
  /** The socket is open and the relay said hello on it. */
  readonly up: boolean;
  /** LumiRPEngine out of reach, since when and why; null while it answers. */
  readonly out: OutOfReach | null;
  /** Why the link can't serve at all (its registration is gone), or null. */
  readonly refused: string | null;
  /** One request, sent once the link is up (waiting `waitMs` at most), with the relay's secret. */
  request<T extends CallRequestType>(type: T, fields: CallFields<T>, waitMs: number): Promise<LoopbackResultBodies[T]>;
}

/** Words for a reply that LumiRPEngine's stop or crash ended or kept from starting. */
export function stoppedWords(why: "stopped" | "crashed", detail: string | null | undefined): string {
  if (why === "stopped") return "LumiRPEngine was stopped on Lumiverse (restarted, updated or turned off), so this reply ended here. Press Retry, or swipe, once it runs again (Lumiverse's Extensions tab).";
  const said = detail?.replace(/\s+/g, " ").trim().slice(0, 200) ?? "";
  return `LumiRPEngine stopped with an error${said !== "" ? ` (${said})` : ""}, so this reply ended here. Lumiverse doesn't restart it by itself: restart it in Lumiverse's Extensions tab, then press Retry.`;
}

export interface RelaySettings extends KeepAlive {
  /** The address and port it serves on: a request's Host must name them (no DNS rebinding), unless the address is a wildcard (`0.0.0.0`, `::`), which names none of the machine's own. */
  listen: string;
  port: number;
  mode: RelayMode;
  /** A call with no chunk this long is given up. */
  stallMs: number;
  /** LumiRPEngine out of reach this long (or since the call began, if later) ends the call. */
  lostMs: number;
  /** While calls are open the link pings this often, naming them, so a worker restart ends them. */
  probeMs: number;
  /** A request unanswered this long, with nothing heard meanwhile, counts LumiRPEngine silent. */
  silentMs: number;
  /** After Lumiverse reports an error in LumiRPEngine, silence this long counts it crashed. */
  crashMs: number;
  /** How long a gap waits before `resend` is asked again. */
  resendMs: number;
  /** The largest body it forwards: Lumiverse drops a socket frame over 4 MiB without a word. */
  maxBodyBytes: number;
  /** In `shared` mode, untagged requests per key per minute (DEPTH-PLAN §3.11): LumiRPEngine holds each user to `SHARED_PASSTHROUGH_PER_MINUTE` whatever this says, so it can only lower that. */
  passthroughPerMinute: number;
}

export const RELAY_DEFAULTS = {
  commentMs: 5_000,
  progressMs: 60_000,
  stallMs: 30 * 60_000,
  lostMs: 120_000,
  probeMs: 15_000,
  silentMs: 45_000,
  crashMs: 10_000,
  resendMs: 3_000,
  maxBodyBytes: LOOPBACK_MAX_BODY_BYTES,
  passthroughPerMinute: SHARED_PASSTHROUGH_PER_MINUTE,
} as const;

/** How many times a gap is asked about before the call is given up. */
const RESEND_TRIES = 5;
/** Chunks between acks while a call runs (its terminal chunk is always acked). */
const ACK_EVERY = 64;
/** How long a `models` request waits for the link. */
const MODELS_WAIT_MS = 10_000;

export interface RelayEnv {
  now(): number;
  /** 128 random bits as hex: a call's name. */
  id(): string;
  log(text: string): void;
  /** A key's fingerprint for the shared relay's log and limits: never the key. */
  fingerprint(key: string): Promise<string>;
}

interface Call {
  id: string;
  answer: SseAnswer | JsonAnswer;
  /** Closes the SSE body, or answers the JSON request. */
  settle(): void;
  /** `begin`/`passthrough`, from sending to its answer (or failure). */
  started: Promise<boolean>;
  /** LumiRPEngine answered its start: only then is it LumiRPEngine's to resume after a reconnect. */
  begun: boolean;
  /** The seq it waits for. */
  next: number;
  held: Map<number, LoopbackChunkPush["chunk"]>;
  /** When LumiRPEngine last said anything of it. */
  heard: number;
  gap: { asked: number; tries: number } | null;
  sinceAck: number;
  /** When core's request came. */
  at: number;
  ended: boolean;
}

const encoder = new TextEncoder();

function json(status: number, body: JsonObject, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/** A failure's words and code: LumiRPEngine's own (`lre.error`), the link's, or the relay's. */
function problemOf(error: unknown): { message: string; code: string } {
  if (error instanceof LreError) return { message: error.message, code: error.code };
  if (error instanceof LiveError) {
    // The connection's words name the CLI's own commands; the relay has its own.
    if (error.problem === "login") return { message: "The loopback's Lumiverse session has ended, so it can't reach LumiRPEngine. Sign it in again on the machine it runs on: lumirpengine loopback login (LumiRPEngine → Settings → Loopback shows the line).", code: "login" };
    if (error.problem === "timeout") return { message: "LumiRPEngine didn't answer the loopback in time: it may be restarting or busy. Press Retry in a moment.", code: "timeout" };
    return { message: `The loopback couldn't reach LumiRPEngine: ${error.message}`, code: error.problem === "forbidden" ? "unreachable" : error.problem };
  }
  return { message: error instanceof Error ? error.message : String(error), code: "internal" };
}

const LOOPBACK_HOSTS: Record<string, true> = { "127.0.0.1": true, localhost: true, "[::1]": true, "::1": true };
/** Addresses that listen on every one of the machine's: a relay on one is reached by whatever names the machine has, so there is none to hold the Host to. */
const WILDCARD_HOSTS: Record<string, true> = { "0.0.0.0": true, "::": true, "[::]": true };

export class Relay {
  private readonly calls = new Map<string, Call>();
  /** In `shared` mode: each key's untagged requests in the last minute, by fingerprint. */
  private readonly passthroughs = new Map<string, number[]>();

  constructor(
    private readonly link: RelayLink,
    private readonly settings: RelaySettings,
    private readonly env: RelayEnv,
  ) {}

  /** The calls under way. */
  get count(): number {
    return this.calls.size;
  }

  /** The calls to resume after a reconnect, with the last chunk each holds in order (loopback hello). One whose start is still unanswered is sent again instead. */
  open(): OpenCall[] {
    return [...this.calls.values()].filter((c) => c.begun).map((c) => ({ call: c.id, seq: c.next - 1 }));
  }

  /** LumiRPEngine no longer holds these calls: it restarted mid-reply (DEPTH-PLAN §3.14), with the relay's socket up or not. */
  lost(ids: readonly string[]): void {
    for (const id of ids) {
      const call = this.calls.get(id);
      if (call) this.end(call, { message: "LumiRPEngine restarted during this reply, so it stopped here. Press Retry, or swipe.", code: "lost" }, null);
    }
  }

  /** A chunk of a call: in order it goes out at once; ahead of a gap it waits, and the gap is asked for. */
  chunk(push: LoopbackChunkPush): void {
    const call = this.calls.get(push.call);
    if (call === undefined || call.ended) return;
    call.heard = this.env.now();
    if (push.seq < call.next || call.held.has(push.seq)) return;
    call.held.set(push.seq, push.chunk);
    for (let chunk = call.held.get(call.next); chunk !== undefined && !call.ended; chunk = call.held.get(call.next)) {
      call.held.delete(call.next);
      call.next++;
      this.deliver(call, chunk);
    }
    if (call.ended) return;
    if (call.held.size === 0) call.gap = null;
    else if (call.gap === null) this.askAgain(call);
  }

  /**
   * Every second: keep streams alive, ask again after a gap, and give up what stalled, or what
   * LumiRPEngine stayed out of reach for (its link down, or LumiRPEngine silent: a hung or restarted
   * worker never leaves a turn to core's 10-minute watchdog). Progress lines are restated only while
   * LumiRPEngine answers, so they never claim work that isn't happening.
   */
  tick(): void {
    const now = this.env.now();
    const up = this.link.up;
    const out = this.link.out;
    const refused = this.link.refused;
    for (const call of [...this.calls.values()]) {
      if (call.ended) continue;
      if (refused !== null) {
        this.end(call, { message: `The loopback can't carry this reply: ${refused}.`, code: "revoked" }, null);
        continue;
      }
      // Each call gets the whole allowance from when it came, however long LumiRPEngine was out before.
      if (out !== null && now - Math.max(out.since, call.at) >= this.settings.lostMs) {
        const seconds = Math.round((now - Math.max(out.since, call.at)) / 1000);
        const problem =
          out.why === "silent"
            ? { message: `LumiRPEngine stopped answering the loopback during this reply (nothing for ${seconds} s): it may have restarted or hung. Press Retry, or swipe.`, code: "stalled" }
            : out.why === "down"
              ? { message: `The loopback lost its connection to Lumiverse for ${seconds} s during this reply. Press Retry once it is back (lumirpengine loopback status says how it is).`, code: "lost" }
              : { message: stoppedWords(out.why, out.detail), code: "unavailable" };
        // A stopped or crashed LumiRPEngine has nothing to abort.
        this.end(call, problem, out.why === "silent" ? "stalled" : out.why === "down" ? "lost" : null);
        continue;
      }
      if (up && call.gap !== null && now - call.gap.asked >= this.settings.resendMs) {
        if (call.gap.tries >= RESEND_TRIES) {
          this.end(call, { message: `Part of this reply never reached the loopback (chunk ${call.next} is missing). Press Retry.`, code: "lost" }, "lost");
          continue;
        }
        this.askAgain(call);
      }
      if (out === null && now - call.heard >= this.settings.stallMs) {
        this.end(call, { message: `LumiRPEngine sent nothing for this reply in ${Math.round(this.settings.stallMs / 60_000)} minutes, so the loopback gave it up. Press Retry.`, code: "stalled" }, "stalled");
        continue;
      }
      if (call.answer instanceof SseAnswer) call.answer.keepAlive(now, out === null, this.settings);
    }
  }

  /** The relay is stopping: every call ends with words the chat shows. */
  shutdown(): void {
    for (const call of [...this.calls.values()]) this.end(call, { message: "The loopback is restarting. LumiRPEngine keeps the turn: press Retry in a moment.", code: "unavailable" }, "shutdown");
  }

  /** Lumiverse stopped LumiRPEngine, or it crashed: every call ends at once, in words, with nothing to abort. */
  stopped(why: "stopped" | "crashed", detail: string | null): void {
    for (const call of [...this.calls.values()]) this.end(call, { message: stoppedWords(why, detail), code: "unavailable" }, null);
  }

  /** Bun.serve's handler. */
  readonly fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    // Core's own fetch sends no Origin; a page in a browser always does, so it never drives the relay.
    if (req.headers.get("origin") !== null) return json(403, errorJson("LumiRPEngine's loopback answers Lumiverse's server, not a browser.", "forbidden"));
    if (!this.hostAllowed(req.headers.get("host"))) return json(421, errorJson(`This is LumiRPEngine's loopback at ${this.settings.listen}:${this.settings.port}; it answers requests addressed to it alone.`, "misdirected"));
    const path = url.pathname.replace(/\/+$/, "").replace(/^\/v1(?=\/)/, "");
    if (path === "/healthz" && req.method === "GET") {
      // `link`: up, or why LumiRPEngine is out of reach (down, silent, stopped, crashed), or refused.
      const out = this.link.out;
      return json(200, { ok: this.link.refused === null, link: this.link.refused !== null ? "refused" : (out?.why ?? (this.link.up ? "up" : "down")), calls: this.calls.size, mode: this.settings.mode, ...(this.link.refused !== null ? { problem: this.link.refused } : out?.why === "stopped" || out?.why === "crashed" ? { problem: stoppedWords(out.why, out.detail) } : {}) });
    }
    if (path === "/models" && req.method === "GET") return this.models(req);
    if (path === "/chat/completions" && req.method === "POST") return this.completions(req);
    return json(404, errorJson(`LumiRPEngine's loopback has no ${req.method} ${url.pathname}: it serves POST /v1/chat/completions and GET /v1/models.`, "not_found"));
  };

  /** Whether the request is addressed to this relay (no DNS rebinding): its Host names the relay's own address and port, any loopback name for a loopback address; any Host on a wildcard address. */
  private hostAllowed(host: string | null): boolean {
    if (host === null) return false;
    const listen = this.settings.listen.toLowerCase();
    if (hasOwn(WILDCARD_HOSTS, listen)) return true;
    const at = host.lastIndexOf(":");
    const ported = at > 0 && !host.endsWith("]");
    const name = (ported ? host.slice(0, at) : host).toLowerCase();
    if ((ported ? Number(host.slice(at + 1)) : 80) !== this.settings.port) return false;
    return hasOwn(LOOPBACK_HOSTS, listen) ? hasOwn(LOOPBACK_HOSTS, name) : name === listen || name === `[${listen}]`;
  }

  private keyOf(req: Request): string | null {
    const auth = req.headers.get("authorization") ?? "";
    const key = /^Bearer\s+(.+)$/i.exec(auth.trim())?.[1]?.trim() ?? "";
    return key === "" ? null : key;
  }

  private noKey(): Response {
    return json(401, errorJson("This is LumiRPEngine's loopback: set the connection's API key to your loopback key (LumiRPEngine → Settings → Loopback).", "invalid_api_key"));
  }

  private async models(req: Request): Promise<Response> {
    const key = this.keyOf(req);
    if (key === null) return this.noKey();
    if (this.link.refused !== null) return json(503, errorJson(this.link.refused, "revoked"));
    try {
      const { models } = await this.link.request("lre.loopback.models", { key }, MODELS_WAIT_MS);
      return json(200, { object: "list", data: models.map((m) => ({ id: m.id, object: "model", created: 0, owned_by: "lumirpengine" })) });
    } catch (error) {
      const p = problemOf(error);
      // A key LumiRPEngine refused reads as a bad key to the connection's Test.
      const badKey = error instanceof LreError && error.code === "forbidden";
      return json(badKey ? 401 : statusOf(p.code), errorJson(p.message, badKey ? "invalid_api_key" : p.code));
    }
  }

  private async completions(req: Request): Promise<Response> {
    const key = this.keyOf(req);
    if (key === null) return this.noKey();
    const length = Number(req.headers.get("content-length") ?? "0");
    const tooLarge = (bytes: number): Response => json(413, errorJson(`This request is ${(bytes / 1048576).toFixed(1)} MiB, and the loopback carries at most ${(this.settings.maxBodyBytes / 1048576).toFixed(1)} MiB (Lumiverse's socket drops larger frames). Lower the connection's context size.`, "too_large"));
    if (length > this.settings.maxBodyBytes) return tooLarge(length);
    // Counted as it arrives, so a body sent without Content-Length stops at the cap instead of being read whole.
    const parts: Uint8Array[] = [];
    let bytes = 0;
    if (req.body !== null) {
      const reader = req.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > this.settings.maxBodyBytes) {
          void reader.cancel().catch(() => {});
          return tooLarge(bytes);
        }
        parts.push(value);
      }
    }
    const text = new TextDecoder().decode(Buffer.concat(parts));
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, errorJson("The request body isn't JSON.", "invalid_request"));
    }
    if (!isRecord(body) || !Array.isArray(body.messages)) return json(400, errorJson("The request isn't a chat completion: it has no messages.", "invalid_request"));
    const tag = body[TURN_PARAM];
    if (tag !== undefined && (typeof tag !== "string" || tag === "")) return json(400, errorJson(`${TURN_PARAM} must be the turn's token.`, "invalid_request"));
    const forwarded = { ...body } as JsonObject;
    delete forwarded[TURN_PARAM];
    if (this.link.refused !== null) return json(503, errorJson(this.link.refused, "revoked"));
    if (tag === undefined && this.settings.mode === "shared") {
      const limited = await this.limited(key, bytes, typeof body.model === "string" ? body.model : "");
      if (limited !== null) return limited;
    }
    const now = this.env.now();
    const id = this.env.id();
    const completion = { id: `chatcmpl-${id.slice(0, 24)}`, model: typeof body.model === "string" && body.model !== "" ? body.model : LOOPBACK_MODEL, created: Math.floor(now / 1000) };
    const jsonAnswer = new JsonAnswer(completion);
    const call: Call = { id, answer: jsonAnswer, settle: () => undefined, started: Promise.resolve(false), begun: false, next: 1, held: new Map(), heard: now, gap: null, sinceAck: 0, at: now, ended: false };
    // Core's Stop force-closes the request (F19): the relay hears it here, or as the body's cancel.
    req.signal.addEventListener("abort", () => this.closed(call), { once: true });
    if (body.stream === true) {
      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => {
          let open = true;
          const write = (piece: string): void => {
            if (!open) return;
            try {
              controller.enqueue(encoder.encode(piece));
            } catch {
              // The client is gone; its cancel ends the call.
              open = false;
            }
          };
          call.answer = new SseAnswer(completion, write, now);
          call.settle = () => {
            if (!open) return;
            open = false;
            try {
              controller.close();
            } catch {
              // Cancelled under it: nothing left to close.
            }
          };
        },
        cancel: () => this.closed(call),
      });
      this.begin(call, typeof tag === "string" ? tag : null, key, forwarded);
      return new Response(stream, { status: 200, headers: SSE_HEADERS });
    }
    const { promise, resolve } = Promise.withResolvers<Response>();
    call.settle = () => {
      const answer = jsonAnswer.answer;
      resolve(answer === null ? json(500, errorJson("The loopback ended this call without an answer.", "internal")) : json(answer.status, answer.body));
    };
    this.begin(call, typeof tag === "string" ? tag : null, key, forwarded);
    return promise;
  }

  /** The shared relay's limit on untagged requests per key, logged by fingerprint (DEPTH-PLAN §3.11). */
  private async limited(key: string, bytes: number, model: string): Promise<Response | null> {
    const print = await this.env.fingerprint(key);
    const now = this.env.now();
    const recent = (this.passthroughs.get(print) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= this.settings.passthroughPerMinute) {
      this.passthroughs.set(print, recent);
      this.env.log(`passthrough refused for key ${print}: over ${this.settings.passthroughPerMinute} a minute`);
      return json(429, errorJson(`The shared loopback carries at most ${this.settings.passthroughPerMinute} untagged requests a minute per key. Wait a minute.`, "rate_limited"), { "Retry-After": "60" });
    }
    recent.push(now);
    this.passthroughs.set(print, recent);
    this.env.log(`passthrough for key ${print}: ${bytes} bytes${model ? `, model ${model}` : ""}`);
    return null;
  }

  /** Sends the call's `begin` (a tagged request) or `passthrough`, again after a dropped link, until it is answered. */
  private begin(call: Call, token: string | null, key: string, body: JsonObject): void {
    this.calls.set(call.id, call);
    const send = async (): Promise<boolean> => {
      const first = this.env.now();
      for (;;) {
        try {
          if (token !== null) {
            const { turn } = await this.link.request("lre.loopback.begin", { call: call.id, token, key, body }, this.settings.lostMs);
            call.answer.turn = turn;
          } else await this.link.request("lre.loopback.passthrough", { call: call.id, key, body }, this.settings.lostMs);
          call.heard = this.env.now();
          call.begun = true;
          return true;
        } catch (error) {
          // A socket that closed under the request may or may not have delivered it: both are idempotent per call, so it goes again.
          if (error instanceof LiveError && error.problem === "closed" && !call.ended && this.env.now() - first < this.settings.lostMs) continue;
          this.end(call, problemOf(error), null);
          return false;
        }
      }
    };
    call.started = send();
  }

  private deliver(call: Call, chunk: LoopbackChunkPush["chunk"]): void {
    if (call.answer instanceof SseAnswer) call.answer.chunk(chunk, this.env.now());
    else call.answer.chunk(chunk);
    const seq = call.next - 1;
    if (terminal(chunk)) {
      this.finish(call);
      void this.link.request("lre.loopback.ack", { call: call.id, seq }, 0).catch(() => undefined);
      return;
    }
    if (++call.sinceAck >= ACK_EVERY) {
      call.sinceAck = 0;
      void this.link.request("lre.loopback.ack", { call: call.id, seq }, 0).catch(() => undefined);
    }
  }

  private askAgain(call: Call): void {
    call.gap = { asked: this.env.now(), tries: (call.gap?.tries ?? 0) + 1 };
    void this.link.request("lre.loopback.resend", { call: call.id, from: call.next }, 0).catch(() => undefined);
  }

  private finish(call: Call): void {
    call.ended = true;
    this.calls.delete(call.id);
    call.settle();
  }

  /** Ends a call on the relay's side: its words to the chat, and LumiRPEngine told why (`reason`) once its start was answered. */
  private end(call: Call, problem: { message: string; code: string }, reason: AbortReason | null): void {
    if (call.ended) return;
    if (call.answer instanceof SseAnswer) call.answer.fail(problem.message, problem.code, this.env.now());
    else call.answer.fail(problem.message, problem.code);
    this.finish(call);
    if (reason !== null) this.abort(call, reason);
  }

  /** Core closed the request (Stop, F19): LumiRPEngine stops the turn between beats (DEPTH-PLAN §3.10). */
  private closed(call: Call): void {
    if (call.ended) return;
    this.finish(call);
    this.abort(call, "closed");
  }

  /** Told after the call's start was answered, so an abort never overtakes its begin. */
  private abort(call: Call, reason: AbortReason): void {
    void call.started.then((started) => {
      if (started) return this.link.request("lre.loopback.abort", { call: call.id, reason }, this.settings.lostMs);
    }).catch((error: unknown) => this.env.log(`abort of call ${call.id.slice(0, 8)} wasn't delivered: ${error instanceof Error ? error.message : String(error)}`));
  }
}
