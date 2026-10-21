// Whose routine applies and how a world tunes it (DESIGN §8): a block id's most specific owner wins
// (their own, their household's, their kind's, a selector's, the world's default) with the chat's
// change on top; and each setting changes the days as designed: awareness (when what the story set
// gives way to routine again), invitations (who asks whom along), sociability and how plans bend
// routine.

import { describe, expect, test } from "bun:test";
import type { Fidelity } from "../../../src/shared/minds";
import type { RoutineBlock, RoutineDef, RoutineSettings } from "../../../src/shared/routines";
import type { Working } from "../../../src/engine/working";
import { dayPlan } from "../../../src/packs/castlife/core/index";
import { routineGmView } from "../../../src/packs/castlife/core/view";
import { at, fixed, gmEdit, gmPlan, invitations, lapse, pin, record, routine, town, whereabouts, withRoutines, YOU } from "./town";

const evening = (place: string): RoutineBlock => fixed("evening", "18:00", 180, { place }, { label: `Evening at ${place}` });
const OWNERS: RoutineDef[] = [
  routine("r_world", undefined, [evening("park")]),
  routine("r_principals", { tier: ["principal"] }, [evening("library")]),
  routine("r_baristas", "barista", [evening("gym")]),
  routine("r_chens", "chen_household", [evening("market")]),
  routine("r_maya", "maya", [evening("pub")]),
];

/** Where the evening block puts `who` on Friday, as laid and as lived at 18:30. */
function evenings(w: Working, who: string): { laid: unknown; lived: unknown } {
  const laid = dayPlan(w.ctx, who, 0).blocks.find((b) => b.start === at(w, 0, "18:00"))?.place;
  lapse(w, at(w, 0, "18:30"));
  return { laid, lived: whereabouts(w, who)[0] };
}

describe("whose routine applies", () => {
  test("their own, then their household's, then their kind's, then a selector's, then the world's default", () => {
    const seen = [5, 4, 3, 2, 1].map((n) => evenings(town((wd) => withRoutines(wd, OWNERS.slice(0, n))), "maya"));
    expect(seen).toEqual([
      { laid: "pub", lived: "pub" },
      { laid: "market", lived: "market" },
      { laid: "gym", lived: "gym" },
      { laid: "library", lived: "library" },
      { laid: "park", lived: "park" },
    ]);
    // Only whom an owner covers: Jordan is a principal but no barista or Chen; Rosa is neither.
    const all = town((wd) => withRoutines(wd, OWNERS));
    expect(["jordan", "rosa"].map((who) => dayPlan(all.ctx, who, 0).blocks.find((b) => b.start === at(all, 0, "18:00"))?.place)).toEqual(["library", "park"]);
    // The GM sees the chain: Maya's own block, shadowing the rest in that order.
    const block = routineGmView(all.ctx, "maya").blocks.find((b) => b.block.id === "evening");
    expect([block?.owner.level, ...(block?.shadowed ?? []).map((s) => s.owner.level)]).toEqual(["own", "group", "kind", "selector", "world"]);
  });

  test("a chat's change to a block sits on top of every owner's, and dropping it goes back to theirs", () => {
    const w = town((wd) => withRoutines(wd, OWNERS));
    gmEdit(w, [{ op: "routine_block", entity: "maya", block: "evening", value: { id: "evening", label: "Settling up at the bank", activity: "errand", kind: "fixed", at: "18:00", minutes: 60, place: { place: "bank" } } }]);
    expect(evenings(w, "maya")).toEqual({ laid: "bank", lived: "bank" });
    expect(routineGmView(w.ctx, "maya").blocks.find((b) => b.block.id === "evening")?.owner.level).toBe("chat");
    gmEdit(w, [{ op: "routine_block", entity: "maya", block: "evening", value: null }]);
    expect(dayPlan(w.ctx, "maya", 1).blocks.find((b) => b.start === at(w, 1, "18:00"))?.place).toBe("pub");
  });
});

