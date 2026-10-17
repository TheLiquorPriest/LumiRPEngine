// Knowledge and visibility (DESIGN §7). `public` is seen by everyone; `known_by` by whoever knows
// the subject: a `knows` relation to it, or matching its `knownBy` selector (being a member of a
// group, say); `secret` by the GM only. A place may also be `discoverable`: known as `known_by` is,
// and found for good once the POV has been there (`space.seen`). A visibility value or a `knownBy`
// selector this reader doesn't understand hides its subject: everything here fails closed.
// Player-facing views (panels, the Montage, the Journal, chips, slots) pass through these filters;
// secret truth reaches a player view only once its stage has been revealed. The GM view shows
// everything as labelled, unrecorded previews.

import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { EntityId, PlaceId, StageId, TrackId, Visibility } from "../shared/ids";
import type { LedgerEvent } from "../shared/ledger";
import type { LoreEntryDef, PlaceDef, Selector, TrackDef, TrackKind, WorldDoc } from "../shared/world";
import { objectiveLabel, objectiveWhen } from "../shared/world";
import { loreIsSecret, lorePhrases } from "../shared/lore";
import type { ExprEnv } from "./expr";
import { readEngineSlice, signalOf, type Signal } from "./engine-pack";
import type { Registry } from "./registry-impl";
import { asObject, evalExpr, fieldDef, isGone, placeOfEntity, scopeEnv, truthy } from "./scope";
import { selectorMatches } from "./selector";
import { placeVisit } from "./seen";
import type { WorldState } from "./state";
import { own } from "./pack-kit";

/** Whether `who` knows `subject` (an entity, place or fact id); everyone knows themselves. */
export function knows(state: Readonly<WorldState>, who: EntityId, subject: string): boolean {
  if (who === subject) return true;
  return own(state.entities, who)?.relations.some((r) => r.type === "knows" && r.to === subject) ?? false;
}

/** A visibility value as this reader understands it: unset is public, and anything it doesn't know is secret. */
export function visibilityOf(v: unknown): Visibility {
  if (v === undefined || v === null || v === "public") return "public";
  return v === "known_by" ? "known_by" : "secret";
}

const SELECTOR_LISTS = ["ids", "kind", "tier", "memberOf", "tag"] as const;

function isStrings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * A `knownBy` selector as this reader understands it, or null. A constraint it doesn't know, a
 * malformed value or no constraint at all grants nobody: ignoring a constraint would widen the grant.
 */
export function knownBySelector(v: unknown): Selector | null {
  if (!isRecord(v)) return null;
  const out: Selector = {};
  let constraints = 0;
  for (const [key, value] of Object.entries(v)) {
    if (key === "class") {
      if (!isRecord(value)) return null;
      const accepted: Record<string, string[]> = {};
      for (const [facet, values] of Object.entries(value)) {
        if (!isStrings(values)) return null;
        accepted[facet] = values;
      }
      out.class = accepted;
      constraints += Object.keys(accepted).length;
      continue;
    }
    const list = SELECTOR_LISTS.find((k) => k === key);
    if (!list || !isStrings(value)) return null;
    out[list] = value;
    constraints++;
  }
  return constraints > 0 ? out : null;
}

/** Whether the POV matches a `knownBy` selector, which makes it know the subject as a `knows` relation would. */
function granted(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, knownBy: unknown): boolean {
  if (knownBy === undefined) return false;
  const selector = knownBySelector(knownBy);
  return selector !== null && selectorMatches(reg, world, state, selector, pov);
}

/** The world document's declaration wins; a spawned entity carries its own in its fields. */
export function entityVisibility(world: WorldDoc, state: Readonly<WorldState>, id: EntityId): Visibility {
  const declared = own(world.entities, id)?.visibility ?? own(state.entities, id)?.fields.visibility;
  return visibilityOf(declared);
}

export function canSeeEntity(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, id: EntityId): boolean {
  if (id === pov) return true;
  // A removed entity is out of the world for the player; the GM view still lists it.
  if (!own(state.entities, id) || isGone(state, id)) return false;
  const v = entityVisibility(world, state, id);
  if (v !== "known_by") return v === "public";
  return knows(state, pov, id) || granted(reg, world, state, pov, own(world.entities, id)?.knownBy ?? own(state.entities, id)?.fields.knownBy);
}

/** A field the POV may see: its entity is visible, and the field is public or `known_by` and known (a `knows` relation to the entity, or its `knownBy`). */
export function canSeeField(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, id: EntityId, field: string): boolean {
  if (!canSeeEntity(reg, world, state, pov, id)) return false;
  const e = own(state.entities, id);
  if (!e) return false;
  const def = fieldDef(reg, world, e.kind, field);
  const v = visibilityOf(def?.visibility);
  if (v !== "known_by") return v === "public";
  return knows(state, pov, id) || granted(reg, world, state, pov, def?.knownBy);
}

/**
 * A place on its own: public; `known_by` and known to the POV (a `knows` relation, its `knownBy`, or
 * listed in its `known_places`) or where it is now; `discoverable` the same, or anywhere it has been.
 */
function placeSeen(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, place: PlaceId, def: PlaceDef): boolean {
  const discoverable = def.visibility === "discoverable";
  const v = discoverable ? "known_by" : visibilityOf(def.visibility);
  if (v !== "known_by") return v === "public";
  const known = own(state.entities, pov)?.fields.known_places;
  if (knows(state, pov, place) || placeOfEntity(state, pov) === place || (Array.isArray(known) && known.includes(place)) || granted(reg, world, state, pov, def.knownBy)) return true;
  // `space.seen` is the world POV's own record.
  return discoverable && pov === world.pov && placeVisit(state, place) !== null;
}

