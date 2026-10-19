import { describe, expect, test } from "bun:test";
import { hudCentreX, hudFloatRect, hudMode, isMobile, mapFloatRect, overlayPlan, sheetRect } from "../../src/frontend/layout";

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

  test("on a phone a bottom sheet spans the width when no chat head covers it; on desktop it is a centred column", () => {
    expect(sheetRect(vp(390), 506)).toEqual({ x: 0, y: 844 - 506, width: 390, height: 506 });
    expect(sheetRect({ width: 1280, height: 800, coarse: false }, 480)).toEqual({ x: 420, y: 800 - 480 - 12, width: 440, height: 480 });
    // Never taller than the viewport less 24 px.
    expect(sheetRect(vp(390), 2000).height).toBe(820);
  });

  test("a chat head over a phone sheet narrows it by the overlap; a head above it, or on desktop, changes nothing", () => {
    const right = { x: 330, y: 500, width: 52, height: 52 };
    expect(sheetRect(vp(390), 506, [right])).toEqual({ x: 0, y: 338, width: 390 - 68, height: 506 });
    const left = { x: 8, y: 700, width: 52, height: 52 };
    expect(sheetRect(vp(390), 506, [left])).toEqual({ x: 68, y: 338, width: 390 - 68, height: 506 });
    expect(sheetRect(vp(390), 506, [{ ...right, y: 120 }])).toEqual({ x: 0, y: 338, width: 390, height: 506 });
    expect(sheetRect({ width: 1280, height: 800, coarse: false }, 480, [{ x: 1220, y: 500, width: 52, height: 52 }]).width).toBe(440);
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
