// `rpe allow <name>` and `rpe deny <name>`: the one way anything that runs a command or calls out is switched on or off.

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import type { CliIO } from "../cli";
import type { DataPaths } from "../config";
import { appliedMigrations } from "../migrations";
import { listSwitches, setSwitch } from "../switches";

export function switchCommand(name: string, state: "on" | "off", paths: DataPaths, io: CliIO): number {
  const db = existsSync(paths.database) ? new Database(paths.database, { readwrite: true, create: false }) : null;
  try {
    const listed = db !== null && (appliedMigrations(db).get("app")?.has(1) ?? false);
    const entry = listed ? db.transaction(() => setSwitch(db, name, state, io.now())).immediate() : null;
    if (entry === null) {
      const all = listed ? listSwitches(db) : [];
      io.err(`Nothing called "${name}" is listed. ${all.length === 0 ? "Nothing is listed yet." : `Listed: ${all.map((s) => `${s.name} (${s.state})`).join(", ")}.`}`);
      return 1;
    }
    io.out(state === "on" ? `"${entry.name}" (${entry.kind}) is on. It may now run: ${entry.what}` : `"${entry.name}" (${entry.kind}) is off.`);
    return 0;
  } finally {
    db?.close();
  }
}
