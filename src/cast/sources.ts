// A character's sources, read live (plan §7.1, §9.3). The card, the persona, the lore entries and the
// memory entity stay in Lumiverse: the cast keeps only which source is bound and which side of the
// character it defines, and asks the host for each one as it stands now. Lore stays the authority
// for what it defines: a source whose revision differs from the one the base was last drawn against
// marks the base older than its source. Code rewrites nothing; redrawing is the Author's.

import { type Binding, type BaseVersion, drawnAgainst, type SourceKind, sourceKey } from "./record";

/** A source as Lumiverse holds it now. */
export interface SourceNow {
  /** Its name or title, as Lumiverse shows it. */
  title: string;
  /** Changes whenever its text does. */
  revision: string;
}

/**
 * Reads one bound source live: the host's (the turn lane gives one over the adapter's reads and the
 * lore). Null when Lumiverse holds no such source for this user and chat, deleted or never there.
 */
export type SourceReader = (scope: { user: string; chat: string }, source: { kind: SourceKind; ref: string }) => Promise<SourceNow | null>;

/** A binding with its source as it stands now, against the base. */
export interface SourceState extends Binding {
  /** Its title now; null when Lumiverse no longer holds it. */
  title: string | null;
  /** Its revision now; null when Lumiverse no longer holds it. */
  revision: string | null;
  /** The revision the base was last drawn against; null when no version of the base has seen it. */
  drawn: string | null;
  /** The base is older than this source: there is a base, and the source changed or went since it was last drawn, or was bound after. */
  newer: boolean;
}

/** Each binding read live and set against the base as it stands. */
export async function sourcesNow(read: SourceReader, scope: { user: string; chat: string }, bindings: readonly Binding[], base: Iterable<BaseVersion>): Promise<SourceState[]> {
  const versions = [...base];
  const drawn = drawnAgainst(versions);
  return Promise.all(
    bindings.map(async (b) => {
      const now = await read(scope, { kind: b.kind, ref: b.ref });
      const was = drawn.get(sourceKey(b.kind, b.ref)) ?? null;
      return { ...b, title: now?.title ?? null, revision: now?.revision ?? null, drawn: was, newer: versions.length > 0 && (now === null || now.revision !== was) };
    }),
  );
}

/** How a bound source stands against the base, for the page: gone from Lumiverse; changed since the base was last drawn from it; unseen (bound after, or never drawn from); else current. */
export function freshnessOf(s: Pick<SourceState, "title" | "newer" | "drawn">): "current" | "changed" | "unseen" | "gone" {
  if (s.title === null) return "gone";
  if (!s.newer) return "current";
  return s.drawn === null ? "unseen" : "changed";
}
