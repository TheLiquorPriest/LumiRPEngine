// The built-in `engine` pack: bookkeeping events the runtime records (rule firings, interrupt
// signals, agent catch-up cursors, the clock set back by a ✎ fix and how far it had run, recorded
// choices, puzzle attempts, reveals, the hints the player opened, the paused scene, checks rolled by the `check` effect), GM
// edits of an entity's tier, agent flag and levels and of its classes and tags, the chat's workspace
// files and pins (`engine/workspace`: `engine.ws.write`, `engine.ws.delete`, `engine.ws.pin`), life states
// (`engine/life`: the events, the `life` effect, the `life` channel and `life_of`), the engine's
// narration channels (`knows`, `spawn`) and the taxonomy formulas (`kind_is`, `in_class`,
// `has_tag`, `member_of`, `tier_of`, `band_of`). Every registry is built with it first:
// `createRegistry([enginePack, ...packs])`. Its state lives in `state.packs.engine`.

import { facetsInOrder } from "../shared/classes";
import { isLifeState, lifeStateOf, type FacetDef } from "../shared/world";
import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord, safeKey } from "../shared/json";
import type { EntityId, InterruptClass, Level, Visibility } from "../shared/ids";
import { DOMAIN_LABEL, DOMAINS, INTERRUPT_CLASSES, LEVEL_LABEL } from "../shared/ids";
import { isBand, tierBand, tierLabel, tierOf } from "../shared/tiers";
import { fieldNoun, listWords, possessive } from "../shared/words";
import type { PackEvent } from "../shared/ledger";
import type { EventTypeDef, PackDef, ReadContext, Rejection } from "./registry";
import type { Value } from "./expr";
import { acts, applyLife, lifeChannel, lifeEffect, lifeKnownTo, lifeOf, tellLife } from "./life";
import { calendarOf, formatClock, placeOffset, slotIndexAt } from "./calendar";
import { knowsChannel, spawnChannel } from "./narration-channels";
import { kindIs, placeOfEntity } from "./scope";
import { restoreObservations } from "./seen";
import { classOf, classProblems, inClass, isMemberOf, tagsOf } from "./selector";
import type { EntityState, WorldState } from "./state";
import { own } from "./pack-kit";
import { minutesBetween } from "./world-state";
import { feedEvent } from "./feed";
import { wsDeleteEvent, wsPinEvent, wsReadersEvent, wsWriteEvent } from "./workspace";
import { outLinesEvent, outSceneEvent } from "./outputs";

const LEVELS: readonly Level[] = [0, 1, 2, 3, 4];

export const ENGINE_PACK = "engine";

/** Event types the runtime emits. */
export const ENGINE_EVENTS = {
  fired: "engine.fired",
  signal: "engine.signal",
  note: "engine.note",
  beat: "engine.beat",
  caught: "engine.caught",
  cursor: "engine.cursor",
  choice: "engine.choice",
  attempt: "engine.attempt",
  revealed: "engine.revealed",
  /** A hint the player opened at a track's stage (DESIGN §10): the narrator is told the hints opened, never the rest. */
  hint: "engine.hint",
  pause: "engine.pause",
  /** A check the `check` effect rolled, with its final values (the outcome's effects follow it). */
  check: "engine.check",
  /** A GM edit of an entity's simulation detail: its tier, agent flag and per-entity level overrides. */
  entity: "engine.entity",
  /** A GM edit of an entity's classes and tags, held in state from then on over the world's definition. */
  classes: "engine.class",
  /** What a coarsened record's fold would get wrong of the POV's observations (`engine/seen`), at its end. */
  observed: "engine.observed",
  /** How the adjudication policy decided an action's check (DESIGN §11): rolled or not and why, the judge's rating, and the attempt a retry rule reads. */
  adjudged: "engine.adjudged",
  /** An entity's life state set (DESIGN §8, `engine/life`): everyone with it learns it as it changes. */
  life: "engine.life",
  /** People told an entity's life state as it is. */
  told: "engine.told",
  /**
   * The clock set back by a ✎ fix of the time (DESIGN §9.2, §12), `minutes` before where it stood.
   * How far it had run stays recorded (`reached`), so nothing up to there runs again (L48).
   */
  rewind: "engine.rewind",
} as const;

