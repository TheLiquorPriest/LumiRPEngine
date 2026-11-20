// A skip of time the player pressed on a sheet (the palette's Timelapse) is carried out by `pass_time`, whichever way the Author records it:
// `act` with the press's own action and values, or the `pass_time` the briefing names for it (`timelapseOperation`), moves the clock the same
// and answers the same. A target that is not a duration, and what the player set to stop a skip, are read by that one operation. Invented world.

import { describe, expect, test } from "bun:test";
import { timelapseOperation } from "../../src/iface/time-press";
import type { JsonObject } from "../../src/shared/json";
import { rig, texts, wordsFromFiles, type Rig } from "./rig";

const SRC = { from: "player" };
const clockOf = (t: Rig): number => t.s.stateAt(t.turn.id).state.world.clock;
const said = (r: { content: { type: string; text?: string }[] }): string => JSON.stringify(r.content).replaceAll("(act)", "(pass_time)").replaceAll('\\"op\\":\\"act\\"', '\\"op\\":\\"pass_time\\"');

describe("a skip of time the player pressed", () => {
  test("act with the timelapse action and the pass_time the briefing names move the clock the same, and are answered the same", async () => {
    const values = { target: { type: "duration", minutes: 60 }, overrides: {}, followRoutine: false, label: "Timelapse 1 h" };
    const acted = await rig();
    const passed = await rig();
    const start = clockOf(acted);
    const a = await acted.call("world_apply", { operations: [{ op: "act", action: "timelapse", params: values, source: SRC }] });
    const told = timelapseOperation("timelapse", values);
    expect(told).toEqual({ op: "pass_time", minutes: 60, interrupts: {}, routine: false, source: SRC });
    const p = await passed.call("world_apply", { operations: [told ?? {}] });
    expect(a.error).toBeUndefined();
    expect(p.error).toBeUndefined();
    expect([clockOf(acted), clockOf(passed)]).toEqual([start + 60, start + 60]);
    expect(said(a)).toBe(said(p));
    wordsFromFiles(a);
  });

  test("a target that is not a duration lands where the engine reads it, as the same words do", async () => {
    const by = await rig();
    const target = await by.call("world_apply", { operations: [{ op: "act", action: "timelapse", params: { target: { type: "day_part", dayPart: "morning" }, overrides: { arrival: "note" } }, source: SRC }] });
    const words = await rig();
    await words.call("world_apply", { operations: [{ op: "pass_time", until: "morning", source: SRC }] });
    expect(target.error).toBeUndefined();
    expect(clockOf(by)).toBeGreaterThan(clockOf(await rig()));
    expect(clockOf(by)).toBe(clockOf(words));
    // A target that names nothing is answered in words, and the clock stays.
    const none = await rig();
    const bad = await none.call("world_apply", { operations: [{ op: "act", action: "timelapse", params: { target: { type: "no such" } }, source: SRC }] });
    expect(clockOf(none)).toBe(clockOf(await rig()));
    expect(texts(bad).join(" ")).toContain("target cannot be read");
  });

  test("a stop set for a skip with an end stops it where it falls due, and what they set to ignore is not listed", async () => {
    // The test's list of what falls due has an arrival an hour into any span.
    const stopped = await rig();
    const start = clockOf(stopped);
    const a = await stopped.call("world_apply", { operations: [{ op: "act", action: "timelapse", params: { minutes: 600, overrides: { arrival: "stop" } }, source: SRC }] });
    expect(clockOf(stopped)).toBe(start + 60);
    expect(a.reports).toEqual([expect.stringContaining("the clock stopped at")]);
    expect(texts(a).join(" ")).toContain("the carter from the far road");
    const ignored = await rig();
    const b = await ignored.call("world_apply", { operations: [{ op: "act", action: "timelapse", params: { minutes: 120, overrides: { arrival: "ignore" } }, source: SRC }] });
    expect(clockOf(ignored)).toBe(start + 120);
    expect(texts(b).join(" ")).not.toContain("the carter from the far road");
  });

  test("the next interruption is the first thing the player set to stop a skip, by their own settings where the call gives none, and where there is none no clock moves", async () => {
    const sheet = { target: { type: "interrupt" }, overrides: {}, followRoutine: false };
    // An arrival falls due an hour in, and the player's own settings stop a skip for it: the clock goes there, whichever way the Author records it.
    const start = clockOf(await rig());
    const through = await rig();
    const a = await through.call("world_apply", { operations: [{ op: "act", action: "timelapse", params: sheet, source: SRC }] });
    expect(clockOf(through)).toBe(start + 60);
    expect(a.reports).toEqual([expect.stringContaining("the clock went to")]);
    expect(texts(a).join(" ")).toContain("the carter from the far road");
    const told = await rig();
    await told.call("world_apply", { operations: [{ op: "pass_time", target: { type: "interrupt" }, source: SRC }] });
    expect(clockOf(told)).toBe(start + 60);
    const said = await rig();
    await said.call("world_apply", { operations: [{ ...(timelapseOperation("timelapse", sheet) ?? {}) }] });
    expect(clockOf(said)).toBe(start + 60);
    // Nothing of a kind they set to stop a skip falls due: the clock stands, and the answer says why, in words, with nothing recorded.
    const refused: JsonObject[] = [{ op: "act", action: "timelapse", params: { ...sheet, overrides: { arrival: "ignore" } }, source: SRC }, { op: "pass_time", target: { type: "interrupt" }, interrupts: { arrival: "ignore" }, source: SRC }];
    for (const operation of refused) {
      const none = await rig();
      const r = await none.call("world_apply", { operations: [operation] });
      expect(clockOf(none)).toBe(start);
      expect(texts(r).join(" ")).toContain("there is no next interruption to skip to, and the clock stands");
      wordsFromFiles(r);
    }
  });
});
