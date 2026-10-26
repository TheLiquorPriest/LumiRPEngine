// Knowledge and visibility (DESIGN §7). `public` is seen by everyone; `known_by` by whoever knows
// the subject: a `knows` relation to it, or matching its `knownBy` selector (being a member of a
// group, say); `secret` by the GM only. A place may also be `discoverable`: known as `known_by` is,
// and found for good once the POV has been there (`space.seen`). A visibility value or a `knownBy`
// selector this reader doesn't understand hides its subject: everything here fails closed.
// Player-facing views (panels, the Montage, the Journal, chips, slots) pass through these filters;
// secret truth reaches a player view only once its stage has been revealed. The GM view shows
// everything as labelled, unrecorded previews.

import type { JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { EntityId, PlaceId, StageId, TrackId, Visibility } from "../shared/ids";
import { heldBy } from "../shared/finance";
import { hashParts } from "../shared/hash";
import type { LedgerEvent } from "../shared/ledger";
import type { ActionDef, Expr, LoreEntryDef, PlaceDef, Selector, StageDef, TrackDef, TrackKind, WorldDoc } from "../shared/world";
import { objectiveLabel, objectiveWhen } from "../shared/world";
import { loreIsSecret, lorePhrases } from "../shared/lore";
import { compile, ExprError, identifiers, type ExprEnv, type Node } from "./expr";
import { readEngineSlice, signalOf, type Signal } from "./engine-pack";
import type { Touch } from "./registry";
import type { Registry } from "./registry-impl";
import { asObject, evalExpr, fieldDef, isGone, kindIs, placeOfEntity, placeWithin, scopeEnv, truthy } from "./scope";
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
  // A `discoverable` thing is hidden until found (a search where it lies, or opening what holds it,
  // writes the POV's `knows` to it), as a `discoverable` place is until visited; every other reader
  // takes it for secret, failing closed.
  const v = isDiscoverable(world, state, id) ? "known_by" : entityVisibility(world, state, id);
  if (v !== "known_by") return v === "public";
  return knows(state, pov, id) || granted(reg, world, state, pov, own(world.entities, id)?.knownBy ?? own(state.entities, id)?.fields.knownBy);
}

/** Whether a thing is `discoverable`: the world document's declaration, else a spawned one's own field. */
export function isDiscoverable(world: WorldDoc, state: Readonly<WorldState>, id: EntityId): boolean {
  return (own(world.entities, id)?.visibility ?? own(state.entities, id)?.fields.visibility) === "discoverable";
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
 * listed in its `known_places`) or where it is now, which is every place around it as much as the
 * one it stands in, so a room of someone's flat keeps the flat; `discoverable` the same, or anywhere
 * it has been. A secret place is never seen, not even from inside.
 */
