// The built-in `engine` pack: bookkeeping events the runtime records (rule firings, interrupt
// signals, agent catch-up cursors, recorded choices, puzzle attempts, reveals, the paused scene,
// checks rolled by the `check` effect), the GM view, the engine's narration channels (`knows`,
// `spawn`) and the taxonomy formulas (`kind_is`, `in_class`, `has_tag`, `member_of`, `tier_of`,
// `band_of`). Every registry is built with it first: `createRegistry([enginePack, ...packs])`. Its
// state lives in `state.packs.engine`.

import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { EntityId, InterruptClass, Level, Visibility } from "../shared/ids";
import { DOMAINS, INTERRUPT_CLASSES } from "../shared/ids";
import { isBand, tierBand, tierLabel, tierOf } from "../shared/tiers";
import type { PackEvent } from "../shared/ledger";
import type { GmView } from "../shared/state-view";
import type { EventTypeDef, PackDef, ReadContext, Rejection } from "./registry";
import type { Value } from "./expr";
import { knowsChannel, spawnChannel } from "./narration-channels";
import { kindIs } from "./scope";
import { inClass, isMemberOf, tagsOf } from "./selector";
import type { EntityState, WorldState } from "./state";
import { optionalQuery, own } from "./pack-kit";

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
} as const;

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
  return {
    fired,
    attempts,
    solved,
    revealed,
    agents,
    rr: typeof s.rr === "number" ? s.rr : 0,
    pauseScene: typeof s.pauseScene === "string" ? s.pauseScene : null,
  };
}

function slice(state: WorldState): JsonObject {
  const s = state.packs[ENGINE_PACK] ?? {};
  state.packs[ENGINE_PACK] = s;
  return s;
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
    visibility: vis === "secret" || vis === "known_by" ? vis : "public",
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
    describe: (e, ctx) => {
      const parts: string[] = [];
      if (typeof e.data.tier === "string") parts.push(tierLabel(ctx.world, e.data.tier));
      if (typeof e.data.agent === "boolean") parts.push(e.data.agent ? "lives off-screen" : "no longer lives off-screen");
      const levels = e.data.levels;
      if (isRecord(levels)) for (const [d, v] of Object.entries(levels)) parts.push(`${d} level ${v === null ? "from the tier" : String(v)}`);
      return `${own(ctx.state.entities, str(e, "entity"))?.name ?? str(e, "entity")}: ${parts.join(", ")}`;
    },
  },
];

// ---------------------------------------------------------------- GM view (labelled previews)

export const GM_LABEL = "Preview — not recorded";

function buildGm(ctx: ReadContext): GmView {
  const truths: GmView["truths"] = [];
  const agendas: GmView["agendas"] = [];
  for (const id of Object.keys(ctx.world.tracks).sort()) {
    const t = own(ctx.world.tracks, id);
    if (!t) continue;
    const stage = own(ctx.state.tracks, id)?.stage ?? t.start;
    for (const [sid, s] of Object.entries(t.stages)) if (s.truth) truths.push({ track: t.label, stage: sid === stage ? `${s.label} (current)` : s.label, truth: s.truth });
    if (t.kind === "agenda") agendas.push({ entity: t.owner ? (own(ctx.state.entities, t.owner)?.name ?? t.owner) : "", label: t.label, stage: own(t.stages, stage)?.label ?? stage });
  }
  const previews: GmView["previews"] = [];
  for (const id of Object.keys(ctx.state.entities).sort()) {
    const e = own(ctx.state.entities, id);
    if (!e || !e.agent) continue;
    const lines = Object.entries(e.fields)
      .filter(([, v]) => v === null || typeof v !== "object")
      .map(([k, v]) => `${k}: ${String(v)}`);
    // Current regard (decayed at level 4) toward everyone the agent has one for: NPC↔NPC included.
    const regard = optionalQuery(ctx, "regard");
    if (regard) {
      for (const r of e.relations) {
        if (r.type !== "regard" || !own(ctx.state.entities, r.to)) continue;
        lines.push(`regard → ${own(ctx.state.entities, r.to)?.name ?? r.to}: ${Math.round(regard(ctx, id, r.to) * 10) / 10}`);
      }
    }
    previews.push({ title: e.name, lines });
  }
  // Everyone else's money, at their own Money levels, when the economy pack is loaded.
  const money = optionalQuery(ctx, "economy.people_money")?.(ctx) ?? [];
  return { label: GM_LABEL, previews, truths, agendas, money };
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
    r.proposal(knowsChannel);
    r.proposal(spawnChannel);
    r.view({ panel: "core.gm", build: (ctx) => buildGm(ctx) as unknown as JsonValue });
    // Taxonomy (DESIGN §4.1): what a selector tests, one constraint at a time. An unknown entity is false (or "").
    r.formula("kind_is", (ctx, e, kind) => {
      const hit = entityArg(ctx, e);
      return hit !== null && kindIs(ctx.registry, ctx.world, hit[1].kind, String(kind ?? ""));
    });
    r.formula("in_class", (ctx, e, facet, value) => {
      const hit = entityArg(ctx, e);
      return hit !== null && inClass(ctx.world, ctx.state, hit[0], String(facet ?? ""), [String(value ?? "")]);
    });
    r.formula("has_tag", (ctx, e, tag) => {
      const hit = entityArg(ctx, e);
      return hit !== null && tagsOf(ctx.world, ctx.state, hit[0]).includes(String(tag ?? ""));
    });
    r.formula("member_of", (ctx, e, group) => {
      const hit = entityArg(ctx, e);
      return hit !== null && isMemberOf(ctx.state, hit[0], String(group ?? ""));
    });
    r.formula("tier_of", (ctx, e) => entityArg(ctx, e)?.[1].tier ?? "");
    r.formula("band_of", (ctx, e) => {
      const hit = entityArg(ctx, e);
      return hit ? (tierBand(ctx.world, hit[1].tier) ?? "") : "";
    });
  },
};
