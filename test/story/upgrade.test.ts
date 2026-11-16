// The story record moved onto the store's changes: a database that holds `story_entry` and `lore_overlay` rows opens with the same
// record at every turn, the same item ids and the same overlays, and neither table; a starting state a migration set holds the
// story that stood before its turn. Every name here is made up.

import { describe, expect, test } from "bun:test";
import { overlayRows } from "../../src/lore/index";
import { STORY_MIGRATIONS } from "../../src/story/schema";
import { moveStoryRows, refreshStoryBases } from "../../src/story/upgrade";
import { CHAT, openTable, USER } from "./rig";

describe("the story record moved onto changes", () => {
  test("rows of the two old tables become changes of their turns, in their places, each item keeping its id, and the tables go", async () => {
    const t = await openTable();
    const first = await t.play();
    const second = await t.play();
    await t.writes.run((db) => {
      for (const m of STORY_MIGRATIONS) if ("sql" in m) db.run(m.sql);
      const row = db.query("INSERT INTO story_entry (user, turn, ord, part, item, value, by, agent, job, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 5)");
      row.run(USER, first.id, 0, "thread", "th-7", JSON.stringify({ text: "Who sealed the letter?", hot: true }), "author", "author-1");
      row.run(USER, second.id, 0, "thread", "th-7", JSON.stringify({ state: "Wren has it.", close: true }), "author", "author-1");
      row.run(USER, second.id, 1, "beat", "b-8", JSON.stringify({ text: "Bram looks away." }), "migration", null);
      db.run("INSERT INTO lore_overlay (user, chat, turn, entry, note, by, created, agent, job, ord) VALUES (?, ?, ?, 'e-1', 'The inn burned.', 'author', 5, 'author-1', NULL, 1)", [USER, CHAT, second.id]);
    });

    await t.writes.run((db) => moveStoryRows(db));

    expect(t.db.query("SELECT name FROM sqlite_master WHERE name IN ('story_entry', 'lore_overlay')").all()).toEqual([]);
    expect(t.record(first).items.get("th-7")?.fields).toEqual({ text: "Who sealed the letter?", hot: true });
    expect(t.record(second).items.get("th-7")).toMatchObject({ fields: { text: "Who sealed the letter?", hot: true, state: "Wren has it." }, opened: first.id, closedBy: second.id });
    expect(t.record(second).items.get("b-8")?.rows.map((r) => r.by)).toEqual(["migration"]);
    expect(overlayRows(t.store, USER, CHAT, null).map((o) => [o.entry, o.note, o.turn])).toEqual([["e-1", "The inn burned.", second.id]]);
    expect(overlayRows(t.store, USER, CHAT, first.id)).toEqual([]);
    // Written by the migration, they are the import's, so the chat is not taken for a played one.
    expect(t.db.query("SELECT source FROM change WHERE op = 'story.write' AND by = 'migration'").all()).toEqual([{ source: "import" }]);
  });

  test("a starting state a migration set holds the story written before its turn after it was set", async () => {
    const t = await openTable();
    const first = await t.play([{ part: "beat", item: null, value: { text: "Wren pays the toll." } }]);
    const second = await t.play();
    await t.writes.run(() => t.s.setBase(second.id, t.s.stateAt(second.id).state.world));
    // The import writes the story after it set the state, on a turn before it.
    await t.write(first, [{ part: "thread", item: null, value: { text: "Who sealed the letter?" } }]);
    const third = await t.begin();
    t.store.dropCaches();
    expect(t.record(third).of("thread")).toEqual([]);

    await t.writes.run((db) => refreshStoryBases(db, USER));
    t.store.dropCaches();
    expect(t.record(third).of("thread").map((i) => i.fields.text)).toEqual(["Who sealed the letter?"]);
    expect(t.record(third).of("beat").map((i) => i.fields.text)).toEqual(["Wren pays the toll."]);
  });
});
