// What the reply told, recorded once it is written (`story_record`); where it says something against
// its turn, noted on it (`story_departure`); and two of the game master's own moves that had no
// tool: a thing put back where it is kept (`item_away`) and someone or something taken out of what
// holds it (`gm_take_out`).
//
// `story_record` stands in for the classic turn's read of its reply (`extract`), for the change
// types no other tool notes (`STORY_TYPES`). The calling agent says what the reply told, one change
// a call, in the read's own shape, and the engine does with it what it does with a read's own:
// - it is read as the read's parser reads one and checked by its type's channel (`noteFact`: money
//   in minor units, the reconciler's own marks dropped);
// - it is held to the reply where the read holds one: a change to an organization quotes the
//   reply's own words, and a change to someone's week is for someone the reply names;
// - its step is held to what the player and the world's author let the story move at once
//   (`boundProposal`);
// - it is staged as the change its channel makes of it (`applyProposals`, through the notes the
//   harness stages), under its own type's mode.
// It decides nothing: a fact names what happened, and a field its kind doesn't take is refused, so
// no call sets what only the engine does (the turn a change came from, a player's own say).
// Time the telling added (`time_advance`) is passed as `time_pass` passes a turn's (`passSpan`), no
// farther than a reply passes without asking.
//
// What the read asks the player about whatever the mode, a recorded change can't ask. Someone
// volunteering a task (`agendaAsks` on the other engines) and a field its world's author bounded in
// Build are therefore refused with why, never recorded unasked.
//
// The reply serves the turn: what it says against what the turn decided or the world holds is never
// written into the world. `story_departure` keeps it on the reply instead, a line each (what the
// reply says, what the world holds), where the player sees it and the next turn's author is told.
// It changes nothing of the world, so no mode and no card applies: only the story's tier, and the
// limits of what a reply keeps (`DEPARTURE_LIMITS`).
//
// The two moves go through the writer as the game master's own controls send them: Put it away is
// the item op `move` to where the thing is kept (`putAwaySpot`), Take out the edit `{op: "put"}`
// with no holder. The writer checks each as it checks any: the caller's tier, the change type's
// mode, the caps.

import { toolArgTextId } from "../../../../shared/agent-tools";
import { HARNESS_FAMILY } from "../../../../shared/harness-text-kit";
import { HARNESS_NOTE } from "../../../../shared/harness-texts";
import { DEPARTURE_LIMITS, STORY_NOTE, STORY_TOOL, STORY_TYPES, type StoryType } from "../../../../shared/harness-texts-story";
import { hashJson } from "../../../../shared/hash";
import { hasOwn, type JsonObject } from "../../../../shared/json";
import { ORG_FACT_TYPES } from "../../../../shared/role-prompts";
import { boundProposal } from "../../../../engine/bounds";
import { putAwaySpot } from "../../../../engine/thing-gm";
import { namedInText } from "../../../../packs/minds/core/fidelity";
import { quotesReply } from "../../../../packs/orgs/core/story";
import type { ToolOutcome } from "../../runtime";
import type { HarnessTurn } from "../harness-turn";
import { gmEdit, missing, needId, NOTE_TIER, noteFact, propose, refusedAnswer, tierRefusal, wordsArg } from "../propose";
import type { ToolReadView } from "../read-view";
import { type Resolved, resolveEntity, resolveNamedThing, resolvePerson, resolvePlace } from "../resolve";
import { argGiven, intArg, jsonObject, needText, objectArg, objectSchema, text } from "../schema";
import { checkOrPropose } from "../write/items";
import { type HarnessToolDefinition, stageChange, words } from "./kit";
import { passSpan } from "./time";

const RECORD = STORY_TOOL.record;
const AWAY = STORY_TOOL.away;
const TAKE_OUT = STORY_TOOL.takeOut;
const DEPARTURE = STORY_TOOL.departure;

/** How a field that names someone or something is found among what the caller's view may name. */
type Finder = (view: ToolReadView, said: string) => Resolved;

