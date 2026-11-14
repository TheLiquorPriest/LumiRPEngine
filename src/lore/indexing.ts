// The lore index (plan §9.1): for every entry of a chat's lore, what the database holds at once (its
// id, book, title, keys, size, how it activates and its revision: `Lore.catalog`) beside what an
// indexing run wrote of it: its kind, one line saying what it is, what it defines and related entries.
// The user may edit those lines; an edit stands over the run's and outlives a run that redoes the
// entry. A run's lines are kept with the revision of the entry the run was given, so after the first
// run only entries that have changed are handed out again.
//
// Code never starts a run (plan §13.5). It hands the next batch to whatever run asks, keeps what the
// run hands back, and counts what is left, as a fact the briefing shows and a rule may name.

import type { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FactDef, FactValue, Scope } from "rp-harness/contract";
import { writeWhole } from "../app/disk";
import type { LoreWrites } from "./ids";
import { LORE_INDEX_FILE, type LoreIndexFile, loreIndexText } from "./index-file";
import { horizonRecords } from "./horizon";
import { foldName } from "./keys";
import type { Lore, LoreAt, LoreCatalogEntry, LoreMapAsk } from "./lore";
import type { LoreMap, LoreMapLine } from "./map";
import { overlayNotes } from "./overlays";
import type { LorePath } from "./sources";

/** Every fixed value of the index, each a setting with this default. */
export const LORE_INDEX_DEFAULTS = Object.freeze({
  /** Entries handed to an indexing run at a time (plan Appendix D.1). */
  batch: 20,
  /** Entries the lore map lists as bound to the horizon and not in the prompt (plan Appendix D.1). */
  bound: 12,
});

export type LoreIndexSettings = { -readonly [K in keyof typeof LORE_INDEX_DEFAULTS]: number };

/** What an entry defines (plan §9.3): a record it is the source for, by its name or its id in the world's tree, and which side of it. */
export interface LoreBinding {
  what: string;
  /** Which side of it the entry defines (its background, its layout); '' where none was said. */
  aspect: string;
}

/** What the index holds of an entry. */
export interface LoreIndexLines {
  kind: string | null;
  /** One line saying what it is. */
  line: string | null;
  defines: LoreBinding[];
  /** Related entries, by RPE's ids. */
  related: string[];
}

export const LORE_INDEX_FIELDS = ["kind", "line", "defines", "related"] as const satisfies readonly (keyof LoreIndexLines)[];
export type LoreIndexField = (typeof LORE_INDEX_FIELDS)[number];

/** An entry of a chat's lore with its index lines: the user's own where the user wrote them, else the run's. */
export interface IndexedEntry extends LoreCatalogEntry, LoreIndexLines {
  /** Whether a run has written lines for the entry as it stands now. */
  indexed: boolean;
  /** Whether a run wrote lines for an earlier revision of it, which still show until it is redone. */
  stale: boolean;
  /** The lines that are the user's own. */
  edited: LoreIndexField[];
}

/** One entry's lines as a run hands them back. */
export interface LoreIndexInput extends LoreIndexLines {
  id: string;
}

/** What became of one entry a run handed back: kept, for the revision it was given at; or not, its id naming no entry of the chat's lore. */
export type LoreIndexOutcome = { id: string; kept: IndexedEntry } | { id: string; unknown: true };

/** The user's edit of an entry's lines: each field given is set as the user's own; null takes the user's own off, and the run's shows again. */
export type LoreIndexEdit = { [F in LoreIndexField]?: LoreIndexLines[F] | null };

interface IndexRow {
  world: string;
  entry: string;
  revision: string | null;
  kind: string | null;
  line: string | null;
  defines: string | null;
  related: string | null;
  own_kind: string | null;
  own_line: string | null;
  own_defines: string | null;
  own_related: string | null;
}

function listOf(raw: string | null): unknown[] | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function bindingsOf(raw: string | null): LoreBinding[] | null {
  const list = listOf(raw);
  return list === null ? null : list.flatMap((b): LoreBinding[] => (typeof b === "object" && b !== null && typeof (b as LoreBinding).what === "string" ? [{ what: (b as LoreBinding).what, aspect: typeof (b as LoreBinding).aspect === "string" ? (b as LoreBinding).aspect : "" }] : []));
}

function idsOf(raw: string | null): string[] | null {
  const list = listOf(raw);
  return list === null ? null : list.filter((id): id is string => typeof id === "string");
}

/** Where the index keeps an entry's lines: a world entry's key is its world's own, a book entry's number the user's for good. */
function placeOf(entry: Pick<LoreCatalogEntry, "world" | "id">): string {
  return `${entry.world}\u0000${entry.id}`;
}

