// Worlds as the store keeps them (plan §4.5, §15.2; R-10): every revision's bytes exactly as received,
// under its id, with their checksum, and beside them each world's index, draft and history notes, as
// today's world store keeps them, in one table (`world_part`). A revision's id is its document's content
// hash (`hashJson`), so a revision once kept never changes and one id names one document whoever kept it.
//
// A part is a file of a world, named as today's world store names it: `index.json`, `draft.json`,
// `history.json`, `rev/<revision>.json`. The fold and the turn read revisions through `storedWorlds`,
// parsed once and held in memory up to `store.worldsKept`; Build, the migration and the maps' keep go
// through `UserStore.worlds` (`UserWorlds`): put, get and list revisions, read and write the draft on the
// version it was made on, append and read history, and a change notice the store is given when it opens.

import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { hashJson } from "../shared/hash";
import type { RevisionId, WorldId } from "../shared/ids";
import { pathSafe } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { RevisionNote, WorldDoc } from "../shared/world";
import { isWorldDoc, migrateWorld } from "../engine/authoring";
import { BLANK_REVISION } from "./blank";
import { StoreInputError, StoreSchemaError } from "./types";

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

/** A file of a world as today's world store names it in the world's folder: the index, the draft, the history, or a revision. */
export const WORLD_PART = /^(index\.json|draft\.json|history\.json|rev\/([^/]+)\.json)$/;

/** A revision file as the migration carried it (today's `worlds/<world>/rev/<revision>.json`). */
export const MIGRATED_REVISION = /^rev\/([0-9a-f]{32})\.json$/;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The SHA-256 of some bytes (a part's checksum). */
export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytesOf(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? encoder.encode(data) : data;
}

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
 * revision read is parsed once and held in memory (`kept` of them, the least recently used going
 * first); one let go is read and parsed again from its bytes when next asked for.
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
    const row = db.query<{ bytes: Uint8Array }, [string]>("SELECT bytes FROM world_part WHERE file = ? LIMIT 1").get(`rev/${revision}.json`);
    const doc = row ? readWorldDoc(decoder.decode(row.bytes)) : null;
    if (!doc) return undefined;
    held.set(revision, doc);
    for (const oldest of held.keys()) {
      if (held.size <= kept) break;
      held.delete(oldest);
    }
    return doc;
  };
}

/** What the store tells of a change to a world, once it is durable (`StoreOptions.worldChanged`): the app passes it to the live socket for open Build pages. */
export interface WorldChange {
  user: string;
  world: WorldId;
  /** What was written: a revision put, the index, the draft (written, or dropped), a history note, or the whole world removed. */
  part: "revision" | "index" | "draft" | "history" | "removed";
  /** `revision`: the revision put. */
  revision?: RevisionId;
  /** `draft`: the draft's version after the write. */
  version?: number;
  /** `draft`: whether a draft is stored now (false once it is dropped). */
  stored?: boolean;
}

/** A world's working copy as it stands: the stored draft's bytes (today's `{ base, doc, version }`) and its version, or, with none stored, the world's own count. */
export interface DraftRead {
  /** The stored draft's bytes; null while none is stored (the working copy is then the head revision). */
  bytes: Uint8Array | null;
  version: number;
  stored: boolean;
}

/** A draft write or drop: done at the version it made, or not done, with the draft as it now stands. */
export type DraftWrite = { done: true; version: number } | { done: false; current: DraftRead };

/** A part as kept. */
export interface KeptPart {
  bytes: Uint8Array;
  sha256: string;
  version: number;
  created: number;
}

/** A world's index as today's world store keeps it (`WorldIndex`), read for the one field the store itself uses. */
function draftCountOf(bytes: Uint8Array | null): number {
  if (bytes === null) return 0;
  try {
    const raw: unknown = JSON.parse(decoder.decode(bytes));
    return isRecord(raw) && typeof raw.draftVersion === "number" && Number.isSafeInteger(raw.draftVersion) && raw.draftVersion > 0 ? raw.draftVersion : 0;
  } catch {
    return 0;
  }
}