/** An action's latest attempt at a check, as a retry rule reads it (DESIGN §11). */
export interface TryRecord {
  /** The clock when it was made. */
  at: number;
  /** Where the actor was. */
  place: string | null;
  outcome: string;
  failed: boolean;
  /** The check as it was rolled (dice, modifier, DC): a different one is a change. */
  odds: string;
  /** The fight and its round, when one was under way: a later round is a change. */
  round?: string;
}

export interface EngineSlice {
  fired: Record<string, { n: number; last: number }>;
  attempts: Record<string, number>;
  /** Wrong answers to a puzzle by track and stage (`engine.attempt`): a stage's hints come one per wrong answer given there (DESIGN §10). */
  missed: Record<string, Record<string, number>>;
  /** Puzzle tracks answered correctly, with the stage the answer was for. */
  solved: Record<string, string>;
  revealed: Record<string, string[]>;
  /** How many of a stage's hints the player has opened, by track and stage (`engine.hint`). */
  hints: Record<string, Record<string, number>>;
  /** Last slot index each LOD1 agent has been stepped through. */
  agents: Record<string, number>;
  /** Round-robin position of the off-screen catch-up queue. */
  rr: number;
  /** The scene key the clock was paused in, or null (DESIGN §9.2: paused for the current scene). */
  pauseScene: string | null;
  /** Each action's latest attempt at a check, keyed by actor, action and parameters (`engine.adjudged`). */
  tries: Record<string, TryRecord>;
  /**
   * How far the clock had run when a ✎ fix last set it back (DESIGN §9.2, L48); null when none did.
   * Everything time-driven up to it already happened, so until the clock passes it again, the clock
   * is all that moves (`ranTo`).
   */
  reached: number | null;
}

export function readEngineSlice(state: Readonly<WorldState>): EngineSlice {
  const s = state.packs[ENGINE_PACK] ?? {};
  const rec = (v: JsonValue | undefined): JsonObject => (isRecord(v) ? (v as JsonObject) : {});
  const fired: EngineSlice["fired"] = {};
  for (const [k, v] of Object.entries(rec(s.fired))) if (isRecord(v) && typeof v.n === "number" && typeof v.last === "number") fired[k] = { n: v.n, last: v.last };
  const attempts: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(s.attempts))) if (typeof v === "number") attempts[k] = v;
  const solved: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec(s.solved))) if (typeof v === "string") solved[k] = v;
  const revealed: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(rec(s.revealed))) if (Array.isArray(v)) revealed[k] = v.filter((x): x is string => typeof x === "string");
  // A count by track and by stage: a row that isn't a record, or a count that isn't a number, counts none.
  const byStage = (v: JsonValue | undefined): Record<string, Record<string, number>> => {
    const out: Record<string, Record<string, number>> = {};
    for (const [track, row] of Object.entries(rec(v))) {
      const counts: Record<string, number> = {};
      for (const [stage, n] of Object.entries(rec(row))) if (typeof n === "number") counts[stage] = n;
      out[track] = counts;
    }
    return out;
  };
  const agents: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(s.agents))) if (typeof v === "number") agents[k] = v;
  const tries: Record<string, TryRecord> = {};
  for (const [k, v] of Object.entries(rec(s.tries))) {
    if (isRecord(v) && typeof v.at === "number" && (typeof v.place === "string" || v.place === null) && typeof v.outcome === "string" && typeof v.failed === "boolean" && typeof v.odds === "string") tries[k] = { at: v.at, place: v.place, outcome: v.outcome, failed: v.failed, odds: v.odds, ...(typeof v.round === "string" ? { round: v.round } : {}) };
  }
  return {
    fired,
    attempts,
    missed: byStage(s.missed),
    solved,
    revealed,
    hints: byStage(s.hints),
    agents,
    rr: typeof s.rr === "number" ? s.rr : 0,
    pauseScene: typeof s.pauseScene === "string" ? s.pauseScene : null,
    reached: typeof s.reached === "number" ? s.reached : null,
    tries,
  };
}

