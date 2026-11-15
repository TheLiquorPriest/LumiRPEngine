import { describe, expect, test } from "bun:test";
import { historyWindow, WINDOW_DEFAULTS, type WindowMessage, type WindowSettings } from "../../../src/story/window/index";

/** An invented chat's path: `count` messages, ids `m0`, `m1`, … at their own places. */
function chat(count: number): WindowMessage[] {
  return Array.from({ length: count }, (_, i) => ({ id: `m${i}`, index: i }));
}

function ids(from: number, to: number): Set<string> {
  const out = new Set<string>();
  for (let i = from; i <= to; i++) out.add(`m${i}`);
  return out;
}

const NOTHING = new Set<string>();
const settings = (over: Partial<WindowSettings>): WindowSettings => ({ ...WINDOW_DEFAULTS, ...over });
const kept = (messages: readonly WindowMessage[], s: WindowSettings, covered: ReadonlySet<string>): number => {
  const cut = historyWindow(messages, s, covered);
  return cut.first === null ? messages.length : messages.length - cut.first.index;
};

describe("the history window", () => {
  test("keeps exactly the latest X, whatever the record covers", () => {
    const messages = chat(100);
    const coverings = [NOTHING, ids(0, 99), ids(0, 49), ids(50, 99), new Set(messages.filter((_, i) => i % 3 === 0).map((m) => m.id))];
    for (const covered of coverings) {
      const cut = historyWindow(messages, settings({ size: 40 }), covered);
      expect(cut.first).toEqual({ id: "m60", index: 60 });
      expect(cut.left.reduce((n, r) => n + r.count, 0)).toBe(60);
    }
    for (let count = 1; count <= 300; count++) expect(kept(chat(count), settings({ size: 40 }), NOTHING)).toBe(Math.min(count, 40));
  });

  test("keeps everything when the chat is no longer than X, or when the setting is off", () => {
    expect(historyWindow(chat(40), settings({ size: 40 }), NOTHING)).toEqual({ first: null, left: [] });
    expect(historyWindow(chat(300), settings({ size: null }), NOTHING)).toEqual({ first: null, left: [] });
    expect(historyWindow([], settings({ size: 40 }), NOTHING)).toEqual({ first: null, left: [] });
  });

  test("names the first kept message by its id and its place in the chat, even where the path skips places", () => {
    const messages = chat(10).map((m) => ({ ...m, index: m.index * 2, swipe: 0 }));
    expect(historyWindow(messages, settings({ size: 3 }), NOTHING).first).toEqual({ id: "m7", index: 14 });
  });

  test("with a window of 40 and a step of 20, 60 messages are kept whole, and the 61st cuts back to exactly 40", () => {
    // READINGS R-95: the window holds 40 to 60, both ends; it changed from 40 to 59, the 60th cutting it back (rule 5: the test asserted that).
    const s = settings({ size: 40, step: 20 });
    expect(kept(chat(60), s, NOTHING)).toBe(60);
    expect(kept(chat(61), s, NOTHING)).toBe(40);
    expect(kept(chat(62), s, NOTHING)).toBe(41);
    expect(kept(chat(81), s, NOTHING)).toBe(60);
    expect(kept(chat(82), s, NOTHING)).toBe(40);
    let front: string | null = null;
    for (let count = 40; count <= 300; count++) {
      const cut = historyWindow(chat(count), s, ids(0, count - 1));
      const size = kept(chat(count), s, NOTHING);
      expect(size).toBeGreaterThanOrEqual(40);
      expect(size).toBeLessThanOrEqual(60);
      const first = cut.first?.id ?? null;
      // The front moves only when the window is cut back to exactly X.
      if (first !== front) expect(size).toBe(40);
      front = first;
    }
  });

  test("a cut inside a message Lumiverse joins keeps it whole and names its first row, a hidden message between them skipped", () => {
    // m7, m8 and m9 are the player's three lines sent in a row: Lumiverse joins them into one message under m7 (READINGS R-202).
    const queued = chat(10).map((m) => (m.index >= 7 ? { ...m, user: true } : m));
    expect(historyWindow(queued, settings({ size: 2 }), NOTHING).first).toEqual({ id: "m7", index: 7 });
    expect(historyWindow(queued, settings({ size: 1 }), NOTHING).first).toEqual({ id: "m7", index: 7 });
    // The cut at the joined message's own first row moves nothing; a message of the narrator's before it is never joined.
    expect(historyWindow(queued, settings({ size: 3 }), NOTHING).first).toEqual({ id: "m7", index: 7 });
    expect(historyWindow(queued, settings({ size: 4 }), NOTHING).first).toEqual({ id: "m6", index: 6 });
    // m8 hidden: m7 and m9 still reach the prompt as one.
    const hidden = queued.map((m) => (m.id === "m8" ? { ...m, hidden: true } : m));
    expect(historyWindow(hidden, settings({ size: 1 }), NOTHING).first).toEqual({ id: "m7", index: 7 });
    // What is left out stops where the joined message begins.
    expect(historyWindow(queued, settings({ size: 1 }), NOTHING).left).toEqual([{ from: { id: "m0", index: 0 }, to: { id: "m6", index: 6 }, count: 7, covered: false }]);
  });

  test("with the hold on, keeps uncovered messages up to its cap, and lets go of what is covered", () => {
    const messages = chat(300);
    const hold = { on: true, cap: 40 };
    // Covered to message 249: the six uncovered messages before the cut keep the window open back to them.
    const covered = new Set([...ids(0, 249), ...ids(256, 299)]);
    expect(historyWindow(messages, settings({ size: 40, hold }), covered).first).toEqual({ id: "m250", index: 250 });
    // The same chat with the hold off keeps exactly 40.
    expect(historyWindow(messages, settings({ size: 40 }), covered).first).toEqual({ id: "m260", index: 260 });
    // Everything covered: nothing more is kept.
    expect(historyWindow(messages, settings({ size: 40, hold }), ids(0, 299)).first).toEqual({ id: "m260", index: 260 });
    // Nothing covered: the cap is the limit, and what lies beyond it leaves uncovered.
    const capped = historyWindow(messages, settings({ size: 40, hold }), NOTHING);
    expect(capped.first).toEqual({ id: "m220", index: 220 });
    expect(capped.left).toEqual([{ from: { id: "m0", index: 0 }, to: { id: "m219", index: 219 }, count: 220, covered: false }]);
    // A cap of 0 holds nothing.
    expect(historyWindow(messages, settings({ size: 40, hold: { on: true, cap: 0 } }), NOTHING).first).toEqual({ id: "m260", index: 260 });
  });

  test("the hold works on top of a step", () => {
    // 300 messages, X 40, step 20: the step alone keeps from 252. Uncovered 230–235 hold it back to 230.
    const covered = new Set([...ids(0, 229), ...ids(236, 299)]);
    const s = settings({ size: 40, step: 20, hold: { on: true, cap: 40 } });
    expect(historyWindow(chat(300), s, covered).first).toEqual({ id: "m230", index: 230 });
  });

  test("says which stretches it leaves out and whether the record covers each", () => {
    const covered = new Set([...ids(0, 9), ...ids(20, 29)]);
    const cut = historyWindow(chat(80), settings({ size: 40 }), covered);
    expect(cut.left).toEqual([
      { from: { id: "m0", index: 0 }, to: { id: "m9", index: 9 }, count: 10, covered: true },
      { from: { id: "m10", index: 10 }, to: { id: "m19", index: 19 }, count: 10, covered: false },
      { from: { id: "m20", index: 20 }, to: { id: "m29", index: 29 }, count: 10, covered: true },
      { from: { id: "m30", index: 30 }, to: { id: "m39", index: 39 }, count: 10, covered: false },
    ]);
  });

  test("hidden messages do not count toward the window", () => {
    // m3 and m7 hidden: of the ten, eight count, and the window of five keeps the latest five of them (READINGS R-21).
    const messages = chat(10).map((m) => (m.id === "m3" || m.id === "m7" ? { ...m, hidden: true } : m));
    const cut = historyWindow(messages, settings({ size: 5 }), NOTHING);
    expect(cut.first).toEqual({ id: "m4", index: 4 });
    // What the window leaves out is what it counted: the hidden m3 is neither kept nor left out by it.
    expect(cut.left).toEqual([{ from: { id: "m0", index: 0 }, to: { id: "m2", index: 2 }, count: 3, covered: false }]);
    // Hiding the message the window began at lets one older message in: the five it keeps are m2, m5, m6, m8 and m9.
    const later = historyWindow(messages.map((m) => (m.id === "m4" ? { ...m, hidden: true } : m)), settings({ size: 5 }), NOTHING);
    expect(later.first).toEqual({ id: "m2", index: 2 });
    // With the step and the hold, the same: they count only what is not hidden (five of eight with a step of two: m4 on).
    expect(historyWindow(messages, settings({ size: 4, step: 2 }), NOTHING).first).toEqual({ id: "m4", index: 4 });
    expect(historyWindow(messages, settings({ size: 5, hold: { on: true, cap: 2 } }), new Set(["m4", "m5", "m6", "m8", "m9"])).first).toEqual({ id: "m1", index: 1 });
  });

  test("refuses a setting it cannot carry out", () => {
    expect(() => historyWindow(chat(10), settings({ size: 0 }), NOTHING)).toThrow(RangeError);
    expect(() => historyWindow(chat(10), settings({ size: 4, step: 2.5 }), NOTHING)).toThrow(RangeError);
    expect(() => historyWindow(chat(10), settings({ hold: { on: true, cap: -1 } }), NOTHING)).toThrow(RangeError);
  });
});
