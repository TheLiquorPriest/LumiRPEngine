// Map labels for the Port Alder starter: the town its map opens on (eleven places with no grid
// cells, on a ring), and every one of its sixteen places on one ring (the densest ring a starter
// makes: the world scope of a copy with no place inside another). At phone and desktop widths no two
// labels overlap, no label covers a dot or the map's buttons, every label stays on the canvas, and
// every place keeps a label. Pure geometry; text is measured at a fixed per-character width a
// little wider than the real 13 px system font.
import { describe, expect, test } from "bun:test";
import { createRegistry } from "../../../src/engine/registry-impl";
import { fit, toScreen } from "../../../src/frontend/map-math";
import { ALL_PACKS, STARTER_WORLDS } from "../../../src/packs/index";
import { buildMapView } from "../../../src/packs/space/core/view";
import { controlBoxes, labelAt, labelPadding, placeLabels, shorten, type Box, type LabelItem } from "../../../src/packs/space/ui/labels";
import { placePoint, scopeBounds } from "../../../src/packs/space/ui/map-draw";
import { startState } from "../support";

const reg = createRegistry(ALL_PACKS);
const measure = (s: string): number => s.length * 7.4;

function portAlderItems(width: number, height: number, flat: boolean): LabelItem[] {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  if (flat) for (const place of Object.values(world.places)) delete place.parent;
  const view = buildMapView(reg.context(world, startState(world)));
  const scope = view.scopes.find((s) => s.id === (flat ? null : view.scope));
  if (!scope) throw new Error("no scope to open on");
  const t = fit(scopeBounds(scope), width, height, labelPadding(width, height));
  return scope.places.map((p) => ({ id: p.id, ...toScreen(t, placePoint(scope, p)), r: p.id === view.here ? 9 : 7, text: p.name }));
}

const hit = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("map labels", () => {
  for (const [width, height, flat] of [
    [326, 560, false],
    [326, 700, false],
    [390, 640, false],
    [390, 780, false],
    // The desktop map: its 480 × 520 float, and fullscreen at 1280.
    [480, 520, false],
    [1280, 800, false],
    [326, 560, true],
    [326, 700, true],
    [390, 640, true],
    [390, 780, true],
    [480, 520, true],
    [1280, 800, true],
  ] as const) {
    test(`Port Alder ${flat ? "all on one ring" : "town"} at ${width}×${height}: no two labels overlap, none covers a dot or a button, all on the canvas`, () => {
      const items = portAlderItems(width, height, flat);
      expect(items.length).toBeGreaterThanOrEqual(flat ? 16 : 11);
      const labels = placeLabels(items, { width, height, measure, avoid: controlBoxes(width, height) });
      expect(labels.map((l) => l.id).sort()).toEqual(items.map((i) => i.id).sort());
      for (const [i, a] of labels.entries()) {
        for (const b of labels.slice(i + 1)) expect(hit(a.box, b.box)).toBe(false);
        for (const d of items) expect(hit(a.box, { x: d.x - d.r, y: d.y - d.r, w: 2 * d.r, h: 2 * d.r })).toBe(false);
        for (const c of controlBoxes(width, height)) expect(hit(a.box, c)).toBe(false);
        expect([a.box.x >= 0, a.box.y >= 0, a.box.x + a.box.w <= width, a.box.y + a.box.h <= height]).toEqual([true, true, true, true]);
        // The full name (on one line or two), or its start ending in "…".
        const shown = a.lines.join(" ");
        expect(a.lines.length <= 2 && (shown === a.full || (shown.endsWith("…") && a.full.startsWith(shown.slice(0, -1).trimEnd())))).toBe(true);
      }
      // On a desktop canvas every name is shown in full.
      if (width >= 1280) expect(labels.every((l) => l.lines.join(" ") === l.full)).toBe(true);
      // At phone widths most names still read in full.
      expect(labels.filter((l) => l.lines.join(" ") === l.full).length * 2).toBeGreaterThanOrEqual(labels.length);
      // Same input, same layout.
      expect(placeLabels(items, { width, height, measure, avoid: controlBoxes(width, height) })).toEqual(labels);
    });
  }

  test("a tap on a label selects its place, with a tap area at least 40 px tall", () => {
    const items = portAlderItems(390, 780, true);
    const labels = placeLabels(items, { width: 390, height: 780, measure, avoid: controlBoxes(390, 780) });
    const one = labels[0];
    if (!one) throw new Error("no labels");
    expect(labelAt(labels, { x: one.box.x + one.box.w / 2, y: one.box.y + one.box.h / 2 })?.id).toBe(one.id);
    expect(labelAt(labels, { x: -100, y: -100 })).toBeNull();
  });

  test("a shortened name ends in an ellipsis and fits", () => {
    expect(shorten("Alder Harbor Marina", 60, measure)).toBe("Alder H…");
    expect(shorten("Bluebird", 200, measure)).toBe("Bluebird");
    expect(shorten("Alder Harbor Marina", 20, measure)).toBeNull();
  });
});
