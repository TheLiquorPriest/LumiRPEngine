// `spawn` makes what it is told: a second one of a name is made and the first told of in a report, a place sent a name the
// parent has is made beside it, what is not a person is not given to, a type no catalog has is answered with the near ones, and
// a name a later operation makes is not there yet. Every name here is made up.

import { describe, expect, test } from "bun:test";
import { rig, texts, wordsFromFiles } from "./rig";

const src = { from: "prose", message: "m-70" };

describe("spawn of what is there already", () => {
  test("a second cask where a cask stands is made, and the first is told of in a report", async () => {
    const t = await rig();
    const r = await t.call("world_apply", { operations: [{ op: "spawn", name: "Cask of cider", at: "cellar", source: src }] });
    expect(r.error).toBeUndefined();
    expect(r.reports?.[0]).toContain("stood under that name already");
    expect(r.reports?.[0]).toContain("[cask]");
    wordsFromFiles(r);
    const casks = Object.values(t.s.stateAt(t.turn.id).state.world.entities).filter((e) => e.name === "Cask of cider");
    expect(casks).toHaveLength(2);
  });

  test("a place sent a name its parent has is made beside it and the one there is told of", async () => {
    const t = await rig();
    const r = await t.call("world_apply", { operations: [{ op: "spawn", kind: "room", name: "The Cellar", at: "lamp_ladle", source: src }] });
    expect(r.error).toBeUndefined();
    expect(r.reports?.[0]).toContain("[cellar]");
  });
});

describe("what spawn answers when it cannot make what it is told", () => {
  test("give to a cask names store; a type no catalog has is answered with near types; a name a later operation makes is not there yet", async () => {
    const t = await rig();
    const give = await t.call("world_apply", { operations: [{ op: "give", what: "Knife", to: "Cask of cider", how: "given", source: src }] });
    expect(give.error).toBe(true);
    expect(texts(give).join("\n")).toContain("store operation");
    const type = await t.call("world_apply", { operations: [{ op: "spawn", name: "Lamp", type: "lantren", at: "cellar", source: src }] });
    expect(type.error).toBe(true);
    expect(texts(type).join("\n")).toContain("lantren");
    const later = await t.call("world_apply", { operations: [{ op: "store", what: "Knife", in: "Odd box", source: src }, { op: "spawn", name: "Odd box", at: "cellar", source: src }] });
    expect(later.error).toBe(true);
    expect(texts(later).join("\n")).toContain("is not recorded yet: operation 2");
  });
});
