// The golden copy's last row and every restore of it (PlanScenarios-3 item 8): `restoreGolden` refuses a copy whose record lists a row as waiting for the live driver, one that
// did not pass, one with no record, and one whose restored instance does not read back as the kept checksum; and the driver's browser preferences are recorded under
// `browser:prefs`, which the instance's report reads as its browser row.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { goldenRecord, GoldenRefused, panelPreferences, readGoldenEnv, recordBrowserPreferences, restoreGolden } from "../../../scripts/proof/live/golden";
import { commandShell } from "../../../scripts/proof/live/terminal";
import { RunLog } from "../../../scripts/testbed/lib/record";
import type { Ctx } from "../../../scripts/testbed/lib/context";
import { ROWS } from "../../../scripts/testbed/lib/instance/rows";

const SUM = "a".repeat(64);
let dir: string;
const shell = commandShell(["bash", "-c"]);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rpe-golden-"));
  // The read-back command a restored instance is asked: exit 0 only when the checksum given is the one the instance's report holds.
  const report = join(dir, "report.sh");
  writeFileSync(report, `#!/bin/bash\n[ "$1" = "$(cat ${dir}/instance.sha)" ] || { echo "the instance reads back $(cat ${dir}/instance.sha)"; exit 1; }\n`);
  chmodSync(report, 0o755);
});

afterAll(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

/** A golden copy `name` with a record beside it (none when `record` is null), restored by touching a marker, and an instance that reads back `instance`. */
function copy(name: string, record: object | null, instance: string) {
  const archive = join(dir, `${name}.tar.zst`);
  if (record !== null) writeFileSync(`${archive}.record.json`, JSON.stringify(record));
  writeFileSync(join(dir, "instance.sha"), instance);
  rmSync(join(dir, `${name}.restored`), { force: true });
  return { env: { copy: archive, restore: `touch ${join(dir, `${name}.restored`)}`, report: join(dir, "report.sh") }, restored: () => existsSync(join(dir, `${name}.restored`)) };
}

test("a copy whose record still lists a row waiting for the live driver is refused before anything is restored", async () => {
  const waiting = copy("waiting", { checksum: SUM, waiting: ["browser"], passes: true }, SUM);
  await expect(restoreGolden(shell, waiting.env)).rejects.toThrow("browser as waiting for the live driver");
  expect(waiting.restored()).toBe(false);
  const failed = copy("failed", { checksum: SUM, waiting: [], passes: false }, SUM);
  await expect(restoreGolden(shell, failed.env)).rejects.toThrow(GoldenRefused);
  expect(failed.restored()).toBe(false);
  const bare = copy("bare", null, SUM);
  await expect(restoreGolden(shell, bare.env)).rejects.toThrow("has no record beside it");
  expect(bare.restored()).toBe(false);
});

test("a restore that does not read back as the kept checksum is refused, naming it; the retaken copy restores and reads back", async () => {
  const other = copy("other", { checksum: SUM, waiting: [], passes: true }, "b".repeat(64));
  await expect(restoreGolden(shell, other.env)).rejects.toThrow(`does not read back as the kept checksum ${SUM.slice(0, 12)}`);
  expect(other.restored()).toBe(true);

  const retaken = copy("retaken", { checksum: SUM, waiting: [], passes: true }, SUM);
  expect(await restoreGolden(shell, retaken.env)).toEqual({ checksum: SUM, waiting: [], passes: true });
  expect(retaken.restored()).toBe(true);

  const broken = copy("broken", { checksum: SUM, waiting: [], passes: true }, SUM);
  await expect(restoreGolden(shell, { ...broken.env, restore: "exit 4" })).rejects.toThrow("restoring the golden copy failed (exit 4)");
});

test("a record is read as the report writes it, and any other shape is no record", () => {
  expect(goldenRecord(JSON.stringify({ checksum: SUM, waiting: [], passes: true }))).toEqual({ checksum: SUM, waiting: [], passes: true });
  for (const bad of ["{", "[]", JSON.stringify({ checksum: "short", waiting: [], passes: true }), JSON.stringify({ checksum: SUM, waiting: "browser", passes: true }), JSON.stringify({ checksum: SUM, waiting: [], passes: "yes" })]) expect(() => goldenRecord(bad)).toThrow(GoldenRefused);
  expect(() => readGoldenEnv({})).toThrow("set LRE_GOLDEN_COPY");
  expect(readGoldenEnv({ LRE_GOLDEN_COPY: "a", LRE_GOLDEN_RESTORE: "b", LRE_GOLDEN_REPORT: "c" })).toEqual({ copy: "a", restore: "b", report: "c" });
});

test("the driver's browser preferences are set, read back from the page, and recorded under browser:prefs, where the instance's report reads them as its browser row", async () => {
  const storage = new Map<string, string>();
  // A page's storage as the browser answers the two expressions the step sends it.
  const page = {
    async evaluate<T>(expression: string): Promise<T> {
      const set = /^localStorage\.setItem\((".*?"), (".*")\)$/.exec(expression);
      if (set !== null) {
        storage.set(JSON.parse(set[1] ?? '""') as string, JSON.parse(set[2] ?? '""') as string);
        return undefined as T;
      }
      const get = /^localStorage\.getItem\((".*")\)$/.exec(expression);
      return (storage.get(JSON.parse(get?.[1] ?? '""') as string) ?? null) as T;
    },
  };
  const instance = mkdtempSync(join(dir, "instance-"));
  const log = new RunLog(instance);
  const chat = crypto.randomUUID();
  const prefs = panelPreferences(chat, "world-1");
  const held = await recordBrowserPreferences(page, log, prefs);
  expect(held.map((p) => p.key)).toEqual(["lre:ui:show-ids", `lre:prepare-live:${chat}`, `lre:things:recent:${chat}`, "lumi_ah.prefs"]);
  expect(storage.get("lre:ui:show-ids")).toBe("true");
  // A second reader of the record sees the same keys, as the report does after a restore.
  const row = ROWS.find((r) => r.id === "browser");
  // The browser row reads only the instance's record of what the driver set (`ctx.log`); the rest of a read-back's context is not touched by it.
  const ctx = { log: new RunLog(instance) } as unknown as Ctx;
  const read = await row?.read(ctx, {} as never);
  expect(read?.found).toBe(4);
  expect(read?.facts).toEqual(["lre:prepare-live:<chat>", "lre:things:recent:<chat>", "lre:ui:show-ids", "lumi_ah.prefs"].sort());

  // A page that does not hold what was set stops the step, naming the key.
  const forgetful = { evaluate: async <T>(expression: string): Promise<T> => (expression.startsWith("localStorage.getItem") ? (null as T) : (undefined as T)) };
  await expect(recordBrowserPreferences(forgetful, new RunLog(mkdtempSync(join(dir, "instance-"))), prefs)).rejects.toThrow("does not hold the preference lre:ui:show-ids");
});
