// Model steps over the host (DESIGN §5.2, §9.4, D10, D31). Routing: `interpret` and `extract` on
// the helper (a quiet JSON call on the user's connection); `npc.choose` on the
// Decision connection, falling back to the helper, then to engine-only. No blind retry: one JSON
// repair call when a helper reply doesn't parse (DESIGN §18.4), and `interpret` asks once more after
// a transient failure (a network reset, a timeout, a 5xx). Prompts are model-agnostic.

import type { ActionId, EntityId, UserId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { StepConfig } from "../shared/settings";
import type { StepPurpose, WorldCurrency, WorldDoc } from "../shared/world";
import type { Answers, Questions } from "../engine/decide";
import type { InterpretOutput } from "../engine/steps";
import { cashGift } from "../packs/gear/core/index";
import type { HostPort } from "./host";
import { HELPER_MAX_TOKENS } from "./settings-store";
import { readStoredJson } from "./stored-json";

export interface CallRecord {
  purpose: StepPurpose;
  via: "decision" | "helper";
  ok: boolean;
  ms: number;
  tokens: number;
}

interface Tally {
  calls: number;
  tokens: number;
  ms: number;
}

interface UserTallies {
  turns: Tally[];
  current: Tally;
}

/** Where a user's tallies are kept (`userStorage/call-meter.json`). */
export const METER_PATH = "call-meter.json";

/** Closed turns kept per user, for the average and the 95th percentile. */
export const METER_TURNS = 200;

function isTally(raw: unknown): raw is Tally {
  return isRecord(raw) && [raw.calls, raw.tokens, raw.ms].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
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
    if (known || !this.host) return known ?? this.remember(userId, { turns: [], current: { calls: 0, tokens: 0, ms: 0 } });
    const raw = await readStoredJson(this.host, METER_PATH, userId, "call meter", (r) => isRecord(r) && r.v === 1 && Array.isArray(r.turns) && isTally(r.current));
    const turns = isRecord(raw) && Array.isArray(raw.turns) ? raw.turns.filter(isTally).slice(-METER_TURNS) : [];
    const current = isRecord(raw) && isTally(raw.current) ? raw.current : { calls: 0, tokens: 0, ms: 0 };
    return this.remember(userId, { turns: turns.map((t) => ({ calls: t.calls, tokens: t.tokens, ms: t.ms })), current: { calls: current.calls, tokens: current.tokens, ms: current.ms } });
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
      const u = this.users.get(userId) ?? this.remember(userId, { turns: [], current: { calls: 0, tokens: 0, ms: 0 } });
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
    });
  }

  /** Closes the user's turn tally. */
  close(userId: UserId): void {
    this.change(userId, (u) => {
      u.turns.push(u.current);
      if (u.turns.length > METER_TURNS) u.turns.shift();
      u.current = { calls: 0, tokens: 0, ms: 0 };
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
    const { turns, current } = this.users.get(userId) ?? { turns: [], current: { calls: 0, tokens: 0, ms: 0 } };
    const last = turns.at(-1) ?? current;
    const avg = (key: keyof Tally): number => (turns.length === 0 ? 0 : Math.round(turns.reduce((s, t) => s + t[key], 0) / turns.length));
    const p95 = (key: keyof Tally): number => {
      if (turns.length === 0) return 0;
      const sorted = turns.map((t) => t[key]).sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] ?? 0;
    };
    return { turn: last, average: { calls: avg("calls"), tokens: avg("tokens"), ms: avg("ms") }, p95: { calls: p95("calls"), tokens: p95("tokens"), ms: p95("ms") } };
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
 * A failure worth one more try: the connection reset or dropped, the request timed out, or the
 * provider answered with a 5xx (the host words these as "… failed (502): …"). An abort is the
 * engine's own deadline, never retried.
 */
export function transientFailure(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/\bAbortError\b/.test(text)) return false;
  return /\b(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|ESOCKETTIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_[A-Z_]+)\b|socket hang up|socket connection was closed|connection (?:was )?(?:reset|closed)|fetch failed|network error|timed? ?out|\(5\d\d\)|\b(?:status|HTTP)\s*:?\s*5\d\d\b/i.test(text);
}

export class Steps {
  constructor(
    private readonly host: StepsHost,
    readonly meter: CallMeter,
  ) {}

  /**
   * A helper JSON call, with one repair call when the reply doesn't parse; with `retryTransient`, a
   * call that fails transiently (`transientFailure`) is made once more. Null on failure.
   */
  async helperJson(purpose: StepPurpose, system: string, user: string, config: StepConfig | null, userId: UserId, signal: AbortSignal, options: { retryTransient?: boolean } = {}): Promise<JsonValue | null> {
    const connectionId = config?.route?.connectionId ?? null;
    const maxTokens = Math.max(config?.maxTokens ?? HELPER_MAX_TOKENS, 1500);
    const call = async (messages: { role: "system" | "user"; content: string }[], retry: boolean): Promise<string | null> => {
      const t0 = performance.now();
      try {
        const r = await this.host.models.quiet({ messages, maxTokens, json: true, connectionId, model: config?.route?.model ?? null }, userId, signal);
        this.meter.record({ purpose, via: "helper", ok: true, ms: performance.now() - t0, tokens: r.tokens }, userId);
        // A reply that ran out of tokens is cut off mid-JSON; say so, as it reads as no JSON.
        if (r.finishReason === "length") this.host.log("warn", `[LumiRPEngine] ${purpose} helper reply was cut off at ${maxTokens} tokens (${r.content.length} characters)`, userId);
        return r.content;
      } catch (error) {
        this.meter.record({ purpose, via: "helper", ok: false, ms: performance.now() - t0, tokens: 0 }, userId);
        const again = retry && !signal.aborted && transientFailure(error);
        this.host.log("warn", `[LumiRPEngine] ${purpose} helper call failed${again ? ", asking once more" : ""}: ${error instanceof Error ? error.message : String(error)}`, userId);
        return again ? call(messages, false) : null;
      }
    };
    const first = await call(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      options.retryTransient === true,
    );
    if (first === null || first.trim() === "") return null;
    try {
      return parseJsonReply(first);
    } catch {
      const fixed = await call(
        [
          { role: "system", content: "Rewrite the text as valid JSON with the same meaning. Output JSON only." },
          { role: "user", content: first },
        ],
        false,
      );
      if (fixed === null) return null;
      try {
        return parseJsonReply(fixed);
      } catch {
        return null;
      }
    }
  }

  /** A decision call (D10): the Decision connection, then the helper, then null (engine-only). A `helper` route asks the helper on that route directly. */
  async decide(purpose: StepPurpose, state: JsonValue, questions: Questions, config: StepConfig | null, userId: UserId, signal: AbortSignal): Promise<{ answers: Answers; via: "decision" | "helper" } | null> {
    const t0 = performance.now();
    const viaHelper = config?.route?.provider === "helper";
    if (!viaHelper) {
      try {
        const r = await this.host.models.decide({ state, questions, connectionId: config?.route?.connectionId ?? null, model: config?.route?.model ?? null }, userId, signal);
        this.meter.record({ purpose, via: "decision", ok: true, ms: performance.now() - t0, tokens: r.tokens }, userId);
        if (Object.keys(r.answers).length > 0) return { answers: r.answers, via: "decision" };
      } catch (error) {
        this.meter.record({ purpose, via: "decision", ok: false, ms: performance.now() - t0, tokens: 0 }, userId);
        this.host.log("warn", `[LumiRPEngine] ${purpose} decision failed, using the helper: ${error instanceof Error ? error.message : String(error)}`, userId);
      }
    }
    if (signal.aborted) return null;
    const lines = Object.entries(questions).map(([key, q]) => {
      if (q.type === "choice") return `"${key}": choose one of ${JSON.stringify(Object.keys(q.criteria))}. ${q.instructions} Criteria: ${JSON.stringify(q.criteria)}`;
      if (q.type === "score") return `"${key}": score 0..${q.criteria.length - 1}. ${q.instructions} Levels: ${JSON.stringify(q.criteria)}`;
      return `"${key}": probability 0..1 that it is true. ${q.instructions}`;
    });
    const system = `Answer each question about the state with probabilities. Output JSON only: {"<key>": {"probabilities": {"<option>": number}}} for choice and score questions, and {"<key>": {"p": number}} for yes/no questions.`;
    const raw = await this.helperJson(purpose, system, `State: ${JSON.stringify(state)}\nQuestions:\n${lines.join("\n")}`, viaHelper && config ? config : { enabled: true, signals: [], maxTokens: config?.maxTokens ?? HELPER_MAX_TOKENS }, userId, signal);
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

// ---------------------------------------------------------------- the typed-input classifier

const ACTION_VERBS =
  /\b(go(?:ing)? to|walk|run|drive|driving|ride|head(?:ing)? (?:to|out|over|back|home)|travel|take|grab|pick up|drop|give|hand|lend|loan|wear|put on|take off|remove|use|buy|purchase|order|pay|transfer|send|refuel|fill (?:it|her) up|wait|sleep|bed\b|nap|rest|skip|examine|inspect|look (?:at|in|under)|search|open|close|lock|unlock|call|phone|text|borrow|steal|sell|attack|fight|hit|shoot|climb|jump|sneak|hide|cook|eat|drink|work|study|train|fix|repair|craft|build)\b/i;
const STRUCTURE = /\$\s?\d|\b\d+(?:\.\d+)?\s?(?:gal|gallons|dollars|bucks|minutes|mins|hours|hrs|days|weeks)\b|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d{1,2}:\d{2}\b|\b(?:until|till)\b/i;

/** DESIGN §5.2: fires on the action lexicon (the built-in verbs plus every action's `lexicon`), a known item, vehicle, account or place named as a target, or a structural cue. Deterministic, no model. */
export function classifyTyped(text: string, world: WorldDoc, lexicon: readonly string[] = []): boolean {
  if (ACTION_VERBS.test(text) || STRUCTURE.test(text)) return true;
  const lower = text.toLowerCase();
  for (const phrase of lexicon) if (phrase.trim().length > 2 && lower.includes(phrase.trim().toLowerCase())) return true;
  for (const [id, e] of Object.entries(world.entities)) {
    if (id === world.pov || e.kind === "person") continue;
    if (e.name.length > 2 && lower.includes(e.name.toLowerCase())) return true;
  }
  for (const p of Object.values(world.places)) if (p.name.length > 2 && lower.includes(`to ${p.name.toLowerCase()}`)) return true;
  return false;
}

// ---------------------------------------------------------------- interpret

function worldBrief(world: WorldDoc, extra: string): string {
  const pov = world.entities[world.pov];
  const people = Object.values(world.entities)
    .filter((e) => e.id !== world.pov)
    .slice(0, 40)
    .map((e) => `${e.id} (${e.name}, ${e.kind})`)
    .join(", ");
  const places = Object.values(world.places)
    .slice(0, 40)
    .map((p) => `${p.id} (${p.name})`)
    .join(", ");
  return `World: ${world.name}. The player character is ${pov?.name ?? world.pov} (id ${world.pov}). Entities: ${people || "none"}. Places: ${places || "none"}. ${extra}`;
}

/** `interpret`: typed input to at most one action (DESIGN §9.4). `instructions` (a world step template) lead the prompt; the output contract stays. Null when the call fails. */
export async function interpret(
  steps: Steps,
  text: string,
  world: WorldDoc,
  actions: { id: ActionId; label: string; params: string[]; lexicon?: string[] }[],
  scene: JsonValue,
  config: StepConfig | null,
  userId: UserId,
  signal: AbortSignal,
  instructions?: string,
): Promise<InterpretOutput | null> {
  if (actions.length === 0) return { action: null, params: {}, probabilities: { none: 1 } };
  const catalog = actions.map((a) => `${a.id} — ${a.label}${a.params.length > 0 ? ` (params: ${a.params.join(", ")})` : ""}${a.lexicon && a.lexicon.length > 0 ? ` [said as: ${a.lexicon.slice(0, 6).join(", ")}]` : ""}`).join("\n");
  const system = `${instructions ? `${instructions}\n` : ""}You map a player's typed input in a roleplay to at most one engine action.\n${worldBrief(world, `Scene: ${JSON.stringify(scene)}.`)}\nAction catalog:\n${catalog}\nRules: only the player character's own deliberate actions in the input count. Speech to others, requests, hypotheticals, past recaps and feelings are not actions (action null). If the input has two actions, return the first. If it also lets time pass after that action ("…and sleep until the next morning", "…then wait two hours"), add "then": {"minutes": number} or {"until": a day part, "shift" or "commitment"}. Use world ids for params. A text param that names an item keeps its qualifiers as written (size, kind, how: "large pizza, delivered", not "pizza"). Money params are plain amounts in ${world.currency.code} as written (200 for ${world.currency.symbol}200). Output JSON only: {"action": string|null, "params": {...}, "confidence": number, "then"?: {...}}.`;
  // A transient failure (a reset connection, a timeout) gets one more try: a turn whose action went unread runs as plain roleplay.
  const raw = await steps.helperJson("interpret", system, text, config, userId, signal, { retryTransient: true });
  if (!isRecord(raw)) return null;
  const action = typeof raw.action === "string" && actions.some((a) => a.id === raw.action) ? raw.action : null;
  const params: JsonObject = {};
  if (isRecord(raw.params)) for (const [k, v] of Object.entries(raw.params)) params[k] = JSON.parse(JSON.stringify(v ?? null)) as JsonValue;
  const confidence = typeof raw.confidence === "number" ? Math.min(1, Math.max(0, raw.confidence)) : 0.8;
  const then = isRecord(raw.then) ? (JSON.parse(JSON.stringify(raw.then)) as JsonObject) : undefined;
  return { action, params: action ? params : {}, probabilities: action ? { [action]: confidence, none: 1 - confidence } : { none: 1 }, ...(then ? { then } : {}) };
}

/** A way of paying said as a payment: a preposition or "use" before it ("pay with my credit card", "on my debit card", "in cash", "from savings"), and not a thing named after it ("a credit card holder"). */
const SAID_METHOD = /\b(?:with|on|using|use|used|by|from|in)\s+(?:(?:my|the|his|her|their|our|a)\s+)?(credit card|debit card|cash|savings)\b(?![ -](?:holder|register|machine|drawer|box|reader|terminal|slot|case|sleeve|wallet))/gi;
/** A mention ruled out just before it ("not with cash", "instead of …", "rather than …"). */
const NEGATED = /(?:\bnot|\bno|\bnever|n't|\binstead of|\brather than|\bthan)(?:\s+(?:pay|paying|paid))?\s*$/i;

/**
 * The way of paying the player's own words name, as said, for an action's `method` the model left
 * empty: "credit card", "debit card", "cash" or "savings", said as a payment (`SAID_METHOD`). A
 * negated mention is skipped and the last one counts ("not with cash, with my debit card" is the
 * debit card). Null when the text names none.
 */
export function saidPayMethod(text: string): string | null {
  const said = [...text.matchAll(SAID_METHOD)].filter((m) => !NEGATED.test(text.slice(0, m.index))).at(-1)?.[1]?.toLowerCase();
  return said ?? null;
}

// ---------------------------------------------------------------- extract

export const EXTRACT_STRICT_RULES = [
  'time_advance only for an explicit jump or stated duration ("an hour later", "the next morning", "for twenty minutes"); never estimate how long described activity took.',
  "knows only when the player character newly learns a public fact from what is said or shown in this reply; not facts already known, not what others learn.",
  "regard only when the prose states a clear change in how one character feels about another.",
  "give only for an explicit handover between two characters; a seller handing over what was bought is part of the purchase; picking something up is not a give.",
  "A purchase already covers its payment: do not add a transfer for it.",
  "One purchase per item: two things bought are two purchases, each with its own item and price; never one item that names both.",
  "Never duplicate a change. When unsure, leave it out.",
];

/** `extract`: proposals read from a reply (DESIGN §9.4). `instructions` (a world text template) lead the prompt; the contract stays. Empty on failure. */
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
): Promise<JsonObject[]> {
  const types =
    'time_advance{minutes} · location{entity,place} · purchase{item,category,payer?,qty?,price?,method?} (payer: the person who pays, an entity id, never an account or a card; method: how the prose says they paid, in its words, e.g. "cash", "debit card", "credit card" or "savings"; leave it out when not said) · transfer{from,to,amount,method?} (from and to: people, entity ids, or a person\'s own cash, checking, savings or card account, never things; method: "cash" when bills or coins change hands in person, as in "hands me $20" or "slips her a twenty"; leave it out for a bank transfer, an app payment or a card) · give{item,from,to,amount?} (amount: for cash or money handed over, the amount) · quantity{entity,item,delta} · condition{who,condition,minutes?,clear?} (a named condition such as tired or injured; clear:true when it ends) · regard{from,to,axis,delta} (axis trust|affection|respect; delta -3..3) · knows{who,fact} (public facts only) · spawn{kind,name,place?,role?}';
  const allowed = channels.length > 0 ? `Only these types are enabled: ${channels.join(", ")}.` : "";
  const system = `${instructions ? `${instructions}\n` : ""}You read a narrator's roleplay reply and propose concrete state changes that the prose states actually happened.\n${worldBrief(world, `Minutes already applied this turn: ${appliedMinutes}.`)}\nProposal types: ${types}. ${allowed}\nRules: no considered, refused or hypothetical changes; use world ids where they exist; one proposal per change. Money amounts are plain amounts in ${world.currency.code} as written (8 for ${world.currency.symbol}8).\nStrict rules:\n- ${EXTRACT_STRICT_RULES.join("\n- ")}\nOutput JSON only: {"proposals":[{"type":...}, ...]}.`;
  const raw = await steps.helperJson("extract", system, `State before: ${JSON.stringify(prefix)}\nNarration:\n${narration}`, config, userId, signal);
  const list = isRecord(raw) && Array.isArray(raw.proposals) ? raw.proposals : Array.isArray(raw) ? raw : [];
  const proposals: JsonObject[] = [];
  for (const p of list) {
    if (!isRecord(p) || typeof p.type !== "string" || (channels.length > 0 && !channels.includes(p.type))) continue;
    // Scaled once: a cash give becomes a transfer carrying its scaled amount.
    proposals.push(inMinorUnits(JSON.parse(JSON.stringify(p)) as JsonObject, world.currency));
  }
  return dedupeProposals(proposals, world.pov);
}

/**
 * A model states money as written ("$8" is 8); the channels read minor units (cents). Converts a
 * proposal's money once: a purchase's `price`, a transfer's `amount`, and cash handed over
 * (`give` of "$20", "a twenty", "cash" with an `amount`), which becomes a cash transfer
 * (`method: "cash"`: bills changing hands go wallet to wallet) of the amount it states (in
 * `amount`, else in the item's own words). A model's own transfer keeps its method. A purchase's
 * `playerPrice` is the player's own, set on a chip, so a model's is dropped. Every proposal a model
 * step returns (`extract`, a world's `effects` templates) goes through it once.
 */
export function inMinorUnits(p: JsonObject, currency: WorldCurrency): JsonObject {
  const cash = p.type === "give" && typeof p.item === "string" ? cashGift(p.item, currency) : null;
  const amount = typeof p.amount === "number" ? p.amount : (cash?.amount ?? undefined);
  const q: JsonObject = cash ? { type: "transfer", ...(typeof p.from === "string" ? { from: p.from } : {}), ...(typeof p.to === "string" ? { to: p.to } : {}), ...(amount !== undefined ? { amount } : {}), method: "cash" } : p;
  delete q.playerPrice;
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
