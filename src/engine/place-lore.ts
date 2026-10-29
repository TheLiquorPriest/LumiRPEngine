// The Place section's lore (DESIGN §6.11, §4.2): what the world's lore, World Info read live
// included, says about where the player character is, for the narrator. Pure; the space pack
// registers it on the `place` slot as the `place_lore` source. It reads lore and changes nothing:
// a World Info entry it tells still reaches the prompt by its own rules, keys and budget included.

import { loreSourceOf } from "../shared/lore";
import type { FeedScope, LoreEntryDef } from "../shared/world";
import { loreReadable, loreSnippet } from "./lore";
import { placeChain } from "./lore-pins";
import type { FeedLine, ReadContext } from "./registry";
import { placeOfEntity } from "./scope";
import { canSeePlace, loreGateReader } from "./visibility";

/** The narrator reads lore as the steps that write for it do (`brief` among `PROSE_STEPS`): a secret only once its gate holds, a Known by entry by what the player character knows. */
const NARRATOR_READS = "brief";

/**
 * Each entry linking where the player character is or a place holding it, whole, nearest place
 * first, then by the author's priority and title, as `Title: text`: the narrator is told all of
 * what the lore says about where he is (a room's inventory, its fittings), never a summary. The
 * section budget trims whole lines from the section's end (§6.2), so a lore entry that doesn't fit
 * is left out whole, never cut. The player scope, and every scope's plain lines, give only what the
 * narrator may read about a place the player character can see; the GM scope adds the rest, marked.
 * A World Info entry's line is the entry's lore as read live, its secret marks apart from its text
 * (each a secret entry of its own, `bookMarkLores`).
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
  const lineOf = (entry: LoreEntryDef, known: FeedLine["known"]): FeedLine[] => {
    const title = typeof entry.title === "string" && entry.title.trim() !== "" ? entry.title : entry.id;
    const whole = loreSnippet((text) => text.length, { title, content: entry.content }, Number.POSITIVE_INFINITY);
    return whole ? [{ text: whole.text, known }] : [];
  };
  const lines = found.filter((f) => f.read).flatMap((f) => lineOf(f.entry, "pov"));
  if (scope !== "gm") return lines;
  // The GM scope's narrator is told the rest too, marked, a secret before its gate holds included.
  return [...lines, ...found.filter((f) => !f.read).flatMap((f) => lineOf(f.entry, "gm"))];
}
