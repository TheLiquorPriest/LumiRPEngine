// Your settings (STANDALONE-PLAN §15.2, "Your settings", "Which model each kind of work uses" and
// "The runtime's own settings"): each of today's settings goes into RPE's config where RPE has a
// setting of the same meaning, its value converted where the unit differs (LumiAH keeps times in
// milliseconds, RPE in seconds), and every other one is listed by name: as having no home in RPE yet,
// or, where RPE's like setting counts something else or takes no such value, as not carried, with why.
// A setting that names a connection living in Lumiverse is listed for the user, with the connection
// it names: RPE calls models through its own connections and can't use one kept in Lumiverse.
// A later run replaces a setting a run carried only while RPE's value is still what a run put there
// (its fingerprint, kept by the run): one the user changed in RPE is left as it is, and listed.
//
// Today's settings are read where today's build keeps them: the engine's `settings.json`, each chat's
// `runs/<chat>/prefs.json` and its own choices in the chat's metadata, LumiAH's `harness/settings.json`
// (only what the user changed, each a value put whole at a path: `H/extension/backend/settings.ts`)
// and `harness/story.json`, and each runtime's config.

import { SETTINGS as HARNESS_SETTINGS } from "rp-harness/helpers";
import { hashJson } from "../shared/hash";
import { isRecord, type JsonValue } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { oneFileAtATime, readText, writeWhole } from "../app/disk";
import { takenValue } from "../app/setting-list";
import { UPDATE_SETTINGS } from "../app/update";
import { LayoutRefused, withKeyAt, yamlMapping } from "../app/yaml";
import type { PutPrints } from "./connections";
import { readText as readFile } from "./files";
import type { Item } from "./report";
import type { Today } from "./today";

