// `rpe status`: what this RPE is, and whether it answers.

import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { appCopyPlaces, fellBackWords, recordedSource } from "../app-copy";
import { currentKeys } from "../auth";
import type { CliIO } from "../cli";
import type { AppConfig, DataPaths } from "../config";
import { appliedMigrations } from "../migrations";
import { accountSystemctl, rpeServiceOf } from "../up";
import { listAllSwitches } from "../switches";
import { runLine } from "./run-line";
import { serverAnswer, serverUrl } from "./running";
import { atWords, STOPPED_LISTING } from "./words";
import { runningServer } from "./writer";
import { runtimeFoldersOf } from "../../migrate/runtime-folders";

/** Whether RPE's service is installed, and if so whether it runs, stopped at its start limit, or stopped otherwise; and whether it fell back to the known-good copy. */
async function serviceLines(paths: DataPaths, io: CliIO): Promise<string[]> {
  const service = await rpeServiceOf(paths.root, io.env, io.home);
  if (service === null) return [`Service: not installed: RPE runs where ${runLine(io, paths, "serve")} starts it, or ${runLine(io, paths, "up")} installs it as a service.`];
  const ran = await accountSystemctl(io.env, process.getuid?.() ?? null)(["show", "--property=ActiveState,SubState,Result", service.unit]);
  const fields = new Map(ran.out.split("\n").flatMap((line) => (line.includes("=") ? [[line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as const] : [])));
  const state = fields.get("ActiveState");
  const lines: string[] = [];
  if (ran.code !== 0 || state === undefined) lines.push(`Service: ${service.unit} is installed; its state could not be asked${ran.err === "" ? "" : ` (${ran.err.trim()})`}.`);
  else if (state === "active") lines.push(`Service: ${service.unit} is running.`);
  else if (fields.get("Result") === "start-limit-hit") lines.push(`Service: ${service.unit} is stopped at its start limit: its manager gave up starting it. Find why in its journal, then start it again with ${runLine(io, paths, "up")}.`);
  else lines.push(`Service: ${service.unit} is installed and not running (${state}${fields.get("SubState") === undefined ? "" : `, ${fields.get("SubState")}`}).`);
  const fell = await fellBackWords(appCopyPlaces(paths.root));
  if (fell !== null) lines.push(`Service: ${fell}`);
  return lines;
}

export async function statusCommand(paths: DataPaths, config: AppConfig, io: CliIO, version: string): Promise<number> {
  io.out(`RPE ${version}`);
  io.out(`Data folder: ${paths.root}`);
  const answer = await serverAnswer(config, io);
  io.out(`Listens on: ${serverUrl(config)}, ${answer === null ? "not answering" : "rpe" in answer ? `answering (RPE ${answer.rpe})` : `answering, but not as RPE (${answer.other})`}`);
  // Where RPE runs, it says its own keys, switches and builds; stopped, they are read from its database, which this process only reads.
  const running = await runningServer(paths, config, io);
  const said = running === null ? null : await running.ops.status();
  for (const line of await serviceLines(paths, io)) io.out(line);
  if (said !== null && said.builds !== null) io.out(`Builds: ${said.builds}`);
  // The one file an update of RPE's installed copy comes from: where `rpe up` ran from.
  const source = await recordedSource(paths.root);
  if (source !== null) io.out(`Updates come from: ${source}`);
  io.out(`Lumiverse: ${config.lumiverse.url ?? "not set"}, for user ${config.lumiverse.user ?? "not set"}`);
  // The folders of the previous build's runtime that `rpe up` and `rpe migrate` read, as XDG_CONFIG_HOME and XDG_DATA_HOME decide them, so they can be checked before a step.
  const runtime = runtimeFoldersOf(io.env, io.home);
  const there = (folder: string): string => `${folder} (${existsSync(folder) ? "there" : "not there"})`;
  io.out(`Previous build's runtime, read by rpe up and rpe migrate: config ${there(runtime.configDir)}, data ${there(runtime.dataDir)}; --runtime-config and --runtime-data name others.`);
  if (!existsSync(paths.database)) {
    io.out("Database: not made yet");
    return 0;
  }
  const db = new Database(paths.database, { readonly: true });
  try {
    const user = config.lumiverse.user;
    const applied = appliedMigrations(db);
    const tables = [...applied].map(([area, versions]) => `${area} ${Math.max(...versions)}`).join(", ");
    io.out(`Database: ${(statSync(paths.database).size / 1048576).toFixed(1)} MiB; tables at ${tables === "" ? "none" : tables}`);
    if (user === null || !(applied.get("app")?.has(1) ?? false)) return 0;
    const keys = said !== null ? said.keys : currentKeys(db, user);
    const keyLines = (["provider", "extension", "web"] as const).flatMap((kind) => {
      const ofKind = keys.filter((k) => k.kind === kind);
      if (ofKind.length === 0) return [`${kind} none`];
      return ofKind.map((key) => {
        const made = new Date(key.made).toISOString().slice(0, 10);
        if (key.taken) return `${kind} taken from the previous build's connection (taken ${made})`;
        // RPE keeps only the provider key's last four characters; the others it keeps by when they were made and end.
        if (kind === "provider") return `${kind} ends ${key.last4} (made ${made})`;
        return `${kind} made ${made}${kind === "extension" ? ", which RPE remakes at every start" : key.ends === null ? ", no end" : `, runs out ${atWords(key.ends)}`}`;
      });
    });
    io.out(`Keys: ${keyLines.join("; ")}`);
    const switches = said !== null ? said.switches : listAllSwitches(db);
    const waiting = switches.filter((s) => s.state === "waiting");
    io.out(`Switches: ${waiting.length} waiting, ${switches.filter((s) => s.state === "on").length} on, ${switches.filter((s) => s.state === "off").length} off`);
    // Each user's own: a thing of another user than this RPE's is said with whose it is.
    for (const s of waiting) io.out(`  waiting${s.user === user ? "" : ` for user ${s.user}`}: ${s.name} (${s.kind}) runs or calls ${s.what}. Switch it on with: ${runLine(io, paths, "allow", s.name, ...(s.user === user ? [] : ["--user", s.user]))}`);
    if (said === null) io.out(`  ${STOPPED_LISTING}`);
  } finally {
    db.close();
  }
  return 0;
}
