// Routine roles (DESIGN §8): what someone's routine and their own schedules are to the engine, by
// level of closeness and per character in a chat. By default the Live, Near and Far cast's are
// informative, context only: nothing of theirs moves them, in a turn or in any skip, with the POV or
// away from it, and narration and context-aware planning decide what they do. A Background
// character's is enforced. World schedules and money flows keep running whatever the roles.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../../src/shared/hash";
import type { EventRef, LedgerEvent } from "../../../src/shared/ledger";
import { FIDELITIES, type Fidelity } from "../../../src/shared/minds";
import { DEFAULT_ROUTINE_ROLES, ROUTINE_ROLES, type RoutineEditOp, type RoutineRole } from "../../../src/shared/routines";
import { resolveEdit } from "../../../src/engine/edits";
import { advance, catchUp } from "../../../src/engine/simulate";
import type { WorldState } from "../../../src/engine/state";
import type { Working } from "../../../src/engine/working";
import { routineChanges } from "../../../src/packs/castlife/core/view";
import { at, foldBoth, gmEdit, held, lapse, pin, record, reg, town, whereabouts, withRoutines } from "./town";
import { entity, lapse as workLapse, packEvents, paid, setup } from "../economy/work-world";

/** The ways time passes: a palette Timelapse the POV's routine runs in (it goes to work), one that holds the POV, and ordinary turns with their catch-up. */
const RUNS: Record<string, (w: Working, to: number) => void> = {
  "a Timelapse the POV's routine runs in": (w, to) => void lapse(w, to),
  "a Timelapse that holds the POV": (w, to) => void held(w, to),
  "ordinary turns": (w, to) => {
    advance(reg, w, to, { runSeed: "seed", mode: "turn" });
    catchUp(reg, w, { runSeed: "seed", agents: 8 });
  },
};

/** Whether Maya's day moved her: her café shift (06:00 to 14:00) ends at two and takes her home, as an enforced routine does. */
function movedBy(w: Working, run: (w: Working, to: number) => void): boolean {
  run(w, at(w, 0, "15:00"));
  return whereabouts(w, "maya")[0] !== "cafe";
}

