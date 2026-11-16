// A continue is the same turn, extended, and its changes are added to it (plan §10.10, R-192 (e)): what its run wrote to the story
// record and the lore's overlays, held on its own open turn until Lumiverse's end names the message, joins the turn that message is
// tied to, after that turn's own writes, as it was written, by the store's own join. Played on the story lane's invented chat.
// Every name here is made up.

import { describe, expect, test } from "bun:test";
import { overlayRows } from "../../src/lore/index";
import { JoinedTurnError } from "../../src/store";
import { recordStory, writeStory } from "../../src/story/record";
import { CHAT, openTable, USER } from "./rig";

const AUTHOR = { user: USER, by: "author", agent: "author-1", job: null };

describe("a continue's held story changes", () => {
  test("join the turn it extended after that turn's own, with its overlays, and the held turn is then refused", async () => {
    const t = await openTable();
    const extended = await t.play([{ part: "beat", item: null, value: { text: "Wren pays the toll." } }]);
    const held = await t.writes.run(() => t.s.beginTurn({ chat: CHAT, kind: "continue", on: extended.node }));
    await t.writes.run(() => recordStory(t.store, { ...AUTHOR, turn: held.id }, [{ part: "beat", item: null, value: { text: "The continue's beat." } }, { entry: "e-1", note: "The toll is paid." }]));
    await t.writes.run(() => t.s.joinTurn(held.id, extended.id));

    expect(t.record().of("beat").map((b) => b.fields.text)).toEqual(["Wren pays the toll.", "The continue's beat."]);
    expect(t.record().of("beat").map((b) => b.touched)).toEqual([extended.id, extended.id]);
    expect(overlayRows(t.store, USER, CHAT, null).map((o) => [o.entry, o.note, o.turn])).toEqual([["e-1", "The toll is paid.", extended.id]]);
    expect(() => t.record(held)).toThrow(JoinedTurnError);
    await expect(t.writes.run(() => writeStory(t.store, { ...AUTHOR, turn: held.id }, [{ part: "beat", item: null, value: { text: "Late." } }]))).rejects.toBeInstanceOf(JoinedTurnError);
  });
});
