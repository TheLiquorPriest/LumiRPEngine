// `pass_time` sent with a span and a time of day together, the time of day
// in the words of a day's clock. Played as the harness plays a call (checked and coerced by pi, then
// run) on the blank world, whose day starts at 08:00 and whose calendar has the four parts of a day.

import { describe, expect, test } from "bun:test";
import type { HostTool, JsonObject, ToolResult } from "rp-harness/contract";
import { asHarnessPasses } from "../story/rig";
import { type Rig, rig, texts, wordsFromFiles } from "./rig";

const SRC = { from: "prose", message: "m-4" };
/** Minutes in a day, and the blank world's first day starting at its epoch. */
const DAY = 1440;
const at = (day: number, hour: number, minute = 0): number => day * DAY + hour * 60 + minute;

async function play(t: Rig, operation: JsonObject): Promise<ToolResult> {
  const r = await t.call("world_apply", asHarnessPasses(t.tools.get("world_apply") as HostTool, { operations: [operation] }));
  wordsFromFiles(r);
  return r;
}

const clock = (t: Rig): number => t.s.stateAt(t.turn.id).state.world.clock;

/** The blank world with its clock moved on to `to`. */
async function blankAt(to: number): Promise<Rig> {
  const t = await rig({}, "blank");
  const r = await play(t, { op: "pass_time", minutes: to - clock(t), source: SRC });
  expect(r.error).toBeUndefined();
  expect(clock(t)).toBe(to);
  return t;
}

describe("pass_time reads a time of day", () => {
  test("at 20:00: four hours and until midnight read as the same time, so the clock goes to midnight and the answer is clean", async () => {
    const t = await blankAt(at(0, 20));
    const r = await play(t, { op: "pass_time", for: "four hours", until: "midnight" });
    expect(r.error).toBeUndefined();
    expect(r.reports).toBeUndefined();
    expect(clock(t)).toBe(at(1, 0));
  });

  test("at 19:30: the two read as different times, so the end it names is applied and the other is reported", async () => {
    const t = await blankAt(at(0, 19, 30));
    const r = await play(t, { op: "pass_time", for: "four hours", until: "midnight" });
    expect(r.error).toBeUndefined();
    expect(clock(t)).toBe(at(1, 0));
    expect(r.reports).toHaveLength(1);
    expect(r.reports?.[0]).toMatch(/^Operation 1 \(pass_time\): for reads as .*11:30.* and until as .*12:00.*; the clock was set by until\.$/);
  });

  test("where one of for and until cannot be read, the other is applied and the one left out is reported with what it takes", async () => {
    const t = await blankAt(at(0, 8));
    const r = await play(t, { op: "pass_time", for: "four hours", until: "when the tide turns", source: SRC });
    expect(r.error).toBeUndefined();
    expect(clock(t)).toBe(at(0, 12));
    expect(r.reports).toEqual([
      'Operation 1 (pass_time): until cannot be read, you sent "when the tide turns", so it was left out and for was applied. It takes a date and time, YYYY-MM-DD HH:MM; a time of day, such as midnight, dawn or 22:00, as the next time the clock shows it; or words for a span, such as two hours.',
    ]);
  });

  test("the words of a day's clock and a clock time each go to the next time the clock shows them", async () => {
    const t = await blankAt(at(0, 8));
    const steps: [string, number][] = [
      ["noon", at(0, 12)],
      ["dusk", at(0, 18)],
      ["22:00", at(0, 22)],
      ["midnight", at(1, 0)],
      ["dawn", at(1, 6)],
      ["10pm", at(1, 22)],
      ["morning", at(2, 6)],
      ["evening", at(2, 18)],
      ["night", at(3, 0)],
    ];
    for (const [until, to] of steps) {
      const r = await play(t, { op: "pass_time", until, source: SRC });
      expect({ until, error: r.error, reports: r.reports, clock: clock(t) }).toEqual({ until, error: undefined, reports: undefined, clock: to });
    }
  });

  test("with none of them readable, nothing is recorded and the answer says what until takes", async () => {
    const t = await blankAt(at(0, 8));
    const before = t.s.changes(t.turn.id).length;
    const r = await play(t, { op: "pass_time", until: "when the tide turns", source: SRC });
    expect(r.error).toBe(true);
    expect(texts(r)[0]).toStartWith('Operation 1 (pass_time): until cannot be read, you sent "when the tide turns". It takes a date and time');
    expect(t.s.changes(t.turn.id).length).toBe(before);
  });
});