function placeSeen(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, place: PlaceId, def: PlaceDef): boolean {
  const discoverable = def.visibility === "discoverable";
  const v = discoverable ? "known_by" : visibilityOf(def.visibility);
  if (v !== "known_by") return v === "public";
  const known = own(state.entities, pov)?.fields.known_places;
  if (knows(state, pov, place) || placeWithin(world, placeOfEntity(state, pov), place) || (Array.isArray(known) && known.includes(place)) || granted(reg, world, state, pov, def.knownBy)) return true;
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

/** Whether a track may be named to the POV: public, revealed, or `known_by` and known (`trackKnown`). */
export function trackShown(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, id: string): boolean {
  const t = own(world.tracks, id);
  if (!t) return false;
  const visibility = visibilityOf(t.visibility);
  if (visibility === "public") return true;
  if ((own(readEngineSlice(state).revealed, id) ?? []).length > 0) return true;
  return visibility === "known_by" && trackKnown(reg, world, state, pov, t);
}

/**
 * Whether a track still keeps something from the POV: a stage truth not yet revealed, or the track
 * itself, which may not be named to it (`trackShown`). Its cue is a hint the narrator may play while
 * this holds (DESIGN §6.6); after that there is nothing left for the cue to hint at.
 */
export function trackKeepsSecret(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, id: string): boolean {
  const t = own(world.tracks, id);
  if (!t) return false;
  const revealed = own(readEngineSlice(state).revealed, id) ?? [];
  return Object.entries(t.stages).some(([stage, s]) => !!s.truth && !revealed.includes(stage)) || !trackShown(reg, world, state, pov, id);
}

/**
 * Whether a track's stage cue is how its owner behaves (DESIGN §6.6, §10): someone other than the
 * POV, a person, owns the track, and it still keeps a secret from the POV. Such a cue has one place,
 * Stance, which tells it under that person's name while they are in the scene; the quest log, the
 * Quest section and a quest's signal never carry it, so nothing tells an unnamed someone's
 * behaviour. Any other stage cue is what the player can notice, and the quest log tells it.
 */
export function ownersCue(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, id: TrackId): boolean {
  const t = own(world.tracks, id);
  if (t?.owner === undefined || t.owner === pov) return false;
  const owner = own(state.entities, t.owner);
  return owner !== undefined && kindIs(reg, world, owner.kind, "person") && trackKeepsSecret(reg, world, state, pov, id);
}

/** A track's current stage, with its id; null for a track the world doesn't have or a stage it has lost. */
function currentStageOf(world: WorldDoc, state: Readonly<WorldState>, id: TrackId): { id: StageId; def: StageDef } | null {
  const t = own(world.tracks, id);
  if (!t) return null;
  const stageId = own(state.tracks, id)?.stage ?? t.start;
  const def = own(t.stages, stageId);
  return def ? { id: stageId, def } : null;
}

/**
 * The hints the player may open at a track's current stage (DESIGN §10): at a stage that takes an
 * answer, one for each wrong answer given there; at any other, every hint the stage has, from the
 * moment the track reaches it. The player opens them one at a time (`engine.hint`), and only the
 * opened ones reach the narrator (`hintsOpened`).
 */
export function hintsEarned(world: WorldDoc, state: Readonly<WorldState>, id: TrackId): string[] {
  const stage = currentStageOf(world, state, id);
  if (!stage) return [];
  const hints = stage.def.hints ?? [];
  if (stage.def.answer === undefined) return [...hints];
  return hints.slice(0, own(own(readEngineSlice(state).missed, id) ?? {}, stage.id) ?? 0);
}

/** How many of the hints earned at a track's current stage the player has opened (`engine.hint`). */
export function hintsOpened(world: WorldDoc, state: Readonly<WorldState>, id: TrackId): number {
  const stage = currentStageOf(world, state, id);
  if (!stage) return 0;
  return Math.min(own(own(readEngineSlice(state).hints, id) ?? {}, stage.id) ?? 0, hintsEarned(world, state, id).length);
}

export function signalVisible(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, s: Signal): boolean {
  if (s.visibility === "secret") return false;
  if (s.visibility === "known_by") return s.entity !== undefined && knows(state, pov, s.entity);
  return s.entity === undefined || canSeeEntity(reg, world, state, pov, s.entity);
}

/**
 * Whether the POV may see every field a pack event writes, as its type declares them (`touches`:
 * `space.pos` x and y, `castlife.need` the needs): a line about a field it can't see would carry
 * the field's value or its change. Touches that can't be read fail closed.
 */
function packFieldsSeen(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId, e: LedgerEvent): boolean {
  const touches = reg.get(e.type)?.touches;
  if (!touches) return true;
  let written: Touch[];
  try {
    written = touches(e);
  } catch {
    return false;
  }
  return written.every((t) => !("field" in t) || canSeeField(reg, world, state, pov, t.entity, t.field));
}

/** Whether a player at `pov` may see an event (its description, its effect in a Montage), every field it writes included. */
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
      return e.lines.some((l) => heldBy(state.entities, l.account, pov));
    case "clock":
    case "timelapse":
      return true;
    case "materialize":
      return canSeeEntity(reg, world, state, pov, e.entity);
    default: {
      if (!packFieldsSeen(reg, world, state, pov, e)) return false;
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
  /** The id the player layer knows it by (`shownTrackId`): a secret track's stand-in, any other's own. */
  id: string;
  kind: TrackKind;
  label: string;
  stage: string;
  /** What the player can notice at the stage; null when it has none, or when it is its owner's behaviour, which only Stance tells (`ownersCue`). */
  cue: string | null;
  /** Revealed truths of this track, oldest first. */
  truths: string[];
  objectives: { label: string; done: boolean }[];
  /** The hints the player may open at this stage (`hintsEarned`), in order. */
  hints: string[];
  /** How many of them the player has opened: those reach the narrator, the rest wait behind "Show a hint". */
  opened: number;
  status: "active" | "done" | "failed";
}

/**
 * The id the player layer knows a track by (DESIGN §7). A secret track never goes by its own, which
 * is the author's and may name more than any one of its truths tells: it goes by a stand-in, `~` and
 * a hash of the world and the track, for as long as it lasts, revealed or not, so the id under an open
 * quest sheet never changes. Any other track goes by its own id.
 */
export function shownTrackId(world: Pick<WorldDoc, "id" | "tracks">, id: TrackId): string {
  if (visibilityOf(own(world.tracks, id)?.visibility) !== "secret") return id;
  let shown = `~${hashParts("lre.track", world.id, id).slice(0, 12)}`;
  while (hasOwn(world.tracks, shown)) shown = `~${shown}`;
  return shown;
}

/**
 * A track as the POV sees it, or null when it is hidden. Secret tracks show only reached cues and
 * revealed truths, under their stand-in id; their labels stay generic until something is revealed.
 * A track still on a start stage with nothing to show or answer (no cue, objectives or puzzle
 * answer) is dormant: it stays out of view until it moves on, so a quest can wait unseen for its
 * trigger. A cue that is its owner's behaviour is Stance's alone (`ownersCue`): the row goes without
 * it, and a secret with nothing else to show has no row until it is revealed.
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
  const cue = !stage.cue || ownersCue(reg, world, state, pov, id) ? null : stage.cue;
  if (cue === null && truths.length === 0 && (secret || dormant)) return null;
  const env = scopeEnv({ reg, ctx: reg.context(world, state), bindings: t.owner ? { self: t.owner } : {} });
  const objectives = secret ? [] : (stage.objectives ?? []).map((o) => ({ label: objectiveLabel(o), done: truthy(evalExpr(objectiveWhen(o), env, false)) }));
  const hints = hintsEarned(world, state, id);
  const failed = Object.values(t.stages).some((s) => s.fail?.to === stageId);
  const terminal = stage.next.length === 0 && !stage.fail;
  return {
    id: shownTrackId(world, id),
    kind: t.kind,
    label: secret && truths.length === 0 ? "Something is going on" : t.label,
    stage: secret && truths.length === 0 ? "" : stage.label,
    cue,
    truths,
    objectives,
    hints,
    opened: hintsOpened(world, state, id),
    status: terminal ? (failed ? "failed" : "done") : "active",
  };
}

/** The calls a formula reads how far the story has come by: a track's stage, the time it has stood there, a story flag. */
const STORY_CALLS: Readonly<Record<string, true>> = { stage: true, since: true, flag: true };

/** Whether a formula reads how far the story has come (DESIGN §10): `stage(…)` or `stage.<track>`, `since(…)` or `flag(…)`. One that doesn't parse reads nothing. */
export function readsStory(expr: Expr): boolean {
  const visit = (n: Node): boolean => {
    switch (n.k) {
      case "id":
        return n.path.length === 2 && n.path[0] === "stage";
      case "call":
        return hasOwn(STORY_CALLS, n.name) || n.args.some(visit);
      case "un":
        return visit(n.a);
      case "bin":
        return visit(n.a) || visit(n.b);
      case "tern":
        return visit(n.c) || visit(n.a) || visit(n.b);
      default:
        return false;
    }
  };
  try {
    return visit(compile(expr).root);
  } catch (e) {
    if (e instanceof ExprError) return false;
    throw e;
  }
}

/**
 * Whether an action is a step the story hasn't come to (DESIGN §11): one of its requirements that
 * reads none of its params reads how far the story has come (`readsStory`) and doesn't hold in
 * `env` (the POV as `self` and `actor`). A quest's or a secret's later step, or one already taken,
 * isn't an option yet: every list of actions the player or a model reads (the Actions sheet, its
 * Combat tab, interpret's catalog) leaves it out rather than showing it locked, so no list names a
 * step the player hasn't reached. A requirement on where they are or what they carry still locks.
 */
export function storyLocked(env: ExprEnv, action: Pick<ActionDef, "params" | "requires">): boolean {
  return action.requires.some((req) => readsStory(req) && identifiers(req).every((name) => !hasOwn(action.params, name)) && !truthy(evalExpr(req, env, false)));
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

/** The titles of the secret lore entries whose gate doesn't hold: what a model may call them. */
export function secretLoreTitles(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): string[] {
  const open = loreGateReader(reg, world, state);
  return Object.values(world.lore).flatMap((l) => (loreIsSecret(l) && typeof l.title === "string" && l.title.trim() !== "" && !open(l) ? [l.title] : []));
}

/** Every unrevealed secret a player view must never carry: tracks' unrevealed truths and gated secret lore. */
export function unrevealedSecrets(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): string[] {
  return [...unrevealedTruths(world, state), ...secretLorePhrases(reg, world, state)];
}

/**
 * The names of the places the POV can't see: free text the player reads (a model's reason, a lore
 * trace) must not say one, as `namesAny` reads a label.
 */
export function unseenPlaceNames(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, pov: EntityId): string[] {
  return Object.entries(world.places).flatMap(([id, p]) => (typeof p.name === "string" && p.name.trim() !== "" && !canSeePlace(reg, world, state, pov, id) ? [p.name] : []));
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

/**
 * The accents people often leave out on Latin, Greek and Cyrillic letters, once decomposed (the
 * combining marks U+0300–U+036F): Zoë is Zoe, Алёна is Алена. Other scripts' marks are parts of their
 * letters and stay ("राम" keeps its vowel sign).
 */
const ACCENTS = /[\u0300-\u036f]/g;

/** Letters with no decomposition that people write plain all the same: Søren is Soren, Łukasz is Lukasz. */
const PLAIN_LETTERS: Record<string, string> = { ø: "o", æ: "ae", œ: "oe", ß: "ss", đ: "d", ł: "l", ı: "i", ð: "d", þ: "th" };

/** A text without the accents people leave out, composed alike however it was typed; its case is kept. */
function unaccented(text: string): string {
  return text.normalize("NFD").replace(ACCENTS, "").normalize("NFC");
}

/** A word as name checks compare it: as written ("zoë", "łukasz") and plain ("zoe", "lukasz"). */
export interface Spelling {
  written: string;
  plain: string;
}

/**
 * A text's words as name checks compare them: lowercase runs of letters, marks and digits ("Vex's"
 * is "vex" and "s"; "राम" keeps its vowel sign), composed alike however they were typed. A short
 * text (a name, a label) is spelt once while among the latest spelt: a name check spells every
 * hidden name against each line (DESIGN §9.6). Callers never change what it gives.
 */
function spellings(text: string): Spelling[] {
  if (text.length > SPELT_LENGTH) return spell(text);
  const known = SPELT.get(text);
  if (known) return known;
  const words = spell(text);
  if (SPELT.size >= KEPT) SPELT.delete(SPELT.keys().next().value ?? "");
  SPELT.set(text, words);
  return words;
}

function spell(text: string): Spelling[] {
  return (text.normalize("NFC").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).map((written) => ({ written, plain: unaccented(written).replace(/[øæœßđłıðþ]/g, (c) => PLAIN_LETTERS[c] ?? c) }));
}

/** How long a text may be to be spelt once and kept; how many spellings and patterns are kept. */
const SPELT_LENGTH = 160;
const KEPT = 8192;
const SPELT = new Map<string, Spelling[]>();
const PATTERNS = new Map<string, RegExp>();

/** A name check's pattern, compiled once while among the latest used (only `test`, so none holds state). */
function patternOf(source: string): RegExp {
  const known = PATTERNS.get(source);
  if (known) return known;
  const re = new RegExp(source, "u");
  if (PATTERNS.size >= KEPT) PATTERNS.delete(PATTERNS.keys().next().value ?? "");
  PATTERNS.set(source, re);
  return re;
}

/** Words too common to name anything on their own: "The Vault of Sorrows" is said by "vault" and "sorrows". */
const FUNCTION_WORDS: Record<string, true> = { a: true, an: true, the: true, of: true, and: true, in: true, on: true, at: true, to: true, by: true, for: true, or: true, with: true, from: true };

const WORD_CHAR = "[\\p{L}\\p{M}\\p{N}]";

/** The words a person is named by (`namesAny`): their name's words but those that name nothing alone ("the", "of"), and no lone letter or digit. */
export function personWords(name: string): Spelling[] {
  return spellings(name).filter((w) => !hasOwn(FUNCTION_WORDS, w.plain) && !/^[a-z0-9]$/.test(w.plain));
}

/**
 * The pattern one word of a name is said by, as `saysInOrder` reads it: a word of ASCII letters and
 * digits only whole, so "dangerous" doesn't say "dan", or with an English plural ending ("the
 * Okafors", "two lanterns", "the Joneses", "the pantries"); one with any other letter anywhere,
 * since a script written without spaces (李雷在监视你) or an inflected form (Вексом for Векс) has
 * no word end to find. Words are runs of letters, marks and digits, so none needs escaping.
 */
export function wordPattern(w: string): string {
  if (!/^[a-z0-9]+$/.test(w)) return w;
  const plural = /[^aeiou]y$/.test(w) ? `(?:${w}(?:e?s)?|${w.slice(0, -1)}ies)` : `${w}(?:e?s)?`;
  return `(?<!${WORD_CHAR})${plural}(?!${WORD_CHAR})`;
}

/** Whether `words` come in `said` (a text's words joined by spaces) in order, each said as `wordPattern` reads it, each later in the same word as the one before or in the next. */
function saysInOrder(said: string, words: readonly string[]): boolean {
  return patternOf(words.map(wordPattern).join(`${WORD_CHAR}*(?: ${WORD_CHAR}*)?`)).test(said);
}

/** What a text says, read for name checks: its words as written and plain, with and without words like "the". */
function sayings(text: string): { says(words: readonly Spelling[], all: boolean): boolean; capital(letter: string): boolean } {
  const words = spellings(text);
  const joined = (key: keyof Spelling, all: boolean): string =>
    words
      .filter((w) => all || !hasOwn(FUNCTION_WORDS, w.plain))
      .map((w) => w[key])
      .join(" ");
  const texts = { written: joined("written", false), plain: joined("plain", false), writtenAll: joined("written", true), plainAll: joined("plain", true) };
  const cased = unaccented(text);
  return {
    // Plain, "Zoe" says Zoë; as written, an inflected "Łukaszem" still says Łukasz.
    says: (parts, all) => saysInOrder(all ? texts.plainAll : texts.plain, parts.map((p) => p.plain)) || saysInOrder(all ? texts.writtenAll : texts.written, parts.map((p) => p.written)),
    capital: (letter) => patternOf(`(?<!${WORD_CHAR})${letter}(?!${WORD_CHAR})`).test(cased),
  };
}

/**
 * Whether a model's free text (a judge's reason, a lore trace's search) names any of `people` or
 * says any of `labels`, ignoring case, the accents people leave out (Zoe for Zoë) and the words that
 * name nothing on their own ("the", "of"), each word read as `saysInOrder` reads it. A person counts
 * by any word of their name ("Vex is watching" names Vex Morrow): one of ASCII letters from two
 * letters, one in another script however short (李雷). A name of single letters (Q, M) counts as that
 * capital standing alone, except A and I, which are words. Anything else (a place, a thing, a
 * track's label, a lore title) counts only by all its words in order, so "under the chapel" says
 * Under the Chapel and "under" alone doesn't. A word or label `heard` says too doesn't count: whoever
 * reads the text has seen it said.
 */
export function namesAny(text: string, people: readonly string[], labels: readonly string[] = [], heard = ""): boolean {
  const said = sayings(text);
  const known = sayings(heard);
  for (const name of people) {
    const words = spellings(name).filter((w) => !hasOwn(FUNCTION_WORDS, w.plain));
    const counted = personWords(name);
    for (const w of counted) if (said.says([w], false) && !known.says([w], false)) return true;
    if (counted.length > 0) continue;
    for (const w of words) {
      const letter = w.plain.toUpperCase();
      if (/^[B-HJ-Z]$/.test(letter) && said.capital(letter) && !known.capital(letter)) return true;
    }
  }
  for (const label of labels) {
    const all = spellings(label);
    const named = all.filter((w) => !hasOwn(FUNCTION_WORDS, w.plain));
    // A label of nothing but such words ("On and On") counts only as it is.
    const whole = named.length === 0;
    const parts = whole ? all : named;
    if (parts.length > 0 && said.says(parts, whole) && !known.says(parts, whole)) return true;
  }
  return false;
}
