// The time family (INC1-SPEC R3a) on Port Alder: the clock at the start under every view, local to a
// place asked about; a person's day as the planner lays it with a secret place marked, and as the GM
// reads it.

import { describe, expect, test } from "bun:test";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import { alderChat, answerOf, callTool, KNOWLEDGE } from "../support/tools";

/** Where Port Alder starts: Monday 14 September 2026 at 06:15, 375 minutes past the calendar's epoch. */
const START = "Mon 14 Sep 2026, 6:15 AM";

interface Clock {
  time?: string;
  minutes?: number;
  dayPart: string;
  holidays?: string[];
  paused: boolean;
}

interface Block {
  from: string;
  to: string;
  label: string;
  activity?: string;
  place?: { id: string; name: string; visibility?: string } | null;
  source?: { type: string };
  origin?: { type: string };
}

interface Day {
  person: { id: string; name: string };
  day: string;
  blocks: Block[];
}

describe("time_clock", () => {
  test("the start, early on a Monday morning, under every knowledge", async () => {
    const { rig, chatId } = await alderChat();
    for (const knowledge of KNOWLEDGE) expect(await answerOf<Clock>(rig, chatId, knowledge, "time_clock")).toEqual({ time: START, minutes: 375, dayPart: "Early morning", holidays: [], paused: false });
  });

  test("local to a place asked about: Chicago is an hour behind Port Alder; a secret place reads too, a place the world lacks doesn't", async () => {
    const { rig, chatId } = await alderChat();
    for (const knowledge of KNOWLEDGE) expect(await answerOf<Clock>(rig, chatId, knowledge, "time_clock", { place: "Chicago, Illinois" })).toMatchObject({ time: "Mon 14 Sep 2026, 5:15 AM", minutes: 375 });
    // Left out or blank: where the player character is.
    expect(await answerOf<Clock>(rig, chatId, "gm", "time_clock", { place: " " })).toMatchObject({ time: START });
    for (const knowledge of KNOWLEDGE) {
      expect(await answerOf<Clock>(rig, chatId, knowledge, "time_clock", { place: "12 Birch Lane" })).toMatchObject({ time: START });
      expect(await callTool(rig, chatId, knowledge, "time_clock", { place: "Nowhere Street" })).toEqual({ text: "No such place here: Nowhere Street.", error: true });
    }
  });
});

describe("time_day", () => {
  test("Danny Okafor's Monday: as the planner lays it under everyone, with why under the GM", async () => {
    const { rig, chatId } = await alderChat();
    const everyone = await answerOf<Day>(rig, chatId, "everyone", "time_day", { person: "Danny Okafor" });
    expect(everyone).toMatchObject({ person: { id: "danny_okafor", name: "Danny Okafor" }, day: "Mon 14 Sep 2026" });
    expect(everyone.blocks.some((b) => b.place?.id === "alder_automotive" && b.label === "working on cars")).toBe(true);
    const gm = await answerOf<Day>(rig, chatId, "gm", "time_day", { person: "danny_okafor" });
    expect(gm.blocks.some((b) => b.place?.id === "alder_automotive" && b.origin?.type === "schedule")).toBe(true);
    expect((await answerOf<Day>(rig, chatId, "gm", "time_day", { person: "danny_okafor", day: 1 })).day).toBe("Tue 15 Sep 2026");
  });

  test("a day that isn't a number of days on is refused, naming it", async () => {
    const { rig, chatId } = await alderChat();
    const bad = await callTool(rig, chatId, "gm", "time_day", { person: "Danny Okafor", day: "tomorrow" });
    expect(bad.error).toBe(true);
    expect(bad.text).toContain("tomorrow");
  });

  test("Marcus's day at his secret home: marked as kept from everyone under everyone, plain with its visibility for the GM", async () => {
    const { rig, chatId } = await alderChat();
    const everyone = await answerOf<Day>(rig, chatId, "everyone", "time_day", { person: "Marcus Delgado" });
    expect(everyone.blocks.find((b) => b.place?.id === "birch_lane_12")?.place?.name).toBe(secretMarkText("12 Birch Lane", [], "everyone", SECRET_MARK_WORDING));
    const gm = await answerOf<Day>(rig, chatId, "gm", "time_day", { person: "Marcus Delgado" });
    expect(gm.blocks.find((b) => b.place?.id === "birch_lane_12")?.place).toEqual({ id: "birch_lane_12", name: "12 Birch Lane", visibility: "secret" });
  });
});