/** An entry with its lines, the user's own over the run's. */
function joined(entry: LoreCatalogEntry, row: IndexRow | undefined): IndexedEntry {
  const own = { kind: row?.own_kind ?? null, line: row?.own_line ?? null, defines: bindingsOf(row?.own_defines ?? null), related: idsOf(row?.own_related ?? null) };
  const edited = LORE_INDEX_FIELDS.filter((f) => own[f] !== null);
  const revision = row?.revision ?? null;
  return {
    ...entry,
    kind: own.kind ?? row?.kind ?? null,
    line: own.line ?? row?.line ?? null,
    defines: own.defines ?? bindingsOf(row?.defines ?? null) ?? [],
    related: own.related ?? idsOf(row?.related ?? null) ?? [],
    indexed: revision === entry.revision,
    stale: revision !== null && revision !== entry.revision,
    edited,
  };
}

export interface LoreIndexDeps {
  lore: Lore;
  db: Database;
  writes: LoreWrites;
  /** The turns each reading of the overlays sees. */
  path: LorePath;
  settings?: Partial<LoreIndexSettings>;
  /** Where the chat's readable index is written; absent, it is not written. */
  file?: LoreIndexFile;
  /** Milliseconds since 1970, for when lines were written; `Date.now` when absent. */
  now?: () => number;
}

const UNINDEXED = "lore.unindexed";

export class LoreIndex {
  readonly settings: Readonly<LoreIndexSettings>;

  constructor(private readonly deps: LoreIndexDeps) {
    this.settings = Object.freeze({ ...LORE_INDEX_DEFAULTS, ...deps.settings });
  }

  /**
   * The lore map in full for a turn (`map.ts`), on the first form `Lore.loreMap` gives: each entry
   * with what the index says of it; the activated entries the overlays on the turn's path have
   * outdated; and the entries bound to who and what is on the horizon, in the horizon's order, that
   * are not in the map's first parts, up to the setting's limit, with the count of any left out.
   */
  async loreMap(ask: LoreMapAsk): Promise<LoreMap> {
    const [first, entries] = await Promise.all([this.deps.lore.loreMap(ask), this.entries(ask)]);
    const byId = new Map(entries.map((e) => [e.id, e]));
    const described = (l: LoreMapLine): LoreMapLine => {
      const e = byId.get(l.id);
      if (e === undefined) return l;
      return { ...l, ...(e.kind !== null ? { kind: e.kind } : {}), ...(e.line !== null ? { line: e.line } : {}), ...(e.defines.length > 0 ? { defines: e.defines } : {}), ...(e.indexed ? {} : { keys: e.keys }) };
    };
    const inPrompt = first.inPrompt.map(described);
    const world = first.world.map(described);
    const notes = overlayNotes(this.deps.db, ask.user, ask.chat, this.deps.path.turns(ask.user, ask.chat, ask.turn), inPrompt.map((l) => l.id));
    const changed = inPrompt.flatMap((l) => {
      const n = notes.get(l.id);
      return n === undefined ? [] : [{ ...l, notes: n }];
    });

    const at = this.deps.lore.worldAt(ask);
    const shown = new Set([...inPrompt, ...world].map((l) => l.id));
    const boundTo = new Map<string, string[]>();
    for (const record of at === null ? [] : horizonRecords(at)) {
      const names = new Set([record.ref, record.id, record.name].map(foldName));
      for (const e of entries) {
        if (shown.has(e.id) || !e.defines.some((b) => names.has(foldName(b.what)))) continue;
        boundTo.set(e.id, [...(boundTo.get(e.id) ?? []), record.name]);
      }
    }
    // A map's insertion order is the order each entry was first bound: the player's character's first.
    const order = [...boundTo];
    const bound = order.slice(0, this.settings.bound).flatMap(([id, to]) => {
      const e = byId.get(id);
      return e === undefined ? [] : [{ ...described({ id, title: e.title }), bound: to }];
    });
    return { inPrompt, world, changed, bound, leftOut: Math.max(0, order.length - this.settings.bound), notIndexed: entries.filter((e) => !e.indexed).length };
  }

  /** Every entry of the chat's lore, in the catalog's order, with its index lines. */
  async entries(at: LoreAt): Promise<IndexedEntry[]> {
    const catalog = await this.deps.lore.catalog(at);
    const rows = this.rows(at.user, catalog);
    return catalog.map((entry) => joined(entry, rows.get(placeOf(entry))));
  }

  /** The next entries no run has indexed as they stand now, in the catalog's order: at most `size`, the setting's when absent. */
  async batch(at: LoreAt, size: number = this.settings.batch): Promise<{ entries: IndexedEntry[]; left: number }> {
    const unindexed = (await this.entries(at)).filter((e) => !e.indexed);
    return { entries: unindexed.slice(0, Math.max(0, Math.floor(size))), left: unindexed.length };
  }

