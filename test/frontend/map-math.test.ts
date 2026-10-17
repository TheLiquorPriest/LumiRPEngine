import { describe, expect, test } from "bun:test";
import { fit, GestureTracker, hitTest, pinch, TAP_MS, toScreen, toWorld, wheelFactor, ZOOM_MAX, ZOOM_MIN, zoomAt } from "../../src/frontend/map-math";
import type { Transform } from "../../src/frontend/map-math";

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);

describe("transforms", () => {
  test("screen and world round-trip", () => {
    const t: Transform = { x: 30, y: -12, k: 2.5 };
    const p = { x: 101, y: 57 };
    const back = toScreen(t, toWorld(t, p));
    close(back.x, p.x);
    close(back.y, p.y);
  });

  test("zooming keeps the world point under the focal point fixed", () => {
    const t: Transform = { x: 40, y: 10, k: 1.3 };
    const focal = { x: 200, y: 150 };
    const before = toWorld(t, focal);
    const zoomed = zoomAt(t, focal, 1.8);
    const after = toWorld(zoomed, focal);
    close(zoomed.k, 1.3 * 1.8);
    close(after.x, before.x);
    close(after.y, before.y);
  });

  test("zoom clamps to [ZOOM_MIN, ZOOM_MAX] and still pins the focal point", () => {
    const t: Transform = { x: 0, y: 0, k: 3 };
    const focal = { x: 50, y: 60 };
    const big = zoomAt(t, focal, 10);
    expect(big.k).toBe(ZOOM_MAX);
    close(toWorld(big, focal).x, toWorld(t, focal).x);
    expect(zoomAt({ x: 0, y: 0, k: 0.5 }, focal, 0.01).k).toBe(ZOOM_MIN);
  });

  test("wheel up zooms in, down zooms out; line mode scales like pixels × 16", () => {
    expect(wheelFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0)).toBeLessThan(1);
    close(wheelFactor(3, 1), wheelFactor(48, 0));
  });

  test("pinch: spreading fingers doubles zoom about the midpoint; moving both pans", () => {
    const t: Transform = { x: 0, y: 0, k: 1 };
    const spread = pinch(t, [{ x: 90, y: 100 }, { x: 110, y: 100 }], [{ x: 80, y: 100 }, { x: 120, y: 100 }]);
    close(spread.k, 2);
    const mid = { x: 100, y: 100 };
    close(toWorld(spread, mid).x, toWorld(t, mid).x);
    const moved = pinch(t, [{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 5, y: 7 }, { x: 15, y: 7 }]);
    expect(moved).toEqual({ x: 5, y: 7, k: 1 });
  });

  test("fit centers the bounds inside the padding", () => {
    const t = fit({ minX: 0, minY: 0, maxX: 400, maxY: 200 }, 220, 420, 10);
    close(t.k, 0.5);
    const center = toScreen(t, { x: 200, y: 100 });
    close(center.x, 110);
    close(center.y, 210);
  });

  test("hitTest picks the nearest item within the radius, in screen space", () => {
    const t: Transform = { x: 0, y: 0, k: 2 };
    const places = [
      { id: "a", x: 10, y: 10 },
      { id: "b", x: 14, y: 10 },
    ];
    expect(hitTest(t, places, { x: 27, y: 20 }, 12)?.id).toBe("b");
    expect(hitTest(t, places, { x: 100, y: 100 }, 12)).toBeNull();
  });
});

describe("gesture tracker", () => {
  test("a short still press is a tap", () => {
    const g = new GestureTracker();
    g.down(1, { x: 50, y: 50 }, 0);
    g.move(1, { x: 53, y: 52 });
    expect(g.up(1, { x: 53, y: 52 }, 120).tap).toEqual({ x: 53, y: 52 });
    expect(g.transform.x).toBe(3);
  });

  test("a drag pans and is not a tap, even if it returns to the start", () => {
    const g = new GestureTracker();
    g.down(1, { x: 0, y: 0 }, 0);
    g.move(1, { x: 40, y: 30 });
    g.move(1, { x: 0, y: 0 });
    const end = g.up(1, { x: 0, y: 0 }, 100);
    expect(end.tap).toBeNull();
    g.down(2, { x: 0, y: 0 }, 200);
    g.move(2, { x: 70, y: 50 });
    expect(g.up(2, { x: 70, y: 50 }, 300).transform).toEqual({ x: 70, y: 50, k: 1 });
  });

  test("a long press is not a tap", () => {
    const g = new GestureTracker();
    g.down(1, { x: 0, y: 0 }, 0);
    expect(g.up(1, { x: 0, y: 0 }, TAP_MS + 1).tap).toBeNull();
  });

  test("two fingers pinch-zoom and never end in a tap", () => {
    const g = new GestureTracker();
    g.down(1, { x: 90, y: 100 }, 0);
    g.down(2, { x: 110, y: 100 }, 10);
    g.move(2, { x: 130, y: 100 });
    close(g.transform.k, 2);
    expect(g.up(2, { x: 130, y: 100 }, 50).tap).toBeNull();
    expect(g.up(1, { x: 90, y: 100 }, 60).tap).toBeNull();
  });

  test("a cancelled pointer ends the gesture without a tap", () => {
    const g = new GestureTracker();
    g.down(1, { x: 0, y: 0 }, 0);
    g.cancel(1);
    expect(g.up(1, { x: 0, y: 0 }, 10).tap).toBeNull();
  });

  test("wheel zooms about the cursor", () => {
    const g = new GestureTracker({ x: 0, y: 0, k: 1 });
    const focal = { x: 120, y: 80 };
    const t = g.wheel(focal, -200, 0);
    expect(t.k).toBeGreaterThan(1);
    close(toWorld(t, focal).x, 120);
    close(toWorld(t, focal).y, 80);
  });
});
