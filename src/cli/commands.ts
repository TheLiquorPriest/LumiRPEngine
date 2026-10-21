// The command line. Each command mirrors a tool (the same code, the same answers), beside sign-in,
// the MCP server and the versions. `run` takes its I/O as arguments, so the tests run it in
// process; main.ts wires it to Node.

import type { JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { Args } from "./args";
import type { CredentialStore } from "./credentials";
import { inClear, normalizeBase } from "./credentials";
import type { Http, OpenSocket, SignOutResult } from "./connection";
import { HostConnection, LiveError, sessionOf, signIn, signOut } from "./connection";
import type { McpOptions } from "./kit-api";
import { Live, resolveRevision } from "./live";
import { templateFile } from "./offline";
import type { ToolContext } from "./tools";
import { callTool, findTool, KeyedQueue } from "./tools";
import { CLI_NAME, CLI_VERSION, VERSION_LINE } from "./version";

export interface CliIO {
  out(text: string): void;
  err(text: string): void;
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
  env: Readonly<Record<string, string | undefined>>;
  /** Whether stdout is a terminal: piped or redirected, `template` and `export` print the whole file rather than an outline. */
  stdoutIsTTY: boolean;
  /** Asks on the terminal (`hidden`: without echoing what is typed); null when there is no terminal. */
  ask(question: string, hidden: boolean): Promise<string | null>;
  credentials: CredentialStore;
  http: Http;
  openSocket: OpenSocket;
}

export const USAGE = `${CLI_NAME}: manage your LumiRPEngine worlds on Lumiverse from a shell or an agent

Sign-in
  login [--url <base>] [--username <name>] [--allow-http]
                                              Sign in; the password comes from a hidden prompt or LUMIVERSE_PASSWORD.
                                              --allow-http: plain http to another machine (the token crosses in clear)
  logout                                      Sign out, and delete the saved session
  status                                      The host and user, the session, LumiRPEngine there, this client

Offline (no sign-in)
  guide [<topic>]                             The agent guide, or its part about a topic
  docs <words…> [--doc <name>]                Look up LumiRPEngine's docs (reference, expressions, recipes, design,
                                              user-guide, studio, presets)
  schema [<pointer>] [--map] [--offset <n>]   The world (or map) JSON Schema at a JSON Pointer
  templates                                   The starter worlds
  template <id> [--out <file>] [--pointer <p>] [--offset <n>]
                                              A starter as an export file
  check <file>                                Shape, migration, lint and macro hazards (exits 1 on errors)
  playtest <file> --turn <text> [--turn …]    Typed turns through the bundled engine, no narrator
  check-world <file> [--days <n>]             Simulated days from the start
                                              (playtest and check-world take --world <id> [--source <s>] for a
                                              world on your Lumiverse instead of a file)

Your worlds on Lumiverse
  worlds                                      Your worlds, with their drafts
  world <worldId> [--source <s>] [--pointer <p>] [--offset <n>]
                                              Read a world (its draft by default)
  search <words…> [--world <id>] [--collections <a,b>] [--kinds <a,b>] [--limit <n>]
  create <name…> [--template <id>]            A new world, blank or from a starter
  import <file>                               A world file as a new world
  edit <worldId> --ops <file|json> [--expect-version <n>]
                                              JSON Patch on the draft
  draft <worldId>                             The draft: version, lint, changes against the head
  commit <worldId> [--note <text>] [--expect-version <n>]
                                              The draft becomes the head
  discard <worldId> [--expect-version <n>]    Drop the draft
  history <worldId>                           How each revision became head
  diff <worldId> [--from <s>] [--to <s>]      What changed (head to draft by default)
  restore <worldId> <revision> [--expect-version <n>]
                                              The draft becomes a copy of a revision
  delete <worldId> [--confirm <exact name>]   Delete a world for good (without --confirm: what it would delete)
  export <worldId> [--revision <r>] [--out <file>] [--offset <n>]
  chats [<worldId>]                           The chats that play a world
  attach <worldId> <chatId>                   A chat plays the world
  upgrade <chatId> [--to <revision>] [--preview] [--spoilers]

  mcp [--read-only] [--pin]                   All of it as an MCP server on stdio, following LumiRPEngine's own
                                              tools (--pin, or LRE_PIN_KIT=1: keep these)
  version, --version                          ${CLI_NAME}, engine, world format and agent API versions

  <s> is draft, head or a revision. Everywhere: --url <base> (or LUMIVERSE_URL) picks the Lumiverse when you
  are signed in to several; --read-only (or LRE_READ_ONLY=1) refuses every change; --timeout <seconds|none>
  (or LRE_TIMEOUT) is how long each request to LumiRPEngine may take (300 by default, none for no limit).`;

class UsageError extends Error {}

interface Parsed {
  command: string | undefined;
  positionals: string[];
  values: Record<string, string[]>;
  flags: Record<string, true>;
}

const BOOLEAN_FLAGS: Record<string, true> = { "--read-only": true, "--allow-http": true, "--preview": true, "--spoilers": true, "--map": true, "--help": true, "--version": true, "--pin": true };

/** What `LRE_READ_ONLY` and `LRE_PIN_KIT` may say. Anything else stops the run: a value meant as "on" must never serve the write tools, or follow a kit it was meant to keep. */
const READ_ONLY_VALUES: Record<string, boolean> = { "": false, "0": false, false: false, no: false, off: false, "1": true, true: true, yes: true, on: true };

/** Whether this run is read-only: `--read-only`, or `LRE_READ_ONLY` in any case. */
function readOnlyOf(p: Parsed, env: CliIO["env"]): boolean {
  const raw = env.LRE_READ_ONLY;
  const value = (raw ?? "").trim().toLowerCase();
  if (!hasOwn(READ_ONLY_VALUES, value)) throw new UsageError(`LRE_READ_ONLY is ${JSON.stringify(raw)}, which isn't a yes or a no: set it to 1 (read-only) or 0, or unset it.`);
  return p.flags["--read-only"] === true || READ_ONLY_VALUES[value] === true;
}

/** Whether `mcp` keeps the kit it was installed with (DESIGN §23): `--pin`, or `LRE_PIN_KIT` in any case. */
function pinOf(p: Parsed, env: CliIO["env"]): boolean {
  const raw = env.LRE_PIN_KIT;
  const value = (raw ?? "").trim().toLowerCase();
  if (!hasOwn(READ_ONLY_VALUES, value)) throw new UsageError(`LRE_PIN_KIT is ${JSON.stringify(raw)}, which isn't a yes or a no: set it to 1 (keep the installed tools) or 0, or unset it.`);
  return p.flags["--pin"] === true || READ_ONLY_VALUES[value] === true;
}

/** Refuses options a command doesn't take, and positionals where it takes none: a misspelled `--read-only` must stop the run, not be ignored. */
function onlyOptions(command: string, p: Parsed, options: readonly string[], usage: string, positionals = true): void {
  const stray = [...Object.keys(p.values), ...Object.keys(p.flags)].filter((o) => !options.includes(o) && o !== "--help");
  if (stray.length > 0) throw new UsageError(`${command} doesn't take ${stray.join(", ")}. Usage: ${CLI_NAME} ${usage}`);
  if (!positionals && p.positionals.length > 0) throw new UsageError(`${command} takes no ${p.positionals.length === 1 ? "argument" : "arguments"} (${p.positionals.join(" ")}). Usage: ${CLI_NAME} ${usage}`);
}

function parse(argv: readonly string[]): Parsed {
  const out: Parsed = { command: undefined, positionals: [], values: {}, flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--") {
      out.positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--") && arg.length > 2) {
      const eq = arg.indexOf("=");
      const name = eq > 0 ? arg.slice(0, eq) : arg;
      if (hasOwn(BOOLEAN_FLAGS, name)) {
        // `--spoilers=false` would read as on: a switch takes no value.
        if (eq > 0) throw new UsageError(`${name} is a switch and takes no value: leave out "=${arg.slice(eq + 1)}".`);
        out.flags[name] = true;
        continue;
      }
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined) throw new UsageError(`${name} needs a value.`);
      (out.values[name] ??= []).push(value);
    } else if (out.command === undefined) out.command = arg;
    else out.positionals.push(arg);
  }
  return out;
}

