// A real run fills Build's own table with the worlds it carried (plan §15.2, "Worlds"; `src/build/seed.ts`):
// the first run copies each world in, a run made again with nothing changed leaves them as they are,
// and the report says which.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "../../src/migrate/migrate";
import { buildFixture, STRAY, USER, type Fixture } from "./fixture";
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
});