const NOTE_SOURCES: Record<string, true> = { create: true, build: true, agent: true, import: true };

function isRevisionNote(v: unknown): v is RevisionNote {
  return isRecord(v) && typeof v.revision === "string" && typeof v.at === "number" && typeof v.source === "string" && NOTE_SOURCES[v.source] === true && (v.note === undefined || typeof v.note === "string");
}

/**
 * One user's worlds, as `UserStore.worlds` gives them: each write is one transaction of the store's own
 * and then tells the change notice. A caller that groups several (a commit: the revision, the index, the
 * history note, the draft dropped) runs them inside one transaction of its own, so they land together.
 */
export class UserWorlds {
  constructor(
    private readonly db: Database,
    private readonly user: string,
    private readonly run: <T>(fn: () => T) => T,
    private readonly now: () => number,
    private readonly told: ((change: WorldChange) => void) | undefined,
  ) {}

  private tell(change: Omit<WorldChange, "user">): void {
    this.told?.({ user: this.user, ...change });
  }

  /** A part's bytes and checksum as kept; null when the world has none such. */
  part(world: WorldId, file: string): KeptPart | null {
    return this.db.query<KeptPart, [string, string, string]>("SELECT bytes, sha256, version, created FROM world_part WHERE user = ? AND world = ? AND file = ?").get(this.user, world, file);
  }

  private keep(world: WorldId, file: string, bytes: Uint8Array, version: number): boolean {
    const had = this.part(world, file) !== null;
    this.db.run(
      "INSERT INTO world_part (user, world, file, bytes, sha256, version, created) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user, world, file) DO UPDATE SET bytes = excluded.bytes, sha256 = excluded.sha256, version = excluded.version",
      [this.user, world, file, bytes, sha256Of(bytes), version, this.now()],
    );
    return !had;
  }

  // ---------------------------------------------------------------- revisions

  /**
   * Keeps a revision's bytes exactly as received. Its id is the hash of the document they parse to
   * (`hashJson`), unless `revision` names the id they are kept under (a carried revision keeps the id
   * chats refer to). A revision already kept stays as it was first received. Refused: bytes that are
   * no world document, a revision that is the blank world's.
   */
  putRevision(world: WorldId, data: string | Uint8Array, revision?: RevisionId): { revision: RevisionId; added: boolean } {
    if (!pathSafe(world)) throw new StoreInputError(`"${world}" cannot name a world`);
    const bytes = bytesOf(data);
    const text = decoder.decode(bytes);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new StoreInputError("a world revision is a JSON document");
    }
    if (!isWorldDoc(raw)) throw new StoreInputError(`${revision ?? "the revision"} is not a world document`);
    const id = revision ?? hashJson(raw);
    if (id === "" || id === BLANK_REVISION || !pathSafe(id)) throw new StoreInputError(`"${id}" cannot name a kept revision`);
    const added = this.run(() => {
      if (this.db.query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM world_part WHERE user = ? AND file = ?").get(this.user, `rev/${id}.json`)?.n) return false;
      return this.keep(world, `rev/${id}.json`, bytes, 0);
    });
    if (added) this.tell({ world, part: "revision", revision: id });
    return { revision: id, added };
  }

  /** A revision's bytes as received; null when this user keeps no such revision. */
  revisionBytes(revision: RevisionId): Uint8Array | null {
    return this.db.query<{ bytes: Uint8Array }, [string, string]>("SELECT bytes FROM world_part WHERE user = ? AND file = ? LIMIT 1").get(this.user, `rev/${revision}.json`)?.bytes ?? null;
  }

  /** A kept revision's document, read as today's world store reads one; null when this user keeps no such revision or it is no world document. */
  doc(revision: RevisionId): WorldDoc | null {
    const bytes = this.revisionBytes(revision);
    return bytes === null ? null : readWorldDoc(decoder.decode(bytes));
  }

