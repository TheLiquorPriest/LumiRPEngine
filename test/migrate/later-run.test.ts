// A later run over today's data changed since the last (STANDALONE-PLAN §15.3: a run "replaces what an
// earlier run imported with what today's side holds now"): what an earlier run wrote into the file
// tree and today's side no longer has is gone, unless it was changed in RPE since; a version folder
// numbered by a message today's side deleted is gone with it; each pin is as the chat shows it now;
// and a carried connection, the default and a carried setting take today's changes only while RPE's
// copy is still what a run put there.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConnectionsDoc, StoredConnection } from "rp-harness/contract";
import { dataPaths } from "../../src/app/config";
import { modelsPort } from "../../src/app/connections";
import { SecretsFile } from "../../src/app/secrets";
import { withTopLevelKey } from "../../src/app/yaml";
import { charactersOf, chatLine } from "../../src/cast/record";
import { migrate } from "../../src/migrate/migrate";
import { reportText, type MigrationReport } from "../../src/migrate/report";
import type { Rec } from "../../src/shared/ledger";
import { AREAS, buildFixture, CHAT, PEOPLE, RUNTIME, SECRETS, STRAY, USER, type Fixture } from "./fixture";
import { look, notesOf, versionsOf } from "./look";
import { deleteMessage, editRecord, putArea, showSwipe } from "./today-edits";
import { TREE as tree } from "./tree";

/** Each of the harness chat's characters' pinned casting, by name. */
const pins = (data: string): Record<string, string | null> => look(data, (db, s) => Object.fromEntries(charactersOf(db, USER, chatLine(s, CHAT.harness)).map((c) => [c.name, c.pinned])));

/** A swipe's castings as `cast` says them, the rest of its story as it was. */
const casting = (cast: NonNullable<NonNullable<Rec["story"]>["cast"]>) => (rec: Rec): Rec => ({ ...rec, story: { ...rec.story, cast } });

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
  const run = await migrate(fixture.sources, { data, env: fixture.named, tree, now: () => new Date(`2026-11-14T${String(hour).padStart(2, "0")}:00:00.000Z`) });
  expect(run.ran).toBe(true);
  return run.report;
}

