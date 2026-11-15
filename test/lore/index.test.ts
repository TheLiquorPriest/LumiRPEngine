// The lore index (plan §9.1): every entry of a chat's lore at once with what the database says of it,
// the batches an indexing run is handed, the lines it hands back kept by revision, and the count of
// what is left that the briefing shows.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type IndexedEntry, Lore, LoreIndex, type LoreIndexInput, loreBatchBlock, loreTools } from "../../src/lore/index";
import type { WorldDoc } from "../../src/shared/world";
import { CHAT, coastEntries, coastWorld, dbFile, type LoreDb, loreDb, Shelf, startingWorlds, Tags, USER, W } from "./fixtures";
import { callCtx, type LoreGuidance, shippedGuidance } from "./shipped";

const AT = { user: USER, chat: CHAT };

/** A run's lines for an entry, made up from its title, with the revision its batch showed. */
const linesFor = (e: Pick<IndexedEntry, "id" | "title" | "revision">): LoreIndexInput => ({ id: e.id, revision: e.revision, kind: "place", line: `${e.title}: as the entry says.`, defines: [{ what: e.title, aspect: "layout" }], related: [] });

describe("the lore index", () => {
  let dir: string;
  let db: LoreDb | null = null;
  let opened = 0;
  let shelf: Shelf;
  let world: WorldDoc;
  let index: LoreIndex;
  let files: LoreGuidance;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "rpe-lore-index-"));
    files = await shippedGuidance(join(dir, "tree"), [CHAT]);
  });
  afterAll(async () => {
    await db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** A fresh database, shelf and world, read by an index with the given batch size. */
  const fresh = async (batch: number): Promise<void> => {
    await db?.close();
    const { file, backups } = dbFile(join(dir, `db-${++opened}`));
    mkdirSync(join(dir, `db-${opened}`));
    const opening = loreDb(file, backups);
    db = opening;
    shelf = new Shelf();
    // The world's lore is copied, since a test rewrites an entry of it and other tests read the coast's own.
    world = coastWorld();
    world.lore = { ...world.lore };
    const lore = new Lore({ books: shelf, worlds: startingWorlds(world), turns: new Tags(), numbers: opening.numbers });
    // No turns: these tests read no overlays.
    index = new LoreIndex({ lore, db: opening.db, writes: opening.writes, path: { turns: () => [] }, settings: { batch }, now: () => 1_000 });
  };
  const shelfEntry = (id: string) => {
    const found = shelf.users.get(USER)?.entries.find((e) => e.id === id);
    if (found === undefined) throw new Error(`no entry ${id} on the shelf`);
    return found;
  };

  test("holds every entry of the chat's lore at once, with what the database says of it, before any run", async () => {
    await fresh(20);
    Object.assign(shelfEntry("entry-shanty"), { constant: true, revision: 3 });
    Object.assign(shelfEntry("entry-gull"), { vectorized: true, revision: 5 });
    const entries = await index.entries(AT);
    const content = (id: string): number => coastEntries().find((e) => e.id === id)?.content.length ?? -1;
    expect(entries.map((e) => [e.id, e.source, e.book, e.title, e.keys, e.size, e.activation, e.indexed, e.kind, e.line])).toEqual([
      // The world's own entries, but not its copy of a book entry; then the books the chat reads, each entry once.
      [W.tithe_law, "The Reed Coast", null, "The harbor tithe", ["tithe", "harbor dues"], 57, ["keyword"], false, null, null],
      [W.cove_route, "The Reed Coast", null, "The cove route", ["cove route"], 50, ["keyword"], false, null, null],
      [W.drowned_crown, "The Reed Coast", null, "The drowned crown", ["crown"], 59, ["keyword"], false, null, null],
      [W.ferry_draft, "The Reed Coast", null, "The ferry", ["ferry"], 48, ["keyword"], false, null, null],
      [W.keeper_log, "The Reed Coast", null, "The lighthouse keeper's log", ["logbook"], 52, ["keyword"], false, null, null],
      ["e-1", "Tavern Songs", "book-songs", "The Lamplighter's Shanty", ["shanty"], content("entry-shanty"), ["constant"], false, null, null],
      ["e-2", "Reed Coast Atlas", "book-atlas", "The lamp room", ["lamp", "lantern"], content("entry-lamp"), ["keyword"], false, null, null],
      ["e-3", "Reed Coast Atlas", "book-atlas", "Gulls nest on the harbor wall every spring…", ["gull"], content("entry-gull"), ["keyword", "vector"], false, null, null],
      ["e-4", "Reed Coast Atlas", "book-atlas", "The tide bell", ["tide bell"], content("entry-tide"), ["keyword"], false, null, null],
    ]);
    // A book entry's revision is Lumiverse's own; a world entry's changes whenever its title, keys or text do.
    expect(entries.filter((e) => e.book !== null).map((e) => e.revision)).toEqual(["3", "1", "5", "1"]);
    expect(new Set(entries.filter((e) => e.book === null).map((e) => e.revision)).size).toBe(5);
    // A marked secret is in nobody's reading of the text.
    expect(entries.find((e) => e.id === "e-4")?.text).not.toContain("hammer");
  });

  test("hands out batches of the set size, keeps a run's lines, and hands out again only what changed since", async () => {
    await fresh(4);
    const first = await index.batch(AT);
    expect(first.entries.map((e) => e.id)).toEqual([W.tithe_law, W.cove_route, W.drowned_crown, W.ferry_draft]);
    expect(first.left).toBe(9);

    const outcomes = await index.write(AT, first.entries.map(linesFor), "indexer");
    expect(outcomes.every((o) => "kept" in o)).toBe(true);
    const second = await index.batch(AT);
    expect(second.entries.map((e) => e.id)).toEqual([W.keeper_log, "e-1", "e-2", "e-3"]);
    expect(second.left).toBe(5);
    await index.write(AT, second.entries.map(linesFor), "indexer");
    await index.write(AT, (await index.batch(AT)).entries.map(linesFor), "indexer");
    expect(await index.batch(AT)).toEqual({ entries: [], left: 0 });

    // The tide bell is edited in Lumiverse, and the world's tithe is rewritten: those two, and only they, are handed out again.
    Object.assign(shelfEntry("entry-tide"), { content: "The bell rings at low water too.", revision: 2 });
    const tithe = world.lore.tithe_law;
    if (tithe === undefined) throw new Error("the coast has its tithe");
    world.lore.tithe_law = { ...tithe, content: "Every boat pays a fifth of its catch now." };
    const again = await index.batch(AT);
    expect(again.entries.map((e) => [e.id, e.indexed])).toEqual([
      [W.tithe_law, false],
      ["e-4", false],
    ]);
    // Until it is redone, the entry keeps the lines its old text was given.
    expect(again.entries.map((e) => e.line)).toEqual(["The harbor tithe: as the entry says.", "The tide bell: as the entry says."]);
    await index.write(AT, again.entries.map(linesFor), "indexer");
    expect((await index.batch(AT)).left).toBe(0);
  });

  test("lines a run hands back are kept for the revision its batch showed: an entry changed meanwhile is handed out again", async () => {
    await fresh(4);
    const batch = await index.batch(AT);
    expect(batch.entries.map((e) => e.id)).toContain(W.tithe_law);
    // The world's tithe is rewritten while the run reads its batch.
    const tithe = world.lore.tithe_law;
    if (tithe === undefined) throw new Error("the coast has its tithe");
    world.lore.tithe_law = { ...tithe, content: "Every boat pays a fifth of its catch now." };
    await index.write(AT, batch.entries.map(linesFor), "indexer");
    const kept = (await index.entries(AT)).find((e) => e.id === W.tithe_law);
    expect([kept?.line, kept?.indexed, kept?.stale]).toEqual(["The harbor tithe: as the entry says.", false, true]);
    expect((await index.batch(AT)).entries.map((e) => e.id)).toEqual([W.tithe_law, W.keeper_log, "e-1", "e-2"]);
  });

  test("lore_index_write keeps what it can read, says what it could not, and answers with the next batch", async () => {
    await fresh(3);
    const [tool] = await loreTools({ index, guidance: files.guidance(CHAT) });
    if (tool === undefined) throw new Error("lore_index_write is not offered");
    const revision = new Map((await index.entries(AT)).map((e) => [e.id, e.revision]));
    const result = await tool.run(
      {
        entries: [
          { id: W.tithe_law, revision: revision.get(W.tithe_law) ?? "", kind: "rule", line: "The harbor tithe: a tenth of every catch.", defines: [{ what: "The harbor steps", aspect: "rules" }], related: ["e-2"] },
          { id: "e-2", revision: Number(revision.get("e-2")), kind: "place", line: "The lamp room: green glass, whale oil." },
          { id: "e-3", revision: revision.get("e-3") ?? "", line: "Gulls on the harbor wall." },
          { id: "e-99", revision: "1", kind: "item", line: "Nothing at all." },
          { id: W.cove_route, kind: "rule", line: "Sefa's brandy run." },
        ],
      },
      callCtx(AT),
    );
    const texts = result.content.flatMap((c) => (c.type === "text" ? [c.text] : []));
    expect(result.error).toBeUndefined();
    expect(texts.slice(0, 3)).toEqual(["Entry 3 needs kind; it was not kept.", "Entry 5 needs revision; it was not kept.", "Entry 4: there is no entry e-99 in this chat's lore; it was not kept."]);
    expect(JSON.parse(texts[3] ?? "")).toEqual({
      kept: [
        { id: W.tithe_law, title: "The harbor tithe", kind: "rule", line: "The harbor tithe: a tenth of every catch.", defines: [{ what: "The harbor steps", aspect: "rules" }], related: ["e-2"] },
        { id: "e-2", title: "The lamp room", kind: "place", line: "The lamp room: green glass, whale oil.", defines: [], related: [] },
      ],
      left: 7,
    });
    expect(texts[4]).toBe("Kept the lines of 2 entries. 7 entries are not indexed yet.");
    expect(texts[5]?.split("\n").slice(0, 3)).toEqual(["Entries to index: 3 of the 7 not indexed yet.", "", `### [${W.cove_route}] The cove route (from The Reed Coast; revision ${revision.get(W.cove_route)}; keys: cove route)`]);
    expect(texts[5]).toContain("Sefa runs brandy through the cove at the new moon.");

    const kept = (await index.entries(AT)).find((e) => e.id === W.tithe_law);
    expect([kept?.kind, kept?.line, kept?.defines, kept?.related, kept?.indexed]).toEqual(["rule", "The harbor tithe: a tenth of every catch.", [{ what: "The harbor steps", aspect: "rules" }], ["e-2"], true]);

    // A call that keeps nothing fails, and says why.
    const none = await tool.run({ entries: [] }, callCtx(AT));
    expect([none.error, none.content]).toEqual([true, [{ type: "text", text: "entries cannot be read: send a list of entries, one for each entry you index." }]]);
  });

  test("the batch a run is given by name, and the count of what is left that the briefing shows", async () => {
    await fresh(2);
    const facts = index.facts();
    const unindexed = async () => (await facts.read({ ...AT, session: "session-1" }, ["lore.unindexed"]))["lore.unindexed"]?.count;
    expect(await unindexed()).toBe(9);
    const block = await loreBatchBlock(index, AT, files.guidance(CHAT));
    // Each entry with the revision a run hands back with its lines.
    const revision = new Map((await index.entries(AT)).map((e) => [e.id, e.revision]));
    expect(block.split("\n\n")).toEqual([
      "Entries to index: 2 of the 9 not indexed yet.",
      `### [${W.tithe_law}] The harbor tithe (from The Reed Coast; revision ${revision.get(W.tithe_law)}; keys: tithe, harbor dues)\nEvery boat pays a tenth of its catch at the harbor steps.`,
      `### [${W.cove_route}] The cove route (from The Reed Coast; revision ${revision.get(W.cove_route)}; keys: cove route)\nSefa runs brandy through the cove at the new moon.`,
    ]);
    while ((await index.batch(AT)).left > 0) await index.write(AT, (await index.batch(AT)).entries.map(linesFor), "indexer");
    expect(await unindexed()).toBe(0);
    expect(await loreBatchBlock(index, AT, files.guidance(CHAT))).toBe("Every entry of this chat's lore is indexed.");
  });

  test("lore_index_write is told to the model in its file's words, and the user's own file wins over the shipped one", async () => {
    await fresh(20);
    const [shipped] = await loreTools({ index, guidance: files.guidance(CHAT) });
    expect(shipped?.description.startsWith("Keeps the index lines of lore entries")).toBe(true);
    const own = join(dir, "tree", "files", ".tools");
    mkdirSync(own, { recursive: true });
    writeFileSync(join(own, "lore_index_write.md"), "---\narguments:\n  entries.kind: One word for what it is.\n---\nFiles what each entry is about.\n");
    const [edited] = await loreTools({ index, guidance: files.guidance(CHAT) });
    const kind = ((edited?.parameters.properties as Record<string, { items: { properties: Record<string, { description?: string }> } }>).entries?.items.properties.kind ?? {}).description;
    expect([edited?.description, kind]).toEqual(["Files what each entry is about.", "One word for what it is."]);
    rmSync(join(own, "lore_index_write.md"));
  });
});
