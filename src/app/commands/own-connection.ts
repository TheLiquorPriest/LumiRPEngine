// RPE's own connection in Lumiverse, as `rpe up` makes it.

import { updateConfigFile } from "../config";
import type { AppConfig, DataPaths } from "../config";
import { isRecord } from "../../shared/json";
import { currentKeys, insertKey, newKeyText } from "../auth";
import type { CliIO } from "../cli";
import { type LumiverseCall, settleConnection, type SettledConnection } from "../up";
import { commandLineDatabase } from "./database";

/**
 * RPE's own connection in Lumiverse, made or brought into line at `apiUrl` (up.ts), its id kept in
 * `lumiverse.connection`, what was done said. Its key is in force only once Lumiverse holds it, so a
 * refusal leaves the key before it working.
 */
export async function ownConnection(call: LumiverseCall, apiUrl: string, paths: DataPaths, current: AppConfig, version: string, io: CliIO): Promise<SettledConnection & { moved: boolean }> {
  const fresh: { key: string | null } = { key: null };
  const db = commandLineDatabase(paths, current, version, io.now);
  let hadKey: boolean;
  let settled: SettledConnection;
  try {
    hadKey = currentKeys(db).some((k) => k.kind === "provider");
    settled = await settleConnection(call, current.lumiverse.connection, { apiUrl, models: current.lumiverse.models, hasKey: hadKey, makeKey: () => (fresh.key = newKeyText("provider")) });
    const key = fresh.key;
    if (key !== null) db.transaction(() => insertKey(db, "provider", io.now(), key)).immediate();
  } finally {
    db.close();
  }
  const moved = settled.id !== current.lumiverse.connection;
  if (moved) {
    await updateConfigFile(paths, (raw) => {
      raw.lumiverse = { ...(isRecord(raw.lumiverse) ? raw.lumiverse : {}), connection: settled.id };
    });
  }
  const named = `"${settled.name}" (${settled.id})`;
  if (settled.todays !== null) io.out(`The connection ${settled.todays} that RPE's config named is the one today's build made for its runtime: it is left as it is, for going back.`);
  if (settled.made) io.out(`Made RPE's connection in Lumiverse, ${named}: OpenAI-compatible, at ${apiUrl}, with a new provider key only it holds.`);
  else if (settled.changed.length > 0) io.out(`Brought RPE's connection in Lumiverse, ${named}, up to date: ${settled.changed.join(", ")}.`);
  else io.out(`RPE's connection in Lumiverse, ${named}, is already as it should be.`);
  if (settled.newKey && hadKey) io.out("A new provider key was made for it, and the one before it no longer works.");
  return { ...settled, moved };
}
