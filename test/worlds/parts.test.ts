// A save of a world's part never loses what the form does not show: each part is saved with the value the page reads from the draft,
// and the draft stays what it was (a world saved untouched stays as it was), for every starter and for the empty world. A time zone that
// does not exist is refused at the save, in words that name it, and is an error of the world's own checks.

import { describe, expect, test } from "bun:test";
import { mapSettingsOf } from "../../src/shared/maps";
import { needsSettingsOf } from "../../src/shared/needs";
import { routineSettingsOf } from "../../src/shared/routines";
import type { JsonValue } from "../../src/shared/json";
import { DEFAULT_PLACE_CAPS, DEFAULT_SPAWN_CAP, type WorldDoc } from "../../src/shared/world";
import { WorldService } from "../../src/worlds/service";
import { makeBed, registry, starter, USER } from "../build-mode/bed";
import { lintWorld } from "../../src/engine/authoring";

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

describe("a time zone that does not exist", () => {
  test("the Calendar and a place refuse it at the save, naming the zone; a world that holds one is told by its checks", async () => {
    const bed = makeBed();
    const service = new WorldService({ store: bed.store, writes: bed.writes, log: bed.log });
    const made = await service.create(USER, "Fernwick", "fantasy_town");
    const id = made.world.id;
    const draft = (await service.draft(USER, id, { op: "get" })).draft as unknown as WorldDoc;
    await expect(service.draft(USER, id, { op: "set", part: "calendar", value: { ...structuredClone(draft.calendar), timeZone: "Mars/Olympus" } as never })).rejects.toThrow('calendar: The time zone "Mars/Olympus" is not a time zone');
    const [placeId, place] = Object.entries(draft.places)[0] ?? ["", draft.places.x];
    await expect(service.draft(USER, id, { op: "put", collection: "places", id: placeId, value: { ...structuredClone(place), timeZone: "Mars/Olympus" } as never })).rejects.toThrow(`places ${placeId}: The time zone "Mars/Olympus"`);
    // A real zone, and a place with none (it takes its parent's), are kept.
    await service.draft(USER, id, { op: "set", part: "calendar", value: { ...structuredClone(draft.calendar), timeZone: "Europe/Paris" } as never });
    await service.draft(USER, id, { op: "put", collection: "places", id: placeId, value: { ...structuredClone(place), timeZone: "" } as never });
    // The checks of a world that holds one already say so, at the field, in words.
    const held: WorldDoc = { ...starter("fantasy_town", "Fernwick"), calendar: { ...draft.calendar, timeZone: "Mars/Olympus" } };
    const issue = lintWorld(held, registry()).find((i) => i.code === "time_zone");
    expect(issue).toMatchObject({ severity: "error", path: "calendar.timeZone" });
    expect(issue?.message).toContain("Mars/Olympus");
  });
});

describe("a real time zone the world's clock holds no rules for", () => {
  test("saves, and the checks warn at the field that its times read as the world's own; a zone the clock holds is not warned about", async () => {
    const bed = makeBed();
    const service = new WorldService({ store: bed.store, writes: bed.writes, log: bed.log });
    const made = await service.create(USER, "Riverton", "modern_slice_of_life");
    const id = made.world.id;
    const draft = (await service.draft(USER, id, { op: "get" })).draft as unknown as WorldDoc;
    const unheld = <T extends { code: string }>(lint: readonly T[]): T[] => lint.filter((i) => i.code === "time_zone_unheld");
    expect(unheld((await service.draft(USER, id, { op: "get" })).lint)).toEqual([]);
    // It still saves; the warning comes back with the save, at the Calendar's time zone, in words that name it.
    const saved = await service.draft(USER, id, { op: "set", part: "calendar", value: { ...structuredClone(draft.calendar), timeZone: "Asia/Dubai" } as never });
    expect(unheld(saved.lint)).toMatchObject([{ severity: "warning", path: "calendar.timeZone" }]);
    expect(saved.lint.find((i) => i.code === "time_zone_unheld")?.message).toContain("Asia/Dubai");
    // A place's zone the clock holds nothing for is warned about too; one it holds (America/Chicago) is not.
    const [placeId, place] = Object.entries(draft.places)[0] ?? ["", draft.places.x];
    const placed = await service.draft(USER, id, { op: "put", collection: "places", id: placeId, value: { ...structuredClone(place), timeZone: "America/Chicago" } as never });
    expect(unheld(placed.lint).map((i) => i.path)).toEqual(["calendar.timeZone"]);
    // A custom calendar has no zones, so nothing is said.
    const custom: WorldDoc = { ...starter("fantasy_town", "Fernwick") };
    custom.calendar = { ...custom.calendar, timeZone: "Asia/Dubai" };
    expect(unheld(lintWorld(custom, registry()))).toEqual([]);
  });
});
