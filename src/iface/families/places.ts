// Places (the skill `places-and-maps`): the three searchable tools that keep the world's places and the ways between them as play goes.
// `place_label` gives a place a new name or other names; `place_remove` takes a place out (one made in play, or one of the world's own,
// marked gone in the chat's draft); `world_path` lays, changes or takes out a way between two places, with minutes and distance per way
// of travel, in the chat's draft. Each keeps today's name and today's logic and is tied to the turn, so a swipe takes it away. What
// they refuse is what the engine would (a name a place beside it goes by, a place that is not empty, a way a map draws); what does not
// add up is reported, and a place or way that is not there is answered with its near names.

import type { JsonObject } from "rp-harness/contract";
import { hashParts } from "../../shared/hash";
import { hasOwn, safeKey } from "../../shared/json";
import { TRAVEL_MODES } from "../../shared/maps";
import type { RouteDef, RouteLeg } from "../../shared/world";
import { own } from "../../engine/pack-kit";
import { baseWorld, findPlaces, madeOf, placeOp } from "../../engine/places-in-play";
import { placeOfEntity, placeWithin } from "../../engine/scope";
import { chatDraftOf, draftEvent } from "../../engine/world-draft";
import { oneOf, TEXT, TEXTS, YES_NO } from "../kit";
import { find, isUnread, notAs, notOneOf, type OpContext, refusedAs, textArg, type Unread } from "../ops";
import { isAlready, notApplicable, type WriteDef, writeTool } from "./run";

const FAMILY = "places";

/** A place's other names as a call gives them, trimmed, none empty, each once and none the place's own name. */
function aliasesOf(o: OpContext, name: string): string[] | Unread | undefined {
  const given = o.args.aliases;
  if (given === undefined || given === null) return undefined;
  if (!Array.isArray(given) || !given.every((a) => typeof a === "string")) return notAs(o, "aliases", given, "names");
  const seen = new Set<string>([name.toLowerCase()]);
  return given.map((a) => String(a).trim()).filter((a) => a !== "" && !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()) !== undefined);
}

