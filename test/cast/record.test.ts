import { describe, expect, test } from "bun:test";
import {
  addCharacter,
  baseHistory,
  baseOf,
  bindingsOf,
  bindSource,
  awayItemId,
  castingItemId,
  charactersOf,
  chatLine,
  findCharacter,
  pinCasting,
  relationshipItemId,
  ROW_PARTS,
  sourceKey,
  unbindSource,
  writeBase,
  type CastWrite,
} from "../../src/cast/record";
import { CHAT, openTable, type Table, USER } from "./rig";

/** One write of every part kept as rows, as an invented innkeeper's first turn might hold them. */
function everyRowPart(c: string): CastWrite[] {
  return [
    { character: c, part: "casting", item: castingItemId(c), value: { as: "supporting", line: "The innkeeper of the Gilded Hart.", why: "He matters to the letter thread." } },
    { character: c, part: "growth", item: null, value: { text: "He no longer trusts a sealed letter.", cause: "The forged seal." } },
    { character: c, part: "mind", item: null, value: { kind: "hiding", text: "He read the letter before he sealed it again.", about: ["Wren"], from: ["p-1"] } },
    { character: c, part: "relationship", item: relationshipItemId(c, "Wren"), value: { with: "Wren", text: "She pays on time. I would not cross her.", trust: 40, warmth: 20, respect: 60, fear: 10 } },
    { character: c, part: "knowledge", item: null, value: { text: "The reeve's seal has a chipped corner.", how: "He saw it on the letter." } },
    { character: c, part: "history", item: null, value: { text: "Handed Wren the sealed letter and would not meet her eye.", beats: ["b-3"] } },
    { character: c, part: "perception", item: null, value: { reach: "part", moment: "Wren opens the letter", content: "From behind the bar: she goes pale.", missed: "What it says.", knows: ["Wren has a sealed letter."] } },
    { character: c, part: "memory", item: null, value: { text: "She went pale at my letter and I said nothing.", gist: "Said nothing when she went pale.", weight: 3, who: ["Wren"], about: ["the letter"], from: ["p-1"] } },
    { character: c, part: "away", item: awayItemId(c), value: { whereabouts: "At the docks.", intention: "Find passage north.", place_ref: "place:docks", until: "nightfall" } },
  ];
}

async function cast(t: Table, name: string): Promise<string> {
  return (await t.writes.run((db) => addCharacter(db, USER, CHAT, name, 1))).id;
}

