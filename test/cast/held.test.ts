// A continue is the same turn, extended (plan §10.10, R-192 (e)): what its characters wrote while it ran, held on its own open turn
// until Lumiverse's end names the message, joins the turn that message is tied to, after that turn's own rows, as it was written,
// in the one queued write that joins the store's changes, the cast's call first. Every name here is made up.

import { describe, expect, test } from "bun:test";
import { dropCastStaged, joinCast, takeBackCast } from "../../src/cast/index";
import { addCharacter, castingItemId, writeCast } from "../../src/cast/record";
import { JoinedTurnError, StoreInputError, type TurnRow } from "../../src/store";
import { CHAT, openTable, type Table, USER } from "./rig";

/** A cast row as stored, every column. */
interface EntryDb {
  id: number;
  user: string;
  turn: string;
  ord: number;
  character: string;
  part: string;
  item: string;
  value: string;
  at: number | null;
  by: string | null;
  agent: string | null;
  job: string | null;
  created: number;
}

const rowsOf = (t: Table, turn: string): EntryDb[] => t.db.query<EntryDb, [string, string]>("SELECT * FROM cast_entry WHERE user = ? AND turn = ? ORDER BY ord").all(USER, turn);

async function cast(t: Table, name: string): Promise<string> {
  return (await t.writes.run((db) => addCharacter(db, USER, CHAT, name, 1))).id;
}

/** The player asks the reply of `extended` to go on: until the end, the continue's run writes on an open turn of its own. */
function continueOf(t: Table, extended: TurnRow): Promise<TurnRow> {
  return t.writes.run(() => t.s.beginTurn({ chat: CHAT, kind: "continue", on: extended.node }));
}

