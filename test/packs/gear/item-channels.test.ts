// The reply's item channels (DESIGN §9.4): picking up, putting down, using up, wearing, losing or
// having stolen, and an item's condition. Each applies what the prose states, as much as it tells,
// against where the thing is now; it refuses what can't happen and keeps a field inside its range.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import { applyEffects } from "../../../src/engine/effects";
import { createRegistry } from "../../../src/engine/registry-impl";
import { createRng } from "../../../src/engine/rng";
import { isGone } from "../../../src/engine/scope";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);

function setup(apples = 3): Working {
  const world = modernUsWorld("w", "Riverton");
  world.entities.apples = { id: "apples", kind: "item", name: "Apples", tier: "background", fields: { place: "apartment", qty: apples }, relations: [] };
  world.entities.coat = { id: "coat", kind: "item", name: "Coat", tier: "background", fields: { owner: "you", slot: "torso_outer", condition: 80 }, relations: [{ type: "in", to: "you" }] };
  world.entities.mug = { id: "mug", kind: "item", name: "Mug", tier: "background", fields: { place: "cafe" }, relations: [] };
  return new Working(reg, world, startState(world));
}

/** Plays a proposal as the reply's read does: refused (its code), or applied. */
function play(w: Working, p: JsonObject): string | null {
  const channel = reg.proposals.get(String(p.type));
  if (!channel) throw new Error(`no ${String(p.type)} channel`);
  const refused = channel.validate(p, w.ctx);
  if (refused) return refused.code;
  const r = applyEffects(reg, w, channel.toEffects(p, w.ctx), { bindings: { self: w.world.pov }, rng: createRng("p") });
  return r.rejected[0]?.rejection.code ?? null;
}

const holder = (w: Working, id: string): string | undefined => w.state.entities[id]?.relations.find((r) => r.type === "in")?.to;

describe("the reply's item channels", () => {
  test("take, drop and use_up apply what the prose states, and refuse what can't happen", () => {
    const w = setup();
    expect(play(w, { type: "take", entity: "you", item: "mug" })).toBe("not_here");
    expect(play(w, { type: "take", entity: "you", item: "the apples" })).toBeNull();
    expect(holder(w, "apples")).toBe("you");
    expect(play(w, { type: "use_up", entity: "you", item: "apples", qty: 0 })).toBe("bad_amount");
    expect(play(w, { type: "use_up", entity: "you", item: "apples", qty: 2 })).toBeNull();
    expect(w.state.entities.apples?.fields.qty).toBe(1);
    expect(play(w, { type: "use_up", entity: "you", item: "apples" })).toBeNull();
    expect(isGone(w.state, "apples")).toBe(true);
    expect(play(w, { type: "drop", entity: "you", item: "mug" })).toBe("not_held");
    expect(play(w, { type: "drop", entity: "you", item: "phone" })).toBeNull();
    expect(w.state.entities.phone?.fields.place).toBe("apartment");
  });

  test("use_up takes as many as the story tells: eleven of twelve leave one, and more than is left uses up the rest", () => {
    const w = setup(12);
    expect(play(w, { type: "take", entity: "you", item: "apples" })).toBeNull();
    expect(play(w, { type: "use_up", entity: "you", item: "apples", qty: 11 })).toBeNull();
    expect(w.state.entities.apples?.fields.qty).toBe(1);
    expect(play(w, { type: "use_up", entity: "you", item: "apples", qty: 5 })).toBeNull();
    expect(isGone(w.state, "apples")).toBe(true);
  });

  test("wear, lose and item_condition apply what the prose states, the condition as far as it tells inside its range", () => {
    const w = setup();
    expect(play(w, { type: "wear", entity: "you", item: "coat", off: true })).toBe("not_worn");
    expect(play(w, { type: "wear", entity: "you", item: "coat" })).toBeNull();
    expect(w.state.entities.coat?.relations.some((r) => r.type === "worn_by" && r.to === "you")).toBe(true);
    expect(play(w, { type: "wear", entity: "you", item: "coat", off: true })).toBeNull();
    expect(play(w, { type: "item_condition", item: "coat", delta: -40 })).toBeNull();
    expect(w.state.entities.coat?.fields.condition).toBe(40);
    expect(play(w, { type: "item_condition", item: "coat", delta: 90 })).toBeNull();
    expect(w.state.entities.coat?.fields.condition).toBe(100);
    expect(play(w, { type: "item_condition", item: "coat", delta: 0 })).toBe("bad_amount");
    expect(play(w, { type: "lose", entity: "you", item: "coat", by: "rosa" })).toBeNull();
    expect(holder(w, "coat")).toBe("rosa");
    expect(play(w, { type: "lose", entity: "you", item: "mug" })).toBe("not_held");
  });

  test("a thing with no condition or count stored steps from its default: a tear marks it, and one less of a single thing leaves none", () => {
    const world = modernUsWorld("w", "Riverton");
    world.entities.scarf = { id: "scarf", kind: "item", name: "Scarf", tier: "background", fields: { owner: "you" }, relations: [{ type: "in", to: "you" }] };
    world.entities.candle = { id: "candle", kind: "item", name: "Candle", tier: "background", fields: { owner: "you" }, relations: [{ type: "in", to: "you" }] };
    const w = new Working(reg, world, startState(world));
    expect(play(w, { type: "item_condition", item: "scarf", delta: -25 })).toBeNull();
    expect(w.state.entities.scarf?.fields.condition).toBe(75);
    expect(play(w, { type: "quantity", entity: "you", item: "candle", delta: -1 })).toBeNull();
    expect(w.state.entities.candle?.fields.qty).toBe(0);
  });

  test("a step the world's author set on a thing's count or condition caps how far one reply moves it", () => {
    const world = modernUsWorld("w", "Riverton");
    world.kinds.item = {
      id: "item",
      label: "Item",
      fields: {
        qty: { type: "number", default: 1, min: 0, bound: { mode: "auto", maxDelta: 5 } },
        condition: { type: "number", default: 100, min: 0, max: 100, bound: { mode: "auto", maxDelta: 10 } },
      },
    };
    world.entities.apples = { id: "apples", kind: "item", name: "Apples", tier: "background", fields: { owner: "you", qty: 12 }, relations: [{ type: "in", to: "you" }] };
    world.entities.coat = { id: "coat", kind: "item", name: "Coat", tier: "background", fields: { owner: "you", condition: 80 }, relations: [{ type: "in", to: "you" }] };
    const w = new Working(reg, world, startState(world));
    expect(play(w, { type: "quantity", entity: "you", item: "apples", delta: -9 })).toBeNull();
    expect(w.state.entities.apples?.fields.qty).toBe(7);
    expect(play(w, { type: "quantity", entity: "you", item: "apples", delta: 20 })).toBeNull();
    expect(w.state.entities.apples?.fields.qty).toBe(12);
    expect(play(w, { type: "item_condition", item: "coat", delta: -40 })).toBeNull();
    expect(w.state.entities.coat?.fields.condition).toBe(70);
  });
});
