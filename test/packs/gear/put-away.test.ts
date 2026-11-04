// The put-away process (ITEMS-SPEC §4.3, §12 Phase 4), on Port Alder at Gear 3: off screen, a thing
// an NPC or their household owns, left lying away from where it is kept, goes back there once it
// has lain out of the player character's sight for the world's hours, stepped with the world's
// slots; the player character's own things never move, nor anything lent, lost, too big to carry
// or nobody's. The world's settings switch it off, set the hours and the Gear level it runs from.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import { DEFAULT_THINGS_CONFIG, thingsConfigOf } from "../../../src/shared/things";
import type { WorldDoc } from "../../../src/shared/world";
import { createRegistry } from "../../../src/engine/registry-impl";
import { advance } from "../../../src/engine/simulate";
import type { EntityState, WorldState } from "../../../src/engine/state";
import { Working } from "../../../src/engine/working";
import { withPart } from "../../../src/packs/gear/ui/config";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const POV = "pov";
const MARCUS = "marcus_delgado";
const SHOP = "alder_automotive";
const HOME = "harbor_street_114";
/** Where Marcus lives. */
const MARCUS_HOME = "birch_lane_12";

function thing(name: string, fields: JsonObject, kind = "item"): EntityState {
  return { kind, name, tier: "background", fields, relations: [], levels: {}, agent: false };
}

/** Marcus's mug, kept at his home, lying on the shop's counter. */
const MUG = thing("Coffee mug", { owner: MARCUS, home: MARCUS_HOME, place: SHOP });
/** Jordan's thermos, kept at his home, left at the shop too. */
const THERMOS = thing("Thermos", { owner: POV, home: HOME, place: SHOP });

/**
 * Port Alder at Gear 3 with `things` lying where their fields put them and the gear pack's config
 * `config`; Jordan comes to the shop and, unless `stays`, goes home at once, so from then the shop
 * is out of his sight.
 */
function leftAtShop(things: Record<string, EntityState>, config: JsonObject = {}, stays = false): Working {
  const world: WorldDoc = STARTER_WORLDS.modern_slice_of_life!("pa", "Port Alder");
  const gear = world.packs.gear;
  if (gear) world.packs.gear = { ...gear, config: { ...(gear.config ?? {}), ...config } };
  const state: WorldState = startState(world, reg);
  state.realism.levels.gear = 3;
  Object.assign(state.entities, structuredClone(things));
  const w = new Working(reg, world, state);
  w.apply({ type: "set", entity: POV, field: "place", value: SHOP });
  if (!stays) w.apply({ type: "set", entity: POV, field: "place", value: HOME });
  return w;
}

/** The game's time runs on `hours`, the world's slots stepped as a turn steps them: Port Alder's day parts start at 5:00, 8:00, 11:30, 14:00, 17:30 and 21:30, and the chat at 6:15. */
function after(w: Working, hours: number): void {
  advance(reg, w, w.state.clock + hours * 60, { runSeed: "seed", mode: "turn" });
}
const where = (w: Working, id: string): string | null => {
  const e = w.state.entities[id];
  const holder = e?.relations.find((r) => r.type === "in")?.to;
  return holder !== undefined ? `in ${holder}` : typeof e?.fields.place === "string" ? e.fields.place : null;
};

