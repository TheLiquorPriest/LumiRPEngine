// The runtime's own folders on the server (LumiAH's runtime, built into today's build), read without
// changing them: its config, its own folder (connections, keys, its working copy of the user's
// documents), the copy of the runtime its service runs, and the service unit. One account may hold
// several runtimes of this extension, one per Lumiverse user and per Lumiverse; the run takes the
// one this user registered with this Lumiverse, as today's extension tells its runtimes apart: the
// registration in the user's own storage names the runtime and holds the hash of its secret, which
// the runtime's config holds. Every other runtime is left alone: its config is read to tell whose it
// is, and nothing else of it is read, kept or backed up.
//
// The working copy is where the runtime's writes land first; they reach the extension's storage
// afterwards. What its journal still names is waiting to be sent, and it is the freshest version of
// those documents and blobs (LumiAH `runtime/store/index.ts`, its header and `load`, `claim`). The
// migration lays it over the user's storage, as today's runtime would send it, unless today's
// runtime would throw it away at its next start: a copy the storage's mark doesn't name while the
// storage names none, or one behind the count the mark took from it (a copy restored or moved).

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { BLOB_HASH, DOC_PATH, EXTENSION_IDENTIFIER, MARK_PATH, RUNTIME_NAME, unitName } from "lumi-ah/link";
import { configDir, configOf, type RuntimeConfig } from "lumi-ah/runtime";
import { isRecord } from "../shared/json";
import { walk, type FoundFile } from "../app/archive";
import { missing, readText, sha256 } from "./files";

/** Where the runtimes keep their configs and their data. */
export interface RuntimeFolders {
  configDir: string;
  dataDir: string;
}

/**
 * The runtime's folders as today's runtime finds them for an account (`H/runtime/config.ts:64-82`):
 * `$XDG_CONFIG_HOME/lumiah` and `$XDG_DATA_HOME/lumiah` where those are absolute, else under home.
 */
export function runtimeFoldersOf(env: Readonly<Record<string, string | undefined>>, home: string): RuntimeFolders {
  const data = env.XDG_DATA_HOME;
  return { configDir: configDir(env, home), dataDir: `${data !== undefined && data.startsWith("/") ? data : `${home}/.local/share`}/lumiah` };
}

/**
 * A runtime's config as today's runtime reads it (`configOf`, `H/runtime/config.ts:138-165`): what it
 * runs with, the file it was set up from, and the unit that keeps it running (`runtimeUnit`).
 */
export type SavedRuntime = RuntimeConfig & { source: string | null; service: { unit: string; file: string; script: string } | null };

/** The copy of the runtime a unit of this extension runs where no unit names another: the one `lumiah up --systemd` installs (`installedPath`, `H/runtime/config.ts:98`). */
function installedScript(dataDir: string, identifier: string): string {
  return join(dataDir, identifier === EXTENSION_IDENTIFIER ? "" : identifier, "lumiah.js");
}

/**
 * The unit that keeps a runtime running, as today's build finds it (`unitRunning`,
 * `H/runtime/update/service.ts:70-93`): the one its config names; else, for a config written before
 * `lumiah up --systemd` recorded its unit, the one that line installs for it (`lumiah-<name>.service`,
 * running the copy it installs), in the account's user units, which sit beside the configs' folder
 * (`unitPath`, `configDir`: both under `$XDG_CONFIG_HOME`, else `~/.config`), where its file is there.
 * Such a config's memory cap is in that unit alone, which is why the unit is kept and backed up.
 */
export function runtimeUnit(config: SavedRuntime, folders: RuntimeFolders): SavedRuntime["service"] {
  if (config.service !== null) return config.service;
  const unit = unitName(config.name);
  const file = join(dirname(folders.configDir), "systemd", "user", unit);
  return existsSync(file) ? { unit, file, script: installedScript(folders.dataDir, config.extension) } : null;
}

/** The config of this extension's runtime `name` in `folders`, as today's runtime reads it, with the unit that keeps it running (`runtimeUnit`); null where no config there reads as that runtime. */
export async function runtimeConfig(folders: RuntimeFolders, identifier: string, name: string): Promise<SavedRuntime | null> {
  for (const f of (await walk(folders.configDir)).filter((f) => !f.path.includes("/") && f.path.endsWith(".json"))) {
    const disk = join(folders.configDir, f.path);
    let config: SavedRuntime;
    try {
      config = configOf(await readText(disk), disk);
    } catch {
      // A config that doesn't read is no runtime's here.
      continue;
    }
    if (config.name === name && config.extension === identifier) return { ...config, service: runtimeUnit(config, folders) };
  }
  return null;
}

