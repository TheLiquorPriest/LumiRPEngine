// The ledger's TurnModel for real chats (DESIGN §5.1): planning runs the simulation pipeline with the
// intent `interpret` produced; reading turns the proposals `extract` produced into validated events
// and then runs the post steps. Model calls happen before, in the ledger's async hooks; this
// bridge only consumes their results, so the core stays synchronous and deterministic.

import { hashParts } from "../shared/hash";
import type { JsonObject } from "../shared/json";
import { hasOwn } from "../shared/json";
import type { GenerationKind, LedgerEvent, TimelapseTarget } from "../shared/ledger";
import { applyEffects } from "../engine/effects";
import { materializeAll } from "../engine/materialize";
import type { TurnModel } from "../engine/ledger/journal";
import type { ReadContext, Rejection } from "../engine/registry";
import type { Registry } from "../engine/registry-impl";
import { createRng } from "../engine/rng";
import type { WorldState } from "../engine/state";
import type { InterpretOutput, PostTurnInput, TurnPlanInput } from "../engine/steps";
import { applyTimeAdvance } from "../engine/time";
import type { EngineTurnPlan } from "../engine/turn";
import { Working } from "../engine/working";

/** Proposals prepared for one reply text: the ones that apply automatically, and whether post steps follow. */
export interface PreparedRead {
  auto: JsonObject[];
  post: boolean;
  /** Off-screen `npc.choose` decisions, applied before the proposals. */
  events?: LedgerEvent[];
  /** The minds' post phase (DESIGN §24.4): presence, memory and consolidation, applied after the post steps. */
  minds?: LedgerEvent[];
}

/** The plan-phase prose steps' output for one plan (DESIGN §5.2): the brief and the prose outline. */
export interface PlanProse {
  brief: string | null;
  outline: string[];
}

export interface ProposalOutcome {
  proposal: JsonObject;
  /** The proposal's own events. */
  events: LedgerEvent[];
  /** Detail sampled for the people it names before it applied (a payer's accounts), recorded with it. */
  materialized: LedgerEvent[];
  rejection: Rejection | null;
  /** Why a change refused unseen (`Rejection.unseen`) was dropped: for the log only, never a chip or a note. */
  dropped?: string;
}

/** The proposal fields that name the people a change reads (a payer's accounts, a recipient's pockets). */
const NAMED = ["from", "to", "payer", "who", "entity"] as const;

/**
 * Turns proposals into events through their channels (DESIGN §9.4): the detail of the people it
 * names is materialized first, as an action's participants are (their accounts get their opening
 * balances), then channel validation, then the channel's effects, applied in order on `w`. A
 * rejected proposal applies nothing, its materialization included.
 */
export function applyProposals(registry: Registry, w: Working, proposals: readonly JsonObject[], seed: string, runSeed: string): ProposalOutcome[] {
  const out: ProposalOutcome[] = [];
  proposals.forEach((proposal, i) => {
    const type = typeof proposal.type === "string" ? proposal.type : "";
    const channel = registry.proposals.get(type);
    if (!channel) {
      out.push({ proposal, events: [], materialized: [], rejection: { code: "unknown_channel", reason: `no channel for ${type}` } });
      return;
    }
    const mark = w.mark();
    const named = NAMED.map((k) => proposal[k]).filter((id): id is string => typeof id === "string" && hasOwn(w.state.entities, id));
    const materialized: LedgerEvent[] = [...new Set(named)].flatMap((id) => materializeAll(registry, w, id, runSeed));
    const rejection = channel.validate(proposal, w.ctx);
    if (rejection) {
      w.restore(mark);
      // An unseen refusal reads as a change that changed nothing: no rejection for a chip or a note to word.
      out.push(rejection.unseen ? { proposal, events: [], materialized: [], rejection: null, dropped: rejection.gm ?? rejection.reason } : { proposal, events: [], materialized: [], rejection });
      return;
    }
    const result = applyEffects(registry, w, channel.toEffects(proposal, w.ctx), { bindings: { self: w.world.pov }, rng: createRng(`${seed}:proposal:${i}`) });
    const failed = result.rejected[0];
    if (failed) {
      w.restore(mark);
      out.push({ proposal, events: [], materialized: [], rejection: failed.rejection });
      return;
    }
    out.push({ proposal, events: result.applied, materialized, rejection: null });
  });
  return out;
}

function clockMinutes(events: readonly LedgerEvent[]): number {
  let minutes = 0;
  for (const e of events) if (e.type === "clock") minutes += e.minutes;
  return minutes;
}

/** Narrated `time.advance` applies whole up to this many minutes per turn; beyond, it becomes a Timelapse chip (DESIGN §9.4). */
export const TIME_ADVANCE_CAP = 240;

/** The simulation's turn pipeline as the bridge uses it: the engine plan carries chips and outline lines too. */
export interface EnginePipeline {
  plan(input: TurnPlanInput): EngineTurnPlan;
  post(input: PostTurnInput): LedgerEvent[];
}

