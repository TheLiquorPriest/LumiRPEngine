// A GM edit that runs a pack effect (DESIGN §7): only an effect registered for the GM view runs,
// with literal arguments and its own checks; any other effect, and a player's fix, is refused.

import { describe, expect, test } from "bun:test";
import { parseEditOps, resolveEdit } from "../../src/engine/edits";
import type { PackDef } from "../../src/engine/registry";
import { baseWorld, POV, registryOf, startState } from "../packs/support";

const pack: PackDef = {
  id: "gmfx",
  label: "GM effects",
  version: 1,
  domain: null,
  requires: [],
  register(r) {
    r.effect({
      type: "gmfx.skill",
      args: ["to"],
      gm: true,
      resolve: (args) => (typeof args.to === "number" && args.to >= 0 ? [{ type: "set", entity: POV, field: "skill", value: args.to }] : { code: "bad_value", reason: "a skill is a number from 0" }),
    });
    r.effect({ type: "gmfx.hidden", args: ["to"], resolve: (args) => [{ type: "set", entity: POV, field: "skill", value: typeof args.to === "number" ? args.to : 0 }] });
  },
};

describe("a GM effect op", () => {
  const reg = registryOf([pack]);
  const world = baseWorld();
  const state = startState(world, reg);

  test("runs an effect registered for GM edits, with its arguments as given", () => {
    const out = resolveEdit(reg, world, state, [{ op: "effect", effect: "gmfx.skill", args: { to: 4 } }], { gm: true, runSeed: "r" });
    expect("events" in out && out.events).toEqual([{ type: "set", entity: POV, field: "skill", value: 4 }]);
  });

  test("refuses an effect not registered for GM edits, an unknown one, and any from a player's fix", () => {
    const refused = (effect: string, gm: boolean): string => {
      const out = resolveEdit(reg, world, state, [{ op: "effect", effect, args: { to: 4 } }], { gm, runSeed: "r" });
      return "rejection" in out ? out.rejection.code : "applied";
    };
    expect(refused("gmfx.hidden", true)).toBe("not_editable");
    expect(refused("gmfx.nothing", true)).toBe("not_editable");
    expect(refused("gmfx.skill", false)).toBe("not_editable");
  });

  test("the effect's own check refuses the whole edit", () => {
    const out = resolveEdit(reg, world, state, [{ op: "set", entity: POV, field: "skill", value: 1 }, { op: "effect", effect: "gmfx.skill", args: { to: -1 } }], { gm: true, runSeed: "r" });
    expect("rejection" in out && out.rejection.reason).toBe("a skill is a number from 0");
  });

  test("a request's effect op needs an effect name and arguments as an object", () => {
    expect(parseEditOps([{ op: "effect", effect: "gmfx.skill", args: { to: 2 } }])).toEqual([{ op: "effect", effect: "gmfx.skill", args: { to: 2 } }]);
    expect(parseEditOps([{ op: "effect", effect: "gmfx.skill" }])).toBeNull();
    expect(parseEditOps([{ op: "effect", effect: 3, args: {} }])).toBeNull();
    expect(parseEditOps([{ op: "effect", effect: "gmfx.skill", args: [2] }])).toBeNull();
  });
});
