#!/usr/bin/env bun
// `rpe`, RPEngine's own application (plan §4.4, §4.6): the process's entry. It hands the command line
// the real terminal, environment, network and signals; everything else is in cli.ts. Built for Bun.

import { homedir } from "node:os";
import { runCli } from "./cli";

/** A secret from the user: the first line piped in, or typed at the terminal without being shown. */
async function secret(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) {
    const first = (await Bun.stdin.text()).split(/\r?\n/)[0]?.trim() ?? "";
    return first === "" ? null : first;
  }
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

function stopped(): Promise<void> {
  const stop = Promise.withResolvers<void>();
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => stop.resolve());
  return stop.promise;
}

process.exitCode = await runCli(
  process.argv.slice(2),
  {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    env: process.env,
    home: homedir(),
    now: Date.now,
    secret,
    stopped,
    fetch: (url, init) => fetch(url, init),
  },
  // The build stamps its id here (scripts/build.ts); run from source, it is the development build.
  { version: process.env.LRE_BUILD_ID ?? "dev" },
);
