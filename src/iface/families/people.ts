// People and what they are (the rest of today's long tail of people tools): a life state set, someone
// or something taken out of the world or brought back, classes and tags, tier and simulation detail,
// any relation made or ended, and detail the world's tables fill in. Each but the last is today's GM
// edit (`engine/edits`) as today's tool sends it; the everyday ones (a value set, someone moved, made,
// or their regard) are `world_apply`'s. A change that is so already (someone taken out twice) changes
// nothing and the answer says so.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import type { FixOp } from "../../shared/ledger";
import { OBJECT, TEXT, TEXTS, YES_NO } from "../kit";
import { find, isUnread, named, notOneOf, textArg, type OpContext, type Unread } from "../ops";
import { timeArg } from "../ops-time";
import { FILLED_IN } from "../source";
import { tagsOf } from "../../engine/selector";
import { editTool, type WriteDef, writeTool } from "./run";

const FAMILY = "people";

/** Each name of a list argument, found as a person or a thing. */
function idsOf(o: OpContext, field: string): string[] | Unread {
  const out: string[] = [];
  for (const said of Array.isArray(o.args[field]) ? (o.args[field] as JsonValue[]) : []) {
    const found = find(o, field, "entity", false, said);
    if (isUnread(found)) return found;
    out.push(found.id);
  }
  return out;
}

const life = editTool({
  name: "gm_set_life",
  family: FAMILY,
  lane: "engine",
  properties: { person: TEXT, state: TEXT, tell: TEXTS },
  required: ["person"],
  example: { person: "tam", state: "dead", tell: ["bram"], source: { from: "prose", message: "m-0701" } },
  build(o) {
    const person = find(o, "person", "person");
    if (isUnread(person)) return person;
    const tell = idsOf(o, "tell");
    if (isUnread(tell)) return tell;
    const state = textArg(o.args, "state");
    return { op: { op: "life", entity: person.id, ...(state !== undefined ? { to: state } : {}), ...(tell.length > 0 ? { tell } : {}) }, what: person.id };
  },
});

const despawn = editTool({
  name: "gm_despawn",
  family: FAMILY,
  lane: "engine",
  properties: { entity: TEXT },
  required: ["entity"],
  example: { entity: "tam", source: { from: "prose", message: "m-0702" } },
  build(o) {
    const e = find(o, "entity", "entity", true);
    return isUnread(e) ? e : { op: { op: "despawn", entity: e.id }, what: e.id };
  },
});

const restore = editTool({
  name: "gm_restore",
  family: FAMILY,
  lane: "engine",
  properties: { entity: TEXT },
  required: ["entity"],
  example: { entity: "tam", source: { from: "prose", message: "m-0703" } },
  build(o) {
    const e = find(o, "entity", "entity", true);
    return isUnread(e) ? e : { op: { op: "restore", entity: e.id }, what: e.id };
  },
});

const classify = editTool({
  name: "gm_classify",
  family: FAMILY,
  lane: "engine",
  properties: { entity: TEXT, class: OBJECT, tags: TEXTS },
  required: ["entity", "class", "tags"],
  example: { entity: "bram", class: { trade: ["innkeeper"] }, tags: ["local"], source: { from: "lore", lore: "lore-bram" } },
  build(o) {
    const e = find(o, "entity", "entity");
    if (isUnread(e)) return e;
    const given = o.args.class;
    if (!isRecord(given) || !Object.values(given).every((v) => Array.isArray(v) && v.every((x) => typeof x === "string"))) return notOneOf(o, "class", given ?? null, []);
    const tags = Array.isArray(o.args.tags) ? o.args.tags.filter((t): t is string => typeof t === "string") : [];
    return { op: { op: "classify", entity: e.id, class: given as Record<string, string[]>, tags }, what: e.id };
  },
  // Classes and tags are kept apart from the thing's own values: the answer shows them as they now stand.
  shows(o, state) {
    const found = o.reading.find(String(o.args.entity), "entity");
    const out: JsonObject = {};
    if ("id" in found) out.tags = [...tagsOf(o.reading.doc, state.world, found.id)];
    return out;
  },
});

