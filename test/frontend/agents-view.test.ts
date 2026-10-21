// The update notice's and Settings → MCP server's words for each MCP server and for the setup that follows (DESIGN §23).

import { describe, expect, test } from "bun:test";
import { serverLine, setupSection } from "../../src/frontend/agents-view";
import type { AgentClientView, AgentsView, LumiverseRunView } from "../../src/shared/agents";
import { followCommands, NPM_INSTALL } from "../../src/shared/agents";

const CORE = "/srv/lumiverse/data/extensions/lumi_rp_engine/repo/dist/lumirpengine.js";
const view: AgentsView = { build: "b2", notice: { build: "b2", previous: "a1", at: 1 }, setup: { core: CORE, commands: followCommands(CORE) }, clients: [] };
const client = (over: Partial<AgentClientView>): AgentClientView => ({ id: "c1", name: "lumirpengine", version: "0.0.1", host: "studio", harness: null, core: "c0", kit: "b2", follows: true, why: null, seen: 1, connected: true, processes: 1, state: "updated", lumiverse: null, ...over });
/** The setup to copy, as every line that offers it does: Bun first, which Lumiverse's machine always has, then Node. */
const SETUP = [
  { label: "Copy the setup for Bun 1.4 or newer", text: `bun ${CORE} mcp` },
  { label: "Copy the setup for Node 22 or newer", text: `node ${CORE} mcp` },
];

describe("each server's line", () => {
  test("reloaded, not yet with Update now, and can't follow with why and what fixes it", () => {
    expect(serverLine(client({}), view)).toEqual({ state: "updated", text: "lumirpengine on studio reloaded this build's tools.", update: false, reconnect: false, copy: [] });
    expect(serverLine(client({ harness: "claude-code" }), view).text).toBe("lumirpengine for claude-code on studio reloaded this build's tools.");
    expect(serverLine(client({ state: "behind", kit: "a1" }), view)).toMatchObject({ update: true, text: "lumirpengine on studio hasn't reloaded this build's tools yet." });
    expect(serverLine(client({ state: "behind", kit: "a1", connected: false }), view).text).toContain("hasn't checked in since LumiRPEngine restarted");
    const elsewhere = serverLine(client({ state: "cannot", kit: "a1", follows: false, why: { code: "elsewhere", text: "LumiRPEngine's tools aren't on this machine" } }), view);
    expect(elsewhere).toMatchObject({ update: false, text: "lumirpengine on studio can't follow LumiRPEngine: LumiRPEngine's tools aren't on this machine.", copy: [{ label: "Copy the install", text: NPM_INSTALL }] });
    expect(serverLine(client({ state: "cannot", kit: "a1", follows: false, why: { code: "unreadable", text: "can't be read here" } }), view).copy).toEqual(SETUP);
    // On a Bun that can't load a kit, the setup that follows is the fix, under a Bun that can or under Node.
    const cannot = "run it with Bun 1.4 or newer, or Node 22 or newer (Bun before 1.4 can't load the kit)";
    expect(serverLine(client({ state: "cannot", kit: "a1", follows: false, why: { code: "runtime", text: cannot } }), view)).toEqual({ state: "cannot", text: `lumirpengine on studio can't follow LumiRPEngine: ${cannot}.`, update: false, reconnect: false, copy: SETUP });
  });

  test("a server from before following gets the one-time install and the setup that follows, Bun first, each to copy", () => {
    const line = serverLine(client({ state: "old", host: null, core: null, kit: null, follows: false }), view);
    expect(line.text).toContain("lumirpengine 0.0.1 is from before MCP servers followed LumiRPEngine");
    expect(line.text).toContain(NPM_INSTALL);
    expect(line.text).toContain(`run the extension's own copy (bun ${CORE} mcp with Bun 1.4 or newer, or node ${CORE} mcp with Node 22 or newer)`);
    expect(line.copy).toEqual([{ label: "Copy the install", text: NPM_INSTALL }, ...SETUP]);
  });

  test("a server running as more than one process says how many", () => {
    expect(serverLine(client({ harness: "claude-code", processes: 2, state: "behind", kit: "a1" }), view).text).toBe("lumirpengine for claude-code on studio (2 processes) hasn't reloaded this build's tools yet.");
    expect(serverLine(client({ harness: "claude-code", processes: 2 }), view).text).toBe("lumirpengine for claude-code on studio (2 processes) reloaded this build's tools.");
    // One, or none heard from lately: nothing to count.
    for (const processes of [0, 1]) expect(serverLine(client({ harness: "claude-code", processes }), view).text).toBe("lumirpengine for claude-code on studio reloaded this build's tools.");
  });
});

