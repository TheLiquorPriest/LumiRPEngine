// The reply's item channels (DESIGN §9.4): picking up, putting down, using up, wearing, losing or
// having stolen, and an item's condition. Each applies what the prose states, as much as it tells,
// against where the thing is now; it refuses what can't happen and keeps a field inside its range.
// On the starter worlds (ITEMS-SPEC §12 Phase 2): a thing handed over that the world lacks is made
// as the story has it (R7), and a hidden thing the words name is found, never made twice (R8).

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../src/shared/json";
import type { EntityDef } from "../../../src/shared/world";
import { accessFor } from "../../../src/engine/access";
import { applyEffects } from "../../../src/engine/effects";
import { createRegistry } from "../../../src/engine/registry-impl";
import { createRng } from "../../../src/engine/rng";
import { isGone } from "../../../src/engine/scope";
import { knows } from "../../../src/engine/visibility";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
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

/** A starter world, with the things a test adds, and its people where `at` puts them (each moved as the story moves people). */
function starter(id: string, things: readonly EntityDef[], at: Readonly<Record<string, string>>): Working {
  const make = STARTER_WORLDS[id];
  if (!make) throw new Error(`no starter ${id}`);
  const world = make("w", id);
  for (const e of things) world.entities[e.id] = structuredClone(e);
  const w = new Working(reg, world, startState(world, reg));
  for (const [entity, to] of Object.entries(at)) moveTo(w, entity, to);
  return w;
}

function moveTo(w: Working, entity: string, to: string): void {
  const r = applyEffects(reg, w, [{ type: "move", args: { entity, to } }], { bindings: {}, rng: createRng("move") });
  if (r.rejected.length > 0) throw new Error(`move refused: ${JSON.stringify(r.rejected)}`);
}

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
});

describe("the reply's thing facts on the starter worlds", () => {
  test("R7: a torque wrench Marcus hands Jordan at the shop is made the shop's, held by Jordan, who may use it as its staff there and not at home", () => {
    const w = starter("modern_slice_of_life", [], { pov: "alder_automotive", marcus_delgado: "alder_automotive" });
    const before = new Set(Object.keys(w.state.entities));
    expect(play(w, { type: "give", item: "a torque wrench", from: "marcus_delgado", to: "pov", why: "Marcus hands Jordan a torque wrench" })).toBeNull();
    const made = Object.keys(w.state.entities).filter((id) => !before.has(id));
    expect(made.map((id) => w.state.entities[id]?.name)).toEqual(["Torque wrench"]);
    const wrench = made[0] ?? "";
    expect(w.state.entities[wrench]?.fields).toMatchObject({ owner: "alder_automotive_co", got: { how: "holding", from: "marcus_delgado" } });
    expect(holder(w, wrench)).toBe("pov");
    // Staff may use the shop's things at the shop: holding it, Jordan needs no grant of his own.
    expect(accessFor(w.ctx, "pov", wrench)).toEqual({ use: { basis: "staff", via: "alder_automotive_co", by: "job_pov_mechanic" }, dispose: null });
    expect(w.state.entities.pov?.relations.some((r) => r.type === "uses" && r.to === wrench)).toBe(false);
    // Taken home, it is no more his to use than any of the shop's tools.
    moveTo(w, "pov", "harbor_street_114");
    expect(holder(w, wrench)).toBe("pov");
    expect(accessFor(w.ctx, "pov", wrench).use).toBeNull();
  });

  test("R8: an old brass key found in the study desk is the discoverable key there, the finder's to know, and no second key", () => {
    // As the replay golden's Mystery Manor has it: a writing desk in Sir Alaric's study, a discoverable brass key in it.
    const desk: EntityDef = { id: "study_desk", kind: "container", name: "Writing desk", tier: "background", fields: { place: "study", fixed: true }, relations: [] };
    const key: EntityDef = { id: "brass_key", kind: "item", name: "Old brass key", tier: "background", visibility: "discoverable", fields: { category: "carried" }, relations: [{ type: "in", to: "study_desk" }] };
    const w = starter("mystery_manor", [desk, key], { pov: "study" });
    expect(knows(w.state, "pov", "brass_key")).toBe(false);
    const before = Object.keys(w.state.entities).sort();
    expect(play(w, { type: "take", entity: "pov", item: "an old brass key", from: "the study desk", why: "you find an old brass key in the study desk" })).toBeNull();
    expect(holder(w, "brass_key")).toBe("pov");
    expect(knows(w.state, "pov", "brass_key")).toBe(true);
    expect(Object.keys(w.state.entities).sort()).toEqual(before);
  });
});
