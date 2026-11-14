// One reader over the user's books and the world's own lore: reading by id, and searching both.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lore } from "../../src/lore/index";
import { ATLAS, CARD, CHAT, coastEntries, dbFile, type LoreDb, loreDb, Shelf, SONGS, startingWorlds, Tags, USER } from "./fixtures";

const AT = { user: USER, chat: CHAT };

describe("one reader over the books and the world", () => {
  let dir: string;
  let db: LoreDb;
  let lore: Lore;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "rpe-lore-read-"));
    const { file, backups } = dbFile(dir);
    db = loreDb(file, backups);
    lore = new Lore({ books: new Shelf(), worlds: startingWorlds(), turns: new Tags(), numbers: db.numbers });
  });
  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("an entry is read by id from either source, in full and in the order asked; an id that names nothing is left out", async () => {
    const [lamp] = await lore.search(AT, { text: "beacon" });
    const read = await lore.read(AT, ["w-tithe_law", "e-999", "tithe_law", lamp?.id ?? "", "w-no_such_entry"]);
    expect(read).toEqual([
      { id: "w-tithe_law", source: "The Reed Coast", title: "The harbor tithe", keys: ["tithe", "harbor dues"], text: "Every boat pays a tenth of its catch at the harbor steps.", revision: expect.any(String) },
      { id: lamp?.id ?? "", source: "Reed Coast Atlas", title: "The lamp room", keys: ["lamp", "lantern"], text: "Green glass and whale oil, kept burning by the night watch.", revision: expect.any(String) },
    ]);
  });

  test("a search finds entries of both sources, by their keys, titles, words, and the world's lookup table, aliases and topics", async () => {
    const harbor = await lore.search(AT, { text: "harbor" });
    expect(harbor.map((h) => [h.title, h.source])).toEqual([
      ["The harbor tithe", "The Reed Coast"],
      ["Gulls nest on the harbor wall every spring…", "Reed Coast Atlas"],
    ]);
    expect(harbor.every((h) => h.how === "words" && h.snippet.toLowerCase().includes("harbor"))).toBe(true);
    // A term of the world's lookup table, an alias, a topic's label, a book entry's other keys.
    expect((await lore.search(AT, { text: "what did the old law say" }))[0]?.id).toBe("w-tithe_law");
    expect((await lore.search(AT, { text: "a tenth" })).map((h) => h.id)).toEqual(["w-tithe_law"]);
    expect((await lore.search(AT, { text: "the tenth" }))[0]?.id).toBe("w-tithe_law");
    expect((await lore.search(AT, { text: "harbor law" }))[0]?.id).toBe("w-tithe_law");
    expect((await lore.search(AT, { text: "beacon" })).map((h) => h.title)).toEqual(["The lamp room"]);
    expect(await lore.search(AT, { text: "quicksilver" })).toEqual([]);
  });

  test("a search keeps to the sources and the number of hits asked", async () => {
    expect((await lore.search(AT, { text: "lamp", sources: ["Tavern Songs"] })).map((h) => h.title)).toEqual(["The Lamplighter's Shanty"]);
    expect((await lore.search(AT, { text: "harbor", sources: ["The Reed Coast"] })).map((h) => h.id)).toEqual(["w-tithe_law"]);
    expect((await lore.search(AT, { text: "harbor", sources: ["Reed Coast Atlas"] })).map((h) => h.source)).toEqual(["Reed Coast Atlas"]);
    expect(await lore.search(AT, { text: "harbor", limit: 1 })).toHaveLength(1);
  });

  test("a search leaves out what today's lore leaves out: the engine's own entries, entries switched off, a twin of a text read already, an earlier build's copy, and every other user's books", async () => {
    expect((await lore.search(AT, { text: "lamp" })).map((h) => h.title)).toEqual(["The lamp room", "The Lamplighter's Shanty"]);
    // The world's copy of the gull entry is not read: the entry is, as the atlas has it now.
    expect((await lore.search(AT, { text: "gull" })).map((h) => h.title)).toEqual(["Gulls nest on the harbor wall every spring…"]);
    expect(await lore.read(AT, ["w-gull_copy"])).toEqual([]);
  });

  test("an entry is read by its number only from a book the chat reads: another chat's books stay that chat's", async () => {
    // The same user has a chat that reads only the songs.
    const shelf = new Shelf(new Map([[USER, { books: [ATLAS, SONGS, CARD], entries: coastEntries(), attached: new Map([[CHAT, [ATLAS.id, CARD.id]], ["chat-songs", [SONGS.id]]]) }]]));
    const both = new Lore({ books: shelf, worlds: startingWorlds(), turns: new Tags(), numbers: db.numbers });
    const [lamp] = await both.search(AT, { text: "beacon" });
    const [shanty] = await both.search(AT, { text: "shanty" });
    expect([lamp?.source, shanty?.source]).toEqual(["Reed Coast Atlas", "Tavern Songs"]);
    const songs = { user: USER, chat: "chat-songs" };
    expect((await both.read(songs, [lamp?.id ?? "", shanty?.id ?? ""])).map((e) => e.title)).toEqual(["The Lamplighter's Shanty"]);
    expect((await both.read(AT, [lamp?.id ?? ""])).map((e) => e.title)).toEqual(["The lamp room"]);
  });

  test("a secret mark in a book entry is left out of what is read and searched, never shown as its raw text", async () => {
    const [tide] = await lore.search(AT, { text: "tide bell" });
    expect(tide?.title).toBe("The tide bell");
    const [read] = await lore.read(AT, [tide?.id ?? ""]);
    expect(read?.text.trim()).toBe("The bell rings at high water.");
    expect(await lore.search(AT, { text: "cracked hammer" })).toEqual([]);
  });

  test("a hit's snippet is the words around what it matched, cut at whole words", async () => {
    const [cove] = await lore.search(AT, { text: "brandy" });
    expect(cove?.id).toBe("w-cove_route");
    expect(cove?.snippet).toBe("Sefa runs brandy through the cove at the new moon.");
    const narrow = new Lore({ books: new Shelf(), worlds: startingWorlds(), turns: new Tags(), numbers: db.numbers, settings: { snippetChars: 10 } });
    expect((await narrow.search(AT, { text: "catch" }))[0]?.snippet).toBe("…of its catch at the…");
  });
});
