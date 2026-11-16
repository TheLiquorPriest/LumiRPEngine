import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import { questSliceOf } from "../../src/quests";
import { holdersOf } from "../../src/quests/holders";
import { STORY_OPS } from "../../src/story/fold";
import { dataOf, rig, texts, world } from "../iface/rig";

const src = { from: "prose", message: "m-1" };

async function opened() {
  const t = await rig();
  const done = await t.call("world_apply", {
    operations: [
      { op: "quest", quest: "The missing ferryman", open: "quest", objective: "Find the ferryman.", matters: "The crossing is shut without him.", stages: [{ stage: "ask", label: "Ask at the landing", condition: "Wren has spoken to the ferrywoman" }, { stage: "search", label: "Search the reeds", condition: "the boat is found" }], stakes: "The crossing stays shut.", source: src },
    ],
  });
  expect(done.error).toBeUndefined();
  return t;
}

describe("agents read quests", () => {
  test("world_query at the quests' level gives a line each, and at a quest its record whole with the conditions as written, the calls and what the world authored", async () => {
    const t = await opened();
    await t.call("world_apply", { operations: [{ op: "quest", quest: "The missing ferryman", stage: "ask", outcome: "failed", why: "The ferrywoman will not talk.", source: src }] });
    const level = dataOf(await t.call("world_query", { at: "quests" }));
    expect((level.quests as { name: string; open: boolean }[]).map((q) => [q.name, q.open])).toEqual([["The sealed letter", true], ["The missing ferryman", true]]);
    const ferryman = dataOf(await t.call("world_query", { at: "The missing ferryman" }));
    expect(ferryman).toMatchObject({ name: "The missing ferryman", objective: "Find the ferryman.", why: "The crossing is shut without him.", stakes: "The crossing stays shut.", world: false });
    expect((ferryman.stages as { stage: string; condition: string; state: string | null; why: string | null }[]).map((s) => [s.stage, s.condition, s.state, s.why])).toEqual([
      ["ask", "Wren has spoken to the ferrywoman", "failed", "The ferrywoman will not talk."],
      ["search", "the boat is found", null, null],
    ]);
    // The world's own quest, by name or by its ref: its stages as the world wrote them, and what it authored for them as data.
    const letter = dataOf(await t.call("world_query", { at: "quest:errand" }));
    expect(letter).toMatchObject({ name: "The sealed letter", world: true });
    expect((letter.stages as { stage: string; current: boolean; authored?: { next: { to: string }[] } }[]).map((s) => [s.stage, s.current, s.authored?.next?.[0]?.to])).toEqual([["asked", true, "done"], ["done", false, undefined]]);
    // A place that goes by a name is the place's; a quest not there is answered with the near ones.
    const none = await t.call("world_query", { at: "quest:ferryboat" });
    expect(none.error).toBe(true);
    expect(texts(none).join("\n")).toContain("The missing ferryman");
  });

  test("world_search with kind quest finds a quest by the words of its objective and its stages", async () => {
    const t = await opened();
    const byObjective = dataOf(await t.call("world_search", { words: "find boat", kind: "quest" }));
    expect((byObjective.hits as { name: string; matched: string }[]).map((h) => [h.name, h.matched])).toEqual([["The missing ferryman", "its objective"]]);
    const byStage = dataOf(await t.call("world_search", { words: "reeds boat" }));
    expect((byStage.hits as { name: string }[]).map((h) => h.name)).toEqual(["The missing ferryman"]);
  });
});

describe("a call into a stage the world built", () => {
  test("names what the stage carries as the world authored it, and applies none of it", async () => {
    const doc = world();
    const errand = doc.tracks.errand;
    if (errand === undefined) throw new Error("the invented world has the errand");
    doc.tracks.errand = { ...errand, stages: { ...errand.stages, asked: { ...(errand.stages.asked as NonNullable<typeof errand.stages.asked>), rewards: [{ type: "post", args: { amount: 5 } }] }, done: { ...(errand.stages.done as NonNullable<typeof errand.stages.done>), cue: "The warden nods.", truth: "The warden sent it himself." } } };
    const t = await rig({}, doc);
    const r = await t.call("world_apply", { operations: [{ op: "quest", quest: "errand", stage: "done", outcome: "met", why: "Delivered.", source: src }] });
    expect(r.error).toBeUndefined();
    const entry = (dataOf(r).operations as JsonObject[])[0] as { authored: { reached: { stage: string; cue: string; truth: string }; left: { stage: string; rewards: unknown[] } } };
    expect(entry.authored.reached).toMatchObject({ stage: "done", cue: "The warden nods.", truth: "The warden sent it himself." });
    expect(entry.authored.left).toMatchObject({ stage: "asked", rewards: [{ type: "post", args: { amount: 5 } }] });
    // Nothing was posted: the reward is the agent's to land as an ordinary operation.
    expect(JSON.stringify(dataOf(r).changed)).not.toContain("-$");
  });
});

describe("the beats that moved a quest", () => {
  test("a quest's record lists the beats tied to its ref, newest first, a count of the rest", async () => {
    const t = await opened();
    const ref = `quest:${Object.keys(questSliceOf(t.s.stateAt(t.turn.id).state).quests)[0] ?? ""}`;
    const beat = (id: string, text: string, refs: string[]) => ({ lane: "story" as const, op: STORY_OPS.write, value: { part: "beat", item: id, value: { text, quest_refs: refs } }, by: "author" });
    await t.writes.run(() => t.s.addChanges(t.turn.id, [beat("b-1", "Wren asks at the landing.", [ref]), beat("b-2", "Nothing to do with it.", []), beat("b-3", "The ferrywoman is cold.", [ref])]));
    const quest = dataOf(await t.call("world_query", { at: "The missing ferryman" }));
    expect((quest.history as { items: { text: string }[] }).items.map((h) => h.text)).toEqual(["The ferrywoman is cold.", "Wren asks at the landing."]);
    expect((quest.history as { more: number }).more).toBe(0);
  });
});

describe("who holds a quest's secret", () => {
  test("the record shows the characters whose knowledge names the quest or a stage of it, and the journal is not changed by it", async () => {
    const item = (character: string, about_refs: string[], text: string) => ({ part: "knowledge" as const, id: `k-${character}`, character, fields: { about_refs, text }, opened: "t", touched: "t", at: null, dropped: false, rows: [] });
    const known = [item("c-1", ["quest:errand/done"], "The warden sent it himself."), item("c-2", ["quest:other"], "Something else."), item("c-3", ["quest:errand"], "There is a letter.")];
    const t = await rig({ questHolders: (_user, _chat, _turn, quest) => holdersOf(known, (c) => ({ "c-1": "Wren", "c-3": "Odile" })[c], quest) });
    const letter = dataOf(await t.call("world_query", { at: "quest:errand" }));
    expect(letter.holders).toEqual([
      { character: "c-1", name: "Wren", text: "The warden sent it himself.", stage: "done" },
      { character: "c-3", name: "Odile", text: "There is a letter.", stage: null },
    ]);
  });
});
