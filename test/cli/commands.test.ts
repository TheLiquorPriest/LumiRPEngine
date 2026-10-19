// The commands as the entry runs them (`run`), over a fake Lumiverse and sign-ins kept in memory:
// what each refuses before anything is sent, what a running `mcp` server does when the sign-in
// changes under it, and what logout says when the host didn't confirm.

import { describe, expect, test } from "bun:test";
import type { CliIO, RunResult } from "../../src/cli/commands";
import { run } from "../../src/cli/commands";
import type { Http } from "../../src/cli/connection";
import { CredentialStore } from "../../src/cli/credentials";
import type { McpServer } from "../../src/cli/mcp";
import { templateFile } from "../../src/cli/offline";
import { isRecord } from "../../src/shared/json";
import { FakeLumiverse, USER } from "./fake-lumiverse";

interface Terminal {
  io: CliIO;
  out: string[];
  err: string[];
  /** Every question asked at the prompt. */
  asked: string[];
}

/** A terminal with nobody at it (every prompt answers nothing), stdout a terminal too (unpiped), and a credentials file of its own; `files` are the files it can read. */
function terminal(fake: FakeLumiverse, options: { env?: Record<string, string>; http?: Http; files?: Record<string, string> } = {}): Terminal {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  let saved: string | null = null;
  const files = options.files ?? {};
  const io: CliIO = {
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
    readFile: (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
      return text;
    },
    writeFile: () => undefined,
    env: options.env ?? {},
    stdoutIsTTY: true,
    ask: async (question) => {
      asked.push(question);
      return null;
    },
    credentials: new CredentialStore(
      {
        read: () => saved,
        write: (_path, text) => {
          saved = text;
        },
      },
      "credentials.json",
    ),
    http: options.http ?? fake.http,
    openSocket: fake.openSocket,
  };
  return { io, out, err, asked };
}

function serverOf(result: RunResult): { mcp: McpServer; close(): void } {
  if (!("mcp" in result)) throw new Error(`mcp didn't start: exit ${result.code}`);
  return result;
}

async function call(mcp: McpServer, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const reply = await mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const result = reply !== null && !Array.isArray(reply) && isRecord(reply.result) ? reply.result : {};
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  return { text: isRecord(first) && typeof first.text === "string" ? first.text : JSON.stringify(reply), isError: result.isError === true };
}

async function toolNames(mcp: McpServer): Promise<string[]> {
  const reply = await mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const tools = reply !== null && !Array.isArray(reply) && isRecord(reply.result) && Array.isArray(reply.result.tools) ? reply.result.tools : [];
  return tools.flatMap((t) => (isRecord(t) && typeof t.name === "string" ? [t.name] : []));
}

/** The routes asked, in order, as "METHOD /path". */
const routes = (fake: FakeLumiverse): string[] => fake.requests.map((r) => `${r.method} ${new URL(r.url).pathname}`);

