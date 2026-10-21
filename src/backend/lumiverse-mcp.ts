// Lumiverse's own MCP server profiles that run lumirpengine (DESIGN §23, G13), read through
// Spindle's `mcp.servers` with the `mcp_servers` permission. Spindle shows a profile without its
// command or arguments, so a profile is known for one of this extension's servers by the tools
// Lumiverse's client holds for it: every kit lists `KIT_MARKS`. Whether that list is this build's
// is its fingerprint against the build's two (read-only and full). Every other profile is read
// only as far as its tool names and then dropped: nothing of it is kept, shown or logged.

import type { ListedTool } from "../shared/agents";
import { KIT_MARKS, toolsFingerprint } from "../shared/agents";
import type { UserId } from "../shared/ids";
import type { HostPort } from "./host";

/** A profile Lumiverse's client is connected to and holds lumirpengine's tools for. */
export interface LreProfile {
  id: string;
  name: string;
  /** The tools it holds are this build's. */
  current: boolean;
}

/** Whether Lumiverse's client holds one of this build's tool lists. */
export function holdsBuild(tools: readonly ListedTool[], fingerprints: readonly string[]): boolean {
  return fingerprints.includes(toolsFingerprint(tools));
}

/**
 * The user's profiles that run lumirpengine. A profile Lumiverse isn't connected to holds no tools,
 * so it can't be told apart from any other and isn't one of them. Throws without `mcp_servers`.
 */
export async function lreProfiles(mcp: HostPort["mcp"], userId: UserId, fingerprints: readonly string[]): Promise<LreProfile[]> {
  const profiles = await mcp.stdioProfiles(userId);
  const statuses = await Promise.all(profiles.map((p) => mcp.status(p.id, userId)));
  const out: LreProfile[] = [];
  profiles.forEach((p, i) => {
    const s = statuses[i];
    if (s === undefined || !s.connected || !KIT_MARKS.every((mark) => s.tools.some((t) => t.name === mark))) return;
    out.push({ id: p.id, name: p.name, current: holdsBuild(s.tools, fingerprints) });
  });
  return out;
}
