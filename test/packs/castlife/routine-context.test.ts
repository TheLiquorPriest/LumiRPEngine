// Routines as context (DESIGN §6.6, §24.5): a routine is informative by default, so the narrator
// and a character's own mind may weigh it and the story decides. The narrator gets one soft line of
// the usual routine of each person with the POV that it can see, from the player's view of it; a
// mind reads its own routine and schedules within their limit, never the planner's day.

import { describe, expect, test } from "bun:test";
import type { RoutineBlock } from "../../../src/shared/routines";
import type { Working } from "../../../src/engine/working";
import { placeOfEntity } from "../../../src/engine/scope";
import { dayPlan } from "../../../src/packs/castlife/core/index";
import { usualRoutineHints } from "../../../src/packs/castlife/core/usual";
import { at, fixed, gmEdit, gmPlan, pin, record, reg, routine, town, withRoutines, YOU } from "./town";

const SWIM: RoutineBlock = { id: "swim", label: "Swimming at the gym", activity: "leisure", kind: "flexible", window: { from: "18:00", to: "21:00" }, minutes: 60, place: { place: "gym" } };
const THERAPY = fixed("therapy", "17:00", 60, "home", { label: "Seeing her therapist", private: true });
const FAMILY_SECRET = fixed("ledger", "21:00", 30, "home", { label: "Going over the family's hidden ledger", private: true });

/** Riverton with Maya's swim, her own private appointment and a private block of her household's, Maya with the player character. */
function withMaya(settings?: { narrator?: boolean }, patch: Parameters<typeof town>[0] = () => undefined): Working {
  const w = town((wd) => {
    withRoutines(wd, [routine("r_maya", "maya", [SWIM, THERAPY]), routine("r_chens", "chen_household", [FAMILY_SECRET])], settings);
    patch(wd);
  });
  record(w, [{ type: "set", entity: "maya", field: "place", value: placeOfEntity(w.state, YOU) }]);
  return w;
}

describe("the narrator's soft line of a usual routine", () => {
  test("a present person the POV can see gets one line of their usual routine, marked as background, never a private block", () => {
    const w = withMaya();
    const hints = usualRoutineHints(w.ctx);
    const maya = hints.find((l) => l.startsWith("Maya"));
    expect(maya).toContain("Swimming at the gym");
    // Background, not a fact: the lead line says the narrator may use or ignore it.
    expect(hints[0]).toMatch(/background/i);
    for (const line of hints) {
      expect(line).not.toContain("therapist");
      expect(line).not.toContain("hidden ledger");
    }
  });

  test("off when the world turns the narrator's routines off, and for anyone the POV can't see or whose role is off", () => {
    expect(usualRoutineHints(withMaya({ narrator: false }).ctx)).toEqual([]);
    const hidden = withMaya(undefined, (wd) => {
      const maya = wd.entities.maya;
      if (maya) maya.visibility = "secret";
    });
    expect(usualRoutineHints(hidden.ctx).some((l) => l.includes("Swimming"))).toBe(false);
    const off = withMaya();
    gmEdit(off, [{ op: "routine_follow", entity: "maya", role: "off" }]);
    expect(usualRoutineHints(off.ctx).some((l) => l.includes("Swimming"))).toBe(false);
  });
});
