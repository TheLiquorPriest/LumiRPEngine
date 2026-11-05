// The GM view's parts (DESIGN §7), each one field of `GmView`, which `lre.gm.part` builds alone: a
// client reading one part (the MCP server's `lre_gm`, the GM page's tabs) needn't have a view of many
// megabytes built and sent whole, and its outline says how many each part holds before any is read.
// One part more than the view's fields, `roster`: every entity as a list shows it, a few hundred
// bytes each, whose pages read their full entries by id. Every answer carries the key of the head it
// was built at, and a request that names the key it holds (`since`) is answered `same` without
// building anything while the head is unchanged. And what a write held behind a turn waits on
// (DESIGN §5.1, P2), which every write's answer and the GM view's held writes say.

import type { GmEntity, GmRosterEntry, GmView } from "./state-view";

/** The parts, in the view's order. */
export const GM_PARTS = ["entities", "kinds", "tiers", "lifeStates", "domains", "classifications", "places", "tracks", "relationTypes", "money", "orgs", "encounter", "routineRoles", "edits", "refused", "held", "minds"] as const satisfies readonly (keyof GmView)[];
export type GmPart = (typeof GM_PARTS)[number];

/** The slim list of every entity (`GmRosterEntry`), read in place of `entities` by a list that shows only names, kinds and badges. */
export const GM_ROSTER = "roster" as const;

/** What a client reads as one part: a field of the view, or the roster. */
export type GmReadPart = GmPart | typeof GM_ROSTER;

/** The parts whose items an id picks one of: an entity, a party's money, an organization. */
export const GM_KEYED_PARTS = ["entities", "money", "orgs"] as const satisfies readonly GmPart[];
export type GmKeyedPart = (typeof GM_KEYED_PARTS)[number];

/** The parts several ids pick from (`ids`): the keyed ones and the roster. */
export const GM_IDS_PARTS: readonly GmReadPart[] = [...GM_KEYED_PARTS, GM_ROSTER];

/** The parts a kind narrows (`kind`): the entities, the roster and the money, to those of the kind or one extending it. */
export const GM_KIND_PARTS: readonly GmReadPart[] = ["entities", "money", GM_ROSTER];

/** At most this many ids in one read (`ids`). */
export const GM_IDS_MAX = 500;

/** One part of the GM view as the whole view holds it; with an id, a list of that one (empty: there is none). */
export type GmPartView = { [P in GmPart]: { part: P; id: string | null; value: GmView[P] } }[GmPart] | { part: typeof GM_ROSTER; id: null; value: GmRosterEntry[] };

/** What `lre.gm.part` reads in place of a part: the view's outline (`GmOutline`). */
export const GM_OUTLINE = "outline" as const;

/**
 * The GM view's outline (`lre.gm.part` of `GM_OUTLINE`): each part in the view's order with how
 * many it holds (a list's items, the classifications' facets, the minds' characters, the fight 1
 * while one is under way), so a client reads only the parts it needs, never the whole view unasked;
 * with `bytes` asked for, each part's size as sent (its JSON, in UTF-8 bytes).
 */
export type GmOutline = { part: GmReadPart; count: number; bytes?: number }[];

/** What `lre.gm.part` builds: one part, or the view's outline. */
export type GmPartAnswer = GmPartView | { part: typeof GM_OUTLINE; id: null; value: GmOutline };

/**
 * What `lre.gm.part` answers: what it built, with the key of the head it was built at (the state as
 * the GM view reads it, the chain's edits, the held and refused writes, the minds settings); or,
 * when the request's `since` is that key still, `same`, with nothing built or sent.
 */
export type GmPartReply = (GmPartAnswer & { key: string; same?: undefined }) | { part: GmReadPart | typeof GM_OUTLINE; id: string | null; key: string; same: true };

/** The roster's entry for an entity as the whole view holds it: what `roster` gives for it, built without the rest. */
export function gmRosterEntry(e: GmEntity): GmRosterEntry {
  return {
    id: e.id,
    name: e.name,
    kind: e.kind,
    tier: e.tier,
    place: e.place,
    ...(e.holder !== null ? { holder: e.holder } : {}),
    ...(e.visibility !== "public" ? { visibility: e.visibility } : {}),
    ...(e.found !== undefined ? { found: e.found } : {}),
    ...(e.life.state !== "alive" ? { life: { state: e.life.state, label: e.life.label, acts: e.life.acts } } : {}),
    ...(e.holds ? { holds: e.holds } : {}),
    ...(e.goes ? { goes: e.goes } : {}),
    ...(e.tags.length > 0 ? { tags: e.tags } : {}),
    ...(e.pov ? { pov: true as const } : {}),
    ...(e.person ? { person: true as const } : {}),
    ...(e.agent ? { agent: true as const } : {}),
    ...(e.gone ? { gone: true as const } : {}),
    ...(e.spawned ? { spawned: true as const } : {}),
    ...(e.claimed ? { claimed: true as const } : {}),
  };
}

/** The entity a roster entry names, as a list reads it: its fields, relations, levels and sheet are left for its page to read (`entities` by id). */
export function rosterEntity(r: GmRosterEntry): GmEntity {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    tier: r.tier,
    agent: r.agent === true,
    pov: r.pov === true,
    person: r.person === true,
    gone: r.gone === true,
    spawned: r.spawned === true,
    visibility: r.visibility ?? "public",
    ...(r.found !== undefined ? { found: r.found } : {}),
    place: r.place,
    holder: r.holder ?? null,
    ...(r.holds ? { holds: r.holds } : {}),
    ...(r.goes ? { goes: r.goes } : {}),
    claimed: r.claimed === true,
    fields: [],
    relations: [],
    levels: [],
    class: {},
    tags: r.tags ?? [],
    sheet: null,
    life: { state: r.life?.state ?? "alive", label: r.life?.label ?? "Alive", acts: r.life?.acts ?? true, everyone: true, aware: [], unaware: [] },
  };
}

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
