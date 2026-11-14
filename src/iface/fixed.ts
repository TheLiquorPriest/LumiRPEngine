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
import { renderView } from "../store/words";
import { rulesetData } from "./bestiary";
import { type Call, oneOf, Reply, SEARCH_KINDS, type SearchKind, TEXT, type ToolSpec, WHOLE, YES_NO } from "./kit";
import { clockText, timeFrom } from "./ops-time";
import { missed, unknownFields } from "./ops";
import { type Found, isFound, Reading } from "./reading";
import { textOf } from "./texts";
import { commit, Draft } from "./writing";

/** A reading for the call, or the reply that says why there is none. */
export function readingOr(call: Call, reply: Reply): Reading | null {
  const r = Reading.of(call);
  if (r instanceof Reading) return r;
  reply.line(`no_${r.missing}`, { id: r.id }).fail();
  return null;
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
  else reply.line("unknown", missed(reading.lines, field, r, want));
  reply.fail();
  return null;
}

/** The tree's own name for the world's ruleset part, which `world_query` also reads. */
export const RULESET_POINT = "ruleset";

export const WORLD_QUERY: ToolSpec = {
  name: "world_query",
  family: "state",
  tier: "read",
  properties: { at: TEXT, depth: { anyOf: [WHOLE, oneOf(["full"])] }, due: TEXT, map: YES_NO },
  required: ["at"],
  example: { at: "thornbury", depth: 2, due: "six hours" },
  async run(args, call) {
    const reply = call.reply();
    const reading = readingOr(call, reply);
    if (reading === null) return reply;
    if (args.at === RULESET_POINT) return reply.data({ ruleset: rulesetData(reading.doc) });
    const at = foundOr(reading, reply, "at", args.at, "point");
    if (at === null) return reply;
    const depth = args.depth === "full" ? "full" : typeof args.depth === "number" && Number.isInteger(args.depth) && args.depth >= 0 ? args.depth : call.settings.queryDepth;
    const view = reading.view().query(at.ref, depth);
    if (view !== null) reply.tree(renderView(view, call.tree));
    if (typeof args.due === "string") {
      const to = timeFrom(reading, reading.state.world, args.due);
      if (to === null) return reply.line("unreadable", { field: "due", value: JSON.stringify(args.due), wants: reading.lines.line("wants_time") ?? "" }).fail();
      const from = reading.state.world.clock;
      const span = { from: clockText({ reading }, Math.min(from, to)), to: clockText({ reading }, Math.max(from, to)) };
      const due = call.deps.due;
      if (due === undefined) reply.data({ span }).line("due_unlisted", {});
      else {
        const items = due.due(reading.state, { from: Math.min(from, to), to: Math.max(from, to) }, at.ref);
        reply.data({ span, due: items.map((i) => ({ when: clockText({ reading }, i.at), kind: i.kind, ...(i.where !== undefined ? { where: i.where } : {}), ...(i.who !== undefined ? { who: i.who } : {}), what: i.what })) });
      }
    }
    if (args.map === true) {
      const map = call.deps.map;
      const place = at.ref.startsWith("place:") ? at.id : null;
      const text = map === undefined || place === null ? null : map.text({ state: reading.state, env: call.deps.env, place });
      if (text === null) reply.line("no_map", { at: `${at.name} [${at.id}]` });
      else reply.tree(text);
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
    const asked = typeof args.limit === "number" && Number.isInteger(args.limit) && args.limit > 0 ? args.limit : call.settings.searchHits;
    const hits = call.deps.search.search(reading.state, call.deps.env, words, { ...(args.kind !== undefined ? { kind: args.kind as SearchKind } : {}), limit: Math.min(asked, call.settings.searchHits) });
    if (hits.length === 0) return reply.line("none_found", { words });
    return reply.data({ hits: hits.map((h) => ({ ...h }) as JsonObject) });
  },
};

/** How many rolls the turn has recorded for someone: the next of theirs is drawn after these. Read inside the write that records the next, so two rolls made at once are counted apart. */
function rollsBefore(call: Call, turn: string, who: string): number {
  return call.deps.store.changes(turn).filter((c) => c.op === ENGINE_EVENTS.check && isRecord(c.value) && isRecord(c.value.data) && c.value.data.actor === who).length;
}

/** How a roll is made: dice by their notation, or a check of the world's by the id it was asked by. */
type RollBy = { dice: string } | { check: string; def: CheckDef };

/** A roll drawn and drafted on the state as it stands: what it came to, or the reply that says why it could not be made. */
function drawRoll(call: Call, reading: Reading, who: Found, purpose: string, by: RollBy, against: number | null): { out: JsonObject | Reply; draft: Draft | null } {
  const reply = call.reply();
  const turn = reading.turn;
  if (turn === null) return { out: reply.line("turn_needed", {}).fail(), draft: null };
  // A roll is drawn from the turn, who rolls and how many rolls the turn has recorded for them: no wording moves it.
  const rng = createRng(hashParts("rpe.roll", turn.id, who.id, String(rollsBefore(call, turn.id, who.id))));
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
    const ready = readyCheck(reading.registry, reading.ctx, against === null ? by.def : { ...by.def, dc: String(against) }, { self: who.id, actor: who.id });
    if ("code" in ready) return { out: reply.line("not_applicable", { n: 1, op: "roll", code: ready.code }).fail(), draft: null };
    const rolled = rollCheck(ready, rng);
    Object.assign(data, { check: by.check, notation: ready.notation, dice: rolled.roll.dice.filter((d) => d.kept).map((d) => d.value), natural: rolled.natural, total: rolled.total, dc: ready.dc, outcome: rolled.outcome });
  }
  const draft = new Draft(reading, call);
  const bad = draft.applyAll([{ type: ENGINE_EVENTS.check, data }]);
  if (bad) return { out: reply.line("not_applicable", { n: 1, op: "roll", code: bad.code }).fail(), draft: null };
  draft.record(1, "roll", "engine", { source: null, precision: null, standing: null, marks: [] }, 0);
  return { out: data, draft };
}

