// The story as an area of the store's fold: a write of an item is a change of the story lane, folded with the engine's along the
// path; read at an earlier turn the item stands as it stood then; undone by its area's own reverse and listed in the story lane of
// the turn's review card. Every name here is made up.

import { describe, expect, test } from "bun:test";
import { openTable } from "./rig";

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
});
