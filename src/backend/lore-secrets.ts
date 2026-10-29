// What holds a World Info entry back from LRE's readers (DESIGN §4.2, §6.1): the same for the
// interceptor, the helpers' live lore and the pins, read afresh by each from what it was given, with
// nothing stored and nothing written. An entry is held by:
// - the secret marks in its own text (`shared/secret-marks.ts`), and then by nothing else of its own;
// - else an earlier build's secrecy fields on it, and the copy note that build kept beside a twin it
//   switched off, both read as they stand: a copy reads as its original holds it, and as a secret no
//   gate opens when its original isn't read and it holds no secret of its own (fail closed);
// - the chat's world's secret and Known-by entries indexed from it;
// - every secret or Known-by text among the entries the reader has, whitespace aside: a twin of a
//   secret (the copy a character's card brings, one the host builds from a card for the prompt) reads
//   as that secret does, and an entry whose whole text is a mark's text reads as that mark.
// Only what the reader has counts: a book it doesn't read holds nothing back, and a hold applies only
// in the world that made it.

import { hashParts } from "../shared/hash";
import type { UserId } from "../shared/ids";
import { bookLoreFieldsOf, engineWroteEntry, LORE_AUDIENCE, loreIsSecret, loreSourceOf, secretCopyOf, withoutOldSecrecy, type BookLoreFields, type SecretCopy } from "../shared/lore";
import { hasSecretMarks, parseSecretMarks, resolveMarkNames, wholeEntrySecret, type MarkNamesSource, type SecretMark } from "../shared/secret-marks";
import type { LoreEntryDef, StepPurpose, WorldDoc } from "../shared/world";
import type { HostBookEntry, HostPort } from "./host";

/** The key a text is known by: each run of whitespace one space, the ends trimmed, hashed; "" for none. */
export function textOf(content: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  return text === "" ? "" : hashParts("lre-lore-text-v1", text);
}

/** An entry as a copy names its original, and a world entry its source: `bookId/entryId`. */
function keyOf(e: { bookId: string; id: string }): string {
  return `${e.bookId}/${e.id}`;
}

/** The entry a copy names as its original. */
function copyOriginal(copy: SecretCopy): { bookId: string; entryId: string } {
  const slash = copy.entry.indexOf("/");
  return { bookId: copy.entry.slice(0, Math.max(0, slash)), entryId: copy.entry.slice(slash + 1) };
}

/** Whether LRE fields keep a text from some reader: secret, or Known by. */
function restricts(fields: BookLoreFields): boolean {
  return loreIsSecret(fields) || fields.visibility === "known_by";
}

/**
 * The fields a world entry holds its text to, when it holds it to any: its secrecy, its audience and
 * holders, and its Known by. A visibility this reader doesn't know reads as Known by with nothing
 * linked, which no one reads, as a book entry's does (`bookLoreFieldsOf`) and as the lint promises.
 */
function worldFields(entry: LoreEntryDef): BookLoreFields | null {
  const secret = loreIsSecret(entry);
  const visibility: unknown = entry.visibility;
  const knownBy = visibility !== undefined && visibility !== "public";
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
    out.links = visibility === "known_by" ? ids(entry.links) : [];
  }
  return out;
}

function add(map: Map<string, BookLoreFields[]>, key: string, fields: BookLoreFields): void {
  if (key === "") return;
  const list = map.get(key);
  if (list) list.push(fields);
  else map.set(key, [fields]);
}

/** A mark as fields: a secret no gate opens, its resolved holders reading it. */
export function markFields(world: MarkNamesSource | null, mark: Pick<SecretMark, "knownTo" | "keptFrom">): BookLoreFields {
  const holders = world ? resolveMarkNames(world, null, mark).knownTo : [];
  return { secret: true, gate: "", ...(holders.length > 0 ? { holders } : {}) };
}

/**
 * A mark where it stands: its entry, and its place among the entry's marks from 1, or null when it
 * is the whole entry; its live lore id is `bookMarkLoreId`'s, or the entry's own (`bookLoreId`).
 */
export interface MarkAt {
  mark: SecretMark;
  bookId: string;
  entryId: string;
  n: number | null;
}

/** An entry's marks, each where it stands (`MarkAt`): the one its whole text is, or each in order. */
function marksAt(e: Pick<HostBookEntry, "id" | "bookId" | "content">): MarkAt[] {
  const whole = wholeEntrySecret(e.content);
  if (whole) return [{ mark: whole, bookId: e.bookId, entryId: e.id, n: null }];
  return parseSecretMarks(e.content).map((mark, i) => ({ mark, bookId: e.bookId, entryId: e.id, n: i + 1 }));
}

