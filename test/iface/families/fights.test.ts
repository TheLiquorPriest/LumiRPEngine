// Fights on an invented world with a combat ruleset of its own: each tool is found by its own words,
// is called, applies (or reads, changing nothing) and answers in full; a fight started while one is
// on changes nothing and is reported.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import type { WorldDoc } from "../../../src/shared/world";
import { FIGHT_TOOLS } from "../../../src/iface/families/fights";
import { dataOf, saidNotReported } from "../rig";
import { appliedInFull, descriptions, eachFoundByItsWords, familyRig, opOf, searchByWords, SRC, wordsFromFiles } from "./kit";

const NAMES = FIGHT_TOOLS.map((t) => t.name);

/** Wren against a grey wolf in the common room: hit points, a d20 initiative and an action a turn. */
function fightWorld(w: WorldDoc): void {
  const kind = w.kinds.character;
  if (kind === undefined) throw new Error("no character kind");
  Object.assign(kind.fields, { max_hp: { type: "number", default: 12 }, hp: { type: "number", label: "HP", pool: { max: "max_hp" } }, dex: { type: "number", default: 0 } });
  w.checks.initiative = { id: "initiative", dice: "d20", modifier: "self.dex" };
  w.ruleset = { ...w.ruleset, combat: { initiative: "initiative", economy: { action: { label: "Action" } }, hp: "hp" } } as WorldDoc["ruleset"];
  w.entities.wolf = { id: "wolf", kind: "character", name: "Grey wolf", tier: "background", fields: { place: "common_room", max_hp: 7 }, relations: [] };
}

describe("fights", () => {
  test("every tool is found by a search on its own words, and a fight and initiative by the word", async () => {
    expect(NAMES).toEqual(["fight_start", "fight_read", "fight_end"]);
    await eachFoundByItsWords(NAMES);
    const docs = await descriptions();
    expect(searchByWords("fight", docs)).toContain("fight_start");
    expect(searchByWords("initiative", docs)).toContain("fight_start");
  });

  test("each tool is called, applies, and answers with what changed and how it stands", async () => {
    const t = await familyRig(fightWorld);
    const started = await t.call("fight_start", { foes: ["Grey wolf"], ...SRC });
    appliedInFull(started, "engine", false);
    expect(opOf(started).fight).not.toBeNull();
    expect(t.s.changes(t.turn.id).length).toBeGreaterThan(0);

    const changes = t.s.changes(t.turn.id).length;
    const read = await t.call("fight_read", {});
    expect(read.error).toBeUndefined();
    expect(dataOf(read).fight).not.toBeNull();
    expect(t.s.changes(t.turn.id).length).toBe(changes);
    wordsFromFiles(read);

    const ended = await t.call("fight_end", { winner: "party", ...SRC });
    appliedInFull(ended, "engine", false);
    expect(opOf(ended).fight).toBeNull();
    expect(t.s.changes(t.turn.id).length).toBeGreaterThan(changes);
  });

  test("a fight started while one is on is applied as nothing and said, with no report", async () => {
    const t = await familyRig(fightWorld);
    await t.call("fight_start", { foes: ["wolf"], ...SRC });
    const changes = t.s.changes(t.turn.id).length;
    const again = await t.call("fight_start", { foes: ["wolf"], ...SRC });
    appliedInFull(again, "engine", false);
    saidNotReported(again, "was already so");
    expect(t.s.changes(t.turn.id).length).toBe(changes);
    expect((opOf(again).fight as JsonObject | null) !== null).toBe(true);
  });
});
