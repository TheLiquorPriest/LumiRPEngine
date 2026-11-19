// `LORE-INDEX.md` (plan §9.1): the readable view of a chat's lore index, written by code from the
// table into the chat's folder whenever a run or the user changes the index.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lore, LoreIndex, loreLines } from "../../src/lore/index";
import { CHAT, dbFile, type LoreDb, loreDb, scanned, Shelf, startingWorlds, Tags, USER, W } from "./fixtures";
import { type LoreGuidance, shippedGuidance } from "./shipped";

const AT = { user: USER, chat: CHAT };

describe("LORE-INDEX.md", () => {
  let dir: string;
  let db: LoreDb;
  let files: LoreGuidance;
  let index: LoreIndex;
  const folder = (): string => join(dir, "chats", "keeper", CHAT);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "rpe-lore-file-"));
    const { file, backups } = dbFile(dir);
    db = loreDb(file, backups);
    files = await shippedGuidance(join(dir, "tree"), [CHAT]);
    const lore = new Lore({ books: new Shelf(), worlds: startingWorlds(), turns: new Tags(), numbers: db.numbers });
    index = new LoreIndex({
      lore,
      db: db.db,
      writes: db.writes,
      path: { overlays: () => [] },
      // Only the coast's chat has a folder yet.
      file: { folder: (user, chat) => (user === USER && chat === CHAT ? folder() : null), lines: async (at) => loreLines(files.guidance(at.chat)) },
    });
  });
  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("is there at the chat's first briefing, before any run, and is written again when a run keeps lines or the user edits them", async () => {
    const path = join(folder(), "LORE-INDEX.md");
    expect(existsSync(path)).toBe(false);
    await index.loreMap({ ...AT, turn: "turn-1", ...scanned([]) });
    expect(existsSync(path)).toBe(true);
    const entries = await index.entries(AT);
    const lamp = entries.find((e) => e.title === "The lamp room");
    const tithe = entries.find((e) => e.id === W.tithe_law);
    await index.write(
      AT,
      [
        { id: W.tithe_law, revision: tithe?.revision ?? "", kind: "rule", line: "A tenth of every catch.", defines: [{ what: "The harbor steps", aspect: "rules" }], related: [lamp?.id ?? ""] },
        { id: lamp?.id ?? "", revision: lamp?.revision ?? "", kind: "place", line: "Green glass and whale oil.", defines: [], related: [] },
      ],
      "indexer",
    );
    const lines = readFileSync(path, "utf8").split("\n");
    expect(lines.slice(0, 3)).toEqual([
      "# Lore index",
      "",
      "The lore this chat reads: 11 entries, 9 of them not indexed yet. Each line gives the entry's id, its title, where it is from, how it comes into the prompt and its size, then what the index says of it.",
    ]);
    expect(lines).toContain(`- [${W.tithe_law}] The harbor tithe (The Reed Coast; keyword; 57 characters): rule. A tenth of every catch. Defines: The harbor steps (rules). Related: ${lamp?.id}.`);
    expect(lines).toContain(`- [${lamp?.id}] The lamp room (Reed Coast Atlas; keyword; 59 characters): place. Green glass and whale oil.`);
    // Before a run reaches it, an entry shows its title and keys.
    expect(lines).toContain(`- [${W.cove_route}] The cove route (The Reed Coast; keyword; 50 characters) Not indexed yet. Keys: cove route.`);

    await index.edit(AT, W.tithe_law, { kind: "law", defines: [{ what: "The harbor steps", aspect: "" }] });
    expect(readFileSync(path, "utf8")).toContain(`- [${W.tithe_law}] The harbor tithe (The Reed Coast; keyword; 57 characters): law. A tenth of every catch. Defines: The harbor steps. Related: ${lamp?.id}.`);
  });

  test("a chat with no folder yet has nowhere to write it", async () => {
    expect(await index.writeFile({ user: USER, chat: "chat-elsewhere" })).toBe(false);
  });
});
