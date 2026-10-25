// What LRE knows of the secrets in a user's World Info books, and the copies it keeps of them (DESIGN
// §4.2, §6.1). A secret's text is secret wherever it is: an entry anywhere in the user's books that
// holds the same text, whitespace aside, whatever its book is named, reads as that secret does
// (`secrecyParts`), for the interceptor, the helpers' live lore and the pins alike; so does one the
// host builds from a character's card for a prompt, which no book stores. Each of the user's books is
// read into an index once, and again only once the host says it changed, so knowing costs one list of
// the books per read. The same index keeps those twins stored switched off, as copies of their secret
// (`secureCopies`), for whatever reads no text: a prompt the interceptor fails on or runs out of time
// for, a chat that plays no world. While some book of the user's has never been read, any text may be
// a secret's, so every book entry is held back until it is.

import type { UserId } from "../shared/ids";
import { isRecord, type JsonObject } from "../shared/json";
import { hashParts } from "../shared/hash";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { bookLoreFieldsOf, engineWroteEntry, LORE_AUDIENCE, loreIsSecret, loreSourceOf, withBookLoreFields, type BookLoreFields } from "../shared/lore";
import type { LoreEntryDef, StepPurpose, WorldDoc } from "../shared/world";
import type { HostBookEntry, HostPort } from "./host";

type Host = Pick<HostPort, "books" | "log">;

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The key a text is known by: each run of whitespace one space, the ends trimmed, hashed (the index keeps no text); "" for none. */
export function textOf(content: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  return text === "" ? "" : hashParts("lre-lore-text-v1", text);
}

/** An entry as a copy names its original, and a world entry its source: `bookId/entryId`. */
function keyOf(e: { bookId: string; id: string }): string {
  return `${e.bookId}/${e.id}`;
}

/**
 * The note beside a twin LRE keeps secret as a copy of a secret (`lumi_rp_engine.secretCopyOf`): the
 * original, as `bookId/entryId`, and how the twin stood before, so that it is put back as it was once
 * no secret holds its text.
 */
export interface SecretCopy {
  entry: string;
  /** Whether it was stored switched off. */
  off: boolean;
  /** Its own LRE fields, or null when it had none. */
  fields: BookLoreFields | null;
}

/** The note on an entry LRE keeps secret as a copy, or null. */
export function secretCopyOf(extensions: unknown): SecretCopy | null {
  const ns = isRecord(extensions) ? extensions[LEDGER_NAMESPACE] : undefined;
  const raw = isRecord(ns) ? ns.secretCopyOf : undefined;
  if (!isRecord(raw) || typeof raw.entry !== "string") return null;
  return { entry: raw.entry, off: raw.off === true, fields: isRecord(raw.fields) ? bookLoreFieldsOf({ [LEDGER_NAMESPACE]: { lore: raw.fields } }) : null };
}

/** Extension data with `copy` as its note (null takes it off), everything else in it kept. */
export function withSecretCopy(extensions: JsonObject, copy: SecretCopy | null): JsonObject {
  const held = extensions[LEDGER_NAMESPACE];
  const ns: JsonObject = isRecord(held) ? { ...held } : {};
  if (copy === null) delete ns.secretCopyOf;
  else ns.secretCopyOf = { entry: copy.entry, off: copy.off, fields: copy.fields === null ? null : (JSON.parse(JSON.stringify(copy.fields)) as JsonObject) };
  const out: JsonObject = { ...extensions };
  if (Object.keys(ns).length === 0) delete out[LEDGER_NAMESPACE];
  else out[LEDGER_NAMESPACE] = ns;
  return out;
}

/** An entry's own secret: LRE's secret fields, unless it holds them as a copy. */
export function ownSecret(e: Pick<HostBookEntry, "extensions">): BookLoreFields | null {
  const fields = bookLoreFieldsOf(e.extensions);
  return fields !== null && loreIsSecret(fields) && secretCopyOf(e.extensions) === null ? fields : null;
}

