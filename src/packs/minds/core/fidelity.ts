// The fidelity ladder (DESIGN §24.1): Live, Near, Far, Background, from a focus score that is a pure
// function of the state and this turn's texts, with the world's weights and thresholds. The GM's pin
// decides first, then the author's `never`, then `always`, then the score.
//
// Which minds run (`pickMinds`) follows from the scene, the ladder and the user's cadence: everyone in
// the POV's scene every turn up to the Live limit, best score first; the others on their level's
// refresh triggers (a Live one every turn), called only while they're in something that could
// surface soon (`involved`).

import type { EntityId, PlaceId } from "../../../shared/ids";
import type { JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import type { Fidelity, FidelityScore, FidelityTexts, MindsSettings, RefreshReason, WorldMindsConfig } from "../../../shared/minds";
import { limitOf, worldMindsOf } from "../../../shared/minds";
import { tierBand } from "../../../shared/tiers";
import type { WorldDoc } from "../../../shared/world";
import { identifiers } from "../../../engine/expr";
import { acts } from "../../../engine/life";
import { objOf, optionalQuery, own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { inPovScene } from "../../../engine/presence";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { selectorMatches, classValues, valueWithin } from "../../../engine/selector";
import { lastSighting } from "../../../engine/seen";
import type { WorldState } from "../../../engine/state";
import { currentStage, isTerminal } from "../../../engine/tracks";
import { knows } from "../../../engine/visibility";
import { lastDue, openCommitments, openPlans, readCharacter, readSlice } from "./state";

/** Who can have a mind: every person still in the world and acting, but the POV. */
export function mindCandidates(ctx: Pick<ReadContext, "registry" | "world" | "state">): EntityId[] {
  const { registry: reg, world, state } = ctx;
  return Object.keys(state.entities)
    .sort()
    .filter((id) => id !== world.pov && kindIs(reg, world, own(state.entities, id)?.kind ?? "", "person") && !isGone(state, id) && acts(world, state, id));
}

/** Honorifics and particles a name holds that never single anyone out on their own. */
const NAME_FILLER: Readonly<Record<string, true>> = { mr: true, mrs: true, ms: true, miss: true, dr: true, sir: true, lady: true, lord: true, dame: true, the: true, of: true, de: true, van: true, von: true, la: true, le: true, old: true, young: true, captain: true, constable: true, father: true, mother: true, sister: true, brother: true, aunt: true, uncle: true };

function words(text: string): string[] {
  return text.toLowerCase().replace(/['’]s\b/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Whether a word of a name singles someone out on its own: three letters or more, and no honorific or particle. */
export function singlesOut(word: string): boolean {
  return word.length >= 3 && !NAME_FILLER[word];
}

/** Whether the texts name someone: their whole name, or a word of it that singles them out (`singlesOut`). */
export function namedIn(name: string, said: readonly string[]): boolean {
  const own = words(name);
  if (own.length === 0 || said.length === 0) return false;
  const whole = own.join(" ");
  const joined = ` ${said.join(" ")} `;
  if (joined.includes(` ${whole} `)) return true;
  const present = new Set(said);
  return own.some((w) => singlesOut(w) && present.has(w));
}

/** Whether a text names someone, as `namedIn` reads a turn's words: the reply's read checks whom a change it reads is about. */
export function namedInText(name: string, text: string): boolean {
  return namedIn(name, words(text));
}

/** The entity ids a value's strings name: an id as a whole string, or an identifier in a formula. */
function namesIn(value: JsonValue | undefined, ids: ReadonlySet<string>, out: Set<string>): void {
  if (typeof value === "string") {
    if (ids.has(value)) out.add(value);
    let found: string[] = [];
    try {
      found = identifiers(value);
    } catch {
      // Prose, not a formula: only a whole-string id counts.
    }
    for (const id of found) if (ids.has(id)) out.add(id);
  } else if (Array.isArray(value)) for (const v of value) namesIn(v, ids, out);
  else if (isRecord(value)) for (const v of Object.values(value)) namesIn(v as JsonValue, ids, out);
}

interface WorldRefs {
  /** Track id → the entity ids its stages (objectives, ways on, effects) name. */
  tracks: Map<string, Set<string>>;
  /** Entity ids any world rule names. */
  rules: Set<string>;
}

const refsCache = new WeakMap<WorldDoc, WorldRefs>();

/** What the world's tracks and rules name, read once per world revision. */
function worldRefs(world: WorldDoc): WorldRefs {
  const hit = refsCache.get(world);
  if (hit) return hit;
  const ids = new Set(Object.keys(world.entities));
  const tracks = new Map<string, Set<string>>();
  for (const [id, t] of Object.entries(world.tracks)) {
    const out = new Set<string>();
    namesIn(t.stages as unknown as JsonValue, ids, out);
    if (t.knownBy?.ids) for (const x of t.knownBy.ids) if (ids.has(x)) out.add(x);
    tracks.set(id, out);
  }
  const rules = new Set<string>();
  for (const r of Object.values(world.rules)) namesIn(r as unknown as JsonValue, ids, rules);
  const refs = { tracks, rules };
  refsCache.set(world, refs);
  return refs;
}

/** The tracks still under way: started, and not at a stage with no way out. */
function liveTracks(world: WorldDoc, state: Readonly<WorldState>): string[] {
  return Object.keys(world.tracks)
    .sort()
    .filter((id) => {
      const t = own(world.tracks, id);
      const stage = currentStage(world, state, id);
      return t !== undefined && stage !== null && !isTerminal(t, stage);
    });
}

/** Whether `a` and `b` are close: one place holds the other, or they share a parent. */
function closeBy(world: WorldDoc, a: PlaceId | null, b: PlaceId | null): boolean {
  if (a === null || b === null || a === b) return false;
  const parent = (p: PlaceId): PlaceId | null => own(world.places, p)?.parent ?? null;
  return parent(a) === b || parent(b) === a || (parent(a) !== null && parent(a) === parent(b));
}

/** Points, worded for the GM, with a reason only when it adds any. */
function reason(out: { label: string; points: number }[], label: string, points: number): number {
  if (points !== 0) out.push({ label, points: Math.round(points * 10) / 10 });
  return points;
}

/** The appointments `who` has with `other` from now until `until` (an entity's dated `appointments`, each with whom). */
function appointmentsWith(state: Readonly<WorldState>, who: EntityId, other: EntityId, until: number): number {
  const list = own(state.entities, who)?.fields.appointments;
  return (Array.isArray(list) ? list : []).filter((raw) => {
    const a = objOf(raw);
    const withList = Array.isArray(a.with) ? a.with : [];
    return typeof a.at === "number" && a.at >= state.clock && a.at <= until && withList.includes(other);
  }).length;
}

/** The pending interactions between a character and the POV: an invitation, an appointment together, an open plan or commitment with them. */
function pendingWith(ctx: ReadContext, id: EntityId): number {
  const { world, state } = ctx;
  const pov = world.pov;
  let n = 0;
  const invited = ctx.registry.formulas.get("invited");
  if (invited && invited(ctx, id) === true) n++;
  const now = state.clock;
  n += appointmentsWith(state, id, pov, Number.POSITIVE_INFINITY) + appointmentsWith(state, pov, id, Number.POSITIVE_INFINITY);
  const c = readCharacter(state, id);
  n += openPlans(c).filter((p) => p.with.includes(pov) && p.when.to >= now).length;
  n += openCommitments(c).filter((x) => x.with.includes(pov)).length;
  return n;
}

/** How far ahead a plan or appointment with the POV could surface soon: the coming day of world time. */
const SOON_MINUTES = 1440;

/**
 * Whether someone off the POV's scene is in something that could surface soon (DESIGN §24.1): a plan
 * or appointment with the POV within the coming day, an invitation to it still open, an agenda of
 * their own under way, the GM's intent for them, a place or activity the story holds them to, or a
 * mind that interrupted the skip the clock stopped on. Idling, living their routine or being named
 * is none of these.
 */
export function involved(ctx: ReadContext, id: EntityId): boolean {
  const { world, state } = ctx;
  const pov = world.pov;
  const now = state.clock;
  const soon = now + SOON_MINUTES;
  const c = readCharacter(state, id);
  if (openPlans(c).some((p) => p.with.includes(pov) && p.when.to >= now && p.when.from <= soon)) return true;
  if (appointmentsWith(state, id, pov, soon) + appointmentsWith(state, pov, id, soon) > 0) return true;
  if (ctx.registry.formulas.get("invited")?.(ctx, id) === true) return true;
  if (liveTracks(world, state).some((t) => own(world.tracks, t)?.kind === "agenda" && own(world.tracks, t)?.owner === id)) return true;
  if (c.intent !== undefined) return true;
  if (Object.values(objOf(own(state.entities, id)?.fields.holds)).some((until) => typeof until === "number" && until > now)) return true;
  return c.mind !== null && c.mind.interrupt !== null && c.mind.at === now;
}

/**
 * Every character's place on the ladder now (DESIGN §24.1), best score first (ties by id). `texts`
 * are this turn's: the player's latest message and the reply before it; empty inside `advance` and
 * at a beat, where nobody is mentioned.
 */
export function fidelityOf(ctx: ReadContext, texts: FidelityTexts, config: WorldMindsConfig = worldMindsOf(ctx.world)): FidelityScore[] {
  const { registry: reg, world, state } = ctx;
  const pov = world.pov;
  const w = config.weights;
  const here = placeOfEntity(state, pov);
  const said = words(`${texts.user}\n${texts.reply}`);
  const refs = worldRefs(world);
  const tracks = liveTracks(world, state);
  const regard = optionalQuery(ctx, "regard");
  const out: FidelityScore[] = [];
  for (const id of mindCandidates(ctx)) {
    const e = own(state.entities, id);
    if (!e) continue;
    const reasons: { label: string; points: number }[] = [];
    let score = 0;
    const place = placeOfEntity(state, id);
    if (here !== null && place === here) score += reason(reasons, "In the scene", w.here);
    else if (closeBy(world, place, here)) score += reason(reasons, "Close by", w.nearby);
    if (namedIn(e.name, said)) score += reason(reasons, "Named this turn", w.mentioned);
    if (regard) {
      const strongest = Math.max(Math.abs(regard(ctx, id, pov)), Math.abs(regard(ctx, pov, id)));
      score += reason(reasons, "Regard with you", w.regard * Math.min(1, strongest / 100));
    }
    if (knows(state, id, pov) || knows(state, pov, id)) score += reason(reasons, "Knows you", w.knows);
    const owned = tracks.filter((t) => own(world.tracks, t)?.owner === id);
    if (owned.length > 0) score += reason(reasons, "Owns a story track", w.owner);
    const named = tracks.filter((t) => own(world.tracks, t)?.owner !== id && refs.tracks.get(t)?.has(id)).length;
    if (named > 0) score += reason(reasons, `In ${Math.min(3, named)} story track${named === 1 ? "" : "s"}`, w.track * Math.min(3, named));
    let roles = 0;
    for (const [value, points] of Object.entries(w.roles)) {
      const held = Object.keys(world.classifications).some((facet) => classValues(world, state, id, facet).some((v) => v === value || valueWithin(world, facet, v, value)));
      if (held) roles += points;
    }
    score += reason(reasons, "Story role", roles);
    if (refs.rules.has(id)) score += reason(reasons, "Named by a world rule", w.rule);
    const pending = Math.min(3, pendingWith(ctx, id));
    if (pending > 0) score += reason(reasons, `${pending} pending with you`, w.pending * pending);
    const band = tierBand(world, e.tier);
    if (band) score += reason(reasons, band === "principal" ? "Lead" : band === "supporting" ? "Supporting" : "Background tier", w.band[band]);
    const last = Math.max(readCharacter(state, id).lastPresent ?? Number.NEGATIVE_INFINITY, lastSighting(state, id)?.at ?? Number.NEGATIVE_INFINITY);
    if (Number.isFinite(last)) score += reason(reasons, "Seen with you lately", w.recent * Math.max(0, 1 - (state.clock - last) / 1440));
    const gm = readCharacter(state, id).pin;
    const never = config.never !== null && selectorMatches(reg, world, state, config.never, id);
    const always = config.always !== null && selectorMatches(reg, world, state, config.always, id);
    const author: Fidelity | null = never ? "background" : always ? "live" : null;
    const t = config.thresholds;
    // Live is for people at hand: in the POV's scene or named this turn. "Close by" only means under the
    // same parent place, which in a town world is the whole town, so it can't qualify anyone; someone
    // elsewhere waits at Near however much story they carry, and a Live slot never goes to a sleeper
    // across town while someone in the room has none.
    const atHand = (here !== null && place === here) || namedIn(e.name, said);
    const scored: Fidelity = score >= t.live ? (atHand ? "live" : "near") : score >= t.near ? "near" : score >= t.far ? "far" : "background";
    if (score >= t.live && !atHand) reasons.push({ label: "Not at hand, so Near at most", points: 0 });
    const level = gm ?? author ?? scored;
    if (gm) reasons.push({ label: `Pinned at ${gm} by the GM`, points: 0 });
    else if (author) reasons.push({ label: never ? "The author: never a mind" : "The author: always Live", points: 0 });
    out.push({ entity: id, level, score: Math.round(score * 10) / 10, reasons, pin: { gm, author } });
  }
  const rank: Record<Fidelity, number> = { live: 0, near: 1, far: 2, background: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || b.score - a.score || (a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : 0));
}

/**
 * A mind due this turn: who, at what level, why now, and whether it is called. One not called (off
 * the POV's scene and not `involved`) makes no model call; only its level is recorded, on the round.
 */
export interface MindPick {
  entity: EntityId;
  level: Fidelity;
  reason: RefreshReason;
  call: boolean;
}

const LEVEL_RANK: Record<Fidelity, number> = { live: 0, near: 1, far: 2, background: 3 };

/**
 * Which minds are due this turn, and which of them are called (DESIGN §24.1). Minds follow the scene
 * and what's in motion: everyone in the POV's scene (`inPovScene`), and a Live character elsewhere
 * while `involved`, thinks every turn, best on the ladder first, up to the Live limit (a GM's
 * refresh request runs whatever the level or the place). Everyone else comes due on their level's
 * cadence: Near characters, and those past the limit, on Near's triggers; Far characters on their
 * first mind, a rise on the ladder or their period. A due mind is called only in the scene or while
 * `involved`, at most `refreshLimit` of them besides the Live ones, the most pressing first. Any
 * other still comes due, uncalled, so the level it was due at is recorded and the tier routine roles
 * read (`minds.tier`) moves as it always did.
 */
export function pickMinds(ctx: ReadContext, scores: readonly FidelityScore[], texts: FidelityTexts, settings: Pick<MindsSettings, "liveLimit" | "nearRefresh" | "farRefreshMinutes" | "refreshLimit">): MindPick[] {
  const { world, state } = ctx;
  const slice = readSlice(state);
  const here = placeOfEntity(state, world.pov);
  const said = words(`${texts.user}\n${texts.reply}`);
  const live: MindPick[] = [];
  const refreshes: (MindPick & { order: number; score: number })[] = [];
  let liveLeft = limitOf(settings.liveLimit);
  const ORDER: Record<RefreshReason, number> = { gm: 0, live: 1, promoted: 2, scene: 3, mention: 4, first: 5, turns: 6, minutes: 7, period: 8 };
  for (const s of scores) {
    const c = readCharacter(state, s.entity);
    const mind = lastDue(c);
    if (c.refresh) {
      refreshes.push({ entity: s.entity, level: s.level, reason: "gm", call: true, order: ORDER.gm, score: s.score });
      continue;
    }
    if (s.level === "background") continue;
    const scene = inPovScene(world, state, s.entity);
    if ((scene || (s.level === "live" && involved(ctx, s.entity))) && liveLeft > 0) {
      liveLeft--;
      live.push({ entity: s.entity, level: s.level, reason: "live", call: true });
      continue;
    }
    const why = ((): RefreshReason | null => {
      if (!mind) return "first";
      if (LEVEL_RANK[s.level] < LEVEL_RANK[mind.level]) return "promoted";
      if (s.level === "far") return state.clock - mind.at >= limitOf(settings.farRefreshMinutes) ? "period" : null;
      const near = settings.nearRefresh;
      const place = placeOfEntity(state, s.entity);
      if (near.scene && here !== null && place === here && mind.place !== here) return "scene";
      if (near.mention && namedIn(own(state.entities, s.entity)?.name ?? "", said)) return "mention";
      if (slice.round - mind.round >= limitOf(near.turns)) return "turns";
      if (state.clock - mind.at >= limitOf(near.minutes)) return "minutes";
      return null;
    })();
    if (why) refreshes.push({ entity: s.entity, level: s.level, reason: why, call: scene || involved(ctx, s.entity), order: ORDER[why], score: s.score });
  }
  // A GM's request always runs; the other calls share the limit, the most pressing first. A mind
  // that isn't called costs nothing, so every one of those is due.
  const sorted = refreshes.sort((a, b) => a.order - b.order || b.score - a.score || (a.entity < b.entity ? -1 : 1));
  const called = sorted.filter((r) => r.call);
  const chosen = [...called.filter((r) => r.reason === "gm"), ...called.filter((r) => r.reason !== "gm").slice(0, limitOf(settings.refreshLimit)), ...sorted.filter((r) => !r.call)];
  return [...live, ...chosen.map(({ entity, level, reason: r, call }) => ({ entity, level, reason: r, call }))];
}
