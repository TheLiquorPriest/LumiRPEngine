// A relation refused for its cardinality says why (DESIGN §7): to the player, naming only the
// people the player knows, as a Journal line would ("someone" for anyone else); to the GM, naming
// everyone.

import { describe, expect, test } from "bun:test";
import type { Visibility } from "../../src/shared/ids";
import { applyEffects } from "../../src/engine/effects";
import { createRegistry } from "../../src/engine/registry-impl";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

/** The POV marrying Maya, whom it knows, while Jordan (at the office, away from the POV) is married to her. */
function marryMaya(jordan: Visibility, met: boolean) {
  const world = modernUsWorld("w", "R");
  world.relations.married_to = { id: "married_to", label: "Married to", from: "*", to: "*", cardinality: "one_one", symmetric: true, fields: {} };
  world.entities.jordan!.visibility = jordan;
  world.entities.jordan!.relations.push({ type: "married_to", to: "maya" });
  world.entities.you!.relations.push({ type: "knows", to: "maya" }, ...(met ? [{ type: "knows", to: "jordan" }] : []));
  const w = new Working(reg, world, startState(world, reg));
  return applyEffects(reg, w, [{ type: "link", args: { rel: "married_to", from: "you", to: "maya" } }], { bindings: {}, rng: createRng("you") }).rejected[0]?.rejection;
}

describe("a refused relation's reason", () => {
  test("names a holder the POV can't see as someone, and keeps the raw reason for the GM", () => {
    const refused = marryMaya("secret", false);
    expect(refused?.code).toBe("cardinality");
    expect(refused?.reason).toContain("Someone is already married to Maya Chen");
    expect(refused?.reason).not.toContain("Jordan");
    expect(refused?.gm).toContain("Jordan Price is already married to Maya Chen");
  });

  test("names a public holder the POV has never met as someone too, and one it has met by name", () => {
    expect(marryMaya("public", false)).toMatchObject({ reason: expect.stringContaining("Someone is already married to Maya Chen"), gm: expect.stringContaining("Jordan Price") });
    const known = marryMaya("public", true);
    expect(known).toMatchObject({ code: "cardinality", reason: expect.stringContaining("Jordan Price is already married to Maya Chen") });
    expect(known?.gm).toBeUndefined();
  });
});
