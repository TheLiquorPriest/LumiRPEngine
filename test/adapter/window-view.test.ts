// What the history window is now, for the chat's marker (`src/adapter/lumiverse/window-view.ts`): the counts made from the window's facts and the chat's path, hidden messages counted only
// where agents may read them. Every id is invented.

import { expect, test } from "bun:test";
import { windowShown, type WindowView } from "../../src/adapter/lumiverse/window-view";

/** Eight messages; the third and the fifth are hidden; `index_in_chat` skips one after the fourth, as a delete leaves it. */
const PATH = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, index: i < 4 ? i : i + 1, hidden: i === 2 || i === 4 }));

const view = (over: Partial<WindowView> = {}): WindowView => ({ on: true, first: { id: "m6", index: 7 }, covered: new Set(["m0", "m1"]), ...over });

test("with the window on, the marker is told the first message kept, the one above it, how many lie above and how many of those the story does not cover; hidden ones are not counted", () => {
  // Above m6: m0, m1, m3, m5 (m2 and m4 are hidden and the agents may not read them); the record covers m0 and m1.
  expect(windowShown(PATH, view(), false)).toEqual({ on: true, first: "m6", before: "m5", above: 4, uncovered: 2 });
});

test("where agents may read hidden messages, a hidden one the record does not cover is counted", () => {
  expect(windowShown(PATH, view(), true)).toEqual({ on: true, first: "m6", before: "m5", above: 6, uncovered: 4 });
});

test("the message the marker stands under is the last one counted above the first kept, whatever stands between them hidden", () => {
  // The first kept is m5, hidden messages m4 and m2 lie above it: m3 is the one the marker stands under.
  expect(windowShown(PATH, view({ first: { id: "m5", index: 6 } }), false)).toEqual({ on: true, first: "m5", before: "m3", above: 3, uncovered: 1 });
});

test("a window that keeps every message, and one that is off, have nothing above", () => {
  expect(windowShown(PATH, view({ first: null }), false)).toEqual({ on: true, first: null, before: null, above: 0, uncovered: 0 });
  expect(windowShown(PATH, view({ on: false, first: null }), true)).toEqual({ on: false, first: null, before: null, above: 0, uncovered: 0 });
  // The first message of the chat is the first kept: nothing above it.
  expect(windowShown(PATH, view({ first: { id: "m0", index: 0 } }), true)).toEqual({ on: true, first: "m0", before: null, above: 0, uncovered: 0 });
});
