// Hidden things stay out of how the engine reads the player character's things (DESIGN §7, §9.4):
// a new thing never joins a stack they can't see, a name never matches a thing they can't see, and
// the GM view tells a discoverable thing as such, found or not.

import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../../src/shared/world";
import { applyEffects } from "../../../src/engine/effects";
import { buildGmWorld } from "../../../src/engine/gm-view";
import { createRegistry } from "../../../src/engine/registry-impl";
import { createRng } from "../../../src/engine/rng";
import { canSeeEntity } from "../../../src/engine/visibility";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

function setup(patch: (w: WorldDoc) => void): Working {
  const world = modernUsWorld("w", "Riverton");
  patch(world);
  return new Working(reg, world, startState(world));
}

const receive = (w: Working, name: string): void => {
  expect(applyEffects(reg, w, [{ type: "gear.receive", args: { name, to: "you", from: "maya" } }], { bindings: {}, rng: createRng(name) }).rejected).toEqual([]);
};

describe("hidden things", () => {
  test("a received thing never joins a stack the player character can't see", () => {
    const w = setup((wd) => {
      wd.entities.tracker = { id: "tracker", kind: "item", name: "Apple", tier: "background", fields: { owner: "you" }, relations: [{ type: "in", to: "you" }], visibility: "secret" };
      wd.entities.spare_key = { id: "spare_key", kind: "item", name: "Spare key", tier: "background", fields: { owner: "you" }, relations: [{ type: "in", to: "wallet" }], visibility: "discoverable" };
    });
    receive(w, "Apple");
    receive(w, "Spare key");
    for (const [hidden, name] of [["tracker", "Apple"], ["spare_key", "Spare key"]] as const) {
      expect(w.state.entities[hidden]?.fields.qty ?? 1).toBe(1);
      const seen = Object.keys(w.state.entities).filter((id) => w.state.entities[id]?.name === name && canSeeEntity(reg, w.world, w.state, "you", id));
      expect(seen.length).toBe(1);
    }
  });

  test("a hidden thing on the player character never hides a visible one by the same name", () => {
    const w = setup((wd) => {
      wd.entities.coin = { id: "coin", kind: "item", name: "Coin", tier: "background", fields: { place: "apartment" }, relations: [] };
      wd.entities.tracker = { id: "tracker", kind: "item", name: "Coin", tier: "background", fields: {}, relations: [{ type: "in", to: "you" }], visibility: "secret" };
    });
    const take = reg.proposals.get("take");
    if (!take) throw new Error("no take channel");
    const p = { type: "take", entity: "you", item: "the coin" };
    expect(take.validate(p, w.ctx)).toBeNull();
    expect(applyEffects(reg, w, take.toEffects(p, w.ctx), { bindings: { self: "you" }, rng: createRng("t") }).rejected).toEqual([]);
    expect(w.state.entities.coin?.relations).toContainEqual({ type: "in", to: "you" });
  });

  test("the GM view tells a discoverable thing as discoverable, and whether it was found", () => {
    const w = setup((wd) => {
      wd.entities.ring = { id: "ring", kind: "item", name: "Silver ring", tier: "background", fields: { place: "apartment" }, relations: [], visibility: "discoverable" };
    });
    const ring = () => buildGmWorld(reg, w.world, w.state).entities.find((e) => e.id === "ring");
    expect(ring()).toMatchObject({ visibility: "discoverable", found: false });
    expect(applyEffects(reg, w, [{ type: "gear.search", args: { who: "you" } }], { bindings: {}, rng: createRng("s") }).rejected).toEqual([]);
    expect(ring()).toMatchObject({ visibility: "discoverable", found: true });
  });
});
