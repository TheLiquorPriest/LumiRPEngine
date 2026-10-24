// What the reply-reading step reads the world against (DESIGN §9.4): who holds each thing, so a
// narrated hand-over reads from the right giver, and the scene's people and things ahead of money
// accounts when there are more than fit.

import { describe, expect, test } from "bun:test";
import { prefixSummary } from "../../src/backend/runtime";
import { createRegistry } from "../../src/engine/registry-impl";
import { isRecord } from "../../src/shared/json";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

describe("the extraction prefix", () => {
  test("a thing names its holder, never a hidden one, and the scene comes before a wallet's worth of accounts", () => {
    const world = modernUsWorld("w", "Riverton");
    for (let i = 0; i < 40; i++) world.entities[`card_${i}`] = { id: `card_${i}`, kind: "account", name: `Card ${i}`, tier: "background", fields: { owner: "you", type: "credit_card" }, relations: [] };
    world.entities.sam = { id: "sam", kind: "person", name: "Sam Ortiz", tier: "supporting", fields: { place: "apartment" }, relations: [] };
    world.entities.ghost = { id: "ghost", kind: "person", name: "The Watcher", tier: "supporting", fields: { place: "apartment" }, relations: [], visibility: "secret" };
    world.entities.coin = { id: "coin", kind: "item", name: "Old coin", tier: "background", fields: {}, relations: [{ type: "in", to: "ghost" }] };
    const summary = prefixSummary(reg, world, startState(world));
    const entities = isRecord(summary) && isRecord(summary.entities) ? summary.entities : {};
    expect(entities.phone).toMatchObject({ holder: "you" });
    expect(entities.sam).toBeDefined();
    expect(Object.keys(entities)).not.toContain("ghost");
    expect(JSON.stringify(summary)).not.toContain("ghost");
  });
});
