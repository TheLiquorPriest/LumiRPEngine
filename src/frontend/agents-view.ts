// What the update notice and Settings → MCP server say of each MCP server and of the setup that
// follows (DESIGN §23). Pure, so the words are tested directly.

import type { AgentClientView, AgentState, AgentsView, SetupCommand } from "../shared/agents";
import { LUMIVERSE_HARNESS, NPM_INSTALL } from "../shared/agents";

export interface ServerLine {
  state: AgentState;
  text: string;
  /** It hasn't reloaded yet: Update now asks it to. */
  update: boolean;
  /** Commands that fix what the line says, to copy. */
  copy: { label: string; text: string }[];
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
      if (client.harness === LUMIVERSE_HARNESS) return { state: client.state, text: `${name} reloaded this build's tools, but Lumiverse's MCP client keeps its old tool list until the server restarts: in Lumiverse's Settings → MCP Servers, Disconnect it and Connect it again.`, update: false, copy: [] };
      return { state: client.state, text: `${name} reloaded this build's tools.`, update: false, copy: [] };
    case "behind":
      // Not connected is not heard from since LumiRPEngine started: right after an update that is every server, running or not.
      return { state: client.state, text: `${name} hasn't reloaded this build's tools yet${client.connected ? "." : ": it hasn't checked in since LumiRPEngine restarted. Running, it takes them at its next check, within a minute; stopped, when it next starts."}`, update: true, copy: [] };
    case "cannot": {
      // Another machine, or a core too old for this kit: only a new install there helps. Pinned, or a kit other users can change
      // (the extension's own copy would refuse it too): no command fixes it. Anything else: the setup that follows.
      const fix = client.why?.code === "elsewhere" || client.why?.code === "kit_api" ? [install] : client.why?.code === "pinned" || client.why?.code === "unsafe" ? [] : setup;
      return { state: client.state, text: `${name} can't follow LumiRPEngine: ${client.why?.text ?? "it didn't say why"}.`, update: false, copy: fix };
    }
    case "old": {
      const commands = view.setup === null ? "" : ` (${view.setup.commands.map((c) => `${c.command} with ${c.needs}`).join(", or ")})`;
      return { state: client.state, text: `${name} is from before MCP servers followed LumiRPEngine, so it keeps the tools it was installed with. Update it once (${NPM_INSTALL}), or set it up to run the extension's own copy${commands}, which follows from then on.`, update: false, copy: [install, ...setup] };
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
