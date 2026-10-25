// The ledger's TurnModel for real chats (DESIGN §5.1): planning runs the simulation pipeline with the
// intent `interpret` produced; reading turns the proposals `extract` produced into validated events
// and then runs the post steps. Model calls happen before, in the ledger's async hooks; this
// bridge only consumes their results, so the core stays synchronous and deterministic.

import type { ActionId } from "../shared/ids";
import { hashParts } from "../shared/hash";
import type { JsonObject } from "../shared/json";
import { hasOwn } from "../shared/json";
import type { GenerationKind, LedgerEvent, PathHash, TimelapseTarget } from "../shared/ledger";
import { applyEffects } from "../engine/effects";
import { materializeAll } from "../engine/materialize";
import type { TurnModel } from "../engine/ledger/journal";
import type { ReadContext, Rejection } from "../engine/registry";
import type { Registry } from "../engine/registry-impl";
import { createRng } from "../engine/rng";
import type { WorldState } from "../engine/state";
import type { InterpretOutput, PostTurnInput, QueuedAction, TurnPlanInput } from "../engine/steps";
import { applyTimeAdvance, type SkipRecord } from "../engine/time";
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
  /** How long a narrated skip may run without asking (the user's `time.askBeyondMinutes`, DESIGN §9.4): one longer becomes a Timelapse chip. */
  askBeyond: number;
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

/**
 * One action of a typed message's read (DESIGN §9.4, §11): it plays, with any claim, unless it waits
 * on the player's answer (`ask`): a claim's question (Add or Not an action), or a check the chat only
 * suggests (Roll or No roll).
 */
export interface ReadStep extends QueuedAction {
  ask?: { kind: "claim" | "check"; question: string; detail: string };
}

/** A typed message's read as `interpret` gave it and the engine judged it: what leads, its actions in order, and those dropped. */
export interface HeldRead {
  lead: ActionId | null;
  params: JsonObject;
  probabilities: Record<string, number>;
  /** Whether the read named an action at all: with none left to play, the turn is plain roleplay. */
  chosen: boolean;
  then?: JsonObject;
  steps: ReadStep[];
  dropped: UnfitAction[];
}

/**
 * A routine change the player's own message states (DESIGN §9.4): never played, it is asked about
 * on that message ("Would you like to add this to your routine?") and recorded only on the player's
 * yes. `proposal` is the `routine` channel's, with the message as its turn.
 */
export interface RoutineAsk {
  proposal: JsonObject;
  question: string;
  detail: string;
  /** What the chip says once the player said yes ("Added to Marcus's routine"). */
  added: string;
  /** Several places the POV may know fit the place the player named: each its own choice, the change at that place. */
  places?: { label: string; proposal: JsonObject }[];
}

