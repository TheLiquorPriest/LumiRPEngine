// Steps 4 to 8 of making the test instance from nothing (PlanScenarios-4 item 1): today's command
// line signed in for both users; today's runtime set up for both, each as a systemd user unit held to
// its memory cap, killed first under memory pressure and keeping its config, data and caches in the
// instance's own folders; the owner's runtime made ready to play the harness engine and its own
// settings changed; and a runtime folder that no config names. Every command is today's own: the
// command line and the runtime shipped in today's build (`dist/lumirpengine.js`, `dist/lumiah.js`),
// and the requests of the harness pages (the drawer's Harness tab → System → Runtime and Settings:
// RPE `main` src/frontend/harness/pages.tsx:46, :57), sent over Lumiverse's event socket.
//
// "LumiAH" below is LumiAH's src/ at the commit today's build pins (RPE `main` package.json); "RPE
// main" is today's pushed build; "Lumiverse" is its src/ at a70f4ed2.
//
// Bounds this file keeps, because it runs on a shared machine: it starts, stops and changes only the
// units and files it made (each named for a runtime the run is given); it stops a process only by the
// pid it started it with; it never runs pkill or killall, and none of its waits matches processes by
// pattern; every unit it makes is memory-capped (`--memory`) and given the drop-in below.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import { isRecord } from "./json";
import { IDENTIFIER } from "../env";
import type { Json } from "../record";
import { say } from "../record";
import { EngineSocket } from "../socket";
import type { InstanceEnv, Who } from "./env";
import { buildDir, cliConfigHome, credentialsFile, lumiahPath, runtimeXdg } from "./env";
import type { SetupCtx, SetupStep } from "./setup";

const WHO: readonly Who[] = ["owner", "other"];

/** Where a system keeps its own programs: LumiAH's runtime finds systemctl and the rest there and never through PATH (LumiAH runtime/update/programs.ts:1-17), and so does this file. */
const SYSTEM_FOLDERS: readonly string[] = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

/** systemctl and git each get a minute: LumiAH ends the programs it runs after one, since none takes that long (LumiAH runtime/main.ts:162-163). */
const PROGRAM_MS = 60_000;
/** `lumirpengine login`: one sign-in, then a hello to the engine to say whether it answers (RPE main src/cli/commands.ts:379-391). */
const CLI_MS = 2 * 60_000;
/**
 * `lumiah up --systemd`: it may wait out the replies a runtime set up before is answering, up to
 * its drain time of five minutes (LumiAH link/settings.ts:233, runtime/cli.ts:935-945), besides its
 * sign-in, its registration and a minute for each systemctl call (runtime/main.ts:162-163).
 */
const UP_MS = 10 * 60_000;
/** `lumiah down`: two systemctl calls (LumiAH runtime/cli.ts:1000-1005), a minute each at most. */
const DOWN_MS = 3 * 60_000;
/**
 * How long a started runtime may take to show as linked on the Runtime page. It reconnects to
 * Lumiverse with waits doubling from a second up to thirty (LumiAH link/settings.ts:236-237), so
 * three minutes holds several tries after a cold start.
 */
const LINK_MS = 3 * 60_000;
/**
 * How long the owner's runtime may take to write a changed tuning into its config: it reads the
 * user's settings again as soon as the extension names a new revision of them, and keeps its own
 * limits in its config when they differ (LumiAH runtime/settings.ts:1-5, :41-46, :57-67; cli.ts:850,
 * :816-824).
 */
const TUNING_MS = 60_000;
/** How often a wait above looks again. */
const POLL_MS = 3_000;

/** Raised rather than lowered, so the owner's account may set it for its own units: under memory pressure, what the set-up started goes first. */
const OOM_SCORE = 1000;
/** The drop-in's file, in the unit's own `.d` folder. */
const DROP_IN = "test-instance.conf";
/** Bun's caches: the script runs with them out of the account's home, and so must every unit it makes. */
const BUN_CACHES = ["BUN_INSTALL_CACHE_DIR", "BUN_RUNTIME_TRANSPILER_CACHE_PATH"] as const;

/** A runtime's name, as `lumiah up --name` takes it (LumiAH link/contract.ts:97). */
const RUNTIME_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** What the runtime-folder step's runtime is named after the owner's runtime's own name. */
const LEFT_SUFFIX = "-left";

/**
 * The tuning value the runtime-settings step changes: how often the runtime asks Lumiverse about its
 * session, which renews it. Its default is a day (LumiAH link/settings.ts:238) and the Settings page
 * takes a minute to seven days (:456); half a day changes nothing a run of the instance can notice.
 */
const TUNING_PATH = ["transport", "runtime", "sessionCheckMs"];
const TUNING_VALUE = 12 * 60 * 60_000;

const LOOPBACK = "127.0.0.1";

// ---------------------------------------------------------------- programs

interface Ran {
  code: number;
  out: string;
  err: string;
}

/** A program in the system's own folders. */
function program(name: string): string {
  for (const folder of SYSTEM_FOLDERS) if (existsSync(join(folder, name))) return join(folder, name);
  throw new Error(`${name} isn't in ${SYSTEM_FOLDERS.join(", ")}`);
}

/**
 * Runs a program to its end with `extra` over this process's environment and nothing on its
 * standard input, so a command that would ask on a terminal finds none; past `limitMs` it is ended
 * by the pid this process started it with, and the call fails.
 */
async function runProgram(argv: string[], extra: Record<string, string>, limitMs: number): Promise<Ran> {
  const proc = Bun.spawn(argv, { env: { ...process.env, ...extra }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    proc.kill();
  }, limitMs);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (late) throw new Error(`${argv.slice(0, 3).join(" ")} … didn't end within ${Math.round(limitMs / 1000)} s and was stopped`);
  return { code, out, err };
}

/** The last words a program said, for a plain failure. */
function said(ran: Ran): string {
  const words = `${ran.err.trim()}\n${ran.out.trim()}`.trim();
  return words.length > 1200 ? `…${words.slice(-1200)}` : words || "(it said nothing)";
}

