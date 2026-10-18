// The state a chat starts from: the world revision's document, before any marker or event. Its
// symmetric and inverse relations are two-sided from the start (`completeRelations`); the things a
// map lays in its cells lie there, and with the grid system on the POV stands on a cell.

import type { Band, DomainId, Level, RevisionId } from "../shared/ids";
import { BANDS, DOMAINS } from "../shared/ids";
import { arrivalCell, cellIndex, placedItems, standingGrid } from "../shared/grid";
import { hasOwn, isRecord } from "../shared/json";
import { mapSettingsOf } from "../shared/maps";
import { agentOf } from "../shared/tiers";
import { ALIVE, type WorldDoc } from "../shared/world";
import { own } from "./pack-kit";
import { completeRelations, type RelationTypes } from "./relations";
import { placeOfEntity } from "./scope";
import { seedLife } from "./life";
import { seedObservations } from "./seen";
import type { EntityState, TrackState, WorldState } from "./state";
import { clampLevel, clampThreshold, clampTick, clampUnitCap } from "./time-limits";

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Minutes between two local date-times written `YYYY-MM-DDTHH:MM` (calendar arithmetic, no time zone). */
export function minutesBetween(from: string, to: string): number {
  const a = LOCAL_RE.exec(from);
  const b = LOCAL_RE.exec(to);
  if (!a || !b) throw new RangeError(`expected YYYY-MM-DDTHH:MM, got ${!a ? from : to}`);
  const ms = (m: RegExpExecArray): number => Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Math.round((ms(b) - ms(a)) / 60_000);
}

/** Levels from a document, each a whole number 0–4; unknown domains are dropped. */
export function clampLevels(levels: Partial<Record<DomainId, unknown>>): Partial<Record<DomainId, Level>> {
  const out: Partial<Record<DomainId, Level>> = {};
  for (const d of DOMAINS) if (levels[d] !== undefined) out[d] = clampLevel(levels[d]);
  return out;
}

/** Every domain's level, each a whole number 0–4; a missing domain is off. */
function domainLevels(levels: Partial<Record<DomainId, unknown>>): Record<DomainId, Level> {
  const out = {} as Record<DomainId, Level>;
  for (const d of DOMAINS) out[d] = clampLevel(levels[d]);
  return out;
}

export function initialState(world: WorldDoc, revision: RevisionId, types: RelationTypes): WorldState {
  const entities: Record<string, EntityState> = {};
  for (const [id, e] of Object.entries(world.entities)) {
    entities[id] = {
      kind: e.kind,
      name: e.name,
      tier: e.tier,
      fields: structuredClone(e.fields),
      relations: structuredClone(e.relations),
      levels: clampLevels(e.levels ?? {}),
      agent: agentOf(world, { id, tier: e.tier, agent: e.agent }),
      // Only when it isn't alive, so a world without life states starts as it always has.
      ...(typeof e.life === "string" && e.life !== ALIVE ? { life: e.life } : {}),
    };
  }
  completeRelations(types, world, entities);
  // A POV the world doesn't place starts where the world says the story starts.
  const pov = entities[world.pov];
  if (pov && placeOfEntity({ entities }, world.pov) === null && hasOwn(world.places, world.start.place)) pov.fields.place = world.start.place;
  // Things a map lays in its cells start there, unless they start inside something (DESIGN §4.1).
  for (const item of placedItems(world)) {
    const thing = own(entities, item.id);
    if (!thing || thing.relations.some((r) => r.type === "in")) continue;
    Object.assign(thing.fields, { place: item.place, x: item.cell.x, y: item.cell.y });
  }
  // With the grid system on, the POV starts on a cell of the grid it stands on (DESIGN §7): its own,
  // when the world gives it one there, else where its place is entered.
  const here = placeOfEntity({ entities }, world.pov);
  if (pov && here !== null && mapSettingsOf(world).grid.movement) {
    const stand = standingGrid(world, here);
    const { x, y } = pov.fields;
    const placed = stand !== null && typeof x === "number" && typeof y === "number" && cellIndex(stand.grid, { x, y }) !== null;
    const entry = placed ? null : arrivalCell(world, here);
    if (entry) Object.assign(pov.fields, { x: entry.cell.x, y: entry.cell.y });
  }
  const tierCaps = {} as Record<Band, Partial<Record<DomainId, Level>>>;
  for (const band of BANDS) {
    const caps: unknown = world.realism.tierCaps[band];
    tierCaps[band] = isRecord(caps) ? clampLevels(caps) : {};
  }
  const tracks: Record<string, TrackState> = {};
  for (const [id, t] of Object.entries(world.tracks)) tracks[id] = { stage: t.start, since: 0 };
  const state: WorldState = {
    revision,
    clock: minutesBetween(world.calendar.epoch, world.start.at),
    entities,
    accounts: {},
    tracks,
    realism: { levels: domainLevels(world.realism.levels), tierCaps },
    time: {
      sceneTicks: Object.fromEntries(Object.entries(world.time.sceneTicks).map(([k, v]) => [k, clampTick(v)])),
      scale: 1,
      paused: false,
      interrupts: { ...world.time.interrupts },
      speedThrough: Object.fromEntries(Object.entries(world.time.speedThrough).map(([k, p]) => [k, { mode: p.mode, thresholdMinutes: clampThreshold(p.thresholdMinutes) }])),
      montage: world.time.montage,
      unitCap: clampUnitCap(world.time.unitCap),
    },
    materialized: {},
    packs: {},
  };
  seedObservations(world, state);
  seedLife(world, state);
  return state;
}