/** A Timelapse chip a read produced (an extracted `time.advance` over the cap or the unit cap). */
export interface ReadChip {
  target: TimelapseTarget;
  reason: "over_cap" | "unit_cap";
}

/** An action `interpret` read whose params name nothing in the world that fits (DESIGN §9.4): its label and why, for its decline chip. */
export interface UnfitAction {
  label: string;
  reason: string;
}

export class TurnBridge implements TurnModel {
  /** `interpret` results keyed by the turn's last user text. */
  private readonly intents = new Map<string, InterpretOutput | null>();
  /** User texts whose intent `interpret` read from typed text (a "Not an action?" chip applies). */
  private readonly interpreted = new Set<string>();
  /** User texts `interpret` couldn't read (its call failed, or a Decision route's choice had no call left for its params): their turn ran as plain roleplay ("Couldn't read your action"). */
  private readonly unread = new Set<string>();
  /** Actions `interpret` read but couldn't apply, their params naming nothing that fits, keyed like `intents`: the first (the turn plays as plain roleplay) or a queued one (the queue ends before it); the reply says why. */
  private readonly unfit = new Map<string, UnfitAction>();
  /** What the input says that the turn won't play whatever happens, in words (`interpret`'s `next`, and actions after the queue's end), offered on a chip that sends it as the next message, keyed like `intents`. */
  private readonly nexts = new Map<string, string>();
  /** Prepared reads keyed by `hashParts(text)`. */
  private readonly reads = new Map<string, PreparedRead>();
  /** Engine plans keyed by seed: elapsed minutes for `appliedMinutes`, chips and outline lines. */
  private readonly plans = new Map<string, EngineTurnPlan>();
  /** Chips produced by reads, keyed like `reads`. */
  private readonly readChips = new Map<string, ReadChip[]>();
  /** Present-agent `npc.choose` decisions keyed like `intents`, applied before the plan. */
  private readonly decisions = new Map<string, LedgerEvent[]>();
  /** The turn's minds round and its minds (DESIGN §24), keyed like `intents`, applied after the decisions. */
  private readonly minds = new Map<string, LedgerEvent[]>();
  /** Plan-phase prose (brief, outline) keyed by plan seed. */
  private readonly prose = new Map<string, PlanProse>();
  /** A typed timelapse longer than a turn may run (`interpret`), offered as a chip instead, keyed like `intents`. */
  private readonly offers = new Map<string, TimelapseTarget>();

  constructor(
    private readonly registry: Registry,
    private readonly pipeline: EnginePipeline,
    readonly runSeed: string,
  ) {}

  setIntent(userText: string, intent: InterpretOutput | null, interpreted = false): void {
    this.intents.set(userText, intent);
    trim(this.intents);
    this.unread.delete(userText);
    this.unfit.delete(userText);
    if (interpreted && intent) this.interpreted.add(userText);
    else this.interpreted.delete(userText);
    if (this.interpreted.size > 64) this.interpreted.delete(this.interpreted.values().next().value ?? "");
  }

  /** Replaces this text's intent with the same read amended (a judgement, a puzzle answer's probability), keeping what was noted about the read. */
  amendIntent(userText: string, intent: InterpretOutput): void {
    if (this.intents.has(userText)) this.intents.set(userText, intent);
  }

  /**
   * `interpret` couldn't read this text: its call failed, or a Decision route's choice had no call
   * left for its params. No intent is kept, so the turn plans as plain roleplay and the next turn on
   * the same text (the chip's Retry, a Re-run) reads it again.
   */
  setUnread(userText: string): void {
    this.intents.delete(userText);
    this.interpreted.delete(userText);
    this.unfit.delete(userText);
    this.unread.add(userText);
    if (this.unread.size > 64) this.unread.delete(this.unread.values().next().value ?? "");
  }

  /** Whether this text's turn ran unread because `interpret` couldn't read it. */
  wasUnread(userText: string): boolean {
    return this.unread.has(userText);
  }

  /**
   * `interpret` read an action whose params name nothing in the world that fits, and its reply gets a
   * decline chip saying why. For the first action no intent is kept (`intent` null), so the turn plays
   * as plain roleplay; for a queued one, `intent` holds the actions before it, which play.
   */
  setUnfit(userText: string, unfit: UnfitAction, intent: InterpretOutput | null = null): void {
    this.setIntent(userText, intent, intent !== null);
    this.unfit.set(userText, unfit);
    trim(this.unfit);
  }

  /** The action this text's turn couldn't apply, when `interpret` read one whose params name nothing that fits. */
  unfitOf(userText: string): UnfitAction | undefined {
    return this.unfit.get(userText);
  }

  /** Whether this text's intent came from `interpret` (not a palette or chip action). */
  wasInterpreted(userText: string): boolean {
    return this.interpreted.has(userText);
  }

  /** Whether an intent is already known for this user text (a palette action, or an earlier interpret). */
  hasIntent(userText: string): boolean {
    return this.intents.has(userText);
  }

