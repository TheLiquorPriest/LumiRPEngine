// The command line. Each command mirrors a tool (the same code, the same answers), beside sign-in,
// the MCP server and the versions. `run` takes its I/O as arguments, so the tests run it in
// process; main.ts wires it to Node.

import type { JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { Args } from "./args";
import type { CredentialStore } from "./credentials";
import { normalizeBase } from "./credentials";
import type { Http, OpenSocket } from "./connection";
import { HostConnection, LiveError, signIn, signOut } from "./connection";
import { Live, resolveRevision } from "./live";
import { McpServer } from "./mcp";
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
  /** Asks on the terminal (`hidden`: without echoing what is typed); null when there is no terminal. */
  ask(question: string, hidden: boolean): Promise<string | null>;
  credentials: CredentialStore;
  http: Http;
  openSocket: OpenSocket;
}

export const USAGE = `${CLI_NAME}: manage your LumiRPEngine worlds on Lumiverse from a shell or an agent

Sign-in
  login [--url <base>] [--username <name>]   Sign in; the password comes from a hidden prompt or LUMIVERSE_PASSWORD
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
  search <words…> [--world <id>] [--collections <a,b>] [--limit <n>]
  create <name…> [--template <id>]            A new world, blank or from a starter
  import <file>                               A world file as a new world
  edit <worldId> --ops <file|json> [--expect-version <n>]
                                              JSON Patch on the draft
  draft <worldId>                             The draft: version, lint, changes against the head
  commit <worldId> [--note <text>]            The draft becomes the head
  discard <worldId>                           Drop the draft
  history <worldId>                           How each revision became head
  diff <worldId> [--from <s>] [--to <s>]      What changed (head to draft by default)
  restore <worldId> <revision>                The draft becomes a copy of a revision
  delete <worldId> --confirm <exact name>     Delete a world for good
  export <worldId> [--revision <r>] [--out <file>] [--offset <n>]
  chats [<worldId>]                           The chats that play a world
  attach <worldId> <chatId>                   A chat plays the world
  upgrade <chatId> [--to <revision>] [--preview] [--spoilers]

  mcp                                         All of it as an MCP server on stdio
  version, --version                          ${CLI_NAME}, engine, world format and agent API versions

  <s> is draft, head or a revision. Everywhere: --url <base> (or LUMIVERSE_URL) picks the Lumiverse when you
  are signed in to several; --read-only (or LRE_READ_ONLY=1) refuses every change.`;

class UsageError extends Error {}

interface Parsed {
  command: string | undefined;
  positionals: string[];
  values: Record<string, string[]>;
  flags: Record<string, true>;
}

const BOOLEAN_FLAGS: Record<string, true> = { "--read-only": true, "--preview": true, "--spoilers": true, "--map": true, "--help": true, "--version": true };

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
    options: ["--world", "--collections", "--limit"],
    needs: 1,
    usage: "search <words…> [--world <id>] [--collections <a,b>] [--limit <n>]",
    args: (p) => ({ query: p.positionals.join(" "), ...(one(p, "--world") !== undefined ? { worldId: one(p, "--world") } : {}), ...(one(p, "--collections") !== undefined ? { collections: (one(p, "--collections") ?? "").split(",").map((c) => c.trim()).filter((c) => c !== "") } : {}), ...(number(p, "--limit") !== undefined ? { limit: number(p, "--limit") } : {}) }),
  },
  create: { tool: "lre_world_create", options: ["--template"], needs: 1, usage: "create <name…> [--template <id>]", args: (p) => ({ name: p.positionals.join(" "), ...(one(p, "--template") !== undefined ? { template: one(p, "--template") } : {}) }) },
  import: { tool: "lre_world_import", options: [], needs: 1, usage: "import <file>", args: (p) => ({ path: pos(p, 0) }) },
  edit: { tool: "lre_edit", options: ["--ops", "--expect-version"], needs: 1, usage: "edit <worldId> --ops <file|json> [--expect-version <n>]", args: (p, io) => ({ worldId: pos(p, 0), ops: opsFrom(p, io), ...(number(p, "--expect-version") !== undefined ? { expectVersion: number(p, "--expect-version") } : {}) }) },
  draft: { tool: "lre_draft", options: [], needs: 1, usage: "draft <worldId>", args: (p) => ({ worldId: pos(p, 0) }) },
  commit: { tool: "lre_commit", options: ["--note"], needs: 1, usage: "commit <worldId> [--note <text>]", args: (p) => ({ worldId: pos(p, 0), ...(one(p, "--note") !== undefined ? { note: one(p, "--note") } : {}) }) },
  discard: { tool: "lre_discard", options: [], needs: 1, usage: "discard <worldId>", args: (p) => ({ worldId: pos(p, 0) }) },
  history: { tool: "lre_history", options: [], needs: 1, usage: "history <worldId>", args: (p) => ({ worldId: pos(p, 0) }) },
  diff: { tool: "lre_diff", options: ["--from", "--to"], needs: 1, usage: "diff <worldId> [--from <s>] [--to <s>]", args: (p) => ({ worldId: pos(p, 0), ...(one(p, "--from") !== undefined ? { from: one(p, "--from") } : {}), ...(one(p, "--to") !== undefined ? { to: one(p, "--to") } : {}) }) },
  restore: { tool: "lre_restore", options: [], needs: 2, usage: "restore <worldId> <revision>", args: (p) => ({ worldId: pos(p, 0), revision: pos(p, 1) }) },
  delete: { tool: "lre_world_delete", options: ["--confirm"], needs: 1, usage: "delete <worldId> --confirm <exact name>", args: (p) => ({ worldId: pos(p, 0), ...(one(p, "--confirm") !== undefined ? { confirm: one(p, "--confirm") } : {}) }) },
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

