// Model steps over the host (DESIGN §5.2, §9.4, D10, D31). Routing: `interpret` and `extract` on
// the helper (a quiet JSON call on the user's connection); `npc.choose` on the
// Decision connection, falling back to the helper, then to engine-only. No blind retry: one JSON
// repair call when a helper reply doesn't parse (DESIGN §18.4), and every call is made again after a
// transient failure (a network reset, a timeout, a 429, a 5xx), twice at most. Prompts are model-agnostic.

import type { DiagCall } from "../shared/diagnostics";
import type { ActionId, EntityId, UserId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { HelperDefault, StepConfig } from "../shared/settings";
import { DEFAULT_HELPER, helperCallOf } from "../shared/settings";
import type { StepPurpose, WorldCurrency, WorldDoc } from "../shared/world";
import { lifeStatesOf } from "../shared/world";
import { firedTimeout } from "../shared/timeouts";
import type { Answers, Questions } from "../engine/decide";
import type { PlaceChoice } from "../engine/place-names";
import { ACTION_QUEUE_LIMIT, type InterpretOutput, type QueuedAction } from "../engine/steps";
import { TRY_ACTION } from "../engine/inferred";
import { TIMELAPSE_ACTION } from "../engine/turn";
import { cashGift } from "../packs/gear/core/index";
import { axesOf } from "../packs/relationships/core/index";
import type { HostPort, QuietMessage, QuietRequest, QuietResult } from "./host";
import type { CatalogEntry, InterpretScene } from "./interpret-context";
import type { LookupTransport, StepLore } from "./lore-steps";
import { readStoredJson } from "./stored-json";

export interface CallRecord {
  purpose: StepPurpose;
  via: "decision" | "helper";
  ok: boolean;
  ms: number;
  tokens: number;
  /** A lore lookup round (DESIGN §5.4): a call made because the model asked to read lore. */
  lookup?: boolean;
}

interface Tally {
  calls: number;
  tokens: number;
  ms: number;
  /** Lore lookup rounds among the calls. */
  lookups: number;
}

const emptyTally = (): Tally => ({ calls: 0, tokens: 0, ms: 0, lookups: 0 });

interface UserTallies {
  turns: Tally[];
  current: Tally;
}

/** Where a user's tallies are kept (`userStorage/call-meter.json`). */
export const METER_PATH = "call-meter.json";

/** Closed turns kept per user, for the average and the 95th percentile. */
export const METER_TURNS = 200;

/** A stored tally, or null when it isn't one; one saved before lookups were counted has none. */
function tallyOf(raw: unknown): Tally | null {
  if (!isRecord(raw)) return null;
  const count = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!count(raw.calls) || !count(raw.tokens) || !count(raw.ms)) return null;
  return { calls: raw.calls, tokens: raw.tokens, ms: raw.ms, lookups: count(raw.lookups) ? raw.lookups : 0 };
}

/** What the meter needs to keep its tallies. */
export type MeterHost = Pick<HostPort, "storage" | "log">;

/**
 * Per-turn call meter (DESIGN §5.3): calls, tokens and latency, kept per user (one user's turns
 * never show in another's). With a host, each user's tallies live in their `call-meter.json`, read
 * the first time they are needed and written after every change, in order; a script's meter
 * (no host) keeps them for the process.
 */
export class CallMeter {
  private readonly users = new Map<UserId, UserTallies>();
  /** Each user's load and writes, in order. */
  private readonly queues = new Map<UserId, Promise<void>>();
  /** The last calls, oldest first, with their user (diagnostics and the per-preset call tests). */
  readonly log: (CallRecord & { userId: UserId })[] = [];

  constructor(private readonly host: MeterHost | null = null) {}

  private remember(userId: UserId, tallies: UserTallies): UserTallies {
    this.users.set(userId, tallies);
    if (this.users.size > 256) this.users.delete(this.users.keys().next().value ?? "");
    return tallies;
  }

  private async load(userId: UserId): Promise<UserTallies> {
    const known = this.users.get(userId);
    if (known || !this.host) return known ?? this.remember(userId, { turns: [], current: emptyTally() });
    const raw = await readStoredJson(this.host, METER_PATH, userId, "call meter", (r) => isRecord(r) && r.v === 1 && Array.isArray(r.turns) && tallyOf(r.current) !== null);
    const turns = isRecord(raw) && Array.isArray(raw.turns) ? raw.turns.map(tallyOf).filter((t): t is Tally => t !== null).slice(-METER_TURNS) : [];
    return this.remember(userId, { turns, current: (isRecord(raw) ? tallyOf(raw.current) : null) ?? emptyTally() });
  }

  /** Queues `step` after the user's earlier work; the queue never rejects (a failed write is logged). */
  private enqueue(userId: UserId, step: () => Promise<void>): Promise<void> {
    const next = (this.queues.get(userId) ?? Promise.resolve()).then(step).catch((error: unknown) => this.host?.log("warn", `[LumiRPEngine] the call meter wasn't saved (${error instanceof Error ? error.message : String(error)})`, userId));
    this.queues.set(userId, next);
    void next.finally(() => {
      if (this.queues.get(userId) === next) this.queues.delete(userId);
    });
    return next;
  }

  private change(userId: UserId, apply: (u: UserTallies) => void): void {
    const host = this.host;
    if (!host) {
      const u = this.users.get(userId) ?? this.remember(userId, { turns: [], current: emptyTally() });
      apply(u);
      return;
    }
    void this.enqueue(userId, async () => {
      const u = await this.load(userId);
      apply(u);
      await host.storage.write(`${METER_PATH}.tmp`, JSON.stringify({ v: 1, turns: u.turns, current: u.current }), userId);
      await host.storage.move(`${METER_PATH}.tmp`, METER_PATH, userId);
    });
  }

  record(call: CallRecord, userId: UserId): void {
    this.log.push({ ...call, userId });
    if (this.log.length > 500) this.log.shift();
    this.change(userId, (u) => {
      u.current.calls++;
      u.current.tokens += call.tokens;
      u.current.ms += call.ms;
      if (call.lookup === true) u.current.lookups++;
    });
  }

  /** Closes the user's turn tally. */
  close(userId: UserId): void {
    this.change(userId, (u) => {
      u.turns.push(u.current);
      if (u.turns.length > METER_TURNS) u.turns.shift();
      u.current = emptyTally();
    });
  }

  /** Resolves once the user's tallies are loaded and their queued changes applied (`view` reads them). */
  ready(userId: UserId): Promise<void> {
    return this.enqueue(userId, async () => {
      await this.load(userId);
    });
  }

  /** Resolves once every queued change is written. */
  async settle(): Promise<void> {
    while (this.queues.size > 0) await Promise.all([...this.queues.values()]);
  }

