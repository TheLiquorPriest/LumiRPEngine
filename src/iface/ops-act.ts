// `act` (plan §6.5: the world's actions and checks are what the GM rules by, not gates in code; §6.8: the everyday verbs are
// operations of `world_apply`): one of the world's actions (any pack's, or the world's own by the same id) carried out by whoever the
// call names, with the action's own arguments and the outcome the GM ruled, as the engine plays an action (`resolveAction`): the
// outcome's effects applied as the action defines them, the activity it starts set with its end, and what that activity meets met at
// that end (`ProcessDef.ended`), since no turn of code passes its time any more. Its requirements are read and each one that does not
// hold is said in the answer and kept with the change; the action is carried out all the same, and its effects do not enforce again
// what its doer may do (`EffectContext.ruled`). Left without an outcome, an action of one outcome takes it and an action with a check
// has its check rolled by the world's rules. The action's own time is given in the answer, never passed: that is `pass_time`'s.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { isRecord } from "../shared/json";
import { parseMoneyInput } from "../shared/money";
import type { ActionDef, ParamDef } from "../shared/world";
import { own } from "../engine/pack-kit";
import { findAction, resolveAction } from "../engine/resolve";
import { createRng } from "../engine/rng";
import { isAlready, notApplicable } from "./families/run";
import { find, isUnread, minorUnits, named, notAs, type OpContext, type OpDef, textArg, type Unread } from "./ops";
import { clockText } from "./ops-time";
import { openAuthored } from "./ops-values";
import { nearestOf, type Want } from "./reading";
import { textOf } from "./texts";

/**
 * One of the action's arguments as the call gives it, as the action takes it: a person, thing or place by name, found as its id; a list
 * of them, each found; a number; an amount in the world's main coin (or as the world writes money), in its smallest unit; a yes or no;
 * anything else as given. Undefined for an argument left empty; what could not be read, when it could not.
 */
function paramValue(o: OpContext, name: string, def: ParamDef, said: JsonValue): JsonValue | Unread | undefined {
  const field = `params.${name}`;
  if (said === null || said === "") return undefined;
  switch (def.type) {
    case "ref": {
      if (typeof said !== "string") return notAs(o, field, said, "name");
      // A place, someone or something of the kind it takes, or either where it names no kind.
      const want: Want = def.ref === "place" ? "place" : def.ref === undefined ? "point" : "entity";
      const found = find(o, field, want, false, said);
      if (!isUnread(found)) return found.id;
      // As the engine reads a reference that names no one (`prepare`): a place it names, which the action's effects take as such (a place bought becomes a property).
      const place = want === "entity" && found.line === "unknown" ? find(o, field, "place", false, said) : found;
      return isUnread(place) ? found : place.id;
    }
    case "list": {
      if (def.ref === undefined) return said;
      const names = Array.isArray(said) ? said : typeof said === "string" ? said.split(",") : null;
      if (names === null) return notAs(o, field, said, "list");
      const ids: string[] = [];
      for (const one of names) {
        if (typeof one !== "string" || one.trim() === "") continue;
        const found = find(o, field, "entity", false, one.trim());
        if (isUnread(found)) return found;
        ids.push(found.id);
      }
      return ids;
    }
    case "number":
    case "duration": {
      const n = typeof said === "number" ? said : typeof said === "string" ? Number(said.trim()) : Number.NaN;
      return Number.isFinite(n) ? n : notAs(o, field, said, def.type === "duration" ? "minutes" : "number");
    }
    case "money": {
      if (typeof said === "number" && Number.isFinite(said)) return minorUnits(o.reading, said);
      const cents = typeof said === "string" ? parseMoneyInput(said, o.reading.world.currency) : null;
      return cents ?? notAs(o, field, said, "amount_any");
    }
    case "bool":
      return said === true || said === "true" ? true : said === false || said === "false" ? false : notAs(o, field, said, "yes_no");
    default:
      return said;
  }
}

/** The action a call names, by its id: a pack's, or the world's own over a pack's of the same id; or what says it is none, nearest first. */
function actionNamed(o: OpContext): ActionDef | Unread {
  const said = textArg(o.args, "action");
  if (said === undefined) return notAs(o, "action", o.args.action ?? null, "name");
  const reg = o.reading.registry;
  const world = o.draft.w.world;
  const action = findAction(reg, world, said);
  if (action !== undefined) return action;
  const all = [...new Set([...reg.actions.keys(), ...Object.keys(world.actions)])].sort();
  const near = nearestOf(said, all, o.call.settings).slice(0, o.call.settings.nearMatches);
  const choices = near.length > 0 ? near : all;
  return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "action", value: JSON.stringify(said), choices: textOf(choices) }, data: { field: "action", choices } };
}