/** The entry a copy names as its original. */
export function copyOriginal(copy: SecretCopy): { bookId: string; entryId: string } {
  const slash = copy.entry.indexOf("/");
  return { bookId: copy.entry.slice(0, Math.max(0, slash)), entryId: copy.entry.slice(slash + 1) };
}

/** Whether LRE fields keep a text from some reader: secret, or Known by. */
function restricts(fields: BookLoreFields): boolean {
  return loreIsSecret(fields) || fields.visibility === "known_by";
}

/** An entry of the user's books as the index keeps it: whether it is a secret, a copy, and of which text. */
interface Indexed {
  id: string;
  bookId: string;
  /** Its text's key (`textOf`). */
  text: string;
  fields: BookLoreFields | null;
  copy: SecretCopy | null;
  disabled: boolean;
}

function indexed(e: Pick<HostBookEntry, "id" | "bookId" | "content" | "extensions" | "disabled">): Indexed {
  return { id: e.id, bookId: e.bookId, text: textOf(e.content), fields: bookLoreFieldsOf(e.extensions), copy: secretCopyOf(e.extensions), disabled: e.disabled };
}

/** The same index entry, read twice (the index builds both alike, so their JSON is alike too). */
function sameIndexed(a: Indexed | undefined, b: Indexed): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

/** A world's secret and Known-by entries indexed from book entries, as its last pass read them: their fields by the entry each came from, and by its text. */
interface WorldSources {
  sources: Map<string, BookLoreFields[]>;
  texts: Map<string, BookLoreFields[]>;
}

/** What LRE knows of the secrets in one user's books (see the header). */
export interface LoreIndex {
  /** Each of the user's books as last read, the engine's own left out, by id: the host's time of its last change then, the second it was read in, and its entries. */
  readonly books: Map<string, { stamp: number | null; at: number; entries: Indexed[] }>;
  /** The ids of the user's books as last listed, the engine's own left out; null until a list is read. */
  listed: string[] | null;
  /** The secrets each world's last pass found indexed from book entries, by world id (`recordWorld`). */
  readonly worlds: Map<string, WorldSources>;
  /** How many of LRE's own writes the index noted in each book, by id: a read of a book that one landed during is older than the note. */
  readonly notes: Map<string, number>;
  /** Whether what keeps the copies changed since the last pass over them (`secureCopies`). */
  changed: boolean;
  /** The read running now: the next waits for it. */
  reading: Promise<void>;
  /** The pass running now (`lorePass`): passes, and LRE's writes of lore fields, go one at a time. */
  writing: Promise<void>;
}

/** Each host's indexes, by user: kept as long as the host is. */
const indexes = new WeakMap<object, Map<UserId, LoreIndex>>();

function indexOf(host: Pick<HostPort, "books">, userId: UserId): LoreIndex {
  let users = indexes.get(host.books);
  if (!users) {
    users = new Map();
    indexes.set(host.books, users);
  }
  let index = users.get(userId);
  if (!index) {
    index = { books: new Map(), listed: null, worlds: new Map(), notes: new Map(), changed: true, reading: Promise.resolve(), writing: Promise.resolve() };
    users.set(userId, index);
  }
  return index;
}

/** Whether every book of the user's has been read: until then, any text may be a secret's. */
function complete(index: LoreIndex): boolean {
  return index.listed !== null && index.listed.every((id) => index.books.has(id));
}

/** Every entry the index holds, by id. */
function entriesById(index: LoreIndex): Map<string, Indexed> {
  return new Map([...index.books.values()].flatMap((b) => b.entries.map((e): [string, Indexed] => [e.id, e])));
}

/**
 * Lists the user's books and reads each one the host says changed since the index read it, or that it
 * never read. The host's times are whole seconds, so a book changed in the second it was read in is
 * read again. A list or a book that can't be read is logged, and what was read of it before stays:
 * nothing but LRE's own writes, which it notes, makes an entry secret.
 */
