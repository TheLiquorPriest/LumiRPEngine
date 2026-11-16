// `spawn` of a new thing put on a holder given in words that name nothing in the world, in the
// middle of a long call, played as the harness plays a call (checked and coerced by pi, then run).
// Where code puts it, no call said, so that spawn stands as assumed. Every name here is made up.

import { describe, expect, test } from "bun:test";
import type { HostTool, JsonObject } from "rp-harness/contract";
import { asHarnessPasses } from "../story/rig";
import { type Rig, rig, texts, wordsFromFiles } from "./rig";

const SRC = { from: "prose", message: "m-3" };

/** A blank world with a scene: the rock, the kitchen on it, Ada there, and the horizon on the kitchen. */
async function scene(): Promise<Rig> {
  const t = await rig({}, "blank");
  const r = await t.call("world_apply", {
    operations: [
      { op: "spawn", kind: "place", name: "Gull Skerry", source: SRC },
      { op: "spawn", kind: "place", name: "Keeper's kitchen", at: "Gull Skerry", source: SRC },
      { op: "spawn", kind: "place", name: "Boat shed", at: "Gull Skerry", source: SRC },
      { op: "spawn", kind: "person", name: "Ada Lorne", at: "Boat shed", source: SRC },
      { op: "horizon", list: ["Keeper's kitchen", "Ada Lorne"] },
    ],
  });
  expect(r.error).toBeUndefined();
  return t;
}

function entityNamed(t: Rig, name: string): { id: string; fields: JsonObject } {
  const [id, e] = Object.entries(t.s.stateAt(t.turn.id).state.world.entities).find(([, x]) => x.name === name) ?? [];
  if (id === undefined || e === undefined) throw new Error(`no ${name}`);
  return { id, fields: e.fields as JsonObject };
}

describe("spawn somewhere given in words", () => {
  test("a thing put on a holder that names nothing is made at the scene's place with the words kept on it, said once, and the rest of the call is applied", async () => {
    const t = await scene();
    const tool = t.tools.get("world_apply") as HostTool;
    const call: JsonObject = {
      operations: [
        { op: "spawn", kind: "person", name: "Ida Pell", at: "Keeper's kitchen", source: SRC },
        { op: "spawn", name: "Kettle", at: "Keeper's kitchen", source: SRC },
        { op: "spawn", name: "Tin mug", at: "Keeper's kitchen", source: SRC },
        { op: "fact", about: "Ida Pell", key: "came", value: "Crossed the causeway at dusk.", source: SRC },
        { op: "spawn", kind: "item", name: "Wet coat", on: "peg by the stove", source: SRC },
        { op: "spawn", name: "Oilskin hat", owner: "Ada Lorne", in: "the hat box by the door", source: SRC },
      ],
    };
    const r = await t.call("world_apply", asHarnessPasses(tool, call));
    expect(r.error).toBeUndefined();
    wordsFromFiles(r);
    const kitchen = String(entityNamed(t, "Ida Pell").fields.place);
    const shed = String(entityNamed(t, "Ada Lorne").fields.place);
    expect(r.reports).toEqual([
      "Operation 4 (fact): no lane was named, so this fact is recorded in the engine lane.",
      `Operation 5 (spawn): nothing goes by peg by the stove, so Wet coat was made at Keeper's kitchen [${kitchen}], which is recorded as assumed, and those words are kept on it as where it was said to be.`,
      `Operation 6 (spawn): nothing goes by the hat box by the door, so Oilskin hat was made at Boat shed [${shed}], which is recorded as assumed, and those words are kept on it as where it was said to be.`,
    ]);
    expect(entityNamed(t, "Wet coat").fields).toMatchObject({ place: kitchen });
    // Where its owner is, when the call names who it is for.
    expect(entityNamed(t, "Oilskin hat").fields).toMatchObject({ place: shed });
    expect(entityNamed(t, "Tin mug").fields.place).toBe(kitchen);
    // Each change of a spawn code placed stands as assumed, with the call's own source; one the call placed stands as the call gave it.
    const rows = t.s.changes(t.turn.id);
    const recorded = (name: string): unknown[] => {
      const { id } = entityNamed(t, name);
      return [...new Set(rows.filter((row) => JSON.stringify(row.value).includes(`"${id}"`)).map((row) => `${row.source}/${row.standing}`))];
    };
    expect(recorded("Wet coat")).toEqual(["prose/assumed"]);
    expect(recorded("Oilskin hat")).toEqual(["prose/assumed"]);
    expect(recorded("Tin mug")).toEqual(["prose/null"]);
  });

  test("with no one named and no scene to put it in, the thing is made at no place, its words kept, and the call says so", async () => {
    const t = await rig({}, "blank");
    const r = await t.call("world_apply", { operations: [{ op: "spawn", kind: "item", name: "Wet coat", on: "peg by the stove", source: SRC }] });
    expect(r.error).toBeUndefined();
    wordsFromFiles(r);
    expect(r.reports?.[0]).toContain("Wet coat was made at no place");
    expect(entityNamed(t, "Wet coat").fields.place).toBeUndefined();
  });
});