  /** The revisions this user keeps, of one world or of all, oldest first. */
  revisions(world?: WorldId): WorldRevisionRow[] {
    const rows =
      world === undefined
        ? this.db.query<{ world: string; file: string; created: number }, [string]>("SELECT world, file, created FROM world_part WHERE user = ? AND file LIKE 'rev/%' ORDER BY created, rowid").all(this.user)
        : this.db.query<{ world: string; file: string; created: number }, [string, string]>("SELECT world, file, created FROM world_part WHERE user = ? AND world = ? AND file LIKE 'rev/%' ORDER BY created, rowid").all(this.user, world);
    return rows.map((r) => ({ revision: r.file.slice(4, -5), world: r.world, created: r.created }));
  }

  // ---------------------------------------------------------------- index, draft, history

  /** The world's index as kept (today's `index.json`); null when the world has none. */
  index(world: WorldId): Uint8Array | null {
    return this.part(world, "index.json")?.bytes ?? null;
  }

  /** The worlds this user keeps an index for. */
  worlds(): WorldId[] {
    return this.db.query<{ world: string }, [string]>("SELECT world FROM world_part WHERE user = ? AND file = 'index.json' ORDER BY world").all(this.user).map((r) => r.world);
  }

  /** Keeps the world's index (the caller writes today's `WorldIndex`, its `draftVersion` included). */
  putIndex(world: WorldId, data: string | Uint8Array): void {
    if (!pathSafe(world)) throw new StoreInputError(`"${world}" cannot name a world`);
    this.run(() => this.keep(world, "index.json", bytesOf(data), 0));
    this.tell({ world, part: "index" });
  }

  /** The working copy as it stands, with the version a write names. */
  draft(world: WorldId): DraftRead {
    const count = draftCountOf(this.index(world));
    const row = this.part(world, "draft.json");
    // A draft at or below the world's count is one a drop already counted: no draft.
    return row !== null && row.version > count ? { bytes: row.bytes, version: row.version, stored: true } : { bytes: null, version: count, stored: false };
  }

  /**
   * Writes the draft, made on `madeOn`, the version its writer read. The draft's own bytes (today's
   * `{ base, doc, version }`) carry the version they make, `madeOn + 1`. A write made on any other version
   * is not written: it is answered with the draft as it now stands and its version.
   */
  writeDraft(world: WorldId, data: string | Uint8Array, madeOn: number): DraftWrite {
    const out = this.run((): DraftWrite => {
      if (this.index(world) === null) throw new StoreInputError(`no world ${world}`);
      const current = this.draft(world);
      if (madeOn !== current.version) return { done: false, current };
      this.keep(world, "draft.json", bytesOf(data), madeOn + 1);
      return { done: true, version: madeOn + 1 };
    });
    if (out.done) this.tell({ world, part: "draft", version: out.version, stored: true });
    return out;
  }

  /**
   * Drops the draft made on `madeOn` (a discard): the world's count takes the next version, the index
   * records it and the draft goes. One made on another version is answered as a draft write is. With no
   * draft stored nothing changes.
   */
  dropDraft(world: WorldId, madeOn: number): DraftWrite {
    const out = this.run((): DraftWrite => {
      const index = this.part(world, "index.json");
      if (index === null) throw new StoreInputError(`no world ${world}`);
      const current = this.draft(world);
      if (madeOn !== current.version) return { done: false, current };
      if (!current.stored) return { done: true, version: current.version };
      const count = Math.max(draftCountOf(index.bytes), madeOn) + 1;
      let raw: unknown;
      try {
        raw = JSON.parse(decoder.decode(index.bytes));
      } catch {
        raw = {};
      }
      this.keep(world, "index.json", encoder.encode(JSON.stringify({ ...(isRecord(raw) ? raw : {}), draftVersion: count })), 0);
      this.db.run("DELETE FROM world_part WHERE user = ? AND world = ? AND file = 'draft.json'", [this.user, world]);
      return { done: true, version: count };
    });
    if (out.done && out.version !== madeOn) this.tell({ world, part: "draft", version: out.version, stored: false });
    return out;
  }

