// Tracks (DESIGN §10): one state machine for quests, secret ladders, puzzles and NPC agendas.
//
// A stage advances only by predicates: its `fail.when` first (to `fail.to`), else the first
// `next[i]` whose `when` holds and whose target's `gate` holds. Leaving a stage by `next` grants
// its `rewards`, and reaching an end stage (no way out) grants its own, since it is never left;
// entering a stage applies its `effects`, records a reveal when it carries `truth` and, for quests,
// signals a `quest` interrupt. Secret stages are never advanced by a model; a puzzle stage with an
// `answer` also advances on a correct answer (exact or normalized, then the authored
// `puzzle.answer` decision threshold). The GM's Stage moves a track on as a real entry does, or back
// with no entry at all (`moveTrack`). Agenda stages feed the planner their `priority`.

import { hashParts } from "../shared/hash";
import type { EntityId, StageId, TrackId } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import type { StageDef, TrackDef, WorldDoc } from "../shared/world";
import { objectiveWhen } from "../shared/world";
import { applyEffects } from "./effects";
import { ENGINE_EVENTS, readEngineSlice } from "./engine-pack";
import type { ExprEnv } from "./expr";
import type { Rejection } from "./registry";
import type { Registry } from "./registry-impl";
import { createRng } from "./rng";
import { evalExpr, scopeEnv, truthy } from "./scope";
import type { WorldState } from "./state";
import { own } from "./pack-kit";
import { ownersCue } from "./visibility";
import type { Working } from "./working";

/** Transitions per track per pass: a stage cycle stops here. */
export const TRANSITION_CAP = 8;

export interface TrackChange {
  track: TrackId;
  from: StageId;
  to: StageId;
  via: "next" | "fail" | "answer" | "gm";
  events: LedgerEvent[];
}

export function currentStage(world: WorldDoc, state: Readonly<WorldState>, track: TrackId): StageId | null {
  const def = own(world.tracks, track);
  if (!def) return null;
  return own(state.tracks, track)?.stage ?? def.start;
}

function trackEnv(reg: Registry, w: Working, track: TrackDef, trackId: TrackId): ExprEnv {
  const stage = own(w.state.tracks, trackId)?.stage ?? track.start;
  const def = own(track.stages, stage);
  const env0 = scopeEnv({ reg, ctx: w.ctx, bindings: track.owner ? { self: track.owner, owner: track.owner } : {} });
  const objectives = def?.objectives ?? [];
  const done = objectives.filter((o) => truthy(evalExpr(objectiveWhen(o), env0, false))).length;
  const slice = readEngineSlice(w.state);
  return scopeEnv({
    reg,
    ctx: w.ctx,
    bindings: track.owner ? { self: track.owner, owner: track.owner } : {},
    vars: {
      track: {
        id: trackId,
        stage,
        since: w.state.clock - (own(w.state.tracks, trackId)?.since ?? 0),
        attempts: own(slice.attempts, trackId) ?? 0,
        objectives: objectives.length,
        done,
        complete: done === objectives.length,
      },
    },
  });
}

/**
 * Moves a track into a stage: the rewards of the stage it leaves (unless it fails), the stage event,
 * its effects, its own rewards when it is an end stage, a reveal and the quest signal.
 */
function enter(reg: Registry, w: Working, trackId: TrackId, track: TrackDef, from: StageId, to: StageId, via: TrackChange["via"], seed: string): TrackChange | null {
  const start = w.events.length;
  const leaving = own(track.stages, from);
  const rng = createRng(hashParts(seed, "track", trackId, from, to, w.state.clock));
  const bindings: Record<string, EntityId> = track.owner ? { self: track.owner, owner: track.owner } : {};
  if (via !== "fail" && leaving?.rewards && leaving.rewards.length > 0) applyEffects(reg, w, leaving.rewards, { bindings, rng: rng.fork("rewards") });
  if (w.apply({ type: "stage", track: trackId, to })) return null;
  const entering = own(track.stages, to);
  if (entering?.effects && entering.effects.length > 0) applyEffects(reg, w, entering.effects, { bindings, rng: rng.fork("effects") });
  // An end stage is never left, so what it rewards comes with reaching it: the quest is done (or lost) here.
  if (entering?.rewards && entering.rewards.length > 0 && isTerminal(track, to)) applyEffects(reg, w, entering.rewards, { bindings, rng: rng.fork("end rewards") });
  if (entering?.truth) w.apply({ type: ENGINE_EVENTS.revealed, data: { track: trackId, stage: to } });
  if (track.kind === "quest") {
    // A cue that is its owner's behaviour is Stance's to tell (`ownersCue`): the signal names the stage instead.
    const cue = entering?.cue && !ownersCue(reg, w.world, w.state, w.world.pov, trackId) ? entering.cue : null;
    const text = cue ?? `${track.label}: ${entering?.label ?? to}`;
    w.apply({ type: ENGINE_EVENTS.signal, data: { class: "quest", text, visibility: track.visibility } });
  }
  return { track: trackId, from, to, via, events: w.events.slice(start) };
}

