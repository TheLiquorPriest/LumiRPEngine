// The relay's link to LumiRPEngine (DEPTH-PLAN §3.6): the CLI's own connection (connection.ts: the
// saved session as a bearer, a socket ticket, a widget session, `lre.hello`), then the loopback's
// hello with the relay's secret on every socket it opens, so LumiRPEngine sends the relay's pushes
// to that session and resumes the calls in flight from their last chunk. While down it reconnects
// with backoff; while up it pings every heartbeat with a report for Settings → Loopback, and every
// few seconds while it answers calls, naming them, so a worker restart under a live socket ends
// them at once (D0a check 4). It knows LumiRPEngine silent when something it asked goes unanswered
// with nothing heard meanwhile. Daily it asks Lumiverse about its session, which renews it (F31),
// and it keeps its origin in its account's local-inference scheduler exclusions (F28), again
// whenever Settings' Fix asks.

import { isRecord } from "../shared/json";
import type { LoopbackChunkPush, LoopbackRequest, LoopbackResultBodies, OpenCall, RelayReport, RelaySession, SchedulerState } from "../shared/loopback";
import { LOOPBACK_API, loopbackPushOf } from "../shared/loopback";
import type { Credentials, Http, LiveProblem, OpenSocket } from "./connection";
import { HostConnection, LiveError, LreError, sessionOf } from "./connection";
import type { CallFields, CallRequestType, OutOfReach, RelayLink } from "./loopback-relay";
import { stoppedWords } from "./loopback-relay";
import { CLI_NAME, CLI_VERSION } from "./version";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A loopback request's own fields, its secret included: the envelope (`lre`, `type`, `reqId`) is the connection's. */
type AskFields<T extends keyof LoopbackResultBodies> = DistributiveOmit<Extract<LoopbackRequest, { type: T }>, "lre" | "type" | "reqId">;
/** What the link hands the relay, and asks of it. */
export interface LinkHandlers {
  chunk(push: LoopbackChunkPush): void;
  /** The calls to resume on a new socket. */
  open(): OpenCall[];
  /** Calls LumiRPEngine no longer holds. */
  lost(calls: readonly string[]): void;
  /** Lumiverse stopped LumiRPEngine, or it crashed: every call ends at once. */
  stopped(why: "stopped" | "crashed", detail: string | null): void;
  readonly count: number;
}

export interface LinkOptions {
  base: string;
  credentials(): Credentials | null;
  http: Http;
  openSocket: OpenSocket;
  secret: string;
  name: string;
  build: string;
  runtime: RelayReport["runtime"];
  host: string;
  listen: string;
  port: number;
  now(): number;
  log(text: string): void;
  /** Each request's wait for LumiRPEngine's answer. */
  timeoutMs: number;
  /** How often it pings while it answers calls. */
  probeMs: number;
  /** How long a request may go unanswered, with nothing heard meanwhile, before LumiRPEngine counts as silent. */
  silentMs: number;
  /** After Lumiverse reports an error in LumiRPEngine, how long silence makes it a crash. */
  crashMs: number;
}

const DAY_MS = 24 * 60 * 60_000;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

/** Problems no wait mends: a request fails at once rather than wait for the link (a session that ended, an address locked out or refused, a LumiRPEngine missing or too old). */
const LASTING: Partial<Record<LiveProblem, true>> = { login: true, locked: true, forbidden: true, insecure: true, not_installed: true, too_old: true };

/** The calls an answer names, as strings: an answer from an older bridge may name none. */
const callsIn = (value: unknown): string[] => (Array.isArray(value) ? value.filter((c): c is string => typeof c === "string") : []);

/** The origins core's scheduler compares (its `normalizeEndpointOrigin`): scheme, lowercase host, port. On a loopback address, both names core may be given. */
export function relayOrigins(listen: string, port: number): string[] {
  const host = listen.includes(":") && !listen.startsWith("[") ? `[${listen}]` : listen.toLowerCase();
  if (host === "127.0.0.1" || host === "localhost") return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  return [`http://${host}:${port}`];
}

