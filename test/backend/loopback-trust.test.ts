// The loopback's trust between accounts (DEPTH-PLAN §3.7, §3.11, §3.14; the depth release's security
// review). Each account's relays say which of its own connections is the loopback, and no other
// account's registration changes that. The registry stays bounded: a few relays per account, each
// field and report checked, so one account's malformed report never breaks another's page. The
// shared relay's untagged requests are limited by LumiRPEngine itself, not only by the relay. A
// registry read that fails is never taken for an empty one, so it never wipes keys or relays. A world
// chat's reply on the loopback that has no turn to tie it to is stopped, never sent untagged. And
// Settings → Loopback's lines never have root run what the Lumiverse account can change, and every
// line runs as that account, named, from /, never as whoever pastes it nor from a path a relay reports.
// A system relay's Update writes a copy only after every read was whole and not empty, and restarts
// the unit only once every copy is written (the final security review, F2). No line has root run a
// file in /var/lib/lumirpengine, whose refusal is a changed copy's own to drop (S-1).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KIT_FILE } from "../../src/shared/agents";
import { isRecord } from "../../src/shared/json";
import type { LoopbackPage, RelayReport } from "../../src/shared/loopback";
import { LOOPBACK_MAX_BODY_BYTES, LOOPBACK_MODEL, SHARED_PASSTHROUGH_PER_MINUTE } from "../../src/shared/loopback";
import type { BackendToFrontend, FrontendToBackend } from "../../src/shared/protocol";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
import { readyLoopback, RELAY_SESSION } from "../support/relay";
import { Rig } from "../support/rig";
import { copyRun, rootRuns, SYSTEM_RELAY_ROOT_PROGRAMS } from "../support/root-lines";

const REGISTRY = "loopback/registry.json";

/** A relay's report as `loopback serve` sends it. */
const report = (name: string, port: number): RelayReport => ({ name, build: "dev", runtime: { bun: "/usr/bin/bun", script: "/srv/lre/lumirpengine.js", unit: null }, host: "box", listen: "127.0.0.1", port, scheduler: "excluded", session: { valid: true, expiresAt: null, checkedAt: null }, calls: 0 });

/** Sends a request as another account, from one of its sessions, and waits for its reply. */
async function sendAs(rig: Rig, userId: string, session: string, request: Record<string, unknown>): Promise<BackendToFrontend> {
  const reqId = `as-${crypto.randomUUID()}`;
  const before = rig.host.sent.length;
  await rig.dispatch.handle({ lre: PROTOCOL_VERSION, reqId, ...request } as unknown as FrontendToBackend, userId, session);
  await rig.host.settle();
  const reply = rig.host.sent.slice(before).find((m) => (m.type === "lre.result" || m.type === "lre.error") && m.reqId === reqId);
  if (!reply) throw new Error(`no reply to ${String(request.type)}`);
  return reply;
}

/** Settings → Loopback as a reply carries it. */
function pageOf(reply: BackendToFrontend): LoopbackPage {
  if (reply.type !== "lre.result" || reply.request !== "lre.loopback.page") throw new Error(`not Settings → Loopback: ${JSON.stringify(reply)}`);
  return reply.body.page;
}

const callId = (): string => crypto.randomUUID().replaceAll("-", "");

describe("which connection is the loopback", () => {
  test("another account's relay registration never makes a user's own Custom connection the loopback", async () => {
    const rig = new Rig();
    const { host } = rig;
    // The victim's world chat runs on a shared Ollama, through a Custom connection.
    host.connectionProfiles.push({ id: "conn-ollama", name: "Ollama", models: ["llama3"], provider: "custom", url: "http://127.0.0.1:11434/v1" });
    host.contextConnectionId = "conn-ollama";
    const chatId = await rig.worldChat();
    // Before any registration, the Ollama connection is no one's loopback, and the victim's page lists no connection.
    expect(await rig.rt.loopback.isLoopback("conn-ollama", host.userId)).toBe(false);
    expect(await rig.rt.loopback.isLoopback("conn-ollama", "mallory")).toBe(false);
    expect(pageOf(await rig.send({ type: "lre.loopback.page", op: "get" })).connections).toEqual([]);
    // Mallory registers a "relay" at the Ollama's address: one frame from her own session.
    const registered = await sendAs(rig, "mallory", "s_mallory", { type: "lre.loopback.register", name: "mallory", mode: "user", build: "dev", host: "box", listen: "127.0.0.1", port: 11434 });
    expect(registered.type).toBe("lre.result");
    // Her own connection to that address reads as her loopback; the victim's doesn't.
    expect(await rig.rt.loopback.isLoopback("conn-ollama", "mallory")).toBe(true);
    expect(await rig.rt.loopback.isLoopback("conn-ollama", host.userId)).toBe(false);
    expect(pageOf(await rig.send({ type: "lre.loopback.page", op: "get" })).connections).toEqual([]);
    // The victim's world chat still plays engine first: the guard stops the generation for the engine, and nothing is tagged.
    host.sendUser(chatId, "I walk into the shop.");
    await host.settle();
    const g = await host.begin(chatId, { type: "normal" });
    expect(g.halted).toBe("cancelled");
    expect(g.parameters?.lre_turn).toBeUndefined();
  });
});

