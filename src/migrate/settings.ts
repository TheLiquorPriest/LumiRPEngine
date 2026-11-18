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
import { RUNTIME_DEFAULTS } from "./today/lumiah/link/settings";
import { tidySettingsOf } from "./today/user-settings";
import { isRecord, type JsonValue } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { oneFileAtATime, readText, writeWhole } from "../app/disk";
import { type Setting, takenValue } from "../app/setting-list";
import { UPDATE_SETTINGS } from "../app/update";
import { LayoutRefused, withKeyAt, yamlMapping } from "../app/yaml";
import type { PutPrints } from "./connections";
import { readText as readFile } from "./files";
import { type Fate, engineFate, engineLeaves, lumiahFate, MEMORY_KEY, tuningFate } from "./setting-map";
import type { Item } from "./report";
import type { Followed } from "./tables";
import type { Today } from "./today";

/** Settings carried, those archived as steering only an old engine, settings with no home in RPE, settings RPE's like setting counts otherwise or can't take, and settings that name a connection in Lumiverse. */
export interface SettingsCarried {
  /** Where each carried setting was, and the setting it now is in RPE's config. */
  carried: { from: string; to: string }[];
  /** Settings a run carried before and the user changed in RPE since: left as RPE has them, today's value not taken. Absent from a report kept before runs told them apart. */
  keptInRpe?: { from: string; to: string }[];
  /** Today's settings RPE has a like setting for that counts something else, or takes no such value: not carried, with that setting's key and why. Absent from a report kept before runs told them. */
  notCarried?: { from: string; to: string; why: string }[];
  /** Today's settings that steered only an engine that is gone: kept in the backup, each with why. Absent from a report kept before runs told them apart. */
  archived?: { from: string; why: string }[];
  /** What a later run did about a setting reset or removed on today's side since an earlier run: followed in RPE's file where RPE's value is still the one a run put there, else left as RPE has it. */
  followed?: Followed[];
  /** Today's settings with no setting of the same meaning in RPE, by where they are and their name. */
  noHome: string[];
  /** Today's settings that name a connection that lives in Lumiverse: where each is, and the connection's id there. */
  lumiverseConnections: { setting: string; connection: string }[];
}

/** LumiAH's settings as the user set them: each value they put whole at a path (`Own`), the nearer the root first, so a deeper one stands over it (`valuesOf`). */
export function lumiahOwn(raw: unknown): Record<string, JsonValue> {
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
  return lumiahOwn(await today.userView.json("harness/settings.json"));
}

