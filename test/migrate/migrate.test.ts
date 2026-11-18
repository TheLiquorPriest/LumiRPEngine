// `migrate`, whole: the gate stops a run with a file no row names before anything is written, even
// RPE's own folder; a rehearsal writes nothing; the real run takes the backup, imports every chat,
// keeps its report in RPE's database and changes nothing of today's data; the next run says what
// changed since; `rpe migrate` runs both, with the file tree's layout; and a run into an RPE that is
// another user's is refused before anything is written.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CliIO, runCli } from "../../src/app/cli";
import { migrateCli } from "../../src/migrate/cli";
import { migrate } from "../../src/migrate/migrate";
import { reportText, type MigrationReport } from "../../src/migrate/report";
import { TreeChats } from "../../src/tree";
import { GLOBAL_FOLDERS, NOTES_FOLDER } from "../../src/tree/layout";
import { buildFixture, CHAT, OTHER_USER, RUNTIME, STRAY, treeSums, USER, type Fixture } from "./fixture";
import { addPlayedChats, PLAYED } from "./played";
import { readable, TREE } from "./tree";

const lockIndex = (sums: Map<string, string>): Map<string, string> => new Map([...sums].filter(([path]) => !path.endsWith(".db-shm")));
/** Today's data, all three places of it: Lumiverse's data folder and the runtime's folders. */
const todays = async (fixture: Fixture): Promise<Map<string, string>> => new Map([...lockIndex(await treeSums(join(fixture.root, "lumiverse"))), ...[...(await treeSums(join(fixture.root, "home")))].map(([p, s]): [string, string] => [`home/${p}`, s])]);

