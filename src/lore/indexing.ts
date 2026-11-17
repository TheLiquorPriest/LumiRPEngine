// The lore index (plan §9.1): for every entry of a chat's lore, what the database holds at once (its
// id, book, title, keys, size, how it activates and its revision: `Lore.catalog`) beside what an
// indexing run wrote of it: its kind, one line saying what it is, what it defines, related entries and
// any fields beside those that the indexer's file asks for. The user may edit the lines; an edit stands
// over the run's and outlives a run that redoes the entry. A run's lines are kept by entry and by the
// revision of the entry the run was given (two chats, or a branch, on different revisions of one entry
// each keep their revision's and neither run replaces the other's), so after the first run only entries
// that have changed are handed out again.
//
// Code never starts a run (plan §13.5). It hands the next batch to whatever run asks, keeps what the
// run hands back, and counts what is left, as a fact the briefing shows and a rule may name.
//
// The chat's readable index, `LORE-INDEX.md`, is kept in step with what it shows: written at the chat's
// first briefing from the database half alone, and again whenever the text it would hold differs from
// the file (an entry changed in Lumiverse, or a run in another chat that changed lines this chat shares).

import type { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { LinesPart } from "../app/guidance";
import type { ActivatedLore, FactDef, FactValue, LoreEntry, Log, Scope } from "rp-harness/contract";
import { readText, writeWhole } from "../app/disk";
import type { LoreSettingsFor } from "./chat-settings";
import type { LoreWrites } from "./ids";
import { LORE_INDEX_FILE, type LoreIndexFile, loreIndexText } from "./index-file";
import { horizonRecords } from "./horizon";
import { type BindingRow, inForce, type LoreLink, pinLinks, putBindings, recordName, resolveRecord, storedBindings } from "./bindings";
import type { Lore, LoreAt, LoreCatalogEntry, LoreMapAsk } from "./lore";
import { loreLine } from "./tools";
import type { LoreMap, LoreMapLine } from "./map";
import { type OverlayRow, overlayNoted } from "./overlays";
import type { HeldSecret } from "./secrets/character";
import type { LoreBookListing, LorePath } from "./sources";
import type { WorldDoc } from "../shared/world";

/** Every fixed value of the index, each a setting with this default. */
export const LORE_INDEX_DEFAULTS = Object.freeze({
  /** Entries handed to an indexing run at a time (plan Appendix D.1). */
  batch: 20,
  /** Entries the lore map lists as bound to the horizon and not in the prompt (plan Appendix D.1). */
  bound: 12,
  /** The most characters of entry text in one batch an indexing run is handed, so twenty long entries never overrun a small model's window (plan §9.1; a batch always holds one entry at least). */
  batchChars: 48_000,
  /** Entries one page of the index as the Lore page shows it holds. */
  page: 50,
});

export type LoreIndexSettings = { -readonly [K in keyof typeof LORE_INDEX_DEFAULTS]: number };

/** What an entry defines (plan §9.3): a record it is the source for, by its name or its id in the world's tree, and which side of it. */
export interface LoreBinding {
  what: string;
  /** Which side of it the entry defines (its background, its layout); '' where none was said. */
  aspect: string;
}

/** A field of an index line beside the four the lore knows, as the indexer's file names it: a text, or a list of texts. */
export type LoreNamedValue = string | string[];

/** The fields beside kind, line, defines and related that `.agents/indexer.md` asks an index line to hold (plan D.2), by the names it gives them. */
export type LoreNamedFields = Record<string, LoreNamedValue>;

/** What the index holds of an entry. */
export interface LoreIndexLines {
  kind: string | null;
  /** One line saying what it is. */
  line: string | null;
  defines: LoreBinding[];
  /** Related entries, by RPE's ids. */
  related: string[];
  /** The fields beside those four, kept as the run sent them. */
  fields: LoreNamedFields;
}

/** The four lines the user may edit, each with its column. */
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
  /** What the entry is bound to: the binding store's rows in force (the owner's over a run's) and the world's own pins of it, each to a record by id. */
  links: LoreLink[];
}

