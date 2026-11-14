// The lore map the Author is given at the start of every turn (plan §9.2), in four parts:
//   1. in the prompt: each entry that activated, with what the index says it is and defines;
//   2. changed by the story: those of them the story has since outdated, with the overlays' notes;
//   3. from the world's own lore: world entries whose keys come up in the recent messages;
//   4. bound to the horizon: entries bound to who and what is on the horizon that did not activate,
//      the player's character's first, then each character present's, then the place's, up to a limit,
//      with a count of any left out.
// An entry no run has indexed as it stands shows its keys. The map is made from ids, keys and bindings
// alone; nothing in it is ranked or judged by code. Its layout is the shipped prompt part
// `.prompts/lore-map.md`, and each entry's line is a line of `.prompts/lore-answers.md`; these are the
// fields they lay out. `Lore.loreMap` gives the first form, parts 1 and 3 by id and title alone.

import type { Fields, LinesPart } from "rp-harness";
import type { LoreBinding } from "./indexing";
import { listField, loreLine } from "./tools";

/** One entry of the map. */
export interface LoreMapLine {
  id: string;
  title: string;
  /** What the index says it is, where a run or the user has said. */
  kind?: string;
  line?: string;
  defines?: LoreBinding[];
  /** For an entry no run has indexed as it stands: its keys, which stand in for what it is. */
  keys?: string[];
  /** Changed by the story: the overlays' notes on it, oldest first. */
  notes?: string[];
  /** Bound to the horizon: the names of who and what on it the entry is bound to. */
  bound?: string[];
}

export interface LoreMap {
  /** The entries Lumiverse activated for this turn's prompt, in the order it gave them. */
  inPrompt: LoreMapLine[];
  /** The world's own entries whose keys come up in the recent messages, in the world's order. They are never in Lumiverse's prompt. */
  world: LoreMapLine[];
  /** Activated entries the story has since outdated, each with its notes. Absent from the first form. */
  changed?: LoreMapLine[];
  /** Entries bound to who and what is on the horizon that did not activate, up to the limit. Absent from the first form. */
  bound?: LoreMapLine[];
  /** How many more entries were bound to the horizon than the limit let in. */
  leftOut?: number;
  /** How many entries of the chat's lore no run has indexed as they stand. */
  notIndexed?: number;
}

/** The fields of `.prompts/lore-map.md` the map fills. A part with no entries is left out, so the layout shows nothing of it. */
export interface LoreMapFields {
  in_prompt?: { lines: string[] };
  changed?: { lines: string[] };
  world?: { lines: string[] };
  bound?: { lines: string[]; left_out?: number };
  not_indexed?: number;
}

/** An entry's fields as the map's lines read them. */
function lineFields(lines: LinesPart, l: LoreMapLine): Fields {
  return {
    id: l.id,
    title: l.title,
    kind: l.kind,
    line: l.line,
    defines: listField((l.defines ?? []).map((b) => loreLine(lines, "binding", { what: b.what, aspect: b.aspect }) ?? b.what)),
    keys: l.keys === undefined ? undefined : listField(l.keys),
    notes: l.notes,
    bound: listField(l.bound ?? []),
  };
}

/**
 * The map's fields. With the lore's lines in force for the chat, each entry's line is that part's line
 * for it (`map_in_prompt`, `map_changed`, `map_world`, `map_bound`); without, the first form's line:
 * its id in brackets, then its title.
 */
export function loreMapFields(map: LoreMap, lines?: LinesPart): LoreMapFields {
  const part = (entries: readonly LoreMapLine[] | undefined, name: string): string[] =>
    (entries ?? []).flatMap((l) => (lines === undefined ? [l.title === "" ? `[${l.id}]` : `[${l.id}] ${l.title}`] : (loreLine(lines, name, lineFields(lines, l)) ?? [])));
  const inPrompt = part(map.inPrompt, "map_in_prompt");
  const changed = part(map.changed, "map_changed");
  const world = part(map.world, "map_world");
  const bound = part(map.bound, "map_bound");
  const leftOut = map.leftOut ?? 0;
  return {
    ...(inPrompt.length > 0 ? { in_prompt: { lines: inPrompt } } : {}),
    ...(changed.length > 0 ? { changed: { lines: changed } } : {}),
    ...(world.length > 0 ? { world: { lines: world } } : {}),
    ...(bound.length > 0 || leftOut > 0 ? { bound: { lines: bound, ...(leftOut > 0 ? { left_out: leftOut } : {}) } } : {}),
    ...((map.notIndexed ?? 0) > 0 ? { not_indexed: map.notIndexed } : {}),
  };
}
