// The time-skip orchestrator (DESIGN §24.7). A timelapse turn with minds on is a time skip: before the
// reply the engine finds its beats (the moments inside it that matter to the player character, with
// their times), may ask the `skip` step for more, then runs the timelapse beat by beat with the minds
// of the people each beat involves, and stops where one of them would interrupt the skip, or where the
// before-the-reply clock runs out. What was decided at each beat is the skip's record; the plan
// replays it (`replaySkip`), so a re-fold, a Re-narrate and the background lane never ask a model.

import type { ChatId, EntityId, UserId } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { Fidelity, MindCallTrace, MindMoment, MindsSettings } from "../shared/minds";
import { limitOf, MIND_TEXT_CAPS, MINDS_EVENTS, SKIP_FILL_HEAD } from "../shared/minds";
import type { ModelUseSettings } from "../shared/settings";
import type { WorldDoc } from "../shared/world";
import { calendarOf, formatClock, formatStamp } from "../engine/calendar";
import { ENGINE_EVENTS } from "../engine/engine-pack";
import { acts } from "../engine/life";
import { optionalQuery, own } from "../engine/pack-kit";
import type { Registry } from "../engine/registry-impl";
import { allRules } from "../engine/rules";
import { isGone, kindIs, placeOfEntity } from "../engine/scope";
import { ranTo } from "../engine/simulate";
import { pinsFor } from "../engine/lore-pins";
import type { WorldState } from "../engine/state";
import type { InterpretOutput } from "../engine/steps";
import { TimelapseRun, type SkipRecord } from "../engine/time";
import { skipPastFight, timelapseOptions, turnStart } from "../engine/turn";
import { Working } from "../engine/working";
import type { HostPort } from "./host";
import { readPins } from "./lore-pins";
import { chatBefore, localTime, mindPrompt, mindsStepConfig, type RunMindsInput, type RunMindsResult } from "./minds";
import { pinnedLines, recentChat } from "./minds-context";
import type { Guidance } from "./preset-binding";
import type { Steps } from "./steps";

/** `runMinds` bound to the runtime: records nothing, and gives the validated `minds.mind` events in `who`'s order, as many as finished before the signal. */
export type BeatMinds = (input: RunMindsInput) => Promise<RunMindsResult>;

/** A moment inside a skip worth stopping at: its time, why in the GM's words, where it came from, whom it names, and its weight when the beats are capped (lower counts more). */
export interface Beat {
  at: number;
  reason: string;
  source: "scan" | "model";
  who: EntityId[];
  rank: number;
}

/** What weighs most when there are more beats than the cap allows: plans with the POV, then invitations, its appointments, the story, its money, and last what the model proposed. */
const RANK = { plan: 1, invitation: 2, appointment: 3, story: 4, money: 5, model: 6 } as const;

/** A skip's span and the beats the engine finds in it. */
export interface ScannedSkip {
  from: number;
  to: number;
  /**
   * Beats lie after it: the skip's start, or how far the clock had run before a ✎ fix set it back,
   * since everything up to there already happened and no mind thinks there again (L48).
   */
  after: number;
  beats: Beat[];
}

/**
 * The beats inside a skip, found without a model (DESIGN §24.7): the POV's appointments, the plans of
 * Live and Near characters that involve it (where the planner lays them), and, from a scratch run of
 * the skip, invitations to it, story moments (a track changing stage, a time rule, a rule that
 * interrupts or tells a beat) and its money (paydays, bills, statements, declines). Only up to where
 * the skip would end on its own, and only past how far the world has run (`ranTo`). Null when the
 * timelapse can't run.
 */
