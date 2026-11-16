// Regard kept as the story gives it: on the axis named, at any level, toward oneself, past the scale with advice, and never faded by code;
// the fading a world's half-life brings is a read. Every name here is invented.

import { describe, expect, test } from "bun:test";
import { applyEffects } from "../../src/engine/effects";
import { createRegistry } from "../../src/engine/registry-impl";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { fadingIn, regardAxes } from "../../src/packs/relationships/core/index";
import type { WorldDoc } from "../../src/shared/world";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

function setup(level: 0 | 1 | 4, patch: (w: WorldDoc) => void = () => undefined): Working {
  const world = modernUsWorld("w", "R");
  world.realism.levels.relationships = level;
  patch(world);
  return new Working(reg, world, startState(world));
}

function adjust(w: Working, from: string, to: string, delta: number, extra: Record<string, boolean | string> = {}): void {
  const out = applyEffects(reg, w, [{ type: "relationships.adjust", args: { from, to, axis: "trust", delta, asGiven: true, ...extra } }], { bindings: {}, rng: createRng("r") });
  expect(out.rejected).toEqual([]);
}

describe("regard as the story gives it", () => {
  test("at Relationships 1, trust +10 is 10 on trust and nothing on the other axes; at level 0, and toward oneself, it is recorded", () => {
    const one = setup(1);
    adjust(one, "maya", "you", 10);
    expect(regardAxes(one.ctx, "maya", "you")).toEqual({ warmth: 0, trust: 10, respect: 0 });
    const off = setup(0);
    adjust(off, "maya", "you", 10);
    expect(regardAxes(off.ctx, "maya", "you").trust).toBe(10);
    adjust(off, "maya", "maya", 5);
    expect(regardAxes(off.ctx, "maya", "maya").trust).toBe(5);
  });

  test("trust taken past its max is kept and advised, and one recorded without the mark is spread and clamped as before", () => {
    const w = setup(4);
    adjust(w, "maya", "you", 130);
    expect(regardAxes(w.ctx, "maya", "you").trust).toBe(130);
    expect(w.advice.some((a) => a?.code === "off_the_scale")).toBe(true);
    const old = setup(1);
    applyEffects(reg, old, [{ type: "relationships.appraise", args: { from: "maya", to: "you", appraisal: { trust: 9 } } }], { bindings: {}, rng: createRng("o") });
    expect(regardAxes(old.ctx, "maya", "you")).toEqual({ warmth: 3, trust: 3, respect: 3 });
  });

  test("with a thirty-day half-life, trust 40 recorded on day 0 still reads 40 on day 30 and is read as halving to 20; with none set the read gives nothing", () => {
    const w = setup(4, (world) => {
      world.packs.relationships = { version: 1, config: { halfLifeDays: 30 } };
    });
    adjust(w, "maya", "you", 40);
    const day30 = w.state.clock + 30 * 1440;
    w.apply({ type: "clock", minutes: 30 * 1440, cause: "advance" });
    expect(regardAxes(w.ctx, "maya", "you").trust).toBe(40);
    const fading = fadingIn(w.ctx, { from: day30 - 30 * 1440, to: day30 });
    expect(fading.find((f) => f.axis === "trust")).toMatchObject({ from: "maya", to: "you", value: 40, halved: 20, at: day30 });
    const none = setup(4);
    adjust(none, "maya", "you", 40);
    expect(fadingIn(none.ctx, { from: 0, to: 90 * 1440 })).toEqual([]);
  });
});
