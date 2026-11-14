// The Settings page's routes (plan §14, §5.2): every setting RPH and RPE read, with its value in force
// for a chat, its default and the level and file it comes from; and a value written into one level's
// config file, which the chat's next turn reads. Played on the composed RPE over the stand-in
// Lumiverse, on a data folder of the test's own. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NO_SESSION, turnSettings } from "../../src/turn";
import { CHAT_CONFIG, CHATS_FOLDER, GLOBAL_CONFIG, SHIPPED_FOLDER } from "../../src/tree";
import type { SettingsReply, SettingView } from "../../src/app/settings-routes";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "../turn/bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** A bed whose chat has had one turn, so that it has its own folder, and so its own level. */
async function playedBed(global: string): Promise<TurnBed> {
  const b = await openTurnBed({ global, answers: [replying("The lamp catches.")] });
  beds.push(b);
  b.host.send(CHAT, "I light the lamp.");
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

function setting(reply: SettingsReply, key: string): SettingView {
  const found = reply.settings.find((s) => s.key === key);
  if (found === undefined) throw new Error(`no setting ${key} in the reply`);
  return found;
}

/** The chat's own config file on disk. */
function chatFile(b: TurnBed): string {
  const folders = b.turns.chats.folders(USER, CHAT);
  if (folders === null) throw new Error("the chat has no folder");
  return join(b.app.paths.files, CHATS_FOLDER, folders.character, folders.chat, CHAT_CONFIG);
}

/** The window the chat's next turn runs under, as the turn lane reads it at every turn. */
async function windowAtNextTurn(b: TurnBed): Promise<number | null> {
  return (await turnSettings(b.turns.files, { user: USER, chat: CHAT, session: NO_SESSION }, b.turns.env.log)).window.size;
}

test("every setting RPH and RPE read is listed for a chat: the value in force, its default, and the level and file it comes from", async () => {
  const b = await playedBed("history:\n  window: 30\nreply:\n  forms:\n    Floor model: two-step\n");
  const made = await b.page<{ id: string; error?: string }>("POST", "/api/v1/connections", { connection: { name: "Floor model", provider: "deepseek", auth: "key", model: "deepseek-v4-flash" }, key: "sk-invented-0000-1111" });
  expect(made.body.error).toBeUndefined();
  await writeFile(chatFile(b), "# This chat's own.\nhistory:\n  window: 12\nlimits:\n  turn:\n    calls: 0\n");

  const { status, body } = await settings(b, "GET", `?chat=${CHAT}`);
  expect(status).toBe(200);
  expect(body.files.map((f) => [f.level, f.file])).toEqual([
    ["shipped", "@shipped/RPE-global.yml"],
    ["global", "@global/RPE-global.yml"],
    ["chat", "RPE.yml"],
  ]);
  // The chat's level over the global one; the shipped file's value where neither sets it; the default where no file does.
  expect(setting(body, "history.window")).toMatchObject({ value: 12, default: 40, from: "chat", file: "RPE.yml", orNone: true, levels: ["global", "chat"] });
  expect(setting(body, "lead")).toMatchObject({ value: "author", from: "shipped", file: "@shipped/RPE-global.yml" });
  expect(setting(body, "history.step")).toMatchObject({ value: null, default: null, from: null, file: null });
  expect(setting(body, "compaction.reserve")).toMatchObject({ value: 16_384, default: 16_384, from: null });
  expect(setting(body, "passConnection").levels).toEqual(["global"]);
  // A value the setting does not take leaves its default in force, and says why.
  expect(setting(body, "limits.turn.calls")).toMatchObject({ value: 40, from: "chat", passed: { value: 0 } });
  expect(setting(body, "limits.turn.calls").passed?.why).toContain("a whole number, at least 1");
  // Per connection: the one the global file names by its name, and by its id where no file names it.
  expect(setting(body, "reply.forms.Floor model")).toMatchObject({ value: "two-step", from: "global", connection: { id: made.body.id, name: "Floor model" } });
  expect(setting(body, `effort.connections.${made.body.id}`)).toMatchObject({ value: null, from: null, connection: { id: made.body.id, name: "Floor model" } });

  // With no chat, the levels every chat shares.
  const shared = await settings(b, "GET", "");
  expect(shared.body.files.map((f) => f.level)).toEqual(["shipped", "global"]);
  expect(setting(shared.body, "history.window")).toMatchObject({ value: 30, from: "global" });
});

test("a value set at a chat's level is in force at the chat's next turn, over the global one; taken away, the global one shows through; the shipped file is never written", async () => {
  const b = await playedBed("history:\n  window: 30\n");
  const shipped = join(b.app.paths.files, SHIPPED_FOLDER, GLOBAL_CONFIG);
  const shippedBefore = await readFile(shipped, "utf8");
  expect(await windowAtNextTurn(b)).toBe(30);

  const set = await settings(b, "PUT", "", { level: "chat", chat: CHAT, key: "history.window", value: 5 });
  expect(set.status).toBe(200);
  expect(setting(set.body, "history.window")).toMatchObject({ value: 5, from: "chat", file: "RPE.yml" });
  expect(await windowAtNextTurn(b)).toBe(5);

  const none = await settings(b, "PUT", "", { level: "chat", chat: CHAT, key: "history.window", none: true });
  expect(setting(none.body, "history.window")).toMatchObject({ value: null, from: "chat" });
  expect(await windowAtNextTurn(b)).toBeNull();

  const removed = await settings(b, "PUT", "", { level: "chat", chat: CHAT, key: "history.window", value: null });
  expect(setting(removed.body, "history.window")).toMatchObject({ value: 30, from: "global" });
  expect(await windowAtNextTurn(b)).toBe(30);
  expect(await readFile(chatFile(b), "utf8")).toBe("");

  expect((await settings(b, "PUT", "", { level: "shipped", key: "history.window", value: 7 })).status).toBe(400);
  expect(await readFile(shipped, "utf8")).toBe(shippedBefore);
});

test("a write keeps the user's comments and every other line of the file, and a key written short keeps its value", async () => {
  const mine = ["# My own settings.", "off: [rules/turn-unrecorded]", "", "history:", "  # The prompt keeps the latest thirty.", "  window: 30", "  hold: true", "", "# Limits, mine.", "limits:", "  turn:", "    depth: 1", ""].join("\n");
  const b = await playedBed("");
  await writeFile(b.app.paths.globalConfig, mine);

  expect((await settings(b, "PUT", "", { level: "global", key: "limits.turn.calls", value: 12 })).status).toBe(200);
  const capped = await settings(b, "PUT", "", { level: "global", key: "history.hold.cap", value: 3 });
  expect(capped.status).toBe(200);
  expect(setting(capped.body, "history.hold.on")).toMatchObject({ value: true, from: "global" });
  expect(setting(capped.body, "history.hold.cap")).toMatchObject({ value: 3, from: "global" });

  const text = await readFile(b.app.paths.globalConfig, "utf8");
  for (const line of ["# My own settings.", "off: [rules/turn-unrecorded]", "  # The prompt keeps the latest thirty.", "  window: 30", "# Limits, mine.", "    depth: 1"]) expect(text.split("\n")).toContain(line);
  expect(Bun.YAML.parse(text)).toEqual({ off: ["rules/turn-unrecorded"], history: { window: 30, hold: { on: true, cap: 3 } }, limits: { turn: { depth: 1, calls: 12 } } });
  const turn = await turnSettings(b.turns.files, { user: USER, chat: CHAT, session: NO_SESSION }, b.turns.env.log);
  expect(turn.window).toEqual({ size: 30, step: null, hold: { on: true, cap: 3 } });
});

test("a value of the wrong kind, a key RPE does not read, ~ where it is not taken and a level a setting is not read from are refused, in RPE's words, and nothing is written", async () => {
  const b = await playedBed("history:\n  window: 30\n");
  const before = await readFile(b.app.paths.globalConfig, "utf8");
  const refused = async (body: unknown): Promise<string> => {
    const answer = await settings<{ error: string }>(b, "PUT", "", body);
    expect(answer.status).toBe(400);
    return answer.body.error;
  };
  expect(await refused({ level: "global", key: "history.window", value: 0 })).toBe("history.window takes a whole number, at least 1, or ~ for every message kept, not 0.");
  expect(await refused({ level: "global", key: "reply.forms.Floor model", value: "three-step" })).toContain("one of tags, two-step");
  expect(await refused({ level: "global", key: "reply.streamAnyway", value: ["Floor model", 3] })).toContain("a list of names");
  expect(await refused({ level: "global", key: "history.windows", value: 3 })).toBe('RPE reads no setting "history.windows".');
  expect(await refused({ level: "global", key: "reply.form", none: true })).toContain("takes no ~");
  expect(await refused({ level: "chat", chat: CHAT, key: "passConnection", value: "Floor model" })).toBe("passConnection is read from the global level alone.");
  expect(await refused({ level: "chat", key: "history.window", value: 3 })).toContain("Name the chat");
  expect(await readFile(b.app.paths.globalConfig, "utf8")).toBe(before);
});
