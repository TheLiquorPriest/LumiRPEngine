// The Settings page's routes (plan §14, §5.2): every setting RPH and RPE read, with its value in force
// for a chat, its default and the level and file it comes from; and a value written into one level's
// config file, which the chat's next turn reads. Played on the composed RPE over the stand-in
// Lumiverse, on a data folder of the test's own. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SETTINGS as HARNESS_SETTINGS } from "rp-harness/helpers";
import { NO_SESSION, turnSettings } from "../../src/turn";
import { CHAT_CONFIG, CHATS_FOLDER, GLOBAL_CONFIG, SHIPPED_FOLDER } from "../../src/tree";
import type { SettingsReply, SettingView } from "../../src/app/settings-routes";
import { keyFor, type Setting } from "../../src/app/setting-list";
import { loadConfig, SERVER_SETTINGS } from "../../src/app/config";
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
  expect(setting(body, `jobs.connections.${made.body.id}.perDay`)).toMatchObject({ value: null, from: null, connection: { id: made.body.id, name: "Floor model" } });

  // With no chat, the levels every chat shares.
  const shared = await settings(b, "GET", "");
  expect(shared.body.files.map((f) => f.level)).toEqual(["shipped", "global"]);
  expect(setting(shared.body, "history.window")).toMatchObject({ value: 30, from: "global" });
});

