// What the real run carries besides the chats: every world file byte for byte into RPE's database,
// read back by today's own world store as the same documents today's build gives; the connections
// and their keys into RPH's two documents through the models port, the keys nowhere else; today's
// settings into RPE's config where RPE has a setting of the same meaning, the rest listed by name,
// and the settings that name a connection living in Lumiverse listed for the user; the user's own
// files into the user's level of the file tree, switched off, and each chat's notes into that chat's
// own notes folder, which no other chat's agents read. And a second run carries a world edited and a
// setting changed since the first.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { walk } from "../../src/app/archive";
import { dataPaths } from "../../src/app/config";
import { modelsPort } from "../../src/app/connections";
import { SecretsFile } from "../../src/app/secrets";
import { createRegistry } from "../../src/engine/registry-impl";
import { migrate } from "../../src/migrate/migrate";
import { reportText, type MigrationReport } from "../../src/migrate/report";
import { blobHash } from "../../src/shared/stores";
import { openToday } from "../../src/migrate/today";
import { carriedWorlds } from "../../src/migrate/worlds";
import { ALL_PACKS } from "../../src/packs/index";
import type { UserId, WorldId } from "../../src/shared/ids";
import { openStore, storedWorlds } from "../../src/store";
import { NOTES_FOLDER, TreeChats } from "../../src/tree";
import { buildFixture, CHARACTER, CHAT, SECRETS, STRAY, USER, type Fixture } from "./fixture";
import { readable, TREE as tree } from "./tree";

const registry = createRegistry(ALL_PACKS);
const user = USER as UserId;

/** A definition file's header and body. */
function headed(text: string): { header: unknown; body: string } {
  const [, header = "", body = ""] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text) ?? [];
  return { header: Bun.YAML.parse(header), body };
}

