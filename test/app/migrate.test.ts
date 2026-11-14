// `rpe migrate` runs the migration's own command line: a rehearsal writes nothing, neither to today's
// data nor to RPE's data folder; the real run, given no --data, carries the data into RPE's own
// folder ($RPE_DATA here, as every command finds it); and a real run is refused while RPE answers at
// the address that folder's config gives it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runCli } from "../../src/app/cli";
import { buildFixture, STRAY, treeSums, USER, type Fixture } from "../migrate/fixture";
import { cliIo, freePort } from "./helpers";

/** Today's data, in all its places: Lumiverse's data folder and the runtime's folders (Lumiverse's lock index left out: SQLite rewrites it on any open). */
async function todays(fixture: Fixture): Promise<Map<string, string>> {
  const sums = new Map<string, string>();
  for (const place of ["lumiverse", "home"]) for (const [path, sum] of await treeSums(join(fixture.root, place))) if (!path.endsWith(".db-shm")) sums.set(`${place}/${path}`, sum);
  return sums;
}

describe("rpe migrate", () => {
  let fixture: Fixture;
  let data: string;
  /** Where today's data is, as the line names it. */
  let today: string[];
  /** Where RPE answers, as its config gives it ($RPE_PORT here): nothing listens there unless a test says so. */
  let port: number;

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    await rm(join(fixture.userFolder, STRAY));
    data = join(fixture.root, "rpe-data");
    today = ["--lumiverse", fixture.sources.lumiverse, "--user", USER, "--runtime-config", fixture.sources.runtime?.configDir ?? "", "--runtime-data", fixture.sources.runtime?.dataDir ?? ""];
    port = freePort();
  });

  afterAll(async () => {
    await fixture.remove();
  });

  async function rpe(argv: string[]): Promise<{ code: number; out: string; err: string }> {
    const io = { ...cliIo(), env: { RPE_DATA: data, RPE_PORT: String(port) } };
    const code = await runCli(argv, io, { version: "1.0.0" });
    return { code, out: io.outs.join("\n"), err: io.errs.join("\n") };
  }

  test("--rehearse prints the report and writes nothing anywhere", async () => {
    const before = await todays(fixture);
    const { code, out } = await rpe(["migrate", "--rehearse", ...today]);
    expect(code).toBe(0);
    expect(out).toContain("Migration rehearsal");
    expect(existsSync(data)).toBe(false);
    expect(await todays(fixture)).toEqual(before);
  });

  test("a real run is refused while RPE answers at the address its data folder's config gives it, before anything is read or written; the rehearsal still runs", async () => {
    const running = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => Response.json({ name: "rpe", version: "1.0.0", started: 1, belongsToUser: true }) });
    try {
      const before = await todays(fixture);
      const refused = await rpe(["migrate", ...today]);
      expect(refused.code).toBe(1);
      expect(refused.err).toContain(`RPE is running at http://127.0.0.1:${port}, the address this data folder's config gives it: stop it (rpe serve), then run rpe migrate again. Nothing was read or changed.`);
      expect(existsSync(data)).toBe(false);
      expect(await todays(fixture)).toEqual(before);
      expect((await rpe(["migrate", "--rehearse", ...today])).code).toBe(0);
    } finally {
      await running.stop(true);
    }
  });

  test("the real run writes into RPE's data folder, the one every command finds when --data is not given", async () => {
    const { code, out } = await rpe(["migrate", ...today]);
    expect(code).toBe(0);
    expect(out).toContain("Migration real run");
    expect(existsSync(join(data, "rpe.db"))).toBe(true);
  });

  test("a line the migration does not understand is refused as misused, with its usage", async () => {
    const { code, err } = await rpe(["migrate", "--lumiverse"]);
    expect(code).toBe(2);
    expect(err).toContain("--rehearse");
  });
});