/** `git -C <dir> <args>`, its answer trimmed. */
export async function git(dir: string, args: string[]): Promise<string> {
  const ran = await runProgram([program("git"), "-C", dir, ...args], {}, PROGRAM_MS);
  if (ran.code !== 0) throw new Error(`git -C ${dir} ${args.join(" ")} failed (${ran.code}): ${said(ran)}`);
  return ran.out.trim();
}

/** `systemctl --user`, reaching the account's own service manager as LumiAH does: by XDG_RUNTIME_DIR, else `/run/user/<uid>` (LumiAH runtime/update/service.ts:54-58). */
async function systemctlRan(args: string[]): Promise<Ran> {
  const uid = process.getuid?.();
  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? (uid !== undefined ? `/run/user/${uid}` : undefined);
  return runProgram([program("systemctl"), "--user", ...args], runtimeDir !== undefined ? { XDG_RUNTIME_DIR: runtimeDir } : {}, PROGRAM_MS);
}

async function systemctl(args: string[]): Promise<string> {
  const ran = await systemctlRan(args);
  if (ran.code !== 0) throw new Error(`systemctl --user ${args.join(" ")} failed (${ran.code}): ${said(ran)}`);
  return ran.out.trim();
}

async function unitActive(unit: string): Promise<boolean> {
  return (await systemctlRan(["is-active", unit])).out.trim() === "active";
}

async function unitProperty(unit: string, property: string): Promise<string> {
  return systemctl(["show", `--property=${property}`, "--value", unit]);
}

// ---------------------------------------------------------------- the command line's sign-in

/** Lumiverse's address as today's command line keys its sign-ins: origin and path, no trailing slash (RPE main src/cli/credentials.ts:36-49). */
function cliBase(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

/**
 * The sign-in today's command line saved for `who` at this Lumiverse, when it is that user's: the
 * file is `{ lumirpengine: 1, hosts: { <base>: { username, token, savedAt } } }` (RPE main
 * src/cli/credentials.ts:62, :79-91). The token is a whole-account credential: it is handed only to
 * the REST client, never printed or logged.
 */
export function savedLogin(env: InstanceEnv, who: Who): { username: string; token: string } | null {
  const path = credentialsFile(env, who);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} isn't readable JSON: it isn't a sign-in today's command line wrote`);
  }
  const hosts = isRecord(raw) && isRecord(raw.hosts) ? raw.hosts : {};
  const entry = hosts[cliBase(env.hostUrl)];
  if (!isRecord(entry) || typeof entry.username !== "string" || typeof entry.token !== "string" || entry.token === "") return null;
  // Lumiverse keeps usernames in lower case (Lumiverse src/auth/index.ts:114-116).
  if (entry.username.toLowerCase() !== env[who].username.toLowerCase()) return null;
  return { username: entry.username, token: entry.token };
}

export const cli: SetupStep = {
  name: "cli",
  makes: "today's command line signed in as each user, its sign-in inside the runtime home",
  async run(s) {
    const base = cliBase(s.env.hostUrl);
    for (const who of WHO) {
      const account = s.env[who];
      const file = credentialsFile(s.env, who);
      if (savedLogin(s.env, who) !== null) {
        say(`  ${account.username}'s command line is signed in to ${base} already`);
        continue;
      }
      // `login --url --username`, the password from LUMIVERSE_PASSWORD where there is no terminal to
      // ask on (RPE main src/cli/commands.ts:362-382, :39-40); never as an argument, which the CLI
      // refuses (:481). It keeps the sign-in under $XDG_CONFIG_HOME (src/cli/credentials.ts:25-34).
      const ran = await runProgram(
        [process.execPath, join(buildDir(s.env), "dist", "lumirpengine.js"), "login", "--url", s.env.hostUrl, "--username", account.username],
        { XDG_CONFIG_HOME: cliConfigHome(s.env, who), LUMIVERSE_PASSWORD: account.password },
        CLI_MS,
      );
      if (ran.code !== 0) throw new Error(`lumirpengine login as ${account.username} failed (exit ${ran.code}): ${said(ran)}`);
      if (savedLogin(s.env, who) === null) throw new Error(`lumirpengine login as ${account.username} ended well, but ${file} holds no sign-in of theirs for ${base}`);
      s.log.log({ step: "cli", action: "created", kind: "command-line sign-in (lumirpengine credentials.json)", id: `${account.username}@${base}`, detail: { file } });
    }
  },
};

// ---------------------------------------------------------------- the harness pages' requests

interface RelayView {
  id: string;
  name: string;
  link: string;
  problem: string | null;
  unit: string | null;
}

/** What `lah.hello` answers that the set-up reads: the page state (LumiAH shared/ui.ts:725-747, :1452). */
interface Hello {
  runtime: { relays: RelayView[]; ready: boolean };
  settings: { values: { [key: string]: unknown }; defaults: { [key: string]: unknown } };
}

interface RuntimeConnection {
  id: string;
  name: string;
  provider: string;
  model?: string;
  key: { set: boolean } | null;
}

/** A runtime's connections as the Runtime page lists them (LumiAH shared/ui.ts:599-604). */
interface ConnectionsView {
  connections: RuntimeConnection[];
  default: string | null;
  providers: { id: string; name: string }[];
}

/** How a runtime is run and kept, as it says itself (LumiAH shared/ui.ts:378-408): whether it takes updates by itself. */
interface ServiceView {
  autoUpdate: boolean;
}

/**
 * The engine's event socket as one user's page, opened as a widget session so that it never takes
 * the frontend slot of that user's browser (lib/socket.ts:1-6). The extension is found as that user
 * sees it: one installed by the owner's Extensions page is the operator's, which every user sees
 * (Lumiverse src/routes/spindle.routes.ts:197-203, src/spindle/manager.service.ts:1927-1941).
 */
async function withPage<T>(s: SetupCtx, who: Who, use: (socket: EngineSocket) => Promise<T>): Promise<T> {
  const host = await s.session(who);
  const extension = await host.extension(IDENTIFIER);
  if (extension.status !== "running") throw new Error(`today's build is ${extension.status} for ${s.env[who].username}, not running: the install step must run first`);
  const socket = await EngineSocket.open(host, extension.id, { page: false });
  try {
    return await use(socket);
  } finally {
    socket.close();
  }
}

