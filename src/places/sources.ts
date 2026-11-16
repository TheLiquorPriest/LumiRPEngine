// A place's sources, read live (plan §7.1, §8.2, §9.3). The lore entries stay in Lumiverse: the lore keeps which entry is bound to the
// place and which aspect it defines, and the place asks for each entry as it stands now. Lore stays the authority for what it defines: an
// entry whose revision differs from the one the base was last drawn against (or that is gone, or was bound after) marks the base older
// than its source. Code rewrites nothing; redrawing is the Author's.

import type { BaseDoc, SourceDoc } from "./fold";

/** An entry bound to a place, as the lore keeps the binding: the entry's id, the aspect it defines, and who bound it. */
export interface PlaceBinding {
  entry: string;
  /** The aspect of the place it defines ("layout", "history"); empty when none was named. */
  aspect: string;
  /** Who bound it: an indexing run, casting, bootstrap or the owner; `pin` for a pin of the world's own; `world` for an entry the world's place was imported from. */
  by: string;
}

/** An entry as Lumiverse holds it now. */
export interface EntryNow {
  title: string;
  /** Changes whenever the entry's text does. */
  revision: string;
}

/** What a place's record reads of the lore: the entries bound to a place, and each entry as it stands now (null when Lumiverse holds none). */
export interface PlaceSourcesReader {
  bindings(user: string, place: string): PlaceBinding[];
  /** The entries bound to any record of the tree by its ref (`quest:<id>`), each with the aspect it defines. Absent: none is bound. */
  recordBindings?(user: string, record: string): PlaceBinding[];
  entry(scope: { user: string; chat: string }, entry: string): Promise<EntryNow | null>;
}

/** A binding with its entry as it stands now, set against the base. */
export interface PlaceSourceShown extends PlaceBinding {
  /** Its title now; null when Lumiverse no longer holds it. */
  title: string | null;
  /** Its revision now; null when Lumiverse no longer holds it. */
  revision: string | null;
  /** The revision the base was drawn against; null when the base has not seen it. */
  drawn: string | null;
  /** The base is older than this source: a base was written, and the entry changed or went since, or was bound after. */
  newer: boolean;
}

export interface PlaceSources {
  sources: PlaceSourceShown[];
  /** The base is older than a source. */
  older: boolean;
}

/**
 * Each binding of a place read live and set against the base as it stands (none written: nothing is older): those the lore keeps
 * (`read.bindings`) and those play bound when it made the place (`held`, from the place area's slice), an entry in both once.
 */
export async function sourcesNow(read: PlaceSourcesReader, scope: { user: string; chat: string }, place: string, base: BaseDoc | null, held: readonly SourceDoc[] = []): Promise<PlaceSources> {
  const lore = read.bindings(scope.user, place);
  const bound: PlaceBinding[] = [...lore, ...held.filter((h) => !lore.some((b) => b.entry === h.entry)).map((h): PlaceBinding => ({ entry: h.entry, aspect: h.aspect, by: h.by ?? "play" }))];
  const sources = await Promise.all(
    bound.map(async (b): Promise<PlaceSourceShown> => {
      const now = await read.entry(scope, b.entry);
      const drawn = base !== null && Object.hasOwn(base.drawn, b.entry) ? (base.drawn[b.entry] ?? null) : null;
      return { ...b, title: now?.title ?? null, revision: now?.revision ?? null, drawn, newer: base !== null && (now === null || now.revision !== drawn) };
    }),
  );
  return { sources, older: sources.some((s) => s.newer) };
}

/** The revision of each entry that is there now, by entry id: what a base written now is drawn against. */
export function drawnFrom(sources: readonly PlaceSourceShown[]): Record<string, string> {
  const drawn: Record<string, string> = {};
  for (const s of sources) if (s.revision !== null) drawn[s.entry] = s.revision;
  return drawn;
}
