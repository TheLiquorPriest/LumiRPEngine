import { describe, expect, test } from "bun:test";
import { blockAt, planDay, type PlanInput } from "../../src/engine/plan-day";
import { createRng } from "../../src/engine/rng";

function input(patch: Partial<PlanInput> = {}): PlanInput {
  return {
    agent: "dev",
    start: 0,
    end: 24 * 60,
    fixed: [{ start: 9 * 60, end: 17 * 60, label: "Work", activity: "work_shift", place: "office", reason: "shift" }],
    options: [
      { id: "sleep", label: "Sleep", activity: "sleep", place: "home", duration: 7 * 60, utility: (t) => (t < 6 * 60 || t >= 22 * 60 ? 10 : 0), reasons: ["tired"], repeat: true },
      { id: "gym", label: "Gym", activity: "exercise", place: "gym", duration: 60, utility: 4, reasons: ["agenda: get fit"] },
      { id: "bar", label: "Bar", activity: "drinks", place: "bar", duration: 120, utility: 4.2, reasons: ["friends"] },
      { id: "read", label: "Read", activity: "reading", place: "home", duration: 90, utility: 1, reasons: ["hobby"] },
    ],
    rng: createRng("plan-seed"),
    ...patch,
  };
}

describe("the day planner", () => {
  test("commitments are fixed; free time goes to the best utility; the plan covers the day", () => {
    const plan = planDay(input());
    expect(blockAt(plan, 10 * 60)?.label).toBe("Work");
    expect(blockAt(plan, 3 * 60)?.option).toBe("sleep");
    expect(plan.blocks[0]?.start).toBe(0);
    expect(plan.blocks.at(-1)?.end).toBe(24 * 60);
    for (let i = 1; i < plan.blocks.length; i++) expect(plan.blocks[i]?.start).toBe(plan.blocks[i - 1]?.end);
  });

  test("ties are recorded with their options; the same seed gives the same plan", () => {
    const a = planDay(input());
    const b = planDay(input({ rng: createRng("plan-seed") }));
    expect(a).toEqual(b);
    expect(a.ties.length).toBeGreaterThan(0);
    expect(a.ties[0]?.options.map((o) => o.id).sort()).toEqual(["bar", "gym"]);
    expect(a.ties[0]?.via).toBe("seed");
    expect(a.tieZone).toBe(true);
  });

  test("a recorded choice is replayed whatever the seed; a model decision is used when given", () => {
    const first = planDay(input());
    const tie = first.ties[0]!;
    const other = tie.chosen === "bar" ? "gym" : "bar";
    const replay = planDay(input({ rng: createRng("different"), recorded: { [tie.key]: other } }));
    expect(replay.ties[0]?.chosen).toBe(other);
    expect(replay.ties[0]?.via).toBe("recorded");
    const model = planDay(input({ decide: () => "gym" }));
    expect([model.ties[0]?.chosen, model.ties[0]?.via, model.tieZone]).toEqual(["gym", "model", false]);
  });

  test("with nothing worth doing, the agent idles", () => {
    const plan = planDay(input({ options: [], fixed: [] }));
    expect(plan.blocks).toEqual([{ start: 0, end: 1440, option: "idle", label: "Free time", activity: "idle", place: null, utility: 0, reasons: ["nothing better to do"], fixed: false }]);
  });
});