describe("the registry's bounds", () => {
  test("an account registers at most eight relays, each address and text bounded; a name again replaces its relay", async () => {
    const rig = new Rig();
    const register = (name: string, extra: Record<string, unknown> = {}) => rig.send({ type: "lre.loopback.register", name, mode: "user", build: "dev", host: "box", listen: "127.0.0.1", port: 7861, ...extra }, RELAY_SESSION);
    for (let i = 0; i < 8; i++) expect((await register(`relay-${i}`)).type).toBe("lre.result");
    const ninth = await register("relay-8");
    expect(ninth).toMatchObject({ type: "lre.error", code: "conflict" });
    expect(ninth.type === "lre.error" ? ninth.message : "").toContain("8 relays registered already");
    // One of the eight set up again is no ninth.
    expect((await register("relay-3")).type).toBe("lre.result");
    // Another account's eight are its own.
    expect((await sendAs(rig, "bob", "s_bob", { type: "lre.loopback.register", name: "bob", mode: "user", build: "dev", host: "box", listen: "127.0.0.1", port: 7862 })).type).toBe("lre.result");
    const long = "x".repeat(20_000);
    for (const extra of [{ build: long }, { host: long }, { listen: long }, { listen: "127.0.0.1 evil" }]) expect(await register("relay-0", extra)).toMatchObject({ type: "lre.error", code: "bad_request" });
    await rig.rt.loopback.store.settle();
    expect(rig.host.extensionFiles.get(REGISTRY)?.length ?? 0).toBeLessThan(10_000);
  });

  test("a shared relay's malformed report never breaks another user's page: the last good report stands", async () => {
    const rig = new Rig();
    // The operator allows the shared relay and runs it.
    rig.body(await rig.send({ type: "lre.loopback.page", op: "shared", enabled: true }));
    const registered = rig.body(await rig.send({ type: "lre.loopback.register", name: "shared", mode: "shared", build: "dev", host: "box", listen: "127.0.0.1", port: 7861 }, RELAY_SESSION));
    const secret = String(registered.secret);
    // A buggy or version-skewed relay's hello: no runtime, no session.
    rig.body(await rig.send({ type: "lre.loopback.hello", secret, api: 1, report: { name: "shared", build: "dev" }, open: [] }, RELAY_SESSION));
    const bobs = await sendAs(rig, "bob", "s_bob", { type: "lre.loopback.page", op: "get" });
    expect(pageOf(bobs).relays.map((r) => r.report)).toEqual([null]);
    // Its depth opt-in reads the same page, and gets as far as bob's own missing key.
    expect(await rig.rt.loopback.unready("bob")).toContain("You have no loopback key");
    // A good report is kept; a malformed ping after it leaves it standing.
    rig.body(await rig.send({ type: "lre.loopback.hello", secret, api: 1, report: report("shared", 7861), open: [] }, RELAY_SESSION));
    rig.body(await rig.send({ type: "lre.loopback.ping", secret, report: { ...report("shared", 7861), runtime: "/tmp/evil", calls: -1 }, calls: [] }, RELAY_SESSION));
    expect(pageOf(await sendAs(rig, "bob", "s_bob", { type: "lre.loopback.page", op: "get" })).relays.map((r) => r.report)).toEqual([report("shared", 7861)]);
  });
});