describe("a running mcp server", () => {
  test("uses the sign-in saved last: after the session ends and the user signs in again, it works without a restart", async () => {
    const fake = new FakeLumiverse();
    fake.lre.seed("Alpha");
    const t = terminal(fake);
    const first = fake.session();
    t.io.credentials.put(fake.base, { username: USER.username, token: first, savedAt: 1 });
    const server = serverOf(await run(["mcp"], t.io));
    expect((await call(server.mcp, "lre_worlds")).isError).toBe(false);
    // The session ends on the host (unused for 7 days, or signed out), and the socket with it.
    fake.tokens.delete(first);
    fake.restart();
    const ended = await call(server.mcp, "lre_worlds");
    expect(ended.isError).toBe(true);
    expect(ended.text).toContain("Sign in again: lumirpengine login");
    // What that says to do, from another terminal.
    t.io.credentials.put(fake.base, { username: USER.username, token: fake.session(), savedAt: 2 });
    const again = await call(server.mcp, "lre_worlds");
    expect(again.isError).toBe(false);
    expect(JSON.parse(again.text).worlds).toHaveLength(1);
    server.close();
  });

  test("refuses to start on an option it doesn't take or an unclear LRE_READ_ONLY, rather than serve the write tools", async () => {
    const fake = new FakeLumiverse();
    // A misspelled --read-only once took the next argument as its value, and mcp checked nothing.
    for (const argv of [["mcp", "--readonly", "--url", fake.base], ["mcp", "--read_only", `--url=${fake.base}`], ["mcp", "--read-only=false"], ["mcp", "read-only"]]) {
      const t = terminal(fake);
      expect(await run(argv, t.io)).toEqual({ code: 2 });
      expect(t.err).not.toEqual([]);
    }
    for (const value of ["maybe", "2", "enabled"]) {
      const t = terminal(fake, { env: { LRE_READ_ONLY: value } });
      expect(await run(["mcp"], t.io)).toEqual({ code: 2 });
      expect(t.err.join("\n")).toContain(`LRE_READ_ONLY is "${value}"`);
    }
    expect(fake.requests).toEqual([]);
  });

  test("reads LRE_READ_ONLY in any case: TRUE, Yes and on hide the write tools as --read-only does", async () => {
    const fake = new FakeLumiverse();
    const cases: [string, boolean][] = [
      ["TRUE", true],
      ["Yes", true],
      [" on ", true],
      ["1", true],
      ["0", false],
      ["Off", false],
      ["", false],
    ];
    for (const [value, readOnly] of cases) {
      const server = serverOf(await run(["mcp"], terminal(fake, { env: { LRE_READ_ONLY: value } }).io));
      const names = await toolNames(server.mcp);
      expect([value, names.includes("lre_edit"), names.includes("lre_world_delete")]).toEqual([value, !readOnly, !readOnly]);
      server.close();
    }
    const flagged = serverOf(await run(["mcp", "--read-only"], terminal(fake).io));
    expect(await toolNames(flagged.mcp)).not.toContain("lre_edit");
    flagged.close();
  });
});

describe("check in a terminal", () => {
  test("prints the report and exits 1 on a world that fails, unpiped as when piped, and 0 on a clean one", async () => {
    const file = templateFile("mystery_manor") as { world: Record<string, unknown> };
    const files = { "clean.json": JSON.stringify(file), "broken.json": "{ nope", "erring.json": JSON.stringify({ ...file, world: { ...file.world, pov: "nobody" } }) };
    const cases: [string, number, Record<string, unknown>][] = [
      ["clean.json", 0, { ok: true, loads: true }],
      ["broken.json", 1, { ok: false, loads: false }],
      ["erring.json", 1, { ok: false, loads: true }],
    ];
    for (const [path, code, report] of cases) {
      const t = terminal(new FakeLumiverse(), { files });
      expect(t.io.stdoutIsTTY).toBe(true);
      expect([path, await run(["check", path], t.io)]).toEqual([path, { code }]);
      expect(JSON.parse(t.out.join("\n"))).toMatchObject(report);
    }
  });
});

describe("read-only on the command line", () => {
  test("LRE_READ_ONLY=Yes refuses a change before anything is sent", async () => {
    const fake = new FakeLumiverse();
    const t = terminal(fake, { env: { LRE_READ_ONLY: "Yes" } });
    t.io.credentials.put(fake.base, { username: USER.username, token: fake.session(), savedAt: 1 });
    expect(await run(["create", "Beta"], t.io)).toEqual({ code: 1 });
    expect(t.err.join("\n")).toContain("read-only");
    expect(fake.requests).toEqual([]);
    expect(fake.lre.worlds.size).toBe(0);
  });
});