export function scanBeats(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, intent: InterpretOutput, runSeed: string): ScannedSkip | null {
  const { target, opts } = timelapseOptions(intent, runSeed);
  const w = new Working(reg, world, state);
  const run = target ? TimelapseRun.start(reg, w, target, opts) : null;
  if (!run || "code" in run) return null;
  const mark = w.events.length;
  run.advanceTo(run.to);
  const end = run.clock;
  const pov = world.pov;
  const ctx = reg.context(world, state);
  const nameOf = (id: EntityId): string => own(state.entities, id)?.name ?? id;
  const person = (id: EntityId): boolean => id !== pov && kindIs(reg, world, own(state.entities, id)?.kind ?? "", "person");
  const beats: Beat[] = [];
  const after = Math.max(run.from, ranTo(state));
  const add = (at: number, reason: string, rank: number, who: EntityId[]): void => {
    if (at > after && at <= end) beats.push({ at, reason, source: "scan", who, rank });
  };
  const appointments = own(state.entities, pov)?.fields.appointments;
  for (const raw of Array.isArray(appointments) ? appointments : []) {
    if (isRecord(raw) && typeof raw.at === "number") add(raw.at, `the player character's appointment${typeof raw.label === "string" ? `: ${raw.label}` : ""}`, RANK.appointment, []);
  }
  const tier = optionalQuery(ctx, "minds.tier");
  const plans = optionalQuery(ctx, "minds.plans");
  const laid = optionalQuery(ctx, "castlife.commitments");
  if (tier && plans && laid) {
    for (const id of Object.keys(state.entities).sort()) {
      const level = id === pov ? "background" : tier(ctx, id);
      if (level !== "live" && level !== "near") continue;
      const withPov = plans(ctx, id).filter((p) => p.status === "open" && p.with.includes(pov));
      for (const b of laid(ctx, id, run.from, end)) {
        const p = withPov.find((x) => x.id === b.plan);
        if (p) add(b.start, `${nameOf(id)}'s plan with the player character: ${p.what}`, RANK.plan, [id, ...p.with.filter(person)]);
      }
    }
  }
  const rules = allRules(reg, world);
  let clock = run.from;
  for (const e of w.events.slice(mark)) {
    if (e.type === "clock") clock += e.minutes;
    else if (e.type === "stage") {
      const track = own(world.tracks, e.track);
      add(clock, `a story moment: ${track?.label ?? e.track}`, RANK.story, track?.owner && person(track.owner) ? [track.owner] : []);
    } else if (e.type === "castlife.invitation" && "data" in e && typeof e.data.agent === "string") add(clock, `${nameOf(e.data.agent)}'s invitation`, RANK.invitation, [e.data.agent]);
    else if (e.type === ENGINE_EVENTS.fired && "data" in e) {
      const rule = rules.find((r) => r.id === e.data.rule);
      if (rule && ("at" in rule.on || rule.interrupt === true || rule.beat !== undefined)) add(clock, `the rule ${rule.id}`, RANK.story, []);
    } else if (e.type === ENGINE_EVENTS.signal && "data" in e && e.data.entity === pov && (e.data.class === "bill" || e.data.class === "decline")) add(typeof e.data.at === "number" ? e.data.at : clock, `the player character's money: ${String(e.data.text ?? e.data.class)}`, RANK.money, []);
  }
  return { from: run.from, to: run.to, after, beats };
}

/** Beats at the same minute as one (its names together, the weightiest reason); then the cap, by weight and time; in time order. */
export function capBeats(beats: readonly Beat[], max: number): Beat[] {
  const byMinute = new Map<number, Beat>();
  for (const b of beats) {
    const same = byMinute.get(b.at);
    if (!same) byMinute.set(b.at, { ...b, who: [...b.who] });
    else byMinute.set(b.at, { ...(b.rank < same.rank ? b : same), source: same.source === "scan" || b.source === "scan" ? "scan" : "model", who: [...new Set([...same.who, ...b.who])] });
  }
  const merged = [...byMinute.values()];
  const kept = Number.isFinite(max) ? [...merged].sort((a, b) => a.rank - b.rank || a.at - b.at).slice(0, Math.max(0, max)) : merged;
  return kept.sort((a, b) => a.at - b.at);
}

