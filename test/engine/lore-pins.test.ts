// Lore pins (DESIGN §24.5): a pin that keeps the end of an entry that doesn't fit keeps its last
// part, so a timeline written oldest first keeps its newest events.

import { expect, test } from "bun:test";
import { blankWorld } from "../../src/engine/authoring";
import { fitPins, pinsFor, worldPinText } from "../../src/engine/lore-pins";
import { createRegistry } from "../../src/engine/registry-impl";
import type { WorldDoc } from "../../src/shared/world";
import { ALL_PACKS } from "../../src/packs/index";
import { startState } from "../packs/support";

const registry = createRegistry(ALL_PACKS);
const tokens = (text: string): number => Math.ceil(text.length / 4);

/** A world with a long timeline, oldest year first, pinned to the brief step with `keep`. */
function timeline(keep?: "start" | "end"): WorldDoc {
  const w = blankWorld("w_pins", "Pins");
  const years = Array.from({ length: 40 }, (_, i) => `In ${1980 + i} the harbor ${i % 2 === 0 ? "flooded again" : "held through the storms"}.`);
  w.lore.timeline = { id: "timeline", title: "Harbor timeline", content: years.join(" "), keys: [], links: [] };
  w.lorePins = JSON.parse(JSON.stringify({ characters: {}, places: {}, steps: { brief: [{ lore: "timeline", ...(keep ? { keep } : {}) }] } }));
  return w;
}

function pinned(w: WorldDoc): string {
  const state = startState(w, registry);
  const texts = pinsFor(w, null, undefined, ["brief"]).flatMap((r) => worldPinText(w, r) ?? []);
  return fitPins({ reg: registry, world: w, state, tokens }, texts, 60, () => true)[0]?.snippet ?? "";
}

test("a pin that keeps the end gives the last part of a long entry, the start-keeping one its first", () => {
  const end = pinned(timeline("end"));
  expect(end).toContain("2019");
  expect(end).not.toContain("1980");
  const start = pinned(timeline());
  expect(start).toContain("1980");
  expect(start).not.toContain("2019");
});
