// The world built without hand-written JSON: a place, a path between two places, a map, what is on a
// map, and the map settings. Each tool reads the world where its call writes (`worldTarget`: this
// chat's own world unless `in` says the world's document), works out one write from its arguments (a
// whole place, route or map put back with only what the call gave changed; the map settings whole),
// and writes it there (`world-kit.ts`): in this chat's own world, staged with the turn and played at
// once; in the world's document, through the store's own path for an editor's writes, answered with
// what changed, the draft's version and the lint the write brought.
//
// What a map draws is the map's: a place or a route with a `map` is refused here as the store
// refuses it, with the tool that changes it in its map. A map is checked before it is written by
// the engine's own checks of one (`mapProblems`: the published schema, then the compiled world), so
// a write that would leave it wrong is refused with what they say and the world stays as it was.
//
// Places are named as the world the call writes has them (`placeIn`): this chat's own world plays
// what the world's draft doesn't hold, and the draft may hold a place the chat doesn't play.

import { TOOL_NOTE } from "../../../../shared/agent-tools";
import { SIGHT_MAX } from "../../../../shared/grid";
import { hashParts } from "../../../../shared/hash";
import { BUILD_NOTE, BUILD_TOOL } from "../../../../shared/harness-texts-build";
import { HARNESS_FAMILY } from "../../../../shared/harness-text-kit";
import { WORLD_NOTE } from "../../../../shared/harness-texts-world";
import type { PlaceVisibility, TravelMode } from "../../../../shared/ids";
import { hasOwn, type JsonObject, type JsonValue, safeKey } from "../../../../shared/json";
import { jsonEqual } from "../../../../shared/json-patch";
import { mapProblems, mapSettingsOf, nameOfId, TRAVEL_MODES } from "../../../../shared/maps";
import { pathText } from "../../../../shared/schema-check";
import type { MapCellDef, MapDisplay, MapDoc, MapLinkDef, MapPlaceDef, PlaceDef, RouteDef, WorldDoc } from "../../../../shared/world";
import { knownZone } from "../../../../engine/calendar";
import { own } from "../../../../engine/pack-kit";
import { placeKey } from "../../../../engine/place-names";
import { slug } from "../../../../engine/places-in-play";
import type { ToolOutcome } from "../../runtime";
import { boolArg, missing } from "../propose";
import { argGiven, badValue, integer, jsonObject, needText, objectArg, objectSchema, text, textArg } from "../schema";
import { type HarnessToolDefinition, number, words } from "./kit";
import { noTarget, WORLD_INS, type WorldTarget, worldTarget } from "./world-kit";

const boolean = (): JsonObject => ({ type: "boolean" });

const VISIBILITIES: readonly PlaceVisibility[] = ["public", "known_by", "secret", "discoverable"];
const DISPLAYS: readonly MapDisplay[] = ["knowledge", "fog"];
/** The modes a map's link takes: every one but `air`, which only a route authored for aircraft has (`lre-map-v1`). */
const LINK_MODES: readonly TravelMode[] = TRAVEL_MODES.filter((m) => m !== "air");
/** The mode of a link that names none, and so of a path that names none: the engine's own (`compileLinks`). */
const WALK: TravelMode = "walk";

const spaced = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The parts of a target a refusal is worded with: its view, its turn's settings, and which world it writes. */
type Said = Pick<WorldTarget, "view" | "turn" | "in">;

/**
 * `items` as a refusal lists them: as many as fit in half of what one tool result may hold
 * (Settings → Agents, Tool results clipped past; as `lintLines` fits its issues), then how many more.
 */
function fitted(t: Said, items: readonly string[]): string[] {
  const room = Math.floor(t.turn.settings.agents.clipChars / 2);
  const shown: string[] = [];
  let used = 0;
  for (const item of items) {
    used += item.length + 2;
    if (used > room && shown.length > 0) break;
    shown.push(item);
  }
  const more = items.length - shown.length;
  return more > 0 ? [...shown, t.view.text(BUILD_NOTE.moreIds, { count: String(more) })] : shown;
}

/** Ids on one line, for a refusal that says what to choose from. */
function listed(t: Said, ids: readonly string[]): string {
  return ids.length === 0 ? t.view.text(BUILD_NOTE.none) : fitted(t, ids).join(", ");
}

/** Where a refusal says it looked: this chat's world, or the world's draft. */
function where(t: Said): string {
  return t.view.text(t.in === "chat" ? BUILD_NOTE.inChat : BUILD_NOTE.inDocument);
}

