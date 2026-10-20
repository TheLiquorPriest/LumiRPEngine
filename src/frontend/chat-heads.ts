// Host chat heads (avatars of other chats with background replies) float above the drawer; they can
// be switched off, dragged anywhere and resized, and are usually absent. The drawer keeps its
// content clear of them only while they actually overlap it, by as much as they do, instead of a
// fixed gutter.

import type { Rect } from "./layout";
import type { Readable } from "./store";
import { createStore } from "./store";

/** Breathing room between a chat head and the content it would otherwise cover. */
const HEAD_ROOM = 8;

/** Heads move on drags and on every streaming re-layout; measuring at most this often keeps a busy chat cheap. */
const MEASURE_MS = 150;

/**
 * How far heads reach into the panel from its nearer side edge, plus breathing room: a head right of
 * the panel's centre pads the right, one left of it the left. A head that doesn't overlap the panel
 * counts for nothing, and neither side takes more than half the panel, so a head dragged into the
 * middle can't squeeze the content away.
 */
export function headGutters(panel: Rect, heads: readonly Rect[]): { left: number; right: number } {
  const panelRight = panel.x + panel.width;
  const panelBottom = panel.y + panel.height;
  const centre = panel.x + panel.width / 2;
  let left = 0;
  let right = 0;
  for (const head of heads) {
    const headRight = head.x + head.width;
    const overlaps = Math.min(panelRight, headRight) > Math.max(panel.x, head.x) && Math.min(panelBottom, head.y + head.height) > Math.max(panel.y, head.y);
    if (!overlaps) continue;
    if (head.x + head.width / 2 >= centre) right = Math.max(right, panelRight - head.x + HEAD_ROOM);
    else left = Math.max(left, headRight - panel.x + HEAD_ROOM);
  }
  const most = panel.width / 2;
  return { left: Math.ceil(Math.min(left, most)), right: Math.ceil(Math.min(right, most)) };
}

/**
 * The rects of the host's chat heads (`[data-head-idx]`), `[]` when there are none or all are hidden.
 * `measure` gives an element's rect in the space the caller measures its panel in (the host's layout
 * pixels); by default the rendered client rect.
 */
export function watchChatHeads(measure: (el: Element) => Rect = (el) => el.getBoundingClientRect()): Readable<Rect[]> & { dispose(): void } {
  const heads = createStore<Rect[]>([]);
  const measureHeads = (): void => {
    const next = [...document.querySelectorAll("[data-head-idx]")].flatMap((el) => {
      const r = measure(el);
      return r.width > 0 && r.height > 0 ? [{ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }] : [];
    });
    const last = heads.get();
    const moved = next.length !== last.length || next.some((r, i) => r.x !== last[i]?.x || r.y !== last[i]?.y || r.width !== last[i]?.width || r.height !== last[i]?.height);
    if (moved) heads.set(next);
  };
  measureHeads();
  let pending = false;
  let disposed = false;
  const schedule = (): void => {
    if (pending || disposed) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      if (!disposed) measureHeads();
    }, MEASURE_MS);
  };
  // Heads come and go as elements, and move or resize through their style and class.
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden", "data-head-idx"] });
  window.addEventListener("resize", schedule);
  return {
    get: heads.get,
    subscribe: heads.subscribe,
    dispose() {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    },
  };
}