function slice(state: WorldState): JsonObject {
  const s = state.packs[ENGINE_PACK] ?? {};
  state.packs[ENGINE_PACK] = s;
  return s;
}

/** Lifts the clock pause's scene pin, so a pause set again holds in the scene it is set in: the next plan pins it there (DESIGN §9.2). */
export function unpinPause(state: WorldState): void {
  const s = state.packs[ENGINE_PACK];
  if (s && typeof s.pauseScene === "string") s.pauseScene = null;
}

function sub(state: WorldState, key: string): JsonObject {
  const s = slice(state);
  const v = s[key];
  if (isRecord(v)) return v as JsonObject;
  const fresh: JsonObject = {};
  s[key] = fresh;
  return fresh;
}

/** Sets a track's stage in a by-stage count of the slice (`missed`, `hints`) to what `next` makes of its count there. */
function countStage(state: WorldState, key: string, track: string, stage: string, next: (n: number) => number): void {
  if (!safeKey(track) || !safeKey(stage)) return;
  const all = sub(state, key);
  const row = isRecord(all[track]) ? (all[track] as JsonObject) : {};
  const n = row[stage];
  all[track] = { ...row, [stage]: next(typeof n === "number" ? n : 0) };
}

function str(e: PackEvent, key: string): string {
  const v = e.data[key];
  return typeof v === "string" ? v : "";
}

/** Tags as an event holds them: a list of non-blank words; null when it isn't one. */
function tagList(v: JsonValue | undefined): string[] | null {
  if (!Array.isArray(v)) return null;
  const tags = v.filter((t): t is string => typeof t === "string" && t.trim() !== "");
  return tags.length === v.length ? tags : null;
}

function need(e: PackEvent, ...keys: string[]): Rejection | null {
  for (const k of keys) if (typeof e.data[k] !== "string" || e.data[k] === "") return { code: "bad_event", reason: `${e.type} needs ${k}` };
  return null;
}

/** Signal data as the runtime reads it. */
export interface Signal {
  class: InterruptClass;
  text: string;
  entity?: string;
  visibility: Visibility;
  /** False: it only notes, whatever its class's policy (a Live or Near character's routine never stops a time skip for them, DESIGN §8). */
  stops?: false;
}

export function signalOf(e: { type: string; data?: JsonObject }): Signal | null {
  if (e.type !== ENGINE_EVENTS.signal || !e.data) return null;
  const cls = e.data.class;
  if (typeof cls !== "string" || !(INTERRUPT_CLASSES as readonly string[]).includes(cls)) return null;
  const vis = e.data.visibility;
  return {
    class: cls as InterruptClass,
    text: typeof e.data.text === "string" ? e.data.text : "",
    ...(typeof e.data.entity === "string" ? { entity: e.data.entity } : {}),
    // A value this reader doesn't know hides the signal (fail closed); unset is public.
    visibility: vis === undefined || vis === null || vis === "public" ? "public" : vis === "known_by" ? "known_by" : "secret",
    ...(e.data.stops === false ? { stops: false as const } : {}),
  };
}

const noop = (): void => undefined;

