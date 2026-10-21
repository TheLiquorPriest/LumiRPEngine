// Following the extension's agent kit (DESIGN §23), the MCP server in process over a fake Lumiverse,
// with temp dirs standing in for the installed extension's dist/: a running server loads a newer kit
// when LumiRPEngine reports a new build whose hash matches, tells its client once and lists the new
// kit's tools; a hash that differs, a path that isn't an installed extension's, and --pin keep the
// tools loaded, and say why; and it looks on connecting, before a call once its last look is old,
// every minute, and when LumiRPEngine asks.

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kit as bundled } from "../../src/cli/agent-kit";
import { CredentialStore } from "../../src/cli/credentials";
import type { Clock } from "../../src/cli/serve";
import { McpSession, serveMcp } from "../../src/cli/serve";
import { isRecord } from "../../src/shared/json";
import { FakeLumiverse, USER } from "./fake-lumiverse";

const root = mkdtempSync(join(tmpdir(), "lre-follow-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** An installed extension's dist/ under its own Lumiverse data dir. */
const distOf = (name: string): string => join(root, name, "data/extensions/lumi_rp_engine/repo/dist");

/** A kit as an extension's build writes one, of build `build`, offering the tools named; and its report. */
function writeKit(dir: string, build: string, tools: string[]): { path: string; sha256: string; api: number; core: string } {
  const names = JSON.stringify(tools);
  const text = `export const kit = { api: 1, build: ${JSON.stringify(build)}, versions: { cli: "0.0.1", engine: "9.9.9", worldFormat: "lre-world-v1", agentApi: 1 },
  tools: () => ${names}.map((name) => ({ name, description: "from build ${build}", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } })),
  has: (name) => ${names}.includes(name),
  call: async (name) => ({ text: name + " answered by build ${build}" }) };\n`;
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "agent-kit.js");
  writeFileSync(path, text);
  return { path, sha256: createHash("sha256").update(text).digest("hex"), api: 1, core: join(dir, "lumirpengine.js") };
}

/** A server as the core runs one, signed in to `fake`, on a clock the test moves. */
function serve(fake: FakeLumiverse, pin = false) {
  let now = 1_000_000;
  const ticks: (() => void)[] = [];
  const clock: Clock = { now: () => now, every: (_ms, tick) => (ticks.push(tick), () => undefined) };
  let saved: string | null = null;
  const credentials = new CredentialStore({ read: () => saved, write: (_path, text) => void (saved = text) }, "credentials.json");
  credentials.put(fake.base, { username: USER.username, token: fake.session(), savedAt: 1 });
  const logs: string[] = [];
  const session = new McpSession({ bundled, mcp: { readOnly: false, pin, base: () => fake.base, timeoutMs: 3000 }, io: { credentials, http: fake.http, openSocket: fake.openSocket, readFile: () => "" }, files: { read: (path) => readFile(path) }, host: "test-host", log: (text) => void logs.push(text), clock });
  const lines: Record<string, unknown>[] = [];
  const server = serveMcp(session, (line) => void lines.push(JSON.parse(line) as Record<string, unknown>));
  let id = 0;
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) {
      await session.idle();
      await server.drain();
    }
  };
  /** Sends a request and answers its result once everything it set going is done. */
  const ask = async (method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const asked = ++id;
    server.feed(`${JSON.stringify({ jsonrpc: "2.0", id: asked, method, ...(params ? { params } : {}) })}\n`);
    await settle();
    const reply = lines.find((l) => l.id === asked);
    return isRecord(reply?.result) ? reply.result : {};
  };
  const start = async (): Promise<void> => {
    await ask("initialize", { protocolVersion: "2025-06-18" });
    session.start();
    await settle();
  };
  return {
    lines,
    logs,
    ask,
    start,
    settle,
    tick: () => ticks.forEach((tick) => tick()),
    advance: (ms: number) => void (now += ms),
    tools: async () => ((await ask("tools/list")).tools as { name: string }[]).map((t) => t.name),
    changed: () => lines.filter((l) => l.method === "notifications/tools/list_changed").length,
  };
}

const own = bundled.tools(false).map((t) => t.name);
/** Each hello's client, as the fake host received it. */
const checkIns = (fake: FakeLumiverse): Record<string, unknown>[] => fake.lre.sent("lre.hello").map((h) => (isRecord(h.client) ? h.client : {}));

