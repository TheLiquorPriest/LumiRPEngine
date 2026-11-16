// A thing an operation names that is not recorded yet: `place` and
// `give` naming a thing nothing recorded goes by, and a support given in words that name nothing.
// Played as the harness plays a call (checked and coerced by pi, then run). Every name here is made up.

import { describe, expect, test } from "bun:test";
import type { HostTool, JsonObject, ToolResult } from "rp-harness/contract";
import { asHarnessPasses } from "../story/rig";
import { type Rig, rig, texts, wordsFromFiles } from "./rig";

const SRC = { from: "prose", message: "m-2" };

/** A blank world with a scene: the rock, the kitchen and the boat shed on it, two people in the kitchen, a lamp, and the horizon on the kitchen. */
async function scene(): Promise<Rig> {
  const t = await rig({}, "blank");
  const r = await t.call("world_apply", {
    operations: [
      { op: "spawn", kind: "place", name: "Gull Skerry", source: SRC },
      { op: "spawn", kind: "place", name: "Keeper's kitchen", at: "Gull Skerry", source: SRC },
      { op: "spawn", kind: "place", name: "Boat shed", at: "Gull Skerry", source: SRC },
      { op: "spawn", kind: "person", name: "Traveller", at: "Keeper's kitchen", source: SRC },
      { op: "spawn", kind: "person", name: "Marta Venn", at: "Keeper's kitchen", source: SRC },
      { op: "spawn", name: "Oil lamp", at: "Keeper's kitchen", source: SRC },
      { op: "horizon", list: ["Keeper's kitchen", "Traveller"] },
    ],
  });
  expect(r.error).toBeUndefined();
  return t;
}

interface Seen {
  id: string;
  fields: JsonObject;
  relations: { type: string; to: string }[];
}

function entityNamed(t: Rig, name: string): Seen {
  const [id, e] = Object.entries(t.s.stateAt(t.turn.id).state.world.entities).find(([, x]) => x.name === name) ?? [];
  if (id === undefined || e === undefined) throw new Error(`no ${name}`);
  return { id, fields: e.fields as JsonObject, relations: e.relations };
}

function count(t: Rig, name: string): number {
  return Object.values(t.s.stateAt(t.turn.id).state.world.entities).filter((x) => x.name === name).length;
}

/** The call as the model sent it, through pi's argument check first. */
async function play(t: Rig, operations: JsonObject[]): Promise<ToolResult> {
  const r = await t.call("world_apply", asHarnessPasses(t.tools.get("world_apply") as HostTool, { operations }));
  wordsFromFiles(r);
  return r;
}

/** The answer's lines that name `words`. */
function linesOn(r: ToolResult, words: string): string[] {
  return texts(r).filter((x) => !x.startsWith("{") && x.includes(words));
}

describe("a thing an operation names that is not recorded yet", () => {
  test.skip("hardening: place: the hand lantern is made where it is set down, the table it was said to be on kept as words, and the answer is clean", async () => {
    const t = await scene();
    const r = await play(t, [{ op: "place", what: "hand lantern", at: "Keeper's kitchen", on: "the table" }]);
    expect(r.error).toBeUndefined();
    expect(r.reports).toBeUndefined();
    const kitchen = String(entityNamed(t, "Traveller").fields.place);
    const lantern = entityNamed(t, "hand lantern");
    expect(lantern.fields).toMatchObject({ place: kitchen, said_on: "the table" });
    expect(linesOn(r, "hand lantern")).toEqual([
      `Operation 1 (place): nothing recorded went by hand lantern, so it was made as a thing, hand lantern [${lantern.id}].`,
      `Operation 1 (place): nothing goes by the table, so those words are kept on hand lantern [${lantern.id}] as where it was said to be.`,
    ]);
  });

  test("place after a spawn of it, as sent next: the table is kept as words, and the lantern made by the spawn stays where it is", async () => {
    const t = await scene();
    const r = await play(t, [
      { op: "spawn", name: "hand lantern", at: "Keeper's kitchen" },
      { op: "place", what: "hand lantern", at: "Keeper's kitchen", on: "the table" },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.reports).toBeUndefined();
    const lantern = entityNamed(t, "hand lantern");
    expect(lantern.fields).toMatchObject({ place: String(entityNamed(t, "Traveller").fields.place), said_on: "the table" });
    expect(count(t, "hand lantern")).toBe(1);
    expect(linesOn(r, "hand lantern")).toEqual([`Operation 2 (place): nothing goes by the table, so those words are kept on hand lantern [${lantern.id}] as where it was said to be.`]);
  });

  test.skip("hardening: give: the spare gloves are made in the giver's hands and given, so they are the one given them's", async () => {
    const t = await scene();
    const r = await play(t, [{ op: "give", what: "spare gloves", from: "Traveller", to: "Marta Venn", how: "given" }]);
    expect(r.error).toBeUndefined();
    expect(r.reports).toBeUndefined();
    const marta = entityNamed(t, "Marta Venn");
    const gloves = entityNamed(t, "spare gloves");
    expect(gloves.relations).toContainEqual(expect.objectContaining({ type: "in", to: marta.id }));
    expect(gloves.fields.owner).toBe(marta.id);
    expect(gloves.fields.got).toMatchObject({ how: "given", from: entityNamed(t, "Traveller").id });
    expect(linesOn(r, "nothing recorded")).toEqual([`Operation 1 (give): nothing recorded went by spare gloves, so it was made as a thing, spare gloves [${gloves.id}].`]);
  });

  test.skip("hardening: wear, store and move each make the thing they name where the one who acts is, and store keeps a holder that names nothing as words", async () => {
    const t = await scene();
    const r = await play(t, [
      { op: "wear", what: "oilskin hat", who: "Marta Venn", source: SRC },
      { op: "store", what: "tin of matches", in: "the dresser drawer", source: SRC },
      { op: "move", who: "Traveller", to: "Boat shed", with: ["boat hook"], source: SRC },
    ]);
    expect(r.error).toBeUndefined();
    const marta = entityNamed(t, "Marta Venn");
    const hat = entityNamed(t, "oilskin hat");
    expect(hat.relations).toContainEqual(expect.objectContaining({ to: marta.id }));
    expect(entityNamed(t, "tin of matches").fields).toMatchObject({ place: String(marta.fields.place), said_in: "the dresser drawer" });
    const shed = String(entityNamed(t, "Traveller").fields.place);
    expect(shed).not.toBe(String(marta.fields.place));
    expect(entityNamed(t, "boat hook").fields.place).toBe(shed);
    for (const [n, op, name] of [[1, "wear", "oilskin hat"], [2, "store", "tin of matches"], [3, "move", "boat hook"]] as const) {
      expect(linesOn(r, `nothing recorded went by ${name},`)).toEqual([`Operation ${n} (${op}): nothing recorded went by ${name}, so it was made as a thing, ${name} [${entityNamed(t, name).id}].`]);
    }
  });

  test.skip("hardening: a name near one that is recorded is answered as before, with the near name, and nothing is made or recorded", async () => {
    const t = await scene();
    const before = t.s.changes(t.turn.id).length;
    const r = await play(t, [{ op: "place", what: "oil lamps", at: "Keeper's kitchen", source: SRC }]);
    expect(r.error).toBe(true);
    const lamp = entityNamed(t, "Oil lamp");
    expect(texts(r)[0]).toBe(`Operation 1 (place): there is nothing called oil lamps that is a person or a thing. Near: Oil lamp [${lamp.id}].`);
    expect(count(t, "oil lamps")).toBe(0);
    expect(t.s.changes(t.turn.id).length).toBe(before);
  });
});
