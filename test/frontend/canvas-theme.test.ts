// The canvas palette (canvas-theme.ts) against a stand-in page: an element computes the `.lre`
// tokens only while it is in the page, as a float widget's root isn't until the host puts it there.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { canvasPalette, watchTheme } from "../../src/packs/space/ui/canvas-theme";

const TOKENS: Record<string, string> = { "--lre-canvas-ink": "rgb(240, 240, 240)", "--lre-canvas-bg": "rgba(0, 0, 0, 0.15)", "--lre-series-1": "#22c55e" };
const TEXT = "rgb(10, 20, 30)";

/** A 2D context that takes hex and rgb() colours, and keeps the last colour for anything else, as a canvas does. */
function context(): { fillStyle: string } {
  let fill = "#000000";
  return {
    get fillStyle() {
      return fill;
    },
    set fillStyle(value: string) {
      if (/^(#[0-9a-f]{3,8}|rgba?\(.*\))$/i.test(value)) fill = value;
    },
  };
}

class Stage {
  isConnected = false;
  constructor(readonly tokens: Record<string, string>) {}
}

const page = {
  documentElement: {},
  body: {},
  createElement: () => ({ getContext: () => context(), style: {} }),
};
const computed = (el: Stage) => ({
  getPropertyValue: (name: string) => (el.isConnected ? (el.tokens[name] ?? "") : ""),
  color: el.isConnected ? TEXT : "",
  fontFamily: "",
});
class Observer {
  observe(): void {}
  disconnect(): void {}
}

const saved = { document: Reflect.get(globalThis, "document"), getComputedStyle: Reflect.get(globalThis, "getComputedStyle"), MutationObserver: Reflect.get(globalThis, "MutationObserver") };
let unwatch = () => {};

beforeAll(() => {
  Object.assign(globalThis, { document: page, getComputedStyle: computed, MutationObserver: Observer });
  // Watching the theme, as a drawn map does, is what keeps palettes between draws.
  unwatch = watchTheme(() => {});
});

afterAll(() => {
  unwatch();
  Object.assign(globalThis, saved);
});

/** The stand-in passed where the palette takes the canvas element. */
const asElement = (stage: Stage): Element => stage as unknown as Element;

describe("canvasPalette", () => {
  test("a palette read before the canvas is in the page isn't kept: once it is, the tokens draw", () => {
    const stage = new Stage(TOKENS);
    const early = canvasPalette(asElement(stage));
    expect(early.ink).not.toBe(TOKENS["--lre-canvas-ink"]);
    stage.isConnected = true;
    const palette = canvasPalette(asElement(stage));
    expect(palette.ink).toBe(TOKENS["--lre-canvas-ink"]);
    expect(palette.bg).toBe(TOKENS["--lre-canvas-bg"]);
    expect(palette.series[0]).toBe(TOKENS["--lre-series-1"]);
  });

  test("with no tokens, marks take the element's text colour", () => {
    const stage = new Stage({});
    stage.isConnected = true;
    const palette = canvasPalette(asElement(stage));
    expect(palette.ink).toBe(TEXT);
    expect(palette.series[0]).toBe(TEXT);
    expect(palette.bg).toBe("transparent");
  });
});