describe("the shared relay's untagged requests", () => {
  test("LumiRPEngine itself holds each user to the limit, per minute and in size, whoever sends them", async () => {
    const rig = new Rig();
    rig.body(await rig.send({ type: "lre.loopback.page", op: "shared", enabled: true }));
    const registered = rig.body(await rig.send({ type: "lre.loopback.register", name: "shared", mode: "shared", build: "dev", host: "box", listen: "127.0.0.1", port: 7861 }, RELAY_SESSION));
    const secret = String(registered.secret);
    rig.body(await rig.send({ type: "lre.loopback.hello", secret, api: 1, report: report("shared", 7861), open: [] }, RELAY_SESSION));
    const key = pageOf(await sendAs(rig, "bob", "s_bob", { type: "lre.loopback.page", op: "mint" })).minted ?? "";
    expect(key).toStartWith("lre_lk_");
    // Whoever holds the relay's secret and session sends straight to LumiRPEngine, past the relay's own limit.
    const passthrough = (body: Record<string, unknown>) => rig.send({ type: "lre.loopback.passthrough", secret, call: callId(), key, body }, RELAY_SESSION);
    const body = { model: LOOPBACK_MODEL, messages: [{ role: "user", content: "Summarize the chat." }] };
    for (let i = 0; i < SHARED_PASSTHROUGH_PER_MINUTE; i++) expect((await passthrough(body)).type).toBe("lre.result");
    const over = await passthrough(body);
    expect(over).toMatchObject({ type: "lre.error", code: "unavailable" });
    expect(over.type === "lre.error" ? over.message : "").toContain(`at most ${SHARED_PASSTHROUGH_PER_MINUTE} untagged requests a minute`);
    // Each user is limited apart: bob stays refused, and the operator's own key still passes.
    expect((await passthrough(body)).type).toBe("lre.error");
    const own = pageOf(await rig.send({ type: "lre.loopback.page", op: "mint" })).minted ?? "";
    expect((await rig.send({ type: "lre.loopback.passthrough", secret, call: callId(), key: own, body }, RELAY_SESSION)).type).toBe("lre.result");
    // A body past the loopback's limit is refused however few came before it.
    const big = await rig.send({ type: "lre.loopback.passthrough", secret, call: callId(), key: own, body: { ...body, messages: [{ role: "user", content: "x".repeat(LOOPBACK_MAX_BODY_BYTES) }] } }, RELAY_SESSION);
    expect(big).toMatchObject({ type: "lre.error", code: "validation" });
    expect(rig.host.logs.some((l) => l.includes(`untagged request of user bob was refused: over ${SHARED_PASSTHROUGH_PER_MINUTE} a minute`))).toBe(true);
  });
});

describe("Settings → Loopback's Test and last request", () => {
  test("Test says what is missing until a relay runs, the key is set and a connection is the loopback; a relay's last request is when it last carried one", async () => {
    const rig = new Rig();
    const before = pageOf(await rig.send({ type: "lre.loopback.page", op: "test" }));
    expect(before.test).toEqual({ ok: false, text: "Test failed. No relay carries your replies yet: start one with the line in Settings → Loopback." });
    const ready = await readyLoopback(rig);
    const after = pageOf(await rig.send({ type: "lre.loopback.page", op: "test" }));
    expect(after.test?.ok).toBe(true);
    expect(after.test?.text).toStartWith("Test passed: sam is running");
    expect(after.relays[0]?.requestAt).toBeNull();
    expect(pageOf(await rig.send({ type: "lre.loopback.page", op: "get" })).test).toBeUndefined();
    const at = Date.now();
    const body = { model: LOOPBACK_MODEL, messages: [{ role: "user", content: "Summarize the chat." }] };
    expect((await rig.send({ type: "lre.loopback.passthrough", secret: ready.secret, call: callId(), key: ready.key, body }, RELAY_SESSION)).type).toBe("lre.result");
    expect(pageOf(await rig.send({ type: "lre.loopback.page", op: "get" })).relays[0]?.requestAt).toBeGreaterThanOrEqual(at);
  });
});

