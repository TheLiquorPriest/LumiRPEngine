// The story as an area of the store's fold: a write of an item is a change of the story lane, folded with the engine's along the
// path; read at an earlier turn the item stands as it stood then; undone by its area's own reverse and listed in the story lane of
// the turn's review card. Every name here is made up.

import { describe, expect, test } from "bun:test";
import { JoinedTurnError } from "../../src/store";
import { STORY_OPS } from "../../src/story/fold";
import { leftOpen } from "../../src/story/open";
import { CHAT, openTable, USER } from "./rig";

describe("the story area", () => {
  test("a story write is a change of the story lane; read at an earlier turn the item stands as it stood then", async () => {
    const t = await openTable();
    const first = await t.play([{ part: "thread", item: null, value: { text: "Who sealed the letter?", hot: true } }]);
    const id = t.record().of("thread")[0]?.id ?? "";
    const second = await t.play([{ part: "thread", item: id, value: { state: "Wren has it.", hot: false } }]);
    expect(t.s.changes(first.id).map((c) => [c.lane, c.op, c.by, c.handle])).toEqual([["story", "story.write", "author", "author-1"]]);
    expect(t.record(first).items.get(id)?.fields).toEqual({ text: "Who sealed the letter?", hot: true });
    expect(t.record(second).items.get(id)?.fields).toEqual({ text: "Who sealed the letter?", hot: false, state: "Wren has it." });
    expect(t.record(second).items.get(id)).toMatchObject({ opened: first.id, touched: second.id });
  });

  test("undoing a story change takes its write off and the item stands as before; the turn's review card lists it in the story lane", async () => {
    const t = await openTable();
    await t.play([{ part: "thread", item: null, value: { text: "Who sealed the letter?" } }]);
    const id = t.record().of("thread")[0]?.id ?? "";
    const second = await t.play([{ part: "thread", item: id, value: { state: "Wren has it.", close: true } }]);
    const change = t.s.changes(second.id)[0];
    if (change === undefined) throw new Error("the turn holds no change");
    const card = t.s.reviewCard(second.id).find((l) => l.lane === "story");
    expect(card?.changes.map((c) => c.change.id)).toEqual([change.id]);
    expect(card?.changes[0]?.undo.left).toEqual([]);

    const undone = await t.writes.run(() => t.s.undo(change.id));
    expect(undone.left).toEqual([]);
    expect(undone.changes).toHaveLength(1);
    const item = t.record().items.get(id);
    expect(item?.fields).toEqual({ text: "Who sealed the letter?" });
    expect(item?.closedBy).toBeNull();
    // A thing the undone write made is struck, never taken away.
    const made = await t.play([{ part: "beat", item: null, value: { text: "The bell rings." } }]);
    const beat = t.s.changes(made.id)[0];
    await t.writes.run(() => t.s.undo(beat?.id ?? 0));
    expect(t.record().of("beat")).toEqual([]);
    expect(t.record().of("beat", true).map((b) => b.dropped)).toEqual([true]);
  });

  test("the horizon is replaced whole by one change, rewinds with a swipe of the turn that set it, and keeps an entry in words as written; the area's reads give it with the open scene and the open threads", async () => {
    const t = await openTable();
    const set = (turn: string, list: unknown[]) => t.writes.run(() => t.s.record({ kind: "turn", turn }, [{ lane: "story", op: STORY_OPS.horizon, value: { list } as never, by: "author" }]));
    const first = await t.begin();
    await set(first.id, ["place:harbour", { at: "the old keep, past the marsh", depth: 1 }]);
    await t.write(first, [{ part: "scene", item: null, value: { title: "The quay", place: "the quay" } }, { part: "thread", item: null, value: { text: "Who sealed the letter?", who: ["Bram"] } }, { part: "beat", item: null, value: { text: "Bram shut the door.", time: "that night" } }]);
    await t.tie(first);
    const read = (name: string): unknown => t.store.readArea(t.s.headState(CHAT).state, "story", name);
    expect(read("horizon")).toEqual([{ at: "place:harbour", depth: "full" }, { at: "the old keep, past the marsh", depth: 1 }]);
    expect(read("scene")).toMatchObject({ place: "the quay" });
    expect(read("threads")).toMatchObject([{ who: ["Bram"], fields: { text: "Who sealed the letter?" } }]);
    // The beats, for a record that links them by id and may not import the story: each not struck, in the order recorded.
    expect(read("beats")).toMatchObject([{ text: "Bram shut the door.", time: "that night" }]);
    const second = await t.begin();
    await set(second.id, ["place:cellar"]);
    await t.tie(second);
    expect(read("horizon")).toEqual([{ at: "place:cellar", depth: "full" }]);
    // Another attempt at the second reply does not hold the horizon the first attempt set.
    const again = await t.swipe();
    await t.tie(again, "another reply");
    expect(read("horizon")).toEqual([{ at: "place:harbour", depth: "full" }, { at: "the old keep, past the marsh", depth: 1 }]);
    await expect(set(first.id, [{ at: "x", depth: -1 }])).rejects.toThrow();
  });

  test("a turn that moved two threads and closed one gives the other, still open, with its stakes, and its record's next; a joined turn is refused by the store", async () => {
    const t = await openTable();
    const first = await t.play([{ part: "thread", item: null, value: { text: "Who sealed the letter?", stakes: "Wren's licence." } }, { part: "thread", item: null, value: { text: "Will the ferry run?" } }]);
    const [seal, ferry] = t.record().of("thread");
    const second = await t.begin();
    await t.write(second, [{ part: "thread", item: seal?.id ?? null, value: { state: "Wren has it." } }, { part: "thread", item: ferry?.id ?? null, value: { close: true } }, { part: "record", item: `rec:${second.id}`, value: { next: "Let the seal matter." } }]);
    await t.tie(second);
    const left = leftOpen(t.store, USER, CHAT, second.id);
    expect(left.threads.map((x) => [x.id, x.state, x.stakes])).toEqual([[seal?.id, "Wren has it.", "Wren's licence."]]);
    expect(left.next).toBe("Let the seal matter.");
    expect(leftOpen(t.store, USER, CHAT, first.id).threads).toHaveLength(2);
    const held = await t.writes.run(() => t.s.beginTurn({ chat: CHAT, kind: "continue", on: second.node }));
    await t.writes.run(() => t.s.joinTurn(held.id, second.id));
    expect(() => leftOpen(t.store, USER, CHAT, held.id)).toThrow(JoinedTurnError);
  });
});
