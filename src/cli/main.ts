#!/usr/bin/env node
// lumirpengine: manage your LumiRPEngine worlds on Lumiverse from a shell, and the same as an MCP
// server (`mcp`) for agents. Built to dist/lumirpengine.js (plain Node 22+, no dependencies). This
// is the only file that touches the disk, the terminal, the network and the process; the
// extension's backend and frontend never import src/cli.

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { run } from "./commands";
import type { CliIO } from "./commands";
import type { Http, OpenSocket } from "./connection";
import { CredentialStore, credentialsPath } from "./credentials";
import type { CredentialFiles } from "./credentials";
import { lineServer } from "./mcp";

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
  ask,
  credentials: new CredentialStore(files, credentialsPath(process.env, process.platform, homedir())),
  http,
  openSocket,
};

const result = await run(process.argv.slice(2), io);
if ("mcp" in result) {
  const server = lineServer(result.mcp, (line) => {
    // Resolves once Node has taken the line, so the next waits its turn instead of piling up in memory.
    const { promise, resolve } = Promise.withResolvers<void>();
    process.stdout.write(`${line}\n`, () => resolve());
    return promise;
  });
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => server.feed(chunk));
  process.stdin.on("end", () => {
    void server.drain().then(() => result.close());
  });
} else {
  process.exitCode = result.code;
}
