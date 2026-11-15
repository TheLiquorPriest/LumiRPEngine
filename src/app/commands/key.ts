// `rpe key`: a new key of a kind, shown once.

import type { CliIO } from "../cli";
import type { KeyKind } from "../auth";
import { currentKeys, insertKey, keyEnds, retireTakenKeys } from "../auth";
import type { AppConfig, DataPaths } from "../config";
import { UsageError } from "./args";
import { commandLineDatabase } from "./database";
import { atWords, webKeyMs } from "./words";

const KEY_WORDS: Readonly<Record<KeyKind, string>> = {
  provider: "Put it in RPE's connection in Lumiverse as its API key.",
  extension: "Give it to the light extension as its registration with this RPE.",
  web: "Sign in to RPE's web UI with it.",
};

export function keyCommand(words: readonly string[], paths: DataPaths, config: AppConfig, io: CliIO, version: string): number {
  const kind = words[0] ?? "provider";
  // The provider key taken from today's connection is retired only when asked: going back needs that connection as it is.
  const all = kind === "provider" && words[1] === "all";
  if (!Object.hasOwn(KEY_WORDS, kind) || words.length > (all ? 2 : 1)) throw new UsageError("rpe key takes provider, extension or web, and provider may take all.");
  const db = commandLineDatabase(paths, config, version, io.now);
  try {
    const { made, retired } = db.transaction(() => ({ made: insertKey(db, kind as KeyKind, io.now()), retired: all ? retireTakenKeys(db, "provider", io.now()) : 0 })).immediate();
    io.out(`A new ${kind} key for this RPE. It is shown this once; RPE keeps only its hash.`);
    io.out("");
    io.out(`  ${made.key}`);
    io.out("");
    io.out(KEY_WORDS[kind as KeyKind]);
    if (made.kind === "web") {
      const ends = keyEnds("web", made.made, webKeyMs(config));
      io.out(ends === null ? "It has no end: it works until a new web key replaces it." : `It works until ${atWords(ends)}.`);
    }
    io.out(`The ${kind} key made before it, if there was one, no longer works.`);
    if (retired > 0) io.out("Nor does the key of today's connection in Lumiverse, which RPE took over at the swap: that connection now needs this new key as its API key. Going back to the previous build then needs that connection's earlier key put back in it.");
    else if (currentKeys(db).some((k) => k.kind === kind && k.last4 === "")) io.out(`Today's connection in Lumiverse, which RPE took over at the swap, keeps its own key, and it goes on working: leave that connection as it is, since going back needs it. To stop that key too, run rpe key provider all.`);
  } finally {
    db.close();
  }
  return 0;
}
