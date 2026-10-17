// World tiers over the three detail bands (DESIGN §9.1): old worlds keep their levels, renamed and
// extra tiers cap through their bands, unknown tiers are linted, and spawns take the world's tier.

import { describe, expect, test } from "bun:test";
import { lintWorld, migrateWorld } from "../../src/engine/authoring";
import { applyEffects } from "../../src/engine/effects";
import { applyMarker } from "../../src/engine/events";
import { realismMarkers, REALISM_PRESETS } from "../../src/engine/realism";
import { effectiveLevel } from "../../src/engine/registry-impl";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import { STARTER_WORLDS } from "../../src/packs/index";
import type { Band } from "../../src/shared/ids";
import { DOMAINS } from "../../src/shared/ids";
import { defaultTiers, spawnTierOf } from "../../src/shared/tiers";
import type { WorldDoc } from "../../src/shared/world";
import { baseWorld, POV, registryOf, startState } from "../packs/support";

/** A starter as an older engine wrote it: no tiers, and the POV on the legacy `pov` tier. */
function legacy(id: string): WorldDoc {
  const doc = JSON.parse(JSON.stringify((STARTER_WORLDS[id] as (i: string, n: string) => WorldDoc)("w", id))) as WorldDoc;
  delete (doc as Partial<WorldDoc>).tiers;
  const pov = doc.entities[doc.pov];
  if (pov) pov.tier = "pov";
  return doc;
}

describe("world tiers and detail bands", () => {
  test("an old world gets the default tiers and keeps every level it had, at every preset", () => {
    for (const id of ["fantasy_town", "mystery_manor", "modern_slice_of_life"]) {
      const old = legacy(id);
      const world = migrateWorld(old);
      expect(world.tiers).toEqual(defaultTiers());
      expect(world.entities[world.pov]?.tier).toBe("principal");
      expect(migrateWorld(world)).toBe(world);
      for (const preset of ["story", "grounded", "simulation"] as const) {
        const s = startState(world);
        for (const m of realismMarkers(REALISM_PRESETS[preset])) applyMarker(s, m);
        for (const [eid, e] of Object.entries(old.entities)) {
          for (const d of DOMAINS) {
            // The rule before world tiers: the tier id was the band, and `pov` was never capped.
            const cap = e.tier === "pov" ? undefined : s.realism.tierCaps[e.tier as Band][d];
            const override = s.entities[eid]?.levels[d];
            const expected: number = override !== undefined ? Math.min(override, s.realism.levels[d]) : cap === undefined ? s.realism.levels[d] : Math.min(cap, s.realism.levels[d]);
            expect<number>(effectiveLevel(world, s, eid, d)).toBe(expected);
          }
        }
      }
    }
  });

  test("renamed and extra tiers cap through their bands, read through the world each time", () => {
    const world = baseWorld();
    world.tiers = {
      lead: { label: "Nobility", band: "principal", order: 0 },
      guard: { label: "Guards", band: "supporting", order: 1 },
      servant: { label: "Servants", band: "background", order: 2 },
      peasant: { label: "Peasants", band: "background", order: 3 },
    };
    world.entities[POV]!.tier = "servant";
    world.entities.dev!.tier = "servant";
    const s = startState(world);
    for (const m of realismMarkers(REALISM_PRESETS.simulation)) applyMarker(s, m);
    expect(effectiveLevel(world, s, "dev", "money")).toBe(2);
    expect(effectiveLevel(world, s, POV, "money")).toBe(4);
    world.tiers.servant!.band = "supporting";
    expect(effectiveLevel(world, s, "dev", "money")).toBe(3);
    // A bare band id (an entity spawned before the rename) keeps its band; an unknown tier runs uncapped.
    s.entities.dev!.tier = "background";
    expect(effectiveLevel(world, s, "dev", "money")).toBe(2);
    s.entities.dev!.tier = "ghost";
    expect(effectiveLevel(world, s, "dev", "money")).toBe(4);
    const reg = registryOf();
    expect(lintWorld(world, reg).filter((i) => i.code === "unknown_tier" || i.code === "tier_band")).toEqual([]);
    world.entities.dev!.tier = "ghost";
    world.tiers.peasant = { label: "Peasants", band: "nobody" as Band, order: 3 };
    const codes = lintWorld(world, reg).map((i) => `${i.code} ${i.path}`);
    expect(codes).toContain("unknown_tier entities.dev.tier");
    expect(codes).toContain("tier_band tiers.peasant.band");
  });

  test("spawns and entities without an agent flag take the world's spawn tier and the tier's agent default", () => {
    const world = baseWorld();
    world.tiers = { ...defaultTiers(), extras: { label: "Extras", band: "background", order: -1, agentDefault: true } };
    expect(spawnTierOf(world)).toBe("extras");
    world.entities.dev!.tier = "extras";
    delete world.entities.dev!.agent;
    world.entities[POV]!.tier = "extras";
    const reg = registryOf();
    const w = new Working(reg, world, startState(world));
    expect([w.state.entities.dev?.agent, w.state.entities[POV]?.agent]).toEqual([true, false]);
    const out = applyEffects(reg, w, [{ type: "spawn", args: { id: "ellie", kind: "person", name: "Ellie" } }, { type: "spawn", args: { id: "bo", kind: "person", name: "Bo", tier: "supporting", agent: false } }], { bindings: {}, rng: createRng("tiers") });
    expect(out.rejected).toEqual([]);
    expect([w.state.entities.ellie?.tier, w.state.entities.ellie?.agent]).toEqual(["extras", true]);
    expect([w.state.entities.bo?.tier, w.state.entities.bo?.agent]).toEqual(["supporting", false]);
    world.spawnTier = "supporting";
    expect(spawnTierOf(world)).toBe("supporting");
  });
});
