// Map and grid gesture math (DESIGN §12): pan, wheel and pinch zoom about a focal point, and taps.
// Pure: a pointer stream in, a transform and taps out. `screen = world * k + (x, y)`.

export interface Point {
  x: number;
  y: number;
}

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
/** A press that moves less than this (layout px) and ends within TAP_MS is a tap. */
export const TAP_SLOP = 8;
export const TAP_MS = 500;

export const IDENTITY: Transform = { x: 0, y: 0, k: 1 };

export function toWorld(t: Transform, p: Point): Point {
  return { x: (p.x - t.x) / t.k, y: (p.y - t.y) / t.k };
}

export function toScreen(t: Transform, p: Point): Point {
  return { x: p.x * t.k + t.x, y: p.y * t.k + t.y };
}

/** Scales by `factor` about a screen point, which stays over the same world point; zoom is clamped. */
export function zoomAt(t: Transform, focal: Point, factor: number): Transform {
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, t.k * factor));
  const ratio = k / t.k;
  return { k, x: focal.x - (focal.x - t.x) * ratio, y: focal.y - (focal.y - t.y) * ratio };
}

/** Wheel delta to a zoom factor: smooth for trackpads, ~10% per mouse notch. */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-pixels * 0.0015);
}

/**
 * Two-finger step: the world point under the previous midpoint follows the new midpoint, scaled
 * by the change in finger distance.
 */
export function pinch(t: Transform, before: readonly [Point, Point], after: readonly [Point, Point]): Transform {
  const d0 = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
  const d1 = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
  const m0 = { x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2 };
  const m1 = { x: (after[0].x + after[1].x) / 2, y: (after[0].y + after[1].y) / 2 };
  const panned = { ...t, x: t.x + m1.x - m0.x, y: t.y + m1.y - m0.y };
  return d0 > 0 ? zoomAt(panned, m1, d1 / d0) : panned;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Centers `bounds` in a `width × height` viewport with `padding`, zoom clamped. */
export function fit(bounds: Bounds, width: number, height: number, padding: number): Transform {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min((width - padding * 2) / w, (height - padding * 2) / h)));
  return { k, x: width / 2 - (bounds.minX + w / 2) * k, y: height / 2 - (bounds.minY + h / 2) * k };
}

/** The nearest item within `radius` screen px of a screen point, or null. */
export function hitTest<T extends Point>(t: Transform, items: readonly T[], screen: Point, radius: number): T | null {
  let best: T | null = null;
  let bestDistance = radius;
  for (const item of items) {
    const p = toScreen(t, item);
    const distance = Math.hypot(p.x - screen.x, p.y - screen.y);
    if (distance <= bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

interface Contact {
  start: Point;
  last: Point;
  at: number;
}

export interface GestureResult {
  transform: Transform;
  /** A completed tap at this screen point. */
  tap: Point | null;
}

/**
 * Tracks pointers (Pointer Events: mouse, pen, touch alike). One contact pans, two pinch; a press
 * that never leaves TAP_SLOP and lifts within TAP_MS while it is the only contact is a tap. Once a
 * second finger lands, the gesture can no longer end in a tap.
 */
export class GestureTracker {
  private readonly contacts = new Map<number, Contact>();
  private tapEligible = false;

  constructor(public transform: Transform = IDENTITY) {}

  down(id: number, p: Point, at: number): GestureResult {
    this.contacts.set(id, { start: p, last: p, at });
    this.tapEligible = this.contacts.size === 1;
    return { transform: this.transform, tap: null };
  }

  move(id: number, p: Point): GestureResult {
    const contact = this.contacts.get(id);
    if (!contact) return { transform: this.transform, tap: null };
    if (Math.hypot(p.x - contact.start.x, p.y - contact.start.y) > TAP_SLOP) this.tapEligible = false;
    if (this.contacts.size === 1) {
      this.transform = { ...this.transform, x: this.transform.x + p.x - contact.last.x, y: this.transform.y + p.y - contact.last.y };
    } else if (this.contacts.size === 2) {
      const other = [...this.contacts.entries()].find(([key]) => key !== id)?.[1];
      if (other) this.transform = pinch(this.transform, [contact.last, other.last], [p, other.last]);
    }
    contact.last = p;
    return { transform: this.transform, tap: null };
  }

  up(id: number, p: Point, at: number): GestureResult {
    const contact = this.contacts.get(id);
    if (!contact) return { transform: this.transform, tap: null };
    this.contacts.delete(id);
    const tapped = this.tapEligible && this.contacts.size === 0 && at - contact.at <= TAP_MS && Math.hypot(p.x - contact.start.x, p.y - contact.start.y) <= TAP_SLOP;
    if (this.contacts.size === 0) this.tapEligible = false;
    return { transform: this.transform, tap: tapped ? p : null };
  }

  cancel(id: number): void {
    this.contacts.delete(id);
    this.tapEligible = false;
  }

  wheel(focal: Point, deltaY: number, deltaMode: number): Transform {
    this.transform = zoomAt(this.transform, focal, wheelFactor(deltaY, deltaMode));
    return this.transform;
  }
}