/**
 * One kind of change as the reply's read gives it (the extract step's own shapes): the fields it
 * takes, and those that name a person, a thing or a place (`find`), each read as the id it names
 * among what the caller's view may name, so one the view may not name reads as no one. Every other
 * field is its channel's own to read.
 */
interface Shape {
  fields: readonly string[];
  find?: Readonly<Record<string, Finder>>;
}

const SHAPES: Readonly<Record<StoryType, Shape>> = {
  // A place the world lacks is `place_make`'s, which puts them there with it: the read's `parent` has no use here.
  location: { fields: ["entity", "place"], find: { entity: resolveEntity, place: resolvePlace } },
  condition: { fields: ["who", "condition", "minutes", "clear"], find: { who: resolvePerson } },
  regard: { fields: ["from", "to", "axis", "delta"], find: { from: resolvePerson, to: resolvePerson } },
  // A payer or a payee is a person, or an account of one.
  transfer: { fields: ["from", "to", "amount", "method"], find: { from: resolveEntity, to: resolveEntity } },
  quantity: { fields: ["entity", "item", "delta"], find: { entity: resolveEntity, item: resolveNamedThing } },
  life: { fields: ["entity", "state"], find: { entity: resolvePerson } },
  knows: { fields: ["who", "fact"], find: { who: resolvePerson } },
  // Its place is the channel's to read: a place's id or name, or the words home and work.
  routine: { fields: ["entity", "change", "label", "days", "start", "end", "minutes", "activity", "place", "with", "replaces"], find: { entity: resolvePerson, with: resolvePerson } },
  // A change to an organization names its people and its organization by id or name as its channel reads them: among those the player character may know.
  membership: { fields: ["who", "org", "change", "position", "title", "by", "said"] },
  employment: { fields: ["who", "change", "org", "job", "title", "position", "rate", "pct", "hours", "basis", "by", "said"] },
  agenda: { fields: ["id", "status", "org", "said"] },
  vote: { fields: ["who", "org", "motion", "vote", "said"] },
  approval: { fields: ["who", "org", "request", "answer", "said"] },
  time_advance: { fields: ["minutes"] },
};

/**
 * The change a call wrote as `type`, read into the fact its channel takes: only the fields its kind
 * takes, each name as the id it names; or the answer that says what to fix.
 */
function factOf(view: ToolReadView, type: StoryType, args: JsonObject): { fact: JsonObject } | { refused: ToolOutcome } {
  const { fields, find = {} } = SHAPES[type];
  // What its kind takes, in the user's words: the answer wherever the change can't be read as written.
  const unread = { refused: view.refuse(STORY_NOTE.badFact, { type, shape: view.text(toolArgTextId(RECORD, type)) }) };
  const given = objectArg(args, type);
  if (given === null) return unread;
  // Someone volunteering a task: the read asks the player whatever the mode, which nothing staged here can.
  if (type === "agenda" && hasOwn(given, "offer")) return { refused: view.refuse(STORY_NOTE.offer) };
  const stray = Object.keys(given).find((field) => !fields.includes(field));
  if (stray !== undefined) return { refused: view.refuse(STORY_NOTE.noField, { type, field: stray, fields: fields.join(", ") }) };
  const fact: JsonObject = { type };
  for (const field of fields) {
    const value = given[field];
    // A model that fills every field writes one it means to leave out as null or as blank text.
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) continue;
    const finder = hasOwn(find, field) ? find[field] : undefined;
    if (!finder) {
      fact[field] = value;
      continue;
    }
    const names = typeof value === "string" ? [value] : Array.isArray(value) && value.every((name): name is string => typeof name === "string") ? value : null;
    if (names === null) return unread;
    const ids: string[] = [];
    for (const name of names) {
      const found = finder(view, name);
      if ("refused" in found) return found;
      ids.push(found.id);
    }
    fact[field] = typeof value === "string" ? (ids[0] ?? value) : ids;
  }
  return { fact };
}

