// What the update notice and Settings → MCP server say of each MCP server and of the setup that
// follows (DESIGN §23). Pure, so the words are tested directly.

import type { AgentClientView, AgentState, AgentsView, LumiverseRunView, SetupCommand } from "../shared/agents";
import { NPM_INSTALL } from "../shared/agents";
import { formatMs } from "../shared/timeouts";

export interface ServerLine {
  state: AgentState;
  text: string;
  /** It hasn't reloaded yet: Update now asks it to. */
  update: boolean;
  /** Lumiverse runs it and its client holds an old tool list: Reconnect in Lumiverse asks it to exit, so Lumiverse connects it again. */
  reconnect: boolean;
  /** Commands that fix what the line says, to copy. */
  copy: { label: string; text: string }[];
}

/** What Lumiverse's own users do by hand: its MCP client lists a server's tools only when it connects. */
const BY_HAND = "in Lumiverse's Settings → MCP Servers, Disconnect it and Connect it again";
/** How the permission that lets the line see Lumiverse's own tool list is granted. */
const GRANT = "In Lumiverse's Extensions tab, switch on LumiRPEngine's Mcp Servers permission (an owner or admin grants it) and this line checks Lumiverse's own tool list.";

/**
 * A server Lumiverse runs that reloaded this build's tools: whether Lumiverse's client has them
 * (by Spindle with `mcp_servers`, else by what the server's processes listed it), Reconnect in
 * Lumiverse while it holds an old list, and the wait for the server back once that was pressed.
 */
function lumiverseLine(name: string, run: LumiverseRunView): ServerLine {
  const line = (text: string, reconnect = false): ServerLine => ({ state: "updated", text, update: false, reconnect, copy: [] });
  const unchecked = run.profiles === null ? ` Without the mcp_servers permission LumiRPEngine can't check Lumiverse's own tool list, only the server's. ${GRANT}` : "";
  if (run.reconnect?.state === "waiting") return line(`${name} reloaded this build's tools; it was asked to exit once its calls are answered, and Lumiverse connects it again. Waiting for it back with them${run.reconnect.through === "server" ? ", as its new process says (Lumiverse's own list can't be checked without the mcp_servers permission)" : ""}.`);
  if (run.reconnect?.state === "late") {
    const within = run.reconnect.waitMs === null ? "" : ` within ${formatMs(run.reconnect.waitMs)} (Settings → Timeouts → MCP server reconnect)`;
    return line(`${name} isn't back from Reconnect in Lumiverse with this build's tools${within}: ${BY_HAND}.`, run.stale > 0);
  }
  if (run.stale > 0) return line(`${name} reloaded this build's tools, but Lumiverse's MCP client keeps the list it got when it connected. Reconnect in Lumiverse ends the server's process once its calls are answered, and Lumiverse connects it again with this build's tools.${unchecked}`, true);
  const old = run.profiles !== null && run.profiles.some((p) => !p.current);
  // A process from before Reconnect in Lumiverse can't be asked, and doesn't say what its client listed.
  if (old || (run.profiles === null && run.unknown > 0)) return line(`${name} reloaded this build's tools, but Lumiverse's MCP client keeps its old tool list until the server restarts: ${BY_HAND}.`);
  if (run.profiles !== null && run.profiles.length > 0) return line(`${name} reloaded this build's tools, and Lumiverse's MCP client has them.`);
  return line(`${name} serves this build's tools, and gave them to Lumiverse's MCP client when it connected.${unchecked}`);
}

/** One server's line: reloaded, not yet, can't follow (why, and what to do), or from before following. */
export function serverLine(client: AgentClientView, view: AgentsView): ServerLine {
  // A line with several processes (two windows of one harness) stands as the one furthest behind, so it says how many there are.
  const processes = client.processes > 1 ? ` (${client.processes} processes)` : "";
  const name = `${client.host !== null ? `${client.name}${client.harness !== null ? ` for ${client.harness}` : ""} on ${client.host}` : `${client.name} ${client.version}`}${processes}`;
  const install = { label: "Copy the install", text: NPM_INSTALL };
  // The setup that follows: its command under each runtime, Bun first, each labelled with the version it needs.
  const setup = (view.setup?.commands ?? []).map((c) => ({ label: `Copy the setup for ${c.needs}`, text: c.command }));
  switch (client.state) {
    case "updated":
      // Lumiverse's own MCP client lists a server's tools once, when it connects, and ignores
      // tools/list_changed: its models see the old list until the server is connected again.
      if (client.lumiverse !== null) return lumiverseLine(name, client.lumiverse);
      return { state: client.state, text: `${name} reloaded this build's tools.`, update: false, reconnect: false, copy: [] };
    case "behind":
      // Not connected is not heard from since LumiRPEngine started: right after an update that is every server, running or not.
      return { state: client.state, text: `${name} hasn't reloaded this build's tools yet${client.connected ? "." : ": it hasn't checked in since LumiRPEngine restarted. Running, it takes them at its next check, within a minute; stopped, when it next starts."}`, update: true, reconnect: false, copy: [] };
    case "cannot": {
      // Another machine, or a core too old for this kit: only a new install there helps. Pinned, or a kit other users can change
      // (the extension's own copy would refuse it too): no command fixes it. Anything else: the setup that follows.
      const fix = client.why?.code === "elsewhere" || client.why?.code === "kit_api" ? [install] : client.why?.code === "pinned" || client.why?.code === "unsafe" ? [] : setup;
      return { state: client.state, text: `${name} can't follow LumiRPEngine: ${client.why?.text ?? "it didn't say why"}.`, update: false, reconnect: false, copy: fix };
    }
    case "old": {
      const commands = view.setup === null ? "" : ` (${view.setup.commands.map((c) => `${c.command} with ${c.needs}`).join(", or ")})`;
      return { state: client.state, text: `${name} is from before MCP servers followed LumiRPEngine, so it keeps the tools it was installed with. Update it once (${NPM_INSTALL}), or set it up to run the extension's own copy${commands}, which follows from then on.`, update: false, reconnect: false, copy: [install, ...setup] };
    }
  }
}

/** Why a runtime is offered, after the version it needs: Bun leads, as the one Lumiverse's machine always has. */
const OFFERED: Record<SetupCommand["runtime"], string> = {
  bun: ", which Lumiverse itself runs on, so it is always on Lumiverse's machine",
  node: "",
};

/** Settings → MCP server's setup: each command that follows, Bun first, under what it needs; then how to give one to a harness. */
export function setupSection(setup: NonNullable<AgentsView["setup"]>): { choices: (SetupCommand & { label: string })[]; help: string } {
  // The first runtime (Bun) gives the examples; the others are the same with their own command.
  const [lead] = setup.commands;
  return {
    choices: setup.commands.map((c) => ({ ...c, label: `For ${c.needs}${OFFERED[c.runtime]}` })),
    help: `Give your agent's harness one of these commands for its lumirpengine server (claude mcp add lumirpengine -- ${lead.command}). It runs this extension's own copy, on the machine Lumiverse runs on, and takes each update's tools by itself. Sign in once first: ${lead.runtime} ${setup.core} login --url <your Lumiverse>. For Lumiverse itself to run it (its Settings → MCP Servers), add a Stdio server with the command ${setup.commands.map((c) => c.runtime).join(" or ")} and the arguments ${setup.core}, mcp.`,
  };
}
