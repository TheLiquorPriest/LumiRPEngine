// What the update notice and Settings → MCP server say of each MCP server (DESIGN §23), and which
// of Lumiverse's own MCP server profiles run lumirpengine. Pure, so the words are tested directly.

import type { AgentClientView, AgentState, AgentsView } from "../shared/agents";
import { NPM_INSTALL } from "../shared/agents";

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
  const name = client.host !== null ? `${client.name} on ${client.host}` : `${client.name} ${client.version}`;
  const install = { label: "Copy the install", text: NPM_INSTALL };
  const setup = view.setup === null ? [] : [{ label: "Copy the setup", text: view.setup.command }];
  switch (client.state) {
    case "updated":
      return { state: client.state, text: `${name} reloaded this build's tools.`, update: false, copy: [] };
    case "behind":
      return { state: client.state, text: `${name} hasn't reloaded this build's tools yet${client.connected ? "." : ": it isn't connected now, and takes them when it next connects."}`, update: true, copy: [] };
    case "cannot": {
      // Another machine, or a core too old for this kit: only a new install there helps. Anything else: the setup that follows.
      const fix = client.why?.code === "elsewhere" || client.why?.code === "kit_api" ? [install] : client.why?.code === "pinned" ? [] : setup;
      return { state: client.state, text: `${name} can't follow LumiRPEngine: ${client.why?.text ?? "it didn't say why"}.`, update: false, copy: fix };
    }
    case "old":
      return { state: client.state, text: `${name} is from before MCP servers followed LumiRPEngine, so it keeps the tools it was installed with. Update it once (${NPM_INSTALL}), or set it up to run the extension's own copy${view.setup === null ? "" : ` (${view.setup.command})`}, which follows from then on.`, update: false, copy: [install, ...setup] };
  }
}

/** A Lumiverse MCP server profile, as `/api/v1/mcp-servers` lists it (the fields read here). */
export interface McpProfile {
  id: string;
  name: string;
  transport_type: string;
  command: string;
  args: string[];
  is_enabled: boolean;
}

/** How a profile runs lumirpengine: the extension's own copy, an npm install, or npx. */
export type ProfileKind = "extension" | "npm" | "npx";

const baseName = (path: string): string => (path.replaceAll("\\", "/").split("/").at(-1) ?? "").toLowerCase().replace(/\.exe$/, "");

/** The profiles that run lumirpengine, and from where; `core` is the extension's own (null when this build has none). */
export function lumirpengineProfiles(profiles: readonly McpProfile[], core: string | null): { profile: McpProfile; kind: ProfileKind }[] {
  const out: { profile: McpProfile; kind: ProfileKind }[] = [];
  for (const profile of profiles) {
    if (profile.transport_type !== "stdio") continue;
    const command = baseName(profile.command);
    if (command === "lumirpengine") out.push({ profile, kind: "npm" });
    else if (command === "npx" && profile.args.some((arg) => /^github:TheLiquorPriest\/LumiRPEngine(#.*)?$/i.test(arg) || /^lumi-rp-engine(@.*)?$/.test(arg))) out.push({ profile, kind: "npx" });
    else if (command === "node" || command === "bun") {
      const script = profile.args.find((arg) => arg.replaceAll("\\", "/").endsWith("/lumirpengine.js"));
      if (script !== undefined) out.push({ profile, kind: core !== null && script === core ? "extension" : "npm" });
    }
  }
  return out;
}

/** The arguments that run the extension's own copy instead, keeping the options after `mcp` (`--read-only`, `--url`…). */
export function extensionArgs(profile: McpProfile, core: string): string[] {
  const at = profile.args.indexOf("mcp");
  return [core, "mcp", ...(at >= 0 ? profile.args.slice(at + 1) : [])];
}
