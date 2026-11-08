// `lumirpengine loopback` (DEPTH-PLAN §3.3): the relay's one-line start, its service and its upkeep.
//
//   up      signs in (or reuses the saved sign-in), registers the relay with LumiRPEngine, puts its
//           origin in the account's scheduler exclusions, writes its config, and serves; with
//           --systemd it installs a stable copy of itself and a unit that runs it instead: the
//           account's own user unit, or as root a system unit run by the account Lumiverse runs as
//   serve   what the unit runs: the relay from its config, until stopped
//   login   a new session for the relay when its own ended (Settings → Loopback says so)
//   status  the relay's config, unit, link and session
//   down    stops and removes the unit
//
// It runs only from files no other account can change (Bun, this bundle and the kit beside it, and
// every directory above them): whoever else could change one would choose the code it runs, as root
// or as anyone else who runs it. Otherwise it refuses, and says how to run the relay as the account
// that can change them. As root the directory it runs in counts too, with any bunfig.toml or .env
// there, which Bun reads before this runs. A system unit runs root-owned copies of Bun and the relay
// (SYSTEM_RELAY_DIR) as its account, never as root. Its Update line refreshes the relay and its kit
// there from that account's install, so root never runs those copies, nor the Bun beside them: every
// line given root for a system relay runs only systemd's own programs (`systemctl`, `install`, `rm`),
// and its `down` and `status`, run as its account, give those lines. Run as root from there, it
// refuses, but only as a courtesy: the refusal is the copy's own code, so a copy its account changed
// needn't refuse, and refusing protects nothing against one.
//
// It needs Bun: the server is Bun.serve with `idleTimeout: 0` (F23), and the unit runs the same Bun
// by its absolute path (F32). Everything it does to the machine goes through LoopbackIO, which
// main.ts supplies, as it does the rest of the CLI's I/O.

import { hasOwn, isRecord } from "../shared/json";
import type { RelayMode } from "../shared/loopback";
import { LOOPBACK_MODEL, RELAY_NAME, relayBase, relayUnitName, shellWord, SYSTEM_CONFIG_DIR, SYSTEM_RELAY_DIR } from "../shared/loopback";
import { KIT_FILE } from "../shared/agents";
import type { CliIO } from "./commands";
import { HostConnection, LiveError, LreError, sessionOf, signIn } from "./connection";
import type { StoredLogin } from "./credentials";
import { inClear, normalizeBase } from "./credentials";
import type { Owned } from "./follow";
import { LoopbackLink, excludeOrigins, relayOrigins } from "./loopback-link";
import type { RelaySettings } from "./loopback-relay";
import { RELAY_DEFAULTS, Relay } from "./loopback-relay";
import { BUILD, CLI_NAME, CLI_VERSION } from "./version";

export interface ServeOptions {
  hostname: string;
  port: number;
  fetch(req: Request): Promise<Response>;
}

/** A running server. */
export interface Served {
  stop(): void;
}

/** The machine as the loopback command needs it; main.ts supplies Node's and Bun's. */
export interface LoopbackFiles {
  /** The file's text, or null when there is none. */
  read(path: string): string | null;
  /** Writes it whole and renames it into place with `mode`, making its directory with `dirMode` when missing. */
  write(path: string, text: string, mode: number, dirMode: number): void;
  /** Writes over the file in place, its owner and mode kept: for a file of this account's in a directory it can't write (a system relay's config, in root's SYSTEM_CONFIG_DIR). */
  rewrite(path: string, text: string): void;
  copy(from: string, to: string, mode: number): void;
  exists(path: string): boolean;
  /** A directory's file names; empty when there is none. */
  list(dir: string): string[];
  remove(path: string): void;
  /** Its owner, group and mode, symlinks followed; null where the system has none (Windows). */
  stat(path: string): OwnedEntry | null;
  /** The path with every symlink in it resolved. */
  real(path: string): string;
  chown(path: string, uid: number, gid: number): void;
}

/** An entry's owner and mode, with its group. */
export interface OwnedEntry extends Owned {
  gid: number;
}

export interface LoopbackIO {
  /** Bun.serve with `idleTimeout: 0`; null under Node, which can't run the relay. It throws when the port is taken. */
  serve: ((options: ServeOptions) => Served) | null;
  /** Resolves with the signal's name when the process is asked to stop. */
  stopped(): Promise<string>;
  /** The absolute path of the Bun running this, or null under Node. */
  bun: string | null;
  /** This bundle's own path (…/dist/lumirpengine.js): `up` copies it and the kit beside it. */
  self: string;
  /** The process's uid; null on Windows. */
  uid: number | null;
  /** The directory it runs in: Bun has read its bunfig.toml (a preload runs first) and .env before this runs. */
  cwd: string;
  hostname: string;
  platform: string;
  home: string;
  files: LoopbackFiles;
  /** Runs a program (systemctl, loginctl, id) with `env` over this process's environment, and resolves with its exit code and output. */
  run(command: string, args: readonly string[], env?: Readonly<Record<string, string>>): Promise<{ code: number; out: string; err: string }>;
  /** Waits `ms`; setTimeout when absent. */
  sleep?(ms: number): Promise<void>;
}

/** The loopback's part of the command line, as commands.ts parsed it. */
export interface LoopbackArgs {
  positionals: string[];
  values: Record<string, string[]>;
  flags: Record<string, true>;
}

/** What `loopback.json` holds (mode 0600: the session is a whole-account credential, the secret the relay's). */
export interface LoopbackConfig {
  name: string;
  base: string;
  listen: string;
  port: number;
  mode: RelayMode;
  relay: string;
  secret: string;
  session: StoredLogin;
  /** The relay's timing and limits where they differ from RELAY_DEFAULTS. */
  tuning: Partial<Tuning>;
}

type Tuning = Omit<RelaySettings, "listen" | "port" | "mode">;

const FORMAT = 1;
const DEFAULT_PORT = 7861;
const LAST_PORT = 7899;
const LISTEN = "127.0.0.1";
/** A directory's sticky bit: no one but an entry's owner, the directory's or root may rename or remove the entry (/tmp). */
const STICKY = 0o1000;
/** Write bits for the entry's group, and for everyone else. */
const GROUP_WRITE = 0o020;
const OTHERS_WRITE = 0o002;

export const LOOPBACK_USAGE = `  loopback up [--url <base>] [--port <n>] [--name <name>] [--shared] [--systemd] [--account <user>]
                                              The loopback relay: sign in, register with LumiRPEngine, keep its address
                                              out of the local-inference scheduler, and serve on 127.0.0.1 (--listen
                                              <host> for another address). --systemd installs it as a service instead: a
                                              user unit for the account that runs it (run it as the account Lumiverse runs
                                              as); as root, from files only root can change, a system unit run by
                                              --account. --shared offers it as every user's relay, which the operator
                                              must allow in Settings → Loopback
  loopback serve --config <file>              Run the relay from its config (what the service runs)
  loopback login | status | down [--name <name>]
                                              Sign the relay in again; how it is; stop and remove its service
`;

class LoopbackUsageError extends Error {}

const one = (a: LoopbackArgs, name: string): string | undefined => a.values[name]?.at(-1);

