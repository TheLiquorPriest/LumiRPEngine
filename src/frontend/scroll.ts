// Scrolling inside the extension without moving the host around it. `scrollIntoView` scrolls every
// ancestor that can scroll, the host's overflow-hidden drawer frame and the page included, which
// pushes the host's tab row and header out of sight and leaves a blank band under the drawer. These
// move only the scroller our content sits in.

/** The nearest ancestor that can scroll vertically: in the drawer, the host's panel content, which our root sits inside rather than fills. */
export function scrollParent(el: Element): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") return node;
  }
  return null;
}

/**
 * Brings `el` into view by scrolling its scroll parent only. "start" puts its top just under the
 * bars that stick there, "center" in the middle of what shows, "nearest" moves as little as needed.
 * The covered top is the element's `scroll-margin-top` when it sets one, else the drawer's mode bar.
 */
export function revealInScroller(el: Element | null, block: "start" | "center" | "nearest" = "nearest"): void {
  if (!el) return;
  const scroller = scrollParent(el);
  if (!scroller) return;
  const style = getComputedStyle(el);
  const covered = parseFloat(style.scrollMarginTop) || parseFloat(style.getPropertyValue("--lre-modebar-h")) || 0;
  const box = el.getBoundingClientRect();
  const port = scroller.getBoundingClientRect();
  const top = port.top + scroller.clientTop + covered;
  const bottom = port.top + scroller.clientTop + scroller.clientHeight;
  let delta = 0;
  if (block === "start") delta = box.top - top;
  else if (block === "center") delta = box.top + box.height / 2 - (top + bottom) / 2;
  else if (box.top < top) delta = box.top - top;
  else if (box.bottom > bottom) delta = Math.min(box.bottom - bottom, box.top - top);
  if (delta !== 0) scroller.scrollTop += delta;
}
