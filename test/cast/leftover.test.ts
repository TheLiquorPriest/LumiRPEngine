import { describe, expect, test } from "bun:test";
import { addCharacter, charactersOf, dropLeftoverCast, writeCast } from "../../src/cast/record";
import { CHAT, openTable, USER } from "./rig";

describe("the cast's leftover rows", () => {
  test("cast rows of a chat that was deleted, or of an import that was forgotten, are removed with it; a chat a branch still shares keeps them; the characters stay", async () => {
    const t = await openTable();
    const wren = (await t.writes.run((db) => addCharacter(db, USER, CHAT, "Wren", 1))).id;
    await t.play([{ character: wren, part: "mind", item: null, value: { kind: "belief", text: "The toll is too high." } }]);
    const rowsOf = (chat: string): number => t.db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM cast_entry WHERE turn IN (SELECT id FROM turn WHERE chat = ?)").get(chat)?.n ?? 0;
    const all = (): number => t.db.query<{ n: number }, []>("SELECT count(*) AS n FROM cast_entry").get()?.n ?? 0;
    const elsewhere = async (chat: string, imported: boolean): Promise<void> => {
      await t.writes.run((db) => {
        t.s.createChat({ id: chat });
        const turn = t.s.beginTurn({ chat, kind: "new", imported });
        writeCast(db, { user: USER, turn: turn.id, by: "author", agent: "author-1", job: null, at: null, now: 5 }, [
          { character: wren, part: "mind", item: null, value: { kind: "want", text: `To leave ${chat}.` } },
          { character: wren, part: "history", item: null, value: { text: `Crossed into ${chat}.` } },
        ]);
      });
      expect(rowsOf(chat)).toBe(2);
    };

    await elsewhere("chat-deleted", false);
    expect(await t.writes.run(() => t.s.deleteChat("chat-deleted"))).toEqual({ kept: false });
    expect(await t.writes.run(() => dropLeftoverCast(t.store, USER))).toBe(2);

    await elsewhere("chat-imported", true);
    expect(await t.writes.run(() => t.s.forgetImport("chat-imported"))).toEqual({ removed: ["chat-imported"], played: [] });
    expect(await t.writes.run(() => dropLeftoverCast(t.store, USER))).toBe(2);
    expect(all()).toBe(1);

    // Deleted while a branch still shares its turns: kept, and so are its cast rows, which the branch reads.
    await t.writes.run(() => t.s.branchChat({ id: "chat-branch", from: CHAT, map: Object.fromEntries(t.shown.map((m) => [m.id, `b-${m.id}`])) }));
    expect(await t.writes.run(() => t.s.deleteChat(CHAT))).toEqual({ kept: true });
    expect(await t.writes.run(() => dropLeftoverCast(t.store, USER))).toBe(0);
    expect(rowsOf(CHAT)).toBe(1);
    expect(charactersOf(t.db, USER, [CHAT]).map((c) => c.name)).toEqual(["Wren"]);
  });
});
