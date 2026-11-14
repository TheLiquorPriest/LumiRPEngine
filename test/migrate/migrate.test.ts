// `migrate`, whole: the gate stops a run with a file no row names before anything is written, even
// RPE's own folder; a rehearsal writes nothing; the real run takes the backup, imports every chat,
// keeps its report in RPE's database and changes nothing of today's data; the next run says what
// changed since; and the command line runs both.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { migrateCli } from "../../src/migrate/cli";
import { migrate } from "../../src/migrate/migrate";
import type { MigrationReport } from "../../src/migrate/report";
import { GLOBAL_FOLDERS, NOTES_FOLDER } from "../../src/tree/layout";
import { buildFixture, STRAY, treeSums, USER, type Fixture } from "./fixture";
import { addPlayedChats, PLAYED } from "./played";

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
    const { report, ran } = await migrate(fixture.sources, { data });
    expect(ran).toBe(false);
    expect(report.refusals.some((r) => r.includes(STRAY))).toBe(true);
    expect(existsSync(data)).toBe(false);
  });

  test("a rehearsal writes nothing, and says the real run may start once the file is gone", async () => {
    await rm(join(fixture.userFolder, STRAY));
    const { report, ran } = await migrate(fixture.sources, { data, rehearse: true });
    expect({ ran, refusals: report.refusals, mode: report.mode }).toEqual({ ran: false, refusals: [], mode: "rehearsal" });
    expect(existsSync(data)).toBe(false);
  });

  let first: MigrationReport;

  test("the real run takes the backup, imports every chat, keeps its report, and leaves today's data as it was", async () => {
    const before = await todays(fixture);
    const { report, ran } = await migrate(fixture.sources, { data, now: () => new Date("2026-11-14T09:00:00.000Z") });
    first = report;
    expect(ran).toBe(true);
    expect(await todays(fixture)).toEqual(before);
    expect(report.backup?.path.startsWith(join(data, "backups"))).toBe(true);
    expect((await stat(report.backup?.path ?? "")).mode & 0o777).toBe(0o600);
    expect(report.imports?.filter((c) => c.outcome !== "imported")).toEqual([]);
    expect(report.imports?.find((c) => c.chatId === PLAYED.planted)?.differences.length).toBe(1);
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
    const { report, ran } = await migrate(fixture.sources, { data, now: () => new Date("2026-11-14T10:00:00.000Z") });
    expect(ran).toBe(true);
    expect(report.changes?.since).toBe(first.at);
    expect(report.changes?.changed).toEqual([`user storage: worlds/${fixture.worldId}/draft.json`]);
    expect(new Set(report.imports?.map((c) => c.outcome))).toEqual(new Set(["replaced"]));
    expect(report.backup?.path).not.toBe(first.backup?.path);
  });

  test("the command line runs the rehearsal and the real run, carries the user's own files where the tree's layout says, and says why a run was refused", async () => {
    const out: string[] = [];
    const io = { out: (t: string) => out.push(t), err: (t: string) => out.push(t), env: {}, home: fixture.root };
    const tree = { agents: GLOBAL_FOLDERS.agents, skills: GLOBAL_FOLDERS.skills, prompts: GLOBAL_FOLDERS.prompts, notes: NOTES_FOLDER };
    const args = ["--lumiverse", fixture.sources.lumiverse, "--user", USER, "--runtime-config", fixture.sources.runtime?.configDir ?? "", "--runtime-data", fixture.sources.runtime?.dataDir ?? "", "--data", data];
    expect(await migrateCli(["--rehearse", ...args], io, tree)).toBe(0);
    expect(out.join("")).toContain("Migration rehearsal");
    expect(await migrateCli(args, io, tree)).toBe(0);
    expect(out.join("")).toContain("Migration real run");
    expect(await readFile(join(data, "files", "imported", "GUIDANCE.md"), "utf8")).toBe("Keep the fog grey.");
    expect(existsSync(join(data, "files", "imported", GLOBAL_FOLDERS.agents, "scout.md"))).toBe(true);
    await writeFile(join(fixture.userFolder, STRAY), "Back again.");
    out.length = 0;
    expect(await migrateCli(args, io, tree)).toBe(1);
    expect(out.join("")).toContain(STRAY);
    expect(await migrateCli(["--lumiverse", fixture.sources.lumiverse], io, tree)).toBe(2);
    expect(out.join("")).toContain("rpe migrate [--rehearse]");
  });
});
