// What the character pickers read (DESIGN §7, the Character model): every place indexed once by its
// parent and by the words of its name and path, so a search over a few hundred places and a browse
// level are each one pass; a bed's choices in order; things found by their name or where they lie;
// and a list of text edited a word at a time. Pure, so the pickers' tests read them directly.

import type { CharacterBed, CharacterDTO, PlaceRef, ThingRef } from "../../shared/character";
import type { PlaceId } from "../../shared/ids";

/** Every place by id, each parent's children by name (`null`: the roots), and each place's words. */
export interface PlaceIndex {
  byId: ReadonlyMap<PlaceId, PlaceRef>;
  children: ReadonlyMap<PlaceId | null, readonly PlaceRef[]>;
  words: ReadonlyMap<PlaceId, { name: readonly string[]; path: readonly string[] }>;
}

/** Lowercased words: letters and digits, accents dropped, so "Café 2B" is ["cafe", "2b"]. */
export function wordsOf(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== "");
}

export function placeIndex(places: readonly PlaceRef[]): PlaceIndex {
  const byId = new Map(places.map((p) => [p.id, p]));
  const children = new Map<PlaceId | null, PlaceRef[]>();
  const words = new Map<PlaceId, { name: string[]; path: string[] }>();
  for (const p of places) {
    // A parent the list doesn't have makes the place a root, so nothing is lost from browsing.
    const parent = p.parent !== null && byId.has(p.parent) ? p.parent : null;
    const list = children.get(parent);
    if (list) list.push(p);
    else children.set(parent, [p]);
    words.set(p.id, { name: wordsOf(p.name), path: p.path.flatMap(wordsOf) });
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return { byId, children, words };
}

/** A place as one line, outermost first: "Riverton › Elm Street Apartments › Apartment 2B". */
export function pathLabel(place: Pick<PlaceRef, "name" | "path">): string {
  return [...place.path, place.name].join(" › ");
}

/** The places that hold a place, outermost first, by id: the browse trail to it. */
export function trailTo(index: PlaceIndex, id: PlaceId | null): PlaceRef[] {
  const out: PlaceRef[] = [];
  const seen = new Set<PlaceId>();
  for (let at = id === null ? undefined : index.byId.get(id); at && !seen.has(at.id); at = at.parent === null ? undefined : index.byId.get(at.parent)) {
    seen.add(at.id);
    out.unshift(at);
  }
  return out;
}

/** Where browsing starts: the current place's parent, so it shows among its neighbours; else the roots. */
export function browseStart(index: PlaceIndex, current: PlaceId | null): PlaceId | null {
  const place = current === null ? undefined : index.byId.get(current);
  return place && place.parent !== null && index.byId.has(place.parent) ? place.parent : null;
}

/**
 * The places whose name or path has every word of the query (each a word's beginning): those with
 * every word in their own name first, then the shallower, then by name. At most `limit`.
 */
export function searchPlaces(index: PlaceIndex, query: string, limit = 60): PlaceRef[] {
  const want = wordsOf(query);
  if (want.length === 0) return [];
  const hits: { place: PlaceRef; own: boolean }[] = [];
  for (const place of index.byId.values()) {
    const w = index.words.get(place.id);
    if (!w) continue;
    const inName = (q: string) => w.name.some((n) => n.startsWith(q));
    if (!want.every((q) => inName(q) || w.path.some((n) => n.startsWith(q)))) continue;
    hits.push({ place, own: want.every(inName) });
  }
  hits.sort((a, b) => Number(b.own) - Number(a.own) || a.place.path.length - b.place.path.length || a.place.name.localeCompare(b.place.name));
  return hits.slice(0, limit).map((h) => h.place);
}

// ---------------------------------------------------------------- beds

/** One choice in the bed picker. */
export type BedOption = { kind: "home"; place: PlaceRef | null } | { kind: "place"; place: PlaceRef } | { kind: "item"; item: ThingRef };

/** The bed picker's choices, in order: sleeping at home, the rooms in their home (nearest first), then the likely beds there. */
export function bedOptions(character: Pick<CharacterDTO, "home" | "bedChoices">): BedOption[] {
  return [{ kind: "home", place: character.home }, ...character.bedChoices.places.map((place) => ({ kind: "place" as const, place })), ...character.bedChoices.items.map((item) => ({ kind: "item" as const, item }))];
}

/** A choice as the bed it makes. */
export function bedOf(option: BedOption): CharacterBed {
  if (option.kind === "home") return { kind: "home", place: option.place, item: null };
  if (option.kind === "place") return { kind: "place", place: option.place, item: null };
  return { kind: "item", place: option.item.place, item: option.item };
}

/** Whether a choice is the bed they have now. */
export function isBed(bed: CharacterBed, option: BedOption): boolean {
  if (option.kind === "home") return bed.kind === "home";
  if (option.kind === "place") return bed.kind === "place" && bed.place?.id === option.place.id;
  return bed.kind === "item" && bed.item?.id === option.item.id;
}

/** The things whose name or place has every word of the query, those named by it first. At most `limit`. */
export function searchThings(things: readonly ThingRef[], query: string, limit = 60): ThingRef[] {
  const want = wordsOf(query);
  if (want.length === 0) return [];
  const hits: { thing: ThingRef; own: boolean }[] = [];
  for (const thing of things) {
    const name = wordsOf(thing.name);
    const where = thing.place ? [...thing.place.path, thing.place.name].flatMap(wordsOf) : [];
    const inName = (q: string) => name.some((n) => n.startsWith(q));
    if (!want.every((q) => inName(q) || where.some((n) => n.startsWith(q)))) continue;
    hits.push({ thing, own: want.every(inName) });
  }
  hits.sort((a, b) => Number(b.own) - Number(a.own) || a.thing.name.localeCompare(b.thing.name));
  return hits.slice(0, limit).map((h) => h.thing);
}

// ---------------------------------------------------------------- lists of text

/** A list with one more entry: trimmed, spaces collapsed; nothing changes for a blank one or one already there (any case). */
export function withText(list: readonly string[], text: string): string[] {
  const t = text.trim().replace(/\s+/g, " ");
  if (t === "" || list.some((x) => x.toLowerCase() === t.toLowerCase())) return [...list];
  return [...list, t];
}