describe("a later run over today's data changed since", () => {
  test("what an earlier run wrote into the file tree and today's side no longer has is removed, unless it was changed in RPE since; a version folder of a deleted message goes with it", async () => {
    await withFixture(async (fixture, data) => {
      await migrated(fixture, data, 9);
      const imported = join(dataPaths(data).files, "imported");
      // In RPE: the player rewrote the imported skill.
      await writeFile(join(imported, "skills/tide-tables/SKILL.md"), "My own tide tables.");
      // On today's side since: the user deleted their agent and their skill, and the last reply's area no longer holds prepare.md.
      const settings = join(fixture.userFolder, "harness/settings.json");
      const lumiah = JSON.parse(await readFile(settings, "utf8")) as { definitions: { agents: Record<string, unknown>; skills: Record<string, unknown> } };
      lumiah.definitions = { agents: {}, skills: {} };
      await writeFile(settings, JSON.stringify(lumiah));
      const { "author/prepare.md": _prepare, ...dark } = AREAS["gen-3"];
      await putArea(fixture, CHAT.harness, "gen-3", dark, 4);

      const second = await migrated(fixture, data, 10);
      expect(existsSync(join(imported, "agents/scout.md"))).toBe(false);
      expect(existsSync(join(imported, "agents/scout.original.json"))).toBe(false);
      expect(existsSync(join(imported, "skills/tide-tables/original.json"))).toBe(false);
      expect(await readFile(join(imported, "skills/tide-tables/SKILL.md"), "utf8")).toBe("My own tide tables.");
      const notes = await notesOf(data, CHAT.harness);
      expect(notes?.has("author/prepare.md")).toBe(false);
      // The first reply's version still holds it: its turn wrote it.
      expect(versionsOf(data, CHAT.harness).find((v) => v.path === "author/prepare.md")).toMatchObject({ before: null, after: AREAS["gen-1"]["author/prepare.md"] });
      expect(second.carried?.ownFiles).toMatchObject({ removed: 4, changed: 1 });

      // Then the player deleted the message before the last reply: every later version folder is numbered anew, and the old numbers go.
      deleteMessage(fixture, "m-h5");
      await migrated(fixture, data, 11);
      expect(versionsOf(data, CHAT.harness).filter((v) => v.path === "notebook.md").map((v) => v.after)).toContain(AREAS["gen-2"]["notebook.md"]);
      // None is left on a turn of the earlier import.
      expect(look(data, (db) => db.query<{ n: number }, []>("SELECT count(*) AS n FROM note_version v WHERE json_extract(v.agent, '$.id') = 'carried' AND NOT EXISTS (SELECT 1 FROM turn t WHERE t.id = v.turn)").get()?.n)).toBe(0);
    });
  });

  test("a later run sets each pin as the chat shows it now: taken away where the player unpinned the person, or where the pinned casting is on a swipe the chat no longer shows", async () => {
    await withFixture(async (fixture, data) => {
      await migrated(fixture, data, 9);
      expect(pins(data)).toEqual({ [PEOPLE.ada.name]: "principal", [PEOPLE.bo.name]: null });
      // On today's side since: the player unpinned Ada on the first reply, and pinned her as supporting on the swipe of the last reply the chat doesn't show.
      editRecord(fixture, "m-h2", 0, casting([{ entity: PEOPLE.ada.entity, standing: "principal" }]));
      editRecord(fixture, "m-h6", 0, casting([{ entity: PEOPLE.bo.entity, standing: "supporting", why: "He keeps the ferry." }, { entity: PEOPLE.ada.entity, standing: "supporting", pinned: true }]));
      expect((await migrated(fixture, data, 10)).carried?.story.pinned).toBe(0);
      expect(pins(data)).toEqual({ [PEOPLE.ada.name]: null, [PEOPLE.bo.name]: null });
      // The player shows that swipe again: its pin is the one the chat shows.
      showSwipe(fixture, "m-h6", 0);
      await migrated(fixture, data, 11);
      expect(pins(data)).toEqual({ [PEOPLE.ada.name]: "supporting", [PEOPLE.bo.name]: null });
    });
  });

  test("a carried connection, the default and a carried setting take today's changes while RPE's copy is what a run put there, and are kept, and said so, once the user changed them in RPE", async () => {
    await withFixture(async (fixture, data) => {
      const paths = dataPaths(data);
      const port = modelsPort(paths, new SecretsFile(paths.secrets), () => USER);
      const conn = async (): Promise<StoredConnection | undefined> => ((await port.loadConnections({ user: USER })) as ConnectionsDoc).connections.find((c) => c.id === "conn-1");
      const todaysBook = join(fixture.sources.runtime?.dataDir ?? "", "runtimes", RUNTIME, "connections.json");
      const changeToday = async (change: (c: Record<string, unknown>) => void): Promise<void> => {
        const book = JSON.parse(await readFile(todaysBook, "utf8")) as { connections: Record<string, unknown>[] };
        change(book.connections[0] ?? {});
        await writeFile(todaysBook, JSON.stringify(book));
      };
      await migrated(fixture, data, 9);

      // On today's side since: the connection's model. RPE's copy is still the first run's: today's is taken.
      await changeToday((c) => (c.model = "deepseek-reasoner"));
      const second = await migrated(fixture, data, 10);
      expect((await conn())?.model).toBe("deepseek-reasoner");
      expect(second.carried?.connections).toMatchObject({ connections: ["conn-1"], changedInRpe: [], default: "conn-1", defaultKept: false });

      // In RPE: the model's limits and the retries entered on the connection, a connection of the user's own made the default, and hidden messages kept from agents.
      const ours: StoredConnection = { ...((await conn()) as StoredConnection), limits: { "deepseek-reasoner": { contextWindow: 128000, maxTokens: 8192 } }, retries: 5 };
      await port.saveConnections({ user: USER }, { v: 1, default: "conn-own", connections: [{ id: "conn-own", name: "Mine", provider: "anthropic", auth: "signin" }, ours] });
      await writeFile(paths.globalConfig, withTopLevelKey(await readFile(paths.globalConfig, "utf8"), "chat", { hiddenReadable: false }, paths.globalConfig));
      // On today's side since: the connection renamed.
      await changeToday((c) => (c.name = "Main, renamed today"));
      const third = await migrated(fixture, data, 11);

      expect(await conn()).toEqual(ours);
      expect(await port.loadConnections({ user: USER })).toMatchObject({ default: "conn-own" });
      expect(Bun.YAML.parse(await readFile(paths.globalConfig, "utf8"))).toMatchObject({ history: { hiddenReadable: false } });
      expect(third.carried?.connections).toMatchObject({ connections: [], changedInRpe: ["conn-1"], default: "conn-own", defaultKept: true });
      expect(third.carried?.settings.keptInRpe).toEqual([{ from: "harness/settings.json: core.story.hidden", to: "RPE-global.yml: history.hiddenReadable" }]);
      const text = reportText(third);
      expect(text).toContain("the default conn-own (chosen in RPE: kept over the previous build's)");
      expect(text).toContain("Connections changed or removed in RPE since a run carried them, left as RPE has them (the previous build's copy not taken): conn-1.");
      expect(text).toContain("  RPE-global.yml: history.hiddenReadable (the previous build's harness/settings.json: core.story.hidden)");
      // Its key, which RPE held as today's had it, stays.
      expect(await port.loadSecrets({ user: USER })).toMatchObject({ keys: { "conn-1": SECRETS.key } });
    });
  });

  test("what today's side reset, removed or rotated since is followed where RPE's copy is still a run's, and named", async () => {
    await withFixture(async (fixture, data) => {
      const paths = dataPaths(data);
      const port = modelsPort(paths, new SecretsFile(paths.secrets), () => USER);
      const book = join(fixture.sources.runtime?.dataDir ?? "", "runtimes", RUNTIME);
      const hidden = async (): Promise<unknown> => (Bun.YAML.parse(await readFile(paths.globalConfig, "utf8")) as { chat?: { hiddenReadable?: boolean } }).chat?.hiddenReadable;
      await migrated(fixture, data, 9);
      expect(await hidden()).toBe(true);

      // On today's side since: the hidden-messages setting reset, and the connection's key rotated.
      const settings = join(fixture.userFolder, "harness/settings.json");
      const lumiah = JSON.parse(await readFile(settings, "utf8")) as { own: { path: string[] }[] };
      lumiah.own = lumiah.own.filter((p) => p.path.join(".") !== "core.story.hidden");
      await writeFile(settings, JSON.stringify(lumiah));
      const secrets = JSON.parse(await readFile(join(book, "secrets.json"), "utf8")) as { keys: Record<string, string> };
      secrets.keys["conn-1"] = "sk-invented-rotated-0123456789";
      await writeFile(join(book, "secrets.json"), JSON.stringify(secrets));
      const second = await migrated(fixture, data, 10);
      expect(await hidden()).toBeUndefined();
      expect(await port.loadSecrets({ user: USER })).toMatchObject({ keys: { "conn-1": "sk-invented-rotated-0123456789" } });
      expect(second.carried?.settings.followed).toEqual([{ what: "RPE-global.yml: history.hiddenReadable", change: "reset or removed on the previous build's side since an earlier run", followed: true }]);
      expect(second.carried?.connections).toMatchObject({ followed: [{ what: "the key of connection conn-1", followed: true }] });

      // The connection removed on today's side since: RPE's copy, still the run's, goes with its key.
      const connections = JSON.parse(await readFile(join(book, "connections.json"), "utf8")) as { connections: unknown[]; default?: string };
      connections.connections = [];
      delete connections.default;
      await writeFile(join(book, "connections.json"), JSON.stringify(connections));
      const third = await migrated(fixture, data, 11);
      expect(((await port.loadConnections({ user: USER })) as ConnectionsDoc).connections.map((c) => c.id)).toEqual([]);
      expect(await port.loadSecrets({ user: USER })).toMatchObject({ keys: {} });
      expect(third.carried?.connections).toMatchObject({ followed: [{ what: "connection conn-1", followed: true }] });
      expect(reportText(third)).toContain("  connection conn-1: removed on the previous build's side since an earlier run; followed in RPE");
    });
  });
});
