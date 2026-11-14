import { describe, expect, test } from "bun:test";
import { castAt } from "../../src/cast/path";
import { addCharacter, type Casting, castingInForce, castingItemId, castOn, CastRecord, charactersOf, chatLine, findCharacter, pinCasting, relationshipItemId } from "../../src/cast/record";
import { CHAT, openTable, type Table, USER } from "./rig";

async function newCharacter(t: Table, name: string): Promise<string> {
  return (await t.writes.run((db) => addCharacter(db, USER, CHAT, name, 1))).id;
}

const casting = (character: string, as: Casting, line?: string) => ({ character, part: "casting" as const, item: castingItemId(character), value: { as, ...(line !== undefined ? { line } : {}) } });

function inForce(t: Table, id: string, turn: Parameters<Table["record"]>[0] = null) {
  const character = charactersOf(t.db, USER, [CHAT]).find((c) => c.id === id);
  if (character === undefined) throw new Error(`no character ${id}`);
  return castingInForce(t.record(turn), character);
}

describe("casting", () => {
  test("the Author casts and recasts along the path: a swipe takes a recast back, and showing that swipe again restores it", async () => {
    const t = await openTable();
    const bram = await newCharacter(t, "Bram");
    await t.play([casting(bram, "supporting", "The innkeeper.")]);
    const recast = await t.play([casting(bram, "principal")]);
    expect(inForce(t, bram)).toEqual({ as: "principal", pinned: false, line: "The innkeeper." });

    const again = await t.swipe();
    await t.tie(again, "another reply");
    expect(inForce(t, bram)?.as).toBe("supporting");
    await t.showSwipe(recast);
    expect(inForce(t, bram)?.as).toBe("principal");
  });

  test("the player's pin stands over the Author's casting, through swipes, until the player takes it away", async () => {
    const t = await openTable();
    const bram = await newCharacter(t, "Bram");
    await t.play([casting(bram, "supporting")]);
    await t.writes.run((db) => pinCasting(db, USER, bram, "extra"));
    const recast = await t.play([casting(bram, "principal")]);
    expect(inForce(t, bram)).toEqual({ as: "extra", pinned: true, line: null });
    // The Author's own casting is still kept, for when the pin goes.
    expect(t.record().castingOf(bram)?.as).toBe("principal");

    const again = await t.swipe();
    await t.tie(again, "another reply");
    expect(inForce(t, bram)?.as).toBe("extra");
    await t.showSwipe(recast);
    await t.writes.run((db) => pinCasting(db, USER, bram, null));
    expect(inForce(t, bram)).toEqual({ as: "principal", pinned: false, line: null });
  });

  test("an extra is a name and a line; nothing is refused for any casting", async () => {
    const t = await openTable();
    const guard = await newCharacter(t, "the gate guard");
    await t.play([
      casting(guard, "extra", "A bored guard who waves carts through."),
      { character: guard, part: "relationship", item: relationshipItemId(guard, "Wren"), value: { with: "Wren", text: "Another courier." } },
    ]);
    const [member] = castOn(t.record(), charactersOf(t.db, USER, [CHAT]));
    expect(member && { name: member.character.name, as: member.as, line: member.line }).toEqual({ name: "the gate guard", as: "extra", line: "A bored guard who waves carts through." });
    expect(t.record().of(guard, "relationship")[0]?.fields.text).toBe("Another courier.");
  });

  test("the cast on a path holds who has a casting there; one cast only in a swiped turn is not in it; a branch knows its source's cast", async () => {
    const t = await openTable();
    const bram = await newCharacter(t, "Bram");
    const hale = await newCharacter(t, "Hale");
    await t.play([casting(bram, "principal")]);
    await t.play([casting(hale, "supporting")]);
    const names = (record: CastRecord, chats: string[]) => castOn(record, charactersOf(t.db, USER, chats)).map((m) => [m.character.name, m.as]);
    expect(names(t.record(), [CHAT])).toEqual([
      ["Bram", "principal"],
      ["Hale", "supporting"],
    ]);
    const again = await t.swipe();
    await t.tie(again, "another reply");
    expect(names(t.record(), [CHAT])).toEqual([["Bram", "principal"]]);

    // A branch made at the first reply: its path reaches the source's first turn through the message map.
    const [first, reply] = t.shown;
    if (first === undefined || reply === undefined) throw new Error("the chat has no first exchange");
    await t.writes.run(() => t.s.branchChat({ id: "chat-b", from: CHAT, map: { [first.id]: "b0", [reply.id]: "b1" }, at: reply.id }));
    await t.writes.run(() => t.s.sync("chat-b", [{ ...first, id: "b0" }, { ...reply, id: "b1" }]));
    const chats = chatLine(t.s, "chat-b");
    expect(chats).toEqual(["chat-b", CHAT]);
    expect(findCharacter(t.db, USER, chats, "bram")?.id).toBe(bram);
    expect(names(CastRecord.read(t.db, USER, castAt(t.s, "chat-b", null)), chats)).toEqual([["Bram", "principal"]]);
  });
});
