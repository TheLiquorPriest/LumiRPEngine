// The settings registry (plan §5.4 "Config", §14, Appendix D.1): every area's list and RPH's, each key
// once, each setting with its words; and the one reader of the config levels, which gives every area
// the same values from the same files, the door's included, and logs what it passes over once, with its
// file. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JsonValue, Log } from "rp-harness/contract";
import { SETTINGS as RPH_SETTINGS } from "rp-harness/helpers";
import { lumiverseSettings } from "../../src/adapter/lumiverse/settings";
import { QUESTION_PATH } from "../../src/adapter/lumiverse/wire";
import { compose } from "../../src/app/compose";
import { diskTexts, portTexts, readConfig } from "../../src/app/config-read";
import { gatherSettings } from "../../src/app/hooks";
import { EFFECT_WORDS, HARNESS_ROW_KEYS, type Setting } from "../../src/app/setting-list";
import { CHAT_CONFIG, CHATS_FOLDER, type ChatLocation, levelFiles, levelTexts, treeSettingsOf } from "../../src/tree";
import { NO_SESSION, turnSettings } from "../../src/turn";
import { bootstrapSettings } from "../../src/turn/bootstrap/settings";
import { TURN_SETTINGS } from "../../src/turn/settings";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "../turn/bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** The registry as the composition's areas give it. */
function registry(): Setting[] {
  return gatherSettings(compose().areas);
}

