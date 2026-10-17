// Responsive layout rules (DESIGN §12). Pure, so the rules are tested without a browser.

/** The HUD pill collapses to time only below this layout width (DESIGN §12). */
export const HUD_COLLAPSE_BELOW = 760;

/** The host's mobile breakpoint (`MOBILE_VIEWPORT_BREAKPOINT`, `frontend/src/lib/mobile.ts`). */
export const HOST_MOBILE_MAX = 600;

/** Width the host's chat-head bubbles cover at the right edge of a narrow viewport (DESIGN §12). */
export const CHAT_HEAD_GUTTER = 64;

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
 * Right padding that keeps a panel's content clear of the chat-head bubbles: on mobile, whatever
 * part of the panel lies in the viewport's right gutter, never more than the gutter itself (a panel
 * measured mid-slide, partly off-screen, must not squeeze its content). Zero on desktop.
 */
export function rightGutter(panel: Rect, viewport: Viewport): number {
  if (!isMobile(viewport)) return 0;
  const right = Math.min(panel.x + panel.width, viewport.width);
  return Math.min(CHAT_HEAD_GUTTER, Math.max(0, Math.ceil(right - (viewport.width - CHAT_HEAD_GUTTER))));
}

/** The palette bottom sheet: on mobile the full width left of the chat-head gutter, a centered 440 px column on desktop. */
export function sheetRect(viewport: Viewport, heightFraction: number): Rect {
  const height = Math.round(Math.min(viewport.height * heightFraction, viewport.height - 24));
  if (isMobile(viewport)) return { x: 0, y: viewport.height - height, width: viewport.width - CHAT_HEAD_GUTTER, height };
  const width = Math.min(440, viewport.width - 24);
  return { x: Math.round((viewport.width - width) / 2), y: viewport.height - height - 12, width, height };
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
