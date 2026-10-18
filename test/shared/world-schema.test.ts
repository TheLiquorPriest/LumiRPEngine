// The published world schema (schemas/lre-world-v1.schema.json) against the documents the engine
// writes: the starters, a new world and the preview world conform, and a broken document is
// reported at the part that is wrong, maps included through the map schema's `$id`.

import { describe, expect, test } from "bun:test";
import schemaJson from "../../schemas/lre-world-v1.schema.json";
import { worldFixture } from "../../dev/preview/fixtures";
import { STARTER_WORLDS } from "../../src/packs/index";
import { isRecord, type JsonValue } from "../../src/shared/json";
import { MAP_SCHEMA } from "../../src/shared/maps";
import { checkSchema, pathText, type JsonPath, type Schema } from "../../src/shared/schema-check";
import type { WorldDoc } from "../../src/shared/world";
import { migrate, newWorld } from "../../src/studio-api";

// A JSON module's inferred type spells out every node, which `Schema` describes in general.
const WORLD_SCHEMA = schemaJson as unknown as Schema;

/** The problems as `path: message` lines, the way an author reads them. */
function problems(doc: unknown): string[] {
  return checkSchema(WORLD_SCHEMA, doc, [MAP_SCHEMA]).map((p) => `${pathText(p.path)}: ${p.message}`);
}

/** A copy of a world, as an untrusted document, with the value at `path` replaced or added. */
function withValue(world: WorldDoc, path: JsonPath, value: JsonValue): unknown {
  const doc: unknown = JSON.parse(JSON.stringify(world));
  let at: unknown = doc;
  for (const key of path.slice(0, -1)) at = isRecord(at) ? at[key] : Array.isArray(at) ? at[Number(key)] : undefined;
  const last = path[path.length - 1] ?? "";
  if (isRecord(at)) at[last] = value;
  else if (Array.isArray(at)) at[Number(last)] = value;
  else throw new Error(`nothing at ${pathText(path)}`);
  return doc;
}

describe("world schema", () => {
  const world = worldFixture();

  test("the starters, a new world and the preview world conform", () => {
    for (const [id, make] of Object.entries(STARTER_WORLDS)) expect({ id, problems: problems(make(id, id)) }).toEqual({ id, problems: [] });
    expect(problems(newWorld("w_new", "New"))).toEqual([]);
    expect(problems(world)).toEqual([]);
  });

  test("an older document conforms once migrated", () => {
    const { lore: _lore, loreIndex: _index, maps: _maps, tiers: _tiers, classifications: _classes, ...rest } = newWorld("w_old", "Old");
    const old: WorldDoc = JSON.parse(JSON.stringify(rest));
    expect(problems(old)).toEqual(['needs "maps"', 'needs "lore"', 'needs "loreIndex"', 'needs "classifications"', 'needs "tiers"'].map((m) => `: ${m}`));
    expect(problems(migrate(old))).toEqual([]);
  });

  test("a broken document is reported at the part that is wrong", () => {
    expect(problems(withValue(world, ["extras"], {}))).toEqual(['extras: "extras" isn\'t a field here']);
    expect(problems(withValue(world, ["entities", "pov", "tier"], 3))).toEqual(["entities.pov.tier: should be text"]);
    expect(problems(withValue(world, ["realism", "levels", "money"], 7))).toEqual(["realism.levels.money: should be at most 4"]);
    expect(problems(withValue(world, ["rules", "payday", "on"], { tick: "hour" }))).toEqual(['rules.payday.on.tick: should be "turn", "slot" or "day"']);
    expect(problems(withValue(world, ["lore", "harbor_history", "source"], { kind: "book", bookId: "b1" }))).toEqual(['lore.harbor_history.source: needs "entryId"', 'lore.harbor_history.source: needs "hash"']);
    expect(problems(withValue(world, ["ruleset", "adjudication", "preset"], "lenient"))).toEqual(['ruleset.adjudication.preset: should be "narrative", "balanced", "crunchy" or "custom"']);
    expect(problems(withValue(world, ["spawnCap"], 600))).toEqual(["spawnCap: should be at most 500"]);
    expect(problems(withValue(world, ["spawnCap"], 60))).toEqual([]);
    // A map is checked by the map schema, which the world schema names by its `$id`.
    expect(problems(withValue(world, ["maps", "diner_floor", "layout", 1], 42))).toEqual(["maps.diner_floor.layout[1]: should be text"]);
    expect(problems(withValue(world, ["maps", "diner_floor", "walls"], true))).toEqual(['maps.diner_floor.walls: "walls" isn\'t a field here']);
  });

  test("combat is an open part of the ruleset; a part the ruleset doesn't have is not", () => {
    expect(problems(withValue(world, ["ruleset", "combat"], { rounds: true, initiative: { check: "agility" } }))).toEqual([]);
    expect(problems(withValue(world, ["ruleset", "magic"], {}))).toEqual(['ruleset.magic: "magic" isn\'t a field here']);
  });

  test("lore may be Known by, read once the POV knows what it links; no other reader is a value", () => {
    expect(problems(withValue(world, ["lore", "harbor_history", "visibility"], "known_by"))).toEqual([]);
    expect(problems(withValue(world, ["lore", "harbor_history", "visibility"], "public"))).toEqual([]);
    expect(problems(withValue(world, ["lore", "harbor_history", "visibility"], "secret"))).toEqual(['lore.harbor_history.visibility: should be "public" or "known_by"']);
  });

  test("an entity's cues each stand for one secret: a lore entry, a track or a story flag", () => {
    expect(problems(withValue(world, ["entities", "pov", "cues"], [{ text: "hums", lore: "harbor_history" }, { text: "hums", track: "t" }, { text: "hums", flag: "seen" }]))).toEqual([]);
    // A cue standing for two secrets, or for none, is reported where it sits.
    expect(problems(withValue(world, ["entities", "pov", "cues"], [{ text: "hums", flag: "seen", track: "t" }, { text: "hums" }])).map((p) => p.split(": ")[0])).toEqual(["entities.pov.cues[0]", "entities.pov.cues[1]"]);
  });
});
