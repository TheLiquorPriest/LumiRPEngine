// Today's map tools kept (plan §8.2 l.1017, §6.8), found by `tool_search` beside the map tools:
// `world_map_place` (a place on a map, moved, renamed, opening onto another map, or taken off),
// `world_map_link` (a link between two places of a map, today's `opens` and paths), `world_map_settings`
// (what the map shows, the grid system, sight, travel) and `world_keep` (copying what this chat changed
// of its world into the world's draft, `keep.ts`). The first three write the chat's own draft of its
// world (`engine.world`, `world-draft.ts`): they play at once, go with the turn, and are the chat's alone
// until kept. A map the world draws is changed square by square (`map_edit`), a map laid in play is
// taken out with `map_lay`'s `remove`. Only what does not exist is refused, with what does; a
// call that leaves the map as it stands says so.

import type { JsonObject } from "rp-harness/contract";
import type { LedgerEvent } from "../../shared/ledger";
import { mapSettingsOf, TRAVEL_MODES } from "../../shared/maps";
import type { MapDoc, MapLinkDef, MapPlaceDef, MapSettings } from "../../shared/world";
import { SIGHT_MAX } from "../../shared/grid";
import { chatDraftOf, draftEvent, type DraftEdit } from "../../engine/world-draft";
import { readingOr } from "../fixed";
import { NUMBER, type Reply, type ToolSpec, TEXT, TEXTS, WHOLE, YES_NO } from "../kit";
import { find, isUnread, notOneOf, numberArg, textArg, type OpContext, type Unread } from "../ops";
import { textOf } from "../texts";
import { type WriteDef, writeTool } from "../families/run";
import { keepable, keepInDraft, type KeepOutcome } from "./keep";
import { idFrom } from "./lay";

const FAMILY = "map";
/** The ways a link may be travelled by a hand's call; `air` only aircraft take, over the routes a world authors for it. */
const LINK_MODES = TRAVEL_MODES.filter((m) => m !== "air");
const DISPLAYS = ["knowledge", "fog"] as const;

/** A name as it is matched: case and the spaces between words aside. */
const plain = (said: string): string => said.trim().replace(/\s+/g, " ").toLowerCase();

/** The maps of the world as this chat plays it. */
function mapsOf(o: OpContext): Readonly<Record<string, MapDoc>> {
  return o.reading.world.maps;
}

/** The map `said` names, by id or title (the call's `field`); or what says there is none, with the maps there are. */
function mapNamed(o: OpContext, field: string, said: string | undefined = textArg(o.args, field)): { id: string; map: MapDoc } | Unread {
  if (said === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: [field] } };
  const key = plain(said);
  const all = Object.entries(mapsOf(o));
  const hit = all.find(([id]) => id === said) ?? all.find(([id, m]) => plain(id) === key || plain(m.title ?? "") === key);
  if (hit !== undefined) return { id: hit[0], map: hit[1] };
  return { line: "no_map_named", fields: { n: o.n, op: o.op, map: said, maps: textOf(all.map(([id]) => id).slice(0, o.call.settings.nearMatches)) } };
}

/** Writes `edit` into the chat's draft of its world as this call's change; what says the engine would not have it, when it does not. */
function writeEdit(o: OpContext, edit: DraftEdit): Unread | undefined {
  const w = o.draft.w;
  const from = w.events.length;
  const bad = o.draft.applyAll([draftEvent(o.reading.doc, chatDraftOf(w.state), edit) as unknown as LedgerEvent]);
  if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
  o.draft.record(o.n, o.op, "engine", o.prov, from);
  return undefined;
}

/** `next` written as the map `id`; where it is the map as it stands, nothing is written and the answer says so. */
function putMap(o: OpContext, id: string, current: MapDoc, next: MapDoc, what: string, how: "made" | "changed" | "removed", members: readonly string[] = []): Unread | undefined {
  if (JSON.stringify(current) === JSON.stringify(next)) {
    o.reply.line("world_map_same", { what });
    return undefined;
  }
  const bad = writeEdit(o, { collection: "maps", id, value: next as unknown as JsonObject });
  if (bad) return bad;
  o.reply.line(how === "changed" ? "world_map_changed" : how === "removed" ? "world_map_removed" : "world_map_made", { what, members: textOf(members) });
  return undefined;
}

/** The arguments of the call that are given, of those that change something. */
function given(o: OpContext, fields: readonly string[]): string[] {
  return fields.filter((f) => o.args[f] !== undefined && o.args[f] !== null);
}