export class TurnBridge implements TurnModel {
  /** `interpret` results keyed by the turn's last user text. */
  private readonly intents = new Map<string, InterpretOutput | null>();
  /** User texts whose intent `interpret` read from typed text (a "Not an action?" chip applies). */
  private readonly interpreted = new Set<string>();
  /** User texts `interpret` couldn't read (its call failed, or a Decision route's choice had no call left for its params): their turn ran as plain roleplay ("Couldn't read your action"). */
  private readonly unread = new Set<string>();
  /** Actions `interpret` read but dropped, their params naming nothing that fits, in the message's order, keyed like `intents`; the rest of the message plays without them, and the reply says why of each. */
  private readonly unfit = new Map<string, UnfitAction[]>();
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
  /** A timelapse turn's time skip as its pre phase ran it (DESIGN §24.7), keyed like `intents`: the plan replays it. */
  private readonly skips = new Map<string, SkipRecord>();
  /** A timelapse turn's `castlife.skip_plan` (#53), keyed like `intents`: recorded ahead of the timelapse it plans, so a Re-run or Retry asks no model again. */
  private readonly skipPlans = new Map<string, LedgerEvent>();
  /** Typed messages whose read waits on the player's answer to a claim (Ask first, DESIGN §9.4), keyed like `intents`; none of it plays until each is answered. */
  private readonly held = new Map<string, HeldRead>();
  /** Routine changes a typed message states, keyed like `intents`: asked about once, when it is read (`takeRoutineAsks`). */
  private readonly routineAsks = new Map<string, RoutineAsk[]>();
  /** Typed messages whose read the player let play from the intent gate (Settings → Steps and connections, DESIGN §5.2), keyed like `intents`. */
  private readonly intentsPassed = new Set<string>();
  /** Each text's own turn's last plan, kept with the path it was made at: what the turn plays once its outline is let through. */
  private readonly ownPlans = new Map<string, { parentPath: PathHash; events: LedgerEvent[]; result: EngineTurnPlan }>();
  /** The outline the player let through the outline gate for a text's turn, as edited: what its reply is told, with the plan it was shown for (`ownPlans`). */
  private readonly outlines = new Map<string, string[]>();
  /**
   * The path each text's turn was read at (`begin`): what is kept for a text belongs to that turn
   * only, so a later turn with the same words, or the same turn after an earlier message changed,
   * is read again, while a Re-run, a Retry or a held answer's Regenerate of the turn reuses it.
   */
  private readonly readAt = new Map<string, PathHash>();

  constructor(
    private readonly registry: Registry,
    private readonly pipeline: EnginePipeline,
    readonly runSeed: string,
  ) {}

  /**
   * The pre phase starts the turn whose last user text is `userText`, planned at `at` (DESIGN
   * §5.1): what was kept for the same words read at another path is another turn's, and goes.
   */
  begin(userText: string, at: PathHash): void {
    if (this.readAt.get(userText) === at) return;
    for (const kept of [this.intents, this.unfit, this.nexts, this.decisions, this.minds, this.offers, this.skips, this.skipPlans, this.held, this.routineAsks, this.ownPlans, this.outlines]) kept.delete(userText);
    this.interpreted.delete(userText);
    this.intentsPassed.delete(userText);
    this.unread.delete(userText);
    this.readAt.set(userText, at);
    trim(this.readAt);
  }

  setIntent(userText: string, intent: InterpretOutput | null, interpreted = false): void {
    this.intents.set(userText, intent);
    trim(this.intents);
    this.unread.delete(userText);
    this.unfit.delete(userText);
    this.held.delete(userText);
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
    this.held.delete(userText);
    this.unread.add(userText);
    if (this.unread.size > 64) this.unread.delete(this.unread.values().next().value ?? "");
  }

  /** Whether this text's turn ran unread because `interpret` couldn't read it. */
  wasUnread(userText: string): boolean {
    return this.unread.has(userText);
  }

  /**
   * `interpret` read actions whose params name nothing in the world that fits, and dropped them; its
   * reply gets a decline chip for each saying why. `intent` holds the message's other actions, which
   * play, or is null when none is left, and the turn plays as plain roleplay.
   */
  setUnfit(userText: string, unfit: UnfitAction[], intent: InterpretOutput | null = null): void {
    this.setIntent(userText, intent, intent !== null);
    this.unfit.set(userText, unfit);
    trim(this.unfit);
  }

  /** The actions this text's turn dropped, in order, when `interpret` read ones whose params name nothing that fits; empty otherwise. */
  unfitOf(userText: string): readonly UnfitAction[] {
    return this.unfit.get(userText) ?? [];
  }

