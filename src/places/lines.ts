// A place's record as the lines the tree carries (plan §6.9, §8.2): `world_query` at a place opened in full, and the world state's
// scene place at hand, give the parts of its record as lines of their own kinds, each part at most the setting's number of entries with
// a count of the rest and the query that reads them. The words of each kind are the world-state layout's (`.prompts/world-state.md`);
// this gives data. A part with nothing recorded says so with its own line.

import type { Store, UserStore, ViewLine } from "../store";
import { MAP_DEFAULTS, type MapConfig } from "../iface/map";
import { accessOf, factReader, featuresOf, type PlaceAt, placeAtState, rowFields, sinceOf } from "./record";
import type { PlaceFactPart } from "./parts";
import { baseAt } from "./base";
import type { PlacesSettings } from "./settings";
import type { PlaceSources } from "./sources";
import { waysPart } from "./ways";
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
  /**
   * The entries bound to the place as Lumiverse holds them now (read ahead: they cannot be read where the lines are made): given, the
   * lines carry the place's base and its sources, the base marked older than a source that changed. Left out, neither is given.
   */
  sources?: PlaceSources;
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

  if (input.sources !== undefined && input.part === undefined) {
    const base = baseAt(at, place, input.sources);
    if (base.text === null) none("base");
    else lines.push({ kind: "place_base", depth, fields: { text: base.text, ...(base.world ? { world: true } : {}), ...(base.older ? { older: true } : {}), ...(base.by !== null ? { by: base.by } : {}) } });
    for (const src of input.sources.sources) lines.push({ kind: "place_source", depth, fields: { entry: src.entry, aspect: src.aspect, ...(src.title !== null ? { title: src.title } : { gone: true }), ...(src.newer ? { newer: true } : {}) } });
    if (input.sources.sources.length === 0) none("sources");
    // Its ways: each with its minutes and distance by each way of travel, and what is adjoining.
    const { ways, adjoining } = waysPart(at, place);
    for (const w of ways) lines.push({ kind: "place_way", depth, fields: { to: w.to.name, id: w.to.id, dir: w.dir, modes: w.modes.map((m) => ({ mode: m.mode, minutes: m.minutes, ...(m.km !== null ? { km: m.km } : {}) })), ...(w.turn !== null ? { laid: true } : {}) } });
    for (const a of adjoining) lines.push({ kind: "place_adjoining", depth, fields: { name: a.name, id: a.id, how: a.how } });
    if (ways.length === 0 && adjoining.length === 0) none("ways");
  }

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

/**
 * A view's lines with a place's record lines in them: after the place's own level line (the one `level_place` with its id), in place of
 * the plain fact lines that carry a record part, which the record's lines give with their turn, time and beat. A view without that level
 * is returned as it is.
 */
export function withPlaceLines(lines: readonly ViewLine[], input: Omit<PlaceLinesInput, "depth">): ViewLine[] {
  const level = lines.findIndex((l) => l.kind === "level_place" && l.fields.id === input.place);
  if (level < 0) return [...lines];
  const own = lines[level]?.depth ?? 0;
  const out = lines.slice(0, level + 1);
  out.push(...placeLines({ ...input, depth: own + 1 }));
  // The plain fact lines of this level stand before the next level line.
  const next = lines.findIndex((l, i) => i > level && l.kind.startsWith("level_"));
  const end = next < 0 ? lines.length : next;
  lines.forEach((l, i) => {
    if (i <= level) return;
    if (i < end && l.kind === "fact" && l.depth > own && typeof l.fields.part === "string") return;
    out.push(l);
  });
  return out;
}

/**
 * The hook the world state calls for each place it shows in full (the scene's place at hand): the place's lines as the turn `turn` of
 * `chat` stands, the plain facts that carry a part given up for them. A ref that is not a place, or a state whose world cannot be found,
 * leaves the lines as they are.
 */
export function placeLinesAt(u: UserStore, env: Store["env"], chat: string, turn: string, settings: PlaceLinesInput["settings"], config?: MapConfig): (ref: string, lines: readonly ViewLine[]) => ViewLine[] {
  let at: PlaceAt | null | undefined;
  return (ref, lines) => {
    if (!ref.startsWith("place:")) return [...lines];
    if (at === undefined) {
      const state = u.stateAt(turn).state;
      const doc = env.worlds(state.world.revision);
      at = doc === undefined ? null : placeAtState(u, env, chat, turn, state, env.registry.context(doc, state.world));
    }
    return at === null ? [...lines] : withPlaceLines(lines, { at, place: ref.slice("place:".length), settings, ...(config !== undefined ? { config } : {}) });
  };
}