/** A whole number from 0 given as an argument; null where not given, an unread where it is not one. */
function fromZero(o: OpContext, field: string): number | null | Unread {
  const v = numberArg(o.args, field);
  if (v === undefined) return o.args[field] === undefined || o.args[field] === null ? null : { line: "unreadable_op", fields: { n: o.n, op: o.op, field, value: JSON.stringify(o.args[field]) } };
  return Number.isInteger(v) && v >= 0 ? v : { line: "unreadable_op", fields: { n: o.n, op: o.op, field, value: JSON.stringify(v) } };
}

// ---------------------------------------------------------------- world_map_place

const MAP_PLACE_ARGS = ["name", "x", "y", "opens"];

const mapPlace: WriteDef = {
  name: "world_map_place",
  family: FAMILY,
  lane: "engine",
  properties: { map: TEXT, place: TEXT, name: TEXT, id: TEXT, x: WHOLE, y: WHOLE, opens: TEXT, remove: YES_NO },
  required: ["map"],
  example: { map: "Thornbury", name: "Bluebird Coffee", x: 4, y: 3, source: { from: "prose", message: "m-0042" } },
  run(o) {
    const on = mapNamed(o, "map");
    if (isUnread(on)) return on;
    const { id: mapId, map } = on;
    const places = map.places ?? [];
    const nameOf = (p: MapPlaceDef): string => p.name ?? p.id;
    const said = textArg(o.args, "place");
    const current = said === undefined ? undefined : (places.find((p) => p.id === said) ?? places.find((p) => plain(p.id) === plain(said) || plain(nameOf(p)) === plain(said)));
    if (said !== undefined && current === undefined) return { line: "no_map_place", fields: { n: o.n, op: o.op, map: mapId, name: said, places: textOf(places.map((p) => p.id)) } };
    const about = (p: MapPlaceDef): string => o.call.lines.line("a_map_place", { name: nameOf(p), id: p.id, map: mapId }) ?? p.id;
    if (o.args.remove === true) {
      if (current === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["place"] } };
      // A link to a place the map no longer has leads nowhere: it goes with the place.
      const next: MapDoc = { ...map, places: places.filter((p) => p !== current), ...(map.links ? { links: map.links.filter((l) => l.from !== current.id && l.to !== current.id) } : {}) };
      return putMap(o, mapId, map, next, about(current), "removed");
    }
    const name = textArg(o.args, "name");
    const givenId = textArg(o.args, "id");
    if (current === undefined && name === undefined && givenId === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["name"] } };
    const id = current?.id ?? givenId ?? idFrom(name ?? "");
    const x = fromZero(o, "x");
    if (isUnread(x)) return x;
    const y = fromZero(o, "y");
    if (isUnread(y)) return y;
    const px = x ?? current?.at?.[0];
    const py = y ?? current?.at?.[1];
    if ((x !== null || y !== null) && (px === undefined || py === undefined)) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["x", "y"] } };
    const opensSaid = textArg(o.args, "opens");
    const opens = opensSaid === undefined ? null : mapNamed(o, "opens", opensSaid);
    if (opens !== null && isUnread(opens)) return opens;
    const placed: MapPlaceDef = { ...(current ?? { id }), ...(name !== undefined ? { name } : {}), ...((x !== null || y !== null) && px !== undefined && py !== undefined ? { at: [px, py] as [number, number] } : {}), ...(opens !== null ? { opens: opens.id } : {}) };
    const next: MapDoc = { ...map, places: current ? places.map((p) => (p === current ? placed : p)) : [...places, placed] };
    return putMap(o, mapId, map, next, about(placed), current ? "changed" : "made", given(o, MAP_PLACE_ARGS));
  },
};

// ---------------------------------------------------------------- world_map_link