  /**
   * Keeps a run's lines for entries of the chat's lore, each for the revision the entry has now, in
   * one write. The user's own lines are left as they are. An id that names no entry of the chat's
   * lore keeps nothing, and says so.
   */
  async write(at: LoreAt, lines: readonly LoreIndexInput[], by: string): Promise<LoreIndexOutcome[]> {
    const catalog = new Map((await this.deps.lore.catalog(at)).map((e) => [e.id, e]));
    const now = (this.deps.now ?? Date.now)();
    const kept = lines.flatMap((l) => {
      const entry = catalog.get(l.id);
      return entry === undefined ? [] : [{ entry, lines: l }];
    });
    await this.deps.writes.run((db) => {
      const put = db.query<unknown, [string, string, string, string, string | null, string | null, string, string, string, number]>(
        `INSERT INTO lore_index (user, world, entry, revision, kind, line, defines, related, by, written) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user, world, entry) DO UPDATE SET revision = excluded.revision, kind = excluded.kind, line = excluded.line, defines = excluded.defines, related = excluded.related, by = excluded.by, written = excluded.written`,
      );
      for (const { entry, lines: l } of kept) put.run(at.user, entry.world, entry.id, entry.revision, l.kind, l.line, JSON.stringify(l.defines), JSON.stringify(l.related), by, now);
    }, "keeping lore index lines");
    await this.writeFile(at);
    const rows = this.rows(at.user, kept.map((k) => k.entry));
    return lines.map((l): LoreIndexOutcome => {
      const entry = catalog.get(l.id);
      return entry === undefined ? { id: l.id, unknown: true } : { id: l.id, kept: joined(entry, rows.get(placeOf(entry))) };
    });
  }

  /** The user's edit of an entry's lines (see `LoreIndexEdit`); null when the id names no entry of the chat's lore. */
  async edit(at: LoreAt, id: string, edit: LoreIndexEdit): Promise<IndexedEntry | null> {
    const entry = (await this.deps.lore.catalog(at)).find((e) => e.id === id);
    if (entry === undefined) return null;
    const now = (this.deps.now ?? Date.now)();
    const value = (field: LoreIndexField): string | null => {
      const given = edit[field];
      if (given === undefined || given === null) return null;
      return typeof given === "string" ? given : JSON.stringify(given);
    };
    await this.deps.writes.run((db) => {
      db.query<unknown, [string, string, string]>("INSERT OR IGNORE INTO lore_index (user, world, entry) VALUES (?, ?, ?)").run(at.user, entry.world, entry.id);
      for (const field of LORE_INDEX_FIELDS) {
        if (!(field in edit)) continue;
        db.query<unknown, [string | null, number, string, string, string]>(`UPDATE lore_index SET own_${field} = ?, edited = ? WHERE user = ? AND world = ? AND entry = ?`).run(value(field), now, at.user, entry.world, entry.id);
      }
    }, "keeping the user's edit of the lore index");
    await this.writeFile(at);
    return joined(entry, this.rows(at.user, [entry]).get(placeOf(entry)));
  }

  /**
   * Writes the chat's readable index, `LORE-INDEX.md` at the top of its folder, from the table as it
   * stands; false when there is nowhere to write it (no file set up, or a chat with no folder yet).
   */
  async writeFile(at: LoreAt): Promise<boolean> {
    const file = this.deps.file;
    const folder = file?.folder(at.user, at.chat) ?? null;
    if (file === undefined || folder === null) return false;
    const text = loreIndexText(await file.lines(at), await this.entries(at));
    await mkdir(folder, { recursive: true });
    await writeWhole(join(folder, LORE_INDEX_FILE), `${text}\n`);
    return true;
  }

  /** `lore.unindexed`, in the shape the turn lane's facts registry takes an area's. */
  facts(): { area: "lore"; defs: readonly FactDef[]; read(scope: Scope, names: readonly string[]): Promise<Record<string, FactValue>> } {
    return {
      area: "lore",
      defs: [{ name: UNINDEXED, counts: "Entries of the chat's lore (its attached books' and its world's own) that no indexing run has written lines for as they stand now." }],
      read: async (scope, names): Promise<Record<string, FactValue>> => {
        if (!names.includes(UNINDEXED)) return {};
        const { left } = await this.batch({ user: scope.user, chat: scope.chat, ...(scope.turn !== undefined ? { turn: scope.turn } : {}) }, 0);
        return { [UNINDEXED]: { count: left } };
      },
    };
  }

  /** The index's rows for these entries, by where each is kept. */
  private rows(user: string, entries: readonly Pick<LoreCatalogEntry, "world" | "id">[]): Map<string, IndexRow> {
    const worlds = [...new Set(entries.map((e) => e.world))];
    const out = new Map<string, IndexRow>();
    if (worlds.length === 0) return out;
    const wanted = new Set(entries.map(placeOf));
    // Prepared rather than cached: the statement's shape changes with the number of worlds asked about.
    const rows = this.deps.db.prepare<IndexRow, string[]>(`SELECT world, entry, revision, kind, line, defines, related, own_kind, own_line, own_defines, own_related FROM lore_index WHERE user = ? AND world IN (${worlds.map(() => "?").join(", ")})`).all(user, ...worlds);
    for (const row of rows) {
      const place = placeOf({ world: row.world, id: row.entry });
      if (wanted.has(place)) out.set(place, row);
    }
    return out;
  }
}