  view(userId: UserId): { turn: Tally; average: Tally; p95: Tally } {
    const { turns, current } = this.users.get(userId) ?? { turns: [], current: emptyTally() };
    const last = turns.at(-1) ?? current;
    const avg = (key: keyof Tally): number => (turns.length === 0 ? 0 : Math.round(turns.reduce((s, t) => s + t[key], 0) / turns.length));
    const p95 = (key: keyof Tally): number => {
      if (turns.length === 0) return 0;
      const sorted = turns.map((t) => t[key]).sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] ?? 0;
    };
    return { turn: last, average: { calls: avg("calls"), tokens: avg("tokens"), ms: avg("ms"), lookups: avg("lookups") }, p95: { calls: p95("calls"), tokens: p95("tokens"), ms: p95("ms"), lookups: p95("lookups") } };
  }
}

/** The first JSON object or array in a reply (models often wrap JSON in prose or fences). */
export function parseJsonReply(text: string): JsonValue {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (start < 0 || end <= start) throw new Error("no JSON in the reply");
    return JSON.parse(trimmed.slice(start, end + 1)) as JsonValue;
  }
}

/** What model steps need from the host (narrow, so scripts can drive the real steps over REST). */
export type StepsHost = Pick<HostPort, "models" | "log">;

/**
 * A failure worth another try: the connection reset or dropped, the request timed out, the provider
 * was busy (429) or answered with a 5xx (the host words these as "… failed (502): …"). An abort is
 * the engine's own deadline, never retried.
 */
export function transientFailure(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/\bAbortError\b/.test(text)) return false;
  return /\b(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|ESOCKETTIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_[A-Z_]+)\b|socket hang up|socket connection was closed|connection (?:was )?(?:reset|closed)|fetch failed|network error|timed? ?out|too many requests|rate.?limit|\((?:5\d\d|429)\)|\b(?:status|HTTP)\s*:?\s*(?:5\d\d|429)\b/i.test(text);
}

/**
 * How providers say a model or endpoint takes no tools: OpenAI-compatible servers ("does not support
 * tools", "function calling is not supported", "tools unsupported", "Unsupported parameter: 'tools'",
 * "Unrecognized request argument supplied: tools"), OpenRouter's routing ("No endpoints found that
 * support tool use"), vLLM's (`"auto" tool choice requires --enable-auto-tool-choice`), llama.cpp's
 * ("tools param requires --jinja flag") and Gemini's ("Function calling is not enabled"). Only an
 * error that says so turns a connection's tools to text, an agent's or a step's lookup: any other
 * failure is the call's own.
 */
