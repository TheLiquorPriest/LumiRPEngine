// The quests family (AGENT-LOOP-PLAN §6; INC1-SPEC R3a): the world's tracks (quests, secrets,
// puzzles and agendas), where one stands, and what moves it on.
//
// - Under `everyone` every track. A restricted track's own words (its label, its stages, its
//   objectives) are marked with its secrecy, and every truth not yet revealed is marked as kept;
//   what the player is meant to read (a cue, a hint, a revealed truth) stays plain.
// - Under `gm` all of it, with each track's visibility and owner and every stage with its truth;
//   a turn agent's view (`marked`) marks each truth not yet revealed as kept.
//
// What moves a track on is read as the engine steps it (`stepTracks`): each way on with what it
// needs and its target's gate, the way it fails, and whether each holds now, in the track's own
// environment (`trackEnv`); the objectives are ticked as the quest log ticks them.

import { readEngineSlice } from "../../../../engine/engine-pack";
import { own } from "../../../../engine/pack-kit";
import { evalExpr, scopeEnv, truthy } from "../../../../engine/scope";
import { currentStage, isTerminal, trackEnv } from "../../../../engine/tracks";
import { hintsEarned, hintsOpened, type PlayerTrack } from "../../../../engine/visibility";
import { TOOL_NOTE } from "../../../../shared/agent-tools";
import type { StageId, TrackId } from "../../../../shared/ids";
import { type Expr, objectiveLabel, objectiveWhen, type StageDef, TRACK_KINDS, type TrackDef, type TrackKind } from "../../../../shared/world";
import type { ToolDefinition } from "../registry";
import type { Secrecy, ToolReadView, ViewRef } from "../read-view";
import { resolveTrack } from "../resolve";
import { badValue, needText, objectSchema, text, textArg } from "../schema";
import { clockWords } from "./time";

const TRACKS = "quests_tracks";
const STAGE = "quests_stage";
const MOVES = "quests_moves";

type TrackStatus = PlayerTrack["status"];

/** A truth not yet revealed is kept from everyone, whatever the track's own visibility. */
const KEPT: Secrecy = { known: [], kept: "everyone" };

/** A stage of a track, by its id and its label. */
interface StageRef {
  id: StageId;
  label: string;
}

/** A track as `quests_tracks` lists it. */
interface TrackRow {
  id: string;
  label: string;
  kind: TrackKind;
  /** The stage it is at, by its label. */
  stage: string;
  status: TrackStatus;
  /** What the player can notice at the stage. */
  cue?: string;
  /** Under `gm`: the stage's id, the track's visibility when it isn't public, and its owner. */
  stageId?: StageId;
  visibility?: string;
  owner?: ViewRef | null;
}

/** Where a track stands, as `quests_stage` gives it. */
interface StageAnswer {
  id: string;
  label: string;
  kind: TrackKind;
  stage: string;
  status: TrackStatus;
  /** When the track came to the stage. */
  since?: string;
  cue?: string;
  /** The stage's objectives, ticked as the quest log ticks them. */
  objectives: { label: string; done: boolean }[];
  /** Every hint earned at the stage, `opened` of them opened. */
  hints: string[];
  opened?: number;
  /** The truths revealed so far, oldest first. */
  truths: string[];
  /** Under `everyone`: each truth not yet revealed, by its stage, marked; the stage the track is at flagged. */
  secrets?: { stage: string; truth: string; current?: true }[];
  /** Under `gm`: the stage's id, the visibility, the owner, and every stage with its truth and whether that is revealed. */
  stageId?: StageId;
  visibility?: string;
  owner?: ViewRef | null;
  stages?: { id: StageId; label: string; truth?: string; revealed?: boolean; current?: true }[];
}

