// The worlds (STANDALONE-PLAN §15.2, "Worlds", "What a world holds" and "Pins"): every world's
// index, every revision, the draft and the history notes, copied byte for byte into RPE's database,
// then kept in the store's own world table, which Build and play read. Revision ids are content hashes
// that chats, drafts and markers refer to, so nothing is re-stamped or rewritten. RPE reads its copy
// with today's own world store, so a world, what it holds and its pins read as today's build reads them.

import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { WorldStore } from "../worlds/worlds";
import type { Registry } from "../engine/registry-impl";
import { STARTER_TABLES } from "../packs/index";
import type { RevisionId, WorldId } from "../shared/ids";
import { StoreInputError, type UserWorlds } from "../store";
import { readBytes, sha256 } from "./files";
import type { Item } from "./report";
import { StandIn, StorageView, type AttemptedWrite } from "./stand-in";
import { keepPutPrints, putPrints } from "./tables";

/** A world's file by its path in today's user storage: the world, and the file's name in the world's folder (`worlds.ts` `worldDir`, `revisionFile`). */
const WORLD_FILE = /^worlds\/([^/]+)\/(index\.json|draft\.json|history\.json|rev\/[0-9a-f]{32}\.json)$/;

export interface WorldsCarried {
  worlds: number;
  revisions: number;
  drafts: number;
  histories: number;
  bytes: number;
  /** Worlds an earlier run carried that today's side has deleted since: each kept (`kept`) while a chat this run imported plays one of its revisions, else gone from RPE's copy as well. Absent where none, and from a report kept before runs named them. */
  gone?: { world: string; kept: boolean }[];
}

/**
 * Copies the world files the report classifies as carried from the user's storage folder into RPE's
 * database, byte for byte with each one's checksum, in place of what an earlier run copied: a world
 * gone from today's data is gone from RPE's copy too, and named, unless a chat this run imported plays
 * one of its revisions (`plays`, the revision ids those chats name): then it is kept as it was, and named.
 */
export async function carryWorlds(db: Database, user: string, folder: string | null, items: readonly Item[], run: string, plays: ReadonlySet<string> = new Set()): Promise<WorldsCarried> {
  const files: { world: string; file: string; bytes: Uint8Array }[] = [];
  for (const item of items) {
    const match = item.where === "user storage" && item.row === "worlds" && item.fate === "carried" ? WORLD_FILE.exec(item.path) : null;
    if (!match || folder === null) continue;
    const bytes = await readBytes(join(folder, item.path));
    if (bytes !== null) files.push({ world: match[1] ?? "", file: match[2] ?? "", bytes });
  }
  const today = new Set(files.map((f) => f.world));
  const gone: { world: string; kept: boolean }[] = [];
  db.transaction(() => {
    const had = db.query<{ world: string; file: string }, [string]>("SELECT world, file FROM world_file WHERE user = ?").all(user);
    for (const world of new Set(had.map((r) => r.world))) {
      if (today.has(world)) continue;
      const kept = had.some((r) => r.world === world && plays.has(/^rev\/([0-9a-f]{32})\.json$/.exec(r.file)?.[1] ?? ""));
      gone.push({ world, kept });
    }
    const keep = new Set(gone.filter((g) => g.kept).map((g) => g.world));
    const remove = db.query("DELETE FROM world_file WHERE user = ? AND world = ?");
    for (const world of new Set(had.map((r) => r.world))) if (!keep.has(world)) remove.run(user, world);
    const put = db.query("INSERT INTO world_file (user, world, file, bytes, sha256, run) VALUES (?, ?, ?, ?, ?, ?)");
    for (const f of files) put.run(user, f.world, f.file, f.bytes, sha256(f.bytes), run);
  })();
  const count = (name: string): number => files.filter((f) => f.file === name).length;
  return { worlds: count("index.json"), revisions: files.filter((f) => f.file.startsWith("rev/")).length, drafts: count("draft.json"), histories: count("history.json"), bytes: files.reduce((n, f) => n + f.bytes.length, 0), ...(gone.length > 0 ? { gone } : {}) };
}