describe("following the extension's kit", () => {
  test("a running server loads a newer kit when LumiRPEngine reports a new build whose hash matches: one tools/list_changed, then the new kit's tools", async () => {
    const fake = new FakeLumiverse();
    // The extension runs the build the server's own kit is: nothing to load.
    fake.lre.build = bundled.build;
    fake.lre.kit = writeKit(distOf("a"), bundled.build, ["lre_unused"]);
    const s = serve(fake);
    await s.start();
    expect(await s.tools()).toEqual(own);
    expect(s.changed()).toBe(0);
    expect(checkIns(fake)).toEqual([{ name: "lumirpengine", version: "0.0.1", serves: "mcp", core: "dev", kit: bundled.build, follows: true, why: null, host: "test-host" }]);

    // The extension updates: its new kit is on disk, and LumiRPEngine now reports that build.
    fake.lre.build = "b2";
    fake.lre.kit = writeKit(distOf("a"), "b2", ["lre_new_tool"]);
    s.tick();
    await s.settle();
    expect(s.changed()).toBe(1);
    expect(await s.tools()).toEqual(["lre_new_tool"]);
    const answer = await s.ask("tools/call", { name: "lre_new_tool", arguments: {} });
    expect(answer.content).toEqual([{ type: "text", text: "lre_new_tool answered by build b2" }]);
    // It checked in again with what it runs now, and said so on stderr; and told its client once.
    expect(checkIns(fake).at(-1)).toMatchObject({ kit: "b2", follows: true, why: null });
    expect(s.logs).toEqual([`lumirpengine: serving the tools of LumiRPEngine build b2 (was build ${bundled.build})`]);
    expect(s.changed()).toBe(1);
  });

  test("a hash that differs or a path that isn't an installed extension's kit is refused and said, and the tools loaded stay", async () => {
    const cases: [string, { path: string; sha256: string; api: number; core: string }, string, string][] = [
      ["a hash that differs", { ...writeKit(distOf("b"), "b3", ["lre_never"]), sha256: "0".repeat(64) }, "mismatch", "its sha256 differs"],
      ["a path elsewhere", writeKit(join(root, "c", "downloads", "dist"), "b3", ["lre_never"]), "refused", "isn't where Lumiverse installs an extension's kit"],
    ];
    for (const [label, report, code, said] of cases) {
      const fake = new FakeLumiverse();
      fake.lre.build = "b3";
      fake.lre.kit = report;
      const s = serve(fake);
      await s.start();
      expect([label, await s.tools()]).toEqual([label, own]);
      expect([label, s.changed()]).toEqual([label, 0]);
      expect([label, checkIns(fake).at(-1)]).toEqual([label, expect.objectContaining({ kit: bundled.build, follows: false, why: { code, text: expect.stringContaining(said) } })]);
      expect([label, s.logs.join("\n")]).toEqual([label, expect.stringContaining(said)]);
    }
  });

  test("--pin keeps the bundled kit whatever LumiRPEngine reports, and says so in its check-in", async () => {
    const fake = new FakeLumiverse();
    fake.lre.build = "b4";
    fake.lre.kit = writeKit(distOf("d"), "b4", ["lre_never"]);
    const s = serve(fake, true);
    await s.start();
    s.tick();
    await s.settle();
    expect(await s.tools()).toEqual(own);
    expect(s.changed()).toBe(0);
    expect(checkIns(fake)).toEqual([expect.objectContaining({ follows: false, why: expect.objectContaining({ code: "pinned" }) })]);
    expect(fake.lre.sent("lre.agents", "kit")).toEqual([]);
  });

  test("it looks on connecting, before a call once its last look is 30 s old, every minute, and when LumiRPEngine asks it by name", async () => {
    const fake = new FakeLumiverse();
    fake.lre.build = bundled.build;
    fake.lre.kit = writeKit(distOf("e"), bundled.build, ["lre_unused"]);
    const s = serve(fake);
    const looks = (): number => fake.lre.sent("lre.agents", "kit").length;
    await s.start();
    // Connecting: the hello's answer was the look.
    expect([checkIns(fake).length, looks()]).toEqual([1, 0]);
    await s.ask("tools/call", { name: "lre_templates", arguments: {} });
    expect(looks()).toBe(0);
    s.advance(31_000);
    await s.ask("tools/call", { name: "lre_templates", arguments: {} });
    expect(looks()).toBe(1);
    s.tick();
    await s.settle();
    expect(looks()).toBe(2);
    fake.push({ type: "lre.kit.reload", client: "another-server" });
    await s.settle();
    expect(looks()).toBe(2);
    fake.push({ type: "lre.kit.reload", client: fake.lre.clientId });
    await s.settle();
    expect(looks()).toBe(3);
    // LumiRPEngine restarted and forgot this session: the look says hello again.
    fake.lre.known = false;
    s.tick();
    await s.settle();
    expect([looks(), checkIns(fake).length]).toEqual([4, 2]);
  });
});