function only(a: LoopbackArgs, sub: string, options: readonly string[], flags: readonly string[]): void {
  const stray = [...Object.keys(a.values).filter((o) => !options.includes(o)), ...Object.keys(a.flags).filter((f) => !flags.includes(f) && f !== "--help")];
  if (stray.length > 0) throw new LoopbackUsageError(`loopback ${sub} doesn't take ${stray.join(", ")}.\n\n${LOOPBACK_USAGE}`);
  if (a.positionals.length > 1) throw new LoopbackUsageError(`loopback ${sub} takes no argument (${a.positionals.slice(1).join(" ")}).\n\n${LOOPBACK_USAGE}`);
}

/** Runs `loopback <sub>`; resolves with the exit code. */
export async function loopback(a: LoopbackArgs, io: CliIO): Promise<number> {
  const sub = a.positionals[0];
  try {
    const lio = io.loopback;
    if (lio === undefined) throw new Error("This build of lumirpengine can't run the loopback relay.");
    // Before anything it would do: it runs only what no other account can change (as root, root alone).
    const refused = sub === "up" || sub === "serve" || sub === "login" || sub === "status" || sub === "down" ? await refusal(a, sub, io, lio) : null;
    if (refused !== null) throw new Error(refused);
    switch (sub) {
      case "up":
        only(a, "up", ["--url", "--port", "--listen", "--name", "--account", "--bun", "--after", "--username"], ["--shared", "--systemd", "--allow-http"]);
        return await up(a, io, lio);
      case "serve": {
        only(a, "serve", ["--config", "--name"], []);
        const path = configPath(a, io, lio);
        return await serve(readConfig(path, lio), path, io, lio);
      }
      case "login":
        only(a, "login", ["--config", "--name", "--username"], []);
        return await login(a, io, lio);
      case "status":
        only(a, "status", ["--config", "--name"], []);
        return await status(a, io, lio);
      case "down":
        only(a, "down", ["--name"], []);
        return await down(a, io, lio);
      default:
        throw new LoopbackUsageError(`${sub === undefined ? "loopback needs what to do" : `There is no loopback ${sub}`}: up, serve, login, status or down.\n\n${LOOPBACK_USAGE}`);
    }
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return error instanceof LoopbackUsageError ? 2 : 1;
  }
}

// ---------------------------------------------------------------- where things go

/** System scope (as root): /etc and SYSTEM_RELAY_DIR, a system unit. User scope: the XDG directories, a user unit. */
interface Place {
  scope: "system" | "user";
  config: string;
  data: string;
  unit: string;
  unitName: string;
}

/** Where a system relay goes (`up` as root): its config in /etc, root-owned copies of Bun, the relay and its kit, and a system unit. */
function systemPlace(name: string): Place {
  const unitName = relayUnitName(name);
  return { scope: "system", config: `${SYSTEM_CONFIG_DIR}/loopback-${name}.json`, data: SYSTEM_RELAY_DIR, unit: `/etc/systemd/system/${unitName}`, unitName };
}

function placeOf(name: string, io: CliIO, lio: LoopbackIO): Place {
  if (lio.uid === 0) return systemPlace(name);
  const unitName = relayUnitName(name);
  const xdg = (variable: string, fallback: string): string => {
    const v = io.env[variable];
    return v !== undefined && v.startsWith("/") ? v : `${lio.home}/${fallback}`;
  };
  const config = xdg("XDG_CONFIG_HOME", ".config");
  return { scope: "user", config: `${config}/lumirpengine/loopback-${name}.json`, data: `${xdg("XDG_DATA_HOME", ".local/share")}/lumirpengine`, unit: `${config}/systemd/user/${unitName}`, unitName };
}

/**
 * How systemctl reaches the place's unit: `--user` for a user unit, whose manager it finds by
 * XDG_RUNTIME_DIR, which `sudo -u <account>` leaves unset (the account's is /run/user/<uid>).
 */
function ctlOf(place: Place, io: CliIO, lio: LoopbackIO): { args: string[]; env: Record<string, string> } {
  if (place.scope === "system") return { args: [], env: {} };
  const runtime = io.env.XDG_RUNTIME_DIR ?? (lio.uid !== null ? `/run/user/${lio.uid}` : undefined);
  return { args: ["--user"], env: runtime !== undefined ? { XDG_RUNTIME_DIR: runtime } : {} };
}

// ---------------------------------------------------------------- whose files it runs

/** A group's name, and the accounts in it (its listed members and every account whose primary group it is); null when they can't all be named. */
type GroupOf = (gid: number) => Promise<{ name: string; uids: number[] | null }>;

/**
 * The groups `getent` names, each asked once. Where there is no getent (macOS), or a member it can't
 * name, the group's accounts are unknown, so its write counts as another account's.
 */
function groupsOf(lio: LoopbackIO): GroupOf {
  const asked = new Map<number, Promise<{ name: string; uids: number[] | null }>>();
  const ask = async (gid: number): Promise<{ name: string; uids: number[] | null }> => {
    const group = await lio.run("getent", ["group", String(gid)]);
    const [name = "", , id, listed = ""] = (group.out.split("\n")[0] ?? "").trim().split(":");
    if (group.code !== 0 || name === "" || id !== String(gid)) return { name: String(gid), uids: null };
    const passwd = await lio.run("getent", ["passwd"]);
    if (passwd.code !== 0) return { name, uids: null };
    const accounts = passwd.out.split("\n").flatMap((line) => {
      const [account = "", , uid = "", primary = ""] = line.trim().split(":");
      return account !== "" && /^\d+$/.test(uid) ? [{ account, uid: Number(uid), primary }] : [];
    });
    const uids = accounts.filter((a) => a.primary === String(gid)).map((a) => a.uid);
    for (const member of listed.split(",").filter((m) => m !== "")) {
      const found = accounts.find((a) => a.account === member);
      if (found === undefined) return { name, uids: null };
      uids.push(found.uid);
    }
    return { name, uids };
  };
  return (gid) => {
    let answer = asked.get(gid);
    if (answer === undefined) asked.set(gid, (answer = ask(gid)));
    return answer;
  };
}

/** No account but its owner is in its group: core makes its directories under a umask of 0002, group-writable, in its account's own group (the depth release's late live run, L3c-1). */
async function ownersGroup(entry: OwnedEntry, groupOf: GroupOf): Promise<boolean> {
  const { uids } = await groupOf(entry.gid);
  return uids !== null && uids.length > 0 && uids.every((u) => u === entry.uid);
}

/** Only `uid` or root can change it: one of theirs, writable by no one else, its group's write counting for nothing in its owner's own group. */
async function onlyTheirs(entry: OwnedEntry, uid: number, groupOf: GroupOf): Promise<boolean> {
  if ((entry.uid !== uid && entry.uid !== 0) || (entry.mode & OTHERS_WRITE) !== 0) return false;
  return (entry.mode & GROUP_WRITE) === 0 || (await ownersGroup(entry, groupOf));
}

