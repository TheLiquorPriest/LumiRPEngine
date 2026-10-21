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
import { at, foldBoth, gmEdit, held, lapse, pin, record, reg, town, whereabouts, withRoutines, YOU } from "./town";
import { runTimelapse } from "../../../src/engine/time";
import { ENGINE_EVENTS } from "../../../src/engine/engine-pack";
import { advance } from "../../../src/engine/simulate";

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

  test("model: in a skip the story holds the POV through, someone with it leaves at their planned block and comes back for a later one, and the POV sees both", () => {
    // Maya, Live, is round at Alex's for coffee; Alex knows her.
    const w = town((wd) => void wd.entities[YOU]?.relations.push({ type: "knows", to: "maya" }));
    record(w, [pin("maya", "live"), { type: "set", entity: "maya", field: "place", value: "apartment" }, { type: "set", entity: "maya", field: "activity", value: "coffee" }]);
    const end = w.state.clock + SPAN;
    record(w, [
      planned(w, [
        {
          entity: "maya",
          blocks: [
            { label: "Home for the afternoon", start: at(w, 0, "12:00"), end: at(w, 0, "20:00"), place: "maya_flat", activity: "idle" },
            { label: "Back at Alex's", start: at(w, 0, "21:00"), end, place: "apartment", activity: "visiting" },
          ],
        },
      ]),
    ]);
    const from = w.events.length;
    // Under the world's own interrupts, where an arrival stops a skip, with Alex held at home.
    const out = runTimelapse(reg, w, { type: "at", at: end }, { runSeed: "seed", povRoutine: false });
    if ("code" in out) throw new Error(out.reason);
    const run = w.events.slice(from);
    const moves = run.flatMap((e) => (e.type === "set" && e.entity === "maya" && e.field === "place" ? [e.value] : []));
    expect([out.result.stop, moves, whereabouts(w, "maya")]).toEqual(["target", ["maya_flat", "apartment"], ["apartment", "visiting"]]);
    // Alex saw her go and come back: a note and an arrival that only notes, both in the Montage.
    const seen = run.filter((e) => "data" in e && e.data.entity === "maya" && (e.type === ENGINE_EVENTS.note || (e.type === ENGINE_EVENTS.signal && e.data.class === "arrival")));
    expect(seen.map((e) => ("data" in e ? [e.type, e.data.stops ?? true] : []))).toEqual([
      [ENGINE_EVENTS.note, true],
      [ENGINE_EVENTS.signal, false],
    ]);
    const lines = out.montage.groups.flatMap((g) => g.lines);
    expect(seen.every((e) => "data" in e && lines.includes(String(e.data.text)))).toBe(true);
  });

  /** Where `who` was put, with the clock time of each move, in a run's events from `from`. */
  function moves(w: Working, from: number, start: number, who: string): string[] {
    let clock = start;
    const out: string[] = [];
    for (const e of w.events.slice(from)) {
      if (e.type === "clock") clock += e.minutes;
      else if (e.type === "set" && e.entity === who && e.field === "place") out.push(`${clock - start} ${String(e.value)}`);
    }
    return out;
  }

  test("model, as played live: the cast come to the POV's place and go at their minutes, and the Montage tells both, whether or not the POV holds a knows link to them", () => {
    // Maya, Live, is at the pub; Alex is held at home. They know each other through her regard, but
    // Alex holds no `knows` link to her, as Port Alder's POV holds none to Danny or Marcus.
    const w = town((wd) => void wd.entities.maya?.relations.push({ type: "regard", to: YOU, fields: { warmth: 30, trust: 30, respect: 30, t: 0 } }));
    record(w, [pin("maya", "live"), { type: "set", entity: "maya", field: "place", value: "pub" }]);
    const start = w.state.clock;
    record(w, [planned(w, [{ entity: "maya", blocks: [{ label: "Coffee at Alex's", start: start + 90, end: start + 240, place: "apartment", activity: "visiting" }, { label: "Back to the pub", start: start + 240, end: start + SPAN, place: "pub", activity: "drinks" }] }])]);
    const from = w.events.length;
    const out = runTimelapse(reg, w, { type: "at", at: start + SPAN }, { runSeed: "seed", povRoutine: false });
    if ("code" in out) throw new Error(out.reason);
    // She arrives (an event puts her there) and leaves at their own minutes, 90 and 240 in.
    expect(moves(w, from, start, "maya")).toEqual(["90 apartment", "240 pub"]);
    const lines = out.montage.groups.flatMap((g) => g.lines);
    const told = w.events.slice(from).flatMap((e) => ("data" in e && e.data.entity === "maya" && (e.type === ENGINE_EVENTS.note || (e.type === ENGINE_EVENTS.signal && e.data.class === "arrival")) ? [String(e.data.text)] : []));
    expect([told.length, told.every((t) => lines.includes(t))]).toEqual([2, true]);
  });

  test("model, as played live: someone a turn's catch-up left behind lives a short visit early in the skip's first slot at its minute", () => {
    // Turns take the clock past noon without stepping Maya, off screen and Far: she lags two slots.
    const w = friday("model");
    advance(reg, w, at(w, 0, "12:10"), { runSeed: "seed", mode: "turn" });
    const start = w.state.clock;
    record(w, [planned(w, [{ entity: "maya", blocks: [{ label: "Lunch at the pub", start: at(w, 0, "12:30"), end: at(w, 0, "13:15"), place: "pub", activity: "lunch" }, { label: "Back to the library", start: at(w, 0, "13:15"), end: at(w, 0, "17:00"), place: "library", activity: "reading" }] }])]);
    const from = w.events.length;
    held(w, at(w, 0, "18:00"));
    expect(moves(w, from, start, "maya")).toEqual([`${at(w, 0, "12:30") - start} pub`, `${at(w, 0, "13:15") - start} library`]);
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
