// Three of the four fixed tools (plan §6.8): `world_query` reads the tree at any point and depth, by
// the store's tree view, and can be asked what falls due in a coming span for that part of the
// tree; `world_search` finds things by words; `roll` makes dice and checks by the world's ruleset,
// once, and records the roll with what it was for. Their answers are the store's data and lines of
// the answers' file.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { hashParts } from "../shared/hash";
import { isRecord } from "../shared/json";
import type { CheckDef } from "../shared/world";
import { checkOf, readyCheck, rollCheck } from "../engine/checks";
import { DiceError, rollDice } from "../engine/dice";
import { ENGINE_EVENTS } from "../engine/engine-pack";
import { createRng } from "../engine/rng";
import { WORLD_STATE_DEFAULTS } from "../store/world-state";
import { renderView } from "../store/words";
import { rulesetData } from "./bestiary";
import { type Call, oneOf, Reply, SEARCH_KINDS, type StateKind, TEXT, type ToolSpec, WHOLE, YES_NO } from "./kit";
import { baseOf, isPlaceFactPart, PLACE_FACT_PARTS, PLACES_DEFAULTS, placeAtState, placeSliceOf, sourcesNow, sourcesOf, withPlaceLines } from "../places";
import { queryQuests, searchedQuests } from "../quests/query";
import { clockText, listDue, timeFrom } from "./ops-time";
import { missed, missedData, numberArg, unknownFields } from "./ops";
import { type Found, isFound, nearestOf, Reading, saysUnreadable, type Unreadable } from "./reading";
import { textOf } from "./texts";
import { commit, Draft } from "./writing";

/** A reading for the call, or the reply that says why there is none. */
export function readingOr(call: Call, reply: Reply): Reading | null {
  const r = Reading.of(call);
  if (r instanceof Reading) return r;
  saysUnreadable(reply, r);
  return null;
}

/** The reply that says why a write could not be recorded where it was made: its turn's changes dropped, its job ended, or its turn joined to another. */
export function unreadable(call: Call, why: Unreadable): Reply {
  return saysUnreadable(call.reply(), why);
}

/** A name a fixed tool's argument gives, found; or null, the reply having said it is not there or fits several. */
export function foundOr(reading: Reading, reply: Reply, field: string, said: JsonValue | undefined, want: Parameters<Reading["find"]>[1]): Found | null {
  if (typeof said !== "string" || said.trim() === "") {
    reply.line("needs_field", { field }).fail();
    return null;
  }
  const r = reading.find(said, want);
  if (isFound(r)) return r;
  if (r.several.length > 0) reply.line("several", { field, name: r.name, several: textOf(r.several.map((x) => `${x.name} [${x.id}]`)) });
  else reply.line("unknown", missed(reading.lines, field, r, want)).refusedWith({ field, ...missedData(r) });
  reply.fail();
  return null;
}

/** The tree's own name for the world's ruleset part, which `world_query` also reads. */
export const RULESET_POINT = "ruleset";