/**
 * The entries, from the file at `path` (its symlinks resolved) up through every directory above it,
 * that someone other than `uid` or root can change: each of `uid`'s or root's its group or everyone
 * else can write, then the first of another account's, where it stops. A directory with its sticky
 * bit (/tmp), `uid`'s or root's, lets no one else rename or remove an entry of `uid`'s or root's in
 * it, so what is below it stays as safe as that entry.
 */
async function changeable(lio: LoopbackIO, path: string, uid: number, groupOf: GroupOf): Promise<{ path: string; entry: OwnedEntry }[]> {
  const found: { path: string; entry: OwnedEntry }[] = [];
  let below: OwnedEntry | null = null;
  for (let at = lio.files.real(path); ; at = at.slice(0, at.lastIndexOf("/")) || "/") {
    const entry = lio.files.stat(at);
    const sticky = entry !== null && below !== null && (entry.mode & STICKY) !== 0 && (entry.uid === uid || entry.uid === 0) && (below.uid === uid || below.uid === 0);
    if (entry !== null && !sticky && !(await onlyTheirs(entry, uid, groupOf))) {
      found.push({ path: at, entry });
      if (entry.uid !== uid && entry.uid !== 0) return found;
    }
    if (at === "/") return found;
    below = entry;
  }
}

/**
 * Why this account won't run this, or null when it may (the depth release's security review, M3, and
 * its late one, S2 and S4): this bundle and the kit beside it, the Bun it runs on and the one `--bun`
 * names for its unit must be no one else's to change but root's, as must every directory above them,
 * or whoever else can change one would run code as this account through it: as root, or as whoever
 * pasted Settings → Loopback's line without its `sudo -u`. As root, the directory it runs in counts
 * too, with any bunfig.toml or .env in it: Bun read them before this ran, a preload first of all, so
 * this catches only the honest mistake, and every line given runs Bun from / (`--cwd /`). The
 * refusal names each; for one of this account's or root's that its group or everyone else can
 * write, the `chmod` that takes that write away, and for one of another account's, how to run the
 * relay as that account.
 */
async function refusal(a: LoopbackArgs, sub: string, io: CliIO, lio: LoopbackIO): Promise<string | null> {
  const me = lio.uid;
  if (me === null) return null;
  const groupOf = groupsOf(lio);
  const kit = `${lio.self.slice(0, lio.self.lastIndexOf("/"))}/${KIT_FILE}`;
  // As root, never a system service's copies, whoever owns them (the final security review, F1). A
  // courtesy for a genuine copy only: this is the copy's own code, so one its account changed needn't
  // refuse, and no line given root runs them (S-1).
  if (me === 0 && [lio.self, kit, lio.bun, one(a, "--bun")].some((p) => p !== null && p !== undefined && inSystemCopies(lio, p))) return copiesRefusal(a, sub, io, lio);
  // This bundle first: whoever can change it is the account its install belongs to.
  const unsafe: { path: string; uid: number | null; why: string | null; entry?: OwnedEntry; here?: true }[] = [];
  for (const path of new Set([lio.self, kit, lio.bun, one(a, "--bun")])) {
    if (path === null || path === undefined) continue;
    let found: { path: string; entry: OwnedEntry }[];
    try {
      found = await changeable(lio, path, me, groupOf);
    } catch (error) {
      unsafe.push({ path, uid: null, why: `can't be checked (${error instanceof Error ? error.message : String(error)})` });
      continue;
    }
    for (const f of found) if (!unsafe.some((u) => u.path === f.path)) unsafe.push({ path: f.path, uid: f.entry.uid, why: null, entry: f.entry });
  }
  if (me === 0) {
    try {
      const dir = lio.cwd === "/" ? "" : lio.cwd;
      for (const path of [lio.cwd, ...lio.files.list(lio.cwd).flatMap((f) => (f === "bunfig.toml" || f.startsWith(".env") ? [`${dir}/${f}`] : []))]) {
        const entry = lio.files.stat(path);
        if (entry !== null && !(await onlyTheirs(entry, 0, groupOf))) unsafe.push({ path, uid: entry.uid, why: null, entry, here: true });
      }
    } catch (error) {
      unsafe.push({ path: lio.cwd, uid: null, why: `can't be checked (${error instanceof Error ? error.message : String(error)})`, here: true });
    }
  }
  if (unsafe.length === 0) return null;
  const names = new Map<number, string>();
  for (const { uid } of unsafe) if (uid !== null && uid !== 0 && uid !== me && !names.has(uid)) names.set(uid, (await lio.run("id", ["-nu", String(uid)])).out.trim() || String(uid));
  // Of this account's or root's, who can write it: its group (unless no one but its owner is in it), everyone else, or both; and the chmod that stops them.
  const shared = new Map<string, { why: string; chmod: string }>();
  for (const { path, uid, entry } of unsafe) {
    if (entry === undefined || (uid !== me && uid !== 0)) continue;
    const group = (entry.mode & GROUP_WRITE) !== 0 && !(await ownersGroup(entry, groupOf)) ? (await groupOf(entry.gid)).name : null;
    const others = (entry.mode & OTHERS_WRITE) !== 0;
    const why = group !== null ? `its group, ${group}, ${others ? "and everyone else " : ""}can change it` : "everyone else can change it";
    shared.set(path, { why, chmod: `  ${uid === 0 && me !== 0 ? "sudo " : ""}chmod ${group !== null ? "g" : ""}${others ? "o" : ""}-w ${shellWord(path)}` });
  }
  const listed = unsafe.map(({ path, uid, why, here }) => `  ${path}: ${why ?? shared.get(path)?.why ?? `${names.get(uid ?? -1) ?? uid} can change it`}${here ? " (Bun reads bunfig.toml and .env in the directory it runs in before this runs)" : ""}`);
  // Its own line again, run from / (`--cwd /`): what it was asked, less what only a system unit takes where another account is to run it.
  const url = one(a, "--url") ?? io.env.LUMIVERSE_URL;
  const command = (system: boolean): string =>
    [lio.bun ?? "bun", "--cwd", "/", lio.self, "loopback", sub, ...Object.entries(a.values).flatMap(([option, values]) => (!system && (option === "--account" || option === "--after") ? [] : [option, values.at(-1) ?? ""])), ...(url !== undefined && one(a, "--url") === undefined ? ["--url", url] : []), ...Object.keys(a.flags).filter((f) => f !== "--help")].map(shellWord).join(" ");
  // Only the directory it runs in stands in the way: the same line, run from /.
  if (unsafe.every((u) => u.here === true)) {
    return [`Refusing to run as root from ${lio.cwd}: an account other than root can change what is there, and Bun read it before this ran.`, ...listed, "Run it from a directory only root can change: Bun's --cwd / does that.", `  sudo ${command(true)}`].join("\n");
  }
  const who = me === 0 ? "root" : (await lio.run("id", ["-nu"])).out.trim() || String(me);
  // Write that a chmod takes away, of the files it runs (the directory it runs in aside, which --cwd / leaves behind).
  const chmods = unsafe.flatMap((u) => {
    const s = shared.get(u.path);
    return s !== undefined && u.here !== true ? [s.chmod] : [];
  });
  // Only that write stands in the way: the chmods, then the same line again.
  if (unsafe.every((u) => u.here === true || shared.has(u.path))) {
    return [
      `Refusing to run as ${who}: an account other than ${who} can change these, and would then run code as ${who} through this command.`,
      ...listed,
      "Take that write away, then run it again:",
      ...chmods,
      `  ${me === 0 ? "sudo " : ""}${command(true)}`,
    ].join("\n");
  }
  const account = one(a, "--account") ?? names.values().next().value ?? null;
  const as = account !== null ? shellWord(account) : "<the account Lumiverse runs as>";
  return [
    me === 0 ? "Refusing to run as root: an account other than root can change these, and would then run code as root through this command." : `Refusing to run as ${who}: another account can change these, and would then run code as ${who} through this command.`,
    ...listed,
    ...(chmods.length > 0 ? ["First take away the write that isn't its owner's:", ...chmods] : []),
    sub === "up" ? `Run the relay as ${as} instead, as that account's own service: it starts at boot and keeps running once lingering is on.` : `Run it as ${as} instead.`,
    ...(sub === "up" ? [`  sudo loginctl enable-linger ${as}`] : []),
    `  sudo -u ${as} ${command(false)}`,
    ...(me === 0 ? [`For a system service instead, check that Bun, ${lio.self.slice(lio.self.lastIndexOf("/") + 1)} and ${KIT_FILE} are the ones you installed, copy them into a directory only root can change other than ${SYSTEM_RELAY_DIR}, and run ${CLI_NAME} loopback from there with --cwd / after Bun${sub === "up" ? " and --account <the account Lumiverse runs as>" : ""}. A system relay's own lines on Settings → Loopback run its copies in ${SYSTEM_RELAY_DIR} as that account, and its Update refreshes them from that account's install, so never run those as root.`] : []),
  ].join("\n");
}

