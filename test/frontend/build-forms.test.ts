import { describe, expect, test } from "bun:test";
import { clockLocal, clockOfStoryDay, durationText, localClock, parseDuration, storyDay } from "../../src/frontend/build/schema-form";

describe("Build durations", () => {
  test("a span reads in the ways people write one", () => {
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("1 h 30 min")).toBe(90);
    expect(parseDuration("1h30")).toBe(90);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("2 d 4 h")).toBe(3120);
    expect(parseDuration("30 s")).toBe(0.5);
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration("5 parsecs")).toBeNull();
    expect(parseDuration("2h 30")).toBe(150);
    expect(parseDuration("30 30")).toBeNull();
  });

  test("a stored span reads back exactly as it is written", () => {
    for (const minutes of [0, 0.5, 45, 60, 90, 1440, 1441, 3125, 10080]) expect(parseDuration(durationText(minutes))).toBe(minutes);
    expect(durationText(1441)).toBe("1 d 1 min");
    expect(durationText(90)).toBe("1 h 30 min");
  });
});

describe("Build clock times", () => {
  const morning = { system: "gregorian" as const, epoch: "2026-10-19T06:00" };

  test("a clock reading is the local time that many minutes after the epoch", () => {
    expect(clockLocal(0, morning)).toBe("2026-10-19T06:00");
    expect(clockLocal(18 * 60 + 30, morning)).toBe("2026-10-20T00:30");
    expect(clockLocal(-60, morning)).toBe("2026-10-19T05:00");
    // Month and year ends roll over as the calendar does.
    expect(clockLocal(13 * 1440, morning)).toBe("2026-11-01T06:00");
    expect(clockLocal(74 * 1440, morning)).toBe("2027-01-01T06:00");
  });

  test("a picked date and time is the clock reading that shows it, and impossible dates are refused", () => {
    for (const clock of [0, 1, 720, 1439, 20000, -45, 525600]) {
      const text = clockLocal(clock, morning);
      expect(text === null ? null : localClock(text, morning)).toBe(clock);
    }
    expect(localClock("2026-02-30T09:00", morning)).toBeNull();
    expect(localClock("2026-10-19 09:00", morning)).toBeNull();
  });

  test("a custom calendar counts days of the story from the epoch's date", () => {
    const custom = { system: "custom" as const, epoch: "0001-01-01T08:00" };
    expect(clockLocal(0, custom)).toBeNull();
    expect(storyDay(0, custom)).toEqual({ day: 1, minute: 480 });
    expect(storyDay(16 * 60, custom)).toEqual({ day: 2, minute: 0 });
    expect(clockOfStoryDay(2, 0, custom)).toBe(16 * 60);
    expect(clockOfStoryDay(1, 480, custom)).toBe(0);
  });
});