/** Every leaf of a value by its dotted path, with its value: a list counts as one setting. */
function leaves(value: unknown, at: string, out: [string, unknown][]): [string, unknown][] {
  if (isRecord(value) && Object.keys(value).length > 0) for (const [key, v] of Object.entries(value)) leaves(v, at === "" ? key : `${at}.${key}`, out);
  else if (at !== "") out.push([at, value]);
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

/** LumiAH's history cutoff as it ships (`H/link/settings.ts:260`), for the part of it a user left as it was: the latest 40 messages kept. */
const LUMIAH_HISTORY = { keep: "last", count: 40 } as const;

/** The connection of RPE's that the connection of today's with this id is, or null where RPE holds none for it. */
export type ConnectionOf = (id: string) => string | null;

/** A throttle of today's on one connection (`core.connections.throttles.<connection>.<field>`), by its field, and RPE's setting of the same meaning for one connection. */
const THROTTLE = /^core\.connections\.throttles\.([^.]+)\.(requestsPerMinute|tokensPerMinute|atOnce)$/;
const throttleKey = (connection: string, field: string): string => `connections.${connection}.throttles.${field}`;

/** The setting RPE declares for `key`: the one of that key, or the one whose key has a `<name>` where `key` has a name (a setting for one connection, or one definition, at a time). */
function declaredFor<T extends { key: string }>(known: readonly T[], key: string): T | undefined {
  const exact = known.find((d) => d.key === key);
  if (exact !== undefined) return exact;
  return known.find((d) => d.key.includes("<") && new RegExp(`^${d.key.split(/<[^>]*>/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^.]+")}$`).test(key));
}

/** A value for one of RPE's settings, from today's settings at `from`. */
interface Put {
  from: string[];
  to: string;
  value: JsonValue;
}

/**
 * Carries today's settings into the global config file at `globalConfig` (`RPE-global.yml`) where RPE
 * has a setting of the same meaning, each written under its own key and the rest of the file kept as
 * the user wrote it, and says what becomes of every other one (`setting-map.ts`). `items` are the report's: the
 * settings row's files and entries, and the runtimes' configs. `earlier` is what earlier runs put into
 * RPE's documents (`migration_put`); with what was carried comes what this run put there, to be kept for
 * the next. `registry` is every setting RPE's areas and RPH declare, which takes each value as its own
 * reader takes it; without it only RPH's list and the update's are known, and a value for another key
 * is written as it is. `connection` says which connection of RPE's a connection of today's is (the one
 * its settings of that connection are carried to); absent, none is.
 */
export async function carrySettings(today: Today, items: readonly Item[], globalConfig: string, earlier: PutPrints, registry?: readonly Setting[], connection?: ConnectionOf): Promise<{ carried: SettingsCarried; put: Map<string, string>; drop: Set<string> }> {
  const known = registry ?? [...HARNESS_SETTINGS, ...UPDATE_SETTINGS];
  const keptInRpe: SettingsCarried["carried"] = [];
  const notCarried: NonNullable<SettingsCarried["notCarried"]> = [];
  const archived: NonNullable<SettingsCarried["archived"]> = [];
  const followed: Followed[] = [];
  const out: SettingsCarried = { carried: [], keptInRpe, notCarried, archived, followed, noHome: [], lumiverseConnections: [] };
  const put = new Map<string, string>();
  /** What a run put before that this one followed out of RPE's file: its print is let go. */
  const drop = new Set<string>();
  const puts: Put[] = [];
  /** Files one of today's settings where its fate says: into RPE's setting, or named as not carried, archived or without a counterpart. */
  const settle = (from: string, fate: Fate, value: JsonValue): void => {
    if ("unlike" in fate) notCarried.push({ from, to: fate.to, why: fate.unlike });
    else if ("to" in fate) puts.push({ from: [from], to: fate.to, value: fate.seconds === true && typeof value === "number" ? value / 1000 : fate.books === true && value === "auto" ? ["auto"] : value });
    else if ("archived" in fate) archived.push({ from, why: fate.archived });
    else out.noHome.push(from);
  };
  const engine = await today.userView.json("settings.json");
  let readSome = engine !== null;
  if (isRecord(engine)) {
    for (const [key, value] of Object.entries(engine)) {
      if (key === "v") continue;
      // His tidy-up's most findings a run puts, as today's reader takes it, into the setting of the same meaning.
      if (key === "tidy") {
        puts.push({ from: ["settings.json: tidy.findings"], to: "things.maxTidyFindings", value: tidySettingsOf(value).findings });
        continue;
      }
      // A group some of whose leaves have a setting of the same meaning: those leaves are settled one by one, and the group's own fate names the rest.
      const inside = engineLeaves(key);
      if (inside.length === 0) {
        settle(`settings.json: ${key}`, engineFate(key), value as JsonValue);
        continue;
      }
      const present = new Map(leaves(value, key, []));
      for (const [path, fate] of inside) if (present.has(path)) settle(`settings.json: ${path}`, fate, present.get(path) as JsonValue);
      if ([...present.keys()].some((path) => !inside.some(([named]) => named === path))) settle(`settings.json: ${key}`, engineFate(key), value as JsonValue);
    }
    // The connections these name are found and matched with RPE's by `model-choices.ts`.
  }

  const history: { from: string[]; keep: unknown; count: unknown } = { from: [], keep: LUMIAH_HISTORY.keep, count: LUMIAH_HISTORY.count };
  const harness = await today.userView.json("harness/settings.json");
  if (harness !== null) readSome = true;
  for (const [path, value] of leaves(lumiahOwn(harness), "", [])) {
    const from = `harness/settings.json: ${path}`;
    // Today's "messages you hid": whether agents may read them.
    if (path === "core.story.hidden") {
      if (value === "include" || value === "leave_out") puts.push({ from: [from], to: "history.hiddenReadable", value: value === "include" });
      else notCarried.push({ from, to: "history.hiddenReadable", why: "the previous build's is neither include nor leave_out" });
    }
    // Today's history cutoff becomes the history window, with the number it keeps now (§15.2); every message kept is `~`.
    else if (path === "transport.history.keep" || path === "transport.history.count") {
      history.from.push(from);
      if (path.endsWith("keep")) history.keep = value;
      else history.count = value;
    } else if (path === "transport.connections.oneToolAtATime") out.carried.push({ from, to: SERIAL_TOOLS });
    else if (THROTTLE.test(path)) {
      // A throttle he set on a connection goes to the throttle of the connection of RPE's that one is (the same id, or the same provider, model and address); with none, it is named, as the model choices name that connection.
      const [, id = "", field = ""] = THROTTLE.exec(path) ?? [];
      const to = connection?.(id) ?? null;
      if (to === null || to.includes(".")) notCarried.push({ from, to: throttleKey("<connection>", field), why: "RPE holds no connection for the one it is set on (listed with the model choices), so there is no connection to set it for" });
      else puts.push({ from: [from], to: throttleKey(to, field), value: value as JsonValue });
    } else settle(from, lumiahFate(path), value as JsonValue);
  }
  if (history.from.length > 0) {
    const kept = history.keep === "all" ? null : history.count;
    if (kept === null || (typeof kept === "number" && Number.isInteger(kept) && kept >= 1)) puts.push({ from: history.from, to: "history.window", value: kept });
    else for (const from of history.from) notCarried.push({ from, to: "history.window", why: "the previous build's cutoff keeps no whole number of messages, at least 1" });
  }

  // Each chat's own choices are carried with the chat (`chat-settings.ts`), the engine's on its record: what is left here has no counterpart.
  const withChat: Readonly<Record<string, true>> = { mapDisplay: true, tidyLeft: true, knowledge: true, narrator: true, tidy: true, engine: true };
  for (const item of items) {
    if (item.where === "user storage" && item.row === "settings" && item.fate === "carried" && /^(runs\/[^/]+\/prefs|harness\/story)\.json$/.test(item.path)) {
      const doc = await today.userView.json(item.path);
      if (isRecord(doc)) for (const key of Object.keys(doc)) if (key !== "v" && !(item.path.startsWith("runs/") && Object.hasOwn(withChat, key))) out.noHome.push(`${item.path}: ${key}`);
    }
    const pref = item.where === "Lumiverse database" && item.row === "settings" ? new RegExp(`^chats/([^/]+)/${LEDGER_NAMESPACE}/prefs/([^/]+)$`).exec(item.path) : null;
    if (pref && !Object.hasOwn(withChat, pref[2] ?? "")) out.noHome.push(`chat ${pref[1]}'s own choice: ${pref[2]}`);
  }

  // The runtime's own settings (`RuntimeSetup`, `H/runtime/config.ts:44-50`): its memory limit is RPE's `service.memory`, each field of its tuning has its own fate, and whether it takes a new build by itself once nothing is under way is RPE's `update.restart`.
  for (const f of today.runtime.files) {
    const name = /^config\/([^/]+)\.json$/.exec(f.path)?.[1];
    if (name === undefined || !today.runtime.runtimes.some((r) => r.name === name)) continue;
    // Its config read whole as the runtime was found (`readRuntimeFolders`): one that no longer reads was changed under the run, which stops it.
    const text = await readFile(f.disk);
    const doc = text === null ? null : (JSON.parse(text) as unknown);
    const runtime = isRecord(doc) ? doc.runtime : undefined;
    if (!isRecord(runtime)) continue;
    readSome = true;
    if (typeof runtime.memory === "string") puts.push({ from: [`runtime ${name}: memory`], to: MEMORY_KEY, value: runtime.memory });
    else if (runtime.memory !== undefined) out.noHome.push(`runtime ${name}: memory`);
    // The runtime writes its whole tuning back whenever any field changes (`keepTuning`), so a field at today's own default is no choice of his: RPE's own default stands for it, and it is named, not carried.
    for (const [field, value] of Object.entries(isRecord(runtime.tuning) ? runtime.tuning : {})) {
      if (Object.hasOwn(RUNTIME_DEFAULTS, field) && value === (RUNTIME_DEFAULTS as Record<string, unknown>)[field]) archived.push({ from: `runtime ${name}: tuning.${field}`, why: "it is at the previous build's own default, which is no choice of yours: RPE's own default for the setting of that meaning stands" });
      else settle(`runtime ${name}: tuning.${field}`, tuningFate(field), value as JsonValue);
    }
    if (runtime.autoUpdate !== undefined) puts.push({ from: [`runtime ${name}: autoUpdate`], to: "update.restart", value: runtime.autoUpdate as JsonValue });
  }

  // Each value into RPE-global.yml where RPE's setting takes it: where RPE has no value and no run put one, or RPE's is still the one a run put there. The file's one lock is held, as every writer of it holds it.
  await oneFileAtATime(globalConfig, async () => {
    const before = (await readText(globalConfig)) ?? "";
    const config = yamlMapping(before, globalConfig);
    let text = before;
    for (const p of puts) {
      // As the app's registry declares the setting, the value as it takes it; and none, for a setting none holds where nothing sets it and no file may set `~` for: nothing is written, and RPE's own none holds.
      const def = declaredFor(known, p.to);
      let value: JsonValue | undefined = p.value;
      if (def === undefined && registry !== undefined) {
        for (const from of p.from) notCarried.push({ from, to: p.to, why: `RPE declares no setting ${p.to}` });
        continue;
      }
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
    // What a run carried before that today's side no longer gives (reset or removed since): taken out of RPE's file where RPE's value is still the one a run put there, else left as RPE has it; named either way. Only while some file of today's settings is still read: with none, nothing can be said of what was reset.
    if (readSome) {
      const given = new Set(puts.map((p) => `setting ${p.to}`));
      for (const [what, was] of earlier) {
        if (!what.startsWith("setting ") || given.has(what)) continue;
        const key = what.slice("setting ".length);
        const path = key.split(".");
        let ours: unknown = config;
        for (const part of path) ours = isRecord(ours) ? ours[part] : undefined;
        drop.add(what);
        if (ours === undefined) continue;
        const to = `RPE-global.yml: ${key}`;
        const change = "reset or removed on the previous build's side since an earlier run";
        if (hashJson(ours) !== was) {
          followed.push({ what: to, change, followed: false });
          continue;
        }
        try {
          text = withKeyAt(text, path, undefined, globalConfig);
          followed.push({ what: to, change, followed: true });
        } catch (error) {
          if (!(error instanceof LayoutRefused)) throw error;
          followed.push({ what: to, change: `${change}; ${error.message}`, followed: false });
        }
      }
    }
    if (text !== before) await writeWhole(globalConfig, text);
  });
  return { carried: out, put, drop };
}