/** A working copy's folder for one user's data of one extension on one Lumiverse (`H/runtime/store/index.ts:307`, `runtime.ts:223-224`). */
export function copyFolderOf(base: string, username: string, identifier: string): string {
  return sha256(JSON.stringify([base, username, identifier])).slice(0, 32);
}

/** A file of the runtime's folders: its path as the classifier reads it (`config/`, `runtimes/<name>/`, `installed/`, `unit/`), and where it is on the disk. */
export interface RuntimeFile extends FoundFile {
  disk: string;
}

/** What a working copy holds that the extension's storage doesn't have yet, by the user-storage path it goes to: a text, or a removal (null). */
export interface Unsent {
  /** The runtime it belongs to. */
  runtime: string;
  /** By user-storage path (`harness/docs/…`, `harness/blobs/…`). */
  files: Map<string, string | null>;
  /** Whether today's runtime sends them, or throws them away at its next start, and why. */
  kept: boolean;
  why: string;
}

/** Whose runtime a run takes: the user's name in Lumiverse, the text of their registry of runtimes in this Lumiverse's storage (`harness/registry.json`; null where there is none), and the runtime the run was told to take (`--runtime`; null where none was named). */
export interface RuntimeOwner {
  username: string | null;
  registry: string | null;
  named: string | null;
}

/** A runtime the run took, and why it is this user's. */
export interface TakenRuntime {
  name: string;
  config: SavedRuntime;
  why: string;
}

/** What the runtime's folders hold for this extension and this user. */
export interface RuntimeRead {
  /** The runtime the run takes, with its config as today's runtime reads it: at most one. */
  runtimes: TakenRuntime[];
  /** The taken runtime's files; nothing of any other runtime's. */
  files: RuntimeFile[];
  /** What the taken runtime's working copy of this user's data hasn't sent. */
  unsent: Unsent[];
  /** Every other runtime of this extension here, and every config that can't be read, by name, with why it is not taken. */
  leftAlone: { name: string; why: string }[];
  /** Why the run can't tell which runtime is this user's, and how to tell it; null where it can. */
  undecided: string | null;
}

/** A mark as the mirror keeps it (`markOf`, `H/runtime/store/index.ts:269-272`). */
function markOf(raw: unknown): { copy: string; count: number } | null {
  if (!isRecord(raw) || raw.v !== 1 || raw.kind !== "mirror" || typeof raw.copy !== "string" || typeof raw.owner !== "string" || typeof raw.at !== "number") return null;
  return { copy: raw.copy, count: typeof raw.count === "number" && Number.isSafeInteger(raw.count) && raw.count >= 0 ? raw.count : 0 };
}