async function refresh(host: Host, index: LoreIndex, userId: UserId): Promise<void> {
  let books: { id: string; updated: number | null }[];
  try {
    books = (await host.books.list(userId)).filter((b) => !b.engine);
  } catch (error) {
    host.log("warn", `[LumiRPEngine] your World Info books weren't listed, so their secrets are as last read${complete(index) ? "" : "; some never were, so every book entry is held back until they are"}: ${message(error)}`, userId);
    return;
  }
  const listed = new Set(books.map((b) => b.id));
  for (const id of [...index.books.keys()]) {
    if (listed.has(id)) continue;
    index.books.delete(id);
    index.changed = true;
  }
  index.listed = books.map((b) => b.id);
  await Promise.all(
    books.map(async (b) => {
      const was = index.books.get(b.id);
      if (was && b.updated !== null && was.stamp === b.updated && b.updated < was.at) return;
      const at = Math.floor(Date.now() / 1000);
      const notes = index.notes.get(b.id) ?? 0;
      try {
        const entries = (await host.books.entries(b.id, userId)).filter((e) => !engineWroteEntry(e.extensions)).map(indexed);
        // A write LRE noted while this read was out is newer than it, and its stamp has the next read read the book again.
        if ((index.notes.get(b.id) ?? 0) !== notes) return;
        if (!was || JSON.stringify(was.entries) !== JSON.stringify(entries)) index.changed = true;
        index.books.set(b.id, { stamp: b.updated, at, entries });
      } catch (error) {
        host.log("warn", `[LumiRPEngine] World Info book ${b.id} wasn't read, so its secrets are as last read${was ? "" : "; it never was, so every book entry is held back until it is"}: ${message(error)}`, userId);
      }
    }),
  );
}

/** What LRE knows of the secrets in the user's books, read now (see `refresh`): reads go one at a time, each after the last. */
export async function loreIndex(host: Host, userId: UserId): Promise<LoreIndex> {
  const index = indexOf(host, userId);
  const read = index.reading.then(() => refresh(host, index, userId));
  index.reading = read.catch(() => undefined);
  await read;
  return index;
}

/** The same as last read, for what can't wait for a read: an interceptor that failed. */
export function lastLoreIndex(host: Pick<HostPort, "books">, userId: UserId): LoreIndex {
  return indexOf(host, userId);
}

/**
 * Runs `fn` on the index read now, after every earlier pass of the user's: what keeps the copies and
 * the copies themselves are then written by one pass at a time, Build's writes of an entry's fields
 * among them. A pass must not start another.
 */
export function lorePass<T>(host: Host, userId: UserId, fn: (index: LoreIndex) => Promise<T>): Promise<T> {
  const index = indexOf(host, userId);
  const run = index.writing.then(async () => fn(await loreIndex(host, userId)));
  index.writing = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** The index once LRE read `e` afresh, or wrote it (`written`): as it is now, before the host's next list says its book changed. */
export function noteEntry(index: LoreIndex, e: Pick<HostBookEntry, "id" | "bookId" | "content" | "extensions" | "disabled">, written = true): void {
  if (written) index.notes.set(e.bookId, (index.notes.get(e.bookId) ?? 0) + 1);
  const book = index.books.get(e.bookId);
  if (!book || engineWroteEntry(e.extensions)) return;
  const next = indexed(e);
  const at = book.entries.findIndex((x) => x.id === e.id);
  if (sameIndexed(book.entries[at], next)) return;
  if (at >= 0) book.entries[at] = next;
  else book.entries.push(next);
  index.changed = true;
}

/** The fields a world entry holds its text to, when it holds it to any: its secrecy, its audience and holders, and its Known by. */
function worldFields(entry: LoreEntryDef): BookLoreFields | null {
  const secret = loreIsSecret(entry);
  const knownBy = entry.visibility !== undefined && entry.visibility !== "public";
  if (!secret && !knownBy) return null;
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);
  const out: BookLoreFields = {};
  if (secret) {
    out.secret = true;
    out.gate = typeof entry.gate === "string" ? entry.gate : "";
  }
  const audience = ids(entry.audience).filter((p): p is StepPurpose => (LORE_AUDIENCE as readonly string[]).includes(p));
  if (audience.length > 0) out.audience = audience;
  const holders = ids(entry.holders);
  if (holders.length > 0) out.holders = holders;
  if (knownBy) {
    out.visibility = "known_by";
    out.links = ids(entry.links);
  }
  return out;
}