/** Settings carried, settings with no home in RPE yet, settings RPE's like setting counts otherwise or can't take, and settings that name a connection in Lumiverse. */
export interface SettingsCarried {
  /** Where each carried setting was, and the setting it now is in RPE's config. */
  carried: { from: string; to: string }[];
  /** Settings a run carried before and the user changed in RPE since: left as RPE has them, today's value not taken. Absent from a report kept before runs told them apart. */
  keptInRpe?: { from: string; to: string }[];
  /** Today's settings RPE has a like setting for that counts something else, or takes no such value: not carried, with that setting's key and why. Absent from a report kept before runs told them. */
  notCarried?: { from: string; to: string; why: string }[];
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

/** Every leaf of a value by its dotted path, with its value: a list counts as one setting. */
function leaves(value: unknown, at: string, out: [string, unknown][]): [string, unknown][] {
  if (isRecord(value) && Object.keys(value).length > 0) for (const [key, v] of Object.entries(value)) leaves(v, at === "" ? key : `${at}.${key}`, out);
  else if (at !== "") out.push([at, value]);
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

/** Where LumiAH's settings put `transport.connections.oneToolAtATime`, which the connections' carry writes (`connections.ts`). */
const SERIAL_TOOLS = "RPE-global.yml: models, serialTools on each connection named";

/** LumiAH's connections that take one tool call per answer (`transport.connections.oneToolAtATime`), which RPH's connections say for themselves (`serialTools`). */
export function oneToolAtATime(own: Record<string, JsonValue>): Set<string> {
  const transport = own.transport;
  const connections = isRecord(transport) ? transport.connections : undefined;
  const ids = isRecord(connections) ? connections.oneToolAtATime : undefined;
  return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
}

/**
 * What RPE's settings a run writes take, as their readers declare them: RPH's own list and the update's.
 * The turn lane's two a run writes, `chat.hiddenReadable` and `history.window`, are declared where the
 * migration may not reach (`test/standalone-boundaries.test.ts`): their values are made to fit where
 * they are read from today's.
 */
const RPE_SETTINGS = [...HARNESS_SETTINGS, ...UPDATE_SETTINGS];

/**
 * LumiAH's settings RPE has a setting of the same meaning for (RPH kept most of them from it: its
 * `src/harness/settings/`), by their paths in its sections (`H/core/settings.ts`): the setting each
 * becomes, and for a time, that LumiAH keeps it in milliseconds where RPE takes seconds.
 */
const LUMIAH_SAME: Readonly<Record<string, { to: string; seconds?: true }>> = {
  "core.turn.tokensOut": { to: "limits.turn.tokensOut" },
  "core.turn.wallMs": { to: "limits.turn.time", seconds: true },
  "core.delegation.depth": { to: "limits.turn.depth" },
  "core.delegation.perRun": { to: "limits.turn.agents" },
  "core.loop.clipChars": { to: "results.clip" },
  "core.session.keepTurns": { to: "compaction.keepTurns" },
  "core.jobs.atOnce": { to: "jobs.atOnce" },
  "core.jobs.perRun": { to: "jobs.perRun" },
  "core.jobs.budget.tokensOut": { to: "jobs.run.tokensOut" },
  "core.jobs.budget.wallMs": { to: "jobs.run.time", seconds: true },
};

const CACHED = "today's counted a token read again from a provider's cache as a share of one (core.spend.cachedWeight); RPE's counts every token sent in full";
const ROUNDS = "today's counted the answers that called tools; RPE's counts every model call";

/** LumiAH's settings RPE has a like setting for that counts something else, so that no value of theirs means the same there: the RPE setting, and why. */
const LUMIAH_UNLIKE: Readonly<Record<string, { to: string; why: string }>> = {
  "core.turn.tokensIn": { to: "limits.turn.tokensIn", why: CACHED },
  "core.jobs.budget.tokensIn": { to: "jobs.run.tokensIn", why: CACHED },
  "core.turn.toolTurns": { to: "limits.turn.calls", why: ROUNDS },
  "core.jobs.budget.toolTurns": { to: "jobs.run.calls", why: ROUNDS },
  "core.jobs.tokensPerDay": { to: "jobs.tokensPerDay", why: "today's counted the tokens of any 24 hours; RPE's counts those of the user's day" },
  "core.spend.cachedWeight": { to: "jobs.cachedWeight", why: "today's weighed every limit on tokens sent by it; RPE's weighs only the jobs' tokens of the user's day" },
  "core.reply.progress": { to: "progress.show", why: "today's, off, showed no progress line; RPE's least still shows the one that keeps a silent turn alive" },
};

/** LumiAH's history cutoff as it ships (`H/link/settings.ts:260`), for the part of it a user left as it was: the latest 40 messages kept. */
const LUMIAH_HISTORY = { keep: "last", count: 40 } as const;

/** A value for one of RPE's settings, from today's settings at `from`. */
interface Put {
  from: string[];
  to: string;
  value: JsonValue;
}

/**
 * Carries today's settings into the global config file at `globalConfig` (`RPE-global.yml`) where RPE
 * has a setting of the same meaning, each written under its own key and the rest of the file kept as
 * the user wrote it, and lists the others. `items` are the report's: the settings row's files and
 * entries, and the runtimes' configs. `earlier` is what earlier runs put into RPE's documents
 * (`migration_put`); with what was carried comes what this run put there, to be kept for the next.
 */
export async function carrySettings(today: Today, items: readonly Item[], globalConfig: string, earlier: PutPrints): Promise<{ carried: SettingsCarried; put: Map<string, string> }> {
  const keptInRpe: SettingsCarried["carried"] = [];
  const notCarried: NonNullable<SettingsCarried["notCarried"]> = [];
  const out: SettingsCarried = { carried: [], keptInRpe, notCarried, noHome: [], lumiverseConnections: [] };
  const put = new Map<string, string>();
  const engine = json(await today.userView.read("settings.json"));
  if (isRecord(engine)) {
    for (const key of Object.keys(engine)) if (key !== "v") out.noHome.push(`settings.json: ${key}`);
    out.lumiverseConnections.push(...connectionSettings(engine, "", []).map((c) => ({ ...c, setting: `settings.json: ${c.setting}` })));
  }

  const puts: Put[] = [];
  const history: { from: string[]; keep: unknown; count: unknown } = { from: [], keep: LUMIAH_HISTORY.keep, count: LUMIAH_HISTORY.count };
  for (const [path, value] of leaves(lumiahOwn(json(await today.userView.read("harness/settings.json"))), "", [])) {
    const from = `harness/settings.json: ${path}`;
    const same = LUMIAH_SAME[path];
    const unlike = LUMIAH_UNLIKE[path];
    // Today's "messages you hid": whether agents may read them.
    if (path === "core.story.hidden") {
      if (value === "include" || value === "leave_out") puts.push({ from: [from], to: "chat.hiddenReadable", value: value === "include" });
      else notCarried.push({ from, to: "chat.hiddenReadable", why: "today's is neither include nor leave_out" });
    }
    // Today's history cutoff becomes the history window, with the number it keeps now (§15.2); every message kept is `~`.
    else if (path === "transport.history.keep" || path === "transport.history.count") {
      history.from.push(from);
      if (path.endsWith("keep")) history.keep = value;
      else history.count = value;
    } else if (path === "transport.connections.oneToolAtATime") out.carried.push({ from, to: SERIAL_TOOLS });
    else if (same !== undefined) puts.push({ from: [from], to: same.to, value: same.seconds === true && typeof value === "number" ? value / 1000 : (value as JsonValue) });
    else if (unlike !== undefined) notCarried.push({ from, to: unlike.to, why: unlike.why });
    else out.noHome.push(from);
  }
  if (history.from.length > 0) {
    const kept = history.keep === "all" ? null : history.count;
    if (kept === null || (typeof kept === "number" && Number.isInteger(kept) && kept >= 1)) puts.push({ from: history.from, to: "history.window", value: kept });
    else for (const from of history.from) notCarried.push({ from, to: "history.window", why: "today's cutoff keeps no whole number of messages, at least 1" });
  }

  for (const item of items) {
    if (item.where === "user storage" && item.row === "settings" && item.fate === "carried" && /^(runs\/[^/]+\/prefs|harness\/story)\.json$/.test(item.path)) {
      const doc = json(await today.userView.read(item.path));
      if (isRecord(doc)) for (const key of Object.keys(doc)) if (key !== "v") out.noHome.push(`${item.path}: ${key}`);
    }
    const pref = item.where === "Lumiverse database" && item.row === "settings" ? new RegExp(`^chats/([^/]+)/${LEDGER_NAMESPACE}/prefs/([^/]+)$`).exec(item.path) : null;
    if (pref) out.noHome.push(`chat ${pref[1]}'s own choice: ${pref[2]}`);
  }

  // The runtime's own settings (`RuntimeSetup`, `H/runtime/config.ts:44-50`): whether it takes a new build by itself once nothing is under way is RPE's `update.restart`; RPE's config has none of the others.
  for (const f of today.runtime.files) {
    const name = /^config\/([^/]+)\.json$/.exec(f.path)?.[1];
    if (name === undefined || !today.runtime.runtimes.some((r) => r.name === name)) continue;
    const doc = json(await readFile(f.disk));
    const runtime = isRecord(doc) ? doc.runtime : undefined;
    if (!isRecord(runtime)) continue;
    for (const key of ["tuning", "memory"]) if (runtime[key] !== undefined) out.noHome.push(`runtime ${name}: ${key}`);
    if (runtime.autoUpdate !== undefined) puts.push({ from: [`runtime ${name}: autoUpdate`], to: "update.restart", value: runtime.autoUpdate as JsonValue });
  }

  // Each value into RPE-global.yml where RPE's setting takes it: where RPE has no value and no run put one, or RPE's is still the one a run put there. The file's one lock is held, as every writer of it holds it.
  await oneFileAtATime(globalConfig, async () => {
    const before = (await readText(globalConfig)) ?? "";
    const config = yamlMapping(before, globalConfig);
    let text = before;
    for (const p of puts) {
      // Where the app declares the setting, the value as it takes it; and none, for a setting none holds where nothing sets it and no file may set `~` for: nothing is written, and RPE's own none holds.
      const def = RPE_SETTINGS.find((d) => d.key === p.to);
      let value: JsonValue | undefined = p.value;
      if (def !== undefined && p.value === null && def.default === null && def.orNone !== true) value = undefined;
      else if (def !== undefined) {
        const taken = takenValue(def, p.value, p.to, true);
        if (!taken.ok) {
          for (const from of p.from) notCarried.push({ from, to: p.to, why: taken.why });
          continue;
        }
        value = taken.value;
      }
      const path = p.to.split(".");
      let ours: unknown = config;
      for (const part of path) ours = isRecord(ours) ? ours[part] : undefined;
      const what = `setting ${p.to}`;
      const was = earlier.get(what);
      // An unset key prints apart from `~`: where RPE's default is not none, the two read differently.
      const print = value === undefined ? "" : hashJson(value);
      const held = ours === undefined ? "" : hashJson(ours);
      const to = `RPE-global.yml: ${p.to}`;
      if (held === print || (was === undefined ? ours === undefined : held === was)) {
        if (held !== print) {
          try {
            text = withKeyAt(text, path, value, globalConfig);
          } catch (error) {
            // A layout of his file the splice does not follow: the value is not carried, and his comments stay.
            if (!(error instanceof LayoutRefused)) throw error;
            for (const from of p.from) notCarried.push({ from, to: p.to, why: error.message });
            continue;
          }
        }
        put.set(what, print);
        for (const from of p.from) out.carried.push({ from, to });
      } else for (const from of p.from) keptInRpe.push({ from, to });
    }
    if (text !== before) await writeWhole(globalConfig, text);
  });
  return { carried: out, put };
}
