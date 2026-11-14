// World documents by revision (plan §4.5: world definitions are kept as they are, by revision, in the
// database). A chat on a real world starts from, and folds over, the revision it plays: the store keeps
// each revision's document in its `world_revision` table, and `storedWorlds` reads that table for
// `openStore`'s `worlds`. A revision's id is its document's content hash, so a revision once kept never
// changes, and one id names one document whoever kept it.

import type { Database } from "bun:sqlite";
import type { RevisionId, WorldId } from "../shared/ids";
import type { WorldDoc } from "../shared/world";
import { isWorldDoc, migrateWorld } from "../engine/authoring";

/** Defaults for reading world documents. */
export const WORLD_DOCS_DEFAULTS = Object.freeze({
  /** Revisions held in memory once read, the least recently used going first (as many as today's world store holds). */
  kept: 8,
});

/** A kept revision, as the store lists it. */
export interface WorldRevisionRow {
  revision: RevisionId;
  world: WorldId;
  created: number;
}

/** A revision file the migration carried, as its `world_file` table names it (today's `worlds/<world>/rev/<revision>.json`). */
export const MIGRATED_REVISION = /^rev\/([0-9a-f]{32})\.json$/;

/** A kept document read as today's world store reads a revision: a world document, upgraded to this build's shape; null when it is none. */
export function readWorldDoc(text: string): WorldDoc | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  return isWorldDoc(raw) ? migrateWorld(raw) : null;
}

/**
 * The world documents the store keeps, by revision: what `openStore` takes as `worlds` for chats that
 * play a real world. It reads any user's row of a revision, since one id names one document. A
 * revision read is held in memory (`kept` of them); one not kept is not held, so it reads once put.
 */
export function storedWorlds(db: Database, options: { kept?: number } = {}): (revision: RevisionId) => WorldDoc | undefined {
  const kept = Math.max(1, Math.floor(options.kept ?? WORLD_DOCS_DEFAULTS.kept));
  const held = new Map<RevisionId, WorldDoc>();
  return (revision) => {
    const hit = held.get(revision);
    if (hit) {
      held.delete(revision);
      held.set(revision, hit);
      return hit;
    }
    const row = db.query<{ doc: string }, [string]>("SELECT doc FROM world_revision WHERE revision = ? LIMIT 1").get(revision);
    const doc = row ? readWorldDoc(row.doc) : null;
    if (!doc) return undefined;
    held.set(revision, doc);
    for (const oldest of held.keys()) {
      if (held.size <= kept) break;
      held.delete(oldest);
    }
    return doc;
  };
}
