// Keeping a long live view in reach: while the page is scrolled to its bottom, what streams in below stays
// in view; scrolled up, the page stays where it is, and "Follow the newest" brings it back to the bottom.
// "Back to top" takes the page to the first agent of the tree. The scroller is the nearest ancestor that
// scrolls (in the drawer, Lumiverse's panel), not the view itself, and only it is moved: scrolling an
// element into view would move every scroller around it, the host's frame included.

import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

/** How far from its end a scroller still counts as at its end (px): a fraction of a pixel's rounding is not a scroll up. */
const AT_BOTTOM_PX = 2;

/** The nearest ancestor of `el` that scrolls vertically; the document's own scroller where none does (the web shell's page scrolls). */
export function scrollerOf(el: Element): HTMLElement {
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") return node;
  }
  return (el.ownerDocument.scrollingElement ?? el.ownerDocument.documentElement) as HTMLElement;
}

/** Whether a scroller holds more than it shows, and whether it stands at its bottom. */
export function reach(scroller: HTMLElement): { scrollable: boolean; atBottom: boolean } {
  return { scrollable: scroller.scrollHeight > scroller.clientHeight + AT_BOTTOM_PX, atBottom: Math.ceil(scroller.scrollTop + scroller.clientHeight) >= scroller.scrollHeight - AT_BOTTOM_PX };
}

export interface Follow {
  /** Whether the page holds more than it shows. */
  readonly scrollable: boolean;
  /** Whether the page stands at its bottom: new records stay in view. */
  readonly atBottom: boolean;
  /** Takes the page to the element `first` names inside the view, and stops following the newest. */
  toFirst(first: string): void;
  /** Takes the page to its bottom, where new records stay in view. */
  toNewest(): void;
}

/** The document's own scroller sends its scroll events to the window. */
function isDocument(scroller: HTMLElement): boolean {
  return scroller === scroller.ownerDocument.scrollingElement || scroller === scroller.ownerDocument.documentElement;
}

/**
 * Follows `root`'s page: `content` changes whenever what the view draws does, and the page is taken to its
 * bottom then if it stood there before the change (a page that shows all it holds follows nothing: it is
 * the page's top that matters then). The view's root takes focus (`tabIndex={-1}`) so that a press of
 * "Back to top" leaves focus at the view's start.
 */
export function useFollowNewest(root: RefObject<HTMLElement | null>, content: unknown): Follow {
  const [at, setAt] = useState({ scrollable: false, atBottom: false });
  /** Where the page stood before what it holds last changed: read by the effect that follows the change. */
  const stood = useRef(false);
  const measure = (scroller: HTMLElement): void => {
    const now = reach(scroller);
    stood.current = now.scrollable && now.atBottom;
    setAt((was) => (was.scrollable === now.scrollable && was.atBottom === now.atBottom ? was : now));
  };
  useEffect(() => {
    const el = root.current;
    if (el === null) return;
    const scroller = scrollerOf(el);
    const target: EventTarget = isDocument(scroller) ? (el.ownerDocument.defaultView ?? window) : scroller;
    const heard = (): void => measure(scroller);
    heard();
    target.addEventListener("scroll", heard, { passive: true });
    window.addEventListener("resize", heard);
    return () => {
      target.removeEventListener("scroll", heard);
      window.removeEventListener("resize", heard);
    };
  }, []);
  useEffect(() => {
    const el = root.current;
    if (el === null) return;
    const scroller = scrollerOf(el);
    if (stood.current) scroller.scrollTop = scroller.scrollHeight;
    // What the change added may have made the page scroll, or no longer.
    const now = reach(scroller);
    setAt((was) => (was.scrollable === now.scrollable && was.atBottom === now.atBottom ? was : now));
  }, [content]);
  return {
    ...at,
    toFirst(first) {
      const el = root.current;
      const target = el?.querySelector(first);
      if (el === null || el === undefined || target === null || target === undefined) return;
      const scroller = scrollerOf(el);
      // The page leaves the bottom, so what streams in no longer moves it.
      stood.current = false;
      setAt((was) => ({ ...was, atBottom: false }));
      // What sticks at the top of the scroller covers its first rows: the target's own scroll margin says how much.
      const covered = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
      const port = isDocument(scroller) ? 0 : scroller.getBoundingClientRect().top + scroller.clientTop;
      scroller.scrollTop += target.getBoundingClientRect().top - port - covered;
      target.querySelector("summary")?.focus({ preventScroll: true });
    },
    toNewest() {
      const el = root.current;
      if (el === null) return;
      const scroller = scrollerOf(el);
      stood.current = true;
      setAt((was) => ({ ...was, atBottom: true }));
      scroller.scrollTop = scroller.scrollHeight;
    },
  };
}