/**
 * Puts the relay's origins in the account's scheduler exclusions (`excludedOrigins`, core's
 * /api/v1/inference-scheduler/config): with the scheduler on, a loopback turn holds the local slot
 * while its own inner calls wait for it, a deadlock progress lines would keep alive (F28).
 */
export async function excludeOrigins(http: Http, base: string, token: string, origins: readonly string[]): Promise<SchedulerState> {
  const url = `${base}/api/v1/inference-scheduler/config`;
  const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };
  const listed = (text: string): string[] => {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return [];
    }
    const config = isRecord(body) && isRecord(body.config) ? body.config : body;
    return isRecord(config) && Array.isArray(config.excludedOrigins) ? config.excludedOrigins.filter((o): o is string => typeof o === "string") : [];
  };
  try {
    const got = await http({ method: "GET", url, headers });
    if (got.status === 404) return "unavailable";
    if (got.status !== 200) return "missing";
    const current = listed(got.text);
    if (origins.every((o) => current.includes(o))) return "excluded";
    const put = await http({ method: "PUT", url, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ excludedOrigins: [...current, ...origins.filter((o) => !current.includes(o))] }) });
    return put.status === 200 && origins.every((o) => listed(put.text).includes(o)) ? "excluded" : "missing";
  } catch {
    return "unknown";
  }
}

export class LoopbackLink implements RelayLink {
  private readonly conn: HostConnection;
  private handlers: LinkHandlers | null = null;
  /** Bumped by every `lre.hello` answer: a new socket, which needs the loopback hello. */
  private socketGen = 0;
  private greetedGen = -1;
  private connecting: Promise<void> | null = null;
  private failures = 0;
  private retryAt = 0;
  private lastProblem = "";
  private heartbeatMs = 60_000;
  private pingedAt = 0;
  private pinging = false;
  private refusal: string | null = null;
  /** Requests LumiRPEngine hasn't answered yet, by when each was sent. */
  private readonly asked = new Map<number, number>();
  private askSeq = 0;
  /** When LumiRPEngine last answered or pushed anything. */
  private heardAt = 0;
  /** When the earliest request that timed out since then was sent; null once LumiRPEngine is heard again. */
  private timedOut: number | null = null;
  /** Since when the link has been down, as the last tick saw it. */
  private downAt: number | null = null;
  /**
   * Lumiverse stopped LumiRPEngine (`SPINDLE_EXTENSION_UNLOADED`), or it crashed (an error report,
   * then nothing heard within `crashMs`). The live socket says when Lumiverse starts it again; a crash
   * it never restarts by itself. Cleared then, or when a hello on a new socket is answered.
   */
  private stoppedBy: { at: number; why: "stopped" | "crashed"; detail: string | null } | null = null;
  /** An error report not yet borne out: a crash unless LumiRPEngine is heard within `crashMs`. */
  private suspect: { at: number; detail: string | null } | null = null;
  /** LumiRPEngine's build and the relay's mode, from the last hello. */
  hello: LoopbackResultBodies["lre.loopback.hello"] | null = null;
  scheduler: SchedulerState = "unknown";
  session: RelaySession = { valid: null, expiresAt: null, checkedAt: null };

  constructor(private readonly options: LinkOptions) {
    this.conn = new HostConnection({
      base: options.base,
      credentials: options.credentials,
      http: options.http,
      openSocket: options.openSocket,
      client: { name: CLI_NAME, version: CLI_VERSION, serves: "command" },
      timeoutMs: options.timeoutMs,
      onHello: () => {
        this.socketGen++;
      },
      onPush: (data) => this.push(data),
      onExtension: (change, detail) => this.lifecycle(change, detail),
    });
  }

  attach(handlers: LinkHandlers): void {
    this.handlers = handlers;
  }

