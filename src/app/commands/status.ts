// `rpe status`: what this RPE is, and whether it answers.

import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { isRecord } from "../../shared/json";
import { BUILDS_PATH } from "../app";
import { currentKeys, insertPageToken, keyEnds, secretHash } from "../auth";
import type { CliIO } from "../cli";
import type { AppConfig, DataPaths } from "../config";
import { openDatabase } from "../database";
import { appliedMigrations } from "../migrations";
import { listSwitches } from "../switches";
import { serverAnswer, serverUrl } from "./running";
import { atWords, webKeyMs } from "./words";

/**
 * The running server's builds in its words, a page's to read: asked with a token the command line
 * makes for this one call and lets go after. Null where none can be made (no database or owner yet) or
 * the server does not say.
 */
async function buildsWords(paths: DataPaths, config: AppConfig, io: CliIO): Promise<string | null> {
  const owner = config.lumiverse.user;
  if (owner === null || !existsSync(paths.database)) return null;
  const db = openDatabase(paths.database, config.database.busyMs);
  try {
    if (!(appliedMigrations(db).get("app")?.has(1) ?? false)) return null;
    const token = db.transaction(() => insertPageToken(db, owner, "command line", config.auth.commandLineSeconds * 1000, io.now())).immediate();
    try {
      const res = await io.fetch(`${serverUrl(config)}${BUILDS_PATH}`, { headers: { authorization: `Bearer ${token.token}` }, signal: AbortSignal.timeout(config.commandLine.waitMs) });
      const body: unknown = await res.json().catch(() => null);
      return res.ok && isRecord(body) && isRecord(body.builds) && typeof body.builds.words === "string" ? body.builds.words : null;
    } catch {
      return null;
    } finally {
      db.run("DELETE FROM page_token WHERE hash = ?", [secretHash(token.token)]);
    }
  } finally {
    db.close();
  }
}

export async function statusCommand(paths: DataPaths, config: AppConfig, io: CliIO, version: string): Promise<number> {
  io.out(`RPE ${version}`);
  io.out(`Data folder: ${paths.root}`);
  const answer = await serverAnswer(config, io);
  io.out(`Listens on: ${serverUrl(config)}, ${answer === null ? "not answering" : "rpe" in answer ? `answering (RPE ${answer.rpe})` : `answering, but not as RPE (${answer.other})`}`);
  const builds = answer !== null && "rpe" in answer ? await buildsWords(paths, config, io) : null;
  if (builds !== null) io.out(`Builds: ${builds}`);
  io.out(`Lumiverse: ${config.lumiverse.url ?? "not set"}, for user ${config.lumiverse.user ?? "not set"}`);
  if (!existsSync(paths.database)) {
    io.out("Database: not made yet");
    return 0;
  }
  const db = new Database(paths.database, { readwrite: true, create: false });
  try {
    const applied = appliedMigrations(db);
    const tables = [...applied].map(([area, versions]) => `${area} ${Math.max(...versions)}`).join(", ");
    io.out(`Database: ${(statSync(paths.database).size / 1048576).toFixed(1)} MiB; tables at ${tables === "" ? "none" : tables}`);
    if (!(applied.get("app")?.has(1) ?? false)) return 0;
    const keys = currentKeys(db);
    const keyLines = (["provider", "extension", "web"] as const).flatMap((kind) => {
      const ofKind = keys.filter((k) => k.kind === kind);
      if (ofKind.length === 0) return [`${kind} none`];
      return ofKind.map((key) => {
        const made = new Date(key.made).toISOString().slice(0, 10);
        if (key.last4 === "") return `${kind} taken from today's connection (taken ${made})`;
        const ends = keyEnds(kind, key.made, webKeyMs(config));
        return `${kind} ends ${key.last4} (made ${made}${kind !== "web" ? "" : ends === null ? ", no end" : `, runs out ${atWords(ends)}`})`;
      });
    });
    io.out(`Keys: ${keyLines.join("; ")}`);
    const switches = listSwitches(db);
    const waiting = switches.filter((s) => s.state === "waiting");
    io.out(`Switches: ${waiting.length} waiting, ${switches.filter((s) => s.state === "on").length} on, ${switches.filter((s) => s.state === "off").length} off`);
    for (const s of waiting) io.out(`  waiting: ${s.name} (${s.kind}) runs ${s.what}. Switch it on with: rpe allow ${s.name}`);
  } finally {
    db.close();
  }
  return 0;
}
