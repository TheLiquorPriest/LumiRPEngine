// The world's lore for RPEngine's own helpers (DESIGN §5.4). Each step run gets a `StepLore`: its
// lore policy and token budget, the reader it searches with (the step's purpose decides what it
// may read, and `engine/lore.ts` enforces it), the prefetch built from the step's own inputs at no
// extra call, the lookups its model may ask for, and the trace the inspector shows (§6.5).
//
// Lookups reach the model as native tools (`lore_search`, `lore_get`, `lore_list`) or, on a
// connection seen refusing tools, as the two-phase `{"need": [...]}` form. The host has no tool-role
// messages, so a round's results go back in a follow-up user message. Every round is one call on
// the phase's lookup budget, held before the model is offered it: a step that can't hold one gets
// no tools, and answers with its prefetch only.
//
// The trace is shown to the player, so it carries only what the player may know (§7). An
// unrevealed secret entry isn't in it at all, nor counted among what a search matched. A step that
// may read an unrevealed secret writes its lookups with what that secret says: they show as their
// kind and count only. `npc.choose` searches with an NPC's private options, so what it searched
// for and found would say what those are: its lookups show as their kind alone, its searches
// uncounted, and the entries it was given aren't listed. Any other step's text is withheld when it
// carries a secret, or names someone or somewhere the POV doesn't know; a lookup the model wrote is
// also withheld when it names a secret entry.

import type { UserId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord, safeKey } from "../shared/json";
import { loreIsSecret, topicIdOf } from "../shared/lore";
import type { StepLore as StepLoreSetting } from "../shared/settings";
import type { LoreStepTrace } from "../shared/state-view";
import type { LoreEntryDef, StepPurpose } from "../shared/world";
import { loreGet, loreList, loreSearch, readableLore, readsSecrets, type LoreHit, type LoreReader, type LoreResult } from "../engine/lore";
import { findLeaks, loreGateReader } from "../engine/visibility";
import type { HostPort, QuietResult, QuietTool } from "./host";
import { parseJsonReply } from "./steps";
import { readStoredJson } from "./stored-json";

/** What a step's prefetch searches with: its own inputs. */
export interface LoreInputs {
  /** What the step reads: the player's message, the reply, the decision's question… */
  text: string;
  /** The people and places it is about. */
  links: string[];
  /**
   * Private inputs (an NPC's options): what the trace shows instead of `text`, or null when it isn't
   * shown at all, being about no one the POV may know.
   */
  shown?: string | null;
}

/** How a step's lookups reach its model. */
export type LookupTransport = "tools" | "need";

/** One thing the model asked to read, or (`refused`) a call to a tool that isn't a lore tool, by its name. */
export interface LoreAsk {
  kind: "search" | "get" | "list" | "refused";
  text: string;
  topic?: string;
}

/** What a step's trace must not show (DESIGN §6.5); the caller leaves out what the player said this turn. */
export interface TraceWithheld {
  /** Text no line of the trace may carry: unrevealed secrets, and the names of people the player hasn't met and of places the POV can't see. */
  text: readonly string[];
  /** What leads to an unrevealed secret entry (its id, title, aliases, keys, terms and topics): no lookup the model wrote may name it. */
  names: readonly string[];
}

/** Hits a prefetch or a search may give; the token budget usually binds first. */
const SEARCH_LIMIT = 6;
/** Entries one `lore_list` answer names; the round's lore tokens usually bind first. */
const LIST_LIMIT = 12;
/** Asks one lookup round answers; the rest of a round's asks are dropped. */
const ROUND_ASKS = 3;
/** How much of a query the trace keeps. */
const TRACE_CHARS = 120;
/** What the trace shows for a query it withholds. */
const WITHHELD = "(withheld: it carries a secret)";
/** Topics a lookup's instructions name. */
const TOPICS_NAMED = 12;
/**
 * A lookup round starts only while this share of its phase's time is left, so a step that looks
 * lore up still has time for its own answer before the phase's deadline.
 */
export const LOOKUP_RESERVE = 1 / 3;