const act: OpDef = {
  name: "act",
  lane: "engine",
  needs: ["action"],
  takes: ["action", "who", "params", "outcome"],
  example: { op: "act", action: "eat", who: "Mara", params: { minutes: 30 }, source: { from: "prose", message: "m-0412" } },
  run(o) {
    const reg = o.reading.registry;
    const w = o.draft.w;
    const action = actionNamed(o);
    if (isUnread(action)) return action;
    let actor = w.world.pov;
    if (o.args.who !== undefined && o.args.who !== null && o.args.who !== "") {
      const who = find(o, "who", "person");
      if (isUnread(who)) return who;
      actor = who.id;
    }
    if (own(w.state.entities, actor) === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["who"] } };
    const given = o.args.params ?? {};
    if (!isRecord(given)) return notAs(o, "params", given, "fields");
    const names = Object.keys(action.params);
    const params: JsonObject = {};
    for (const [name, said] of Object.entries(given)) {
      const def = own(action.params, name);
      if (def === undefined) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: `params.${name}`, value: JSON.stringify(said), choices: textOf(names) }, data: { field: `params.${name}`, choices: names } };
      const value = paramValue(o, name, def, said as JsonValue);
      if (isUnread(value)) return value;
      if (value !== undefined) params[name] = value;
    }
    const missing = Object.entries(action.params).flatMap(([name, def]) => (def.optional === true || params[name] !== undefined ? [] : [`params.${name}`]));
    if (missing.length > 0) return { line: "needs", fields: { n: o.n, op: o.op, fields: missing } };
    const outcomes = Object.keys(action.outcomes);
    const ruled = textArg(o.args, "outcome");
    if (o.args.outcome !== undefined && o.args.outcome !== null && (ruled === undefined || !outcomes.includes(ruled))) return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "outcome", value: JSON.stringify(o.args.outcome), choices: textOf(outcomes) }, data: { field: "outcome", choices: outcomes } };

    const from = w.events.length;
    // Whoever it names has the accounts the world gave them opened first, so a sum starts from what the world gave (`openAuthored`).
    const parties = [actor, ...Object.entries(params).flatMap(([name, v]) => (own(action.params, name)?.type === "ref" && typeof v === "string" && own(w.state.entities, v) !== undefined ? [v] : []))];
    const unopened = openAuthored(o, [...new Set(parties)]);
    if (unopened) return unopened;
    const mark = w.lightMark();
    const res = resolveAction(reg, w, { action, actor, params }, createRng(o.draft.seed(o.n)), { advise: true, ...(ruled !== undefined ? { outcome: ruled } : {}) });
    if (!res.ok) {
      w.restore(mark);
      const failed = res.failed ?? { code: "failed", reason: "" };
      o.draft.note({ code: failed.code, reason: failed.reason });
      return notApplicable(o, failed.code);
    }
    const refused = res.rejected.find((r) => !isAlready(r.rejection.code));
    if (refused !== undefined) {
      w.restore(mark);
      o.draft.note(refused.rejection);
      return notApplicable(o, refused.rejection.code);
    }
    // The span of the activity it starts is its own: what that activity meets is met as it ends, which no turn of code reaches now.
    const span = res.activity;
    if (span !== null) {
      for (const def of reg.processes) {
        if (def.scope !== "agent" || def.ended === undefined || w.ctx.levelOf(res.actor, def.domain) < def.minLevel) continue;
        const bad = o.draft.applyAll(def.ended(w.ctx, res.actor, span));
        if (bad) {
          w.restore(mark);
          return notApplicable(o, bad.code);
        }
      }
    }
    if (w.events.length === from) o.reply.line("already_so", { n: o.n, op: o.op, what: `${action.label} [${action.id}]` });
    for (const unmet of res.advised ?? []) o.draft.adviseOp(o.n, { code: "unmet_requirement", values: { requirement: typeof unmet.requirement === "string" ? unmet.requirement : unmet.reason, ...(unmet.words !== undefined ? { words: unmet.words } : {}) } });
    o.draft.record(o.n, o.op, o.lane, o.prov, from);
    const check = res.check;
    o.after((state): JsonObject => ({
      action: `${action.label} [${action.id}]`,
      who: named(o.reading, res.actor),
      outcome: res.outcome,
      ...(check !== null ? { roll: { dice: check.notation, rolled: check.total, ...(check.natural !== null ? { natural: check.natural } : {}), ...(check.dc !== null ? { dc: check.dc } : {}) } } : {}),
      minutes: res.duration,
      ...(span !== null ? { activity: span.type, until: clockText(o, span.until, state) } : {}),
    }));
    return undefined;
  },
};

/** The operation that carries out one of the world's actions. */
export const ACT_OPS: readonly OpDef[] = [act];