function add(map: Map<string, BookLoreFields[]>, key: string, fields: BookLoreFields): void {
  if (key === "") return;
  const list = map.get(key);
  if (list) list.push(fields);
  else map.set(key, [fields]);
}

/**
 * What `world`'s secret and Known-by entries hold their text to: by the book entry each was indexed
 * from, and by its text, the source's as the index read it among them. `sourcesOnly` leaves out an
 * entry written in the world itself, whose text binds no other world's chats.
 */
function worldSources(world: WorldDoc, byId: ReadonlyMap<string, Indexed> | null, sourcesOnly: boolean): WorldSources {
  const out: WorldSources = { sources: new Map(), texts: new Map() };
  for (const entry of Object.values(world.lore)) {
    const fields = worldFields(entry);
    if (!fields) continue;
    const source = loreSourceOf(entry.source);
    if (source.kind !== "book" && sourcesOnly) continue;
    add(out.texts, textOf(typeof entry.content === "string" ? entry.content : ""), fields);
    if (source.kind !== "book") continue;
    add(out.sources, `${source.bookId}/${source.entryId}`, fields);
    const now = byId?.get(source.entryId);
    if (now) add(out.texts, now.text, fields);
  }
  return out;
}

/**
 * Keeps what `world`'s secrets indexed from book entries hold back (DESIGN §4.2), so that every read
 * and the copies pass know it whichever chat or world reads next: a source whose own write failed
 * included. Each world keeps what its last pass, of its draft or a revision, found.
 */
export function recordWorld(index: LoreIndex, world: WorldDoc): void {
  const next = worldSources(world, entriesById(index), true);
  const was = index.worlds.get(world.id);
  const flat = (w: WorldSources): string => JSON.stringify([[...w.sources], [...w.texts]]);
  if (was && flat(was) === flat(next)) return;
  index.worlds.set(world.id, next);
  index.changed = true;
}

/** What a reader holds the user's book entries to (`secretTexts`). */
export interface SecretTexts {
  /** Whether every book of the user's was read: while one wasn't, any text may be a secret's. */
  known: boolean;
  /** The fields of every secret or Known-by text, by its key (`textOf`). */
  texts: Map<string, BookLoreFields[]>;
  /** The fields of the world's secret and Known-by entries, by the book entry each was indexed from (`bookId/entryId`). */
  sources: Map<string, BookLoreFields[]>;
}

/**
 * The fields an indexed entry holds its text to: its own, when they keep it from some reader; a
 * copy's own as it stood (its Known by, say); and a copy's whose original is gone, since nothing says
 * its text may be read now. A copy of an original still there adds nothing: its original does, while
 * it is secret.
 */
function heldBy(e: Indexed, byId: ReadonlyMap<string, Indexed>, whole: boolean): BookLoreFields[] {
  const out: BookLoreFields[] = [];
  if (e.copy === null) {
    if (e.fields && restricts(e.fields)) out.push(e.fields);
    return out;
  }
  if (e.copy.fields && restricts(e.copy.fields)) out.push(e.copy.fields);
  if (whole && !byId.has(copyOriginal(e.copy).entryId) && e.fields && restricts(e.fields)) out.push(e.fields);
  return out;
}

/**
 * What a reader holds a book entry to (`secrecyParts`): the secret and Known-by texts of the user's
 * books as the index has them, and the sources every world's last pass found; then `world`'s own
 * secret and Known-by entries; then those of `entries` the reader was given with their fields (a
 * prompt's, as the host scans them). With no index, nothing of the books is known.
 */
