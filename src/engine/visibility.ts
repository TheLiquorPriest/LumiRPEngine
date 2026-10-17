// Knowledge and visibility (DESIGN §7). `public` is seen by everyone, `known_by` by whoever has a
// `knows` relation to the subject, `secret` by the GM only. Player-facing views (panels, the
// Montage, the Journal, chips, slots) pass through these filters; secret truth reaches a player
// view only once its stage has been revealed. The GM view shows everything as labelled,
// unrecorded previews.

import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { EntityId, PlaceId, StageId, TrackId, Visibility } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import type { TrackKind, WorldDoc } from "../shared/world";
import { objectiveLabel, objectiveWhen } from "../shared/world";
import { readEngineSlice, signalOf, type Signal } from "./engine-pack";
import type { Registry } from "./registry-impl";
import { asObject, evalExpr, fieldDef, scopeEnv, truthy } from "./scope";
import type { WorldState } from "./state";
import { own } from "./pack-kit";

/** Whether `who` knows `subject` (an entity, place or fact id); everyone knows themselves. */
export function knows(state: Readonly<WorldState>, who: EntityId, subject: string): boolean {
  if (who === subject) return true;
  return own(state.entities, who)?.relations.some((r) => r.type === "knows" && r.to === subject) ?? false;
}

function visibilityOf(v: unknown): Visibility {
  return v === "secret" || v === "known_by" ? v : "public";
}

export function entityVisibility(world: WorldDoc, state: Readonly<WorldState>, id: EntityId): Visibility {
  const declared = own(world.entities, id)?.visibility ?? own(state.entities, id)?.fields.visibility;
  return visibilityOf(declared);
}

export function canSeeEntity(world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, id: EntityId): boolean {
  if (id === pov) return true;
  if (!own(state.entities, id)) return false;
  const v = entityVisibility(world, state, id);
  return v === "public" || (v === "known_by" && knows(state, pov, id));
}

export function canSeeField(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, id: EntityId, field: string): boolean {
  if (!canSeeEntity(world, state, pov, id)) return false;
  const e = own(state.entities, id);
  if (!e) return false;
  const v = visibilityOf(fieldDef(reg, world, e.kind, field)?.visibility);
  return v === "public" || (v === "known_by" && knows(state, pov, id));
}

/** Places: public, known to the POV (a `knows` relation, or listed in its `known_places`), or where it is now. */
export function canSeePlace(world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, place: PlaceId): boolean {
  const def = own(world.places, place);
  if (!def) return false;
  const v = visibilityOf(def.visibility);
  if (v === "public") return true;
  if (v === "secret") return false;
  const p = own(state.entities, pov);
  const known = p?.fields.known_places;
  return knows(state, pov, place) || p?.fields.place === place || (Array.isArray(known) && known.includes(place));
}

export function signalVisible(world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, s: Signal): boolean {
  if (s.visibility === "secret") return false;
  if (s.visibility === "known_by") return s.entity !== undefined && knows(state, pov, s.entity);
  return s.entity === undefined || canSeeEntity(world, state, pov, s.entity);
}

/** Whether a player at `pov` may see an event (its description, its effect in a Montage). */
export function eventVisible(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, e: LedgerEvent): boolean {
  switch (e.type) {
    case "set":
    case "add":
      return canSeeField(reg, world, state, pov, e.entity, e.field);
    case "link":
    case "unlink":
      return e.rel !== "knows" ? canSeeEntity(world, state, pov, e.from) && canSeeEntity(world, state, pov, e.to) : e.from === pov;
    case "spawn":
      return visibilityOf(e.entity.visibility) === "public";
    case "stage": {
      const t = own(world.tracks, e.track);
      return !!t && t.visibility === "public";
    }
    case "post":
      return e.lines.some((l) => own(state.entities, l.account)?.fields.owner === pov);
    case "clock":
    case "timelapse":
      return true;
    case "materialize":
      return canSeeEntity(world, state, pov, e.entity);
    default: {
      const s = signalOf(e);
      if (s) return signalVisible(world, state, pov, s);
      const data = asObject("data" in e ? e.data : undefined);
      const v = visibilityOf(data.visibility);
      if (v === "secret") return false;
      if (typeof data.entity === "string" && !canSeeEntity(world, state, pov, data.entity)) return false;
      return v === "public" || (typeof data.entity === "string" && knows(state, pov, data.entity));
    }
  }
}