/** What a copy whose original isn't read is held to, when it holds no secret of its own: a secret no gate opens, which nothing read says the end of. */
const UNREAD_ORIGINAL: Readonly<BookLoreFields> = { secret: true, gate: "" };

/** What a reader holds the entries it has to (`secretTexts`). */
export interface SecretTexts {
  /** The fields of every secret or Known-by text, by its key (`textOf`): the world's entries', an earlier build's secrets', and each mark's. */
  texts: Map<string, BookLoreFields[]>;
  /** The fields of the world's secret and Known-by entries, by the book entry each was indexed from (`bookId/entryId`). */
  sources: Map<string, BookLoreFields[]>;
  /** An earlier build's secret fields on each entry the reader has, by its id: what a copy's original holds the copy to now. */
  originals: Map<string, BookLoreFields>;
  /** Each mark in the entries the reader has, where it stands, by its text's key: an entry of exactly that text reads as that mark. */
  marks: Map<string, MarkAt>;
  /** The ids of the entries the reader has: a copy's original among them says what holds the copy. */
  read: Set<string>;
}

/**
 * What a reader holds the entries it has to (`secrecyParts`): `world`'s own secret and Known-by
 * entries (by their text, and by the book entry each was indexed from, that entry's text now among
 * them when the reader has it), then the earlier build's secrets and the marks among `entries`, each
 * by its text. With neither given, nothing holds anything back.
 */
export function secretTexts(also: { world?: WorldDoc | null; entries?: readonly Pick<HostBookEntry, "id" | "bookId" | "content" | "extensions">[] } = {}): SecretTexts {
  const entries = (also.entries ?? []).filter((e) => !engineWroteEntry(e.extensions));
  const out: SecretTexts = { texts: new Map(), sources: new Map(), originals: new Map(), marks: new Map(), read: new Set(entries.map((e) => e.id)) };
  const given = new Map(entries.map((e) => [e.id, e]));
  for (const entry of Object.values(also.world?.lore ?? {})) {
    const fields = worldFields(entry);
    if (!fields) continue;
    add(out.texts, textOf(typeof entry.content === "string" ? entry.content : ""), fields);
    const source = loreSourceOf(entry.source);
    if (source.kind !== "book") continue;
    add(out.sources, `${source.bookId}/${source.entryId}`, fields);
    const now = given.get(source.entryId);
    if (now) add(out.texts, textOf(now.content), fields);
  }
  for (const e of entries) {
    const marks = marksAt(e);
    if (marks.length > 0) {
      for (const at of marks) {
        const key = textOf(at.mark.text);
        if (key === "" || out.marks.has(key)) continue;
        out.marks.set(key, at);
        add(out.texts, key, markFields(also.world ?? null, at.mark));
      }
      continue;
    }
    // A copy's fields are its originals': it reads as they do, never as one more secret of its text.
    if (secretCopyOf(e.extensions) !== null) continue;
    const fields = bookLoreFieldsOf(e.extensions);
    if (!fields || !restricts(fields)) continue;
    add(out.texts, textOf(e.content), fields);
    if (loreIsSecret(fields)) out.originals.set(e.id, fields);
  }
  return out;
}

/**
 * The originals that the copy notes among `entries` name and `entries` doesn't hold, each read once
 * from its book: a copy reads as its original holds it wherever the original is (DESIGN §4.2), as the
 * earlier build that kept it read every book. One that is gone, or can't be read, is left out, and its
 * copy then reads as `secrecyParts` gives it, a secret all the same.
 */
export async function copiedOriginals(host: Pick<HostPort, "books" | "log">, entries: readonly HostBookEntry[], userId: UserId): Promise<HostBookEntry[]> {
  const have = new Set(entries.map((e) => e.id));
  const named = new Map<string, string>();
  for (const e of entries) {
    const copy = hasSecretMarks(e.content) ? null : secretCopyOf(e.extensions);
    const original = copy ? copyOriginal(copy) : null;
    if (original && original.entryId !== "" && !have.has(original.entryId)) named.set(original.entryId, original.bookId);
  }
  const read = await Promise.all(
    [...named].map(([entryId, bookId]) =>
      host.books.entry(entryId, userId).then(
        (e) => (e && e.bookId === bookId && !engineWroteEntry(e.extensions) ? [e] : []),
        (error: unknown) => {
          host.log("warn", `[LumiRPEngine] the World Info entry a copy was kept secret as a twin of (${bookId}/${entryId}) wasn't read, so the copy stays secret: ${error instanceof Error ? error.message : String(error)}`, userId);
          return [];
        },
      ),
    ),
  );
  return read.flat();
}