describe("the put-away process", () => {
  test("Marcus's mug, left on the shop counter more than 24 h out of Jordan's sight, goes back to its rest; Jordan's own things never move", () => {
    const w = leftAtShop({ mug: MUG, thermos: THERMOS });
    // Left at 6:15: the slot ending at 5:00 the next day is under 24 h on, the one ending at 8:00 over.
    after(w, 23);
    expect([where(w, "mug"), where(w, "thermos")]).toEqual([SHOP, SHOP]);
    after(w, 3);
    expect([where(w, "mug"), where(w, "thermos")]).toEqual([MARCUS_HOME, SHOP]);
    // Recorded as the process's own change: the mug set at its rest, nothing else of it touched.
    expect(w.events.filter((e) => e.type === "set" && e.entity === "mug")).toEqual([{ type: "set", entity: "mug", field: "place", value: MARCUS_HOME }]);
    // Days on, Jordan's thermos is still where he left it.
    after(w, 72);
    expect(where(w, "thermos")).toBe(SHOP);
  });

  test("out of sight only: while Jordan is at the shop, nothing there goes back, however long it lies there", () => {
    const w = leftAtShop({ mug: MUG }, {}, true);
    after(w, 48);
    expect(where(w, "mug")).toBe(SHOP);
  });

  test("a household's thing goes back, and one kept on its owner goes onto them; never a thing lent, one lost, a furnishing or one nobody owns", () => {
    const w = leftAtShop({
      dish: thing("Casserole dish", { owner: "household_kowalczyk", home: HOME, place: SHOP }),
      cap: thing("Ball cap", { owner: MARCUS, home: "owner", place: SHOP }),
      lent: thing("Torque wrench", { owner: MARCUS, home: MARCUS_HOME, place: SHOP }),
      armchair: thing("Armchair", { owner: MARCUS, home: MARCUS_HOME, place: SHOP, size: "furniture" }),
      cone: thing("Traffic cone", { home: MARCUS_HOME, place: SHOP }),
    });
    w.state.entities.danny_okafor?.relations.push({ type: "uses", to: "lent", until: w.state.clock + 7 * 24 * 60, fields: { basis: "loan" } });
    w.state.entities.lost_one = thing("Wallet", { owner: MARCUS, home: MARCUS_HOME, lost: true });
    after(w, 26);
    expect(["dish", "cap", "lent", "armchair", "cone", "lost_one"].map((id) => [id, where(w, id)])).toEqual([
      ["dish", HOME],
      ["cap", `in ${MARCUS}`],
      ["lent", SHOP],
      ["armchair", SHOP],
      ["cone", SHOP],
      ["lost_one", null],
    ]);
  });

  test("a thing that changed hands lately waits the hours from then", () => {
    const w = leftAtShop({ mug: { ...MUG, fields: { ...MUG.fields } } });
    after(w, 20);
    const mug = w.state.entities.mug;
    if (mug) mug.fields.got = { how: "holding", at: w.state.clock };
    // 24 h from 2:15 is 2:15 two days on: the slot ending at 5:00 then is the first past it.
    after(w, 10);
    expect(where(w, "mug")).toBe(SHOP);
    after(w, 14);
    expect(where(w, "mug")).toBe(SHOP);
    after(w, 6);
    expect(where(w, "mug")).toBe(MARCUS_HOME);
  });

  test("the world's settings: switched off, or from a Gear level above the world's, nothing goes back; the hours are the world's", () => {
    const off = leftAtShop({ mug: MUG }, { putAway: { on: false } });
    after(off, 30);
    expect(where(off, "mug")).toBe(SHOP);
    const higher = leftAtShop({ mug: MUG }, { putAway: { minLevel: 4 } });
    after(higher, 30);
    expect(where(higher, "mug")).toBe(SHOP);
    const sooner = leftAtShop({ mug: MUG }, { putAway: { hours: 2 } });
    after(sooner, 1);
    expect(where(sooner, "mug")).toBe(SHOP);
    after(sooner, 6);
    expect(where(sooner, "mug")).toBe(MARCUS_HOME);
  });

  test("Build → Packs → gear keeps a setting only while it differs from the shipped default", () => {
    const config = { notWithYou: 2 };
    expect(withPart(config, "putAway", { on: true, hours: 12, minLevel: 3 }, DEFAULT_THINGS_CONFIG.putAway)).toEqual({ notWithYou: 2, putAway: { on: true, hours: 12, minLevel: 3 } });
    expect(withPart({ ...config, putAway: { hours: 12 } }, "putAway", { ...DEFAULT_THINGS_CONFIG.putAway }, DEFAULT_THINGS_CONFIG.putAway)).toEqual(config);
    expect(withPart(config, "tidy", { auto: false }, DEFAULT_THINGS_CONFIG.tidy)).toEqual({ ...config, tidy: { auto: false } });
    expect(thingsConfigOf({ packs: { gear: { version: 1, config: { putAway: { on: false, hours: 6, minLevel: 2 }, tidy: { auto: false } } } } })).toMatchObject({ putAway: { on: false, hours: 6, minLevel: 2 }, tidy: { auto: false } });
  });
});

describe("clothing goes back into what keeps it at home (N3)", () => {
  test("Marcus's shirt, left at the shop, goes back into the wardrobe at his home; one lying at his home goes in too", () => {
    // Made in play, so where it rests is read, not authored: in what keeps clothing at his home.
    const shirt = thing("Flannel shirt", { owner: MARCUS, category: "clothing", place: SHOP });
    const socks = thing("Wool socks", { owner: MARCUS, catalog: "socks_wool_pair", place: MARCUS_HOME });
    const wardrobe = thing("Oak wardrobe", { owner: MARCUS, place: MARCUS_HOME });
    const w = leftAtShop({ marcus_shirt: shirt, marcus_socks: socks, marcus_wardrobe: wardrobe });
    after(w, 26);
    expect(where(w, "marcus_shirt")).toBe("in marcus_wardrobe");
    expect(where(w, "marcus_socks")).toBe("in marcus_wardrobe");
    expect(where(w, "marcus_wardrobe")).toBe(MARCUS_HOME);
  });
});
