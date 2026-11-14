// Your settings (STANDALONE-PLAN §15.2, "Your settings", "Which model each kind of work uses" and
// "The runtime's own settings"): each of today's settings goes into RPE's config where RPE has a
// setting of the same meaning, and every other one is listed by name, as having no home in RPE yet.
// A setting that names a connection living in Lumiverse is listed for the user, with the connection
// it names: RPE calls models through its own connections and can't use one kept in Lumiverse.
//
// Today's settings are read where today's build keeps them: the engine's `settings.json`, each chat's
// `runs/<chat>/prefs.json` and its own choices in the chat's metadata, LumiAH's `harness/settings.json`
// (only what the user changed, each a value put whole at a path: `H/extension/backend/settings.ts`)
// and `harness/story.json`, and each runtime's config.

import { isRecord, type JsonValue } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { readText, writeWhole } from "../app/disk";
import { withTopLevelKey, yamlMapping } from "../app/yaml";
import { readText as readFile } from "./files";
import type { Item } from "./report";
import type { Today } from "./today";

/** Settings carried, settings with no home in RPE yet, and settings that name a connection in Lumiverse. */
export interface SettingsCarried {
  /** Where each carried setting was, and the setting it now is in RPE's config. */
  carried: { from: string; to: string }[];
  /** Today's settings with no setting of the same meaning in RPE yet, by where they are and their name. */
  noHome: string[];
  /** Today's settings that name a connection that lives in Lumiverse: where each is, and the connection's id there. */
  lumiverseConnections: { setting: string; connection: string }[];
}