/** The page state, as every harness page reads it on opening. */
function hello(socket: EngineSocket): Promise<Hello> {
  return socket.lah<Hello>("lah.hello", {});
}

/** Waits until the Runtime page shows the runtime `name` linked (`link` is `linked` once it is up: LumiAH shared/ui.ts:268-307); its row there. */
async function waitLinked(s: SetupCtx, who: Who, name: string): Promise<RelayView> {
  return withPage(s, who, async (socket) => {
    const began = Date.now();
    for (;;) {
      const relay = (await hello(socket)).runtime.relays.find((r) => r.name === name);
      if (relay?.link === "linked") return relay;
      if (Date.now() - began > LINK_MS) {
        const shown = relay === undefined ? "not registered at all" : `${relay.link}${relay.problem ? `: ${relay.problem}` : ""}`;
        throw new Error(`the runtime ${name} isn't linked ${LINK_MS / 1000} s after it started; ${s.env[who].username}'s Runtime page shows it ${shown}`);
      }
      await Bun.sleep(POLL_MS);
    }
  });
}

/** The owner's runtime's row on the Runtime page, which must be linked: the runtimes step makes it so. */
async function ownersRelay(s: SetupCtx, socket: EngineSocket): Promise<{ state: Hello; relay: RelayView }> {
  const name = s.env.runtimes.owner.name;
  const state = await hello(socket);
  const relay = state.runtime.relays.find((r) => r.name === name);
  if (relay?.link !== "linked") throw new Error(`the owner's runtime ${name} isn't linked (${relay?.link ?? "not registered"}): the runtimes step must run first`);
  return { state, relay };
}

function at(value: unknown, path: readonly string[]): unknown {
  let here = value;
  for (const key of path) here = isRecord(here) ? here[key] : undefined;
  return here;
}

// ---------------------------------------------------------------- a runtime's files and unit

/** A runtime's config, as much of it as the set-up reads; never printed, since it holds the runtime's session and secret. */
interface RuntimeConfig {
  base: string;
  port: number;
  memory: string;
  autoUpdate: boolean;
  tuning: { [key: string]: unknown };
  service: { unit: string; bun: string } | null;
  username: string;
}

/** The file is `{ lumiah: 1, runtime: { … } }` (LumiAH runtime/config.ts:132-135, :17-56). */
function readConfig(path: string): RuntimeConfig | null {
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} isn't readable JSON`);
  }
  const c = isRecord(raw) && raw.lumiah === 1 && isRecord(raw.runtime) ? raw.runtime : null;
  const session = c !== null && isRecord(c.session) ? c.session : null;
  if (c === null || session === null || typeof c.name !== "string" || typeof c.base !== "string" || typeof c.port !== "number" || typeof session.username !== "string") throw new Error(`${path} isn't a runtime config today's runtime wrote`);
  const service = isRecord(c.service) && typeof c.service.unit === "string" && typeof c.service.bun === "string" ? { unit: c.service.unit, bun: c.service.bun } : null;
  return {
    base: c.base,
    port: c.port,
    memory: typeof c.memory === "string" ? c.memory : "",
    autoUpdate: c.autoUpdate !== false,
    tuning: isRecord(c.tuning) ? c.tuning : {},
    service,
    username: session.username,
  };
}

/** Where one runtime's files and unit are, and where the account's systemd reads its unit. */
interface UnitPlace {
  name: string;
  /** `lumiah-<name>.service` (LumiAH link/contract.ts:693-695). */
  unit: string;
  /** Where `up --systemd` writes it: `$XDG_CONFIG_HOME/systemd/user` (LumiAH runtime/update/service.ts:49-52, cli.ts:242-245, :655). */
  file: string;
  /** `$XDG_CONFIG_HOME/lumiah/<name>.json` (LumiAH runtime/config.ts:70-77). */
  config: string;
  /** `$XDG_DATA_HOME/lumiah/runtimes/<name>`, made by `serve` (LumiAH runtime/config.ts:79-90, cli.ts:829). */
  folder: string;
  /** The link the account's systemd reads the unit through, where it reads none of the runtime home (null where it reads `file` itself). */
  link: string | null;
  /** The drop-in, in the unit's own `.d` folder beside the link. */
  dropIn: string;
  /** The link `systemctl enable` makes for the unit's `WantedBy=default.target` (LumiAH runtime/update/service.ts:37-38) in the same folder. */
  wants: string;
  /** Where the account's own XDG folders would hold this runtime's config and folder: what must stay untouched. */
  homeConfig: string;
  homeFolder: string;
}

/** The folders the account's systemd user manager reads units from: its own answer (`UnitPath` of the manager). */
async function unitSearchPath(): Promise<string[]> {
  return (await systemctl(["show", "--property=UnitPath", "--value"])).split(/\s+/).filter((p) => p !== "");
}

/**
 * Where a runtime's unit must go to be read. `up --systemd` writes the unit under the
 * `$XDG_CONFIG_HOME` it runs with (LumiAH runtime/update/service.ts:49-52), the folder systemd's user
 * manager reads only when its own XDG_CONFIG_HOME is the same. Run with the runtime home's, as the
 * instance runs it, that folder is outside the manager's search path, and `up`'s own `systemctl
 * enable` and `restart` (cli.ts:668, :674) would find no such unit. So, where the manager doesn't
 * read it, the unit is linked into the account's own unit folder, `~/.config/systemd/user`, as
 * `systemctl link` links a unit file from outside the search path. That command refuses a file that
 * isn't there yet, and `up` writes the unit and enables it in one run (cli.ts:655-668), so the same
 * link is placed just before `up`; `lumiah down`'s `systemctl disable` takes the unit's links away
 * (cli.ts:1002; systemctl(1), disable), and the step that takes a unit down removes any it leaves.
 * Drop-ins are read only from the search path's own folders, so the drop-in sits beside the link.
 * That folder is where the environment's units are kept, and they must outlive a reboot: the golden
 * copy's restore starts them by name. The runtime's config, data and caches stay in the runtime home.
 */