const events: EventTypeDef<PackEvent>[] = [
  {
    type: ENGINE_EVENTS.fired,
    validate: (e) => need(e, "rule"),
    apply: (e, state) => {
      const fired = sub(state, "fired");
      const prev = fired[str(e, "rule")];
      const n = isRecord(prev) && typeof prev.n === "number" ? prev.n : 0;
      fired[str(e, "rule")] = { n: n + 1, last: state.clock };
    },
    describe: (e) => `rule ${str(e, "rule")}`,
  },
  {
    type: ENGINE_EVENTS.signal,
    validate: (e) => (signalOf(e) ? null : { code: "bad_event", reason: "signal needs a known class" }),
    apply: noop,
    describe: (e) => str(e, "text"),
  },
  { type: ENGINE_EVENTS.note, validate: () => null, apply: noop, describe: (e) => str(e, "text") },
  { type: ENGINE_EVENTS.beat, validate: () => null, apply: noop, describe: (e) => str(e, "hint") },
  {
    type: ENGINE_EVENTS.caught,
    validate: (e, ctx) => {
      const missing = need(e, "agent");
      if (missing) return missing;
      return typeof e.data.slot === "number" && own(ctx.state.entities, str(e, "agent")) ? null : { code: "bad_event", reason: "caught needs an agent and a slot" };
    },
    apply: (e, state) => {
      const slot = e.data.slot;
      if (typeof slot === "number") sub(state, "agents")[str(e, "agent")] = slot;
    },
    describe: (e) => `${str(e, "agent")} caught up`,
  },
  {
    type: ENGINE_EVENTS.cursor,
    validate: (e) => (typeof e.data.rr === "number" ? null : { code: "bad_event", reason: "cursor needs rr" }),
    apply: (e, state) => {
      if (typeof e.data.rr === "number") slice(state).rr = e.data.rr;
    },
    describe: () => "catch-up queue",
  },
  { type: ENGINE_EVENTS.choice, validate: (e) => need(e, "key", "choice"), apply: noop, describe: (e) => `${str(e, "key")}: ${str(e, "choice")}` },
  {
    type: ENGINE_EVENTS.attempt,
    validate: (e, ctx) => (own(ctx.world.tracks, str(e, "track")) ? null : { code: "missing_track", reason: `no track ${str(e, "track")}` }),
    apply: (e, state) => {
      const track = str(e, "track");
      if (e.data.correct === true) sub(state, "solved")[track] = str(e, "stage");
      else {
        const attempts = sub(state, "attempts");
        const n = own(attempts, track);
        attempts[track] = (typeof n === "number" ? n : 0) + 1;
        // The stage's own count: a later stage's hints don't come from the wrong answers given before it.
        countStage(state, "missed", track, str(e, "stage"), (count) => count + 1);
      }
    },
    describe: (e) => `attempt on ${str(e, "track")}`,
  },
  {
    // `n`: how many of the stage's hints are open with this one, as the player saw them when they asked
    // (DESIGN §10). Each opens one more, and only while fewer than `n` are open: a second tap on the
    // same "Show a hint", sent before the first one showed (both held through a reply), opens nothing
    // more, an Undo of either of two hints opened closes one, and a rebased view that lost an earlier
    // one never jumps to `n`. One recorded without it opens one more, as it always has.
    type: ENGINE_EVENTS.hint,
    validate: (e, ctx) => {
      const missing = need(e, "track", "stage");
      if (missing) return missing;
      const n = e.data.n;
      if (n !== undefined && !(typeof n === "number" && Number.isInteger(n) && n >= 1)) return { code: "bad_event", reason: `${e.type} needs n, a whole number from 1` };
      const t = own(ctx.world.tracks, str(e, "track"));
      return t && own(t.stages, str(e, "stage")) ? null : { code: "missing_track", reason: `no stage ${str(e, "stage")} of track ${str(e, "track")}` };
    },
    apply: (e, state) => {
      const n = e.data.n;
      countStage(state, "hints", str(e, "track"), str(e, "stage"), (open) => (typeof n === "number" ? (open < n ? open + 1 : open) : open + 1));
    },
    describe: (e) => `hint opened on ${str(e, "track")}`,
  },
  {
    type: ENGINE_EVENTS.revealed,
    validate: (e) => need(e, "track", "stage"),
    apply: (e, state) => {
      const revealed = sub(state, "revealed");
      const list = revealed[str(e, "track")];
      const stages = Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
      if (!stages.includes(str(e, "stage"))) stages.push(str(e, "stage"));
      revealed[str(e, "track")] = stages;
    },
    describe: (e) => `${str(e, "track")} revealed`,
  },
  {
    type: ENGINE_EVENTS.pause,
    validate: (e) => (typeof e.data.scene === "string" || e.data.scene === null ? null : { code: "bad_event", reason: "pause needs scene" }),
    apply: (e, state) => {
      slice(state).pauseScene = typeof e.data.scene === "string" ? e.data.scene : null;
    },
    describe: () => "clock pause",
  },
  {
    type: ENGINE_EVENTS.rewind,
    // Never before the story starts: nothing in the world was there to be set back to.
    validate: (e, ctx) => {
      const minutes = e.data.minutes;
      if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes <= 0) return { code: "bad_event", reason: "a clock set back needs whole minutes above zero" };
      const start = minutesBetween(ctx.world.calendar.epoch, ctx.world.start.at);
      if (ctx.state.clock - minutes >= start) return null;
      return { code: "before_start", reason: `the story starts at ${formatClock(calendarOf(ctx.world), start, placeOffset(ctx.world, start, placeOfEntity(ctx.state, ctx.world.pov)))}` };
    },
    // A second set-back inside the window keeps the furthest the clock had run, not where it stood.
    apply: (e, state) => {
      const minutes = e.data.minutes;
      if (typeof minutes !== "number") return;
      const s = slice(state);
      s.reached = Math.max(typeof s.reached === "number" ? s.reached : state.clock, state.clock);
      state.clock -= minutes;
    },
    describe: (e) => `clock set back ${String(e.data.minutes)} min`,
  },
  {
    type: ENGINE_EVENTS.check,
    validate: (e, ctx) => need(e, "actor", "outcome") ?? (own(ctx.state.entities, str(e, "actor")) ? null : { code: "missing_entity", reason: `no entity ${str(e, "actor")}` }),
    apply: noop,
    describe: (e) => {
      const total = typeof e.data.total === "number" ? ` (rolled ${e.data.total}${typeof e.data.dc === "number" ? ` against ${e.data.dc}` : ""})` : "";
      return `${str(e, "actor")}: ${str(e, "check").replace(/_/g, " ")}, ${str(e, "outcome").replace(/_/g, " ")}${total}`;
    },
  },
  {
    type: ENGINE_EVENTS.entity,
    validate: (e, ctx) => {
      if (!own(ctx.state.entities, str(e, "entity"))) return { code: "missing_entity", reason: `no entity ${str(e, "entity")}` };
      const { tier, agent, levels } = e.data;
      if (tier !== undefined && (typeof tier !== "string" || !(tierOf(ctx.world, tier) || isBand(tier)))) return { code: "bad_tier", reason: `no tier ${String(tier)}` };
      if (agent !== undefined && typeof agent !== "boolean") return { code: "bad_event", reason: "agent is yes or no" };
      if (levels !== undefined && !(isRecord(levels) && Object.entries(levels).every(([d, v]) => DOMAINS.some((x) => x === d) && (v === null || (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 4))))) return { code: "bad_level", reason: "a level is a whole number 0–4, or null to follow the tier" };
      return null;
    },
    apply: (e, state) => {
      const ent = own(state.entities, str(e, "entity"));
      if (!ent) return;
      if (typeof e.data.tier === "string") ent.tier = e.data.tier;
      if (typeof e.data.agent === "boolean") ent.agent = e.data.agent;
      const levels = e.data.levels;
      if (!isRecord(levels)) return;
      for (const domain of DOMAINS) {
        const v = levels[domain];
        if (v === null) delete ent.levels[domain];
        else if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 4) ent.levels[domain] = v as Level;
      }
    },
    touches: (e) => {
      const entity = str(e, "entity");
      return (["tier", "agent", "levels"] as const).filter((aspect) => e.data[aspect] !== undefined).map((aspect) => ({ entity, aspect }));
    },
    describe: (e, ctx) => {
      // One sentence for all of it: "Danny Okafor is now in the Supporting tier and has Money detail at level 2".
      const clauses: string[] = [];
      if (typeof e.data.tier === "string") clauses.push(`is now in the ${tierLabel(ctx.world, e.data.tier)} tier`);
      if (typeof e.data.agent === "boolean") clauses.push(e.data.agent ? "now lives their own life off-screen" : "no longer lives their own life off-screen");
      const levels = e.data.levels;
      if (isRecord(levels))
        for (const [d, v] of Object.entries(levels)) {
          // An area and a level as Settings → Realism names them: "Money detail at level 2 (Simple)".
          const domain = DOMAINS.find((x) => x === d);
          const area = domain ? DOMAIN_LABEL[domain] : d;
          const level = LEVELS.find((n) => n === v);
          clauses.push(v === null ? `has ${area} detail from their tier again` : `now has ${area} detail at level ${String(v)}${level !== undefined ? ` (${LEVEL_LABEL[level]})` : ""}`);
        }
      return `${own(ctx.state.entities, str(e, "entity"))?.name ?? str(e, "entity")} ${listWords(clauses)}`;
    },
  },
  {
    type: ENGINE_EVENTS.classes,
    validate: (e, ctx) => {
      const ent = own(ctx.state.entities, str(e, "entity"));
      if (!ent) return { code: "missing_entity", reason: `no entity ${str(e, "entity")}` };
      const classes = classOf(e.data.class);
      if (!classes) return { code: "bad_event", reason: "a classification is facet → values" };
      const problem = classProblems(ctx.world, classes, ent.name)[0];
      if (problem) return { code: problem.code, reason: problem.message };
      if (e.data.was !== undefined && !classOf(e.data.was)) return { code: "bad_event", reason: "the classification before is facet → values" };
      return tagList(e.data.tags) ? null : { code: "bad_event", reason: "tags are a list of words" };
    },
    apply: (e, state) => {
      const ent = own(state.entities, str(e, "entity"));
      if (!ent) return;
      // Both are held, empty ones too, so the world's definition no longer speaks for either.
      ent.class = classOf(e.data.class) ?? {};
      ent.tags = tagList(e.data.tags) ?? [];
    },
    touches: (e) => [{ entity: str(e, "entity"), aspect: "class" }],
    describe: (e, ctx, viewer) => {
      const classes = classOf(e.data.class) ?? {};
      const name = own(ctx.state.entities, str(e, "entity"))?.name ?? str(e, "entity");
      const valuesOf = (f: FacetDef, values: readonly string[]): string => (values.length > 0 ? listWords(values.map((v) => own(f.values, v)?.label ?? v)) : "none");
      // "Danny Okafor's trade is now mechanic": each facet as what it is, then its values.
      const facetLine = (f: FacetDef, values: readonly string[]): string => `${possessive(name)} ${fieldNoun(f.label, "").noun} is now ${valuesOf(f, values)}`;
      if (viewer !== undefined) {
        // A player's line says only what changed on the facets players can see, a cleared one
        // included, and never tags (DESIGN §4.1), so an edit to a hidden facet or a tag has no line.
        // Without the values before, it can't say what changed, so it says nothing.
        const was = classOf(e.data.was);
        if (!was) return "";
        const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));
        const changed = facetsInOrder(ctx.world)
          .filter(([id, f]) => f.shown === true && !same(own(classes, id) ?? [], own(was, id) ?? []))
          .map(([id, f]) => facetLine(f, own(classes, id) ?? []));
        return changed.join("; ");
      }
      const parts = facetsInOrder(ctx.world).flatMap(([id, f]) => {
        const values = own(classes, id) ?? [];
        return values.length > 0 ? [facetLine(f, values)] : [];
      });
      const tags = tagList(e.data.tags) ?? [];
      if (tags.length > 0) parts.push(`${possessive(name)} tags are now ${listWords(tags)}`);
      return parts.length > 0 ? parts.join("; ") : `${name} now has no classes and no tags`;
    },
  },
  {
    type: ENGINE_EVENTS.observed,
    validate: (e) => (Object.values(e.data).every(isRecord) ? null : { code: "bad_event", reason: "observed needs places and people" }),
    apply: (e, state) => restoreObservations(state, e.data),
    describe: () => "what you saw meanwhile",
  },
  {
    type: ENGINE_EVENTS.adjudged,
    validate: (e, ctx) => need(e, "actor", "action", "outcome") ?? (own(ctx.state.entities, str(e, "actor")) ? null : { code: "missing_entity", reason: `no entity ${str(e, "actor")}` }),
    apply: (e, state) => {
      // Only an attempt a retry rule reads carries a key; its record is the latest for that check.
      const key = e.data.key;
      if (typeof key !== "string" || !safeKey(key)) return;
      const { place, round } = e.data;
      sub(state, "tries")[key] = { at: state.clock, place: typeof place === "string" ? place : null, outcome: str(e, "outcome"), failed: e.data.failed === true, odds: str(e, "odds"), ...(typeof round === "string" ? { round } : {}) };
    },
    describe: (e) => `${str(e, "actor")}: ${str(e, "action").replace(/_/g, " ")}, ${str(e, "outcome").replace(/_/g, " ")}${e.data.rolled === true ? "" : ` (no roll: ${str(e, "why")})`}`,
  },
  {
    type: ENGINE_EVENTS.life,
    validate: (e, ctx) => {
      const ent = own(ctx.state.entities, str(e, "entity"));
      if (!ent) return { code: "missing_entity", reason: `no entity ${str(e, "entity")}` };
      if (!isLifeState(ctx.world, str(e, "to"))) return { code: "bad_life", reason: `there's no life state ${str(e, "to")}` };
      const seen = e.data.witnesses;
      if (seen !== undefined && !(Array.isArray(seen) && seen.every((id) => typeof id === "string"))) return { code: "bad_event", reason: "a life change's witnesses are entity ids" };
      return lifeOf(ctx.state, str(e, "entity")) === str(e, "to") ? { code: "no_change", reason: `${ent.name} is already ${lifeStateOf(ctx.world, str(e, "to")).label.toLowerCase()}` } : null;
    },
    apply: (e, state, ctx) => applyLife(state, ctx, str(e, "entity"), str(e, "to"), witnessesOf(e)),
    touches: (e) => [{ entity: str(e, "entity"), aspect: "life" }],
    describe: (e, ctx, viewer) => {
      const id = str(e, "entity");
      const def = lifeStateOf(ctx.world, str(e, "to"));
      const name = own(ctx.state.entities, id)?.name ?? id;
      const state = def.label.toLowerCase();
      if (viewer === undefined) return `${name} is now ${state}`;
      if (id === viewer) return `You are now ${state}`;
      // A player's line only for one who saw it change: one learned of later is the telling's news
      // (`engine.told`), so the turn it happened on never dates it.
      return witnessesOf(e)?.includes(viewer) === true ? `${name} ${def.reads}` : "";
    },
  },
  {
    type: ENGINE_EVENTS.told,
    validate: (e, ctx) => {
      if (!own(ctx.state.entities, str(e, "entity"))) return { code: "missing_entity", reason: `no entity ${str(e, "entity")}` };
      const who = e.data.who;
      return Array.isArray(who) && who.length > 0 && who.every((id) => typeof id === "string" && own(ctx.state.entities, id)) ? null : { code: "bad_event", reason: "told needs the people told" };
    },
    apply: (e, state) => tellLife(state, str(e, "entity"), Array.isArray(e.data.who) ? e.data.who.filter((id): id is string => typeof id === "string") : []),
    describe: (e, ctx, viewer) => {
      const id = str(e, "entity");
      const name = own(ctx.state.entities, id)?.name ?? id;
      const who = Array.isArray(e.data.who) ? e.data.who.filter((x): x is string => typeof x === "string") : [];
      if (viewer === undefined) return `${listWords(who.map((w) => own(ctx.state.entities, w)?.name ?? w))} now ${who.length === 1 ? "knows" : "know"} that ${name} ${lifeStateOf(ctx.world, lifeOf(ctx.state, id)).reads}`;
      // Someone else being told is nobody's news; the POV hears what it now takes to be so.
      return who.includes(viewer) ? `${name} ${lifeStateOf(ctx.world, lifeKnownTo(ctx.state, id, viewer)).reads}` : "";
    },
  },
];