function gateOpen(reg: Registry, w: Working, track: TrackDef, trackId: TrackId, to: StageId): boolean {
  const gate = own(track.stages, to)?.gate;
  if (gate === undefined) return true;
  return truthy(evalExpr(gate, trackEnv(reg, w, track, trackId), false));
}

/** Advances every track whose predicates hold, in id order, until stable (bounded per track). */
export function stepTracks(reg: Registry, w: Working, seed: string): TrackChange[] {
  const changes: TrackChange[] = [];
  for (const trackId of Object.keys(w.world.tracks).sort()) {
    const track = own(w.world.tracks, trackId);
    if (!track) continue;
    for (let i = 0; i < TRANSITION_CAP; i++) {
      const stage = own(w.state.tracks, trackId)?.stage ?? track.start;
      const def: StageDef | undefined = own(track.stages, stage);
      if (!def) break;
      const env = trackEnv(reg, w, track, trackId);
      let change: TrackChange | null = null;
      const solvedHere = track.kind === "puzzle" && def.answer !== undefined && own(readEngineSlice(w.state).solved, trackId) === stage;
      if (def.fail && truthy(evalExpr(def.fail.when, env, false))) change = enter(reg, w, trackId, track, stage, def.fail.to, "fail", seed);
      else if (solvedHere && def.next[0] && gateOpen(reg, w, track, trackId, def.next[0].to)) change = enter(reg, w, trackId, track, stage, def.next[0].to, "answer", seed);
      else {
        for (const n of def.next) {
          if (!truthy(evalExpr(n.when, env, false))) continue;
          if (!gateOpen(reg, w, track, trackId, n.to)) continue;
          change = enter(reg, w, trackId, track, stage, n.to, "next", seed);
          break;
        }
      }
      if (!change) break;
      changes.push(change);
    }
  }
  return changes;
}

/** Every stage a track can come to from `stage` by its ways on (`next` and `fail`); `stage` itself only when a way leads back to it. */
function stagesAfter(track: TrackDef, stage: StageId): Set<StageId> {
  const reached = new Set<StageId>();
  const queue: StageId[] = [stage];
  for (let s = queue.shift(); s !== undefined; s = queue.shift()) {
    const def = own(track.stages, s);
    for (const to of [...(def?.next ?? []).map((n) => n.to), ...(def?.fail ? [def.fail.to] : [])]) {
      if (reached.has(to)) continue;
      reached.add(to);
      queue.push(to);
    }
  }
  return reached;
}

/**
 * The GM's Stage (DESIGN §10): moves a track to `to`, recorded as the GM's edit. A stage the track
 * can still come to from where it stands is entered as the story would enter it: the stage it leaves
 * grants its rewards (unless `to` is how that stage fails), and the stage entered applies its
 * effects, its rewards when it is an end stage, its reveal and a quest's signal; stages it skips play
 * no part. A stage that doesn't follow from where it stands (one already passed, a way back) is only
 * set, so nothing is granted, spawned or revealed twice. The stage's own ways on wait for the next
 * step of the tracks, so the chat stands where the GM put it. The same stage again changes nothing.
 */
