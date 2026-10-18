// The built-in `engine` pack: bookkeeping events the runtime records (rule firings, interrupt
// signals, agent catch-up cursors, recorded choices, puzzle attempts, reveals, the paused scene,
// checks rolled by the `check` effect), GM edits of an entity's tier, agent flag and levels and of
// its classes and tags, life states (`engine/life`: the events, the `life` effect, the `life`
// channel and `life_of`), the engine's narration channels (`knows`, `spawn`) and the taxonomy
// formulas (`kind_is`, `in_class`, `has_tag`, `member_of`, `tier_of`, `band_of`). Every registry is
// built with it first: `createRegistry([enginePack, ...packs])`. Its state lives in `state.packs.engine`.

import { facetsInOrder } from "../shared/classes";
import { isLifeState, lifeStateOf, type FacetDef } from "../shared/world";
import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord, safeKey } from "../shared/json";
import type { EntityId, InterruptClass, Level, Visibility } from "../shared/ids";
import { DOMAINS, INTERRUPT_CLASSES } from "../shared/ids";
import { isBand, tierBand, tierLabel, tierOf } from "../shared/tiers";
import type { PackEvent } from "../shared/ledger";
import type { EventTypeDef, PackDef, ReadContext, Rejection } from "./registry";
import type { Value } from "./expr";
import { acts, applyLife, lifeChannel, lifeEffect, lifeKnownTo, lifeOf, tellLife } from "./life";
import { calendarOf, slotIndexAt } from "./calendar";
import { knowsChannel, spawnChannel } from "./narration-channels";
import { kindIs } from "./scope";
import { restoreObservations } from "./seen";
import { classOf, classProblems, inClass, isMemberOf, tagsOf } from "./selector";
import type { EntityState, WorldState } from "./state";
import { own } from "./pack-kit";

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
  /** Puzzle tracks answered correctly, with the stage the answer was for. */
  solved: Record<string, string>;
  revealed: Record<string, string[]>;
  /** Last slot index each LOD1 agent has been stepped through. */
  agents: Record<string, number>;
  /** Round-robin position of the off-screen catch-up queue. */
  rr: number;
  /** The scene key the clock was paused in, or null (DESIGN §9.2: paused for the current scene). */
  pauseScene: string | null;
  /** Each action's latest attempt at a check, keyed by actor, action and parameters (`engine.adjudged`). */
  tries: Record<string, TryRecord>;
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
  const agents: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(s.agents))) if (typeof v === "number") agents[k] = v;
  const tries: Record<string, TryRecord> = {};
  for (const [k, v] of Object.entries(rec(s.tries))) {
    if (isRecord(v) && typeof v.at === "number" && (typeof v.place === "string" || v.place === null) && typeof v.outcome === "string" && typeof v.failed === "boolean" && typeof v.odds === "string") tries[k] = { at: v.at, place: v.place, outcome: v.outcome, failed: v.failed, odds: v.odds, ...(typeof v.round === "string" ? { round: v.round } : {}) };
  }
  return {
    fired,
    attempts,
    solved,
    revealed,
    agents,
    rr: typeof s.rr === "number" ? s.rr : 0,
    pauseScene: typeof s.pauseScene === "string" ? s.pauseScene : null,
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
      }
    },
    describe: (e) => `attempt on ${str(e, "track")}`,
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
      const parts: string[] = [];
      if (typeof e.data.tier === "string") parts.push(tierLabel(ctx.world, e.data.tier));
      if (typeof e.data.agent === "boolean") parts.push(e.data.agent ? "lives off-screen" : "no longer lives off-screen");
      const levels = e.data.levels;
      if (isRecord(levels)) for (const [d, v] of Object.entries(levels)) parts.push(`${d} level ${v === null ? "from the tier" : String(v)}`);
      return `${own(ctx.state.entities, str(e, "entity"))?.name ?? str(e, "entity")}: ${parts.join(", ")}`;
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
      const valuesOf = (f: FacetDef, values: readonly string[]): string => (values.length > 0 ? values.map((v) => own(f.values, v)?.label ?? v).join(", ") : "none");
      if (viewer !== undefined) {
        // A player's line says only what changed on the facets players can see, a cleared one
        // included, and never tags (DESIGN §4.1), so an edit to a hidden facet or a tag has no line.
        // Without the values before, it can't say what changed, so it says nothing.
        const was = classOf(e.data.was);
        if (!was) return "";
        const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));
        const changed = facetsInOrder(ctx.world)
          .filter(([id, f]) => f.shown === true && !same(own(classes, id) ?? [], own(was, id) ?? []))
          .map(([id, f]) => `${f.label} ${valuesOf(f, own(classes, id) ?? [])}`);
        return changed.length > 0 ? `${name}: ${changed.join("; ")}` : "";
      }
      const parts = facetsInOrder(ctx.world).flatMap(([id, f]) => {
        const values = own(classes, id) ?? [];
        return values.length > 0 ? [`${f.label} ${valuesOf(f, values)}`] : [];
      });
      const tags = tagList(e.data.tags) ?? [];
      if (tags.length > 0) parts.push(`tags ${tags.join(", ")}`);
      return parts.length > 0 ? `${name}: ${parts.join("; ")}` : `${name}: no classification or tags`;
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
      return lifeOf(ctx.state, str(e, "entity")) === str(e, "to") ? { code: "no_change", reason: `${ent.name} is already ${lifeStateOf(ctx.world, str(e, "to")).label.toLowerCase()}` } : null;
    },
    apply: (e, state, ctx) => applyLife(state, ctx, str(e, "entity"), str(e, "to")),
    touches: (e) => [{ entity: str(e, "entity"), aspect: "life" }],
    describe: (e, ctx, viewer) => {
      const id = str(e, "entity");
      const def = lifeStateOf(ctx.world, str(e, "to"));
      const name = own(ctx.state.entities, id)?.name ?? id;
      if (viewer === undefined) return `${name}: ${def.label}`;
      // A player's line only once the POV knows it: a death it didn't see or hear of has none.
      if (lifeKnownTo(ctx.state, id, viewer) !== str(e, "to")) return "";
      return id === viewer ? `You: ${def.label}` : `${name} ${def.reads}`;
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
      if (viewer === undefined) return `${who.map((w) => own(ctx.state.entities, w)?.name ?? w).join(", ")} learn: ${name} ${lifeStateOf(ctx.world, lifeOf(ctx.state, id)).reads}`;
      // Someone else being told is nobody's news; the POV hears what it now takes to be so.
      return who.includes(viewer) ? `${name} ${lifeStateOf(ctx.world, lifeKnownTo(ctx.state, id, viewer)).reads}` : "";
    },
  },
];

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
