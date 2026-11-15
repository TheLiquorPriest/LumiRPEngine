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
import { NO_SESSION } from "../../src/turn";
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
    const hits = await b.turns.files.find(scope, { by: "list" });
    if (!Array.isArray(hits)) throw new Error(`the listing was refused: ${JSON.stringify(hits)}`);
    return hits.length;
  };
  const prune = () => pruneChat({ files: b.app.paths.files, chats: b.turns.chats }, USER, CHAT);

  expect(await listing()).toBeGreaterThan(1);
  expect((await settings(b, "PUT", "", { level: "chat", chat: CHAT, key: "files.findLimit", value: 1 })).status).toBe(200);
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
  const config = { store: { snapshotEvery: 10, foldsKept: 0 }, cast: { faintBelow: 0.5, topOfMind: "nine" } };
  const told: string[] = [];
  const tell = (_key: string, _value: unknown, why: string): void => void told.push(why);
  expect(numbersIn(config, STORE_SETTING_DEFS, tell)).toEqual({ snapshotEvery: 10, foldsKept: STORE_DEFAULTS.foldsKept, notable: STORE_DEFAULTS.notable });
  expect(numbersIn(config, CAST_SETTING_DEFS, tell)).toEqual({ ...CAST_DEFAULTS, faintBelow: 0.5 });
  expect(told).toEqual(["store.foldsKept takes a whole number, at least 1, not 0.", 'cast.topOfMind takes a whole number, at least 0, not "nine".']);
});
