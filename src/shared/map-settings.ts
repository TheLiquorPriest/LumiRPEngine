// A world's map settings as Build shows and saves them (DESIGN §4.1, §12; PlanChatUI-B6): what `mapSettingsOf` gives (the display, the grid
// system, the travel simulation) with the travel times and the words a grid's terrain holds for a door, which the engine reads from the
// stored settings as they are. A world that sets none of them keeps no settings, so one saved untouched stays as it was.

import { isRecord, type JsonObject } from "./json";
import { DEFAULT_DOOR_TERRAINS, doorTerrainsOf } from "./grid";
import { mapSettingsOf } from "./maps";
import type { MapSettings } from "./world";

/** The settings as the editor shows them: the travel times where the world has them, and the door terrains in force (the shipped ones where it names none). */
export function mapSettingsForEdit(world: { readonly mapSettings?: unknown }): MapSettings {
  const raw = isRecord(world.mapSettings) ? world.mapSettings : {};
  return { ...mapSettingsOf(world), ...(isRecord(raw.travel) ? { travel: raw.travel as MapSettings["travel"] } : {}), doorTerrains: [...doorTerrainsOf(world)] };
}

/** The settings the editor sends, as the world keeps them; null for the shipped ones, which are no settings. */
export function storedMapSettings(sent: unknown): MapSettings | null {
  const raw: JsonObject = isRecord(sent) ? (sent as JsonObject) : {};
  const travel = isRecord(raw.travel) && Object.keys(raw.travel).length > 0 ? (raw.travel as MapSettings["travel"]) : undefined;
  const words = Array.isArray(raw.doorTerrains) ? raw.doorTerrains.filter((w): w is string => typeof w === "string").map((w) => w.trim()).filter((w) => w !== "") : undefined;
  const doors = words !== undefined && JSON.stringify(words) !== JSON.stringify(DEFAULT_DOOR_TERRAINS) ? words : undefined;
  const settings: MapSettings = { ...mapSettingsOf({ mapSettings: sent }), ...(travel === undefined ? {} : { travel }), ...(doors === undefined ? {} : { doorTerrains: doors }) };
  return JSON.stringify(settings) === JSON.stringify(mapSettingsOf({})) ? null : settings;
}
