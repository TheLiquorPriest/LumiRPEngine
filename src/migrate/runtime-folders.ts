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
import { BLOB_HASH, DOC_PATH, EXTENSION_IDENTIFIER, MARK_PATH, RUNTIME_NAME, unitName } from "./today/lumiah/link/contract";
import { configDir, configOf, type RuntimeConfig } from "./today/lumiah/runtime/config";
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
  /** Set where the file is of a runtime folder no config names: what the report says of it. Such a file is the working-copy row's, archived. */
  working?: string;
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
  /** What the user said of runtime folders no config names (`--mine`, `--theirs`), by folder name. */
  told?: Readonly<Record<string, "mine" | "theirs">>;
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
  /** The runtime folders no config names that are this user's, by name, with why: their working copies' files are in `files`, archived, and what they hadn't sent is in `unsent`, not taken. */
  archived: { name: string; why: string }[];
}

/** A working copy found in a runtime's folder, and what its identity file says it is for: an extension, a user and a Lumiverse (`keepIdentity`, `H/runtime/store/index.ts:532`), and its own id, which a mark names. */
interface FoundCopy {
  runtime: string;
  folder: string;
  dir: string;
  extension: string;
  user: string | null;
  lumiverse: string | null;
  copy: string | null;
}

/** Every working copy under the runtimes' folder whose identity file reads as one of an extension's. */
async function copiesIn(dataDir: string): Promise<FoundCopy[]> {
  const out: FoundCopy[] = [];
  for (const runtime of await names(join(dataDir, "runtimes"))) {
    if (!RUNTIME_NAME.test(runtime)) continue;
    for (const folder of await names(join(dataDir, "runtimes", runtime, "store"))) {
      const dir = join(dataDir, "runtimes", runtime, "store", folder);
      const identity = parse(await readText(join(dir, "identity.json")));
      if (!isRecord(identity) || typeof identity.extension !== "string") continue;
      out.push({ runtime, folder, dir, extension: identity.extension, user: typeof identity.user === "string" ? identity.user : null, lumiverse: typeof identity.lumiverse === "string" ? identity.lumiverse : null, copy: typeof identity.copy === "string" ? identity.copy : null });
    }
  }
  return out;
}

/** A Lumiverse's address as runtimes compare it: its scheme, host and port, with every name of the machine itself the same. */
function addressKey(address: string): string {
  try {
    const url = new URL(address);
    const host = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase()) ? "loopback" : url.hostname.toLowerCase();
    return `${url.protocol}//${host}:${url.port === "" ? (url.protocol === "https:" ? "443" : "80") : url.port}`;
  } catch {
    return address.trim().toLowerCase();
  }
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
 * (`registryOf`, LumiAH `extension/backend/registry.ts:53-65`): each registration's id, its runtime's name and the
 * SHA-256 of its secret. Null where there is no registry, or none that today's extension reads.
 */
function relaysOf(text: string | null): { id: string; name: string; secret: string }[] | null {
  const raw = parse(text);
  if (!isRecord(raw) || raw.v !== 1) return null;
  if (!isRecord(raw.relays)) return [];
  return Object.entries(raw.relays).flatMap(([id, r]) => (isRecord(r) && typeof r.name === "string" && typeof r.secret === "string" && typeof r.port === "number" && Number.isInteger(r.port) && r.port >= 1 && r.port <= 65535 ? [{ id, name: r.name, secret: r.secret }] : []));
}

/** Each registration's id and the SHA-256 of its secret; null where there is no registry the previous build reads. */
function registrations(text: string | null): Map<string, string> | null {
  const relays = relaysOf(text);
  return relays === null ? null : new Map(relays.map((r) => [r.id, r.secret]));
}

