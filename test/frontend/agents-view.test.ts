// The update notice's and Settings → MCP server's words for each MCP server (DESIGN §23), and which
// of Lumiverse's own MCP server profiles run lumirpengine and how one is switched to the extension's copy.

import { describe, expect, test } from "bun:test";
import { extensionArgs, lumirpengineProfiles, serverLine } from "../../src/frontend/agents-view";
import type { McpProfile } from "../../src/frontend/agents-view";
import type { AgentClientView, AgentsView } from "../../src/shared/agents";
import { NPM_INSTALL } from "../../src/shared/agents";

const CORE = "/srv/lumiverse/data/extensions/lumi_rp_engine/repo/dist/lumirpengine.js";
const view: AgentsView = { build: "b2", notice: { build: "b2", previous: "a1", at: 1 }, setup: { core: CORE, command: `node ${CORE} mcp` }, clients: [] };
const client = (over: Partial<AgentClientView>): AgentClientView => ({ id: "c1", name: "lumirpengine", version: "0.0.1", host: "studio", harness: null, core: "c0", kit: "b2", follows: true, why: null, seen: 1, connected: true, state: "updated", ...over });

describe("each server's line", () => {
  test("reloaded, not yet with Update now, and can't follow with why and what fixes it", () => {
    expect(serverLine(client({}), view)).toEqual({ state: "updated", text: "lumirpengine on studio reloaded this build's tools.", update: false, copy: [] });
    expect(serverLine(client({ harness: "claude-code" }), view).text).toBe("lumirpengine for claude-code on studio reloaded this build's tools.");
    expect(serverLine(client({ state: "behind", kit: "a1" }), view)).toMatchObject({ update: true, text: "lumirpengine on studio hasn't reloaded this build's tools yet." });
    expect(serverLine(client({ state: "behind", kit: "a1", connected: false }), view).text).toContain("hasn't checked in since LumiRPEngine restarted");
    const elsewhere = serverLine(client({ state: "cannot", kit: "a1", follows: false, why: { code: "elsewhere", text: "LumiRPEngine's tools aren't on this machine" } }), view);
    expect(elsewhere).toMatchObject({ update: false, text: "lumirpengine on studio can't follow LumiRPEngine: LumiRPEngine's tools aren't on this machine.", copy: [{ label: "Copy the install", text: NPM_INSTALL }] });
    expect(serverLine(client({ state: "cannot", kit: "a1", follows: false, why: { code: "unreadable", text: "can't be read here" } }), view).copy).toEqual([{ label: "Copy the setup", text: `node ${CORE} mcp` }]);
  });

  test("a server from before following gets the one-time install and the setup that follows, each to copy", () => {
    const line = serverLine(client({ state: "old", host: null, core: null, kit: null, follows: false }), view);
    expect(line.text).toContain("lumirpengine 0.0.1 is from before MCP servers followed LumiRPEngine");
    expect(line.text).toContain(NPM_INSTALL);
    expect(line.text).toContain(`node ${CORE} mcp`);
    expect(line.copy).toEqual([
      { label: "Copy the install", text: NPM_INSTALL },
      { label: "Copy the setup", text: `node ${CORE} mcp` },
    ]);
  });
});

describe("Lumiverse's own MCP servers", () => {
  const profile = (id: string, command: string, args: string[], transport_type = "stdio"): McpProfile => ({ id, name: id, transport_type, command, args, is_enabled: true });
  const profiles = [
    profile("own", "node", [CORE, "mcp"]),
    profile("global", "/usr/local/bin/node", ["/usr/local/lib/node_modules/lumi-rp-engine/dist/lumirpengine.js", "mcp", "--read-only"]),
    profile("npx", "npx", ["-y", "github:TheLiquorPriest/LumiRPEngine#v1", "mcp"]),
    profile("bin", "C:\\npm\\lumirpengine.exe", ["mcp"]),
    profile("other", "node", ["/opt/other-server/index.js"]),
    profile("remote", "", [], "streamable_http"),
  ];

  test("the ones that run lumirpengine, and from where", () => {
    expect(lumirpengineProfiles(profiles, CORE).map((p) => [p.profile.id, p.kind])).toEqual([
      ["own", "extension"],
      ["global", "npm"],
      ["npx", "npx"],
      ["bin", "npm"],
    ]);
  });

  test("switched to the extension's own copy, an npm or npx one keeps the options after mcp", () => {
    expect(extensionArgs(profiles[1] as McpProfile, CORE)).toEqual([CORE, "mcp", "--read-only"]);
    expect(extensionArgs(profiles[2] as McpProfile, CORE)).toEqual([CORE, "mcp"]);
  });
});
