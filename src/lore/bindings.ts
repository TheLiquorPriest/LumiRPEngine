// The one binding store (plan §9.3): an entry linked by id to the record it defines, with the aspect it
// defines, who proposed it and the revision of the entry it was made at. An indexing run, casting, bootstrap
// and the owner's own edit write the same rows (`lore_binding`); the lore map, a character's known lore, the
// cast and the place and quest records read them.
//
// A record is named by its id in the world's tree (`entity:<id>`, `place:<id>`), a quest's (`quest:<id>`)
// or a cast character's (`cast:<id>`); a name or an id a writer gives is turned into that id once, when the
// binding is written, and from then on only the id is read: a renamed record keeps its bindings, and two
// records of one name never share them. A record that does not exist is kept as the writer wrote it and shown
// as unlinked; it is never matched by folded text.
//
// A world's own lore pins (a world entry, a book entry or a whole book pinned to a character or a place, kept
// in the world document) are read as bindings from the world as it stands at the point of the path, and are
// never copied into this table.

import type { Database } from "bun:sqlite";
import { isGone } from "../engine/scope";
import { hasOwn } from "../shared/json";
import { lorePinKey, lorePinsOf } from "../shared/lore";
import type { LoreCatalogEntry } from "./lore";
import { foldName } from "./keys";
import type { LorePin } from "../shared/world";
import type { WorldAt } from "./sources";

/** Who proposed a binding: an indexing run, casting, bootstrap, or the owner (whose stand over a run's). */
export const BINDING_BYS = ["run", "casting", "bootstrap", "owner"] as const;
export type BindingBy = (typeof BINDING_BYS)[number];

/** A binding as the table keeps it. */
export interface BindingRow {
  entry: string;
  /** The record's id, or, where none exists, what the writer wrote. */
  record: string;
  linked: boolean;
  aspect: string;
  by: BindingBy;
  revision: string | null;
  created: number;
}

/** A binding as the index shows it: one the table keeps, or a pin of the world's (`by: "pin"`). */
export interface LoreLink {
  record: string;
  linked: boolean;
  aspect: string;
  by: BindingBy | "pin";
}

/** A record the lore map can name: a kind and its id. */
const TYPED = /^(entity|place|quest|cast):(.+)$/;

/** The world as the chat plays it: its own places, and those play made or changed. */
function placesOf(at: WorldAt): Readonly<Record<string, { name: string; parent?: string }>> {
  return at.registry.context(at.world, at.state).world.places as Readonly<Record<string, { name: string; parent?: string }>>;
}

function livePerson(at: WorldAt, id: string): boolean {
  return hasOwn(at.state.entities, id) && !isGone(at.state, id);
}

/**
 * The record a writer means by `what`, as its id where one exists: a ref (`entity:sefa`, `place:harbor`), a bare id of a place or of a
 * thing or person in the world, or a name that is exactly one record's (folded as the lore folds names). A cast character's or a quest's
 * ref is taken as given: the area that writes it is the one that knows it. Anything else is kept as written, unlinked.
 */
export function resolveRecord(at: WorldAt | null, what: string): { record: string; linked: boolean } {
  const text = what.trim();
  const typed = TYPED.exec(text);
  if (typed !== null) {
    const [, kind, id = ""] = typed;
    if (kind === "cast" || kind === "quest") return { record: text, linked: true };
    if (at !== null && ((kind === "entity" && livePerson(at, id)) || (kind === "place" && hasOwn(placesOf(at), id)))) return { record: text, linked: true };
    return { record: text, linked: false };
  }
  if (at === null || text === "") return { record: text, linked: false };
  const places = placesOf(at);
  if (hasOwn(places, text)) return { record: `place:${text}`, linked: true };
  if (livePerson(at, text)) return { record: `entity:${text}`, linked: true };
  const key = foldName(text);
  const named = [
    ...Object.keys(at.state.entities).filter((id) => livePerson(at, id) && foldName(at.state.entities[id]?.name ?? "") === key).map((id) => `entity:${id}`),
    ...Object.entries(places).filter(([, p]) => foldName(p.name) === key).map(([id]) => `place:${id}`),
  ];
  return named.length === 1 && named[0] !== undefined ? { record: named[0], linked: true } : { record: text, linked: false };
}

