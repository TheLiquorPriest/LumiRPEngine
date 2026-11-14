// Overlays (plan §9.3, §9.5): the Author's note, written through the story's `story_record`, that the
// story has moved past part of an entry. It is tied to its turn: a swipe takes it off the chat's path,
// showing that swipe again brings it back, and an entry RPE does not know is refused with nothing
// recorded. Played on the story lane's invented chat, with the lore's tables beside the store's.

import { describe, expect, test } from "bun:test";
import type { HostTool, ToolCtx } from "rp-harness/contract";
import { shippedTexts } from "../../src/iface/texts";
import { LORE_MIGRATIONS, overlayNotes, overlayWrite, storePath, storeWorlds } from "../../src/lore/index";
import { storyTools } from "../../src/story/index";
import { CHAT, openTable, type Table, USER } from "../story/rig";

const ctx = (turn: string): ToolCtx => ({ scope: { user: USER, chat: CHAT, session: "session-1", turn }, agent: { id: "author-1", definition: "author" }, run: "run-1", callId: "call-1", signal: new AbortController().signal, onUpdate: () => undefined });

async function table(): Promise<{ t: Table; record: HostTool; notes(turn?: string): string[] }> {
  const t = await openTable();
  // The database takes writes only through its queue.
  await t.writes.run((d) => {
    for (const m of LORE_MIGRATIONS) if ("sql" in m) d.run(m.sql);
    // RPE has shown an agent one book entry, the inn: it is e-1.
    d.run("INSERT INTO lore_entry_number (user, n, entry) VALUES (?, 1, 'entry-inn')", [USER]);
  });
  const tools = await storyTools({ store: t.store, writes: t.writes, files: shippedTexts(), overlay: overlayWrite(storeWorlds(t.store), () => 7) });
  const record = tools.find((tool) => tool.name === "story_record");
  if (record === undefined) throw new Error("story_record is not offered");
  const path = storePath(t.store);
  return { t, record, notes: (turn) => overlayNotes(t.db, USER, CHAT, path.turns(USER, CHAT, turn), ["e-1"]).get("e-1") ?? [] };
}

describe("overlays", () => {
  test("an overlay written in a turn is gone once that turn is swiped, and back when its swipe is shown again", async () => {
    const { t, record, notes } = await table();
    await t.play();
    const turn = await t.begin();
    const result = await record.run({ operations: [{ op: "overlay", entry: "e-1", text: "The entry says a thriving inn; the east wing burned tonight." }] }, ctx(turn.id));
    expect(result.error).toBeUndefined();
    // The turn sees its own overlay before its reply is tied.
    expect(notes(turn.id)).toEqual(["The entry says a thriving inn; the east wing burned tonight."]);
    await t.tie(turn);
    expect(notes()).toEqual(["The entry says a thriving inn; the east wing burned tonight."]);

    const swipe = await t.swipe();
    // The swipe is made after the turn before the one it replaces: it does not see the overlay.
    expect(notes(swipe.id)).toEqual([]);
    await t.tie(swipe);
    expect(notes()).toEqual([]);

    await t.showSwipe(turn);
    expect(notes()).toEqual(["The entry says a thriving inn; the east wing burned tonight."]);
  });

  test("an entry RPE does not know is refused, and the call records nothing", async () => {
    const { t, record } = await table();
    const turn = await t.begin();
    const result = await record.run({ operations: [{ op: "beat", text: "The bell rings." }, { op: "overlay", entry: "e-9", text: "Burned." }] }, ctx(turn.id));
    expect(result.error).toBe(true);
    const texts = result.content.flatMap((c) => (c.type === "text" ? [c.text] : []));
    expect(texts).toContain("Operation 2 (overlay): there is no lore entry e-9.");
    expect(t.db.query<{ n: number }, []>("SELECT count(*) AS n FROM lore_overlay").get()?.n).toBe(0);
    expect(t.record(turn).items.size).toBe(0);
  });
});