async function unitPlace(env: InstanceEnv, name: string): Promise<UnitPlace> {
  if (!RUNTIME_NAME.test(name)) throw new Error(`"${name}" isn't a runtime name today's runtime takes: lowercase letters, digits, _ and -, up to 40 (LumiAH link/contract.ts:97)`);
  const xdg = runtimeXdg(env);
  const home = userInfo().homedir;
  const unit = `lumiah-${name}.service`;
  const unitDir = join(xdg.XDG_CONFIG_HOME, "systemd", "user");
  const own = join(home, ".config", "systemd", "user");
  const reads = await unitSearchPath();
  let readDir: string;
  let link: string | null;
  if (reads.includes(unitDir)) {
    readDir = unitDir;
    link = null;
  } else if (reads.includes(own)) {
    readDir = own;
    link = join(own, unit);
  } else {
    throw new Error(`the account's systemd reads user units from neither ${unitDir} nor ${own} (it reads ${reads.join(", ")}), so a runtime's unit can't be put where it reads one`);
  }
  return {
    name,
    unit,
    file: join(unitDir, unit),
    config: join(xdg.XDG_CONFIG_HOME, "lumiah", `${name}.json`),
    folder: join(xdg.XDG_DATA_HOME, "lumiah", "runtimes", name),
    link,
    dropIn: join(readDir, `${unit}.d`, DROP_IN),
    wants: join(readDir, "default.target.wants", unit),
    homeConfig: join(home, ".config", "lumiah", `${name}.json`),
    homeFolder: join(home, ".local", "share", "lumiah", "runtimes", name),
  };
}

/**
 * What every unit the set-up makes runs with, as the script runs: the runtime home's XDG folders, so
 * the runtime's config, folder and installed copy stay there, and Bun's caches where the script keeps
 * them. The unit `up --systemd` writes sets no environment (LumiAH runtime/update/service.ts:21-41),
 * and the runtime it runs finds its own folder by XDG_DATA_HOME (runtime/cli.ts:829, config.ts:64-68,
 * :79-82), so without these it would make its folder in the account's home.
 */
function unitEnvironment(env: InstanceEnv): [string, string][] {
  const xdg = runtimeXdg(env);
  const pairs: [string, string][] = [
    ["XDG_CONFIG_HOME", xdg.XDG_CONFIG_HOME],
    ["XDG_DATA_HOME", xdg.XDG_DATA_HOME],
  ];
  for (const name of BUN_CACHES) {
    const value = process.env[name];
    if (value === undefined || value.trim() === "") throw new Error(`set ${name}: every unit the set-up makes runs with the script's own Bun caches, so that none lands in the account's home`);
    pairs.push([name, value]);
  }
  // A unit line can't hold a control character, and systemd lists the environment split at spaces, which the check after the restart reads.
  for (const [name, value] of pairs) if (/[\s\u0000-\u001f\u007f]/.test(value)) throw new Error(`${name} holds a space or a control character: it can't go into a unit's environment as it is`);
  return pairs;
}

/** What is at `path`: a symbolic link's target, null for anything else there, undefined for nothing. */
function linkAt(path: string): string | null | undefined {
  let link: boolean;
  try {
    link = lstatSync(path).isSymbolicLink();
  } catch {
    return undefined;
  }
  return link ? readlinkSync(path) : null;
}

/** Places the link the account's systemd reads the unit through, unless it is there already; whether it placed it. */
function placeLink(place: UnitPlace): boolean {
  if (place.link === null) return false;
  const there = linkAt(place.link);
  if (there === place.file) return false;
  if (there !== undefined) throw new Error(`${place.link} is there already and isn't the set-up's link to ${place.file}: the set-up never changes a unit file it didn't make`);
  mkdirSync(dirname(place.link), { recursive: true });
  symlinkSync(place.file, place.link);
  return true;
}

/**
 * Writes the drop-in unless it holds exactly this already; whether it wrote it. Each environment
 * assignment is quoted, with systemd's specifier character escaped (systemd.unit(5), Specifiers).
 */
function placeDropIn(place: UnitPlace, environment: [string, string][]): boolean {
  const text = [
    "# Made by the test instance's set-up: under memory pressure this runtime goes first, and it runs with the set-up's own environment.",
    "[Service]",
    `OOMScoreAdjust=${OOM_SCORE}`,
    // No swap beside today's own memory cap (`up --memory`, MemoryMax): what the set-up starts holds no more than its cap.
    "MemorySwapMax=0",
    ...environment.map(([name, value]) => `Environment="${`${name}=${value}`.replace(/%/g, "%%").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`),
    "",
  ].join("\n");
  if (existsSync(place.dropIn) && readFileSync(place.dropIn, "utf8") === text) return false;
  mkdirSync(dirname(place.dropIn), { recursive: true });
  writeFileSync(place.dropIn, text, { mode: 0o644 });
  return true;
}

/** Fails where the account's own XDG folders hold a config or a folder of this runtime's name: what the instance's runtime must never read or write. */
function homeUntouched(place: UnitPlace, when: string): void {
  const found = [place.homeConfig, place.homeFolder].filter((path) => path !== place.config && path !== place.folder && existsSync(path));
  if (found.length > 0) throw new Error(`${when}, the account's own home holds ${found.join(" and ")}: the instance's runtime ${place.name} must keep its config and folder in the runtime home only`);
}

/** What the unit holds now, as systemd loaded it: the memory cap, the OOM score and the environment of the drop-in. */
async function unitHolds(place: UnitPlace, environment: [string, string][]): Promise<void> {
  const oom = await unitProperty(place.unit, "OOMScoreAdjust");
  const memory = await unitProperty(place.unit, "MemoryMax");
  const listed = (await unitProperty(place.unit, "Environment")).split(/\s+/);
  const missing = environment.filter(([name, value]) => !listed.includes(`${name}=${value}`)).map(([name]) => name);
  if (oom !== String(OOM_SCORE) || memory === "" || memory === "infinity" || missing.length > 0) {
    throw new Error(`the unit ${place.unit} doesn't hold what it must: OOMScoreAdjust ${oom || "unset"}, MemoryMax ${memory || "unset"}${missing.length > 0 ? `, nothing for ${missing.join(", ")} in its environment` : ""}`);
  }
  if (!(await unitActive(place.unit))) throw new Error(`the unit ${place.unit} isn't active`);
}

