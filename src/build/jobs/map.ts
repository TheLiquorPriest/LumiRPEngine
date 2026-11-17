// Describe a map (DESIGN §13; PlanChatUI-B5): his prose about one place becomes one `lre-map-v1` map, which the job's agent proposes
// through `world_propose`. It is given the map's id and place, the places in and around it, his prose and the published JSON Schema
// (`mapGiven`); each map it proposes is checked against the schema and the map lint on the draft, and the problems are answered to it to
// fix. The last map it proposed comes back as the job's one proposal, which Build previews and applies on his press. Moved from the
// previous extension's `map-job.ts`; its prompt and example are the agent's definition now.

import { type Say, sayOr } from "./checks";
import type { MapId, PlaceId } from "../../shared/ids";
import type { JsonObject, JsonValue } from "../../shared/json";
import { hasOwn, isRecord } from "../../shared/json";
import type { JobProposal } from "../../shared/jobs";
import { MAP_SCHEMA, mapProblems, readMap, type MapProblem } from "../../shared/maps";
import { pathText } from "../../shared/schema-check";
import type { MapDoc, WorldDoc } from "../../shared/world";
import { say } from "../../engine/lines";

const MAP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface MapRequest {
  scope: PlaceId;
  mapId: MapId;
  prose: string;
}

/** A job's input as a request: a place the world has, an id for the map (by default `<scope>_map`), and the prose as the job kept it. */
export function readMapRequest(world: WorldDoc, input: JsonObject): MapRequest {
  const scope = typeof input.scope === "string" ? input.scope : "";
  if (!hasOwn(world.places, scope)) throw new Error("choose the place the map draws");
  const prose = typeof input.prose === "string" ? input.prose.trim() : "";
  if (prose === "") throw new Error("describe the place first");
  const given = typeof input.mapId === "string" ? input.mapId.trim() : "";
  const fallback = `${scope.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^[^A-Za-z0-9]+/, "")}_map`.slice(0, 64);
  const mapId = given !== "" ? given : fallback;
  if (!MAP_ID.test(mapId)) throw new Error("a map id is letters, digits, _ and -, starting with a letter or digit");
  return { scope, mapId, prose };
}

/** What the agent is given, as data: the map's id, the place it draws and the place that holds it, the places already inside it (their ids stay), every other place a link may name, his prose, and the map format's JSON Schema. */
export function mapGiven(world: WorldDoc, request: MapRequest): JsonObject {
  const place = world.places[request.scope];
  const named = (id: string): JsonObject => ({ id, name: world.places[id]?.name ?? id });
  return {
    mapId: request.mapId,
    place: named(request.scope),
    ...(place?.parent ? { inside: named(place.parent) } : {}),
    placesInside: Object.values(world.places)
      .filter((p) => p.parent === request.scope && p.map !== request.mapId)
      .map((p) => named(p.id)),
    otherPlaces: Object.keys(world.places)
      .filter((id) => id !== request.scope && world.places[id]?.parent !== request.scope)
      .sort(),
    prose: request.prose,
    schema: MAP_SCHEMA as unknown as JsonValue,
  };
}

export interface MapAnswer {
  /** The answer with the request's id and place in it, as checked. */
  value: JsonValue | null;
  map: MapDoc | null;
  problems: MapProblem[];
}

/** A proposed map read as the requested one: its id and place set, checked against the schema and the map lint on `world`. */
export function readMapAnswer(world: WorldDoc, request: MapRequest, reply: JsonValue | null): MapAnswer {
  if (!isRecord(reply)) return { value: reply, map: null, problems: [{ severity: "error", path: [], code: "map_shape", message: say("lint_should_be_one_map_object") }] };
  // A model sometimes wraps the map: {"map": {...}}.
  const raw = isRecord(reply.map) && reply.scope === undefined && reply.layout === undefined && reply.places === undefined ? reply.map : reply;
  const value: JsonObject = { ...raw, id: request.mapId, scope: request.scope };
  // Lint reads every map through the schema check, so the answer goes in as it is.
  const problems = mapProblems({ ...world, maps: { ...world.maps, [request.mapId]: value as unknown as MapDoc } }).get(request.mapId) ?? [];
  return { value, map: readMap(value).map, problems };
}

/** The map lint's problems, a line of Build's jobs part each (`map_problem`), the lint's own message in it. */
export function problemLines(problems: readonly MapProblem[], say: Say): string {
  return problems.map((p) => sayOr(say, "map_problem", { ...(p.path.length > 0 ? { at: pathText(p.path) } : {}), message: p.message })).join("\n");
}

/** The map as a proposal: ticked when it has no errors (lint warnings lower it a little), with what's left to fix in its note. */
export function mapProposal(request: MapRequest, answer: MapAnswer & { map: MapDoc }, say: Say): JobProposal {
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
    ...(answer.problems.length > 0 ? { note: `${sayOr(say, "map_check")}\n${problemLines(answer.problems, say)}` } : {}),
  };
}
