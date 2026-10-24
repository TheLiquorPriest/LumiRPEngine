// The Place section's lore (DESIGN §6.11, §4.2): what the world's lore, World Info read live
// included, says about where the player character is, for the narrator. Pure; the space pack
// registers it on the `place` slot as the `place_lore` source.

import { lorePinKey, loreSourceOf } from "../shared/lore";
import type { FeedScope, LoreEntryDef, LoreKeep } from "../shared/world";
import { loreReadable, loreSnippet } from "./lore";
import { pinsFor, placeChain } from "./lore-pins";
import type { FeedLine, ReadContext } from "./registry";
import { placeOfEntity } from "./scope";
import { canSeePlace, loreGateReader } from "./visibility";

/** At most this many entries of each kind (read, or GM-only) go into the Place section; the helpers' searches still find the rest. */
export const PLACE_LORE_CAP = 6;

/**
 * Each lore line's share of the Place section, in characters: about 150 tokens at the section
 * estimate's 3.2 characters a token. A longer entry is cut at a word, so a long town or region entry
 * linked from every room inside it never makes the section too big for the budget, which would leave
 * the whole section out, the place's own description with it.
 */
export const PLACE_LORE_CHARS = 480;

/** The narrator reads lore as the steps that write for it do (`brief` among `PROSE_STEPS`): a secret only once its gate holds, a Known by entry by what the player character knows. */
const NARRATOR_READS = "brief";

/**
 * Each entry linking where the player character is or a place holding it, nearest place first, then
 * by the author's priority and title, as `Title: text` within `PLACE_LORE_CHARS`, cut keeping its
 * start, or its end when it is pinned to one of those places to keep the end. The player scope, and
 * every scope's plain lines, give only what the narrator may read about a place the player character
 * can see; the GM scope adds the rest, marked. A line holding a World Info entry's whole text names
 * it as its source, so that entry stays out of the same prompt (§6.1); a cut one doesn't, nor one
 * whose text holds a macro, which the section can't keep but the entry's own activation runs.
 */
export function placeLoreLines(ctx: ReadContext, scope: FeedScope): FeedLine[] {
  const { registry, world, state } = ctx;
  const here = placeOfEntity(state, world.pov);
  if (!here) return [];
  const chain = placeChain(world, here);
  const open = loreGateReader(registry, world, state);
  const found: { entry: LoreEntryDef; at: number; read: boolean }[] = [];
  for (const entry of Object.values(world.lore)) {
    const links = Array.isArray(entry.links) ? entry.links : [];
    const at = chain.findIndex((place) => links.includes(place));
    if (at < 0 || typeof entry.content !== "string" || entry.content.trim() === "") continue;
    const read = canSeePlace(registry, world, state, world.pov, chain[at] ?? here) && loreReadable(registry, world, state, entry, NARRATOR_READS, false, open);
    // An AI-written entry still waiting for review reaches no one, the GM's narrator included.
    const source = loreSourceOf(entry.source);
    if (source.kind === "ai" && source.status === "pending") continue;
    found.push({ entry, at, read });
  }
  found.sort((a, b) => a.at - b.at || (b.entry.priority ?? 0) - (a.entry.priority ?? 0) || String(a.entry.title).localeCompare(String(b.entry.title)) || a.entry.id.localeCompare(b.entry.id));
  // A pin to one of these places says which part of a long entry to keep.
  const keeps = new Map(pinsFor(world, here).map((ref) => [ref.key, ref.pin.keep ?? "start"]));
  const keepOf = (entry: LoreEntryDef): LoreKeep => {
    const source = loreSourceOf(entry.source);
    return keeps.get(lorePinKey({ lore: entry.id })) ?? (source.kind === "book" ? keeps.get(lorePinKey({ book: source.bookId, entry: source.entryId })) : undefined) ?? "start";
  };
  const lineOf = (entry: LoreEntryDef, known: FeedLine["known"]): FeedLine[] => {
    const title = typeof entry.title === "string" && entry.title.trim() !== "" ? entry.title : entry.id;
    const snippet = loreSnippet((text) => text.length, { title, content: entry.content }, PLACE_LORE_CHARS, keepOf(entry));
    if (!snippet) return [];
    const source = loreSourceOf(entry.source);
    return [{ text: snippet.text, known, ...(source.kind === "book" && !snippet.cut && !entry.content.includes("{{") ? { source: { bookId: source.bookId, entryId: source.entryId } } : {}) }];
  };
  const lines = found.filter((f) => f.read).slice(0, PLACE_LORE_CAP).flatMap((f) => lineOf(f.entry, "pov"));
  if (scope !== "gm") return lines;
  // The GM scope's narrator is told the rest too, marked, a secret before its gate holds included.
  return [...lines, ...found.filter((f) => !f.read).slice(0, PLACE_LORE_CAP).flatMap((f) => lineOf(f.entry, "gm"))];
}
