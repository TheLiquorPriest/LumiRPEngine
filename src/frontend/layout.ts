// Responsive layout rules (DESIGN §12). Pure, so the rules are tested without a browser.

import { headGutters } from "./chat-heads";

/** The HUD pill collapses to time only below this layout width (DESIGN §12). */
export const HUD_COLLAPSE_BELOW = 760;

/** The host's mobile breakpoint (`MOBILE_VIEWPORT_BREAKPOINT`, `frontend/src/lib/mobile.ts`). */
export const HOST_MOBILE_MAX = 600;

export interface Viewport {
  width: number;
  height: number;
  /** `(pointer: coarse)`: the host treats touch devices as mobile at any width. */
  coarse: boolean;
}

/** The host overlays the drawer above everything on mobile, float widgets included (DESIGN §12). */
export function isMobile(viewport: Viewport): boolean {
  return viewport.coarse || viewport.width <= HOST_MOBILE_MAX;
}

export type HudMode = "full" | "collapsed";

export function hudMode(viewport: Viewport): HudMode {
  return viewport.width < HUD_COLLAPSE_BELOW ? "collapsed" : "full";
}

export interface OverlayPlan {
  /** Close the host drawer first: on mobile it stacks above float widgets, even fullscreen ones. */
  closeDrawer: boolean;
  /** Fill the viewport (mobile) or keep a resizable float (desktop). */
  fullscreen: boolean;
}

/**
 * How to open a float overlay (the map, the palette sheet): on a mobile viewport with the drawer
 * open, the drawer must close or the overlay receives no input; mobile overlays go fullscreen.
 */
export function overlayPlan(viewport: Viewport, drawerOpen: boolean): OverlayPlan {
  const mobile = isMobile(viewport);
  return { closeDrawer: mobile && drawerOpen, fullscreen: mobile };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A bottom sheet (the palette, the World sheet) `height` px tall, never taller than the viewport less
 * 24 px. On mobile it spans the width less what the host's chat heads actually cover of it (they
 * are usually absent, and anywhere when present); on desktop it is a centred 440 px column.
 */
export function sheetRect(viewport: Viewport, height: number, heads: readonly Rect[] = []): Rect {
  const tall = Math.round(Math.min(height, viewport.height - 24));
  if (!isMobile(viewport)) {
    const width = Math.min(440, viewport.width - 24);
    return { x: Math.round((viewport.width - width) / 2), y: viewport.height - tall - 12, width, height: tall };
  }
  const full: Rect = { x: 0, y: viewport.height - tall, width: viewport.width, height: tall };
  const gutters = headGutters(full, heads);
  return { x: gutters.left, y: full.y, width: full.width - gutters.left - gutters.right, height: tall };
}

/**
 * The map's float widget on desktop: at most 480 × 520, near the top right. Phone and desktop
 * keep their own saved geometry, so a size saved on a 390 px phone never opens the desktop map at
 * 366 px.
 */
export function mapFloatRect(viewport: Viewport): Rect & { key: string } {
  const width = Math.min(480, viewport.width - 24);
  const height = Math.min(520, viewport.height - 120);
  return { x: Math.max(12, viewport.width - width - 24), y: 72, width, height, key: isMobile(viewport) ? "lre-map-phone" : "lre-map-desk" };
}

/** Left edge that centres a HUD pill `width` px wide in the viewport. */
export function hudCentreX(viewport: Viewport, width: number): number {
  return Math.max(8, Math.round((viewport.width - width) / 2));
}

/**
 * The HUD pill's float widget: 220 × 44, centred near the top (it re-centres as its content sizes
 * it, until the player moves it). Phone and desktop keep their own saved geometry, so a pill placed
 * on a 390 px phone never opens the desktop pill off-centre.
 */
export function hudFloatRect(viewport: Viewport): Rect & { key: string } {
  return { x: hudCentreX(viewport, 220), y: 64, width: 220, height: 44, key: isMobile(viewport) ? "lre-hud-phone" : "lre-hud-desk" };
}
