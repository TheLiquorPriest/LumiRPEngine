// The lore map the Author is given at the start of every turn (plan §9.2), first form: the entries
// that activated for the prompt, and the world's own entries whose keys come up in the recent
// messages, one line each with its id and title. The lines are made from ids, titles and keys alone;
// nothing in the map is ranked or judged by code. The map's layout and words are the shipped prompt
// part `.prompts/lore-map.md`; these are the fields it lays out.

/** One entry of the map. */
export interface LoreMapLine {
  id: string;
  title: string;
}

export interface LoreMap {
  /** The entries Lumiverse activated for this turn's prompt, in the order it gave them. */
  inPrompt: LoreMapLine[];
  /** The world's own entries whose keys come up in the recent messages, in the world's order. They are never in Lumiverse's prompt. */
  world: LoreMapLine[];
}

/** The fields of `.prompts/lore-map.md` the map fills. A part with no entries is left out, so the layout shows nothing of it. */
export interface LoreMapFields {
  in_prompt?: { lines: string[] };
  world?: { lines: string[] };
}

/** One line per entry, as plan §9.2 writes them: its id in brackets, then its title. */
function linesOf(part: readonly LoreMapLine[]): string[] {
  return part.map(({ id, title }) => (title === "" ? `[${id}]` : `[${id}] ${title}`));
}

export function loreMapFields(map: LoreMap): LoreMapFields {
  return {
    ...(map.inPrompt.length > 0 ? { in_prompt: { lines: linesOf(map.inPrompt) } } : {}),
    ...(map.world.length > 0 ? { world: { lines: linesOf(map.world) } } : {}),
  };
}
