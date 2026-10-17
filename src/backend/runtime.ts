// The backend composition root (ARCHITECTURE §2): builds the registry from the packs, wires the
// ledger to the host, and implements the turn hooks (interpret before planning, extract before
// the commit, chips after it), the World Info interceptor (engine slots) and the state push.

import { hashJson, hashParts } from "../shared/hash";
import type { ChatId, ChipId, InterruptClass, MessageId, RevisionId, UserId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { ChatRun, EventRef, GenerationKind, LedgerEvent, MarkerBody, TimelapseTarget } from "../shared/ledger";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { neutralizeMacros } from "../shared/macros";
import type { ExtractionType, UserSettings } from "../shared/settings";
import { EXTRACTION_TYPES } from "../shared/settings";
import type { ContextGeneration, ContextView, StateView } from "../shared/state-view";
import type { ActionDef, WorldDoc } from "../shared/world";
import { formatMoney } from "../shared/world";
import { transferCents } from "../packs/economy/core/index";
import type { EngineTurnPlan } from "../engine/turn";
import { timelapseIntent } from "../engine/turn";
import { parseOverrides, parseTarget } from "../engine/time";
import { DOMAINS } from "../shared/ids";
import { boundProposal } from "../engine/bounds";
import { calendarOf, dateAt, formatClock, formatHHMM, nextTimeOfDay, weekdayName, type Calendar } from "../engine/calendar";
import type { Questions } from "../engine/decide";
import type { ChainMessage } from "../engine/ledger/chain";
import { LedgerFold } from "../engine/ledger/fold";
import type { LedgerCore, LedgerEnv } from "../engine/ledger/journal";
import { optionalQuery } from "../engine/pack-kit";
import type { PackDef, ReadContext } from "../engine/registry";
import { createRegistry, type Registry } from "../engine/registry-impl";
import { createRng } from "../engine/rng";
import { evalExpr, placeOfEntity, scopeEnv, truthy } from "../engine/scope";
import type { WorldState } from "../engine/state";
import type { InterpretOutput } from "../engine/steps";
import { checkAnswer } from "../engine/tracks";
import { playerKnows } from "../engine/player-events";
import { canSeeEntity, canSeePlace, findLeaks, playerTrack, unrevealedTruths } from "../engine/visibility";
import { openPuzzle } from "../packs/story/core/index";
import { Working } from "../engine/working";
import { EngineBook, placementOf, renderSection, sectionsOf, sectionTokens } from "./book";
import { ChipStore, type StoredChip } from "./chips";
import type { DryRun, HostPort, InterceptorInput, InterceptorResult } from "./host";
import { LedgerService, toChain, type TurnContext, type TurnHooks } from "./ledger-io";
import { StatePush } from "./push";
import { cacheKeyOf, gatherCandidates, selectLore } from "./selection";
import { effectiveMode, recordOutcome, SettingsStore } from "./settings-store";
import { CallMeter, classifyTyped, dedupeProposals, extract, interpret, saidPayMethod, Steps } from "./steps";
import { PlanNotes } from "./plan-notes";
import { presetCaveats, type PresetCaveat } from "./preset-lint";
import { applyProposals, type EnginePipeline, type PlanProse, TurnBridge } from "./turn-model";
import { contradiction, factLines, fires, noFacts, npcChoose, planFacts, presentNames, promptedEffects, promptedText, puzzleAnswer, refsExist, renderTemplate, runsOf, safeVars, StepBudget, templatesFor, tiesOf, type PlanStart, type SignalFacts, type StepRun, type Tie } from "./turn-steps";
import { buildView, clockMinutes, compactSpan, notWorldView, spanText, TIMELAPSE_ACTION } from "./view";
import { WorldStore } from "./worlds";

/** One interceptor run (`core.context`, DESIGN §6.5), with what the activation check and warnings need. */
export interface InspectorRecord extends ContextGeneration {
  /** Entries forced, for the activation check (not shown). */
  forced: string[];
  warnings?: string[];
}

export interface RuntimeOptions {
  host: HostPort;
  packs: readonly PackDef[];
  pipeline: EnginePipeline;
  /** World templates by id (Modern US starter and friends). */
  templates?: Record<string, (id: string, name: string) => WorldDoc>;
}

/** The connection key D4 learning counts under when a step runs on the user's active connection. */
export const ACTIVE_CONNECTION = "active";

/** Chips a read stores for its swipe; a read that replaces it (Re-read edit, Retry read) drops them. */
const READ_CHIP_KINDS: ReadonlySet<string> = new Set(["undo", "confirm", "decline", "choice", "contradiction"]);

/** Slots only a real turn's plan fills (DESIGN §5.1 Dry Run plans nothing), so a dry run can't confirm them. */
const TURN_ONLY_SLOTS: Readonly<Record<string, true>> = { outcome: true, montage: true, outline: true };

/**
 * The most a host token count may be, as a multiple of the section's padded estimate (which stays at
 * or above the real tokenizers); a larger count is ignored and the estimate stands in.
 */
const TOKEN_COUNT_CAP = 4;

function readRun(meta: JsonObject): ChatRun | null {
  const raw = meta[LEDGER_NAMESPACE];
  if (!isRecord(raw) || raw.v !== 1 || typeof raw.worldId !== "string" || typeof raw.revision !== "string" || typeof raw.runSeed !== "string") return null;
  return { v: 1, worldId: raw.worldId, revision: raw.revision, runSeed: raw.runSeed, startedAt: typeof raw.startedAt === "number" ? raw.startedAt : 0 };
}

/** Starting markers from the user's settings (DESIGN §4.3, §9.1): the revision, every level and tier cap, every time control. */
export function startMarkersFrom(settings: UserSettings, revision: string): MarkerBody[] {
  const out: MarkerBody[] = [{ kind: "migrate", to: revision }];
  for (const domain of DOMAINS) out.push({ kind: "resolve", domain, scope: { all: true }, to: settings.realism.levels[domain] });
  for (const tier of ["principal", "supporting", "background"] as const) {
    for (const [domain, level] of Object.entries(settings.realism.tierCaps[tier])) {
      const d = DOMAINS.find((x) => x === domain);
      if (d && level !== undefined) out.push({ kind: "resolve", domain: d, scope: { tier }, to: level });
    }
  }
  const t = settings.time;
  for (const [sceneType, minutes] of Object.entries(t.sceneTicks)) out.push({ kind: "time", control: "tick", scope: { sceneType }, to: minutes });
  out.push({ kind: "time", control: "scale", scope: { all: true }, to: t.scale });
  for (const [cls, policy] of Object.entries(t.interrupts)) out.push({ kind: "time", control: "interrupt", scope: { interrupt: cls as keyof typeof t.interrupts }, to: policy });
  for (const [activity, policy] of Object.entries(t.speedThrough)) out.push({ kind: "time", control: "speed_through", scope: { activity }, to: { mode: policy.mode, thresholdMinutes: policy.thresholdMinutes } });
  out.push({ kind: "time", control: "montage", scope: { all: true }, to: t.montage });
  out.push({ kind: "time", control: "unit_cap", scope: { all: true }, to: { agentDays: t.unitCap.agentDays, events: t.unitCap.events } });
  out.push({ kind: "time", control: "npc_calls", scope: { all: true }, to: t.npcCallsPerTimelapse });
  return out;
}

/**
 * Whether the POV may be told about an entity: itself, someone it has met, its own thing, or someone
 * it can see where it stands (an extraction chip must never name a stranger). A world
 * that doesn't place the POV can't tell who is present: every entity it can see counts.
 */
function povMayKnow(world: WorldDoc, state: Readonly<WorldState>, id: string): boolean {
  const pov = world.pov;
  if (id === pov || playerKnows(world, state, pov, id)) return true;
  if (!canSeeEntity(world, state, pov, id)) return false;
  const e = state.entities[id];
  if (e?.fields.owner === pov) return true;
  const here = placeOfEntity(state, pov);
  return here === undefined || placeOfEntity(state, id) === here;
}

/** The world as the POV may know it, for model prompts that list entities and places (`interpret`, `extract`). */
function povWorld(world: WorldDoc, state: Readonly<WorldState>): WorldDoc {
  return {
    ...world,
    entities: Object.fromEntries(Object.entries(world.entities).filter(([id]) => povMayKnow(world, state, id))),
    places: Object.fromEntries(Object.entries(world.places).filter(([id]) => canSeePlace(world, state, world.pov, id))),
  };
}

/** The prefix an extraction reads against: only entities and places the POV may know. */
function prefixSummary(world: WorldDoc, state: WorldState): JsonValue {
  const pov = state.entities[world.pov];
  const people: JsonObject = {};
  for (const [id, e] of Object.entries(state.entities)) {
    if (Object.keys(people).length >= 30) break;
    if (!povMayKnow(world, state, id)) continue;
    people[id] = { name: e.name, kind: e.kind, place: typeof e.fields.place === "string" ? e.fields.place : null };
  }
  const places = Object.keys(world.places).filter((p) => canSeePlace(world, state, world.pov, p)).slice(0, 40);
  return { clock: state.clock, pov: world.pov, povName: pov?.name ?? world.pov, cents: state.accounts[world.pov] ?? null, entities: people, places };
}

/**
 * Whether every entity and place a proposal names is one the POV may know; others never become chips
 * or changes. A value is matched as the channels read it, trimmed (and lowercased when only that
 * names something), so `" vera "` is Vera.
 */
export function proposalKnown(p: JsonObject, world: WorldDoc, state: Readonly<WorldState>): boolean {
  const named = (s: string): string => {
    const t = s.trim();
    return hasOwn(state.entities, t) || hasOwn(world.places, t) ? t : t.toLowerCase();
  };
  const ok = (v: JsonValue | undefined, depth: number): boolean => {
    if (typeof v === "string") {
      const id = named(v);
      return hasOwn(state.entities, id) ? povMayKnow(world, state, id) : hasOwn(world.places, id) ? canSeePlace(world, state, world.pov, id) : true;
    }
    if (depth > 3) return true;
    if (Array.isArray(v)) return v.every((x) => ok(x, depth + 1));
    if (isRecord(v)) return Object.values(v).every((x) => ok(x as JsonValue, depth + 1));
    return true;
  };
  return Object.entries(p).every(([k, v]) => k === "type" || ok(v, 0));
}

/**
 * Whether a narrated give hands the borrower what this turn lent them, or something inside it (the
 * glovebox of a lent truck): that's the loan itself, not a second change. A give of anything else
 * stays, even to the same person in the same turn. Keys aren't linked to what they open, so keys
 * handed over with a lend are their own proposal (DESIGN §22).
 */
export function lentAlong(p: JsonObject, pre: readonly LedgerEvent[], state: Readonly<WorldState>): boolean {
  if (p.type !== "give" || typeof p.item !== "string" || typeof p.to !== "string") return false;
  const idOf = (s: string): string | null => {
    const t = s.trim();
    if (hasOwn(state.entities, t)) return t;
    const named = Object.keys(state.entities).filter((id) => state.entities[id]?.name.toLowerCase() === t.toLowerCase());
    return named.length === 1 ? (named[0] ?? null) : null;
  };
  const item = idOf(p.item);
  const to = idOf(p.to);
  if (!item || !to) return false;
  const inside = (outer: string): boolean => {
    let cur = state.entities[item]?.relations.find((r) => r.type === "in")?.to;
    for (let guard = 0; cur && guard < 64; guard++) {
      if (cur === outer) return true;
      cur = state.entities[cur]?.relations.find((r) => r.type === "in")?.to;
    }
    return false;
  };
  return pre.some((e) => e.type === "link" && e.rel === "uses" && e.from === to && (e.to === item || inside(e.to)));
}

/** Words that don't name the thing bought ("a box of matches" is matches). */
const FILLER_WORDS: Record<string, true> = { a: true, an: true, the: true, of: true, some: true, my: true, your: true, his: true, her: true, their: true, our: true, this: true, that: true, and: true, or: true, for: true, to: true, from: true, at: true, with: true, in: true, on: true, by: true, per: true };

/** Words that start a trailing phrase about where, when or who a thing is for ("sandwich for lunch", "bus ticket to Boston"). */
const TRAILING_PREPOSITIONS: Record<string, true> = { for: true, to: true, from: true, at: true, with: true, in: true, on: true };

/** A word's singular, simply: "coffees" coffee, "lunches" lunch, "glasses" glass; "bus" and "glass" stay. */
function singular(w: string): string {
  if (w.length <= 3 || /(?:ss|us|is)$/.test(w)) return w;
  if (/(?:s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  return w.endsWith("s") ? w.slice(0, -1) : w;
}

/**
 * A purchase's name as two names are compared: lowercase; a catalog name's "Noun, qualifier" (or
 * "Noun (qualifier)") read as the noun, its qualifier's words kept for overlap ("Milk, whole" is milk,
 * with whole); a trailing "for/to/from/at/with/in/on …" phrase dropped ("sandwich for lunch" is a
 * sandwich); articles and stop words dropped; plurals singular. The head noun is the noun's last word.
 */
function itemWords(name: string): { head: string; words: Set<string> } | null {
  const text = name.toLowerCase().replace(/['’]/g, "");
  const cut = text.search(/[,(]/);
  const base = (cut < 0 ? text : text.slice(0, cut)).match(/[a-z0-9]+/g) ?? [];
  const qualifier = cut < 0 ? [] : (text.slice(cut + 1).match(/[a-z0-9]+/g) ?? []);
  const trailing = base.findIndex((w, i) => i > 0 && hasOwn(TRAILING_PREPOSITIONS, w));
  const kept = (ws: readonly string[]): string[] => ws.filter((w) => !hasOwn(FILLER_WORDS, w)).map(singular);
  const noun = kept(trailing < 0 ? base : base.slice(0, trailing));
  const head = noun.at(-1);
  return head === undefined ? null : { head, words: new Set([...noun, ...kept(qualifier)]) };
}

/**
 * Whether a narrated purchase is the one this turn's own action already made: the player typed the
 * Buy and the reply tells it again ("milk" for the bought "Milk, whole", "leather card holder" for
 * the bought "credit card holder"). Names compare as `itemWords` reads them. They match when one
 * name's words hold all of the other's, or when the head noun is the same and the shorter name
 * shares at least 2/3 of its words with the other; either way with any price the narration states
 * within ±25% of the Buy's: of what it charged, of the price the player typed for it (`typed`, minor
 * units), or of anywhere in its catalog row's (or category's) range, since a catalogued Buy is
 * charged the catalog's price, not the typed one ("you pay $3 for the coffee" after a typed $3
 * coffee charged $5.38). The same head noun at an equal stated price matches too ("slim leather
 * holder", $12). A different thing bought in the same turn stays ("lantern oil" at $6 after a $40
 * lantern). Only a purchase the player character (or something they own) pays for.
 */
export function boughtAlong(p: JsonObject, pre: readonly LedgerEvent[], ctx: ReadContext, typed: number | null = null): boolean {
  const { world, state } = ctx;
  if (p.type !== "purchase" || typeof p.item !== "string") return false;
  const payer = typeof p.payer === "string" ? p.payer.trim() : "";
  if (payer !== "" && payer !== world.pov && hasOwn(state.entities, payer) && state.entities[payer]?.fields.owner !== world.pov) return false;
  const said = itemWords(p.item);
  if (!said) return false;
  const stated = typeof p.price === "number" && Number.isFinite(p.price) ? Math.abs(p.price) : null;
  const near = (v: number): boolean => stated === null || Math.abs(stated - v) <= 0.25 * v;
  return pre.some((e) => {
    const memo = e.type === "economy.txn" && "data" in e ? e.data.memo : e.type === "post" ? e.memo : undefined;
    if (typeof memo !== "string" || !memo.startsWith("Bought ")) return false;
    const name = memo.slice("Bought ".length).replace(/\s×\d+$/, "");
    const qty = Number(/\s×(\d+)$/.exec(memo)?.[1] ?? 1);
    const bought = itemWords(name);
    if (!bought) return false;
    // The Buy's price: a posting moves it twice (out and in); the history line once, from the payer's own accounts.
    const lines = e.type === "post" ? e.lines : "data" in e && Array.isArray(e.data.lines) ? e.data.lines : [];
    const moved = lines.reduce((sum: number, l) => sum + (isRecord(l) && typeof l.amount === "number" ? Math.abs(l.amount) : 0), 0);
    const cents = e.type === "post" ? moved / 2 : moved;
    const sameHead = bought.head === said.head;
    if (sameHead && stated !== null && stated === cents) return true;
    const inBand = (): boolean => {
      const band = stated === null ? null : optionalQuery(ctx, "economy.bought_band")?.(ctx, name, qty, world.pov);
      return !!band && stated !== null && stated >= 0.75 * band.min && stated <= 1.25 * band.max;
    };
    if (!near(cents) && !(typed !== null && near(typed)) && !inBand()) return false;
    const [shorter, longer] = said.words.size <= bought.words.size ? [said.words, bought.words] : [bought.words, said.words];
    const shared = [...shorter].filter((w) => longer.has(w)).length;
    return shared === shorter.size || (sameHead && shared * 3 >= shorter.size * 2);
  });
}

/** What an extraction reads against: the state, its world, the record's seed and its pre-reply events. */
export interface ReadInput {
  state: WorldState;
  world: WorldDoc;
  seed: string;
  pre: LedgerEvent[];
}

/** Why a timelapse stopped, as the stop chip says it. */
const STOP_LABEL: Record<InterruptClass, string> = {
  invitation: "an invitation",
  bill: "a bill",
  decline: "a declined payment",
  incident: "an incident",
  quest: "a quest event",
  rule: "a world rule",
  arrival: "someone arrived",
  overdue: "an overdue loan",
  needs: "a need",
  weather: "a weather alert",
};

function trimMap<K, V>(map: Map<K, V>, cap = 64): void {
  while (map.size > cap) {
    const first = map.keys().next();
    if (first.done) return;
    map.delete(first.value);
  }
}

/** Sets `key` as the newest entry and evicts the oldest past `cap` (no unbounded per-chat maps). */
function lruSet<K, V>(map: Map<K, V>, key: K, value: V, cap: number): void {
  map.delete(key);
  map.set(key, value);
  trimMap(map, cap);
}

function signalWithin(signal: AbortSignal, ms: number): AbortSignal {
  return ms > 0 ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : signal;
}

export class Runtime implements TurnHooks {
  readonly host: HostPort;
  readonly registry: Registry;
  readonly worlds: WorldStore;
  readonly settings: SettingsStore;
  readonly chips: ChipStore;
  /** Planned-turn lines by seed, for Re-narrate after a restart. */
  readonly planNotes: PlanNotes;
  readonly book: EngineBook;
  readonly meter = new CallMeter();
  readonly steps: Steps;
  readonly ledger: LedgerService;
  readonly push: StatePush;
  readonly templates: Record<string, (id: string, name: string) => WorldDoc>;
  private readonly pipeline: EnginePipeline;
  /** Runs by `user \0 chat`. */
  private readonly runs = new Map<string, ChatRun | null>();
  private readonly bridges = new Map<ChatId, TurnBridge>();
  private readonly settingsCache = new Map<UserId, UserSettings>();
  private readonly inspector = new Map<ChatId, InspectorRecord[]>();
  private readonly delivery = new Map<ChatId, Record<string, "verified" | "unverified">>();
  /**
   * Host tokenizer counts of rendered section texts, by user and text hash: the host counts with each
   * user's own main model, so one user's count never prices another's section. A section costs its
   * count once the host has counted that exact text for that user; until then the estimate (with
   * margin) stands in and the count is fetched in the background, so the interceptor never waits on
   * the host. A count that isn't a finite number from 0 to `TOKEN_COUNT_CAP` times the estimate is
   * ignored, so a bogus count can't clip every section.
   */
  private readonly tokenCounts = new Map<string, number>();
  /** The world chat each user last generated in (the D32 preset lint dry-runs it when none is open). */
  private readonly lastWorldChat = new Map<UserId, ChatId>();
  /** The D32 preset caveats each chat's last dry run found (shown in the inspector). */
  private readonly presetWarnings = new Map<ChatId, string[]>();
  private readonly selectCache = new Map<ChatId, Map<string, boolean>>();
  /** Each open chat's pinned world revisions, by `user \0 chat`. */
  private readonly pins = new Map<string, Map<RevisionId, WorldDoc>>();
  /**
   * Notes for the next turn's Outcome slot (DESIGN §9.5: "the next Outcome slot says so"), from the
   * reply that produced them; dropped once a later message has committed and another follows.
   * In memory: a restart between the reply and the next turn loses them.
   */
  private readonly outcomeNotes = new Map<ChatId, OutcomeNote[]>();
  /** The pre-phase call budget per generation, shared by `beforePlan` and `afterPlan`. */
  private readonly preBudgets = new Map<string, StepBudget>();
  /** The POV's place after each chat's last plan (the `scene_change` signal). */
  private readonly lastPlace = new Map<ChatId, string | null>();
  /** What the pre phase saw, per generation, for the plan phase's signals. */
  private readonly prePhase = new Map<string, { facts: SignalFacts; text: string; start: PlanStart; connectionId: string | null }>();

  constructor(options: RuntimeOptions) {
    this.host = options.host;
    this.registry = createRegistry(options.packs);
    this.pipeline = options.pipeline;
    this.templates = options.templates ?? {};
    this.worlds = new WorldStore(this.host, this.registry);
    this.settings = new SettingsStore(this.host);
    this.chips = new ChipStore(this.host);
    this.planNotes = new PlanNotes(this.host);
    this.book = new EngineBook(this.host, this.worlds);
    this.steps = new Steps(this.host, this.meter);
    // Snapshots from another build never apply (the build defines LRE_BUILD_ID; tests fold as "dev").
    this.ledger = new LedgerService(this.host, (chatId, userId) => this.resolveEnv(chatId, userId), new LedgerFold(this.registry, { fingerprint: process.env.LRE_BUILD_ID ?? "dev" }));
    this.push = new StatePush(this.host, (chatId, userId) => this.view(chatId, userId));
  }

  start(): void {
    this.ledger.hooks = this;
    this.ledger.attach();
    this.host.registerInterceptor((input) => this.intercept(input), 50);
    this.host.on("MESSAGE_SENT", (e, userId) => {
      if (e.message.isUser && userId) void this.lapse(e.chatId, userId);
    });
    this.host.on("WORLD_INFO_ACTIVATED", (e) => this.onActivated(e.chatId, e.entries.map((x) => x.id)));
  }

  // ---------------------------------------------------------------- chats

  /** The chat's run as `userId` sees it. Cached per (user, chat), so one user's lookup never answers another's. */
  async runOf(chatId: ChatId, userId: UserId): Promise<ChatRun | null> {
    const key = `${userId}\u0000${chatId}`;
    if (this.runs.has(key)) return this.runs.get(key) ?? null;
    const run = readRun(await this.host.chats.chatMetadata(chatId, userId));
    lruSet(this.runs, key, run, 512);
    return run;
  }

  /** After attaching or upgrading a chat: drop cached state so it resolves afresh. */
  forgetChat(chatId: ChatId): void {
    for (const key of [...this.runs.keys()]) if (key.endsWith(`\u0000${chatId}`)) this.runs.delete(key);
    this.bridges.delete(chatId);
    this.ledger.forget(chatId);
  }

  private async resolveEnv(chatId: ChatId, userId: UserId): Promise<LedgerEnv | null> {
    const run = await this.runOf(chatId, userId);
    if (!run) return null;
    // The chat pins only the revisions its ledger references (its run's, its migrate targets),
    // loaded as its core asks for them; every other revision lives in the store's bounded LRU.
    const pinned = new Map<RevisionId, WorldDoc>();
    const missing = new Set<RevisionId>();
    lruSet(this.pins, `${userId}\u0000${chatId}`, pinned, 256);
    try {
      pinned.set(run.revision, (await this.worlds.get(run.worldId, userId, run.revision)).world);
    } catch (error) {
      this.host.log("warn", `[LumiRPEngine] chat ${chatId}: its world ${run.worldId} is unavailable (${error instanceof Error ? error.message : String(error)})`, userId);
      return null;
    }
    const settings = await this.settings.get(userId);
    lruSet(this.settingsCache, userId, settings, 256);
    // One bridge per chat run: a second env resolution (concurrent opens) must not orphan the
    // intents and plans the first one's core uses.
    const existing = this.bridges.get(chatId);
    const bridge = existing && existing.runSeed === run.runSeed ? existing : new TurnBridge(this.registry, this.pipeline, run.runSeed);
    lruSet(this.bridges, chatId, bridge, 256);
    return {
      types: this.registry,
      // A revision found in the user's cache (one just committed) is pinned on first use.
      worlds: (revision) => {
        const doc = pinned.get(revision) ?? this.worlds.cached(userId, run.worldId, revision);
        if (doc) pinned.set(revision, doc);
        return doc;
      },
      pin: async (revisions) => {
        for (const rev of revisions) {
          if (pinned.has(rev) || missing.has(rev)) continue;
          try {
            pinned.set(rev, (await this.worlds.get(run.worldId, userId, rev)).world);
          } catch {
            // Not one of the world's revisions: a fold that needs it reports the unknown revision.
            missing.add(rev);
          }
        }
      },
      run,
      model: bridge,
      // Settings seed new chats only (DESIGN §9.1): the latest settings, so the view before the first
      // record (its palette) and the first turn's plan use the same levels.
      startMarkers: () => startMarkersFrom(this.settings.known(userId) ?? this.settingsCache.get(userId) ?? settings, run.revision),
      newSeed: () => crypto.randomUUID(),
    };
  }

  /** The revisions a chat's ledger keeps loaded (diagnostics; a world's other revisions come and go through the store's LRU). */
  pinnedRevisions(chatId: ChatId, userId: UserId): RevisionId[] {
    return [...(this.pins.get(`${userId}\u0000${chatId}`)?.keys() ?? [])];
  }

  // ---------------------------------------------------------------- turn hooks

  /**
   * The pre phase (DESIGN §5.2, §5.3), before the plan: the turn's intent (a recorded palette or chip
   * action, else `interpret` when its signals fire), `npc.choose` for agents with the POV, and
   * `puzzle.answer` when an answer needs judging. One call budget covers this and `afterPlan`.
   */
  async beforePlan(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string | null; dryRun: boolean; connectionId: string | null; signal: AbortSignal }): Promise<void> {
    await this.keepBookAttached(input.chatId, input.userId);
    const bridge = this.bridges.get(input.chatId);
    const p = input.generationId ? input.core.journal.pending[input.generationId] : null;
    // A Re-narrate copies its source's plan (P3): no resolve, simulate or model calls before it.
    if (!bridge || input.dryRun || !p || p.kind === "continue" || p.kind === "impersonate" || (p.kind === "renarrate" && p.renarrateOf)) return;
    const settings = await this.settings.get(input.userId);
    lruSet(this.settingsCache, input.userId, settings, 256);
    const target = p.messageId ? input.observed.findIndex((m) => m.id === p.messageId) : input.observed.length;
    const before = input.observed.slice(0, target < 0 ? input.observed.length : target);
    const lastUser = before.findLast((m) => m.isUser);
    const text = lastUser ? (lastUser.swipes[lastUser.swipeId] ?? "") : "";
    const render = input.core.renderState(input.observed);
    if (!render) return;
    const budget = new StepBudget(settings.modelUse.budgets.pre.calls, settings.modelUse.budgets.pre.ms, input.signal);
    this.preBudgets.set(p.generationId, budget);
    trimMap(this.preBudgets);
    const ctx = this.registry.context(render.world, render.state);
    const ties = tiesOf(ctx, render.world, render.state);
    const recorded = lastUser ? (await this.host.chats.messages(input.chatId, input.userId)).find((m) => m.id === lastUser.id)?.metadata[LEDGER_NAMESPACE] : undefined;
    const all = [...this.registry.actions.values(), ...Object.values(render.world.actions)];
    const typed = text.trim() !== "" && !(isRecord(recorded) && typeof recorded.action === "string");
    const facts: SignalFacts = {
      ...noFacts(before.filter((m) => !m.isUser).length + 1),
      typed,
      classifier: typed && classifyTyped(text, render.world, [...all.flatMap((a) => a.lexicon ?? []), ...TIMELAPSE_LEXICON]),
      sceneChange: this.lastPlace.has(input.chatId) && this.lastPlace.get(input.chatId) !== placeOfEntity(render.state, render.world.pov),
      agentsPresent: presentNames(this.registry, render.world, render.state).length > 0,
      present: ties.present.length > 0,
      offscreen: ties.offscreen.length > 0,
      tieZone: ties.present.length > 0,
      invitation: (before.findLast((m) => !m.isUser)?.ledger?.swipes[String(before.findLast((m) => !m.isUser)?.swipeId ?? 0)]?.events ?? []).some((e) => e.type === "castlife.invitation"),
      timelapse: isRecord(recorded) && recorded.action === TIMELAPSE_ACTION,
    };
    // Intent and present-agent choices are independent: they run side by side.
    const intentTask = text.trim() === "" || bridge.hasIntent(text) ? Promise.resolve() : this.readIntent(bridge, text, recorded, render, all, settings, facts, budget, input.userId);
    const npcRuns = runsOf(settings.modelUse, render.world, "npc.choose", facts);
    const npcTask = npcRuns.length > 0 && ties.present.length > 0 && budget.take() ? npcChoose(this.steps, npcRuns[0] as StepRun, ties.present, (t) => this.describeTie(t, render.world, render.state), createRng(hashParts("lre.npc.pre", bridge.runSeed, p.generationId)), input.userId, budget.signal) : Promise.resolve([]);
    const [, decisions] = await Promise.all([intentTask, npcTask]);
    bridge.setDecisions(text, decisions);
    this.prePhase.set(p.generationId, { facts, text, start: { place: placeOfEntity(render.state, render.world.pov), clock: render.state.clock }, connectionId: input.connectionId });
    trimMap(this.prePhase);
    if (text.trim() !== "") this.host.log("info", `[LumiRPEngine] plan ${String(input.generationId).slice(0, 8)}: intent ${bridge.intentOf(text)?.action ?? "none"} ${JSON.stringify(bridge.intentOf(text)?.params ?? {}).slice(0, 240)}, ${decisions.length} npc decision(s), ${budget.spent} pre call(s)`, input.userId);
    await this.judgeAnswer(bridge, text, render, settings, facts, budget, input.userId);
  }

  /**
   * The plan phase (DESIGN §5.2, §5.3): with the plan made, `brief` and the prose `outline` (stacked
   * on the engine's beats) run side by side on the pre budget; their text goes to the Outline
   * slot. They see only player-visible facts (secrecy batching rule).
   */
  async afterPlan(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string; signal: AbortSignal }): Promise<void> {
    const bridge = this.bridges.get(input.chatId);
    const p = input.core.journal.pending[input.generationId];
    const pre = this.prePhase.get(input.generationId);
    if (!bridge || !p?.planned || p.renarrateOf || !pre) return;
    const plan = bridge.planFor(p.seed);
    const render = input.core.renderState(input.observed);
    if (!render) return;
    lruSet(this.lastPlace, input.chatId, placeOfEntity(render.state, render.world.pov), 256);
    const settings = this.settingsCache.get(input.userId) ?? (await this.settings.get(input.userId));
    const facts: SignalFacts = { ...pre.facts, ...planFacts(render.world, pre.start, render.state, plan) };
    const briefRuns = runsOf(settings.modelUse, render.world, "brief", facts, "text");
    const outlineRuns = runsOf(settings.modelUse, render.world, "outline", facts, "text");
    if (briefRuns.length === 0 && outlineRuns.length === 0) {
      await this.keepPlanLines(input.chatId, input.userId, p.seed, plan, render.world, undefined);
      return;
    }
    const budget = this.preBudgets.get(input.generationId) ?? new StepBudget(settings.modelUse.budgets.pre.calls, settings.modelUse.budgets.pre.ms, input.signal);
    const secrets = unrevealedTruths(render.world, render.state);
    const vars = safeVars(this.stepVars(render.world, render.state, plan, pre.text, ""), secrets);
    const run = (r: StepRun, kind: "brief" | "outline"): Promise<string[]> => (budget.take() ? promptedText(this.steps, r, kind, vars, secrets, input.userId, budget.signal).then((lines) => lines ?? []) : Promise.resolve([]));
    const [briefs, outlines] = await Promise.all([Promise.all(briefRuns.map((r) => run(r, "brief"))), Promise.all(outlineRuns.map((r) => run(r, "outline")))]);
    const brief = briefs.flat().join(" ").trim();
    const prose = { brief: brief === "" ? null : brief, outline: outlines.flat() };
    bridge.setProse(p.seed, prose);
    await this.keepPlanLines(input.chatId, input.userId, p.seed, plan, render.world, prose);
    this.host.log("info", `[LumiRPEngine] plan ${input.generationId.slice(0, 8)}: brief ${brief === "" ? "none" : "yes"}, ${outlines.flat().length} outline line(s), ${budget.spent} pre call(s)`, input.userId);
  }

  /** Stores the sections a plan feeds the narrator, so Re-narrate can rebuild them. */
  private async keepPlanLines(chatId: ChatId, userId: UserId, seed: string, plan: EngineTurnPlan | undefined, world: WorldDoc, prose: PlanProse | undefined): Promise<void> {
    if (!plan) return;
    try {
      await this.planNotes.put(chatId, userId, seed, { ...planLines(plan, world, this.registry), outline: planOutline(plan, prose) });
    } catch (error) {
      this.host.log("warn", `[LumiRPEngine] plan lines not kept: ${error instanceof Error ? error.message : String(error)}`, userId);
    }
  }

  /** The engine placeholders a step template may use (DESIGN §5.2), all player-visible after `safeVars`. */
  private stepVars(world: WorldDoc, state: WorldState, plan: EngineTurnPlan | undefined, user: string, reply: string): Record<string, string> {
    const place = placeOfEntity(state, world.pov);
    const facts = factLines(this.registry, world, state, []);
    return {
      world: world.name,
      pov: state.entities[world.pov]?.name ?? world.pov,
      place: place ? (world.places[place]?.name ?? place) : "",
      clock: formatClock(calendarOf(world), state.clock),
      scene: facts.slice(0, 8).join("\n"),
      facts: facts.join("\n"),
      present: presentNames(this.registry, world, state).join(", "),
      outcome: plan ? planLines(plan, world, this.registry).outcome.join("\n") : "",
      beats: (plan?.outline ?? []).join("\n"),
      brief: "",
      user,
      reply,
      recent: "",
    };
  }

  /** The turn's intent: a recorded palette or chip action, else `interpret` (helper JSON, or a Decision choice over the actions). */
  private async readIntent(bridge: TurnBridge, text: string, recorded: JsonValue | undefined, render: { world: WorldDoc; state: WorldState }, all: ActionDef[], settings: UserSettings, facts: SignalFacts, budget: StepBudget, userId: UserId): Promise<void> {
    // A palette or chip action records its intent on the user message (dispatch `lre.action`); it
    // survives restarts and a bridge that never saw the request.
    if (isRecord(recorded) && typeof recorded.action === "string") {
      const params = isRecord(recorded.params) ? (JSON.parse(JSON.stringify(recorded.params)) as JsonObject) : {};
      const target = recorded.action === TIMELAPSE_ACTION ? parseTarget(params.target) : null;
      const overrides: Record<string, string> = {};
      for (const [k, v] of Object.entries(parseOverrides(params.overrides))) if (typeof v === "string") overrides[k] = v;
      bridge.setIntent(text, recorded.action === TIMELAPSE_ACTION ? (target ? timelapseIntent(target, overrides) : null) : { action: recorded.action, params, probabilities: { [recorded.action]: 1 } });
      return;
    }
    // Letting time pass is always in the catalog, so a world without actions still interprets.
    const run = runsOf(settings.modelUse, render.world, "interpret", facts)[0];
    if (!run || !budget.take()) {
      bridge.setIntent(text, null);
      return;
    }
    const scene = { place: placeOfEntity(render.state, render.world.pov) };
    // Letting time pass is an engine action too ("I sleep until the next morning").
    const dayParts = render.world.calendar.dayParts.map((d) => d.id);
    const timelapseEntry = { id: TIMELAPSE_ACTION, label: `Let time pass (wait, sleep, skip ahead): minutes for a stated duration, or until one of ${[...dayParts, "shift", "commitment"].join(", ")} ("next <day part>" for the following day's)`, params: ["minutes", "until"], lexicon: TIMELAPSE_LEXICON };
    // Answer names the open puzzles the player can see, so a typed "I dial 1887" finds it.
    const puzzles = openPuzzleTitles(this.registry, render.world, render.state);
    const labelOf = (a: ActionDef): string => (a.pack === "story" && a.id === "answer" && puzzles.length > 0 ? `${a.label} (open: ${puzzles.join("; ")})` : a.label);
    const catalog = [...all.map((a) => ({ id: a.id, label: labelOf(a), params: Object.keys(a.params), ...(a.lexicon ? { lexicon: a.lexicon } : {}) })), timelapseEntry];
    let result: InterpretOutput | null;
    if (run.config.route?.provider === "decision") {
      // A Decision route answers which action (or none); a helper call fills its params when it has any.
      const criteria: Record<string, string> = { none: "Not an action: speech, a request, a feeling or a recap." };
      for (const a of all) criteria[a.id] = labelOf(a);
      criteria[TIMELAPSE_ACTION] = timelapseEntry.label;
      const answer = await this.steps.decide("interpret", { text, scene }, { action: { type: "choice", instructions: run.template?.template ?? "Which engine action does the player character deliberately take in this typed input?", criteria } }, run.config, userId, budget.signal);
      const a = answer?.answers.action;
      const chosen = a?.type === "choice" && a.choice !== "none" ? (a.choice === TIMELAPSE_ACTION ? { id: TIMELAPSE_ACTION, params: { minutes: null, until: null } } : all.find((x) => x.id === a.choice)) : undefined;
      if (!chosen) result = a?.type === "choice" ? { action: null, params: {}, probabilities: a.probabilities } : null;
      else if (Object.keys(chosen.params).length === 0 || !budget.take()) result = { action: chosen.id, params: {}, probabilities: a?.type === "choice" ? a.probabilities : { [chosen.id]: 1 } };
      else result = await interpret(this.steps, text, povWorld(render.world, render.state), catalog.filter((c) => c.id === chosen.id), scene, { ...run.config, route: { provider: "helper", connectionId: null, model: null } }, userId, budget.signal);
    } else {
      result = await interpret(this.steps, text, povWorld(render.world, render.state), catalog, scene, run.config, userId, budget.signal, run.template ? renderTemplate(run.template.template, { world: render.world.name, pov: render.state.entities[render.world.pov]?.name ?? render.world.pov }) : undefined);
    }
    // A bare time span reads as the timelapse itself; one after another action ("I head home and
    // sleep until the next morning") is offered once that action has run.
    const timeOnly = result?.action === TIMELAPSE_ACTION ? result.params : result && !result.action && result.then ? result.then : null;
    if (timeOnly) {
      const target = interpretedTarget(timeOnly, render.world, render.state.clock, text);
      // A short span runs in the turn; a longer one is offered (a misread can't skip days unasked).
      const over = target?.type === "duration" && target.minutes > INTERPRETED_TIMELAPSE_CAP;
      bridge.setOffer(text, over ? target : null);
      bridge.setIntent(text, target && !over ? timelapseIntent(target) : null, target !== null && !over);
      return;
    }
    bridge.setOffer(text, result?.then ? interpretedTarget(result.then, render.world, render.state.clock, text) : null);
    // The model states money as written ("$200"); money params are minor units (cents).
    const chosen = result?.action ? all.find((a) => a.id === result.action) : undefined;
    if (result && chosen) {
      const scale = 10 ** render.world.currency.decimals;
      for (const [name, def] of Object.entries(chosen.params)) {
        const v = result.params[name];
        if (def.type === "money" && typeof v === "number" && Number.isFinite(v)) result.params[name] = Math.round(v * scale);
      }
      // A way of paying the player named that the model left out (a long sentence can lose it) is
      // taken from the player's own words; a method the model did set stands.
      const method = result.params.method;
      const said = hasOwn(chosen.params, "method") && !(typeof method === "string" && method.trim() !== "") ? saidPayMethod(text) : null;
      if (said) result.params.method = said;
    }
    if (result?.action && !refsExist(this.registry, all.find((a) => a.id === result.action), result.params, render.world, render.state)) {
      this.host.log("info", `[LumiRPEngine] interpret: ${result.action} names nothing in the world (${JSON.stringify(result.params)}); played as roleplay`, userId);
      bridge.setIntent(text, null);
      return;
    }
    bridge.setIntent(text, result, true);
  }

  /** `puzzle.answer` (DESIGN §10): an Answer the stage can't match exactly is judged, then retried with the probability. */
  private async judgeAnswer(bridge: TurnBridge, text: string, render: { world: WorldDoc; state: WorldState }, settings: UserSettings, facts: SignalFacts, budget: StepBudget, userId: UserId): Promise<void> {
    const intent = bridge.intentOf(text);
    if (!intent?.action || this.registry.actions.get(intent.action)?.pack !== "story" || intent.action !== "answer") return;
    // The model names the puzzle loosely, or not at all: resolve it as the story pack does.
    const track = openPuzzle(this.registry.context(render.world, render.state), typeof intent.params.puzzle === "string" ? intent.params.puzzle : "") ?? "";
    const answer = typeof intent.params.answer === "string" ? intent.params.answer : "";
    if (typeof intent.params.decision === "number" || !checkAnswer(render.world, render.state, track, answer).needsDecision) return;
    const stage = render.world.tracks[track]?.stages[render.state.tracks[track]?.stage ?? render.world.tracks[track]?.start ?? ""];
    const run = runsOf(settings.modelUse, render.world, "puzzle.answer", facts)[0];
    if (!run || !stage?.answer || !budget.take()) return;
    const p = await puzzleAnswer(this.steps, run, stage.label, stage.answer.expect, answer, userId, budget.signal);
    if (p !== null) bridge.setIntent(text, { ...intent, params: { ...intent.params, puzzle: track, decision: p } }, bridge.wasInterpreted(text));
  }

  /** What `npc.choose` sees about one tie: who, where, when, and the options (private plans stay in this decision call). */
  private describeTie(t: Tie, world: WorldDoc, state: WorldState): JsonValue {
    const e = state.entities[t.agent];
    const place = placeOfEntity(state, t.agent);
    return { agent: e?.name ?? t.agent, at: place ? (world.places[place]?.name ?? place) : null, time: formatClock(calendarOf(world), state.clock), options: t.options };
  }

  /**
   * The world's book must stay in the chat's `chat_world_book_ids` (DESIGN §4.2): attaching another
   * chat book from the host's UI replaces the list, which would silently drop every engine slot.
   */
  private async keepBookAttached(chatId: ChatId, userId: UserId): Promise<void> {
    const run = await this.runOf(chatId, userId);
    if (!run) return;
    const bookId = (await this.worlds.index(run.worldId, userId))?.loreBookId;
    if (!bookId) return;
    const meta = await this.host.chats.chatMetadata(chatId, userId);
    const ids = Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids : [];
    if (ids.includes(bookId)) return;
    this.host.log("warn", `[LumiRPEngine] chat ${chatId}: the world's book was detached; re-attaching it`, userId);
    await this.book.attach(chatId, bookId, userId);
  }

  private readonly bookNames = new Map<string, string>();

  /** A user book's display name (cached; book ids are stable), for the Context inspector. */
  private async bookName(bookId: string, userId: UserId): Promise<string> {
    const known = this.bookNames.get(bookId);
    if (known) return known;
    const name = (await this.host.books.name(bookId, userId).catch(() => null)) ?? bookId;
    lruSet(this.bookNames, bookId, name, 1024);
    return name;
  }

  async beforeCommit(input: TurnContext): Promise<void> {
    let context: ReadInput | null;
    if (input.kind === "continue") {
      const index = input.observed.findIndex((m) => m.id === input.messageId);
      const head = input.core.fold(input.observed.slice(0, index + 1));
      const world = input.core.worldAt(head.state.revision);
      context = world ? { state: head.state, world, seed: "", pre: [] } : null;
    } else {
      context = input.core.commitContext(input.generationId, input.messageId, input.observed);
    }
    if (context) await this.prepareRead(input.chatId, input.userId, input.messageId, input.swipeId, input.generationId, input.content, context, input.kind !== "continue");
  }

  /**
   * The post phase (DESIGN §5.2, §5.3), before the read commits: `extract` (or world `effects`
   * templates), off-screen `npc.choose`, `contradiction` and `choices`, side by side on the post
   * budget. Proposals are sorted by mode (D4 precedence, then bounds); the automatic ones and the
   * decisions are prepared for the core's read; undo, confirm, decline, contradiction and choice
   * chips are stored. With `replace` (a Re-read edit), the read replaces the swipe's earlier one, so
   * that read's chips go first.
   */
  async prepareRead(chatId: ChatId, userId: UserId, messageId: MessageId, swipeId: number, key: string, text: string, context: ReadInput, post: boolean, replace = false): Promise<void> {
    if (replace) await this.chips.removeWhere(chatId, userId, (c) => c.messageId === messageId && c.swipeId === swipeId && READ_CHIP_KINDS.has(c.kind));
    const bridge = this.bridges.get(chatId);
    if (!bridge) return;
    const settings = await this.settings.get(userId);
    const input = { chatId, userId, messageId, generationId: key, content: text };
    const pre = this.prePhase.get(key);
    const plan = bridge.planFor(context.seed);
    const ctx = this.registry.context(context.world, context.state);
    const ties = tiesOf(ctx, context.world, context.state);
    const facts: SignalFacts = { ...(pre?.facts ?? noFacts()), ...(pre ? planFacts(context.world, pre.start, context.state, plan) : {}), reply: text.trim() !== "", present: false, offscreen: ties.offscreen.length > 0, tieZone: ties.offscreen.length > 0 };
    // The user's post-phase deadline as set (no silent 15 s floor).
    const budget = new StepBudget(settings.modelUse.budgets.post.calls, settings.modelUse.budgets.post.ms);
    const secrets = unrevealedTruths(context.world, context.state);
    const vars = safeVars(this.stepVars(context.world, context.state, plan, pre?.text ?? "", text), secrets);
    const modelUse = settings.modelUse;
    // Each step takes its call from the budget when it starts, in priority order.
    const extractRun = runsOf(modelUse, context.world, "extract", facts).find((r) => r.template === null || r.template.output !== "effects");
    const extractTask = extractRun && budget.take()
      ? extract(this.steps, text, povWorld(context.world, context.state), prefixSummary(context.world, context.state), clockMinutes(context.pre), EXTRACTION_TYPES.filter((t) => t === "time_advance" || this.registry.proposals.has(t)), extractRun.config, userId, budget.signal, extractRun.template ? renderTemplate(extractRun.template.template, vars) : undefined)
      : Promise.resolve([]);
    const effectsTasks = (["extract", "contradiction", "choices"] as const).flatMap((purpose) => runsOf(modelUse, context.world, purpose, facts, "effects")).map((r) => (budget.take() ? promptedEffects(this.steps, r, vars, context.world.currency, userId, budget.signal) : Promise.resolve([])));
    const npcRun = runsOf(modelUse, context.world, "npc.choose", facts)[0];
    const npcTask = npcRun && ties.offscreen.length > 0 && budget.take() ? npcChoose(this.steps, npcRun, ties.offscreen, (t) => this.describeTie(t, context.world, context.state), createRng(hashParts("lre.npc.post", bridge.runSeed, key)), userId, budget.signal) : Promise.resolve([]);
    const contradictionRun = runsOf(modelUse, context.world, "contradiction", facts).find((r) => r.template === null || r.template.output === "decision");
    const told = [...(plan ? planLines(plan, context.world, this.registry).outcome : []), ...factLines(this.registry, context.world, context.state, secrets)];
    const contradictionTask = contradictionRun && post && budget.take() ? contradiction(this.steps, contradictionRun, told, text, userId, budget.signal) : Promise.resolve(null);
    const choiceRuns = runsOf(modelUse, context.world, "choices", facts, "text");
    const choiceTasks = choiceRuns.map((r) => (post && budget.take() ? promptedText(this.steps, r, "choices", vars, secrets, userId, budget.signal).then((lines) => lines ?? []) : Promise.resolve([])));
    const [extracted, effects, decisions, contradicted, choices] = await Promise.all([extractTask, Promise.all(effectsTasks), npcTask, contradictionTask, Promise.all(choiceTasks)]);
    // Proposals naming what the POV can't know (a hidden or unmet entity, a secret place) are dropped,
    // and so are the turn's own action told again: a give of what it lent, a purchase it made (with
    // the price the player typed for this turn's Buy, in minor units, when there is one).
    const intent = pre ? bridge.intentOf(pre.text) : null;
    const typed = intent?.action === "buy" && typeof intent.params.price === "number" ? intent.params.price : null;
    const deduped = dedupeProposals([...extracted, ...effects.flat()], context.world.pov).filter((p) => !lentAlong(p, context.pre, context.state) && !boughtAlong(p, context.pre, ctx, typed));
    const known = deduped.filter((p) => proposalKnown(p, context.world, context.state));
    if (known.length < deduped.length) this.host.log("info", `[LumiRPEngine] read ${messageId.slice(0, 8)}: dropped ${deduped.length - known.length} proposal(s) naming what the player hasn't seen`, userId);
    // So is one carrying a secret's unrevealed truth: its chip would show it.
    const proposals = known.filter((p) => findLeaks(p, secrets).length === 0);
    if (proposals.length < known.length) this.host.log("info", `[LumiRPEngine] read ${messageId.slice(0, 8)}: dropped ${known.length - proposals.length} proposal(s) carrying an unrevealed secret`, userId);
    this.host.log("info", `[LumiRPEngine] read ${messageId.slice(0, 8)}: ${proposals.length} proposal(s), ${decisions.length} npc decision(s), contradiction ${contradicted ? "yes" : "no"}, ${choices.flat().length} choice(s), ${budget.spent} post call(s)`, userId);
    const learning = await this.settings.learningOf(input.userId);
    // D4 learning counts on the connection that read the reply. A chip-triggered read
    // (Re-read, Retry read) or a Continue without a pre phase was read on the user's default
    // connection, the one Settings shows.
    const connection = extractRun?.config.route?.connectionId ?? pre?.connectionId ?? (await this.activeConnectionId(userId));
    const auto: JsonObject[] = [];
    const confirm: JsonObject[] = [];
    for (const p of proposals) {
      const type = EXTRACTION_TYPES.find((t) => t === p.type);
      if (!type) continue;
      const { mode: typeMode } = effectiveMode(settings, learning, connection, type);
      const entity = typeof p.entity === "string" ? p.entity : typeof p.who === "string" ? p.who : typeof p.from === "string" ? p.from : undefined;
      const field = typeof p.field === "string" ? p.field : undefined;
      const bounded = boundProposal(this.registry, context.world, context.state, { type, ...(entity ? { entity } : {}), ...(field ? { field } : {}), ...(typeof p.delta === "number" ? { delta: p.delta } : {}) }, { typeMode, ...(settings.extraction[type]?.maxDelta !== undefined ? { typeMaxDelta: settings.extraction[type]?.maxDelta } : {}) });
      const fitted: JsonObject = bounded.delta !== undefined ? { ...p, delta: bounded.delta } : p;
      if (bounded.mode === "auto") auto.push(fitted);
      else if (bounded.mode === "confirm") confirm.push(fitted);
    }
    bridge.prepareRead(input.content, { auto, post, events: decisions });
    // `choices` and `contradiction` become chips below, with the read's others.
    // Each automatic proposal gets an undo chip; each confirm proposal a confirm chip (DESIGN §11).
    // An automatic proposal the engine refuses gets a decline chip instead, never silence: a payment
    // that can't be covered (with Pay another way), or anything else that can't apply (no amount, an
    // unknown item). The next Outcome slot says it didn't happen (DESIGN §9.5).
    const w = new Working(this.registry, context.world, context.state);
    const outcomes = applyProposals(this.registry, w, auto.filter((p) => p.type !== "time_advance"), `${context.seed}:preview`, bridge.runSeed);
    const stored: StoredChip[] = [];
    const declines: { proposal: JsonObject; reason: string; payment: boolean }[] = [];
    outcomes.forEach((o, i) => {
      if (o.rejection) {
        if (o.rejection.code !== "declined") this.host.log("info", `[LumiRPEngine] read ${input.messageId.slice(0, 8)}: ${describeProposal(o.proposal)} didn't apply (${o.rejection.code}: ${o.rejection.reason})`, input.userId);
        declines.push({ proposal: o.proposal, reason: o.rejection.reason, payment: o.rejection.code === "declined" });
        return;
      }
      if (o.events.length === 0) return;
      const type = String(o.proposal.type);
      stored.push({
        id: `undo:${input.messageId}:${input.generationId}:${i}`,
        kind: "undo",
        messageId: input.messageId,
        swipeId,
        label: describeProposal(o.proposal, context.world, context.state),
        detail: "Applied automatically.",
        actions: [{ id: "undo", label: "Undo", style: "danger" }],
        expires: "next_send",
        payload: { type, connection, events: JSON.parse(JSON.stringify(o.events)) as JsonValue },
      });
    });
    confirm.forEach((proposal, i) => {
      // Offer Apply only for what would apply now: a decline gets its own chip; anything else
      // that can't validate (an unknown item, no price) is logged and dropped.
      const [check] = applyProposals(this.registry, new Working(this.registry, context.world, w.state), [proposal], `${context.seed}:check`, bridge.runSeed);
      if (check?.rejection?.code === "declined") {
        declines.push({ proposal, reason: check.rejection.reason, payment: true });
        return;
      }
      if (!check || check.rejection || check.events.length === 0) {
        this.host.log("info", `[LumiRPEngine] read ${input.messageId.slice(0, 8)}: dropped ${describeProposal(proposal)} (${check?.rejection?.reason ?? "no change"})`, input.userId);
        return;
      }
      stored.push({
        id: `confirm:${input.messageId}:${input.generationId}:${i}`,
        kind: "confirm",
        messageId: input.messageId,
        swipeId,
        label: `${describeProposal(proposal, context.world, context.state)}${purchaseQuote(proposal, check.events, context.world)}`,
        detail: "The narration says this happened. Apply it?",
        actions: [
          { id: "confirm", label: "Apply", style: "primary" },
          { id: "reject", label: "No" },
        ],
        expires: "next_send",
        // Applied with the check's seed, so a purchase charges the amount its label shows.
        payload: { type: String(proposal.type), connection, proposal, seed: `${context.seed}:check` },
      });
    });
    // Another swipe of this reply replaces its notes.
    const notes = (this.outcomeNotes.get(chatId) ?? []).filter((n) => n.messageId !== messageId);
    declines.forEach((d, i) => {
      const id = `decline:${input.messageId}:${input.generationId}:${i}`;
      notes.push({ id, messageId, text: declineNote(d.proposal, d.reason, "accept", context.state, context.world) });
      stored.push({
        id,
        kind: "decline",
        messageId: input.messageId,
        swipeId,
        label: !d.payment ? `Didn't apply: ${describeProposal(d.proposal, context.world, context.state)}` : d.proposal.type === "purchase" ? `Couldn't pay for ${describeItem(d.proposal)}` : `Declined: ${describeProposal(d.proposal, context.world, context.state)}`,
        detail: d.payment ? `${d.reason}. It stays unowned, and the next reply is told so.` : `${d.reason}. Nothing changed, and the next reply is told so.`,
        actions: [...(d.payment ? [{ id: "other", label: "Pay another way", style: "primary" as const }] : []), { id: "remove", label: "Remove it" }, { id: "accept", label: "Accept" }],
        expires: "next_send",
        payload: { type: String(d.proposal.type), connection, proposal: d.proposal, reason: d.reason },
      });
    });
    // The reply contradicted an engine fact (DESIGN §5.2 contradiction): a chip, and the next turn is told the fact.
    if (contradicted) {
      const id = `contradiction:${messageId}:${key}`;
      notes.push({ id, messageId, text: `Correction: the last reply went against an engine fact. ${contradicted}` });
      stored.push({ id, kind: "contradiction", messageId, swipeId, label: "The reply contradicts the facts", detail: contradicted, actions: [{ id: "renarrate", label: "Re-narrate", style: "primary" }, { id: "dismiss", label: "It's fine" }], expires: "next_send", payload: { fact: contradicted } });
    }
    // Suggested next moves (DESIGN §5.2 choices): one tap sends it as the player's message.
    choices.flat().forEach((choice, i) => {
      stored.push({ id: `choice:${messageId}:${key}:${i}`, kind: "choice", messageId, swipeId, label: choice, actions: [{ id: "send", label: "Send" }], expires: "next_send", payload: { text: choice } });
    });
    lruSet(this.outcomeNotes, chatId, notes, 256);
    await this.chips.add(input.chatId, input.userId, stored);
  }

  /** Replaces (or, with `null`, drops) a pending Outcome note. */
  setOutcomeNote(chatId: ChatId, id: string, text: string | null): void {
    const notes = this.outcomeNotes.get(chatId) ?? [];
    const i = notes.findIndex((n) => n.id === id);
    if (i < 0) return;
    if (text === null) notes.splice(i, 1);
    else notes[i] = { ...notes[i], text } as OutcomeNote;
  }

  async afterCommit(input: TurnContext): Promise<void> {
    this.meter.close(input.userId);
    const bridge = this.bridges.get(input.chatId);
    if (!bridge) return;
    const rec = input.core.chain(input.observed).find((x) => x.id === input.messageId)?.ledger?.swipes[String(input.swipeId)] ?? input.core.journal.messages[input.messageId]?.ledger.swipes[String(input.swipeId)];
    const stored: StoredChip[] = [];
    const at = `${input.messageId}:${input.swipeId}`;
    const base = { messageId: input.messageId, swipeId: input.swipeId };
    const plan = rec ? bridge.planFor(rec.seed) : undefined;
    if (rec && rec.seed !== "" && !plan && input.kind !== "renarrate" && input.kind !== "continue") this.host.log("warn", `[LumiRPEngine] chat ${input.chatId}: no engine plan for the committed turn (seed ${rec.seed.slice(0, 8)}); its chips are missing`, input.userId);
    const idx = input.observed.findIndex((m) => m.id === input.messageId);
    const user = input.observed.slice(0, idx < 0 ? input.observed.length : idx).findLast((m) => m.isUser);
    const userText = user ? (user.swipes[user.swipeId] ?? "") : "";
    // Rolls and odds, and an action that couldn't run (DESIGN §12 chips), from the turn's resolution.
    const res = plan?.resolution;
    this.host.log("info", `[LumiRPEngine] turn ${input.messageId.slice(0, 8)}:${input.swipeId} ${input.kind}: plan ${plan ? "yes" : "no"}, action ${res?.action ?? "-"}, check ${res?.check?.outcome ?? "-"}`, input.userId);
    if (res) {
      // The action lives in the revision the chat folds at (after any Upgrade), not the run's first.
      const world = input.core.worldAt(input.core.fold(input.observed).state.revision) ?? input.core.worldAt(rec?.defHash ?? "");
      const label = (world?.actions[res.action] ?? this.registry.actions.get(res.action))?.label ?? res.action;
      if (res.check) {
        const odds = Object.entries(res.check.odds)
          .map(([band, p]) => `${band} ${Math.round(p * 100)}%`)
          .join(" · ");
        const mod = res.check.modifier !== 0 ? ` ${res.check.modifier > 0 ? "+" : "−"} ${Math.abs(res.check.modifier)}` : "";
        stored.push({ id: `roll:${at}`, kind: "roll", ...base, label: `${label}: ${res.check.outcome}`, detail: `Rolled ${res.check.roll.notation}${mod} = ${res.check.total}. Odds: ${odds}.`, actions: [], expires: "never", payload: {} });
      }
      if (!res.ok && res.failed) stored.push({ id: `decline:${at}`, kind: "decline", ...base, label: `${label}: couldn't`, detail: playerReason(res.failed), actions: [], expires: "next_send", payload: {} });
      else if (res.rejected.length > 0) stored.push({ id: `decline:${at}`, kind: "decline", ...base, label: `${label}: declined`, detail: res.rejected.map((r) => r.rejection.reason).join("; "), actions: [], expires: "next_send", payload: {} });
      // Typed text `interpret` read as an action (DESIGN §9.4, §11): one tap undoes the resolution.
      if (res.ok && res.events.length > 0 && input.kind !== "renarrate" && input.kind !== "continue" && bridge.wasInterpreted(userText)) {
        stored.push({ id: `not_action:${at}`, kind: "not_action", ...base, label: "Not an action?", detail: `Read as "${label}". Undo it if you only meant to say it.`, actions: [{ id: "undo", label: "Not an action", style: "danger" }], expires: "next_send", payload: { text: userText, events: JSON.parse(JSON.stringify(res.events)) as JsonValue } });
      }
    }
    this.ageNotes(input.chatId, input.messageId);
    const headState = input.core.fold(input.observed).state;
    const chipWorld = input.core.worldAt(headState.revision) ?? input.core.worldAt(rec?.defHash ?? "");
    for (const [i, chip] of (plan?.chips ?? []).entries()) {
      if (chip.kind === "retry_timelapse") {
        // Retry re-sends the turn's timelapse request (its target and interrupt overrides).
        const intent = bridge.intentOf(userText);
        const params = intent?.action === TIMELAPSE_ACTION ? intent.params : null;
        stored.push({ id: `tl:${at}:${i}`, kind: "retry_timelapse", ...base, label: "Timelapse didn't run", detail: chip.reason, actions: params ? [{ id: "retry", label: "Retry" }] : [], expires: "next_send", payload: params ? { target: params.target ?? null, overrides: params.overrides ?? null } : {} });
        continue;
      }
      // DESIGN §9.2 wording: "Timelapse to 07:00 (8 h 55 min)?"
      const to = chip.target.type === "at" && chipWorld ? ` to ${shortClock(calendarOf(chipWorld), headState.clock, chip.target.at)}` : "";
      const label = chip.kind === "timelapse_offer" ? `Timelapse${to} (${compactSpan(chip.remaining)})?` : `Continue timelapse (${compactSpan(chip.remaining)} left)`;
      stored.push({ id: `tl:${at}:${i}`, kind: chip.kind, ...base, label, actions: [{ id: "timelapse", label: chip.kind === "timelapse_offer" ? "Timelapse" : "Continue", style: "primary" }], expires: "next_send", payload: { target: JSON.parse(JSON.stringify(chip.target)) as JsonValue } });
    }
    // A typed timelapse longer than a turn runs on its own: offered, never run unasked.
    const offer = input.kind === "continue" ? undefined : bridge.offerFor(userText);
    if (offer) {
      const part = offer.type === "day_part" ? chipWorld?.calendar.dayParts.find((d) => d.id === offer.dayPart)?.label.toLowerCase() : undefined;
      const label = offer.type === "duration" ? `Timelapse ${compactSpan(offer.minutes)}?` : offer.type === "day_part" ? `Timelapse to ${part ?? offer.dayPart}?` : offer.type === "shift" ? "Timelapse to your next shift?" : offer.type === "commitment" ? "Timelapse to your next commitment?" : "Timelapse?";
      const detail = offer.type === "duration" && offer.minutes > INTERPRETED_TIMELAPSE_CAP ? "That's longer than one turn runs on its own. Run it as a timelapse?" : "You said time passes after that. Run it as a timelapse?";
      stored.push({ id: `tlo:${at}`, kind: "timelapse_offer", ...base, label, detail, actions: [{ id: "timelapse", label: "Timelapse", style: "primary" }], expires: "next_send", payload: { target: JSON.parse(JSON.stringify(offer)) as JsonValue } });
    }
    // An interrupt ended the timelapse early (DESIGN §9.2): say why, and offer the rest of the run.
    const summary = plan?.timelapse?.summary;
    if (summary?.stoppedBy && !(plan?.chips ?? []).some((c) => c.kind === "continue_timelapse")) {
      const elapsed = summary.to - summary.from;
      const rest = summary.target.type === "duration" ? { type: "duration" as const, minutes: Math.max(1, summary.target.minutes - elapsed) } : summary.target;
      const left = rest.type === "duration" ? ` (${compactSpan(rest.minutes)} left)` : "";
      stored.push({ id: `tl:${at}:stop`, kind: "continue_timelapse", ...base, label: `Timelapse stopped: ${STOP_LABEL[summary.stoppedBy]}`, detail: `Continue to the original target${left}?`, actions: [{ id: "timelapse", label: "Continue", style: "primary" }], expires: "next_send", payload: { target: JSON.parse(JSON.stringify(rest)) as JsonValue } });
    }
    for (const [i, chip] of bridge.chipsFor(input.content).entries()) {
      stored.push({ id: `adv:${at}:${i}`, kind: "timelapse_offer", ...base, label: "The narration skipped ahead — run it as a timelapse?", detail: chip.reason === "unit_cap" ? "Too much happens in between to run it inside the turn." : "Longer than a turn can cover.", actions: [{ id: "timelapse", label: "Run timelapse", style: "primary" }], expires: "next_send", payload: { target: JSON.parse(JSON.stringify(chip.target)) as JsonValue, allNote: true } });
    }
    await this.chips.add(input.chatId, input.userId, stored);
  }

  /** Outcome notes are told to the turn after their reply (and its swipes), then dropped. */
  private ageNotes(chatId: ChatId, messageId: MessageId): void {
    const notes = this.outcomeNotes.get(chatId);
    if (!notes) return;
    const kept = notes.filter((n) => n.messageId === messageId || n.toldTo === undefined || n.toldTo === messageId);
    for (const n of kept) if (n.messageId !== messageId) n.toldTo = messageId;
    lruSet(this.outcomeNotes, chatId, kept, 256);
  }

  changed(chatId: ChatId, userId: UserId): void {
    this.push.changed(chatId, userId);
  }

  /** The next swipe's mode, chosen on the swipe-option chip; consumed by that swipe. */
  private readonly swipeChoice = new Map<ChatId, "rerun" | "renarrate">();

  setSwipeChoice(chatId: ChatId, mode: "rerun" | "renarrate"): void {
    lruSet(this.swipeChoice, chatId, mode, 256);
  }

  async kindOf(input: { chatId: ChatId; userId: UserId; kind: GenerationKind }): Promise<GenerationKind> {
    if (input.kind !== "swipe" && input.kind !== "regenerate") return input.kind;
    const choice = this.swipeChoice.get(input.chatId);
    this.swipeChoice.delete(input.chatId);
    const mode = choice ?? (await this.settings.get(input.userId)).swipeDefault;
    return mode === "renarrate" ? "renarrate" : input.kind;
  }

  /** The next send: lapsed undo chips count as accepted (D4 learning); confirm chips lapse uncounted. */
  private async lapse(chatId: ChatId, userId: UserId): Promise<void> {
    const gone = await this.chips.lapse(chatId, userId);
    const settings = await this.settings.get(userId);
    const learning = await this.settings.learningOf(userId);
    let counted = false;
    for (const chip of gone) {
      if (chip.kind !== "undo") continue;
      const type = EXTRACTION_TYPES.find((t) => t === chip.payload.type);
      const connection = typeof chip.payload.connection === "string" ? chip.payload.connection : ACTIVE_CONNECTION;
      if (!type) continue;
      counted = true;
      const change = recordOutcome(settings, learning, connection, type, "accepted", Date.now());
      if (change) await this.addModeChip(chatId, userId, change.type, change.from, change.to, change.connectionId);
    }
    if (counted) await this.settings.saveLearning(userId);
    this.push.changed(chatId, userId);
  }

  async addModeChip(chatId: ChatId, userId: UserId, type: ExtractionType, from: string, to: string, connectionId: string): Promise<void> {
    const core = await this.ledger.core(chatId, userId);
    if (!core) return;
    const observed = toChain(await this.host.chats.messages(chatId, userId));
    const head = observed.findLast((m) => !m.isUser);
    if (!head) return;
    const label = to === "auto" ? `${TYPE_LABELS[type]} now apply automatically` : `${TYPE_LABELS[type]} need your confirm again`;
    await this.chips.add(chatId, userId, [
      { id: `mode:${type}:${Date.now()}`, kind: "mode_change", messageId: head.id, label, detail: "Learned from your confirms and undos on this connection.", actions: [{ id: "undo", label: "Undo" }], expires: "never", payload: { change: { connectionId, type, from, to } } },
    ]);
  }

  // ---------------------------------------------------------------- the World Info interceptor

  async intercept(input: InterceptorInput): Promise<InterceptorResult | null> {
    const run = await this.runOf(input.chatId, input.userId);
    if (!run) return null;
    lruSet(this.lastWorldChat, input.userId, input.chatId, 1024);
    const core = await this.ledger.core(input.chatId, input.userId);
    if (!core) return null;
    const observed = toChain(await this.host.chats.messages(input.chatId, input.userId));
    const render = core.renderState(observed);
    if (!render) return null;
    const { world, state } = render;
    const index = await this.worlds.index(run.worldId, input.userId);
    const settings = await this.settings.get(input.userId);
    const result: InterceptorResult = { disabled: [], enabled: [], forced: [], mutated: [], disableRecursion: false };
    const bookId = index?.loreBookId ?? null;
    const slotIds = bookId ? await this.book.slotEntries(bookId, input.userId) : new Map<string, string>();
    const present = new Set(input.entries.filter((e) => e.bookId === bookId).map((e) => e.id));
    const ctx = this.registry.context(world, state);
    const secrets = unrevealedTruths(world, state);
    const plan = Object.values(core.journal.pending).filter((p) => p.planned).at(-1);
    const turnPlan = plan ? this.bridges.get(input.chatId)?.planFor(plan.seed) : undefined;
    const prose = turnPlan && plan ? this.bridges.get(input.chatId)?.proseFor(plan.seed) : undefined;
    // A plan the bridge no longer holds (a restart, or 64 newer plans) comes back from storage.
    const kept = plan && !turnPlan ? await this.planNotes.get(input.chatId, input.userId, plan.seed) : null;
    const outline = turnPlan ? planOutline(turnPlan, prose) : (kept?.outline ?? []);
    const planned = turnPlan ? planLines(turnPlan, world, this.registry) : kept ? { outcome: kept.outcome, montage: kept.montage } : { outcome: [], montage: [] };
    // Declines from the last reply (DESIGN §9.5), for the next turn and its swipes only.
    for (const n of this.outcomeNotes.get(input.chatId) ?? []) if (n.messageId !== plan?.messageId && (n.toldTo === undefined || n.toldTo === plan?.messageId)) planned.outcome.unshift(n.text);
    const record: InspectorRecord = { id: plan?.generationId ?? `dry:${Date.now().toString(36)}`, at: Date.now(), activation: "unconfirmed", candidates: [], sections: [], budget: { sections: settings.modelUse.tokens.sections, lore: settings.modelUse.tokens.lore, used: 0 }, forced: [] };
    if (bookId && present.size === 0) record.warnings = ["The world's book wasn't attached to this chat, so no engine sections reached the narrator. It is re-attached for the next turn."];
    else if (bookId && index && sectionsOf(world).some((s) => !present.has(slotIds.get(s.id) ?? ""))) {
      // A slot entry was deleted in the host's UI (or the cache is stale): recreate it for the next turn.
      record.warnings = ["Some engine slot entries were missing from the world's book; they are recreated for the next turn."];
      void this.book.ensure(world, index, input.userId).catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] slot repair failed: ${error instanceof Error ? error.message : String(error)}`, input.userId));
    }
    // 1. Slots: the section budget is reserved first; Outcome (rank 0) is never evicted (DESIGN §6.2).
    let budget = settings.modelUse.tokens.sections;
    const sceneText: string[] = [];
    const delivery = this.delivery.get(input.chatId) ?? {};
    const uncounted = new Map<string, string>();
    for (const section of sectionsOf(world)) {
      const entryId = slotIds.get(section.id);
      if (!entryId || !present.has(entryId)) continue;
      const lines: string[] = [];
      for (const r of this.registry.renderers) {
        if (r.slot !== section.id) continue;
        try {
          lines.push(...r.render(ctx));
        } catch (error) {
          this.host.log("warn", `[LumiRPEngine] section ${section.id}: ${error instanceof Error ? error.message : String(error)}`, input.userId);
        }
      }
      if (section.id === "outline") lines.push(...outline);
      // DESIGN §9.2: every turn has an elapsed time, and the Scene slot states it.
      if (section.id === "scene" && plan) {
        const minutes = clockMinutes(plan.events);
        lines.push(minutes > 0 ? `This turn took ${spanText(minutes)}.` : "No time passes this turn.");
      }
      // The turn's resolution leads the Outcome slot; a timelapse's Montage fills its own.
      if (section.id === "outcome") lines.unshift(...planned.outcome);
      if (section.id === "montage") lines.push(...planned.montage);
      const safe = lines.filter((l) => findLeaks(l, secrets).length === 0);
      if (safe.length === 0) continue;
      const content = renderSection(section.label, section.template, safe);
      const key = hashParts("lre.tokens", input.userId, content);
      const counted = this.tokenCounts.get(key);
      if (counted === undefined) uncounted.set(key, content);
      const cost = counted ?? sectionTokens(content);
      const clipped = section.rank > 0 && cost > budget;
      // A clipped section wasn't in the prompt, so an earlier delivery check says nothing about it.
      record.sections.push({ slot: section.id, label: section.label, tokens: cost, clipped, delivery: clipped ? "unchecked" : (delivery[section.id] ?? "unchecked") });
      if (clipped) continue;
      budget -= cost;
      sceneText.push(content);
      const placement = placementOf(section);
      result.enabled.push(entryId);
      result.forced.push(entryId);
      result.mutated.push({ id: entryId, content, ...(placement ? { placement } : {}) });
    }
    if (uncounted.size > 0) {
      const asked = [...uncounted];
      void this.host.tokens
        .count(asked.map(([, content]) => content), input.userId)
        .then((counts) =>
          counts?.forEach((n, i) => {
            const [key, content] = asked[i] ?? ["", ""];
            if (key !== "" && Number.isFinite(n) && n >= 0 && n <= TOKEN_COUNT_CAP * sectionTokens(content)) lruSet(this.tokenCounts, key, n, 1024);
          }),
        )
        .catch(() => undefined);
    }
    // 2. Lore: candidates, selection, the lore budget and the vote (DESIGN §6.1–6.4).
    const povPlace = placeOfEntity(state, world.pov);
    const sceneIds = new Set<string>();
    for (let p: string | undefined = povPlace ?? undefined, guard = 0; p && guard < 16; p = world.places[p]?.parent, guard++) sceneIds.add(p);
    for (const [id] of Object.entries(state.entities)) if (povPlace && placeOfEntity(state, id) === povPlace) sceneIds.add(id);
    const recent = [...input.messages].reverse().slice(0, 8).map((m) => m.content);
    const found = gatherCandidates({
      entries: input.entries,
      engineBookId: bookId,
      slotIds: new Set(slotIds.values()),
      passThroughBooks: new Set(settings.passThroughBooks),
      suppressed: (e) => world.suppressed.some((s) => s.bookId === e.bookId && ("entryId" in s ? s.entryId === e.id : s.comment === e.comment)),
      sceneIds,
      recent,
      // Places are public; an entity counts once the POV has met it (sim's playerKnows).
      knows: (id) => !hasOwn(state.entities, id) || playerKnows(world, state, world.pov, id),
      revealed: (gate) => {
        try {
          return truthy(evalExpr(gate, scopeEnv({ reg: this.registry, ctx }), false));
        } catch {
          return false;
        }
      },
    });
    const selectConfig = settings.modelUse.steps.select ?? null;
    // Select runs per its signals and budget (DESIGN §5.3): `always` asks every candidate, the cache
    // signals ask only candidates without a cached decision, other signals ask all when they fire.
    const selectFacts: SignalFacts = { ...((plan ? this.prePhase.get(plan.generationId)?.facts : undefined) ?? noFacts()), uncached: true, hitSetChanged: true, candidatesChanged: true };
    const cacheSignals = ["uncached", "hit_set_changed", "candidates_changed"];
    const mode = !selectConfig?.enabled || settings.modelUse.budgets.select.calls < 1 ? "engine" : selectConfig.signals.includes("always") ? "full" : selectConfig.signals.some((s) => cacheSignals.includes(s)) ? "standard" : fires(selectConfig.signals, selectFacts) ? "full" : "engine";
    const selectTemplate = templatesFor(world, "select")[0]?.template;
    const relevance = hashJson({ place: [...sceneIds].sort(), tracks: state.tracks, knows: state.entities[world.pov]?.relations.filter((r) => r.type === "knows").map((r) => r.to) ?? [], levels: state.realism.levels });
    const stepKey = hashJson({ route: selectConfig?.route ?? null, template: selectConfig?.template ?? null, v: 1 });
    const cache = this.selectCache.get(input.chatId) ?? new Map<string, boolean>();
    lruSet(this.selectCache, input.chatId, cache, 256);
    trimMap(cache, 2048);
    const seed = plan?.seed ?? hashParts("lre.wi", input.chatId, String(observed.length));
    const selection = await selectLore({
      candidates: found.candidates,
      loreBudget: settings.modelUse.tokens.lore,
      mode,
      cache,
      cacheKey: (c) => cacheKeyOf(c, relevance, stepKey),
      seed,
      decide: async (asks) => {
        // An inspector dry run (no planned turn) uses cached decisions only: no paid call.
        if (!plan) return null;
        const questions: Questions = {};
        const keys = new Map<string, string>();
        asks.slice(0, 16).forEach((c, i) => {
          keys.set(`c${i}`, c.entry.id);
          questions[`c${i}`] = { type: "noul", instructions: `${selectTemplate ?? "Does this lore matter for the narrator's next reply?"} Title: ${c.entry.comment || c.entry.keys.join(", ")}. Text: ${c.entry.content.slice(0, 500)}` };
        });
        const brief = this.bridges.get(input.chatId)?.proseFor(plan.seed)?.brief ?? null;
        const answer = await this.steps.decide("select", { scene: sceneText.join("\n").slice(0, 2500), recent: recent.slice(0, 6), ...(brief ? { brief } : {}) }, questions, selectConfig, input.userId, AbortSignal.timeout(Math.max(500, Math.min(6000, settings.modelUse.budgets.select.ms))));
        if (!answer) return null;
        const out = new Map<string, number>();
        for (const [key, a] of Object.entries(answer.answers)) {
          const id = keys.get(key);
          if (id && a.type === "noul") out.set(id, a.noul);
        }
        return out;
      },
    });
    record.budget.used = selection.used;
    const selectedIds = new Set(selection.selected.map((c) => c.entry.id));
    const bookNames = new Map<string, string>();
    for (const id of new Set(found.candidates.map((c) => c.entry.bookId))) bookNames.set(id, id === bookId ? "World lore" : await this.bookName(id, input.userId));
    for (const c of found.candidates) {
      if (selectedIds.has(c.entry.id)) {
        result.forced.push(c.entry.id);
        if (c.engine) result.enabled.push(c.entry.id);
      } else if (!c.engine) result.disabled.push(c.entry.id);
      const s = selection.status.get(c.entry.id) ?? { status: "dropped" as const, reason: "unranked" };
      record.candidates.push({ title: c.entry.comment || c.entry.keys.join(", ") || c.entry.id, book: c.entry.bookId, bookName: bookNames.get(c.entry.bookId) ?? c.entry.bookId, status: s.status, reason: s.reason });
    }
    result.disabled.push(...found.suppressed, ...found.overflow);
    const groups = new Set(selection.selected.map((c) => c.entry.group).filter((g): g is string => g !== null));
    for (const e of found.passThrough) if (e.group && groups.has(e.group)) result.disabled.push(e.id);
    // Every engine-book entry the engine didn't pick this turn is voted off, so one re-enabled in the
    // host's UI (a gated secret's lore, an unused slot) can't activate natively.
    const picked = new Set([...result.enabled, ...result.forced]);
    const voted = new Set(result.disabled);
    for (const e of input.entries) if (e.bookId === bookId && !picked.has(e.id) && !voted.has(e.id)) result.disabled.push(e.id);
    result.disableRecursion = found.passThrough.length === 0;
    if (selection.pinsOverBudget) record.warnings = [...(record.warnings ?? []), "Pinned (constant) entries alone exceed the lore budget."];
    record.forced = [...result.forced];
    // Only real turns enter the history; a dry run (inspector check, preview) records nothing.
    if (plan) {
      const list = this.inspector.get(input.chatId) ?? [];
      list.push(record);
      if (list.length > 10) list.shift();
      lruSet(this.inspector, input.chatId, list, 256);
      this.push.changed(input.chatId, input.userId);
    }
    return result;
  }

  /** `WORLD_INFO_ACTIVATED`: confirms the latest interceptor record when every forced entry activated. */
  private onActivated(chatId: ChatId, activated: readonly string[]): void {
    const record = this.inspector.get(chatId)?.at(-1);
    if (!record || record.activation !== "unconfirmed") return;
    const ids = new Set(activated);
    record.activation = record.forced.every((id) => ids.has(id)) ? "confirmed" : "unconfirmed";
  }

  /**
   * Deliverability (DESIGN §4.2): between generations, a dry-run assembly is
   * searched for each slot's text; a slot whose text is found is `verified`, else `unverified`.
   * Outcome, Montage and Outline hold only what a real turn planned, so a dry run (which plans
   * nothing) never carries them: they stay `unchecked` rather than reading as not delivered.
   */
  async checkDelivery(chatId: ChatId, userId: UserId): Promise<void> {
    const core = await this.ledger.core(chatId, userId);
    if (!core || core.inFlight) return;
    const assembly = await this.host.dryRun(chatId, userId);
    const text = assembly.messages.map((m) => m.content).join("\n");
    lruSet(this.presetWarnings, chatId, (await this.lintOf(chatId, assembly, userId)).map((c) => c.message), 256);
    const last = this.inspector.get(chatId)?.at(-1);
    const out: Record<string, "verified" | "unverified"> = {};
    for (const s of last?.sections ?? []) if (!s.clipped && !hasOwn(TURN_ONLY_SLOTS, s.slot)) out[s.slot] = text.includes(`[${neutralizeMacros(s.label)}]`) ? "verified" : "unverified";
    lruSet(this.delivery, chatId, out, 256);
    for (const s of last?.sections ?? []) s.delivery = s.clipped ? "unchecked" : (out[s.slot] ?? s.delivery);
    this.push.changed(chatId, userId);
  }

  /** The user's default connection id, the key its D4 learning is kept under; `"active"` when the host can't say. */
  async activeConnectionId(userId: UserId): Promise<string> {
    return (await this.host.connections.active(userId).catch(() => null))?.id ?? ACTIVE_CONNECTION;
  }

  /**
   * The D32 preset lint (DESIGN §13) for Settings → Caveats: a dry run of the world chat the user has
   * open, else the one they last played; none when there is neither.
   */
  async presetCaveats(userId: UserId): Promise<PresetCaveat[]> {
    const open = await this.host.chats.active(userId).catch(() => null);
    const chatId = open && (await this.runOf(open, userId)) ? open : this.lastWorldChat.get(userId);
    if (!chatId) return [];
    try {
      return await this.lintOf(chatId, await this.host.dryRun(chatId, userId), userId);
    } catch (error) {
      this.host.log("warn", `[LumiRPEngine] preset lint: ${error instanceof Error ? error.message : String(error)}`, userId);
      return [];
    }
  }

  private async lintOf(chatId: ChatId, assembly: DryRun, userId: UserId): Promise<PresetCaveat[]> {
    const found = presetCaveats(assembly, null);
    if (found.length === 0) return found;
    // Named by the preset the host assembles with (block ids repeat across copied presets).
    const preset = await this.host.presets.active(chatId, userId).catch(() => null);
    return preset ? presetCaveats(assembly, preset.name) : found;
  }

  /** The interceptor records kept for a chat (newest last). */
  inspectorRecords(chatId: ChatId): readonly InspectorRecord[] | undefined {
    return this.inspector.get(chatId);
  }

  /** The inspector panel (`core.context`, `ContextView`). */
  async inspectorView(chatId: ChatId, userId: UserId): Promise<JsonValue> {
    const warnings: string[] = [];
    if ((await this.host.councilWorldInfo(userId)) === true) warnings.push("Council World Info is on: Council uses native activation over your lore books in this world chat.");
    const records = this.inspector.get(chatId) ?? [];
    for (const r of records) for (const w of r.warnings ?? []) if (!warnings.includes(w)) warnings.push(w);
    for (const w of this.presetWarnings.get(chatId) ?? []) if (!warnings.includes(w)) warnings.push(w);
    for (const w of this.ledger.notices(chatId, userId)) if (!warnings.includes(w)) warnings.push(w);
    const view: ContextView = { generations: records.map(({ forced: _forced, warnings: _w, ...r }) => r).reverse(), warnings };
    return JSON.parse(JSON.stringify(view)) as JsonValue;
  }

  // ---------------------------------------------------------------- views

  async view(chatId: ChatId, userId: UserId): Promise<StateView> {
    const run = await this.runOf(chatId, userId);
    if (!run) return notWorldView(chatId);
    const core = await this.ledger.core(chatId, userId);
    if (!core) return notWorldView(chatId);
    const observed = toChain(await this.host.chats.messages(chatId, userId));
    const stored = await this.chips.list(chatId, userId);
    const view = buildView({ chatId, run, core, observed, registry: this.registry, world: (r) => core.worldAt(r), stored, meter: this.meter.view(userId) });
    view.panels["core.context"] = await this.inspectorView(chatId, userId);
    return view;
  }

  /** A stored chip, removed (it was acted on). */
  takeChip(chatId: ChatId, userId: UserId, id: ChipId): Promise<StoredChip | null> {
    return this.chips.take(chatId, userId, id);
  }

  /** Refs to `events` in a record, in order: by default among its read (post-`pre`) events; `start: 0` includes the plan's. */
  static refsOf(rec: { events: LedgerEvent[]; pre: number }, events: readonly JsonValue[], start = rec.pre): EventRef[] {
    const refs: EventRef[] = [];
    const wanted = events.map((e) => JSON.stringify(e));
    let from = start;
    for (const w of wanted) {
      const index = rec.events.findIndex((e, i) => i >= from && JSON.stringify(e) === w);
      if (index < 0) continue;
      refs.push({ in: "events", index });
      from = index + 1;
    }
    return refs;
  }

  bridgeOf(chatId: ChatId): TurnBridge | undefined {
    return this.bridges.get(chatId);
  }

  /** The head assistant message of a chat (writes target it). */
  static head(observed: readonly ChainMessage[]): { id: MessageId; swipeId: number } | null {
    const m = observed.findLast((x) => !x.isUser);
    return m ? { id: m.id, swipeId: m.swipeId } : null;
  }
}

export const TYPE_LABELS: Record<ExtractionType, string> = {
  time_advance: "Time skips",
  location: "Moves",
  condition: "Condition changes",
  knows: "New facts",
  give: "Handovers",
  purchase: "Purchases",
  transfer: "Payments",
  regard: "Feelings",
  quantity: "Quantities",
  spawn: "New characters",
};

/** The puzzles the player can see that take an answer now, as "Puzzle — stage" titles (interpret's Answer label). */
function openPuzzleTitles(registry: Registry, world: WorldDoc, state: Readonly<WorldState>): string[] {
  const out: string[] = [];
  for (const id of Object.keys(world.tracks).sort()) {
    const t = world.tracks[id];
    const stage = t?.kind === "puzzle" ? t.stages[state.tracks[id]?.stage ?? t.start] : undefined;
    if (!t || !stage?.answer || playerTrack(registry, world, state, world.pov, id) === null) continue;
    out.push(`${t.label} — ${stage.label}`);
    if (out.length >= 6) break;
  }
  return out;
}

/** Typed phrases that let time pass: they wake the classifier and are the timelapse's lexicon for `interpret`. */
const TIMELAPSE_LEXICON = ["wait until", "sleep until", "next morning", "skip ahead", "skip to", "pass the time", "sleep through", "hours later", "days later", "wait for"];

/** The longest typed timelapse a turn runs on its own (minutes); longer ones are offered as a chip. */
export const INTERPRETED_TIMELAPSE_CAP = 1440;

/** A "next" day part closer than this is the one after it: "sleep until the next morning" at 07:14 means tomorrow's. */
const NEXT_DAY_PART_GAP = 180;

/** A typed timelapse's target from `interpret` params: `until` a day part (or the next one), shift or commitment, else `minutes`. */
function interpretedTarget(params: JsonObject, world: WorldDoc, now: number, text: string): TimelapseTarget | null {
  const cal = calendarOf(world);
  const raw = typeof params.until === "string" ? params.until.trim().toLowerCase() : "";
  const next = /^(the\s+)?(next|tomorrow)\b/.test(raw);
  const until = raw.replace(/^(the\s+)?(next|tomorrow)\s*/, "");
  const idx = cal.dayParts.findIndex((d) => d.id.toLowerCase() === until || d.label.toLowerCase() === until);
  const part = cal.dayParts[idx];
  if (part) {
    // The model may drop the "next" the player typed ("…sleep until the next morning" → until "morning").
    const words = [until, part.label.toLowerCase()].map((w) => w.replace(/[^a-z0-9 ]/g, "")).filter((w) => w !== "");
    if (next || /\btomorrow\b/i.test(text) || new RegExp(`\\bnext\\s+(${words.join("|")})\\b`, "i").test(text)) {
      const start = cal.partStarts[idx] ?? 0;
      const at = nextTimeOfDay(cal, now, start);
      return { type: "at", at: at - now < NEXT_DAY_PART_GAP ? nextTimeOfDay(cal, at, start) : at };
    }
    return { type: "day_part", dayPart: part.id };
  }
  if (until === "shift" || until === "commitment") return { type: until };
  const minutes = typeof params.minutes === "number" && Number.isFinite(params.minutes) ? Math.round(params.minutes) : 0;
  return minutes > 0 ? { type: "duration", minutes } : null;
}

/** Why an action couldn't run, for the player: a requirement isn't shown as its expression ("requires to != here"). */
export function playerReason(failed: { code: string; reason: string; requirement?: string }): string {
  if (failed.code !== "requirement") return failed.reason;
  const req = failed.requirement ?? failed.reason.replace(/^requires\s+/, "");
  if (/\bto\s*!=\s*here\b/.test(req)) return "You're already there.";
  const why = REQUIREMENT_WORDS.find(([pattern]) => pattern.test(req))?.[1];
  return why ? `Not possible here and now: ${why}.` : "Not possible here and now.";
}

/** Readable reasons for the requirement shapes packs use (the expression itself is never shown). */
const REQUIREMENT_WORDS: readonly [RegExp, string][] = [
  [/\blevel\.(\w+)\s*>=/, "this world doesn't simulate that in enough detail"],
  [/\bowner\s*==\s*self\b/, "it isn't yours"],
  [/\bcarries\(self/, "you need to have it with you"],
  [/\blent_out\(/, "it isn't lent out"],
  [/\bat\(|\bplace\([^)]*\)\s*==\s*here|==\s*here\b/, "it has to be here"],
  [/>\s*0\b/, "it needs an amount"],
];

/** A clock time for a chip: "07:00" later the same day, else with its weekday ("Sat 07:00"). */
function shortClock(cal: Calendar, now: number, at: number): string {
  const d = dateAt(cal, at);
  return d.dayIndex === dateAt(cal, now).dayIndex ? formatHHMM(d.minuteOfDay) : `${weekdayName(cal, d.weekday)} ${formatHHMM(d.minuteOfDay)}`;
}

/** The Outline slot's lines: the brief, the engine's beats, then the outline step's prose. */
function planOutline(plan: EngineTurnPlan, prose: PlanProse | undefined): string[] {
  return [...(prose?.brief ? [`Brief: ${prose.brief}`] : []), ...plan.outline, ...(prose?.outline ?? [])];
}

/**
 * What the narrator must know about the turn's plan (DESIGN §6.2 Outcome, §9.2 Montage): the action's
 * result with its roll, or why it couldn't run; and a timelapse's Montage groups and money.
 */
export function planLines(plan: EngineTurnPlan, world: WorldDoc, registry: Registry): { outcome: string[]; montage: string[] } {
  const outcome: string[] = [];
  const res = plan.resolution;
  if (res) {
    const label = (world.actions[res.action] ?? registry.actions.get(res.action))?.label ?? res.action;
    const reasons = res.rejected.slice(0, 3).map((r) => r.rejection.reason);
    if (!res.ok) outcome.push(`${label}: it didn't happen (${res.failed?.reason ?? "not possible"}). Narrate the attempt failing.`);
    else if (res.check) {
      outcome.push(`${label}: ${res.check.outcome} (rolled ${res.check.total} on ${res.check.roll.notation}). Narrate this result.`);
      for (const r of reasons) outcome.push(`Not possible: ${r}.`);
    } else if (reasons.length > 0) outcome.push(`${label}: it didn't go through (${reasons.join("; ")}). Narrate it failing; nothing changed hands.`);
    else outcome.push(`${label}: done.`);
  }
  // A timelapse covers what actually ran, not what was asked for (an interrupt may stop it early).
  const summary = plan.timelapse?.summary;
  if (summary) {
    const cal = calendarOf(world);
    const span = spanText(summary.to - summary.from);
    outcome.push(`Time passed: ${span}, from ${formatClock(cal, summary.from)} to ${formatClock(cal, summary.to)}${summary.stoppedBy ? `, stopped early by ${STOP_LABEL[summary.stoppedBy]}` : ""}. Narrate only this span.`);
  }
  const montage: string[] = [];
  const m = plan.montage;
  if (m) {
    for (const g of m.groups.slice(0, 7)) montage.push(`${g.label}: ${g.lines.slice(0, 6).join("; ")}`);
    for (const a of m.money.slice(0, 4)) montage.push(`${a.label}: in ${formatMoney(a.in, world.currency)}, out ${formatMoney(a.out, world.currency)}`);
  }
  return { outcome, montage };
}

export interface OutcomeNote {
  id: string;
  /** The reply that produced the note. */
  messageId: MessageId;
  text: string;
  /** The message the note was first told to (its swipes are told too). */
  toldTo?: MessageId;
}

/** The thing a proposal is about, for chip labels ("coffee", "Toolbox"). */
export function describeItem(p: JsonObject): string {
  const v = p.name ?? p.item ?? p.category;
  return typeof v === "string" && v !== "" ? v : String(p.type);
}

/**
 * The next Outcome slot's line for a declined narrated change (DESIGN §9.5): by default (and on
 * Accept) it didn't happen; Remove asks the narrator to drop it from the story.
 */
export function declineNote(p: JsonObject, reason: string, choice: "accept" | "remove", state: Readonly<WorldState>, world: WorldDoc): string {
  // A purchase reads by its item; any other change (a gift of cash, a move) by its chip label,
  // quoted as written, so a name keeps its case ("Danny Okafor paid $20.00 to you").
  const what = p.type === "purchase" ? describeItem(p) : `"${describeProposal(p, world, state)}"`;
  if (choice === "remove") return `Earlier, ${what} was narrated but never happened; leave it out from here on.`;
  if (p.type !== "purchase") return `Earlier, ${what} was narrated but didn't happen (${reason}).`;
  const payerId = typeof p.payer === "string" && p.payer !== "" ? p.payer : null;
  const who = (payerId ? state.entities[payerId]?.name : undefined) ?? "The payment";
  return payerId ? `Earlier, ${who}'s payment for ${what} was declined (${reason}); they don't have it.` : `Earlier, paying for ${what} was declined (${reason}); it isn't owned.`;
}

/**
 * What a purchase's confirm chip adds to its label, from the check that applied it: the amount it
 * charges, and the catalog item it's priced as when that isn't the narrated name (": $4.10 (priced
 * as Milk, whole)"). Empty for anything else, or a purchase that records no history line.
 */
export function purchaseQuote(p: JsonObject, events: readonly LedgerEvent[], world: WorldDoc): string {
  if (p.type !== "purchase") return "";
  for (const e of events) {
    if (e.type !== "economy.txn" || !("data" in e) || typeof e.data.memo !== "string" || !e.data.memo.startsWith("Bought ")) continue;
    const lines = Array.isArray(e.data.lines) ? e.data.lines : [];
    const cents = lines.reduce((sum: number, l) => sum + (isRecord(l) && typeof l.amount === "number" ? Math.abs(l.amount) : 0), 0);
    const name = e.data.memo.slice("Bought ".length).replace(/\s×\d+$/, "");
    const said = typeof p.item === "string" ? p.item.trim().toLowerCase() : "";
    return `: ${formatMoney(cents, world.currency)}${name.toLowerCase() !== said ? ` (priced as ${name})` : ""}`;
  }
  return "";
}

/** A one-line label for a proposal chip; ids read as names (and money in the world's currency) when the world and state are given. */
export function describeProposal(p: JsonObject, world?: WorldDoc, state?: Readonly<WorldState>): string {
  const raw = (k: string): string => (typeof p[k] === "string" || typeof p[k] === "number" ? String(p[k]) : "?");
  const s = (k: string): string => {
    const v = raw(k);
    if (!world || !state) return v;
    if (v === world.pov) return "you";
    return state.entities[v]?.name ?? world.places[v]?.name ?? v;
  };
  switch (p.type) {
    case "purchase":
      return `Bought ${s("item")}`;
    case "transfer": {
      // The sum the transfer moves: `cents` when given (minor units), else the converted `amount`.
      const cents = transferCents(p);
      const amount = Number.isFinite(cents) && world ? formatMoney(cents, world.currency) : `${world?.currency.symbol ?? "$"}${Number.isFinite(cents) ? String(cents) : "?"}`;
      return world && p.from !== world.pov && typeof p.from === "string" ? `${s("from")} paid ${amount} to ${s("to")}` : `Paid ${amount} to ${s("to")}`;
    }
    case "give":
      return `${s("from")} gave ${s("item")} to ${s("to")}`;
    case "location":
      return `${s("entity")} → ${s("place")}`;
    case "condition": {
      // Sheets: {who, condition, clear?}; a bare field change (entity, field, delta) otherwise.
      if (typeof p.condition !== "string") return `${s("entity")} ${s("field")} ${Number(p.delta) >= 0 ? "+" : ""}${s("delta")}`;
      const who = typeof p.who === "string" && p.who !== "" ? s("who") : "you";
      return p.clear === true ? `${who}: no longer ${raw("condition")}` : `${who}: ${raw("condition")}`;
    }
    case "quantity":
      return `${s("entity")} ${s("item")} ${Number(p.delta) >= 0 ? "+" : ""}${s("delta")}`;
    case "regard":
      return `${s("from")} → ${s("to")}: ${s("axis")} ${Number(p.delta) >= 0 ? "+" : ""}${s("delta")}`;
    case "knows":
      return `${s("who")} learns: ${s("fact")}`;
    case "spawn":
      return `New: ${s("name")}`;
    case "time_advance":
      return `+${s("minutes")} min`;
    default:
      return String(p.type);
  }
}
