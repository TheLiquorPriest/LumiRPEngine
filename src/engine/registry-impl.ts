// Builds the frozen engine registry from pack definitions (DESIGN §3 Modules; ARCHITECTURE §5).

import type { DomainId, EntityId, Level, TableId } from "../shared/ids";
import { DOMAINS } from "../shared/ids";
import { tierBand } from "../shared/tiers";
import type { ActionDef, KindDef, RelationTypeDef, RuleDef, ScheduleDef, WorldDoc } from "../shared/world";
import type { Value } from "./expr";
import { coreEventTypes, type EventTypes } from "./events";
import type {
  CoreRegistry,
  EffectDef,
  EventGuardDef,
  EventTypeDef,
  LintRule,
  MaterializerDef,
  PackDef,
  PanelViewDef,
  ProcessDef,
  ProposalChannelDef,
  QueryMap,
  ReadContext,
  SectionRenderer,
  ServiceMap,
  TableDef,
} from "./registry";
import { observing } from "./seen";
import { touching } from "./touched";
import type { WorldState } from "./state";
import { clampLevel } from "./time-limits";
import { canSeeEntity } from "./visibility";

export interface Registry extends EventTypes {
  readonly packs: readonly PackDef[];
  readonly kinds: ReadonlyMap<string, KindDef>;
  readonly relations: ReadonlyMap<string, RelationTypeDef>;
  readonly effects: ReadonlyMap<string, EffectDef>;
  readonly formulas: ReadonlyMap<string, (ctx: ReadContext, ...args: Value[]) => Value>;
  readonly renderers: readonly SectionRenderer[];
  readonly actions: ReadonlyMap<string, ActionDef>;
  readonly rules: readonly RuleDef[];
  readonly schedules: readonly ScheduleDef[];
  readonly tables: ReadonlyMap<TableId, TableDef>;
  readonly materializers: ReadonlyMap<DomainId, MaterializerDef>;
  readonly processes: readonly ProcessDef[];
  readonly proposals: ReadonlyMap<string, ProposalChannelDef>;
  readonly lints: readonly LintRule[];
  readonly views: readonly PanelViewDef[];
  /** A read context over a world document and a state. */
  context(world: WorldDoc, state: Readonly<WorldState>): ReadContext;
}

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

/**
 * Effective level (DESIGN §9.1): the override, capped by the domain level; else min(domain level,
 * the cap of the band the entity's tier maps to). The tier is read through the world each time, so
 * a world's tier changes reach a chat with its revision. The POV (`world.pov`) is never capped.
 */
export function effectiveLevel(world: Pick<WorldDoc, "pov" | "tiers">, state: Readonly<WorldState>, entity: EntityId, domain: DomainId): Level {
  const domainLevel = state.realism.levels[domain];
  const e = state.entities[entity];
  if (!e) return domainLevel;
  const override = e.levels[domain];
  if (override !== undefined) return Math.min(override, domainLevel) as Level;
  const band = entity === world.pov ? null : tierBand(world, e.tier);
  const cap = band ? state.realism.tierCaps[band][domain] : undefined;
  return cap === undefined ? domainLevel : (Math.min(cap, domainLevel) as Level);
}

/** The grid system needs positions: while it moves people, Space plays at this level at least. */
export const GRID_SPACE_FLOOR: Level = 3;

/**
 * A world's floor on a domain's effective level (DESIGN §9.1, §11): its ruleset's (its math needs,
 * say, Sheets 3 for stat modifiers), and Space 3 while the grid system moves people on grids
 * (`mapSettings.grid.movement`), whatever the realism settings, tier caps or overrides say. Wraps
 * every effective level the engine reads.
 */
export function rulesetFloor(world: Pick<WorldDoc, "ruleset" | "mapSettings">, domain: DomainId, level: Level): Level {
  const authored = world.ruleset?.minLevels?.[domain];
  const grid = domain === "space" && world.mapSettings?.grid?.movement === true ? GRID_SPACE_FLOOR : 0;
  return Math.max(level, grid, authored === undefined ? 0 : clampLevel(authored)) as Level;
}

/** Each domain's floor where the world sets one (`rulesetFloor`), for the sliders that can't go below them. */
export function levelFloors(world: Pick<WorldDoc, "ruleset" | "mapSettings">): Partial<Record<DomainId, Level>> {
  const out: Partial<Record<DomainId, Level>> = {};
  for (const domain of DOMAINS) if (world.ruleset?.minLevels?.[domain] !== undefined || rulesetFloor(world, domain, 0) > 0) out[domain] = rulesetFloor(world, domain, 0);
  return out;
}

