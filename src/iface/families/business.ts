// Business (the skill `economy`): a business's takings adjusted, a production project started, paused,
// resumed or dropped (or a step of it set back, or made to cost more), a price set, and one of the
// world's GM effects run by name, each through the packs' own handlers (the economy's revenue and
// price effects, the organizations' project change, any effect a pack marks for the game master).
// Amounts are the call's, in the world's main coin; each change carries its why.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import type { EffectDef } from "../../engine/registry";
import type { Registry } from "../../engine/registry-impl";
import { NUMBER, OBJECT, oneOf, TEXT, WHOLE } from "../kit";
import { find, isUnread, minorUnits, notAs, numberArg, textArg } from "../ops";
import { nearestOf } from "../reading";
import { textOf } from "../texts";
import { effectChange, effectTool, notApplicable, readTool, type WriteDef, writeTool } from "./run";
import { orgChange } from "./groups";

const FAMILY = "business";

const PROJECT_ACTS = ["start", "pause", "resume", "drop", "note"] as const;

/** The effects the game master may run: each pack's, marked so, by name with the arguments it reads. */
function gmEffects(registry: Registry): EffectDef[] {
  return [...registry.effects.values()].filter((def) => def.gm === true).sort((a, b) => a.type.localeCompare(b.type));
}

/** An effect as an answer gives it: its name, the arguments it must have and those it can do without. */
function effectData(def: { type: string; args: readonly string[] }): JsonObject {
  const optional = def.args.filter((a) => a.endsWith("?")).map((a) => a.slice(0, -1));
  return { effect: def.type, args: def.args.filter((a) => !a.endsWith("?")), ...(optional.length > 0 ? { optional } : {}) };
}

const effects = readTool({
  name: "gm_effects",
  family: FAMILY,
  properties: { search: TEXT },
  required: [],
  example: { search: "price" },
  read(r, args, reply) {
    const words = (textArg(args, "search") ?? "").toLowerCase().split(/\s+/).filter((w) => w !== "");
    const all = gmEffects(r.registry);
    const found = all.filter((def) => words.every((w) => def.type.toLowerCase().includes(w)));
    if (found.length === 0) return { line: "no_effect", fields: { search: words.join(" ") }, data: { effects: all.map((def) => def.type) } };
    reply.data({ effects: found.map(effectData) as unknown as JsonValue });
    return undefined;
  },
});

const runEffect: WriteDef = {
  name: "gm_effect",
  family: FAMILY,
  lane: "engine",
  properties: { effect: TEXT, args: OBJECT },
  required: ["effect"],
  example: { effect: "economy.set_price", args: { asset: "lamp_house_shares", price: 1250 }, source: { from: "gm" } },
  run(o) {
    const said = textArg(o.args, "effect");
    if (said === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["effect"] } };
    const all = gmEffects(o.reading.registry);
    const def = all.find((d) => d.type === said);
    if (def === undefined) {
      const near = nearestOf(said, all.map((d) => d.type), o.call.settings).slice(0, o.call.settings.nearMatches);
      return { line: "unknown_effect", fields: { n: o.n, op: o.op, effect: said, effects: textOf(near.length > 0 ? near : all.map((d) => d.type)) }, data: { effects: all.map((d) => d.type) } };
    }
    const given = o.args.args;
    if (given !== undefined && given !== null && !isRecord(given)) return notAs(o, "args", given, "fields");
    const from = o.draft.w.events.length;
    const refused = effectChange(o, { type: def.type, args: { ...(given ?? {}) } });
    if (refused !== null) return notApplicable(o, refused.code);
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

const revenue = effectTool({
  name: "gm_revenue",
  family: FAMILY,
  lane: "engine",
  effect: "economy.revenue_adjust",
  args: [{ field: "stream", want: "entity" }, { field: "factor" }, { field: "amount", arg: "cents", money: true }, { field: "days" }, { field: "reason" }],
  properties: { stream: TEXT, factor: NUMBER, amount: NUMBER, days: WHOLE, reason: TEXT },
  required: ["stream", "reason"],
  example: { stream: "Lamp House takings", factor: 1.5, days: 7, reason: "the harvest fair", source: { from: "prose", message: "m-0901" } },
});

const price = effectTool({
  name: "set_price",
  family: FAMILY,
  lane: "engine",
  effect: "economy.set_price",
  args: [{ field: "asset", want: "entity" }, { field: "price", money: true }],
  properties: { asset: TEXT, price: NUMBER },
  required: ["asset", "price"],
  example: { asset: "Lamp House shares", price: 12.5, source: { from: "gm" } },
});

const project: WriteDef = {
  name: "gm_project",
  family: FAMILY,
  lane: "engine",
  properties: { act: oneOf(PROJECT_ACTS), org: TEXT, template: TEXT, project: TEXT, name: TEXT, account: TEXT, step: TEXT, days: WHOLE, amount: NUMBER, why: TEXT },
  required: ["act"],
  example: { act: "start", org: "The Lamplighters", template: "new_lamp_house", why: "the guild's charter", source: { from: "prose", message: "m-0902" } },
  run(o) {
    const act = textArg(o.args, "act");
    if (act === undefined || !PROJECT_ACTS.some((a) => a === act)) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "act", value: JSON.stringify(o.args.act ?? null), choices: textOf(PROJECT_ACTS) } };
    const change: JsonObject = { do: "project", act };
    for (const field of ["org", "template", "project", "name", "account", "step", "why"] as const) {
      const v = textArg(o.args, field);
      if (v !== undefined) change[field] = v;
    }
    if (o.args.days !== undefined && o.args.days !== null) {
      const days = numberArg(o.args, "days");
      if (days === undefined) return notAs(o, "days", o.args.days, "qty");
      change.days = days;
    }
    // A step's extra cost is an amount in the world's main coin, kept in its smallest unit.
    if (o.args.amount !== undefined && o.args.amount !== null) {
      const amount = numberArg(o.args, "amount");
      if (amount === undefined) return notAs(o, "amount", o.args.amount, "amount_any");
      change.cents = minorUnits(o.reading, amount);
    }
    // The project's own organization is the one it belongs to when the call names only the project.
    if (change.org === undefined && change.project !== undefined) {
      const found = find(o, "project", "entity");
      if (isUnread(found)) return found;
      const owner = o.draft.w.state.entities[found.id]?.fields.org;
      if (typeof owner === "string") change.org = owner;
    }
    return orgChange(o, change);
  },
};

/** The family's tools, as RPH's search finds them. */
export const BUSINESS_TOOLS = [revenue, price, writeTool(project), effects, writeTool(runEffect)];
