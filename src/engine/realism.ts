// Realism (DESIGN §9.1, §9.2): levels per domain, caps per tier, presets, effective levels and
// promote/demote previews. Levels gate processes, rendering and extraction, never the data shape
// (D18): a demotion leaves every field live, so a promotion never restores stale detail; the
// preview lists what switches on or off and which predicates read fields that will freeze.

import type { DomainId, EntityId, Level, RealismPresetId, Tier } from "../shared/ids";
import { DOMAINS } from "../shared/ids";
import type { MarkerBody } from "../shared/ledger";
import type { WorldDoc } from "../shared/world";
import { objectiveWhen } from "../shared/world";
import { applyMarker } from "./events";
import { identifiers } from "./expr";
import { isMaterialized } from "./materialize";
import type { Registry } from "./registry-impl";
import { effectiveLevel } from "./registry-impl";
import { kindFields } from "./scope";
import type { RealismState, WorldState } from "./state";
import { own } from "./pack-kit";

type Caps = RealismState["tierCaps"];
type Preset = Exclude<RealismPresetId, "custom">;

function all(level: Level): Record<DomainId, Level> {
  return Object.fromEntries(DOMAINS.map((d) => [d, level])) as Record<DomainId, Level>;
}

/** The three named presets (DESIGN §9.1). An absent tier cap means "the domain level". */
export const REALISM_PRESETS: Record<Preset, RealismState> = {
  story: {
    levels: { money: 1, gear: 1, vehicles: 1, castlife: 1, relationships: 1, space: 2, calendar: 2, weather: 1, sheets: 1 },
    tierCaps: { principal: {}, supporting: {}, background: {} },
  },
  grounded: {
    levels: { money: 2, gear: 2, vehicles: 2, castlife: 2, relationships: 2, space: 2, calendar: 3, weather: 2, sheets: 2 },
    tierCaps: { principal: {}, supporting: {}, background: all(1) },
  },
  simulation: {
    levels: { money: 4, gear: 4, vehicles: 4, castlife: 4, relationships: 4, space: 4, calendar: 4, weather: 3, sheets: 3 },
    tierCaps: { principal: all(4), supporting: all(3), background: all(2) },
  },
};

const CAPPED_TIERS: readonly Exclude<Tier, "pov">[] = ["principal", "supporting", "background"];

function capOf(caps: Caps, tier: Exclude<Tier, "pov">, domain: DomainId): Level {
  return caps[tier][domain] ?? 4;
}

/** The preset a realism state matches, or `custom`. */
export function presetOf(realism: RealismState): RealismPresetId {
  for (const [id, p] of Object.entries(REALISM_PRESETS) as [Preset, RealismState][]) {
    const same = DOMAINS.every((d) => p.levels[d] === realism.levels[d] && CAPPED_TIERS.every((t) => capOf(p.tierCaps, t, d) === capOf(realism.tierCaps, t, d)));
    if (same) return id;
  }
  return "custom";
}

/** The `resolve` markers that move a chat to a realism state (domain levels, then tier caps). */
export function realismMarkers(target: RealismState): MarkerBody[] {
  const out: MarkerBody[] = [];
  for (const d of DOMAINS) out.push({ kind: "resolve", domain: d, scope: { all: true }, to: target.levels[d] });
  for (const t of CAPPED_TIERS) for (const d of DOMAINS) out.push({ kind: "resolve", domain: d, scope: { tier: t }, to: capOf(target.tierCaps, t, d) });
  return out;
}

export interface LevelChange {
  entity: EntityId;
  domain: DomainId;
  from: Level;
  to: Level;
}

export interface FrozenPredicate {
  where: "rule" | "track" | "action";
  id: string;
  expr: string;
  field: string;
}

export interface LevelPreview {
  promoted: LevelChange[];
  demoted: LevelChange[];
  /** Promoted entities that lack representation in the domain and will materialize when shown. */
  materialize: { entity: EntityId; domain: DomainId }[];
  processesOn: string[];
  processesOff: string[];
  /** Predicates that read fields whose level contract puts them above the new level (DESIGN §9.2). */
  frozen: FrozenPredicate[];
}