export interface PlayerTrack {
  id: TrackId;
  kind: TrackKind;
  label: string;
  stage: string;
  cue: string | null;
  /** Revealed truths of this track, oldest first. */
  truths: string[];
  objectives: { label: string; done: boolean }[];
  hints: string[];
  status: "active" | "done" | "failed";
}

/**
 * A track as the POV sees it, or null when it is hidden. Secret tracks show only reached cues and
 * revealed truths; their labels stay generic until something is revealed. A track still on a start
 * stage with nothing to show or answer (no cue, objectives or puzzle answer) is dormant: it stays
 * out of view until it moves on, so a quest can wait unseen for its trigger.
 */
export function playerTrack(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, id: TrackId): PlayerTrack | null {
  const t = own(world.tracks, id);
  if (!t) return null;
  if (t.visibility === "known_by" && !(t.owner && knows(state, pov, t.owner)) && t.owner !== pov) return null;
  const stageId: StageId = own(state.tracks, id)?.stage ?? t.start;
  const stage = own(t.stages, stageId);
  if (!stage) return null;
  const revealed = own(readEngineSlice(state).revealed, id) ?? [];
  const truths = revealed.map((s) => own(t.stages, s)?.truth).filter((x): x is string => typeof x === "string");
  const secret = t.visibility === "secret";
  const dormant = stageId === t.start && (stage.objectives ?? []).length === 0 && stage.answer === undefined;
  if (!stage.cue && truths.length === 0 && (secret || dormant)) return null;
  const env = scopeEnv({ reg, ctx: reg.context(world, state), bindings: t.owner ? { self: t.owner } : {} });
  const objectives = secret ? [] : (stage.objectives ?? []).map((o) => ({ label: objectiveLabel(o), done: truthy(evalExpr(objectiveWhen(o), env, false)) }));
  const attempts = own(readEngineSlice(state).attempts, id) ?? 0;
  const failed = Object.values(t.stages).some((s) => s.fail?.to === stageId);
  const terminal = stage.next.length === 0 && !stage.fail;
  return {
    id,
    kind: t.kind,
    label: secret && truths.length === 0 ? "Something is going on" : t.label,
    stage: secret && truths.length === 0 ? "" : stage.label,
    cue: stage.cue ?? null,
    truths,
    objectives,
    hints: (stage.hints ?? []).slice(0, attempts),
    status: terminal ? (failed ? "failed" : "done") : "active",
  };
}

/** Every unrevealed secret truth in the world: text that must never reach a player view. */
export function unrevealedTruths(world: WorldDoc, state: Readonly<WorldState>): string[] {
  const out: string[] = [];
  const slice = readEngineSlice(state);
  for (const [id, t] of Object.entries(world.tracks)) {
    const revealed = own(slice.revealed, id) ?? [];
    for (const [sid, s] of Object.entries(t.stages)) if (s.truth && !revealed.includes(sid)) out.push(s.truth);
  }
  return out;
}

/** Strings in a JSON value that contain any of `secrets` (case-insensitive): a leak check for views and slots. */
export function findLeaks(value: JsonValue | string | undefined, secrets: readonly string[]): string[] {
  const needles = secrets.map((s) => s.toLowerCase()).filter((s) => s.length > 0);
  const out: string[] = [];
  const visit = (v: JsonValue | undefined): void => {
    if (typeof v === "string") {
      const lower = v.toLowerCase();
      for (const n of needles) if (lower.includes(n)) out.push(v);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (isRecord(v)) Object.values(v).forEach((x) => visit(x as JsonValue));
  };
  visit(value);
  return out;
}