  /** Removes the stored draft without counting it (a commit that has counted it in the index it wrote). */
  removeDraft(world: WorldId): void {
    const had = this.run(() => this.db.run("DELETE FROM world_part WHERE user = ? AND world = ? AND file = 'draft.json'", [this.user, world]).changes > 0);
    if (had) this.tell({ world, part: "draft", version: this.draft(world).version, stored: false });
  }

  /** How each of the world's revisions became head, oldest first. */
  history(world: WorldId): RevisionNote[] {
    const row = this.part(world, "history.json");
    if (row === null) return [];
    try {
      const raw: unknown = JSON.parse(decoder.decode(row.bytes));
      return isRecord(raw) && Array.isArray(raw.notes) ? raw.notes.filter(isRevisionNote) : [];
    } catch {
      return [];
    }
  }

  /** Appends a note to the world's history (today's `{ v: 1, notes }`). */
  appendHistory(world: WorldId, note: RevisionNote): void {
    if (!isRevisionNote(note)) throw new StoreInputError("a history note names its revision, when it was made and what made it");
    this.run(() => {
      if (!pathSafe(world)) throw new StoreInputError(`"${world}" cannot name a world`);
      this.keep(world, "history.json", encoder.encode(JSON.stringify({ v: 1, notes: [...this.history(world), note] })), 0);
    });
    this.tell({ world, part: "history" });
  }

  /**
   * Removes every part of the world this user keeps. With `keepRevisions` the revisions stay, unlisted and under the world's id: chats that
   * played the world name their revisions by id, and a chat's fold starts from one (a chat's record stays whole).
   */
  remove(world: WorldId, options: { keepRevisions?: boolean } = {}): void {
    const had = this.run(() => this.db.run(`DELETE FROM world_part WHERE user = ? AND world = ?${options.keepRevisions === true ? " AND file NOT LIKE 'rev/%'" : ""}`, [this.user, world]).changes > 0);
    if (had) this.tell({ world, part: "removed" });
  }

  /**
   * Keeps what the migration carried of this user's worlds (its `world_file` table, plan §15.2), byte for
   * byte, so the chats it imported play their worlds: every revision not yet kept, and the index, draft and
   * history of a world this user keeps none of. A revision already kept stays as it is; a file that does
   * not read as a world document is kept all the same (it is the user's) and listed.
   */
  copyCarried(): { added: number; held: number; unreadable: { world: WorldId; revision: RevisionId }[] } {
    if (!tableHeld(this.db, "world_file")) {
      throw new StoreSchemaError("This database holds no world_file table: the migration's tables are not here, so it carried no worlds into it.");
    }
    const moved = this.run(() => moveWorldFiles(this.db, "world_file", { user: this.user, now: this.now(), overwrite: false }));
    return { added: moved.revisionsAdded, held: moved.revisionsHeld, unreadable: moved.unreadable };
  }

  /**
   * Keeps a world's index, draft or history as the migration carried it, byte for byte (a draft's version from its own bytes, as
   * `moveWorldFiles` takes it), in one write of the store's, and tells the change. A later run follows what the old engine changed
   * where his copy is still what a run put; whether it is, and whether he removed the world, is the caller's to compare (`part`).
   */
  putCarried(world: WorldId, file: "index.json" | "draft.json" | "history.json", bytes: Uint8Array): void {
    const version = file === "draft.json" ? carriedDraftVersion(bytes, this.part(world, "index.json")?.bytes ?? null) : 0;
    this.run(() => this.keep(world, file, bytes, version));
    if (file === "index.json") this.tell({ world, part: "index" });
    else if (file === "history.json") this.tell({ world, part: "history" });
    else this.tell({ world, part: "draft", version, stored: true });
  }
}

// ------------------------------------------------------------------ moving the other tables' files in

/** Whether the database holds a table. */
export function tableHeld(db: Database, name: string): boolean {
  return (db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.n ?? 0) > 0;
}

