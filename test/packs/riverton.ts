// Riverton: a hand-built Modern US test fixture (not starter content: starter worlds come from
// data-src/templates through ops' converter). It exercises every pack at Simulation realism.

import { defaultTiers } from "../../src/shared/tiers";
import type { EntityDef, WorldDoc } from "../../src/shared/world";
import { DEFAULT_CURRENCY, WORLD_FORMAT } from "../../src/shared/world";
import { REALISM_PRESETS } from "../../src/engine/realism";
import { holidaysFromTables } from "../../src/packs/calendar/core/index";
import { ALL_PACKS, defaultTables } from "../../src/packs/index";

function person(id: string, name: string, tier: EntityDef["tier"], fields: EntityDef["fields"], extra: Partial<EntityDef> = {}): EntityDef {
  return { id, kind: "person", name, tier, fields, relations: [], ...extra };
}

/** The Modern US slice-of-life starter (DESIGN §13 templates): Simulation realism, Riverton, Ohio. */
export function modernUsWorld(id: string, name: string): WorldDoc {
  const tables = defaultTables();
  const pins: WorldDoc["pins"] = { generators: {}, tables: {} };
  for (const [tid, t] of Object.entries(tables)) pins.tables[tid] = t.revision;
  const sim = REALISM_PRESETS.simulation;
  const entities: Record<string, EntityDef> = {};
  const add = (e: EntityDef): void => {
    entities[e.id] = e;
  };
  add(person("you", "Alex Rivera", "principal", { place: "apartment", home: "apartment", wealth: "modest", occupation: "office_clerk", region: "oh", employer: "brightline", charm: 12, wits: 13, grit: 11 }));
  add(person("maya", "Maya Chen", "principal", { place: "cafe", home: "maya_flat", wealth: "poor", occupation: "barista", region: "oh", charm: 14 }, { agent: true }));
  add(person("jordan", "Jordan Price", "principal", { place: "office", home: "jordan_house", wealth: "comfortable", occupation: "operations_manager", region: "oh" }, { agent: true }));
  add(person("rosa", "Rosa Delgado", "supporting", { place: "apartment_hall", home: "apartment_hall", wealth: "modest", occupation: "auto_mechanic", region: "oh" }, { agent: true }));
  add({ id: "brightline", kind: "business", name: "Brightline Logistics", tier: "background", fields: { place: "office" }, relations: [] });
  add({ id: "region_riverton", kind: "region", name: "Riverton area", tier: "background", fields: { climate: "temperate", weather: "clear" }, relations: [] });
  add({ id: "wallet", kind: "container", name: "Wallet", tier: "background", fields: { owner: "you", catalog: "wallet", capacity_l: 0.08, max_load_kg: 0.25, slot: "pocket" }, relations: [{ type: "in", to: "you" }] });
  add({ id: "phone", kind: "item", name: "Phone", tier: "background", fields: { owner: "you", notable: true, weight_g: 190, slot: "pocket" }, relations: [{ type: "in", to: "you" }] });
  add({ id: "toolbox", kind: "kit", name: "Mechanic's toolbox", tier: "background", fields: { owner: "you", kit: "mechanic_toolbox_45", notable: true, place: "garage", volume_l: 30, weight_g: 14000 }, relations: [] });
  add({ id: "cash", kind: "account", name: "Cash", tier: "background", fields: { owner: "you", type: "cash", opening: 8400 }, relations: [{ type: "in", to: "wallet" }] });
  add({ id: "checking", kind: "account", name: "Checking", tier: "background", fields: { owner: "you", type: "checking", institution: "Riverton Credit Union", opening: 214000 }, relations: [] });
  add({ id: "savings", kind: "account", name: "Savings", tier: "background", fields: { owner: "you", type: "savings", apy_pct: 0.4, opening: 650000 }, relations: [] });
  add({ id: "card", kind: "account", name: "Visa card", tier: "background", fields: { owner: "you", type: "card", limit: 400000, apr_pct: 22, statement_day: 3, due_day: 28, autopay: "minimum", opening: -38000 }, relations: [] });
  add({ id: "truck", kind: "vehicle", name: "Pickup truck", tier: "background", fields: { owner: "you", class: "pickup_midsize", place: "garage", home: "garage", fuel_pct: 62, odometer_mi: 48210, condition: 80 }, relations: [] });
  return {
    format: WORLD_FORMAT,
    id,
    name,
    currency: { ...DEFAULT_CURRENCY },
    lore: {},
    engineVersion: "0.1.0",
    packs: Object.fromEntries(ALL_PACKS.filter((p) => p.id !== "engine").map((p) => [p.id, { version: p.version, config: {} }])),
    pins,
    kinds: {},
    relations: {},
    entities,
    places: {
      riverton: { id: "riverton", name: "Riverton", timeZone: "America/New_York", fields: { region: "region_riverton" } },
      apartment_bldg: { id: "apartment_bldg", name: "Elm Street Apartments", parent: "riverton", fields: {} },
      apartment: { id: "apartment", name: "Your apartment", parent: "apartment_bldg", sceneType: "downtime", fields: { security: 2 } },
      apartment_hall: { id: "apartment_hall", name: "Apartment 2B", parent: "apartment_bldg", sceneType: "downtime", fields: {} },
      garage: { id: "garage", name: "Building garage", parent: "apartment_bldg", sceneType: "exploration", fields: {} },
      cafe: { id: "cafe", name: "Daybreak Café", parent: "riverton", sceneType: "conversation", fields: { security: 1 } },
      maya_flat: { id: "maya_flat", name: "Maya's flat", parent: "riverton", fields: {}, visibility: "known_by" },
      office: { id: "office", name: "Brightline office", parent: "riverton", sceneType: "conversation", fields: { security: 3 } },
      jordan_house: { id: "jordan_house", name: "Jordan's house", parent: "riverton", fields: {}, visibility: "known_by" },
      park: { id: "park", name: "Riverside Park", parent: "riverton", sceneType: "exploration", fields: {} },
      lake: { id: "lake", name: "Lake Erie marina", sceneType: "exploration", fields: { region: "region_riverton" } },
      trailhead: { id: "trailhead", name: "Old Quarry trailhead", sceneType: "exploration", fields: { region: "region_riverton" } },
    },
    routes: {
      apt_cafe: { id: "apt_cafe", from: "apartment_bldg", to: "cafe", modes: { walk: { minutes: 12, distanceKm: 0.9 }, road: { minutes: 4, distanceKm: 1.2 } }, bidirectional: true },
      cafe_office: { id: "cafe_office", from: "cafe", to: "office", modes: { walk: { minutes: 15, distanceKm: 1.1 }, road: { minutes: 5, distanceKm: 1.6 } }, bidirectional: true },
      apt_office: { id: "apt_office", from: "apartment_bldg", to: "office", modes: { walk: { minutes: 25, distanceKm: 2 }, road: { minutes: 9, distanceKm: 3.1 } }, bidirectional: true },
      apt_park: { id: "apt_park", from: "apartment_bldg", to: "park", modes: { walk: { minutes: 10, distanceKm: 0.8 } }, bidirectional: true },
      cafe_maya: { id: "cafe_maya", from: "cafe", to: "maya_flat", modes: { walk: { minutes: 8, distanceKm: 0.6 } }, bidirectional: true },
      office_jordan: { id: "office_jordan", from: "office", to: "jordan_house", modes: { road: { minutes: 14, distanceKm: 9 } }, bidirectional: true },
      town_lake: { id: "town_lake", from: "riverton", to: "lake", modes: { road: { minutes: 35, distanceKm: 48, terrain: "paved" } }, bidirectional: true },
      town_trail: { id: "town_trail", from: "riverton", to: "trailhead", modes: { road: { minutes: 25, distanceKm: 30, terrain: "paved" }, offroad: { minutes: 40, distanceKm: 22, terrain: "dirt" } }, bidirectional: true },
      lake_crossing: { id: "lake_crossing", from: "lake", to: "trailhead", modes: { water: { minutes: 50, distanceKm: 18, terrain: "open_water" } }, bidirectional: true },
    },
    grids: {},
    rules: {},
    actions: {
      persuade: {
        id: "persuade",
        label: "Persuade",
        params: { target: { type: "ref", ref: "person" } },
        requires: ["at(target, here)"],
        check: { id: "persuade", dice: "2d6", modifier: "floor((self.charm - 10) / 2)", bands: [{ outcome: "refuse", max: 6 }, { outcome: "maybe", min: 7, max: 9 }, { outcome: "agree", min: 10 }] },
        outcomes: { refuse: [], maybe: [{ type: "note", args: { text: "They'll think about it." } }], agree: [{ type: "note", args: { text: "They agree." } }] },
        duration: "10",
        lexicon: ["persuade", "convince", "talk into"],
        observable: "makes a case",
      },
    },
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
      holidays: holidaysFromTables(tables["calendar.holidays"], tables["calendar.observances"]),
    },
    schedules: {
      you_work: { id: "you_work", owner: "you", target: "activity", recurrence: { every: "week", weekdays: [1, 2, 3, 4, 5], except: ["thanksgiving", "christmas", "new_years_day"] }, slots: [{ start: "09:00", end: "17:00", value: "work_shift" }] },
      maya_shift: { id: "maya_shift", owner: "maya", target: "activity", recurrence: { every: "week", weekdays: [3, 4, 5, 6, 0] }, slots: [{ start: "06:00", end: "14:00", value: "work_shift" }] },
      maya_place: { id: "maya_place", owner: "maya", target: "place", recurrence: { every: "week", weekdays: [3, 4, 5, 6, 0] }, slots: [{ start: "06:00", end: "14:00", value: "cafe" }] },
      jordan_work: { id: "jordan_work", owner: "jordan", target: "activity", recurrence: { every: "week", weekdays: [1, 2, 3, 4, 5] }, slots: [{ start: "08:00", end: "17:30", value: "work_shift" }] },
      jordan_place: { id: "jordan_place", owner: "jordan", target: "place", recurrence: { every: "week", weekdays: [1, 2, 3, 4, 5] }, slots: [{ start: "08:00", end: "17:30", value: "office" }] },
      rosa_routine: { id: "rosa_routine", owner: "rosa", target: "place", recurrence: { every: "day" }, slots: [{ start: "10:00", end: "12:00", weighted: [{ value: "park", weight: 2 }, { value: "cafe", weight: 1 }, { value: "apartment_hall", weight: 1 }] }] },
    },
    tracks: {
      first_week: {
        id: "first_week",
        kind: "quest",
        label: "Settle in",
        start: "coffee",
        visibility: "public",
        stages: {
          coffee: { label: "Meet the neighbors at the café", objectives: ["at(pov, 'cafe')"], next: [{ to: "garage", when: "track.complete" }], cue: "The café on the corner is where the neighborhood gathers." },
          garage: { label: "Check on the truck", objectives: ["at(pov, 'garage')"], next: [{ to: "settled", when: "track.complete" }] },
          settled: { label: "Settled in", next: [] },
        },
      },
    },
    tables,
    realism: { preset: "simulation", levels: { ...sim.levels }, tierCaps: structuredClone(sim.tierCaps) },
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
    lenientPricing: true,
    pov: "you",
    tiers: defaultTiers(),
    classifications: {},
    start: { place: "apartment", at: "2026-10-16T07:30" },
  };
}