test("GET /api/v1/settings offers every setting of RPH's exported list with its default and what it takes", async () => {
  const b = await playedBed("");
  const made = await b.page<{ id: string; error?: string }>("POST", "/api/v1/connections", { connection: { name: "Floor model", provider: "deepseek", auth: "key", model: "deepseek-v4-flash" }, key: "sk-invented-0000-1111" });
  expect(made.body.error).toBeUndefined();

  const { status, body } = await settings(b, "GET", `?chat=${CHAT}`);
  expect(status).toBe(200);
  expect(HARNESS_SETTINGS.length).toBeGreaterThan(0);
  for (const def of HARNESS_SETTINGS) {
    const shown = setting(body, keyFor(def, made.body.id));
    expect({ key: def.key, default: shown.default, takes: shown.takes, none: shown.none, orNone: shown.orNone }).toEqual({ key: def.key, default: def.default, takes: def.takes, none: def.none ?? null, orNone: def.orNone === true });
  }
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

test("the files switched off at a level are listed under it, and a write switches one on again", async () => {
  const b = await playedBed("");
  // His own file, with one `off:` list (the bed's own line replaced).
  await writeFile(b.app.paths.globalConfig, "off:\n  - rules/turn-unrecorded\n  - WORLD\n");
  await writeFile(chatFile(b), "off: [SIMULATION]\n");
  const listed = setting((await settings(b, "GET", `?chat=${CHAT}`)).body, "off");
  // Every level's list, each under its level; together, what is off.
  expect(listed).toMatchObject({ joined: true, value: ["rules/turn-unrecorded", "WORLD", "SIMULATION"], takes: { type: "texts" } });
  expect(listed.set).toEqual([
    { level: "shipped", file: "@shipped/RPE-global.yml", value: [] },
    { level: "global", file: "@global/RPE-global.yml", value: ["rules/turn-unrecorded", "WORLD"] },
    { level: "chat", file: "RPE.yml", value: ["SIMULATION"] },
  ]);

  // WORLD switched on again at the level that switched it off: written as the Files page writes it, a list under `off:`.
  const on = await settings(b, "PUT", "", { level: "global", key: "off", value: ["rules/turn-unrecorded"] });
  expect(on.status).toBe(200);
  expect(setting(on.body, "off").value).toEqual(["rules/turn-unrecorded"]);
  expect(Bun.YAML.parse(await readFile(b.app.paths.globalConfig, "utf8"))).toEqual({ off: ["rules/turn-unrecorded"] });
  const chatOn = await settings(b, "PUT", "", { level: "chat", chat: CHAT, key: "off", value: [] });
  expect(setting(chatOn.body, "off").value).toEqual(["rules/turn-unrecorded"]);
});

test("`added:` is shown and written as a table of situations, each with its files", async () => {
  const b = await playedBed("");
  const shipped = setting((await settings(b, "GET", `?chat=${CHAT}`)).body, "added");
  expect(shipped).toMatchObject({ value: { swipe: ["SWIPE"], regenerate: ["SWIPE"], delete: ["DELETE"] }, from: "shipped", takes: { type: "table", of: { type: "texts" } } });
  expect(shipped.takesWords).toBe("a table of names, each to a list of names");

  // A situation's entry at the chat's level replaces the shipped one for that situation alone.
  const set = await settings(b, "PUT", "", { level: "chat", chat: CHAT, key: "added", value: { swipe: ["SWIPE", "RECAP"] } });
  expect(set.status).toBe(200);
  expect(setting(set.body, "added").value).toEqual({ swipe: ["SWIPE", "RECAP"], regenerate: ["SWIPE"], delete: ["DELETE"] });
  expect(Bun.YAML.parse(await readFile(chatFile(b), "utf8"))).toEqual({ added: { swipe: ["SWIPE", "RECAP"] } });

  const refused = await settings<{ error: string }>(b, "PUT", "", { level: "chat", chat: CHAT, key: "added", value: { swipe: "SWIPE" } });
  expect(refused).toEqual({ status: 400, body: { error: 'added.swipe takes a list of names, not "SWIPE".' } });
});

test("a list of records a test area declares is shown as a table and written back with one record added and one taken out, his comments kept", async () => {
  const marks: Setting = {
    key: "keeper.marks",
    default: [],
    takes: {
      type: "records",
      fields: [
        { name: "file", takes: { type: "text" }, about: "The note marked." },
        { name: "agent", takes: { type: "text" }, about: "Who keeps it." },
      ],
    },
    perConnection: false,
    name: "Marked notes",
    about: "Notes the keeper marks, each with the agent that keeps it.",
    effect: "use",
  };
  const mine = ["# The keeper's marks.", "keeper:", "  marks:", "    # The tide first.", "    - { file: persistent-workspace/tides.md, agent: keeper }", "    - { file: persistent-workspace/gulls.md, agent: author }", "# The end.", ""].join("\n");
  const b = await openTurnBed({ global: mine, answers: [], areas: () => [{ name: "keeper", settings: [marks] }] });
  beds.push(b);

  const shown = setting((await settings(b, "GET", "")).body, "keeper.marks");
  expect(shown).toMatchObject({ value: [{ file: "persistent-workspace/tides.md", agent: "keeper" }, { file: "persistent-workspace/gulls.md", agent: "author" }], takes: { type: "records" } });
  expect(shown.takesWords).toBe("a list of records, each with file (a line of text) and agent (a line of text)");

  const written = [{ file: "persistent-workspace/tides.md", agent: "keeper" }, { file: "persistent-workspace/lamp.md", agent: "keeper" }];
  const put = await settings(b, "PUT", "", { level: "global", key: "keeper.marks", value: written });
  expect(put.status).toBe(200);
  expect(setting(put.body, "keeper.marks").value).toEqual(written);
  const text = await readFile(b.app.paths.globalConfig, "utf8");
  for (const line of ["# The keeper's marks.", "# The end."]) expect(text.split("\n")).toContain(line);
  // The bed's own `off:` line stays as it was.
  expect(Bun.YAML.parse(text)).toEqual({ off: [], keeper: { marks: written } });

  // A record short of a field is refused, and nothing is written.
  const refused = await settings<{ error: string }>(b, "PUT", "", { level: "global", key: "keeper.marks", value: [{ file: "persistent-workspace/tides.md" }] });
  expect(refused.status).toBe(400);
  expect(refused.body.error).toBe('keeper.marks[1] is a record with file (a line of text) and agent (a line of text), not {"file":"persistent-workspace/tides.md"}.');
  expect(await readFile(b.app.paths.globalConfig, "utf8")).toBe(text);
});

test("the server's limits are listed under RPE-global.yml with their defaults, and a write from the page lands there and is in force after a restart", async () => {
  const b = await openTurnBed({ answers: [] });
  beds.push(b);
  const configBefore = await readFile(b.app.paths.config, "utf8");
  const listed = (await settings(b, "GET", "")).body;
  for (const def of SERVER_SETTINGS) {
    expect(setting(listed, def.key)).toMatchObject({ key: def.key, default: def.default, effect: "start", levels: ["global"], name: def.name, about: def.about });
  }
  // The one of Appendix D.1: RPE listens on loopback unless an address is set.
  expect(setting(listed, "server.address")).toMatchObject({ value: "127.0.0.1", row: "RPE listens on", effectWords: "from RPE's next start" });

  const put = await settings(b, "PUT", "", { level: "global", key: "server.bodyBytes", value: 2_097_152 });
  expect(put.status).toBe(200);
  expect(setting(put.body, "server.bodyBytes")).toMatchObject({ value: 2_097_152, from: "global", file: "@global/RPE-global.yml" });
  expect(Bun.YAML.parse(await readFile(b.app.paths.globalConfig, "utf8"))).toMatchObject({ server: { bodyBytes: 2_097_152 } });
  // Read from the global level alone; config.json is not written.
  expect((await settings(b, "PUT", "", { level: "chat", chat: CHAT, key: "server.bodyBytes", value: 4096 })).status).toBe(400);
  expect(await readFile(b.app.paths.config, "utf8")).toBe(configBefore);
  // What RPE's next start reads.
  expect((await loadConfig(b.app.paths, {})).server.bodyBytes).toBe(2_097_152);
});

test("config.json's facts are listed, and no route writes config.json", async () => {
  const b = await openTurnBed({ answers: [] });
  beds.push(b);
  const configBefore = await readFile(b.app.paths.config, "utf8");
  const { facts } = (await settings(b, "GET", "")).body;
  expect(facts.map((f) => [f.key, f.from])).toEqual([
    ["lumiverse.url", "config.json"],
    ["lumiverse.user", "config.json"],
    ["lumiverse.database", "config.json"],
    ["port", "config.json"],
    ["lumiverse.connection", "config.json"],
    ["lumiverse.models", "config.json"],
    ["data", "install"],
    ["database", "install"],
  ]);
  expect(facts.find((f) => f.key === "lumiverse.user")?.value).toBe(USER);
  expect(facts.find((f) => f.key === "lumiverse.connection")?.value).toBe(CONNECTION);
  // A fact, or a limit by the key config.json gave it in earlier builds, is no setting a route writes.
  for (const key of ["port", "lumiverse.url", "lumiverse.user", "address", "live.follows"]) {
    const answer = await settings<{ error: string }>(b, "PUT", "", { level: "global", key, value: 1 });
    expect({ key, status: answer.status, error: answer.body.error }).toEqual({ key, status: 400, error: `RPE reads no setting "${key}".` });
  }
  // A limit written from the page lands in RPE-global.yml alone.
  expect((await settings(b, "PUT", "", { level: "global", key: "server.address", value: "0.0.0.0" })).status).toBe(200);
  expect(await readFile(b.app.paths.config, "utf8")).toBe(configBefore);
});

/** The Files page's switch of a file at a level, as the page calls it: its status. */
async function switchOff(b: TurnBed, path: string, body: unknown): Promise<number> {
  const token = (await b.app.auth.mintPageToken(USER, "extension")).token;
  const res = await fetch(`${b.listening.url}/api/v1/files-off/${path}`, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.status;
}

test("a setting written while the Files page switches a file off: both changes are in the file", async () => {
  const b = await openTurnBed({ answers: [] });
  beds.push(b);
  await writeFile(b.app.paths.globalConfig, "# Mine.\nhistory:\n  window: 30\n");
  for (const [round, file] of ["consent", "perceptions-owed", "unsourced"].entries()) {
    const [setting, switched] = await Promise.all([settings(b, "PUT", "", { level: "global", key: "history.window", value: 20 + round }), switchOff(b, `@shipped/.rules/${file}.md`, { level: "global", off: true })]);
    expect({ round, setting: setting.status, switched }).toEqual({ round, setting: 200, switched: 200 });
    const text = await readFile(b.app.paths.globalConfig, "utf8");
    expect({ round, comment: text.startsWith("# Mine.\n") }).toEqual({ round, comment: true });
    expect({ round, doc: Bun.YAML.parse(text) }).toMatchObject({ round, doc: { history: { window: 20 + round }, off: expect.arrayContaining([`rules/${file}`]) } });
  }
});

test("a file whose layout the splice cannot follow is left as it was, and the answer names the line", async () => {
  const b = await openTurnBed({ answers: [] });
  beds.push(b);
  const mine = "# Mine.\nhistory: { hold: true,\n  step: 10 }\n";
  await writeFile(b.app.paths.globalConfig, mine);
  const refused = await settings<{ error: string }>(b, "PUT", "", { level: "global", key: "history.window", value: 25 });
  expect(refused.status).toBe(409);
  expect(refused.body.error).toContain('line 2 ("history: { hold: true,")');
  expect(refused.body.error).toContain("without losing your comments");
  expect(await readFile(b.app.paths.globalConfig, "utf8")).toBe(mine);
  // The Files page's switch writes the same file under the same rule.
  expect(await switchOff(b, "@shipped/.rules/consent.md", { level: "global", off: true })).toBe(200);
  expect((await readFile(b.app.paths.globalConfig, "utf8")).startsWith(mine.trimEnd())).toBe(true);
});

test("PUT at the chat level for a chat RPE has never played writes its RPE.yml, and its first turn plays under it", async () => {
  const b = await openTurnBed({ answers: [replying("The lamp catches.")] });
  beds.push(b);
  expect(b.turns.chats.folders(USER, CHAT)).toBeNull();
  const set = await settings(b, "PUT", "", { level: "chat", chat: CHAT, key: "history.window", value: 5 });
  expect(set.status).toBe(200);
  expect(setting(set.body, "history.window")).toMatchObject({ value: 5, from: "chat", file: "RPE.yml" });
  const file = chatFile(b);
  expect(Bun.YAML.parse(await readFile(file, "utf8"))).toEqual({ history: { window: 5 } });
  expect(await windowAtNextTurn(b)).toBe(5);

  // Its first turn finds the chat placed where the write put it, and plays under the chat's own level.
  b.host.send(CHAT, "I light the lamp.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  await settledTurn(b, out.generationId!);
  expect(chatFile(b)).toBe(file);
  expect(await windowAtNextTurn(b)).toBe(5);

  // A chat Lumiverse does not have is no folder made.
  const unknown = await settings<{ error: string }>(b, "PUT", "", { level: "chat", chat: "chat-nowhere", key: "history.window", value: 5 });
  expect(unknown).toEqual({ status: 404, body: { error: "Lumiverse has no chat chat-nowhere of yours." } });
  expect(b.turns.chats.folders(USER, "chat-nowhere")).toBeNull();
});