/** Whether `path`, as given or with its symlinks resolved, is in SYSTEM_RELAY_DIR: a system service's copies. */
function inSystemCopies(lio: LoopbackIO, path: string): boolean {
  const real = (p: string): string => {
    try {
      return lio.files.real(p);
    } catch {
      return p;
    }
  };
  const dirs = [SYSTEM_RELAY_DIR, real(SYSTEM_RELAY_DIR)];
  return [path, real(path)].some((p) => dirs.some((d) => p.startsWith(`${d}/`)));
}

/** systemd's own lines for a system relay's unit: root stops and removes it, or sees it, with these, never with a copy of LumiRPEngine's its account can change. */
function systemdLines(name: string): { down: string; status: string } {
  const place = systemPlace(name);
  return { down: `sudo systemctl disable --now ${place.unitName} && sudo rm ${place.unit} && sudo systemctl daemon-reload`, status: `systemctl status ${place.unitName}` };
}

/**
 * Why root won't run a system service's copies (the final security review, F1): its Update line
 * writes what its account read from its own install over the relay and its kit there, which stay
 * root's, so whatever they hold, its account chose. `down` and `status` get systemd's own lines
 * instead, for the relay `--name` or `--config` names, or the only one set up here. A courtesy for a
 * genuine copy only (S-1): this is the copy's own code, so a copy its account changed needn't refuse,
 * and its code has run as root by the time it would; so the message says never to run them as root.
 */
function copiesRefusal(a: LoopbackArgs, sub: string, io: CliIO, lio: LoopbackIO): string {
  let name = "<name>";
  try {
    name = /\/loopback-([a-z0-9][a-z0-9_-]*)\.json$/.exec(configPath(a, io, lio))?.[1] ?? name;
  } catch {
    // No relay named, and none or several set up here: the lines name none.
  }
  const file = lio.self.slice(lio.self.lastIndexOf("/") + 1);
  const lines = systemdLines(name);
  const instead: Record<string, string[]> = {
    down: ["Stop and remove its service with systemd's own programs instead:", `  ${lines.down}`],
    status: ["See its service with systemd's own program instead:", `  ${lines.status}`],
    login: ["Sign it in again with its Sign-in line on LumiRPEngine → Settings → Loopback, which runs these copies as its account."],
    up: [`To set it up again, run up from copies of Bun, ${file} and ${KIT_FILE} you checked yourself, in a directory only root can change other than ${SYSTEM_RELAY_DIR}, with --cwd / after Bun.`],
  };
  return [`Refusing to run as root from ${SYSTEM_RELAY_DIR}: these are a system service's copies, and its Update line on LumiRPEngine → Settings → Loopback writes over ${file} and ${KIT_FILE} there what its account read from its own install, so that account chose what they hold. Never run them as root, even to see this: a copy its account changed needn't refuse. Its unit runs them as that account.`, ...(instead[sub] ?? [])].join("\n");
}

/** The relay's name from a username: lowercase letters, digits, `_` and `-`. */
function nameFrom(username: string): string {
  const name = username.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+/, "").slice(0, 40);
  return RELAY_NAME.test(name) ? name : "relay";
}

function givenName(a: LoopbackArgs): string | undefined {
  const name = one(a, "--name");
  if (name !== undefined && !RELAY_NAME.test(name)) throw new LoopbackUsageError(`--name is "${name}": use lowercase letters, digits, _ and -, up to 40.`);
  return name;
}

/** `--config`, else the config of `--name`, else the only relay configured here. */
function configPath(a: LoopbackArgs, io: CliIO, lio: LoopbackIO): string {
  const given = one(a, "--config");
  if (given !== undefined) return given;
  const name = givenName(a);
  if (name !== undefined) {
    const place = placeOf(name, io, lio);
    // Its account's system relay: its config is that account's own, in root's directory.
    const system = systemPlace(name).config;
    return place.scope === "user" && !lio.files.exists(place.config) && lio.files.exists(system) ? system : place.config;
  }
  const dir = placeOf("x", io, lio).config.replace(/\/[^/]*$/, "");
  const found = lio.files.list(dir).filter((f) => /^loopback-[a-z0-9][a-z0-9_-]*\.json$/.test(f));
  if (found.length === 1) return `${dir}/${found[0]}`;
  throw new LoopbackUsageError(found.length === 0 ? `No loopback relay is set up here (${dir}). Start one with: ${CLI_NAME} loopback up --url <the address you open Lumiverse at>` : `Several relays are set up here (${found.map((f) => f.slice(9, -5)).join(", ")}): pick one with --name.`);
}

// ---------------------------------------------------------------- the config

/** A config as its file holds it (`loopback.json`). */
function configText(config: LoopbackConfig): string {
  return `${JSON.stringify({ lumirpengine: FORMAT, loopback: config }, null, 2)}\n`;
}

function writeConfig(path: string, config: LoopbackConfig, lio: LoopbackIO, owner: { uid: number; gid: number } | null): void {
  // As root the directory is /etc/lumirpengine, which the unit's account must get through to its own config.
  lio.files.write(path, configText(config), 0o600, lio.uid === 0 ? 0o755 : 0o700);
  if (owner !== null) lio.files.chown(path, owner.uid, owner.gid);
}

