// `set` records what the story gives: a number added to a field of words is recorded and the field stays, a value for the whole world
// is recorded at the world and reported, a system's own value stands and is said. Every name here is invented.

import { describe, expect, test } from "bun:test";
import { rig } from "./rig";

const src = { from: "prose", message: "m-80" };

describe("set as given", () => {
  test("add 5 to a mood of steady is recorded, the mood stays, and it is reported", async () => {
    const t = await rig();
    const r = await t.call("world_apply", { operations: [{ op: "set", at: "bram", key: "mood", add: 5, source: src }] });
    expect(r.error).toBeUndefined();
    expect(r.reports?.[0]).toContain("holds no number");
    expect(t.s.stateAt(t.turn.id).state.world.entities.bram?.fields.mood).toBe("steady");
  });

  test("set at world law is recorded at the world and reported; currency says the system's own value stands", async () => {
    const t = await rig();
    const r = await t.call("world_apply", { operations: [{ op: "set", at: "world", key: "law", value: "the king's peace", source: src }, { op: "set", at: "world", key: "currency", value: "crowns", source: src }] });
    expect(r.error).toBeUndefined();
    expect(r.reports?.[0]).toContain("not a value the world's setup lists");
    expect(r.reports?.some((x) => x.includes("keeps currency itself"))).toBe(true);
    expect(t.s.stateAt(t.turn.id).state.values?.law).toBe("the king's peace");
  });
});