/** What `moveWorldFiles` did. */
export interface WorldFilesMoved {
  /** Files kept in `world_part` that were not (or, with `overwrite`, that differed). */
  moved: number;
  /** Files already kept, byte for byte. */
  held: number;
  /** Files already kept that differ from the source's and were left as kept. */
  differing: number;
  /** Revisions that read as world documents, moved or already held; those that do not (kept all the same) are listed. */
  revisionsAdded: number;
  revisionsHeld: number;
  unreadable: { world: WorldId; revision: RevisionId }[];
}

interface SourceFile {
  user: string;
  world: string;
  file: string;
  bytes: Uint8Array;
  /** The source's own checksum where it keeps one; else the bytes'. */
  sha256: string;
}

const BUILD_PATH = /^worlds\/([^/]+)\/(index\.json|draft\.json|history\.json|rev\/[^/]+\.json)$/;

/** The world files a table holds: the migration's `world_file` (bytes and checksum), or Build's `build_file` (text by storage path). */
function filesOf(db: Database, table: "world_file" | "build_file", user: string | undefined): SourceFile[] {
  if (!tableHeld(db, table)) return [];
  if (table === "world_file") {
    const rows =
      user === undefined
        ? db.query<{ user: string; world: string; file: string; bytes: Uint8Array; sha256: string }, []>("SELECT user, world, file, bytes, sha256 FROM world_file ORDER BY user, world, file").all()
        : db.query<{ user: string; world: string; file: string; bytes: Uint8Array; sha256: string }, [string]>("SELECT user, world, file, bytes, sha256 FROM world_file WHERE user = ? ORDER BY world, file").all(user);
    return rows.filter((r) => WORLD_PART.test(r.file));
  }
  const rows =
    user === undefined
      ? db.query<{ user: string; path: string; body: string }, []>("SELECT user, path, body FROM build_file WHERE path LIKE 'worlds/%' ORDER BY user, path").all()
      : db.query<{ user: string; path: string; body: string }, [string]>("SELECT user, path, body FROM build_file WHERE user = ? AND path LIKE 'worlds/%' ORDER BY path").all(user);
  const out: SourceFile[] = [];
  for (const r of rows) {
    const match = BUILD_PATH.exec(r.path);
    if (!match) continue;
    const bytes = encoder.encode(r.body);
    out.push({ user: r.user, world: match[1] ?? "", file: match[2] ?? "", bytes, sha256: sha256Of(bytes) });
  }
  return out;
}

/** A carried draft's version: its own, or, for one stored before drafts had versions, a new draft one write in past its index's count. */
function carriedDraftVersion(bytes: Uint8Array, indexBytes: Uint8Array | null): number {
  let n = 0;
  try {
    const raw: unknown = JSON.parse(decoder.decode(bytes));
    n = isRecord(raw) && typeof raw.version === "number" && Number.isSafeInteger(raw.version) && raw.version > 0 ? raw.version : 0;
  } catch {
    n = 0;
  }
  return n > 0 ? n : draftCountOf(indexBytes) + 1;
}

/**
 * Moves the world files of the migration's table (`world_file`) or of Build's (`build_file`) into
 * `world_part`, byte for byte, and compares the checksum of what it keeps with the source's: any
 * difference stops it with nothing kept (the caller's transaction rolls back). A revision already
 * kept stays as it is (one id names one document); index, draft and history of a world already kept
 * stay unless `overwrite` says the source's are newer. Neither source table is changed. Call it inside
 * a transaction. A world Build removed (a `build_seed` row, and no index in `build_file`) is not brought
 * back from the migration's copy.
 */
