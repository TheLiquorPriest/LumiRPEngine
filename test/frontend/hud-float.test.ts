import { describe, expect, test } from "bun:test";
import { HudFloat } from "../../src/frontend/hud-float";
import type { Viewport } from "../../src/frontend/layout";

interface Widget {
  key: string;
  x: number;
  destroyed: boolean;
}

function probe(start: Viewport) {
  let viewport = start;
  const made: Widget[] = [];
  const hud = new HudFloat<Widget>({
    viewport: () => viewport,
    create(rect) {
      const widget = { key: rect.key, x: rect.x, destroyed: false };
      made.push(widget);
      return widget;
    },
    destroy(widget) {
      widget.destroyed = true;
    },
  });
  return { hud, made, resize: (next: Viewport) => (viewport = next) };
}

const PHONE: Viewport = { width: 390, height: 844, coarse: false };
const DESK: Viewport = { width: 1280, height: 800, coarse: false };

describe("HUD pill across the phone breakpoint", () => {
  test("widening a phone window moves the pill to the desktop layout's geometry, and back", () => {
    const { hud, made, resize } = probe(PHONE);
    expect(hud.ensure().key).toBe("lre-hud-phone");
    resize(DESK);
    expect(hud.relayout()).toBe(true);
    expect(made[0]?.destroyed).toBe(true);
    expect(hud.get()).toBeNull();
    expect(hud.ensure()).toMatchObject({ key: "lre-hud-desk", x: 530, destroyed: false });
    resize(PHONE);
    expect(hud.relayout()).toBe(true);
    expect(hud.ensure().key).toBe("lre-hud-phone");
    expect(made.map((w) => w.destroyed)).toEqual([true, true, false]);
  });

  test("a resize within one layout, or before the pill exists, keeps it as it is", () => {
    const { hud, made, resize } = probe(DESK);
    expect(hud.relayout()).toBe(false);
    const widget = hud.ensure();
    resize({ ...DESK, width: 900 });
    expect(hud.relayout()).toBe(false);
    expect(hud.ensure()).toBe(widget);
    expect(made).toHaveLength(1);
    // A touch device is a phone at any width.
    resize({ ...DESK, coarse: true });
    expect(hud.relayout()).toBe(true);
    expect(hud.ensure().key).toBe("lre-hud-phone");
  });
});