export function secretTexts(index: LoreIndex | null, also: { world?: WorldDoc | null; entries?: readonly Pick<HostBookEntry, "content" | "extensions">[] } = {}): SecretTexts {
  const whole = index !== null && complete(index);
  const out: SecretTexts = { known: whole, texts: new Map(), sources: new Map() };
  const byId = index ? entriesById(index) : null;
  const merge = (from: WorldSources): void => {
    for (const [key, list] of from.sources) for (const fields of list) add(out.sources, key, fields);
    for (const [key, list] of from.texts) for (const fields of list) add(out.texts, key, fields);
  };
  if (index && byId) {
    for (const e of byId.values()) for (const fields of heldBy(e, byId, whole)) add(out.texts, e.text, fields);
    for (const w of index.worlds.values()) merge(w);
  }
  if (also.world) merge(worldSources(also.world, byId, false));
  for (const e of also.entries ?? []) {
    if (engineWroteEntry(e.extensions) || secretCopyOf(e.extensions) !== null) continue;
    const fields = bookLoreFieldsOf(e.extensions);
    if (fields && restricts(fields)) add(out.texts, textOf(e.content), fields);
  }
  return out;
}

/**
 * The stricter of LRE fields that hold the same text (DESIGN §4.2): secret when any is, open only once
 * every secret one's gate holds (a missing gate never does), in whatever order they come; Known by
 * when any is, about everything any links; audiences and holders joined, each having been given to
 * read it.
 */
export function stricter(all: readonly BookLoreFields[]): BookLoreFields {
  const out: BookLoreFields = {};
  const secrets = all.filter((f) => loreIsSecret(f));
  if (secrets.length > 0) {
    const gates = [...new Set(secrets.map((f) => (f.gate ?? "").trim()))].sort();
    out.secret = true;
    out.gate = gates.includes("") ? "" : gates.length === 1 ? (gates[0] ?? "") : gates.map((g) => `(${g})`).join(" && ");
  }
  const joined = (pick: (f: BookLoreFields) => readonly string[] | undefined): string[] | undefined => {
    const lists = all.map(pick).filter((list): list is readonly string[] => list !== undefined);
    return lists.length === 0 ? undefined : [...new Set(lists.flat())];
  };
  const audience = joined((f) => f.audience)?.filter((p): p is StepPurpose => (LORE_AUDIENCE as readonly string[]).includes(p));
  if (audience) out.audience = audience;
  const holders = joined((f) => f.holders);
  if (holders) out.holders = holders;
  const links = joined((f) => f.links);
  if (all.some((f) => f.visibility === "known_by")) {
    out.visibility = "known_by";
    out.links = links ?? [];
  } else if (links) out.links = links;
  const aliases = joined((f) => f.aliases);
  if (aliases) out.aliases = aliases;
  return out;
}

/** What holds back a text while some book of the user's was never read: a secret no gate opens. */
const UNREAD: BookLoreFields = { secret: true, gate: "" };

/**
 * What holds a World Info entry back from a reader (DESIGN §4.2, §6.1), the same for the interceptor,
 * the helpers' live lore and the pins: its own LRE fields; a copy's own as it stood; the fields of the
 * world's entries indexed from it, or from the original it is a copy of; those of every secret or
 * Known-by text it holds, in whatever book; and, while some book of the user's was never read, a
 * secret no gate opens. None: it reads as it is.
 */
export function secrecyParts(e: Pick<HostBookEntry, "id" | "bookId" | "content" | "extensions">, texts: SecretTexts): BookLoreFields[] {
  if (engineWroteEntry(e.extensions)) return [];
  const out: BookLoreFields[] = [];
  const own = bookLoreFieldsOf(e.extensions);
  if (own) out.push(own);
  const copy = secretCopyOf(e.extensions);
  if (copy?.fields) out.push(copy.fields);
  out.push(...(texts.sources.get(keyOf(e)) ?? []));
  if (copy && copy.entry !== keyOf(e)) out.push(...(texts.sources.get(copy.entry) ?? []));
  out.push(...textParts(texts, e.content, true));
  return out;
}

/** `secrecyParts` as one set of fields (`stricter`), or null when nothing holds the entry back. */
export function bookSecrecy(e: Pick<HostBookEntry, "id" | "bookId" | "content" | "extensions">, texts: SecretTexts): BookLoreFields | null {
  const parts = secrecyParts(e, texts);
  return parts.length === 0 ? null : stricter(parts);
}

