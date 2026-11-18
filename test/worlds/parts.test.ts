// A save of a world's part never loses what the form does not show: each part is saved with the value the page reads from the draft,
// and the draft stays what it was (a world saved untouched stays as it was), for every starter and for the empty world.

import { describe, expect, test } from "bun:test";
import { mapSettingsOf } from "../../src/shared/maps";
import { needsSettingsOf } from "../../src/shared/needs";
import { routineSettingsOf } from "../../src/shared/routines";
import type { JsonValue } from "../../src/shared/json";
import { DEFAULT_PLACE_CAPS, DEFAULT_SPAWN_CAP, type WorldDoc } from "../../src/shared/world";
import { WorldService } from "../../src/worlds/service";
import { makeBed, USER } from "../build-mode/bed";

/** The value the page sends for each part: the document's own, as Build reads it. */
function pageValues(doc: WorldDoc): Record<string, JsonValue> {
  const json = (value: unknown): JsonValue => structuredClone(value) as JsonValue;
  return {
    meta: json({ name: doc.name, pov: doc.pov, narrator: doc.narrator ?? null, start: doc.start, seedMode: doc.seedMode, lenientPricing: doc.lenientPricing, spawnCap: doc.spawnCap ?? DEFAULT_SPAWN_CAP, placeCap: doc.placeCap ?? DEFAULT_PLACE_CAPS.chat, placesPerTurn: doc.placesPerTurn ?? DEFAULT_PLACE_CAPS.turn, lifeStates: doc.lifeStates ?? {}, currency: doc.currency, mapSettings: mapSettingsOf(doc) }),
    calendar: json(doc.calendar),
    realism: json(doc.realism),
    time: json(doc.time),
    tiers: json({ tiers: doc.tiers, ...(doc.spawnTier === undefined ? {} : { spawnTier: doc.spawnTier }) }),
    ruleset: json(doc.ruleset ?? {}),
    loreIndex: json(doc.loreIndex),
    minds: json(doc.minds ?? {}),
    lorePins: json(doc.lorePins ?? {}),
    routineSettings: json(routineSettingsOf(doc)),
    needs: json(needsSettingsOf(doc)),
  };
}

describe("saving a part of a world", () => {
  for (const template of ["fantasy_town", "mystery_manor", "modern_slice_of_life", null]) {
    test(`each part saved as the page reads it leaves the world as it was (${template ?? "empty"})`, async () => {
      const bed = makeBed();
      const service = new WorldService({ store: bed.store, writes: bed.writes, log: bed.log });
      const made = await service.create(USER, "Fernwick", template);
      const id = made.world.id;
      const before = structuredClone((await service.draft(USER, id, { op: "get" })).draft) as unknown as WorldDoc;
      for (const [part, value] of Object.entries(pageValues(before))) {
        await service.draft(USER, id, { op: "set", part: part as never, value: value as never });
        expect({ part, draft: (await service.draft(USER, id, { op: "get" })).draft }).toEqual({ part, draft: before as never });
      }
    });
  }
});
