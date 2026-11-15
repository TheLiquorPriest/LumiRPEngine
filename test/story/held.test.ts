// A continue is the same turn, extended, and its changes are added to it (plan §10.10, R-192 (e)): what its run wrote to the story
// record and the lore's overlays, held on its own open turn until Lumiverse's end names the message, joins the turn that message is
// tied to, after that turn's own writes, as it was written, in the one queued write that joins the store's changes, the story's call
// first. Played on the story lane's invented chat, with the lore's tables beside the store's. Every name here is made up.

import { describe, expect, test } from "bun:test";
import { overlayNotes, overlayWrite, storePath, storeWorlds } from "../../src/lore/index";
import { JoinedTurnError, StoreInputError, type TurnRow } from "../../src/store";
import { dropStoryStaged, joinStory, storyMark, takeBackStory } from "../../src/story/index";
import { type StoryWrite, writeStory } from "../../src/story/record";
import { CHAT, openTable, type Table, USER } from "./rig";

/** Who writes: the Author's own run, or a job one of its runs started. */
interface Writer {
  by: string;
  agent: string;
  job: string | null;
}

const AUTHOR: Writer = { by: "author", agent: "author-1", job: null };
const KEEPER_JOB: Writer = { by: "keeper", agent: "keeper-2", job: "job-1" };

/** A story row or an overlay as stored, every column, with its table. */
type Stored = Record<string, unknown> & { table: string; ord: number };

/** A turn's story rows and overlays as stored, in their places on the turn. */
function rowsOf(t: Table, turn: string): Stored[] {
  const of = (table: string): Stored[] => t.db.query<Stored, [string, string]>(`SELECT * FROM ${table} WHERE user = ? AND turn = ?`).all(USER, turn).map((r) => ({ ...r, table }));
  return [...of("story_entry"), ...of("lore_overlay")].sort((a, b) => a.ord - b.ord);
}

async function table(): Promise<{ t: Table; write(turn: TurnRow, writes: readonly StoryWrite[], who?: Writer): Promise<unknown>; overlay(turn: TurnRow, note: string, who?: Writer): Promise<unknown>; notes(turn?: TurnRow): string[] }> {
  const t = await openTable();
  // RPE has shown an agent one book entry, the inn: it is e-1.
  await t.writes.run((d) => d.run("INSERT INTO lore_entry_number (user, n, entry) VALUES (?, 1, 'entry-inn')", [USER]));
  const lore = overlayWrite(storeWorlds(t.store), () => 7);
  const path = storePath(t.store);
  return {
    t,
    write: (turn, writes, who = AUTHOR) => t.writes.run((d) => writeStory(d, { user: USER, turn: turn.id, ...who, now: 5 }, writes)),
    // As the story's `overlay` operation writes one: in the place after the turn's last story write.
    overlay: (turn, note, who = AUTHOR) => t.writes.run((d) => lore(d, { user: USER, chat: CHAT, turn: turn.id, entry: "e-1", note, ...who, ord: storyMark(d, USER, turn.id) + 1 })),
    notes: (turn) => overlayNotes(t.db, USER, path.turns(USER, CHAT, turn?.id), ["e-1"]).get("e-1") ?? [],
  };
}

/** The player asks the reply of `extended` to go on: until the end, the continue's run writes on an open turn of its own. */
function continueOf(t: Table, extended: TurnRow): Promise<TurnRow> {
  return t.writes.run(() => t.s.beginTurn({ chat: CHAT, kind: "continue", on: extended.node }));
}

/** The end names the extended turn's message: in one queued write the story's rows join, then the store's changes. */
function joined(t: Table, held: TurnRow, extended: TurnRow): Promise<number> {
  return t.writes.run(() => {
    const n = joinStory(t.store, USER, held.id, extended.id);
    t.s.joinTurn(held.id, extended.id);
    return n;
  });
}

/** What a queued write was refused with; null when it was not. */
async function refusal(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
  } catch (error) {
    return error;
  }
  return null;
}

const beat = (text: string): StoryWrite => ({ part: "beat", item: null, value: { text } });
const texts = (t: Table, part: "beat" | "thread", turn?: TurnRow): unknown[] => t.record(turn ?? null).of(part).map((i) => i.fields.text);