/**
 * `lumiah up` as the Runtime page's own start line runs it (LumiAH extension/backend/relays.ts:417-418,
 * :460), with the name, the account, the port and the memory cap given: `--url`, `--name`,
 * `--username`, `--port`, `--memory`, `--extension` and `--systemd` (runtime/cli.ts:146-156, :208).
 * `--extension` because the runtime is built from LumiAH's own entry (RPE main scripts/build.ts:87-89),
 * which links to LumiAH's own extension unless told another (runtime/main.ts:170, cli.ts:151-153,
 * :572). The password comes from LUMIVERSE_PASSWORD where there is no terminal to ask on (cli.ts:469);
 * a runtime set up here before keeps its own sign-in while it holds (cli.ts:476-487). The unit's
 * ExecStart runs the Bun this file runs on, by its real path (cli.ts:577-585, :655;
 * runtime/update/service.ts:31): `up` defaults to the Bun running it, which is `process.execPath`
 * here (runtime/main.ts:111).
 */
async function lumiahUp(s: SetupCtx, who: Who, name: string, port: number): Promise<void> {
  const account = s.env[who];
  const ran = await runProgram(
    [process.execPath, lumiahPath(s.env), "up", "--url", s.env.hostUrl, "--name", name, "--username", account.username, "--port", String(port), "--memory", s.env.runtimeMemory, "--extension", IDENTIFIER, "--systemd"],
    { ...runtimeXdg(s.env), LUMIVERSE_PASSWORD: account.password },
    UP_MS,
  );
  if (ran.code !== 0) throw new Error(`lumiah up for the runtime ${name} failed (exit ${ran.code}): ${said(ran)}`);
  for (const line of `${ran.out}\n${ran.err}`.split("\n")) if (line.trim() !== "") say(`  lumiah: ${line.trim()}`);
}

/** `lumiah down --name`: stops and disables the unit, removes its file and reloads systemd; the config stays (LumiAH runtime/cli.ts:156, :221-223, :995-1011). */
async function lumiahDown(s: SetupCtx, name: string): Promise<void> {
  const ran = await runProgram([process.execPath, lumiahPath(s.env), "down", "--name", name], runtimeXdg(s.env), DOWN_MS);
  if (ran.code !== 0) throw new Error(`lumiah down for the runtime ${name} failed (exit ${ran.code}): ${said(ran)}`);
}

/** Refuses a memory cap that caps nothing: every unit the set-up makes is held to one. */
function cappedMemory(env: InstanceEnv): void {
  if (env.runtimeMemory === "infinity") throw new Error("LRE_RUNTIME_MEMORY is infinity: every unit the set-up makes must be memory-capped");
}

/**
 * Sets up one runtime with `up --systemd` unless an earlier run left it standing (its config naming
 * its unit, with this Lumiverse, account, port and cap, and the unit active); the link and drop-in are
 * placed first, so the unit never runs without them. What it made is logged.
 */
async function standRuntime(s: SetupCtx, step: string, who: Who, place: UnitPlace, port: number, environment: [string, string][]): Promise<void> {
  const account = s.env[who];
  if (placeLink(place)) s.log.log({ step, action: "placed", kind: "systemd link to the runtime's unit (where the account's systemd reads user units)", id: place.link ?? place.file, detail: { unit: place.unit, file: place.file } });
  const droppedIn = placeDropIn(place, environment);
  if (droppedIn) s.log.log({ step, action: "placed", kind: "systemd drop-in: OOMScoreAdjust and the set-up's environment", id: place.dropIn, detail: { unit: place.unit, OOMScoreAdjust: OOM_SCORE, environment: environment.map(([name]) => name) } });
  const before = readConfig(place.config);
  const standing =
    before !== null &&
    before.service?.unit === place.unit &&
    cliBase(before.base) === cliBase(s.env.hostUrl) &&
    before.username.toLowerCase() === account.username.toLowerCase() &&
    before.port === port &&
    before.memory === s.env.runtimeMemory &&
    existsSync(place.file) &&
    (await unitActive(place.unit));
  if (!standing) {
    const host = await s.session(who);
    // `up` adds the loopback connection to Lumiverse for a user who has none (LumiAH runtime/cli.ts:639, :706-715): what it added is logged.
    const had = new Set((await host.connections()).map((c) => c.id));
    const wanted = linkAt(place.wants) !== undefined;
    await lumiahUp(s, who, place.name, port);
    const config = readConfig(place.config);
    if (config?.service?.unit !== place.unit) throw new Error(`lumiah up ended well, but ${place.config} names no unit ${place.unit}`);
    s.log.log({
      step,
      action: "created",
      kind: "runtime (lumiah up --systemd: its registration, config, installed copy and unit; its address in the scheduler exclusions)",
      id: place.unit,
      name: place.name,
      detail: { user: account.username, port, memory: config.memory, config: place.config, unitFile: place.file, bun: config.service.bun },
    });
    for (const c of await host.connections()) if (!had.has(c.id)) s.log.log({ step, action: "created", kind: "Lumiverse loopback connection (made by lumiah up for a user who has none)", id: c.id, name: c.name, detail: { user: account.username, provider: c.provider ?? null } });
    if (!wanted && linkAt(place.wants) !== undefined) s.log.log({ step, action: "created", kind: "systemd enable link (made by lumiah up's systemctl enable)", id: place.wants, detail: { unit: place.unit } });
  } else if (droppedIn) {
    // The unit ran before this drop-in: systemd reads it again, and the runtime restarts under it.
    await systemctl(["daemon-reload"]);
    await systemctl(["restart", place.unit]);
    s.log.log({ step, action: "changed", kind: "runtime unit restarted under its drop-in", id: place.unit, name: place.name });
  } else {
    say(`  the runtime ${place.name} stands from an earlier run`);
  }
  await unitHolds(place, environment);
}