/** A bed whose chat has had one turn, so that it has its own folder, its own level, under `global`. */
async function playedBed(global: string): Promise<TurnBed> {
  const b = await openTurnBed({ global, answers: [replying("The gulls wheel.")] });
  beds.push(b);
  b.host.send(CHAT, "I walk the quay.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  await settledTurn(b, out.generationId!);
  return b;
}

function located(b: TurnBed): ChatLocation {
  const folders = b.turns.chats.folders(USER, CHAT);
  if (folders === null) throw new Error("the chat has no folder");
  return { files: b.app.paths.files, character: folders.character, chat: folders.chat };
}

test("every key RPH's reader takes is listed once, beside every RPE area's", () => {
  const areas = compose().areas;
  const listed = gatherSettings(areas);
  const keys = listed.map((s) => s.key);
  expect(new Set(keys).size).toBe(keys.length);
  for (const def of RPH_SETTINGS) {
    expect(keys.filter((k) => k === def.key)).toEqual([def.key]);
    // With RPH's own default and what it takes.
    expect(listed.find((s) => s.key === def.key)).toMatchObject({ default: def.default, takes: def.takes, perConnection: def.perConnection });
  }
  for (const area of areas) for (const def of area.settings ?? []) expect(keys).toContain(def.key);
  // Each RPH key the registry gives a row of Appendix D.1 is one RPH reads.
  for (const key of HARNESS_ROW_KEYS) expect(RPH_SETTINGS.map((s) => s.key)).toContain(key);
});

test("a key declared by two areas, or by an area and RPH, fails the registry's test", () => {
  const areas = compose().areas;
  const listed = gatherSettings(areas);
  const again = (key: string) => ({ name: "again", settings: listed.filter((s) => s.key === key) });
  expect(() => gatherSettings([...areas, again("history.window")])).toThrow("The setting history.window is listed by two areas, turn and again: one area lists a setting.");
  expect(() => gatherSettings([...areas, again("limits.turn.calls")])).toThrow("The setting limits.turn.calls is listed by two areas, turn and again: one area lists a setting.");
});

test("every setting has its line", () => {
  const wrong: string[] = [];
  for (const s of registry()) {
    if (s.name.trim() === "") wrong.push(`${s.key} has no name`);
    if (s.about.trim() === "" || s.about.includes("\n")) wrong.push(`${s.key} has no one line on what it does`);
    if (!(s.effect in EFFECT_WORDS)) wrong.push(`${s.key} says no moment it takes effect`);
  }
  expect(wrong).toEqual([]);
});

test("a section that is not a mapping, and a whole file that is not one, are logged once with the file's name", () => {
  const warned: { message: string; fields: Record<string, JsonValue> | undefined }[] = [];
  const log: Log = { debug: () => undefined, info: () => undefined, warn: (message, fields) => void warned.push({ message, fields }), error: () => undefined };
  const read = readConfig(
    [
      { level: "shipped", file: "@shipped/RPE-global.yml", text: "turn:\n  lead: author\n" },
      { level: "global", file: "@global/RPE-global.yml", text: "history: 5\n" },
      { level: "chat", file: "RPE.yml", text: "- one\n- two\n" },
    ],
    log,
    TURN_SETTINGS,
  );
  // Every setting under `history:` read, twice: each of them is at its default, and the section is told of once.
  for (let i = 0; i < 2; i++) for (const def of TURN_SETTINGS) read.value(def);
  expect(read.value(TURN_SETTINGS.find((d) => d.key === "history.window")!)).toBe(40);
  expect(warned).toEqual([
    { message: "A config file is not a mapping of keys that RPE can read; the settings in it are passed over.", fields: { file: "RPE.yml", why: "RPE.yml must hold one mapping of names to values." } },
    { message: "A setting has a value it does not take; its default holds.", fields: { setting: "history", value: 5, file: "@global/RPE-global.yml", why: "history holds the settings under it as a mapping of keys, not 5." } },
  ]);
});

test("the same files give every area the same values", async () => {
  const global = ["history:", "  window: 12", "files:", "  findHits: 7", "bootstrap:", "  askAtTokens: 1234", "lumiverse:", "  search:", "    hits: 7", "cast:", "  topOfMind: 4", ""].join("\n");
  const b = await playedBed(global);
  const loc = located(b);
  await writeFile(join(loc.files, CHATS_FOLDER, loc.character!, loc.chat!, CHAT_CONFIG), ["history:", "  window: 9", "files:", "  grepMs: 300", ""].join("\n"));
  const scope = { user: USER, chat: CHAT, session: NO_SESSION };
  const defs = b.app.settings.filter((d) => !d.perConnection);

  // Read through the agents' file port, through the tree's view, from disk as the Settings page does, and by the reader the composition hands every area.
  const reads = {
    port: readConfig(await portTexts(b.turns.files, scope), null, defs),
    tree: readConfig(await levelTexts(loc), null, defs),
    disk: readConfig(await diskTexts(levelFiles(loc)), null, defs),
    handed: await b.composition.settings.read(USER, CHAT),
  };
  for (const def of defs) {
    const values = Object.fromEntries(Object.entries(reads).map(([from, read]) => [from, read.value(def)]));
    expect([def.key, values]).toEqual([def.key, { port: values.port, tree: values.port, disk: values.port, handed: values.port }]);
  }
  expect(reads.handed.value(defs.find((d) => d.key === "history.window")!)).toBe(9);

  // And each area's own reader reads those values.
  const turn = await turnSettings(b.turns.files, scope, b.turns.env.log);
  expect(turn.window.size).toBe(9);
  expect(turn.cast.topOfMind).toBe(4);
  expect((await bootstrapSettings(b.turns.files, scope, b.turns.env.log)).tokenLimit).toBe(1234);
  expect(await treeSettingsOf(loc)).toMatchObject({ findLimit: 7, grepMs: 300 });
  expect(lumiverseSettings(b.composition.settings.shared()).search.limit).toBe(7);
});

test("a value set in RPE-global.yml for a setting the door declares reaches the door", async () => {
  // The question's largest body, which the door reads as it adds its route at start.
  const b = await playedBed(["lumiverse:", "  question:", "    maxKiB: 16", ""].join("\n"));
  const question = b.app.routes.list().find((r) => r.path === QUESTION_PATH);
  expect(question?.maxBody).toBe(16 * 1024);
});
