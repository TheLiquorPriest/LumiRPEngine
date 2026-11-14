// Overlays (plan §9.3, §9.5): the Author's note, written through the story's `story_record`, that the
// story has moved past part of an entry. It is tied to its turn: a swipe takes it off the chat's path,
// showing that swipe again brings it back, and a branch sees those of the turns it shares. It is its
// writer's, as a story row is: the lead dropping a sub-agent's writes takes its overlays with them, and
// so does a continue that saved nothing, a job's aside. An entry RPE does not know is refused with
// nothing recorded. Played on the story lane's invented chat, with the lore's tables beside the store's.

import { describe, expect, test } from "bun:test";
import type { AgentRef, HostTool, ToolCtx } from "rp-harness/contract";
import { shippedTexts } from "../../src/iface/texts";
import { overlayNotes, overlayWrite, storePath, storeWorlds } from "../../src/lore/index";
import { dropStoryStaged, storyMark, storyTools, takeBackStory } from "../../src/story/index";
import { CHAT, openTable, type Table, USER } from "../story/rig";

const AUTHOR: AgentRef = { id: "author-1", definition: "author" };
const ctx = (turn: string, agent: AgentRef = AUTHOR): ToolCtx => ({ scope: { user: USER, chat: CHAT, session: "session-1", turn }, agent, run: "run-1", callId: "call-1", signal: new AbortController().signal, onUpdate: () => undefined });

async function table(): Promise<{ t: Table; record: HostTool; notes(turn?: string, chat?: string): string[]; overlay(turn: string, text: string, agent?: AgentRef): Promise<void> }> {
  const t = await openTable();
  // RPE has shown an agent one book entry, the inn: it is e-1.
  await t.writes.run((d) => d.run("INSERT INTO lore_entry_number (user, n, entry) VALUES (?, 1, 'entry-inn')", [USER]));
  const tools = await storyTools({ store: t.store, writes: t.writes, files: shippedTexts(), overlay: overlayWrite(storeWorlds(t.store), () => 7) });
  const record = tools.find((tool) => tool.name === "story_record");
  if (record === undefined) throw new Error("story_record is not offered");
  const path = storePath(t.store);
  return {
    t,
    record,
    notes: (turn, chat = CHAT) => overlayNotes(t.db, USER, path.turns(USER, chat, turn), ["e-1"]).get("e-1") ?? [],
    async overlay(turn, text, agent = AUTHOR) {
      const r = await record.run({ operations: [{ op: "overlay", entry: "e-1", text }] }, ctx(turn, agent));
      expect(r.error).toBeUndefined();
    },
  };
}

describe("overlays", () => {
  test("an overlay written in a turn is gone once that turn is swiped, and back when its swipe is shown again", async () => {
    const { t, notes, overlay } = await table();
    await t.play();
    const turn = await t.begin();
    await overlay(turn.id, "The entry says a thriving inn; the east wing burned tonight.");
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

  test("a branch sees the overlays of the turns it shares with its source", async () => {
    const { t, notes, overlay } = await table();
    const turn = await t.begin();
    await overlay(turn.id, "The east wing burned.");
    await t.tie(turn);
    const [first, reply] = t.shown;
    if (first === undefined || reply === undefined) throw new Error("the chat has no first exchange");
    await t.writes.run(() => t.s.branchChat({ id: "chat-b", from: CHAT, map: { [first.id]: "b0", [reply.id]: "b1" }, at: reply.id }));
    await t.writes.run(() => t.s.sync("chat-b", [{ ...first, id: "b0" }, { ...reply, id: "b1" }]));
    expect(notes(undefined, "chat-b")).toEqual(["The east wing burned."]);
    expect(notes()).toEqual(["The east wing burned."]);
  });

  test("the lead dropping a sub-agent's writes takes its overlays with its story rows, and leaves the others'", async () => {
    const { t, record, notes, overlay } = await table();
    const turn = await t.begin();
    await overlay(turn.id, "The Author's note.");
    const keeper: AgentRef = { id: "keeper-1", definition: "keeper", parent: "author-1" };
    const kept = await record.run({ operations: [{ op: "beat", text: "Smoke over the roofs." }, { op: "overlay", entry: "e-1", text: "The keeper's note." }] }, ctx(turn.id, keeper));
    expect(kept.error).toBeUndefined();
    expect(notes(turn.id)).toEqual(["The Author's note.", "The keeper's note."]);
    await t.writes.run(() => dropStoryStaged(t.store, USER, turn.id, keeper.id));
    expect(notes(turn.id)).toEqual(["The Author's note."]);
    expect(t.record(turn).items.size).toBe(0);
  });

  test("a continue that saved nothing takes back the overlays it wrote, even with no story row after the mark, and keeps a job's and the turn's own", async () => {
    const { t, notes, overlay } = await table();
    const turn = await t.begin();
    // The turn's own run ends on an overlay, after its last story row.
    await t.write(turn, [{ part: "beat", item: null, value: { text: "The bell rings." } }]);
    await overlay(turn.id, "Written by the turn.");
    await t.tie(turn);
    // A continue begins: it takes the story's mark, then writes an overlay and nothing else; a job writes one meanwhile.
    const mark = storyMark(t.db, USER, turn.id);
    await overlay(turn.id, "Written by the continue.");
    await overlay(turn.id, "Written by a job.", { id: "keeper-2", definition: "keeper", job: "job-1" });
    expect(notes()).toEqual(["Written by the turn.", "Written by the continue.", "Written by a job."]);
    // A row written after an overlay takes the place after it.
    const [row] = await t.write(turn, [{ part: "beat", item: null, value: { text: "Ash falls." } }]);
    expect(row?.ord).toBe(storyMark(t.db, USER, turn.id));
    await t.writes.run((d) => takeBackStory(d, USER, turn.id, mark));
    expect(notes()).toEqual(["Written by the turn.", "Written by a job."]);
    expect([...t.record().items.values()].map((i) => i.fields.text)).toEqual(["The bell rings."]);
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