  get up(): boolean {
    return this.refusal === null && this.stoppedBy === null && this.conn.isOpen() && this.greetedGen === this.socketGen;
  }

  get refused(): string | null {
    return this.refusal;
  }

  /**
   * LumiRPEngine out of reach: stopped or crashed; the link down; or silent (something asked has
   * waited `silentMs` with nothing heard from LumiRPEngine meanwhile, counted from the later of the
   * two). Null while it answers.
   */
  get out(): OutOfReach | null {
    const now = this.options.now();
    if (this.stoppedBy !== null) return { since: this.stoppedBy.at, why: this.stoppedBy.why, detail: this.stoppedBy.detail };
    if (!this.up) return { since: this.downAt ?? now, why: "down" };
    let oldest = this.timedOut;
    for (const at of this.asked.values()) if (oldest === null || at < oldest) oldest = at;
    if (oldest === null) return null;
    const since = Math.max(oldest, this.heardAt);
    return now - since >= this.options.silentMs ? { since, why: "silent" } : null;
  }

  /** Lumiverse's word on LumiRPEngine's lifecycle, which reaches the relay's socket too (D0a check 4). */
  private lifecycle(change: "loaded" | "unloaded" | "error", detail: string | null): void {
    const now = this.options.now();
    if (change === "loaded") {
      // A new worker, which knows neither this relay's session nor its calls: the next tick says hello to it.
      if (this.stoppedBy !== null) this.options.log("LumiRPEngine is running again on Lumiverse");
      this.stoppedBy = null;
      this.suspect = null;
      this.greetedGen = -1;
      this.retryAt = 0;
      return;
    }
    if (change === "unloaded") {
      this.stop({ at: now, why: "stopped", detail: null });
      return;
    }
    // An error report: a worker that died, or one that carries on. It is asked at once, and the answer decides.
    this.suspect ??= { at: now, detail };
    this.pingedAt = 0;
  }

  private stop(stopped: { at: number; why: "stopped" | "crashed"; detail: string | null }): void {
    this.stoppedBy = stopped;
    this.suspect = null;
    this.greetedGen = -1;
    this.options.log(stoppedWords(stopped.why, stopped.detail));
    this.handlers?.stopped(stopped.why, stopped.detail);
  }

  report(): RelayReport {
    const { name, build, runtime, host, listen, port } = this.options;
    return { name, build, runtime, host, listen, port, scheduler: this.scheduler, session: this.session, calls: this.handlers?.count ?? 0 };
  }