export const ROLL: ToolSpec = {
  name: "roll",
  family: "state",
  tier: "write",
  lane: "engine",
  properties: { who: TEXT, for: TEXT, dice: TEXT, check: TEXT, against: WHOLE },
  required: ["who", "for"],
  example: { who: "wren", for: "whether she slips past the gate guard unseen", check: "stealth", against: 13 },
  async run(args, call) {
    const reply = call.reply();
    const reading = readingOr(call, reply);
    if (reading === null) return reply;
    if (reading.turn === null) return reply.line("turn_needed", {}).fail();
    const who = foundOr(reading, reply, "who", args.who, "entity");
    if (who === null) return reply;
    const purpose = typeof args.for === "string" ? args.for.trim() : "";
    if (purpose === "") return reply.line("needs_field", { field: "for" }).fail();
    const dice = typeof args.dice === "string" && args.dice.trim() !== "" ? args.dice.trim() : undefined;
    const checkId = typeof args.check === "string" && args.check.trim() !== "" ? args.check.trim() : undefined;
    if ((dice === undefined) === (checkId === undefined)) return reply.line("needs_one_field", { fields: ["dice", "check"] }).fail();
    const against = typeof args.against === "number" && Number.isFinite(args.against) ? Math.round(args.against) : null;
    const def = checkId === undefined ? null : checkOf(reading.doc, checkId);
    const by: RollBy | null = dice !== undefined ? { dice } : checkId !== undefined && def !== null ? { check: checkId, def } : null;
    if (by === null) return reply.line("unknown", unknownFields(call.lines, "check", "check", checkId ?? "", Object.keys(reading.doc.checks).slice(0, call.settings.nearMatches))).fail();
    // Drawn inside the write that records it, on the state as it stands then, so a roll made at the same time for the same person is counted before this one and draws other dice.
    const worked = await commit(call, () => {
      const missing = call.reply();
      const now = readingOr(call, missing);
      return now === null ? { out: missing, draft: null } : drawRoll(call, now, who, purpose, by, against);
    });
    if (worked.out instanceof Reply) return worked.out;
    const id = worked.done?.rows[0]?.id;
    return reply.data({ roll: { ...(id !== undefined ? { id: String(id) } : {}), who: `${who.name} [${who.id}]`, ...worked.out } });
  },
};
