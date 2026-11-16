import { describe, expect, test } from "bun:test";
import { stageAt } from "../../src/turn/stage";
import { writeStory } from "../../src/story/record";
import { CHAT, openTable, USER } from "../cast/rig";

describe("who is on stage at a turn (R-56)", () => {
  test("with no scene recorded, those the state places where the owner's character is are on stage, with the things there; the owner's character is not added", async () => {
    const t = await openTable();
    const turn = await t.begin();
    const stage = stageAt(t.store, USER, CHAT, turn.id);
    expect(stage).toMatchObject({ who: ["Bram"], place: "The Common Room", how: "owner" });
    expect(stage?.things).toEqual(expect.arrayContaining(["Satchel", "Knife", "Grey cloak"]));
  });

  test("with a scene open, its people and those the state places in its place are on stage, one it names who stands elsewhere included", async () => {
    const t = await openTable();
    const turn = await t.begin();
    await t.writes.run(() => writeStory(t.store, { user: USER, chat: CHAT, turn: turn.id, by: "author", agent: "author-1", job: null }, [{ part: "scene", item: null, value: { who: ["Bram"], place: "The Cellar" } }]));
    const stage = stageAt(t.store, USER, CHAT, turn.id);
    expect(stage).toMatchObject({ who: ["Bram", "Odile"], place: "The Cellar", how: "scene" });
    expect(stage?.things).toEqual(["Cask of cider"]);
  });

  test("with no scene and no one else where the owner's character is, nobody is on stage and the stage says it was not recorded", async () => {
    const t = await openTable();
    const turn = await t.begin();
    // The chat's head before any state placed Bram elsewhere: move him to the cellar with the engine's own event.
    await t.writes.run(() => t.s.addChanges(turn.id, [{ lane: "engine", op: "set", value: { type: "set", entity: "bram", field: "place", value: "cellar" } }]));
    expect(stageAt(t.store, USER, CHAT, turn.id)).toMatchObject({ who: [], how: "none" });
  });
});