const mapLink: WriteDef = {
  name: "world_map_link",
  family: FAMILY,
  lane: "engine",
  properties: { map: TEXT, from: TEXT, to: TEXT, mode: { type: "string", enum: [...LINK_MODES] }, minutes: NUMBER, one_way: YES_NO, remove: YES_NO },
  required: ["map", "from", "to"],
  example: { map: "Thornbury", from: "Market Square", to: "The Lamp and Ladle", minutes: 3, source: { from: "prose", message: "m-0042" } },
  run(o) {
    const on = mapNamed(o, "map");
    if (isUnread(on)) return on;
    const { id: mapId, map } = on;
    const from = find(o, "from", "place");
    if (isUnread(from)) return from;
    const to = find(o, "to", "place");
    if (isUnread(to)) return to;
    const said = textArg(o.args, "mode");
    const mode = LINK_MODES.find((m) => m === said);
    if (said !== undefined && mode === undefined) return notOneOf(o, "mode", said, LINK_MODES);
    const links = map.links ?? [];
    const modeOf = (l: MapLinkDef): string => l.mode ?? "walk";
    const between = links.filter((l) => (l.from === from.id && l.to === to.id) || (l.from === to.id && l.to === from.id));
    const what = o.call.lines.line("a_map_link", { from: from.name, to: to.name, map: mapId }) ?? "";
    if (o.args.remove === true) {
      const gone = mode === undefined ? between : between.filter((l) => modeOf(l) === mode);
      if (gone.length === 0) return { line: "no_map_link", fields: { n: o.n, op: o.op, map: mapId, from: from.name, to: to.name, ...(mode !== undefined ? { mode } : {}), links: textOf(links.map((l) => `${l.from} - ${l.to} (${modeOf(l)})`)) } };
      return putMap(o, mapId, map, { ...map, links: links.filter((l) => !gone.includes(l)) }, what, "removed");
    }
    // Two places may have a link for each way of travelling: without a mode, the one there is, or the ways there are say which.
    if (mode === undefined && between.length > 1) return { line: "map_links_many", fields: { n: o.n, op: o.op, map: mapId, from: from.name, to: to.name, modes: textOf(between.map(modeOf)) } };
    const current = mode === undefined ? between[0] : between.find((l) => modeOf(l) === mode);
    const minutes = numberArg(o.args, "minutes");
    if (minutes !== undefined && !(minutes > 0)) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "minutes", value: JSON.stringify(minutes) } };
    const oneWay = typeof o.args.one_way === "boolean" ? o.args.one_way : undefined;
    let link: MapLinkDef;
    if (current !== undefined) {
      if (minutes === undefined && oneWay === undefined) return { line: "needs_any", fields: { n: o.n, op: o.op, fields: ["minutes", "one_way"] } };
      // Made one-way, a link runs as the call says, whichever way it ran; both ways is a link's own default, so it says nothing.
      link = { ...current, ...(oneWay === true ? { from: from.id, to: to.id, bidirectional: false } : {}), ...(minutes !== undefined ? { minutes } : {}) };
      if (oneWay === false) delete link.bidirectional;
    } else {
      if (minutes === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["minutes"] } };
      link = { from: from.id, to: to.id, ...(mode !== undefined ? { mode: mode as MapLinkDef["mode"] } : {}), minutes, ...(oneWay === true ? { bidirectional: false } : {}) };
    }
    const next: MapDoc = { ...map, links: current ? links.map((l) => (l === current ? link : l)) : [...links, link] };
    return putMap(o, mapId, map, next, what, current ? "changed" : "made", given(o, ["minutes", "one_way"]));
  },
};

// ---------------------------------------------------------------- world_map_settings

const SETTING_ARGS = ["display", "grid_movement", "sight_radius", "travel_simulation"];

