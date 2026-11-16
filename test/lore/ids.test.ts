// Lore ids: an entry keeps its id from one run of RPE to the next, and an id names one user's entry.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, WriteQueue } from "../../src/app/database";
import { migrate, type Migration, Migrations } from "../../src/app/migrations";
import { EntryNumbers, Lore, LORE_MIGRATIONS } from "../../src/lore/index";
import { STORE_MIGRATIONS } from "../../src/store";
import { ATLAS, CHAT, COAST_LORE, coastWorld, dbFile, loreDb, OTHER_USER, SONGS, Shelf, startingWorlds, Tags, USER, W } from "./fixtures";

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
    expect(foundAfter["The harbor tithe"]).toBe(W.tithe_law);
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

  test("a world entry is numbered once and keeps its number across revisions and restarts", async () => {
    const { file, backups } = dbFile(dir);
    const first = loreDb(file, backups, false);
    const one = new Lore({ books: new Shelf(), worlds: startingWorlds(), turns: new Tags(), numbers: first.numbers });
    const tithe = (await one.search(AT, { text: "tithe" })).find((h) => h.title === "The harbor tithe")?.id ?? "";
    expect(tithe).toMatch(/^w-[1-9][0-9]*$/);
    await first.close();

    // A new revision of the world, after a restart: the entry is retitled and another stands before it.
    const world = coastWorld();
    world.lore = { storm_bell: { id: "storm_bell", title: "The storm bell", keys: ["bell"], content: "It rings when the sea turns.", links: [] }, ...world.lore, tithe_law: { ...COAST_LORE.tithe_law!, title: "The harbor dues" } };
    const second = loreDb(file, backups, false);
    const two = new Lore({ books: new Shelf(), worlds: startingWorlds(world), turns: new Tags(), numbers: second.numbers });
    expect((await two.search(AT, { text: "tithe" })).map((h) => [h.id, h.title])).toEqual([[tithe, "The harbor dues"]]);
    expect((await two.read(AT, [tithe])).map((e) => [e.id, e.title])).toEqual([[tithe, "The harbor dues"]]);
    const bell = (await two.search(AT, { text: "bell" })).find((h) => h.title === "The storm bell")?.id ?? "";
    expect(bell).toMatch(/^w-[1-9][0-9]*$/);
    expect(bell).not.toBe(tithe);
    // A number names an entry of the world it was given in, and of no other.
    const elsewhere = startingWorlds({ ...coastWorld(), id: "world-other" });
    expect(await new Lore({ books: new Shelf(), worlds: elsewhere, turns: new Tags(), numbers: second.numbers }).read(AT, [tithe])).toEqual([]);
    await second.close();
  });

  test("an index line, an overlay and a proposal stored under a world entry's key are found under its number after the step", async () => {
    const { file, backups } = dbFile(dir);
    const db = openDatabase(file, 2_000);
    const upTo = (steps: readonly Migration[]): Migrations => {
      const migrations = new Migrations();
      migrations.add("store", STORE_MIGRATIONS);
      migrations.add("lore", steps);
      return migrations;
    };
    migrate(db, upTo(LORE_MIGRATIONS.filter((m) => m.version < 7)), { user: USER, version: "before", backups, now: () => 0 });
    const world = "world-reed-coast";
    db.run("INSERT INTO chat (user, id, world, revision, created) VALUES (?, ?, ?, 'revision-1', 0)", [USER, CHAT, world]);
    db.run("INSERT INTO lore_index (user, world, entry, revision, kind, related) VALUES (?, ?, 'w-cove_route', 'r1', 'rule', ?)", [USER, world, JSON.stringify(["w-tithe_law", "e-1"])]);
    db.run("INSERT INTO lore_index (user, world, entry, revision, kind) VALUES (?, ?, 'w-tithe_law', 'r1', 'rule')", [USER, world]);
    db.run("INSERT INTO lore_index (user, world, entry, revision, kind, related) VALUES (?, '', 'e-1', '1', 'place', ?)", [USER, JSON.stringify(["w-cove_route"])]);
    db.run("INSERT INTO lore_overlay (user, chat, turn, entry, note, created) VALUES (?, ?, 'turn-1', 'w-tithe_law', 'The tithe was lifted.', 0)", [USER, CHAT]);
    db.run("INSERT INTO lore_proposal (user, chat, agent, target, text, reason, status, created) VALUES (?, ?, 'scribe', 'w-cove_route', 'Sefa runs brandy.', 'canon', 'open', 0)", [USER, CHAT]);
    // The step that moves the overlays onto the store's changes (12) is the story's: the numbering is what is looked at here.
    migrate(db, upTo(LORE_MIGRATIONS.filter((m) => m.version < 12)), { user: USER, version: "after", backups, now: () => 0 });

    const queue = new WriteQueue(db, 50);
    const numbers = new EntryNumbers(db, queue);
    const given = await numbers.ofWorld(USER, world, ["cove_route", "tithe_law"]);
    expect([given.get("cove_route"), given.get("tithe_law")]).toEqual([1, 2]);
    expect(db.query("SELECT entry, related FROM lore_index ORDER BY rowid").all()).toEqual([
      { entry: "w-1", related: JSON.stringify(["w-2", "e-1"]) },
      { entry: "w-2", related: null },
      { entry: "e-1", related: JSON.stringify(["w-1"]) },
    ]);
    expect(db.query("SELECT entry FROM lore_overlay").all()).toEqual([{ entry: "w-2" }]);
    expect(db.query("SELECT target FROM lore_proposal").all()).toEqual([{ target: "w-1" }]);
    // The numbers stand: the next entry seen is given the next number.
    expect((await numbers.ofWorld(USER, world, ["keeper_log"])).get("keeper_log")).toBe(3);
    await queue.close();
    db.close();
  });
});