export const WORLD_QUERY: ToolSpec = {
  name: "world_query",
  family: "state",
  tier: "read",
  properties: { at: TEXT, depth: { anyOf: [WHOLE, oneOf(["full"])] }, due: TEXT, map: YES_NO, part: oneOf(PLACE_FACT_PARTS) },
  required: ["at"],
  example: { at: "thornbury", depth: 2, due: "six hours" },
  async run(args, call) {
    const reply = call.reply();
    const reading = readingOr(call, reply);
    if (reading === null) return reply;
    if (args.at === RULESET_POINT) return reply.data({ ruleset: rulesetData(reading.doc) });
    // (S17Story, quests) The quests' level, or a quest by name, id or ref: its record whole.
    const quest = queryQuests(call, reading, reply, args.at);
    if (quest !== null) return quest;
    const at = foundOr(reading, reply, "at", args.at, "point");
    if (at === null) return reply;
    // A depth that reads as none is refused naming the field, never replaced by the setting's.
    const saidDepth = args.depth === undefined || args.depth === null ? undefined : args.depth === "full" ? "full" : numberArg(args, "depth");
    if (args.depth !== undefined && args.depth !== null && (saidDepth === undefined || (saidDepth !== "full" && !(Number.isInteger(saidDepth) && saidDepth >= 0)))) {
      return reply.line("unreadable", { field: "depth", value: JSON.stringify(args.depth), wants: reading.lines.line("wants_depth") ?? "" }).fail();
    }
    const depth = saidDepth ?? call.settings.queryDepth;
    // (S17Story, places) A place's record: what the story changed there, its features and its access and state, as lines of their own, or one part whole.
    const part = typeof args.part === "string" && isPlaceFactPart(args.part) ? args.part : undefined;
    if (args.part !== undefined && args.part !== null && part === undefined) return reply.line("unreadable", { field: "part", value: JSON.stringify(args.part), choices: textOf(PLACE_FACT_PARTS) }).fail();
    if (part !== undefined && !at.ref.startsWith("place:")) return reply.line("part_needs_place", { at: `${at.name} [${at.id}]`, choices: textOf(PLACE_FACT_PARTS) }).fail();
    const found = reading.view().query(at.ref, depth, { due: call.deps.due, ahead: call.deps.dueAhead ?? WORLD_STATE_DEFAULTS.dueAhead });
    // Its sources are read live, as Lumiverse holds the entries now, and set against its base.
    const sources = call.deps.placeSources !== undefined && at.ref.startsWith("place:") && part === undefined ? await sourcesNow(call.deps.placeSources, { user: call.scope.user, chat: call.scope.chat }, at.id, baseOf(placeSliceOf(reading.state), at.id), sourcesOf(placeSliceOf(reading.state), at.id)) : undefined;
    const view =
      found !== null && at.ref.startsWith("place:")
        ? {
            lines: withPlaceLines(found.lines, {
              at: placeAtState(call.deps.store, call.deps.env, call.scope.chat, reading.turn?.id ?? null, reading.state, reading.ctx),
              place: at.id,
              settings: { ...PLACES_DEFAULTS, ...(call.deps.places ?? {}) },
              ...(call.deps.mapSettings !== undefined ? { config: call.deps.mapSettings } : {}),
              ...(part !== undefined ? { part } : {}),
              ...(sources !== undefined ? { sources } : {}),
            }),
          }
        : found;
    if (view !== null) reply.tree(renderView(view, call.tree));
    if (typeof args.due === "string") {
      const to = timeFrom(reading, reading.state.world, args.due);
      if (to === null) return reply.line("unreadable", { field: "due", value: JSON.stringify(args.due), wants: reading.lines.line("wants_time") ?? "" }).fail();
      const from = reading.state.world.clock;
      const span = { from: clockText({ reading }, Math.min(from, to)), to: clockText({ reading }, Math.max(from, to)) };
      reply.data({ span, due: listDue({ reading, reply, call }, call.deps.due.due(reading.state, { from: Math.min(from, to), to: Math.max(from, to) }, at.ref, call.settings.dueItems)) });
    }
    if (args.map === true) {
      const place = at.ref.startsWith("place:") ? at.id : null;
      const printed = place === null ? null : call.deps.map.text({ state: reading.state, env: call.deps.env, place });
      if (printed === null) reply.line("no_map", { at: `${at.name} [${at.id}]` });
      else reply.tree(printed.text);
    }
    return reply;
  },
};

export const WORLD_SEARCH: ToolSpec = {
  name: "world_search",
  family: "state",
  tier: "read",
  properties: { words: TEXT, kind: oneOf(SEARCH_KINDS), limit: WHOLE },
  required: ["words"],
  example: { words: "cider cask", kind: "thing" },
  async run(args, call) {
    const reply = call.reply();
    const reading = readingOr(call, reply);
    if (reading === null) return reply;
    const words = typeof args.words === "string" ? args.words.trim() : "";
    if (words === "") return reply.line("needs_field", { field: "words" }).fail();
    if (args.kind !== undefined && !(SEARCH_KINDS as readonly JsonValue[]).includes(args.kind)) return reply.line("unreadable", { field: "kind", value: JSON.stringify(args.kind), choices: textOf(SEARCH_KINDS) }).fail();
    const asked = args.limit === undefined || args.limit === null ? call.settings.searchHits : numberArg(args, "limit");
    if (asked === undefined || !Number.isInteger(asked) || asked < 1) return reply.line("unreadable", { field: "limit", value: JSON.stringify(args.limit), wants: reading.lines.line("wants_qty") ?? "" }).fail();
    // At most what the setting allows, with how many more were found beyond what is listed.
    // (S17Story, quests) A quest is found by the words of its name, objective and stages, beside what the state's search finds; the state's own kinds are asked of it alone.
    const stateKind = args.kind === undefined || args.kind === "quest" ? undefined : (args.kind as StateKind);
    const fromState = args.kind === "quest" ? [] : await call.deps.search.search(reading.state, call.deps.env, words, { ...(stateKind !== undefined ? { kind: stateKind } : {}), limit: Number.MAX_SAFE_INTEGER });
    const found = [...fromState, ...(args.kind === undefined || args.kind === "quest" ? searchedQuests(reading, words) : [])];
    if (found.length === 0) return reply.line("none_found", { words });
    const shown = Math.min(asked, call.settings.searchHits);
    if (found.length > shown) reply.line("more_found", { words, shown, more: found.length - shown });
    return reply.data({ hits: found.slice(0, shown).map((h) => ({ ...h }) as JsonObject) });
  },
};