/** What moves a track on, as `quests_moves` gives it. */
interface MovesAnswer {
  id: string;
  label: string;
  stage: string;
  /** The stage's id; each way on, with what it needs, its target's gate and whether each holds now; the way it fails; the stage's objectives with what decides each. */
  stageId?: StageId;
  next?: { to: StageRef; when: Expr; holds: boolean; gate?: { when: Expr; holds: boolean } }[];
  fail?: { to: StageRef; when: Expr; holds: boolean };
  objectives?: { label: string; when: Expr; done: boolean }[];
}

/** Where a track stands as the engine has it. */
interface Standing {
  ref: ViewRef;
  stage: StageId;
  def: StageDef | undefined;
  /** When it came to the stage; null when the state keeps no record of it. */
  since: number | null;
  status: TrackStatus;
  /** The stages whose truths are revealed, oldest first. */
  revealed: readonly StageId[];
  /** The track's own words as the view gives them: where the view marks, marked with its secrecy when it isn't public. */
  words: (text: string) => string;
}

/** A track's standing, or null when the view may not name it. */
function standing(view: ToolReadView, id: TrackId, t: TrackDef): Standing | null {
  const ref = view.track(id);
  if (!ref) return null;
  const stage = currentStage(view.world, view.state, id) ?? t.start;
  const secrecy = view.trackSecrecy(id);
  return {
    ref,
    stage,
    def: own(t.stages, stage),
    since: own(view.state.tracks, id)?.since ?? null,
    // As the quest log has it (`playerTrack`): an end stage is done, or failed when a way to fail leads there.
    status: isTerminal(t, stage) ? (Object.values(t.stages).some((s) => s.fail?.to === stage) ? "failed" : "done") : "active",
    revealed: own(readEngineSlice(view.state).revealed, id) ?? [],
    words: (text) => view.mark(text, secrecy),
  };
}

/** A stage's objectives, each with what decides it and whether it is met now, read as the quest log reads them (`playerTrack`: the track's owner as `self`). */
function objectivesOf(view: ToolReadView, t: TrackDef, def: StageDef | undefined): { label: string; when: Expr; done: boolean }[] {
  const objectives = def?.objectives ?? [];
  if (objectives.length === 0) return [];
  const env = scopeEnv({ reg: view.registry, ctx: view.ctx, bindings: t.owner ? { self: t.owner } : {} });
  return objectives.map((o) => ({ label: objectiveLabel(o), when: objectiveWhen(o), done: truthy(evalExpr(objectiveWhen(o), env, false)) }));
}

/** Every track by id, of `kind` when given. */
function trackRows(view: ToolReadView, kind: TrackKind | null): TrackRow[] {
  const rows: TrackRow[] = [];
  for (const id of Object.keys(view.world.tracks).sort()) {
    const t = own(view.world.tracks, id);
    const at = t && (kind === null || t.kind === kind) ? standing(view, id, t) : null;
    if (!t || !at) continue;
    const row: TrackRow = { id, label: at.ref.name, kind: t.kind, stage: at.words(at.def?.label ?? at.stage), status: at.status };
    rows.push(view.knowledge === "gm" ? { ...row, stageId: at.stage, visibility: at.ref.visibility, owner: t.owner === undefined ? undefined : view.entity(t.owner) } : row);
  }
  return rows;
}

