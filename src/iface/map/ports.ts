// The map's two faces for what calls it (`src/iface/map/`): the squares the everyday operations put
// someone or something on (`GridMoves`, `world_apply`'s `move` and `place`), and a place's map as the
// world state and `world_query` print it (`MapView`). The engine's tools are given both by the host
// (`EngineDeps`, the turn lane); the world state's own declaration of the second is `MapText`.

import type { JsonObject, JsonValue } from "../../shared/json";
import type { FoldEnv } from "../../store/fold";
import type { StoreState } from "../../store/types";
import type { Fields } from "../texts";

/** What the grid finds does not add up where something now stands, as a report to keep with its change: the answers' line it is (`grid_<code>`), its fields, and the map's words for it. */
export interface GridFinding {
  line: string;
  fields: Fields;
  words: string;
}

/**
 * Placing on a map's squares: the events that put someone or something at a square, beside someone,
 * or in a zone of the grid it stands on; `said`, the sentences the answer gives of it, worded from
 * the map's part (for one that stood on the map before, the way it went and the time that took);
 * and `reports`, what does not add up where it now stands (a square in a wall, over something that
 * blocks, a room with no free square), kept with the change. It is applied all the same. `filled` is
 * true where code chose the square (beside someone, a free square of a zone): that change is an
 * assumption. Where there is no square to put it on (the place has no map, the map has no such zone,
 * the one to stand beside stands on none), the result is `kept`: the zone or the words that stay as
 * its position, never a refusal. Only a square that does not exist is one, with what does exist.
 */
export type GridPlaced = { events: JsonObject[]; said?: string[]; reports?: GridFinding[]; filled?: true } | { kept: { zone?: string; words?: string }; reports?: GridFinding[] } | { problem: string; fields: Fields };

export interface GridMoves {
  place(input: { state: StoreState; env: FoldEnv; who: string; place: string; square?: [number, number]; near?: string; zone?: string; nearMatches?: number }): GridPlaced;
  /**
   * What the grid finds of a place's light that was just set (`world_apply`'s `set`, key `light`): a value
   * that is neither lit nor dark is recorded as given and reads as unset, which the finding says, with
   * what the place now reads as. Null where the light reads, or was cleared.
   */
  light(input: { state: StoreState; env: FoldEnv; place: string; value: JsonValue | undefined }): GridFinding | null;
}

/** The map's two layers: what is drawn (the title, the part shown, the picture, the legend) and what moves (who and what is where, the doors). */
export type MapLayer = "drawn" | "moving";

/**
 * A map as printed: the id of the grid it is (a grid shown once however many places on it are shown),
 * a version of the drawn layer as play stands (it changes when a square is edited, a grid is laid or
 * the world's revision changes, and not when someone moves or a door opens), and the text of the layer
 * asked for, or of both when none is.
 */
export interface MapPrinted {
  grid: string;
  drawn: string;
  text: string;
}

/**
 * A place's map as the world state prints it: null for a place with no map. `around` are the tree
 * refs of the horizon's entries, which the part printed of a large grid must hold when they fit.
 */
export interface MapView {
  text(input: { state: StoreState; env: FoldEnv; place: string; layer?: MapLayer; around?: readonly string[] }): MapPrinted | null;
}