describe("migrate", () => {
  let fixture: Fixture;
  let data: string;

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    await addPlayedChats(fixture);
    data = join(fixture.root, "rpe-data");
  });

  afterAll(async () => {
    await fixture.remove();
  });

  test("a file no row names stops the real run by its name, before anything is written", async () => {
    const { report, ran } = await migrate(fixture.sources, { data, tree: TREE });
    expect(ran).toBe(false);
    expect(report.refusals.some((r) => r.includes(STRAY))).toBe(true);
    expect(existsSync(data)).toBe(false);
  });

  test("a rehearsal writes nothing, and says the real run may start once the file is gone", async () => {
    await rm(join(fixture.userFolder, STRAY));
    const { report, ran } = await migrate(fixture.sources, { data, rehearse: true, tree: TREE });
    expect({ ran, refusals: report.refusals, mode: report.mode }).toEqual({ ran: false, refusals: [], mode: "rehearsal" });
    expect(existsSync(data)).toBe(false);
  });

  let first: MigrationReport;

  test("the real run takes the backup, imports every chat, keeps its report, and leaves today's data as it was", async () => {
    const before = await todays(fixture);
    const { report, ran } = await migrate(fixture.sources, { data, env: fixture.named, tree: TREE, now: () => new Date("2026-11-14T09:00:00.000Z") });
    first = report;
    expect(ran).toBe(true);
    expect(await todays(fixture)).toEqual(before);
    expect(report.backup?.path.startsWith(join(data, "backups"))).toBe(true);
    expect((await stat(report.backup?.path ?? "")).mode & 0o777).toBe(0o600);
    expect(report.imports?.filter((c) => c.outcome !== "imported")).toEqual([]);
    expect(report.imports?.find((c) => c.chatId === PLAYED.planted)?.differences.length).toBe(1);
    // Its last lines say what it kept in the backup only, by row: nobody reads it as complete.
    const lines = reportText(report).trimEnd().split("\n");
    expect(lines).toContain("Kept in the backup only, as this build has no place for them in RPE yet: this run did not carry everything. A later run carries them once it has a place for them.");
    expect(lines.at(-1)).toMatch(new RegExp(`^ {2}In all: ${report.rows.reduce((n, r) => n + r.count.backup, 0)} thing\\(s\\), of \\d+ row\\(s\\)\\.$`));
    expect(report.rows.find((r) => r.row === "panel-requests")?.count).toMatchObject({ carried: 0, attached: 0 });
    expect(report.rows.find((r) => r.row === "panel-requests")?.count.backup).toBeGreaterThan(0);
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      expect(db.query("SELECT count(*) AS n FROM migration_run WHERE user = ?").get(USER)).toEqual({ n: 1 });
      expect(db.query("SELECT count(*) AS n FROM chat WHERE user = ?").get(USER)).toEqual({ n: report.imports?.length ?? -1 });
    } finally {
      db.close();
    }
  });

  test("the next run replaces what the last imported, and says what changed since", async () => {
    const draft = join(fixture.userFolder, `worlds/${fixture.worldId}/draft.json`);
    await writeFile(draft, (await readFile(draft, "utf8")).replace("Harbour, draft", "Harbour, edited in Build"));
    const { report, ran } = await migrate(fixture.sources, { data, env: fixture.named, tree: TREE, now: () => new Date("2026-11-14T10:00:00.000Z") });
    expect(ran).toBe(true);
    expect(report.changes?.since).toBe(first.at);
    expect(report.changes?.changed).toEqual([`user storage: worlds/${fixture.worldId}/draft.json`]);
    expect(new Set(report.imports?.map((c) => c.outcome))).toEqual(new Set(["replaced"]));
    expect(report.backup?.path).not.toBe(first.backup?.path);
  });

  test("`rpe migrate` runs the rehearsal and the real run, carries the user's own files and each chat's notes where the tree's layout says, and says why a run was refused", async () => {
    const out: string[] = [];
    const io: CliIO = {
      out: (t) => out.push(t),
      err: (t) => out.push(t),
      env: fixture.named,
      home: fixture.root,
      now: () => Date.parse("2026-11-14T11:00:00.000Z"),
      secret: async () => null,
      ask: async () => null,
      stopped: () => new Promise(() => {}),
      fetch: async () => {
        throw new Error("The migration calls out to nothing.");
      },
    };
    const rpe = (line: string[]): Promise<number> => runCli(["migrate", ...line], io, { version: "test" });
    const args = ["--lumiverse", fixture.sources.lumiverse, "--user", USER, "--runtime-config", fixture.sources.runtime?.configDir ?? "", "--runtime-data", fixture.sources.runtime?.dataDir ?? "", "--data", data];
    expect(await rpe(["--rehearse", ...args])).toBe(0);
    expect(out.join("")).toContain("Migration rehearsal");
    expect(await rpe(args)).toBe(0);
    expect(out.join("")).toContain("Migration real run");
    const files = join(data, "files");
    expect(await readFile(join(files, "imported", "GUIDANCE.md"), "utf8")).toBe("Keep the fog grey.");
    expect(existsSync(join(files, "imported", "agents", "scout.md"))).toBe(true);
    const db = new Database(join(data, "rpe.db"));
    try {
      const own = new TreeChats(db, { run: async (write) => write(db) }, files).folders(USER, CHAT.harness);
      expect((await readable({ files, character: own?.character ?? null, chat: own?.chat ?? null })).get(`${NOTES_FOLDER}/notebook.md`)).toBe("Ada distrusts the guard. The fog came.");
    } finally {
      db.close();
    }
    await writeFile(join(fixture.userFolder, STRAY), "Back again.");
    out.length = 0;
    expect(await rpe(args)).toBe(1);
    expect(out.join("")).toContain(STRAY);
    expect(await rpe(["--lumiverse", fixture.sources.lumiverse])).toBe(2);
    expect(out.join("")).toContain("rpe migrate [--rehearse]");
  });

  test("an option whose value is left out is refused as misused: the switch after it is never taken as its value", async () => {
    // Today's data still holds the file no row names, so that a run taking `--rehearse` as its folder would stop before writing.
    await writeFile(join(fixture.userFolder, STRAY), "Back again.");
    const out: string[] = [];
    const io = { out: (t: string) => out.push(t), err: (t: string) => out.push(t), env: {}, home: fixture.root };
    const line = ["--lumiverse", fixture.sources.lumiverse, "--user", USER, "--runtime-config", fixture.sources.runtime?.configDir ?? "", "--runtime-data", fixture.sources.runtime?.dataDir ?? "", "--data", "--rehearse"];
    expect(await migrateCli(line, io, TREE)).toBe(2);
    expect(out.join("")).toContain("--data needs a value, and --rehearse is an option.");
    expect(existsSync("--rehearse")).toBe(false);
  });
});

