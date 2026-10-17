// Shared fixtures for the simulation runtime and pack tests: a minimal world document, its
// initial state, a registry (always with the engine pack first) and a validating fold.

import { hashJson } from "../../src/shared/hash";
import type { LedgerEvent } from "../../src/shared/ledger";
import { defaultTiers } from "../../src/shared/tiers";
import type { WorldDoc } from "../../src/shared/world";
import { DEFAULT_CURRENCY, WORLD_FORMAT } from "../../src/shared/world";
import { enginePack } from "../../src/engine/engine-pack";
import { applyEvent, validateEvent } from "../../src/engine/events";
import type { PackDef } from "../../src/engine/registry";
import { createRegistry, type Registry } from "../../src/engine/registry-impl";
import type { WorldState } from "../../src/engine/state";
import { initialState } from "../../src/engine/world-state";
import type { RelationTypes } from "../../src/engine/relations";

export const POV = "sam";

/** A small world: one POV, one LOD1 agent, two places, the default tiers, Story realism, US Eastern calendar. */
export function baseWorld(patch: Partial<WorldDoc> = {}): WorldDoc {
  const world: WorldDoc = {
    format: WORLD_FORMAT,
    id: "world-sim",
    name: "Sim test world",
    currency: { ...DEFAULT_CURRENCY },
    lore: {},
    engineVersion: "0.0.0",
    packs: {},
    pins: { generators: {}, tables: {} },
    kinds: {
      person: {
        id: "person",
        label: "Person",
        fields: {
          place: { type: "ref" },
          home: { type: "ref" },
          activity: { type: "text", default: "idle" },
          activity_until: { type: "number" },
          cash: { type: "money", min: 0 },
          stress: { type: "number", min: 0, max: 100, default: 0, bands: [{ label: "calm", max: 30 }, { label: "tense", min: 30, max: 70 }, { label: "frantic", min: 70 }] },
          skill: { type: "number", default: 0 },
          secret_note: { type: "text", visibility: "secret" },
        },
      },
    },
    relations: {},
    entities: {
      [POV]: { id: POV, kind: "person", name: "Sam", tier: "principal", fields: { place: "home", home: "home", cash: 5000, skill: 2 }, relations: [] },
      dev: { id: "dev", kind: "person", name: "Dev", tier: "principal", fields: { place: "cafe", home: "cafe", cash: 900 }, relations: [], agent: true },
    },
    places: {
      town: { id: "town", name: "Town", fields: {} },
      home: { id: "home", name: "Home", parent: "town", sceneType: "downtime", fields: { security: 2 } },
      cafe: { id: "cafe", name: "Cafe", parent: "town", fields: { security: 1 } },
    },
    routes: {},
    grids: {},
    maps: {},
    rules: {},
    actions: {},
    checks: {},
    calendar: {
      system: "gregorian",
      epoch: "2026-10-16T00:00",
      timeZone: "America/New_York",
      dayParts: [
        { id: "night", label: "Night", start: "00:00" },
        { id: "morning", label: "Morning", start: "06:00" },
        { id: "afternoon", label: "Afternoon", start: "12:00" },
        { id: "evening", label: "Evening", start: "18:00" },
      ],
      holidays: [{ id: "thanksgiving", label: "Thanksgiving", rule: { type: "nth_weekday", month: 11, weekday: 4, n: 4 }, dayOff: true }],
    },
    schedules: {},
    tracks: {},
    tables: {},
    realism: {
      preset: "story",
      levels: { money: 1, gear: 1, vehicles: 1, castlife: 1, relationships: 1, space: 2, calendar: 2, weather: 1, sheets: 1 },
      tierCaps: { principal: {}, supporting: {}, background: {} },
    },
    time: {
      sceneTicks: { conversation: 2, action: 0.5, exploration: 10, downtime: 30 },
      interrupts: { invitation: "stop", bill: "note", decline: "stop", incident: "stop", quest: "stop", rule: "ignore", arrival: "stop", overdue: "ignore", needs: "ignore", weather: "ignore" },
      speedThrough: { sleep: { mode: "offer", thresholdMinutes: 30 }, work_shift: { mode: "offer", thresholdMinutes: 30 }, travel: { mode: "offer", thresholdMinutes: 30 }, waiting: { mode: "offer", thresholdMinutes: 30 } },
      montage: "key",
      unitCap: { agentDays: 600, events: 5000 },
    },
    sections: {},
    steps: {},
    suppressed: [],
    seedMode: "fresh",
    lenientPricing: false,
    pov: POV,
    tiers: defaultTiers(),
    classifications: {},
    start: { place: "home", at: "2026-10-16T08:00" },
  };
  return { ...world, ...patch };
}

export function registryOf(packs: readonly PackDef[] = []): Registry {
  return createRegistry([enginePack, ...packs]);
}

const ENGINE_ONLY = registryOf();

/** The world's starting state. Pass the test's registry when the world relies on pack relation types (kinship, groups). */
export function startState(world: WorldDoc, types: RelationTypes = ENGINE_ONLY): WorldState {
  return initialState(world, hashJson(world), types);
}

/** Folds events onto a copy of `state`, validating each; a rejection is a test failure. */
export function fold(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, events: readonly LedgerEvent[]): WorldState {
  const s = structuredClone(state) as WorldState;
  for (const e of events) {
    const ctx = reg.context(world, s);
    const rejection = validateEvent(reg, e, ctx);
    if (rejection) throw new Error(`event ${e.type} rejected on fold: ${rejection.reason}`);
    applyEvent(reg, e, s, ctx);
  }
  return s;
}

/** The trial balance: every account's posting total summed (L22: always 0). */
export function trialBalance(state: Readonly<WorldState>): number {
  return Object.values(state.accounts).reduce((a, b) => a + b, 0);
}