const TOOL_REFUSALS: readonly RegExp[] = [
  /\b(?:does|do)(?: not|n't) support (?:native )?(?:tools?|tool[ _-]?(?:use|calls?|calling)|function[ _-]?(?:calls?|calling)|functions)\b/i,
  /\b(?:tools?|tool[ _-]?(?:use|calls?|calling)|function[ _-]?(?:calls?|calling))\b[^.\n]{0,40}\b(?:is|are) not (?:supported|enabled|available)\b/i,
  /\b(?:tools?|tool[ _-]?(?:use|calls?|calling)|function[ _-]?(?:calls?|calling))(?: are| is)? unsupported\b/i,
  /\bno endpoints found that support tool use\b/i,
  /\bunsupported (?:parameter|argument|field)\b[^.\n]{0,8}\btools?\b/i,
  /\bunrecognized request arguments? supplied\b[^.\n]{0,8}\btools?\b/i,
  /--enable-auto-tool-choice\b/i,
  /\btools? param(?:eter)? requires --jinja\b/i,
  /\bfunction calling is not enabled\b/i,
];

/** Whether a failed call's error is its provider refusing native tools (`TOOL_REFUSALS`), in its message or its cause's. */
export function isToolRefusal(error: unknown): boolean {
  const texts = [error instanceof Error ? error.message : String(error), error instanceof Error && error.cause !== undefined ? (error.cause instanceof Error ? error.cause.message : String(error.cause)) : ""];
  return texts.some((text) => TOOL_REFUSALS.some((pattern) => pattern.test(text)));
}

/** How many times a call that failed transiently is made again, the first after `RETRY_PAUSE_MS`, each later one after twice the wait before it. */
export const TRANSIENT_RETRIES = 2;
const RETRY_PAUSE_MS = 1000;

/** Waits `ms`, or until `signal` ends the step's time. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (signal.aborted) {
    resolve();
    return promise;
  }
  const done = (): void => {
    clearTimeout(timer);
    signal.removeEventListener("abort", done);
    resolve();
  };
  const timer = setTimeout(done, ms);
  signal.addEventListener("abort", done, { once: true });
  return promise;
}

/**
 * Why a run stopped a call whose answer it no longer needs (minds it started before the player's
 * message was read, which the read or the player then made pointless): the call shows it, and fails nothing.
 */
export class NotNeeded extends Error {
  constructor(why: string) {
    super(why);
    this.name = "NotNeeded";
  }
}

/** A decision's questions as a helper reads them, one line each. */
function questionLines(questions: Questions): string[] {
  return Object.entries(questions).map(([key, q]) => {
    if (q.type === "choice") return `"${key}": choose one of ${JSON.stringify(Object.keys(q.criteria))}. ${q.instructions} Criteria: ${JSON.stringify(q.criteria)}`;
    if (q.type === "score") return `"${key}": score 0..${q.criteria.length - 1}. ${q.instructions} Levels: ${JSON.stringify(q.criteria)}`;
    return `"${key}": probability 0..1 that it is true. ${q.instructions}`;
  });
}

/** Leads the recent chat a step's card lets it read, after its input: context only, since what it tells is already recorded. */
const RECENT_CHAT_LEAD = "Recent chat, oldest first (the messages before this turn's; context only: what they tell already happened and is recorded, so nothing in them is a change to report or act on again):";

/** What leads a preset's guidance in a helper's prompt: it styles the answer, never its contract. */
const GUIDANCE_LEAD = "Style and rules from the player's preset. Follow them where they fit the instructions above; they never change what to output or its format:";
export class Steps {
  /** Each model call as diagnostics read it (connection, model, tokens in and out, finish_reason, time); the runtime sets it. */
  onCall: ((userId: UserId, call: DiagCall) => void) | null = null;
  /** A model call is starting (the activity line says what the engine is asking); the runtime sets it. */
  onCallStart: ((userId: UserId, purpose: StepPurpose) => void) | null = null;

  /** `helperOf` reads the user's helper model (Settings → Helper model), which every helper call without a connection of its own runs on. */
  constructor(
    private readonly host: StepsHost,
    readonly meter: CallMeter,
    private readonly helperOf: (userId: UserId) => Promise<Readonly<HelperDefault>> = async () => DEFAULT_HELPER,
  ) {}

  /**
   * One metered quiet call. A call that fails transiently (`transientFailure`: a
   * dropped connection, 429, 5xx) is made again, up to `TRANSIENT_RETRIES` times after a short wait,
   * inside the step's time; an empty or cut-off answer is never asked again. The reply, or the
   * last attempt's error. Each attempt is its own call in diagnostics; one asked again is marked
   * `retried`, and the last carries how many came before it.
   */
  private async quiet(purpose: StepPurpose, request: QuietRequest, userId: UserId, signal: AbortSignal, o: { lookup: boolean; spared?: boolean }, attempt = 0): Promise<QuietResult | Error> {
    const t0 = performance.now();
    const lookup = o.lookup ? { lookup: true } : {};
    const tried = attempt > 0 ? { retries: attempt } : {};
    const route = { purpose, via: "helper" as const, connection: request.connectionId ?? "active", maxTokens: request.maxTokens, ...lookup, ...(o.spared ? { spared: true } : {}) };
    this.onCallStart?.(userId, purpose);
    try {
      const r = await this.host.models.quiet(request, userId, signal);
      const ms = performance.now() - t0;
      this.meter.record({ purpose, via: "helper", ok: true, ms, tokens: r.tokens, ...lookup }, userId);
      const answered = r.content.trim() !== "" || (r.toolCalls?.length ?? 0) > 0;
      this.onCall?.(userId, { ...route, model: r.model ?? request.model ?? "default", tokensIn: r.tokensIn ?? null, tokensOut: answered ? (r.tokensOut ?? null) : 0, finishReason: r.finishReason, ms, ok: true, ...tried });
      // A reply that ran out of tokens is cut off mid-JSON; say so, as it reads as no JSON.
      if (r.finishReason === "length") this.host.log("warn", `[LumiRPEngine] ${purpose} helper reply was cut off at ${request.maxTokens} tokens (${r.content.length} characters)`, userId);
      return r;
    } catch (error) {
      const ms = performance.now() - t0;
      this.meter.record({ purpose, via: "helper", ok: false, ms, tokens: 0, ...lookup }, userId);
      const why = error instanceof Error ? error.message : String(error);
      const fired = firedTimeout(signal);
      const unneeded = signal.reason instanceof NotNeeded ? signal.reason : null;
      const again = attempt < TRANSIENT_RETRIES && !signal.aborted && transientFailure(error);
      this.onCall?.(userId, { ...route, ...(unneeded ? { spared: true } : {}), model: request.model ?? "default", tokensIn: null, tokensOut: null, finishReason: "", ms, ok: false, error: unneeded ? `not needed: ${unneeded.message}` : fired ? `${fired.message} (${why})` : signal.aborted ? `aborted: the step's time ran out (${why})` : why, ...tried, ...(again ? { retried: true } : {}) });
      if (!unneeded) this.host.log("warn", `[LumiRPEngine] ${purpose} helper call failed${again ? ", asking again" : ""}: ${why}`, userId);
      if (!again) return error instanceof Error ? error : new Error(why);
      await pause(RETRY_PAUSE_MS * 2 ** attempt, signal);
      return signal.aborted ? (error instanceof Error ? error : new Error(why)) : this.quiet(purpose, request, userId, signal, o, attempt + 1);
    }
  }

  /**
   * A helper JSON call, with one repair call when the reply doesn't parse; a call that fails
   * transiently (`transientFailure`) is made again (`quiet`). Null on failure, with why in
   * `failure` when the caller passes one: short words naming no one, fit for a player's chip.
   *
   * The preset's guidance for the step (DESIGN §6.8) follows the instructions, and the step's lore
   * follows that. When it may look lore up (`StepLore.offer` holds a round on the phase's lookup
   * budget), the model is offered the lore tools or the need form; each time it asks, the engine
   * answers in a follow-up message and the call is made again, once per round held. A connection
   * that refuses the tools is asked again in the need form, and the refusal is kept once that works.
   *
   * `recent`, the chat before the turn's that the step's card lets it read (oldest first), follows
   * the input as its "Recent chat" block.
   */
  async helperJson(purpose: StepPurpose, system: string, user: string, config: StepConfig | null, userId: UserId, signal: AbortSignal, options: { lore?: StepLore | null; guidance?: string; usage?: { tokens: number }; failure?: { reason: string }; spared?: boolean; recent?: readonly string[] } = {}): Promise<JsonValue | null> {
    const lore = options.lore ?? null;
    const guidance = options.guidance ? `${GUIDANCE_LEAD}\n${options.guidance}` : "";
    // The lookup round is held before anything is awaited, so steps beside this one see it taken.
    let offer = lore?.offer() ?? null;
    const call = helperCallOf(config, await this.helperOf(userId));
    const base = { ...call, maxTokens: Math.max(call.maxTokens, 1500) };
    const asked = options.recent && options.recent.length > 0 ? `${user}\n\n${RECENT_CHAT_LEAD}\n${options.recent.join("\n")}` : user;
    const opening = (): QuietMessage[] => [{ role: "system", content: [system, guidance, lore?.block() ?? "", offer && lore ? lore.instructions(offer) : ""].filter((s) => s !== "").join("\n\n") }, { role: "user", content: asked }];
    // JSON mode stays off while tools are offered: some providers refuse the two together.
    const ask = async (messages: QuietMessage[], tools: boolean, o: { lookup: boolean }): Promise<QuietResult | Error> => {
      const r = await this.quiet(purpose, { ...base, messages, json: !tools, ...(tools && lore ? { tools: [...lore.tools] } : {}) }, userId, signal, { ...o, spared: options.spared === true });
      if (options.usage && !(r instanceof Error)) options.usage.tokens += r.tokens;
      return r;
    };
    let messages = opening();
    let reply = await ask(messages, offer === "tools", { lookup: false });
    if (reply instanceof Error && offer === "tools" && lore && !signal.aborted && !transientFailure(reply)) {
      // The call with the tools failed for good: the same question in the need form, on the round
      // already held. Only a provider saying it takes no tools turns the connection's lookups to the
      // need form from then on, once that works.
      const refusal = isToolRefusal(reply) ? reply.message : null;
      offer = lore.refuseTools(refusal !== null);
      messages = opening();
      reply = await ask(messages, false, { lookup: false });
      if (!(reply instanceof Error) && refusal !== null) lore.keepRefusal(refusal);
    }
    while (lore && offer && !(reply instanceof Error)) {
      const asks = lore.asked(reply, offer);
      if (!asks) {
        lore.release();
        offer = null;
        break;
      }
      lore.spend();
      const results = lore.answer(asks);
      const next = lore.offer();
      const end = next === "tools" ? "Look up more with the lore tools if you must, or answer now as instructed." : next === "need" ? 'Reply with only {"need": [...]} once more if you must, or answer now as instructed.' : "Now answer as instructed, with what you have. Don't ask for more lore.";
      messages = [...messages, { role: "assistant", content: lore.echo(reply, offer) }, { role: "user", content: `${results}\n\n${end}` }];
      offer = next;
      reply = await ask(messages, next === "tools", { lookup: true });
    }
    if (lore && offer) lore.release();
    const failed = (reason: string): null => {
      if (options.failure) options.failure.reason = reason;
      return null;
    };
    if (reply instanceof Error) return failed(signal.reason instanceof NotNeeded ? `not needed: ${signal.reason.message}` : signal.aborted ? "the time ran out before it answered" : `the call failed: ${reply.message.replace(/\s+/g, " ").trim().slice(0, 160)}`);
    const first = reply.content;
    if (first.trim() === "") return failed(reply.finishReason === "length" ? `the answer was cut off at ${base.maxTokens} tokens before it said anything` : "the answer was empty");
    try {
      return parseJsonReply(first);
    } catch {
      const fixed = await ask(
        [
          { role: "system", content: "Rewrite the text as valid JSON with the same meaning. Output JSON only." },
          { role: "user", content: first },
        ],
        false,
        { lookup: false },
      );
      if (fixed instanceof Error) return failed("the answer wasn't JSON, and the call to repair it failed");
      try {
        return parseJsonReply(fixed.content);
      } catch {
        return failed(reply.finishReason === "length" ? `the answer was cut off at ${base.maxTokens} tokens` : "the answer wasn't JSON");
      }
    }
  }

  /**
   * The lookup pre-pass of a step on the Decision connection (DESIGN §5.4). The Decisions API takes
   * no tools, so one bounded call on the helper model asks what lore the decision
   * needs (the lore tools, or the need form), on a round of the phase's lookup budget, and never
   * answers the decision itself. Its hits join the step's lore, which the decision then reads.
   */
  private async lookupFirst(purpose: StepPurpose, state: JsonValue, questions: Questions, lore: StepLore, userId: UserId, signal: AbortSignal): Promise<void> {
    let offer = lore.offer();
    if (!offer) return;
    lore.spend();
    const helper = helperCallOf(null, await this.helperOf(userId));
    const ask = (transport: LookupTransport) => {
      const contract = transport === "need" ? 'Output JSON only: {"need": ["a short query", …]}, or {"need": []} when the notes given are enough.' : 'Call the lore tools for what you need; when the notes given are enough, reply "none".';
      const system = ["You get a decision ready. Read the state and the questions and say what world lore would help answer them; don't answer them.", lore.block(), lore.instructions(transport), contract].filter((s) => s !== "").join("\n\n");
      const messages: QuietMessage[] = [
        { role: "system", content: system },
        { role: "user", content: `State: ${JSON.stringify(state)}\nQuestions:\n${questionLines(questions).join("\n")}` },
      ];
      return this.quiet(purpose, { messages, json: transport === "need", ...helper, ...(transport === "tools" ? { tools: [...lore.tools] } : {}) }, userId, signal, { lookup: true });
    };
    let reply = await ask(offer);
    if (reply instanceof Error && offer === "tools" && !signal.aborted && !transientFailure(reply)) {
      const refusal = isToolRefusal(reply) ? reply.message : null;
      offer = lore.refuseTools(refusal !== null);
      reply = await ask(offer);
      if (!(reply instanceof Error) && refusal !== null) lore.keepRefusal(refusal);
    }
    if (reply instanceof Error) return;
    const asks = lore.asked(reply, offer);
    if (asks) lore.answer(asks);
  }

  /**
   * A decision call (D10): the Decision connection, then the helper, then null (engine-only). A
   * `helper` route asks the helper on that route directly. The step's lore, the preset's guidance
   * for it (`rules`) and the recent chat its card lets it read (`recent`) ride in the state the
   * Decision connection reads, after its lookup pre-pass, or in the helper's prompt, which may look
   * lore up itself.
   */
  async decide(purpose: StepPurpose, state: JsonValue, questions: Questions, config: StepConfig | null, userId: UserId, signal: AbortSignal, lore: StepLore | null = null, guidance = "", recent: readonly string[] = []): Promise<{ answers: Answers; via: "decision" | "helper" } | null> {
    const viaHelper = config?.route?.provider === "helper";
    if (!viaHelper) {
      if (lore) await this.lookupFirst(purpose, state, questions, lore, userId, signal);
      const notes = lore?.lines() ?? [];
      const extra: JsonObject = { ...(notes.length > 0 ? { lore: notes } : {}), ...(guidance !== "" ? { rules: guidance } : {}), ...(recent.length > 0 ? { recent: [...recent] } : {}) };
      const asked: JsonValue = Object.keys(extra).length === 0 ? state : isRecord(state) ? { ...state, ...extra } : { state, ...extra };
      const t0 = performance.now();
      const route = { purpose, via: "decision" as const, connection: config?.route?.connectionId ?? "active", maxTokens: null, finishReason: "", tokensIn: null };
      this.onCallStart?.(userId, purpose);
      try {
        const r = await this.host.models.decide({ state: asked, questions, connectionId: config?.route?.connectionId ?? null, model: config?.route?.model ?? null }, userId, signal);
        const ms = performance.now() - t0;
        this.meter.record({ purpose, via: "decision", ok: true, ms, tokens: r.tokens }, userId);
        const answered = Object.keys(r.answers).length > 0;
        // An answer with no token count is an answer: the count is unknown, never zero.
        this.onCall?.(userId, { ...route, model: r.model, tokensOut: answered ? (r.tokens > 0 ? r.tokens : null) : 0, ms, ok: true });
        if (answered) return { answers: r.answers, via: "decision" };
      } catch (error) {
        const ms = performance.now() - t0;
        this.meter.record({ purpose, via: "decision", ok: false, ms, tokens: 0 }, userId);
        this.onCall?.(userId, { ...route, model: config?.route?.model ?? "default", tokensOut: null, ms, ok: false, error: error instanceof Error ? error.message : String(error) });
        this.host.log("warn", `[LumiRPEngine] ${purpose} decision failed, using the helper: ${error instanceof Error ? error.message : String(error)}`, userId);
      }
    }
    if (signal.aborted) return null;
    const system = `Answer each question about the state with probabilities. Output JSON only: {"<key>": {"probabilities": {"<option>": number}}} for choice and score questions, and {"<key>": {"p": number}} for yes/no questions.`;
    // A decision falling back to the helper runs on the helper model, with the step's max tokens if it set its own.
    const raw = await this.helperJson(purpose, system, `State: ${JSON.stringify(state)}\nQuestions:\n${questionLines(questions).join("\n")}`, viaHelper && config ? config : { enabled: true, signals: [], ...(config?.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}) }, userId, signal, { lore, guidance, recent });
    if (!isRecord(raw)) return null;
    const answers: Answers = {};
    for (const [key, q] of Object.entries(questions)) {
      const a = raw[key];
      if (!isRecord(a)) continue;
      if (q.type === "noul") {
        // A reply without `p` is no answer: a made-up 0.5 would be sampled as the model's.
        if (typeof a.p !== "number" || !Number.isFinite(a.p)) continue;
        answers[key] = { type: "noul", noul: Math.min(1, Math.max(0, a.p)) };
        continue;
      }
      const probabilities: Record<string, number> = {};
      if (isRecord(a.probabilities)) for (const [k, v] of Object.entries(a.probabilities)) if (typeof v === "number" && v >= 0) probabilities[k] = v;
      const keys = q.type === "choice" ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
      const best = keys.reduce((b, k) => ((probabilities[k] ?? 0) > (probabilities[b] ?? 0) ? k : b), keys[0] ?? "");
      if (q.type === "choice") answers[key] = { type: "choice", choice: best, probabilities, confidence: probabilities[best] ?? 0 };
      else answers[key] = { type: "score", score: Number(best), probabilities, confidence: probabilities[best] ?? 0 };
    }
    return { answers, via: "helper" };
  }
}

