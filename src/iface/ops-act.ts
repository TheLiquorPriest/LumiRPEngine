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
import type { EntityId } from "../shared/ids";
import type { ActionDef, ParamDef } from "../shared/world";
import { calendarOf, dateAt } from "../engine/calendar";
import { offeredActions } from "../engine/offered";
import { own } from "../engine/pack-kit";
import { paramChoices } from "../engine/param-words";
import { companionCandidates, findAction, paramCandidates, resolveAction } from "../engine/resolve";
import { createRng } from "../engine/rng";
import { isGone, kindIs } from "../engine/scope";
import { selectorMatches } from "../engine/selector";
import { canSeeEntity } from "../engine/visibility";
import { downsOf } from "../packs/combat/core/flow";
import { fightById, fighterOf, fightsOf, rulesOf as fightRulesOf } from "../packs/combat/core/model";
import { isAlready, notApplicable } from "./families/run";
import { find, isUnread, minorUnits, named, notAs, type OpContext, type OpDef, textArg, type Unread } from "./ops";
import { clockText } from "./ops-time";
import { openAuthored } from "./ops-values";
import { nearestOf, type Reading, type Want } from "./reading";
import { textOf } from "./texts";

/**
 * A value of one of an action's arguments, as an answer that says what the action takes shows it (`act`'s `explain`): the one the
 * action declares (`ParamDef.example`); else, for a reference, the first the actor could pick as things stand (as the palette offers
 * them), else the first of its kind the actor knows of, by name; a count of one, half an hour, ten of the main coin, yes, today's date,
 * the first of the values a text argument takes from a list (its table's rows, or its game system's: `paramChoices`). None for words the action gives no example of: its own words say what they are.
 */
function exampleOf(reading: Reading, action: ActionDef, name: string, def: ParamDef, actor: EntityId): JsonValue | undefined {
  if (def.example !== undefined) return def.example;
  const reg = reading.registry;
  const world = reading.world;
  const state = reading.state.world;
  switch (def.type) {
    case "ref": {
      const known = (id: EntityId): boolean => {
        const e = own(state.entities, id);
        return e !== undefined && id !== actor && !isGone(state, id) && (def.ref === undefined || kindIs(reg, world, e.kind, def.ref)) && (def.of === undefined || selectorMatches(reg, world, state, def.of, id)) && canSeeEntity(reg, world, state, actor, id);
      };
      // A reference that names no kind takes anyone or anything: someone is the likelier value to show (an admission's who, a fight's target).
      const picks = paramCandidates(reg, world, state, action, name, actor);
      const id = (def.ref === undefined ? picks.find((p) => reading.isPerson(p)) : undefined) ?? picks[0] ?? (def.ref === "place" ? undefined : Object.keys(state.entities).sort().find(known));
      return id === undefined ? undefined : reading.nameOf(id);
    }
    case "list": {
      const id = companionCandidates(reg, world, state, action, name, actor)[0];
      return id === undefined ? undefined : [reading.nameOf(id)];
    }
    case "number":
      return 1;
    case "duration":
      return 30;
    case "money":
      return 10;
    case "bool":
      return true;
    case "date": {
      const d = dateAt(calendarOf(world), state.clock);
      return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
    }
    case "text":
      return paramChoices(reading.ctx, def, actor)[0]?.value;
    default:
      return undefined;
  }
}

/**
 * A list or an object given for an argument that is one value: a list of words or numbers as the words joined by commas (ids, powers,
 * keys: as an action's text arguments list them), any other as its JSON text (a payment preference's tiers).
 */
function asText(said: JsonObject | JsonValue[]): string {
  return Array.isArray(said) && said.every((x) => typeof x === "string" || typeof x === "number") ? said.join(", ") : JSON.stringify(said);
}

/**
 * One of the action's arguments as the call gives it, as the action takes it: a person, thing or place by name, found as its id; a list
 * of them, each found; a number; an amount in the world's main coin (or as the world writes money), in its smallest unit; a yes or no;
 * a list or an object given for any other argument, as text (`asText`), the one way an action's argument, a single value, carries one;
 * anything else as given. Undefined for an argument left empty; what could not be read, when it could not.
 */