/** The lore tools a native lookup offers (Spindle's `ToolSchemaDTO`). */
export const LORE_TOOLS: readonly QuietTool[] = [
  {
    name: "lore_search",
    description: "Search the world's lore notes by words or names, optionally under one topic. Returns the best matches with excerpts.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Words or names to look for" }, topic: { type: "string", description: "A topic to look under" } }, required: ["query"] },
  },
  { name: "lore_get", description: "Read one lore note by its id (the [id] before a note).", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "lore_list", description: "List the lore notes filed under a topic.", parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] } },
];

/**
 * A phase's lookup budget (DESIGN §5.4): rounds, apart from the phase's calls. A step holds a round
 * before its model is offered lookups, spends it when the model asks, and releases it when the
 * model answers instead, so parallel steps never overdraw it. A round may start only within the
 * first `ms` of the phase, and only while `LOOKUP_RESERVE` of the phase's time is left.
 */
export class LookupBudget {
  private used = 0;
  private held = 0;
  private readonly started = performance.now();

  constructor(
    readonly calls: number,
    readonly ms: number,
    private readonly phaseMs: number,
    private readonly signal: AbortSignal,
  ) {}

  hold(): boolean {
    const elapsed = performance.now() - this.started;
    if (this.used + this.held >= this.calls || elapsed >= this.ms || this.signal.aborted || this.phaseMs - elapsed < this.phaseMs * LOOKUP_RESERVE) return false;
    this.held++;
    return true;
  }

  spend(): void {
    this.held = Math.max(0, this.held - 1);
    this.used++;
  }

  release(): void {
    this.held = Math.max(0, this.held - 1);
  }

  get spent(): number {
    return this.used;
  }
}

/** Lookups a step may make: the phase's budget, its transport, and what to do when its connection refuses tools. */
export interface StepLookups {
  budget: LookupBudget;
  transport: LookupTransport;
  /** Keeps the refusal for the step's connection, once the need form worked instead. */
  refused(reason: string): void;
}

export class StepLore {
  readonly trace: LoreStepTrace;
  /** The tools a native lookup offers. */
  readonly tools = LORE_TOOLS;
  /** The entries given so far, in the order given. */
  private readonly given = new Map<string, LoreHit>();
  /** An `effects` template reads no secret, whatever its purpose. */
  private readonly effects: boolean;
  /** Called with the snippets of new hits, for the host to count their tokens. */
  private readonly counted: (texts: readonly string[]) => void;
  private readonly lookups: StepLookups | null;
  private transport: LookupTransport;
  /** The step may read a secret whose gate doesn't hold: its model's lookups are written with what the secret says. */
  private readonly guarded: boolean;
  /** The step reads someone's private plans (`LoreInputs.shown`): what it searched for and found would say what those are. */
  private readonly privateInputs: boolean;
  /** Whether a secret entry's gate holds: one that doesn't is left out of the trace. */
  private readonly gateOpen: (entry: LoreEntryDef) => boolean;

  constructor(
    readonly purpose: StepPurpose,
    readonly setting: Readonly<StepLoreSetting>,
    private readonly reader: LoreReader,
    phase: "pre" | "post",
    private readonly withheld: TraceWithheld,
    options: { effects?: boolean; counted?: (texts: readonly string[]) => void; lookups?: StepLookups | null; privateInputs?: boolean } = {},
  ) {
    this.effects = options.effects === true;
    this.counted = options.counted ?? (() => undefined);
    this.lookups = setting.policy === "lookup" || setting.policy === "prefetch+lookup" ? (options.lookups ?? null) : null;
    this.transport = this.lookups?.transport ?? "tools";
    this.privateInputs = options.privateInputs === true;
    this.trace = { step: purpose, phase, policy: setting.policy, transport: "none", queries: [], entries: [], ...(this.privateInputs ? { private: true as const } : {}), lookups: 0, notes: [] };
    this.guarded = readsSecrets(reader.reg, reader.world, reader.state, purpose, this.effects);
    this.gateOpen = loreGateReader(reader.reg, reader.world, reader.state);
  }