describe("a registry read that fails", () => {
  test("is never kept as an empty registry, and a write meanwhile wipes nothing: the next request reads the real one", async () => {
    const first = new Rig();
    const { secret } = await readyLoopback(first, 7861);
    await first.rt.loopback.store.settle();
    const stored = first.host.extensionFiles.get(REGISTRY);
    expect(stored).toContain('"name":"sam"');
    // Lumiverse restarts LumiRPEngine, and its storage fails the registry's first read.
    const host = first.host;
    const read = host.extensionStorage.read;
    let failing = true;
    host.extensionStorage = { ...host.extensionStorage, read: async (path) => (failing && path === REGISTRY ? Promise.reject(new Error("disk I/O error")) : read(path)) };
    const rig = first.restart();
    const hello = await rig.send({ type: "lre.loopback.hello", secret, api: 1, report: report("sam", 7861), open: [] }, RELAY_SESSION);
    // Not "forbidden", which a relay takes for its registration gone and never retries.
    expect(hello).toMatchObject({ type: "lre.error", code: "internal" });
    expect(hello.type === "lre.error" ? hello.message : "").toContain("disk I/O error");
    // A mint while the registry can't be read writes nothing over it.
    expect((await rig.send({ type: "lre.loopback.page", op: "mint" })).type).toBe("lre.error");
    await rig.rt.loopback.store.settle();
    expect(host.extensionFiles.get(REGISTRY)).toBe(stored);
    failing = false;
    // The next request reads the registry again: the relay and the key are both there.
    expect((await rig.send({ type: "lre.loopback.hello", secret, api: 1, report: report("sam", 7861), open: [] }, RELAY_SESSION)).type).toBe("lre.result");
    const page = rig.body(await rig.send({ type: "lre.loopback.page", op: "get" })).page;
    expect(isRecord(page) && isRecord(page.key) ? page.key.set : null).toBe(true);
  });

  test("a registry this build can't read is kept aside before the first write over it", async () => {
    const rig = new Rig();
    rig.host.extensionFiles.set(REGISTRY, "{ not json");
    rig.body(await rig.send({ type: "lre.loopback.page", op: "mint" }));
    await rig.rt.loopback.store.settle();
    expect(rig.host.extensionFiles.get(`${REGISTRY}.bad`)).toBe("{ not json");
    expect(JSON.parse(rig.host.extensionFiles.get(REGISTRY) ?? "null")).toMatchObject({ v: 1, keys: { [rig.host.userId]: { print: expect.any(String) } } });
  });
});

describe("a world chat's reply on the loopback with no turn to tie it to", () => {
  test("is stopped by the tagger where the guard can't stop it, never sent untagged; the next reply is tagged", async () => {
    const rig = new Rig();
    const { host } = rig;
    const { connectionId } = await readyLoopback(rig, 7861);
    host.contextConnectionId = connectionId;
    const chatId = await rig.worldChat();
    // A host whose guard can't cancel, and a GENERATION_STARTED that never reached LumiRPEngine.
    host.capabilities = { ...host.capabilities, cancel: false };
    host.sendUser(chatId, "I walk into the shop.");
    await host.settle();
    host.lost.add("GENERATION_STARTED");
    const unheard = await host.begin(chatId, { type: "normal" });
    expect(unheard.halted).toBe("failed");
    expect(unheard.parameters?.lre_turn).toBeUndefined();
    // A chat that isn't a world chat passes through on the same connection, untagged, as before.
    const plain = host.createChat("Hi.");
    host.sendUser(plain, "Summarize this.");
    await host.settle();
    const passthrough = await host.begin(plain, { type: "normal" });
    expect(passthrough.halted).toBeUndefined();
    expect(passthrough.parameters?.lre_turn).toBeUndefined();
    // The next reply whose start is heard is tagged as ever.
    const heard = await host.begin(chatId, { type: "normal" });
    expect(heard.halted).toBeUndefined();
    expect(typeof heard.parameters?.lre_turn).toBe("string");
  });
});

