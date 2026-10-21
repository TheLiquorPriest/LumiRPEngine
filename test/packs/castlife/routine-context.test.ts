// Routines as context (DESIGN §6.6, §24.5): a routine is informative by default, so the narrator
// and a character's own mind may weigh it and the story decides. The narrator gets one soft line of
// the usual routine of each person with the POV that it can see, from the player's view of it; a
// mind reads its own routine and schedules within their limit, never the planner's day.

import { describe, expect, test } from "bun:test";
import { mindContext, type MindContextReport } from "../../../src/backend/minds-context";
import { factLines } from "../../../src/backend/turn-steps";
import { DEFAULT_MIND_READS, DEFAULT_MINDS_MEMORY, type MindsReads } from "../../../src/shared/minds";
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
    // A hint is no fact: no helper reads it.
    expect(factLines(reg, w.world, w.state, []).some((l) => l.includes("Swimming"))).toBe(false);
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

describe("a mind's usual routine", () => {
  const context = (w: Working, reads: MindsReads = DEFAULT_MIND_READS, report?: MindContextReport): string =>
    mindContext({ reg, world: w.world, state: w.state, who: "maya", memory: DEFAULT_MINDS_MEMORY, messages: [], hideJson: true, reads, moment: { kind: "turn", at: w.state.clock, reason: "", user: "", reply: "" } }, report);
  const routineOf = (text: string): string => /## Your usual routine[^\n]*\n((?:- .*\n?)*)/.exec(text)?.[1] ?? "";

  test("on by default: their routine and their own private block, never a private block that isn't theirs or the planner's day", () => {
    const w = withMaya();
    // A plan the GM recorded: the planner lays it into her day (a Far character's), and it is no habit of hers.
    record(w, [pin("maya", "far"), gmPlan(w, "maya", { id: "dinner", what: "Dinner with Jordan at the Anchor", kind: "meet", where: "pub", with: ["jordan"], priority: 4, when: { from: at(w, 0, "19:30"), to: at(w, 0, "21:00") } })]);
    const laid = dayPlan(w.ctx, "maya", 0).blocks.find((b) => b.option === "plan:dinner");
    expect(laid).toBeDefined();
    const lines = routineOf(context(w));
    expect(lines).not.toContain(laid?.label ?? "plan:dinner");
    expect(lines).toContain("Swimming at the gym");
    expect(lines).toContain("Seeing her therapist");
    expect(lines).not.toContain("hidden ledger");
    expect(lines).not.toContain("Dinner with Jordan");
    // Their life (off by default) is where the planner's day goes, once the user turns it on.
    expect(context(w, { ...DEFAULT_MIND_READS, life: { on: true, tokens: "none" } })).toContain("Dinner with Jordan");
  });

  test("off, it isn't there; within its limit, whole lines only, and the report says how many were left out", () => {
    const w = withMaya();
    expect(context(w, { ...DEFAULT_MIND_READS, routine: { on: false, tokens: "none" } })).not.toContain("Your usual routine");
    const whole = routineOf(context(w, { ...DEFAULT_MIND_READS, routine: { on: true, tokens: "none" } })).trim().split("\n");
    expect(whole.length).toBeGreaterThan(1);
    const report: MindContextReport = { pinned: [], activated: [] };
    const first = whole[0] ?? "";
    // Room for the first line alone.
    const cut = routineOf(context(w, { ...DEFAULT_MIND_READS, routine: { on: true, tokens: Math.ceil(first.length / 3.2) + 2 } }, report)).trim().split("\n");
    expect(cut.length).toBeLessThan(whole.length);
    for (const line of cut) expect(whole).toContain(line);
    expect(report.routine).toEqual({ given: cut.length, left: whole.length - cut.length });
  });

  test("a mind whose routine role is off reads none", () => {
    const w = withMaya();
    gmEdit(w, [{ op: "routine_follow", entity: "maya", role: "off" }]);
    expect(context(w)).not.toContain("Your usual routine");
  });
});
