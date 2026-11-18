// The rehearsal on an invented tree of today's data: every store of the plan's table is found and
// counted, the file no row names stops the real run by name, every row's sums hold, today's own
// readers' writes stay in the stand-in's memory and nothing on the disk changes, the runtime's
// unsent writes are taken as today's runtime would send them, and a second run says what changed.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rehearse } from "../../src/migrate/rehearse";
import { reportText, type MigrationReport } from "../../src/migrate/report";
import { NO_PLACE_YET, ROWS } from "../../src/migrate/rows";
import { buildFixture, CHAT, depthFiles, IDENT, STRAY, treeSums, type Fixture } from "./fixture";

/** Every file of the tree but SQLite's shared-memory index, which every reader of a WAL database writes its locks into. */
function withoutLockIndex(sums: Map<string, string>): Map<string, string> {
  return new Map([...sums].filter(([path]) => !path.endsWith(".db-shm")));
}

describe("the rehearsal, extension installed for everyone", () => {
  let fixture: Fixture;
  let before: Map<string, string>;
  let report: MigrationReport;

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    before = await treeSums(fixture.root);
    // As `rpe migrate` runs it: given the file tree's places, where the user's own files go.
    report = await rehearse(fixture.sources, { target: fixture.root, tree: true });
  });

  afterAll(async () => {
    await fixture.remove();
  });

  test("leaves every file as it found it, the database and its log among them", async () => {
    const after = await treeSums(fixture.root);
    expect(withoutLockIndex(after)).toEqual(withoutLockIndex(before));
    expect(after.get("lumiverse/lumiverse.db")).toBe(before.get("lumiverse/lumiverse.db") ?? "");
    expect(report.database).toBe("locked");
  });

  test("keeps today's readers' writes in memory: a damaged journal set aside, a fresh one for another run's, a sweep, a flush", () => {
    const writes = report.standIn.writes;
    const aside = writes.find((w) => w.op === "move" && w.path === `runs/${CHAT.harness}/journal.json`);
    expect(aside?.to).toMatch(new RegExp(`^runs/${CHAT.harness}/journal\\.json\\.corrupt-\\d+$`));
    expect(writes.some((w) => w.op === "move" && w.path === `runs/${CHAT.agents}/journal.json.tmp` && w.to === `runs/${CHAT.agents}/journal.json`)).toBe(true);
    expect(writes.some((w) => w.op === "move" && w.path === `runs/${CHAT.agents}/chips.json` && /\.corrupt-\d+$/.test(w.to ?? ""))).toBe(true);
    expect(writes.some((w) => w.op === "remove" && w.path === `runs/${CHAT.classic}/outcome-notes.json`)).toBe(true);
    expect(writes.some((w) => w.op === "message metadata" && w.path === `chats/${CHAT.branch}/messages/m-c2-b`)).toBe(true);
    // A turn under way holds today's flush: nothing is written back onto that chat's messages.
    expect(writes.some((w) => w.op === "message metadata" && w.path.startsWith(`chats/${CHAT.classic}/`))).toBe(false);
    // A chat whose journal was never written gets a fresh one, kept in memory.
    expect(writes.some((w) => w.op === "move" && w.to === `runs/${CHAT.fresh}/journal.json`)).toBe(true);
    expect(writes.filter((w) => w.op === "refused call")).toEqual([]);
    expect(report.unreadable.map((u) => u.path)).toContain(`user storage: runs/${CHAT.harness}/journal.json`);
  });

  test("finds and counts every store of the plan's table", () => {
    for (const row of report.rows) {
      // The rows he gives to what no row names are not a store of today's build: none is given here.
      if (row.found === "not read" || row.row === "owner-rows") continue;
      const counted = row.found === "own" ? row.count.found : (row.inside?.count ?? 0);
      expect({ row: row.row, counted: counted > 0 }).toEqual({ row: row.row, counted: true });
    }
    expect(report.rows.map((r) => r.row)).toEqual(ROWS.map((r) => r.id));
    expect(report.rows.filter((r) => r.found === "not read").map((r) => r.row)).toEqual(["cli-signins", "browser-prefs"]);
  });

  test("the file no row names is found, not classified, and the real run refuses by its name", () => {
    expect(report.notClassified.map((i) => `${i.where}: ${i.path}`)).toEqual([`user storage: ${STRAY}`]);
    expect(report.refusals.some((r) => r.includes(STRAY))).toBe(true);
    expect(reportText(report)).toContain(STRAY);
  });

  test("classifies RPE's own registration and a chat's mark of where its engine came from: neither is carried, neither stops the real run", () => {
    expect(report.items.find((i) => i.where === "user storage" && i.path === "rpe/registration.json")).toMatchObject({ row: "rpe-own", fate: "archived" });
    expect(report.items.find((i) => i.where === "Lumiverse database" && i.path === `chats/${CHAT.agents}/${IDENT}/prefs/engineFrom`)).toMatchObject({ row: "chat-switch", fate: "archived", bytes: 9, note: expect.stringContaining("default for new chats") });
    expect(report.refusals.every((r) => !r.includes("registration") && !r.includes("engineFrom"))).toBe(true);
  });

  test("counts each row's things where the real run puts them: each chat's area at every turn carried as notes, the rows with no place yet kept in the backup only, never called carried", () => {
    const count = (row: string) => report.rows.find((r) => r.row === row)?.count;
    // The harness chat's area lands as notes at every turn: the latest as it stands, the ones before it as versions.
    // Its texts count with it: the index of each head and the body of each note it names are the row's too.
    expect(count("author-notes")).toEqual({ found: 12, carried: 12, attached: 0, archived: 0, backup: 0 });
    // The chat's record in RPE holds what the switch said, and the old note on where its engine was chosen is archived.
    expect(count("chat-switch")).toMatchObject({ carried: 4, attached: 0, archived: 1, backup: 0 });
    expect(count("worlds")).toMatchObject({ backup: 0 });
    for (const row of report.rows) {
      if (row.count.backup > 0) expect({ row: row.row, later: Object.hasOwn(NO_PLACE_YET, row.row) }).toEqual({ row: row.row, later: true });
      expect({ row: row.row, sum: row.count.carried + row.count.attached + row.count.archived + row.count.backup }).toEqual({ row: row.row, sum: row.count.found });
    }
    const classified = report.items.filter((i) => i.row !== null).length;
    expect(report.rows.reduce((n, r) => n + r.count.found, 0)).toBe(classified);
    expect(classified + report.notClassified.length).toBe(report.items.length);
    // The report's last lines say what is kept in the backup only, by row, so that nobody reads the run as complete.
    const lines = reportText(report).trimEnd().split("\n");
    const from = lines.findIndex((l) => l.startsWith("The real run will keep these in the backup only"));
    expect(from).toBeGreaterThan(0);
    const tail = lines.slice(from + 1);
    expect(tail).toContain(`  ${ROWS.find((r) => r.id === "approvals-jobs")?.what}: ${count("approvals-jobs")?.backup} thing(s)`);
    expect(tail.at(-1)).toBe(`  In all: ${report.rows.reduce((n, r) => n + r.count.backup, 0)} thing(s), of ${tail.length - 1} row(s).`);
  });

  test("reads one user's rows and storage only", () => {
    expect(report.chats.map((c) => c.chatId).sort()).toEqual([CHAT.agents, CHAT.branch, CHAT.classic, CHAT.fresh, CHAT.harness].sort());
    expect(report.items.some((i) => i.path.includes(CHAT.other))).toBe(false);
  });

  test("reads each chat with today's readers: its turns, its journal, what waits on the user, a turn under way", () => {
    const chat = (id: string) => report.chats.find((c) => c.chatId === id);
    expect(chat(CHAT.classic)).toMatchObject({ engine: "classic", turns: 3, journal: "read", deletedTurns: 1, underWay: 1, waiting: { questions: 1, staged: 1, chips: 1, reviewCards: 1, rollback: false } });
    expect(chat(CHAT.agents)).toMatchObject({ engine: "agents", turns: 1, journal: "from another run of this chat", waiting: { rollback: true, chips: 0 } });
    expect(chat(CHAT.harness)).toMatchObject({ engine: "harness", turns: 4, journal: "unreadable" });
    expect(chat(CHAT.branch)).toMatchObject({ engine: "classic", turns: 2, journal: "read", underWay: 0 });
    expect(chat(CHAT.fresh)).toMatchObject({ engine: "classic", turns: 1, journal: "none" });
    expect(report.underWay).toBe(1);
  });

  test("classifies what today's build leaves beside its files: leftovers, set-aside copies, a deleted chat's and a forgotten chat's data", () => {
    const item = (path: string) => report.items.find((i) => i.where === "user storage" && i.path === path);
    expect(item(`runs/${CHAT.classic}/journal.json.tmp`)).toMatchObject({ row: "ledger", fate: "archived" });
    expect(item(`runs/${CHAT.classic}/staged.json.corrupt-1700000000000`)).toMatchObject({ row: "chips-staged", fate: "archived" });
    expect(item("harness/notices.json.bad")).toMatchObject({ row: "logs", fate: "archived" });
    expect(item(`runs/${CHAT.gone}/journal.json`)).toMatchObject({ row: "deleted-chats", fate: "archived" });
    expect(item(`harness/docs/chats/${CHAT.forgot}/learned.json`)).toMatchObject({ row: "learned-and-home", fate: "archived" });
    expect(item("agents.json")).toMatchObject({ row: "mcp-clients", fate: "archived" });
    expect(report.items.find((i) => i.where === "extension storage" && i.path === "agents/build.json")).toMatchObject({ row: "mcp-clients" });
    expect(report.unreadable.map((u) => u.path)).toContain(`user storage: runs/${CHAT.classic}/staged.json.corrupt-1700000000000`);
  });

  test("classifies the files the depth engine of an earlier build left: archived in their own row, each saying what it is and why", () => {
    const paths = [...Object.keys(depthFiles(CHAT.classic)).filter((p) => !p.endsWith(".tmp")), "loopback/registry.json"];
    const items = paths.map((path) => report.items.find((i) => i.where !== "runtime" && i.path === path));
    expect(items.map((i) => ({ path: i?.path, row: i?.row, fate: i?.fate }))).toEqual(paths.map((path) => ({ path, row: "depth-engine", fate: "archived" })));
    for (const i of items) expect(i?.note).toContain("the previous build has no depth engine");
    expect(report.items.find((i) => i.path === `runs/${CHAT.classic}/archive/shard-7.json.tmp`)).toMatchObject({ row: "depth-engine", fate: "archived", note: expect.stringContaining("temporary") });
    expect(report.rows.find((r) => r.row === "depth-engine")?.count).toEqual({ found: paths.length + 1, carried: 0, attached: 0, archived: paths.length + 1, backup: 0 });
  });

  test("takes the runtime's unsent writes as today's runtime would send them, and nothing a cut-off write named", () => {
    const item = (path: string) => report.items.find((i) => i.where === "user storage" && i.path === path);
    expect(item(fixture.unsentDoc)?.note).toContain("working copy");
    expect(item("harness/docs/jobs/job-2.json")).toMatchObject({ row: "approvals-jobs", fate: "carried" });
    expect(item(fixture.unsentRemoval)).toMatchObject({ fate: "archived" });
    expect(item("harness/docs/upkeep.json")?.note).toBeUndefined();
    expect(report.unsent).toEqual([{ runtime: "home", files: 4, kept: true, why: expect.any(String) }]);
  });

  test("reads only this extension's runtime, and classifies its config, keys, working copy, installed copy and unit", () => {
    const runtime = report.items.filter((i) => i.where === "runtime");
    expect(runtime.some((i) => i.path.startsWith("config/standalone"))).toBe(false);
    expect(runtime.find((i) => i.path === "config/home.json")).toMatchObject({ row: "runtime-settings", fate: "carried" });
    expect(runtime.find((i) => i.path === "config/home.json.4242.tmp")).toMatchObject({ row: "runtime-settings", fate: "archived" });
    expect(runtime.find((i) => i.path === "runtimes/home/secrets.json")).toMatchObject({ row: "connections" });
    expect(runtime.find((i) => i.path === "runtimes/home/waiting.json")).toMatchObject({ row: "logs" });
    expect(runtime.find((i) => i.path === "installed/lumiah.js")).toMatchObject({ row: "working-copy" });
    expect(runtime.find((i) => i.path === "unit/lumiah-home.service")).toMatchObject({ row: "runtime-settings" });
  });

  test("lists a blob a record names that today's clean-up removed, by its path", () => {
    expect(report.unreadable.some((u) => u.path === `user storage: ${fixture.missingBlob}`)).toBe(true);
  });

  test("lists what today's build put in Lumiverse itself, and the disk the real run takes", () => {
    expect(report.lumiverse).toEqual({ engineBooks: 1, engineEntries: 1, markedEntries: 1, chatsWithEngineBook: 1, regexScripts: 1, presetBlocks: 2, outletReferences: 1, panelMessages: 1, chatsPinned: 1, chatsPinnedToModel: 1, schedulerExclusions: { listed: 2, engine: 1 } });
    expect(report.disk.backup).toBeGreaterThan(0);
    expect(report.disk.total).toBe(report.disk.backup + report.disk.import);
    expect(report.disk.free).toBeGreaterThan(0);
  });

  test("a second run over the same data says nothing changed; one after an edit names it", async () => {
    const again = await rehearse(fixture.sources, { previous: report });
    expect(again.changes).toMatchObject({ added: [], changed: [], gone: [], rows: [], chats: [] });
    const draft = join(fixture.userFolder, `worlds/${fixture.worldId}/draft.json`);
    const text = await readFile(draft, "utf8");
    await writeFile(draft, text.replace("Harbour, draft", "Harbour, edited in Build"));
    try {
      const edited = await rehearse(fixture.sources, { previous: report });
      expect(edited.changes?.changed).toEqual([`user storage: worlds/${fixture.worldId}/draft.json`]);
      expect(edited.changes?.rows.map((r) => r.row)).toEqual(["worlds"]);
    } finally {
      await writeFile(draft, text);
    }
  });

  test("reads what Lumiverse has committed to its log while it runs", async () => {
    const writer = new Database(join(fixture.sources.lumiverse, "lumiverse.db"));
    writer.run("PRAGMA wal_autocheckpoint=0");
    writer.query("INSERT INTO chats (id, name, metadata, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)").run("c-new", "New", JSON.stringify({ [`lumiah_chat_${IDENT}`]: { v: 1 } }), 1, 999, fixture.sources.userId);
    try {
      const live = await rehearse(fixture.sources);
      expect(live.items.some((i) => i.path === `chats/c-new/lumiah_chat_${IDENT}`)).toBe(true);
    } finally {
      writer.query("DELETE FROM chats WHERE id = ?").run("c-new");
      writer.close();
    }
  });
});