/**
 * The place of the target's world `said` names: by its id, its id in any case, else its exact name
 * (case, spaces and a leading article aside); or the refusal, which lists that world's places. It is
 * read as compiled, so a place a map draws is found too.
 */
function placeIn(t: Said, doc: WorldDoc, said: string): string | ToolOutcome {
  if (hasOwn(doc.places, said)) return said;
  const lower = said.toLowerCase();
  const rules: ((p: PlaceDef) => boolean)[] = [(p) => p.id.toLowerCase() === lower, (p) => spaced(p.name) === spaced(said) || (placeKey(p.name) !== "" && placeKey(p.name) === placeKey(said))];
  for (const rule of rules) {
    const found = Object.values(doc.places).filter(rule);
    const [one] = found;
    if (one && found.length === 1) return one.id;
    if (found.length > 1) return t.view.refuse(TOOL_NOTE.ambiguous, { name: said, matches: found.map((p) => `${p.name} (${p.id})`).join("; ") });
  }
  return t.view.refuse(BUILD_NOTE.noPlace, { name: said, where: where(t), places: listed(t, Object.keys(doc.places).sort()) });
}

/** The target's place an argument the tool can't do without names, or the refusal. */
function needPlace(t: Said, doc: WorldDoc, tool: string, args: JsonObject, key: string): string | ToolOutcome {
  const said = needText(t.view, tool, args, key);
  return typeof said !== "string" ? said : placeIn(t, doc, said);
}

/** The id of the target's map `said` names: its id, its id in any case, else its title; or the refusal, which lists that world's maps. */
function mapIn(t: Said, doc: WorldDoc, said: string): string | ToolOutcome {
  const ids = Object.keys(doc.maps);
  const id = hasOwn(doc.maps, said) ? said : (ids.find((m) => m.toLowerCase() === said.toLowerCase()) ?? ids.find((m) => spaced(doc.maps[m]?.title ?? "") === spaced(said)));
  return id ?? t.view.refuse(BUILD_NOTE.noMap, { map: said, where: where(t), maps: listed(t, ids.sort()) });
}

/** The target's map a call's `map` names, with its id; or the refusal. */
function needMap(t: Said, doc: WorldDoc, tool: string, args: JsonObject): { id: string; map: MapDoc } | ToolOutcome {
  const said = needText(t.view, tool, args, "map");
  if (typeof said !== "string") return said;
  const id = mapIn(t, doc, said);
  if (typeof id !== "string") return id;
  const map = own(doc.maps, id);
  return map ? { id, map } : t.view.refuse(BUILD_NOTE.noMap, { map: said, where: where(t), maps: listed(t, Object.keys(doc.maps).sort()) });
}

/** A number a call gave, a numeric text read as one: null when it is left out, NaN when it is no number. */
function numberArg(args: JsonObject, key: string): number | null {
  if (!argGiven(args, key)) return null;
  const v = args[key];
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : Number.NaN;
}

/** Whether a number argument was answered with a refusal instead of read. */
function refusedArg(n: number | null | ToolOutcome): n is ToolOutcome {
  return typeof n === "object" && n !== null;
}

/** A number above 0 (minutes, kilometres, metres), null when left out; or the refusal. */
function positiveArg(t: Said, tool: string, args: JsonObject, key: string): number | null | ToolOutcome {
  const n = numberArg(args, key);
  return n === null || n > 0 ? n : t.view.refuse(BUILD_NOTE.needsPositive, { tool, arg: key, value: String(args[key]) });
}

/** A whole number, 0 or above (a size, a position), null when left out; or the refusal. */
function wholeArg(t: Said, tool: string, args: JsonObject, key: string): number | null | ToolOutcome {
  const n = numberArg(args, key);
  return n === null || (Number.isInteger(n) && n >= 0) ? n : t.view.refuse(BUILD_NOTE.needsWhole, { tool, arg: key, value: String(args[key]) });
}

/**
 * What the engine's own checks of a map say against `map` as the map `id` of the target's world:
 * the errors it would have (the schema's, then what the compiled world says of it) that it doesn't
 * have now, as a refusal; null when the write brings none. Errors the map already had stay its own.
 */
