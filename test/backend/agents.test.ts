// The outside MCP servers on the backend (DESIGN §23): what a hello tells an outside client and keeps
// of an MCP server's check-in, how a start under another build is taken for an update, and the
// notice after one: each server's line, Update now, the line turning once the server reloads, and
// Reconnect in Lumiverse for a server Lumiverse runs.

import { describe, expect, setSystemTime, test } from "bun:test";
import type { BuildInfo } from "../../src/backend/agents";
import type { AgentClientView, AgentsView, ListedTool } from "../../src/shared/agents";
import { toolsFingerprint } from "../../src/shared/agents";
import { Rig } from "../support/rig";

const tool = (name: string, description: string): ListedTool => ({ name, description, input_schema: { type: "object", properties: {} } });
/** The tools Lumiverse's client holds for a lumirpengine profile: listed under build a1, and this build's (b2). */
const OLD_TOOLS = [tool("lre_guide", "The guide, as build a1 had it."), tool("lre_status", "Which Lumiverse this is.")];
const NEW_TOOLS = [tool("lre_guide", "The guide, as build b2 has it."), tool("lre_status", "Which Lumiverse this is."), tool("lre_new", "New in b2.")];

const DIST = "/srv/lumiverse/data/extensions/lumi_rp_engine/repo/dist";
const build = (id: string): BuildInfo => ({ id, kit: { path: `${DIST}/agent-kit.js`, core: `${DIST}/lumirpengine.js`, sha256: "a".repeat(64), api: 1 }, tools: [toolsFingerprint(NEW_TOOLS)] });

