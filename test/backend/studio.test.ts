// The studio seam (DESIGN §15): load, validate, migrate, lint, Playtest, Check world and versions,
// with the shipped packs and no host.

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import { DEFAULT_CURRENCY } from "../../src/shared/world";
import { checkWorld, ENGINE_VERSION, exportFile, lint, load, migrate, newWorld, PACK_VERSIONS, playtest, studioState, validate, WORLD_FORMAT } from "../../src/studio-api";

describe("studio seam", () => {
  test("load accepts JSON text, documents and export files; rejects bad JSON and wrong shapes", () => {
    const world = newWorld("w_studio", "Studio");
    const fromFile = load(exportFile(world));
    expect(fromFile.ok).toBe(true);
    const fromText = load(JSON.stringify(world));
    expect(fromText.ok && fromText.world.name).toBe("Studio");
    const bad = load("{not json");
    expect(bad.ok).toBe(false);
    expect(validate({ format: WORLD_FORMAT }).length).toBeGreaterThan(3);
    expect(validate(world)).toEqual([]);
  });

  test("validate reports each collection and part that isn't an object where it is, and lets migrate fill what older documents lack", () => {
    const doc: Record<string, unknown> = JSON.parse(JSON.stringify(newWorld("w_shape", "Shape")));
    const parts = ["packs", "kinds", "relations", "entities", "places", "routes", "grids", "maps", "rules", "actions", "checks", "schedules", "tracks", "tables", "sections", "steps", "lore", "classifications", "tiers", "pins", "calendar", "realism", "time", "start", "currency", "loreIndex", "ruleset", "mapSettings"];
    for (const part of parts) expect({ part, paths: validate({ ...doc, [part]: [] }).map((i) => i.path) }).toEqual({ part, paths: [part] });
    expect(validate({ ...doc, entities: { you: 5 }, lore: { note: "text" }, spawnTier: 2, spawnCap: "many" }).map((i) => i.path)).toEqual(["entities.you", "lore.note", "spawnTier", "spawnCap"]);
    // A document from before maps, lore, its lookup table, classifications, tiers and currency: load migrates it.
    const { maps: _maps, lore: _lore, loreIndex: _index, classifications: _classes, tiers: _tiers, currency: _currency, ...old } = doc;
    expect(validate(old)).toEqual([]);
    const loaded = load(JSON.stringify(old));
    expect(loaded.ok && [loaded.world.maps, loaded.world.lore, Object.keys(loaded.world.tiers).sort(), loaded.world.currency.code]).toEqual([{}, {}, ["background", "principal", "supporting"], "USD"]);
  });

  test("migrate fills a missing currency and drops step templates of the retired select purpose; lint finds a broken POV", () => {
    const world = newWorld("w_old", "Old");
    const { currency: _currency, ...rest } = world;
    const old = JSON.parse(JSON.stringify(rest)) as typeof world;
    expect(migrate(old).currency).toEqual(DEFAULT_CURRENCY);
    expect(migrate(world)).toBe(world);
    const steps = { pick: { id: "pick", purpose: "select", template: "Does this lore matter?", output: "decision", signals: ["uncached"] }, brief: { id: "brief", purpose: "brief", template: "Summarize the scene.", output: "text", signals: [] } };
    const loaded = load(JSON.stringify({ ...world, steps }));
    expect(loaded.ok && Object.keys(loaded.world.steps)).toEqual(["brief"]);
    expect(loaded.issues.filter((i) => i.path.startsWith("steps."))).toEqual([]);
    expect(lint(world).filter((i) => i.severity === "error")).toEqual([]);
    expect(lint({ ...world, pov: "ghost" }).some((i) => i.code === "missing_pov")).toBe(true);
    // The spawn cap is a whole number from 0 to 500; a world without one plays at 24.
    for (const spawnCap of [2.5, -1, 501]) expect(lint({ ...world, spawnCap }).some((i) => i.path === "spawnCap" && i.severity === "error")).toBe(true);
    for (const spawnCap of [0, 60, 500]) expect(lint({ ...world, spawnCap }).some((i) => i.path === "spawnCap")).toBe(false);
    expect(migrate(world).spawnCap).toBeUndefined();
  });

  test("Playtest and Check world run the shipped packs deterministically", () => {
    const world = newWorld("w_run", "Run");
    const a = playtest(world, ["look around", "wait"]);
    expect(a.turns.length).toBe(2);
    expect(playtest(world, ["look around", "wait"])).toEqual(a);
    const check = checkWorld(world, 2);
    expect(check.turns.map((t) => t.user)).toEqual(["Day 1", "Day 2"]);
    expect(check.turns.every((t) => !t.notes.some((n) => n.startsWith("failed")))).toBe(true);
  });

  test("versions and the lre-state-v1 payload", () => {
    const state = studioState(["file"]);
    expect(state.engineVersion).toBe(ENGINE_VERSION);
    expect(state.worldFormat).toBe(WORLD_FORMAT);
    expect(isRecord(state.packs) && Object.keys(state.packs).length).toBe(Object.keys(PACK_VERSIONS).length);
    expect(state.inbound).toEqual(["file"]);
  });
});