function mapRefusal(t: Said, doc: WorldDoc, id: string, map: MapDoc): ToolOutcome | null {
  const errors = (world: WorldDoc): { at: string; message: string; key: string }[] => (mapProblems(world).get(id) ?? []).filter((p) => p.severity === "error").map((p) => ({ at: pathText(p.path), message: p.message, key: `${p.code}\u0000${p.message}` }));
  const had = new Set(errors(doc).map((p) => p.key));
  const brought = errors({ ...doc, maps: { ...doc.maps, [id]: map } }).filter((p) => !had.has(p.key));
  if (brought.length === 0) return null;
  return t.view.refuse(BUILD_NOTE.badMap, { map: id, problems: fitted(t, brought.map((p) => (p.at === "" ? p.message : `${p.at}: ${p.message}`))).map((line) => `- ${line}`).join("\n") });
}

/** The arguments among `keys` a call gave: what a change's answer says it changed, and none when it gave nothing to change. */
function given(args: JsonObject, keys: readonly string[]): string[] {
  return keys.filter((k) => argGiven(args, k));
}

const PLACE_ARGS = ["name", "parent", "scene", "time_zone", "visibility", "description", "fields"] as const;
const LEG_ARGS = ["mode", "minutes", "km", "terrain"] as const;
const MAP_ARGS = ["scope", "title", "width", "height", "layout", "legend", "cell_meters"] as const;
const MAP_PLACE_ARGS = ["name", "x", "y", "opens"] as const;
const SETTING_ARGS = ["display", "grid_movement", "sight_radius", "travel_simulation"] as const;