/** What a skip needs besides its dependencies: who asks, the world and the state the plan starts from, the timelapse, the settings, and the before-the-reply clock. */
export interface SkipInput {
  chatId: ChatId;
  userId: UserId;
  world: WorldDoc;
  /** The state the turn's plan starts from: its fold, the turn's decisions and its minds round. */
  state: Readonly<WorldState>;
  intent: InterpretOutput;
  runSeed: string;
  settings: { minds: MindsSettings; modelUse: ModelUseSettings; hideJsonBlocks: boolean };
  guidance?: Guidance;
  /** The before-the-reply clock: once it runs out the skip stops at the next beat. */
  signal: AbortSignal;
}

export interface SkipDeps {
  registry: Registry;
  steps: Steps;
  minds: BeatMinds;
  /** Where the lore pinned to the `skip` step and the recent chat it reads come from (DESIGN §24.5). */
  host: Pick<HostPort, "books" | "log" | "chats">;
}

/** A skip as its pre phase ran it: its record for the plan, and the minds' traces for the inspector. */
export interface SkipRun {
  record: SkipRecord;
  traces: MindCallTrace[];
}

/**
 * The `skip` step (DESIGN §24.7), when the user turned it on: further beats the model proposes inside
 * the span, from the beats found, what the people involved plan, the lore pinned to the step (its
 * only lore, §24.5) and, while minds read it, the recent chat before the skip. Its prompt is the
 * user's own, else the world's template, else the built-in. Its reasons are the GM's to read only: no
 * mind and no player surface is given them, since they may come of someone's private intent. Its call
 * joins the inspector's minds calls, with no text and as no one.
 */
async function proposedBeats(deps: SkipDeps, input: SkipInput, state: Readonly<WorldState>, scanned: ScannedSkip, traces: MindCallTrace[]): Promise<Beat[]> {
  const config = mindsStepConfig(input.settings.modelUse, "skip");
  if (!config || input.signal.aborted) return [];
  const ctx = deps.registry.context(input.world, state);
  const cal = calendarOf(input.world);
  const plans = optionalQuery(ctx, "minds.plans");
  const intents = [...new Set(scanned.beats.flatMap((b) => b.who))].flatMap((id) => {
    const theirs = (plans?.(ctx, id) ?? []).filter((p) => p.status === "open");
    return theirs.length > 0 ? [`${own(state.entities, id)?.name ?? id}: ${theirs.map((p) => `${p.what} (${formatStamp(cal, p.when.from)})`).join("; ")}`] : [];
  });
  const pinned = pinnedLines({ reg: deps.registry, world: input.world, state, reads: input.settings.minds.reads, pinned: await readPins(deps.host, input.world, pinsFor(input.world, null, undefined, ["skip"]), input.userId) }, "skip");
  const reads = input.settings.minds.reads;
  const chat = reads.history.on ? recentChat({ reads, hideJson: input.settings.hideJsonBlocks, history: chatBefore(await deps.host.chats.messages(input.chatId, input.userId).catch(() => []), true) }) : [];
  // The player's own words for the span, which the beats must follow, while minds read the player's message.
  const fill = reads.message.on ? (input.intent.text?.trim() ?? "") : "";
  const user = [`The skip runs from ${formatStamp(cal, scanned.from)} to ${formatStamp(cal, scanned.to)}.`, fill !== "" ? `${SKIP_FILL_HEAD}\n${fill}` : "", scanned.beats.length > 0 ? `Moments found:\n${scanned.beats.map((b) => `- ${formatStamp(cal, b.at)}: ${b.reason}`).join("\n")}` : "No moments found.", intents.length > 0 ? `What the people involved plan:\n${intents.join("\n")}` : "", pinned.length > 0 ? `Pinned lore:\n${pinned.join("\n")}` : "", chat.length > 0 ? `Recent chat (as the player sees it):\n${chat.join("\n")}` : ""].filter((part) => part !== "").join("\n\n");
  // The placeholders the minds steps' docs promise; the step thinks for no one, so `character` is empty.
  const here = placeOfEntity(state, input.world.pov);
  const prompt = mindPrompt("skip", input.world, input.settings.minds, { world: input.world.name, character: "", clock: formatClock(cal, scanned.from), place: here ? (own(input.world.places, here)?.name ?? here) : "", pov: own(state.entities, input.world.pov)?.name ?? input.world.pov });
  const usage = { tokens: 0 };
  const t0 = performance.now();
  const raw = await deps.steps.helperJson("skip", prompt.text, user, config, input.userId, input.signal, { lore: null, guidance: input.guidance?.skip ?? "", usage });
  const proposals = isRecord(raw) && Array.isArray(raw.beats) ? raw.beats : null;
  traces.push({ purpose: "skip", phase: "skip", who: "", level: null, outcome: proposals ? "recorded" : "failed", ms: Math.round(performance.now() - t0), tokens: usage.tokens, prompt: prompt.source });
  if (!proposals) return [];
  const out: Beat[] = [];
  for (const b of proposals.slice(0, 5)) {
    if (!isRecord(b) || typeof b.at !== "string" || typeof b.reason !== "string") continue;
    const at = localTime(input.world, scanned.from, b.at);
    if (at !== null && at > scanned.after && at <= scanned.to) out.push({ at, reason: b.reason.replace(/\s+/g, " ").trim().slice(0, MIND_TEXT_CAPS.reason), source: "model", who: [], rank: RANK.model });
  }
  return out;
}