describe("the cast's routine informs; it doesn't move them", () => {
  test("Live, Near and Far characters stay where the story has them through turns and every skip, with the POV or away from it", () => {
    for (const level of ["live", "near", "far"] satisfies Fidelity[]) {
      for (const [how, run] of Object.entries(RUNS)) {
        for (const where of ["library", "apartment"]) {
          const w = town();
          // The story has Maya at the library, or round at Alex's for coffee; Alex goes to work at nine in a Timelapse that follows its routine.
          record(w, [pin("maya", level), { type: "set", entity: "maya", field: "place", value: where }, { type: "set", entity: "maya", field: "activity", value: "coffee" }]);
          run(w, at(w, 0, "22:00"));
          // Her shift, her schedules' edges, her evening and her bedtime all pass her by.
          expect({ level, how, where, now: whereabouts(w, "maya") }).toEqual({ level, how, where, now: [where, "coffee"] });
          expect(w.events.some((e) => "data" in e && e.data.entity === "maya" && (e.data.class === "arrival" || e.data.class === "invitation"))).toBe(false);
        }
      }
    }
  });

  test("each level's role is the world's to set; only an enforced routine moves anyone", () => {
    for (const level of FIDELITIES) {
      for (const role of ROUTINE_ROLES) {
        const w = town((wd) => withRoutines(wd, [], { roles: { ...DEFAULT_ROUTINE_ROLES, [level]: role } }));
        record(w, [pin("maya", level)]);
        expect({ level, role, moved: movedBy(w, RUNS["a Timelapse the POV's routine runs in"]!) }).toEqual({ level, role, moved: role === "enforced" });
      }
    }
    // By default, Background alone.
    expect(FIDELITIES.map((level) => [level, DEFAULT_ROUTINE_ROLES[level]])).toEqual([
      ["live", "informative"],
      ["near", "informative"],
      ["far", "informative"],
      ["background", "enforced"],
    ]);
  });

  test("the GM sets one character's role in a chat; null returns them to their level's", () => {
    const roled = (level: Fidelity, ops: RoutineEditOp[]): boolean => {
      const w = town();
      record(w, [pin("maya", level)]);
      for (const op of ops) gmEdit(w, [op]);
      return movedBy(w, RUNS["a Timelapse the POV's routine runs in"]!);
    };
    const follow = (role: RoutineRole | null): RoutineEditOp => ({ op: "routine_follow", entity: "maya", role });
    expect(roled("live", [follow("enforced")])).toBe(true);
    expect(roled("background", [follow("informative")])).toBe(false);
    expect(roled("background", [follow("off")])).toBe(false);
    expect(roled("background", [follow("informative"), follow(null)])).toBe(true);
    // Their mode and awareness stay as they were set.
    const w = town();
    gmEdit(w, [{ op: "routine_follow", entity: "maya", mode: "no_invitations" }, follow("informative")]);
    expect(routineChanges(reg.context(w.world, w.state)).map((c) => c.follow)).toEqual([{ mode: "no_invitations", awareness: null, role: "informative", skips: null }]);
  });

  test("the GM's role folds the same both ways, and Undo takes it back", () => {
    const world = town().world;
    const fixes: LedgerEvent[][] = [];
    const states: WorldState[] = [foldBoth(world, [], fixes).state];
    for (const op of [{ op: "routine_follow", entity: "maya", role: "informative" }, { op: "routine_follow", entity: "maya", awareness: "story_first" }, { op: "routine_follow", entity: "maya", role: null }] satisfies RoutineEditOp[]) {
      const out = resolveEdit(reg, world, states.at(-1) ?? states[0]!, [op], { gm: true, runSeed: "seed" });
      if ("rejection" in out) throw new Error(out.rejection.reason);
      fixes.push(out.events);
      states.push(foldBoth(world, [], fixes).state);
    }
    expect(states.map((s) => routineChanges(reg.context(world, s)).map((c) => c.follow))).toEqual([[], [{ mode: null, awareness: null, role: "informative", skips: null }], [{ mode: null, awareness: "story_first", role: "informative", skips: null }], [{ mode: null, awareness: "story_first", role: null, skips: null }]]);
    const undo = (count: number): EventRef[] => Array.from({ length: count }, (_, i) => ({ in: "post" as const, seq: fixes.length - i, index: 0 }));
    for (let k = 1; k <= fixes.length; k++) expect(hashJson(foldBoth(world, [], fixes, undo(k)).state)).toBe(hashJson(states[fixes.length - k]));
  });
});

describe("money and the world run whatever the roles", () => {
  test("an informative worker kept away from work all week is still paid for her scheduled shifts, and her bills still post", () => {
    const { w } = setup((wd) => {
      wd.entities.job_maya = entity("job_maya", "job", "Barista", { worker: "maya", employer: "daybreak", title: "Barista", basis: "hourly", rate: 1_800, hours: "scheduled", pay_every: "weekly", pay_weekday: 5, start: "2025-01-06" });
      wd.entities.maya_rent = entity("maya_rent", "flow", "Maya's rent", { flow_kind: "bill", from: "maya_checking", to: "Landlord", amount_cents: 2_000, every: "day", shortfall: "skip", status: "active" });
    });
    // Maya is Live, at home: the story has kept her there, and her café shifts don't take her.
    record(w, [pin("maya", "live"), { type: "set", entity: "maya", field: "place", value: "maya_flat" }]);
    workLapse(w, 8 * 1440);
    expect(whereabouts(w, "maya")[0]).toBe("maya_flat");
    // Friday's payday pays the week her schedule says she worked; the rent posts every day.
    expect(paid(w, "job_maya").map((d) => (typeof d.minutes === "number" ? d.minutes > 0 : false))).toEqual([true]);
    expect(packEvents(w, "economy.flow_run").filter((e) => e.data.flow === "maya_rent" && e.data.outcome === "paid").length).toBe(8);
  });
});