/**
 * What a run did with the carried worlds in the store's own table: revisions added, held already, and
 * those that read as no world document (kept in the migration's copy and the backup, and listed); worlds
 * new to RPE, put whole; each index, draft or history today's side changed since a run put it where RPE's
 * copy was still the run's (`followed`, "world/file"); each changed in RPE since a run put it, kept as RPE
 * has it (`newer`: today's side changed it too); and each world he removed in RPE, which stays removed.
 */
export interface WorldsFollowed {
  added: number;
  held: number;
  unreadable: { world: WorldId; revision: RevisionId }[];
  copied: string[];
  followed: string[];
  kept: { world: string; file: string; newer: boolean }[];
  removed: string[];
}

/** What a run put of a world's file into the store's table, by its key in `migration_put`. */
const printOf = (world: string, file: string): string => `world-part ${world}/${file}`;

/**
 * Keeps this run's copy of the worlds (`world_file`) in the store's own table, through the store, by the
 * later-run rule (R-79): every revision not kept yet; a world new to RPE whole; an index, draft or history
 * replaced only where RPE's copy is still what a run put there, else kept as RPE has it and named; a world
 * he removed in RPE since a run put it stays removed, its revisions kept for the chats that play them. One
 * transaction; what it put is remembered for the next run.
 */
export function followWorlds(db: Database, worlds: UserWorlds, user: string): WorldsFollowed {
  const out: WorldsFollowed = { added: 0, held: 0, unreadable: [], copied: [], followed: [], kept: [], removed: [] };
  const prints = putPrints(db, user);
  const put = new Map<string, string>();
  const rows = db.query<{ world: string; file: string; bytes: Uint8Array; sha256: string }, [string]>("SELECT world, file, bytes, sha256 FROM world_file WHERE user = ? ORDER BY world, file").all(user);
  // The index first: a draft's version is read against the world's index as kept.
  const order = (file: string): number => (file === "index.json" ? 0 : file === "history.json" ? 1 : file === "draft.json" ? 2 : 3);
  db.transaction(() => {
    for (const world of new Set(rows.map((r) => r.world))) {
      const id = world as WorldId;
      const files = rows.filter((r) => r.world === world).sort((a, b) => order(a.file) - order(b.file));
      for (const f of files) {
        const revision = /^rev\/(.+)\.json$/.exec(f.file)?.[1];
        if (revision === undefined) continue;
        try {
          if (worlds.putRevision(id, f.bytes, revision as RevisionId).added) out.added++;
          else out.held++;
        } catch (error) {
          if (!(error instanceof StoreInputError)) throw error;
          out.unreadable.push({ world: id, revision: revision as RevisionId });
        }
      }
      const isNew = worlds.index(id) === null && prints.get(printOf(world, "index.json")) === undefined;
      if (!isNew && worlds.index(id) === null) {
        out.removed.push(world);
        continue;
      }
      if (isNew) out.copied.push(world);
      for (const f of files) {
        const file = f.file === "index.json" || f.file === "draft.json" || f.file === "history.json" ? f.file : null;
        if (file === null) continue;
        const printed = prints.get(printOf(world, file));
        const kept = worlds.part(id, file);
        const take = (): void => {
          worlds.putCarried(id, file, f.bytes);
          put.set(printOf(world, file), f.sha256);
        };
        if (kept === null) {
          // A draft or history he committed, dropped or removed in RPE since a run put it stays as RPE has it.
          if (printed !== undefined) out.kept.push({ world, file, newer: printed !== f.sha256 });
          else take();
        } else if (kept.sha256 === f.sha256) put.set(printOf(world, file), f.sha256);
        else if (printed === kept.sha256) {
          take();
          out.followed.push(`${world}/${file}`);
        } else out.kept.push({ world, file, newer: printed === undefined || printed !== f.sha256 });
      }
    }
    keepPutPrints(db, user, put);
  })();
  return out;
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