export function readConfig(path: string, lio: LoopbackIO): LoopbackConfig {
  const text = lio.files.read(path);
  if (text === null) throw new Error(`There is no loopback config at ${path}. Set the relay up with: ${CLI_NAME} loopback up`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${path} isn't readable JSON. Set the relay up again with: ${CLI_NAME} loopback up`);
  }
  const c = isRecord(raw) && raw.lumirpengine === FORMAT && isRecord(raw.loopback) ? raw.loopback : null;
  const s = c !== null && isRecord(c.session) ? c.session : null;
  if (c === null || s === null || typeof c.name !== "string" || typeof c.base !== "string" || typeof c.listen !== "string" || typeof c.port !== "number" || (c.mode !== "user" && c.mode !== "shared") || typeof c.relay !== "string" || typeof c.secret !== "string" || typeof s.username !== "string" || typeof s.token !== "string") {
    throw new Error(`${path} isn't a loopback config this lumirpengine reads. Set the relay up again with: ${CLI_NAME} loopback up`);
  }
  const tuning: Partial<Tuning> = {};
  if (isRecord(c.tuning)) for (const [k, v] of Object.entries(c.tuning)) if (hasOwn(RELAY_DEFAULTS, k) && typeof v === "number" && v > 0) (tuning as Record<string, number>)[k] = v;
  return { name: c.name, base: c.base, listen: c.listen, port: c.port, mode: c.mode, relay: c.relay, secret: c.secret, session: { username: s.username, token: s.token, savedAt: typeof s.savedAt === "number" ? s.savedAt : 0, ...(s.allowHttp === true ? { allowHttp: true } : {}) }, tuning };
}

// ---------------------------------------------------------------- sign-in

/** A new session: the password from LUMIVERSE_PASSWORD or a hidden prompt, never kept. */
async function signInFor(base: string, io: CliIO, username: string | undefined, allowHttp: boolean): Promise<StoredLogin> {
  const clear = inClear(base);
  if (clear && !allowHttp) throw new LoopbackUsageError(`${base} is plain http to another machine: the password, and the relay's session on every call after, would cross the network in clear. Use Lumiverse's https address, or accept that with --allow-http.`);
  // Asked as nobody first: a redirect, an untrusted host or a lockout stops here, before a password is sent.
  await sessionOf(io.http, base, null);
  const user = username ?? io.env.LUMIVERSE_USERNAME ?? (await io.ask("Lumiverse username for the loopback: ", false));
  if (user === null || user.trim() === "") throw new LoopbackUsageError("The loopback needs your Lumiverse username: --username <name>, or LUMIVERSE_USERNAME.");
  const password = io.env.LUMIVERSE_PASSWORD ?? (await io.ask(`Password for ${user.trim()} at ${base}: `, true));
  if (password === null || password === "") throw new LoopbackUsageError("No password: run this in a terminal and type it at the prompt, or set LUMIVERSE_PASSWORD.");
  const token = await signIn(io.http, base, user.trim(), password);
  return { username: user.trim(), token, savedAt: Date.now(), ...(clear ? { allowHttp: true as const } : {}) };
}

/** The saved sign-in when it still holds, else a new one. */
async function sessionFor(base: string, a: LoopbackArgs, io: CliIO): Promise<StoredLogin> {
  const saved = io.credentials.get(base);
  if (saved !== null && (one(a, "--username") === undefined || one(a, "--username") === saved.username)) {
    const state = await sessionOf(io.http, base, saved.token).catch(() => null);
    if (state?.valid === true) {
      io.out(`Using your saved sign-in to ${base} as ${saved.username}. (If you sign that session out, sign the relay in again: ${CLI_NAME} loopback login.)`);
      return saved;
    }
  }
  return signInFor(base, io, one(a, "--username") ?? saved?.username, a.flags["--allow-http"] === true || saved?.allowHttp === true);
}

function connectionFor(base: string, session: StoredLogin, io: CliIO): HostConnection {
  return new HostConnection({ base, credentials: () => session, http: io.http, openSocket: io.openSocket, client: { name: CLI_NAME, version: CLI_VERSION, serves: "command" }, timeoutMs: 30_000 });
}

// ---------------------------------------------------------------- up

/** Whether the port is free to serve on, by serving on it for a moment. */
function portFree(lio: LoopbackIO, listen: string, port: number): boolean {
  const serve = lio.serve;
  if (serve === null) return false;
  try {
    serve({ hostname: listen, port, fetch: async () => new Response(null, { status: 503 }) }).stop();
    return true;
  } catch {
    return false;
  }
}

function portOf(a: LoopbackArgs, lio: LoopbackIO, listen: string, previous: LoopbackConfig | null): number {
  const given = one(a, "--port");
  if (given !== undefined) {
    const port = Number(given);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new LoopbackUsageError(`--port is "${given}": give a port number.`);
    // The relay already set up there holds it: `up` restarts that one.
    if (previous?.port !== port && !portFree(lio, listen, port)) throw new Error(`Port ${port} on ${listen} is taken. Pick another with --port.`);
    return port;
  }
  if (previous !== null && previous.listen === listen) return previous.port;
  for (let port = DEFAULT_PORT; port <= LAST_PORT; port++) if (portFree(lio, listen, port)) return port;
  throw new Error(`No port from ${DEFAULT_PORT} to ${LAST_PORT} is free on ${listen}: pick one with --port.`);
}

/** In a container (the official compose runs Lumiverse in one), where systemd isn't and 127.0.0.1 is the container's own. */
function inContainer(lio: LoopbackIO): boolean {
  return lio.files.exists("/.dockerenv") || lio.files.exists("/run/.containerenv");
}

function dockerGuide(bun: string, self: string, config: string, base: string): string {
  return [
    "Lumiverse runs in a container here: there is no systemd, and Lumiverse's 127.0.0.1 is the container's own.",
    "Run the relay inside Lumiverse's container, as a second process:",
    `  ${bun} ${self} loopback up --url ${base}`,
    "or as a compose service that shares Lumiverse's network (127.0.0.1 is then the same for both):",
    "  lumirpengine-loopback:",
    "    image: <Lumiverse's image>",
    '    network_mode: "service:lumiverse"',
    "    volumes: [<Lumiverse's data volume, mounted where it is in Lumiverse's service>]",
    `    command: ["${bun}", "${self}", "loopback", "serve", "--config", "${config}"]`,
    "    restart: always",
    `(run \`loopback up\` once inside the container first, so ${config} exists).`,
  ].join("\n");
}

/** A word of a unit's ExecStart: quoted when it must be, `%` and `$` escaped (systemd.service(5)). */
function unitWord(word: string): string {
  const escaped = word.replace(/%/g, "%%").replace(/\$/g, "$$$$");
  return /^[A-Za-z0-9_@%+=:,./$-]+$/.test(escaped) ? escaped : `"${escaped.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function unitText(u: { name: string; bun: string; script: string; config: string; scope: "system" | "user"; account: string | null; after: string | null }): string {
  const system = u.scope === "system";
  return [
    `# Written by \`${CLI_NAME} loopback up\`: LumiRPEngine's loopback relay. ${system ? `\`${systemdLines(u.name).down}\`` : `\`${CLI_NAME} loopback down --name ${u.name}\``} removes it.`,
    "[Unit]",
    `Description=LumiRPEngine loopback relay (${u.name})`,
    ...(system ? [`After=network-online.target${u.after !== null ? ` ${u.after}` : ""}`, "Wants=network-online.target"] : []),
    // It reconnects until Lumiverse answers, however long Lumiverse takes to start: never give up on it.
    "StartLimitIntervalSec=0",
    "",
    "[Service]",
    "Type=simple",
    ...(system && u.account !== null ? [`User=${u.account}`] : []),
    `ExecStart=${[u.bun, u.script, "loopback", "serve", "--config", u.config].map(unitWord).join(" ")}`,
    "Restart=always",
    "RestartSec=2",
    "",
    "[Install]",
    `WantedBy=${system ? "multi-user.target" : "default.target"}`,
    "",
  ].join("\n");
}