/** Where a track stands, as the view reads it; null when it may not name it. */
function stageAnswer(view: ToolReadView, id: TrackId): StageAnswer | null {
  const t = own(view.world.tracks, id);
  const at = t ? standing(view, id, t) : null;
  if (!t || !at) return null;
  const answer: StageAnswer = {
    id,
    label: at.ref.name,
    kind: t.kind,
    stage: at.words(at.def?.label ?? at.stage),
    status: at.status,
    since: at.since === null ? undefined : clockWords(view, at.since),
    cue: at.def?.cue,
    objectives: objectivesOf(view, t, at.def).map((o) => ({ label: at.words(o.label), done: o.done })),
    hints: hintsEarned(view.world, view.state, id),
    opened: hintsOpened(view.world, view.state, id),
    truths: at.revealed.map((s) => own(t.stages, s)?.truth).filter((x): x is string => typeof x === "string"),
  };
  const stages = Object.entries(t.stages);
  if (view.knowledge === "everyone") {
    const kept = view.trackSecrecy(id) ?? KEPT;
    return { ...answer, secrets: stages.flatMap(([sid, s]) => (s.truth && !at.revealed.includes(sid) ? [{ stage: at.words(s.label), truth: view.mark(s.truth, kept), current: sid === at.stage || undefined }] : [])) };
  }
  // The GM's every stage, each truth not yet revealed marked as kept where the view marks.
  const kept = view.marked ? (view.trackSecrecy(id) ?? KEPT) : null;
  return {
    ...answer,
    stageId: at.stage,
    visibility: at.ref.visibility,
    owner: t.owner === undefined ? undefined : view.entity(t.owner),
    stages: stages.map(([sid, s]) => ({ id: sid, label: at.words(s.label), truth: s.truth === undefined || at.revealed.includes(sid) ? s.truth : view.mark(s.truth, kept), revealed: s.truth === undefined ? undefined : at.revealed.includes(sid), current: sid === at.stage || undefined })),
  };
}

/** What moves a track on, as the view reads it; null when it may not name it. */
function movesAnswer(view: ToolReadView, id: TrackId): MovesAnswer | null {
  const t = own(view.world.tracks, id);
  const at = t ? standing(view, id, t) : null;
  if (!t || !at) return null;
  const env = trackEnv(view.registry, view, t, id);
  const holds = (when: Expr): boolean => truthy(evalExpr(when, env, false));
  const fail = at.def?.fail;
  return {
    id,
    label: at.ref.name,
    stage: at.words(at.def?.label ?? at.stage),
    stageId: at.stage,
    next: (at.def?.next ?? []).map((n) => {
      const gate = own(t.stages, n.to)?.gate;
      return { to: { id: n.to, label: at.words(own(t.stages, n.to)?.label ?? n.to) }, when: n.when, holds: holds(n.when), gate: gate === undefined ? undefined : { when: gate, holds: holds(gate) } };
    }),
    fail: fail ? { to: { id: fail.to, label: at.words(own(t.stages, fail.to)?.label ?? fail.to) }, when: fail.when, holds: holds(fail.when) } : undefined,
    objectives: objectivesOf(view, t, at.def).map((o) => ({ label: at.words(o.label), when: o.when, done: o.done })),
  };
}

/** A tool that reads one track: resolved among those the view may name, answered by `read`. */
function trackTool(name: string, read: (view: ToolReadView, id: TrackId) => StageAnswer | MovesAnswer | null): ToolDefinition {
  return {
    name,
    family: "quests",
    tier: "read",
    parameters: () => objectSchema({ track: text() }, ["track"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = needText(view, name, args, "track");
      if (typeof said !== "string") return said;
      const r = resolveTrack(view, said);
      if ("refused" in r) return r.refused;
      const answer = view.read(() => read(view, r.id));
      return answer ? view.answer(answer) : view.refuse(TOOL_NOTE.noTrack, { name: said });
    },
  };
}

/** The quests family, in the order of its texts (`shared/agent-tools-read.ts`). */
export const QUESTS_TOOLS: readonly ToolDefinition[] = [
  {
    name: TRACKS,
    family: "quests",
    tier: "read",
    parameters: () => objectSchema({ kind: text(TRACK_KINDS) }),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = textArg(args, "kind");
      const kind = TRACK_KINDS.find((k) => k === said) ?? null;
      if (said !== null && kind === null) return badValue(view, TRACKS, "kind", said, TRACK_KINDS);
      return view.answer({ tracks: view.read(() => trackRows(view, kind)) });
    },
  },
  trackTool(STAGE, stageAnswer),
  trackTool(MOVES, movesAnswer),
];