  /** The prefetch: the index searched with the step's own inputs, at no extra call. */
  prefetch(inputs: LoreInputs): void {
    if (this.setting.policy !== "prefetch" && this.setting.policy !== "prefetch+lookup") return;
    this.take("prefetch", inputs.shown === undefined ? inputs.text : (inputs.shown ?? ""), loreSearch(this.reader, { query: inputs.text, links: inputs.links, purpose: this.purpose, effects: this.effects, limit: SEARCH_LIMIT, tokenBudget: this.setting.tokens }));
  }

  private note(text: string): void {
    if (!this.trace.notes.includes(text)) this.trace.notes.push(text);
  }

  /**
   * A query as the trace shows it: shortened, and withheld when it carries what the trace must not
   * show. A lookup the model wrote shows no text at all when the step may read a secret or reads
   * private inputs.
   */
  private shown(kind: LoreStepTrace["queries"][number]["kind"], text: string): string {
    if (kind !== "prefetch" && (this.guarded || this.privateInputs)) return "";
    const shown = text.replace(/\s+/g, " ").trim();
    if (findLeaks(shown, kind === "prefetch" ? this.withheld.text : [...this.withheld.text, ...this.withheld.names]).length > 0) return WITHHELD;
    return shown.length > TRACE_CHARS ? `${shown.slice(0, TRACE_CHARS)}…` : shown;
  }

  /**
   * Records a search in the trace and keeps the hits the step hasn't been given yet. An unrevealed
   * secret is neither listed nor counted; a private step's searches go uncounted and its entries
   * unlisted, since their titles, number and size would all say what its inputs are.
   */
  private take(kind: LoreStepTrace["queries"][number]["kind"], text: string, result: LoreResult): LoreHit[] {
    this.trace.queries.push({ kind, text: this.shown(kind, text), ...(this.privateInputs ? {} : { matched: result.matched - result.secret }) });
    const fresh = result.hits.filter((h) => !this.given.has(h.id));
    for (const h of fresh) {
      this.given.set(h.id, h);
      if (!h.secret && !this.privateInputs) this.trace.entries.push({ title: findLeaks(h.title, this.withheld.text).length > 0 ? "A hidden entry" : h.title, tokens: h.tokens, cut: h.cut });
    }
    if (fresh.length > 0) this.counted(fresh.map((h) => h.snippet));
    return fresh;
  }

  /** The lore given so far, a line per entry, with its id. */
  lines(): string[] {
    return [...this.given.values()].map((h) => `[${h.id}] ${h.snippet}`);
  }

  /** The block a helper prompt carries; empty when the step was given none. */
  block(): string {
    const lines = this.lines();
    return lines.length === 0 ? "" : `World lore (reference notes; they may be incomplete):\n${lines.map((l) => `- ${l}`).join("\n")}`;
  }

  /**
   * Holds a lookup round when the step may ask for one: its policy looks up, there is lore it may
   * read that it hasn't been given, and the phase's lookup budget has a round. The transport to
   * offer, or null: the step answers with what it has.
   */
  offer(): LookupTransport | null {
    if (!this.lookups) return null;
    const { reg, world, state } = this.reader;
    if (!readableLore(reg, world, state, this.purpose, this.effects).some((id) => !this.given.has(id))) return null;
    if (!this.lookups.budget.hold()) {
      this.note("No lookup: the phase's lookup budget was spent or its time was up, so the step used its prefetch.");
      return null;
    }
    this.trace.transport = this.transport;
    return this.transport;
  }

  /** The held round was made. */
  spend(): void {
    this.lookups?.budget.spend();
    this.trace.lookups++;
  }

  /** The held round wasn't needed. */
  release(): void {
    this.lookups?.budget.release();
  }

  /** The connection refused the tools: this step asks in the need form instead (the refusal is kept once that works). */
  refuseTools(): LookupTransport {
    this.transport = "need";
    this.trace.transport = "need";
    this.note("The connection refused the lore tools, so the step asked in the need form.");
    return "need";
  }

  /** Keeps a tool refusal for the step's connection. */
  keepRefusal(reason: string): void {
    this.lookups?.refused(reason);
  }