// ---------------------------------------------------------------- interpret

/** The world as `extract` is told it: the player character, the entities it may know, and the places it is offered (`placeMenu`: the ones the reply names, then the nearest). */
function worldBrief(world: WorldDoc, places: readonly PlaceChoice[]): string {
  const pov = world.entities[world.pov];
  const people = Object.values(world.entities)
    .filter((e) => e.id !== world.pov)
    .slice(0, 40)
    .map((e) => `${e.id} (${e.name}, ${e.kind})`)
    .join(", ");
  const listed = places.map((p) => `${p.id} (${p.name})`).join(", ");
  return `World: ${world.name}. The player character is ${pov?.name ?? world.pov} (id ${world.pov}). Entities: ${people || "none"}. Places, those the reply names and the nearest first: ${listed || "none"}.`;
}

/** What `interpret` may say a thing the player says they have is, for a claim (DESIGN §9.4): food and drink are used up, money, keys, weapons and documents ask first. */
export type ThingSort = "food" | "drink" | "weapon" | "key" | "document" | "money" | "other";
const THING_SORTS: readonly ThingSort[] = ["food", "drink", "weapon", "key", "document", "money", "other"];

/** One of the input's actions after the first as `interpret` read it, with what it says the thing it uses is. */
export interface ReadAction extends QueuedAction {
  thing?: ThingSort;
}

