// A relation refused for its cardinality says why (DESIGN §7): to the player, naming only the
// people the POV can see ("someone" for anyone else); to the GM, naming everyone.

import { describe, expect, test } from "bun:test";
import { applyEffects } from "../../src/engine/effects";
import { createRegistry } from "../../src/engine/registry-impl";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

describe("a refused relation's reason", () => {
  test("names a holder the POV can't see as someone, and keeps the raw reason for the GM", () => {
    const world = modernUsWorld("w", "R");
    world.relations.married_to = { id: "married_to", label: "Married to", from: "*", to: "*", cardinality: "one_one", symmetric: true, fields: {} };
    world.entities.jordan!.visibility = "secret";
    world.entities.jordan!.relations.push({ type: "married_to", to: "maya" });
    const w = new Working(reg, world, startState(world, reg));
    const link = (from: string) => applyEffects(reg, w, [{ type: "link", args: { rel: "married_to", from, to: "maya" } }], { bindings: {}, rng: createRng(from) }).rejected[0]?.rejection;
    const refused = link("you");
    expect(refused?.code).toBe("cardinality");
    expect(refused?.reason).toContain("Someone is already married to Maya Chen");
    expect(refused?.reason).not.toContain("Jordan");
    expect(refused?.gm).toContain("Jordan Price is already married to Maya Chen");
    // With everyone in it visible, there is one reason, and it names them.
    world.entities.jordan!.visibility = "public";
    expect(link("you")).toMatchObject({ code: "cardinality", reason: expect.stringContaining("Jordan Price") });
    expect(link("you")?.gm).toBeUndefined();
  });
});