  /**
   * How the model may ask for lore, for its instructions. A topic is named only when the step can
   * read an entry under it: a topic only secrets are filed under would say what they are about.
   */
  instructions(transport: LookupTransport): string {
    const topics: string[] = [];
    for (const t of Object.values(this.reader.world.loreIndex.topics)) {
      if (topics.length >= TOPICS_NAMED) break;
      if (isRecord(t) && typeof t.label === "string" && t.label.trim() !== "" && loreList(this.reader, t.label, this.purpose, this.effects).length > 0) topics.push(t.label);
    }
    const named = topics.length > 0 ? ` Topics: ${topics.join(", ")}.` : "";
    if (transport === "tools") return `When the notes given aren't enough, you may look up the world's lore with the lore tools before you answer.${named}`;
    return `When you need world lore that isn't given here, reply with only {"need": ["a short query", …]} (at most ${ROUND_ASKS}) and nothing else; you'll get what the lore says, then answer.${named}`;
  }

  /** What the model asked to read in its reply, or null when the reply is its answer. */
  asked(reply: QuietResult, transport: LookupTransport): LoreAsk[] | null {
    if (transport === "tools") {
      const calls = reply.toolCalls ?? [];
      if (calls.length === 0) return null;
      const text = (args: JsonObject, key: string): string => {
        const v = args[key];
        return typeof v === "string" ? v.trim() : "";
      };
      return calls.slice(0, ROUND_ASKS).map((c): LoreAsk => {
        if (c.name === "lore_get") return { kind: "get", text: text(c.args, "id") };
        if (c.name === "lore_list") return { kind: "list", text: text(c.args, "topic") };
        // A tool the step never offered is refused: running it as a search would read what it didn't ask for.
        if (c.name !== "lore_search") return { kind: "refused", text: c.name.slice(0, 64) };
        const topic = text(c.args, "topic");
        return { kind: "search", text: text(c.args, "query"), ...(topic !== "" ? { topic } : {}) };
      });
    }
    let v: JsonValue;
    try {
      v = parseJsonReply(reply.content);
    } catch {
      return null;
    }
    if (!isRecord(v) || !Array.isArray(v.need)) return null;
    const needs = v.need.filter((n): n is string => typeof n === "string" && n.trim() !== "").slice(0, ROUND_ASKS);
    return needs.length > 0 ? needs.map((text) => ({ kind: "search", text: text.trim() })) : null;
  }

  /** Runs what the model asked, within the step's lore tokens for the round: the results as the model reads them. */
  answer(asks: readonly LoreAsk[]): string {
    let left = this.setting.tokens;
    const parts: string[] = [];
    for (const a of asks) {
      if (a.kind === "refused") {
        this.note("The model called a tool that isn't a lore tool, so it was refused.");
        parts.push(`${a.text}: not a lore tool, so nothing was run; the lore tools are lore_search, lore_get and lore_list`);
        continue;
      }
      if (a.kind === "list") {
        const listed = loreList(this.reader, a.text, this.purpose, this.effects);
        // The trace counts what the list names, an unrevealed secret left out, unless the step's
        // inputs are private.
        const lore = this.reader.world.lore;
        const shownCount = listed.filter((l) => {
          const def = hasOwn(lore, l.id) ? lore[l.id] : undefined;
          return !(def && loreIsSecret(def) && !this.gateOpen(def));
        }).length;
        this.trace.queries.push({ kind: "list", text: this.shown("list", a.text), ...(this.privateInputs ? {} : { matched: shownCount }) });
        // A list names entries within the round's lore tokens, as a search's snippets are.
        const lines: string[] = [];
        for (const l of listed.slice(0, LIST_LIMIT)) {
          const line = `[${l.id}] ${l.title}`;
          const cost = this.reader.tokens(line);
          if (cost > left) break;
          lines.push(line);
          left -= cost;
        }
        if (lines.length > 0) this.counted(lines);
        const more = listed.length - lines.length;
        parts.push(`lore_list "${a.text}": ${listed.length === 0 ? "nothing under that topic" : lines.length === 0 ? `${listed.length} under that topic, with no room left to name them` : `${lines.join("; ")}${more > 0 ? ` (and ${more} more; search under the topic to narrow it)` : ""}`}`);
        continue;
      }
      let result: LoreResult;
      if (a.kind === "get") {
        const hit = loreGet(this.reader, a.text, this.purpose, left, this.effects);
        result = { hits: hit ? [hit] : [], matched: hit ? 1 : 0, secret: hit?.secret === true ? 1 : 0 };
      } else {
        result = loreSearch(this.reader, { query: a.text, ...(a.topic ? { topics: [topicIdOf(a.topic)] } : {}), purpose: this.purpose, effects: this.effects, limit: SEARCH_LIMIT, tokenBudget: left, skip: new Set(this.given.keys()) });
      }
      const fresh = this.take(a.kind, a.text, result);
      left = Math.max(0, left - fresh.reduce((s, h) => s + h.tokens, 0));
      const label = `${a.kind === "get" ? "lore_get" : "lore_search"} "${a.text}"`;
      parts.push(fresh.length > 0 ? `${label}:\n${fresh.map((h) => `- [${h.id}] ${h.snippet}`).join("\n")}` : `${label}: nothing new${result.matched > 0 ? " (what it matches is given above)" : ""}`);
    }
    return `Lore you asked for:\n${parts.join("\n")}`;
  }

