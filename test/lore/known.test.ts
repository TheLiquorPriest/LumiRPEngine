// The lore a character's agent reads as its own (plan §9.4): the world's person it plays is found as
// the cast finds a secret's holder, whether the agent was started with that person's id or name or the
// cast's character id; it is given the entries the index binds to that person, as the person may read
// them (`index:known-to-self`), and reads nothing more. Played on the invented coast, with a cast.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRef } from "rp-harness/contract";
import { addCharacter, CAST_MIGRATIONS, chatLine, findCharacter } from "../../src/cast/index";
import { Lore, LoreIndex, loreKnownBlock, lorePort, storeWorlds } from "../../src/lore/index";
import { hashJson } from "../../src/shared/hash";
import { openStore, type Store } from "../../src/store/store";
import { CHAT, coastWorld, dbFile, type LoreDb, loreDb, registry, Shelf, Tags, USER, W } from "./fixtures";
import { type LoreGuidance, shippedGuidance } from "./shipped";

const AT = { user: USER, chat: CHAT };
const CROWN = [W.drowned_crown];
const ids = (entries: readonly { id: string }[]): string[] => entries.map((e) => e.id);
const agent = (plays?: string): AgentRef => ({ id: "character-1", definition: "character", ...(plays !== undefined ? { plays } : {}) });

describe("the lore a character knows", () => {
  let dir: string;
  let db: LoreDb;
  let store: Store;
  let lore: Lore;
  let index: LoreIndex;
  let files: LoreGuidance;
  let orrin: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "rpe-lore-known-"));
    const { file, backups } = dbFile(dir);
    db = loreDb(file, backups);
    files = await shippedGuidance(join(dir, "tree"), [CHAT]);
    const world = coastWorld();
    const revision = hashJson(world);
    store = openStore({ db: ":memory:", registry: registry(), worlds: (r) => (r === revision ? world : undefined) });
    for (const m of CAST_MIGRATIONS) {
      if ("sql" in m) store.db.run(m.sql);
      else m.up(store.db, USER);
    }
    store.user(USER).createChat({ id: CHAT, world: world.id, revision });
    // The cast knows the lighthouse keeper by his full name, under an id of its own; the host gives the lore the cast's names, as
    // the turn lane does.
    orrin = addCharacter(store.db, USER, CHAT, "Orrin Pell", 1).id;
    const worlds = storeWorlds(store, (user, chat, said) => findCharacter(store.db, user, chatLine(store.user(user), chat), said)?.name ?? null);
    lore = new Lore({ books: new Shelf(), worlds, turns: new Tags(), numbers: db.numbers });
    index = new LoreIndex({ lore, db: db.db, writes: db.writes, path: { overlays: () => [] } });
    // An indexing run binds the crown and the keeper's log to Orrin, by name and by tree ref; the cove route to him too, though he
    // does not know the cove; the tithe to Sefa.
    const read = await index.entries(AT);
    const revisionOf = (id: string): string => read.find((e) => e.id === id)?.revision ?? "";
    const bound = (id: string, what: string) => ({ id, revision: revisionOf(id), kind: "item", line: `${id}.`, defines: [{ what, aspect: "" }], related: [] });
    const bell = read.find((e) => e.title === "The tide bell")?.id ?? "";
    await index.write(AT, [bound(W.drowned_crown, "Orrin Pell"), bound(W.keeper_log, "entity:orrin"), bound(W.cove_route, "orrin"), bound(W.tithe_law, "Sefa Moor"), bound(bell, "Orrin Pell")], "indexer");
  });
  afterAll(async () => {
    store.close();
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a character's agent reads as the world's person it plays, started by that person's id or name or by the cast's id", async () => {
    for (const plays of ["orrin", "Orrin Pell", orrin]) {
      expect(ids(await lore.readAs(AT, plays, CROWN))).toEqual(CROWN);
      expect(ids(await lore.searchAs(AT, plays, { text: "crown" }))).toEqual(CROWN);
    }
    // Through RPH's lore port, as an agent's `lore:` attachment and its lore tools read.
    const port = lorePort(lore);
    const scope = { ...AT, session: "session-1" };
    expect(ids(await port.read(scope, CROWN, agent("Orrin Pell")))).toEqual(CROWN);
    expect(ids(await port.read(scope, CROWN, agent(orrin)))).toEqual(CROWN);
    // Someone who holds no secret, and a name that is no one's, read none of it.
    expect(await port.read(scope, CROWN, agent("Tobin Reed"))).toEqual([]);
    expect(await port.read(scope, CROWN, agent("The ghost of the cove"))).toEqual([]);
    expect(await port.search(scope, { text: "crown" }, agent("The ghost of the cove"))).toEqual([]);
  });

  test("index:known-to-self gives the entries bound to the character, a book entry's marks only where it holds them, then the secrets it holds, worded by the lore's lines", async () => {
    const guidance = files.guidance(CHAT);
    const bell = (await index.entries(AT)).find((e) => e.title === "The tide bell")?.id;
    const block = await loreKnownBlock(index, AT, agent(orrin), guidance);
    expect(block.split("\n\n")).toEqual([
      `### [${W.drowned_crown}] The drowned crown (from The Reed Coast)\nOrrin hid the old queen's crown under the lighthouse stair.`,
      `### [${W.keeper_log}] The lighthouse keeper's log (from The Reed Coast)\nForty winters of weather, written in a cramped hand.`,
      `### [${bell}] The tide bell (from Reed Coast Atlas)\nThe bell rings at high water.\nOrrin cracked the bell with a hammer.`,
      "The secrets you hold:\n- Orrin cracked the bell with a hammer. (yours from the start)\n- Orrin hid the old queen's crown under the lighthouse stair. (yours from the start)",
    ]);
    expect(await loreKnownBlock(index, AT, agent("orrin"), guidance)).toBe(block);
    // Bound to nothing and holding nothing, the part's line says so; an agent that plays no one is given nothing.
    expect(await loreKnownBlock(index, AT, agent("Tobin Reed"), guidance)).toBe("No lore is bound to you.");
    expect(await loreKnownBlock(index, AT, agent(), guidance)).toBe("");
    expect(await loreKnownBlock(index, AT, agent("The ghost of the cove"), guidance)).toBe("");
  });

  test("a character is given the secrets it holds and no other, within its budget", async () => {
    const mine = await index.held(AT, "Orrin Pell");
    expect(mine?.secrets.map((s) => [s.id, s.how])).toEqual([["book:book-atlas/entry-tide#1", "authored"], ["drowned_crown", "authored"]]);
    expect(mine?.budget).toBe(1600);
    expect((await index.held(AT, "Tobin Reed"))?.secrets).toEqual([]);
    expect(await index.held(AT, "The ghost of the cove")).toBeNull();
  });
});
