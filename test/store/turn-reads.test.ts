// The Journal's notes and the lines under replies stored with their turns' nodes (`store/turn-reads.ts`): a read works out only the
// turns whose node holds no row in the words asked, and stores those; what it gives from memory or rows is what a store with no rows
// works out afresh; an edit of his own, an Undo, a job's end, a swipe and other words each have exactly the rows they leave missing
// worked out again; a store opened again on the database reads the rows and works nothing out; and a turn's end, with no page open,
// stores what its turn shows once the chat's writes settle and no run of it goes on.

import { beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { historyTexts, installHistoryLines } from "../../src/iface/history-lines";
import { shippedTexts } from "../../src/iface/texts";
import { journalNotes, type JournalWords, storeEndedNotes } from "../../src/play/journal";
import { openStore, type Store } from "../../src/store";
import { afterTurns, type KeepTurnReads, storedTurnReads, storeTurnReads, type TurnReadKind } from "../../src/store/turn-reads";
import { STORY_STORE_AREA } from "../../src/story";
import type { Turns } from "../../src/turn/lane";
import { replyLines, type ReplyWords, storeEndedLines } from "../../src/turn/replies";
import { engine, goTo, make, play, POV, registry, testStore, tick, USER } from "./fixtures";

const REPLIES = ["m1", "m2", "m3", "m4"];
let words: JournalWords;
let lineWords: ReplyWords;

beforeAll(async () => {
  await installHistoryLines(shippedTexts());
  const texts = await historyTexts(shippedTexts());
  words = { texts, code: (code) => code, key: "words-1" };
  lineWords = { texts, key: "line-words-1" };
});

/** A chat of four played turns. */
function played() {
  let at = 0;
  const ts = testStore({ now: () => ++at });
  ts.s.createChat({ id: "c", revision: ts.revision });
  const turns = [
    play(ts.s, "c", "m1", "Morning.", 1, engine(tick(10))),
    play(ts.s, "c", "m2", "To the cellar.", 2, engine(goTo(POV, "cellar"))),
    play(ts.s, "c", "m3", "A lamp.", 3, engine(make("lamp", "Lamp", POV))),
    play(ts.s, "c", "m4", "Later.", 4, engine(make("rope", "Rope", POV), tick(5))),
  ];
  return { ...ts, turns };
}

const opened = (store: Store): Store => openStore({ areas: [STORY_STORE_AREA], db: store.db, registry: registry(), worlds: store.env.worlds });

interface Read {
  /** The turns each kind worked out, and stored at once. */
  stored: Record<TurnReadKind, string[]>;
  /** What the reads gave. */
  gave: unknown;
}

/** Reads the notes and the lines as the routes do, storing what they work out at once. */
async function read(store: Store, given: { notes?: JournalWords; lines?: ReplyWords } = {}): Promise<Read> {
  const stored: Record<TurnReadKind, string[]> = { notes: [], line: [] };
  const keep: KeepTurnReads = (at, user, kind, rows) => {
    stored[kind].push(...rows.keys());
    storeTurnReads(at, user, kind, rows);
  };
  const turns = { store, marks: { ofTurn: () => [] }, runs: { ofChat: () => [], record: () => null } } as unknown as Pick<Turns, "store" | "marks" | "runs">;
  const notes = await journalNotes(store, USER, "c", 100, given.notes ?? words, keep);
  const lines = await replyLines(turns, USER, "c", REPLIES, undefined, given.lines ?? lineWords, keep);
  return { stored: { notes: stored.notes.sort(), line: stored.line.sort() }, gave: { notes, lines } };
}

/** What a store with no rows and nothing in memory works out now, on a copy of the database. */
async function afresh(store: Store): Promise<unknown> {
  const db = Database.deserialize(store.db.serialize());
  db.run("DELETE FROM turn_read");
  return (await read(openStore({ areas: [STORY_STORE_AREA], db, registry: registry(), worlds: store.env.worlds }))).gave;
}

/** The path's turns whose node holds no row of `kind` in the words a plain `read` asks, which it must work out. */
function rowless(store: Store, kind: TurnReadKind): string[] {
  const s = store.user(USER);
  const turns = s.path("c").flatMap((e) => (e.turn === null ? [] : [e.turn]));
  const rows = storedTurnReads(store, USER, kind, turns.map((t) => s.turn(t)?.node ?? ""));
  const wordsKey = kind === "notes" ? words.key : lineWords.key;
  return turns.filter((t) => !(rows.get(s.turn(t)?.node ?? "")?.key.endsWith(wordsKey) ?? false)).sort();
}

/** A read after a change works out exactly the turns whose rows are missing, and gives what is worked out afresh. */
async function readsExactly(store: Store): Promise<void> {
  const expected = { notes: rowless(store, "notes"), line: rowless(store, "line") };
  const now = await read(store);
  expect(now.stored).toEqual(expected);
  expect(now.gave).toEqual(await afresh(store));
}

describe("a turn's reads stored with its node", () => {
  test("are worked out once and stored, and a store opened again on the database reads them and works nothing out", async () => {
    const { store, turns } = played();
    const all = turns.map((t) => t.id).sort();
    const first = await read(store);
    expect(first.stored).toEqual({ notes: all, line: all });
    expect((await read(store)).stored).toEqual({ notes: [], line: [] });
    // A restart after play: a store of its own on the same database, nothing in its memory, reads every row.
    const again = await read(opened(store));
    expect(again.stored).toEqual({ notes: [], line: [] });
    expect(again.gave).toEqual(first.gave);
    expect(store.db.query<{ n: number }, []>("SELECT count(*) AS n FROM turn_read").get()?.n).toBe(8);
  });

  test("an edit of his own, an Undo, a job's end, a swipe and other words each have exactly the rows they leave missing worked out", async () => {
    const { store, s, turns } = played();
    await read(store);
    // An edit of his own and its Undo stand in the head's reading only: no row is missing, and the rows are what is worked out afresh.
    const edit = s.addOwnerChanges("c", engine(goTo(POV, "market")));
    await readsExactly(store);
    s.undo(edit.changes.map((c) => c.id));
    await readsExactly(store);
    // A job of the newest turn records its changes there, then ends.
    s.addChanges(turns[3]!.id, engine(make("map", "Folded map", POV)).map((c) => ({ ...c, job: "j-map" })));
    await readsExactly(store);
    s.endJob("j-map");
    await readsExactly(store);
    // An edit of the past: the second turn's changes, and so its state and every later one's, are others.
    const rows = (): number => store.db.query<{ n: number }, []>("SELECT count(*) AS n FROM turn_read").get()?.n ?? 0;
    const had = rows();
    s.addChanges(turns[1]!.id, engine(make("key", "Iron key", POV)));
    expect(had - rows()).toBe(6);
    await readsExactly(store);
    // A swipe of the newest reply: its turn is new, and the turn it was swiped from keeps its row for a swipe back.
    const swiped = s.turn(turns[3]!.id)?.node ?? "";
    play(s, "c", "m4", "Much later.", 5, engine(tick(30)), { target: "m4" });
    await readsExactly(store);
    expect(storedTurnReads(store, USER, "notes", [swiped]).size).toBe(1);
    // Other words: every turn's is worked out again.
    const every = s.path("c").flatMap((e) => (e.turn === null ? [] : [e.turn])).sort();
    expect((await read(store, { notes: { ...words, key: "words-2" }, lines: { ...lineWords, key: "line-words-2" } })).stored).toEqual({ notes: every, line: every });
  });

  test("are not stored for a turn still open, nor once its state moved after they were worked out", async () => {
    const { store, s } = played();
    const open = s.beginTurn({ chat: "c", kind: "normal" });
    s.addChanges(open.id, engine(tick(1)));
    const node = s.turn(open.id)?.node ?? "";
    storeTurnReads(store, USER, "notes", new Map([[open.id, { node, mark: s.foldKey(open.id), key: "k", value: "[]" }]]));
    expect(storedTurnReads(store, USER, "notes", [node]).size).toBe(0);
    const done = s.path("c").findLast((e) => e.turn !== null)?.turn ?? "";
    const mark = s.foldKey(done);
    s.addChanges(done, engine(tick(2)));
    storeTurnReads(store, USER, "notes", new Map([[done, { node: s.turn(done)?.node ?? "", mark, key: "k", value: "[]" }]]));
    expect(storedTurnReads(store, USER, "notes", [s.turn(done)?.node ?? ""]).size).toBe(0);
  });

  test("are stored when a turn ends, with no page open: the turns it leaves without, once the chat's writes settle and no run goes on", async () => {
    const { store, s, turns } = played();
    let running = true;
    const stored: Record<TurnReadKind, string[]> = { notes: [], line: [] };
    const keep: KeepTurnReads = (at, user, kind, rows) => {
      stored[kind].push(...rows.keys());
      storeTurnReads(at, user, kind, rows);
    };
    // Told when a pass found the chat still running, or when it ended: what a step below waits for, rather than a guessed time.
    let told = Promise.withResolvers<void>();
    const ended = async (user: string, chat: string): Promise<void> => {
      await storeEndedNotes(store, user, chat, words, keep);
      await storeEndedLines(store, user, chat, lineWords, keep);
      told.resolve();
    };
    const stop = afterTurns(
      store,
      () => {
        if (running) told.resolve();
        return running;
      },
      ended,
      (error) => told.reject(error),
      1,
    );
    const settled = async (): Promise<Record<TurnReadKind, string[]>> => {
      await told.promise;
      told = Promise.withResolvers<void>();
      const out = { notes: stored.notes.sort(), line: stored.line.sort() };
      stored.notes = [];
      stored.line = [];
      return out;
    };
    try {
      // While a run of the chat goes on, nothing is worked out; once it is over, the turns no row is stored for (every turn here).
      const next = play(s, "c", "m5", "Night.", 5, engine(make("candle", "Candle", POV)));
      expect(await settled()).toEqual({ notes: [], line: [] });
      running = false;
      s.addChanges(next.id, engine(tick(1)));
      const all = [...turns, next].map((t) => t.id).sort();
      expect(await settled()).toEqual({ notes: all, line: all });
      // The next turn ends: its own alone.
      const last = play(s, "c", "m6", "Dawn.", 6, engine(goTo(POV, "cellar")));
      expect(await settled()).toEqual({ notes: [last.id], line: [last.id] });
      // A job's changes on that turn let its rows go; the job's end stores them again.
      s.addChanges(last.id, engine(make("map", "Folded map", POV)).map((c) => ({ ...c, job: "j-map" })));
      s.endJob("j-map");
      expect(await settled()).toEqual({ notes: [last.id], line: [last.id] });
      // A store opened again reads every row and works nothing out, and what they hold is what is worked out afresh.
      const again = await read(opened(store), { notes: words, lines: lineWords });
      expect(again.stored).toEqual({ notes: [], line: [] });
      expect(again.gave).toEqual(await afresh(store));
    } finally {
      stop();
    }
  });
});