/** An MCP server's hello `client` as lumirpengine sends it: on `host`, with `kit` loaded. */
const server = (host: string, kit: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({ name: "lumirpengine", version: "0.0.1", serves: "mcp", core: "c0ffee00", kit, follows: true, why: null, host, ...more });

/** The servers' views pushed since `from`, each with the session it went to (none: every session of the user). */
function pushed(rig: Rig, from = 0): { view: AgentsView; session?: string }[] {
  const out: { view: AgentsView; session?: string }[] = [];
  rig.host.sent.forEach((m, i) => {
    const session = rig.host.sentTo[i]?.session;
    if (i >= from && m.type === "lre.agents.changed") out.push({ view: m.view, ...(session !== undefined ? { session } : {}) });
  });
  return out;
}

const byHost = (view: AgentsView | undefined): Record<string, AgentClientView> => Object.fromEntries((view?.clients ?? []).map((c) => [c.host ?? "(none)", c]));

const page = (rig: Rig, session = "page-1") => rig.send({ type: "lre.hello", chatId: null }, session);

describe("a start under another build", () => {
  test("is no update on the first run or under the same build; a new build is one until the user dismisses it, toasted once, and the next update brings it back", async () => {
    let rig = new Rig({ build: build("a1") });
    await page(rig);
    expect(pushed(rig)).toEqual([]);
    expect(JSON.parse(rig.host.extensionFiles.get("agents/build.json") ?? "null")).toMatchObject({ build: "a1", previous: null });
    rig = rig.restart({ build: build("a1") });
    await page(rig);
    expect(pushed(rig)).toEqual([]);
    expect(rig.host.toasts).toEqual([]);

    rig = rig.restart({ build: build("b2") });
    let from = rig.host.sent.length;
    await page(rig);
    expect(pushed(rig, from)).toEqual([{ view: expect.objectContaining({ build: "b2", notice: { build: "b2", previous: "a1", at: expect.any(Number) } }), session: "page-1" }]);
    expect(rig.host.toasts).toEqual([{ message: "Updated to build b2.", userId: rig.host.userId }]);
    // Another page, a reload, a restart under the same build: the notice again, the toast not.
    await page(rig, "page-2");
    rig = rig.restart({ build: build("b2") });
    from = rig.host.sent.length;
    await page(rig);
    expect(pushed(rig, from).map((p) => p.view.notice?.build)).toEqual(["b2"]);
    expect(rig.host.toasts).toHaveLength(1);

    // Dismissed: every page is told, and no page hello shows it again.
    from = rig.host.sent.length;
    const dismissed = rig.body(await rig.send({ type: "lre.agents", op: "dismiss" }, "page-1"));
    expect((dismissed.view as AgentsView).notice).toBeNull();
    expect(pushed(rig, from)).toEqual([{ view: expect.objectContaining({ notice: null }) }]);
    from = rig.host.sent.length;
    await page(rig);
    expect(pushed(rig, from)).toEqual([]);

    rig = rig.restart({ build: build("c3") });
    from = rig.host.sent.length;
    await page(rig);
    expect(pushed(rig, from).map((p) => p.view.notice)).toEqual([{ build: "c3", previous: "b2", at: expect.any(Number) }]);
    expect(rig.host.toasts).toHaveLength(2);
  });
});

describe("check-ins", () => {
  test("an MCP server's hello learns the build and its kit, and its check-in is kept with when it was seen; a command-line run's is not", async () => {
    const rig = new Rig({ build: build("b2") });
    const hello = rig.body(await rig.send({ type: "lre.hello", chatId: null, client: server("mac-mini", "b2") }, "srv-1"));
    const id = String(hello.client);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(hello).toMatchObject({ accepted: true, build: "b2", kit: build("b2").kit });
    const stored = (): Record<string, unknown> => JSON.parse(rig.host.files.get(`${rig.host.userId}/agents.json`) ?? "{}").clients;
    expect(stored()).toEqual({ [id]: { name: "lumirpengine", version: "0.0.1", host: "mac-mini", harness: null, core: "c0ffee00", kit: "b2", follows: true, why: null, seen: expect.any(Number) } });

    // A run of the command line names itself and learns the build, and keeps nothing.
    const run = rig.body(await rig.send({ type: "lre.hello", chatId: null, client: { name: "lumirpengine", version: "0.0.1", serves: "command" } }, "cli-1"));
    expect(run).toMatchObject({ build: "b2", kit: build("b2").kit });
    expect(run.client).toBeUndefined();
    expect(Object.keys(stored())).toEqual([id]);

    // The same server again, after a restart of it or from another process: one entry, at its latest.
    await rig.send({ type: "lre.hello", chatId: null, client: server("mac-mini", "b2", { follows: false, why: { code: "pinned", text: "--pin keeps the tools this lumirpengine was installed with" } }) }, "srv-2");
    expect(Object.values(stored())).toEqual([expect.objectContaining({ follows: false, why: { code: "pinned", text: "--pin keeps the tools this lumirpengine was installed with" } })]);

    // A server's own check is known on a session it checked in on, and not on one the extension never heard from (as after it restarts).
    expect(rig.body(await rig.send({ type: "lre.agents", op: "kit" }, "srv-1"))).toEqual({ build: "b2", kit: build("b2").kit, known: true });
    expect(rig.body(await rig.send({ type: "lre.agents", op: "kit" }, "srv-9")).known).toBe(false);
    expect(rig.body(await rig.restart({ build: build("b2") }).send({ type: "lre.agents", op: "kit" }, "srv-1")).known).toBe(false);
  });

  test("a server is its name, machine and harness: two harnesses on one machine are two lines, each with its own state, and the same harness restarted stays one", async () => {
    const rig = new Rig({ build: build("b2") });
    const stored = (): Record<string, { harness: string | null; kit: string | null; follows: boolean }> => JSON.parse(rig.host.files.get(`${rig.host.userId}/agents.json`) ?? "{}").clients;
    const claude = String(rig.body(await rig.send({ type: "lre.hello", chatId: null, client: server("devbox", "a1", { harness: "claude-code" }) }, "srv-claude")).client);
    const codex = String(rig.body(await rig.send({ type: "lre.hello", chatId: null, client: server("devbox", "b2", { harness: "codex" }) }, "srv-codex")).client);
    expect(claude).not.toBe(codex);
    let view = rig.body(await rig.send({ type: "lre.agents", op: "get" }, "page-1")).view as AgentsView;
    expect(Object.fromEntries(view.clients.map((c) => [c.harness, [c.id, c.state, c.connected]]))).toEqual({ "claude-code": [claude, "behind", true], codex: [codex, "updated", true] });

    // Claude Code's server restarted (a new process, a new session) on another kit: still its one line, at its latest.
    const again = String(rig.body(await rig.send({ type: "lre.hello", chatId: null, client: server("devbox", "b2", { harness: "claude-code", follows: false, why: { code: "pinned", text: "--pin keeps the installed tools" } }) }, "srv-claude-2")).client);
    expect(again).toBe(claude);
    expect(Object.keys(stored()).sort()).toEqual([claude, codex].sort());
    expect(stored()[claude]).toMatchObject({ harness: "claude-code", kit: "b2", follows: false });
    expect(stored()[codex]).toMatchObject({ harness: "codex", kit: "b2", follows: true });
    view = rig.body(await rig.send({ type: "lre.agents", op: "get" }, "page-1")).view as AgentsView;
    expect(view.clients.map((c) => c.id).sort()).toEqual([claude, codex].sort());
  });

  test("a server from before check-ins never shares a line with one that follows, even one that names no machine", async () => {
    const rig = new Rig({ build: build("b2") });
    const old = String(rig.body(await rig.send({ type: "lre.hello", chatId: null, client: { name: "lumirpengine", version: "0.0.1" } }, "srv-old")).client);
    // An empty host name is no machine: the rule before this one keyed such a server as it keyed one from before check-ins.
    const following = String(rig.body(await rig.send({ type: "lre.hello", chatId: null, client: server("", "b2") }, "srv-new")).client);
    const onHost = String(rig.body(await rig.send({ type: "lre.hello", chatId: null, client: server("devbox", "b2") }, "srv-host")).client);
    expect(new Set([old, following, onHost]).size).toBe(3);
    const view = rig.body(await rig.send({ type: "lre.agents", op: "get" }, "page-1")).view as AgentsView;
    expect(Object.fromEntries(view.clients.map((c) => [c.id, c.state]))).toEqual({ [old]: "old", [following]: "updated", [onHost]: "updated" });
  });

  test("servers kept under an earlier rule's ids are keyed again as their check-ins say, the latest of any two kept", async () => {
    const rig = new Rig({ build: build("b2") });
    const kept = (host: string | null, kit: string | null, seen: number) => ({ name: "lumirpengine", version: "0.0.1", host, core: kit === null ? null : "c0ffee00", kit, follows: kit !== null, why: null, seen });
    rig.host.files.set(`${rig.host.userId}/agents.json`, JSON.stringify({ v: 1, toasted: null, dismissed: null, clients: { "0000000000000001": kept(null, null, 1), "0000000000000002": kept("devbox", "a1", 2), "0000000000000003": kept("devbox", "b2", 3) } }));
    const old = String(rig.body(await rig.send({ type: "lre.hello", chatId: null, client: { name: "lumirpengine", version: "0.0.1" } }, "srv-old")).client);
    const view = rig.body(await rig.send({ type: "lre.agents", op: "get" }, "page-1")).view as AgentsView;
    expect(view.clients.map((c) => [c.host, c.kit])).toEqual([
      [null, null],
      ["devbox", "b2"],
    ]);
    expect(view.clients[0]?.id).toBe(old);
  });
});

describe("a server's processes", () => {
  test("a server stands as its process furthest behind, says how many it has, and drops one not heard from for two minutes", async () => {
    let now = Date.UTC(2026, 9, 20, 12);
    const later = (ms: number): void => {
      now += ms;
      setSystemTime(new Date(now));
    };
    later(0);
    try {
      const rig = new Rig({ build: build("b2") });
      const hello = async (session: string, kit: string): Promise<string> => String(rig.body(await rig.send({ type: "lre.hello", chatId: null, client: server("studio", kit, { harness: "claude-code" }) }, session)).client);
      const look = (session: string) => rig.send({ type: "lre.agents", op: "kit" }, session);
      const lines = async () => (rig.body(await rig.send({ type: "lre.agents", op: "get" }, "page-1")).view as AgentsView).clients.map((c) => ({ id: c.id, state: c.state, kit: c.kit, processes: c.processes }));

      // Two windows of Claude Code on one machine: the one that lags checked in first, the one that reloaded last. One lagging is not updated.
      const id = await hello("srv-a", "a1");
      expect(await hello("srv-b", "b2")).toBe(id);
      expect(await lines()).toEqual([{ id, state: "behind", kit: "a1", processes: 2 }]);
      // Both reloaded: updated.
      await hello("srv-a", "b2");
      expect(await lines()).toEqual([{ id, state: "updated", kit: "b2", processes: 2 }]);

      // A third process checks in on the old build and goes quiet (hung, or its machine asleep), while the others look every minute.
      await hello("srv-c", "a1");
      expect(await lines()).toEqual([{ id, state: "behind", kit: "a1", processes: 3 }]);
      for (const step of [61_000, 61_000]) {
        later(step);
        await look("srv-a");
        await look("srv-b");
      }
      // Unheard for two minutes, its socket still open: it no longer says how its server stands.
      expect(await lines()).toEqual([{ id, state: "updated", kit: "b2", processes: 2 }]);
      // Heard from again, it counts again, and the pages are told.
      const from = rig.host.sent.length;
      await look("srv-c");
      expect(pushed(rig, from).at(-1)?.view.clients.map((c) => [c.state, c.processes])).toEqual([["behind", 3]]);
      // Its socket closes: it is gone at once.
      rig.host.closeSession("srv-c");
      await rig.host.settle();
      expect(await lines()).toEqual([{ id, state: "updated", kit: "b2", processes: 2 }]);
    } finally {
      setSystemTime();
    }
  });

  /** Two processes of one harness checked in on build a1, then the extension restarted as b2 (an update): the processes are what the user's file kept. */
  async function updated(later: (ms: number) => void) {
    const before = new Rig({ build: build("a1") });
    const hello = async (rig: Rig, session: string, kit: string): Promise<string> => String(rig.body(await rig.send({ type: "lre.hello", chatId: null, client: server("studio", kit, { harness: "claude-code" }) }, session)).client);
    const id = await hello(before, "srv-a", "a1");
    await hello(before, "srv-b", "a1");
    later(30_000);
    await before.send({ type: "lre.agents", op: "kit" }, "srv-a");
    await before.send({ type: "lre.agents", op: "kit" }, "srv-b");
    await before.host.settle();
    const kept = (): Record<string, { seen: number }> => JSON.parse(before.host.files.get(`${before.host.userId}/agents.json`) ?? "{}").processes ?? {};
    expect(Object.keys(kept()).sort()).toEqual(["srv-a", "srv-b"]);
    later(5_000);
    const rig = before.restart({ build: build("b2") });
    const lines = async () => (rig.body(await rig.send({ type: "lre.agents", op: "get" }, "page-1")).view as AgentsView).clients.map((c) => ({ id: c.id, state: c.state, processes: c.processes, connected: c.connected }));
    return { rig, id, kept, lines, hello: (session: string, kit: string) => hello(rig, session, kit) };
  }

  const clock = () => {
    let now = Date.UTC(2026, 9, 20, 12);
    const later = (ms: number): void => {
      now += ms;
      setSystemTime(new Date(now));
    };
    later(0);
    return later;
  };

  test("after a restart, a server's processes from before it still count: not yet (2 processes) until both have said hello on the new build, and neither is connected or known until it does", async () => {
    const later = clock();
    try {
      const { rig, id, lines, hello } = await updated(later);
      expect(await lines()).toEqual([{ id, state: "behind", processes: 2, connected: false }]);
      // Restored is not known: the process's look says hello again.
      expect(rig.body(await rig.send({ type: "lre.agents", op: "kit" }, "srv-a")).known).toBe(false);
      // One reloads: the other, from before the restart, still lags.
      await hello("srv-b", "b2");
      expect(await lines()).toEqual([{ id, state: "behind", processes: 2, connected: true }]);
      // It says hello on the old build first, then reloads: only then is the server updated.
      await hello("srv-a", "a1");
      expect(await lines()).toEqual([{ id, state: "behind", processes: 2, connected: true }]);
      await hello("srv-a", "b2");
      expect(await lines()).toEqual([{ id, state: "updated", processes: 2, connected: true }]);
    } finally {
      setSystemTime();
    }
  });

  test("a process from before a restart that never comes back ages out after two minutes, from the line and from the file", async () => {
    const later = clock();
    try {
      const { rig, id, kept, lines, hello } = await updated(later);
      await hello("srv-b", "b2");
      expect(await lines()).toEqual([{ id, state: "behind", processes: 2, connected: true }]);
      // srv-b looks every minute; srv-a was last heard 35 s before the restart and never again.
      later(61_000);
      await rig.send({ type: "lre.agents", op: "kit" }, "srv-b");
      expect(await lines()).toEqual([{ id, state: "behind", processes: 2, connected: true }]);
      later(60_000);
      await rig.send({ type: "lre.agents", op: "kit" }, "srv-b");
      await rig.host.settle();
      expect(await lines()).toEqual([{ id, state: "updated", processes: 1, connected: true }]);
      expect(Object.keys(kept())).toEqual(["srv-b"]);
    } finally {
      setSystemTime();
    }
  });

  test("a process from before a restart whose session closes drops out at once", async () => {
    const later = clock();
    try {
      const { rig, id, kept, lines, hello } = await updated(later);
      await hello("srv-b", "b2");
      expect(await lines()).toEqual([{ id, state: "behind", processes: 2, connected: true }]);
      rig.host.closeSession("srv-a");
      await rig.host.settle();
      expect(await lines()).toEqual([{ id, state: "updated", processes: 1, connected: true }]);
      expect(Object.keys(kept())).toEqual(["srv-b"]);
    } finally {
      setSystemTime();
    }
  });
});

describe("the update notice", () => {
  test("lists each server as it stands; Update now asks the one named to reload, and its line turns once it checks in", async () => {
    let rig = new Rig({ build: build("a1") });
    await rig.send({ type: "lre.hello", chatId: null, client: server("studio", "a1") }, "srv-studio");
    await rig.send({ type: "lre.hello", chatId: null, client: server("laptop", "a1", { follows: false, why: { code: "elsewhere", text: "LumiRPEngine's tools aren't on this machine" } }) }, "srv-laptop");
    // From before check-ins: a name and a version, nothing else.
    await rig.send({ type: "lre.hello", chatId: null, client: { name: "lumirpengine", version: "0.0.1" } }, "srv-old");

    rig = rig.restart({ build: build("b2") });
    // One that took the new build by itself already.
    await rig.send({ type: "lre.hello", chatId: null, client: server("mini", "b2") }, "srv-mini");
    let from = rig.host.sent.length;
    await page(rig);
    const [shown] = pushed(rig, from);
    expect(shown?.view.notice).toMatchObject({ build: "b2", previous: "a1" });
    const lines = byHost(shown?.view);
    expect(Object.fromEntries(Object.entries(lines).map(([host, c]) => [host, c.state]))).toEqual({ mini: "updated", studio: "behind", laptop: "cannot", "(none)": "old" });
    expect(lines.laptop?.why).toEqual({ code: "elsewhere", text: "LumiRPEngine's tools aren't on this machine" });
    // Since the restart only mini has said anything: the others' sessions aren't known to be open.
    expect(Object.fromEntries(Object.entries(lines).map(([host, c]) => [host, c.connected]))).toEqual({ mini: true, studio: false, laptop: false, "(none)": false });
    // The setup that follows runs the extension's own core: under Bun first, which Lumiverse's machine always has, then Node.
    expect(shown?.view.setup?.core).toBe(`${DIST}/lumirpengine.js`);
    expect(shown?.view.setup?.commands.map((c) => c.command)).toEqual([`bun ${DIST}/lumirpengine.js mcp`, `node ${DIST}/lumirpengine.js mcp`]);
    expect(rig.host.toasts.at(-1)?.message).toBe("Updated to build b2. The drawer says how each of your MCP servers took it.");

    // Update now: sent to every session of the user, so it reaches a server the restarted extension hasn't heard from yet.
    const studio = lines.studio?.id ?? "";
    from = rig.host.sent.length;
    await rig.send({ type: "lre.agents", op: "update", client: studio }, "page-1");
    const relayed = rig.host.sent.findIndex((m, i) => i >= from && m.type === "lre.kit.reload");
    expect(rig.host.sent[relayed]).toEqual({ lre: 1, type: "lre.kit.reload", client: studio });
    expect(rig.host.sentTo[relayed]).toEqual({ userId: rig.host.userId });

    // The server reloads and checks in on its session: every page gets its line as updated.
    from = rig.host.sent.length;
    await rig.send({ type: "lre.hello", chatId: null, client: server("studio", "b2") }, "srv-studio");
    const told = pushed(rig, from).at(-1);
    expect(told?.session).toBeUndefined();
    expect(byHost(told?.view).studio).toMatchObject({ id: studio, state: "updated", kit: "b2", connected: true });

    // Its socket closes: the pages are told it isn't connected any more.
    from = rig.host.sent.length;
    rig.host.closeSession("srv-studio");
    await rig.host.settle();
    expect(byHost(pushed(rig, from).at(-1)?.view).studio).toMatchObject({ state: "updated", connected: false });

    // Forget drops a server from the list.
    const forgotten = rig.body(await rig.send({ type: "lre.agents", op: "forget", client: lines["(none)"]?.id ?? "" }, "page-1"));
    expect((forgotten.view as AgentsView).clients.map((c) => c.host)).not.toContain(null);
  });
});

describe("a server Lumiverse runs (Reconnect in Lumiverse)", () => {
  /** A Lumiverse-run process that reloaded b2's kit while its client (Lumiverse's, which never lists again) holds a1's tools. */
  const stale = server("studio", "b2", { harness: "lumiverse", core: "a1", listed: "a1" });
  /** A process Lumiverse started on b2: its client listed b2's tools (null: before it asked). */
  const fresh = (listed: string | null) => server("studio", "b2", { harness: "lumiverse", core: "b2", listed });
  const hello = async (rig: Rig, session: string, client: Record<string, unknown>): Promise<string> => String(rig.body(await rig.send({ type: "lre.hello", chatId: null, client }, session)).client);
  const lumiverseLine = (view: AgentsView | undefined): AgentClientView | undefined => view?.clients.find((c) => c.harness === "lumiverse");
  const get = async (rig: Rig): Promise<AgentsView> => rig.body(await rig.send({ type: "lre.agents", op: "get" }, "page-1")).view as AgentsView;
  const press = async (rig: Rig, id: string): Promise<AgentsView> => rig.body(await rig.send({ type: "lre.agents", op: "reconnect", client: id }, "page-1")).view as AgentsView;
  /** Each Reconnect in Lumiverse sent since `from`: the server named and the one session it went to. */
  const asked = (rig: Rig, from: number) => rig.host.sent.flatMap((m, i) => (i >= from && m.type === "lre.kit.reconnect" ? [{ client: m.client, session: rig.host.sentTo[i]?.session }] : []));
  /** Lumiverse's profiles: lumirpengine's (holding `tools`), another stdio server's, a remote one that lists the same names, and one Lumiverse isn't connected to. */
  const profiles = (rig: Rig, tools: ListedTool[]): void => {
    rig.host.mcpProfiles.push(
      { id: "p-lre", name: "LumiRPEngine", transport: "stdio", connected: true, tools },
      { id: "p-diary", name: "Private diary", transport: "stdio", connected: true, tools: [tool("diary_read", "Reads the user's diary.")] },
      { id: "p-remote", name: "Remote copy", transport: "streamable_http", connected: true, tools: NEW_TOOLS },
      { id: "p-off", name: "Switched off", transport: "stdio", connected: false, tools: [] },
    );
  };

  test("with mcp_servers, its line names the profiles whose Lumiverse client holds lumirpengine's tools, by those tools alone, and whether that list is this build's; nothing of another profile is shown", async () => {
    const rig = new Rig({ build: build("b2") });
    rig.host.mcpGranted = true;
    profiles(rig, OLD_TOOLS);
    await hello(rig, "srv-lv", stale);
    await hello(rig, "srv-cc", server("studio", "b2", { harness: "claude-code", core: "a1", listed: "a1" }));
    let view = await get(rig);
    expect(lumiverseLine(view)?.lumiverse).toEqual({ stale: 1, unknown: 0, profiles: [{ name: "LumiRPEngine", current: false }], reconnect: null });
    // Another harness's line isn't Lumiverse's: Claude Code lists its tools again by itself.
    expect(view.clients.find((c) => c.harness === "claude-code")?.lumiverse).toBeNull();
    for (const other of ["Private diary", "Remote copy", "Switched off", "diary_read"]) expect(JSON.stringify(view)).not.toContain(other);
    // Spindle was only asked for the list and the stdio profiles' status: the remote one was never read.
    expect([...new Set(rig.host.mcpReads)].sort()).toEqual(["list", "status p-diary", "status p-lre", "status p-off"]);
    // Lumiverse holds this build's tools: the profile reads current.
    const lre = rig.host.mcpProfiles.find((p) => p.id === "p-lre");
    if (lre) lre.tools = NEW_TOOLS;
    view = await get(rig);
    expect(lumiverseLine(view)?.lumiverse?.profiles).toEqual([{ name: "LumiRPEngine", current: true }]);
  });

  test("without mcp_servers, Spindle is never asked and the line says only what the server's processes do; a process from before Reconnect in Lumiverse counts as unknown", async () => {
    const rig = new Rig({ build: build("b2") });
    profiles(rig, OLD_TOOLS);
    await hello(rig, "srv-old", server("studio", "b2", { harness: "lumiverse", core: "a1" }));
    const view = await get(rig);
    expect(lumiverseLine(view)?.lumiverse).toEqual({ stale: 0, unknown: 1, profiles: null, reconnect: null });
    expect(rig.host.mcpReads).toEqual([]);
  });

  test("pressed with mcp_servers: only the Lumiverse-run process holding an old list is asked, on its own session; the line waits until Spindle shows Lumiverse holding this build's tools", async () => {
    const rig = new Rig({ build: build("b2") });
    rig.host.mcpGranted = true;
    profiles(rig, OLD_TOOLS);
    const id = await hello(rig, "srv-lv", stale);
    // Another process of the same line whose client listed this build, and Claude Code's server on the same machine, aren't asked.
    await hello(rig, "srv-lv-ok", fresh("b2"));
    await hello(rig, "srv-cc", server("studio", "b2", { harness: "claude-code", core: "a1", listed: "a1" }));
    const from = rig.host.sent.length;
    let view = await press(rig, id);
    expect(asked(rig, from)).toEqual([{ client: id, session: "srv-lv" }]);
    expect(lumiverseLine(view)?.lumiverse?.reconnect).toEqual({ state: "waiting", waitMs: 60_000, through: "lumiverse" });
    // It exits; until Lumiverse holds the new list, the line still waits.
    rig.host.closeSession("srv-lv");
    await rig.host.settle();
    expect(lumiverseLine(await get(rig))?.lumiverse?.reconnect?.state).toBe("waiting");
    // Lumiverse connects it again: a new process, whose tools Lumiverse's client lists on connecting.
    const lre = rig.host.mcpProfiles.find((p) => p.id === "p-lre");
    if (lre) lre.tools = NEW_TOOLS;
    await hello(rig, "srv-lv-2", fresh(null));
    await hello(rig, "srv-lv-2", fresh("b2"));
    await rig.host.settle();
    view = pushed(rig, from).at(-1)?.view ?? (await get(rig));
    expect(lumiverseLine(view)?.lumiverse).toEqual({ stale: 0, unknown: 0, profiles: [{ name: "LumiRPEngine", current: true }], reconnect: null });
    // Reading and reconnecting is all it did: Spindle was asked for the list and statuses, nothing else.
    expect(rig.host.mcpReads.every((r) => r === "list" || r.startsWith("status "))).toBe(true);
  });

  test("pressed without mcp_servers: back is the asked process gone and a new one having listed this build's tools", async () => {
    const rig = new Rig({ build: build("b2") });
    const id = await hello(rig, "srv-lv", stale);
    const from = rig.host.sent.length;
    const view = await press(rig, id);
    expect(asked(rig, from)).toEqual([{ client: id, session: "srv-lv" }]);
    expect(lumiverseLine(view)?.lumiverse?.reconnect).toEqual({ state: "waiting", waitMs: 60_000, through: "server" });
    rig.host.closeSession("srv-lv");
    await hello(rig, "srv-lv-2", fresh(null));
    await rig.host.settle();
    expect(lumiverseLine(await get(rig))?.lumiverse?.reconnect?.state).toBe("waiting");
    await hello(rig, "srv-lv-2", fresh("b2"));
    await rig.host.settle();
    expect(lumiverseLine(await get(rig))?.lumiverse).toEqual({ stale: 0, unknown: 0, profiles: null, reconnect: null });
    expect(rig.host.mcpReads).toEqual([]);
  });

  test("not back within the user's wait, the line says so; pressed again it waits again; with no limit it never gives up", async () => {
    let now = Date.UTC(2026, 9, 21, 12);
    const later = (ms: number): void => {
      now += ms;
      setSystemTime(new Date(now));
    };
    later(0);
    try {
      const rig = new Rig({ build: build("b2") });
      await rig.rt.settings.set(rig.host.userId, { timeouts: { mcpReconnectMs: 5_000 } });
      const id = await hello(rig, "srv-lv", stale);
      expect(lumiverseLine(await press(rig, id))?.lumiverse?.reconnect).toEqual({ state: "waiting", waitMs: 5_000, through: "server" });
      later(5_001);
      expect(lumiverseLine(await get(rig))?.lumiverse?.reconnect?.state).toBe("late");
      expect(lumiverseLine(await press(rig, id))?.lumiverse?.reconnect?.state).toBe("waiting");
      await rig.rt.settings.set(rig.host.userId, { timeouts: { mcpReconnectMs: "none" } });
      expect(lumiverseLine(await press(rig, id))?.lumiverse?.reconnect).toEqual({ state: "waiting", waitMs: null, through: "server" });
      later(10 * 86_400_000);
      expect(lumiverseLine(await get(rig))?.lumiverse?.reconnect?.state).toBe("waiting");
      // Back at last: the line no longer waits.
      rig.host.closeSession("srv-lv");
      await hello(rig, "srv-lv-2", fresh("b2"));
      await rig.host.settle();
      expect(lumiverseLine(await get(rig))?.lumiverse?.reconnect).toBeNull();
    } finally {
      setSystemTime();
    }
  });

  test("pressed when no process holds an old list, nothing is asked", async () => {
    const rig = new Rig({ build: build("b2") });
    const id = await hello(rig, "srv-lv", fresh("b2"));
    const from = rig.host.sent.length;
    expect(lumiverseLine(await press(rig, id))?.lumiverse?.reconnect).toBeNull();
    expect(asked(rig, from)).toEqual([]);
  });
});