/** One entry's lines as a run hands them back, with the revision of the entry it read them from, as its batch showed it. */
export interface LoreIndexInput extends Omit<LoreIndexLines, "fields"> {
  id: string;
  revision: string;
  fields?: LoreNamedFields;
}

/** What became of one entry a run handed back: kept, for the revision it was given at; or not, its id naming no entry of the chat's lore. */
export type LoreIndexOutcome = { id: string; kept: IndexedEntry } | { id: string; unknown: true };

/** The user's edit of an entry's lines: each field given is set as the user's own; null takes the user's own off, and the run's shows again. */
export type LoreIndexEdit = { [F in LoreIndexField]?: LoreIndexLines[F] | null };

/** A run's lines for one revision of an entry, as the table keeps them. */
interface IndexRow {
  world: string;
  entry: string;
  revision: string;
  kind: string | null;
  line: string | null;
  related: string | null;
  fields: string | null;
}

/** The user's own lines for an entry, whatever its revision. */
interface OwnRow {
  world: string;
  entry: string;
  own_kind: string | null;
  own_line: string | null;
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

/** Whether an entry is bound to one of `refs`, by a link to the record itself or to the cast character who is that person. */
function isBoundTo(e: IndexedEntry, refs: ReadonlySet<string>, persons: ReadonlyMap<string, string>): boolean {
  return e.links.some((l) => l.linked && (refs.has(l.record) || refs.has(persons.get(l.record) ?? "")));
}

function idsOf(raw: string | null): string[] | null {
  const list = listOf(raw);
  return list === null ? null : list.filter((id): id is string => typeof id === "string");
}

/** The named fields a row holds: the texts and lists of texts in its JSON object; nothing else. */
function namedOf(raw: string | null): LoreNamedFields {
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([name, v]): [string, LoreNamedValue][] => (typeof v === "string" ? [[name, v]] : Array.isArray(v) ? [[name, v.filter((i): i is string => typeof i === "string")]] : [])));
  } catch {
    return {};
  }
}

/** Where the index keeps an entry's lines: a world entry's key is its world's own, a book entry's number the user's for good. */
function placeOf(entry: Pick<LoreCatalogEntry, "world" | "id">): string {
  return `${entry.world}\u0000${entry.id}`;
}

/** What a job is handed is held by the user, the entry's place and its revision: an entry changed meanwhile is another claim. */
function claimOf(user: string, entry: Pick<LoreCatalogEntry, "world" | "id" | "revision">): string {
  return `${user}\u0000${placeOf(entry)}\u0000${entry.revision}`;
}

/** The next entries an indexing run is handed, and the counts the answer tells: `left` still to be handed to a run, `held` those another job has now. */
export interface LoreBatch {
  entries: IndexedEntry[];
  left: number;
  held: number;
}

/** What the table holds for one entry: a run's lines at each revision it was run at, newest first, and the user's own. */
interface Held {
  runs: IndexRow[];
  own?: OwnRow;
}

/** What the binding store and the world's pins give an entry: the links in force, what each reads as now, and whether the owner has bound it himself. */
interface Bound {
  links: LoreLink[];
  defines: LoreBinding[];
  owned: boolean;
}

/** An entry with its lines, the user's own over the run's; the run's at its revision as it stands now, else at the newest earlier one. */
function joined(entry: LoreCatalogEntry, held: Held | undefined, bound: Bound | undefined): IndexedEntry {
  const own = { kind: held?.own?.own_kind ?? null, line: held?.own?.own_line ?? null, related: idsOf(held?.own?.own_related ?? null) };
  const edited: LoreIndexField[] = [...(own.kind === null ? [] : (["kind"] as const)), ...(own.line === null ? [] : (["line"] as const)), ...(bound?.owned === true ? (["defines"] as const) : []), ...(own.related === null ? [] : (["related"] as const))];
  const current = held?.runs.find((r) => r.revision === entry.revision);
  const row = current ?? held?.runs[0];
  return {
    ...entry,
    kind: own.kind ?? row?.kind ?? null,
    line: own.line ?? row?.line ?? null,
    defines: bound?.defines ?? [],
    links: bound?.links ?? [],
    related: own.related ?? idsOf(row?.related ?? null) ?? [],
    fields: namedOf(row?.fields ?? null),
    indexed: current !== undefined,
    stale: current === undefined && row !== undefined,
    edited,
  };
}

