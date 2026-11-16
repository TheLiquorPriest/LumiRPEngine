// What the Author and the GM read of a secret in a book entry: each mark in place worded as a secret with its id and who holds it, the list of the
// entry's secrets, and the id turned into today's fact and back.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lore, loreLines } from "../../../src/lore";
import { secretIds } from "../../../src/lore/secrets/ids";
import { ATLAS, CHAT, dbFile, type LoreDb, loreDb, Shelf, startingWorlds, Tags, USER, W } from "../fixtures";
import { shippedGuidance } from "../shipped";

const AT = { user: USER, chat: CHAT };

describe("the secrets the lead reads", () => {
  let dir: string;
  let db: LoreDb;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "rpe-lore-shown-"));
    const { file, backups } = dbFile(dir);
    db = loreDb(file, backups);
  });
  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("the Author reads a book entry in full, each mark as a secret with its id and its holders; the id resolves to today's fact and back", async () => {
    const { guidance } = await shippedGuidance(dir, [CHAT]);
    const lore = new Lore({ books: new Shelf(), worlds: startingWorlds(), turns: new Tags(), numbers: db.numbers, lines: async (at) => loreLines(guidance(at.chat)) });
    const [tide] = await lore.search(AT, { text: "tide bell" });
    const [read] = await lore.read(AT, [tide?.id ?? ""]);
    const id = `${tide?.id}#1`;
    expect(read?.secrets).toEqual([{ id, heldBy: ["Orrin Pell"] }]);
    expect(read?.text).toContain(`Orrin cracked the bell with a hammer. [secret ${id}; held by Orrin Pell]`);
    expect(read?.text).not.toContain("{{");

    const ids = secretIds({ numbers: db.numbers, books: new Shelf() });
    expect(await ids.secretFactOf(USER, id)).toBe("wi:book-atlas:entry-tide:0");
    expect(await ids.shownSecretId(USER, "wi:book-atlas:entry-tide:0")).toBe(id);
    expect(await ids.secretFactOf(USER, W.drowned_crown)).toBe("lore:drowned_crown");
    expect(await ids.shownSecretId(USER, "lore:drowned_crown")).toBe(W.drowned_crown);
    // Today's own forms pass through.
    expect(await ids.secretFactOf(USER, "wi:book-atlas:entry-tide")).toBe("wi:book-atlas:entry-tide");
    expect(await ids.secretFactOf(USER, `book:${ATLAS.id}/entry-tide#2`)).toBe("wi:book-atlas:entry-tide:1");
    expect(await ids.secretFactOf(USER, "w-9999")).toBeNull();
  });
});