/**
 * A lasting change to someone's week the input itself states (DESIGN §9.4 the player's message as a
 * routine's source), in the `routine` channel's shape, with `said`: the input's own words stating it.
 * It is never played: the chat asks the player before it changes anyone's routine.
 */
export type SaidRoutine = JsonObject & { said: string };

/** How many routine changes one message may state. */
const SAID_ROUTINES_MAX = 3;

/** `interpret`'s read: the intent, the reason it gave when it read no action, what it says each action's thing is, and the routine changes the input states. */
export type InterpretRead = Omit<InterpretOutput, "queue"> & { reason?: string; thing?: ThingSort; queue?: ReadAction[]; routine?: SaidRoutine[] };

/** What `interpret` is told of the world besides the catalog: its name and money, the player character, and the scene as the POV knows it (`interpretScene`). */
export interface InterpretContext {
  world: Pick<WorldDoc, "name" | "currency">;
  pov: { id: EntityId; name: string };
  scene: InterpretScene;
}

/** A catalog action on one line: "id — label: what it does. Params: …. Needs: …. Said as: …." */
function catalogLine(e: CatalogEntry): string {
  const parts = [`${e.id} — ${e.label}${e.description ? `: ${e.description.replace(/[\s.]+$/, "")}` : ""}`];
  if (e.params.length > 0) parts.push(`Params: ${e.params.join(", ")}`);
  if (e.needs.length > 0) parts.push(`Needs: ${e.needs.join("; ")}`);
  if (e.lexicon && e.lexicon.length > 0) parts.push(`Said as: ${e.lexicon.slice(0, 6).join(", ")}`);
  return `${parts.join(". ")}.`;
}

/**
 * `interpret`: typed input to its actions in order (DESIGN §5.2, §9.4, §11): the first, with the
 * player's words for it (`text`; a time skip's are what fills it), the further ones it reads as
 * engine actions (`queue`), and the rest as the player would type it (`next`), or none with its
 * reason. It reads the scene, the places and the messages before the input
 * (`context`), and only the catalog's actions. `instructions` (a world step template) lead the
 * prompt; the output contract stays; the preset's guidance and the step's lore follow. Null when
 * the call fails.
 */