/** How many places up a parent chain is followed; a longer chain (a loop) hides the place. */
const PLACE_DEPTH = 32;

/**
 * Places the POV may see: one it sees on its own (`placeSeen`) inside places it sees too. A room of
 * a place it can't see is as hidden as that place, so nothing names it or offers a way there; when
 * the POV stands in it, it goes by `HIDDEN_PLACE_NAME` like the place around it.
 */
export function canSeePlace(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, place: PlaceId): boolean {
  let id: PlaceId | undefined = place;
  let def = own(world.places, place);
  if (!def) return false;
  for (let depth = 0; id !== undefined && def; depth++) {
    if (depth >= PLACE_DEPTH || !placeSeen(reg, world, state, pov, id, def)) return false;
    id = def.parent;
    def = id === undefined ? undefined : own(world.places, id);
  }
  return true;
}

/** What every player surface calls a place the POV can't see, even the one it stands in: never its name. */
export const HIDDEN_PLACE_NAME = "Somewhere";

/**
 * The POV's place as every player surface names it (the map, the HUD and its ✎, Scene, the sheet,
 * and the facts the narrator and the helpers read): its id and name when the POV may see it, else
 * `HIDDEN_PLACE_NAME` with no id. Null when the POV isn't anywhere.
 */
export function povPlace(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): { id: PlaceId | null; name: string } | null {
  const here = placeOfEntity(state, world.pov);
  if (here === null) return null;
  return canSeePlace(reg, world, state, world.pov, here) ? { id: here, name: own(world.places, here)?.name ?? here } : { id: null, name: HIDDEN_PLACE_NAME };
}

/** A `known_by` track is known to its owner, to whoever knows the owner, and to whoever matches its `knownBy`. */
export function trackKnown(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, t: TrackDef): boolean {
  return t.owner === pov || (t.owner !== undefined && knows(state, pov, t.owner)) || granted(reg, world, state, pov, t.knownBy);
}

export function signalVisible(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, s: Signal): boolean {
  if (s.visibility === "secret") return false;
  if (s.visibility === "known_by") return s.entity !== undefined && knows(state, pov, s.entity);
  return s.entity === undefined || canSeeEntity(reg, world, state, pov, s.entity);
}

/** Whether a player at `pov` may see an event (its description, its effect in a Montage). */
export function eventVisible(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, e: LedgerEvent): boolean {
  switch (e.type) {
    case "set":
    case "add":
      return canSeeField(reg, world, state, pov, e.entity, e.field);
    case "link":
    case "unlink":
      return e.rel !== "knows" ? canSeeEntity(reg, world, state, pov, e.from) && canSeeEntity(reg, world, state, pov, e.to) : e.from === pov;
    case "spawn":
      return visibilityOf(e.entity.visibility) === "public";
    case "stage": {
      const t = own(world.tracks, e.track);
      return !!t && visibilityOf(t.visibility) === "public";
    }
    case "post":
      return e.lines.some((l) => own(state.entities, l.account)?.fields.owner === pov);
    case "clock":
    case "timelapse":
      return true;
    case "materialize":
      return canSeeEntity(reg, world, state, pov, e.entity);
    default: {
      const s = signalOf(e);
      if (s) return signalVisible(reg, world, state, pov, s);
      const data = asObject("data" in e ? e.data : undefined);
      const v = visibilityOf(data.visibility);
      if (v === "secret") return false;
      if (typeof data.entity === "string" && !canSeeEntity(reg, world, state, pov, data.entity)) return false;
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
  const visibility = visibilityOf(t.visibility);
  if (visibility === "known_by" && !trackKnown(reg, world, state, pov, t)) return null;
  const stageId: StageId = own(state.tracks, id)?.stage ?? t.start;
  const stage = own(t.stages, stageId);
  if (!stage) return null;
  const revealed = own(readEngineSlice(state).revealed, id) ?? [];
  const truths = revealed.map((s) => own(t.stages, s)?.truth).filter((x): x is string => typeof x === "string");
  const secret = visibility === "secret";
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

/**
 * Reads secret lore gates against one state, building the expression scope once. A gate that is
 * missing, blank or can't be evaluated doesn't hold: the entry stays secret (fail closed).
 */
export function loreGateReader(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): (entry: LoreEntryDef) => boolean {
  let env: ExprEnv | null = null;
  return (entry) => {
    if (typeof entry.gate !== "string" || entry.gate.trim() === "") return false;
    try {
      env ??= scopeEnv({ reg, ctx: reg.context(world, state), bindings: {} });
      return truthy(evalExpr(entry.gate, env, false));
    } catch {
      return false;
    }
  };
}

/** The text of every secret lore entry whose gate doesn't hold, as the phrases the leak check looks for (`lorePhrases`). */
export function secretLorePhrases(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): string[] {
  const open = loreGateReader(reg, world, state);
  const out: string[] = [];
  for (const l of Object.values(world.lore)) if (loreIsSecret(l) && typeof l.content === "string" && !open(l)) out.push(...lorePhrases(l.content));
  return out;
}

/** Every unrevealed secret a player view must never carry: tracks' unrevealed truths and gated secret lore. */
export function unrevealedSecrets(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): string[] {
  return [...unrevealedTruths(world, state), ...secretLorePhrases(reg, world, state)];
}

/**
 * The names of the places the POV can't see: free text the player reads (a model's reason, a lore
 * trace) must not carry one. Names shorter than three characters would match almost anything.
 */
export function unseenPlaceNames(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId): string[] {
  return Object.entries(world.places).flatMap(([id, p]) => (typeof p.name === "string" && p.name.trim().length >= 3 && !canSeePlace(reg, world, state, pov, id) ? [p.name] : []));
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
