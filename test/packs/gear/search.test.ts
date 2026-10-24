// Search and discovery (DESIGN §7): a `discoverable` thing is hidden until the player character
// searches where it lies, or opens the container that holds it, and is known for good after.

import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../../src/shared/world";
import { createRegistry } from "../../../src/engine/registry-impl";
import { resolveAction } from "../../../src/engine/resolve";
import { createRng } from "../../../src/engine/rng";
import { canSeeEntity } from "../../../src/engine/visibility";
import { Working } from "../../../src/engine/working";
import { lintStructure } from "../../../src/engine/world-lint";
import { ALL_PACKS } from "../../../src/packs/index";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

function setup(patch: (w: WorldDoc) => void): Working {
  const world = modernUsWorld("w", "Riverton");
  patch(world);
  return new Working(reg, world, startState(world));
}

const sees = (w: Working, id: string): boolean => canSeeEntity(reg, w.world, w.state, w.world.pov, id);

describe("search and discoverable things", () => {
  test("a discoverable thing lying here shows only once the player character searches", () => {
    const w = setup((wd) => {
      wd.entities.ring = { id: "ring", kind: "item", name: "Silver ring", tier: "background", fields: { place: "apartment" }, relations: [], visibility: "discoverable" };
    });
    expect(lintStructure(w.world, reg).filter((i) => i.path.startsWith("entities.ring"))).toEqual([]);
    expect(sees(w, "ring")).toBe(false);
    const found = resolveAction(reg, w, { action: "search", params: {} }, createRng("s"));
    expect(found.ok).toBe(true);
    expect(sees(w, "ring")).toBe(true);
  });

  test("a container's authored contents show when it is opened, and a search of the room leaves them inside", () => {
    const w = setup((wd) => {
      wd.entities.chest = { id: "chest", kind: "container", name: "Old chest", tier: "background", fields: { place: "apartment", capacity_l: 40, stock: "household" }, relations: [] };
      wd.entities.letter = { id: "letter", kind: "item", name: "Sealed letter", tier: "background", fields: {}, relations: [{ type: "in", to: "chest" }], visibility: "discoverable" };
    });
    resolveAction(reg, w, { action: "search", params: {} }, createRng("room"));
    expect(sees(w, "letter")).toBe(false);
    const opened = resolveAction(reg, w, { action: "search", params: { target: "chest" } }, createRng("chest"));
    expect(opened.ok).toBe(true);
    expect(sees(w, "letter")).toBe(true);
  });
});
