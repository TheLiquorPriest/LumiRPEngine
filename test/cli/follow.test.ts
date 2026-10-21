// Following the extension's agent kit (DESIGN §23), the MCP server in process over a fake Lumiverse,
// with temp dirs standing in for the installed extension's dist/: a running server loads a newer kit
// when LumiRPEngine reports a new build whose hash matches, tells its client once and lists the new
// kit's tools; a hash that differs, a path that isn't an installed extension's (its symlinks
// resolved), a kit or directory other users can change, and --pin keep the tools loaded, and say
// why; and it looks on connecting, before a call once its last look is old, every minute, and when
// LumiRPEngine asks.

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { kit as bundled } from "../../src/cli/agent-kit";
import { CredentialStore } from "../../src/cli/credentials";
import type { KitFiles } from "../../src/cli/follow";
import type { Clock } from "../../src/cli/serve";
import { McpSession, serveMcp } from "../../src/cli/serve";
import { runtimeCannotFollow, versionLine } from "../../src/cli/version";
import type { KitReport } from "../../src/shared/agents";
import { isRecord } from "../../src/shared/json";
import { disk, distOf as distIn, writeKit } from "../support/kits";
import { FakeLumiverse, USER } from "./fake-lumiverse";

const root = mkdtempSync(join(tmpdir(), "lre-follow-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** An installed extension's dist/ under its own Lumiverse data dir. */
const distOf = (name: string): string => distIn(root, name);

/** Someone else: never this user, never root. */
const OTHER_UID = (process.getuid?.() ?? 0) + 4242;

/** A server as the core runs one, signed in to `fake`, on a clock the test moves; following's disk is the real one unless `files` says otherwise, and `cannotLoad` is the runtime's word that it can't load a kit. */
function serve(fake: FakeLumiverse, options: { pin?: boolean; files?: KitFiles; cannotLoad?: string } = {}) {
  let now = 1_000_000;
  const ticks: (() => void)[] = [];
  const clock: Clock = { now: () => now, every: (_ms, tick) => (ticks.push(tick), () => undefined) };
  let saved: string | null = null;
  const credentials = new CredentialStore({ read: () => saved, write: (_path, text) => void (saved = text) }, "credentials.json");
  credentials.put(fake.base, { username: USER.username, token: fake.session(), savedAt: 1 });
  const logs: string[] = [];
  const session = new McpSession({ bundled, mcp: { readOnly: false, pin: options.pin ?? false, base: () => fake.base, timeoutMs: 3000 }, io: { credentials, http: fake.http, openSocket: fake.openSocket, readFile: () => "" }, files: options.files ?? disk, host: "test-host", log: (text) => void logs.push(text), cannotLoad: options.cannotLoad ?? null, clock });
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
    await ask("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "test-harness", version: "1" } });
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
    expect(checkIns(fake)).toEqual([{ name: "lumirpengine", version: "0.0.1", serves: "mcp", core: "dev", kit: bundled.build, follows: true, why: null, host: "test-host", harness: "test-harness" }]);

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
    const cases: [string, KitReport, string, string][] = [
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

  test("a kit loads only when no one but this user or root can change it: a link out of the extension's layout, a directory others can write and a file another user owns are refused and said, and the tools loaded stay", async () => {
    // Laid out as the extension's kit, but a link to a file elsewhere.
    const elsewhere = writeKit(join(root, "f", "downloads"), "b5", ["lre_never"]);
    mkdirSync(distOf("f"), { recursive: true, mode: 0o755 });
    const link = join(distOf("f"), "agent-kit.js");
    symlinkSync(elsewhere.path, link);
    // repo/ writable by its group: anyone in it could put another kit in its place.
    const shared = writeKit(distOf("g"), "b5", ["lre_never"]);
    const repo = dirname(distOf("g"));
    chmodSync(repo, 0o775);
    // A file another user planted (the disk says so: a test can't chown).
    const planted = writeKit(distOf("h"), "b5", ["lre_never"]);
    const theirs: KitFiles = { ...disk, read: async (path) => ({ ...(await disk.read(path)), uid: OTHER_UID }) };
    const cases: [string, KitReport, KitFiles, string, string][] = [
      ["a link out of the layout", { ...elsewhere, path: link }, disk, "refused", `whose real path ${realpathSync(elsewhere.path)} isn't where Lumiverse installs an extension's kit`],
      ["a directory others can write", shared, disk, "unsafe", `${realpathSync(repo)} can be changed by other users`],
      ["a file another user owns", planted, theirs, "unsafe", `${realpathSync(planted.path)} can be changed by other users`],
    ];
    for (const [label, report, files, code, said] of cases) {
      const fake = new FakeLumiverse();
      fake.lre.build = "b5";
      fake.lre.kit = report;
      const s = serve(fake, { files });
      await s.start();
      expect([label, await s.tools()]).toEqual([label, own]);
      expect([label, s.changed()]).toEqual([label, 0]);
      expect([label, checkIns(fake).at(-1)]).toEqual([label, expect.objectContaining({ kit: bundled.build, follows: false, why: { code, text: expect.stringContaining(said) } })]);
    }
  });

  test("a kit reached through a linked data dir loads, its real path being an installed extension's; and where owners aren't checked (Windows) a shared directory doesn't stop one", async () => {
    // Lumiverse's data dir is a link to another disk.
    const linked = writeKit(join(root, "i", "disk", "data/extensions/lumi_rp_engine/repo/dist"), "b6", ["lre_linked_tool"]);
    symlinkSync(join(root, "i", "disk", "data"), join(root, "i", "data"));
    const windows = writeKit(distOf("j"), "b6", ["lre_windows_tool"]);
    chmodSync(dirname(distOf("j")), 0o777);
    const cases: [string, KitReport, KitFiles, string][] = [
      ["a linked data dir", { ...linked, path: join(distOf("i"), "agent-kit.js") }, disk, "lre_linked_tool"],
      ["no owners to check", windows, { ...disk, uid: null }, "lre_windows_tool"],
    ];
    for (const [label, report, files, tool] of cases) {
      const fake = new FakeLumiverse();
      fake.lre.build = "b6";
      fake.lre.kit = report;
      const s = serve(fake, { files });
      await s.start();
      expect([label, await s.tools()]).toEqual([label, [tool]]);
      expect([label, checkIns(fake).at(-1)]).toEqual([label, expect.objectContaining({ kit: "b6", follows: true, why: null })]);
    }
  });

  test("--pin keeps the bundled kit whatever LumiRPEngine reports, and says so in its check-in", async () => {
    const fake = new FakeLumiverse();
    fake.lre.build = "b4";
    fake.lre.kit = writeKit(distOf("d"), "b4", ["lre_never"]);
    const s = serve(fake, { pin: true });
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

describe("on a Bun that can't load a kit", () => {
  const CANNOT = "run it with Node 22 or newer (Bun before 1.4 can't load the kit)";

  test("Bun before 1.4 can't follow, and --version says so; Bun 1.4 and Node can", () => {
    for (const bun of ["1.3.14", "1.0.0", "0.9.9"]) expect([bun, runtimeCannotFollow(bun)]).toEqual([bun, CANNOT]);
    for (const bun of ["1.4.0", "1.4.3", "2.0.0", undefined]) expect([bun, runtimeCannotFollow(bun)]).toEqual([bun, null]);
    expect(versionLine("1.3.14")).toEndWith(`; under Bun 1.3.14 it can't follow LumiRPEngine's tools: ${CANNOT}`);
    expect(versionLine("1.4.3")).toMatch(/^lumirpengine \d+\.\d+\.\d+ \(build [\w.-]+, engine \d+\.\d+\.\d+, world format lre-world-v1, agent API \d+\)$/);
  });

  test("its server doesn't try: its one check-in and lre_status say why, it never looks, and the tools it has stay", async () => {
    const fake = new FakeLumiverse();
    fake.lre.build = "b10";
    fake.lre.kit = writeKit(distOf("k"), "b10", ["lre_never"]);
    const s = serve(fake, { cannotLoad: CANNOT });
    await s.start();
    s.tick();
    await s.settle();
    expect(await s.tools()).toEqual(own);
    expect(s.changed()).toBe(0);
    expect(checkIns(fake)).toEqual([expect.objectContaining({ kit: bundled.build, follows: false, why: { code: "runtime", text: CANNOT } })]);
    expect(fake.lre.sent("lre.agents", "kit")).toEqual([]);
    const status = (await s.ask("tools/call", { name: "lre_status", arguments: {} })).content as { text: string }[];
    expect(JSON.parse(status[0]?.text ?? "{}").client).toMatchObject({ follows: false, whyNot: CANNOT });
  });
});
