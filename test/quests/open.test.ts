import { describe, expect, test } from "bun:test";
import { questSliceOf, questViews } from "../../src/quests";
import { dataOf, rig, texts } from "../iface/rig";

const src = { from: "prose", message: "m-1" };

describe("the quest operation", () => {
  test("opens The missing ferryman with what it is, its stages, who and where and its stakes, and calls a stage on it", async () => {
    const t = await rig();
    const opened = await t.call("world_apply", {
      operations: [
        {
          op: "quest",
          quest: "The missing ferryman",
          open: "quest",
          objective: "Find the ferryman.",
          matters: "The crossing is shut without him.",
          stages: [
            { stage: "ask", label: "Ask at the landing", condition: "Wren has spoken to the ferrywoman" },
            { stage: "search", label: "Search the reeds", condition: "the boat is found" },
          ],
          who: ["wren"],
          where: ["common_room"],
          stakes: "The crossing stays shut.",
          source: src,
        },
      ],
    });
    expect(opened.error).toBeUndefined();
    const slice = () => questSliceOf(t.s.stateAt(t.turn.id).state);
    const [made] = Object.values(slice().quests);
    expect(made).toMatchObject({ kind: "quest", name: "The missing ferryman", objective: "Find the ferryman.", why: "The crossing is shut without him.", stakes: "The crossing stays shut.", who: ["entity:wren"], where: ["place:common_room"] });
    expect(made?.stages.map((s) => s.id)).toEqual(["ask", "search"]);

    // Named again, by its name: it stands for the quest, and the call writes to it; a stage is called failed with its reason.
    const called = await t.call("world_apply", { operations: [{ op: "quest", quest: "the missing  ferryman", stage: "Ask at the landing", outcome: "failed", why: "The ferrywoman will not talk.", source: src }] });
    expect(called.error).toBeUndefined();
    const view = questViews({}, slice())[0];
    expect(view?.stages[0]?.call).toMatchObject({ state: "failed", why: "The ferrywoman will not talk." });

    // The world's own quest: its stage move keeps its reason and outcome as the call of the stage it leaves.
    const world = await t.call("world_apply", { operations: [{ op: "quest", quest: "errand", stage: "done", outcome: "met", why: "delivered", source: src }] });
    expect(world.error).toBeUndefined();
    expect(slice().marks.errand?.calls.asked).toMatchObject({ state: "met", why: "delivered" });
    expect(slice().marks.errand?.calls.done).toBeUndefined();
    expect(texts(world).join("\n")).not.toBe("");
    expect(dataOf(world)).toBeDefined();
  });

  test("a thread the story record does not hold is answered with its threads; nothing is opened", async () => {
    const t = await rig();
    const r = await t.call("world_apply", { operations: [{ op: "quest", quest: "The cellar rumour", open: "secret", thread: "th-nowhere", source: src }] });
    expect(texts(r).join("\n")).toContain("th-nowhere");
    expect(Object.keys(questSliceOf(t.s.stateAt(t.turn.id).state).quests)).toEqual([]);
  });
});
