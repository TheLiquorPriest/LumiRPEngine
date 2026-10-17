// Describe a map (DESIGN §13): the author's prose about one place becomes one `lre-map-v1` map from
// a helper JSON call. The prompt carries the published JSON Schema and a short example; the answer
// is checked against the schema and the map lint on the draft, and a map with errors gets one repair
// call that lists them. The map comes back as a proposal, which Build previews and applies.

import type { MapId, PlaceId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import { MAP_SCHEMA, mapProblems, readMap, type MapProblem } from "../shared/maps";
import type { JobProposal } from "../shared/protocol";
import { pathText } from "../shared/schema-check";
import type { MapDoc, WorldDoc } from "../shared/world";

/** The most prose one request carries. */
export const MAP_PROSE_MAX = 4000;

const MAP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface MapRequest {
  scope: PlaceId;
  mapId: MapId;
  prose: string;
}

/** A job's input as a request: a place the world has, an id for the map (by default `<scope>_map`), and the prose. */
export function readMapRequest(world: WorldDoc, input: JsonObject): MapRequest {
  const scope = typeof input.scope === "string" ? input.scope : "";
  if (!hasOwn(world.places, scope)) throw new Error("choose the place the map draws");
  const prose = typeof input.prose === "string" ? input.prose.trim().slice(0, MAP_PROSE_MAX) : "";
  if (prose === "") throw new Error("describe the place first");
  const given = typeof input.mapId === "string" ? input.mapId.trim() : "";
  const fallback = `${scope.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^[^A-Za-z0-9]+/, "")}_map`.slice(0, 64);
  const mapId = given !== "" ? given : fallback;
  if (!MAP_ID.test(mapId)) throw new Error("a map id is letters, digits, _ and -, starting with a letter or digit");
  return { scope, mapId, prose };
}

const EXAMPLE: MapDoc = {
  id: "cottage",
  scope: "farm",
  title: "The cottage",
  layout: ["#######", "#kk+bb#", "#kk#bb#", "###+###"],
  legend: { k: { place: "cottage_kitchen" }, b: { place: "cottage_bedroom" } },
  places: [
    { id: "cottage_kitchen", name: "Kitchen" },
    { id: "cottage_bedroom", name: "Bedroom" },
  ],
};

/** The system prompt: the task, the rules, the schema and the example. */
export function mapSystem(): string {
  return [
    "You draw maps for a roleplay world engine. From the author's description of one place, answer with one map of that place's inside, as JSON in the lre-map-v1 format the JSON Schema below defines. Output the map object only: no prose, no code fence.",
    "Rules:",
    '- A building, a floor or a set of rooms is a grid map: "layout" is the floor plan, one string per row, every row the same length, one character per cell, and "legend" says what each character is. Unless the legend says otherwise # is a wall, . is floor, + is a door and a space is nothing. Give each room its own letter and map that letter to {"place": "<the room\'s id>"}.',
    '- A town, a district or a region is a node map: "places" and "links", no layout. "at" is optional, [x, y] within "size" [width, height].',
    '- "places" lists the places inside it, each with a new lowercase snake_case id and a "name". Never reuse an id the world already has.',
    '- "links" are ways between places with their minutes on foot (or a "mode"). Link every place inside it or none; with no links, people walk freely between them.',
    "- Draw only what the description says or clearly implies. At most 64 rows of 64 cells, and 64 places.",
    `JSON Schema:\n${JSON.stringify(MAP_SCHEMA)}`,
    `Example, a two-room cottage on a farm:\n${JSON.stringify(EXAMPLE)}`,
  ].join("\n");
}

/** The request: the map's id and place, the places already inside it and around it, and the prose. */
export function mapRequestText(world: WorldDoc, request: MapRequest): string {
  const place = world.places[request.scope];
  const label = (id: string): string => `${id} (${world.places[id]?.name ?? id})`;
  const inside = Object.values(world.places).filter((p) => p.parent === request.scope && p.map !== request.mapId);
  const others = Object.keys(world.places)
    .filter((id) => id !== request.scope && world.places[id]?.parent !== request.scope)
    .sort()
    .slice(0, 60);
  return [
    `Map id: ${request.mapId}`,
    `The place to draw: ${label(request.scope)}${place?.parent ? `, inside ${label(place.parent)}` : ""}`,
    `Places already inside it (don't reuse their ids; they stay as they are): ${inside.length > 0 ? inside.map((p) => label(p.id)).join(", ") : "none"}`,
    `Other places in the world, which links may name: ${others.length > 0 ? others.join(", ") : "none"}`,
    `Description:\n${request.prose}`,
  ].join("\n");
}

export interface MapAnswer {
  /** The answer with the request's id and place in it, as checked. */
  value: JsonValue | null;
  map: MapDoc | null;
  problems: MapProblem[];
}

/** A helper's answer read as the requested map: its id and place set, checked against the schema and the map lint on `world`. */
export function readMapAnswer(world: WorldDoc, request: MapRequest, reply: JsonValue | null): MapAnswer {
  if (!isRecord(reply)) return { value: reply, map: null, problems: [{ severity: "error", path: [], code: "map_shape", message: "should be one map object, as JSON" }] };
  // A model sometimes wraps the map: {"map": {...}}.
  const raw = isRecord(reply.map) && reply.scope === undefined && reply.layout === undefined && reply.places === undefined ? reply.map : reply;
  const value: JsonObject = { ...raw, id: request.mapId, scope: request.scope };
  // Lint reads every map through the schema check, so the answer goes in as it is.
  const problems = mapProblems({ ...world, maps: { ...world.maps, [request.mapId]: value as unknown as MapDoc } }).get(request.mapId) ?? [];
  return { value, map: readMap(value).map, problems };
}

export function problemLines(problems: readonly MapProblem[]): string {
  return problems.map((p) => `- ${p.path.length > 0 ? `${pathText(p.path)}: ` : ""}${p.message}`).join("\n");
}

/** The repair call's request: the first request, what was wrong with the answer, and the answer itself. */
export function mapRepairText(request: string, answer: MapAnswer): string {
  return `${request}\n\nYour map had these problems:\n${problemLines(answer.problems.filter((p) => p.severity === "error"))}\n\nYour map was:\n${JSON.stringify(answer.value)}\n\nAnswer with the corrected map, JSON only.`;
}

/** The map as a proposal: ticked when it has no errors (lint warnings lower it a little), with what's left to fix in its note. */
export function mapProposal(request: MapRequest, answer: MapAnswer & { map: MapDoc }): JobProposal {
  const errors = answer.problems.filter((p) => p.severity === "error");
  const confidence = errors.length > 0 ? 0.4 : answer.problems.length > 0 ? 0.75 : 0.9;
  return {
    id: `maps:${request.mapId}`,
    collection: "maps",
    key: request.mapId,
    value: answer.map as unknown as JsonValue,
    source: "Described",
    confidence,
    pack: "space",
    ...(answer.problems.length > 0 ? { note: `Check before you commit:\n${problemLines(answer.problems)}` } : {}),
  };
}