describe("awareness: when what the story set gives way to routine", () => {
  /** Maya's evening at the Anchor; the story puts her in the park at three. Where she is through the night. */
  function night(world: Partial<RoutineSettings>, chat?: RoutineSettings["awareness"]): string[] {
    const w = town((wd) => withRoutines(wd, [routine("r_maya", "maya", [evening("pub")])], world));
    if (chat) gmEdit(w, [{ op: "routine_follow", entity: "maya", awareness: chat }]);
    lapse(w, at(w, 0, "15:00"));
    record(w, [{ type: "set", entity: "maya", field: "place", value: "park" }]);
    return [[0, "17:30"], [0, "18:30"], [1, "00:30"], [1, "06:30"]].map(([day, t]) => {
      lapse(w, at(w, Number(day), String(t)));
      return String(whereabouts(w, "maya")[0]);
    });
  }

  test("routine first takes her back at her routine's next block, balanced at bedtime, story first not at all", () => {
    expect(night({ awareness: "routine_first" })).toEqual(["maya_flat", "pub", "maya_flat", "cafe"]);
    expect(night({ awareness: "balanced" })).toEqual(["park", "park", "maya_flat", "cafe"]);
    expect(night({ awareness: "story_first" })).toEqual(["park", "park", "park", "park"]);
    // Balanced is the default; the chat can set one person's own.
    expect(night({})).toEqual(night({ awareness: "balanced" }));
    expect(night({ awareness: "balanced" }, "story_first")).toEqual(night({ awareness: "story_first" }));
  });
});

describe("invitations: who asks whom along", () => {
  /** Maya's drinks at the Anchor ask Alex and Jordan along; she knows both. */
  function friday(asking: RoutineSettings["invitations"]): { asked: unknown[]; jordan: unknown } {
    const drinks = fixed("drinks", "18:00", 180, { place: "pub" }, { label: "Drinks at the Anchor", activity: "drinks", company: { who: { ids: [YOU, "jordan"] }, invite: true } });
    const w = town((wd) => {
      withRoutines(wd, [routine("r_maya", "maya", [drinks])], { invitations: asking });
      for (const to of [YOU, "jordan"]) wd.entities.maya?.relations.push({ type: "regard", to, fields: { warmth: 40, trust: 40, respect: 40, t: 0 } });
    });
    lapse(w, at(w, 0, "18:30"));
    return { asked: invitations(w.events), jordan: whereabouts(w, "jordan")[0] };
  }

  test("off asks no one; to the player only asks Alex; between everyone also brings Jordan", () => {
    expect(friday("off")).toEqual({ asked: [], jordan: "jordan_house" });
    expect(friday("player")).toEqual({ asked: [["maya", "routine:drinks"]], jordan: "jordan_house" });
    expect(friday("everyone")).toEqual({ asked: [["maya", "routine:drinks"]], jordan: "pub" });
  });
});

describe("sociability and how plans bend routine", () => {
  test("an outgoing Maya sees her friends before she tidies up; a reserved one tidies first", () => {
    const run = (sociability: RoutineSettings["sociability"]): unknown => {
      const w = town((wd) =>
        withRoutines(
          wd,
          [
            routine("r_maya", "maya", [
              { id: "friends", label: "Friends at the Anchor", activity: "socialize", kind: "flexible", window: { from: "18:00", to: "21:00" }, minutes: 90, priority: 1, needs: ["social"], place: { place: "pub" } },
              { id: "tidy", label: "Tidies the flat", activity: "chores", kind: "flexible", window: { from: "18:00", to: "21:00" }, minutes: 60, priority: 3, needs: [], place: "home" },
            ]),
          ],
          { sociability },
        ),
      );
      lapse(w, at(w, 0, "18:30"));
      return whereabouts(w, "maya");
    };
    expect(run("outgoing")).toEqual(["pub", "socialize"]);
    expect(run("reserved")).toEqual(["maya_flat", "chores"]);
  });

  test("how strongly plans bend routine decides which of the story's plans take Jordan out of work", () => {
    /** Jordan at `level`, with the GM's errand at the bank in his working hours; where he is during it. */
    const during = (planBend: RoutineSettings["planBend"], level: Fidelity, priority: number): unknown => {
      // Alex has no work at the office today, so no scene there holds Jordan.
      const w = town((wd) => {
        delete wd.schedules.you_work;
        withRoutines(wd, [], { planBend });
      });
      record(w, [pin("jordan", level), gmPlan(w, "jordan", { id: "errand", priority, when: { from: at(w, 0, "10:00"), to: at(w, 0, "11:00") } })]);
      lapse(w, at(w, 0, "10:30"));
      return whereabouts(w, "jordan")[0];
    };
    expect([during("must", "far", 4), during("must", "far", 5)]).toEqual(["office", "bank"]);
    expect([during("strong", "near", 3), during("strong", "far", 4)]).toEqual(["office", "bank"]);
    expect([during("standard", "far", 3), during("standard", "near", 3)]).toEqual(["office", "bank"]);
    expect(during("ordinary", "far", 3)).toBe("bank");
  });
});
