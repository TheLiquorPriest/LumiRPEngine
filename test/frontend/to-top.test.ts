// "Back to top" in the live views (src/frontend/to-top.tsx; GM → Live and Play → Now's preparation):
// when it shows, from where the panel is scrolled, how tall it is and whether it can scroll; what the
// button says; and that its foot sits above the bottom bars rather than under them. Read without a DOM.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { Button } from "../../src/frontend/components";
import { PREPARE_LIVE_CSS } from "../../src/frontend/story/prepare-live-styles";
import { LIVE_CSS } from "../../src/frontend/styles/live";
import { showsToTop, TO_TOP_SCREENS, ToTopButton } from "../../src/frontend/to-top";
import type { Props } from "../support/tree";

/** A phone's panel: what shows of it is 700 px tall. */
const PHONE = 700;

describe("when Back to top shows", () => {
  test("not at the top, nor a screen down", () => {
    expect(showsToTop({ top: 0, height: PHONE, scrollable: true })).toBe(false);
    expect(showsToTop({ top: PHONE, height: PHONE, scrollable: true })).toBe(false);
  });

  test("once the panel is a screen and a half down, and further", () => {
    expect(TO_TOP_SCREENS).toBe(1.5);
    expect(showsToTop({ top: PHONE * 1.5 - 1, height: PHONE, scrollable: true })).toBe(false);
    expect(showsToTop({ top: PHONE * 1.5, height: PHONE, scrollable: true })).toBe(true);
    expect(showsToTop({ top: PHONE * 12, height: PHONE, scrollable: true })).toBe(true);
  });

  test("it goes again once scrolled back near the top", () => {
    const at = (top: number) => showsToTop({ top, height: PHONE, scrollable: true });
    expect([PHONE * 3, PHONE * 2, PHONE, 0].map(at)).toEqual([true, true, false, false]);
  });

  test("a taller panel needs more scrolling before it shows", () => {
    expect(showsToTop({ top: 1200, height: PHONE, scrollable: true })).toBe(true);
    expect(showsToTop({ top: 1200, height: 900, scrollable: true })).toBe(false);
  });

  test("never where the view can't scroll, nor where the panel isn't showing", () => {
    expect(showsToTop({ top: PHONE * 4, height: PHONE, scrollable: false })).toBe(false);
    expect(showsToTop({ top: 0, height: 0, scrollable: true })).toBe(false);
    expect(showsToTop({ top: 500, height: 0, scrollable: true })).toBe(false);
  });
});

describe("the button", () => {
  test("is a real button that says Back to top, with an up arrow", () => {
    let pressed = 0;
    const tree = ToTopButton({ onClick: () => pressed++ }) as VNode<Props>;
    expect(tree.type).toBe(Button);
    expect(tree.props.children).toBe("Back to top");
    expect(tree.props.icon).toBe("chevron-up");
    expect(tree.props.size).toBe("sm");
    (tree.props.onClick as () => void)();
    expect(pressed).toBe(1);
  });

  test("its foot sits above the bottom bar, wraps on a narrow phone, and only its buttons take a touch", () => {
    expect(LIVE_CSS).toContain(".lre-gm .lre-live-follow{bottom:calc(var(--lre-gm-nav-h,0px) + var(--lre-s2))}");
    expect(LIVE_CSS).toContain(".lre-gm:has(.lre-gm-notice) .lre-live-follow{bottom:calc(var(--lre-gm-nav-h,0px) + var(--lre-gm-notice-h,0px) + 2 * var(--lre-s2))}");
    expect(PREPARE_LIVE_CSS).toContain(".lre-play .lre-prep-live-foot{bottom:calc(var(--lre-tap-lg) + 2 * var(--lre-s1) + 1px + env(safe-area-inset-bottom,0px) + var(--lre-s2))}");
    for (const [css, foot] of [
      [LIVE_CSS, ".lre-live-follow"],
      [PREPARE_LIVE_CSS, ".lre-prep-live-foot"],
    ] as const) {
      expect(css).toContain(`${foot}{position:sticky;bottom:var(--lre-s2);z-index:1;display:flex;flex-wrap:wrap;justify-content:center;gap:var(--lre-s2);pointer-events:none}`);
      expect(css).toContain(`${foot}>.lre-btn{pointer-events:auto;background:var(--lre-bar-bg);`);
    }
  });
});
