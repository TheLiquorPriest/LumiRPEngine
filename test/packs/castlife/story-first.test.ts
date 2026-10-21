// The story comes first (DESIGN §8, §24.8): a routine or a schedule never moves the cast the story is
// about (Live and Near characters) or interrupts play for them, across a timelapse too; nobody in a
// scene with the POV is taken out of it in ordinary play; a Background character elsewhere keeps their
// routine and schedules. Invitations come only on a ground (a story plan, or a routine block that asks
// its company along), never from the cast the story is about, and never to a POV already with the
// host or where they'd meet.

import { describe, expect, test } from "bun:test";
import type { Fidelity } from "../../../src/shared/minds";
import type { RoutineBlock } from "../../../src/shared/routines";
import type { WorldDoc } from "../../../src/shared/world";
import { advance, catchUp } from "../../../src/engine/simulate";
import type { Working } from "../../../src/engine/working";
import { at, fixed, gmPlan, invitations, lapse, pin, record, reg, routine, town, whereabouts, withRoutines, YOU } from "./town";

/** Maya's drinks at the Anchor at eight, asking Alex along; she is fond of Alex. */
const DRINKS: RoutineBlock = fixed("drinks", "20:00", 120, { place: "pub" }, { label: "Drinks at the Anchor", activity: "drinks", company: { who: { ids: [YOU] }, invite: true } });

function fond(wd: WorldDoc, warmth = 60): void {
  wd.entities.maya?.relations.push({ type: "regard", to: YOU, fields: { warmth, trust: warmth, respect: warmth, t: 0 } });
}

/** Riverton where Maya's routine asks Alex along to drinks, Jordan spends Friday evening at the library, and Alex has the day off. */
function evening(patch: (w: WorldDoc) => void = () => undefined): Working {
  return town((wd) => {
    delete wd.schedules.you_work;
    withRoutines(wd, [routine("r_maya", "maya", [DRINKS]), routine("r_jordan", "jordan", [fixed("reading", "19:00", 120, { place: "library" }, { activity: "reading" })])]);
    fond(wd);
    patch(wd);
  });
}

describe("the cast the story is about", () => {
  test("a Live or Near character with the POV is never moved or interrupted by a routine or a schedule, across a timelapse", () => {
    for (const level of ["live", "near"] satisfies Fidelity[]) {
      const w = evening();
      // The story brings Maya round to Alex's for coffee before her shift.
      record(w, [pin("maya", level), { type: "set", entity: "maya", field: "place", value: "apartment" }, { type: "set", entity: "maya", field: "activity", value: "coffee" }]);
      const run = lapse(w, at(w, 0, "22:00"), true);
      // Her shift's start and end, her drinks and her bedtime all pass her by, and nothing of hers stops the skip.
      expect(whereabouts(w, "maya")).toEqual(["apartment", "coffee"]);
      expect(run.result.stop).toBe("target");
      expect(invitations(w.events)).toEqual([]);
      expect(w.events.some((e) => "data" in e && e.data.entity === "maya" && (e.data.class === "arrival" || e.data.class === "invitation"))).toBe(false);
    }
  });

  test("a Background character elsewhere keeps their routine and their schedules through the same skip", () => {
    const w = evening();
    record(w, [pin("maya", "live"), { type: "set", entity: "maya", field: "place", value: "apartment" }]);
    const seen: string[] = [];
    for (const t of ["12:00", "17:45", "19:30", "21:15"]) {
      lapse(w, at(w, 0, t));
      seen.push(`${t} ${whereabouts(w, "jordan").join("/")}`);
    }
    expect(seen).toEqual(["12:00 office/work_shift", "17:45 jordan_house/dinner", "19:30 library/reading", "21:15 jordan_house/idle"]);
  });

  test("in ordinary play nobody the POV is with is taken out of the scene by a routine or a schedule", () => {
    const w = evening();
    // Alex drops into the café at half past one, where Maya's shift ends at two.
    record(w, [{ type: "set", entity: YOU, field: "place", value: "cafe" }]);
    advance(reg, w, at(w, 0, "20:30"), { runSeed: "seed", mode: "turn" });
    catchUp(reg, w, { runSeed: "seed", agents: 8 });
    expect(whereabouts(w, "maya")[0]).toBe("cafe");
    expect(invitations(w.events)).toEqual([]);
  });
});

describe("invitations", () => {
  test("none without a ground: a fond friend with time on her hands asks nothing until a plan or her routine does", () => {
    const asked = (patch: (w: WorldDoc) => void, plan: boolean): unknown[] => {
      const w = town((wd) => {
        delete wd.schedules.you_work;
        fond(wd, 90);
        patch(wd);
      });
      if (plan) record(w, [pin("maya", "far"), gmPlan(w, "maya", { id: "catch_up", what: "Hear how Alex's week went", kind: "meet", where: "cafe", with: [YOU], priority: 4, when: { from: at(w, 1, "16:00"), to: at(w, 1, "17:00") } })]);
      const run = lapse(w, at(w, 2, "00:00"), true);
      expect(run.result.stop).toBe(invitations(w.events).length > 0 ? "interrupt" : "target");
      return invitations(w.events);
    };
    expect(asked(() => undefined, false)).toEqual([]);
    expect(asked((wd) => withRoutines(wd, [routine("r_maya", "maya", [DRINKS])]), false)).toEqual([["maya", "routine:drinks"]]);
    expect(asked(() => undefined, true)).toEqual([["maya", "plan:catch_up"]]);
  });

  test("none from the cast the story is about: a Live or Near host asks no one, a Far or Background one does", () => {
    const asked = (level: Fidelity | null): unknown[] => {
      const w = evening();
      if (level) record(w, [pin("maya", level)]);
      lapse(w, at(w, 0, "20:30"));
      return invitations(w.events);
    };
    expect([asked("live"), asked("near")]).toEqual([[], []]);
    expect([asked("far"), asked(null)]).toEqual([[["maya", "routine:drinks"]], [["maya", "routine:drinks"]]]);
  });

  test("none to a POV already with the host, or already where they'd meet", () => {
    // Turns pass the hour the drinks are asked (two in the afternoon) with Alex where the story put them.
    const asked = (where: string): unknown[] => {
      const w = evening();
      record(w, [{ type: "set", entity: YOU, field: "place", value: where }]);
      advance(reg, w, at(w, 0, "18:30"), { runSeed: "seed", mode: "turn" });
      catchUp(reg, w, { runSeed: "seed", agents: 8 });
      return invitations(w.events);
    };
    expect(asked("apartment")).toEqual([["maya", "routine:drinks"]]);
    // Maya serves at the café until two: Alex sitting there is with her when she'd ask.
    expect(asked("cafe")).toEqual([]);
    expect(asked("pub")).toEqual([]);
  });
});