export interface LoreIndexDeps {
  lore: Lore;
  db: Database;
  writes: LoreWrites;
  /** What each reading of the overlays sees: the story's overlays as the store folded them at its point. */
  path: LorePath;
  settings?: Partial<LoreIndexSettings>;
  /** Where the chat's readable index is written; absent, it is not written. */
  file?: LoreIndexFile;
  /** What a chat's levels set of the lore's settings (his own index entry); absent, none is set. */
  settingsFor?: LoreSettingsFor;
  /** Milliseconds since 1970, for when lines were written; `Date.now` when absent. */
  now?: () => number;
  /** Where a readable index that could not be kept is said. */
  log?: Log;
  /** Whether the user's job is still going (waiting, held, running or asking): an entry handed to a job that has ended is handed out again. Absent, a job is taken to be going until it writes or `release`s. */
  jobRunning?: (user: string, job: string) => Promise<boolean>;
}

/** An entry Lumiverse activated for a turn's prompt, as the lore map read it: what the turn's folder lays out, reading nothing again. */
export interface ActivatedRead extends ActivatedLore {
  /** Its text as any reader may read it (`LoreCatalogEntry.text`); absent where the map's reading of the chat's lore holds no entry of this id. */
  text?: string;
}

/** The lore map in full for a turn, with the entries that activated for its prompt as the map read them, in the tag's order. */
export interface TurnLoreMap extends LoreMap {
  activated: ActivatedRead[];
}

const UNINDEXED = "lore.unindexed";

export class LoreIndex {
  readonly settings: Readonly<LoreIndexSettings>;
  /** The chats whose readable index this index has kept, which a run in another chat that changed lines they share brings up to date. */
  readonly #kept = new Map<string, { user: string; chat: string }>();
  /** Entries handed to an indexing job, by where each is kept and its revision: the job's until it writes lines for them or ends. */
  readonly #claims = new Map<string, string>();

  constructor(private readonly deps: LoreIndexDeps) {
    this.settings = Object.freeze({ ...LORE_INDEX_DEFAULTS, ...deps.settings });
  }

  /** The index's numbers for this chat: its levels' settings over the global ones the index was made with, as they stand now. */
  async settingsAt(at: LoreAt): Promise<Readonly<LoreIndexSettings>> {
    return { ...this.settings, ...(await this.deps.settingsFor?.(at))?.index };
  }

  /** The answers' lines in force for the chat (`.prompts/lore-answers.md`), by the one reader the readable index is worded with; undefined where the part is off or no file is set up. */
  async lines(at: LoreAt): Promise<LinesPart | undefined> {
    return this.deps.file?.lines(at);
  }

  /** Entries in full as the lead and the GM read them (`Lore.read`), each with the notes the story has written on it (`noted`). */
  async read(at: LoreAt, ids: readonly string[]): Promise<LoreEntry[]> {
    return this.noted(at, await this.deps.lore.read(at, ids));
  }

  /** The entries the character a reader plays may know (`Lore.readAs`), each with the notes the story has written on it (`noted`). */
  async readAs(at: LoreAt, plays: string, ids: readonly string[]): Promise<LoreEntry[]> {
    return this.noted(at, await this.deps.lore.readAs(at, plays, ids));
  }

