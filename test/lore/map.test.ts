// The first lore map: what activated for a turn's prompt, and the world's entries whose keys come up
// in the recent messages, matched as Lumiverse matches keys; and what activated, as RPH reads it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keysIn, Lore, loreMapFields, LUMIVERSE_KEY_MATCHING } from "../../src/lore/index";
import { ATLAS, CHAT, dbFile, type LoreDb, loreDb, Shelf, SONGS, startingWorlds, Tags, USER, W } from "./fixtures";

const AT = { user: USER, chat: CHAT };
const WHOLE_WORDS = { caseSensitive: false, wholeWords: true };
const CASED = { caseSensitive: true, wholeWords: false };

describe("the lore map", () => {
  let dir: string;
  let db: LoreDb;
  let tags: Tags;
  let lore: Lore;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "rpe-lore-map-"));
    const { file, backups } = dbFile(dir);
    db = loreDb(file, backups);
    tags = new Tags();
    tags.set(USER, CHAT, "turn-1", [
      { id: "entry-lamp", book: ATLAS.id, title: "The lamp room", how: "keyword" },
      { id: "entry-gull", book: ATLAS.id, title: "", how: "vector" },
    ]);
    lore = new Lore({ books: new Shelf(), worlds: startingWorlds(), turns: tags, numbers: db.numbers });
  });
  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("lists exactly the entries that activated, then the world's entries whose keys come up in the messages", async () => {
    const messages = [
      "Nell counts out the TITHE on the harbor steps.",
      "Orrin will not speak of the crown, nor of the lighthouse keeper.",
      "A gull screams over the cove.",
    ];
    const map = await lore.loreMap({ ...AT, turn: "turn-1", messages });
    const [lamp, gull] = await lore.activated({ ...AT, turn: "turn-1" });
    const gullTitle = "Gulls nest on the harbor wall every spring…";
    expect(map).toEqual({
      // Each with its book's name and how it activated, which the turn's folder lays out; no line of the map shows either.
      inPrompt: [
        { id: lamp?.id ?? "", title: "The lamp room", source: "Reed Coast Atlas", how: "keyword" },
        { id: gull?.id ?? "", title: gullTitle, source: "Reed Coast Atlas", how: "vector" },
      ],
      // Not the keeper's log, whose title comes up but none of its keys; not the world's copy of the gull entry.
      world: [
        { id: W.tithe_law, title: "The harbor tithe" },
        { id: W.drowned_crown, title: "The drowned crown" },
      ],
    });
    expect(loreMapFields(map)).toEqual({
      in_prompt: { lines: [`[${lamp?.id}] The lamp room`, `[${gull?.id}] ${gullTitle}`] },
      world: { lines: [`[${W.tithe_law}] The harbor tithe`, `[${W.drowned_crown}] The drowned crown`] },
    });
  });

  test("a part with nothing in it is left out of the layout's fields", async () => {
    const quiet = await lore.loreMap({ ...AT, turn: "turn-no-tag", messages: ["Nothing of note happens."] });
    expect(quiet).toEqual({ inPrompt: [], world: [] });
    expect(loreMapFields(quiet)).toEqual({});
    const prompted = await lore.loreMap({ ...AT, turn: "turn-1", messages: [] });
    expect(Object.keys(loreMapFields(prompted))).toEqual(["in_prompt"]);
  });

  test("the user's own key matching in Lumiverse is followed", async () => {
    const messages = ["The crowned heron stands in the shallows."];
    expect((await lore.loreMap({ ...AT, turn: "turn-no-tag", messages })).world.map((l) => l.id)).toEqual([W.drowned_crown]);
    expect((await lore.loreMap({ ...AT, turn: "turn-no-tag", messages, matching: WHOLE_WORDS })).world).toEqual([]);
    expect((await lore.loreMap({ ...AT, turn: "turn-no-tag", messages: ["Pay the Tithe."], matching: CASED })).world).toEqual([]);
  });

  test("keys are found as Lumiverse finds them: within one message, case folded unless asked, at word edges only when asked", () => {
    const said = (messages: string[], key: string, how = LUMIVERSE_KEY_MATCHING): boolean => keysIn(messages, how)(key);
    expect(said(["The CROWNED heron"], "crown")).toBe(true);
    expect(said(["The CROWNED heron"], "crown", WHOLE_WORDS)).toBe(false);
    expect(said(["Under the crown, a heron"], "crown", WHOLE_WORDS)).toBe(true);
    expect(said(["crown_jewels"], "crown", WHOLE_WORDS)).toBe(false);
    expect(said(["The CROWN"], "crown", CASED)).toBe(false);
    expect(said(["The crown"], "crown", CASED)).toBe(true);
    // A key is never found across two messages, nor trimmed, and an empty one never matches.
    expect(said(["Nell pays the", "tithe at dawn"], "the tithe")).toBe(false);
    expect(said(["pays the tithe"], " tithe")).toBe(true);
    expect(said(["pays thetithe"], " tithe")).toBe(false);
    expect(said(["anything"], "")).toBe(false);
    // Case is folded one code point at a time, and whole words are judged on the text as written.
    expect(said(["İsland"], "i̇sland")).toBe(true);
    expect(said(["xİsland"], "i̇sland", WHOLE_WORDS)).toBe(true);
  });

  test("what activated, as RPH reads it: by RPE's ids, with each book's name and how it activated; nothing for no turn", async () => {
    tags.set(USER, CHAT, "turn-2", [
      { id: "entry-shanty", book: SONGS.id, title: "The Lamplighter's Shanty", how: "constant" },
      { id: "entry-guest", book: "book-of-a-guest", title: "A guest's lore", how: "keyword" },
      { id: "entry-lamp", book: ATLAS.id, title: "The lamp room", how: "something new" },
    ]);
    const [shanty, guest, lamp] = await lore.activated({ ...AT, turn: "turn-2" });
    expect(shanty).toEqual({ id: expect.stringMatching(/^e-[1-9][0-9]*$/), source: "Tavern Songs", title: "The Lamplighter's Shanty", how: "constant" });
    // A book this Lumiverse does not hold (a guest's, in a shared room) cannot be named or read.
    expect(guest).toEqual({ id: expect.stringMatching(/^e-[1-9][0-9]*$/), source: "", title: "A guest's lore", how: "keyword" });
    expect(await lore.read(AT, [guest?.id ?? ""])).toEqual([]);
    // How it activated is left out when Lumiverse says something the contract has no word for.
    expect(lamp).toEqual({ id: (await lore.activated({ ...AT, turn: "turn-1" }))[0]?.id, source: "Reed Coast Atlas", title: "The lamp room" });
    expect(await lore.activated(AT)).toEqual([]);
    expect(await lore.activated({ ...AT, turn: "turn-no-tag" })).toEqual([]);
  });
});