/** The names of the runtimes this user's registry registers with this Lumiverse; none where it holds none. */
export function registeredNames(text: string | null): string[] {
  return (relaysOf(text) ?? []).map((r) => r.name);
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
  const out: RuntimeRead = { runtimes: [], files: [], unsent: [], leftAlone: [], archived: [], undecided: null };
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
  // This Lumiverse's address as the data shows it: where the runtimes registered with it reach it, and where the working copy its storage's mark names does.
  const copies = await copiesIn(folders.dataDir);
  const mark = markOf(parse(mirrorMark));
  const known = new Map<string, string>();
  for (const c of ours) if (registered(c)) known.set(addressKey(c.config.base), c.config.base);
  for (const c of copies) if (mark !== null && c.copy === mark.copy && c.extension === identifier && c.lumiverse !== null) known.set(addressKey(c.lumiverse), c.lumiverse);
  let taken: (typeof ours)[number] | null = null;
  let why = "";
  if (owner.named !== null) {
    const named = owner.named;
    const found = ours.find((c) => c.name === named);
    if (found === undefined) out.undecided = unreadable.includes(named) ? `The config of the runtime ${named} can't be read, so this run can't take it: set it up again with the previous build's install line, or run with --no-runtime.` : `There is no runtime ${named} of this extension in ${folders.configDir}${ours.length > 0 ? `: there are ${ours.map((c) => c.name).join(", ")}` : ""}.`;
    else if (!sameUser(found)) out.undecided = `The runtime ${named} signs in to Lumiverse as another user, so its connections and keys are not this user's: this run doesn't take it.`;
    // A name the user shares on another Lumiverse is no proof: where their storage keeps registrations, a runtime named is taken only as one of them, as one found by itself is.
    else if (regs !== null && !registered(found)) out.undecided = `The runtime ${named} signs in as this user's name, but is not registered with this Lumiverse for this user (another Lumiverse's runtime, or one whose registration was replaced), so its connections and keys may be another's: this run doesn't take it. Register it with this Lumiverse with the previous build's install line, or run with --no-runtime.`;
    // Where it keeps none, the runtime's Lumiverse is compared with this one's, by what the data shows of it: a runtime of another Lumiverse is left alone.
    else if (regs === null && known.size > 0 && !known.has(addressKey(found.config.base))) out.undecided = `The runtime ${named} signs in as this user's name, and this user's storage holds no registration of a runtime, but its config's Lumiverse address (${found.config.base}) is not this Lumiverse's (${[...known.values()].join(", ")}, as the working copy this user's storage names reaches it): another Lumiverse's runtime, so its connections and keys may be another's and this run doesn't take it.`;
    else [taken, why] = [found, regs === null ? `named with --runtime; ${known.size > 0 ? "its config's Lumiverse address is this Lumiverse's" : "nothing in this user's storage shows this Lumiverse's address to compare it with"}; this user's storage holds no registration of a runtime to tell it by` : "named with --runtime, and registered with this Lumiverse for this user"];
  } else {
    const registeredHere = ours.filter(registered);
    const [only] = registeredHere;
    if (registeredHere.length === 1 && only !== undefined) [taken, why] = [only, "registered with this Lumiverse for this user: the registration in their storage holds its secret"];
    else if (registeredHere.length > 1) out.undecided = `Several runtimes of the previous build are registered with this Lumiverse for this user (${registeredHere.map((c) => c.name).join(", ")}): say which one this run takes with --runtime <name>.`;
    else if (regs === null && ours.some(sameUser)) out.undecided = `This user's storage holds no registration of a runtime (harness/registry.json is missing or isn't one the previous build reads), so which runtime here is theirs can't be told by it (${ours.filter(sameUser).map((c) => c.name).join(", ")} sign(s) in as their name): say which with --runtime <name>, or that none is with --no-runtime.`;
    else if (unreadable.length > 0) out.undecided = `No runtime of the previous build is registered with this Lumiverse for this user, and the config of ${unreadable.join(", ")} can't be read, so whether it is theirs can't be told: set it up again with the previous build's install line, or say that no runtime here is theirs with --no-runtime.`;
  }
  for (const c of ours) {
    if (c === taken) continue;
    const reason = !sameUser(c) ? "signs in to Lumiverse as another user" : registered(c) ? "registered with this Lumiverse for this user as well" : "signs in as this user's name, but is not registered with this Lumiverse for this user: another Lumiverse's runtime, or one whose registration was replaced";
    out.leftAlone.push({ name: c.name, why: reason });
  }
  for (const name of unreadable) out.leftAlone.push({ name, why: "its config can't be read, so whose it is can't be told" });
  // A runtime folder no config names: this extension's where a working copy in it says so; today's build doesn't run it. Its working copies' identity files say whose each is (`keepIdentity`, `H/runtime/store/index.ts:532`): this user's are counted under the working-copy row and archived in the backup, with what they hadn't sent listed as not taken, since today's runtime never runs it; another user's, or another Lumiverse's, are left alone by name; where whose can't be told, the run asks.
  const told = owner.told ?? {};
  for (const name of await names(join(folders.dataDir, "runtimes"))) {
    if (configured.has(name) || !RUNTIME_NAME.test(name)) continue;
    const here = copies.filter((c) => c.runtime === name);
    const ofThis = here.filter((c) => c.extension === identifier);
    if (ofThis.length === 0) continue;
    const verdicts = ofThis.map((c) => (c.user === null || owner.username === null ? "unknown" : c.user !== owner.username ? "another user's" : known.size > 0 && c.lumiverse !== null && !known.has(addressKey(c.lumiverse)) ? "another Lumiverse's" : "his"));
    const elsewhere = verdicts.find((v) => v !== "his" && v !== "unknown");
    const answer = told[name];
    const verdict = answer === "mine" ? "his" : answer === "theirs" ? "told not his" : verdicts.every((v) => v === "his") ? "his" : elsewhere !== undefined && verdicts.every((v) => v !== "his" && v !== "unknown") ? "not his" : "unknown";
    if (verdict === "his") {
      const root = join(folders.dataDir, "runtimes", name);
      const note = `a file of the runtime folder ${name}, which no config names, so the previous build never runs it; its working copy is this user's${answer === "mine" ? " (as you said)" : ""}`;
      // Only this user's working copies of this extension are taken: another one's is left where it is, unread.
      const apart = here.filter((c) => !ofThis.includes(c) || (c.user !== null && c.user !== owner.username)).map((c) => `store/${c.folder}/`);
      out.files.push(...(await walk(root)).filter((f) => !apart.some((p) => f.path.startsWith(p))).map((f) => ({ ...f, path: `runtimes/${name}/${f.path}`, disk: join(root, f.path), working: note })));
      for (const c of ofThis) {
        const files = await unsentOf(c.dir);
        if (files.size > 0) out.unsent.push({ runtime: name, files, kept: false, why: "no config names this runtime, so the previous runtime never runs it and never sends what its working copy hadn't sent" });
      }
      out.archived.push({ name, why: answer === "mine" ? "no config names it; you said its working copy is this user's" : "no config names it; its working copy's identity says it is this user's" });
    } else if (verdict === "told not his" || verdict === "not his") {
      out.leftAlone.push({ name, why: verdict === "told not his" ? "no config names it, and you said it is not this user's" : `no config names it, and its working copy is ${elsewhere ?? "another's"}` });
    } else {
      const unclear = ofThis.some((c) => c.user === null) ? "a working copy's identity file names no user" : owner.username === null ? "Lumiverse's database holds no name for this user" : "its working copies are of more than one user, or of another Lumiverse and this one";
      out.undecided = [out.undecided, `The runtime folder ${name} holds a working copy of this extension that no config names, and whose it is can't be told (${unclear}): say that it is this user's with --mine ${name}, or that it is not with --theirs ${name}.`].filter((s) => s !== null).join(" ");
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
    // The runtime's own folder may hold the working copy of another user it once signed in as: that one is left where it is.
    const another = copies.filter((c) => c.runtime === name && c.user !== null && c.user !== owner.username).map((c) => `store/${c.folder}/`);
    out.files.push(...(await walk(root)).filter((f) => !another.some((p) => f.path.startsWith(p))).map((f) => ({ ...f, path: `runtimes/${name}/${f.path}`, disk: join(root, f.path) })));
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
          ? { kept: false, why: "the extension's storage names no runtime as keeping it, so the previous runtime would throw its copy away, with what it hadn't sent" }
          : mark.copy !== copy
            ? { kept: true, why: "another copy keeps the extension's storage, and the previous runtime sends what it hadn't sent as its own writes" }
            : count < mark.count
              ? { kept: false, why: "the copy is behind what the extension's storage took from it (a copy restored or moved), so the previous runtime would throw it away, with what it hadn't sent" }
              : { kept: true, why: "the copy is the one the extension's storage keeps, and the previous runtime sends what it hadn't sent" };
      out.unsent.push({ runtime: name, files, ...outcome });
    }
  }
  out.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}