describe("a continue's held story rows", () => {
  test("a held turn's beat, thread touch and overlay become the extended turn's, after its own and in the order made, and the record at that turn reads them", async () => {
    const { t, write, overlay, notes } = await table();
    await t.play([{ part: "thread", item: null, value: { text: "Who set the east wing alight?" } }]);
    const thread = t.record().of("thread")[0]?.id ?? "";
    const extended = await t.begin();
    await write(extended, [beat("The bell rings.")]);
    await overlay(extended, "The entry says a thriving inn; smoke hangs over the yard.");
    await t.tie(extended);
    const own = rowsOf(t, extended.id);
    const held = await continueOf(t, extended);
    await write(held, [beat("Ash falls on the cobbles.")]);
    await overlay(held, "The east wing burned to its beams.");
    await write(held, [{ part: "thread", item: thread, value: { note: "The ash smells of lamp oil." } }]);
    const heldRows = rowsOf(t, held.id);
    expect(texts(t, "beat", extended)).toEqual(["The bell rings."]);

    expect(await joined(t, held, extended)).toBe(3);
    // After its own writes, in the order made, each as written: the same id, value, writer, agent, job and time.
    expect(rowsOf(t, extended.id)).toEqual([...own, ...heldRows.map((r, i) => ({ ...r, turn: extended.id, ord: own.length + i }))]);
    expect(rowsOf(t, held.id)).toEqual([]);
    // The record at that turn reads them: the beat after the turn's own, the thread touched by it, the overlay after its own.
    expect(texts(t, "beat", extended)).toEqual(["The bell rings.", "Ash falls on the cobbles."]);
    expect(t.record(extended).items.get(thread)).toMatchObject({ touched: extended.id, fields: { text: "Who set the east wing alight?", note: "The ash smells of lamp oil." } });
    expect(notes(extended)).toEqual(["The entry says a thriving inn; smoke hangs over the yard.", "The east wing burned to its beams."]);
  });

  test("a job's row on the held turn joins the extended turn and keeps its job", async () => {
    const { t, write, overlay, notes } = await table();
    const extended = await t.play([beat("The bell rings.")]);
    const held = await continueOf(t, extended);
    await write(held, [beat("The keeper counts the buckets.")], KEEPER_JOB);
    await overlay(held, "The well by the inn is dry.", KEEPER_JOB);

    expect(await joined(t, held, extended)).toBe(2);
    expect(rowsOf(t, extended.id).map((r) => [r.table, r.by, r.agent, r.job])).toEqual([
      ["story_entry", "author", "author-1", null],
      ["story_entry", "keeper", "keeper-2", "job-1"],
      ["lore_overlay", "keeper", "keeper-2", "job-1"],
    ]);
    expect(texts(t, "beat", extended)).toEqual(["The bell rings.", "The keeper counts the buckets."]);
    expect(notes(extended)).toEqual(["The well by the inn is dry."]);
  });

  test("after a take-back of the held turn's own rows, only the job's rows move", async () => {
    const { t, write, overlay } = await table();
    const extended = await t.play([beat("The bell rings.")]);
    const held = await continueOf(t, extended);
    await write(held, [beat("Written by the continue.")]);
    await overlay(held, "Noted by the continue.");
    await write(held, [beat("Written by a job.")], KEEPER_JOB);

    // The continue saved nothing new: the owners take back the held turn's own rows, which leaves a job's, then the joins.
    const moved = await t.writes.run((d) => {
      expect(takeBackStory(d, USER, held.id, -1)).toBe(2);
      t.s.takeBack(held.id, -1);
      const n = joinStory(t.store, USER, held.id, extended.id);
      t.s.joinTurn(held.id, extended.id);
      return n;
    });
    expect(moved).toBe(1);
    expect(texts(t, "beat", extended)).toEqual(["The bell rings.", "Written by a job."]);
    expect(rowsOf(t, extended.id).map((r) => r.job)).toEqual([null, "job-1"]);
  });

  test("a swipe of the extended turn takes its own rows and the added ones together", async () => {
    const { t, write, overlay, notes } = await table();
    const extended = await t.begin();
    await write(extended, [beat("The bell rings.")]);
    await overlay(extended, "Smoke hangs over the yard.");
    await t.tie(extended);
    const held = await continueOf(t, extended);
    await write(held, [beat("Ash falls on the cobbles.")]);
    await overlay(held, "The east wing burned to its beams.");
    await joined(t, held, extended);
    expect(texts(t, "beat")).toEqual(["The bell rings.", "Ash falls on the cobbles."]);

    const swipe = await t.swipe();
    await write(swipe, [beat("Rain puts the fire out.")]);
    await t.tie(swipe);
    expect(texts(t, "beat")).toEqual(["Rain puts the fire out."]);
    expect(notes()).toEqual([]);
    // Shown again, the extended swipe brings back its own rows and the added ones together.
    await t.showSwipe(extended);
    expect(texts(t, "beat")).toEqual(["The bell rings.", "Ash falls on the cobbles."]);
    expect(notes()).toEqual(["Smoke hangs over the yard.", "The east wing burned to its beams."]);
  });

  test("the story's rows join only where the store's changes can, and before them: a held turn not open, a turn not tied, turns of different chats and a turn joined already are refused, and nothing moves", async () => {
    const { t, write, overlay } = await table();
    const extended = await t.play([beat("The bell rings.")]);
    const held = await continueOf(t, extended);
    await write(held, [beat("Ash falls on the cobbles.")]);
    await overlay(held, "The east wing burned to its beams.");
    const open = await t.writes.run(() => t.s.beginTurn({ chat: CHAT, kind: "new" }));
    await t.writes.run(() => t.s.createChat({ id: "chat-b" }));
    const elsewhere = await t.writes.run(() => t.s.beginTurn({ chat: "chat-b", kind: "continue" }));
    const all = () => [t.db.query("SELECT * FROM story_entry ORDER BY id").all(), t.db.query("SELECT * FROM lore_overlay ORDER BY id").all()];
    const before = all();
    const refused: [string, string, string][] = [
      ["a held turn not open", extended.id, extended.id],
      ["a turn not tied", held.id, open.id],
      ["turns of different chats", elsewhere.id, extended.id],
      ["a turn not there", "turn-gone", extended.id],
    ];
    for (const [what, from, into] of refused) {
      const error = await refusal(t.writes.run(() => joinStory(t.store, USER, from, into)));
      expect([what, error instanceof StoreInputError && !(error instanceof JoinedTurnError)]).toEqual([what, true]);
    }
    expect(all()).toEqual(before);

    // The store's call marks the held turn joined, so the story's comes first in the write: after it, the story's call is refused,
    // naming the turn it joined, and so is a join onto the joined turn.
    await joined(t, held, extended);
    const after = all();
    const again = await refusal(t.writes.run(() => joinStory(t.store, USER, held.id, extended.id)));
    expect(again instanceof JoinedTurnError ? [again.turn, again.joined] : again).toEqual([held.id, extended.id]);
    const later = await continueOf(t, extended);
    const onto = await refusal(t.writes.run(() => joinStory(t.store, USER, later.id, held.id)));
    expect(onto instanceof JoinedTurnError ? [onto.turn, onto.joined] : onto).toEqual([held.id, extended.id]);
    expect(all()).toEqual(after);
  });

  test("a take-back addressed to a joined turn is refused with the typed error naming the turn it joined", async () => {
    const { t, write, overlay, notes } = await table();
    const extended = await t.play([beat("The bell rings.")]);
    const held = await continueOf(t, extended);
    await write(held, [beat("Ash falls on the cobbles.")]);
    await overlay(held, "The east wing burned to its beams.");
    await joined(t, held, extended);
    // The lead dropping a sub-agent's writes, still addressed to the held turn: refused, named, and the joined rows stay.
    for (const agent of [undefined, "author-1"]) {
      const error = await refusal(t.writes.run(() => dropStoryStaged(t.store, USER, held.id, agent)));
      expect(error instanceof JoinedTurnError ? [error.turn, error.joined] : error).toEqual([held.id, extended.id]);
    }
    expect(texts(t, "beat", extended)).toEqual(["The bell rings.", "Ash falls on the cobbles."]);
    expect(notes(extended)).toEqual(["The east wing burned to its beams."]);
  });
});