export function moveTrack(reg: Registry, w: Working, trackId: TrackId, to: StageId, seed: string): Rejection | null {
  const track = own(w.world.tracks, trackId);
  if (!track) return { code: "missing_track", reason: `no track ${trackId}` };
  if (!own(track.stages, to)) return { code: "missing_stage", reason: `${track.label} has no stage ${to}` };
  const from = own(w.state.tracks, trackId)?.stage ?? track.start;
  if (from === to) return null;
  if (!stagesAfter(track, from).has(to)) return w.apply({ type: "stage", track: trackId, to });
  const leaving = own(track.stages, from);
  const fails = leaving !== undefined && leaving.fail?.to === to && !leaving.next.some((n) => n.to === to);
  return enter(reg, w, trackId, track, from, to, fails ? "fail" : "gm", seed) ? null : { code: "bad_stage", reason: `${track.label} can't move to ${to}` };
}

/** Answer normalization: case, accents, punctuation, spacing and a leading article don't matter. */
export function normalizeAnswer(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "");
}

export interface AnswerCheck {
  correct: boolean;
  via: "exact" | "normalized" | "decision" | null;
  /** True when the stage authored a decision threshold, nothing matched and no decision was given. */
  needsDecision: boolean;
  /** The attempt to record, or null (not a puzzle stage with an answer, or a decision is needed first). */
  event: LedgerEvent | null;
}

/**
 * Checks a puzzle answer against the current stage (pure). `decision` is the `puzzle.answer`
 * step's probability that the answer is correct; it counts only where the author enabled it,
 * against the authored threshold. A correct attempt marks the stage solved; the track advances to
 * the stage's first `next` target on its next step (gate permitting).
 */
export function checkAnswer(world: WorldDoc, state: Readonly<WorldState>, trackId: TrackId, answer: string, decision?: number): AnswerCheck {
  const none: AnswerCheck = { correct: false, via: null, needsDecision: false, event: null };
  const track = own(world.tracks, trackId);
  if (!track || track.kind !== "puzzle") return none;
  const stage = own(state.tracks, trackId)?.stage ?? track.start;
  const def = own(track.stages, stage);
  if (!def?.answer) return none;
  let via: AnswerCheck["via"] = null;
  if (def.answer.expect.includes(answer)) via = "exact";
  else if (def.answer.normalize && def.answer.expect.some((x) => normalizeAnswer(x) === normalizeAnswer(answer))) via = "normalized";
  else if (def.answer.decision && decision !== undefined && decision >= def.answer.decision.threshold) via = "decision";
  if (via === null && def.answer.decision !== undefined && decision === undefined) return { ...none, needsDecision: true };
  return { correct: via !== null, via, needsDecision: false, event: { type: ENGINE_EVENTS.attempt, data: { track: trackId, stage, correct: via !== null, ...(via ? { via } : {}) } } };
}

export interface AnswerResult extends AnswerCheck {
  change: TrackChange | null;
}

/** Records an answer and steps the tracks: a correct answer advances the puzzle. */
export function answerPuzzle(reg: Registry, w: Working, trackId: TrackId, answer: string, seed: string, decision?: number): AnswerResult {
  const check = checkAnswer(w.world, w.state, trackId, answer, decision);
  if (!check.event || w.apply(check.event)) return { ...check, change: null };
  const change = check.correct ? (stepTracks(reg, w, seed).find((c) => c.track === trackId && c.via === "answer") ?? null) : null;
  return { ...check, change };
}

export interface AgendaItem {
  track: TrackId;
  label: string;
  stage: StageId;
  stageLabel: string;
  priority: number;
}

/** Agenda tracks an agent owns, with their current stage's planner priority. */
export function agendaFor(world: WorldDoc, state: Readonly<WorldState>, agent: EntityId): AgendaItem[] {
  const out: AgendaItem[] = [];
  for (const id of Object.keys(world.tracks).sort()) {
    const t = own(world.tracks, id);
    if (!t || t.kind !== "agenda" || t.owner !== agent) continue;
    const stage = own(state.tracks, id)?.stage ?? t.start;
    const def = own(t.stages, stage);
    if (!def) continue;
    out.push({ track: id, label: t.label, stage, stageLabel: def.label, priority: def.priority ?? 0 });
  }
  return out.sort((a, b) => b.priority - a.priority || a.track.localeCompare(b.track));
}

/** A terminal stage has no way out. */
export function isTerminal(track: TrackDef, stage: StageId): boolean {
  const def = own(track.stages, stage);
  return !def || (def.next.length === 0 && !def.fail);
}
