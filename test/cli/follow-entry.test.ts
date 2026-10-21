// Following the extension's kit through the real entry (src/cli/main.ts) as a harness runs it:
// `lumirpengine mcp` under this Bun, on stdio, signed in to a local fake Lumiverse that reports a
// kit laid out as an installed extension's. The entry's own disk (Node's fs: symlinks resolved,
// owners as the files say) decides what it loads.

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runtimeCannotFollow } from "../../src/cli/version";
import type { KitReport } from "../../src/shared/agents";
import { isRecord } from "../../src/shared/json";
import { AGENT_API } from "../../src/shared/protocol";
import { distOf, writeKit } from "../support/kits";

const ROOT = resolve(import.meta.dir, "../..");
const TOKEN = "tok_follow_entry_7b1d";

type Message = Record<string, unknown>;

/** Messages as they come: the first that matches, come already or still to come. Once closed, a wait for one that never came fails, saying why. */
class Inbox {
  readonly got: Message[] = [];
  private readonly waiting = new Set<{ match(m: Message): boolean; resolve(m: Message): void; reject(error: Error): void }>();
  private closed: string | null = null;

  push(message: Message): void {
    this.got.push(message);
    for (const w of this.waiting) {
      if (!w.match(message)) continue;
      this.waiting.delete(w);
      w.resolve(message);
    }
  }

  close(why: string): void {
    this.closed = why;
    for (const w of this.waiting) w.reject(new Error(why));
    this.waiting.clear();
  }

  next(match: (m: Message) => boolean): Promise<Message> {
    const found = this.got.find(match);
    if (found) return Promise.resolve(found);
    if (this.closed !== null) return Promise.reject(new Error(this.closed));
    const { promise, resolve: take, reject } = Promise.withResolvers<Message>();
    this.waiting.add({ match, resolve: take, reject });
    return promise;
  }
}

/** What the fake LumiRPEngine reports, and the check-ins of the server running now. */
const lre: { build: string; kit: KitReport | null; checkIns: Inbox } = { build: "dev", kit: null, checkIns: new Inbox() };

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/api/ws") return url.searchParams.get("ticket") === "t1" && srv.upgrade(req) ? undefined : new Response("no", { status: 400 });
    if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (url.pathname === "/api/v1/spindle") return Response.json({ extensions: [{ id: "ext1", identifier: "lumi_rp_engine", enabled: true, status: "running", version: "0.0.1" }] });
    if (url.pathname === "/api/v1/ws-ticket") return Response.json({ ticket: "t1" });
    return new Response("no", { status: 404 });
  },
  websocket: {
    open(ws) {
      ws.send(JSON.stringify({ event: "CONNECTED", payload: {} }));
    },
    message(ws, raw) {
      const frame: unknown = JSON.parse(String(raw));
      if (!isRecord(frame) || !isRecord(frame.payload)) return;
      const payload = frame.payload;
      const reply = (body: Message): void => {
        ws.send(JSON.stringify({ event: "SPINDLE_FRONTEND_MSG", payload: { extensionId: "ext1", data: { lre: 1, type: "lre.result", reqId: payload.reqId, request: payload.type, body } } }));
      };
      if (payload.type === "lre.hello") {
        if (isRecord(payload.client)) lre.checkIns.push(payload.client);
        reply({ accepted: true, agentApi: AGENT_API, build: lre.build, kit: lre.kit, client: "c0ffee0000000002" });
      } else if (payload.type === "lre.agents" && payload.op === "kit") reply({ build: lre.build, kit: lre.kit, known: true });
    },
  },
});
const base = `http://127.0.0.1:${server.port}`;
const root = mkdtempSync(join(tmpdir(), "lre-follow-entry-"));
const home = join(root, "home");
mkdirSync(join(home, "config/lumirpengine"), { recursive: true, mode: 0o700 });
writeFileSync(join(home, "config/lumirpengine/credentials.json"), JSON.stringify({ lumirpengine: 1, hosts: { [base]: { username: "tom", token: TOKEN, savedAt: 1 } } }), { mode: 0o600 });