/** A row written by a job the continue started. */
function jobWrite(t: Table, turn: TurnRow, character: string, text: string): Promise<unknown> {
  return t.writes.run((db) => writeCast(db, { user: USER, turn: turn.id, by: "gm", agent: "gm-1", job: "job-1", at: null, now: 6 }, [{ character, part: "memory", item: null, value: { text, gist: text, weight: 2 } }]));
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

describe("a continue's held cast rows", () => {
  test("a continue's held rows join the turn it extended: after its own rows, in the order they were made, as written; read at that turn, the cast shows them; a job's row joins too and keeps its job", async () => {
    const t = await openTable();
    const bram = await cast(t, "Bram");
    await t.play([{ character: bram, part: "casting", item: castingItemId(bram), value: { as: "supporting" } }]);
    const extended = await t.play([{ character: bram, part: "knowledge", item: null, value: { text: "Wren keeps a lantern lit.", how: "Saw it in her window." } }]);
    const own = rowsOf(t, extended.id);
    const held = await continueOf(t, extended);
    await t.write(held, [{ character: bram, part: "casting", item: castingItemId(bram), value: { as: "principal", line: "He carries the lantern now." } }]);
    await jobWrite(t, held, bram, "She trusted me with the lantern.");
    await t.write(held, [{ character: bram, part: "history", item: null, value: { text: "Walked Wren to the cellar." } }]);
    const heldRows = rowsOf(t, held.id);
    expect(t.record(extended).castingOf(bram)?.as).toBe("supporting");

    // The end names the extended turn's message: in one queued write the cast's rows join, then the store's changes, whose call
    // marks the held turn joined.
    const moved = await t.writes.run(() => {
      const n = joinCast(t.store, USER, held.id, extended.id);
      t.s.joinTurn(held.id, extended.id);
      return n;
    });
    expect(moved).toBe(3);
    // After its own rows, in the order they were made, each as written: the same id, value, writer, agent, job and time.
    expect(rowsOf(t, extended.id)).toEqual([...own, ...heldRows.map((r, i) => ({ ...r, turn: extended.id, ord: own.length + i }))]);
    expect(rowsOf(t, held.id)).toEqual([]);
    // Read at that turn, the cast shows them over its own.
    const at = t.record(extended);
    expect(at.castingOf(bram)).toEqual({ as: "principal", line: "He carries the lantern now." });
    expect(at.of(bram, "knowledge").map((i) => i.fields.text)).toEqual(["Wren keeps a lantern lit."]);
    expect(at.of(bram, "history").map((i) => [i.fields.text, i.opened])).toEqual([["Walked Wren to the cellar.", extended.id]]);
    // The job's row keeps its job, so it is read where a job's is: once the job has ended, just before the next turn to begin (§10.9).
    expect(rowsOf(t, extended.id).find((r) => r.part === "memory")?.job).toBe("job-1");
    expect(at.of(bram, "memory")).toEqual([]);
    await t.writes.run(() => t.s.endJob("job-1"));
    const next = await t.begin();
    expect(t.record(next).of(bram, "memory").map((i) => i.fields.text)).toEqual(["She trusted me with the lantern."]);
  });

  test("when the continue saved nothing new, its own rows are taken back first and only the job's rows join", async () => {
    const t = await openTable();
    const bram = await cast(t, "Bram");
    const extended = await t.play([{ character: bram, part: "history", item: null, value: { text: "Lit the lamps." } }]);
    const held = await continueOf(t, extended);
    await t.write(held, [{ character: bram, part: "history", item: null, value: { text: "Trimmed the wicks." } }]);
    await jobWrite(t, held, bram, "The wicks wanted trimming.");

    const moved = await t.writes.run(() => {
      takeBackCast(t.db, USER, held.id, -1);
      t.s.takeBack(held.id, -1);
      const n = joinCast(t.store, USER, held.id, extended.id);
      t.s.joinTurn(held.id, extended.id);
      return n;
    });
    expect(moved).toBe(1);
    expect(rowsOf(t, extended.id).map((r) => [r.part, r.job, JSON.parse(r.value).text])).toEqual([
      ["history", null, "Lit the lamps."],
      ["memory", "job-1", "The wicks wanted trimming."],
    ]);
  });

  test("the cast's rows join only where the store's changes can, and before them: a held turn not open, a turn not tied, turns of different chats and a turn joined already are refused, and nothing moves", async () => {
    const t = await openTable();
    const bram = await cast(t, "Bram");
    const extended = await t.play([{ character: bram, part: "history", item: null, value: { text: "Lit the lamps." } }]);
    const held = await continueOf(t, extended);
    await t.write(held, [{ character: bram, part: "history", item: null, value: { text: "Trimmed the wicks." } }]);
    const open = await t.writes.run(() => t.s.beginTurn({ chat: CHAT, kind: "new" }));
    await t.writes.run(() => t.s.createChat({ id: "chat-b" }));
    const elsewhere = await t.writes.run(() => t.s.beginTurn({ chat: "chat-b", kind: "continue" }));
    const all = () => t.db.query("SELECT * FROM cast_entry ORDER BY id").all();
    const before = all();
    const refused: [string, string, string][] = [
      ["a held turn not open", extended.id, extended.id],
      ["a turn not tied", held.id, open.id],
      ["turns of different chats", elsewhere.id, extended.id],
      ["a turn not there", "turn-gone", extended.id],
    ];
    for (const [what, from, into] of refused) {
      const error = await refusal(t.writes.run(() => joinCast(t.store, USER, from, into)));
      expect([what, error instanceof StoreInputError && !(error instanceof JoinedTurnError)]).toEqual([what, true]);
    }
    expect(all()).toEqual(before);

    // The store's call marks the held turn joined, so the cast's comes first in the write: after it, the cast's call is refused,
    // naming the turn it joined, and so is a join onto the joined turn.
    await t.writes.run(() => {
      joinCast(t.store, USER, held.id, extended.id);
      t.s.joinTurn(held.id, extended.id);
    });
    const joined = all();
    const again = await refusal(t.writes.run(() => joinCast(t.store, USER, held.id, extended.id)));
    expect(again instanceof JoinedTurnError ? [again.turn, again.joined] : again).toEqual([held.id, extended.id]);
    const later = await continueOf(t, extended);
    const onto = await refusal(t.writes.run(() => joinCast(t.store, USER, later.id, held.id)));
    expect(onto instanceof JoinedTurnError ? [onto.turn, onto.joined] : onto).toEqual([held.id, extended.id]);
    expect(all()).toEqual(joined);
  });

  test("a take-back addressed to a joined turn is refused with the typed error naming the turn it joined", async () => {
    const t = await openTable();
    const bram = await cast(t, "Bram");
    const extended = await t.play([{ character: bram, part: "history", item: null, value: { text: "Lit the lamps." } }]);
    const held = await continueOf(t, extended);
    await t.write(held, [{ character: bram, part: "history", item: null, value: { text: "Trimmed the wicks." } }]);
    await t.writes.run(() => {
      joinCast(t.store, USER, held.id, extended.id);
      t.s.joinTurn(held.id, extended.id);
    });
    // The lead dropping a sub-agent's writes, still addressed to the held turn: refused, named, and the joined rows stay.
    for (const agent of [undefined, "author-1"]) {
      const error = await refusal(t.writes.run(() => dropCastStaged(t.store, USER, held.id, agent)));
      expect(error instanceof JoinedTurnError ? [error.turn, error.joined] : error).toEqual([held.id, extended.id]);
    }
    expect(rowsOf(t, extended.id).map((r) => JSON.parse(r.value).text)).toEqual(["Lit the lamps.", "Trimmed the wicks."]);
  });
});