export async function interpret(
  steps: Steps,
  text: string,
  context: InterpretContext,
  actions: readonly CatalogEntry[],
  config: StepConfig | null,
  userId: UserId,
  signal: AbortSignal,
  instructions?: string,
  lore: StepLore | null = null,
  guidance = "",
): Promise<InterpretRead | null> {
  if (actions.length === 0) return { action: null, params: {}, probabilities: { none: 1 } };
  const { world, pov, scene } = context;
  const rules = [
    `Read what the player character does in the input. Work out what it refers to ("what she offered", "there", "him") from the scene and the recent messages.`,
    `Only the player character's own deliberate actions count, whether said in the first person ("I", "we"), as a stage direction ("[${pov.name} heads to the roof]") or as narration about ${pov.name} in the third person. "I'll …" about what the player character does now is an action.`,
    `No action ("action": null) for speech alone, out-of-character text ("OOC:", "((…))") that doesn't say time passes, questions, requests to others, what someone else does, hypotheticals, plans for another time, recaps or feelings.`,
    // A time skip is the timelapse whatever else the input says (DESIGN §5.2), so an out-of-character
    // instruction to skip is never read as the activity it describes, with that action's own duration.
    // The one exception: getting out of bed or up from a rest before the out-of-character part is
    // doing something else (§9.2), which ends a night or a rest, so it plays, with the time after it as its `then`.
    ...(actions.some((a) => a.id === TIMELAPSE_ACTION)
      ? [
          `A time skip is "action": "${TIMELAPSE_ACTION}", whatever else the input says: an out-of-character instruction that time passes or skips ahead ("OOC: over the next hour, I sort the stock", "(OOC: skip ahead two hours)", "[OOC] later that evening", "((cover the next hour))"), and in character a span spent on something no catalog action covers ("I spend the next hour sorting the stock"). Its "params" hold "span", the input's own words for how long or until when ("over the next hour"), with "minutes", "until" or "at" as the catalog says. Its "text" is what the input says happens in that time, in the input's own words ("I sort the stock"), left out when it says nothing happens. What the input says happens in that time fills it: never an action of its own, nor in "more", "next" or "then". The one exception is in-character input that, before the out-of-character instruction, gets the player character out of bed or up from a rest with a catalog action ("I get out of bed and make coffee. (OOC: skip an hour.)"): read that action, and any actions after it, as usual, and the time as their "then". What the out-of-character instruction itself says happens ("OOC: skip to morning, I get up", "OOC: over the next two hours, I walk to the gym") still fills the time.`,
        ]
      : []),
    `Use only the catalog's actions, as described there: never invent one. When no catalog action fits, "action" is null. An incidental action that fits none, or names someone or somewhere nothing lists where its param takes only what is listed, is left out: it never hides the actions after it.`,
    `An action on a thing the player says they have that nothing lists ("I pour Theresa a coffee" with no coffee listed) is still read, in order with the rest: its param holds the thing in the input's own words ("coffee"), and "thing" says what sort of thing it is: "food", "drink", "weapon", "key", "document", "money" or "other".`,
    `When the input and its context still leave it unclear which action or which target is meant, give "action": null and a short "reason"; never guess.`,
    `Params are world ids, from the scene, Places and the catalog's lists, except a thing nothing lists, or anyone or anything a param takes in the input's own words ("I drop a coin in the tip jar": its receiver is "the tip jar"), which keeps the input's own words. A text param that names an item keeps its qualifiers as written ("large pizza, delivered", not "pizza"). Money params are plain amounts in ${world.currency.code} as written (200 for ${world.currency.symbol}200).`,
    `Read every action in the input, in order, not only the first. Return the first as "action" with its "params" and its "text": that action written as the player would type it, with whatever and whoever it involves ("I take the envelope from the clerk"). If the input has more actions after it, list them in order in "more" (at most ${ACTION_QUEUE_LIMIT - 1}), each {"action": a catalog id, "params": {...}, "text": that action written as the player would type it}: "I walk to the market and buy bread" → "action" for the walk, and "more": [{"action": <the buy's id>, "params": {"item": "bread"}, "text": "I buy bread"}]. An action after them that no catalog action fits goes in "next", written as the player would type it.`,
    `If the input lets time pass after its last action, in character ("…and sleep until the next morning", "…then wait two hours", "…then skip ahead to Friday at 6 PM") or out of character after the input gets the player character out of bed or up from a rest, add "then": {"span": its words for how long or until when, with "minutes", "until" (a day part, "shift" or "commitment") or "at" ("YYYY-MM-DD HH:MM" for a stated day and time)}; time passing is never in "more" or "next", nor is anything else that isn't an action.`,
    // A routine the player's own message states is asked about, never played (DESIGN §9.4): it is no
    // action, so it never takes an action's place, and anything short of a plain statement is none.
    `If the input itself plainly states, as settled fact, a lasting change to someone's week (the player character's own, "I start nights at the marina Monday", or one the input says someone told of, "Marcus says he's started swimming on Tuesdays"), add it to "routine": [{"entity": their id, "change": "start" for a new job, shift or habit, "stop" for one given up, "move" for a new home, "label": what it is in the input's words, "days": the days the input states (weekday names, "weekdays", "weekends" or "daily"; leave it out when the input states none, never guess), "start"?/"end"?: "HH:MM" as stated (or "start": morning|afternoon|evening|night), "activity"?: work|school|exercise|leisure|socialize|errand, "place"?: any place the input names for it, as a place id, or in the input's own words when nothing lists it ("the community pool"); left out only when the input names none (for "move", the new home), "with"?: people's ids, "replaces"?: true only when the input says it takes the place of what they did then, "said": the input's own words that state it, copied exactly}]. Never for a question ("do you still swim on Tuesdays?"), a one-off, a plan, a wish, a hypothetical, someone's thoughts, or a habit only mentioned in passing ("I walk past the pool where I swim on Tuesdays"). It is never an action, and changes nothing about "action", "more", "then" or "next".`,
  ];
  // An uncertain attempt is Try something while the chat infers checks (DESIGN §11): never beside, or
  // instead of, a catalog action that covers it, and a reaction the input asks for counts.
  if (actions.some((a) => a.id === TRY_ACTION)) {
    rules.push(
      `An attempt whose outcome is uncertain that no other catalog action covers is "${TRY_ACTION}" (Try something), even asked as a question ("I watch him as he answers: is he lying?" is the player character's reading of him against his deceit). Never read an attempt a catalog action covers as "${TRY_ACTION}", nor both: that action alone. "attempt" is what is attempted, in the input's words; "skill" and "difficulty" come from its lists; "with" lists the companions the input has join in ("we sneak past"); "against" lists the people here it opposes or targets, each with the skill they resist with.`,
    );
  }
  // A message can take for granted a move the engine never made, or what the last message left
  // unplayed (DESIGN §5.2): read those first, so the engine has the POV where the story does.
  const presumed = [
    `When the input takes for granted that ${pov.name} is somewhere other than the scene's place (beside someone who isn't here, at a fixture of another place), read the move there first, as "I go there" is read: to where that person was last seen, or the place with that fixture.`,
    `When it takes for granted that what the scene lists as left from the last message happened, read those actions first, in order.`,
  ];
  const system = [
    instructions ?? "",
    "You map a player's typed input in a roleplay to the engine actions it takes, in order.",
    `World: ${world.name}. The player character is ${pov.name} (id ${pov.id}).`,
    `Scene:\n${scene.lines.join("\n")}`,
    scene.places.length > 0 ? `Places (id: name), nearest first:\n${scene.places.join("\n")}` : "",
    scene.recent.length > 0 ? `Recent messages, oldest first:\n${scene.recent.join("\n")}` : "",
    `Action catalog:\n${actions.map(catalogLine).join("\n")}`,
    `Rules:\n${rules.map((r) => `- ${r}`).join("\n")}`,
    presumed.map((r) => `- ${r}`).join("\n"),
    `Output JSON only, exactly this shape: {"action": string|null, "params": {...}, "text"?: string, "thing"?: string, "confidence": number, "reason"?: string, "more"?: [{"action": string, "params": {...}, "text": string, "thing"?: string}], "then"?: {"span": string, "minutes"?: number, "until"?: string, "at"?: string}, "next"?: string, "routine"?: [{"entity": string, "change": string, "label": string, "days"?: string|string[], "start"?: string, "end"?: string, "activity"?: string, "place"?: string, "with"?: string[], "replaces"?: boolean, "said": string}]}.`,
  ]
    .filter((part) => part !== "")
    .join("\n");
  const raw = await steps.helperJson("interpret", system, text, config, userId, signal, { lore, guidance });
  if (!isRecord(raw)) return null;
  const action = typeof raw.action === "string" && actions.some((a) => a.id === raw.action) ? raw.action : null;
  const params: JsonObject = {};
  if (isRecord(raw.params)) for (const [k, v] of Object.entries(raw.params)) params[k] = JSON.parse(JSON.stringify(v ?? null)) as JsonValue;
  const confidence = typeof raw.confidence === "number" ? Math.min(1, Math.max(0, raw.confidence)) : 0.8;
  const then = isRecord(raw.then) ? (JSON.parse(JSON.stringify(raw.then)) as JsonObject) : undefined;
  // Words that become a chip's text: one longer than a suggested choice is no single action, and it
  // is dropped rather than cut, so a cut can't hide a secret from the leak check that follows.
  const words = (v: JsonValue | undefined): string => {
    const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
    return s.length <= 120 ? s : "";
  };
  // The further actions, in order, up to the queue's bound. One no catalog action reads ends the
  // queue: it and every one after it (and any past the bound) are left in words, as `next` is.
  const queue: ReadAction[] = [];
  const rest: string[] = [];
  for (const entry of action && Array.isArray(raw.more) ? raw.more.slice(0, 16) : []) {
    const said = isRecord(entry) ? words(entry.text) : "";
    const id = isRecord(entry) && typeof entry.action === "string" ? entry.action : null;
    if (rest.length === 0 && queue.length < ACTION_QUEUE_LIMIT - 1 && isRecord(entry) && id !== null && actions.some((a) => a.id === id)) {
      const own: JsonObject = {};
      if (isRecord(entry.params)) for (const [k, v] of Object.entries(entry.params)) own[k] = JSON.parse(JSON.stringify(v ?? null)) as JsonValue;
      const thing = THING_SORTS.find((s) => s === entry.thing);
      queue.push({ action: id, params: own, text: said, ...(thing ? { thing } : {}) });
    } else if (said !== "") rest.push(said);
  }
  const next = [...rest, words(raw.next)].filter((s) => s !== "");
  // Why it read no action, for the log: a line at most.
  const reason = !action && typeof raw.reason === "string" ? raw.reason.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  const thing = action ? THING_SORTS.find((s) => s === raw.thing) : undefined;
  // The first action in the player's words (or what fills a time skip), for the intent gate's card.
  const lead = action ? words(raw.text) : "";
  // Routine changes the input states, read whatever its action: each keeps `said`, so the engine can
  // check the words are the player's own and a statement (`routineAsks`).
  const routine = (Array.isArray(raw.routine) ? raw.routine : []).flatMap((r): SaidRoutine[] => {
    if (!isRecord(r) || typeof r.said !== "string" || r.said.trim() === "") return [];
    const copy = JSON.parse(JSON.stringify(r)) as JsonObject;
    return [{ ...copy, said: r.said.replace(/\s+/g, " ").trim() }];
  }).slice(0, SAID_ROUTINES_MAX);
  return { action, params: action ? params : {}, probabilities: action ? { [action]: confidence, none: 1 - confidence } : { none: 1 }, ...(lead !== "" ? { text: lead } : {}), ...(thing ? { thing } : {}), ...(then ? { then } : {}), ...(queue.length > 0 ? { queue } : {}), ...(next.length > 0 ? { next } : {}), ...(reason !== "" ? { reason } : {}), ...(routine.length > 0 ? { routine } : {}) };
}