function predicates(world: WorldDoc, reg: Registry): { where: FrozenPredicate["where"]; id: string; expr: string }[] {
  const out: { where: FrozenPredicate["where"]; id: string; expr: string }[] = [];
  for (const [id, r] of Object.entries(world.rules)) {
    if (r.when) out.push({ where: "rule", id, expr: r.when });
    if ("at" in r.on) out.push({ where: "rule", id, expr: r.on.at });
  }
  for (const r of reg.rules) if (r.when && !world.rules[r.id]) out.push({ where: "rule", id: r.id, expr: r.when });
  for (const [id, t] of Object.entries(world.tracks)) {
    for (const s of Object.values(t.stages)) {
      for (const n of s.next) out.push({ where: "track", id, expr: n.when });
      if (s.fail) out.push({ where: "track", id, expr: s.fail.when });
      if (s.gate) out.push({ where: "track", id, expr: s.gate });
      for (const o of s.objectives ?? []) out.push({ where: "track", id, expr: objectiveWhen(o) });
    }
  }
  for (const [id, a] of Object.entries(world.actions)) for (const req of a.requires) out.push({ where: "action", id, expr: req });
  return out;
}

/** Fields with a level contract in `domain` above `level`, over every kind (world and packs). */
function fieldsAbove(reg: Registry, world: WorldDoc, domain: DomainId, level: Level): Set<string> {
  const out = new Set<string>();
  const kinds = new Set([...Object.keys(world.kinds), ...reg.kinds.keys()]);
  for (const k of kinds) for (const [name, f] of Object.entries(kindFields(reg, world, k))) if (f.domain === domain && (f.level ?? 0) > level) out.add(name);
  return out;
}

/** Predicates (rules, tracks, actions) that read a field of `domain` whose level contract is above `level`: they are frozen there. */
export function frozenPredicates(reg: Registry, world: WorldDoc, domain: DomainId, level: Level): FrozenPredicate[] {
  const fields = fieldsAbove(reg, world, domain, level);
  const out: FrozenPredicate[] = [];
  if (fields.size === 0) return out;
  for (const p of predicates(world, reg)) {
    let names: string[];
    try {
      names = identifiers(p.expr);
    } catch {
      continue;
    }
    for (const n of names) if (fields.has(n)) out.push({ ...p, field: n });
  }
  return out;
}

/** What a `resolve` marker would change, from the current state. Pure: nothing is recorded. */
export function previewLevelChange(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, body: Extract<MarkerBody, { kind: "resolve" }>): LevelPreview {
  const after = structuredClone(state) as WorldState;
  applyMarker(after, body);
  const promoted: LevelChange[] = [];
  const demoted: LevelChange[] = [];
  const materialize: LevelPreview["materialize"] = [];
  for (const id of Object.keys(state.entities).sort()) {
    const from = effectiveLevel(state, id, body.domain);
    const to = effectiveLevel(after, id, body.domain);
    if (to > from) {
      promoted.push({ entity: id, domain: body.domain, from, to });
      if (reg.materializers.has(body.domain) && !isMaterialized(state, id, body.domain)) materialize.push({ entity: id, domain: body.domain });
    } else if (to < from) demoted.push({ entity: id, domain: body.domain, from, to });
  }
  const processesOn: string[] = [];
  const processesOff: string[] = [];
  for (const p of reg.processes) {
    if (p.domain !== body.domain) continue;
    const was = state.realism.levels[p.domain] >= p.minLevel;
    const now = after.realism.levels[p.domain] >= p.minLevel;
    if (now && !was) processesOn.push(p.id);
    if (was && !now) processesOff.push(p.id);
  }
  const frozen = demoted.length > 0 ? frozenPredicates(reg, world, body.domain, Math.min(...demoted.map((d) => d.to)) as Level) : [];
  return { promoted, demoted, materialize, processesOn, processesOff, frozen };
}

/** The level contract of a kind in a domain: the fields live at each level 0–4. */
export function levelContract(reg: Registry, world: WorldDoc, kind: string, domain: DomainId): Record<Level, string[]> {
  const out: Record<Level, string[]> = { 0: [], 1: [], 2: [], 3: [], 4: [] };
  const fields = Object.entries(kindFields(reg, world, kind)).filter(([, f]) => f.domain === domain);
  for (const lvl of [0, 1, 2, 3, 4] as Level[]) out[lvl] = fields.filter(([, f]) => lvl > 0 && (f.level ?? 1) <= lvl).map(([n]) => n).sort();
  return out;
}

/** Whether a field is live for an entity at its effective level (fields without a contract always are). */
export function fieldLive(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, entity: EntityId, field: string): boolean {
  const e = own(state.entities, entity);
  if (!e) return false;
  const def = own(kindFields(reg, world, e.kind), field);
  if (!def?.domain) return true;
  const lvl = effectiveLevel(state, entity, def.domain);
  return lvl > 0 && lvl >= (def.level ?? 1);
}
