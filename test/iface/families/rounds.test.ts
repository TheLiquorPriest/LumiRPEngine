// A fight played a round at a time: what each fighter did is recorded as the call gives it and the fight goes on
// to the next turn; a fighter who acts twice in a round is recorded and reported.

import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../../src/shared/world";
import { fightsOf } from "../../../src/packs/combat/core/model";
import { appliedInFull, familyRig, SRC } from "./kit";

/** Wren and Bram against a grey wolf in the common room, with hit points and an action a turn. */
function fightWorld(w: WorldDoc): void {
  const kind = w.kinds.character;
  if (kind === undefined) throw new Error("no character kind");
  Object.assign(kind.fields, { max_hp: { type: "number", default: 12 }, hp: { type: "number", label: "HP", pool: { max: "max_hp" } }, dex: { type: "number", default: 0 } });
  w.checks.initiative = { id: "initiative", dice: "d20", modifier: "self.dex" };
  w.ruleset = { ...w.ruleset, combat: { initiative: "initiative", economy: { action: { label: "Action" } }, hp: "hp" } } as WorldDoc["ruleset"];
  w.entities.wolf = { id: "wolf", kind: "character", name: "Grey wolf", tier: "background", fields: { place: "common_room", max_hp: 7 }, relations: [] };
}

describe("fight_round", () => {
  test("two rounds of three fighters move the round and the turn and record six actions; an act twice in a round is reported", async () => {
    const t = await familyRig(fightWorld);
    appliedInFull(await t.call("fight_start", { with: ["Wren", "Bram"], foes: ["Grey wolf"], ...SRC }), "engine", false);
    const who = ["Wren", "Bram", "Grey wolf"];
    const actions = [...who, ...who].map((name) => ({ who: name, did: "acts", to: name === "Grey wolf" ? "Wren" : "Grey wolf", result: "a hit" }));
    const r = await t.call("fight_round", { actions, ...SRC });
    appliedInFull(r, "engine", false);
    const rows = t.s.changes(t.turn.id);
    expect(rows.filter((row) => row.op === "combat.act")).toHaveLength(6);
    expect(rows.filter((row) => row.op === "combat.turn")).toHaveLength(6);
    const fight = fightsOf(t.s.stateAt(t.turn.id).state.world)[0];
    expect(fight?.round).toBe(3);
    expect(fight?.turn).toBe(0);
    // Wren twice in a row: recorded, and said.
    const twice = await t.call("fight_round", { actions: [{ who: "Wren", did: "swings" }, { who: "Wren", did: "swings again" }], ...SRC });
    expect(twice.error).toBeUndefined();
    expect((twice.reports ?? []).some((x) => x.includes("has acted in round"))).toBe(true);
  });
});