describe("what the real run carries besides the chats", () => {
  let fixture: Fixture;
  let data: string;
  let report: MigrationReport;

  /** RPE's copy of the worlds and today's, each read by today's world store: the same answers to every read. */
  async function sameWorlds(): Promise<void> {
    const today = await openToday(fixture.sources);
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      const ours = carriedWorlds(db, USER, registry);
      const theirs = today.reader.worldStore;
      expect(await ours.list(user)).toEqual(await theirs.list(user));
      const world = fixture.worldId as WorldId;
      const index = await theirs.index(world, user);
      expect(index?.revisions.length).toBeGreaterThan(1);
      expect(await ours.index(world, user)).toEqual(index);
      expect(await ours.history(world, user)).toEqual(await theirs.history(world, user));
      for (const revision of index?.revisions ?? []) expect((await ours.get(world, user, revision)).world).toEqual((await theirs.get(world, user, revision)).world);
      expect(await ours.working(world, user)).toEqual(await theirs.working(world, user));
      // Byte for byte: every world file today's build keeps, and nothing else.
      const disk = new Map<string, string>();
      for (const f of await walk(join(fixture.userFolder, "worlds"))) disk.set(`worlds/${f.path}`, await readFile(join(fixture.userFolder, "worlds", f.path), "utf8"));
      const kept = db.query<{ world: string; file: string; bytes: Uint8Array }, [string]>("SELECT world, file, bytes FROM world_file WHERE user = ?").all(USER);
      expect(new Map(kept.map((r) => [`worlds/${r.world}/${r.file}`, new TextDecoder().decode(r.bytes)]))).toEqual(disk);
    } finally {
      db.close();
      today.close();
    }
  }

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    await rm(join(fixture.userFolder, STRAY));
    data = join(fixture.root, "rpe-data");
    const first = await migrate(fixture.sources, { data, env: fixture.named, tree, now: () => new Date("2026-11-14T09:00:00.000Z") });
    expect(first.ran).toBe(true);
    report = first.report;
  });

  afterAll(async () => {
    await fixture.remove();
  });

  test("every world, revision, draft and history note is in RPE byte for byte, and RPE gives the same world documents today's build gives, pins and all", async () => {
    await sameWorlds();
    expect(report.carried?.worlds).toMatchObject({ worlds: 1, revisions: 2, drafts: 1, histories: 1 });
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      const head = await carriedWorlds(db, USER, registry).get(fixture.worldId as WorldId, user);
      expect(head.world.lorePins).toEqual({ characters: { "e-ada": [{ lore: "lore-harbour" }] }, places: {}, steps: {} });
    } finally {
      db.close();
    }
  });

  test("RPE's store keeps every world revision the run carried, so a migrated chat's world revision is found by the store's own resolver", async () => {
    expect(report.worldsInStore).toEqual({ added: 2, held: 0, unreadable: 0, copied: [fixture.worldId], followed: [], kept: [], removed: [] });
    const db = new Database(join(data, "rpe.db"));
    try {
      const revision = openStore({ db, registry, worlds: () => undefined }).user(USER).chat(CHAT.classic)?.revision ?? null;
      expect(revision).toBe(fixture.revisions[0] ?? "");
      if (revision === null) return;
      const doc = storedWorlds(db)(revision);
      expect(doc?.id).toBe(fixture.worldId);
      // Read as today's world store reads that revision: the same document.
      const today = await openToday(fixture.sources);
      try {
        expect(doc).toEqual((await today.reader.worldStore.get(fixture.worldId as WorldId, user, revision)).world);
      } finally {
        today.close();
      }
    } finally {
      db.close();
    }
  });

  test("the connections and their keys reach RPH's two documents through the models port, and no key is written anywhere else", async () => {
    const paths = dataPaths(data);
    const port = modelsPort(paths, new SecretsFile(paths.secrets), () => USER);
    expect(await port.loadConnections({ user: USER })).toEqual({ v: 1, default: "conn-1", connections: [{ id: "conn-1", name: "Main", provider: "deepseek", auth: "key", model: "deepseek-chat", effort: "high", headers: ["X-Team", "X-Gone"], serialTools: true }] });
    // Beside the key and the header's value, the place they were given for, in the model layer's own form (key-places.test.ts plays it through a start).
    expect(await port.loadSecrets({ user: USER })).toEqual({ v: 1, keys: { "conn-1": SECRETS.key }, signins: { anthropic: { type: "oauth", access: SECRETS.access, refresh: SECRETS.refresh, expires: 1 } }, headers: { "conn-1": { "X-Team": SECRETS.header } }, places: { "conn-1": expect.any(String) }, device: "device-0001" });
    expect(report.carried?.connections).toEqual({ runtime: "home", connections: ["conn-1"], leftOut: 1, keys: 1, signins: 1, headerValues: 1, kept: 0, default: "conn-1", changedInRpe: [], defaultKept: false });
    // The backup is today's data as it was, kept by its owner alone; outside it and the secrets file, no secret is anywhere in RPE's data folder.
    const holding: string[] = [];
    for (const f of await walk(data)) {
      if (f.path === "secrets.json" || f.path.startsWith("backups/")) continue;
      const text = new TextDecoder().decode(await readFile(join(data, f.path)));
      if (Object.values(SECRETS).some((secret) => text.includes(secret))) holding.push(f.path);
    }
    expect(holding).toEqual([]);
  });

  test("a setting with one of the same meaning in RPE is in RPE-global.yml; the rest are listed by name, and those naming a Lumiverse connection are listed for the user", async () => {
    const config = Bun.YAML.parse(await readFile(dataPaths(data).globalConfig, "utf8")) as Record<string, unknown>;
    // Today's history cutoff becomes the history window, with the number it keeps now; the runtime's update choice is RPE's own.
    expect({ history: config.history, update: config.update, service: config.service }).toEqual({ history: { hiddenReadable: true, window: 30 }, update: { restart: true }, service: { memory: "1G" } });
    const settings = report.carried?.settings;
    expect(settings?.carried.map((s) => s.from).sort()).toEqual(["harness/settings.json: core.story.hidden", "harness/settings.json: transport.connections.oneToolAtATime", "harness/settings.json: transport.history.count", "harness/settings.json: transport.history.keep", "runtime home: autoUpdate", "runtime home: memory"]);
    expect(settings?.lumiverseConnections).toEqual([
      { setting: "settings.json: helper.connectionId", connection: "conn-helper" },
      { setting: "settings.json: agents.main.connectionId", connection: "conn-main" },
      { setting: "settings.json: story.models.standing.connectionId", connection: "conn-story" },
    ]);
    expect(settings?.noHome).toEqual(expect.arrayContaining(["settings.json: prompts", "harness/settings.json: core.agents.main.effort", "harness/story.json: jobs"]));
    expect(settings?.archived?.map((s) => s.from)).toContain("settings.json: helper");
    const text = reportText(report);
    expect(text).toContain("settings.json: story.models.standing.connectionId (connection conn-story");
    expect(text).not.toContain(SECRETS.key);
  });

  test("the user's own files are at the user's level of the file tree under imported/, switched off, in the folders the tree's layout gives", async () => {
    const files = dataPaths(data).files;
    const at = (path: string): Promise<string> => readFile(join(files, "imported", path), "utf8");
    expect(headed(await at("agents/scout.md"))).toEqual({ header: { name: "scout", description: "Walks ahead and says what is there.", model: "default", effort: "high", tools_as: "text", tools: ["lore_search", "chat_read"], limits: { toolRounds: 8, time: 90 } }, body: "Walk ahead of the party and report what you see.\n" });
    expect(JSON.parse(await at("agents/scout.original.json"))).toMatchObject({ id: "scout", given: "task" });
    expect(headed(await at("skills/tide-tables/SKILL.md"))).toEqual({ header: { name: "tide-tables", description: "When the pier floods." }, body: "Read the harbour's tide table before any walk on the pier.\n" });
    // The engine's text whose id no build had is set apart under its reason; LumiAH's is attached as it is, under its own name.
    expect([await at(".prompts/set-apart/unknown-id/classic.narrator.md"), await at(".prompts/lumiah/lumiah.writer.md")]).toEqual(["Be terse.", "Write short."]);
    // The prompt set today's turns recorded, word for word, by the hash its turns name it by; and its row has nothing in the backup only.
    expect(await at(`prompt-sets/${blobHash("set")}.json`)).toBe(await readFile(join(fixture.userFolder, `prompts/sets/${blobHash("set")}.json`), "utf8"));
    expect(report.rows.find((r) => r.row === "texts")?.count).toMatchObject({ found: 1, attached: 1, backup: 0 });
    expect([await at("GUIDANCE.md"), await readFile(join(files, NOTES_FOLDER, "style.md"), "utf8")]).toEqual(["Keep the fog grey.", "Short lines."]);
    // Nothing of any chat is at the user's level, which every chat's agents read.
    expect(existsSync(join(files, "imported", "chats"))).toBe(false);
    expect((await readdir(files)).sort()).toEqual(["RPE-global.yml", "chats", "imported", NOTES_FOLDER]);
    expect(reportText(report)).toContain("Waiting on you: your GUIDANCE.md");
  });

  test("each chat's notes and learned files are in that chat's own notes folder, which only its own agents read", async () => {
    const files = dataPaths(data).files;
    const texts = ["Ada distrusts the guard. The fog came.", "Next: the lighthouse.", "The pier floods at high tide."];
    const holding = (read: Map<string, string>): string[] => [...read].filter(([, t]) => texts.some((n) => t.includes(n))).map(([p]) => p);
    // What every chat's agents read above their own levels holds none of them.
    expect(holding(await readable({ files, character: null, chat: null }))).toEqual([]);
    const db = new Database(join(data, "rpe.db"));
    try {
      const chats = new TreeChats(db, { run: async (write) => write(db) }, files);
      const own = chats.folders(USER, CHAT.harness);
      if (own === null) throw new Error("the harness chat has no folders");
      // Another chat with the same character, one the run did not place, placed as RPE places it the first time it plays it: none of them either.
      const sibling = await chats.place(USER, "chat-sibling", { character: CHARACTER, chat: { name: "Harbour (sibling)" } });
      expect(sibling.character).toBe(own.character);
      expect(holding(await readable({ files, ...sibling }))).toEqual([]);
      // The chat's own agents read them in its notes folder: the area at its latest turn, the characters' mind files left to their own row; and its learned/.
      const mine = await readable({ files, ...own });
      const notes = NOTES_FOLDER;
      expect([`${notes}/notebook.md`, `${notes}/author/prepare.md`, `${notes}/learned/notes.md`].map((p) => mine.get(p))).toEqual(texts);
      expect([...mine.keys()].filter((p) => p.includes("minds/"))).toEqual([]);
      // A chat LumiAH was told to forget is left in the backup, and no folder is made for it.
      expect(chats.folders(USER, CHAT.forgot)).toBeNull();
    } finally {
      db.close();
    }
  });

  test("a second run carries a world edited and a setting changed since the first", async () => {
    const draft = join(fixture.userFolder, `worlds/${fixture.worldId}/draft.json`);
    await writeFile(draft, (await readFile(draft, "utf8")).replace("Harbour, draft", "Harbour, edited in Build"));
    const lumiah = join(fixture.userFolder, "harness/settings.json");
    await writeFile(lumiah, (await readFile(lumiah, "utf8")).replace('"include"', '"leave_out"'));
    const second = await migrate(fixture.sources, { data, env: fixture.named, tree, now: () => new Date("2026-11-14T10:00:00.000Z") });
    expect(second.ran).toBe(true);
    // The revisions the store keeps already are kept once: a draft edited on today's side is no new revision, and RPE's draft, still the first run's, follows it.
    expect(second.report.worldsInStore).toEqual({ added: 0, held: 2, unreadable: 0, copied: [], followed: [`${fixture.worldId}/draft.json`], kept: [], removed: [] });
    expect(second.report.changes?.changed.sort()).toEqual([`user storage: worlds/${fixture.worldId}/draft.json`, "user storage: harness/settings.json"].sort());
    await sameWorlds();
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      expect((await carriedWorlds(db, USER, registry).working(fixture.worldId as WorldId, user)).name).toBe("Harbour, edited in Build");
    } finally {
      db.close();
    }
    const config = Bun.YAML.parse(await readFile(dataPaths(data).globalConfig, "utf8")) as Record<string, unknown>;
    expect(config.history).toEqual({ hiddenReadable: false, window: 30 });
  });

  test("a chat played on RPE keeps the notes it has: a later run leaves them as they are, and says so", async () => {
    const files = dataPaths(data).files;
    const db = new Database(join(data, "rpe.db"));
    let notebook = "";
    try {
      const own = new TreeChats(db, { run: async (write) => write(db) }, files).folders(USER, CHAT.harness);
      notebook = join(files, "chats", own?.character ?? "", own?.chat ?? "", NOTES_FOLDER, "notebook.md");
      // A turn played on RPE, and its agents' word in the notes.
      openStore({ db, registry, worlds: () => undefined }).user(USER).beginTurn({ chat: CHAT.harness, kind: "normal" });
    } finally {
      db.close();
    }
    await writeFile(notebook, "Ada trusts the guard now.");
    const third = await migrate(fixture.sources, { data, env: fixture.named, tree, now: () => new Date("2026-11-14T11:00:00.000Z") });
    expect(third.ran).toBe(true);
    expect(third.report.imports?.find((c) => c.chatId === CHAT.harness)?.outcome).toBe("played on RPE: left alone");
    expect(await readFile(notebook, "utf8")).toBe("Ada trusts the guard now.");
    expect(third.report.carried?.ownFiles?.leftAlone).toBe(1);
    expect(reportText(third.report)).toContain("1 chat(s) played on RPE keep the notes they have");
  });

  test("a later run leaves the keys and sign-ins RPE already has: a key changed in RPE, a sign-in RPE refreshed since", async () => {
    const paths = dataPaths(data);
    const port = modelsPort(paths, new SecretsFile(paths.secrets), () => USER);
    const had = (await port.loadSecrets({ user: USER })) as Record<string, unknown>;
    const refreshed = { type: "oauth", access: "access-refreshed-in-rpe", refresh: "refresh-refreshed-in-rpe", expires: 2_000_000_000_000 };
    await port.saveSecrets({ user: USER }, { ...(had as object), v: 1, keys: { "conn-1": "sk-changed-in-rpe" }, signins: { anthropic: refreshed } } as Parameters<typeof port.saveSecrets>[1]);
    const fourth = await migrate(fixture.sources, { data, env: fixture.named, tree, now: () => new Date("2026-11-14T12:00:00.000Z") });
    expect(fourth.ran).toBe(true);
    expect(await port.loadSecrets({ user: USER })).toMatchObject({ keys: { "conn-1": "sk-changed-in-rpe" }, signins: { anthropic: refreshed } });
    expect(fourth.report.carried?.connections).toMatchObject({ keys: 0, signins: 0, kept: 2 });
  });
});