  async request<T extends CallRequestType>(type: T, fields: CallFields<T>, waitMs: number): Promise<LoopbackResultBodies[T]> {
    const deadline = this.options.now() + waitMs;
    while (!this.up) {
      if (this.refusal !== null) throw new LiveError("forbidden", this.refusal);
      const stopped = this.stoppedBy;
      if (stopped !== null && this.conn.isOpen()) {
        // The live socket will say when Lumiverse starts LumiRPEngine again; a crash it never restarts by itself.
        if (stopped.why === "crashed" || this.options.now() >= deadline) throw new LiveError("not_running", stoppedWords(stopped.why, stopped.detail));
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, Math.min(1_000, Math.max(0, deadline - this.options.now())));
        await promise;
        continue;
      }
      try {
        await this.connect();
      } catch (error) {
        // A wait mends a link that is down, not a session that ended or a LumiRPEngine that's missing.
        if ((error instanceof LiveError && LASTING[error.problem] === true) || this.options.now() >= deadline) throw error;
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, Math.min(1_000, Math.max(0, deadline - this.options.now())));
        await promise;
      }
    }
    // The secret is the link's to add: the relay's fields never carry it.
    const withSecret = { ...fields, secret: this.options.secret } as unknown as AskFields<T>;
    return this.ask(type, withSecret);
  }

  /** One request, kept in `asked` until LumiRPEngine answers it: an answer of any kind is a sign of life, a timeout a sign of silence. */
  private async ask<T extends keyof LoopbackResultBodies>(type: T, fields: AskFields<T>): Promise<LoopbackResultBodies[T]> {
    const id = ++this.askSeq;
    const at = this.options.now();
    this.asked.set(id, at);
    try {
      // protocol.ts joins the loopback's requests into the protocol's: these fields are that request's.
      const answer = (await this.conn.request(type, fields as never)) as LoopbackResultBodies[T];
      this.heard();
      return answer;
    } catch (error) {
      if (error instanceof LreError) this.heard();
      else if (error instanceof LiveError && error.problem === "timeout" && at >= this.heardAt) this.timedOut ??= at;
      throw error;
    } finally {
      this.asked.delete(id);
    }
  }

  private heard(): void {
    this.heardAt = this.options.now();
    this.timedOut = null;
  }

  /** Opens the socket if it is closed and says the loopback hello on it; one at a time. */
  connect(): Promise<void> {
    this.connecting ??= this.greet().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async greet(): Promise<void> {
    await this.conn.ensureOpen();
    const gen = this.socketGen;
    let answer: LoopbackResultBodies["lre.loopback.hello"];
    try {
      answer = await this.ask("lre.loopback.hello", { secret: this.options.secret, api: LOOPBACK_API, report: this.report(), open: this.handlers?.open() ?? [] });
    } catch (error) {
      if (error instanceof LreError && error.code === "forbidden") this.refuse(`LumiRPEngine refused this relay (${error.message}). Register it again with lumirpengine loopback up`);
      else if (error instanceof LiveError && error.problem === "timeout") throw new LiveError("timeout", `LumiRPEngine on ${this.options.base} didn't answer the loopback's hello. Update LumiRPEngine (Extensions → LumiRPEngine → Update): the loopback needs a build with its bridge.`);
      throw error;
    }
    if (answer.api !== LOOPBACK_API) {
      this.refuse(`LumiRPEngine speaks loopback API ${answer.api} and this relay ${LOOPBACK_API}: install the relay again from LumiRPEngine's build (lumirpengine loopback up)`);
      throw new LiveError("too_old", this.refusal ?? "");
    }
    const again = this.hello !== null || this.failures > 0;
    this.hello = answer;
    this.heartbeatMs = answer.heartbeatMs > 0 ? answer.heartbeatMs : this.heartbeatMs;
    this.pingedAt = this.options.now();
    // Only the socket the hello was said on counts as greeted; an answered hello also shows LumiRPEngine running.
    if (gen === this.socketGen) this.greetedGen = gen;
    this.stoppedBy = null;
    this.suspect = null;
    const lost = callsIn(answer.lost);
    if (lost.length > 0) this.handlers?.lost(lost);
    this.options.log(`${again ? "connected again" : "connected"} to LumiRPEngine ${answer.build} on ${this.options.base}, carrying ${answer.mode === "shared" ? "every user's turns (the shared relay)" : "its own account's turns"}`);
    this.failures = 0;
    this.lastProblem = "";
  }

  private refuse(why: string): void {
    this.refusal = why;
    this.options.log(why);
    this.conn.close();
  }

  private push(data: Record<string, unknown>): void {
    // Whatever LumiRPEngine sends is a sign of life.
    this.heard();
    const push = loopbackPushOf(data);
    if (push === null) return;
    if (push.type === "lre.loopback.chunk") this.handlers?.chunk(push);
    else void this.fix();
  }

  /** Settings → Loopback's Fix, and every start: the scheduler exclusion again, reported on the next ping. */
  async fix(): Promise<void> {
    const token = this.options.credentials()?.token;
    if (token === undefined) return;
    const origins = relayOrigins(this.options.listen, this.options.port);
    const was = this.scheduler;
    this.scheduler = await excludeOrigins(this.options.http, this.options.base, token, origins);
    if (this.scheduler !== was && (this.scheduler === "missing" || this.scheduler === "unknown")) this.options.log(`couldn't put ${origins.join(" and ")} in the local-inference scheduler's Excluded origins. Before turning the scheduler on, add them there (Lumiverse → Settings → Inference scheduler): a loopback turn would otherwise wait on its own calls.`);
    this.pingedAt = 0;
  }

  /** Asks Lumiverse about the session, which renews it (F31); an ended one answers `null` (D0a check 10). */
  async refreshSession(): Promise<void> {
    const now = this.options.now();
    try {
      const state = await sessionOf(this.options.http, this.options.base, this.options.credentials()?.token ?? null);
      this.session = { valid: state.valid, expiresAt: state.expiresAt, checkedAt: now };
      if (state.valid === false) this.options.log(`the relay's Lumiverse session for ${this.options.base} has ended: sign in again with lumirpengine loopback login`);
    } catch (error) {
      this.session = { ...this.session, valid: null, checkedAt: now };
      this.options.log(`couldn't ask ${this.options.base} about the relay's session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The heartbeat, naming the calls LumiRPEngine took: those it no longer holds end at once. */
  private ping(calls: string[]): void {
    this.pingedAt = this.options.now();
    this.pinging = true;
    this.ask("lre.loopback.ping", { secret: this.options.secret, report: this.report(), calls })
      .then((answer) => {
        const lost = callsIn(answer.lost);
        if (lost.length > 0) this.handlers?.lost(lost);
      })
      .catch((error: unknown) => {
        if (error instanceof LreError && error.code === "forbidden") this.refuse(`LumiRPEngine refused this relay (${error.message}). Register it again with lumirpengine loopback up`);
      })
      .finally(() => {
        this.pinging = false;
      });
  }

  /** Every second: reconnect when down (with backoff), ping when due (often while calls are open), weigh an error report, and ask about the session daily. */
  tick(): void {
    const now = this.options.now();
    if (!this.up) this.downAt ??= now;
    else this.downAt = null;
    if (this.refusal !== null) return;
    if (this.suspect !== null) {
      // Heard since the report: the worker carries on. Silent through `crashMs`: it crashed.
      if (this.heardAt >= this.suspect.at) this.suspect = null;
      else if (now - this.suspect.at >= this.options.crashMs) this.stop({ at: this.suspect.at, why: "crashed", detail: this.suspect.detail });
    }
    if (this.session.checkedAt === null || now - this.session.checkedAt >= DAY_MS) {
      this.session = { ...this.session, checkedAt: now };
      void this.refreshSession();
    }
    if (!this.up) {
      // Stopped under a live socket: Lumiverse says when it starts LumiRPEngine again, so nothing is sent meanwhile.
      if (this.stoppedBy !== null && this.conn.isOpen()) return;
      if (this.connecting !== null || now < this.retryAt) return;
      this.connect().catch((error: unknown) => {
        // The CLI's words say `lumirpengine login`; the relay's own session is renewed with `loopback login`.
        const ended = error instanceof LiveError && error.problem === "login";
        if (ended) this.session = { ...this.session, valid: false };
        const problem = ended ? `the relay's Lumiverse session for ${this.options.base} has ended: sign it in again with lumirpengine loopback login` : error instanceof Error ? error.message : String(error);
        this.retryAt = this.options.now() + (BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)] ?? 30_000);
        this.failures++;
        if (problem !== this.lastProblem) this.options.log(`can't reach LumiRPEngine yet (trying again): ${problem}`);
        this.lastProblem = problem;
      });
      return;
    }
    if (this.pinging) return;
    const calls = (this.handlers?.open() ?? []).map((c) => c.call);
    if (now - this.pingedAt >= (calls.length > 0 ? this.options.probeMs : this.heartbeatMs)) this.ping(calls);
  }

  close(): void {
    this.conn.close();
  }
}
