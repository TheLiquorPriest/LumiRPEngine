// What the reply-reading step reads the world against (DESIGN §9.4, ITEMS-SPEC §5.2): who holds each
// thing, whose it is (stated, or presumed from where it lies) and how big, and where it rests, so a
// narrated hand-over reads from the right giver and keeps its owner; the scene's people and things
// ahead of a wallet's worth of money accounts; and as many things as the user's Things the read is
// shown, those the reply or the player's message names first, then the scene's, then the player
// character's own, each party and place as the player character may know it.

import { describe, expect, test } from "bun:test";
import { prefixSummary } from "../../src/backend/runtime";
import { createRegistry } from "../../src/engine/registry-impl";
import { kindIs } from "../../src/engine/scope";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { EntityDef, WorldDoc } from "../../src/shared/world";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

/** The entities a summary shows, by id, in its order. */
function shown(summary: unknown): Record<string, unknown> {
  return isRecord(summary) && isRecord(summary.entities) ? summary.entities : {};
}

/** Port Alder, with the things a test adds, those `known` ones the player character knows of wherever they are. */
function portAlder(things: readonly EntityDef[] = [], known: readonly string[] = []): WorldDoc {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  for (const e of things) world.entities[e.id] = e;
  world.entities.pov?.relations.push(...known.map((to) => ({ type: "knows", to })));
  return world;
}

const item = (id: string, name: string, fields: JsonObject, kind = "item"): EntityDef => ({ id, kind, name, tier: "background", fields, relations: [] });

describe("the extraction prefix", () => {
  test("a thing names its holder, never a hidden one, and the scene comes before a wallet's worth of accounts", () => {
    const world = modernUsWorld("w", "Riverton");
    for (let i = 0; i < 40; i++) world.entities[`card_${i}`] = { id: `card_${i}`, kind: "account", name: `Card ${i}`, tier: "background", fields: { owner: "you", type: "credit_card" }, relations: [] };
    world.entities.sam = { id: "sam", kind: "person", name: "Sam Ortiz", tier: "supporting", fields: { place: "apartment" }, relations: [] };
    world.entities.ghost = { id: "ghost", kind: "person", name: "The Watcher", tier: "supporting", fields: { place: "apartment" }, relations: [], visibility: "secret" };
    world.entities.coin = { id: "coin", kind: "item", name: "Old coin", tier: "background", fields: {}, relations: [{ type: "in", to: "ghost" }] };
    const summary = prefixSummary(reg, world, startState(world), { said: [], shown: 40 });
    const entities = shown(summary);
    expect(entities.phone).toMatchObject({ holder: "you" });
    expect(entities.sam).toBeDefined();
    expect(Object.keys(entities)).not.toContain("ghost");
    expect(JSON.stringify(summary)).not.toContain("ghost");
  });

  test("a thing says whose it is, stated or presumed from where it lies, its size and where it rests", () => {
    // Milk nobody owns, on the counter at 114 Harbor Street: the property's owner's, presumed (§4.2).
    const world = portAlder([item("counter_milk", "Milk", { place: "harbor_street_114" })]);
    const entities = shown(prefixSummary(reg, world, startState(world, reg), { said: [], shown: 40 }));
    expect(entities.pov_phone).toMatchObject({ holder: "pov", owner: "pov", size: "pocket", rest: { in: "pov" } });
    expect(entities.pov_toolbox).toMatchObject({ place: "alder_automotive", owner: "pov", size: "armful", rest: { place: "alder_automotive" } });
    expect(entities.counter_milk).toMatchObject({ place: "harbor_street_114", owner: "helen_kowalczyk", presumed: true });
    expect(entities.pov_phone).not.toHaveProperty("presumed");
    // People are no things: they carry none of it.
    expect(entities.danny_okafor).not.toHaveProperty("owner");
    expect(entities.danny_okafor).not.toHaveProperty("size");
  });

  test("it shows as many things as the user's window, those the reply or the message names first, then the scene's, then the player character's own elsewhere", () => {
    // Fifty spare parts at the shop, the business's, and a brass compass in the park, nobody's, all of which Jordan knows of; and the toolbox Jordan keeps at the shop.
    const parts = Array.from({ length: 50 }, (_, i) => item(`spare_part_${i}`, `Spare part ${i}`, { place: "alder_automotive", owner: "alder_automotive_co" }));
    const world = portAlder([...parts, item("brass_compass", "Brass compass", { place: "lakefront_park" })], [...parts.map((p) => p.id), "brass_compass"]);
    const state = startState(world, reg);
    const things = (summary: unknown): string[] => Object.entries(shown(summary)).flatMap(([id, e]) => (isRecord(e) && typeof e.kind === "string" && kindIs(reg, world, e.kind, "item") ? [id] : []));
    const reply = "You turn the old compass over in your hands.";
    const wide = things(prefixSummary(reg, world, state, { said: [reply, "I look at the compass."], shown: 40 }));
    expect(wide).toHaveLength(40);
    expect(wide[0]).toBe("brass_compass");
    // The scene's (on Jordan, at 114 Harbor Street) before Jordan's own elsewhere, and those before the shop's parts.
    expect(wide.indexOf("pov_phone")).toBeLessThan(wide.indexOf("pov_toolbox"));
    expect(wide.indexOf("pov_toolbox")).toBeLessThan(wide.findIndex((id) => id.startsWith("spare_part_")));
    // A narrower window keeps the named one and the scene's first; none of the parts.
    const narrow = things(prefixSummary(reg, world, state, { said: [reply], shown: 5 }));
    expect(narrow).toHaveLength(5);
    expect(narrow[0]).toBe("brass_compass");
    expect(narrow.some((id) => id.startsWith("spare_part_"))).toBe(false);
    // Unnamed, the compass waits its turn behind the scene's and Jordan's own.
    expect(things(prefixSummary(reg, world, state, { said: ["The shop is quiet."], shown: 5 }))).not.toContain("brass_compass");
    // People come whatever the window; none of them counts toward it.
    expect(shown(prefixSummary(reg, world, state, { said: [], shown: 0 })).danny_okafor).toBeDefined();
  });
});