/**
 * The minds at a moment of the skip. At a beat: the people it names, then those with the player
 * character whom fidelity puts at Live or Near, best score first, up to `cap`. At its end (a `turn`
 * moment, as the turn's own minds, which can't interrupt anything): only those with the player
 * character. Each thinks blind to the others, with a reason that names nothing private. Only their
 * `minds.mind` events come back.
 */
async function mindsAt(deps: SkipDeps, input: SkipInput, w: Working, kind: MindMoment["kind"], named: readonly EntityId[], cap: number, reason: string, traces: MindCallTrace[]): Promise<LedgerEvent[]> {
  const pov = input.world.pov;
  const scores = optionalQuery(w.ctx, "minds.fidelity")?.(w.ctx, { user: "", reply: "" }) ?? [];
  const here = placeOfEntity(w.state, pov);
  const able = (id: EntityId): boolean => id !== pov && own(w.state.entities, id) !== undefined && !isGone(w.state, id) && acts(w.world, w.state, id);
  const rank = (id: EntityId): number => {
    const i = scores.findIndex((s) => s.entity === id);
    return i < 0 ? scores.length : i;
  };
  const present = scores.filter((s) => (s.level === "live" || s.level === "near") && here !== null && placeOfEntity(w.state, s.entity) === here).map((s) => s.entity);
  const who = [...new Set([...[...named].sort((a, b) => rank(a) - rank(b)), ...present])].filter(able).slice(0, cap);
  if (who.length === 0) return [];
  const levels: Record<EntityId, Fidelity> = {};
  for (const id of who) levels[id] = scores.find((s) => s.entity === id)?.level ?? "background";
  // The player's own words for the span reach the minds in it, which those with the player character are told (`mindContext`).
  const skip = input.intent.text?.trim() ?? "";
  const result = await deps.minds({ chatId: input.chatId, userId: input.userId, world: input.world, state: w.state, who, moment: { kind, at: w.state.clock, reason, user: "", reply: "", ...(skip !== "" ? { skip } : {}) }, levels, signal: input.signal, guidance: input.guidance?.mind ?? "", phase: "skip" });
  traces.push(...result.traces);
  return result.events.filter((e) => e.type === MINDS_EVENTS.mind && "data" in e && typeof e.data.entity === "string" && who.includes(e.data.entity));
}

/** The first of a beat's minds that interrupts the skip, from someone who still acts. */
function interrupter(w: Working, events: readonly LedgerEvent[]): EntityId | null {
  for (const e of events) {
    if (e.type !== MINDS_EVENTS.mind || !("data" in e)) continue;
    const who = e.data.entity;
    if (typeof who === "string" && isRecord(e.data.interrupt) && typeof e.data.interrupt.reason === "string" && acts(w.world, w.state, who)) return who;
  }
  return null;
}

