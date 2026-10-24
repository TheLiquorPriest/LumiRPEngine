// The reply's item channels (DESIGN §9.4): picking up, putting down, using up, wearing, losing or
// having stolen, and an item's condition. Each applies what the prose states against where the thing
// is now, and refuses what can't happen or goes past its bound.

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

function setup(): Working {
  const world = modernUsWorld("w", "Riverton");
  world.entities.apples = { id: "apples", kind: "item", name: "Apples", tier: "background", fields: { place: "apartment", qty: 3 }, relations: [] };
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
  test("take, drop and use_up apply what the prose states, and refuse what can't happen or goes past the bound", () => {
    const w = setup();
    expect(play(w, { type: "take", entity: "you", item: "mug" })).toBe("not_here");
    expect(play(w, { type: "take", entity: "you", item: "the apples" })).toBeNull();
    expect(holder(w, "apples")).toBe("you");
    expect(play(w, { type: "use_up", entity: "you", item: "apples", qty: 11 })).toBe("bound");
    expect(play(w, { type: "use_up", entity: "you", item: "apples", qty: 2 })).toBeNull();
    expect(w.state.entities.apples?.fields.qty).toBe(1);
    expect(play(w, { type: "use_up", entity: "you", item: "apples" })).toBeNull();
    expect(isGone(w.state, "apples")).toBe(true);
    expect(play(w, { type: "drop", entity: "you", item: "mug" })).toBe("not_held");
    expect(play(w, { type: "drop", entity: "you", item: "phone" })).toBeNull();
    expect(w.state.entities.phone?.fields.place).toBe("apartment");
  });

  test("wear, lose and item_condition apply within their bounds", () => {
    const w = setup();
    expect(play(w, { type: "wear", entity: "you", item: "coat", off: true })).toBe("not_worn");
    expect(play(w, { type: "wear", entity: "you", item: "coat" })).toBeNull();
    expect(w.state.entities.coat?.relations.some((r) => r.type === "worn_by" && r.to === "you")).toBe(true);
    expect(play(w, { type: "wear", entity: "you", item: "coat", off: true })).toBeNull();
    expect(play(w, { type: "item_condition", item: "coat", delta: -40 })).toBe("bound");
    expect(play(w, { type: "item_condition", item: "coat", delta: -20 })).toBeNull();
    expect(w.state.entities.coat?.fields.condition).toBe(60);
    expect(play(w, { type: "lose", entity: "you", item: "coat", by: "rosa" })).toBeNull();
    expect(holder(w, "coat")).toBe("rosa");
    expect(play(w, { type: "lose", entity: "you", item: "mug" })).toBe("not_held");
  });
});
