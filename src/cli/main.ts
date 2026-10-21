#!/usr/bin/env node
// lumirpengine's core (DESIGN §23): manage your LumiRPEngine worlds on Lumiverse from a shell, and
// the same as an MCP server (`mcp`) for agents. Built to dist/lumirpengine.js (plain Node 22+, no
// dependencies) beside its agent kit, dist/agent-kit.js, which holds every tool and runs the
// command line; `mcp` serves the kit's tools and follows the extension's own kit. This is the only
// file that touches the disk, the terminal, the network and the process; the extension's backend
// and frontend never import src/cli.

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { KIT_FILE } from "../shared/agents";
import type { CliIO } from "./commands";
import type { Http, OpenSocket } from "./connection";
import { CredentialStore, credentialsPath } from "./credentials";
import type { CredentialFiles } from "./credentials";
import type { KitFiles } from "./follow";
import { bundledKitOf } from "./kit-api";
import { McpSession, serveMcp } from "./serve";

const nodeMajor = Number((process.versions.node ?? "0").split(".")[0]);
// Bun reports a Node version too; only Node itself needs checking for its built-in WebSocket.
if (process.versions.bun === undefined && nodeMajor < 22) {
  process.stderr.write(`lumirpengine needs Node 22 or newer (this is Node ${process.versions.node}): it uses Node's built-in WebSocket and fetch.\n`);
  process.exit(1);
}

const files: CredentialFiles = {
  read(path) {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  },
  write(path, text) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // Written whole and moved into place, owner-only before it holds anything: a session token is a whole-account credential.
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, text, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, path);
  },
};

const http: Http = async (request) => {
  const response = await fetch(request.url, { method: request.method, headers: request.headers, ...(request.body !== undefined ? { body: request.body } : {}), redirect: "manual" });
  const text = await response.text();
  return { status: response.status, header: (name) => response.headers.get(name), text };
};

const openSocket: OpenSocket = (url, events) => {
  const ws = new WebSocket(url);
  ws.addEventListener("message", (event) => events.message(typeof event.data === "string" ? event.data : String(event.data)));
  ws.addEventListener("close", (event) => events.close(event.code, event.reason));
  // An error is followed by a close, which says what happened.
  ws.addEventListener("error", () => undefined);
  return { send: (text) => ws.send(text), close: () => ws.close() };
};

/** A question on the terminal, on stderr so stdout keeps only the answer's data; `hidden` echoes nothing. */
function ask(question: string, hidden: boolean): Promise<string | null> {
  const input = process.stdin;
  if (!input.isTTY) return Promise.resolve(null);
  const { promise, resolve } = Promise.withResolvers<string | null>();
  if (!hidden) {
    const rl = createInterface({ input, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.on("SIGINT", () => {
      rl.close();
      resolve(null);
    });
    return promise;
  }
  process.stderr.write(question);
  const typed: string[] = [];
  const done = (value: string | null): void => {
    input.setRawMode(false);
    input.pause();
    input.off("data", key);
    process.stderr.write("\n");
    resolve(value);
  };
  const key = (chunk: string): void => {
    for (const ch of chunk) {
      if (ch === "\r" || ch === "\n") return done(typed.join(""));
      if (ch === "\u0003") return done(null);
      if (ch === "\u0004") return done(typed.length > 0 ? typed.join("") : null);
      if (ch === "\u007f" || ch === "\b") typed.pop();
      else typed.push(ch);
    }
  };
  input.setEncoding("utf8");
  input.setRawMode(true);
  input.resume();
  input.on("data", key);
  return promise;
}

const io: CliIO = {
  out: (text) => process.stdout.write(text.endsWith("\n") ? text : `${text}\n`),
  err: (text) => process.stderr.write(text.endsWith("\n") ? text : `${text}\n`),
  readFile: (path) => readFileSync(path, "utf8"),
  writeFile: (path, text) => writeFileSync(path, text),
  env: process.env,
  stdoutIsTTY: Boolean(process.stdout.isTTY),
  ask,
  credentials: new CredentialStore(files, credentialsPath(process.env, process.platform, homedir())),
  http,
  openSocket,
};

/** Following's side of the disk (DESIGN §23): symlinks resolved, and owners as the files themselves say. */
const kitFiles: KitFiles = {
  realpath: (path) => realpath(path),
  async stat(path) {
    const entry = await lstat(path);
    return { uid: entry.uid, mode: entry.mode };
  },
  async read(path) {
    // Owner and bytes through one handle: they are one file's, whatever is renamed into its place meanwhile.
    const handle = await open(path, "r");
    try {
      const entry = await handle.stat();
      return { uid: entry.uid, mode: entry.mode, bytes: await handle.readFile() };
    } finally {
      await handle.close();
    }
  },
  // Owners and mode bits are POSIX's: Windows gives neither to check.
  uid: process.platform === "win32" ? null : (process.getuid?.() ?? null),
};

// The kit beside this file (src/cli/agent-kit.ts when run from source, which Bun resolves): a
// bundle of its own, imported at run time, since a static import would bundle every tool into the core.
const kit = bundledKitOf(await import(new URL(KIT_FILE, import.meta.url).href));
if (typeof kit === "string") {
  process.stderr.write(`lumirpengine's agent kit (${KIT_FILE}, beside ${import.meta.url}) can't run: ${kit}. Install lumirpengine again.\n`);
  process.exit(1);
}

const result = await kit.run(process.argv.slice(2), io);
if ("mcp" in result) {
  const session = new McpSession({ bundled: kit, mcp: result.mcp, io, files: kitFiles, host: hostname(), log: (text) => process.stderr.write(`${text}\n`) });
  const server = serveMcp(session, (line) => {
    // Resolves once Node has taken the line, so the next waits its turn instead of piling up in memory.
    const { promise, resolve } = Promise.withResolvers<void>();
    process.stdout.write(`${line}\n`, () => resolve());
    return promise;
  });
  session.start();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => server.feed(chunk));
  process.stdin.on("end", () => {
    void server.drain().then(() => session.close());
  });
} else {
  process.exitCode = result.code;
}
