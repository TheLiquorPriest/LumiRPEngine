// A real run fills Build's own table with the worlds it carried (plan §15.2, "Worlds"; `src/build/seed.ts`):
// the first run copies each world in, a run made again with nothing changed leaves them as they are,
// and the report says which. A world changed in Build and on today's side since stays as Build has
// it, and the printed report and the Migration page name it as waiting on the user.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "../../src/migrate/migrate";
import { migrationPage } from "../../src/migrate/page";
import { reportText } from "../../src/migrate/report";
import { buildFixture, IDENT, STRAY, USER, type Fixture } from "./fixture";
import { TREE as tree } from "./tree";

describe("the worlds a run carried, in Build's own table", () => {
  let fixture: Fixture;
  let data: string;

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    await rm(join(fixture.userFolder, STRAY));
    data = join(fixture.root, "rpe-data");
  });

  afterAll(async () => {
    await fixture.remove();
  });

  const worldsHeld = (): string[] => {
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      const rows = db.query<{ path: string }, [string]>("SELECT path FROM build_file WHERE user = ? ORDER BY path").all(USER);
      return [...new Set(rows.map((r) => r.path.split("/")[1] ?? ""))].filter((w) => w !== "");
    } finally {
      db.close();
    }
  };

  test("the first run copies each carried world in, and a run made again leaves them as they are", async () => {
    const first = await migrate(fixture.sources, { data, tree, now: () => new Date("2026-11-14T09:00:00.000Z") });
    expect(first.ran).toBe(true);
    const seeded = first.report.worldsInBuild;
    expect(seeded).toBeDefined();
    expect(seeded?.copied.length).toBeGreaterThan(0);
    expect(seeded?.replaced).toEqual([]);
    expect(seeded?.kept).toEqual([]);
    expect(worldsHeld().sort()).toEqual([...(seeded?.copied ?? [])].sort());

    const again = await migrate(fixture.sources, { data, tree, now: () => new Date("2026-11-14T10:00:00.000Z") });
    expect(again.ran).toBe(true);
    expect(again.report.worldsInBuild?.copied).toEqual([]);
    expect(again.report.worldsInBuild?.kept).toEqual([]);
    expect([...(again.report.worldsInBuild?.unchanged ?? []), ...(again.report.worldsInBuild?.replaced ?? [])].sort()).toEqual([...(seeded?.copied ?? [])].sort());
    expect(worldsHeld().sort()).toEqual([...(seeded?.copied ?? [])].sort());
  });

  test("a world changed in Build and on today's side since is kept as Build has it, and the printed report and the Migration page name it as waiting on the user", async () => {
    const draft = `worlds/${fixture.worldId}/draft.json`;
    // In RPE's Build: the draft edited, as Build's world store writes it.
    const db = new Database(join(data, "rpe.db"));
    try {
      const held = db.query<{ body: string }, [string, string]>("SELECT body FROM build_file WHERE user = ? AND path = ?").get(USER, draft)?.body ?? "";
      db.run("UPDATE build_file SET body = ? WHERE user = ? AND path = ?", [held.replace("Harbour, draft", "Harbour, touched in RPE"), USER, draft]);
    } finally {
      db.close();
    }
    // On today's side: the same draft edited too.
    const todays = join(fixture.userFolder, draft);
    await writeFile(todays, (await readFile(todays, "utf8")).replace("Harbour, draft", "Harbour, edited today"));

    const third = await migrate(fixture.sources, { data, tree, now: () => new Date("2026-11-14T11:00:00.000Z") });
    expect(third.ran).toBe(true);
    expect(third.report.worldsInBuild).toMatchObject({ kept: [fixture.worldId], newer: [fixture.worldId], names: { [fixture.worldId]: "Harbour, rebuilt" } });
    const text = reportText(third.report);
    expect(text).toContain(`  Harbour, rebuilt (${fixture.worldId}): changed or removed in RPE since a run put it there, so kept as RPE has it`);
    expect(text).toContain(`Waiting on you: the world Harbour, rebuilt (${fixture.worldId}) was changed in RPE's Build, and on today's side too, since a run put it into Build. Build keeps its own; today's newer files are in RPE's copy of today's worlds and in the backup, not in Build.`);
    const read = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      const page = migrationPage({ db: read, user: USER, identifier: IDENT });
      expect(page.waiting).toContainEqual({ kind: "world", world: fixture.worldId, name: "Harbour, rebuilt" });
      expect(page.text).toContain(`Waiting on you: the world Harbour, rebuilt (${fixture.worldId})`);
      expect(read.query<{ body: string }, [string, string]>("SELECT body FROM build_file WHERE user = ? AND path = ?").get(USER, draft)?.body).toContain("Harbour, touched in RPE");
    } finally {
      read.close();
    }
  });
});