  /**
   * `entries` with the notes the story has written on each: the overlays of the turns on the path at `at`, each worded by the answers'
   * line `read_note` (the note and the turn it was written on) after the entry's text, or as the note stands where the part has none.
   * A note travels with the entry to every reader, as it does to every part of the lore map.
   */
  private async noted(at: LoreAt, entries: LoreEntry[]): Promise<LoreEntry[]> {
    const notes = overlayNoted(this.deps.path.overlays(at.user, at.chat, at.turn), entries.map((e) => e.id));
    if (notes.size === 0) return entries;
    const lines = await this.lines(at);
    return entries.map((e) => {
      const n = notes.get(e.id);
      return n === undefined ? e : { ...e, text: [e.text, ...n.map((x) => loreLine(lines, "read_note", { note: x.note, turn: x.turn }) ?? x.note)].join("\n\n") };
    });
  }

  /** The overlays on the chat's path as the Lore page lists them: each with its entry (and the entry's title where the chat's lore holds it), its note, the turn that wrote it and who wrote it, in the path's order. */
  async overlays(at: LoreAt): Promise<(OverlayRow & { title: string | null })[]> {
    const rows = this.deps.path.overlays(at.user, at.chat, at.turn);
    if (rows.length === 0) return [];
    const titles = new Map((await this.deps.lore.catalog(at)).map((e) => [e.id, e.title]));
    return rows.map((r) => ({ ...r, title: titles.get(r.entry) ?? null }));
  }

  /** Every book of the user's, as the Settings page lists them for his choice of books. */
  bookList(at: LoreAt): Promise<LoreBookListing[]> {
    return this.deps.lore.bookList(at);
  }

  /**
   * The lore map in full for a turn (`map.ts`), on the first form `Lore.loreMap` gives: each entry
   * with what the index says of it; the activated entries the overlays on the turn's path have
   * outdated; and the entries bound to who and what is on the horizon, in the horizon's order, that
   * are not in the map's first parts, up to the setting's limit, with the count of any left out. With
   * it, the entries that activated as it read them, their text from its reading of the chat's lore.
   * The chat's readable index is kept in step with what the entries now show.
   */
  async loreMap(ask: LoreMapAsk): Promise<TurnLoreMap> {
    const [first, entries] = await Promise.all([this.deps.lore.loreMap(ask), this.entries(ask)]);
    const set = await this.settingsAt(ask);
    await this.keepFile(ask, entries);
    const byId = new Map(entries.map((e) => [e.id, e]));
    const described = (l: LoreMapLine): LoreMapLine => {
      const e = byId.get(l.id);
      if (e === undefined) return l;
      // An entry no run has indexed shows its keys in place of what it is; one indexed at an earlier revision shows what it was, marked as changed since.
      return {
        ...l,
        ...(e.kind !== null ? { kind: e.kind } : {}),
        ...(e.line !== null ? { line: e.line } : {}),
        ...(e.defines.length > 0 ? { defines: e.defines } : {}),
        ...(Object.keys(e.fields).length > 0 ? { fields: e.fields } : {}),
        ...(e.indexed ? {} : e.stale ? { stale: true } : { keys: e.keys }),
      };
    };
    const first1 = first.inPrompt.map(described);
    const first3 = first.world.map(described);

    const at = this.deps.lore.worldAt(ask);
    const shown = new Set([...first1, ...first3].map((l) => l.id));
    const persons = this.personsOf(ask, entries);
    const boundTo = new Map<string, string[]>();
    for (const record of at === null ? [] : horizonRecords(at)) {
      // A pin to a place holds for the places inside it.
      const refs = new Set([record.ref, ...record.holds]);
      for (const e of entries) {
        if (shown.has(e.id) || !isBoundTo(e, refs, persons)) continue;
        boundTo.set(e.id, [...(boundTo.get(e.id) ?? []), record.name]);
      }
    }
    // A map's insertion order is the order each entry was first bound: the player's character's first.
    const order = [...boundTo];
    const bound4 = order.slice(0, set.bound).flatMap(([id, to]) => {
      const e = byId.get(id);
      return e === undefined ? [] : [{ ...described({ id, title: e.title }), bound: to }];
    });
    // The story's notes travel with the entry: every part that shows an entry shows what the story has moved past in it, each note with the turn it was written on. So do its secrets, each by id with who holds it.
    const notes = overlayNoted(this.deps.path.overlays(ask.user, ask.chat, ask.turn), [...first1, ...first3, ...bound4].map((l) => l.id));
    const secrets = new Map((await this.deps.lore.read(ask, [...new Set([...first1, ...first3, ...bound4].map((l) => l.id))])).flatMap((e) => (e.secrets === undefined || e.secrets.length === 0 ? [] : [[e.id, e.secrets.map((s) => ({ id: s.id, holders: s.heldBy }))] as const])));
    const noted = (l: LoreMapLine): LoreMapLine => {
      const n = notes.get(l.id);
      const s = secrets.get(l.id);
      return n === undefined && s === undefined ? l : { ...l, ...(n === undefined ? {} : { notes: n }), ...(s === undefined ? {} : { secrets: s }) };
    };
    const inPrompt = first1.map(noted);
    const world = first3.map(noted);
    const bound = bound4.map(noted);
    // Part 2 lists those of part 1 the story has outdated.
    const changed = inPrompt.filter((l) => l.notes !== undefined);
    const activated = first.inPrompt.map(({ id, title, source, how }): ActivatedRead => {
      const text = byId.get(id)?.text;
      return { id, title, source: source ?? "", ...(how !== undefined ? { how } : {}), ...(text !== undefined ? { text } : {}) };
    });
    return { inPrompt, world, changed, bound, leftOut: Math.max(0, order.length - set.bound), notIndexed: entries.filter((e) => !e.indexed).length, activated };
  }

