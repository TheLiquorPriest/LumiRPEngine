// How the cast spends a time skip (DESIGN §8, issue #53): while someone's routine is informative,
// their level's choice, or the GM's for them, says whether a skip leaves them where the story has
// them, lives their routine for its span, or lives what the model planned for them at its start.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../../src/shared/hash";
import type { EventRef, LedgerEvent } from "../../../src/shared/ledger";
import { DEFAULT_SKIP_LIVES, ROUTINE_EVENTS, type RoutineEditOp, type SkipLife, type SkipPlan } from "../../../src/shared/routines";
import { resolveEdit } from "../../../src/engine/edits";
import type { WorldState } from "../../../src/engine/state";
import type { Working } from "../../../src/engine/working";
import { routineChanges } from "../../../src/packs/castlife/core/view";
import { fold, startState } from "../support";
import { at, foldBoth, gmEdit, lapse, pin, record, reg, town, whereabouts, withRoutines } from "./town";

/** The skip: twenty-two hours from Friday 07:30, the POV at home on its own day. */
const SPAN = 22 * 60;

/** Riverton with Far characters spending skips as `far` says; Maya, Far, at the library where the story put her. */
function friday(far: SkipLife = DEFAULT_SKIP_LIVES.far): Working {
  const w = town((wd) => withRoutines(wd, [], { skips: { ...DEFAULT_SKIP_LIVES, far } }));
  record(w, [pin("maya", "far"), { type: "set", entity: "maya", field: "place", value: "library" }, { type: "set", entity: "maya", field: "activity", value: "reading" }]);
  return w;
}

/** The model's plan for the skip starting now, as the turn records it ahead of the timelapse. */
function planned(w: Working, plans: SkipPlan["plans"]): LedgerEvent {
  return { type: ROUTINE_EVENTS.skipPlan, data: JSON.parse(JSON.stringify({ from: w.state.clock, to: w.state.clock + SPAN, plans })) };
}

/** Drinks at the Anchor in the evening, then bed at her flat. */
const EVENING = (w: Working): SkipPlan["plans"][number]["blocks"] => [
  { label: "Drinks at the Anchor", start: at(w, 0, "19:00"), end: at(w, 0, "23:00"), place: "pub", activity: "drinks" },
  { label: "Bed", start: at(w, 0, "23:30"), end: w.state.clock + SPAN, place: "maya_flat", activity: "sleep" },
];

describe("a time skip, for someone whose routine is informative", () => {
  test("stay: they keep where the story has them, whatever was planned for them", () => {
    const w = friday("stay");
    record(w, [planned(w, [{ entity: "maya", blocks: EVENING(w) }])]);
    lapse(w, w.state.clock + SPAN);
    expect(whereabouts(w, "maya")).toEqual(["library", "reading"]);
  });

  test("routine: someone the POV isn't with goes home to sleep during a 22-hour skip", () => {
    const w = friday("routine");
    lapse(w, w.state.clock + SPAN);
    // Her shift's end passes her by at the library, where the story has her; bedtime takes her home.
    expect(whereabouts(w, "maya")).toEqual(["maya_flat", "sleep"]);
  });

  test("model: the recorded blocks are lived, someone it didn't plan stays, and a replay folds from the record", () => {
    const w = friday("model");
    record(w, [pin("jordan", "far"), { type: "set", entity: "jordan", field: "place", value: "bank" }, planned(w, [{ entity: "maya", blocks: EVENING(w) }])]);
    const end = w.state.clock + SPAN;
    lapse(w, at(w, 0, "21:00"));
    expect([whereabouts(w, "maya"), whereabouts(w, "jordan")[0]]).toEqual([["pub", "drinks"], "bank"]);
    lapse(w, end);
    expect([whereabouts(w, "maya"), whereabouts(w, "jordan")[0]]).toEqual([["maya_flat", "sleep"], "bank"]);
    // The fold reads the recorded plan and moves: nothing is planned again.
    expect(fold(reg, w.world, startState(w.world), w.events)).toEqual(w.state);
  });

  test("the GM sets one character's skip life; null returns them to their level's, both folds agree and Undo takes it back", () => {
    const where = (ops: RoutineEditOp[]): unknown => {
      const w = friday();
      for (const op of ops) gmEdit(w, [op]);
      lapse(w, w.state.clock + SPAN);
      return whereabouts(w, "maya")[0];
    };
    const skips = (life: SkipLife | null): RoutineEditOp => ({ op: "routine_follow", entity: "maya", skips: life });
    // Her level's: planned by the model, and no plan names her, so she stays.
    expect(where([])).toBe("library");
    expect(where([skips("routine")])).toBe("maya_flat");
    expect(where([skips("routine"), skips(null)])).toBe("library");

    const world = town().world;
    const fixes: LedgerEvent[][] = [];
    const states: WorldState[] = [foldBoth(world, [], fixes).state];
    for (const op of [skips("routine"), { op: "routine_follow", entity: "maya", mode: "no_invitations" }, skips(null)] satisfies RoutineEditOp[]) {
      const out = resolveEdit(reg, world, states.at(-1) ?? states[0]!, [op], { gm: true, runSeed: "seed" });
      if ("rejection" in out) throw new Error(out.rejection.reason);
      fixes.push(out.events);
      states.push(foldBoth(world, [], fixes).state);
    }
    expect(states.map((s) => routineChanges(reg.context(world, s)).map((c) => c.follow))).toEqual([[], [{ mode: null, awareness: null, role: null, skips: "routine" }], [{ mode: "no_invitations", awareness: null, role: null, skips: "routine" }], [{ mode: "no_invitations", awareness: null, role: null, skips: null }]]);
    const undo = (count: number): EventRef[] => Array.from({ length: count }, (_, i) => ({ in: "post" as const, seq: fixes.length - i, index: 0 }));
    for (let k = 1; k <= fixes.length; k++) expect(hashJson(foldBoth(world, [], fixes, undo(k)).state)).toBe(hashJson(states[fixes.length - k]));
  });
});