describe("a server Lumiverse runs", () => {
  const run = (over: Partial<LumiverseRunView>): AgentClientView => client({ harness: "lumiverse", lumiverse: { stale: 0, unknown: 0, profiles: null, reconnect: null, ...over } });
  const BY_HAND = "Lumiverse's Settings → MCP Servers, Disconnect it and Connect it again";

  test("once it reloads while Lumiverse's client holds the old list, the line offers Reconnect in Lumiverse; without mcp_servers it says Lumiverse's own list can't be checked, and how to grant it", () => {
    const without = serverLine(run({ stale: 1 }), view);
    expect(without).toMatchObject({ state: "updated", update: false, reconnect: true, copy: [] });
    // Says the client holds the old list, that Lumiverse's own list can't be checked, and where the permission is granted.
    expect(without.text).toContain("keeps the list it got when it connected");
    expect(without.text).toContain("can't check Lumiverse's own tool list");
    expect(without.text).toContain("Mcp Servers permission");
    const granted = serverLine(run({ stale: 1, profiles: [{ name: "LumiRPEngine", current: false }] }), view);
    expect(granted.reconnect).toBe(true);
    expect(granted.text).not.toContain("permission");
    // Not yet: Update now reaches it as it does any other server.
    expect(serverLine(client({ harness: "lumiverse", state: "behind", kit: "a1", lumiverse: { stale: 0, unknown: 0, profiles: null, reconnect: null } }), view)).toMatchObject({ update: true, reconnect: false, text: "lumirpengine for lumiverse on studio hasn't reloaded this build's tools yet." });
  });

  test("a process from before Reconnect in Lumiverse, or an old list Spindle shows with no process to ask, keeps today's instruction", () => {
    for (const line of [serverLine(run({ unknown: 1 }), view), serverLine(run({ profiles: [{ name: "LumiRPEngine", current: false }] }), view)]) {
      expect(line).toMatchObject({ reconnect: false, update: false });
      expect(line.text).toStartWith("lumirpengine for lumiverse on studio reloaded this build's tools, but Lumiverse's MCP client keeps its old tool list until the server restarts");
      expect(line.text).toContain(BY_HAND);
    }
  });

  test("while it waits nothing is offered; back, the line reads updated (by Lumiverse's own list with mcp_servers); not back in time, it gives the wait, today's instruction and Reconnect again", () => {
    const waiting = serverLine(run({ stale: 1, reconnect: { state: "waiting", waitMs: 60_000, through: "server" } }), view);
    expect(waiting).toMatchObject({ reconnect: false, update: false, copy: [] });
    expect(waiting.text).toContain("Waiting for it back");
    const current = serverLine(run({ profiles: [{ name: "LumiRPEngine", current: true }] }), view);
    expect(current).toMatchObject({ state: "updated", update: false, reconnect: false, copy: [] });
    expect(current.text).toContain("Lumiverse's MCP client has them");
    const unchecked = serverLine(run({}), view);
    expect(unchecked).toMatchObject({ reconnect: false, update: false });
    expect(unchecked.text).toContain("gave them to Lumiverse's MCP client when it connected");
    expect(unchecked.text).toContain("can't check Lumiverse's own tool list");
    const late = serverLine(run({ stale: 1, reconnect: { state: "late", waitMs: 60_000, through: "lumiverse" } }), view);
    expect(late.reconnect).toBe(true);
    // The wait it was given, and where it is set; then by hand.
    expect(late.text).toContain("within 1 min (Settings → Timeouts → MCP server reconnect)");
    expect(late.text).toContain(BY_HAND);
    expect(serverLine(run({ reconnect: { state: "late", waitMs: null, through: "server" } }), view).text).not.toContain("within");
  });
});

describe("Settings → MCP server's setup", () => {
  test("offers the Bun command first, as the runtime Lumiverse's machine always has, then the Node one, each under the version it needs and copied as shown", () => {
    const { choices, help } = setupSection({ core: CORE, commands: followCommands(CORE) });
    expect(choices.map((c) => [c.label, c.command])).toEqual([
      ["For Bun 1.4 or newer, which Lumiverse itself runs on, so it is always on Lumiverse's machine", `bun ${CORE} mcp`],
      ["For Node 22 or newer", `node ${CORE} mcp`],
    ]);
    // Signed in with the runtime it leads with; and Lumiverse's own MCP Servers take either as the command, the core and mcp as the arguments.
    expect(help).toContain(`claude mcp add lumirpengine -- bun ${CORE} mcp`);
    expect(help).toContain(`Sign in once first: bun ${CORE} login --url <your Lumiverse>.`);
    expect(help).toContain(`add a Stdio server with the command bun or node and the arguments ${CORE}, mcp.`);
  });

  test("a path that needs quoting is one shell word in both commands", () => {
    const core = "/Volumes/Lumi Data/extensions/lumi_rp_engine/repo/dist/lumirpengine.js";
    expect(setupSection({ core, commands: followCommands(core) }).choices.map((c) => c.command)).toEqual([`bun "${core}" mcp`, `node "${core}" mcp`]);
  });
});