  /** Every entry of the chat's lore, in the catalog's order, with its index lines and what it is bound to. */
  async entries(at: LoreAt): Promise<IndexedEntry[]> {
    const catalog = await this.deps.lore.catalog(at);
    const held = this.rows(at.user, catalog);
    const bound = this.bindings(at, catalog);
    return catalog.map((entry) => joined(entry, held.get(placeOf(entry)), bound.get(entry.id)));
  }

  /**
   * The index of the books a world reads, for no chat (Build's lore index): its readable text as `lines` word it (`loreIndexText`, as a
   * chat's `LORE-INDEX.md` is), and each book with how many entries it lists. What an entry is bound to is a chat's, and is left out.
   */
  async ofWorld(user: string, world: WorldDoc, lines: LinesPart | undefined): Promise<{ text: string; books: { id: string; name: string; entries: number }[] }> {
    const catalog = await this.deps.lore.worldCatalog(user, world);
    const held = this.rows(user, catalog);
    const entries = catalog.map((entry) => joined(entry, held.get(placeOf(entry)), undefined));
    const books = new Map<string, { id: string; name: string; entries: number }>();
    for (const e of entries) {
      if (e.book === null) continue;
      const book = books.get(e.book) ?? { id: e.book, name: e.source, entries: 0 };
      book.entries += 1;
      books.set(e.book, book);
    }
    return { text: loreIndexText(lines, entries), books: [...books.values()] };
  }

  /**
   * What each entry is bound to as it reads now: the binding store's rows in force, each by the name its record has now (a record
   * the world no longer has, or a cast character no longer there, reads as unlinked), and the world's own pins of it.
   */
  private bindings(at: LoreAt, catalog: readonly LoreCatalogEntry[]): Map<string, Bound> {
    const world = this.deps.lore.worldAt(at);
    const stored = storedBindings(this.deps.db, at.user);
    const read = (r: BindingRow): { what: string; linked: boolean } => {
      if (!r.linked || r.record.startsWith("quest:")) return { what: r.record, linked: r.linked };
      const name = r.record.startsWith("cast:") ? this.deps.lore.castName(at, r.record.slice("cast:".length)) : recordName(world, r.record);
      return { what: name ?? r.record, linked: name !== null };
    };
    return new Map(
      catalog.map((entry): [string, Bound] => {
        const rows = inForce(stored.get(entry.id)).map((r) => ({ r, ...read(r) }));
        const links: LoreLink[] = [...rows.map(({ r, linked }) => ({ record: r.record, linked, aspect: r.aspect, by: r.by })), ...(world === null ? [] : pinLinks(world, entry))];
        return [entry.id, { links, defines: rows.map(({ r, what }) => ({ what, aspect: r.aspect })), owned: stored.get(entry.id)?.some((r) => r.by === "owner") === true }];
      }),
    );
  }

