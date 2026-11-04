// The GM view's parts (DESIGN §7), each one field of `GmView`, which `lre.gm.part` builds alone: a
// client reading one part (the MCP server's `lre_gm`) needn't have a view of many megabytes built
// and sent whole, and its outline says how many each part holds before any is read. And what a
// write held behind a turn waits on (DESIGN §5.1, P2), which every write's answer and the GM view's
// held writes say.

import type { GmView } from "./state-view";

/** The parts, in the view's order. */
export const GM_PARTS = ["entities", "kinds", "tiers", "lifeStates", "domains", "classifications", "places", "tracks", "relationTypes", "money", "orgs", "encounter", "routineRoles", "edits", "refused", "held", "minds"] as const satisfies readonly (keyof GmView)[];
export type GmPart = (typeof GM_PARTS)[number];

/** The parts whose items an id picks one of: an entity, a party's money, an organization. */
export const GM_KEYED_PARTS = ["entities", "money", "orgs"] as const satisfies readonly GmPart[];
export type GmKeyedPart = (typeof GM_KEYED_PARTS)[number];

/** One part of the GM view as the whole view holds it; with an id, a list of that one (empty: there is none). */
export type GmPartView = { [P in GmPart]: { part: P; id: string | null; value: GmView[P] } }[GmPart];

/** What `lre.gm.part` reads in place of a part: the view's outline (`GmOutline`). */
export const GM_OUTLINE = "outline" as const;

/**
 * The GM view's outline (`lre.gm.part` of `GM_OUTLINE`): each part in the view's order with how
 * many it holds (a list's items, the classifications' facets, the minds' characters, the fight 1
 * while one is under way), so a client reads only the parts it needs, never the whole view unasked.
 */
export type GmOutline = { part: GmPart; count: number }[];

/** What `lre.gm.part` answers: one part, or the view's outline. */
export type GmPartAnswer = GmPartView | { part: typeof GM_OUTLINE; id: null; value: GmOutline };

/** What a held write waits on (DESIGN §5.1, P2): the engine planning the chat's turn, the page that starts that turn's reply, or the reply being written. */
export type QueuedOn = "engine" | "page" | "reply";

/** A write made while a turn was under way, waiting for it (`GmView.held`), oldest first. */
export interface GmHeldWrite {
  id: string;
  /** What it is: a ✎ fix, GM edit or action (`post`), a marker, Keep or Discard, a Re-read, an Undo… */
  kind: string;
  /** What it does, worded as the GM view's edits are; empty for a write that changes no world (a Keep, an Undo). */
  lines: string[];
  /** A player's action, by how it reads, rather than a correction. */
  by?: string;
  waitsOn: QueuedOn;
}

/**
 * The one of `items` a token names (the GM view's keyed reads, `/money/<party id or name>`): the one
 * whose key is the token, else the one whose name it is, read without case or spaces at its ends;
 * with the keys of every one so named when several are; null when none is.
 */
export function keyedItem<T>(items: readonly T[], token: string, key: (item: T) => string | null, name: (item: T) => string | null): { item: T; index: number } | { ambiguous: string[] } | null {
  const index = items.findIndex((item) => key(item) === token);
  const keyed = items[index];
  if (keyed !== undefined) return { item: keyed, index };
  const wanted = token.trim().toLowerCase();
  const named = items.flatMap((item, i) => (name(item)?.trim().toLowerCase() === wanted ? [{ item, index: i }] : []));
  if (named.length > 1) return { ambiguous: named.map((n) => key(n.item) ?? String(n.index)) };
  return named[0] ?? null;
}