const running = new Set<Subprocess>();
afterEach(() => {
  for (const proc of running) proc.kill();
  running.clear();
});
afterAll(() => {
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

/** `lumirpengine mcp` as a harness starts it: requests on its stdin, its answers and notifications read off its stdout. */
function harness() {
  lre.checkIns = new Inbox();
  const proc = Bun.spawn(["bun", join(ROOT, "src/cli/main.ts"), "mcp"], { env: { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: join(home, "config") }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  running.add(proc);
  const out = new Inbox();
  const checkIns = lre.checkIns;
  const err = new Response(proc.stderr).text();
  void (async () => {
    const decoder = new TextDecoder();
    let held = "";
    for await (const chunk of proc.stdout) {
      held += decoder.decode(chunk, { stream: true });
      for (let end = held.indexOf("\n"); end >= 0; end = held.indexOf("\n")) {
        const line = held.slice(0, end).trim();
        held = held.slice(end + 1);
        if (line !== "") out.push(JSON.parse(line) as Message);
      }
    }
    // It exited: nothing more is coming, and what it said on stderr says why.
    const why = `lumirpengine mcp exited: ${await err}`;
    out.close(why);
    checkIns.close(why);
  })();
  let id = 0;
  const ask = async (method: string, params?: Message): Promise<Message> => {
    const asked = ++id;
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: asked, method, ...(params ? { params } : {}) })}\n`);
    proc.stdin.flush();
    const reply = await out.next((m) => m.id === asked);
    return isRecord(reply.result) ? reply.result : {};
  };
  return {
    out,
    checkIns,
    ask,
    start: () => ask("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "entry-harness", version: "1" } }),
    tools: async (): Promise<string[]> => ((await ask("tools/list")).tools as { name: string }[]).map((t) => t.name),
    /** Ends its stdin, as a harness that stops it does: its stderr, once it has exited. */
    stop: async (): Promise<string> => {
      proc.stdin.end();
      await proc.exited;
      running.delete(proc);
      return await err;
    },
  };
}

/** The Bun the entry runs under, as a harness that runs `bun …` gets it, and why it can't follow there (before 1.4), if it can't. */
const BUN = Bun.spawnSync(["bun", "--version"], { env: { PATH: process.env.PATH ?? "" } }).stdout.toString().trim();
const CANNOT = runtimeCannotFollow(BUN);

describe("lumirpengine mcp, the real entry", () => {
  // On a Bun that can't follow at all there is nothing to refuse: the test below covers it.
  test.skipIf(CANNOT !== null)("refuses a kit other users can change, or one whose real path isn't an installed extension's, says why, and serves its own tools", async () => {
    // repo/ writable by everyone: anyone could put another kit in its place.
    const shared = writeKit(distOf(root, "shared"), "b8", ["lre_planted"]);
    const repo = dirname(distOf(root, "shared"));
    chmodSync(repo, 0o777);
    // Laid out as the extension's kit, but a link to a file elsewhere.
    const elsewhere = writeKit(join(root, "downloads"), "b8", ["lre_planted"]);
    mkdirSync(distOf(root, "linked"), { recursive: true, mode: 0o755 });
    const link = join(distOf(root, "linked"), "agent-kit.js");
    symlinkSync(elsewhere.path, link);
    const cases: [string, KitReport, string, string][] = [
      ["a directory others can write", shared, "unsafe", `${realpathSync(repo)} can be changed by other users`],
      ["a link out of the layout", { ...elsewhere, path: link }, "refused", `whose real path ${realpathSync(elsewhere.path)} isn't where Lumiverse installs an extension's kit`],
    ];
    for (const [label, report, code, said] of cases) {
      lre.build = "b8";
      lre.kit = report;
      const s = harness();
      await s.start();
      // Refused, it checks in again saying why; loaded, it would tell its client the tools changed.
      const first = await Promise.race([s.checkIns.next((c) => c.follows === false), s.out.next((m) => m.method === "notifications/tools/list_changed")]);
      expect([label, first]).toEqual([label, expect.objectContaining({ serves: "mcp", kit: "dev", harness: "entry-harness", follows: false, why: { code, text: expect.stringContaining(said) } })]);
      const tools = await s.tools();
      expect([label, tools.includes("lre_guide"), tools.includes("lre_planted")]).toEqual([label, true, false]);
      expect([label, await s.stop()]).toEqual([label, expect.stringContaining(said)]);
    }
  });

  test("under Bun 1.4 follows a kit the size of the real one; under an older Bun says it can't before trying, with nothing large on stderr or in its check-in", async () => {
    // The real kit is about 4 MB, imported as a data URL: Bun 1.3 refuses one longer than about 2 KB, Bun 1.4 takes it.
    lre.build = "b9";
    lre.kit = writeKit(distOf(root, "big"), "b9", ["lre_followed"], 4_000_000);
    const env = { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: join(home, "config") };
    const version = Bun.spawnSync(["bun", join(ROOT, "src/cli/main.ts"), "--version"], { env }).stdout.toString();
    const s = harness();
    await s.start();
    if (CANNOT === null) {
      await s.out.next((m) => m.method === "notifications/tools/list_changed");
      expect(await s.tools()).toEqual(["lre_followed"]);
      expect((await s.ask("tools/call", { name: "lre_followed", arguments: {} })).content).toEqual([{ type: "text", text: "lre_followed answered by build b9" }]);
      expect(await s.checkIns.next((c) => c.kit === "b9")).toMatchObject({ follows: true, why: null });
      expect(await s.stop()).toContain("serving the tools of LumiRPEngine build b9");
      expect(version).not.toContain("can't follow");
      return;
    }
    // Off before it is tried: its first check-in says why, it keeps its own tools, and the hello is a few hundred bytes, not the kit's URL.
    expect(await s.checkIns.next(() => true)).toMatchObject({ kit: "dev", follows: false, why: { code: "runtime", text: CANNOT } });
    const tools = await s.tools();
    expect([tools.includes("lre_guide"), tools.includes("lre_followed")]).toEqual([true, false]);
    expect(JSON.stringify(s.checkIns.got).length).toBeLessThan(4096);
    expect((await s.stop()).length).toBeLessThan(4096);
    expect(version).toContain(`under Bun ${BUN} it can't follow LumiRPEngine's tools: ${CANNOT}`);
  });
});