async function setUpRuntime(s: SetupCtx, who: Who, environment: [string, string][]): Promise<void> {
  const spec = s.env.runtimes[who];
  const place = await unitPlace(s.env, spec.name);
  homeUntouched(place, "before its runtime is set up");
  await standRuntime(s, "runtimes", who, place, spec.port, environment);
  const relay = await waitLinked(s, who, spec.name);
  if (relay.unit !== null && relay.unit !== place.unit) throw new Error(`the runtime ${spec.name} says it runs under ${relay.unit}, not ${place.unit}`);
  const config = readConfig(place.config);
  if (config === null || config.port !== spec.port || config.memory !== s.env.runtimeMemory) throw new Error(`${place.config} doesn't hold the port ${spec.port} and the memory cap ${s.env.runtimeMemory} it was set up with`);
  // The runtime made its folder where the unit's XDG_DATA_HOME says, and nothing of it is in the account's own XDG folders.
  if (!existsSync(place.folder)) throw new Error(`the runtime ${spec.name} is linked, but made no folder at ${place.folder}: it didn't run with the runtime home's XDG_DATA_HOME`);
  homeUntouched(place, "after its runtime started");
  s.log.set(`runtime:${who}`, { name: spec.name, unit: place.unit, port: spec.port, config: place.config });
}

export const runtimes: SetupStep = {
  name: "runtimes",
  makes: "today's runtime for each user: a memory-capped systemd user unit, killed first under pressure, its config, folder and caches out of the account's home",
  async run(s) {
    cappedMemory(s.env);
    const environment = unitEnvironment(s.env);
    for (const who of WHO) await setUpRuntime(s, who, environment);
  },
};

// ---------------------------------------------------------------- the owner's runtime plays the harness

/** A level of the story's model ladder (RPE main src/shared/settings.ts:816-820, :830-839). */
interface ModelPick {
  connectionId?: unknown;
  model?: unknown;
}

function picksOf(models: unknown): ModelPick[] {
  if (!isRecord(models)) return [];
  const out: ModelPick[] = [];
  if (isRecord(models.default)) out.push(models.default);
  for (const group of ["agents", "standings", "runs", "characters"]) {
    const table = models[group];
    if (isRecord(table)) for (const pick of Object.values(table)) if (isRecord(pick)) out.push(pick);
  }
  return out;
}

export const runtimeConnection: SetupStep = {
  name: "runtime-connection",
  makes: "the owner's runtime: its loopback key minted, and a provider connection of its own that the harness engine's agents run on",
  async run(s) {
    const { env, log } = s;
    await withPage(s, "owner", async (socket) => {
      const { state, relay } = await ownersRelay(s, socket);

      // A harness chat is answered only once a runtime is linked, the loopback key is minted and the
      // loopback connection holds it (LumiAH shared/ui.ts:359-360; RPE main
      // src/backend/harness/mount.ts:426-433). The Runtime page's Mint has the linked runtime put
      // the key in that connection (LumiAH shared/ui.ts:1504-1511; extension/backend/ui.ts:502-506).
      // The key itself is never kept or shown here.
      if (!state.runtime.ready) {
        const minted = await socket.lah<{ connection: { id: string; name: string } | null }>("lah.key", { op: "mint" });
        if (minted.connection === null) throw new Error("the loopback key was minted, but no linked runtime put it in Lumiverse's loopback connection");
        log.log({ step: "runtime-connection", action: "created", kind: "loopback key (minted on the Runtime page; the runtime put it in Lumiverse's loopback connection)", id: minted.connection.id, name: minted.connection.name });
        if (!(await hello(socket)).runtime.ready) throw new Error("the loopback key is minted, but the Runtime page doesn't show the runtime ready to answer chats");
      }

      // Runtime → Connections: a connection of the runtime's own, saved as the page saves a new one
      // with a key (LumiAH extension/frontend/connections.tsx:697, connections-model.ts:217-219,
      // :365-390; shared/ui.ts:616-626, :1640). The first connection a runtime has is its default
      // (runtime/models/book.ts:380, :399).
      let view = await socket.lah<ConnectionsView>("lah.connections.list", { relay: relay.id });
      if (!view.providers.some((p) => p.id === env.provider)) throw new Error(`the runtime offers no provider "${env.provider}" (it offers ${view.providers.map((p) => p.id).join(", ")})`);
      const named = view.connections.filter((c) => c.name === env.connectionName);
      if (named.length > 1) throw new Error(`the owner's runtime has ${named.length} connections named "${env.connectionName}"`);
      let mine = named[0];
      if (mine !== undefined && (mine.provider !== env.provider || mine.model !== env.model || mine.key?.set !== true)) {
        throw new Error(`the owner's runtime has a connection "${env.connectionName}" that isn't ${env.provider} / ${env.model} with a key: the set-up doesn't change a connection it didn't make`);
      }
      if (mine === undefined) {
        const saved = await socket.lah<{ saved: RuntimeConnection; view: ConnectionsView }>("lah.connections.save", {
          relay: relay.id,
          connection: { name: env.connectionName, provider: env.provider, auth: "key", baseUrl: null, api: null, model: env.model, effort: null },
          key: env.providerKey,
        });
        mine = saved.saved;
        view = saved.view;
        log.log({ step: "runtime-connection", action: "created", kind: "runtime connection (the runtime's connections.json and secrets.json)", id: mine.id, name: mine.name, detail: { runtime: relay.name, provider: env.provider, model: env.model } });
      }
      // An agent that names no connection runs on the default, with its model (LumiAH shared/ui.ts:576-583).
      if (view.default !== mine.id) {
        view = await socket.lah<ConnectionsView>("lah.connections.default", { relay: relay.id, id: mine.id });
        if (view.default !== mine.id) throw new Error(`the runtime's default connection didn't become "${env.connectionName}"`);
        log.log({ step: "runtime-connection", action: "changed", kind: "runtime default connection", id: mine.id, name: mine.name, detail: { runtime: relay.name } });
      }

      // Where today's harness agents take their model from: the story's model ladder, Settings →
      // Story → Models (RPE main src/backend/harness/extension.ts:1182-1192,
      // src/shared/story-models.ts:50-58); where it picks nothing, an agent runs on its definition's
      // own, and the engine's definitions name no connection and no model
      // (src/backend/harness/definitions/index.ts:196-198), so it runs on the runtime's default
      // connection and that connection's model (LumiAH core/run.ts:684-690). A ladder naming
      // anything else would play elsewhere.
      const settings = await socket.lre<{ settings?: unknown }>("lre.settings.get");
      const elsewhere = picksOf(at(settings.settings, ["story", "models"])).filter((p) => (p.connectionId !== undefined && p.connectionId !== mine.id) || (p.model !== undefined && p.model !== env.model));
      if (elsewhere.length > 0) throw new Error(`Settings → Story → Models picks another connection or model for some of the harness's agents: they wouldn't play on "${env.connectionName}" / ${env.model}`);
    });
    await loopbackAnswers(s);
  },
};