describe("a character's record", () => {
  test("holds every part as written, and reads each back as it stands", async () => {
    const t = await openTable();
    const bram = await cast(t, "Bram Holloway");
    const turn = await t.begin();
    await t.writes.run((db) => {
      bindSource(db, USER, bram, { kind: "card", ref: "card-bram", defines: null }, 2);
      bindSource(db, USER, bram, { kind: "entry", ref: "e-112", defines: "background" }, 3);
      bindSource(db, USER, bram, { kind: "persona", ref: "persona-x", defines: "voice" }, 4);
      bindSource(db, USER, bram, { kind: "memory", ref: "mem-7", defines: null }, 5);
      writeBase(
        db,
        { user: USER, chat: CHAT, turn: turn.id, by: "author", agent: "author-1", now: 6 },
        bram,
        { seed: "An innkeeper who keeps his head down.", soul: "Wants a quiet life; will not lie to a guest.", inner_voice: "Counts things when he is nervous.", background: "Born in the cellar of the inn he now keeps." },
        { [sourceKey("entry", "e-112")]: "r1", [sourceKey("card", "card-bram")]: "r9" },
      );
    });
    const writes = everyRowPart(bram);
    await t.write(turn, writes);
    await t.tie(turn);

    expect(charactersOf(t.db, USER, [CHAT]).map((c) => [c.id, c.name, c.chat, c.pinned])).toEqual([[bram, "Bram Holloway", CHAT, null]]);
    expect(findCharacter(t.db, USER, [CHAT], "  bram   HOLLOWAY")?.id).toBe(bram);
    expect(findCharacter(t.db, USER, [CHAT], bram)?.name).toBe("Bram Holloway");
    expect(findCharacter(t.db, USER, [CHAT], "Wren")).toBeNull();

    expect(bindingsOf(t.db, USER, bram).map((b) => [b.kind, b.ref, b.defines])).toEqual([
      ["card", "card-bram", null],
      ["entry", "e-112", "background"],
      ["persona", "persona-x", "voice"],
      ["memory", "mem-7", null],
    ]);
    const base = baseOf(t.db, USER, bram, CHAT);
    expect([...base.values()].map((v) => [v.part, v.version, v.turn])).toEqual([
      ["seed", 1, turn.id],
      ["soul", 1, turn.id],
      ["inner_voice", 1, turn.id],
      ["background", 1, turn.id],
    ]);
    expect(base.get("inner_voice")?.text).toBe("Counts things when he is nervous.");
    expect(base.get("background")?.seen).toEqual({ "entry:e-112": "r1", "card:card-bram": "r9" });

    const record = t.record();
    for (const part of ROW_PARTS) expect({ part, count: record.of(bram, part).length }).toEqual({ part, count: 1 });
    for (const w of writes) {
      const [item] = record.of(bram, w.part);
      expect(item?.fields).toEqual(w.value);
      expect(item?.opened).toBe(turn.id);
      expect(item?.rows.map((r) => [r.by, r.agent])).toEqual([["author", "author-1"]]);
    }
    expect(record.castingOf(bram)).toEqual({ as: "supporting", line: "The innkeeper of the Gilded Hart." });
    expect(record.items.get(relationshipItemId(bram, " wren "))?.fields.trust).toBe(40);
  });

  test("keeps each item's history and every version of the base; read at an earlier turn, rows stand as they did then", async () => {
    const t = await openTable();
    const bram = await cast(t, "Bram");
    const first = await t.play([{ character: bram, part: "knowledge", item: null, value: { text: "Wren carries letters for the reeve.", how: "Told by the ferryman." } }]);
    const known = t.record().of(bram, "knowledge")[0]?.id ?? "";
    const second = await t.play([{ character: bram, part: "knowledge", item: known, value: { how: "Saw her badge himself." } }]);
    await t.play([{ character: bram, part: "knowledge", item: known, value: { drop: true, why: "She quit the reeve's service." } }]);

    const at = (turn: typeof first) => t.record(turn).items.get(known);
    expect(at(first)?.fields).toEqual({ text: "Wren carries letters for the reeve.", how: "Told by the ferryman." });
    expect(at(second)?.fields.how).toBe("Saw her badge himself.");
    expect(at(second)?.dropped).toBe(false);
    expect(t.record().of(bram, "knowledge")).toEqual([]);
    expect(t.record().of(bram, "knowledge", true)[0]?.rows.map((r) => r.turn)).toHaveLength(3);

    await t.writes.run((db) => {
      writeBase(db, { user: USER, chat: CHAT, turn: null, by: null, agent: null, now: 10 }, bram, { seed: "An innkeeper." }, {});
      writeBase(db, { user: USER, chat: CHAT, turn: null, by: null, agent: null, now: 11 }, bram, { seed: "An innkeeper who keeps his head down." }, {});
    });
    expect(baseHistory(t.db, USER, bram, CHAT).map((v) => [v.part, v.version, v.text])).toEqual([
      ["seed", 1, "An innkeeper."],
      ["seed", 2, "An innkeeper who keeps his head down."],
    ]);
    expect(baseOf(t.db, USER, bram, CHAT).get("seed")?.version).toBe(2);
  });

  test("a relationship and a piece of knowledge written in a turn go with that turn's swipe and come back when it is shown again; the base and sources stay", async () => {
    const t = await openTable();
    const bram = await cast(t, "Bram");
    await t.play([{ character: bram, part: "casting", item: castingItemId(bram), value: { as: "principal" } }]);
    const played = await t.begin();
    await t.write(played, everyRowPart(bram).slice(1));
    await t.writes.run((db) => {
      bindSource(db, USER, bram, { kind: "entry", ref: "e-9", defines: "appearance" }, 9);
      writeBase(db, { user: USER, chat: CHAT, turn: played.id, by: "author", agent: "author-1", now: 9 }, bram, { soul: "Will not lie to a guest." }, {});
    });
    await t.tie(played);
    const rel = relationshipItemId(bram, "Wren");
    expect(t.record().items.get(rel)?.fields.text).toBe("She pays on time. I would not cross her.");
    expect(t.record().of(bram, "knowledge")).toHaveLength(1);

    const again = await t.swipe();
    await t.tie(again, "another reply");
    const after = t.record();
    expect(after.items.get(rel)).toBeUndefined();
    for (const part of ["growth", "mind", "relationship", "knowledge", "history"] as const) expect({ part, after: after.of(bram, part) }).toEqual({ part, after: [] });
    // The turn before stays: its casting is still on the path.
    expect(after.castingOf(bram)?.as).toBe("principal");
    // Outside turns: the swipe leaves them.
    expect(bindingsOf(t.db, USER, bram).map((b) => b.ref)).toEqual(["e-9"]);
    expect(baseOf(t.db, USER, bram, CHAT).get("soul")?.text).toBe("Will not lie to a guest.");

    await t.showSwipe(played);
    const back = t.record();
    expect(back.items.get(rel)?.fields).toMatchObject({ with: "Wren", trust: 40 });
    expect(back.of(bram, "knowledge")[0]?.fields.text).toBe("The reeve's seal has a chipped corner.");
    expect(back.of(bram, "history")).toHaveLength(1);
  });

  test("an open turn sees its own rows and no other reading does; deleting a turn's messages takes its rows off the path", async () => {
    const t = await openTable();
    const bram = await cast(t, "Bram");
    await t.play([{ character: bram, part: "history", item: null, value: { text: "Opened the inn at dawn." } }]);
    const open = await t.begin();
    await t.write(open, [{ character: bram, part: "history", item: null, value: { text: "Barred the door at dusk." } }]);
    expect(t.record(open).of(bram, "history").map((h) => h.fields.text)).toEqual(["Opened the inn at dawn.", "Barred the door at dusk."]);
    expect(t.record().of(bram, "history").map((h) => h.fields.text)).toEqual(["Opened the inn at dawn."]);
    await t.tie(open);
    expect(t.record().of(bram, "history")).toHaveLength(2);
    await t.remove(2);
    expect(t.record().of(bram, "history").map((h) => h.fields.text)).toEqual(["Opened the inn at dawn."]);
  });

  test("a binding can be said again with another side, and taken away", async () => {
    const t = await openTable();
    const bram = await cast(t, "Bram");
    await t.writes.run((db) => {
      bindSource(db, USER, bram, { kind: "entry", ref: "e-1", defines: "background" }, 1);
      bindSource(db, USER, bram, { kind: "entry", ref: "e-1", defines: "voice" }, 2);
    });
    expect(bindingsOf(t.db, USER, bram).map((b) => [b.ref, b.defines])).toEqual([["e-1", "voice"]]);
    expect(await t.writes.run((db) => unbindSource(db, USER, bram, "entry", "e-1"))).toBe(true);
    expect(bindingsOf(t.db, USER, bram)).toEqual([]);
  });

  test("a base redrawn and a casting pinned in the source after the branch point do not change the branch's; one made in the branch is its own", async () => {
    const t = await openTable();
    const bram = await cast(t, "Bram");
    // A time that is before the branch was made (the store's clock here counts from 1) and one far after it.
    await t.writes.run((db) => {
      writeBase(db, { user: USER, chat: CHAT, turn: null, by: "author", agent: "author-1", now: 1 }, bram, { soul: "Wants a quiet life." }, {});
      pinCasting(db, USER, bram, "principal", { chat: CHAT, now: 1 });
    });
    await t.play();
    const [first, reply] = t.shown;
    if (first === undefined || reply === undefined) throw new Error("the chat has no first exchange");
    await t.writes.run(() => t.s.branchChat({ id: "chat-b", from: CHAT, map: { [first.id]: "b0", [reply.id]: "b1" }, at: reply.id }));
    const later = 1_000_000_000;
    await t.writes.run((db) => {
      writeBase(db, { user: USER, chat: CHAT, turn: null, by: "author", agent: "author-1", now: later }, bram, { soul: "Wants no guests at all." }, {});
      pinCasting(db, USER, bram, "supporting", { chat: CHAT, now: later });
    });
    const soulIn = (chat: string) => baseOf(t.db, USER, bram, chat).get("soul");
    const pinIn = (chat: string) => charactersOf(t.db, USER, chatLine(t.s, chat))[0]?.pinned;
    expect([soulIn(CHAT)?.text, soulIn("chat-b")?.text]).toEqual(["Wants no guests at all.", "Wants a quiet life."]);
    expect([pinIn(CHAT), pinIn("chat-b")]).toEqual(["supporting", "principal"]);

    // The branch redraws its own: the source keeps what it has, and the version numbers run on.
    await t.writes.run((db) => {
      writeBase(db, { user: USER, chat: "chat-b", turn: null, by: "author", agent: "author-1", now: later + 1 }, bram, { soul: "Wants to leave." }, {});
      pinCasting(db, USER, bram, null, { chat: "chat-b", now: later + 1 });
    });
    expect([soulIn(CHAT)?.text, soulIn("chat-b")?.text, soulIn("chat-b")?.version]).toEqual(["Wants no guests at all.", "Wants to leave.", 3]);
    expect([pinIn(CHAT), pinIn("chat-b")]).toEqual(["supporting", null]);
    expect(baseHistory(t.db, USER, bram, "chat-b").map((v) => v.text)).toEqual(["Wants a quiet life.", "Wants to leave."]);
  });
});