function paramValue(o: OpContext, name: string, def: ParamDef, said: JsonValue): JsonValue | Unread | undefined {
  const field = `params.${name}`;
  if (said === null || said === "") return undefined;
  // The kind the argument takes is known from the action: a name is looked up among that kind alone (its `ref`, its selector), so a
  // company and a place of one name are not both found; a place fits a reference that names no kind.
  const w = o.draft.w;
  const fits = (id: string): boolean => {
    const e = own(w.state.entities, id);
    if (e === undefined) return def.ref === undefined && def.of === undefined;
    return (def.ref === undefined || kindIs(o.reading.registry, w.world, e.kind, def.ref)) && (def.of === undefined || selectorMatches(o.reading.registry, w.world, w.state, def.of, id));
  };
  switch (def.type) {
    case "ref": {
      if (typeof said !== "string") return notAs(o, field, said, "name");
      // A place, someone or something of the kind it takes, or either where it names no kind.
      const want: Want = def.ref === "place" ? "place" : def.ref === undefined ? "point" : "entity";
      const found = find(o, field, want, false, said, def.ref === "place" ? undefined : fits);
      if (!isUnread(found)) return found.id;
      // As the engine reads a reference that names no one (`prepare`): a place it names, which the action's effects take as such (a place bought becomes a property).
      const place = want === "entity" && found.line === "unknown" ? find(o, field, "place", false, said) : found;
      return isUnread(place) ? found : place.id;
    }
    case "list": {
      if (def.ref === undefined) return typeof said === "object" ? asText(said) : said;
      const names = Array.isArray(said) ? said : typeof said === "string" ? said.split(",") : null;
      if (names === null) return notAs(o, field, said, "list");
      const ids: string[] = [];
      for (const one of names) {
        if (typeof one !== "string" || one.trim() === "") continue;
        const found = find(o, field, "entity", false, one.trim(), fits);
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
      return typeof said === "object" ? asText(said) : said;
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
  const all = [...offeredActions(reg, o.draft.w.ctx).keys()].sort();
  const near = nearestOf(said, all, o.call.settings).slice(0, o.call.settings.nearMatches);
  const choices = near.length > 0 ? near : all;
  return { line: "unreadable_op", fields: { n: o.n, op: o.op, field: "action", value: JSON.stringify(said), choices: textOf(choices) }, data: { field: "action", choices } };
}

/**
 * An action of the tabletop rules (the `d20` pack's) carried out while its doer is in a fight under way (RULESET-DESIGN §5.3): what
 * it costs of the fight's budgets (`ruleset.d20.costs`, by the action's id, `attack.full` for every attack a high base attack gives)
 * is spent, and said where its doer has it not left this turn and carried out all the same; the act is recorded into the fight, as
 * `fight_round` records one, with `told`, its records' words, for the fight's round to show its numbers; and who that leaves down or
 * back up is settled by the fight's rules. Nothing for any other action.
 */
function intoFight(o: OpContext, action: ActionDef, actor: EntityId, params: JsonObject, outcome: string | null, told: readonly string[]): void {
  const w = o.draft.w;
  const d20 = w.world.ruleset?.d20;
  const rules = fightRulesOf(w.world);
  if (d20 === undefined || rules === null || action.pack !== "d20") return;
  const enc = fightsOf(w.state).find((f) => fighterOf(f, actor) !== undefined);
  if (!enc) return;
  const key = action.id === "attack" && params.full === true ? "attack.full" : action.id;
  const cost = own(d20.costs ?? {}, key) ?? {};
  if (Object.keys(cost).length > 0) {
    const refused = o.draft.applyAll([{ type: "combat.spend", data: { encounter: enc.id, who: actor, cost } }]);
    if (refused) o.reply.report("fight_cost_not_left", { n: o.n, op: o.op, who: named(o.reading, actor), cost: Object.entries(cost).map(([b, n]) => `${n} ${rules.economy[b]?.label ?? b}`).join(", "), why: refused.reason });
  }
  const target = typeof params.target === "string" ? params.target : null;
  o.draft.applyAll([{ type: "combat.act", data: { encounter: enc.id, actor, action: action.id, label: action.label, ...(target !== null ? { target } : {}), ...(outcome !== null && outcome !== "default" ? { outcome } : {}), ...(told.length > 0 ? { told: [...told] } : {}) } }]);
  const now = fightById(w.state, enc.id);
  if (now !== null) downsOf(w, rules, now, createRng(o.draft.seed(o.n)).fork("down"));
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
    // What the action worked out and where its numbers came from, as its records say it (an event type that is `told`): whole for the
    // answer, and as the player's character is shown it (another's hit points as the fight shows them) for the fight's round.
    const toldSince = (start: number, viewer?: EntityId): string[] =>
      w.events.slice(start).flatMap((e) => {
        const def = reg.get(e.type);
        return def?.told === true ? [def.describe(e, w.ctx, viewer)] : [];
      });
    // An action of the tabletop rules taken in a fight under way is recorded into the fight with those words, spends its cost, and settles who is down (RULESET-DESIGN §5.3).
    intoFight(o, action, res.actor, params, res.outcome, toldSince(from, w.world.pov));
    if (w.events.length === from) o.reply.line("already_so", { n: o.n, op: o.op, what: `${action.label} [${action.id}]` });
    for (const unmet of res.advised ?? []) o.draft.adviseOp(o.n, { code: "unmet_requirement", values: { requirement: typeof unmet.requirement === "string" ? unmet.requirement : unmet.reason, ...(unmet.words !== undefined ? { words: unmet.words } : {}) } });
    const told = toldSince(from);
    o.draft.record(o.n, o.op, o.lane, o.prov, from);
    const check = res.check;
    o.after((state): JsonObject => ({
      action: `${action.label} [${action.id}]`,
      who: named(o.reading, res.actor),
      outcome: res.outcome,
      ...(check !== null ? { roll: { dice: check.notation, rolled: check.total, ...(check.natural !== null ? { natural: check.natural } : {}), ...(check.dc !== null ? { dc: check.dc } : {}) } } : {}),
      ...(told.length > 0 ? { told } : {}),
      minutes: res.duration,
      ...(span !== null ? { activity: span.type, until: clockText(o, span.until, state) } : {}),
    }));
    return undefined;
  },
  explain(reply, n, args, reading) {
    const said = textArg(args, "action");
    const action = said === undefined ? undefined : findAction(reading.registry, reading.world, said);
    if (action === undefined) return;
    const who = typeof args.who === "string" && args.who.trim() !== "" ? reading.find(args.who, "person") : null;
    const actor = who !== null && "id" in who ? who.id : reading.world.pov;
    const takes: string[] = [];
    const example: JsonObject = {};
    for (const [name, def] of Object.entries(action.params)) {
      // A parameter that takes one of a list is told with each value it takes and the name a person is shown for it (`paramChoices`).
      const choices = paramChoices(reading.ctx, def, actor).map((c) => `${c.value} (${c.label})`);
      takes.push(reading.lines.line("act_param", { name, optional: def.optional === true, says: def.label ?? "", ...(choices.length > 0 ? { choices: choices.join(", ") } : {}) }) ?? "");
      const value = exampleOf(reading, action, name, def, actor);
      if (value !== undefined && (def.optional !== true || def.example !== undefined)) example[name] = value;
    }
    const call: JsonObject = { op: "act", action: action.id, ...(Object.keys(example).length > 0 ? { params: example } : {}) };
    // Each argument's line says commas of its own, so they are set apart by semicolons.
    reply.line("act_takes", { n, action: `${action.label} [${action.id}]`, takes: takes.filter((t) => t !== "").join("; "), example: JSON.stringify(call) });
  },
};

/** The operation that carries out one of the world's actions. */
export const ACT_OPS: readonly OpDef[] = [act];
