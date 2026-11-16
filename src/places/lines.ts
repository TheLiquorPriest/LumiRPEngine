// A place's record as the lines the tree carries (plan §6.9, §8.2): `world_query` at a place opened in full, and the world state's
// scene place at hand, give the parts of its record as lines of their own kinds, each part at most the setting's number of entries with
// a count of the rest and the query that reads them. The words of each kind are the world-state layout's (`.prompts/world-state.md`);
// this gives data. A part with nothing recorded says so with its own line.

import type { ViewLine } from "../store";
import { MAP_DEFAULTS, type MapConfig } from "../iface/map";
import { accessOf, factReader, featuresOf, type PlaceAt, rowFields, sinceOf } from "./record";
import type { PlaceFactPart } from "./parts";
import type { PlacesSettings } from "./settings";
import type { PlaceFactRow } from "./shapes";

/** The line kind of each part whose entries are facts. */
const FACT_LINES: Record<PlaceFactPart, string> = { since: "place_since", feature: "place_feature", access: "place_access" };

export interface PlaceLinesInput {
  at: PlaceAt;
  place: string;
  settings: Pick<PlacesSettings, "since" | "features" | "access">;
  config?: MapConfig;
  /** How far in the lines sit. */
  depth: number;
  /** Asked for one part whole (`world_query`'s `part`): every entry of it, none of the others. */
  part?: PlaceFactPart;
}

/** The query that reads what a part left out: `world_query` at the place, asking for the part whole. */
function askFor(place: string, part: PlaceFactPart): string {
  return `world_query at place:${place} part ${part}`;
}

/** The lines of the parts of a place's record the tree shows: what the story changed (`since`), its features and its access and state. */
export function placeLines(input: PlaceLinesInput): ViewLine[] {
  const { at, place, depth } = input;
  const config = input.config ?? MAP_DEFAULTS;
  const reader = factReader(at);
  // A part asked for whole is not cut by its setting.
  const settings = input.part === undefined ? input.settings : { since: Number.MAX_SAFE_INTEGER, features: Number.MAX_SAFE_INTEGER, access: Number.MAX_SAFE_INTEGER };
  const wanted = (part: PlaceFactPart): boolean => input.part === undefined || input.part === part;
  const lines: ViewLine[] = [];
  const facts = (part: PlaceFactPart, shown: { items: PlaceFactRow[]; more: number }): void => {
    for (const row of shown.items) lines.push({ kind: FACT_LINES[part], depth, fields: rowFields(row) });
    if (shown.more > 0) lines.push({ kind: "place_more", depth, fields: { part, n: shown.more, ask: askFor(place, part) } });
  };
  const none = (part: string): void => {
    lines.push({ kind: "place_none", depth, fields: { part } });
  };

  if (wanted("since")) {
    const since = sinceOf(at, place, settings, reader);
    facts("since", since);
    if (since.items.length === 0) none("since");
  }
  if (wanted("feature")) {
    const features = featuresOf(at, place, settings, config, reader);
    facts("feature", features.facts);
    for (const f of features.fixtures) lines.push({ kind: "place_fixture", depth, fields: { name: f.name, at: f.at.join(","), size: f.size.join("x") } });
    for (const z of features.zones) lines.push({ kind: "place_zone", depth, fields: { name: z.name, squares: z.squares } });
    if (features.facts.items.length === 0 && features.fixtures.length === 0 && features.zones.length === 0) none("feature");
  }
  if (wanted("access")) {
    const access = accessOf(at, place, settings, config, reader);
    if (access.entry !== null) lines.push({ kind: "place_entry", depth, fields: { audience: access.entry.audience, ...(access.entry.inherited ? { from: access.entry.name } : {}) } });
    facts("access", access.facts);
    for (const d of access.doors) lines.push({ kind: "place_door", depth, fields: { at: d.at.join(","), state: d.state } });
    if (access.entry === null && access.facts.items.length === 0 && access.doors.length === 0) none("access");
  }
  return lines;
}
