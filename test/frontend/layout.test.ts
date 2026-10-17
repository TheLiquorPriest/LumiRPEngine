import { describe, expect, test } from "bun:test";
import { hudCentreX, hudFloatRect, hudMode, isMobile, mapFloatRect, overlayPlan, rightGutter, sheetRect } from "../../src/frontend/layout";

const vp = (width: number, coarse = false) => ({ width, height: 844, coarse });

describe("responsive rules", () => {
  test("the HUD collapses below 760 px, not at 760", () => {
    expect(hudMode(vp(759))).toBe("collapsed");
    expect(hudMode(vp(760))).toBe("full");
    expect(hudMode(vp(390))).toBe("collapsed");
    expect(hudMode(vp(1280))).toBe("full");
  });

  test("mobile follows the host: ≤600 px or a coarse pointer", () => {
    expect(isMobile(vp(390))).toBe(true);
    expect(isMobile(vp(600))).toBe(true);
    expect(isMobile(vp(601))).toBe(false);
    expect(isMobile(vp(1024, true))).toBe(true);
  });

  test("opening the map on mobile with the drawer open closes the drawer and goes fullscreen", () => {
    expect(overlayPlan(vp(390), true)).toEqual({ closeDrawer: true, fullscreen: true });
    expect(overlayPlan(vp(326), true)).toEqual({ closeDrawer: true, fullscreen: true });
    expect(overlayPlan(vp(390), false)).toEqual({ closeDrawer: false, fullscreen: true });
    expect(overlayPlan(vp(1024, true), true)).toEqual({ closeDrawer: true, fullscreen: true });
  });

  test("on desktop the drawer stays open and the map is a float", () => {
    expect(overlayPlan(vp(1280), true)).toEqual({ closeDrawer: false, fullscreen: false });
  });

  test("the right gutter covers only the part of a panel under the chat heads, on mobile", () => {
    expect(rightGutter({ x: 0, y: 0, width: 326, height: 800 }, vp(390))).toBe(0);
    expect(rightGutter({ x: 0, y: 0, width: 360, height: 800 }, vp(390))).toBe(34);
    expect(rightGutter({ x: 44, y: 0, width: 346, height: 800 }, vp(390))).toBe(64);
    expect(rightGutter({ x: 0, y: 0, width: 1280, height: 800 }, vp(1280))).toBe(0);
    // Measured mid-slide (partly off-screen): never more than the gutter.
    expect(rightGutter({ x: 390, y: 0, width: 360, height: 800 }, vp(390))).toBe(64);
    expect(rightGutter({ x: 200, y: 0, width: 360, height: 800 }, vp(390))).toBe(64);
  });

  test("the palette sheet sits left of the chat heads at the bottom on mobile and is a centered column on desktop", () => {
    expect(sheetRect(vp(390), 0.6)).toEqual({ x: 0, y: 844 - 506, width: 390 - 64, height: 506 });
    expect(sheetRect({ width: 1280, height: 800, coarse: false }, 0.6)).toEqual({ x: 420, y: 800 - 480 - 12, width: 440, height: 480 });
  });

  test("the desktop map opens 480 × 520 at the top right, and phone and desktop save their geometry apart", () => {
    expect(mapFloatRect({ width: 1280, height: 800, coarse: false })).toEqual({ x: 1280 - 480 - 24, y: 72, width: 480, height: 520, key: "lre-map-desk" });
    expect(mapFloatRect(vp(390)).key).toBe("lre-map-phone");
    expect(mapFloatRect({ width: 1024, height: 800, coarse: true }).key).toBe("lre-map-phone");
  });

  test("the HUD pill opens centred near the top, and phone and desktop save their geometry apart", () => {
    expect(hudFloatRect({ width: 1280, height: 800, coarse: false })).toEqual({ x: 530, y: 64, width: 220, height: 44, key: "lre-hud-desk" });
    expect(hudFloatRect(vp(390))).toEqual({ x: 85, y: 64, width: 220, height: 44, key: "lre-hud-phone" });
    expect(hudFloatRect({ width: 1024, height: 800, coarse: true }).key).toBe("lre-hud-phone");
    // As its content sizes it, the pill stays centred: a 465 px pill at 1280 starts at 408.
    expect(hudCentreX({ width: 1280, height: 800, coarse: false }, 465)).toBe(408);
    expect(hudCentreX(vp(326), 400)).toBe(8);
  });
});