/** What holds a text back: every secret or Known-by text it is; and, for a book's text while some book of the user's was never read, a secret no gate opens. */
export function textParts(texts: SecretTexts, content: string, fromBook: boolean): BookLoreFields[] {
  return [...(texts.texts.get(textOf(content)) ?? []), ...(fromBook && !texts.known ? [UNREAD] : [])];
}

/** `entry` held back by `parts` too, the stricter of all (`stricter`): what a reader may read of it. */
export function heldTo(entry: LoreEntryDef, parts: readonly BookLoreFields[]): LoreEntryDef {
  const held = parts.filter(restricts);
  if (held.length === 0) return entry;
  const own = worldFields(entry);
  const s = stricter(own ? [own, ...held] : held);
  const out: LoreEntryDef = { ...entry };
  if (s.secret) {
    out.secret = true;
    out.gate = s.gate ?? "";
  }
  if (s.audience) out.audience = s.audience;
  if (s.holders) out.holders = s.holders;
  if (s.visibility === "known_by") {
    out.visibility = "known_by";
    out.links = [...new Set([...entry.links, ...(s.links ?? [])])];
  }
  return out;
}

/** The secret originals among `entries`, as `secureCopies` follows them: each entry with a secret of its own. */
function originalsAmong(entries: readonly HostBookEntry[]): HostBookEntry[] {
  return entries.filter((p) => ownSecret(p) !== null).sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

/** Every other entry of the index that holds `text`, read again now: another pass's reads, or Build's write, may be newer than the index's. */
async function readTwins(host: Pick<HostPort, "books">, index: LoreIndex, text: string, id: string, userId: UserId): Promise<HostBookEntry[]> {
  const ids = [...entriesById(index).values()].filter((x) => x.text === text && x.id !== id).map((x) => x.id);
  const read = await Promise.all(ids.map((x) => host.books.entry(x, userId)));
  const out = read.filter((p): p is HostBookEntry => p !== null && !engineWroteEntry(p.extensions) && textOf(p.content) === text);
  for (const p of out) noteEntry(index, p, false);
  return out;
}

/**
 * Settles one entry the index says may need it, from it and every entry of its text read again now
 * (`secureCopies`): one no secret holds is left alone; a twin of a secret original is kept secret as
 * its copy, stored switched off with the stricter of their fields, whichever comes first; a copy no
 * secret holds now is put back as it stood, unless its original is gone, when it keeps its secret as
 * its own (nothing says its text may be read now, and the author may make it public in Build).
 */
async function settle(host: Pick<HostPort, "books">, index: LoreIndex, id: string, sources: ReadonlySet<string>, userId: UserId): Promise<void> {
  const e = await host.books.entry(id, userId);
  if (!e || engineWroteEntry(e.extensions) || sources.has(keyOf(e))) return;
  noteEntry(index, e, false);
  const text = textOf(e.content);
  if (text === "" || ownSecret(e) !== null) return;
  const copy = secretCopyOf(e.extensions);
  const by = originalsAmong(await readTwins(host, index, text, e.id, userId));
  const write = async (extensions: JsonObject, disabled: boolean): Promise<void> => {
    if (e.disabled === disabled && JSON.stringify(extensions) === JSON.stringify(e.extensions)) return;
    await host.books.setExtensions(e.id, extensions, disabled, userId);
    noteEntry(index, { ...e, extensions, disabled });
  };
  if (by.length > 0) {
    const keys = by.map(keyOf);
    const note: SecretCopy = copy ? { ...copy, entry: keys.includes(copy.entry) ? copy.entry : (keys[0] ?? copy.entry) } : { entry: keys[0] ?? "", off: e.disabled, fields: bookLoreFieldsOf(e.extensions) };
    await write(withSecretCopy(withBookLoreFields(e.extensions, stricter(by.map((o) => ownSecret(o) ?? {}))), note), true);
    return;
  }
  if (!copy) return;
  const original = await host.books.entry(copyOriginal(copy).entryId, userId);
  if (original === null) await write(withSecretCopy(e.extensions, null), true);
  else await write(withSecretCopy(withBookLoreFields(e.extensions, copy.fields), null), copy.off);
}

/**
 * Keeps every secret's twins stored switched off as its copies (DESIGN §4.2, §6.1): the second line
 * under the reads, for whatever reads no text. Runs inside `lorePass`, and only once something the
 * copies follow changed since the last pass. An entry is settled (`settle`) when the index says it is
 * a twin not yet kept as the stricter of its secrets' fields, a copy no secret holds, or a copy whose
 * original is gone; a world's secret source is `secureIndexedSecrets`' to keep. One that can't be read
 * or written is logged, the rest go on, and the next pass tries it again.
 */
export async function secureCopies(host: Host, index: LoreIndex, userId: UserId): Promise<void> {
  if (!index.changed) return;
  index.changed = false;
  const byId = entriesById(index);
  const whole = complete(index);
  const sources = new Set([...index.worlds.values()].flatMap((w) => [...w.sources.keys()]));
  const keeps = new Map<string, Indexed[]>();
  for (const e of byId.values()) {
    if (e.text === "" || e.copy !== null || !e.fields || !loreIsSecret(e.fields)) continue;
    const list = keeps.get(e.text);
    if (list) list.push(e);
    else keeps.set(e.text, [e]);
  }
  // Fields as the index reads them back, so a copy already kept as they would write it is left alone.
  const asStored = (fields: BookLoreFields): string => JSON.stringify(bookLoreFieldsOf({ [LEDGER_NAMESPACE]: { lore: JSON.parse(JSON.stringify(fields)) as JsonObject } }));
  for (const e of byId.values()) {
    if (e.text === "" || sources.has(keyOf(e)) || (e.copy === null && e.fields && loreIsSecret(e.fields))) continue;
    const by = (keeps.get(e.text) ?? []).filter((o) => o.id !== e.id);
    const orphan = e.copy !== null && whole && !byId.has(copyOriginal(e.copy).entryId);
    if (by.length === 0 && e.copy === null) continue;
    if (!orphan && by.length > 0 && e.copy !== null && e.disabled && by.some((o) => keyOf(o) === e.copy?.entry) && JSON.stringify(e.fields) === asStored(stricter(by.map((o) => o.fields ?? {})))) continue;
    try {
      await settle(host, index, e.id, sources, userId);
    } catch (error) {
      index.changed = true;
      host.log("warn", `[LumiRPEngine] World Info entry ${keyOf(e)} wasn't kept secret with the secret entries of its text: ${message(error)}`, userId);
    }
  }
}

/** The secret entries that keep the copy `e` secret now, read again: none once no secret holds its text, and then the author may change it. */
export async function copyKeepers(host: Pick<HostPort, "books">, index: LoreIndex, e: HostBookEntry, userId: UserId): Promise<HostBookEntry[]> {
  const text = textOf(e.content);
  return text === "" ? [] : originalsAmong(await readTwins(host, index, text, e.id, userId));
}

/**
 * What Build says of an entry's twins (`lre.lore entries`): every other entry of the user's books that
 * holds its text, and every copy that names it, whatever its book is named; and, for a copy, the entry
 * it follows, found by its id wherever it is now, and whether a secret still keeps it.
 */
export function twinViews(index: LoreIndex, e: HostBookEntry): { twins: { bookId: string; entryId: string }[]; copyOf: { bookId: string; entryId: string; kept: boolean } | null } {
  const byId = entriesById(index);
  const text = textOf(e.content);
  const twins = [...byId.values()].filter((o) => o.id !== e.id && ((text !== "" && o.text === text) || o.copy?.entry === keyOf(e))).map((o) => ({ bookId: o.bookId, entryId: o.id }));
  const copy = secretCopyOf(e.extensions);
  if (!copy) return { twins, copyOf: null };
  const named = copyOriginal(copy);
  const original = byId.get(named.entryId);
  const kept = text !== "" && [...byId.values()].some((o) => o.id !== e.id && o.text === text && o.copy === null && o.fields !== null && loreIsSecret(o.fields));
  return { twins, copyOf: { bookId: original?.bookId ?? named.bookId, entryId: named.entryId, kept } };
}