/** A record's name as it stands now, for the lines that show a binding: a person's, a place's; null for any other ref (a cast character's name is the cast's). */
export function recordName(at: WorldAt | null, record: string): string | null {
  const typed = at === null ? null : TYPED.exec(record);
  if (at === null || typed === null) return null;
  const [, kind, id = ""] = typed;
  if (kind === "entity") return livePerson(at, id) ? (at.state.entities[id]?.name ?? null) : null;
  return kind === "place" && hasOwn(placesOf(at), id) ? (placesOf(at)[id]?.name ?? null) : null;
}

/** The places holding a place, nearest first, as refs: a pin to a place holds for the places inside it. */
export function placesAbove(at: WorldAt, place: string): string[] {
  const places = placesOf(at);
  const out: string[] = [];
  for (let p = places[place]?.parent; p !== undefined && hasOwn(places, p) && !out.includes(`place:${p}`) && out.length < 16; p = places[p]?.parent) out.push(`place:${p}`);
  return out;
}

interface Stored {
  entry: string;
  record: string;
  linked: number;
  aspect: string;
  by: string;
  revision: string | null;
  created: number;
}

/** Every binding the user has stored, by entry. */
export function storedBindings(db: Database, user: string): Map<string, BindingRow[]> {
  const out = new Map<string, BindingRow[]>();
  const rows = db.query<Stored, [string]>("SELECT entry, record, linked, aspect, by, revision, created FROM lore_binding WHERE user = ? ORDER BY created, rowid").all(user);
  for (const r of rows) {
    const list = out.get(r.entry) ?? [];
    list.push({ entry: r.entry, record: r.record, linked: r.linked === 1, aspect: r.aspect, by: r.by as BindingBy, revision: r.revision, created: r.created });
    out.set(r.entry, list);
  }
  return out;
}

/**
 * The bindings in force for an entry: every writer's, except that the owner's own stand over an indexing run's: where he has bound
 * the entry himself, a run's bindings are not in force (a run that redoes the entry does not undo his).
 */
export function inForce(rows: readonly BindingRow[] | undefined): BindingRow[] {
  const all = rows ?? [];
  const owned = all.some((r) => r.by === "owner");
  return all.filter((r) => !(owned && r.by === "run"));
}

/** Replaces one writer's bindings of an entry with `bound`, inside the caller's write; with none, takes that writer's off. */
export function putBindings(db: Database, user: string, entry: string, by: BindingBy, bound: readonly { record: string; linked: boolean; aspect: string }[], revision: string | null, now: number): void {
  db.query<unknown, [string, string, string]>("DELETE FROM lore_binding WHERE user = ? AND entry = ? AND by = ?").run(user, entry, by);
  const put = db.query<unknown, [string, string, string, number, string, string, string | null, number]>(
    "INSERT INTO lore_binding (user, entry, record, linked, aspect, by, revision, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user, entry, record, by) DO UPDATE SET aspect = excluded.aspect, linked = excluded.linked, revision = excluded.revision",
  );
  for (const b of bound) put.run(user, entry, b.record, b.linked ? 1 : 0, b.aspect, by, revision, now);
}

/**
 * The bindings the world's own pins give an entry, read from the world at the point of the path: those of the characters and places
 * that pin it (the entry itself, or the book it is in, or the one entry of a book), each to the record it is pinned to. A pin to a
 * record the world does not have is unlinked. A pin never widens who may read an entry; this only says what it is bound to.
 */
export function pinLinks(at: WorldAt, entry: Pick<LoreCatalogEntry, "key" | "book" | "lumiverse">): LoreLink[] {
  const keys = new Set([...(entry.key === null ? [] : [`lore:${entry.key}`]), ...(entry.book === null ? [] : [`book:${entry.book}`, ...(entry.lumiverse === null ? [] : [`book:${entry.book}/${entry.lumiverse}`])])]);
  if (keys.size === 0) return [];
  const pins = lorePinsOf(at.world);
  const out: LoreLink[] = [];
  const read = (record: Readonly<Record<string, readonly LorePin[] | undefined>>, ref: (id: string) => string): void => {
    for (const [id, list] of Object.entries(record)) {
      if (list?.some((pin) => keys.has(lorePinKey(pin))) !== true) continue;
      out.push({ record: ref(id), linked: true, aspect: "", by: "pin" });
    }
  };
  read(pins.characters, (id) => `entity:${id}`);
  read(pins.places, (id) => `place:${id}`);
  return out.map((l) => ({ ...l, linked: resolveRecord(at, l.record).linked }));
}