export function moveWorldFiles(db: Database, table: "world_file" | "build_file", options: { user?: string; now: number; overwrite: boolean }): WorldFilesMoved {
  const out: WorldFilesMoved = { moved: 0, held: 0, differing: 0, revisionsAdded: 0, revisionsHeld: 0, unreadable: [] };
  let files = filesOf(db, table, options.user);
  if (table === "world_file" && tableHeld(db, "build_seed") && tableHeld(db, "build_file")) {
    const seeded = new Set(db.query<{ user: string; world: string }, []>("SELECT user, world FROM build_seed").all().map((r) => `${r.user}\0${r.world}`));
    const indexed = new Set(db.query<{ user: string; path: string }, []>("SELECT user, path FROM build_file WHERE path LIKE 'worlds/%/index.json'").all().map((r) => `${r.user}\0${r.path.split("/")[1] ?? ""}`));
    files = files.filter((f) => !seeded.has(`${f.user}\0${f.world}`) || indexed.has(`${f.user}\0${f.world}`));
  }
  const read = db.query<{ bytes: Uint8Array }, [string, string, string]>("SELECT bytes FROM world_part WHERE user = ? AND world = ? AND file = ?");
  const put = db.query("INSERT INTO world_part (user, world, file, bytes, sha256, version, created) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user, world, file) DO UPDATE SET bytes = excluded.bytes, sha256 = excluded.sha256, version = excluded.version");
  // Revisions are held by id across a user's worlds: one id names one document.
  const revisionHeld = db.query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM world_part WHERE user = ? AND file = ?");
  for (const f of files) {
    const revision = f.file.startsWith("rev/") ? f.file.slice(4, -5) : null;
    const already = read.get(f.user, f.world, f.file)?.bytes ?? null;
    const sameId = revision !== null && already === null && (revisionHeld.get(f.user, f.file)?.n ?? 0) > 0;
    const readable = revision !== null && readWorldDoc(decoder.decode(f.bytes)) !== null;
    if (revision !== null && !readable) out.unreadable.push({ world: f.world, revision });
    const indexBytes = (): Uint8Array | null => files.find((x) => x.user === f.user && x.world === f.world && x.file === "index.json")?.bytes ?? read.get(f.user, f.world, "index.json")?.bytes ?? null;
    const version = f.file === "draft.json" ? carriedDraftVersion(f.bytes, indexBytes()) : 0;
    if (already !== null) {
      const same = already.length === f.bytes.length && already.every((b, i) => b === f.bytes[i]);
      if (same) {
        out.held++;
        if (readable) out.revisionsHeld++;
        continue;
      }
      if (revision !== null || !options.overwrite) {
        out.differing++;
        continue;
      }
    } else if (sameId) {
      out.held++;
      if (readable) out.revisionsHeld++;
      continue;
    }
    put.run(f.user, f.world, f.file, f.bytes, f.sha256, version, options.now);
    const kept = read.get(f.user, f.world, f.file)?.bytes;
    if (!kept || sha256Of(kept) !== f.sha256) throw new StoreSchemaError(`The checksum of ${f.world}/${f.file} differs once kept in the store's world table: nothing was moved.`);
    out.moved++;
    if (readable) out.revisionsAdded++;
  }
  return out;
}

/**
 * The store's migration of its worlds into `world_part`: what the migration carried (`world_file`) first, then what Build kept
 * (`build_file`, which wins for a world's index, draft and history, being the copy a person edits), then the store's own old
 * revision table, which goes. Both source tables stay, for their callers to move off.
 */
export function keepWorldsOnce(db: Database, now: number): void {
  moveWorldFiles(db, "world_file", { now, overwrite: false });
  moveWorldFiles(db, "build_file", { now, overwrite: true });
  const held = db.query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM world_part WHERE user = ? AND file = ?");
  const put = db.query("INSERT INTO world_part (user, world, file, bytes, sha256, version, created) VALUES (?, ?, ?, ?, ?, 0, ?)");
  for (const r of db.query<{ user: string; revision: string; world: string; doc: string; created: number }, []>("SELECT user, revision, world, doc, created FROM world_revision ORDER BY created, rowid").all()) {
    if ((held.get(r.user, `rev/${r.revision}.json`)?.n ?? 0) > 0) continue;
    const bytes = encoder.encode(r.doc);
    put.run(r.user, r.world, `rev/${r.revision}.json`, bytes, sha256Of(bytes), r.created);
  }
  db.run("DROP TABLE world_revision");
}