  /** The world person each cast character the entries are bound to is, as `entity:<id>`: the cast and the world meet by the character's id or name (`Lore.personPlayed`). */
  private personsOf(at: LoreAt, entries: readonly IndexedEntry[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const e of entries) {
      for (const l of e.links) {
        if (!l.linked || !l.record.startsWith("cast:") || out.has(l.record)) continue;
        const person = this.deps.lore.personPlayed(at, l.record.slice("cast:".length));
        if (person !== null) out.set(l.record, `entity:${person.id}`);
      }
    }
    return out;
  }

  /**
   * The next entries no run has indexed as they stand now, in the catalog's order: at most `size` (the setting's when absent) and
   * at most the characters of text the chat's setting allows in one batch (one entry at least, however long). With `job`, the
   * batch is that job's: held for it until it writes lines for them or it ends, so a second job at the same time is handed the
   * next entries and none is indexed twice at once. `left` counts the entries still to be handed to a run; `held`, those another
   * job has now.
   */
  async batch(at: LoreAt, size?: number, job?: string): Promise<LoreBatch> {
    const unindexed = (await this.entries(at)).filter((e) => !e.indexed);
    const going = new Map<string, boolean>();
    const free: IndexedEntry[] = [];
    let held = 0;
    for (const e of unindexed) {
      const by = this.#claims.get(claimOf(at.user, e));
      if (by !== undefined && by !== job && (await this.going(at.user, by, going))) held += 1;
      else free.push(e);
    }
    const set = await this.settingsAt(at);
    const entries: IndexedEntry[] = [];
    let chars = 0;
    for (const e of free) {
      if (entries.length >= Math.max(0, Math.floor(size ?? set.batch)) || (entries.length > 0 && chars + e.text.length > set.batchChars)) break;
      entries.push(e);
      chars += e.text.length;
    }
    if (job !== undefined) for (const e of entries) this.#claims.set(claimOf(at.user, e), job);
    return { entries, left: free.length, held };
  }

  /** How many entries of the chat's lore no run has indexed as they stand now, those another job holds included. */
  async unindexed(at: LoreAt): Promise<number> {
    return (await this.entries(at)).filter((e) => !e.indexed).length;
  }