/** How many rolls the turn has recorded for someone: the next of theirs is drawn after these. Read inside the write that records the next, so two rolls made at once are counted apart. */
function rollsBefore(call: Call, turn: string, who: string): number {
  return call.deps.store.changes(turn).filter((c) => c.op === ENGINE_EVENTS.check && isRecord(c.value) && isRecord(c.value.data) && c.value.data.actor === who).length;
}

/** How a roll is made: dice by their notation, or a check of the world's by the id it was asked by. */
type RollBy = { dice: string } | { check: string; def: CheckDef };

/** A roll drawn and drafted on the state as it stands: what it came to, or the reply that says why it could not be made. */
function drawRoll(call: Call, reading: Reading, who: Found, purpose: string, by: RollBy, against: number | null, sum: { expression: string; total: number } | null): { out: JsonObject | Reply; draft: Draft | null } {
  const reply = call.reply();
  const turn = reading.turn;
  // A roll is drawn from the turn, who rolls and how many rolls the turn has recorded for them; a call of no turn, from its job or session and the call: no wording moves it.
  const rng = createRng(turn === null ? hashParts("rpe.roll", call.agent.job ?? call.scope.session, call.callId, who.id) : hashParts("rpe.roll", turn.id, who.id, String(rollsBefore(call, turn.id, who.id))));
  const data: JsonObject = { actor: who.id, for: purpose };
  if ("dice" in by) {
    let rolled;
    try {
      rolled = rollDice(by.dice, rng);
    } catch (error) {
      if (!(error instanceof DiceError)) throw error;
      return { out: reply.line("unreadable", { field: "dice", value: JSON.stringify(by.dice), wants: call.lines.line("wants_dice") ?? "" }).fail(), draft: null };
    }
    Object.assign(data, { check: "", notation: rolled.notation, dice: rolled.dice.filter((d) => d.kept).map((d) => d.value), natural: rolled.natural, total: rolled.total, dc: against, outcome: against === null ? "rolled" : rolled.total >= against ? "success" : "failure" });
  } else {
    // A difficulty given stands for any opposition the check has: nobody is named to roll against.
    const { vs: _vs, ...unopposed } = by.def;
    const ready = readyCheck(reading.registry, reading.ctx, against === null ? by.def : { ...unopposed, dc: String(against) }, { self: who.id, actor: who.id });
    if ("code" in ready) return { out: reply.line("not_applicable", { n: 1, op: "roll", code: ready.code }).fail(), draft: null };
    const rolled = rollCheck(ready, rng);
    Object.assign(data, { check: by.check, notation: ready.notation, dice: rolled.roll.dice.filter((d) => d.kept).map((d) => d.value), natural: rolled.natural, total: rolled.total, dc: ready.dc, outcome: rolled.outcome });
  }
  if (sum !== null) data.sum = { expression: sum.expression, total: sum.total };
  const draft = new Draft(reading, call);
  const bad = draft.applyAll([{ type: ENGINE_EVENTS.check, data }]);
  if (bad) return { out: reply.line("not_applicable", { n: 1, op: "roll", code: bad.code }).fail(), draft: null };
  draft.record(1, "roll", "engine", { source: null, precision: null, standing: null, marks: [] }, 0);
  return { out: data, draft };
}

/**
 * An expression of numbers worked out: + - * / and brackets, decimals, a percent sign (8% is 0.08). Its value, or null when it is
 * anything but that (a word, a division by nothing).
 */