  intentOf(userText: string): InterpretOutput | null {
    return this.intents.get(userText) ?? null;
  }

  /** `npc.choose` decisions for the turn whose last user text is `userText` (empty clears them). */
  setDecisions(userText: string, events: LedgerEvent[]): void {
    if (events.length === 0) this.decisions.delete(userText);
    else this.decisions.set(userText, events);
    trim(this.decisions);
  }

  /** The minds round and minds for the turn whose last user text is `userText` (empty clears them). */
  setMinds(userText: string, events: LedgerEvent[]): void {
    if (events.length === 0) this.minds.delete(userText);
    else this.minds.set(userText, events);
    trim(this.minds);
  }

  /** What the plan applies before the pipeline, in order: the decisions, then the minds. */
  prePlan(userText: string): LedgerEvent[] {
    return [...(this.decisions.get(userText) ?? []), ...(this.minds.get(userText) ?? [])];
  }

  setOffer(userText: string, target: TimelapseTarget | null): void {
    if (target) this.offers.set(userText, target);
    else this.offers.delete(userText);
    trim(this.offers);
  }

  offerFor(userText: string): TimelapseTarget | undefined {
    return this.offers.get(userText);
  }

  setNext(userText: string, next: string | null): void {
    if (next) this.nexts.set(userText, next);
    else this.nexts.delete(userText);
    trim(this.nexts);
  }

  nextOf(userText: string): string | undefined {
    return this.nexts.get(userText);
  }

  setProse(seed: string, prose: PlanProse): void {
    this.prose.set(seed, prose);
    trim(this.prose);
  }

  proseFor(seed: string): PlanProse | undefined {
    return this.prose.get(seed);
  }

  prepareRead(text: string, read: PreparedRead): void {
    this.reads.set(hashParts("lre.read", text), read);
    trim(this.reads);
  }

  /** The engine plan made with `seed` (chips, outline), if this process made it. */
  planFor(seed: string): EngineTurnPlan | undefined {
    return this.plans.get(seed);
  }

  /** Chips the last read of `text` produced. */
  chipsFor(text: string): ReadChip[] {
    return this.readChips.get(hashParts("lre.read", text)) ?? [];
  }

  plan(input: { state: WorldState; ctx: ReadContext; seed: string; kind: GenerationKind; userTexts: string[] }): LedgerEvent[] {
    const last = input.userTexts.at(-1) ?? "";
    // Decisions and minds first: the plan then follows the choices they record (DESIGN §5.2 npc.choose, §24).
    const w = new Working(this.registry, input.ctx.world, input.state);
    w.applyAll(this.prePlan(last));
    const result = this.pipeline.plan({
      registry: this.registry,
      world: input.ctx.world,
      state: w.state,
      runSeed: this.runSeed,
      seed: input.seed,
      kind: input.kind,
      userTexts: input.userTexts,
      intent: this.intents.get(last) ?? null,
    });
    this.plans.set(input.seed, result);
    trim(this.plans);
    return [...w.events, ...result.events];
  }

  read(input: { state: WorldState; ctx: ReadContext; seed: string; text: string }): LedgerEvent[] {
    const key = hashParts("lre.read", input.text);
    const prepared = this.reads.get(key);
    const w = new Working(this.registry, input.ctx.world, input.state);
    w.applyAll(prepared?.events ?? []);
    const chips: ReadChip[] = [];
    const proposals: JsonObject[] = [];
    for (const p of prepared?.auto ?? []) {
      if (p.type !== "time_advance") {
        proposals.push(p);
        continue;
      }
      const minutes = typeof p.minutes === "number" ? Math.round(p.minutes) : 0;
      // During a fight it applies nothing and offers nothing: the read's preparation declined it already.
      const outcome = applyTimeAdvance(this.registry, w, minutes, { runSeed: this.runSeed, capMinutes: TIME_ADVANCE_CAP, unitCap: w.state.time.unitCap });
      if (outcome.chip) chips.push({ target: outcome.chip.target, reason: outcome.reason === "unit_cap" ? "unit_cap" : "over_cap" });
    }
    applyProposals(this.registry, w, proposals, input.seed, this.runSeed);
    if (prepared?.post !== false) {
      const base = input.seed.split(":")[0] ?? input.seed;
      const applied = (this.plans.get(base)?.elapsedMinutes ?? 0) + clockMinutes(w.events);
      w.applyAll(this.pipeline.post({ registry: this.registry, world: input.ctx.world, state: w.state, runSeed: this.runSeed, seed: input.seed, appliedMinutes: applied, extracted: [...w.events] }));
    }
    w.applyAll(prepared?.minds ?? []);
    this.readChips.set(key, chips);
    trim(this.readChips);
    return w.events;
  }
}

function trim<K, V>(map: Map<K, V>, cap = 64): void {
  while (map.size > cap) {
    const first = map.keys().next();
    if (first.done) return;
    map.delete(first.value);
  }
}
