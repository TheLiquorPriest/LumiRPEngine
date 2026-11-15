#!/usr/bin/env bun
// `rpe`, RPEngine's own application (plan §4.4, §4.6): the process's entry. It hands the command line
// the real terminal, environment, network and signals; everything else is in cli.ts. Built for Bun.

import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { runCli } from "./cli";
import { invokedAs } from "./commands/run-line";
import { compose } from "./compose";

/** The lines piped in, read once and handed out one for each question, so a username and a password can arrive on one input. */
let piped: string[] | null = null;

async function nextPiped(): Promise<string | null> {
  piped ??= (await Bun.stdin.text()).split(/\r?\n/);
  const line = piped.shift()?.trim() ?? "";
  return line === "" ? null : line;
}

/** A secret from the user: the next line piped in, or typed at the terminal without being shown. */
async function secret(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) return await nextPiped();
  process.stderr.write(question);
  const stdin = process.stdin;
  const answered = Promise.withResolvers<string | null>();
  let typed = "";
  const onData = (chunk: string): void => {
    for (const ch of chunk) {
      // Enter gives the key; Ctrl-C and Ctrl-D give up.
      const done = ch === "\r" || ch === "\n" ? typed : ch === "\u0003" || ch === "\u0004" ? null : undefined;
      if (done !== undefined) {
        stdin.off("data", onData);
        stdin.setRawMode(false);
        stdin.pause();
        process.stderr.write("\n");
        answered.resolve(done === "" ? null : done);
        return;
      }
      typed = ch === "\u007f" || ch === "\b" ? typed.slice(0, -1) : typed + ch;
    }
  };
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.on("data", onData);
  stdin.resume();
  return await answered.promise;
}

/** A line from the user: the next line piped in, or typed at the terminal and shown as typed. */
async function ask(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) return await nextPiped();
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await terminal.question(question)).trim();
    return answer === "" ? null : answer;
  } finally {
    terminal.close();
  }
}

function stopped(): Promise<void> {
  const stop = Promise.withResolvers<void>();
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => stop.resolve());
  return stop.promise;
}

// RPE's worker threads run this file too (src/app/workers/pool.ts): there it serves tasks, and starts no command line.
if (Bun.isMainThread) process.exitCode = await runCli(
  process.argv.slice(2),
  {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    env: process.env,
    home: homedir(),
    now: Date.now,
    secret,
    ask,
    stopped,
    fetch: (url, init) => fetch(url, init),
    invoked: invokedAs(process.execPath, Bun.main),
  },
  // The build stamps its id here (scripts/build.ts); run from source, it is the development build. The
  // app file is this one: the file `rpe up`'s service runs, which an update of the extension replaces.
  { version: process.env.LRE_BUILD_ID ?? "dev", areas: compose().areas, appFile: Bun.main, host: { platform: process.platform, uid: process.getuid?.() ?? null, bun: process.execPath } },
);