describe("Settings → Loopback's lines", () => {
  // The depth release's late security review: a system relay's Update copied the account's install into root's directory as root, following its links, and its Sign-in ran that copy as root (S1); a user unit's Sign-in ran the words its relay reported, sudo included (S3); the lines named no account, so pasted from another login they ran there (S4); and Bun read the directory they were pasted in (S2).
  test("never run, as root, what the service's account can change or a path a relay reports: every line runs as that account, named, from /; a system relay's run as root only system programs", async () => {
    const dist = "/srv/lumiverse/data/extensions/lre/repo/dist";
    const rig = new Rig({ build: { id: "next", kit: { path: `${dist}/${KIT_FILE}`, core: `${dist}/lumirpengine.js`, sha256: "a".repeat(64), api: 1 }, tools: [] } });
    const url = "http://127.0.0.1:7860";
    const bun = rig.host.bunPath ?? "";
    // Two relays of the user's on an older build, each signed out by its own report: a system unit's, which reports paths of its own choosing, and a user unit's, which reports sudo as its Bun.
    const relays = [
      { name: "sam", port: 7861, runtime: { bun: "/tmp/evil-bun", script: "/tmp/evil.js", unit: { name: "lumirpengine-loopback-sam.service", scope: "system" } } },
      { name: "sam-dev", port: 7862, runtime: { bun: "sudo", script: "/home/sam/.local/share/lumirpengine/lumirpengine.js", unit: { name: "lumirpengine-loopback-sam-dev.service", scope: "user" } } },
    ];
    for (const { name, port, runtime } of relays) {
      const secret = String(rig.body(await rig.send({ type: "lre.loopback.register", name, mode: "user", build: "old", host: "box", listen: "127.0.0.1", port }, RELAY_SESSION)).secret);
      rig.body(await rig.send({ type: "lre.loopback.hello", secret, api: 1, report: { ...report(name, port), build: "old", runtime, session: { valid: false, expiresAt: null, checkedAt: 1 } }, open: [] }, RELAY_SESSION));
    }
    const page = pageOf(await rig.send({ type: "lre.loopback.page", op: "get", origin: url }));
    expect(page.line.command).toBe(`sudo -u lumi ${bun} --cwd / ${dist}/lumirpengine.js loopback up --url ${url} --systemd`);
    expect(page.line.account).toBe("lumi");
    const lines = Object.fromEntries(page.relays.map((r) => [r.name, r.lines]));
    expect(page.relays.map((r) => [r.signIn, r.update])).toEqual([
      [true, true],
      [true, true],
    ]);
    // The system relay's: root reads nothing of the account's (the account's reads go into a directory of the operator's own, which root installs from) and runs only install and systemctl; the copies sign in as the account, its config written in place.
    expect(lines.sam).toEqual({
      update: `t=$(mktemp -d /tmp/lumirpengine.XXXXXX) && sudo -u lumi cat ${dist}/lumirpengine.js >"$t"/lumirpengine.js && sudo -u lumi cat ${dist}/${KIT_FILE} >"$t"/${KIT_FILE} && test -s "$t"/lumirpengine.js && test -s "$t"/${KIT_FILE} && sudo install -m 0644 "$t"/lumirpengine.js /var/lib/lumirpengine/lumirpengine.js && sudo install -m 0644 "$t"/${KIT_FILE} /var/lib/lumirpengine/${KIT_FILE} && rm -r "$t" && sudo systemctl restart lumirpengine-loopback-sam.service`,
      login: "sudo -u lumi /var/lib/lumirpengine/bun --cwd / /var/lib/lumirpengine/lumirpengine.js loopback login --config /etc/lumirpengine/loopback-sam.json && sudo systemctl restart lumirpengine-loopback-sam.service",
    });
    // The user unit's run LumiRPEngine's own install, as the account, whatever its relay reported.
    expect(lines["sam-dev"]).toEqual({ update: `sudo -u lumi ${bun} --cwd / ${dist}/lumirpengine.js loopback up --url ${url} --name sam-dev --systemd`, login: `sudo -u lumi ${bun} --cwd / ${dist}/lumirpengine.js loopback login --name sam-dev` });
    // A Lumiverse run as root names no account: its lines need no sudo, and a system relay's, which can't name the account its unit runs as, are none.
    rig.host.account = "root";
    const root = pageOf(await rig.send({ type: "lre.loopback.page", op: "get", origin: url }));
    expect(root.line.command).toBe(`${bun} --cwd / ${dist}/lumirpengine.js loopback up --url ${url} --systemd`);
    expect(root.relays.find((r) => r.name === "sam")?.lines).toEqual({ update: null, login: null });
    // The final security review's last finding, S-1: no line on either page has root run a file in /var/lib/lumirpengine, and a system relay's have it run systemd's own programs alone.
    const given = [page, root].flatMap((p) => [p.line.command, p.line.foreground, ...p.relays.flatMap((r) => [r.lines.update, r.lines.login])]).filter((l): l is string => l !== null);
    expect(given).toContain(lines.sam?.update ?? "");
    expect(given).toContain(lines.sam?.login ?? "");
    for (const line of given) for (const words of rootRuns(line)) expect({ line, runs: copyRun(words) }).toEqual({ line, runs: null });
    for (const line of [lines.sam?.update ?? "", lines.sam?.login ?? ""]) for (const [program = ""] of rootRuns(line)) expect({ line, program, allowed: SYSTEM_RELAY_ROOT_PROGRAMS.includes(program) }).toEqual({ line, program, allowed: true });
  });

  // The final security review, F2: each step was `cat … | tee …`, whose status is tee's, and tee empties its file as it opens it, so a failed read (sudo -u refused, the install mid-update) emptied the service's bundle and kit and the restart ran anyway.
  test.skipIf(process.platform === "win32")("a system relay's Update writes a copy only after every read was whole and not empty, and restarts the unit only once every copy is written", async () => {
    const dist = "/srv/lumiverse/data/extensions/lre/repo/dist";
    const rig = new Rig({ build: { id: "next", kit: { path: `${dist}/${KIT_FILE}`, core: `${dist}/lumirpengine.js`, sha256: "a".repeat(64), api: 1 }, tools: [] } });
    const secret = String(rig.body(await rig.send({ type: "lre.loopback.register", name: "sam", mode: "user", build: "old", host: "box", listen: "127.0.0.1", port: 7861 }, RELAY_SESSION)).secret);
    rig.body(await rig.send({ type: "lre.loopback.hello", secret, api: 1, report: { ...report("sam", 7861), build: "old", runtime: { bun: "/usr/bin/bun", script: "/x.js", unit: { name: "lumirpengine-loopback-sam.service", scope: "system" } } }, open: [] }, RELAY_SESSION));
    const update = pageOf(await rig.send({ type: "lre.loopback.page", op: "get", origin: "http://127.0.0.1:7860" })).relays.find((r) => r.name === "sam")?.lines.update ?? "";
    // The line run by sh on a scratch machine: sudo runs what follows it (as the account after -u), systemctl writes down what it was asked.
    const run = (sources: { bundle: string | null; kit: string | null }): { code: number; bundle: string; kit: string; restarted: string } => {
      const root = mkdtempSync(join(tmpdir(), "lre-update-"));
      try {
        const [from, to] = [join(root, "dist"), join(root, "copies")];
        Bun.spawnSync(["mkdir", "-p", from, to]);
        writeFileSync(join(to, "lumirpengine.js"), "old bundle");
        writeFileSync(join(to, KIT_FILE), "old kit");
        if (sources.bundle !== null) writeFileSync(join(from, "lumirpengine.js"), sources.bundle);
        if (sources.kit !== null) writeFileSync(join(from, KIT_FILE), sources.kit);
        const line = update.replaceAll(dist, from).replaceAll("/var/lib/lumirpengine", to).replace("/tmp/lumirpengine.XXXXXX", join(root, "read.XXXXXX"));
        const stubs = `sudo() { if [ "$1" = -u ]; then shift 2; fi; "$@"; }; systemctl() { echo "$*" >> ${JSON.stringify(join(root, "restarted"))}; }; `;
        const done = Bun.spawnSync(["sh", "-c", stubs + line], { stderr: "pipe" });
        const read = (p: string): string => {
          try {
            return readFileSync(p, "utf8");
          } catch {
            return "";
          }
        };
        return { code: done.exitCode, bundle: read(join(to, "lumirpengine.js")), kit: read(join(to, KIT_FILE)), restarted: read(join(root, "restarted")) };
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    };
    expect(run({ bundle: "new bundle", kit: "new kit" })).toEqual({ code: 0, bundle: "new bundle", kit: "new kit", restarted: "restart lumirpengine-loopback-sam.service\n" });
    // A read that fails (here the kit is missing), or one that reads nothing, writes neither copy and restarts nothing.
    for (const sources of [{ bundle: "new bundle", kit: null }, { bundle: "", kit: "new kit" }, { bundle: null, kit: "new kit" }]) {
      const failed = run(sources);
      expect(failed.code).not.toBe(0);
      expect([failed.bundle, failed.kit, failed.restarted]).toEqual(["old bundle", "old kit", ""]);
    }
  });
});