/**
 * `fact` with its step held to what the story may move at once, as a reply's read is held
 * (`boundProposal`): cut to the largest step the player set for its type (Settings → Changes from
 * the reply) and to the field's own in Build. Or the answer that says why nothing is recorded: no
 * step at all, or a field Build says the story never changes, or asks first for, which a recorded
 * change can't.
 */
function fitted(view: ToolReadView, turn: HarnessTurn, type: StoryType, fact: JsonObject): { fact: JsonObject } | { refused: ToolOutcome } {
  const target = view.registry.proposals.get(type)?.boundTarget?.(fact, view.ctx) ?? null;
  const entity = target?.entity ?? [fact.entity, fact.who, fact.from].find((id): id is string => typeof id === "string");
  const step = turn.settings.extraction[type]?.maxDelta;
  const delta = typeof fact.delta === "number" ? fact.delta : undefined;
  // The type's own mode is asked where the change is staged: here only the field and the step speak.
  const bound = boundProposal(view.registry, view.world, view.state, { type, ...(entity !== undefined ? { entity } : {}), ...(target ? { field: target.field } : {}), ...(delta !== undefined ? { delta } : {}) }, { typeMode: "auto", ...(step !== undefined ? { typeMaxDelta: step } : {}) });
  if (target && bound.mode !== "auto") return { refused: view.refuse(STORY_NOTE.bound, { field: target.field, name: view.name(target.entity), mode: bound.mode }) };
  if (bound.delta === 0 && delta !== undefined && delta !== 0) return { refused: view.refuse(STORY_NOTE.noStep, { type }) };
  return { fact: bound.delta !== undefined ? { ...fact, delta: bound.delta } : fact };
}

