import { describe, expect, test } from "bun:test";
import { headGutters } from "../../src/frontend/chat-heads";

// The drawer's content at 390 px: 12 px of host padding each side, below the host's header.
const panel = { x: 12, y: 120, width: 366, height: 700 };

describe("chat-head gutters", () => {
  test("no heads leave no gutters", () => {
    expect(headGutters(panel, [])).toEqual({ left: 0, right: 0 });
  });

  test("a head over the right edge pads the right by its overlap plus breathing room", () => {
    // Panel right edge 378; the head starts at 330: 48 px over, plus 8.
    expect(headGutters(panel, [{ x: 330, y: 200, width: 52, height: 52 }])).toEqual({ left: 0, right: 56 });
    // The widest overlap of a column of heads counts.
    expect(headGutters(panel, [{ x: 330, y: 200, width: 52, height: 52 }, { x: 320, y: 262, width: 64, height: 64 }])).toEqual({ left: 0, right: 66 });
  });

  test("a head over the left edge pads the left", () => {
    // The head ends at 60: 48 px into the panel, plus 8.
    expect(headGutters(panel, [{ x: 8, y: 200, width: 52, height: 52 }])).toEqual({ left: 56, right: 0 });
  });

  test("heads outside the panel, beside it or above and below it, give nothing", () => {
    expect(headGutters(panel, [{ x: 400, y: 200, width: 52, height: 52 }])).toEqual({ left: 0, right: 0 });
    expect(headGutters({ x: 0, y: 0, width: 380, height: 800 }, [{ x: 400, y: 200, width: 52, height: 52 }])).toEqual({ left: 0, right: 0 });
    expect(headGutters(panel, [{ x: 330, y: 20, width: 52, height: 52 }, { x: 330, y: 900, width: 52, height: 52 }])).toEqual({ left: 0, right: 0 });
  });
});