export const WORLD_BUILD_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: BUILD_TOOL.place,
    family: HARNESS_FAMILY.world,
    tier: "write",
    parameters: () => objectSchema({ place: text(), name: text(), id: text(), parent: text(), scene: text(), time_zone: text(), visibility: text(VISIBILITIES), description: text(), fields: jsonObject(), remove: boolean(), in: text(WORLD_INS) }),
    async run(args, env) {
      const tool = BUILD_TOOL.place;
      const t = await worldTarget(env, tool, args);
      if (noTarget(t)) return t;
      const { view, doc } = t;
      const said = textArg(args, "place");
      let current: PlaceDef | undefined;
      if (said !== null) {
        const found = placeIn(t, doc, said);
        if (typeof found !== "string") return found;
        current = own(doc.places, found);
        if (current?.map !== undefined) return view.refuse(BUILD_NOTE.placeOfMap, { name: current.name, id: current.id, map: current.map });
      }
      if (boolArg(args, "remove") === true) {
        if (!current) return missing(view, tool, "place");
        return t.remove("places", current.id, view.text(BUILD_NOTE.removed, { what: view.text(BUILD_NOTE.aPlace, { name: current.name, id: current.id }) }), { place: current.id });
      }
      const name = textArg(args, "name");
      const givenId = textArg(args, "id");
      if (current && givenId !== null && givenId !== current.id) return view.refuse(BUILD_NOTE.keepsId, { name: current.name, id: current.id });
      if (!current && name === null) return missing(view, tool, "name");
      const id = current?.id ?? givenId ?? slug(name ?? "");
      if (!current) {
        // Made from the name, the id is no one's choice: a place of that name is the one meant, not a second one.
        const twin = givenId === null ? Object.values(doc.places).find((p) => spaced(p.name) === spaced(name ?? "")) : undefined;
        if (twin) return view.refuse(BUILD_NOTE.placeExists, { name: twin.name, id: twin.id });
        const holder = own(doc.places, id);
        if (holder) return view.refuse(BUILD_NOTE.idTaken, { id, by: view.text(BUILD_NOTE.aPlace, { name: holder.name, id }), arg: "place" });
      }
      const changes = given(args, PLACE_ARGS);
      if (current && changes.length === 0) return view.refuse(BUILD_NOTE.nothing, { tool, args: PLACE_ARGS.join(", ") });
      const shown = name ?? current?.name ?? id;
      const parentSaid = textArg(args, "parent");
      let parent = current?.parent;
      if (parentSaid !== null) {
        const found = placeIn(t, doc, parentSaid);
        if (typeof found !== "string") return found;
        // Up from the parent through the places it is inside: reaching this place closes a loop.
        let at: string | undefined = found;
        for (let guard = Object.keys(doc.places).length; at !== undefined && guard >= 0; guard--) {
          if (at === id) return view.refuse(BUILD_NOTE.parentLoop, { parent: parentSaid, place: shown });
          at = own(doc.places, at)?.parent;
        }
        parent = found;
      }
      const scene = textArg(args, "scene");
      if (scene !== null && !hasOwn(doc.time.sceneTicks, scene)) return badValue(view, tool, "scene", scene, Object.keys(doc.time.sceneTicks));
      const zone = textArg(args, "time_zone");
      if (zone !== null && !knownZone(zone)) return view.refuse(BUILD_NOTE.badZone, { zone });
      const shownTo = textArg(args, "visibility");
      const visibility = VISIBILITIES.find((v) => v === shownTo) ?? null;
      if (shownTo !== null && visibility === null) return badValue(view, tool, "visibility", shownTo, VISIBILITIES);
      const fields: JsonObject = { ...(current?.fields ?? {}) };
      if (argGiven(args, "fields")) {
        const set = objectArg(args, "fields");
        if (!set) return view.refuse(BUILD_NOTE.badJson, { tool, arg: "fields" });
        for (const [field, value] of Object.entries(set)) {
          if (value === null) delete fields[field];
          else fields[field] = value;
        }
      }
      const description = textArg(args, "description");
      if (description !== null) fields.description = description;
      const next: PlaceDef = {
        ...(current ?? { id, name: shown }),
        ...(name !== null ? { name } : {}),
        ...(parent !== undefined ? { parent } : {}),
        ...(scene !== null ? { sceneType: scene } : {}),
        ...(zone !== null ? { timeZone: zone } : {}),
        ...(visibility !== null ? { visibility } : {}),
        fields,
      };
      const what = view.text(BUILD_NOTE.aPlace, { name: next.name, id });
      return t.put("places", id, next, current ? view.text(BUILD_NOTE.changed, { what, members: changes.join(", ") }) : view.text(BUILD_NOTE.made, { what }), { place: id });
    },
  },
  {
    name: BUILD_TOOL.path,
    family: HARNESS_FAMILY.world,
    tier: "write",
    parameters: () => objectSchema({ from: text(), to: text(), mode: text(TRAVEL_MODES), minutes: number(), km: number(), terrain: text(), one_way: boolean(), remove: boolean(), in: text(WORLD_INS) }, ["from", "to"]),
    async run(args, env) {
      const tool = BUILD_TOOL.path;
      const t = await worldTarget(env, tool, args);
      if (noTarget(t)) return t;
      const { view, doc } = t;
      const from = needPlace(t, doc, tool, args, "from");
      if (typeof from !== "string") return from;
      const to = needPlace(t, doc, tool, args, "to");
      if (typeof to !== "string") return to;
      const nameOf = (id: string): string => own(doc.places, id)?.name ?? id;
      if (from === to) return view.refuse(BUILD_NOTE.sameEnds, { name: nameOf(from) });
      const said = textArg(args, "mode");
      const mode = TRAVEL_MODES.find((m) => m === said) ?? null;
      if (said !== null && mode === null) return badValue(view, tool, "mode", said, TRAVEL_MODES);
      const between = Object.values(doc.routes)
        .filter((r) => (r.from === from && r.to === to) || (r.from === to && r.to === from))
        .sort((a, b) => a.id.localeCompare(b.id));
      const route = between.find((r) => r.map === undefined);
      const drawn = between.find((r) => r.map !== undefined);
      // The way between them is a map's link: a second, authored one beside it would double it.
      if (!route && drawn?.map !== undefined) return view.refuse(BUILD_NOTE.routeOfMap, { from, to, map: drawn.map });
      if (boolArg(args, "remove") === true) {
        if (!route) {
          const others = Object.values(doc.routes).flatMap((r) => (r.from === from ? [r.to] : r.to === from ? [r.from] : []));
          return view.refuse(BUILD_NOTE.noPath, { from, to, others: listed(t, [...new Set(others)].sort()) });
        }
        const extra = { route: route.id };
        const names = { from: nameOf(route.from), to: nameOf(route.to), id: route.id };
        const modes = { ...route.modes };
        if (mode !== null) {
          if (!modes[mode]) return view.refuse(BUILD_NOTE.noPathMode, { from, to, mode, modes: listed(t, Object.keys(modes)) });
          delete modes[mode];
        }
        // A route with no way left to travel it is no path: its last mode takes the route with it.
        if (mode === null || Object.keys(modes).length === 0) return t.remove("routes", route.id, view.text(BUILD_NOTE.removed, { what: view.text(BUILD_NOTE.aPath, names) }), extra);
        return t.put("routes", route.id, { ...route, modes }, view.text(BUILD_NOTE.removed, { what: view.text(BUILD_NOTE.aPathMode, { ...names, mode }) }), extra);
      }
      const oneWay = boolArg(args, "one_way");
      const changes = given(args, [...LEG_ARGS, "one_way"]);
      if (route && changes.length === 0) return view.refuse(BUILD_NOTE.nothing, { tool, args: [...LEG_ARGS, "one_way"].join(", ") });
      const minutes = positiveArg(t, tool, args, "minutes");
      if (refusedArg(minutes)) return minutes;
      const km = positiveArg(t, tool, args, "km");
      if (refusedArg(km)) return km;
      const terrain = textArg(args, "terrain");
      // A one-way route that runs against the call would take the new way of travelling the wrong way round.
      if (route && !route.bidirectional && route.from === to && oneWay === null) return view.refuse(BUILD_NOTE.otherWay, { from, to });
      const modes = { ...(route?.modes ?? {}) };
      if (!route || given(args, LEG_ARGS).length > 0) {
        const key = mode ?? WALK;
        const leg = modes[key];
        const takes = minutes ?? leg?.minutes;
        if (takes === undefined) return missing(view, tool, "minutes");
        modes[key] = { ...leg, minutes: takes, ...(km !== null ? { distanceKm: km } : {}), ...(terrain !== null ? { terrain } : {}) };
      }
      let id = route?.id ?? `rt_${from}_${to}`;
      if (!route) {
        // Two long ids make one the store refuses: a digest of the ends stands for them.
        if (!safeKey(id)) id = `rt_${hashParts("lre.route", from, to).slice(0, 12)}`;
        const base = id;
        for (let n = 2; hasOwn(doc.routes, id); n++) id = `${base}_${n}`;
      }
      // Made one-way, a route runs as the call says, whichever way it ran.
      const next: RouteDef = route ? { ...route, ...(oneWay === true ? { from, to } : {}), modes, bidirectional: oneWay === null ? route.bidirectional : !oneWay } : { id, from, to, modes, bidirectional: oneWay !== true };
      const what = view.text(BUILD_NOTE.aPath, { from: nameOf(next.from), to: nameOf(next.to), id });
      return t.put("routes", id, next, route ? view.text(BUILD_NOTE.changed, { what, members: changes.join(", ") }) : view.text(BUILD_NOTE.made, { what }), { route: id });
    },
  },
  {
    name: BUILD_TOOL.map,
    family: HARNESS_FAMILY.world,
    tier: "write",
    parameters: () => objectSchema({ map: text(), scope: text(), title: text(), width: integer({ minimum: 0 }), height: integer({ minimum: 0 }), layout: words(), legend: jsonObject(), cell_meters: number(), remove: boolean(), in: text(WORLD_INS) }),
    async run(args, env) {
      const tool = BUILD_TOOL.map;
      const t = await worldTarget(env, tool, args);
      if (noTarget(t)) return t;
      const { view, doc } = t;
      const said = textArg(args, "map");
      const found = said === null ? null : mapIn(t, doc, said);
      const current = typeof found === "string" ? own(doc.maps, found) : undefined;
      if (boolArg(args, "remove") === true) {
        if (found === null) return missing(view, tool, "map");
        if (typeof found !== "string") return found;
        return t.remove("maps", found, view.text(BUILD_NOTE.removed, { what: view.text(BUILD_NOTE.aMap, { id: found }) }), { map: found });
      }
      const scopeSaid = textArg(args, "scope");
      const scope = scopeSaid === null ? null : placeIn(t, doc, scopeSaid);
      if (scope !== null && typeof scope !== "string") return scope;
      const title = textArg(args, "title");
      let id: string;
      if (current && typeof found === "string") id = found;
      else {
        // A map named that the world doesn't have is a new one only with the place it draws: without one, the name is taken for a mistake.
        if (scope === null) return found !== null && typeof found !== "string" ? found : missing(view, tool, said === null && title === null ? "map" : "scope");
        if (said === null && title === null) return missing(view, tool, "map");
        id = said ?? slug(title ?? "");
        if (hasOwn(doc.maps, id)) return view.refuse(BUILD_NOTE.idTaken, { id, by: view.text(BUILD_NOTE.aMap, { id }), arg: "map" });
      }
      const changes = given(args, MAP_ARGS);
      if (current && changes.length === 0) return view.refuse(BUILD_NOTE.nothing, { tool, args: MAP_ARGS.join(", ") });
      const width = wholeArg(t, tool, args, "width");
      if (refusedArg(width)) return width;
      const height = wholeArg(t, tool, args, "height");
      if (refusedArg(height)) return height;
      const w = width ?? current?.size?.[0];
      const h = height ?? current?.size?.[1];
      if (w === undefined || h === undefined) {
        if (width !== null) return view.refuse(BUILD_NOTE.needsBoth, { tool, one: "width", other: "height" });
        if (height !== null) return view.refuse(BUILD_NOTE.needsBoth, { tool, one: "height", other: "width" });
      }
      const rows = args.layout;
      // Rows are kept as written: a space is a cell.
      const layout = argGiven(args, "layout") ? (Array.isArray(rows) && rows.length > 0 && rows.every((r): r is string => typeof r === "string") ? rows : null) : undefined;
      if (layout === null) return view.refuse(BUILD_NOTE.badRows);
      const legend: Record<string, MapCellDef> = { ...(current?.legend ?? {}) };
      if (argGiven(args, "legend")) {
        const set = objectArg(args, "legend");
        if (!set) return view.refuse(BUILD_NOTE.badJson, { tool, arg: "legend" });
        for (const [ch, cell] of Object.entries(set)) {
          if (cell === null) delete legend[ch];
          // Whether each is a cell a legend takes is the schema's to say (`mapRefusal`).
          else legend[ch] = cell as unknown as MapCellDef;
        }
      }
      const cellMeters = positiveArg(t, tool, args, "cell_meters");
      if (refusedArg(cellMeters)) return cellMeters;
      const next: MapDoc = {
        ...(current ?? { id, scope: scope ?? "" }),
        ...(scope !== null ? { scope } : {}),
        ...(title !== null ? { title } : {}),
        ...(w !== undefined && h !== undefined && (width !== null || height !== null) ? { size: [w, h] } : {}),
        ...(layout !== undefined ? { layout } : {}),
        ...(cellMeters !== null ? { cellMeters } : {}),
      };
      if (Object.keys(legend).length > 0) next.legend = legend;
      else delete next.legend;
      const refusal = mapRefusal(t, doc, id, next);
      if (refusal) return refusal;
      const what = view.text(BUILD_NOTE.aMap, { id });
      return t.put("maps", id, next, current ? view.text(BUILD_NOTE.changed, { what, members: changes.join(", ") }) : view.text(BUILD_NOTE.made, { what }), { map: id });
    },
  },
  {
    name: BUILD_TOOL.mapPlace,
    family: HARNESS_FAMILY.world,
    tier: "write",
    parameters: () => objectSchema({ map: text(), place: text(), name: text(), id: text(), x: integer({ minimum: 0 }), y: integer({ minimum: 0 }), opens: text(), remove: boolean(), in: text(WORLD_INS) }, ["map"]),
    async run(args, env) {
      const tool = BUILD_TOOL.mapPlace;
      const t = await worldTarget(env, tool, args);
      if (noTarget(t)) return t;
      const { view, doc } = t;
      const on = needMap(t, doc, tool, args);
      if ("text" in on) return on;
      const { map } = on;
      const places = map.places ?? [];
      const nameOf = (p: MapPlaceDef): string => p.name ?? nameOfId(p.id);
      const said = textArg(args, "place");
      const current = said === null ? undefined : (places.find((p) => p.id === said) ?? places.find((p) => p.id.toLowerCase() === said.toLowerCase()) ?? places.find((p) => spaced(nameOf(p)) === spaced(said)));
      if (said !== null && !current) return view.refuse(BUILD_NOTE.noMapPlace, { map: on.id, name: said, places: listed(t, places.map((p) => p.id)) });
      if (boolArg(args, "remove") === true) {
        if (!current) return missing(view, tool, "place");
        // A link to a place the map no longer has leads nowhere: it goes with the place.
        const next: MapDoc = { ...map, places: places.filter((p) => p !== current), ...(map.links ? { links: map.links.filter((l) => l.from !== current.id && l.to !== current.id) } : {}) };
        const refusal = mapRefusal(t, doc, on.id, next);
        if (refusal) return refusal;
        return t.put("maps", on.id, next, view.text(BUILD_NOTE.removed, { what: view.text(BUILD_NOTE.aMapPlace, { name: nameOf(current), id: current.id, map: on.id }) }), { map: on.id, place: current.id });
      }
      const name = textArg(args, "name");
      const givenId = textArg(args, "id");
      if (current && givenId !== null && givenId !== current.id) return view.refuse(BUILD_NOTE.keepsId, { name: nameOf(current), id: current.id });
      if (!current && name === null && givenId === null) return missing(view, tool, "name");
      const id = current?.id ?? givenId ?? slug(name ?? "");
      const twin = current ? undefined : places.find((p) => p.id === id);
      if (twin) return view.refuse(BUILD_NOTE.idTaken, { id, by: view.text(BUILD_NOTE.aMapPlace, { name: nameOf(twin), id, map: on.id }), arg: "place" });
      const changes = given(args, MAP_PLACE_ARGS);
      if (current && changes.length === 0) return view.refuse(BUILD_NOTE.nothing, { tool, args: MAP_PLACE_ARGS.join(", ") });
      const x = wholeArg(t, tool, args, "x");
      if (refusedArg(x)) return x;
      const y = wholeArg(t, tool, args, "y");
      if (refusedArg(y)) return y;
      const px = x ?? current?.at?.[0];
      const py = y ?? current?.at?.[1];
      if (px === undefined || py === undefined) {
        if (x !== null) return view.refuse(BUILD_NOTE.needsBoth, { tool, one: "x", other: "y" });
        if (y !== null) return view.refuse(BUILD_NOTE.needsBoth, { tool, one: "y", other: "x" });
      }
      const opensSaid = textArg(args, "opens");
      const opens = opensSaid === null ? null : mapIn(t, doc, opensSaid);
      if (opens !== null && typeof opens !== "string") return opens;
      const placed: MapPlaceDef = { ...(current ?? { id }), ...(name !== null ? { name } : {}), ...(px !== undefined && py !== undefined && (x !== null || y !== null) ? { at: [px, py] } : {}), ...(opens !== null ? { opens } : {}) };
      const next: MapDoc = { ...map, places: current ? places.map((p) => (p === current ? placed : p)) : [...places, placed] };
      const refusal = mapRefusal(t, doc, on.id, next);
      if (refusal) return refusal;
      const what = view.text(BUILD_NOTE.aMapPlace, { name: nameOf(placed), id, map: on.id });
      return t.put("maps", on.id, next, current ? view.text(BUILD_NOTE.changed, { what, members: changes.join(", ") }) : view.text(BUILD_NOTE.made, { what }), { map: on.id, place: id });
    },
  },
  {
    name: BUILD_TOOL.mapLink,
    family: HARNESS_FAMILY.world,
    tier: "write",
    parameters: () => objectSchema({ map: text(), from: text(), to: text(), mode: text(LINK_MODES), minutes: number(), one_way: boolean(), remove: boolean(), in: text(WORLD_INS) }, ["map", "from", "to"]),
    async run(args, env) {
      const tool = BUILD_TOOL.mapLink;
      const t = await worldTarget(env, tool, args);
      if (noTarget(t)) return t;
      const { view, doc } = t;
      const on = needMap(t, doc, tool, args);
      if ("text" in on) return on;
      const { map } = on;
      const from = needPlace(t, doc, tool, args, "from");
      if (typeof from !== "string") return from;
      const to = needPlace(t, doc, tool, args, "to");
      if (typeof to !== "string") return to;
      if (from === to) return view.refuse(BUILD_NOTE.sameEnds, { name: own(doc.places, from)?.name ?? from });
      const said = textArg(args, "mode");
      const mode = LINK_MODES.find((m) => m === said) ?? null;
      if (said !== null && mode === null) return badValue(view, tool, "mode", said, LINK_MODES);
      const links = map.links ?? [];
      const modeOf = (l: MapLinkDef): TravelMode => l.mode ?? WALK;
      const between = links.filter((l) => (l.from === from && l.to === to) || (l.from === to && l.to === from));
      const extra = { map: on.id };
      const what = view.text(BUILD_NOTE.aLink, { from, to, map: on.id });
      if (boolArg(args, "remove") === true) {
        const gone = mode === null ? between : between.filter((l) => modeOf(l) === mode);
        if (gone.length === 0) return view.refuse(BUILD_NOTE.noLink, { map: on.id, from, to, mode: mode === null ? "" : ` (${mode})`, links: listed(t, links.map((l) => `${l.from} - ${l.to} (${modeOf(l)})`)) });
        const next: MapDoc = { ...map, links: links.filter((l) => !gone.includes(l)) };
        const refusal = mapRefusal(t, doc, on.id, next);
        if (refusal) return refusal;
        return t.put("maps", on.id, next, view.text(BUILD_NOTE.removed, { what }), extra);
      }
      if (mode === null && between.length > 1) return view.refuse(BUILD_NOTE.manyLinks, { map: on.id, from, to, modes: between.map(modeOf).join(", ") });
      const current = mode === null ? between[0] : between.find((l) => modeOf(l) === mode);
      const minutes = positiveArg(t, tool, args, "minutes");
      if (refusedArg(minutes)) return minutes;
      const oneWay = boolArg(args, "one_way");
      let link: MapLinkDef;
      if (current) {
        if (minutes === null && oneWay === null) return view.refuse(BUILD_NOTE.nothing, { tool, args: "minutes, one_way" });
        if (current.bidirectional === false && current.from === to && oneWay === null) return view.refuse(BUILD_NOTE.otherWay, { from, to });
        // Made one-way, a link runs as the call says, whichever way it ran; both ways is a link's own default, so it says nothing.
        link = { ...current, ...(oneWay === true ? { from, to, bidirectional: false } : {}), ...(minutes !== null ? { minutes } : {}) };
        if (oneWay === false) delete link.bidirectional;
      } else {
        if (minutes === null) return missing(view, tool, "minutes");
        link = { from, to, ...(mode !== null ? { mode } : {}), minutes, ...(oneWay === true ? { bidirectional: false } : {}) };
      }
      const next: MapDoc = { ...map, links: current ? links.map((l) => (l === current ? link : l)) : [...links, link] };
      const refusal = mapRefusal(t, doc, on.id, next);
      if (refusal) return refusal;
      return t.put("maps", on.id, next, current ? view.text(BUILD_NOTE.changed, { what, members: given(args, ["minutes", "one_way"]).join(", ") }) : view.text(BUILD_NOTE.made, { what }), extra);
    },
  },
  {
    name: BUILD_TOOL.mapSettings,
    family: HARNESS_FAMILY.world,
    tier: "write",
    parameters: () => objectSchema({ display: text(DISPLAYS), grid_movement: boolean(), sight_radius: integer({ minimum: 0, maximum: SIGHT_MAX }), travel_simulation: boolean(), in: text(WORLD_INS) }),
    async run(args, env) {
      const tool = BUILD_TOOL.mapSettings;
      const t = await worldTarget(env, tool, args);
      if (noTarget(t)) return t;
      const { view, doc } = t;
      const said = textArg(args, "display");
      const display = DISPLAYS.find((d) => d === said) ?? null;
      if (said !== null && display === null) return badValue(view, tool, "display", said, DISPLAYS);
      const movement = boolArg(args, "grid_movement");
      const simulation = boolArg(args, "travel_simulation");
      const sight = numberArg(args, "sight_radius");
      if (sight !== null && !(Number.isInteger(sight) && sight >= 0 && sight <= SIGHT_MAX)) return view.refuse(BUILD_NOTE.outOfRange, { tool, arg: "sight_radius", min: "0", max: String(SIGHT_MAX), value: String(args.sight_radius) });
      const gave = { display, grid_movement: movement, sight_radius: sight, travel_simulation: simulation };
      const changes = SETTING_ARGS.filter((k) => gave[k] !== null);
      if (changes.length === 0) return view.refuse(BUILD_NOTE.nothing, { tool, args: SETTING_ARGS.join(", ") });
      // The settings as they play (a part left out or malformed is its default), with what the call
      // gave; whatever else the world keeps there (its travel tuning) stays.
      const now = mapSettingsOf(doc);
      const next = { ...doc.mapSettings, display: display ?? now.display, grid: { movement: movement ?? now.grid.movement, sightRadius: sight ?? now.grid.sightRadius }, ...(simulation !== null ? { travelSimulation: simulation } : {}) };
      const then = mapSettingsOf({ mapSettings: next });
      const extra = { settings: { display: then.display, grid_movement: then.grid.movement, sight_radius: then.grid.sightRadius, travel_simulation: then.travelSimulation === true } };
      // Settings that play as they did are not written: a world without the part keeps none.
      if (jsonEqual(then, now)) return t.same(extra);
      return t.settings(next as unknown as JsonObject, view.text(BUILD_NOTE.changed, { what: view.text(BUILD_NOTE.settings), members: changes.join(", ") }), extra);
    },
  },
];
