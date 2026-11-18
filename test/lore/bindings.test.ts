// Bindings (plan §9.3): what an entry defines, proposed by an indexing run, edited by the user, and
// kept across a run that redoes the entry; the lore map follows the bindings in force.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lore, LoreIndex } from "../../src/lore/index";
import { CHAT, coastWorld, dbFile, type LoreDb, loreDb, Shelf, startingWorlds, Tags, USER, W } from "./fixtures";

const AT = { user: USER, chat: CHAT };

describe("bindings", () => {
  let dir: string;
  let db: LoreDb;
  let shelf: Shelf;
  let index: LoreIndex;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "rpe-lore-bindings-"));
    const { file, backups } = dbFile(dir);
    db = loreDb(file, backups);
    shelf = new Shelf();
    const start = startingWorlds(coastWorld());
    // The Author's horizon: the net lofts, where Tobin is.
    const worlds = { registry: start.registry, at: (user: string, chat: string) => { const at = start.at(user, chat); return at === null ? null : { ...at, horizon: ["net_lofts"] }; } };
    index = new LoreIndex({ lore: new Lore({ books: shelf, worlds, turns: new Tags(), numbers: db.numbers }), db: db.db, writes: db.writes, path: { overlays: () => [] } });
  });
  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const tide = async () => (await index.entries(AT)).find((e) => e.title === "The tide bell");
  const bound = async () => (await index.loreMap({ ...AT, turn: "turn-1", messages: [] })).bound?.map((l) => [l.title, l.bound]);

  test("a run proposes them, the user's edit stands over the run's, and a run that redoes the entry leaves the edit alone", async () => {
    const first = await tide();
    const id = first?.id ?? "";
    await index.write(AT, [{ id, revision: first?.revision ?? "", kind: "item", line: "The bell on the quay.", defines: [{ what: "The Fishmarket", aspect: "sound" }], related: [] }], "indexer");
    expect([(await tide())?.defines, (await tide())?.edited]).toEqual([[{ what: "The Fishmarket", aspect: "sound" }], []]);
    expect(await bound()).toEqual([]);

    // The user binds it to Tobin instead, and says it is a rule; the lore map follows at once.
    await index.edit(AT, id, { defines: [{ what: "Tobin Reed", aspect: "duty" }], kind: "rule" });
    expect([(await tide())?.kind, (await tide())?.defines, (await tide())?.edited]).toEqual(["rule", [{ what: "Tobin Reed", aspect: "duty" }], ["kind", "defines"]]);
    expect(await bound()).toEqual([["The tide bell", ["Tobin Reed"]]]);

    // The entry changes in Lumiverse and a run redoes it with bindings of its own: the user's stand.
    const row = shelf.users.get(USER)?.entries.find((e) => e.id === "entry-tide");
    if (row === undefined) throw new Error("the tide bell is on the shelf");
    Object.assign(row, { content: "The bell rings at every tide now.", revision: 2 });
    const changed = (await index.batch(AT)).entries.find((e) => e.id === id);
    expect(changed?.revision).toBe("2");
    await index.write(AT, [{ id, revision: changed?.revision ?? "", kind: "item", line: "The bell that rings every tide.", defines: [{ what: "The Lighthouse", aspect: "sound" }], related: [] }], "indexer");
    const redone = await tide();
    expect([redone?.indexed, redone?.kind, redone?.line, redone?.defines]).toEqual([true, "rule", "The bell that rings every tide.", [{ what: "Tobin Reed", aspect: "duty" }]]);

    // The user takes their own bindings back: the run's latest show.
    await index.edit(AT, id, { defines: null });
    expect([(await tide())?.defines, (await tide())?.edited]).toEqual([[{ what: "The Lighthouse", aspect: "sound" }], ["kind"]]);
    expect(await bound()).toEqual([]);
  });

  test("an entry casting bound to a character and one the world pins to a place both reach part 4 by the record's id, in the horizon's order; a binding to no record matches nothing", async () => {
    const world = { ...coastWorld(), lorePins: { characters: { nell: [{ lore: "keeper_log" }] }, places: { reed_coast: [{ lore: "ferry_draft" }] }, steps: {} } };
    const start = startingWorlds(world);
    // The cast knows Sefa as c-1; the horizon names the net lofts (inside the coast the ferry is pinned to) and Sefa.
    const worlds = { registry: start.registry, castName: (_u: string, _c: string, said: string) => (said === "c-1" ? "Sefa Moor" : null), at: (user: string, chat: string) => { const at = start.at(user, chat); return at === null ? null : { ...at, horizon: ["net_lofts", "sefa"] }; } };
    const idx = new LoreIndex({ lore: new Lore({ books: shelf, worlds, turns: new Tags(), numbers: db.numbers }), db: db.db, writes: db.writes, path: { overlays: () => [] } });
    await idx.entries(AT);
    await db.writes.run((d) => {
      d.run("INSERT INTO lore_binding (user, entry, record, linked, aspect, by, created) VALUES (?, ?, 'cast:c-1', 1, 'background', 'casting', 1)", [USER, W.cove_route]);
      d.run("INSERT INTO lore_binding (user, entry, record, linked, aspect, by, created) VALUES (?, ?, 'Tobin Reed', 0, '', 'run', 1)", [USER, W.tithe_law]);
    });
    const map = await idx.loreMap({ ...AT, turn: "turn-1", messages: [] });
    expect(map.bound?.map((l) => [l.id, l.bound])).toEqual([
      [W.keeper_log, ["Nell Harrow"]],
      [W.cove_route, ["Sefa Moor"]],
      [W.ferry_draft, ["The Net Lofts"]],
    ]);
    const entries = await idx.entries(AT);
    expect(entries.find((e) => e.id === W.keeper_log)?.links).toEqual([{ record: "entity:nell", linked: true, aspect: "", by: "pin" }]);
    expect(entries.find((e) => e.id === W.tithe_law)?.links).toEqual([{ record: "Tobin Reed", linked: false, aspect: "", by: "run" }]);
  });
});
