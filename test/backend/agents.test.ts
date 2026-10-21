// The outside MCP servers on the backend (DESIGN §23): what a hello tells an outside client and keeps
// of an MCP server's check-in, how a start under another build is taken for an update, and the
// notice after one: each server's line, Update now, and the line turning once the server reloads.

import { describe, expect, setSystemTime, test } from "bun:test";
import type { BuildInfo } from "../../src/backend/agents";
import type { AgentClientView, AgentsView } from "../../src/shared/agents";
import { Rig } from "../support/rig";

const DIST = "/srv/lumiverse/data/extensions/lumi_rp_engine/repo/dist";
const build = (id: string): BuildInfo => ({ id, kit: { path: `${DIST}/agent-kit.js`, core: `${DIST}/lumirpengine.js`, sha256: "a".repeat(64), api: 1 } });

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
    const claude = String(rig.body(await rig.send({ type: "lre.hello", chatId: null, client: server("lumi-dev", "a1", { harness: "claude-code" }) }, "srv-claude")).client);
    const codex = String(rig.body(await rig.send({ type: "lre.hello", chatId: null, client: server("lumi-dev", "b2", { harness: "codex" }) }, "srv-codex")).client);
    expect(claude).not.toBe(codex);
    let view = rig.body(await rig.send({ type: "lre.agents", op: "get" }, "page-1")).view as AgentsView;
    expect(Object.fromEntries(view.clients.map((c) => [c.harness, [c.id, c.state, c.connected]]))).toEqual({ "claude-code": [claude, "behind", true], codex: [codex, "updated", true] });

    // Claude Code's server restarted (a new process, a new session) on another kit: still its one line, at its latest.
    const again = String(rig.body(await rig.send({ type: "lre.hello", chatId: null, client: server("lumi-dev", "b2", { harness: "claude-code", follows: false, why: { code: "pinned", text: "--pin keeps the installed tools" } }) }, "srv-claude-2")).client);
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
    const onHost = String(rig.body(await rig.send({ type: "lre.hello", chatId: null, client: server("lumi-dev", "b2") }, "srv-host")).client);
    expect(new Set([old, following, onHost]).size).toBe(3);
    const view = rig.body(await rig.send({ type: "lre.agents", op: "get" }, "page-1")).view as AgentsView;
    expect(Object.fromEntries(view.clients.map((c) => [c.id, c.state]))).toEqual({ [old]: "old", [following]: "updated", [onHost]: "updated" });
  });

  test("servers kept under an earlier rule's ids are keyed again as their check-ins say, the latest of any two kept", async () => {
    const rig = new Rig({ build: build("b2") });
    const kept = (host: string | null, kit: string | null, seen: number) => ({ name: "lumirpengine", version: "0.0.1", host, core: kit === null ? null : "c0ffee00", kit, follows: kit !== null, why: null, seen });
    rig.host.files.set(`${rig.host.userId}/agents.json`, JSON.stringify({ v: 1, toasted: null, dismissed: null, clients: { "0000000000000001": kept(null, null, 1), "0000000000000002": kept("lumi-dev", "a1", 2), "0000000000000003": kept("lumi-dev", "b2", 3) } }));
    const old = String(rig.body(await rig.send({ type: "lre.hello", chatId: null, client: { name: "lumirpengine", version: "0.0.1" } }, "srv-old")).client);
    const view = rig.body(await rig.send({ type: "lre.agents", op: "get" }, "page-1")).view as AgentsView;
    expect(view.clients.map((c) => [c.host, c.kit])).toEqual([
      [null, null],
      ["lumi-dev", "b2"],
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
    expect(shown?.view.setup).toEqual({ core: `${DIST}/lumirpengine.js`, command: `node ${DIST}/lumirpengine.js mcp` });
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
