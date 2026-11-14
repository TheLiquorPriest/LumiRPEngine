// The worlds (STANDALONE-PLAN §15.2, "Worlds", "What a world holds" and "Pins"): every world's
// index, every revision, the draft and the history notes, copied byte for byte into RPE's database.
// Revision ids are content hashes that chats, drafts and markers refer to, so nothing is re-stamped
// or rewritten. RPE reads its copy with today's own world store, so a world, what it holds and its
// pins read as today's build reads them.

import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { WorldStore } from "../backend/worlds";
import type { Registry } from "../engine/registry-impl";
import { STARTER_TABLES } from "../packs/index";
import { readBytes, sha256 } from "./files";
import type { Item } from "./report";
import { StandIn, StorageView, type AttemptedWrite } from "./stand-in";

/** A world's file by its path in today's user storage: the world, and the file's name in the world's folder (`worlds.ts` `worldDir`, `revisionFile`). */
const WORLD_FILE = /^worlds\/([^/]+)\/(index\.json|draft\.json|history\.json|rev\/[0-9a-f]{32}\.json)$/;

export interface WorldsCarried {
  worlds: number;
  revisions: number;
  drafts: number;
  histories: number;
  bytes: number;
}

/**
 * Copies the world files the report classifies as carried from the user's storage folder into RPE's
 * database, byte for byte with each one's checksum, in place of what an earlier run copied: a world
 * gone from today's data is gone from RPE's copy too.
 */
export async function carryWorlds(db: Database, user: string, folder: string | null, items: readonly Item[], run: string): Promise<WorldsCarried> {
  const files: { world: string; file: string; bytes: Uint8Array }[] = [];
  for (const item of items) {
    const match = item.where === "user storage" && item.row === "worlds" && item.fate === "carried" ? WORLD_FILE.exec(item.path) : null;
    if (!match || folder === null) continue;
    const bytes = await readBytes(join(folder, item.path));
    if (bytes !== null) files.push({ world: match[1] ?? "", file: match[2] ?? "", bytes });
  }
  db.transaction(() => {
    db.run("DELETE FROM world_file WHERE user = ?", [user]);
    const put = db.query("INSERT INTO world_file (user, world, file, bytes, sha256, run) VALUES (?, ?, ?, ?, ?, ?)");
    for (const f of files) put.run(user, f.world, f.file, f.bytes, sha256(f.bytes), run);
  })();
  const count = (name: string): number => files.filter((f) => f.file === name).length;
  return { worlds: count("index.json"), revisions: files.filter((f) => f.file.startsWith("rev/")).length, drafts: count("draft.json"), histories: count("history.json"), bytes: files.reduce((n, f) => n + f.bytes.length, 0) };
}

/**
 * RPE's copy of the user's worlds, read by today's own world store over it: the same index, revisions
 * (each upgraded as today's store upgrades it), draft and history today's build gives. What that store
 * would write as it reads (a damaged history set aside) stays in memory; the copy is never changed.
 */
export function carriedWorlds(db: Database, user: string, registry: Registry): WorldStore {
  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  for (const row of db.query<{ world: string; file: string; bytes: Uint8Array }, [string]>("SELECT world, file, bytes FROM world_file WHERE user = ?").all(user)) files.set(`worlds/${row.world}/${row.file}`, decoder.decode(row.bytes));
  const writes: AttemptedWrite[] = [];
  const view = new StorageView("RPE's copy", null, writes, files);
  return new WorldStore(new StandIn({ userId: user, user: view, extension: view, db: null }, writes).host, registry, STARTER_TABLES);
}
