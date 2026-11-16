// How a map is laid out wherever one is shown (plan §8.2, §22 l.2120): the world state, `world_query`
// and `map_view`. The layout is a file, `.prompts/map-layout.md`: its body places the title, the part
// shown, the picture, the legend, the list of who and what is where, and the doors, in the order the
// owner wants them, and its lines word each of them (the picture's own rows and column numbers, a
// legend entry, a piece's line, a door's). Code fills fields; nothing of the layout is in code. The
// map's tools answer in `.prompts/map-answers.md`, not here.

import { readPart, type Template } from "../../store/words";
import type { Fields } from "../texts";

/** The prompt part a map's layout and every line that prints a map come from. */
export const MAP_LAYOUT = "map-layout";

/** A map's layout as the chat has it. */
export interface MapLayout {
  /** The file's text; empty when the chat has none. */
  readonly source: string;
  /** What the header says besides the lines: it is read as fields by every line. */
  readonly header: Fields;
  readonly lines: ReadonlyMap<string, Template>;
  /** The body: where each field of a map goes; null when the chat has no layout, which prints no map. */
  readonly body: Template | null;
  /** The keys of the facts on a piece that its line carries, as the layout names them (`facts:` in its header). */
  readonly facts: readonly string[];
  /** How wide the column of row numbers is, in characters (`labelWidth:` in its header). */
  readonly labelWidth: number;
  /** What of the file could not be read: the map is then printed by what of it could. */
  readonly problems: readonly string[];
}

/** No layout: nothing is printed of a map. */
export const NO_LAYOUT: MapLayout = Object.freeze({ source: "", header: {}, lines: new Map(), body: null, facts: [], labelWidth: 0, problems: [] });

/** A layout from its file's text; a file that cannot be read gives none and says why. */
export function parseLayout(text: string | undefined): MapLayout {
  if (text === undefined) return NO_LAYOUT;
  try {
    const part = readPart(text, `.prompts/${MAP_LAYOUT}.md`);
    const width = part.header.labelWidth;
    const facts = part.header.factKeys;
    return {
      source: text,
      header: part.header,
      lines: part.lines,
      body: part.body,
      facts: Array.isArray(facts) ? facts.filter((k): k is string => typeof k === "string") : [],
      labelWidth: typeof width === "number" && Number.isInteger(width) && width >= 0 ? width : 0,
      problems: [],
    };
  } catch (error) {
    return { ...NO_LAYOUT, source: text, problems: [error instanceof Error ? error.message : String(error)] };
  }
}

/** A line of the layout filled; undefined when the layout has no such line or it comes out blank. A line's own leading spaces are kept. */
export function layoutLine(layout: MapLayout, name: string, fields: Fields = {}): string | undefined {
  const said = layout.lines.get(name)?.render(layout.header, fields).trimEnd();
  return said === undefined || said.trim() === "" ? undefined : said;
}