const label: WriteDef = {
  name: "place_label",
  family: FAMILY,
  lane: "engine",
  properties: { place: TEXT, name: TEXT, aliases: TEXTS },
  required: ["place"],
  example: { place: "The Cellar", name: "The Wine Cellar", aliases: ["the vault"] },
  run(o) {
    const place = find(o, "place", "place");
    if (isUnread(place)) return place;
    const w = o.draft.w;
    const def = own(w.ctx.world.places, place.id);
    if (!def) return refusedAs(o, { code: "missing_place", reason: `no place ${place.id}` }, "place", "place");
    const name = textArg(o.args, "name");
    const aliases = aliasesOf(o, name ?? def.name);
    if (isUnread(aliases)) return aliases;
    if (name === undefined && aliases === undefined) return { line: "needs_any", fields: { n: o.n, op: o.op, fields: ["name", "aliases"] } };
    const from = w.events.length;
    if (madeOf(def) !== null) {
      // A place made in play: today's place op, which finds a place of that name beside it first.
      const out = placeOp(w.ctx, { do: "label", place: place.id, ...(name !== undefined ? { name } : {}), ...(aliases !== undefined ? { aliases } : {}) }, { by: o.call.agent.definition, salt: o.draft.seed(o.n), advise: true });
      if ("code" in out) {
        if (!isAlready(out.code)) return notApplicable(o, out.code);
        o.reply.line("already_so", { n: o.n, op: o.op, what: def.name });
        return undefined;
      }
      const bad = o.draft.applyAll(out.events);
      if (bad) return refusedAs(o, bad, "place", "place");
    } else {
      // One of the world's own places: its names, in the chat's draft of its world.
      const next = name ?? def.name;
      const fields: JsonObject = { ...def.fields };
      if (aliases !== undefined) {
        if (aliases.length === 0) delete fields.aliases;
        else fields.aliases = aliases;
      }
      for (const said of [next, ...(aliases ?? [])]) {
        const other = findPlaces(w.ctx, said, { ...(def.parent !== undefined ? { parent: def.parent } : {}) }).find((h) => h.id !== place.id && h.matched !== "head");
        if (other) return notApplicable(o, "exists");
      }
      const bad = o.draft.applyAll([draftEvent(baseWorld(w.ctx.world), chatDraftOf(w.state), { collection: "places", id: place.id, value: { ...(def as unknown as JsonObject), name: next, fields } })]);
      if (bad) return refusedAs(o, bad, "place", "place");
    }
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

const remove: WriteDef = {
  name: "place_remove",
  family: FAMILY,
  lane: "engine",
  properties: { place: TEXT },
  required: ["place"],
  example: { place: "The Loft" },
  run(o) {
    const place = find(o, "place", "place");
    if (isUnread(place)) return place;
    const w = o.draft.w;
    const def = own(w.ctx.world.places, place.id);
    if (!def) return refusedAs(o, { code: "gone", reason: `no place ${place.id}` }, "place", "place");
    const from = w.events.length;
    if (madeOf(def) !== null) {
      const out = placeOp(w.ctx, { do: "remove", place: place.id }, { by: o.call.agent.definition, salt: o.draft.seed(o.n) });
      if ("code" in out) return notApplicable(o, out.code);
      const bad = o.draft.applyAll(out.events);
      if (bad) return refusedAs(o, bad, "place", "place");
    } else {
      // One of the world's own, marked gone in the chat's draft, once nothing and no place is in it.
      const inside = Object.values(w.ctx.world.places).some((p) => p.parent === place.id) || Object.keys(w.state.entities).some((e) => placeWithin(w.ctx.world, placeOfEntity(w.state, e), place.id));
      if (inside) return notApplicable(o, "occupied");
      const bad = o.draft.applyAll([draftEvent(baseWorld(w.ctx.world), chatDraftOf(w.state), { collection: "places", id: place.id, gone: true })]);
      if (bad) return refusedAs(o, bad, "place", "place");
    }
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

/** A number a call gives that must be above 0, or none. */
function positive(o: OpContext, field: string): number | Unread | undefined {
  const v = o.args[field];
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : notAs(o, field, v, "positive");
}

const path: WriteDef = {
  name: "world_path",
  family: FAMILY,
  lane: "engine",
  properties: { from: TEXT, to: TEXT, mode: oneOf(TRAVEL_MODES), minutes: { type: "number" }, km: { type: "number" }, terrain: TEXT, one_way: YES_NO, remove: YES_NO },
  required: ["from", "to"],
  example: { from: "Market Square", to: "The Far Road", mode: "walk", minutes: 20, km: 1.6 },
  run(o) {
    const from = find(o, "from", "place");
    if (isUnread(from)) return from;
    const to = find(o, "to", "place");
    if (isUnread(to)) return to;
    const w = o.draft.w;
    const nameOf = (id: string): string => own(w.ctx.world.places, id)?.name ?? id;
    if (from.id === to.id) return { line: "same_ends", fields: { n: o.n, op: o.op, name: nameOf(from.id) } };
    const mode = textArg(o.args, "mode");
    if (mode !== undefined && !TRAVEL_MODES.some((m) => m === mode)) return notOneOf(o, "mode", mode, TRAVEL_MODES);
    const between = Object.values(w.ctx.world.routes)
      .filter((r) => (r.from === from.id && r.to === to.id) || (r.from === to.id && r.to === from.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    const route = between.find((r) => r.map === undefined);
    const drawn = between.find((r) => r.map !== undefined);
    // The way between them is a map's link: a second one beside it would double it.
    if (route === undefined && drawn?.map !== undefined) return { line: "route_of_map", fields: { n: o.n, op: o.op, from: nameOf(from.id), to: nameOf(to.id), map: drawn.map } };
    const events = o.draft;
    const start = w.events.length;
    const edit = (id: string, value: RouteDef | null): Unread | undefined => {
      const bad = events.applyAll([draftEvent(baseWorld(w.ctx.world), chatDraftOf(w.state), value === null ? { collection: "routes", id, gone: true } : { collection: "routes", id, value: value as unknown as JsonObject })]);
      return bad ? refusedAs(o, bad, "from", "place") : undefined;
    };
    if (o.args.remove === true) {
      if (route === undefined) {
        const others = [...new Set(Object.values(w.ctx.world.routes).flatMap((r) => (r.from === from.id ? [r.to] : r.to === from.id ? [r.from] : [])))].sort().map(nameOf);
        return { line: "no_path", fields: { n: o.n, op: o.op, from: nameOf(from.id), to: nameOf(to.id), others: others.join(", ") } };
      }
      const modes = { ...route.modes };
      if (mode !== undefined) {
        if (!hasOwn(modes, mode)) return { line: "no_path_mode", fields: { n: o.n, op: o.op, from: nameOf(from.id), to: nameOf(to.id), mode, modes: Object.keys(modes).join(", ") } };
        delete modes[mode as keyof typeof modes];
      }
      // A route with no way left to travel it is no path: its last mode takes the route with it.
      const failed = mode === undefined || Object.keys(modes).length === 0 ? edit(route.id, null) : edit(route.id, { ...route, modes });
      if (failed) return failed;
    } else {
      const minutes = positive(o, "minutes");
      if (isUnread(minutes)) return minutes;
      const km = positive(o, "km");
      if (isUnread(km)) return km;
      const terrain = textArg(o.args, "terrain");
      const oneWay = typeof o.args.one_way === "boolean" ? o.args.one_way : undefined;
      if (route !== undefined && minutes === undefined && km === undefined && terrain === undefined && oneWay === undefined) return { line: "needs_any", fields: { n: o.n, op: o.op, fields: ["minutes", "km", "terrain", "one_way"] } };
      const modes: RouteDef["modes"] = { ...(route?.modes ?? {}) };
      const key = (mode ?? "walk") as keyof typeof modes;
      const leg: RouteLeg | undefined = modes[key];
      const takes = minutes ?? leg?.minutes;
      if (takes === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["minutes"] } };
      if (minutes !== undefined || km !== undefined || terrain !== undefined || route === undefined) modes[key] = { ...leg, minutes: takes, ...(km !== undefined ? { distanceKm: km } : {}), ...(terrain !== undefined ? { terrain } : {}) };
      let id = route?.id ?? `rt_${from.id}_${to.id}`;
      if (route === undefined) {
        // Two long ids make one the store refuses: a digest of the ends stands for them.
        if (!safeKey(id)) id = `rt_${hashParts("lre.route", from.id, to.id).slice(0, 12)}`;
        const first = id;
        for (let n = 2; hasOwn(w.ctx.world.routes, id); n++) id = `${first}_${n}`;
      }
      // Made one-way, a route runs as the call says, whichever way it ran.
      const next: RouteDef = route !== undefined ? { ...route, ...(oneWay === true ? { from: from.id, to: to.id } : {}), modes, bidirectional: oneWay === undefined ? route.bidirectional : !oneWay } : { id, from: from.id, to: to.id, modes, bidirectional: oneWay !== true };
      const failed = edit(id, next);
      if (failed) return failed;
    }
    o.draft.record(o.n, o.op, "engine", o.prov, start);
    return undefined;
  },
};

/** The family's tools, as RPH's search finds them. */
export const PLACE_TOOLS = [writeTool(label), writeTool(remove), writeTool(path)];

