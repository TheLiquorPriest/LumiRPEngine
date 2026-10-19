// The real entry (src/cli/main.ts) as a user runs it, against a local fake Lumiverse: login keeps
// the session in a file only its owner can read, nothing ever prints the token, and logout ends
// the session and forgets it. Also where the file lives on each platform.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CredentialStore, credentialsPath, normalizeBase } from "../../src/cli/credentials";

const ROOT = resolve(import.meta.dir, "../..");
const TOKEN = "tok_entry_9f3c2a_secret";
const calls: string[] = [];
let signedIn = true;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req, srv) {
    const url = new URL(req.url);
    calls.push(`${req.method} ${url.pathname}`);
    const bearer = req.headers.get("authorization") === `Bearer ${TOKEN}` && signedIn;
    if (url.pathname === "/api/auth/sign-in/username") return Response.json({ token: TOKEN, user: { username: "tom" } });
    if (url.pathname === "/api/auth/sign-out") {
      signedIn = false;
      return Response.json({ success: bearer });
    }
    if (url.pathname === "/api/auth/get-session") return Response.json(bearer ? { session: { expiresAt: "2026-10-25T18:00:00.000Z" } } : null);
    // The socket carries no bearer: its single-use ticket stands for the session.
    if (url.pathname === "/api/ws") return url.searchParams.get("ticket") === "t1" && srv.upgrade(req) ? undefined : new Response("no", { status: 400 });
    if (!bearer) return Response.json({ error: "Unauthorized" }, { status: 401 });
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
      if (typeof frame !== "object" || frame === null || !("payload" in frame)) return;
      const payload = frame.payload as { type?: string; reqId?: string };
      if (payload.type === "lre.hello") ws.send(JSON.stringify({ event: "SPINDLE_FRONTEND_MSG", payload: { extensionId: "ext1", data: { lre: 1, type: "lre.result", reqId: payload.reqId, request: "lre.hello", body: { accepted: true, agentApi: 1 } } } }));
    },
  },
});
const base = `http://127.0.0.1:${server.port}`;
const home = mkdtempSync(join(tmpdir(), "lre-cli-"));
afterAll(() => {
  server.stop(true);
  rmSync(home, { recursive: true, force: true });
});

async function cli(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(["bun", join(ROOT, "src/cli/main.ts"), ...args], { env: { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: join(home, "config"), ...env }, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out, err };
}

describe("the lumirpengine entry", () => {
  const file = join(home, "config/lumirpengine/credentials.json");

  test("login saves the session owner-only and never prints the token; status and logout neither", async () => {
    const login = await cli(["login", "--url", `${base}/`, "--username", "tom"], { LUMIVERSE_PASSWORD: "hunter2" });
    expect(login.code).toBe(0);
    expect(login.out).toContain(`Signed in to ${base} as tom`);
    expect(login.out).toContain("speaks agent API 1");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, "config/lumirpengine")).mode & 0o777).toBe(0o700);
    const saved = JSON.parse(readFileSync(file, "utf8")) as { hosts: Record<string, { username: string; token: string }> };
    expect(saved.hosts[base]).toMatchObject({ username: "tom", token: TOKEN });
    const status = await cli(["status"]);
    expect(status.code).toBe(0);
    expect(JSON.parse(status.out)).toMatchObject({ signedIn: true, lumiverse: base, user: "tom", lumiRPEngine: { agentApi: 1 } });
    const logout = await cli(["logout"]);
    expect(logout.code).toBe(0);
    expect(calls).toContain("POST /api/auth/sign-out");
    expect(JSON.parse(readFileSync(file, "utf8")).hosts).toEqual({});
    for (const run of [login, status, logout]) expect(`${run.out}${run.err}`).not.toContain(TOKEN);
  });

  test("a password given as an argument is refused before anything is sent", async () => {
    const before = calls.length;
    const run = await cli(["login", "--url", base, "--username", "tom", "--password", "hunter2"]);
    expect(run.code).toBe(2);
    expect(run.err).toContain("never takes a password as an argument");
    expect(calls.length).toBe(before);
  });

  test("--version names the CLI, the engine, the world format and the agent API", async () => {
    const run = await cli(["--version"]);
    expect(run.out.trim()).toMatch(/^lumirpengine \d+\.\d+\.\d+ \(engine \d+\.\d+\.\d+, world format lre-world-v1, agent API \d+\)$/);
  });

  test("a piped template prints the whole export file, which check then reads; check exits 1 on a file that fails", async () => {
    const run = await cli(["template", "mystery_manor"]);
    expect(run.code).toBe(0);
    const file = JSON.parse(run.out) as { format: string; world: { name: string } };
    expect(file.format).toBe("lre-world-export-v1");
    const path = join(home, "manor.json");
    writeFileSync(path, run.out);
    const check = await cli(["check", path]);
    expect(check.code).toBe(0);
    expect(JSON.parse(check.out)).toMatchObject({ ok: true, loads: true, errors: 0, contents: { entities: 41 } });
    // A script goes by the exit code: a file that doesn't load, or loads with lint errors, is a failure.
    const broken = join(home, "broken-world.json");
    writeFileSync(broken, "{ nope");
    const failed = await cli(["check", broken]);
    expect(failed.code).toBe(1);
    expect(JSON.parse(failed.out)).toMatchObject({ ok: false, loads: false });
    const erring = join(home, "erring-world.json");
    writeFileSync(erring, JSON.stringify({ ...file, world: { ...file.world, pov: "nobody" } }));
    const linted = await cli(["check", erring]);
    expect(linted.code).toBe(1);
    expect(JSON.parse(linted.out)).toMatchObject({ ok: false, loads: true });
  });
});

describe("where sign-ins are kept", () => {
  test("XDG_CONFIG_HOME when absolute, ~/.config otherwise, %APPDATA% on Windows", () => {
    expect(credentialsPath({ XDG_CONFIG_HOME: "/x/cfg" }, "linux", "/home/t")).toBe("/x/cfg/lumirpengine/credentials.json");
    expect(credentialsPath({ XDG_CONFIG_HOME: "relative" }, "darwin", "/Users/t")).toBe("/Users/t/.config/lumirpengine/credentials.json");
    expect(credentialsPath({ APPDATA: "C:\\Users\\t\\AppData\\Roaming" }, "win32", "C:\\Users\\t")).toBe("C:\\Users\\t\\AppData\\Roaming\\lumirpengine\\credentials.json");
  });

  test("keyed by base URL as normalized; a broken file is named rather than overwritten", () => {
    expect(normalizeBase("HTTP://Lumi.Example:80/")).toBe("http://lumi.example");
    expect(normalizeBase("https://example.com/lumiverse/")).toBe("https://example.com/lumiverse");
    expect(() => normalizeBase("localhost:7860")).toThrow("isn't an http or https URL");
    const path = join(home, "broken.json");
    writeFileSync(path, "{ nope");
    const store = new CredentialStore({ read: (p) => readFileSync(p, "utf8"), write: () => undefined }, path);
    expect(() => store.bases()).toThrow(`${path} isn't readable JSON`);
  });
});
