// The report's counts (STANDALONE-PLAN §15.5): its table, each row of which balances as printed, the
// things kept in the backup only in a column of their own; and the mind files and the story record:
// what this run carried, against the same total the rehearsal found inside other rows' things, every
// part of the difference named: what of a chat the run did not import is in the backup only, or kept
// from an earlier run for a chat left alone; and what is in the backup only is listed with the rest of it.

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createRegistry } from "../../src/engine/registry-impl";
import { migrate } from "../../src/migrate/migrate";
import { type MigrationReport, reportText } from "../../src/migrate/report";
import { ALL_PACKS } from "../../src/packs/index";
import { openStore } from "../../src/store";
import { buildFixture, CHAT, IDENT, STRAY, USER, type Fixture } from "./fixture";
import { accounted } from "./look";
import { lumiverse } from "./today-edits";
import { TREE as tree } from "./tree";

const registry = createRegistry(ALL_PACKS);

async function withFixture(run: (fixture: Fixture, data: string) => Promise<void>): Promise<void> {
  const fixture = await buildFixture("operator");
  try {
    await rm(join(fixture.userFolder, STRAY));
    await run(fixture, join(fixture.root, "rpe-data"));
  } finally {
    await fixture.remove();
  }
}

async function migrated(fixture: Fixture, data: string, hour: number): Promise<MigrationReport> {
  const run = await migrate(fixture.sources, { data, tree, now: () => new Date(`2026-11-14T${String(hour).padStart(2, "0")}:00:00.000Z`) });
  expect(run.ran).toBe(true);
  return run.report;
}

/** The line the report prints for a row in "Where each row's things are now in RPE". */
const landed = (report: MigrationReport, row: string): string => `  ${report.rows.find((r) => r.row === row)?.what}: ${report.landed?.[row as keyof typeof report.landed]}`;

describe("the report's table", () => {
  test("every row the rehearsal and the real run print balances as printed: found = carried + attached + archived + kept in the backup only, every column there, zero where nothing was", async () => {
    await withFixture(async (fixture, data) => {
      const rehearsal = await migrate(fixture.sources, { data, tree, rehearse: true, now: () => new Date("2026-11-14T08:00:00.000Z") });
      const real = await migrated(fixture, data, 9);
      // Things this build has no place for yet are there to count: the fourth column is not always zero.
      expect(real.rows.some((r) => r.count.backup > 0)).toBe(true);
      for (const report of [rehearsal.report, real]) {
        const text = reportText(report);
        const header = "Row: found = carried + attached + archived + kept in the backup only (bytes)\n";
        expect(text).toContain(header);
        const table = text.slice(text.indexOf(header) + header.length).split("\n\n")[0]?.split("\n") ?? [];
        expect(table.length).toBe(report.rows.length);
        for (const r of report.rows) {
          const rest = table.find((line) => line.startsWith(`  ${r.what}: `))?.slice(r.what.length + 4) ?? "";
          if (r.found === "not read") {
            expect({ row: r.row, printed: rest.startsWith("not read: ") }).toEqual({ row: r.row, printed: true });
            continue;
          }
          const sums = /^(\d+) = (\d+) \+ (\d+) \+ (\d+) \+ (\d+) \(\d+\)/.exec(rest)?.slice(1).map(Number) ?? [];
          expect({ row: r.row, columns: sums.length }).toEqual({ row: r.row, columns: 5 });
          const [found, ...parts] = sums;
          expect({ row: r.row, found }).toEqual({ row: r.row, found: parts.reduce((n, part) => n + part, 0) });
        }
      }
    });
  });
});

describe("the report's counts of the mind files and the story record", () => {
  test("of a chat the run can't import, its mind files and story entries are counted against the same total, and named as in the backup only", async () => {
    await withFixture(async (fixture, data) => {
      lumiverse(fixture, (db) => db.query(`UPDATE chats SET metadata = json_set(metadata, '$.${IDENT}.revision', 'rev-unreadable') WHERE id = ?`).run(CHAT.harness));
      const report = await migrated(fixture, data, 9);
      expect(report.imports?.find((c) => c.chatId === CHAT.harness)?.outcome).toBe("not imported");
      accounted(report);
      const why = "not imported: today's reader can't open it: its world can't be read";
      const text = reportText(report);
      expect(text).toContain(landed(report, "mind-files"));
      expect(report.landed?.["mind-files"]).toEndWith(`0 version(s) of 0 file(s) of 0 character(s), 0 of the 5 found in today's areas; 5 version(s) of 1 chat(s) this run did not import (${why}): in the backup only`);
      expect(report.landed?.["story-record"]).toEndWith(`0 of the 8 entr(ies) found in today's records; 8 entr(ies) of 1 chat(s) this run did not import (${why}): in the backup only`);
      // And the list of what is in the backup only names them, so nobody reads the run as complete.
      const kept = text.slice(text.indexOf("Kept in the backup only"));
      const what = (row: string): string => report.rows.find((r) => r.row === row)?.what ?? "";
      expect(kept).toContain(`  ${what("mind-files")}: 5 version(s) of 1 chat(s) this run did not import (${why}), inside other rows' things`);
      expect(kept).toContain(`  ${what("story-record")}: 8 entr(ies) of 1 chat(s) this run did not import (${why}), inside other rows' things`);
    });
  });

  test("of a chat left alone because it was played on RPE, they are counted as kept from an earlier run", async () => {
    await withFixture(async (fixture, data) => {
      accounted(await migrated(fixture, data, 9));
      const db = new Database(join(data, "rpe.db"));
      try {
        openStore({ db, registry, worlds: () => undefined }).user(USER).beginTurn({ chat: CHAT.harness, kind: "normal" });
      } finally {
        db.close();
      }
      const report = await migrated(fixture, data, 10);
      expect(report.imports?.find((c) => c.chatId === CHAT.harness)?.outcome).toBe("played on RPE: left alone");
      accounted(report);
      expect(report.landed?.["mind-files"]).toEndWith("0 of the 5 found in today's areas; 5 version(s) of 1 chat(s) this run did not import (played on RPE: left alone): kept from an earlier run");
      expect(report.landed?.["story-record"]).toEndWith("0 of the 8 entr(ies) found in today's records; 8 entr(ies) of 1 chat(s) this run did not import (played on RPE: left alone): kept from an earlier run");
      const text = reportText(report);
      expect(text.slice(text.indexOf("Kept in the backup only"))).not.toContain("this run did not import");
    });
  });
});