const one = (p: Parsed, name: string): string | undefined => p.values[name]?.at(-1);

function number(p: Parsed, name: string): number | undefined {
  const value = one(p, name);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new UsageError(`${name} takes a whole number, not ${JSON.stringify(value)}.`);
  return Number(value);
}

/** `--expect-version` as the write tools take it: the draft version the change is meant for. */
function expectVersion(p: Parsed): Args {
  const version = number(p, "--expect-version");
  return version === undefined ? {} : { expectVersion: version };
}

/** Each mirrored command: its tool, the options it takes, and how its arguments become the tool's. */
interface Mirror {
  tool: string;
  options: readonly string[];
  /** How many positionals it needs at least; the usage line says which. */
  needs: number;
  usage: string;
  args(p: Parsed, io: CliIO): Args;
}

const pos = (p: Parsed, i: number): string | undefined => p.positionals[i];

const MIRRORS: Readonly<Record<string, Mirror>> = {
  guide: { tool: "lre_guide", options: [], needs: 0, usage: "guide [<topic>]", args: (p) => (p.positionals.length > 0 ? { topic: p.positionals.join(" ") } : {}) },
  docs: { tool: "lre_docs", options: ["--doc"], needs: 1, usage: "docs <words…> [--doc <name>]", args: (p) => ({ query: p.positionals.join(" "), ...(one(p, "--doc") !== undefined ? { doc: one(p, "--doc") } : {}) }) },
  schema: { tool: "lre_schema", options: ["--map", "--offset"], needs: 0, usage: "schema [<pointer>] [--map] [--offset <n>]", args: (p) => ({ ...(pos(p, 0) !== undefined ? { pointer: pos(p, 0) } : {}), ...(p.flags["--map"] ? { schema: "map" } : {}), ...(number(p, "--offset") !== undefined ? { offset: number(p, "--offset") } : {}) }) },
  templates: { tool: "lre_templates", options: [], needs: 0, usage: "templates", args: () => ({}) },
  template: { tool: "lre_template", options: ["--out", "--pointer", "--offset"], needs: 1, usage: "template <id> [--out <file>] [--pointer <p>] [--offset <n>]", args: (p) => ({ id: pos(p, 0), ...pointerAndOffset(p) }) },
  check: { tool: "lre_check", options: [], needs: 1, usage: "check <file>", args: (p) => ({ path: pos(p, 0) }) },
  playtest: { tool: "lre_playtest", options: ["--turn", "--world", "--source"], needs: 0, usage: "playtest (<file> | --world <id> [--source <s>]) --turn <text> [--turn …]", args: (p) => ({ ...runFrom(p), turns: p.values["--turn"] ?? [] }) },
  "check-world": { tool: "lre_check_world", options: ["--days", "--world", "--source"], needs: 0, usage: "check-world (<file> | --world <id> [--source <s>]) [--days <n>]", args: (p) => ({ ...runFrom(p), ...(number(p, "--days") !== undefined ? { days: number(p, "--days") } : {}) }) },
  status: { tool: "lre_status", options: [], needs: 0, usage: "status", args: () => ({}) },
  worlds: { tool: "lre_worlds", options: [], needs: 0, usage: "worlds", args: () => ({}) },
  world: { tool: "lre_world", options: ["--source", "--pointer", "--offset"], needs: 1, usage: "world <worldId> [--source <s>] [--pointer <p>] [--offset <n>]", args: (p) => ({ worldId: pos(p, 0), ...(one(p, "--source") !== undefined ? { source: one(p, "--source") } : {}), ...pointerAndOffset(p) }) },
  search: {
    tool: "lre_search",
    options: ["--world", "--collections", "--kinds", "--limit"],
    needs: 1,
    usage: "search <words…> [--world <id>] [--collections <a,b>] [--kinds <a,b>] [--limit <n>]",
    args: (p) => ({
      query: p.positionals.join(" "),
      ...(one(p, "--world") !== undefined ? { worldId: one(p, "--world") } : {}),
      ...(one(p, "--collections") !== undefined ? { collections: (one(p, "--collections") ?? "").split(",").map((c) => c.trim()).filter((c) => c !== "") } : {}),
      ...(one(p, "--kinds") !== undefined ? { kinds: (one(p, "--kinds") ?? "").split(",").map((k) => k.trim()).filter((k) => k !== "") } : {}),
      ...(number(p, "--limit") !== undefined ? { limit: number(p, "--limit") } : {}),
    }),
  },
  create: { tool: "lre_world_create", options: ["--template"], needs: 1, usage: "create <name…> [--template <id>]", args: (p) => ({ name: p.positionals.join(" "), ...(one(p, "--template") !== undefined ? { template: one(p, "--template") } : {}) }) },
  import: { tool: "lre_world_import", options: [], needs: 1, usage: "import <file>", args: (p) => ({ path: pos(p, 0) }) },
  edit: { tool: "lre_edit", options: ["--ops", "--expect-version"], needs: 1, usage: "edit <worldId> --ops <file|json> [--expect-version <n>]", args: (p, io) => ({ worldId: pos(p, 0), ops: opsFrom(p, io), ...expectVersion(p) }) },
  draft: { tool: "lre_draft", options: [], needs: 1, usage: "draft <worldId>", args: (p) => ({ worldId: pos(p, 0) }) },
  commit: { tool: "lre_commit", options: ["--note", "--expect-version"], needs: 1, usage: "commit <worldId> [--note <text>] [--expect-version <n>]", args: (p) => ({ worldId: pos(p, 0), ...(one(p, "--note") !== undefined ? { note: one(p, "--note") } : {}), ...expectVersion(p) }) },
  discard: { tool: "lre_discard", options: ["--expect-version"], needs: 1, usage: "discard <worldId> [--expect-version <n>]", args: (p) => ({ worldId: pos(p, 0), ...expectVersion(p) }) },
  history: { tool: "lre_history", options: [], needs: 1, usage: "history <worldId>", args: (p) => ({ worldId: pos(p, 0) }) },
  diff: { tool: "lre_diff", options: ["--from", "--to"], needs: 1, usage: "diff <worldId> [--from <s>] [--to <s>]", args: (p) => ({ worldId: pos(p, 0), ...(one(p, "--from") !== undefined ? { from: one(p, "--from") } : {}), ...(one(p, "--to") !== undefined ? { to: one(p, "--to") } : {}) }) },
  restore: { tool: "lre_restore", options: ["--expect-version"], needs: 2, usage: "restore <worldId> <revision> [--expect-version <n>]", args: (p) => ({ worldId: pos(p, 0), revision: pos(p, 1), ...expectVersion(p) }) },
  delete: { tool: "lre_world_delete", options: ["--confirm"], needs: 1, usage: "delete <worldId> [--confirm <exact name>]", args: (p) => ({ worldId: pos(p, 0), ...(one(p, "--confirm") !== undefined ? { confirm: one(p, "--confirm") } : {}) }) },
  export: { tool: "lre_world_export", options: ["--revision", "--out", "--offset"], needs: 1, usage: "export <worldId> [--revision <r>] [--out <file>] [--offset <n>]", args: (p) => ({ worldId: pos(p, 0), ...(one(p, "--revision") !== undefined ? { revision: one(p, "--revision") } : {}), ...(number(p, "--offset") !== undefined ? { offset: number(p, "--offset") } : {}) }) },
  chats: { tool: "lre_chats", options: [], needs: 0, usage: "chats [<worldId>]", args: (p) => (pos(p, 0) !== undefined ? { worldId: pos(p, 0) } : {}) },
  attach: { tool: "lre_attach", options: [], needs: 2, usage: "attach <worldId> <chatId>", args: (p) => ({ worldId: pos(p, 0), chatId: pos(p, 1) }) },
  upgrade: { tool: "lre_upgrade", options: ["--to", "--preview", "--spoilers"], needs: 1, usage: "upgrade <chatId> [--to <revision>] [--preview] [--spoilers]", args: (p) => ({ chatId: pos(p, 0), ...(one(p, "--to") !== undefined ? { to: one(p, "--to") } : {}), ...(p.flags["--preview"] ? { preview: true } : {}), ...(p.flags["--spoilers"] ? { spoilers: true } : {}) }) },
};

