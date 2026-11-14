// The runtime's own folders on the server (LumiAH's runtime, built into today's build), read without
// changing them: its config, its own folder (connections, keys, its working copy of the user's
// documents), the copy of the runtime its service runs, and the service unit. Only the runtimes of
// this extension are read: a config names the extension it links to.
//
// The working copy is where the runtime's writes land first; they reach the extension's storage
// afterwards. What its journal still names is waiting to be sent, and it is the freshest version of
// those documents and blobs (LumiAH `runtime/store/index.ts`, its header and `load`, `claim`). The
// migration lays it over the user's storage, as today's runtime would send it, unless today's
// runtime would throw it away at its next start: a copy the storage's mark doesn't name while the
// storage names none, or one behind the count the mark took from it (a copy restored or moved).

import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { BLOB_HASH, DOC_PATH, EXTENSION_IDENTIFIER, MARK_PATH, RUNTIME_NAME } from "lumi-ah/link";
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

/** A runtime's config as today's runtime reads it (`configOf`, `H/runtime/config.ts:138-165`): what it runs with, and the unit that keeps it running. */
export type SavedRuntime = RuntimeConfig & { service: { unit: string; file: string; bun: string; script: string } | null };

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

/** What the runtime's folders hold for this extension. */
export interface RuntimeRead {
  /** The runtimes of this extension, by name, with their config as today's runtime reads it. */
  runtimes: { name: string; config: SavedRuntime }[];
  files: RuntimeFile[];
  /** Configs that couldn't be read: whose they are isn't known, so they are found and not classified. */
  unreadable: RuntimeFile[];
  /** Per runtime that holds a working copy of this user's data: what it hasn't sent. */
  unsent: Unsent[];
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
 * Reads the runtime's folders for one extension and one user: `username` is the name the runtime
 * signs in to Lumiverse as, and `mirrorMark` the text of the mark in the extension's storage
 * (`harness/docs/mirror.json`), null when there is none.
 */
export async function readRuntimeFolders(folders: RuntimeFolders, identifier: string, username: string | null, mirrorMark: string | null): Promise<RuntimeRead> {
  const out: RuntimeRead = { runtimes: [], files: [], unreadable: [], unsent: [] };
  const configFiles = (await walk(folders.configDir)).filter((f) => !f.path.includes("/"));
  for (const f of configFiles) {
    if (!f.path.endsWith(".json")) continue;
    const disk = join(folders.configDir, f.path);
    let config: SavedRuntime;
    try {
      config = configOf(await readText(disk), disk);
    } catch {
      out.unreadable.push({ ...f, path: `config/${f.path}`, disk });
      continue;
    }
    if (config.extension !== identifier) continue;
    out.runtimes.push({ name: config.name, config });
    out.files.push(...(await beside(folders.configDir, f.path, "config")));
  }
  const ours = new Set(out.runtimes.map((r) => r.name));
  // A runtime folder no config names is this extension's when a working copy in it says so.
  for (const name of await names(join(folders.dataDir, "runtimes"))) {
    if (ours.has(name) || !RUNTIME_NAME.test(name)) continue;
    for (const copy of await names(join(folders.dataDir, "runtimes", name, "store"))) {
      const identity = parse(await readText(join(folders.dataDir, "runtimes", name, "store", copy, "identity.json")));
      if (isRecord(identity) && identity.extension === identifier) ours.add(name);
    }
  }
  for (const name of [...ours].sort()) {
    const root = join(folders.dataDir, "runtimes", name);
    out.files.push(...(await walk(root)).map((f) => ({ ...f, path: `runtimes/${name}/${f.path}`, disk: join(root, f.path) })));
  }
  // The copy of the runtime its service runs (`installedCopy`, `H/runtime/update/service.ts:100`), with what a write left beside it.
  const installed = new Set(out.runtimes.map(({ config }) => config.service?.script ?? join(folders.dataDir, identifier === EXTENSION_IDENTIFIER ? "" : identifier, "lumiah.js")));
  if (out.runtimes.length === 0 && identifier !== EXTENSION_IDENTIFIER) installed.add(join(folders.dataDir, identifier, "lumiah.js"));
  for (const path of installed) out.files.push(...(await beside(dirname(path), basename(path), "installed")));
  // The service unit each config names, with what a rewrite left beside it.
  for (const { config } of out.runtimes) if (config.service) out.files.push(...(await beside(dirname(config.service.file), basename(config.service.file), "unit")));
  // What the working copy of this user's data hasn't sent, and whether today's runtime would send it.
  if (username !== null) {
    const mark = markOf(parse(mirrorMark));
    for (const { name, config } of out.runtimes) {
      const copyDir = join(folders.dataDir, "runtimes", name, "store", copyFolderOf(config.base, username, identifier));
      const files = await unsentOf(copyDir);
      if (files.size === 0) continue;
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
