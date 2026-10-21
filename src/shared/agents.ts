// The agent kit and the MCP servers that follow it (DESIGN §23): where a build's kit is and what it
// hashes to, what a server checks in with, and the servers a user's account has seen. Shared by the
// backend, which says where its kit is and keeps the check-ins, the frontend, which shows them, and
// the `lumirpengine` CLI, which loads the kit.

/** The level of the contract between the CLI's core and an agent kit: a kit of another level is refused, not loaded. */
export const KIT_API = 1;

/** The kit and the core as `bun run build` names them, beside dist/backend.js. */
export const KIT_FILE = "agent-kit.js";
export const CORE_FILE = "lumirpengine.js";

/** The one-time install that brings a server from before following up to date. */
export const NPM_INSTALL = "npm i -g github:TheLiquorPriest/LumiRPEngine";

/** This build's agent kit, as LumiRPEngine tells an outside client: its absolute path, its sha256 (hex), its contract level, and the core beside it. */
export interface KitReport {
  path: string;
  sha256: string;
  api: number;
  core: string;
}

/** Why an MCP server doesn't follow the extension's kit. */
export type FollowCode = "pinned" | "unsupported" | "no_kit" | "kit_api" | "refused" | "elsewhere" | "unreadable" | "mismatch" | "broken";

/** What an MCP server checks in with, in its hello's `client`, on connecting and after each change of what it runs. */
export interface AgentCheckIn {
  /** An MCP server checks in; a command-line run only names itself. */
  serves: "mcp" | "command";
  /** The builds of its core and of the kit it has loaded. */
  core: string;
  kit: string;
  /** Whether it follows the extension's kit, and why not. */
  follows: boolean;
  why: { code: FollowCode; text: string } | null;
  /** The machine it runs on. */
  host: string;
  /** The agent harness that runs it (its MCP client's `initialize` clientInfo.name: claude-code, codex…), null when it gave none. */
  harness: string | null;
}

/** A hello's `client`: every outside client names itself; an MCP server from this build on checks in as well. */
export type HelloClient = { name: string; version: string } & Partial<AgentCheckIn>;

/** How a server stands against this build: on its tools, not yet, unable to follow, or from before following. */
export type AgentState = "updated" | "behind" | "cannot" | "old";

/** One MCP server as its last check-in left it. */
export interface AgentClientView {
  id: string;
  name: string;
  version: string;
  host: string | null;
  /** The harness that runs it; null for one that gave none, and for a server from before check-ins or harnesses. */
  harness: string | null;
  /** Null for a server from before check-ins. */
  core: string | null;
  kit: string | null;
  follows: boolean;
  why: { code: FollowCode | "other"; text: string } | null;
  /** Its last check-in, in ms since the epoch. */
  seen: number;
  /** A session of it is open now. */
  connected: boolean;
  state: AgentState;
}

/** What Settings → MCP server and the update notice show. */
export interface AgentsView {
  /** This build. */
  build: string;
  /** The extension started as another build than it last ran as, and this user hasn't dismissed the notice. */
  notice: { build: string; previous: string; at: number } | null;
  /** The setup that follows the extension: its own core, as a command; null when this build has no kit. */
  setup: { core: string; command: string } | null;
  /** The servers this account has seen, the latest first. */
  clients: AgentClientView[];
}

/**
 * The file a `file:` URL names, as its machine writes paths: `file:///home/x` is `/home/x`,
 * `file:///C:/x` is `C:\x` and `file://server/share/x` is `\\server\share\x`. Null for any other URL.
 */
export function pathOfFileUrl(url: string): string | null {
  let parsed: URL;
  let path: string;
  try {
    parsed = new URL(url);
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (parsed.protocol !== "file:") return null;
  if (parsed.hostname !== "") return `\\\\${parsed.hostname}${path.replaceAll("/", "\\")}`;
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1).replaceAll("/", "\\") : path;
}

/**
 * Why an MCP server may not load a kit from this path, or null when it may: only an absolute,
 * plain path ending `/extensions/<identifier>/repo/dist/agent-kit.js`, where Lumiverse installs an
 * extension, with either separator. A message can name any file, so the hash is not the only guard.
 */
export function kitPathProblem(path: string, identifier: string): string | null {
  const slashed = path.replaceAll("\\", "/");
  if (!(slashed.startsWith("/") || /^[A-Za-z]:\//.test(slashed))) return "isn't an absolute path";
  const segments = (slashed.startsWith("//") ? slashed.slice(2) : slashed).split("/").slice(1);
  if (segments.some((s) => s === "" || s === "." || s === "..")) return "isn't a plain path (it has an empty, . or .. part)";
  if (!slashed.endsWith(`/extensions/${identifier}/repo/dist/${KIT_FILE}`)) return `isn't where Lumiverse installs an extension's kit (…/extensions/${identifier}/repo/dist/${KIT_FILE})`;
  return null;
}

/** A path as one shell word: bare when it can be, else quoted. */
function shellWord(text: string): string {
  if (/^[\w./:\\@%+=,-]+$/.test(text)) return text;
  if (!/["$`]/.test(text)) return `"${text}"`;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

/** The setup that follows the extension: its own core, run by Node. */
export function followCommand(core: string): string {
  return `node ${shellWord(core)} mcp`;
}