const mapSettings: WriteDef = {
  name: "world_map_settings",
  family: FAMILY,
  lane: "engine",
  properties: { display: { type: "string", enum: [...DISPLAYS] }, grid_movement: YES_NO, sight_radius: { type: "integer", minimum: 0, maximum: SIGHT_MAX }, travel_simulation: YES_NO },
  required: [],
  example: { display: "fog", sight_radius: 6, source: { from: "prose", message: "m-0042" } },
  run(o) {
    const said = textArg(o.args, "display");
    const display = DISPLAYS.find((d) => d === said);
    if (said !== undefined && display === undefined) return notOneOf(o, "display", said, DISPLAYS);
    const sight = numberArg(o.args, "sight_radius");
    if (sight !== undefined && !(Number.isInteger(sight) && sight >= 0 && sight <= SIGHT_MAX)) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "sight_radius", value: JSON.stringify(sight) } };
    const movement = typeof o.args.grid_movement === "boolean" ? o.args.grid_movement : undefined;
    const simulation = typeof o.args.travel_simulation === "boolean" ? o.args.travel_simulation : undefined;
    const changes = given(o, SETTING_ARGS);
    if (changes.length === 0) return { line: "needs_any", fields: { n: o.n, op: o.op, fields: SETTING_ARGS } };
    // The settings as they play (a part left out or malformed is its default), with what the call gave; whatever else the world keeps there (its travel tuning) stays.
    const world = o.reading.world;
    const now = mapSettingsOf(world);
    const next = { ...world.mapSettings, display: display ?? now.display, grid: { movement: movement ?? now.grid.movement, sightRadius: sight ?? now.grid.sightRadius }, ...(simulation !== undefined ? { travelSimulation: simulation } : {}) } as MapSettings;
    const what = o.call.lines.line("the_map_settings", {}) ?? "";
    // Settings that play as they did are not written: a world without the part keeps none.
    if (JSON.stringify(mapSettingsOf({ mapSettings: next })) === JSON.stringify(now)) {
      o.reply.line("world_map_same", { what });
      return undefined;
    }
    const bad = writeEdit(o, { part: "mapSettings", value: next as unknown as JsonObject });
    if (bad) return bad;
    const then = mapSettingsOf({ mapSettings: next });
    o.reply.line("world_map_changed", { what, members: textOf(changes) });
    o.after(() => ({ settings: { display: then.display, grid_movement: then.grid.movement, sight_radius: then.grid.sightRadius, travel_simulation: then.travelSimulation === true } }));
    return undefined;
  },
};

// ---------------------------------------------------------------- world_keep

/** The words a call names to keep, as a list of texts (a text alone is one); null where it is neither. */
function namedList(args: JsonObject, field: string): string[] | null {
  const v = args[field];
  if (v === undefined || v === null) return [];
  if (typeof v === "string") return v.trim() === "" ? [] : [v];
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]).filter((x) => x.trim() !== "") : null;
}

/** The answer to a keep, as the map's lines say it. */
function keepAnswer(reply: Reply, out: KeepOutcome): void {
  if ("failed" in out) {
    reply.line(`keep_${out.failed}`, {});
    reply.fail();
    return;
  }
  const all = [...out.kept.maps.map((m) => `map ${m}`), ...out.kept.places.map((p) => `place ${p}`), ...out.kept.paths.map((p) => `path ${p}`), ...(out.kept.settings ? ["the map settings"] : [])];
  if (out.written) reply.line("keep_done", { kept: textOf(all), version: out.version });
  else reply.line("keep_nothing", {});
  for (const s of out.skipped) reply.line(`keep_${s.code}`, { id: s.id });
  reply.data({ kept: { maps: [...out.kept.maps], places: [...out.kept.places], paths: [...out.kept.paths], ...(out.kept.settings ? { settings: true } : {}) }, skipped: out.skipped.map((s) => ({ id: s.id, code: s.code })), draft: { version: out.version, written: out.written } });
}

const keep: ToolSpec = {
  name: "world_keep",
  family: FAMILY,
  tier: "write",
  lane: "engine",
  properties: { maps: TEXTS, places: TEXTS, paths: TEXTS, settings: YES_NO },
  required: [],
  example: { maps: ["The Far Road"], settings: true },
  async run(args, call) {
    const reply = call.reply();
    const r = readingOr(call, reply);
    if (r === null) return reply;
    const maps = namedList(args, "maps");
    const places = namedList(args, "places");
    const paths = namedList(args, "paths");
    for (const [field, list] of [["maps", maps], ["places", places], ["paths", paths]] as const) if (list === null) return reply.line("unreadable_op", { op: "world_keep", field, value: JSON.stringify(args[field]) }).fail();
    const settings = args.settings === true;
    const pick = { maps: maps ?? [], places: places ?? [], paths: paths ?? [], settings };
    // Nothing named: what this chat has changed that could be kept, so it can be named.
    if (pick.maps.length + pick.places.length + pick.paths.length === 0 && !settings) {
      const changes = keepable(r.doc, r.state.world).map((c) => `${c.kind} ${c.name ?? c.id}`);
      reply.line("keep_names", { changes: textOf(changes) });
      reply.data({ changed: changes });
      return reply;
    }
    const out = await call.deps.writes.run(() => keepInDraft(call.deps.store.worlds, r.doc, r.state.world, pick));
    keepAnswer(reply, out);
    return reply;
  },
};

/** Today's map tools, as RPH's search finds them (registered with the map tools, `maptools.ts`). */
export const TODAY_TOOLS: readonly ToolSpec[] = [writeTool(mapPlace), writeTool(mapLink), writeTool(mapSettings), keep];