/**
 * The owner's loopback connection in Lumiverse must point at the owner's runtime, and that runtime
 * must answer there. The first run on the bed showed why: a runtime set up after it re-pointed the
 * connection at itself (`lumiah up` names the connection's address after the runtime it sets up,
 * LumiAH `src/runtime/cli.ts:706-715`) and was then taken down, leaving harness chats nowhere to go.
 * Lumiverse keeps the address as the connection's `api_url` (Lumiverse
 * `src/services/connections.service.ts:98`); the loopback's model is `lumiah-<identifier>`.
 */
async function loopbackAnswers(s: SetupCtx): Promise<void> {
  const host = await s.session("owner");
  const page: unknown = await host.call("GET", "/api/v1/connections?limit=200");
  const rows: unknown[] = Array.isArray(page) ? page : isRecord(page) && Array.isArray(page.data) ? page.data : [];
  const loopbacks = rows.filter((c): c is { [key: string]: unknown } => isRecord(c) && typeof c.model === "string" && c.model.startsWith("lumiah-"));
  if (loopbacks.length === 0) throw new Error("the owner has no loopback connection in Lumiverse after the set-up");
  for (const c of loopbacks) {
    const url = typeof c.api_url === "string" ? c.api_url : "";
    const port = url === "" ? null : Number(new URL(url).port);
    if (port !== s.env.runtimes.owner.port) throw new Error(`the owner's loopback connection "${String(c.name)}" points at ${url || "no address"}, not at the owner's runtime on port ${s.env.runtimes.owner.port}`);
    const answer = await fetch(`${url.replace(/\/+$/, "")}/models`).then((r) => r.status, (error: unknown) => (error instanceof Error ? error.message : String(error)));
    if (typeof answer !== "number") throw new Error(`the owner's runtime does not answer at ${url}: ${answer}`);
    s.log.log({ step: "runtime-connection", action: "changed", kind: "check: the owner's loopback connection points at the owner's runtime, which answers", id: String(c.id), name: String(c.name), detail: { port, status: answer } });
  }
}

// ---------------------------------------------------------------- the owner's runtime's own settings

export const runtimeSettings: SetupStep = {
  name: "runtime-settings",
  makes: "the owner's runtime's own settings: a tuning value off its default, the memory cap `up` gave it, and updates taken only from the Runtime page",
  async run(s) {
    const { env, log } = s;
    const config = join(runtimeXdg(env).XDG_CONFIG_HOME, "lumiah", `${env.runtimes.owner.name}.json`);
    await withPage(s, "owner", async (socket) => {
      const { state, relay } = await ownersRelay(s, socket);

      // Tuning: the runtime's limits and timings are the user's settings under `transport.runtime`,
      // which the Settings page sets path by path from the settings' root (LumiAH link/settings.ts:16,
      // :433-436; extension/backend/backend.ts:116; extension/frontend/pages/settings.tsx:186-192;
      // extension/backend/settings.ts:251-260; shared/ui.ts:697, :1499). The runtime reads them
      // whenever they change and keeps them in its config (link/settings.ts:436).
      const fallback = at(state.settings.defaults, TUNING_PATH);
      if (at(state.settings.values, TUNING_PATH) !== TUNING_VALUE) {
        const set = await socket.lah<{ settings: { values: unknown } }>("lah.settings.set", { set: [{ path: TUNING_PATH, value: TUNING_VALUE }], reset: [] });
        if (at(set.settings.values, TUNING_PATH) !== TUNING_VALUE) throw new Error(`the Settings page didn't take ${TUNING_PATH.join(".")} = ${TUNING_VALUE}`);
        log.log({ step: "runtime-settings", action: "changed", kind: "harness setting (harness/settings.json): a runtime tuning value", id: TUNING_PATH.join("."), detail: { value: TUNING_VALUE, default: typeof fallback === "number" ? fallback : null } });
      }
      const began = Date.now();
      while (readConfig(config)?.tuning.sessionCheckMs !== TUNING_VALUE) {
        if (Date.now() - began > TUNING_MS) throw new Error(`the owner's runtime didn't write ${TUNING_PATH.join(".")} = ${TUNING_VALUE} into ${config} within ${TUNING_MS / 1000} s`);
        await Bun.sleep(POLL_MS);
      }

      // The memory limit: what `up --memory` gave it, kept in its config (LumiAH runtime/cli.ts:637-638, config.ts:44-53).
      const memory = readConfig(config)?.memory;
      if (memory !== env.runtimeMemory) throw new Error(`${config} holds the memory limit ${memory ?? "none"}, not ${env.runtimeMemory}`);

      // The update choice: on until the Runtime page says otherwise (LumiAH runtime/config.ts:59); the
      // page's own switch is `lah.runtime.service.set` with `autoUpdate` (extension/frontend/
      // runtime-service.tsx:48-51; shared/ui.ts:1517-1519; extension/backend/ui.ts:519-522), which the
      // runtime keeps in its config (runtime/update/update.ts:461-476, runtime/cli.ts:857, :816-824).
      let service = (await socket.lah<{ service: ServiceView }>("lah.runtime.service.get", { relay: relay.id })).service;
      if (service.autoUpdate) {
        service = (await socket.lah<{ service: ServiceView }>("lah.runtime.service.set", { relay: relay.id, autoUpdate: false })).service;
        if (service.autoUpdate) throw new Error("the owner's runtime still takes updates by itself after the Runtime page switched that off");
        log.log({ step: "runtime-settings", action: "changed", kind: "runtime update choice (its config's autoUpdate)", id: relay.name, detail: { autoUpdate: false, default: true } });
      }
      if (readConfig(config)?.autoUpdate !== false) throw new Error(`${config} doesn't hold the update choice the Runtime page set`);

      log.set("setup:runtime-settings", {
        tuning: { setting: TUNING_PATH.join("."), value: TUNING_VALUE, default: typeof fallback === "number" ? fallback : null },
        // LumiAH's own limit until one is given is 1G (runtime/update/memory.ts:6-7).
        memory: { value: env.runtimeMemory, default: "1G", set: "lumiah up --memory" },
        autoUpdate: { value: false, default: true },
      });
    });
  },
};