  /** Gives back what a job was handed and has not written lines for: it ended. */
  release(job: string): void {
    for (const [key, by] of this.#claims) if (by === job) this.#claims.delete(key);
  }

  /** Whether the job still holds what it was handed: one that has ended gives it back. `known` keeps the answer for one batch. */
  private async going(user: string, job: string, known: Map<string, boolean>): Promise<boolean> {
    let now = known.get(job);
    if (now === undefined) {
      now = this.deps.jobRunning === undefined ? true : await this.deps.jobRunning(user, job);
      known.set(job, now);
      if (!now) this.release(job);
    }
    return now;
  }

  /**
   * The lore bound as known to the character a reader plays (plan §9.4): the entries whose bindings
   * name the world's person it is (`Lore.personPlayed`), by tree ref, id or name as the lore map
   * matches a binding, as that character may read them (`Lore.readAs`), in the catalog's order. Null
   * when the reader plays no one in the chat's world.
   */
  async knownTo(at: LoreAt, plays: string): Promise<LoreEntry[] | null> {
    const person = this.deps.lore.personPlayed(at, plays);
    if (person === null) return null;
    const all = await this.entries(at);
    const persons = this.personsOf(at, all);
    const refs = new Set([`entity:${person.id}`]);
    const bound = all.filter((e) => isBoundTo(e, refs, persons));
    return bound.length === 0 ? [] : this.noted(at, await this.deps.lore.readAs(at, person.id, bound.map((e) => e.id)));
  }

  /** The secrets the character a reader plays holds, with how it came by each and the tokens they may take (`Lore.held`); null when it plays no one in the chat's world. */
  held(at: LoreAt, plays: string): Promise<{ secrets: HeldSecret[]; budget: number } | null> {
    return this.deps.lore.held(at, plays);
  }

  /**
   * Keeps a run's lines for entries of the chat's lore, each for the revision the run read the entry
   * at, in one write: an entry changed since its batch was handed out keeps them as an earlier
   * revision's, and is handed out again. The user's own lines are left as they are. An id that names
   * no entry of the chat's lore keeps nothing, and says so. What `job` wrote lines for is no longer held for it.
   */
  async write(at: LoreAt, lines: readonly LoreIndexInput[], by: string, job?: string): Promise<LoreIndexOutcome[]> {
    const catalog = new Map((await this.deps.lore.catalog(at)).map((e) => [e.id, e]));
    const now = (this.deps.now ?? Date.now)();
    const kept = lines.flatMap((l) => {
      const entry = catalog.get(l.id);
      return entry === undefined ? [] : [{ entry, lines: l }];
    });
    const world = this.deps.lore.worldAt(at);
    await this.deps.writes.run((db) => {
      const put = db.query<unknown, [string, string, string, string, string | null, string | null, string, string, string, number]>(
        `INSERT INTO lore_index (user, world, entry, revision, kind, line, related, fields, by, written) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user, world, entry, revision) DO UPDATE SET kind = excluded.kind, line = excluded.line, related = excluded.related, fields = excluded.fields, by = excluded.by, written = excluded.written`,
      );
      for (const { entry, lines: l } of kept) {
        put.run(at.user, entry.world, entry.id, l.revision, l.kind, l.line, JSON.stringify(l.related), JSON.stringify(l.fields ?? {}), by, now);
        // What the run says the entry defines is its bindings, each to the record by its id: the run's latest replaces its earlier ones, and the owner's stand over them.
        putBindings(db, at.user, entry.id, "run", l.defines.map((b) => ({ ...resolveRecord(world, b.what), aspect: b.aspect })), l.revision, now);
      }
    }, "keeping lore index lines");
    // What was written is no longer held for the job that was handed it.
    if (job !== undefined) for (const { entry, lines: l } of kept) this.#claims.delete(claimOf(at.user, { ...entry, revision: l.revision }));
    await this.keepFiles(at);
    const held = this.rows(at.user, kept.map((k) => k.entry));
    const bound = this.bindings(at, kept.map((k) => k.entry));
    return lines.map((l): LoreIndexOutcome => {
      const entry = catalog.get(l.id);
      return entry === undefined ? { id: l.id, unknown: true } : { id: l.id, kept: joined(entry, held.get(placeOf(entry)), bound.get(entry.id)) };
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
    const world = this.deps.lore.worldAt(at);
    await this.deps.writes.run((db) => {
      db.query<unknown, [string, string, string]>("INSERT OR IGNORE INTO lore_index_own (user, world, entry) VALUES (?, ?, ?)").run(at.user, entry.world, entry.id);
      for (const field of LORE_INDEX_FIELDS) {
        if (field === "defines" || !(field in edit)) continue;
        db.query<unknown, [string | null, number, string, string, string]>(`UPDATE lore_index_own SET own_${field} = ?, edited = ? WHERE user = ? AND world = ? AND entry = ?`).run(value(field), now, at.user, entry.world, entry.id);
      }
      // His own bindings stand over a run's and outlive a run that redoes the entry; null takes them off, and the run's show again.
      if ("defines" in edit) putBindings(db, at.user, entry.id, "owner", (edit.defines ?? []).map((b) => ({ ...resolveRecord(world, b.what), aspect: b.aspect })), null, now);
    }, "keeping the user's edit of the lore index");
    await this.keepFiles(at);
    return joined(entry, this.rows(at.user, [entry]).get(placeOf(entry)), this.bindings(at, [entry]).get(entry.id));
  }

  /**
   * Writes the chat's readable index, `LORE-INDEX.md` at the top of its folder, from the table as it
   * stands, when it differs from the file there; false when there is nowhere to write it (no file set
   * up, or a chat with no folder yet). It is there from the chat's first briefing, before any run.
   */
  async writeFile(at: LoreAt): Promise<boolean> {
    return this.keepFile(at, await this.entries(at));
  }

  /** `lore.unindexed`, in the shape the turn lane's facts registry takes an area's. */
  facts(): { area: "lore"; defs: readonly FactDef[]; read(scope: Scope, names: readonly string[]): Promise<Record<string, FactValue>> } {
    return {
      area: "lore",
      defs: [{ name: UNINDEXED, counts: "Entries of the chat's lore (its attached books' and its world's own) that no indexing run has written lines for as they stand now." }],
      read: async (scope, names): Promise<Record<string, FactValue>> => {
        if (!names.includes(UNINDEXED)) return {};
        return { [UNINDEXED]: { count: await this.unindexed({ user: scope.user, chat: scope.chat, ...(scope.turn !== undefined ? { turn: scope.turn } : {}) }) } };
      },
    };
  }

  /**
   * The chat's readable index kept as `entries` show it: the text of his own index entry where he has one, then the
   * lines in force. Written only when it differs from the file. A file that cannot be kept never stops what called for it.
   */
  private async keepFile(at: LoreAt, entries: readonly IndexedEntry[]): Promise<boolean> {
    const file = this.deps.file;
    const folder = file?.folder(at.user, at.chat) ?? null;
    if (file === undefined || folder === null) return false;
    try {
      const id = (await this.deps.settingsFor?.(at))?.indexEntry ?? null;
      const [lines, head] = await Promise.all([file.lines(at), id === null ? null : this.deps.lore.bookText(at, id)]);
      const text = `${loreIndexText(lines, entries, head)}\n`;
      const path = join(folder, LORE_INDEX_FILE);
      if ((await readText(path)) !== text) {
        await mkdir(folder, { recursive: true });
        await writeWhole(path, text);
      }
      this.#kept.set(`${at.user}\u0000${at.chat}`, { user: at.user, chat: at.chat });
      return true;
    } catch (error) {
      this.deps.log?.warn("A chat's readable lore index could not be kept.", { chat: at.chat, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  /** This chat's readable index, and every other chat's of the same user that this index has kept, brought up to date: a run in one chat changes lines the others share. */
  private async keepFiles(at: LoreAt): Promise<void> {
    await this.writeFile(at);
    const others = [...this.#kept.values()].filter((k) => k.user === at.user && k.chat !== at.chat);
    await Promise.all(others.map((k) => this.writeFile(k)));
  }

  /** The index's rows for these entries, by where each is kept. */
  private rows(user: string, entries: readonly Pick<LoreCatalogEntry, "world" | "id">[]): Map<string, Held> {
    const worlds = [...new Set(entries.map((e) => e.world))];
    const out = new Map<string, Held>();
    if (worlds.length === 0) return out;
    const wanted = new Set(entries.map(placeOf));
    const marks = worlds.map(() => "?").join(", ");
    // Prepared rather than cached: the statement's shape changes with the number of worlds asked about.
    const runs = this.deps.db.prepare<IndexRow, string[]>(`SELECT world, entry, revision, kind, line, related, fields FROM lore_index WHERE user = ? AND world IN (${marks}) ORDER BY written DESC, rowid DESC`).all(user, ...worlds);
    for (const row of runs) {
      const place = placeOf({ world: row.world, id: row.entry });
      if (!wanted.has(place)) continue;
      const held = out.get(place) ?? { runs: [] };
      held.runs.push(row);
      out.set(place, held);
    }
    const owns = this.deps.db.prepare<OwnRow, string[]>(`SELECT world, entry, own_kind, own_line, own_related FROM lore_index_own WHERE user = ? AND world IN (${marks})`).all(user, ...worlds);
    for (const row of owns) {
      const place = placeOf({ world: row.world, id: row.entry });
      if (!wanted.has(place)) continue;
      const held = out.get(place) ?? { runs: [] };
      held.own = row;
      out.set(place, held);
    }
    return out;
  }
}
