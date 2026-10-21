// #48 in the preview: Cast's usual day (`lre.routine`, view "player") for the people Play → People
// shows a day for, and what Propose routines from lore proposes for Maple Falls, for Build's review.

import type { JobProposal } from "../../src/shared/protocol";
import type { RoutinePlayerView } from "../../src/shared/routines";

/**
 * Someone's day as the POV may know it, as the engine's projection gives it: Dev's private block reads
 * "Busy" with no reason beyond their own business, and Rosie's opening rests on a lore entry the POV
 * may read. Anyone Cast shows no day for gets none.
 */
export function routinePlayerFixture(entity: string): RoutinePlayerView {
  if (entity === "npc_dev") {
    return {
      entity,
      name: "Dev Patel",
      day: {
        label: "Tuesday",
        blocks: [
          { from: "00:00", to: "08:00", label: "Sleep", kind: "sleep", reasons: ["night"], source: { type: "routine" } },
          { from: "08:30", to: "09:00", label: "Commute", kind: "travel", reasons: ["trip"], source: { type: "commitment" } },
          { from: "09:00", to: "17:00", label: "Garage", kind: "work", reasons: ["his shift"], source: { type: "commitment" } },
          { from: "17:00", to: "18:30", label: "Busy", kind: "other", reasons: ["their own business"], source: { type: "routine" } },
          { from: "18:30", to: "19:30", label: "Dinner", kind: "free", reasons: ["evening meal"], source: { type: "routine" } },
          { from: "19:30", to: "24:00", label: "Free", kind: "free", reasons: [], source: { type: "free" } },
        ],
      },
    };
  }
  if (entity === "npc_rosie") {
    return {
      entity,
      name: "Rosie Alvarez",
      day: {
        label: "Tuesday",
        blocks: [
          { from: "00:00", to: "05:30", label: "Sleep", kind: "sleep", reasons: ["night"], source: { type: "routine" } },
          { from: "05:30", to: "14:00", label: "Opens the diner", kind: "work", reasons: ["work"], source: { type: "lore", entry: "rosies_diner", title: "Rosie's Diner" } },
          { from: "14:00", to: "15:00", label: "Waits for the delivery", kind: "other", reasons: ["said so at noon"], source: { type: "story" } },
          { from: "15:00", to: "22:00", label: "Home", kind: "free", reasons: [], source: { type: "free" } },
          { from: "22:00", to: "24:00", label: "Sleep", kind: "sleep", reasons: ["night"], source: { type: "routine" } },
        ],
      },
    };
  }
  return { entity, name: entity, day: null };
}

const lore = (entry: string, quote: string) => ({ type: "lore", entry, quote });

/**
 * A first pass of Propose routines for Maple Falls: Rosie's opening and the crew's counter coffee rest
 * on the diner's entry, Mara's shift on her sheet; Rosie's nap clashes with her shift and Dev's drinks
 * name company with no tie, so both start unticked; one cited nothing and is never offered. It stopped
 * after Rosie, so Continue reads the rest.
 */
export const ROUTINE_PROPOSALS: JobProposal[] = [
  {
    id: "routines:npc_rosie_opens",
    collection: "routines",
    key: "npc_rosie_opens",
    value: { id: "npc_rosie_opens", label: "Opens the diner", owner: "npc_rosie", blocks: [{ id: "opens", label: "Opens the diner", activity: "work", kind: "fixed", at: "05:30", minutes: 510, days: { weekdays: [1, 2, 3, 4, 5, 6] }, place: { place: "diner" }, source: lore("rosies_diner", "Rosie's opens at six and closes at three.") }] },
    source: "rosies_diner",
    confidence: 0.86,
    pack: "castlife",
    owner: "npc_rosie",
    sourceNames: { rosies_diner: "Rosie's Diner" },
  },
  {
    id: "routines:npc_rosie_nap",
    collection: "routines",
    key: "npc_rosie_nap",
    value: { id: "npc_rosie_nap", label: "Afternoon nap", owner: "npc_rosie", blocks: [{ id: "nap", label: "Afternoon nap", activity: "rest", kind: "flexible", window: { from: "13:00", to: "16:00" }, minutes: 45, place: "home", source: lore("rosies_diner", "closes at three") }] },
    source: "rosies_diner",
    confidence: 0.4,
    pack: "castlife",
    owner: "npc_rosie",
    sourceNames: { rosies_diner: "Rosie's Diner" },
    problems: ["it clashes with the schedule rosie_shift: Rosie is at Rosie's Diner until 15:00, Monday to Saturday"],
  },
  {
    id: "routines:npc_dev_drinks",
    collection: "routines",
    key: "npc_dev_drinks",
    value: { id: "npc_dev_drinks", label: "Drinks after work", owner: "npc_dev", blocks: [{ id: "drinks", label: "Drinks after work", activity: "socialize", kind: "optional", window: { from: "17:30", to: "21:00" }, minutes: 90, perWeek: 2, chance: 0.6, place: "here", company: { who: { ids: ["npc_mara"] }, invite: true }, source: { type: "sheet", entity: "npc_dev", field: "tags", quote: "night_owl" } }] },
    source: "npc_dev.tags",
    confidence: 0.4,
    pack: "castlife",
    owner: "npc_dev",
    sourceNames: { "npc_dev.tags": "Dev Patel · tags" },
    problems: ["Mara Kim (npc_mara) in its company has no tie to Dev Patel, and the cited text doesn't name them together"],
  },
  {
    id: "schedules:npc_mara_shift_place",
    collection: "schedules",
    key: "npc_mara_shift_place",
    value: { id: "npc_mara_shift_place", owner: "npc_mara", target: "place", recurrence: { every: "week", weekdays: [1, 2, 3, 4, 5] }, slots: [{ start: "14:00", end: "22:00", value: "diner" }], pack: "castlife", source: { type: "sheet", entity: "npc_mara", field: "role", quote: "Cook" } },
    source: "npc_mara.role",
    confidence: 0.74,
    pack: "castlife",
    owner: "npc_mara",
    sourceNames: { "npc_mara.role": "Mara Kim · role" },
    note: "goes with schedules.npc_mara_shift_activity: apply both",
  },
  {
    id: "routines:npc_mara_walk",
    collection: "routines",
    key: "npc_mara_walk",
    value: { id: "npc_mara_walk", label: "Evening walk", owner: "npc_mara", blocks: [{ id: "walk", label: "Evening walk", activity: "leisure", kind: "flexible", window: { from: "19:00", to: "21:00" }, minutes: 30 }] },
    source: "",
    confidence: 0.7,
    pack: "castlife",
    owner: "npc_mara",
  },
  {
    id: "routines:diner_crew_coffee",
    collection: "routines",
    key: "diner_crew_coffee",
    value: { id: "diner_crew_coffee", label: "Coffee at the counter", owner: "diner_crew", blocks: [{ id: "counter_coffee", label: "Coffee at the counter", activity: "socialize", kind: "fixed", at: "05:45", minutes: 15, days: { off: "never" }, place: { place: "diner" }, source: lore("rosies_diner", "the counter is for regulars") }] },
    source: "rosies_diner",
    confidence: 0.81,
    pack: "castlife",
    owner: "diner_crew",
    sourceNames: { rosies_diner: "Rosie's Diner" },
  },
];