async function must(lio: LoopbackIO, command: string, args: readonly string[], env?: Readonly<Record<string, string>>): Promise<string> {
  const r = await lio.run(command, args, env);
  if (r.code !== 0) throw new Error(`${command} ${args.join(" ")} failed (${r.code}): ${(r.err || r.out).trim()}`);
  return r.out.trim();
}

/**
 * The account a system unit runs as: --account, else the one the relay set up here before under
 * this name runs as (its config is that account's). Never root: the relay needs no more rights than
 * the account Lumiverse runs as.
 */
async function accountOf(a: LoopbackArgs, place: Place, lio: LoopbackIO): Promise<{ name: string; uid: number; gid: number }> {
  let name = one(a, "--account");
  if (name === undefined) {
    const owner = lio.files.exists(place.config) ? lio.files.stat(place.config)?.uid : undefined;
    if (owner === undefined || owner === 0) throw new LoopbackUsageError("Name the account the relay's system service runs as, the one Lumiverse runs as: --account <user>.");
    name = await must(lio, "id", ["-nu", String(owner)]);
  }
  const uid = Number(await must(lio, "id", ["-u", name]));
  if (uid === 0) throw new LoopbackUsageError(`${name} is root, and the relay never runs as root: name the account Lumiverse runs as with --account <user>.`);
  const gid = Number(await must(lio, "id", ["-g", name]));
  return { name, uid, gid };
}