/**
 * The stricter of LRE fields that hold the same text (DESIGN §4.2): secret when any is, open only once
 * every secret one's gate holds (a missing gate never does), in whatever order they come; Known by
 * when any is, about everything any links, and read by no one when a Known-by one links nothing;
 * audiences and holders joined, each having been given to read it.
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
  const knownBy = all.filter((f) => f.visibility === "known_by");
  if (knownBy.length > 0) {
    out.visibility = "known_by";
    // A Known-by part that links nothing is read by no one, and another part's links don't open it.
    out.links = knownBy.some((f) => (f.links ?? []).length === 0) ? [] : (links ?? []);
  } else if (links) out.links = links;
  const aliases = joined((f) => f.aliases);
  if (aliases) out.aliases = aliases;
  return out;
}

/**
 * What holds a World Info entry back from a reader (see the header): the parts its own text and
 * fields give, the world's entries indexed from it (or from the original a copy names), and every
 * secret or Known-by text it is. An entry with marks reads its secrecy from them alone: of its own
 * fields, only its Known by counts, and its marks stand apart from its text (`bookEntryLores`). None:
 * it reads as it is.
 */
export function secrecyParts(e: Pick<HostBookEntry, "id" | "bookId" | "content" | "extensions">, texts: SecretTexts): BookLoreFields[] {
  if (engineWroteEntry(e.extensions)) return [];
  const out: BookLoreFields[] = [];
  const marked = hasSecretMarks(e.content);
  const own = marked ? withoutOldSecrecy(bookLoreFieldsOf(e.extensions)) : bookLoreFieldsOf(e.extensions);
  if (own) out.push(own);
  const copy = marked ? null : secretCopyOf(e.extensions);
  if (copy?.fields) out.push(copy.fields);
  const named = copy ? copyOriginal(copy).entryId : null;
  const original = named !== null && named !== e.id ? texts.originals.get(named) : undefined;
  if (original) out.push(original);
  // An original this reader doesn't have can't say what holds its copy: one with no secret of its own stays secret.
  else if (named !== null && named !== e.id && !texts.read.has(named) && !(own && loreIsSecret(own))) out.push(UNREAD_ORIGINAL);
  out.push(...(texts.sources.get(keyOf(e)) ?? []));
  if (copy && copy.entry !== keyOf(e)) out.push(...(texts.sources.get(copy.entry) ?? []));
  if (!marked) out.push(...textParts(texts, e.content));
  return out;
}

/** `secrecyParts` as one set of fields (`stricter`), or null when nothing holds the entry back. */
export function bookSecrecy(e: Pick<HostBookEntry, "id" | "bookId" | "content" | "extensions">, texts: SecretTexts): BookLoreFields | null {
  const parts = secrecyParts(e, texts);
  return parts.length === 0 ? null : stricter(parts);
}

/** What holds a text back: every secret or Known-by text it is. */
export function textParts(texts: SecretTexts, content: string): BookLoreFields[] {
  return texts.texts.get(textOf(content)) ?? [];
}

/**
 * `entry` held back by `parts` too, the stricter of all (`stricter`): what a reader may read of it.
 * Its own fields again (an entry's text is listed under itself) change nothing, so an entry no other
 * part holds reads as written, a visibility no reader knows included.
 */
export function heldTo(entry: LoreEntryDef, parts: readonly BookLoreFields[]): LoreEntryDef {
  const own = worldFields(entry);
  const mine = own === null ? null : JSON.stringify(own);
  const held = parts.filter((p) => restricts(p) && JSON.stringify(p) !== mine);
  if (held.length === 0) return entry;
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
    // Read by no one links nothing, its own links left out too; else it is about all of them.
    out.links = (s.links ?? []).length === 0 ? [] : [...new Set([...entry.links, ...(s.links ?? [])])];
  }
  return out;
}

/** Whether an earlier build switched an entry off for its secrecy: a secret of its own, or a copy that was on before it was kept secret. One a secret's text alone holds back was switched off by its author, and stays so. */
export function switchedOffForSecrecy(e: Pick<HostBookEntry, "extensions">): boolean {
  const copy = secretCopyOf(e.extensions);
  if (copy) return !copy.off;
  return loreIsSecret(bookLoreFieldsOf(e.extensions) ?? {});
}
