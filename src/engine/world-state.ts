// The state a chat starts from: the world revision's document, before any marker or event.

import type { Band, DomainId, Level, RevisionId } from "../shared/ids";
import { BANDS, DOMAINS } from "../shared/ids";
import { isRecord } from "../shared/json";
import { agentOf } from "../shared/tiers";
import type { WorldDoc } from "../shared/world";
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
function clampLevels(levels: Partial<Record<DomainId, unknown>>): Partial<Record<DomainId, Level>> {
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

export function initialState(world: WorldDoc, revision: RevisionId): WorldState {
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
    };
  }
  const tierCaps = {} as Record<Band, Partial<Record<DomainId, Level>>>;
  for (const band of BANDS) {
    const caps: unknown = world.realism.tierCaps[band];
    tierCaps[band] = isRecord(caps) ? clampLevels(caps) : {};
  }
  const tracks: Record<string, TrackState> = {};
  for (const [id, t] of Object.entries(world.tracks)) tracks[id] = { stage: t.start, since: 0 };
  return {
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
      npcCalls: 0,
    },
    materialized: {},
    packs: {},
  };
}