  /**
   * A typed message's read (DESIGN §9.4, §11): the first action that plays leads, with the read's
   * confidence, and the others queue behind it. While a step in it waits on the player's answer,
   * none of it is the turn's intent yet: it is held until each is answered (`answerAsk`).
   */
  setRead(userText: string, read: HeldRead): void {
    if (read.steps.some((s) => s.ask)) {
      this.intents.delete(userText);
      this.interpreted.delete(userText);
      this.unfit.delete(userText);
      this.unread.delete(userText);
      this.held.set(userText, read);
      trim(this.held);
      return;
    }
    this.held.delete(userText);
    const [first, ...queue] = read.steps.map(({ ask: _ask, ...step }): QueuedAction => step);
    const confidence = read.lead ? (read.probabilities[read.lead] ?? 1) : 1;
    const probabilities = !first || first.action === read.lead ? read.probabilities : { [first.action]: confidence, none: 1 - confidence };
    const intent: InterpretOutput | null = read.chosen && !first ? null : { action: first?.action ?? read.lead, params: first?.params ?? read.params, probabilities, ...(first?.claim ? { claim: first.claim } : {}), ...(read.then ? { then: read.then } : {}), ...(queue.length > 0 ? { queue } : {}) };
    if (read.dropped.length > 0) this.setUnfit(userText, read.dropped, intent);
    else this.setIntent(userText, intent, true);
  }

  /** Whether this text's read waits on the player's answer to a claim or a suggested check. */
  isHeld(userText: string): boolean {
    return this.held.has(userText);
  }

  /** The first step this text's read waits on: its place in the read, what kind of question it is, and the question the chat asks. */
  askOf(userText: string): { index: number; kind: "claim" | "check"; question: string; detail: string } | null {
    const steps = this.held.get(userText)?.steps ?? [];
    const index = steps.findIndex((s) => s.ask);
    const ask = steps[index]?.ask;
    return ask ? { index, ...ask } : null;
  }

  /** The player's answer to what a step waits on: Add (a claim made real as read) or Roll (the check plays) keeps it; Not an action or No roll drops that step. False when nothing waits there. */
  answerAsk(userText: string, index: number, keep: boolean): boolean {
    const read = this.held.get(userText);
    if (!read?.steps[index]?.ask) return false;
    const steps = keep ? read.steps.map((s, i): ReadStep => (i === index ? { action: s.action, params: s.params, text: s.text, ...(s.claim ? { claim: s.claim } : {}) } : s)) : read.steps.filter((_, i) => i !== index);
    this.setRead(userText, { ...read, steps });
    return true;
  }

  /** The routine changes this text states, from its read (empty clears them). */
  setRoutineAsks(userText: string, asks: RoutineAsk[]): void {
    if (asks.length === 0) this.routineAsks.delete(userText);
    else this.routineAsks.set(userText, asks);
    trim(this.routineAsks);
  }

