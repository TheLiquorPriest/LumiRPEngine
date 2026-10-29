// The section budget (DESIGN §6.2): a section over what is left of it is trimmed by whole lines from
// its end, those lines counted among its cut ones, and left out whole only when not even its header
// and first line fit.

import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../src/shared/world";
import { sectionTokens } from "../../src/backend/book";
import { buildSections, type SectionsBuilt } from "../../src/backend/sections-build";
import { SECRET_MARK_WORDING } from "../../src/shared/secret-marks";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);

/** Riverton with a Place section of many lines: ten things lying in the apartment and an entry about it. */
function world(): WorldDoc {
  const w = modernUsWorld("w", "R");
  for (let i = 1; i <= 10; i++) w.entities[`jar${i}`] = { id: `jar${i}`, kind: "item", name: `Jar number ${i}`, tier: "background", fields: { place: "apartment", description: `A glass jar marked ${i}.` }, relations: [] };
  w.lore.flat = { id: "flat", title: "The flat", content: "A narrow flat over the laundromat, warm from the dryers below.", keys: [], links: ["apartment"] };
  return w;
}

/** The sections on the budget, read as the player character knows the world, so only plain lines spend it. */
function build(w: WorldDoc, budget: number): SectionsBuilt {
  return buildSections({ registry: reg, world: w, state: startState(w, reg), secrets: [], narrator: { chat: null, view: { knowledge: "pov", secrets: "omit" } }, wording: SECRET_MARK_WORDING, budget, mindsBudget: 1000, texts: {}, said: "", planned: { outcome: ["You look around."], montage: [] }, outline: [], elapsed: 5, hasEntry: () => true, cost: sectionTokens, seen: () => {}, warn: () => {} });
}

describe("a section over what is left of the section budget", () => {
  const w = world();
  const whole = build(w, 1_000_000);
  const place = whole.sections.find((s) => s.slot === "place");
  // What every section ranked before Place spends of the budget.
  const before = whole.sections.filter((s) => s.status === "sent" && s.slot !== "minds" && s.rank < (place?.rank ?? 0)).reduce((sum, s) => sum + (s.tokens ?? 0), 0);

  test("is trimmed by whole lines from its end, its first lines kept and the rest counted as cut, not left out", () => {
    expect(place?.status).toBe("sent");
    const room = Math.floor((place?.tokens ?? 0) / 2);
    const built = build(w, before + room);
    const trimmed = built.sections.find((s) => s.slot === "place");
    expect(trimmed?.status).toBe("sent");
    expect(trimmed?.tokens ?? Infinity).toBeLessThanOrEqual(room);
    const kept = (trimmed?.content ?? "").split("\n");
    const all = (place?.content ?? "").split("\n");
    expect(kept.length).toBeGreaterThan(1);
    expect(all.slice(0, kept.length)).toEqual(kept);
    expect(trimmed?.cut).toBe(all.length - kept.length);
    expect(built.record.find((r) => r.slot === "place")).toMatchObject({ clipped: false, cut: all.length - kept.length });
  });

  test("is left out whole only when its header and first line alone don't fit", () => {
    const built = build(w, before + 1);
    expect(built.sections.find((s) => s.slot === "place")?.status).toBe("clipped");
    expect(built.record.find((r) => r.slot === "place")).toMatchObject({ clipped: true, tokens: place?.tokens });
  });
});
