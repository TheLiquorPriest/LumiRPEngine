// What the update notice and Settings → MCP server say of each MCP server (DESIGN §23). Pure, so
// the words are tested directly.

import type { AgentClientView, AgentState, AgentsView } from "../shared/agents";
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
  const setup = view.setup === null ? [] : [{ label: "Copy the setup", text: view.setup.command }];
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
    case "old":
      return { state: client.state, text: `${name} is from before MCP servers followed LumiRPEngine, so it keeps the tools it was installed with. Update it once (${NPM_INSTALL}), or set it up to run the extension's own copy${view.setup === null ? "" : ` (${view.setup.command})`}, which follows from then on.`, update: false, copy: [install, ...setup] };
  }
}