function pointerAndOffset(p: Parsed): Args {
  const offset = number(p, "--offset");
  return { ...(one(p, "--pointer") !== undefined ? { pointer: one(p, "--pointer") } : {}), ...(offset !== undefined ? { offset } : {}) };
}

function runFrom(p: Parsed): Args {
  const world = one(p, "--world");
  if (world !== undefined) return { worldId: world, ...(one(p, "--source") !== undefined ? { source: one(p, "--source") } : {}) };
  return pos(p, 0) !== undefined ? { path: pos(p, 0) } : {};
}

/** `--ops` as JSON text (it starts with `[` or `{`) or a file holding it; one operation alone is a list of one. */
function opsFrom(p: Parsed, io: CliIO): JsonValue {
  const given = one(p, "--ops");
  if (given === undefined) throw new UsageError("edit needs --ops: a JSON Patch list, inline or in a file.");
  const text = /^\s*[[{]/.test(given) ? given : io.readFile(given);
  let ops: unknown;
  try {
    ops = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`--ops isn't JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return (isRecord(ops) ? [ops] : ops) as JsonValue;
}

/** The Lumiverse a command talks to: --url, else LUMIVERSE_URL, else the only one signed in to. */
function chooseBase(p: Parsed, io: CliIO): string {
  const given = one(p, "--url") ?? io.env.LUMIVERSE_URL;
  if (given !== undefined && given.trim() !== "") return normalizeBase(given);
  const stored = io.credentials.bases();
  const [only] = stored;
  if (stored.length === 1 && only !== undefined) return only;
  if (stored.length === 0) throw new LiveError("login", `Not signed in to a Lumiverse yet. Run: ${CLI_NAME} login --url <the address you open Lumiverse at>`);
  throw new LiveError("login", `Signed in to several Lumiverses (${stored.join(", ")}): pick one with --url or LUMIVERSE_URL.`);
}

/**
 * How long each request to LumiRPEngine (and the socket's opening) may take: `--timeout`, else
 * `LRE_TIMEOUT`, in seconds or "none"; else the client's default. Null is no limit.
 */
function timeoutOf(p: Parsed, env: CliIO["env"]): number | null | undefined {
  const raw = one(p, "--timeout") ?? env.LRE_TIMEOUT;
  if (raw === undefined || raw.trim() === "") return undefined;
  if (raw.trim().toLowerCase() === "none") return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new UsageError(`--timeout (or LRE_TIMEOUT) is ${JSON.stringify(raw)}: give a number of seconds above 0, or none for no limit.`);
  return Math.round(seconds * 1000);
}

function liveFor(base: string, io: CliIO, timeoutMs: number | null | undefined): Live {
  if (io.credentials.get(base) === null) throw new LiveError("login", `Not signed in to ${base}. Run: ${CLI_NAME} login --url ${base}`);
  // Read again whenever the connection opens: a `login` while an `mcp` server runs takes effect without a restart.
  return new Live(new HostConnection({ base, credentials: () => io.credentials.get(base), http: io.http, openSocket: io.openSocket, client: { name: CLI_NAME, version: CLI_VERSION, serves: "command" }, ...(timeoutMs !== undefined ? { timeoutMs } : {}) }));
}

interface Session {
  ctx: ToolContext;
  /** Closes the connection, if one was opened. */
  close(): void;
}

/** The tools' context for one run: the host is reached only when a live tool first needs it. */
function sessionFor(p: Parsed, io: CliIO, readOnly: boolean): Session {
  let live: Live | null = null;
  const queue = new KeyedQueue();
  const timeoutMs = timeoutOf(p, io.env);
  const ctx: ToolContext = {
    readFile: (path) => io.readFile(path),
    readOnly,
    live: () => (live ??= liveFor(chooseBase(p, io), io, timeoutMs)),
    serialize: (key, work) => queue.run(key, work),
  };
  return { ctx, close: () => live?.conn.close() };
}

async function login(p: Parsed, io: CliIO): Promise<number> {
  const given = one(p, "--url") ?? io.env.LUMIVERSE_URL;
  const stored = io.credentials.bases();
  const asked = given ?? (stored.length === 1 ? stored[0] : await io.ask("Lumiverse address (as you open it in a browser): ", false));
  if (asked === null || asked === undefined || asked.trim() === "") throw new UsageError("login needs Lumiverse's address: --url <base>, or LUMIVERSE_URL.");
  const base = normalizeBase(asked);
  const clear = inClear(base);
  if (clear && p.flags["--allow-http"] !== true) {
    throw new UsageError(`${base} is plain http to another machine: your password now, and the session token on every call after, would cross the network in clear, readable by anyone on the way. Use Lumiverse's https address if it has one. If the network is yours and you accept that, sign in with --allow-http.`);
  }
  // Asked as nobody, before a password is typed or sent: a redirect to https, an untrusted host or a lockout stops here.
  await sessionOf(io.http, base, null);
  if (clear) io.err(`Warning: ${base} is plain http. Your password now, and the session token on every call after, cross the network in clear.`);
  const username = one(p, "--username") ?? io.env.LUMIVERSE_USERNAME ?? io.credentials.get(base)?.username ?? (await io.ask("Username: ", false));
  if (username === null || username.trim() === "") throw new UsageError("login needs your username: --username <name>, or LUMIVERSE_USERNAME.");
  const password = io.env.LUMIVERSE_PASSWORD ?? (await io.ask(`Password for ${username} at ${base}: `, true));
  if (password === null || password === "") throw new UsageError("No password: run login in a terminal and type it at the prompt, or set LUMIVERSE_PASSWORD.");
  const token = await signIn(io.http, base, username.trim(), password);
  // The consent goes with the sign-in, so `mcp` and the other commands use it without the flag.
  io.credentials.put(base, { username: username.trim(), token, savedAt: Date.now(), ...(clear ? { allowHttp: true } : {}) });
  io.out(`Signed in to ${base} as ${username.trim()}. The session is saved in ${io.credentials.path}, readable only by you; the password is not kept.`);
  // Say now whether LumiRPEngine answers there, rather than at the first tool call.
  const live = liveFor(base, io, timeoutOf(p, io.env));
  try {
    const host = await live.conn.describe();
    const version = host.extension?.version;
    io.out(host.problem ?? `LumiRPEngine${version ? ` ${version}` : ""} is running there and speaks agent API ${host.agentApi ?? "none"}.`);
  } finally {
    live.conn.close();
  }
  return 0;
}

async function logout(p: Parsed, io: CliIO): Promise<number> {
  const base = chooseBase(p, io);
  const login = io.credentials.get(base);
  if (login === null) {
    io.out(`Not signed in to ${base}: nothing to do.`);
    return 0;
  }
  let result: SignOutResult | null = null;
  let unreachable = "";
  try {
    result = await signOut(io.http, base, login.token);
  } catch (error) {
    unreachable = error instanceof Error ? error.message : String(error);
  }
  // The saved copy goes either way: this machine stops using the session.
  io.credentials.remove(base);
  if (result !== null && result.outcome !== "unconfirmed") {
    io.out(result.outcome === "ended" ? `Signed out of ${base}: Lumiverse ended the session, and the saved copy is deleted.` : `The session had already ended on ${base}; the saved copy is deleted.`);
    return 0;
  }
  const answer = result === null ? `couldn't be reached (${unreachable})` : `answered ${result.status}`;
  io.err(`Lumiverse at ${base} ${answer} and didn't confirm the sign-out, so the session is still valid there: it stays usable by anyone who holds the token until it expires, after 7 days without use. The saved copy on this machine is deleted.`);
  return 1;
}

/** `template` and `export` as a whole file: written to `out` in one go, or printed when stdout is piped (`out` null). */
async function writeOut(command: string, p: Parsed, io: CliIO, session: Session, out: string | null): Promise<number> {
  let file: JsonValue | null;
  let what: string;
  if (command === "template") {
    const id = pos(p, 0) ?? "";
    file = templateFile(id);
    if (file === null) {
      io.err(`There is no starter "${id}" (${CLI_NAME} templates lists them).`);
      return 1;
    }
    what = `the starter ${id}`;
  } else {
    const worldId = pos(p, 0) ?? "";
    const live = session.ctx.live();
    const index = await live.index(worldId);
    const given = one(p, "--revision");
    const revision = given === undefined ? index.head : resolveRevision(index, given);
    file = await live.exportFile(worldId, revision);
    what = `“${index.name}” (${worldId}), revision ${revision}`;
  }
  const text = `${JSON.stringify(file, null, 2)}\n`;
  if (out === null) {
    io.out(text);
    return 0;
  }
  io.writeFile(out, text);
  io.out(`Wrote ${what} to ${out} as an export file (Import reads it).`);
  return 0;
}

export type RunResult = { code: number } | { mcp: McpOptions };

/** Runs one command; `mcp` hands back what to serve with, for the core to serve on stdin (DESIGN §23). */
export async function run(argv: readonly string[], io: CliIO): Promise<RunResult> {
  let p: Parsed;
  try {
    p = parse(argv);
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return { code: 2 };
  }
  const command = p.command;
  if (command === "version" || command === "-v" || (command === undefined && p.flags["--version"])) {
    io.out(VERSION_LINE);
    return { code: 0 };
  }
  if (command === undefined || command === "help" || p.flags["--help"]) {
    io.out(USAGE);
    return { code: 0 };
  }
  let session: Session | null = null;
  try {
    const readOnly = readOnlyOf(p, io.env);
    if (command === "mcp") {
      // Checked like any command's: a misspelled --read-only must refuse to start, never serve the write tools.
      onlyOptions("mcp", p, ["--url", "--read-only", "--timeout", "--pin"], "mcp [--read-only] [--pin] [--url <base>] [--timeout <seconds|none>]", false);
      return { mcp: { readOnly, pin: pinOf(p, io.env), base: () => chooseBase(p, io), timeoutMs: timeoutOf(p, io.env) } };
    }
    session = sessionFor(p, io, readOnly);
    if (command === "login") {
      if (p.values["--password"] !== undefined) throw new UsageError(`${CLI_NAME} never takes a password as an argument: it would stay in your shell history and show in the process list. Type it at the prompt, or set LUMIVERSE_PASSWORD.`);
      onlyOptions("login", p, ["--url", "--username", "--allow-http"], "login [--url <base>] [--username <name>] [--allow-http]", false);
      return { code: await login(p, io) };
    }
    if (command === "logout") {
      onlyOptions("logout", p, ["--url"], "logout [--url <base>]", false);
      return { code: await logout(p, io) };
    }
    const mirror = hasOwn(MIRRORS, command) ? MIRRORS[command] : undefined;
    if (mirror === undefined || findTool(mirror.tool) === undefined) {
      io.err(`There is no command ${command}.\n\n${USAGE}`);
      return { code: 2 };
    }
    onlyOptions(command, p, ["--url", "--read-only", "--timeout", ...mirror.options], mirror.usage);
    if (p.positionals.length < mirror.needs) throw new UsageError(`Usage: ${CLI_NAME} ${mirror.usage}`);
    const out = one(p, "--out");
    // A redirect wants the file itself (`template <id> > world.json`); a terminal gets the outline and paging.
    const whole = (command === "template" || command === "export") && !io.stdoutIsTTY && one(p, "--pointer") === undefined && one(p, "--offset") === undefined;
    if (out !== undefined || whole) return { code: await writeOut(command, p, io, session, out ?? null) };
    const result = await callTool(mirror.tool, mirror.args(p, io), session.ctx);
    if (result.isError) io.err(result.text);
    else io.out(result.text);
    return { code: result.isError || result.failed ? 1 : 0 };
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(error.message);
      return { code: 2 };
    }
    io.err(error instanceof Error ? error.message : String(error));
    return { code: 1 };
  } finally {
    session?.close();
  }
}
