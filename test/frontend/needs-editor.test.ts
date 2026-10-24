// Build → Needs (DESIGN §8): one name per need wherever it shows (the page, its hint, Play's Needs),
// each number said in words with its value, and a need switched off showing none. The page is walked
// as a rendered tree (no DOM), as the other controls' tests do.

import { describe, expect, test } from "bun:test";
import { NumberStepper, Seg } from "../../src/frontend/components";
import { PART_INFO } from "../../src/frontend/build/chrome";
import { FormGroup } from "../../src/frontend/build/form-kit";
import { NeedsFields } from "../../src/frontend/build/needs-editor";
import { createRegistry } from "../../src/engine/registry-impl";
import { Working } from "../../src/engine/working";
import { ALL_PACKS } from "../../src/packs/index";
import { buildNeedsView } from "../../src/packs/castlife/core/index";
import { NEED_DEFAULTS, NEED_IDS, type NeedId, type NeedTuning } from "../../src/shared/needs";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";
import { press, propsOf } from "../support/tree";

type Needs = Record<NeedId, NeedTuning>;

/** The page's fields for `value`, and what its last change asked for. */
function page(value: Needs): { tree: unknown; changed: () => Needs | null } {
  let next: Needs | null = null;
  const tree = NeedsFields({ value, lint: [], disabled: false, onChange: (v) => (next = v) });
  return { tree, changed: () => next };
}

const defaults = (): Needs => structuredClone(NEED_DEFAULTS) as Needs;

describe("Build → Needs", () => {
  test("each need goes by one name: the page's, its hint's and Play's", () => {
    const titles = propsOf(page(defaults()).tree, FormGroup).map((p) => String(p.title));
    const world = modernUsWorld("w", "R");
    world.realism.levels.castlife = 4;
    const play = buildNeedsView(new Working(createRegistry(ALL_PACKS), world, startState(world)).ctx)?.needs.map((n) => n.name);
    expect(titles).toEqual(play ?? []);
    for (const title of titles) expect(PART_INFO.needs.hint.toLowerCase()).toContain(title.toLowerCase());
  });

  test("every number reads with its value, and follows it as it changes", () => {
    const first = page(defaults());
    const steppers = propsOf(first.tree, NumberStepper);
    expect(steppers).toHaveLength(NEED_IDS.length * 3);
    for (const s of steppers) expect(String(s.label)).toContain(String(s.value));
    // The page's first number, hunger's growth (4 by default), raised to 6: the page asks for 6 and says it.
    const rate = steppers[0];
    if (!rate) throw new Error("no number");
    press(rate, 6);
    const after = first.changed();
    expect(after?.hunger.rate).toBe(6);
    const again = propsOf(page(after ?? defaults()).tree, NumberStepper)[0];
    expect(String(again?.label)).toContain("6");
    expect(String(again?.label)).not.toBe(String(rate.label));
  });

  test("a need switched off shows no numbers", () => {
    const first = page(defaults());
    // Each need's On/Off sits in its header, named for the need.
    const second = propsOf(first.tree, FormGroup)[1];
    const fatigue = propsOf(second?.aside, Seg)[0];
    if (!fatigue) throw new Error("no on/off for the second need");
    expect(fatigue.label).toBe(second?.title);
    press(fatigue, "off");
    const off = first.changed();
    expect(off?.fatigue.on).toBe(false);
    expect(propsOf(page(off ?? defaults()).tree, NumberStepper)).toHaveLength((NEED_IDS.length - 1) * 3);
  });
});
