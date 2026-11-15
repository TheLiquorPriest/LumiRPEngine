// Several runtimes of today's build under one account, as on a server where two Lumiverse users, or
// one user on two Lumiverses, each run one: the real run takes the one this user registered with this
// Lumiverse, carries and backs up its connections, keys and files alone, and names in its report
// which it took and which it left alone. Another user's keys are in no file the run writes. Where the
// run can't tell which is the user's, it refuses before writing anything and says how to tell it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { walk } from "../../src/app/archive";
import { migrateCli } from "../../src/migrate/cli";
import { sha256 } from "../../src/migrate/files";
import { migrate } from "../../src/migrate/migrate";
import { addNeighbours, buildFixture, NEIGHBOUR_KEYS, RUNTIME, SECRETS, STRAY, treeSums, USER, type Fixture } from "./fixture";
import { TREE } from "./tree";

/** Every file under `root` holding `text`, by path. */
async function holding(root: string, text: string): Promise<string[]> {
  const out: string[] = [];
  for (const f of await walk(root)) if ((await readFile(join(root, f.path))).includes(text)) out.push(f.path);
  return out;
}

const todays = async (fixture: Fixture): Promise<Map<string, string>> => new Map([...(await treeSums(join(fixture.root, "lumiverse"))), ...(await treeSums(join(fixture.root, "home")))].filter(([path]) => !path.endsWith(".db-shm")));

describe("several runtimes under one account", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    await rm(join(fixture.userFolder, STRAY));
    await addNeighbours(fixture);
  });

  afterAll(async () => {
    await fixture.remove();
  });

  test("the run carries only the runtime this user registered with this Lumiverse, and no file it writes holds another's keys", async () => {
    const data = join(fixture.root, "rpe-data");
    const before = await todays(fixture);
    const { report, ran } = await migrate(fixture.sources, { data, env: fixture.named, tree: TREE });
    expect(report.refusals).toEqual([]);
    expect(ran).toBe(true);
    expect(report.runtime?.taken).toMatchObject({ name: RUNTIME, unit: "lumiah-home.service" });
    expect(report.runtime?.leftAlone.map((r) => r.name)).toEqual(["away", "neighbour"]);
    expect(report.items.filter((i) => i.where === "runtime" && /(neighbour|away)/.test(i.path))).toEqual([]);
    expect(report.carried?.connections).toMatchObject({ runtime: RUNTIME, connections: ["conn-1"] });
    // This user's key is carried and backed up; the others' keys, sign-ins and secrets are nowhere in what the run wrote.
    expect((await holding(data, SECRETS.key)).length).toBeGreaterThanOrEqual(2);
    for (const text of [NEIGHBOUR_KEYS.neighbour, NEIGHBOUR_KEYS.away, "neighbour relay secret", "neighbour-session-token", "away relay secret", "away-session-token"]) expect({ text, files: await holding(data, text) }).toEqual({ text, files: [] });
    expect(await todays(fixture)).toEqual(before);
  });

  test("with two registered for this user, `rpe migrate` refuses before writing and says how to tell it; named, it takes that one", async () => {
    const registry = join(fixture.userFolder, "harness", "registry.json");
    const original = await readFile(registry, "utf8");
    const doc = JSON.parse(original) as { relays: Record<string, unknown> };
    doc.relays["relay-away"] = { id: "relay-away", name: "away", secret: sha256("away relay secret"), listen: "127.0.0.1", port: 7871 };
    await writeFile(registry, JSON.stringify(doc));
    try {
      const out: string[] = [];
      const io = { out: (t: string) => out.push(t), err: (t: string) => out.push(t), env: {}, home: fixture.root };
      const data = join(fixture.root, "told");
      const line = ["--lumiverse", fixture.sources.lumiverse, "--user", USER, "--runtime-config", fixture.sources.runtime?.configDir ?? "", "--runtime-data", fixture.sources.runtime?.dataDir ?? "", "--data", data];
      expect(await migrateCli(line, io, TREE)).toBe(1);
      expect(out.join("")).toContain(`Several runtimes of today's build are registered with this Lumiverse for this user (away, ${RUNTIME}): say which one this run takes with --runtime <name>.`);
      expect(existsSync(data)).toBe(false);
      out.length = 0;
      expect(await migrateCli([...line, "--rehearse", "--runtime", RUNTIME], io, TREE)).toBe(0);
      expect(out.join("")).toContain(`Today's runtime: took ${RUNTIME}, named with --runtime, and registered with this Lumiverse for this user.`);
      expect(await migrateCli([...line, "--runtime", RUNTIME, "--no-runtime"], io, TREE)).toBe(2);
    } finally {
      await writeFile(registry, original);
    }
  });

  test("named with --runtime, a runtime this user's storage holds no registration of is not taken, though it signs in as their name: the run refuses before writing", async () => {
    const out: string[] = [];
    const io = { out: (t: string) => out.push(t), err: (t: string) => out.push(t), env: {}, home: fixture.root };
    const data = join(fixture.root, "named-away");
    const before = await todays(fixture);
    // `away` is this user's name on another Lumiverse: its keys are not this Lumiverse's user's.
    expect(await migrateCli(["--lumiverse", fixture.sources.lumiverse, "--user", USER, "--runtime-config", fixture.sources.runtime?.configDir ?? "", "--runtime-data", fixture.sources.runtime?.dataDir ?? "", "--data", data, "--runtime", "away"], io, TREE)).toBe(1);
    expect(out.join("")).toContain("The runtime away signs in as this user's name, but is not registered with this Lumiverse for this user (another Lumiverse's runtime, or one whose registration was replaced), so its connections and keys may be another's: this run doesn't take it.");
    expect(existsSync(data)).toBe(false);
    expect(await todays(fixture)).toEqual(before);
  });
});
