// `rpe status`: what this RPE is, and whether it answers.

import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { currentKeys } from "../auth";
import type { CliIO } from "../cli";
import type { AppConfig, DataPaths } from "../config";
import { appliedMigrations } from "../migrations";
import { listSwitches } from "../switches";
import { runLine } from "./run-line";
import { serverAnswer, serverUrl } from "./running";
import { atWords } from "./words";
import { runningServer } from "./writer";

export async function statusCommand(paths: DataPaths, config: AppConfig, io: CliIO, version: string): Promise<number> {
  io.out(`RPE ${version}`);
  io.out(`Data folder: ${paths.root}`);
  const answer = await serverAnswer(config, io);
  io.out(`Listens on: ${serverUrl(config)}, ${answer === null ? "not answering" : "rpe" in answer ? `answering (RPE ${answer.rpe})` : `answering, but not as RPE (${answer.other})`}`);
  // Where RPE runs, it says its own keys, switches and builds; stopped, they are read from its database, which this process only reads.
  const running = await runningServer(paths, config, io);
  const said = running === null ? null : await running.ops.status();
  if (said !== null && said.builds !== null) io.out(`Builds: ${said.builds}`);
  io.out(`Lumiverse: ${config.lumiverse.url ?? "not set"}, for user ${config.lumiverse.user ?? "not set"}`);
  if (!existsSync(paths.database)) {
    io.out("Database: not made yet");
    return 0;
  }
  const db = new Database(paths.database, { readonly: true });
  try {
    const user = config.lumiverse.user;
    // Before the install names a user there is none whose tables to read.
    const applied = user === null ? new Map<string, Set<number>>() : appliedMigrations(db, user);
    const tables = [...applied].map(([area, versions]) => `${area} ${Math.max(...versions)}`).join(", ");
    io.out(`Database: ${(statSync(paths.database).size / 1048576).toFixed(1)} MiB; tables at ${tables === "" ? "none" : tables}`);
    if (user === null || !(applied.get("app")?.has(1) ?? false)) return 0;
    const keys = said !== null ? said.keys : currentKeys(db, user);
    const keyLines = (["provider", "extension", "web"] as const).flatMap((kind) => {
      const ofKind = keys.filter((k) => k.kind === kind);
      if (ofKind.length === 0) return [`${kind} none`];
      return ofKind.map((key) => {
        const made = new Date(key.made).toISOString().slice(0, 10);
        if (key.taken) return `${kind} taken from today's connection (taken ${made})`;
        // RPE keeps only the provider key's last four characters; the others it keeps by when they were made and end.
        if (kind === "provider") return `${kind} ends ${key.last4} (made ${made})`;
        return `${kind} made ${made}${kind === "extension" ? ", which RPE remakes at every start" : key.ends === null ? ", no end" : `, runs out ${atWords(key.ends)}`}`;
      });
    });
    io.out(`Keys: ${keyLines.join("; ")}`);
    const switches = said !== null ? said.switches : listSwitches(db, user);
    const waiting = switches.filter((s) => s.state === "waiting");
    io.out(`Switches: ${waiting.length} waiting, ${switches.filter((s) => s.state === "on").length} on, ${switches.filter((s) => s.state === "off").length} off`);
    for (const s of waiting) io.out(`  waiting: ${s.name} (${s.kind}) runs ${s.what}. Switch it on with: ${runLine(io, paths, "allow", s.name)}`);
  } finally {
    db.close();
  }
  return 0;
}
