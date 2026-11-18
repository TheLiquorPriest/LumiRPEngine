// The limits RPE's own areas keep (the file tree, the cast, the story lane, the lore, the store; plan
// Appendix D.1), each a setting: every one is listed by the Settings route, at the levels its reader
// takes it from, with its default where no file sets it; a value it does not take is refused in RPE's
// words; and a limit the tree reads itself, written through the route at a chat's level, holds at its
// next use. Played on the composed RPE over the stand-in Lumiverse, on a data folder of the test's own.
// Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { numbersIn, type Setting } from "../../src/app/setting-list";
import type { SettingsReply, SettingView } from "../../src/app/settings-routes";
import { CAST_DEFAULTS, CAST_SETTING_DEFS, CAST_SETTINGS } from "../../src/cast";
import { LORE_SETTINGS } from "../../src/lore";
import { STORE_DEFAULTS, STORE_SETTING_DEFS, STORE_SETTINGS } from "../../src/store";
import { STORY_SETTINGS } from "../../src/story";
import { pruneChat, TREE_SETTINGS } from "../../src/tree";
import { NO_SESSION, type TurnSettings, turnSettings } from "../../src/turn";
import { bootstrapSettings } from "../../src/turn/bootstrap";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "../turn/bed";

/** Every setting of the areas, by the area that reads it. */
const AREAS: Readonly<Record<string, readonly Setting[]>> = { tree: TREE_SETTINGS, cast: CAST_SETTINGS, story: STORY_SETTINGS, lore: LORE_SETTINGS, store: STORE_SETTINGS };

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** A bed whose chat has had one turn, so that it has its own folder, its own level and a turn folder. */
async function playedBed(): Promise<TurnBed> {
  const b = await openTurnBed({ global: "", answers: [replying("The tide turns.")] });
  beds.push(b);
  b.host.send(CHAT, "I watch the harbour.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  await settledTurn(b, out.generationId!);
  return b;
}

/** A call to the settings routes as the Settings page makes it: its status and its JSON. */
async function settings<T = SettingsReply>(b: TurnBed, method: "GET" | "PUT", query: string, body?: unknown): Promise<{ status: number; body: T }> {
  const token = (await b.app.auth.mintPageToken(USER, "extension")).token;
  const res = await fetch(`${b.listening.url}/api/v1/settings${query}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as T };
}

test("every setting the tree, the cast, the story lane, the lore and the store read is listed for a chat, at the levels it is read from, with its default where no file sets it", async () => {
  const b = await playedBed();
  const { status, body } = await settings(b, "GET", `?chat=${CHAT}`);
  expect(status).toBe(200);
  const keys = body.settings.map((s) => s.key);
  expect(keys.length).toBe(new Set(keys).size);
  const listed = new Map<string, SettingView>(body.settings.map((s) => [s.key, s]));
  const wrong: string[] = [];
  for (const [area, defs] of Object.entries(AREAS)) {
    for (const def of defs) {
      const view = listed.get(def.key);
      if (view === undefined) {
        wrong.push(`${area}: ${def.key} is not listed`);
        continue;
      }
      // Read at every level, or from the global level alone where its part is made once for every chat.
      const levels = def.levels === undefined ? ["global", "chat"] : ["global"];
      if (JSON.stringify(view.levels) !== JSON.stringify(levels)) wrong.push(`${area}: ${def.key} may be set at ${view.levels.join(", ")}`);
      if (JSON.stringify(view.default) !== JSON.stringify(def.default) || (view.from === null && JSON.stringify(view.value) !== JSON.stringify(def.default))) wrong.push(`${area}: ${def.key} shows ${JSON.stringify(view.value)}, default ${JSON.stringify(view.default)}`);
    }
  }
  expect(wrong).toEqual([]);
  // The one the shipped file sets says so.
  expect(listed.get("retention.turnFolders")).toMatchObject({ value: 50, from: "shipped", file: "@shipped/RPE-global.yml" });
});

test("a value a setting does not take, past its most, under its least, or at a level it is not read from, is refused in RPE's words", async () => {
  const b = await playedBed();
  const before = await Bun.file(b.app.paths.globalConfig).text();
  const refused = async (body: unknown): Promise<string> => {
    const answer = await settings<{ error: string }>(b, "PUT", "", body);
    expect(answer.status).toBe(400);
    return answer.body.error;
  };
  expect(await refused({ level: "global", key: "cast.faintBelow", value: 2 })).toBe("cast.faintBelow takes a number from 0 to 1, not 2.");
  expect(await refused({ level: "global", key: "lore.index.bound", value: -1 })).toBe("lore.index.bound takes a whole number, at least 0, not -1.");
  expect(await refused({ level: "chat", chat: CHAT, key: "store.snapshotEvery", value: 10 })).toBe("store.snapshotEvery is read from the global level alone.");
  expect(await Bun.file(b.app.paths.globalConfig).text()).toBe(before);
});

test("a limit the tree reads, written through the route at a chat's level, holds at its next use: the hits a listing gives, and the turn folders kept whole", async () => {
  const b = await playedBed();
  const scope = { user: USER, chat: CHAT, session: NO_SESSION };
  const listing = async (): Promise<number> => {
    const found = await b.turns.files.find(scope, { by: "list" });
    if (found.status !== "found") throw new Error(`the listing was refused: ${JSON.stringify(found)}`);
    return found.hits.length;
  };
  const prune = () => pruneChat({ files: b.app.paths.files, chats: b.turns.chats }, USER, CHAT);

  expect(await listing()).toBeGreaterThan(1);
  expect((await settings(b, "PUT", "", { level: "chat", chat: CHAT, key: "files.findHits", value: 1 })).status).toBe(200);
  expect(await listing()).toBe(1);

  // As shipped, 50 are kept whole: the chat's one turn folder stays as it is.
  expect((await prune()).folders).toBe(0);
  const set = await settings(b, "PUT", "", { level: "chat", chat: CHAT, key: "retention.turnFolders", value: 0 });
  expect(set.body.settings.find((s) => s.key === "retention.turnFolders")).toMatchObject({ value: 0, from: "chat", file: "RPE.yml" });
  const pruned = await prune();
  expect(pruned.folders).toBe(1);
  expect(pruned.files).toBeGreaterThan(0);
});

test("an area's settings are read from a config through its list: a value it takes holds, and one it does not leaves the default and is told why", () => {
  const config = { store: { snapshotEvery: 10, statesPerChat: 0 }, cast: { faintBelow: 0.5, topOfMind: "nine" } };
  const told: string[] = [];
  const tell = (_key: string, _value: unknown, why: string): void => void told.push(why);
  const { ownOnly: _ownOnly, ...defaults } = STORE_DEFAULTS;
  expect(numbersIn(config, STORE_SETTING_DEFS, tell) as Record<string, number | null>).toEqual({ ...defaults, snapshotEvery: 10 });
  expect(numbersIn(config, CAST_SETTING_DEFS, tell)).toEqual({ ...CAST_DEFAULTS, faintBelow: 0.5 });
  expect(told).toEqual(["store.statesPerChat takes a whole number, at least 1, not 0.", 'cast.topOfMind takes a whole number, at least 0, not "nine".']);
});

test("for each area, a value changed through PUT /api/v1/settings is what that area reads at its next turn, or after a restart where its row says so", async () => {
  const b = await playedBed();
  const scope = { user: USER, chat: CHAT, session: NO_SESSION };
  const effectOf = async (key: string): Promise<string | undefined> => (await settings(b, "GET", `?chat=${CHAT}`)).body.settings.find((s) => s.key === key)?.effect;
  const put = async (body: Record<string, unknown>): Promise<void> => {
    expect({ body, status: (await settings(b, "PUT", "", body)).status }).toEqual({ body, status: 200 });
  };

  // At the next turn: the cast's, the story lane's, the world state's and the engine's tools', each read through the one reader as a turn begins.
  const nextTurn: readonly [string, number, (t: TurnSettings) => number][] = [
    ["cast.topOfMind", 4, (t) => t.cast.topOfMind],
    ["story.soFar.minTokens", 3000, (t) => t.storySoFar.floor],
    ["worldState.tokens", 2500, (t) => t.worldState.budget],
    ["engine.searchHits", 7, (t) => t.engine.searchHits],
  ];
  for (const [key, value, read] of nextTurn) {
    expect({ key, effect: await effectOf(key) }).toEqual({ key, effect: "turn" });
    await put({ level: "chat", chat: CHAT, key, value });
    expect({ key, read: read(await turnSettings(b.turns.files, scope, b.turns.env.log)) }).toEqual({ key, read: value });
  }

  // At its next use: the bootstrap's limit, read as a bootstrap job starts.
  expect(await effectOf("bootstrap.askAtTokens")).toBe("use");
  await put({ level: "chat", chat: CHAT, key: "bootstrap.askAtTokens", value: 150_000 });
  expect((await bootstrapSettings(b.turns.files, scope, b.turns.env.log)).tokenLimit).toBe(150_000);

  // From the next start: the store's own, read once as RPE opens the store; this RPE keeps what it opened with until it starts again.
  expect(await effectOf("store.snapshotEvery")).toBe("start");
  const opened = b.turns.store.snapshotEvery;
  await put({ level: "global", key: "store.snapshotEvery", value: opened + 7 });
  expect(b.turns.store.snapshotEvery).toBe(opened);
  await b.restart();
  expect(b.turns.store.snapshotEvery).toBe(opened + 7);
});