  /** The routine changes this text's read found, taken: a Re-run or a held answer's Regenerate of the turn reads none again, so nothing is asked twice. */
  takeRoutineAsks(userText: string): RoutineAsk[] {
    const asks = this.routineAsks.get(userText) ?? [];
    this.routineAsks.delete(userText);
    return asks;
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

  /** What the plan applies before the pipeline, in order: the decisions, the minds, then the skip plan, so the timelapse that follows lives it. */
  prePlan(userText: string): LedgerEvent[] {
    const plan = this.skipPlans.get(userText);
    return [...(this.decisions.get(userText) ?? []), ...(this.minds.get(userText) ?? []), ...(plan ? [plan] : [])];
  }

  /** The skip plan this text's timelapse turn records (null: none), and whether one was made for it. */
  setSkipPlan(userText: string, event: LedgerEvent | null): void {
    if (event) this.skipPlans.set(userText, event);
    else this.skipPlans.delete(userText);
    trim(this.skipPlans);
  }

  hasSkipPlan(userText: string): boolean {
    return this.skipPlans.has(userText);
  }

  /** The time skip for the turn whose last user text is `userText` (null clears it): the plan replays its beats. */
  setSkip(userText: string, record: SkipRecord | null): void {
    if (record) this.skips.set(userText, record);
    else this.skips.delete(userText);
    trim(this.skips);
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

  plan(input: { state: WorldState; ctx: ReadContext; seed: string; kind: GenerationKind; userTexts: string[]; parentPath: PathHash }): LedgerEvent[] {
    const last = input.userTexts.at(-1) ?? "";
    // Only what this turn's own pre phase kept: the same words read at another path are another turn's.
    const own = this.readAt.get(last) === input.parentPath;
    // An outline the player let through plays the plan it was shown for, never a fresh one whose rolls could differ.
    const shown = own && this.outlines.has(last) ? this.ownPlans.get(last) : undefined;
    if (shown && shown.parentPath === input.parentPath) {
      this.plans.set(input.seed, shown.result);
      trim(this.plans);
      return structuredClone(shown.events);
    }
    // Decisions and minds first: the plan then follows the choices they record (DESIGN §5.2 npc.choose, §24).
    const w = new Working(this.registry, input.ctx.world, input.state);
    w.applyAll(own ? this.prePlan(last) : []);
    const result = this.pipeline.plan({
      registry: this.registry,
      world: input.ctx.world,
      state: w.state,
      runSeed: this.runSeed,
      seed: input.seed,
      kind: input.kind,
      userTexts: input.userTexts,
      intent: own ? (this.intents.get(last) ?? null) : null,
      skip: own ? (this.skips.get(last) ?? null) : null,
    });
    this.plans.set(input.seed, result);
    trim(this.plans);
    const events = [...w.events, ...result.events];
    // Kept by reference (a reuse clones it), so a turn that never meets the outline gate pays nothing for it.
    if (own) {
      this.ownPlans.set(last, { parentPath: input.parentPath, events, result });
      trim(this.ownPlans);
    }
    return events;
  }

  /**
   * The player let this text's read play from the intent gate (Play, or Edit with its params). A real
   * pick the edit made for the claim's param wins over the claim (DESIGN §9.4): the claimed thing is
   * made only while that param stays as read.
   */
  passIntent(userText: string, params?: JsonObject): boolean {
    const intent = this.intents.get(userText);
    if (!intent) return false;
    if (params) {
      const { claim, ...rest } = intent;
      const kept = claim !== undefined && JSON.stringify(params[claim.param] ?? null) === JSON.stringify(intent.params[claim.param] ?? null);
      this.intents.set(userText, { ...rest, params, ...(claim && kept ? { claim } : {}) });
    }
    this.intentsPassed.add(userText);
    if (this.intentsPassed.size > 64) this.intentsPassed.delete(this.intentsPassed.values().next().value ?? "");
    return true;
  }

  intentPassed(userText: string): boolean {
    return this.intentsPassed.has(userText);
  }

  /** The outline the player let through the outline gate for this text's turn: its plan plays as shown, told this outline. False when no plan was shown for it. */
  passOutline(userText: string, lines: string[]): boolean {
    if (!this.ownPlans.has(userText)) return false;
    this.outlines.set(userText, lines);
    trim(this.outlines);
    return true;
  }

  outlineOf(userText: string): readonly string[] | undefined {
    return this.outlines.get(userText);
  }

  /** The turn shown at the outline gate was taken: its outline and kept plan go, so the next run of these words plans again. */
  dropOutline(userText: string): void {
    this.outlines.delete(userText);
    this.ownPlans.delete(userText);
  }

  read(input: { state: WorldState; ctx: ReadContext; seed: string; text: string }): LedgerEvent[] {
    const key = hashParts("lre.read", input.text);
    const prepared = this.reads.get(key);
    const w = new Working(this.registry, input.ctx.world, input.state);
    w.applyAll(prepared?.events ?? []);
    const chips: ReadChip[] = [];
    const proposals: JsonObject[] = [];
    if (prepared) for (const p of prepared.auto) {
      if (p.type !== "time_advance") {
        proposals.push(p);
        continue;
      }
      const minutes = typeof p.minutes === "number" ? Math.round(p.minutes) : 0;
      // During a fight it applies nothing and offers nothing: the read's preparation declined it already.
      const outcome = applyTimeAdvance(this.registry, w, minutes, { runSeed: this.runSeed, capMinutes: prepared.askBeyond, unitCap: w.state.time.unitCap });
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
