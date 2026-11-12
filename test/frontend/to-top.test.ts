// "Back to top" in the live views (src/frontend/to-top.tsx; GM → Live and Play → Now's preparation):
// when it shows, from where the panel is scrolled, how tall it is and whether it can scroll; and what
// the button says. Read without a DOM. How high its foot floats, above the bottom bar's measured
// height, is test/frontend/bar-height.test.ts.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { Button } from "../../src/frontend/components";
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
});
