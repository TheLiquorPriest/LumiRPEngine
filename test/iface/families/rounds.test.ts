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

  test("harm comes off the gauge the ruleset names, the wolf it leaves at nothing is down, and no field of the call's naming is made", async () => {
    const t = await familyRig(fightWorld);
    await t.call("fight_start", { with: ["Wren"], foes: ["Grey wolf"], ...SRC });
    const r = await t.call("fight_round", { actions: [{ who: "Wren", did: "swings her staff", to: "Grey wolf", result: "a hit", harm: 4 }, { who: "Grey wolf", did: "bites", to: "Wren", result: "a hit", harm: 3 }], ...SRC });
    expect(r.error).toBeUndefined();
    const world = () => t.s.stateAt(t.turn.id).state.world;
    expect(world().entities.wolf?.fields.hp).toBe(3);
    expect(world().entities.wren?.fields.hp).toBe(9);
    await t.call("fight_round", { actions: [{ who: "Wren", did: "swings again", to: "Grey wolf", result: "a hit", harm: 10 }], ...SRC });
    expect(world().entities.wolf?.fields.hp).toBe(0);
    expect(fightsOf(world())[0]?.order.find((f) => f.id === "wolf")?.down).toBe(true);
  });

  test("in a world whose ruleset names no gauge, harm is kept with the act and said, and no value is changed", async () => {
    const t = await familyRig();
    await t.call("fight_start", { with: ["Wren"], foes: ["Bram"], ...SRC });
    const r = await t.call("fight_round", { actions: [{ who: "Wren", did: "shoves", to: "Bram", result: "a hit", harm: 2 }], ...SRC });
    expect(r.error).toBeUndefined();
    expect((r.reports ?? []).some((x) => x.includes("names no gauge"))).toBe(true);
    expect(t.s.stateAt(t.turn.id).state.world.entities.bram?.fields.hp).toBeUndefined();
    expect(t.s.changes(t.turn.id).some((c) => c.op === "combat.act" && JSON.stringify(c.value).includes('"harm":2'))).toBe(true);
  });
});