describe("what the gate refuses before anything is written", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    await rm(join(fixture.userFolder, STRAY));
  });

  afterAll(async () => {
    await fixture.remove();
  });

  test("a run for a user other than the one this RPE belongs to is refused before anything is written", async () => {
    const data = join(fixture.root, "owned");
    await mkdir(data);
    await writeFile(join(data, "config.json"), `${JSON.stringify({ v: 1, lumiverse: { url: null, user: OTHER_USER } })}\n`);
    const before = await treeSums(data);
    const { report, ran } = await migrate(fixture.sources, { data, tree: TREE });
    expect(ran).toBe(false);
    expect(report.refusals).toContain(`This RPE belongs to the Lumiverse user ${OTHER_USER}, and this run is for ${USER}: one RPE serves one Lumiverse user.`);
    expect(await treeSums(data)).toEqual(before);
  });

  test("a run for a user other than an earlier run's is refused before anything is written", async () => {
    const data = join(fixture.root, "shared");
    expect((await migrate(fixture.sources, { data, env: fixture.named, tree: TREE })).ran).toBe(true);
    // SQLite's shared-memory index of RPE's database aside, which every reader of it writes its locks into.
    const before = lockIndex(await treeSums(data));
    const { report, ran } = await migrate({ ...fixture.sources, userId: OTHER_USER }, { data, tree: TREE });
    expect(ran).toBe(false);
    expect(report.refusals).toContain(`An earlier run carried the data of the Lumiverse user ${USER} into this data folder, and this run is for ${OTHER_USER}: one RPE serves one Lumiverse user.`);
    expect(lockIndex(await treeSums(data))).toEqual(before);
  });

  test("a row this build carries that the run has no place for stops it: connections whose file today's runtime can't read", async () => {
    const data = join(fixture.root, "unreadable-book");
    await writeFile(join(fixture.sources.runtime?.dataDir ?? "", "runtimes", RUNTIME, "connections.json"), "{ not a book");
    const { report, ran } = await migrate(fixture.sources, { data, tree: TREE });
    expect(ran).toBe(false);
    const connections = report.rows.find((r) => r.row === "connections");
    expect(connections?.count).toMatchObject({ found: 2, carried: 0, backup: 0 });
    expect(report.refusals).toContain(`Row "${connections?.what}": 2 found, but 0 carried, 0 attached, 0 archived and 0 kept in the backup only; 2 have no place in this run: the runtime ${RUNTIME}: its connections file isn't a list of connections the previous runtime reads.`);
    expect(existsSync(data)).toBe(false);
  });

  test("a runtime expected where neither of its folders is stops the run, which names both; saying the server runs none is the way through", async () => {
    const data = join(fixture.root, "runtime-elsewhere");
    const elsewhere = { configDir: join(fixture.root, "another-account", "config"), dataDir: join(fixture.root, "another-account", "data") };
    const { report, ran } = await migrate({ ...fixture.sources, runtime: elsewhere }, { data, tree: TREE });
    expect(ran).toBe(false);
    expect(report.refusals).toContain(`The runtime's folders are not where this run looks: neither ${elsewhere.configDir} nor ${elsewhere.dataDir} is there. Say where they are, or that the server runs no runtime of the previous build (--no-runtime).`);
    expect(existsSync(data)).toBe(false);
    const none = await migrate({ ...fixture.sources, runtime: null }, { data, tree: TREE, rehearse: true });
    expect(none.report.refusals).toEqual([]);
  });
});