const entity = editTool({
  name: "gm_set_entity",
  family: FAMILY,
  lane: "engine",
  properties: { entity: TEXT, tier: TEXT, agent: YES_NO, levels: OBJECT },
  required: ["entity"],
  example: { entity: "odile", tier: "principal", source: { from: "author" } },
  build(o) {
    const e = find(o, "entity", "entity");
    if (isUnread(e)) return e;
    const levels = o.args.levels;
    if (levels !== undefined && !isRecord(levels)) return notOneOf(o, "levels", levels, []);
    const tier = textArg(o.args, "tier");
    const op = { op: "entity", entity: e.id, ...(tier !== undefined ? { tier } : {}), ...(typeof o.args.agent === "boolean" ? { agent: o.args.agent } : {}), ...(isRecord(levels) ? { levels } : {}) };
    return { op: op as unknown as FixOp, what: e.id };
  },
});

const link = editTool({
  name: "gm_link",
  family: FAMILY,
  lane: "engine",
  properties: { relation: TEXT, from: TEXT, to: TEXT, fields: OBJECT, until: TEXT },
  required: ["relation", "from", "to"],
  example: { relation: "employed_by", from: "odile", to: "bram", fields: { role: "cellar hand" }, source: { from: "prose", message: "m-0704" } },
  build(o) {
    const from = find(o, "from", "entity");
    if (isUnread(from)) return from;
    const to = find(o, "to", "point");
    if (isUnread(to)) return to;
    const fields = o.args.fields;
    if (fields !== undefined && fields !== null && !isRecord(fields)) return notOneOf(o, "fields", fields, []);
    const until = timeArg(o, "until");
    if (isUnread(until)) return until;
    const op = { op: "link", rel: textArg(o.args, "relation") ?? "", from: from.id, to: to.id, ...(isRecord(fields) ? { fields } : {}), ...(until !== undefined ? { until } : {}) };
    return { op: op as unknown as FixOp, what: from.id };
  },
});

const unlink = editTool({
  name: "gm_unlink",
  family: FAMILY,
  lane: "engine",
  properties: { relation: TEXT, from: TEXT, to: TEXT },
  required: ["relation", "from", "to"],
  example: { relation: "employed_by", from: "odile", to: "bram", source: { from: "prose", message: "m-0705" } },
  build(o) {
    const from = find(o, "from", "entity");
    if (isUnread(from)) return from;
    const to = find(o, "to", "point");
    if (isUnread(to)) return to;
    return { op: { op: "unlink", rel: textArg(o.args, "relation") ?? "", from: from.id, to: to.id }, what: from.id };
  },
});

/**
 * Detail the world's tables give someone or something that nobody has recorded, filled in when an
 * agent asks for it (plan §6.4, coming into view), part by part as today's engine samples it
 * (`engine/materialize`: a person's money, the everyday things they carry, a vehicle's fuel and
 * wear). Nothing else fills these in. No call says the values, so they are recorded with
 * `FILLED_IN`, and the tool takes no provenance.
 */
const fillIn: WriteDef = {
  name: "fill_in_detail",
  family: FAMILY,
  lane: "engine",
  provenance: false,
  properties: { who: TEXT, part: TEXT },
  required: ["who"],
  example: { who: "tam", part: "money" },
  run(o) {
    const who = find(o, "who", "entity");
    if (isUnread(who)) return who;
    const parts = [...o.reading.registry.materializers.keys()].sort();
    const said = textArg(o.args, "part");
    const part = parts.find((p) => p === said?.toLowerCase());
    if (said !== undefined && part === undefined) return notOneOf(o, "part", said, parts);
    const from = o.draft.w.events.length;
    for (const domain of part !== undefined ? [part] : parts) {
      const bad = o.draft.fill(o.n, who.id, domain);
      if (bad) return { line: "not_applicable", fields: { n: o.n, op: o.op, code: bad.code } };
    }
    if (o.draft.w.events.length === from) o.reply.line("nothing_filled", { n: o.n, op: o.op, what: named(o.reading, who.id) });
    o.draft.record(o.n, o.op, "engine", FILLED_IN, from);
    return undefined;
  },
};

/** The family's tools, as RPH's search finds them. */
export const PEOPLE_TOOLS = [life, despawn, restore, classify, entity, link, unlink, writeTool(fillIn)];
