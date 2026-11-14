// Lore ids: an entry keeps its id from one run of RPE to the next, and an id names one user's entry.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lore } from "../../src/lore/index";
import { ATLAS, CHAT, dbFile, loreDb, OTHER_USER, SONGS, Shelf, startingWorlds, Tags, USER } from "./fixtures";

const AT = { user: USER, chat: CHAT };

/** Each entry's id, by its title. */
function byTitle(entries: readonly { id: string; title: string }[]): Record<string, string> {
  return Object.fromEntries(entries.map((e) => [e.title, e.id]));
}

describe("lore ids", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rpe-lore-ids-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("an entry keeps its id across runs, whatever order it is asked for in and whatever entries come after it", async () => {
    const { file, backups } = dbFile(dir);
    const tags = new Tags();
    tags.set(USER, CHAT, "turn-1", [
      { id: "entry-lamp", book: ATLAS.id, title: "The lamp room", how: "keyword" },
      { id: "entry-gull", book: ATLAS.id, title: "", how: "keyword" },
      { id: "entry-shanty", book: SONGS.id, title: "The Lamplighter's Shanty", how: "constant" },
    ]);
    const first = loreDb(file, backups);
    const one = new Lore({ books: new Shelf(), worlds: startingWorlds(), turns: tags, numbers: first.numbers });
    const activatedBefore = byTitle(await one.activated({ ...AT, turn: "turn-1" }));
    const foundBefore = byTitle([...(await one.search(AT, { text: "harbor" })), ...(await one.search(AT, { text: "lamp" }))]);
    await first.close();

    // The next run: the atlas has gained an entry, and a later turn's tag lists them the other way round.
    const shelf = new Shelf();
    shelf.users.get(USER)?.entries.unshift({ id: "entry-net", book: ATLAS.id, comment: "The net lofts", content: "Nets hang drying above the lamp room's yard.", keys: ["net lofts"], secondaryKeys: [], disabled: false, constant: false, vectorized: false, extensions: {}, revision: 1 });
    tags.set(USER, CHAT, "turn-2", [
      { id: "entry-net", book: ATLAS.id, title: "The net lofts", how: "keyword" },
      { id: "entry-shanty", book: SONGS.id, title: "The Lamplighter's Shanty", how: "constant" },
      { id: "entry-gull", book: ATLAS.id, title: "", how: "keyword" },
      { id: "entry-lamp", book: ATLAS.id, title: "The lamp room", how: "keyword" },
    ]);
    const second = loreDb(file, backups);
    const two = new Lore({ books: shelf, worlds: startingWorlds(), turns: tags, numbers: second.numbers });
    const activatedAfter = byTitle(await two.activated({ ...AT, turn: "turn-2" }));
    const foundAfter = byTitle([...(await two.search(AT, { text: "harbor" })), ...(await two.search(AT, { text: "lamp" }))]);

    expect(Object.keys(activatedBefore)).toEqual(["The lamp room", "Gulls nest on the harbor wall every spring…", "The Lamplighter's Shanty"]);
    for (const [title, id] of Object.entries(activatedBefore)) expect(activatedAfter[title]).toBe(id);
    expect(Object.keys(foundBefore)).toEqual(expect.arrayContaining(["The harbor tithe", "Gulls nest on the harbor wall every spring…", "The lamp room", "The Lamplighter's Shanty"]));
    for (const [title, id] of Object.entries(foundBefore)) expect(foundAfter[title]).toBe(id);
    expect(foundAfter["The harbor tithe"]).toBe("w-tithe_law");
    // The new entry has an id of its own, never one given before.
    const net = activatedAfter["The net lofts"];
    expect(net).toMatch(/^e-[1-9][0-9]*$/);
    expect(Object.values(activatedBefore)).not.toContain(net);
    // And every id still reads its own entry.
    const read = await two.read(AT, [activatedBefore["The lamp room"] ?? "", activatedBefore["The Lamplighter's Shanty"] ?? ""]);
    expect(read.map((e) => [e.title, e.source])).toEqual([
      ["The lamp room", "Reed Coast Atlas"],
      ["The Lamplighter's Shanty", "Tavern Songs"],
    ]);
    await second.close();
  });

  test("each user's entries are numbered apart, and an id never reads another user's entry", async () => {
    const { file, backups } = dbFile(dir);
    const db = loreDb(file, backups);
    const lore = new Lore({ books: new Shelf(), worlds: startingWorlds(), turns: new Tags(), numbers: db.numbers });
    const theirs = await lore.search({ user: OTHER_USER, chat: CHAT }, { text: "lamp" });
    const mine = await lore.search(AT, { text: "beacon" });
    expect(theirs.map((h) => [h.id, h.title])).toEqual([["e-1", "Inland lamp"]]);
    expect(mine.map((h) => [h.id, h.title])).toEqual([["e-1", "The lamp room"]]);
    expect((await lore.read(AT, ["e-1"])).map((e) => e.text)).toEqual(["Green glass and whale oil, kept burning by the night watch."]);
    expect((await lore.read({ user: OTHER_USER, chat: CHAT }, ["e-1"])).map((e) => e.text)).toEqual(["Another user's lamp, which no other user ever reads."]);
    await db.close();
  });
});