export const STORY_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: RECORD,
    family: HARNESS_FAMILY.people,
    tier: "write",
    // Each kind of change is an argument of its own, written as JSON text: its fields are its kind's, and none is fixed for the schema to name.
    parameters: () => objectSchema(Object.fromEntries(STORY_TYPES.map((type) => [type, jsonObject()]))),
    async run(args, env) {
      const view = await env.reader.view();
      const turn = env.turn;
      if (!turn) return view.refuse(HARNESS_NOTE.noTurn);
      // Held here too, whatever lets the call through: time passed is staged with the turn itself, past the notes' own check.
      const below = tierRefusal(view, env, NOTE_TIER);
      if (below) return below;
      const reply = turn.reply;
      if (reply === null) return view.refuse(STORY_NOTE.afterReply);
      const given = STORY_TYPES.filter((type) => argGiven(args, type));
      const [type] = given;
      if (type === undefined || given.length > 1) return view.refuse(STORY_NOTE.oneChange, { types: STORY_TYPES.join(", "), count: String(given.length) });
      const read = view.read(() => factOf(view, type, args));
      if ("refused" in read) return read.refused;
      if (type === "time_advance") {
        const minutes = intArg(read.fact, "minutes");
        if (minutes === null || minutes <= 0) return view.refuse(STORY_NOTE.timeMinutes);
        const most = Math.min(turn.settings.time.askBeyondMinutes, turn.settings.agents.harnessLimits.timePassMinutes);
        if (minutes > most) return view.refuse(STORY_NOTE.timeAsk, { minutes: String(most) });
        const passed = passSpan(view, turn.runSeed, minutes, most);
        if ("stopped" in passed) return passed.stopped === "unit_cap" ? view.refuse(STORY_NOTE.timeTooMuch) : view.refuse(STORY_NOTE.timeAsk, { minutes: String(most) });
        const staged = await stageChange(view, turn, { key: hashJson(["lre.harness.time", view.state.clock, minutes]), changeType: "time_advance", events: passed.events, lines: [passed.line, ...passed.recorded], time: minutes, proposal: { type, minutes } });
        if ("refused" in staged) return staged.refused;
        return view.answer({ staged: { changeType: type, lines: [passed.line, ...passed.happened], lands: staged.lands } });
      }
      let fact = read.fact;
      if (ORG_FACT_TYPES.some((org) => org === type) && !quotesReply(typeof fact.said === "string" ? fact.said : "", reply.text)) return view.refuse(STORY_NOTE.notQuoted);
      if (type === "routine") {
        const who = typeof fact.entity === "string" ? fact.entity : view.pov;
        if (who !== view.pov && !namedInText(view.name(who), reply.text)) return view.refuse(STORY_NOTE.notNamed, { name: view.name(who) });
        // The reply's own message is the change's turn, which no call sets: it records where the change came from.
        fact = { ...fact, entity: who, turn: reply.messageId };
      }
      const fit = view.read(() => fitted(view, turn, type, fact));
      if ("refused" in fit) return fit.refused;
      return noteFact(view, env, fit.fact);
    },
  },
  {
    name: AWAY,
    family: HARNESS_FAMILY.items,
    tier: "write",
    parameters: () => objectSchema({ item: text(), why: text() }, ["item", "why"]),
    async run(args, env) {
      const view = await env.reader.view();
      if (!env.turn) return view.refuse(HARNESS_NOTE.noTurn);
      const item = needId(view, AWAY, args, "item", resolveNamedThing);
      if (typeof item !== "string") return item;
      const why = needText(view, AWAY, args, "why");
      if (typeof why !== "string") return why;
      const to = view.read(() => putAwaySpot(view.ctx, item));
      if (to === null) return view.refuse(STORY_NOTE.awayNowhere, { name: view.name(item) });
      return checkOrPropose(view, env, { do: "move", item, to, why }, false);
    },
  },
  {
    name: TAKE_OUT,
    family: HARNESS_FAMILY.places,
    tier: "write",
    parameters: () => objectSchema({ entity: text() }, ["entity"]),
    async run(args, env) {
      const view = await env.reader.view();
      if (!env.turn) return view.refuse(HARNESS_NOTE.noTurn);
      const entity = needId(view, TAKE_OUT, args, "entity", resolveEntity);
      if (typeof entity !== "string") return entity;
      return propose(view, env.writer, gmEdit({ op: "put", entity, into: null }));
    },
  },
  {
    name: DEPARTURE,
    family: HARNESS_FAMILY.turn,
    tier: "write",
    parameters: () => objectSchema({ lines: words() }, ["lines"]),
    async run(args, env) {
      const view = await env.reader.view();
      const turn = env.turn;
      if (!turn) return view.refuse(HARNESS_NOTE.noTurn);
      // Held here too, whatever lets the call through: lines of departure pass no writer, which would hold its caller to its tier.
      const below = tierRefusal(view, env, NOTE_TIER);
      if (below) return below;
      if (turn.reply === null || !turn.depart) return view.refuse(STORY_NOTE.departAfterReply);
      // One line given as text, not as a list, is a list of one.
      const raw = args.lines;
      const lines = typeof raw === "string" ? [raw.trim()].filter((line) => line !== "") : wordsArg(args, "lines");
      if (lines === null || lines.length === 0) return missing(view, DEPARTURE, "lines");
      const most = String(DEPARTURE_LIMITS.lines);
      if (lines.length > DEPARTURE_LIMITS.lines) return view.refuse(STORY_NOTE.departMany, { most, count: String(lines.length) });
      const long = lines.findIndex((line) => line.length > DEPARTURE_LIMITS.chars);
      if (long >= 0) return view.refuse(STORY_NOTE.departLong, { at: String(long + 1), chars: String(lines[long]?.length ?? 0), most: String(DEPARTURE_LIMITS.chars) });
      const kept = await turn.depart(lines);
      if ("refused" in kept) return refusedAnswer(kept);
      if ("full" in kept) return view.refuse(STORY_NOTE.departFull, { held: String(kept.full), most });
      return view.answer({ departures: { lines: kept.departures, lands: view.text(STORY_NOTE.departed) } });
    },
  },
];
