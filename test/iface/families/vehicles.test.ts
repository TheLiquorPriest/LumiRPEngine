// Vehicles on an invented world: each tool is found by its own words, is called, applies (or reads,
// changing nothing) and answers in full; a drive to a place no road reaches is made all the same and
// reported.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import { VEHICLE_TOOLS } from "../../../src/iface/families/vehicles";
import { dataOf, type Rig } from "../rig";
import { appliedInFull, descriptions, eachFoundByItsWords, familyRig, searchByWords, SRC, wordsFromFiles } from "./kit";

const NAMES = VEHICLE_TOOLS.map((t) => t.name);

/** Bram's old van, parked in the market square, made by its class. */
async function van(t: Rig): Promise<string> {
  const r = await t.call("world_apply", { operations: [{ op: "spawn", name: "Old van", class: "minivan", at: "market_square", owner: "bram", ...SRC }] });
  return String((dataOf(r).operations as JsonObject[])[0]?.made);
}

describe("vehicles", () => {
  test("every tool is found by a search on its own words, and a vehicle by the word", async () => {
    expect(NAMES).toEqual(["vehicles_classes", "vehicles_drive"]);
    await eachFoundByItsWords(NAMES);
    const docs = await descriptions();
    expect(searchByWords("vehicle", docs)).toContain("vehicles_drive");
    expect(searchByWords("vehicle classes", docs)).toContain("vehicles_classes");
  });

  test("each tool is called, applies, and answers with what changed and how it stands", async () => {
    const t = await familyRig();
    const id = await van(t);
    const changes = t.s.changes(t.turn.id).length;
    const listed = await t.call("vehicles_classes", { search: "van" });
    expect(listed.error).toBeUndefined();
    expect((dataOf(listed).classes as JsonObject[]).some((c) => c.id === "minivan")).toBe(true);
    expect(t.s.changes(t.turn.id).length).toBe(changes);
    wordsFromFiles(listed);

    const driven = appliedInFull(await t.call("vehicles_drive", { vehicle: "Old van", to: "The Far Road", driver: "Tam", ...SRC }), "engine");
    expect((driven.changed as JsonObject[]).some((c) => c.at === `entity:${id}` && (c.now as JsonObject).place === "far_road")).toBe(true);
    expect(t.s.stateAt(t.turn.id).state.world.entities.tam?.fields.place).toBe("far_road");
  });

  test("a drive in a van that has broken down is made all the same and reported", async () => {
    const t = await familyRig();
    const id = await van(t);
    await t.call("world_apply", { operations: [{ op: "set", at: id, key: "status", value: "broken", ...SRC }] });
    const r = await t.call("vehicles_drive", { vehicle: "Old van", to: "far_road", driver: "tam", ...SRC });
    appliedInFull(r, "engine");
    expect((r.reports ?? []).some((x) => x.includes("recorded as broken down"))).toBe(true);
    expect(t.s.stateAt(t.turn.id).state.world.entities[id]?.fields.place).toBe("far_road");
  });
});