async function up(a: LoopbackArgs, io: CliIO, lio: LoopbackIO): Promise<number> {
  if (lio.serve === null || lio.bun === null) throw new LoopbackUsageError(`The loopback relay runs on Bun (Bun.serve, idleTimeout 0): run this line with Bun, as LumiRPEngine → Settings → Loopback shows it.`);
  const systemd = a.flags["--systemd"] === true;
  const given = one(a, "--url") ?? io.env.LUMIVERSE_URL;
  const stored = io.credentials.bases();
  const asked = given ?? (stored.length === 1 ? stored[0] : await io.ask("Lumiverse address (as you open it in a browser): ", false));
  if (asked === null || asked === undefined || asked.trim() === "") throw new LoopbackUsageError("loopback up needs Lumiverse's address: --url <base>, or LUMIVERSE_URL.");
  const base = normalizeBase(asked);
  const listen = one(a, "--listen") ?? LISTEN;
  if (listen !== LISTEN && listen !== "localhost") io.err(`Warning: the relay will listen on ${listen}, where other machines can reach it, not only this one. Every call still needs a loopback key and must be addressed to ${listen} itself, unless that is a wildcard address (0.0.0.0, ::), which answers any name; nothing else stands between them and it.`);
  const mode: RelayMode = a.flags["--shared"] === true ? "shared" : "user";
  const bun = one(a, "--bun") ?? lio.bun;
  if (!bun.startsWith("/")) throw new LoopbackUsageError(`--bun must be an absolute path (systemd and sudo search no PATH that has Bun): ${bun}`);
  if (systemd && lio.platform !== "linux") throw new Error(`--systemd installs a systemd service, and this is ${lio.platform}. Run the relay in the foreground instead (leave out --systemd), under your own service manager.`);
  if (systemd && inContainer(lio)) throw new Error(dockerGuide(bun, lio.self, placeOf(givenName(a) ?? "relay", io, lio).config, base));
  if (systemd && /\.ts$/.test(lio.self)) throw new Error(`The service runs a built relay, and this runs from source (${lio.self}). Build first (bun run build), then run dist/lumirpengine.js.`);

  const session = await sessionFor(base, a, io);
  const name = givenName(a) ?? nameFrom(session.username);
  const place = placeOf(name, io, lio);
  // A system service already runs a relay of this name here: registering this one would take its registration from it.
  const system = systemPlace(name);
  if (place.scope === "user" && lio.files.exists(system.config)) throw new LoopbackUsageError(`A system service runs the relay "${name}" on this machine (${system.config}). Set this one up under another --name, or update that one with its own line on LumiRPEngine → Settings → Loopback.`);
  const account = systemd && place.scope === "system" ? await accountOf(a, place, lio) : null;
  // A relay set up here before under this name keeps its port and tuning.
  let previous: LoopbackConfig | null = null;
  try {
    previous = readConfig(place.config, lio);
  } catch {
    // None yet, or unreadable: set up afresh.
  }
  const port = portOf(a, lio, listen, previous);

  // Registered before anything is written: LumiRPEngine refuses `shared` unless the operator allowed it.
  const conn = connectionFor(base, session, io);
  let registered: { relay: string; secret: string; mode: RelayMode; model: string; user: string };
  try {
    registered = await conn.request("lre.loopback.register", { name, mode, build: BUILD, host: lio.hostname, listen, port });
  } catch (error) {
    if (error instanceof LreError) throw new Error(`LumiRPEngine didn't register the relay: ${error.message}`);
    if (error instanceof LiveError && error.problem === "timeout") throw new Error(`LumiRPEngine on ${base} didn't answer the loopback's registration. Update LumiRPEngine (Extensions → LumiRPEngine → Update): the loopback needs a build with its bridge.`);
    throw error;
  } finally {
    conn.close();
  }
  // The reply's `user` is the account's id: the account is named by the username it signed in with.
  const who = session.username;
  io.out(`Registered the relay "${name}" with LumiRPEngine: it carries ${registered.mode === "shared" ? "every user's turns (the shared relay)" : `${who}'s turns`}.`);

  const origins = relayOrigins(listen, port);
  const scheduler = await excludeOrigins(io.http, base, session.token, origins);
  // Core reads the scheduler's setting through a 5-second cache (D0a check 7): a turn begun sooner still waits behind the old one.
  if (scheduler === "excluded") io.out(`Its address (${origins.join(", ")}) is in ${who}'s local-inference scheduler exclusions (in effect within 5 seconds), so the scheduler never holds a turn's own calls behind it.`);
  else if (scheduler === "unavailable") io.out("This Lumiverse has no local-inference scheduler: nothing to exclude.");
  else io.err(`Couldn't put ${origins.join(" and ")} in ${who}'s local-inference scheduler exclusions. Before turning the scheduler on, add them under Settings → Inference scheduler → Excluded origins: a loopback turn would otherwise wait on its own calls.`);
  if (registered.mode === "shared") io.out(`As the shared relay: each user who turns the local-inference scheduler on must add ${origins.join(" and ")} to their own Excluded origins (Settings → Inference scheduler); the relay can do it only for ${who}.`);

  const config: LoopbackConfig = { name, base, listen, port, mode: registered.mode, relay: registered.relay, secret: registered.secret, session, tuning: previous?.tuning ?? {} };
  const connection = `In Lumiverse, the loopback is a Custom (OpenAI-compatible) connection: base URL ${relayBase(listen, port)}, model ${registered.model || LOOPBACK_MODEL}, and as its API key your loopback key (LumiRPEngine → Settings → Loopback).`;

  if (!systemd) {
    writeConfig(place.config, config, lio, null);
    io.out(`Saved the relay's config in ${place.config} (readable only by you).`);
    io.out(connection);
    if (inContainer(lio)) io.out(dockerGuide(bun, lio.self, place.config, base));
    return serve(config, place.config, io, lio);
  }

  writeConfig(place.config, config, lio, account);
  // A stable copy the unit owns: an update of LumiRPEngine removes and replaces its install (F32). A
  // system unit's are root's alone, Bun's among them, so its account can change none of what it runs.
  const dir = lio.self.replace(/\/[^/]*$/, "");
  const script = `${place.data}/${lio.self.slice(dir.length + 1)}`;
  lio.files.copy(lio.self, script, 0o644);
  lio.files.copy(`${dir}/${KIT_FILE}`, `${place.data}/${KIT_FILE}`, 0o644);
  const runBun = place.scope === "system" ? `${place.data}/bun` : bun;
  if (runBun !== bun) lio.files.copy(bun, runBun, 0o755);
  lio.files.write(place.unit, unitText({ name, bun: runBun, script, config: place.config, scope: place.scope, account: account?.name ?? null, after: one(a, "--after") ?? (place.scope === "system" ? "lumiverse.service" : null) }), 0o644, 0o755);
  const ctl = ctlOf(place, io, lio);
  // Before the unit starts: lingering also starts the user's service manager, which `systemctl --user` needs.
  const user = place.scope === "user" ? await must(lio, "id", ["-nu"]) : null;
  const lingering = user === null || (await linger(io, lio, user));
  try {
    await must(lio, "systemctl", [...ctl.args, "daemon-reload"], ctl.env);
  } catch (error) {
    // No user manager to reach: lingering is off, and the account has no session of its own (`sudo -u`).
    if (lingering) throw error;
    throw new Error(`${user}'s service manager isn't running (lingering is off, and ${user} isn't logged in), so the relay's user service can't start. Turn lingering on with: sudo loginctl enable-linger ${user}, then run this again.`);
  }
  await must(lio, "systemctl", [...ctl.args, "enable", place.unitName], ctl.env);
  if (previous !== null) await drain(previous, io, lio);
  await must(lio, "systemctl", [...ctl.args, "restart", place.unitName], ctl.env);
  const when = lingering ? "it is started, and starts at boot and keeps running when you log out" : "it is started, but only runs while you are logged in (see above)";
  io.out(`Installed the relay in ${place.data} and the ${place.scope} unit ${place.unitName}${account !== null ? `, run as ${account.name}` : ""}; ${when}.`);
  io.out(connection);
  return 0;
}

/**
 * A user unit starts at boot and outlives a logout only with lingering on (systemd-logind): on
 * already, turned on now (logind lets a user do it for themself where its policy allows), or the
 * line that does it. Whether it is on in the end.
 */
async function linger(io: CliIO, lio: LoopbackIO, user: string): Promise<boolean> {
  const on = async (): Promise<boolean> => (await lio.run("loginctl", ["show-user", user, "--property=Linger", "--value"])).out.trim() === "yes";
  if (await on()) return true;
  const asked = await lio.run("loginctl", ["enable-linger", user]);
  if (asked.code === 0 && (await on())) {
    io.out(`Turned lingering on for ${user}, so the relay's user service starts at boot and keeps running after you log out.`);
    return true;
  }
  io.err(`Lingering is off for ${user} and couldn't be turned on from here${asked.err.trim() !== "" ? ` (${asked.err.trim()})` : ""}: the relay's user service won't start at boot and stops when you log out. Turn it on with: sudo loginctl enable-linger ${user}`);
  return false;
}

// ---------------------------------------------------------------- serve

/** Runs the relay until the process is asked to stop. `path` is its config, read again for the session whenever the link opens, so a `loopback login` takes effect without a restart. */
export async function serve(config: LoopbackConfig, path: string, io: CliIO, lio: LoopbackIO): Promise<number> {
  const start = lio.serve;
  if (start === null) throw new LoopbackUsageError("The loopback relay runs on Bun (Bun.serve, idleTimeout 0): run it with Bun.");
  const log = (text: string): void => io.err(`[loopback ${config.name}] ${text}`);
  const settings: RelaySettings = { ...RELAY_DEFAULTS, ...config.tuning, listen: config.listen, port: config.port, mode: config.mode };
  // systemd marks what it runs with INVOCATION_ID: then the unit is the one `up` names for this relay, a
  // system unit when its config is a system relay's, whatever account the unit runs it as (`User=`).
  const unit = io.env.INVOCATION_ID !== undefined ? { name: relayUnitName(config.name), scope: path.startsWith(`${SYSTEM_CONFIG_DIR}/`) ? ("system" as const) : ("user" as const) } : null;
  let session = config.session;
  const credentials = (): StoredLogin => {
    try {
      session = readConfig(path, lio).session;
    } catch {
      // The file went or broke under it: the session it started with stands.
    }
    return session;
  };
  const link = new LoopbackLink({ base: config.base, credentials, http: io.http, openSocket: io.openSocket, secret: config.secret, name: config.name, build: BUILD, runtime: { bun: lio.bun, script: lio.self, unit }, host: lio.hostname, listen: config.listen, port: config.port, now: Date.now, log, timeoutMs: 60_000, probeMs: settings.probeMs, silentMs: settings.silentMs, crashMs: settings.crashMs });
  const encoder = new TextEncoder();
  const relay = new Relay(link, settings, {
    now: Date.now,
    id: () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join(""),
    log,
    fingerprint: async (key) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(key)))].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join(""),
  });
  link.attach(relay);
  let server: Served;
  try {
    server = start({ hostname: config.listen, port: config.port, fetch: relay.fetch });
  } catch (error) {
    throw new Error(`The relay can't serve on ${config.listen}:${config.port}: ${error instanceof Error ? error.message : String(error)}. Is another relay running there?`);
  }
  log(`serving ${relayBase(config.listen, config.port)} for ${config.base} as ${config.session.username} (${config.mode === "shared" ? "the shared relay" : "its own turns"})`);
  void link.fix();
  const timer = setInterval(() => {
    link.tick();
    relay.tick();
  }, 1_000);
  const signal = await lio.stopped();
  log(`stopping (${signal})`);
  clearInterval(timer);
  relay.shutdown();
  // A moment for the error chunks and aborts to go out.
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 500);
  await promise;
  server.stop();
  link.close();
  return 0;
}

// ---------------------------------------------------------------- login, status, down

async function restartIfInstalled(place: Place, io: CliIO, lio: LoopbackIO): Promise<void> {
  if (!lio.files.exists(place.unit)) return;
  const ctl = ctlOf(place, io, lio);
  await must(lio, "systemctl", [...ctl.args, "restart", place.unitName], ctl.env);
  io.out(`Restarted ${place.unitName}.`);
}