export function createRegistry(packs: readonly PackDef[]): Registry {
  const events = new Map<string, EventTypeDef>();
  const guards = new Map<string, { pack: string; def: EventGuardDef }[]>();
  const kinds = new Map<string, KindDef>();
  const relations = new Map<string, RelationTypeDef>();
  const effects = new Map<string, EffectDef>();
  const services = new Map<string, unknown>();
  const queries = new Map<string, unknown>();
  const formulas = new Map<string, (ctx: ReadContext, ...args: Value[]) => Value>();
  const renderers: SectionRenderer[] = [];
  const actions = new Map<string, ActionDef>();
  const rules: RuleDef[] = [];
  const schedules: ScheduleDef[] = [];
  const tables = new Map<TableId, TableDef>();
  const materializers = new Map<DomainId, MaterializerDef>();
  const processes: ProcessDef[] = [];
  const proposals = new Map<string, ProposalChannelDef>();
  const lints: LintRule[] = [];
  const views: PanelViewDef[] = [];

  const once = <T>(map: Map<string, T>, key: string, value: T, what: string): void => {
    if (map.has(key)) throw new RegistryError(`${what} ${key} is registered twice`);
    map.set(key, value);
  };

  const registry: Registry = {
    packs,
    kinds,
    relations,
    effects,
    formulas,
    renderers,
    actions,
    rules,
    schedules,
    tables,
    materializers,
    processes,
    proposals,
    lints,
    views,
    get: (type) => events.get(type),
    context(world, state) {
      return {
        registry,
        world,
        state,
        tables: { get: (id) => world.tables[id] },
        levelOf: (entity, domain) => rulesetFloor(world, domain, effectiveLevel(world, state, entity, domain)),
        service<K extends keyof ServiceMap>(name: K): ServiceMap[K] {
          if (!services.has(String(name))) throw new RegistryError(`no service ${String(name)}`);
          return services.get(String(name)) as ServiceMap[K];
        },
        query<K extends keyof QueryMap>(name: K): QueryMap[K] {
          if (!queries.has(String(name))) throw new RegistryError(`no query ${String(name)}`);
          return queries.get(String(name)) as QueryMap[K];
        },
      };
    },
  };

  // Moving events also keep the POV's observations (`space.seen`); both folds apply these same types.
  for (const def of coreEventTypes(() => registry)) once(events, def.type, observing(def, canSeeEntity), "event type");

  const seen = new Set<string>();
  for (const pack of packs) {
    if (seen.has(pack.id)) throw new RegistryError(`pack ${pack.id} is registered twice`);
    for (const dep of pack.requires) if (!seen.has(dep)) throw new RegistryError(`pack ${pack.id} requires ${dep}, registered later or missing`);
    seen.add(pack.id);
    const r: CoreRegistry = {
      kind: (d) => once(kinds, d.id, { ...d, pack: d.pack ?? pack.id }, "kind"),
      relation: (d) => once(relations, d.id, d, "relation"),
      event: (d) => {
        if (!d.type.startsWith(`${pack.id}.`)) throw new RegistryError(`pack ${pack.id} may only register ${pack.id}.* events, not ${d.type}`);
        once(events, d.type, d as unknown as EventTypeDef, "event type");
      },
      guard: (d) => {
        const list = guards.get(d.type) ?? [];
        list.push({ pack: pack.id, def: d as unknown as EventGuardDef });
        guards.set(d.type, list);
      },
      effect: (d) => once(effects, d.type, d, "effect"),
      service: (name, impl) => once(services, String(name), impl, "service"),
      query: (name, impl) => once(queries, String(name), impl, "query"),
      formula: (name, fn) => once(formulas, name, fn, "formula"),
      renderer: (d) => renderers.push(d),
      action: (d) => once(actions, d.id, d, "action"),
      rule: (d) => rules.push(d),
      schedule: (d) => schedules.push(d),
      table: (d) => once(tables, d.id, d, "table"),
      materializer: (d) => {
        if (materializers.has(d.domain)) throw new RegistryError(`materializer ${d.domain} is registered twice`);
        materializers.set(d.domain, d);
      },
      process: (d) => processes.push(d),
      proposal: (d) => once(proposals, d.type, d, "proposal channel"),
      lint: (d) => lints.push(d),
      view: (d) => views.push(d),
    };
    pack.register(r);
  }
  // Guards run after the type's own check, in pack order; the first rejection wins.
  for (const [type, list] of guards) {
    const def = events.get(type);
    if (!def) throw new RegistryError(`pack ${list[0]?.pack ?? "?"} guards unknown event type ${type}`);
    events.set(type, {
      ...def,
      validate: (e, ctx) => {
        const own = def.validate(e, ctx);
        if (own) return own;
        for (const g of list) {
          const rejection = g.def.validate(e, ctx);
          if (rejection) return rejection;
        }
        return null;
      },
    });
  }
  // Every type that writes entities' definitions keeps the touched record (an Upgrade's defaults); both folds apply these same types.
  for (const [type, def] of events) events.set(type, touching(def));
  return Object.freeze(registry);
}
