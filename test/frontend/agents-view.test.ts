// The update notice's and Settings → MCP server's words for each MCP server (DESIGN §23).

import { describe, expect, test } from "bun:test";
import { serverLine } from "../../src/frontend/agents-view";
import type { AgentClientView, AgentsView } from "../../src/shared/agents";
import { NPM_INSTALL } from "../../src/shared/agents";

const CORE = "/srv/lumiverse/data/extensions/lumi_rp_engine/repo/dist/lumirpengine.js";
const view: AgentsView = { build: "b2", notice: { build: "b2", previous: "a1", at: 1 }, setup: { core: CORE, command: `node ${CORE} mcp` }, clients: [] };
const client = (over: Partial<AgentClientView>): AgentClientView => ({ id: "c1", name: "lumirpengine", version: "0.0.1", host: "studio", harness: null, core: "c0", kit: "b2", follows: true, why: null, seen: 1, connected: true, processes: 1, state: "updated", ...over });

describe("each server's line", () => {
  test("reloaded, not yet with Update now, and can't follow with why and what fixes it", () => {
    expect(serverLine(client({}), view)).toEqual({ state: "updated", text: "lumirpengine on studio reloaded this build's tools.", update: false, copy: [] });
    expect(serverLine(client({ harness: "claude-code" }), view).text).toBe("lumirpengine for claude-code on studio reloaded this build's tools.");
    expect(serverLine(client({ state: "behind", kit: "a1" }), view)).toMatchObject({ update: true, text: "lumirpengine on studio hasn't reloaded this build's tools yet." });
    expect(serverLine(client({ state: "behind", kit: "a1", connected: false }), view).text).toContain("hasn't checked in since LumiRPEngine restarted");
    const elsewhere = serverLine(client({ state: "cannot", kit: "a1", follows: false, why: { code: "elsewhere", text: "LumiRPEngine's tools aren't on this machine" } }), view);
    expect(elsewhere).toMatchObject({ update: false, text: "lumirpengine on studio can't follow LumiRPEngine: LumiRPEngine's tools aren't on this machine.", copy: [{ label: "Copy the install", text: NPM_INSTALL }] });
    expect(serverLine(client({ state: "cannot", kit: "a1", follows: false, why: { code: "unreadable", text: "can't be read here" } }), view).copy).toEqual([{ label: "Copy the setup", text: `node ${CORE} mcp` }]);
    // On a Bun that can't load a kit, the setup that follows is the fix: it runs the core with Node.
    expect(serverLine(client({ state: "cannot", kit: "a1", follows: false, why: { code: "runtime", text: "run it with Node 22 or newer (Bun before 1.4 can't load the kit)" } }), view)).toEqual({ state: "cannot", text: "lumirpengine on studio can't follow LumiRPEngine: run it with Node 22 or newer (Bun before 1.4 can't load the kit).", update: false, copy: [{ label: "Copy the setup", text: `node ${CORE} mcp` }] });
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

  test("a server running as more than one process says how many", () => {
    expect(serverLine(client({ harness: "claude-code", processes: 2, state: "behind", kit: "a1" }), view).text).toBe("lumirpengine for claude-code on studio (2 processes) hasn't reloaded this build's tools yet.");
    expect(serverLine(client({ harness: "claude-code", processes: 2 }), view).text).toBe("lumirpengine for claude-code on studio (2 processes) reloaded this build's tools.");
    // One, or none heard from lately: nothing to count.
    for (const processes of [0, 1]) expect(serverLine(client({ harness: "claude-code", processes }), view).text).toBe("lumirpengine for claude-code on studio reloaded this build's tools.");
  });

  test("a server Lumiverse runs itself is a line like any other; once it reloads, the line says Lumiverse's MCP client keeps its old tool list until the server restarts, and where to restart it", () => {
    const updated = serverLine(client({ harness: "lumiverse" }), view);
    expect(updated).toMatchObject({ state: "updated", update: false, copy: [] });
    expect(updated.text).toStartWith("lumirpengine for lumiverse on studio reloaded this build's tools, but Lumiverse's MCP client keeps its old tool list until the server restarts");
    expect(updated.text).toContain("Lumiverse's Settings → MCP Servers, Disconnect it and Connect it again");
    // Not yet: Update now reaches it as it does any other server.
    expect(serverLine(client({ harness: "lumiverse", state: "behind", kit: "a1" }), view)).toMatchObject({ update: true, text: "lumirpengine for lumiverse on studio hasn't reloaded this build's tools yet." });
  });
});
