// What someone is doing, as the words after "is": over the activities the engine and the shipped
// worlds really set, never a bare noun ("is work"), and nothing for someone doing nothing in particular.

import { describe, expect, test } from "bun:test";
import { activityPhrase } from "../../src/shared/activity";
import { BASIC_BLOCKS } from "../../src/shared/routines";
import fantasy from "../../src/packs/starters/fantasy_town.json";
import manor from "../../src/packs/starters/mystery_manor.json";
import modern from "../../src/packs/starters/modern_slice_of_life.json";

/** Every `activity` string in a document. */
function activitiesIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) activitiesIn(v, out);
  else if (value !== null && typeof value === "object") for (const [k, v] of Object.entries(value)) (k === "activity" && typeof v === "string" ? out.add(v) : activitiesIn(v, out));
  return out;
}

// The engine's own (a routine's built-ins, basic needs, actions' and agendas'), then the shipped worlds'.
// ("busy", for a private block, is already an adjective: "is busy".)
const ENGINE = ["work", "socialize", "leisure", ...BASIC_BLOCKS.map((b) => b.activity), "waiting", "travel", "trip", "rest", "errand", "chores", "appointment", "visiting", "agenda"];
const SHIPPED = [...new Set([...activitiesIn(modern), ...activitiesIn(fantasy), ...activitiesIn(manor)])].filter((a) => a !== "idle");

describe("what someone is doing, after \"is\"", () => {
  test("no activity the engine sets reads as a bare noun after \"is\"", () => {
    for (const a of new Set(ENGINE)) {
      const phrase = activityPhrase(a);
      expect(phrase).not.toBeNull();
      // "waiting" already follows "is"; "work", "sleep", "lunch" never stand bare.
      if (!/ing$/.test(a)) expect(phrase).not.toBe(a);
    }
  });

  test("a shipped world's own words read as they are when they already follow \"is\", and a noun phrase never stands bare", () => {
    expect(SHIPPED.length).toBeGreaterThan(5);
    for (const a of SHIPPED) {
      const phrase = activityPhrase(a) ?? "";
      expect(phrase).toContain(a);
      // "getting ready for the bus", "among his collection": as written; "village duty": never bare.
      const reads = /^[a-z]+ing\b/i.test(a) || /^(among|at|in|on|out)\b/i.test(a);
      if (reads) expect(phrase).toBe(a);
      else expect(phrase).not.toBe(a);
    }
  });

  test("doing nothing in particular is no activity to tell, and a kind names its place when given", () => {
    expect(activityPhrase("idle")).toBeNull();
    expect(activityPhrase("")).toBeNull();
    expect(activityPhrase("work", "Alder Automotive")).toContain("Alder Automotive");
  });
});
