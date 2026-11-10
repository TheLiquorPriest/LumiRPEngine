// The agent kit and the MCP servers that follow it (DESIGN §23): where a build's kit is and what it
// hashes to, what a server checks in with, and the servers a user's account has seen. Shared by the
// backend, which says where its kit is and keeps the check-ins, the frontend, which shows them, and
// the `lumirpengine` CLI, which loads the kit.

import { hashJson } from "./hash";

/** The level of the contract between the CLI's core and an agent kit: a kit of another level is refused, not loaded. */
export const KIT_API = 1;

/** The kit and the core as `bun run build` names them, beside dist/backend.js. */
export const KIT_FILE = "agent-kit.js";
export const CORE_FILE = "lumirpengine.js";

/** The one-time install that brings a server from before following up to date. */
export const NPM_INSTALL = "npm i -g github:TheLiquorPriest/LumiRPEngine";

/**
 * The harness a server Lumiverse runs itself (its Settings → MCP Servers) checks in with: the name
 * Lumiverse's MCP client gives in `initialize` (`new Client({ name: "lumiverse" })`, in Lumiverse's
 * src/services/mcp-client-manager.ts).
 */
export const LUMIVERSE_HARNESS = "lumiverse";

/** The permission that lets the extension see the user's Lumiverse MCP server profiles and the tools Lumiverse's client holds for each (Spindle's `mcp.servers`). */
export const MCP_PERMISSION = "mcp_servers";

/** Tools every kit lists, read-only or not: a Lumiverse profile whose client holds both runs a lumirpengine server. */
export const KIT_MARKS = ["lre_guide", "lre_status"] as const;

/** A tool as Lumiverse's MCP client keeps it from a server's `tools/list` (its `McpDiscoveredTool`, without the server it came from). */
export interface ListedTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * A tool list's fingerprint, its key order aside: `bun run build` takes it of the kit's two lists
 * (read-only and full) and the backend of the list Lumiverse's client holds for a profile, so the
 * two match exactly when Lumiverse has this build's tools.
 */
export function toolsFingerprint(tools: readonly ListedTool[]): string {
  return hashJson(tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })));
}

/** This build's agent kit, as LumiRPEngine tells an outside client: its absolute path, its sha256 (hex), its contract level, and the core beside it. */
export interface KitReport {
  path: string;
  sha256: string;
  api: number;
  core: string;
}

/** Why an MCP server doesn't follow the extension's kit; `unsafe`: the kit, or a directory it sits in, can be changed by other users; `runtime`: it runs on a Bun that can't load a kit. */
export type FollowCode = "pinned" | "runtime" | "unsupported" | "no_kit" | "kit_api" | "refused" | "unsafe" | "elsewhere" | "unreadable" | "mismatch" | "broken";

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
  /**
   * The build of the kit whose tools it last answered its client's `tools/list` with, null before
   * the client asked; a core from before Reconnect in Lumiverse doesn't send it. Lumiverse's client
   * lists only on connecting, so a Lumiverse-run server listed another build holds an old list.
   */
  listed: string | null;
}

/** A hello's `client`: every outside client names itself; an MCP server from this build on checks in as well. */
export type HelloClient = { name: string; version: string } & Partial<AgentCheckIn>;

/** How a server stands against this build: on its tools, not yet, unable to follow, or from before following. */
export type AgentState = "updated" | "behind" | "cannot" | "old";

/** One MCP server: as the process of it furthest behind left it, of those heard from in the last 2 minutes, else as its last check-in did. */
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
  /** Its processes heard from in the last 2 minutes (each a session of its own, since the extension started). */
  processes: number;
  state: AgentState;
  /** A server Lumiverse runs itself (harness `lumiverse`): what Lumiverse's client holds, and Reconnect in Lumiverse; null for any other. */
  lumiverse: LumiverseRunView | null;
}

/** Reconnect in Lumiverse (DESIGN §23) under way: its processes were asked to exit, and the line waits for them back with this build's tools, or they weren't back within the wait. */
export interface ReconnectView {
  state: "waiting" | "late";
  /** The wait it was given (Settings → Timeouts → MCP server reconnect), in ms; null for no limit. */
  waitMs: number | null;
  /** What says it is back: Lumiverse's own tool list, through Spindle (`mcp_servers`), or only the server's new processes. */
  through: "lumiverse" | "server";
}

/** What a server Lumiverse runs itself adds to its line. */
export interface LumiverseRunView {
  /** Its connected processes whose client holds another build's tools than they serve: Reconnect in Lumiverse asks these to exit, and Lumiverse connects them again. */
  stale: number;
  /** Its processes from before Reconnect in Lumiverse: they don't say what their client listed, and don't exit when asked. */
  unknown: number;
  /** Lumiverse's own profiles that hold LumiRPEngine's tools, each with whether that is this build's list; null without the `mcp_servers` permission (or when Spindle couldn't say). */
  profiles: LumiverseProfileView[] | null;
  reconnect: ReconnectView | null;
}

/** A Lumiverse MCP server profile whose client holds lumirpengine's tools, as Spindle shows it: its name, and nothing else of its configuration. */
export interface LumiverseProfileView {
  name: string;
  /** Lumiverse's client holds this build's tools for it. */
  current: boolean;
}

/** What Settings → MCP server and the update notice show. */
export interface AgentsView {
  /** This build. */
  build: string;
  /** The extension started as another build than it last ran as, and this user hasn't dismissed the notice. */
  notice: { build: string; previous: string; at: number } | null;
  /** The setup that follows the extension: its own core, and the command that runs it under each runtime, Bun first; null when this build has no kit. */
  setup: { core: string; commands: SetupCommand[] } | null;
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

/**
 * The runtimes the core runs on, each with the least version of it that follows the extension.
 * Bun first: Lumiverse runs only on Bun (1.4.2 or newer), so one that follows is always on
 * Lumiverse's machine, where a server must run to follow; a machine set up with Node can use that.
 */
export const RUNTIMES = [
  { runtime: "bun", needs: "Bun 1.4 or newer" },
  { runtime: "node", needs: "Node 22 or newer" },
] as const;

/** One way to run the setup that follows the extension: the runtime's command, the version it needs, and the whole command. */
export interface SetupCommand {
  runtime: (typeof RUNTIMES)[number]["runtime"];
  needs: string;
  command: string;
}

/** The setup that follows the extension: its own core, under each runtime, Bun first. */
export function followCommands(core: string): SetupCommand[] {
  return RUNTIMES.map(({ runtime, needs }) => ({ runtime, needs, command: `${runtime} ${shellWord(core)} mcp` }));
}
