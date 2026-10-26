// GM → World → an entity → Put inside (DESIGN §7 containment): it offers only what holds things, as
// the GM view says, each named with where it is, so two wallets read apart; a person or a vehicle
// is offered only vehicles, and a bill or a part built into a vehicle is offered nothing.

import { describe, expect, test } from "bun:test";
import { migrateWorld } from "../../src/engine/authoring";
import { buildGmWorld } from "../../src/engine/gm-view";
import { createRegistry } from "../../src/engine/registry-impl";
import { initialState } from "../../src/engine/world-state";
import { holdersFor } from "../../src/frontend/gm/editor";
import { ALL_PACKS } from "../../src/packs/index";

const reg = createRegistry(ALL_PACKS);

describe("Put inside", () => {
  test("offers holders only, each with where it is", async () => {
    const world = migrateWorld(await Bun.file(new URL("../../src/packs/starters/modern_slice_of_life.json", import.meta.url)).json());
    const gm = buildGmWorld(reg, world, initialState(world, "gm", reg));
    const of = (id: string) => {
      const entity = gm.entities.find((e) => e.id === id);
      if (!entity) throw new Error(`no ${id}`);
      return holdersFor(gm, entity);
    };
    const phone = of("pov_phone");
    const ids = phone.map((h) => h.id);
    expect(ids).toContain("pov_wallet");
    expect(ids).toContain("pov");
    expect(ids).not.toContain("bill_phone");
    expect(ids.some((id) => gm.entities.find((e) => e.id === id)?.kind === "account")).toBe(false);
    expect(phone.find((h) => h.id === "pov_wallet")?.label).toBe(`Wallet (on ${gm.entities.find((e) => e.id === "pov")?.name})`);
    expect(of("pov_truck").every((h) => gm.entities.find((e) => e.id === h.id)?.holds === "vehicle")).toBe(true);
    expect(of("danny_okafor").every((h) => gm.entities.find((e) => e.id === h.id)?.holds === "vehicle")).toBe(true);
    expect(of("bill_phone")).toEqual([]);
    expect(of("pov_truck_bed")).toEqual([]);
  });
});