/** A beat's minds as recorded: only the one that stops the skip keeps its interrupt, so no one else is told as stepping in. */
function stopperOnly(events: readonly LedgerEvent[], stopper: EntityId | null): LedgerEvent[] {
  return events.map((e) => (e.type === MINDS_EVENTS.mind && "data" in e && e.data.entity !== stopper && isRecord(e.data.interrupt) ? { ...e, data: { ...e.data, interrupt: null } } : e));
}

/**
 * A time skip's pre phase (DESIGN §24.7): from the state the plan starts from, the beats, the `skip`
 * step's proposals, and the timelapse run beat by beat with the minds at each, capped by the user's
 * settings ("none" is no cap, which the before-the-reply clock still bounds). A mind's interrupt stops
 * it at its beat; the clock running out stops it at the next beat it reaches, the first one too, so
 * a Continue always gets further, with the rest left for it. Past the last beat it runs to its end,
 * where those with the player character think once more as the turn's own minds. A fight under way
 * ends first, as the plan ends it (`skipPastFight`). Null when the timelapse can't run, which the
 * plan then says.
 */
export async function runSkip(deps: SkipDeps, input: SkipInput): Promise<SkipRun | null> {
  const reg = deps.registry;
  const cal = calendarOf(input.world);
  const w = new Working(reg, input.world, input.state);
  turnStart(reg, w, input.runSeed);
  skipPastFight(w, input.runSeed);
  const scanned = scanBeats(reg, input.world, w.state, input.intent, input.runSeed);
  const { target, opts } = timelapseOptions(input.intent, input.runSeed);
  const run = scanned && target ? TimelapseRun.start(reg, w, target, opts) : null;
  if (!scanned || !run || "code" in run) return null;
  const traces: MindCallTrace[] = [];
  const beats = capBeats([...scanned.beats, ...(await proposedBeats(deps, input, w.state, scanned, traces))], limitOf(input.settings.minds.skip.maxBeats));
  const perBeat = limitOf(input.settings.minds.skip.maxMindsPerBeat);
  const record: SkipRecord = { beats: [{ at: run.from, events: run.apply([{ type: MINDS_EVENTS.skip, data: { from: run.from, to: run.to, beats: beats.map((b) => ({ at: b.at, reason: b.reason, source: b.source })) } }]) }], stop: null };
  for (const beat of beats) {
    run.advanceTo(beat.at);
    if (run.clock !== beat.at) break;
    // Once the before-the-reply clock has run out no one else is asked.
    const minds = input.signal.aborted ? [] : await mindsAt(deps, input, w, "beat", beat.who, perBeat, `Time skips ahead; it is now ${formatClock(cal, beat.at)}.`, traces);
    const applied = run.apply(stopperOnly(minds, interrupter(w, minds)));
    // Every beat reached is recorded, with its minds' events or none, so the plan's replay cuts the run where this one did.
    record.beats.push({ at: beat.at, events: applied });
    const stopper = interrupter(w, applied);
    if (stopper) {
      record.stop = { by: "mind", at: beat.at, entity: stopper };
      return { record, traces };
    }
    if (input.signal.aborted) {
      record.stop = { by: "clock", at: beat.at };
      return { record, traces };
    }
  }
  run.advanceTo(run.to);
  // The unit cap may have taken the run back to the start of a slot a beat fell inside: that beat is undone.
  record.beats = record.beats.filter((b) => b.at <= run.clock);
  if (!input.signal.aborted) {
    const end = run.apply(await mindsAt(deps, input, w, "turn", [], limitOf(input.settings.minds.liveLimit), `The time skip ends; it is now ${formatClock(cal, run.clock)}.`, traces));
    if (end.length > 0) record.beats.push({ at: run.clock, events: end });
  }
  return { record, traces };
}