// ---------------------------------------------------------------- a runtime folder no config names

/** A loopback port no listener holds now, as the system hands one out. */
function freePort(): number {
  const probe = Bun.serve({ hostname: LOOPBACK, port: 0, fetch: () => new Response(null, { status: 503 }) });
  const port = Number(probe.port);
  probe.stop(true);
  if (!Number.isInteger(port) || port <= 0) throw new Error("the system handed out no free loopback port");
  return port;
}

/**
 * Removes what is left in the account's unit folder of a unit `lumiah down` took down: the drop-in the
 * set-up placed, and the link and the enable link where `disable` left them (each only when it names
 * that unit). What it removed.
 */
function removePlaced(place: UnitPlace): string[] {
  const removed: string[] = [];
  if (existsSync(place.dropIn)) {
    rmSync(place.dropIn);
    removed.push(place.dropIn);
  }
  const folder = dirname(place.dropIn);
  if (existsSync(folder) && readdirSync(folder).length === 0) rmdirSync(folder);
  if (place.link !== null && linkAt(place.link) === place.file) {
    unlinkSync(place.link);
    removed.push(place.link);
  }
  const wanted = linkAt(place.wants);
  if (typeof wanted === "string" && basename(wanted) === place.unit) {
    unlinkSync(place.wants);
    removed.push(place.wants);
  }
  return removed;
}

/**
 * Today's runtime has no command that leaves a folder no config names: its commands are up, serve,
 * login, status and down (LumiAH runtime/cli.ts:206-226); `down` stops and removes the unit and keeps
 * the config (:995-1011), and nothing else deletes one. `down` says what forgets a runtime: "Its
 * config, with the runtime's session, stays in <config>: delete it to forget the runtime here"
 * (:1009). So the folder is made by play, by a runtime of the owner's set up and run (`serve` makes it,
 * :829), taken down by `down`, forgotten on the Runtime page (LumiAH extension/frontend/pages/
 * runtime.tsx:163-178, shared/ui.ts:1513), and its config deleted as `down` tells the user. Its unit
 * is made and removed within this step.
 */
export const runtimeFolder: SetupStep = {
  name: "runtime-folder",
  makes: "a runtime folder no config names, left by a runtime of the owner's set up, run, taken down and forgotten",
  async run(s) {
    const { env, log } = s;
    const name = `${env.runtimes.owner.name}${LEFT_SUFFIX}`;
    const place = await unitPlace(env, name);
    homeUntouched(place, "before the runtime-folder step");

    if (!existsSync(place.folder)) {
      cappedMemory(env);
      const environment = unitEnvironment(env);
      // Its port is any the system hands out free now: the runtime lives only within this step.
      await standRuntime(s, "runtime-folder", "owner", place, readConfig(place.config)?.port ?? freePort(), environment);
      await waitLinked(s, "owner", name);
      if (!existsSync(place.folder)) throw new Error(`the runtime ${name} is linked, but made no folder at ${place.folder}`);
      log.log({ step: "runtime-folder", action: "created", kind: "runtime folder (made by the runtime's serve)", id: place.folder, name });
    }

    if (existsSync(place.file)) {
      const links = [place.link, place.wants].filter((path): path is string => path !== null && linkAt(path) !== undefined);
      await lumiahDown(s, name);
      log.log({ step: "runtime-folder", action: "deleted", kind: "runtime unit (lumiah down: stopped, disabled, its file removed)", id: place.unit, name, detail: { file: place.file } });
      for (const path of links) if (linkAt(path) === undefined) log.log({ step: "runtime-folder", action: "deleted", kind: "systemd link (removed by lumiah down's systemctl disable)", id: path, detail: { unit: place.unit } });
    }
    const removed = removePlaced(place);
    if (removed.length > 0) {
      await systemctl(["daemon-reload"]);
      for (const path of removed) log.log({ step: "runtime-folder", action: "deleted", kind: "systemd file left for that unit in the account's unit folder", id: path, detail: { unit: place.unit } });
    }

    await withPage(s, "owner", async (socket) => {
      for (const relay of (await hello(socket)).runtime.relays.filter((r) => r.name === name)) {
        await socket.lah("lah.relay", { op: "forget", relay: relay.id });
        log.log({ step: "runtime-folder", action: "deleted", kind: "runtime registration (forgotten on the Runtime page; registry.json)", id: relay.id, name });
      }
    });

    if (existsSync(place.config)) {
      rmSync(place.config);
      log.log({ step: "runtime-folder", action: "deleted", kind: "runtime config (deleted by hand, as lumiah down tells the user)", id: place.config, name });
    }

    if (!existsSync(place.folder) || existsSync(place.config) || existsSync(place.file) || (await unitActive(place.unit))) {
      throw new Error(`the runtime folder ${place.folder} isn't left as it must be: the folder there, and no config, unit file or running unit of ${name}`);
    }
    homeUntouched(place, "after the runtime-folder step");
    const made: Json = { path: place.folder, by: "play", config: "deleted by hand, as lumiah down tells the user" };
    log.set("setup:runtime-folder", made);
    // Its runtime was set up after the owner's: the owner's loopback connection must still point at the owner's runtime.
    await loopbackAnswers(s);
  },
};