function liveFor(base: string, io: CliIO): Live {
  const login = io.credentials.get(base);
  if (login === null) throw new LiveError("login", `Not signed in to ${base}. Run: ${CLI_NAME} login --url ${base}`);
  return new Live(new HostConnection({ base, username: login.username, token: login.token, http: io.http, openSocket: io.openSocket, client: { name: CLI_NAME, version: CLI_VERSION } }));
}

interface Session {
  ctx: ToolContext;
  /** Closes the connection, if one was opened. */
  close(): void;
}

/** The tools' context for one run: the host is reached only when a live tool first needs it. */
function sessionFor(p: Parsed, io: CliIO): Session {
  let live: Live | null = null;
  const queue = new KeyedQueue();
  const readOnly = p.flags["--read-only"] === true || io.env.LRE_READ_ONLY === "1" || io.env.LRE_READ_ONLY === "true";
  const ctx: ToolContext = {
    readFile: (path) => io.readFile(path),
    readOnly,
    live: () => (live ??= liveFor(chooseBase(p, io), io)),
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
  const username = one(p, "--username") ?? io.env.LUMIVERSE_USERNAME ?? io.credentials.get(base)?.username ?? (await io.ask("Username: ", false));
  if (username === null || username.trim() === "") throw new UsageError("login needs your username: --username <name>, or LUMIVERSE_USERNAME.");
  const password = io.env.LUMIVERSE_PASSWORD ?? (await io.ask(`Password for ${username} at ${base}: `, true));
  if (password === null || password === "") throw new UsageError("No password: run login in a terminal and type it at the prompt, or set LUMIVERSE_PASSWORD.");
  const token = await signIn(io.http, base, username.trim(), password);
  io.credentials.put(base, { username: username.trim(), token, savedAt: Date.now() });
  io.out(`Signed in to ${base} as ${username.trim()}. The session is saved in ${io.credentials.path}, readable only by you; the password is not kept.`);
  // Say now whether LumiRPEngine answers there, rather than at the first tool call.
  const live = liveFor(base, io);
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
  let ended: boolean;
  try {
    ended = await signOut(io.http, base, login.token);
  } catch (error) {
    // The saved token goes either way: an unused session ends on its own within 7 days.
    io.err(`Couldn't reach Lumiverse to end the session (${error instanceof Error ? error.message : String(error)}). The saved session is deleted anyway; unused, it ends on its own within 7 days.`);
    ended = false;
  }
  io.credentials.remove(base);
  io.out(ended ? `Signed out of ${base}, and the saved session is deleted.` : `The saved session for ${base} is deleted.`);
  return 0;
}

/** `template --out` and `export --out`: the whole file, written in one go. */
async function writeOut(command: string, p: Parsed, io: CliIO, session: Session, out: string): Promise<number> {
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
  io.writeFile(out, `${JSON.stringify(file, null, 2)}\n`);
  io.out(`Wrote ${what} to ${out} as an export file (Import reads it).`);
  return 0;
}

export type RunResult = { code: number } | { mcp: McpServer; close(): void };

/** Runs one command; `mcp` hands back the server for the caller to serve on stdin. */
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
  if (command === "mcp") {
    const session = sessionFor(p, io);
    return { mcp: new McpServer(session.ctx), close: session.close };
  }
  const session = sessionFor(p, io);
  try {
    if (command === "login") {
      if (p.values["--password"] !== undefined) throw new UsageError(`${CLI_NAME} never takes a password as an argument: it would stay in your shell history and show in the process list. Type it at the prompt, or set LUMIVERSE_PASSWORD.`);
      return { code: await login(p, io) };
    }
    if (command === "logout") return { code: await logout(p, io) };
    const mirror = hasOwn(MIRRORS, command) ? MIRRORS[command] : undefined;
    if (mirror === undefined || findTool(mirror.tool) === undefined) {
      io.err(`There is no command ${command}.\n\n${USAGE}`);
      return { code: 2 };
    }
    const known = new Set(["--url", "--read-only", "--help", ...mirror.options]);
    const stray = [...Object.keys(p.values), ...Object.keys(p.flags)].filter((o) => !known.has(o));
    if (stray.length > 0) throw new UsageError(`${command} doesn't take ${stray.join(", ")}. Usage: ${CLI_NAME} ${mirror.usage}`);
    if (p.positionals.length < mirror.needs) throw new UsageError(`Usage: ${CLI_NAME} ${mirror.usage}`);
    const out = one(p, "--out");
    if (out !== undefined) return { code: await writeOut(command, p, io, session, out) };
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
    session.close();
  }
}