function parse(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * The runtimes a user has registered with this Lumiverse, as today's extension reads its registry
 * (`registryOf`, LumiAH `extension/backend/registry.ts:53-65`): each registration's id and the
 * SHA-256 of its secret. Null where there is no registry, or none that today's extension reads.
 */
function registrations(text: string | null): Map<string, string> | null {
  const raw = parse(text);
  if (!isRecord(raw) || raw.v !== 1) return null;
  const out = new Map<string, string>();
  if (!isRecord(raw.relays)) return out;
  for (const [id, r] of Object.entries(raw.relays)) {
    if (isRecord(r) && typeof r.name === "string" && typeof r.secret === "string" && typeof r.port === "number" && Number.isInteger(r.port) && r.port >= 1 && r.port <= 65535) out.set(id, r.secret);
  }
  return out;
}

async function names(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
}

/** The files of a folder that sit beside `name`: itself, and what a write of it left behind (`<name>.<anything>.tmp`). */
async function beside(dir: string, name: string, label: string): Promise<RuntimeFile[]> {
  return (await walk(dir)).filter((f) => f.path === name || (f.path.startsWith(`${name}.`) && f.path.endsWith(".tmp") && !f.path.includes("/"))).map((f) => ({ ...f, path: `${label}/${f.path}`, disk: join(dir, f.path) }));
}

/**
 * What a working copy hasn't sent (`load`, `H/runtime/store/index.ts:565-591`): each journal entry
 * names a document (`d.<sha256 of its path>`, holding the path) or a blob (`b.<hash>`); one whose
 * file isn't on the disk is a write cut off before it happened, and is no change. A document's empty
 * file is a removal.
 */
async function unsentOf(copyDir: string): Promise<Map<string, string | null>> {
  const files = new Map<string, string | null>();
  for (const name of await names(join(copyDir, "journal"))) {
    if (name.startsWith("b.") && BLOB_HASH.test(name.slice(2))) {
      const hash = name.slice(2);
      const text = await readText(join(copyDir, "blobs", hash.slice(0, 2), hash));
      if (text !== null) files.set(`harness/blobs/${hash.slice(0, 2)}/${hash}`, text);
      continue;
    }
    const held = parse(await readText(join(copyDir, "journal", name)));
    if (!isRecord(held) || typeof held.path !== "string" || !DOC_PATH.test(held.path) || held.path === MARK_PATH || name !== `d.${sha256(held.path)}`) continue;
    const text = await readText(join(copyDir, "docs", held.path));
    if (text !== null) files.set(`harness/docs/${held.path}`, text === "" ? null : text);
  }
  return files;
}

/**
 * Reads the runtime's folders for one extension and one user: the one runtime that is the user's
 * (`owner`), whole, and of every other one no more than its config. `mirrorMark` is the text of the
 * mark in the extension's storage (`harness/docs/mirror.json`), null when there is none.
 */
export async function readRuntimeFolders(folders: RuntimeFolders, identifier: string, owner: RuntimeOwner, mirrorMark: string | null): Promise<RuntimeRead> {
  const out: RuntimeRead = { runtimes: [], files: [], unsent: [], leftAlone: [], undecided: null };
  // Every config here is read to tell whose runtime it is: it names its extension, the user it signs in as, and its registration.
  const ours: { name: string; config: SavedRuntime; file: string }[] = [];
  const unreadable: string[] = [];
  const configured = new Set<string>();
  for (const f of (await walk(folders.configDir)).filter((f) => !f.path.includes("/") && f.path.endsWith(".json"))) {
    const disk = join(folders.configDir, f.path);
    configured.add(f.path.slice(0, -".json".length));
    let config: SavedRuntime;
    try {
      config = configOf(await readText(disk), disk);
    } catch {
      unreadable.push(f.path.slice(0, -".json".length));
      continue;
    }
    configured.add(config.name);
    if (config.extension === identifier) ours.push({ name: config.name, config, file: f.path });
  }
  const regs = registrations(owner.registry);
  const sameUser = (c: { config: SavedRuntime }): boolean => owner.username !== null && c.config.session.username === owner.username;
  // Its registration (`register`, LumiAH `extension/backend/relays.ts:185-220`) is kept in this user's storage of this Lumiverse, under the id its config holds, with its secret's hash.
  const registered = (c: { config: SavedRuntime }): boolean => regs?.get(c.config.relay) === sha256(c.config.secret);
  let taken: (typeof ours)[number] | null = null;
  let why = "";
  if (owner.named !== null) {
    const named = owner.named;
    const found = ours.find((c) => c.name === named);
    if (found === undefined) out.undecided = unreadable.includes(named) ? `The config of the runtime ${named} can't be read, so this run can't take it: set it up again with today's install line, or run with --no-runtime.` : `There is no runtime ${named} of this extension in ${folders.configDir}${ours.length > 0 ? `: there are ${ours.map((c) => c.name).join(", ")}` : ""}.`;
    else if (!sameUser(found)) out.undecided = `The runtime ${named} signs in to Lumiverse as another user, so its connections and keys are not this user's: this run doesn't take it.`;
    // A name the user shares on another Lumiverse is no proof: where their storage keeps registrations, a runtime named is taken only as one of them, as one found by itself is. Where it keeps none, the name is all there is to tell it by, and the line names it.
    else if (regs !== null && !registered(found)) out.undecided = `The runtime ${named} signs in as this user's name, but is not registered with this Lumiverse for this user (another Lumiverse's runtime, or one whose registration was replaced), so its connections and keys may be another's: this run doesn't take it. Register it with this Lumiverse with today's install line, or run with --no-runtime.`;
    else [taken, why] = [found, regs === null ? "named with --runtime; this user's storage holds no registration of a runtime to tell it by" : "named with --runtime, and registered with this Lumiverse for this user"];
  } else {
    const registeredHere = ours.filter(registered);
    const [only] = registeredHere;
    if (registeredHere.length === 1 && only !== undefined) [taken, why] = [only, "registered with this Lumiverse for this user: the registration in their storage holds its secret"];
    else if (registeredHere.length > 1) out.undecided = `Several runtimes of today's build are registered with this Lumiverse for this user (${registeredHere.map((c) => c.name).join(", ")}): say which one this run takes with --runtime <name>.`;
    else if (regs === null && ours.some(sameUser)) out.undecided = `This user's storage holds no registration of a runtime (harness/registry.json is missing or isn't one today's build reads), so which runtime here is theirs can't be told by it (${ours.filter(sameUser).map((c) => c.name).join(", ")} sign(s) in as their name): say which with --runtime <name>, or that none is with --no-runtime.`;
    else if (unreadable.length > 0) out.undecided = `No runtime of today's build is registered with this Lumiverse for this user, and the config of ${unreadable.join(", ")} can't be read, so whether it is theirs can't be told: set it up again with today's install line, or say that no runtime here is theirs with --no-runtime.`;
  }
  for (const c of ours) {
    if (c === taken) continue;
    const reason = !sameUser(c) ? "signs in to Lumiverse as another user" : registered(c) ? "registered with this Lumiverse for this user as well" : "signs in as this user's name, but is not registered with this Lumiverse for this user: another Lumiverse's runtime, or one whose registration was replaced";
    out.leftAlone.push({ name: c.name, why: reason });
  }
  for (const name of unreadable) out.leftAlone.push({ name, why: "its config can't be read, so whose it is can't be told" });
  // A runtime folder no config names: this extension's when a working copy in it says so; today's build doesn't run it.
  for (const name of await names(join(folders.dataDir, "runtimes"))) {
    if (configured.has(name) || !RUNTIME_NAME.test(name)) continue;
    for (const copy of await names(join(folders.dataDir, "runtimes", name, "store"))) {
      const identity = parse(await readText(join(folders.dataDir, "runtimes", name, "store", copy, "identity.json")));
      if (!isRecord(identity) || identity.extension !== identifier) continue;
      out.leftAlone.push({ name, why: "no config names it, so today's build doesn't run it" });
      break;
    }
  }
  out.leftAlone.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  if (taken !== null) {
    const { name, file } = taken;
    // The unit that keeps it running: the one its config names, or the one its install line made for a config that names none.
    const config = { ...taken.config, service: runtimeUnit(taken.config, folders) };
    taken = { name, config, file };
    out.runtimes.push({ name, config, why });
    out.files.push(...(await beside(folders.configDir, file, "config")));
    const root = join(folders.dataDir, "runtimes", name);
    out.files.push(...(await walk(root)).map((f) => ({ ...f, path: `runtimes/${name}/${f.path}`, disk: join(root, f.path) })));
  }
  // The copy of the runtime its service runs (`installedCopy`, `H/runtime/update/service.ts:100`), with what a write left beside it: the one every runtime of this extension here runs where no unit names another.
  const script = taken?.config.service?.script ?? (taken !== null || identifier !== EXTENSION_IDENTIFIER ? installedScript(folders.dataDir, identifier) : null);
  if (script !== null) out.files.push(...(await beside(dirname(script), basename(script), "installed")));
  // The unit that keeps it running, with what a rewrite left beside it.
  const unit = taken?.config.service;
  if (unit) out.files.push(...(await beside(dirname(unit.file), basename(unit.file), "unit")));
  // What its working copy of this user's data hasn't sent, and whether today's runtime would send it. The copy is the runtime's own for its Lumiverse, the user it signs in as, and the extension (`H/runtime/runtime.ts:224`).
  if (taken !== null) {
    const { name, config } = taken;
    const mark = markOf(parse(mirrorMark));
    const copyDir = join(folders.dataDir, "runtimes", name, "store", copyFolderOf(config.base, config.session.username, identifier));
    const files = await unsentOf(copyDir);
    if (files.size > 0) {
      const identity = parse(await readText(join(copyDir, "identity.json")));
      const copy = isRecord(identity) && identity.v === 1 && identity.kind === "working-copy" && typeof identity.copy === "string" ? identity.copy : null;
      const count = isRecord(identity) && typeof identity.count === "number" && Number.isSafeInteger(identity.count) && identity.count >= 0 ? identity.count : 0;
      // `claim` (`H/runtime/store/index.ts:682-720`): the copy carries on under its own mark when it
      // isn't behind it; under another's, what it hadn't sent stays and is sent; with no mark, or
      // behind its own, the copy goes with what it hadn't sent.
      const outcome =
        mark === null
          ? { kept: false, why: "the extension's storage names no runtime as keeping it, so today's runtime would throw its copy away, with what it hadn't sent" }
          : mark.copy !== copy
            ? { kept: true, why: "another copy keeps the extension's storage, and today's runtime sends what it hadn't sent as its own writes" }
            : count < mark.count
              ? { kept: false, why: "the copy is behind what the extension's storage took from it (a copy restored or moved), so today's runtime would throw it away, with what it hadn't sent" }
              : { kept: true, why: "the copy is the one the extension's storage keeps, and today's runtime sends what it hadn't sent" };
      out.unsent.push({ runtime: name, files, ...outcome });
    }
  }
  out.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}