/** How long `up` waits for the running relay's calls to finish before restarting it, and how often it asks. */
const DRAIN_MS = 300_000;
const DRAIN_POLL_MS = 2_000;

/** The calls the relay running with this config has under way, from its /healthz; 0 when it doesn't answer. */
async function callsUnderWay(config: LoopbackConfig, io: CliIO): Promise<number> {
  try {
    const host = config.listen.includes(":") && !config.listen.startsWith("[") ? `[${config.listen}]` : config.listen;
    const reply = await io.http({ method: "GET", url: `http://${host}:${config.port}/healthz`, headers: { Accept: "application/json" } });
    const body: unknown = JSON.parse(reply.text);
    return isRecord(body) && typeof body.calls === "number" ? body.calls : 0;
  } catch {
    return 0;
  }
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Before `up` restarts a running relay: a restart cuts the turns it carries, so it waits for them to finish, up to DRAIN_MS. */
async function drain(config: LoopbackConfig, io: CliIO, lio: LoopbackIO): Promise<void> {
  let calls = await callsUnderWay(config, io);
  if (calls === 0) return;
  io.out(`The running relay has ${calls} call(s) under way: waiting up to ${DRAIN_MS / 60_000} minutes for them to finish before restarting it.`);
  const sleep = lio.sleep ?? delay;
  for (let n = 0; n < DRAIN_MS / DRAIN_POLL_MS && calls > 0; n++) {
    await sleep(DRAIN_POLL_MS);
    calls = await callsUnderWay(config, io);
  }
  if (calls > 0) io.err(`${calls} call(s) still under way after ${DRAIN_MS / 60_000} minutes: restarting the relay ends them.`);
}

async function login(a: LoopbackArgs, io: CliIO, lio: LoopbackIO): Promise<number> {
  const path = configPath(a, io, lio);
  const config = readConfig(path, lio);
  const session = await signInFor(config.base, io, one(a, "--username") ?? config.session.username, config.session.allowHttp === true);
  // A system relay's config is its account's, in root's directory: that account signs it in again (Settings → Loopback's line runs the service's root-owned copies as it, never as root: the late security review, S1), writing over the file in place, as it can't rename one into root's directory; root restarts the unit.
  const system = path.startsWith(`${SYSTEM_CONFIG_DIR}/`);
  if (system && lio.uid !== 0) lio.files.rewrite(path, configText({ ...config, session }));
  else {
    const owner = lio.uid === 0 ? (lio.files.stat(path)?.uid ?? null) : null;
    const gid = owner !== null && owner !== 0 ? Number(await must(lio, "id", ["-g", String(owner)])) : null;
    writeConfig(path, { ...config, session }, lio, owner !== null && owner !== 0 && gid !== null ? { uid: owner, gid } : null);
  }
  io.out(`The relay "${config.name}" is signed in to ${config.base} as ${session.username} again.`);
  const place = system ? systemPlace(config.name) : placeOf(config.name, io, lio);
  if (!lio.files.exists(place.unit)) io.out("A relay running in the foreground takes the new sign-in when it next connects.");
  else if (place.scope === "system" && lio.uid !== 0) io.out(`Its system service takes the new sign-in when it next connects; restart it as root to have it at once: sudo systemctl restart ${place.unitName}`);
  else await restartIfInstalled(place, io, lio);
  return 0;
}

async function status(a: LoopbackArgs, io: CliIO, lio: LoopbackIO): Promise<number> {
  const path = configPath(a, io, lio);
  const config = readConfig(path, lio);
  // As its account, a system relay's unit is root's: systemd's own program shows it (the final security review, F1).
  const system = lio.uid !== 0 && path.startsWith(`${SYSTEM_CONFIG_DIR}/`);
  const place = system ? systemPlace(config.name) : placeOf(config.name, io, lio);
  io.out(`Relay "${config.name}" (${config.mode === "shared" ? "the shared relay" : "its own account's turns"}) for ${config.base} as ${config.session.username}, at ${relayBase(config.listen, config.port)}.`);
  if (system) io.out(`Service ${place.unitName}: a system service, which systemd's own program shows: ${systemdLines(config.name).status}`);
  else if (lio.files.exists(place.unit)) {
    const ctl = ctlOf(place, io, lio);
    const active = await lio.run("systemctl", [...ctl.args, "is-active", place.unitName], ctl.env);
    io.out(`Service ${place.unitName}: ${active.out.trim() || "unknown"}.`);
  } else io.out("No service: it runs only while `loopback up` or `loopback serve` does.");
  let healthy = false;
  try {
    const host = config.listen.includes(":") && !config.listen.startsWith("[") ? `[${config.listen}]` : config.listen;
    const reply = await io.http({ method: "GET", url: `http://${host}:${config.port}/healthz`, headers: { Accept: "application/json" } });
    const body: unknown = JSON.parse(reply.text);
    if (isRecord(body)) {
      healthy = body.ok === true && body.link === "up";
      io.out(`It answers: link to LumiRPEngine ${String(body.link)}, ${String(body.calls)} call(s) under way${typeof body.problem === "string" ? `. ${body.problem}` : ""}.`);
    }
  } catch (error) {
    io.out(`It doesn't answer on ${config.listen}:${config.port} (${error instanceof Error ? error.message : String(error)}).`);
  }
  try {
    const session = await sessionOf(io.http, config.base, config.session.token);
    io.out(session.valid === false ? `Its Lumiverse session has ended: ${CLI_NAME} loopback login --name ${config.name}` : `Its Lumiverse session holds${session.expiresAt !== null ? ` until ${session.expiresAt} unused (the relay renews it daily)` : ""}.`);
    if (session.valid === false) healthy = false;
  } catch (error) {
    io.out(`Couldn't ask ${config.base} about its session: ${error instanceof Error ? error.message : String(error)}`);
  }
  return healthy ? 0 : 1;
}

async function down(a: LoopbackArgs, io: CliIO, lio: LoopbackIO): Promise<number> {
  const name = givenName(a) ?? readConfig(configPath(a, io, lio), lio).name;
  const place = placeOf(name, io, lio);
  if (!lio.files.exists(place.unit)) {
    // As its account, a system relay's unit is root's to remove, with systemd's own programs (the final security review, F1).
    const system = systemPlace(name);
    if (place.scope === "user" && lio.files.exists(system.unit)) {
      throw new Error([`The relay "${name}" runs as a system service, which root stops and removes with systemd's own programs:`, `  ${systemdLines(name).down}`, `Its config, with the relay's session, stays in ${system.config}: delete it to forget the relay here.`].join("\n"));
    }
    io.out(`There is no ${place.scope} unit ${place.unitName}: nothing to stop.`);
    return 0;
  }
  const ctl = ctlOf(place, io, lio);
  await must(lio, "systemctl", [...ctl.args, "disable", "--now", place.unitName], ctl.env);
  lio.files.remove(place.unit);
  await must(lio, "systemctl", [...ctl.args, "daemon-reload"], ctl.env);
  io.out(`Stopped and removed ${place.unitName}. Its config, with the relay's session, stays in ${place.config}: delete it to forget the relay here.`);
  return 0;
}