function json(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** LumiAH's settings as the user set them: each value they put whole at a path (`Own`), the nearer the root first, so a deeper one stands over it (`valuesOf`). */
function lumiahOwn(raw: unknown): Record<string, JsonValue> {
  const values: Record<string, JsonValue> = {};
  const own = isRecord(raw) && Array.isArray(raw.own) ? raw.own.filter((o: unknown): o is { path: string[]; value: JsonValue } => isRecord(o) && Array.isArray(o.path) && o.path.length > 0 && o.path.every((p: unknown) => typeof p === "string") && o.value !== undefined) : [];
  for (const o of [...own].sort((a, b) => a.path.length - b.path.length)) {
    let node: Record<string, JsonValue> = values;
    for (const key of o.path.slice(0, -1)) {
      if (!isRecord(node[key])) node[key] = {};
      node = node[key] as Record<string, JsonValue>;
    }
    node[o.path.at(-1) as string] = structuredClone(o.value);
  }
  return values;
}

/** LumiAH's settings in the user's storage, as the user set them. */
export async function lumiahSettings(today: Today): Promise<Record<string, JsonValue>> {
  return lumiahOwn(json(await today.userView.read("harness/settings.json")));
}

/** Every leaf of a value by its dotted path: a list counts as one setting. */
function leaves(value: unknown, at: string, out: string[]): string[] {
  if (isRecord(value) && Object.keys(value).length > 0) for (const [key, v] of Object.entries(value)) leaves(v, at === "" ? key : `${at}.${key}`, out);
  else if (at !== "") out.push(at);
  return out;
}

/** Each setting that names a connection, by its dotted path: the engine's one name for a connection chosen for a kind of work (`connectionId`). */
function connectionSettings(value: unknown, at: string, out: { setting: string; connection: string }[]): { setting: string; connection: string }[] {
  if (Array.isArray(value)) value.forEach((v, i) => connectionSettings(v, `${at}.${i}`, out));
  else if (isRecord(value))
    for (const [key, v] of Object.entries(value)) {
      const path = at === "" ? key : `${at}.${key}`;
      if (key === "connectionId" && typeof v === "string" && v !== "") out.push({ setting: path, connection: v });
      else connectionSettings(v, path, out);
    }
  return out;
}

/** What LumiAH's "messages you hid" (`core.story.hidden`) says of RPE's `chat.hiddenReadable`: whether agents may read them. */
function hiddenReadable(own: Record<string, JsonValue>): boolean | null {
  const core = own.core;
  const story = isRecord(core) ? core.story : undefined;
  const hidden = isRecord(story) ? story.hidden : undefined;
  return hidden === "include" ? true : hidden === "leave_out" ? false : null;
}

/** LumiAH's connections that take one tool call per answer (`transport.connections.oneToolAtATime`), which RPH's connections say for themselves (`serialTools`). */
export function oneToolAtATime(own: Record<string, JsonValue>): Set<string> {
  const transport = own.transport;
  const connections = isRecord(transport) ? transport.connections : undefined;
  const ids = isRecord(connections) ? connections.oneToolAtATime : undefined;
  return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
}

/** The paths RPE's config takes from LumiAH's settings, and the setting each becomes. */
const LUMIAH_CARRIED: Readonly<Record<string, string>> = {
  "core.story.hidden": "RPE-global.yml: chat.hiddenReadable",
  "transport.connections.oneToolAtATime": "RPE-global.yml: models, serialTools on each connection named",
};

/**
 * Carries today's settings into the global config file at `globalConfig` (`RPE-global.yml`) where RPE
 * has a setting of the same meaning, each written under its own key and the rest of the file kept as
 * the user wrote it, and lists the others. `items` are the report's: the settings row's files and
 * entries, and the runtimes' configs.
 */
export async function carrySettings(today: Today, items: readonly Item[], globalConfig: string): Promise<SettingsCarried> {
  const out: SettingsCarried = { carried: [], noHome: [], lumiverseConnections: [] };
  const engine = json(await today.userView.read("settings.json"));
  if (isRecord(engine)) {
    for (const key of Object.keys(engine)) if (key !== "v") out.noHome.push(`settings.json: ${key}`);
    out.lumiverseConnections.push(...connectionSettings(engine, "", []).map((c) => ({ ...c, setting: `settings.json: ${c.setting}` })));
  }

  const own = lumiahOwn(json(await today.userView.read("harness/settings.json")));
  for (const path of leaves(own, "", [])) {
    const to = LUMIAH_CARRIED[path];
    if (to === undefined) out.noHome.push(`harness/settings.json: ${path}`);
    else out.carried.push({ from: `harness/settings.json: ${path}`, to });
  }
  const hidden = hiddenReadable(own);
  if (hidden !== null) {
    const text = (await readText(globalConfig)) ?? "";
    const chat = yamlMapping(text, globalConfig).chat;
    await writeWhole(globalConfig, withTopLevelKey(text, "chat", { ...(isRecord(chat) ? chat : {}), hiddenReadable: hidden }, globalConfig));
  }

  for (const item of items) {
    if (item.where === "user storage" && item.row === "settings" && item.fate === "carried" && /^(runs\/[^/]+\/prefs|harness\/story)\.json$/.test(item.path)) {
      const doc = json(await today.userView.read(item.path));
      if (isRecord(doc)) for (const key of Object.keys(doc)) if (key !== "v") out.noHome.push(`${item.path}: ${key}`);
    }
    const pref = item.where === "Lumiverse database" && item.row === "settings" ? new RegExp(`^chats/([^/]+)/${LEDGER_NAMESPACE}/prefs/([^/]+)$`).exec(item.path) : null;
    if (pref) out.noHome.push(`chat ${pref[1]}'s own choice: ${pref[2]}`);
  }

  // The runtime's own settings (`RuntimeSetup`, `H/runtime/config.ts:44-50`): RPE's config has none of them.
  for (const f of today.runtime.files) {
    const name = /^config\/([^/]+)\.json$/.exec(f.path)?.[1];
    if (name === undefined || !today.runtime.runtimes.some((r) => r.name === name)) continue;
    const doc = json(await readFile(f.disk));
    const runtime = isRecord(doc) ? doc.runtime : undefined;
    if (isRecord(runtime)) for (const key of ["tuning", "memory", "autoUpdate"]) if (runtime[key] !== undefined) out.noHome.push(`runtime ${name}: ${key}`);
  }
  return out;
}
