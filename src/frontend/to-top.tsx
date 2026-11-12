// "Back to top" for the long live views (GM → Live, Play → Now's preparation): on a phone a long
// feed is many screens of thumb-scrolling, so once the panel the view sits in is well down, a button
// brings it back to the top in one press. The scroller is the host panel the view sits inside (as
// the views' own follow logic finds it), not the view itself.

import type { RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Button } from "./components";
import { scrollParent } from "./scroll";

/** How far down the panel must be, in heights of what shows, before the button shows: a screen and a half, so a short scroll doesn't bring it up. */
export const TO_TOP_SCREENS = 1.5;

/** Where a scroller stands: how far it is scrolled down (px), how tall its view is (px), and whether it holds more than shows. */
export interface ScrollAt {
  top: number;
  height: number;
  scrollable: boolean;
}

/** Whether "Back to top" shows: only where the view can scroll, once it is a screen and a half from its top; below that it goes again. */
export function showsToTop(at: ScrollAt): boolean {
  // A panel that isn't showing (a closed drawer, another tab) has no height: nothing to bring back.
  return at.scrollable && at.height > 0 && at.top >= at.height * TO_TOP_SCREENS;
}

/**
 * Whether "Back to top" shows for the view at `root`, and what pressing it does. `key` changes when
 * the view's root comes or goes (a view drawn only once it has loaded), so the scroller is found again.
 * `root` should take focus (`tabIndex={-1}`): the button leaves near the top, and focus waits at the
 * view's start rather than being lost to the page.
 */
export function useToTop(root: RefObject<HTMLElement | null>, key: unknown): { shown: boolean; toTop(): void } {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const scroller = root.current ? scrollParent(root.current) : null;
    if (!scroller) {
      setShown(false);
      return;
    }
    const heard = (): void => setShown(showsToTop({ top: scroller.scrollTop, height: scroller.clientHeight, scrollable: scroller.scrollHeight > scroller.clientHeight }));
    heard();
    scroller.addEventListener("scroll", heard, { passive: true });
    // Turning the phone or its keyboard opening changes the height that shows without a scroll.
    window.addEventListener("resize", heard);
    return () => {
      scroller.removeEventListener("scroll", heard);
      window.removeEventListener("resize", heard);
    };
  }, [key]);
  const toTop = (): void => {
    const el = root.current;
    const scroller = el ? scrollParent(el) : null;
    if (!el || !scroller) return;
    // Nothing moves under reduced motion: the jump is instant there.
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    scroller.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  };
  return { shown, toTop };
}

/** The button itself, a sibling of the view's other foot buttons (GM → Live's "Follow the newest"). */
export function ToTopButton(props: { onClick(): void }) {
  return (
    <Button size="sm" icon="chevron-up" onClick={() => props.onClick()}>
      Back to top
    </Button>
  );
}