/** Who an `engine.life` event records seeing the change; null on one recorded before witnesses were. */
function witnessesOf(e: PackEvent): EntityId[] | null {
  const seen = e.data.witnesses;
  return Array.isArray(seen) ? seen.filter((id): id is string => typeof id === "string") : null;
}

/** A formula argument naming an entity in the state, with that entity; null otherwise. */
function entityArg(ctx: ReadContext, v: Value | undefined): [EntityId, EntityState] | null {
  const id = typeof v === "string" ? v : "";
  const e = own(ctx.state.entities, id);
  return e ? [id, e] : null;
}
export const enginePack: PackDef = {
  id: ENGINE_PACK,
  label: "Engine",
  version: 1,
  domain: null,
  requires: [],
  register(r) {
    for (const def of events) r.event(def);
    // The GM's per-chat section settings (DESIGN §6.11).
    r.event(feedEvent);
    // The chat's workspace files, by path, and the ones pinned (DESIGN §4.4).
    r.event(wsWriteEvent);
    r.event(wsDeleteEvent);
    r.event(wsPinEvent);
    r.event(wsReadersEvent);
    // What an agent turn tells its narrator, recorded on the turn (INC2-SPEC C11): no state of its own.
    r.event(outLinesEvent);
    r.event(outSceneEvent);
    r.proposal(knowsChannel);
    r.proposal(spawnChannel);
    r.proposal(lifeChannel);
    // Someone who acts again comes back caught up, as a restored agent does: the slots spent out of it aren't lived again.
    r.effect({
      type: "life",
      args: ["entity", "to?", "tell?"],
      resolve: (a, ctx) => {
        const out = lifeEffect(a, ctx);
        const subject = typeof a.entity === "string" ? a.entity : "";
        const wakes = Array.isArray(out) && typeof a.to === "string" && out.some((e) => e.type === ENGINE_EVENTS.life) && own(ctx.state.entities, subject)?.agent === true && !acts(ctx.world, ctx.state, subject) && lifeStateOf(ctx.world, a.to).acts;
        return wakes && Array.isArray(out) ? [...out, { type: ENGINE_EVENTS.caught, data: { agent: subject, slot: slotIndexAt(calendarOf(ctx.world), ctx.state.clock) } }] : out;
      },
    });
    // An entity's life state (DESIGN §8), for rules and requirements: "" for an unknown entity.
    r.formula("life_of", (ctx, entity) => {
      const hit = entityArg(ctx, entity);
      return hit ? lifeOf(ctx.state, hit[0]) : "";
    });
    // Taxonomy (DESIGN §4.1): what a selector tests, one constraint at a time. An unknown entity is false (or "").
    r.formula("kind_is", (ctx, entity, kind) => {
      const hit = entityArg(ctx, entity);
      return hit !== null && kindIs(ctx.registry, ctx.world, hit[1].kind, String(kind ?? ""));
    });
    r.formula("in_class", (ctx, entity, facet, value) => {
      const hit = entityArg(ctx, entity);
      return hit !== null && inClass(ctx.world, ctx.state, hit[0], String(facet ?? ""), [String(value ?? "")]);
    });
    r.formula("has_tag", (ctx, entity, tag) => {
      const hit = entityArg(ctx, entity);
      return hit !== null && tagsOf(ctx.world, ctx.state, hit[0]).includes(String(tag ?? ""));
    });
    r.formula("member_of", (ctx, entity, group) => {
      const hit = entityArg(ctx, entity);
      return hit !== null && isMemberOf(ctx.state, hit[0], String(group ?? ""));
    });
    r.formula("tier_of", (ctx, entity) => entityArg(ctx, entity)?.[1].tier ?? "");
    r.formula("band_of", (ctx, entity) => {
      const hit = entityArg(ctx, entity);
      return hit ? (tierBand(ctx.world, hit[1].tier) ?? "") : "";
    });
  },
};