describe("login over plain http", () => {
  test("to another machine, is refused without --allow-http before anything is sent or asked", async () => {
    const fake = new FakeLumiverse("http://lumi.example:7860");
    const t = terminal(fake, { env: { LUMIVERSE_PASSWORD: USER.password } });
    expect(await run(["login", "--url", fake.base, "--username", USER.username], t.io)).toEqual({ code: 2 });
    expect(t.err.join("\n")).toContain("sign in with --allow-http");
    expect(fake.requests).toEqual([]);
    expect(t.io.credentials.bases()).toEqual([]);
  });

  test("with --allow-http, warns, asks the host as nobody before the password goes, and saves the consent for later commands", async () => {
    const fake = new FakeLumiverse("http://lumi.example:7860");
    fake.lre.seed("Alpha");
    const t = terminal(fake, { env: { LUMIVERSE_PASSWORD: USER.password } });
    expect(await run(["login", "--url", fake.base, "--username", USER.username, "--allow-http"], t.io)).toEqual({ code: 0 });
    expect(t.err.join("\n")).toContain(`Warning: ${fake.base} is plain http`);
    expect(routes(fake).slice(0, 2)).toEqual(["GET /api/auth/get-session", "POST /api/auth/sign-in/username"]);
    expect(fake.requests[0]?.headers.Authorization).toBeUndefined();
    expect(t.io.credentials.get(fake.base)).toMatchObject({ username: USER.username, allowHttp: true });
    // Saved with the sign-in, so neither this nor `mcp` needs the flag again.
    expect(await run(["worlds"], t.io)).toEqual({ code: 0 });
    expect(JSON.parse(t.out.at(-1) ?? "{}").worlds).toHaveLength(1);
  });

  test("a sign-in saved without the consent is refused there, and its token isn't sent", async () => {
    const fake = new FakeLumiverse("http://lumi.example:7860");
    const t = terminal(fake);
    t.io.credentials.put(fake.base, { username: USER.username, token: fake.session(), savedAt: 1 });
    expect(await run(["worlds"], t.io)).toEqual({ code: 1 });
    expect(t.err.join("\n")).toContain(`lumirpengine login --url ${fake.base} --allow-http`);
    expect(fake.requests).toEqual([]);
  });

  test("a host that redirects to https, or locks the address out, stops login before the password is asked or sent", async () => {
    const fake = new FakeLumiverse("http://lumi.example");
    const toHttps: Http = async (req) => {
      fake.requests.push(req);
      return { status: 301, header: (name) => (name.toLowerCase() === "location" ? `https://lumi.example${new URL(req.url).pathname}` : null), text: "" };
    };
    const redirected = terminal(fake, { http: toHttps });
    expect(await run(["login", "--url", fake.base, "--allow-http"], redirected.io)).toEqual({ code: 1 });
    expect(redirected.err.join("\n")).toContain("answers on https: use lumirpengine login --url https://lumi.example,");
    expect(redirected.asked).toEqual([]);
    const locked: Http = async (req) => {
      fake.requests.push(req);
      return { status: 429, header: (name) => (name.toLowerCase() === "retry-after" ? "1800" : null), text: JSON.stringify({ error: "Too many failed login attempts" }) };
    };
    const lockedOut = terminal(fake, { http: locked });
    expect(await run(["login", "--url", fake.base, "--allow-http"], lockedOut.io)).toEqual({ code: 1 });
    expect(lockedOut.err.join("\n")).toContain("for about 30 minutes");
    expect(lockedOut.asked).toEqual([]);
    expect(routes(fake)).toEqual(["GET /api/auth/get-session", "GET /api/auth/get-session"]);
  });
});

describe("logout", () => {
  test("says the session ended when the host confirms it", async () => {
    const fake = new FakeLumiverse();
    const t = terminal(fake);
    const token = fake.session();
    t.io.credentials.put(fake.base, { username: USER.username, token, savedAt: 1 });
    expect(await run(["logout"], t.io)).toEqual({ code: 0 });
    expect(t.out.join("\n")).toContain("Lumiverse ended the session");
    expect(fake.tokens.has(token)).toBe(false);
    expect(t.io.credentials.bases()).toEqual([]);
  });

  test("when the host doesn't confirm, says plainly that the session stays valid until it expires", async () => {
    const fake = new FakeLumiverse();
    const failing: [string, Http][] = [
      ["answered 502", async (req) => (req.url.endsWith("/api/auth/sign-out") ? { status: 502, header: () => null, text: "Bad Gateway" } : fake.http(req))],
      [
        "couldn't be reached",
        async () => {
          throw new Error("connect ECONNREFUSED");
        },
      ],
    ];
    for (const [what, http] of failing) {
      const t = terminal(fake, { http });
      const token = fake.session();
      t.io.credentials.put(fake.base, { username: USER.username, token, savedAt: 1 });
      expect(await run(["logout"], t.io)).toEqual({ code: 1 });
      expect(t.err.join("\n")).toContain(`${what}`);
      expect(t.err.join("\n")).toContain("didn't confirm the sign-out, so the session is still valid there");
      expect(t.err.join("\n")).toContain("until it expires");
      expect(t.io.credentials.bases()).toEqual([]);
      expect(fake.tokens.has(token)).toBe(true);
    }
  });
});
