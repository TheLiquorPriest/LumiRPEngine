// What `bun run build` left in dist/, checked as it ships: the application starts from a folder that
// holds nothing else and says its build id; copied to a folder of its own with what a server needs of
// dist/ and nothing more, it serves its status from a data folder of its own; the extension's backend
// holds nothing Lumiverse's install scan refuses; and no built file holds this machine's home path,
// its name, or a key.

import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { join, relative } from "node:path";
import { DIST, OUT, SERVER } from "../../scripts/build";
import { installScan } from "../../scripts/install-scan";
import { STATUS_PATH } from "../../src/app/app";

const APP = join(DIST, OUT.app);
/** How long the built application may take to say where it listens. */
const START_MS = 10_000;

const folders: string[] = [];
function folder(prefix: string): string {
  const made = mkdtempSync(join(tmpdir(), prefix));
  folders.push(made);
  return made;
}
afterAll(() => {
  for (const made of folders) rmSync(made, { recursive: true, force: true });
});

/** The build id the built application says it is, run from a folder that holds nothing but it. */
function versionAlone(): { code: number; out: string; err: string } {
  if (!existsSync(APP)) throw new Error(`${relative(process.cwd(), APP)} is not there: run \`bun run build\``);
  const alone = folder("rpe-alone-");
  copyFileSync(APP, join(alone, OUT.app));
  const ran = Bun.spawnSync([process.execPath, OUT.app, "--version"], { cwd: alone, env: { PATH: process.env.PATH ?? "" }, stdout: "pipe", stderr: "pipe" });
  return { code: ran.exitCode, out: ran.stdout.toString().trim(), err: ran.stderr.toString().trim() };
}

/** The first match of `pattern` in what `stream` says, or null once it ends or `ms` have passed. */
async function said(stream: ReadableStream<Uint8Array>, pattern: RegExp, ms: number): Promise<RegExpExecArray | null> {
  const reader = stream.getReader();
  // A deadline on a real child process, which fake time can't drive; the wait itself is for its line.
  const timer = setTimeout(() => void reader.cancel(), ms);
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      text += decoder.decode(value, { stream: true });
      const match = pattern.exec(text);
      if (match !== null) return match;
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

/** Every file under `dir`. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

const quoted = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Credentials by their shapes: the providers' keys, a cloud's, a code host's, a private key, and RPE's own keys and page tokens. */
const KEYS: readonly (readonly [kind: string, shape: RegExp])[] = [
  ["an Anthropic key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["an OpenAI-style key", /\bsk-(?:proj-|svcacct-|admin-|or-v1-)?[A-Za-z0-9_-]{20,}/],
  ["a Google key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["a GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/],
  ["an AWS key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["a Hugging Face token", /\bhf_[A-Za-z0-9]{30,}\b/],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["an RPE key", /\brp[epwx]_[0-9a-f]{64}\b/],
];

describe("dist/, as built", () => {
  test("the application starts from a folder that holds nothing else, and says its build id", () => {
    expect(versionAlone()).toEqual({ code: 0, out: expect.stringMatching(/^rpe (?:[0-9a-f]{8,}(?:-dirty\.\d+)?|\d+)$/), err: "" });
  });

  test("what a server needs of dist/, copied alone, serves the application's status from a data folder of its own, and stops when told to", async () => {
    const id = versionAlone().out.slice("rpe ".length);
    const server = folder("rpe-server-");
    // The pages are left out of a build made with --no-pages.
    for (const name of SERVER) if (existsSync(join(DIST, name))) cpSync(join(DIST, name), join(server, name), { recursive: true });
    const data = folder("rpe-data-");
    // Nothing of this machine's environment: no Lumiverse to reach, no data folder but the one given, any free port.
    const proc = Bun.spawn([process.execPath, join(server, OUT.app), "serve", "--data", data], { cwd: server, env: { PATH: process.env.PATH ?? "", HOME: data, RPE_PORT: "0" }, stdout: "pipe", stderr: "pipe" });
    try {
      const listening = await said(proc.stdout, /listens on (http:\/\/\S+) \(/, START_MS);
      expect({ listening: listening !== null, err: listening === null ? await new Response(proc.stderr).text() : "" }).toEqual({ listening: true, err: "" });
      const answer = await fetch(new URL(STATUS_PATH, listening?.[1]));
      expect({ status: answer.status, body: await answer.json() }).toEqual({ status: 200, body: expect.objectContaining({ name: "rpe", version: id }) });
    } finally {
      proc.kill("SIGTERM");
    }
    expect(await proc.exited).toBe(0);
  });

  test("the extension's backend holds nothing Lumiverse's install scan refuses", () => {
    expect(installScan(readFileSync(join(DIST, OUT.backend), "utf8"))).toEqual([]);
  });

  test("no built file holds this machine's home path, its name, or a key", () => {
    const me = userInfo().username;
    const homes = [...new Set([homedir(), `/${"Users"}/${me}`, `/home/${me}`])];
    // A machine's name as only a machine's name is written: its local network name, a URL's host, user@host, and the whole name where it has a domain.
    const host = hostname();
    const name = quoted(host.split(".")[0] ?? host);
    const machine = [new RegExp(`(?<![A-Za-z0-9-])${name}\\.local\\b`, "i"), new RegExp(`//${name}(?=[:/])`, "i"), new RegExp(`(?<=[A-Za-z0-9._-])@${name}(?![A-Za-z0-9-])`, "i"), ...(host.includes(".") ? [new RegExp(`(?<![A-Za-z0-9-])${quoted(host)}(?![A-Za-z0-9-])`, "i")] : [])];
    const files = filesUnder(DIST);
    expect(files.length).toBeGreaterThan(0);
    const held: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const at = relative(DIST, file);
      // Which file and what kind, never the text found: the report would hold it.
      if (homes.some((home) => text.includes(home))) held.push(`${at}: a home path`);
      if (machine.some((shape) => shape.test(text))) held.push(`${at}: this machine's name`);
      for (const [kind, shape] of KEYS) if (shape.test(text)) held.push(`${at}: ${kind}`);
    }
    expect(held).toEqual([]);
  });
});