describe("the rehearsal, extension installed for one user", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await buildFixture("user");
  });

  afterAll(async () => {
    await fixture.remove();
  });

  test("finds the extension's own storage in the user's folder, and the same stores", async () => {
    const before = await treeSums(fixture.root);
    const report = await rehearse(fixture.sources, { tree: true });
    expect(withoutLockIndex(await treeSums(fixture.root))).toEqual(withoutLockIndex(before));
    expect(report.layout).toEqual({ scope: "user", userFolder: true, extensionFolder: false });
    expect(report.items.find((i) => i.where === "user storage" && i.path === "agents/build.json")).toMatchObject({ row: "mcp-clients" });
    expect(report.items.find((i) => i.where === "user storage" && i.path === "diagnostics/backend.log")).toMatchObject({ row: "logs" });
    expect(report.notClassified.map((i) => i.path)).toEqual([STRAY]);
    for (const row of report.rows) expect(row.count.found).toBe(row.count.carried + row.count.attached + row.count.archived + row.count.backup);
  });

  test("reads Lumiverse's database after a clean stop as an unchanging file, and leaves no file beside it", async () => {
    // Lumiverse stopped cleanly: its log is in the database, and neither the log nor its index is left.
    const path = join(fixture.sources.lumiverse, "lumiverse.db");
    const lumiverse = new Database(path);
    lumiverse.run("PRAGMA wal_checkpoint(TRUNCATE)");
    lumiverse.close();
    await rm(`${path}-wal`, { force: true });
    await rm(`${path}-shm`, { force: true });
    const before = await treeSums(fixture.root);
    const report = await rehearse(fixture.sources);
    expect(await treeSums(fixture.root)).toEqual(before);
    expect(report.database).toBe("immutable");
    expect(report.chats.map((c) => c.chatId)).toContain(CHAT.classic);
  });
});

describe("the report, on a file today's readers can't parse", () => {
  test("names it by path in fixed words, and never quotes what it holds", async () => {
    const fixture = await buildFixture("operator");
    try {
      // The revision every chat of the fixture plays, and its world's index, damaged: a parser's own error would quote these words.
      await writeFile(join(fixture.userFolder, "worlds", fixture.worldId, "rev", `${fixture.revisions[0]}.json`), `{ "name": Ostrichfeather }`);
      await writeFile(join(fixture.userFolder, "worlds", fixture.worldId, "index.json"), `{ "name": Saltpetrel }`);
      const report = await rehearse(fixture.sources);
      expect(report.unreadable).toContainEqual({ path: `user storage: worlds/${fixture.worldId}/index.json`, why: "the previous build's world store can't read it" });
      expect(report.chats.find((c) => c.chatId === CHAT.classic)?.notOpened).toBe(`its world ${fixture.worldId} at revision ${fixture.revisions[0]} can't be read by the previous build's world store`);
      for (const word of ["Ostrichfeather", "Saltpetrel"]) {
        expect(JSON.stringify(report)).not.toContain(word);
        expect(reportText(report)).not.toContain(word);
      }
    } finally {
      await fixture.remove();
    }
  });
});