  /** The model's ask as the conversation's assistant turn: only the calls the round answered. */
  echo(reply: QuietResult, transport: LookupTransport): string {
    if (transport === "need") return reply.content;
    const calls = (reply.toolCalls ?? []).slice(0, ROUND_ASKS).map((c) => `${c.name} ${JSON.stringify(c.args)}`).join("\n");
    return [reply.content.trim(), calls].filter((s) => s !== "").join("\n");
  }
}

/** Where the connections seen refusing tool calls are kept (`userStorage/lore-tools.json`). */
export const TOOL_SUPPORT_PATH = "lore-tools.json";

/**
 * Which connections refused the lore tools (DESIGN §5.4), learned from a recorded failure and kept
 * per user, in memory and in storage, so `auto` lookups ask them in the need form from then on.
 * `ready` loads a user's record before a phase's steps read it.
 */
export class ToolSupport {
  private readonly users = new Map<UserId, Record<string, { at: number; reason: string }>>();

  constructor(private readonly host: Pick<HostPort, "storage" | "log">) {}

  async ready(userId: UserId): Promise<void> {
    if (this.users.has(userId)) return;
    const raw = await readStoredJson(this.host, TOOL_SUPPORT_PATH, userId, "lore tool support", (r) => isRecord(r) && r.v === 1 && isRecord(r.refused));
    const refused: Record<string, { at: number; reason: string }> = {};
    const stored = isRecord(raw) && isRecord(raw.refused) ? raw.refused : {};
    for (const [id, v] of Object.entries(stored)) if (safeKey(id) && isRecord(v) && typeof v.at === "number" && typeof v.reason === "string") refused[id] = { at: v.at, reason: v.reason.slice(0, 300) };
    this.users.set(userId, refused);
  }

  /** Whether a connection has been seen refusing tools (as far as the loaded record says). */
  refuses(userId: UserId, connectionId: string): boolean {
    const refused = this.users.get(userId);
    return refused !== undefined && hasOwn(refused, connectionId);
  }

  async refuse(userId: UserId, connectionId: string, reason: string): Promise<void> {
    if (!safeKey(connectionId)) return;
    await this.ready(userId);
    const refused = this.users.get(userId) ?? {};
    refused[connectionId] = { at: Date.now(), reason: reason.slice(0, 300) };
    this.users.set(userId, refused);
    this.host.log("info", `[LumiRPEngine] connection ${connectionId} refused the lore tools (${reason.slice(0, 120)}); its lookups use the need form from now on`, userId);
    await this.host.storage.write(`${TOOL_SUPPORT_PATH}.tmp`, JSON.stringify({ v: 1, refused }), userId);
    await this.host.storage.move(`${TOOL_SUPPORT_PATH}.tmp`, TOOL_SUPPORT_PATH, userId);
  }
}