/** A way of paying said as a payment: a preposition or "use" before it ("pay with my credit card", "on my debit card", "in cash", "from savings"), and not a thing named after it ("a credit card holder"). */
const SAID_METHOD = /\b(?:with|on|using|use|used|by|from|in)\s+(?:(?:my|the|his|her|their|our|a)\s+)?(credit card|debit card|card|cash|savings)\b(?![ -](?:holder|register|machine|drawer|box|reader|terminal|slot|case|sleeve|wallet))/gi;
/** A mention ruled out just before it ("not with cash", "instead of …", "rather than …"). */
const NEGATED = /(?:\bnot|\bno|\bnever|n't|\binstead of|\brather than|\bthan)(?:\s+(?:pay|paying|paid))?\s*$/i;

/**
 * The way of paying the player's own words name, as said, for an action's `method` the model left
 * empty: "credit card", "debit card", "card", "cash" or "savings", said as a payment (`SAID_METHOD`). A
 * negated mention is skipped and the last one counts ("not with cash, with my debit card" is the
 * debit card). Null when the text names none.
 */
export function saidPayMethod(text: string): string | null {
  const said = [...text.matchAll(SAID_METHOD)].filter((m) => !NEGATED.test(text.slice(0, m.index))).at(-1)?.[1]?.toLowerCase();
  return said ?? null;
}

// ---------------------------------------------------------------- extract

export const EXTRACT_STRICT_RULES = [
  'time_advance only for an explicit jump or stated duration ("an hour later", "the next morning", "for twenty minutes"), as all the time the reply says passes from the player\'s message to its end, never less for what the turn already took; never estimate how long described activity took.',
  "knows only when the player character newly learns of a public person, thing or place from what is said or shown in this reply: fact is its id, or a place's name as the prose gives it; never a sentence or what they learned about it, never one already known, never what others learn.",
  "regard only when the prose states a clear change in how one character feels about another.",
  "give only for an explicit handover between two characters; a seller handing over what was bought is part of the purchase; picking something up is not a give.",
  "A purchase already covers its payment: do not add a transfer for it.",
  "One purchase per item: two things bought are two purchases, each with its own item and price; never one item that names both.",
  "life only when the prose states that someone died, is dying, collapsed or came round, or that the player character is told so; never a threat, a fear or a guess.",
  "routine only when the prose states a lasting change to someone's week: a new job or shift, a new habit, one they gave up, or a move to a new home, with the days and times the prose gives; never a one-off, a plan, a wish, someone's thoughts, or a habit only mentioned.",
  "take, drop, use_up, wear and lose only for a thing the prose says changed hands or state this reply: picked up or found (take), put down (drop), eaten, drunk or used up (use_up), put on or taken off (wear, off: true), lost or stolen (lose, by: the thief); item_condition only when it says a thing was damaged, worn out or mended.",
  "Never duplicate a change. When unsure, leave it out.",
];

/** The reply's item changes (DESIGN §9.4), each by who (`entity`, the player character when left out) and the thing, its id where the state lists it, else its name. */
const EXTRACT_ITEM_TYPES = "take{entity,item} · drop{entity,item} · use_up{entity,item,qty?} (qty: how many, 1 when not said) · wear{entity,item,off?} · lose{entity,item,by?} (by: who stole it) · item_condition{entity?,item,delta} (delta: as far as the prose says it changed, on the condition's 0..100 scale: damage negative, mending positive)";

/** What `extract` reads from a reply: the changes it proposes, and the place it leaves the player character in (a place id as the model gave it; null when it doesn't say). */
export interface ExtractRead {
  proposals: JsonObject[];
  where: string | null;
}

/** Where the reply leaves the player character, asked beside the changes: a reply can take a move as given without telling it, and no change holds that (DESIGN §9.4). */
const EXTRACT_WHERE = `Beside "proposals", give "where": the place where the reply leaves the player character at its end, whether it tells how they got there or takes it as given, as its id from Places (or its name as Places lists it); null when it doesn't say.`;

/** How `extract` may use the usual routines it is given (DESIGN §9.4): to place a move the reply describes, never to make one. */
const EXTRACT_USUAL = `Usual routines are given below the state, only to tell where a move the reply describes is going: someone who heads out to their usual spot ("his usual lunch place", "off to her regular bar") moves to that place; give its id from their usual routine, or place "usual" when the reply doesn't say which. A usual routine is never a move by itself: no location for someone the reply doesn't describe leaving or arriving.`;

/** `extract`: proposals read from a reply (DESIGN §9.4), and where it leaves the player character (`where`, asked while `location` is a channel). `instructions` (a world text template) lead the prompt; the contract stays; the preset's guidance and the step's lore follow. `usual`: the usual routines of the people with the player character as it may know them, given while `location` is a channel, apart from any fact. `places`: the places it is offered (`placeMenu`); `personKinds`: the kinds a newcomer may be. Empty on failure. */
export async function extract(
  steps: Steps,
  narration: string,
  world: WorldDoc,
  prefix: JsonValue,
  appliedMinutes: number,
  channels: string[],
  config: StepConfig | null,
  userId: UserId,
  signal: AbortSignal,
  instructions?: string,
  lore: StepLore | null = null,
  guidance = "",
  usual: readonly string[] = [],
  recent: readonly string[] = [],
  said = "",
  places: readonly PlaceChoice[] = [],
  personKinds: readonly string[] = [],
): Promise<ExtractRead> {
  // The world's regard axes with their ranges (the relationships pack's own, or its world's set).
  const regardAxes = axesOf({ world })
    .map((a) => `${a.id} (${a.min}..${a.max})`)
    .join("|");
  const types =
    `time_advance{minutes} · location{entity,place} (place: its id from Places, or its name as Places lists it) · purchase{item,category,payer?,qty?,price?,method?} (payer: the person who pays, an entity id, never an account or a card; method: how the prose says they paid, in its words, e.g. "cash", "debit card", "credit card" or "savings"; leave it out when not said) · transfer{from,to,amount,method?} (from and to: people, entity ids, or a person's own cash, checking, savings or card account, never things; method: "cash" when bills or coins change hands in person, as in "hands me $20" or "slips her a twenty"; leave it out for a bank transfer, an app payment or a card) · give{item,from,to,amount?} (amount: for cash or money handed over, the amount) · quantity{entity,item,delta} · condition{who,condition,minutes?,clear?} (a named condition such as tired or injured; clear:true when it ends) · regard{from,to,axis,delta} (axis ${regardAxes}; delta: as far as the prose moves it, inside the axis's range: worse negative, better positive) · knows{who,fact} (fact: the id of a person, thing or place the player character newly learns of, or the name of a place they first hear of; never a sentence) · spawn{kind,name,place?,role?} (a new character the reply introduces by name${personKinds.length > 0 ? `; kind: ${personKinds.join("|")}` : ""}; never a thing) · life{entity,state} (state: ${lifeStatesOf(world)
      .map(([id]) => id)
      .join("|")}) · routine{entity,change,label,days,start?,end?,minutes?,activity?,place?,with?,replaces?} (change: start for a new job, shift or habit, stop for one given up, move for a new home, its place the home; days: weekday names, weekdays, weekends or daily; start and end: HH:MM, or start morning|afternoon|evening|night; activity: work|school|exercise|leisure|socialize|errand; place: any place the prose names for it, as a place id, or in the prose's own words when nothing lists it ("the community pool"), left out only when the prose names none; with: people's ids; replaces: true only when the prose says it takes the place of what they did then)`;
  const allowed = channels.length > 0 ? `Only these types are enabled: ${channels.join(", ")}.` : "";
  const system = `${instructions ? `${instructions}\n` : ""}You read a narrator's roleplay reply and propose concrete state changes that the prose states actually happened.\n${worldBrief(world, places)}\nProposal types: ${types} · ${EXTRACT_ITEM_TYPES}. ${allowed}\nRules: no considered, refused or hypothetical changes; use world ids where they exist; one proposal per change. Money amounts are plain amounts in ${world.currency.code} as written (8 for ${world.currency.symbol}8).\nStrict rules:\n- ${EXTRACT_STRICT_RULES.join("\n- ")}\nOutput JSON only: {"proposals":[{"type":...}, ...]}.`;
  const moves = channels.length === 0 || channels.includes("location");
  const routines = moves && usual.length > 0;
  const asked = `${moves ? `${system}\n${EXTRACT_WHERE}` : system}${routines ? `\n${EXTRACT_USUAL}` : ""}`;
  // The player's message is what the reply answers ("I put on my coat" → "she shrugs it on"): context
  // for what the reply means, never a change of its own, since only what the reply states happened.
  const message = said.trim() !== "" ? `The player's message this reply answers (context only; propose only what the narration states happened):\n${said.trim()}\n` : "";
  const raw = await steps.helperJson("extract", asked, `State before: ${JSON.stringify(prefix)}\n${routines ? `Usual routines (where a described move goes; never a move by itself):\n${usual.join("\n")}\n` : ""}${message}Narration:\n${narration}`, config, userId, signal, { lore, guidance, recent });
  const list = isRecord(raw) && Array.isArray(raw.proposals) ? raw.proposals : Array.isArray(raw) ? raw : [];
  const proposals: JsonObject[] = [];
  for (const p of list) {
    if (!isRecord(p) || typeof p.type !== "string" || (channels.length > 0 && !channels.includes(p.type))) continue;
    // Narrated time is the turn's whole (DESIGN §9.4): only what goes beyond the minutes the turn
    // already applied (`appliedMinutes`) is proposed, so its action's own time is never counted twice,
    // whatever path applies it (automatically, or on a confirm chip's Apply).
    if (p.type === "time_advance") {
      const beyond = typeof p.minutes === "number" && Number.isFinite(p.minutes) ? Math.round(p.minutes - appliedMinutes) : 0;
      if (beyond > 0) proposals.push({ ...(JSON.parse(JSON.stringify(p)) as JsonObject), minutes: beyond });
      continue;
    }
    // Scaled once: a cash give becomes a transfer carrying its scaled amount.
    proposals.push(inMinorUnits(JSON.parse(JSON.stringify(p)) as JsonObject, world.currency));
  }
  const where = moves && isRecord(raw) && typeof raw.where === "string" && raw.where.trim() !== "" ? raw.where.trim() : null;
  return { proposals: dedupeProposals(proposals, world.pov), where };
}

/**
 * A model states money as written ("$8" is 8); the channels read minor units (cents). Converts a
 * proposal's money once: a purchase's `price`, a transfer's `amount`, and cash handed over
 * (`give` of "$20", "a twenty", "cash" with an `amount`), which becomes a cash transfer
 * (`method: "cash"`: bills changing hands go wallet to wallet) of the amount it states (in
 * `amount`, else in the item's own words). A model's own transfer keeps its method. A purchase's
 * `playerPrice` is the player's own, set on a chip, and `owned` the engine's (an unpriced purchase
 * priced later), so a model's are dropped. Every proposal a model step returns (`extract`, a world's
 * `effects` templates) goes through it once.
 */
export function inMinorUnits(p: JsonObject, currency: WorldCurrency): JsonObject {
  const cash = p.type === "give" && typeof p.item === "string" ? cashGift(p.item, currency) : null;
  const amount = typeof p.amount === "number" ? p.amount : (cash?.amount ?? undefined);
  const q: JsonObject = cash ? { type: "transfer", ...(typeof p.from === "string" ? { from: p.from } : {}), ...(typeof p.to === "string" ? { to: p.to } : {}), ...(amount !== undefined ? { amount } : {}), method: "cash" } : p;
  delete q.playerPrice;
  delete q.owned;
  const money = q.type === "purchase" ? "price" : q.type === "transfer" ? "amount" : null;
  const v = money ? q[money] : undefined;
  if (money && typeof v === "number" && Number.isFinite(v)) q[money] = Math.round(v * 10 ** currency.decimals);
  return q;
}

function same(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  return typeof a === "string" && typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Deterministic dedupe (DESIGN §9.4): a purchase subsumes the seller's handover of the item and its
 * payment transfer; exact duplicates go. (Cash handed over is already a transfer: `inMinorUnits`.)
 */
export function dedupeProposals(proposals: JsonObject[], pov: EntityId): JsonObject[] {
  const purchases = proposals.filter((p) => p.type === "purchase");
  const out: JsonObject[] = [];
  const seen = new Set<string>();
  for (const q of proposals) {
    if (q.type === "give" && purchases.some((b) => same(b.item, q.item) && (same(q.to, b.payer ?? pov) || same(q.to, pov)))) continue;
    if (q.type === "transfer" && purchases.length > 0 && (same(q.from, pov) || purchases.some((b) => same(q.from, b.payer)))) continue;
    const key = JSON.stringify(q);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}
