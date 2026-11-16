// A date nobody set is shown to nobody (decision 85). A chat with no world plays on the blank world,
// whose clock starts at a moment nobody chose: its minutes count, but until a change sets the clock
// to a date and time, the engine's answers give a time as how long it is from now and no view shows
// a date. A move by a span, a count of minutes or to a time of day sets nothing. Played as the
// harness plays a call, on the blank world, whose clock starts at 08:00 on Thursday 1 January 2026.

import { describe, expect, test } from "bun:test";
import type { HostTool, JsonObject, ToolResult } from "rp-harness/contract";
import { clockRecorded } from "../../src/store/blank";
import { asHarnessPasses } from "../story/rig";
import { dataOf, type Rig, rig, texts, wordsFromFiles } from "./rig";

const SRC = { from: "prose", message: "m-4" };

/** What a date or a clock time is written with: a year, a month's or a weekday's name, a time of day. */
const DATED = /\b\d{4}\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b|\d{1,2}:\d{2}|\b[AP]M\b/;

async function call(t: Rig, name: string, args: JsonObject): Promise<ToolResult> {
  const r = await t.call(name, asHarnessPasses(t.tools.get(name) as HostTool, args));
  wordsFromFiles(r);
  return r;
}

const apply = (t: Rig, operation: JsonObject): Promise<ToolResult> => call(t, "world_apply", { operations: [{ ...operation, source: SRC }] });
const op = (r: ToolResult): JsonObject => (dataOf(r).operations as JsonObject[])[0] as JsonObject;
const worldChange = (r: ToolResult): JsonObject | undefined => (dataOf(r).changed as JsonObject[]).find((c) => c.at === "world");
/** Every word of an answer: its data, its tree and its lines, and what it reports. */
const said = (r: ToolResult): string => [...texts(r), ...(r.reports ?? [])].join("\n");
const recorded = (t: Rig): boolean => clockRecorded(t.s.stateAt(t.turn.id).state);

describe("on a chat with no world, whose clock nobody has set", () => {
  test("pass_time of two hours answers with no date anywhere, and the views after it show none", async () => {
    const t = await rig({}, "blank");
    const r = await apply(t, { op: "pass_time", for: "two hours" });
    expect(r.error).toBeUndefined();
    expect(op(r).span).toEqual({ from: "120 minutes before now", to: "the time now" });
    // The rig's list has an arrival an hour into any span.
    expect(op(r).due).toEqual([expect.objectContaining({ when: "60 minutes before now", kind: "arrival" })]);
    expect(worldChange(r)).toEqual({ at: "world", name: "", was: { time: "120 minutes before now" }, now: { time: "the time now" } });
    expect(said(r)).not.toMatch(DATED);
    expect(recorded(t)).toBe(false);

    // The views: the world's own level has no time, and a span ahead is told from now.
    const tree = await call(t, "world_query", { at: "world", due: "two hours" });
    expect(dataOf(tree).span).toEqual({ from: "the time now", to: "120 minutes from now" });
    expect(dataOf(tree).due).toEqual([expect.objectContaining({ when: "60 minutes from now" })]);
    expect(said(tree)).not.toMatch(/· time:/);
    expect(said(tree)).not.toMatch(DATED);

    // A set-back is reported the same way.
    const back = await apply(t, { op: "set", at: "world", key: "time", add: -60 });
    expect(back.reports).toEqual(["Operation 1 (set): the clock was set back from the time now to 60 minutes before now."]);
    expect(said(back)).not.toMatch(DATED);
  });

  test("a move to a time of day, or by a count of minutes, only moves the clock; a time set to a date and time sets it, and then every answer and view gives dates", async () => {
    const t = await rig({}, "blank");
    const moves: JsonObject[] = [
      { op: "pass_time", until: "evening" },
      { op: "pass_time", minutes: 30 },
      { op: "set", at: "world", key: "time", add: 15 },
      { op: "set", at: "world", key: "time", value: "22:00" },
    ];
    for (const moved of moves) {
      const r = await apply(t, moved);
      expect({ moved, error: r.error, dated: DATED.test(said(r)) }).toEqual({ moved, error: undefined, dated: false });
      expect(recorded(t)).toBe(false);
    }

    const set = await apply(t, { op: "set", at: "world", key: "time", value: "2026-01-02 09:00" });
    expect(set.error).toBeUndefined();
    expect(worldChange(set)?.now).toEqual({ time: "Fri 2 Jan 2026, 9:00 AM" });
    expect(recorded(t)).toBe(true);
    const tree = await call(t, "world_query", { at: "world" });
    expect(said(tree)).toContain("· time: Fri 2 Jan 2026, 9:00 AM");

    // From then on a span is told in dates, and so is what it brings due.
    const r = await apply(t, { op: "pass_time", for: "two hours" });
    expect(op(r).span).toEqual({ from: "Fri 2 Jan 2026, 9:00 AM", to: "Fri 2 Jan 2026, 11:00 AM" });
    expect(op(r).due).toEqual([expect.objectContaining({ when: "Fri 2 Jan 2026, 10:00 AM" })]);
  });

  test("pass_time until a date and time sets the clock, and its own answer gives the dates", async () => {
    const t = await rig({}, "blank");
    const r = await apply(t, { op: "pass_time", until: "2026-01-01 18:00" });
    expect(r.error).toBeUndefined();
    expect(op(r).span).toEqual({ from: "Thu 1 Jan 2026, 8:00 AM", to: "Thu 1 Jan 2026, 6:00 PM" });
    expect(worldChange(r)?.now).toEqual({ time: "Thu 1 Jan 2026, 6:00 PM" });
    expect(recorded(t)).toBe(true);
  });
});