function sumOf(text: string): number | null {
  const src = text.replace(/\s+/g, "");
  let at = 0;
  const factor = (): number | null => {
    const sign = src[at] === "-" ? -1 : 1;
    if (src[at] === "-" || src[at] === "+") at++;
    let value: number | null;
    if (src[at] === "(") {
      at++;
      value = expression();
      if (value === null || src[at] !== ")") return null;
      at++;
    } else {
      const m = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(src.slice(at));
      if (!m) return null;
      at += m[0].length;
      value = Number(m[0]);
    }
    while (src[at] === "%") {
      value /= 100;
      at++;
    }
    return sign * value;
  };
  const term = (): number | null => {
    let value = factor();
    while (value !== null && (src[at] === "*" || src[at] === "/")) {
      const op = src[at++];
      const next = factor();
      if (next === null || (op === "/" && next === 0)) return null;
      value = op === "*" ? value * next : value / next;
    }
    return value;
  };
  const expression = (): number | null => {
    let value = term();
    while (value !== null && (src[at] === "+" || src[at] === "-")) {
      const op = src[at++];
      const next = term();
      if (next === null) return null;
      value = op === "+" ? value + next : value - next;
    }
    return value;
  };
  const total = expression();
  return total !== null && at === src.length && Number.isFinite(total) ? Number(total.toPrecision(12)) : null;
}

export const ROLL: ToolSpec = {
  name: "roll",
  family: "state",
  tier: "write",
  lane: "engine",
  properties: { who: TEXT, for: TEXT, dice: TEXT, check: TEXT, against: WHOLE, sum: TEXT },
  required: [],
  example: { who: "wren", for: "whether she slips past the gate guard unseen", check: "stealth", against: 13 },
  async run(args, call) {
    const reply = call.reply();
    // A sum asked for is worked out as it is written: answered as data alone, or recorded with the roll it is part of.
    const expression = typeof args.sum === "string" && args.sum.trim() !== "" ? args.sum.trim() : undefined;
    const total = expression === undefined ? null : sumOf(expression);
    if (expression !== undefined && total === null) return reply.line("unreadable", { field: "sum", value: JSON.stringify(args.sum), wants: call.lines.line("wants_sum") ?? "" }).fail();
    const sum = expression !== undefined && total !== null ? { expression, total } : null;
    if (sum !== null && args.dice === undefined && args.check === undefined) return reply.data({ sum });
    const reading = readingOr(call, reply);
    if (reading === null) return reply;
    const who = foundOr(reading, reply, "who", args.who, "entity");
    if (who === null) return reply;
    const purpose = typeof args.for === "string" ? args.for.trim() : "";
    if (purpose === "") return reply.line("needs_field", { field: "for" }).fail();
    const dice = typeof args.dice === "string" && args.dice.trim() !== "" ? args.dice.trim() : undefined;
    const checkId = typeof args.check === "string" && args.check.trim() !== "" ? args.check.trim() : undefined;
    if ((dice === undefined) === (checkId === undefined)) return reply.line("needs_one_field", { fields: ["dice", "check"] }).fail();
    // A difficulty that reads as none is refused naming the field, never ignored.
    const said = args.against === undefined || args.against === null ? null : numberArg(args, "against");
    if (said === undefined) return reply.line("unreadable", { field: "against", value: JSON.stringify(args.against), wants: call.lines.line("wants_number") ?? "" }).fail();
    const against = said === null ? null : Math.round(said);
    const def = checkId === undefined ? null : checkOf(reading.doc, checkId);
    const by: RollBy | null = dice !== undefined ? { dice } : checkId !== undefined && def !== null ? { check: checkId, def } : null;
    if (by === null) {
      const ids = Object.keys(reading.doc.checks);
      const near = nearestOf(checkId ?? "", ids, call.settings).slice(0, call.settings.nearMatches);
      return reply.line("unknown", unknownFields(call.lines, "check", "check", checkId ?? "", near, [], ids.length === 0)).refusedWith({ field: "check", near: near.map((id) => ({ id, name: id, what: "check" })) }).fail();
    }
    // A check rolled against someone has no one to roll against here: it says what it needs.
    if ("check" in by && by.def.vs !== undefined && against === null) return reply.line("check_needs_against", { check: by.check }).fail();
    // Drawn inside the write that records it, on the state as it stands then, so a roll made at the same time for the same person is counted before this one and draws other dice.
    const worked = await commit(call, () => {
      const missing = call.reply();
      const now = readingOr(call, missing);
      return now === null ? { out: missing, draft: null } : drawRoll(call, now, who, purpose, by, against, sum);
    });
    if (worked.gone) return unreadable(call, worked.gone);
    if (worked.out instanceof Reply) return worked.out;
    const id = worked.done?.rows[0]?.id;
    return reply.data({ roll: { ...(id !== undefined ? { id: String(id) } : {}), who: `${who.name} [${who.id}]`, ...worked.out } });
  },
};
