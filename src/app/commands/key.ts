// `rpe key`: a new key of a kind, shown once.

import type { CliIO } from "../cli";
import type { KeyKind } from "../auth";
import type { AppConfig, DataPaths } from "../config";
import { UsageError } from "./args";
import { atWords } from "./words";
import { withWriter } from "./writer";

/** The keys a command makes, and what to do with each. The extension's is made by RPE at every start, and handed over. */
const KEY_WORDS = {
  provider: "Put it in RPE's connection in Lumiverse as its API key.",
  web: "Sign in to RPE's web UI with it.",
} as const satisfies Partial<Record<KeyKind, string>>;

export async function keyCommand(words: readonly string[], paths: DataPaths, config: AppConfig, io: CliIO, version: string): Promise<number> {
  const kind = words[0] ?? "provider";
  if (kind === "extension") throw new Error("RPE makes its extension's key itself at every start and hands it over, so a key made by hand would cut the extension off until RPE starts again: there is no command for it. rpe key takes provider and web.");
  // The provider key taken from today's connection is retired only when asked: going back needs that connection as it is.
  const all = kind === "provider" && words[1] === "all";
  if (!Object.hasOwn(KEY_WORDS, kind) || words.length > (all ? 2 : 1)) throw new UsageError("rpe key takes provider or web, and provider may take all.");
  const made = await withWriter({ paths, config, io, version, what: "rpe key" }, (ops) => ops.makeKey({ kind: kind as keyof typeof KEY_WORDS, ...(all ? { all } : {}) }), { forUser: true });
  io.out(`A new ${kind} key for this RPE. It is shown this once; RPE keeps only its hash.`);
  io.out("");
  io.out(`  ${made.key}`);
  io.out("");
  io.out(KEY_WORDS[kind as keyof typeof KEY_WORDS]);
  if (made.kind === "web") {
    io.out(made.ends === null ? "It has no end: it works until a new web key replaces it." : `It works until ${atWords(made.ends)}.`);
  }
  io.out(`The ${kind} key made before it, if there was one, no longer works.`);
  if (made.retired > 0) io.out("Nor does the key of today's connection in Lumiverse, which RPE took over at the swap: that connection now needs this new key as its API key. Going back to the previous build then needs that connection's earlier key put back in it.");
  else if (made.takenStays) io.out(`Today's connection in Lumiverse, which RPE took over at the swap, keeps its own key, and it goes on working: leave that connection as it is, since going back needs it. To stop that key too, run rpe key provider all.`);
  return 0;
}
