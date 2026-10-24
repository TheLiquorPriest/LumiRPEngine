// The Place section's lore (DESIGN §6.11, §4.2): what the world's lore, World Info read live
// included, says about where the player character is, for the narrator. Pure; the space pack
// registers it on the `place` slot as the `place_lore` source.

import { loreSourceOf } from "../shared/lore";
import type { FeedScope, LoreEntryDef } from "../shared/world";
import { loreReadable } from "./lore";
import { placeChain } from "./lore-pins";
import type { FeedLine, ReadContext } from "./registry";
import { placeOfEntity } from "./scope";
import { canSeePlace, loreGateReader } from "./visibility";

/** At most this many entries of each kind (read, or GM-only) go into the Place section; the helpers' searches still find the rest. */
export const PLACE_LORE_CAP = 6;

/** The narrator reads lore as the steps that write for it do (`brief` among `PROSE_STEPS`): a secret only once its gate holds, a Known by entry by what the player character knows. */
const NARRATOR_READS = "brief";

/**
 * Each entry linking where the player character is or a place holding it, nearest place first, then
 * by the author's priority and title, as `Title: text`. The player scope, and every scope's plain
 * lines, give only what the narrator may read about a place the player character can see; the GM
 * scope adds the rest, marked. A line from a World Info entry names it as its source, so that entry
 * stays out of the same prompt (§6.1), unless its text holds a macro, which the section can't keep
 * but the entry's own activation runs.
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
  const lineOf = (entry: LoreEntryDef, known: FeedLine["known"]): FeedLine => {
    const text = `${typeof entry.title === "string" && entry.title.trim() !== "" ? entry.title.trim() : entry.id}: ${entry.content.replace(/\s+/g, " ").trim()}`;
    const source = loreSourceOf(entry.source);
    return { text, known, ...(source.kind === "book" && !entry.content.includes("{{") ? { source: { bookId: source.bookId, entryId: source.entryId } } : {}) };
  };
  const lines = found.filter((f) => f.read).slice(0, PLACE_LORE_CAP).map((f) => lineOf(f.entry, "pov"));
  if (scope !== "gm") return lines;
  // The GM scope's narrator is told the rest too, marked, a secret before its gate holds included.
  return [...lines, ...found.filter((f) => !f.read).slice(0, PLACE_LORE_CAP).map((f) => lineOf(f.entry, "gm"))];
}
