// The routines and schedules screens (#48): Build's schedule editor, as the engine reads what it writes.

import { describe, expect, test } from "bun:test";
import { createRegistry } from "../../src/engine/registry-impl";
import { createRng } from "../../src/engine/rng";
import { ownerRank, sampleSlot, scheduleOwners } from "../../src/engine/schedules";
import { ownerLevel, ownerOptions, type Owner, type OwnerLevel } from "../../src/frontend/build/owner-picker";
import { kindIs } from "../../src/frontend/build/selector-editor";
import { givenKey, givenValue, scheduleWrite, slotValueType } from "../../src/frontend/build/schedule-form";
import { ALL_PACKS } from "../../src/packs/index";
import type { ScheduleDef, WorldDoc } from "../../src/shared/world";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

/** Riverton with the Chens' household, Maya in it: a group whose schedules reach its members. */
function riverton(): WorldDoc {
  const w = modernUsWorld("w", "Riverton");
  w.entities.chens = { id: "chens", kind: "household", name: "The Chens", tier: "background", fields: {}, relations: [] };
  w.entities.maya?.relations.push({ type: "member_of", to: "chens" });
  return w;
}

/** The draft as Build's forms read it: the packs' kinds merged in, the world's own winning. */
function formDoc(w: WorldDoc): WorldDoc {
  const reg = createRegistry(ALL_PACKS);
  return { ...w, kinds: { ...Object.fromEntries(reg.kinds), ...w.kinds } };
}

describe("Build → Schedules", () => {
  test("each owner level the editor offers is the level the engine ranks, and a group's schedule reaches its members", () => {
    const reg = createRegistry(ALL_PACKS);
    const w = riverton();
    const doc = formDoc(w);
    const state = startState(w, reg);
    const RANK: Record<OwnerLevel, number | null> = { entity: 0, group: 1, kind: 2, selector: 3, none: null };
    const owners: [Owner, OwnerLevel][] = [
      ["maya", "entity"],
      ["chens", "group"],
      ["person", "kind"],
      [{ tier: ["principal"] }, "selector"],
      [undefined, "none"],
    ];
    for (const [owner, level] of owners) {
      const schedule: ScheduleDef = { id: "s", owner, target: "place", recurrence: { every: "day" }, slots: [] };
      expect([owner, ownerLevel(doc, owner)]).toEqual([owner, level]);
      expect([owner, RANK[level]]).toEqual([owner, ownerRank(reg, w, state, schedule)]);
    }
    // The pickers offer each owner at its own level only.
    expect(ownerOptions(doc, "group").map((o) => o.value)).toContain("chens");
    expect(ownerOptions(doc, "group").map((o) => o.value)).not.toContain("maya");
    expect(ownerOptions(doc, "entity").map((o) => o.value)).toContain("maya");
    expect(ownerOptions(doc, "entity").map((o) => o.value)).not.toContain("chens");
    expect(scheduleOwners(reg, w, state, { id: "s", owner: "chens", target: "place", recurrence: { every: "day" }, slots: [] })).toEqual(["maya"]);
  });

  test("values are typed by what the schedule sets: places by id, a declared field by its definition, else words", () => {
    const doc = formDoc(riverton());
    expect(slotValueType(doc, "maya", "place")).toEqual({ kind: "place" });
    const activity = slotValueType(doc, "maya", "activity");
    expect(activity.kind === "field" ? activity.def.type : activity.kind).toBe("text");
    expect(slotValueType(doc, "chens", "mood_of_the_day")).toEqual({ kind: "words" });
  });
});
