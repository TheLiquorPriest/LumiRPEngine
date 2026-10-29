// The time family (INC1-SPEC R3a) on Port Alder: the clock at the start under every knowledge, local
// to a place asked about, and under the player character's only as far as its Calendar & time level
// shows it; a person's day as Play's Cast shows it, as the planner lays it with a secret place
// marked, and as the GM reads it.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import { alderChat, answerOf, callTool, KNOWLEDGE } from "../support/tools";

/** Where Port Alder starts: Monday 14 September 2026 at 06:15, 375 minutes past the calendar's epoch. */
const START = "Mon 14 Sep 2026, 6:15 AM";
/** The note for what the player character can't know. */
const HIDDEN = "Jordan Ellis doesn't know that";

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

  test("under the player character's knowledge, only as far as its Calendar & time level shows the clock", async () => {
    const { rig, chatId } = await alderChat();
    // Before the chat's first turn, the head reads with the starting markers that turn applies, which
    // come after a level set now: the level is set once a turn has played.
    await rig.turn(chatId, "I look around.", "The street is quiet.");
    rig.body(await rig.send({ type: "lre.marker", chatId, kind: "resolve", domain: "calendar", scope: { all: true }, to: 1 }));
    expect(await answerOf<Clock>(rig, chatId, "pov", "time_clock")).toEqual({ dayPart: "Early morning", paused: false });
    // The GM reads the date and time whatever the player character's level shows (a turn on from the start).
    expect((await answerOf<Clock>(rig, chatId, "gm", "time_clock")).time).toStartWith("Mon 14 Sep 2026, ");
    rig.body(await rig.send({ type: "lre.marker", chatId, kind: "resolve", domain: "calendar", scope: { all: true }, to: 0 }));
    const off = await callTool(rig, chatId, "pov", "time_clock");
    expect(off.error).toBe(true);
    expect(off.text).toContain(HIDDEN);
  });

  test("local to a place asked about: Chicago is an hour behind Port Alder; one the player character can't know of reads as one that doesn't exist", async () => {
    const { rig, chatId } = await alderChat();
    for (const knowledge of KNOWLEDGE) expect(await answerOf<Clock>(rig, chatId, knowledge, "time_clock", { place: "Chicago, Illinois" })).toMatchObject({ time: "Mon 14 Sep 2026, 5:15 AM", minutes: 375 });
    // Left out or blank: where the player character is.
    expect(await answerOf<Clock>(rig, chatId, "gm", "time_clock", { place: " " })).toMatchObject({ time: START });
    expect(await answerOf<Clock>(rig, chatId, "gm", "time_clock", { place: "12 Birch Lane" })).toMatchObject({ time: START });
    expect(await callTool(rig, chatId, "pov", "time_clock", { place: "12 Birch Lane" })).toEqual({ text: "No such place here: 12 Birch Lane.", error: true });
    expect(await callTool(rig, chatId, "pov", "time_clock", { place: "Nowhere Street" })).toEqual({ text: "No such place here: Nowhere Street.", error: true });
  });
});

describe("time_day", () => {
  test("Danny Okafor's Monday: as the planner lays it under everyone, with why under the GM, and as Cast shows it to the player character he is with", async () => {
    const { rig, chatId } = await alderChat();
    const everyone = await answerOf<Day>(rig, chatId, "everyone", "time_day", { person: "Danny Okafor" });
    expect(everyone).toMatchObject({ person: { id: "danny_okafor", name: "Danny Okafor" }, day: "Mon 14 Sep 2026" });
    expect(everyone.blocks.some((b) => b.place?.id === "alder_automotive" && b.label === "working on cars")).toBe(true);
    const gm = await answerOf<Day>(rig, chatId, "gm", "time_day", { person: "danny_okafor" });
    expect(gm.blocks.some((b) => b.place?.id === "alder_automotive" && b.origin?.type === "schedule")).toBe(true);
    expect((await answerOf<Day>(rig, chatId, "gm", "time_day", { person: "danny_okafor", day: 1 })).day).toBe("Tue 15 Sep 2026");
    const pov = await answerOf<Day>(rig, chatId, "pov", "time_day", { person: "Danny" });
    expect(pov.person).toEqual({ id: "danny_okafor", name: "Danny Okafor" });
    expect(pov.blocks.length).toBeGreaterThan(0);
    expect(pov.blocks.every((b) => b.place === undefined && b.origin === undefined && b.source !== undefined)).toBe(true);
  });

  test("under the player character's knowledge, the day of someone away and any day but today are beyond it", async () => {
    const { rig, chatId } = await alderChat();
    const beyond: JsonObject[] = [{ person: "Marcus Delgado" }, { person: "Danny Okafor", day: 1 }];
    for (const args of beyond) {
      const out = await callTool(rig, chatId, "pov", "time_day", args);
      expect(out.error).toBe(true);
      expect(out.text).toContain(HIDDEN);
    }
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
