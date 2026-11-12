// A fight on the harness engine, played round by round through the combat pack as the classic turn
// plays one (`engine/turn.ts`: `combat.round` around the player character's action). The pack is
// used as it is: its effects start and end an encounter (`combat.start`, `combat.end`), its round
// service plays everyone's turns (`openRound`, `.after`), and a recorded `combat.decision` wins over
// its own tactics for a fighter's turn while it is still possible. Nothing here rolls or rules.
//
// What the classic engine asks a model (`npc.choose`: what a fighter does on its turn), the author
// decides here, or the fighter's own agent (`mind_fight`), or, said in so many words (`tactics`),
// the pack's own tactics. So a round is refused while anyone who has a choice has none recorded.
//
// - Each other fighter's next turn is read as the pack reads an `npc.choose` question (`fightChoices`:
//   its options as they will be when its turn starts). The pack's own query only answers while the
//   player character is up, so the turns due before theirs (they lost the initiative) are read here
//   from what the pack exports, the same way.
// - One call plays each other fighter at most once: the turns due before the player character's
//   play in a call of their own, then the round with the player character's action. A fighter's
//   choice is therefore always for one turn, its next.
// - The dice are the engine's, and nothing a call says is part of what they are drawn from: the
//   player character's action draws as `action_play` draws it (the turn, who rolls, how many rolls
//   the turn has recorded for them), and a round from the turn's seed and the fight as its record
//   has it (`roundSeed`). No choice a call gives, and no list of foes, moves them.
// - A round passes no time while the fight goes on (`time: 0`, as a classic turn inside a fight moves
//   no clock); the round that ends it leaves the turn's time to the author.
// - What a fight tool records is a change of the type "What the author plays" (`play`), a fighter's
//   own choice one of "Characters' minds" (`mind`): Never refuses it, Confirm puts it on the card.
// - An answer's lines and names are the engine's own, written for the game master: where the view
//   marks, each is marked as every read marks a secret (`marker`, `nameIn`).

import { HARNESS_FAMILY, HARNESS_NOTE } from "../../../../shared/harness-texts";
import { MINDS_NOTE } from "../../../../shared/harness-texts-minds";
import { PLAY_NOTE, PLAY_TOOL } from "../../../../shared/harness-texts-play";
import { hashJson, hashParts } from "../../../../shared/hash";
import type { EntityId } from "../../../../shared/ids";
import type { JsonObject } from "../../../../shared/json";
import type { LedgerEvent } from "../../../../shared/ledger";
import type { CombatDef } from "../../../../shared/world";
import { fightRound } from "../../../../engine/adjudication";
import { applyEffects } from "../../../../engine/effects";
import { materializeAll } from "../../../../engine/materialize";
import { labelOf, optionalQuery, optionalService, own, sliceOf } from "../../../../engine/pack-kit";
import { authorLines } from "../../../../engine/player-events";
import type { ReadContext } from "../../../../engine/registry";
import { createRng } from "../../../../engine/rng";
import { runRulesOnEvents } from "../../../../engine/rules";
import type { WorldState } from "../../../../engine/state";
import { Working } from "../../../../engine/working";
import { type FightOption, fightOptions, optionKey, turnKey, turnRefill } from "../../../../packs/combat/core/flow";
import { decisionsOf, type Encounter, encounterOf, fighterOf, PACK, povLeft, rulesOf, standing, writeEncounter } from "../../../../packs/combat/core/model";
import { buildEncounterView, type EncounterView } from "../../../../packs/combat/core/view";
import { characterSelf, PLAYER } from "../../../story/minds";
import type { ToolOutcome } from "../../runtime";
import { BOOLEAN, boolArg, wordsArg } from "../propose";
import { percent } from "../read/checks";
import type { ToolReadView } from "../read-view";
import { resolvePerson } from "../resolve";
import { argGiven, badValue, jsonObject, objectArg, objectSchema, text, textArg } from "../schema";
import { type Attempt, askedOf, attemptOf, attemptProperties, marker, type Played, rollAnswer } from "./checks";
import { type HarnessToolDefinition, stageChange, words } from "./kit";
import { authorTurn, playOn, retryNote } from "./play";

const READ = PLAY_TOOL.fightRead;
const START = PLAY_TOOL.fightStart;
const ROUND = PLAY_TOOL.fightRound;
const END = PLAY_TOOL.fightEnd;
const MIND = PLAY_TOOL.mindFight;

/** A fight's sides as the pack names them: the player character's, and the other. */
const SIDES = ["party", "foes"] as const;

/** A fight under way: the world's combat rules and the encounter. */
interface Fight {
  rules: CombatDef;
  enc: Encounter;
}

/** Another fighter's next turn, as a recorded decision names it and a round's gate reads it. */
interface DueTurn {
  who: EntityId;
  round: number;
  /** What a decision for this turn is recorded under (`combat.decision`). */
  key: string;
  options: FightOption[];
  /** The decision recorded for it, while it is still one of its options. */
  decided: string | null;
}

/** The fight a call acts on, or the answer that says there is none: a world without combat rules, or no fight under way. */
function fightUnderWay(view: ToolReadView): Fight | ToolOutcome {
  const rules = rulesOf(view.world);
  if (!rules) return view.refuse(PLAY_NOTE.noCombat);
  const enc = encounterOf(view.state);
  return enc ? { rules, enc } : view.refuse(PLAY_NOTE.noFight);
}

/**
 * What the fighter at `index` of the order may do when its turn starts: for whoever is up, as the
 * state has it; for anyone else, with the turn theirs and their per-turn budgets refilled, as the
 * pack reads an `npc.choose` question's options (`fightChoices`). Read on a state that shares
 * everything with the one read but the fight's own slice.
 */
function optionsAt(ctx: ReadContext, fight: Fight, index: number): FightOption[] {
  const { rules, enc } = fight;
  const f = enc.order[index];
  if (!f) return [];
  if (index === enc.turn) return fightOptions(ctx.registry, ctx.world, ctx.state, f.id);
  const then: WorldState = { ...ctx.state, packs: { ...ctx.state.packs, [PACK]: { ...sliceOf(ctx.state, PACK) } } };
  writeEncounter(then, { ...enc, turn: index, order: enc.order.map((p) => (p.id === f.id ? { ...p, left: { ...p.left, ...turnRefill(ctx, rules, p.id) } } : p)) });
  return fightOptions(ctx.registry, ctx.world, then, f.id);
}

/** Every other standing fighter's next turn, in the order they come, from whoever is up: the round it falls in, the key its decision has, and its options then. */
function dueTurns(ctx: ReadContext, fight: Fight): DueTurn[] {
  const { enc } = fight;
  const recorded = decisionsOf(ctx.state);
  const n = enc.order.length;
  const out: DueTurn[] = [];
  for (let k = 0; k < n; k++) {
    const index = (enc.turn + k) % n;
    const f = enc.order[index];
    if (!f || f.id === ctx.world.pov || !standing(ctx, enc, f)) continue;
    // Past the end of the order the turn is the next round's, as the pack keys it.
    const round = enc.round + Math.floor((enc.turn + k) / n);
    const key = turnKey(enc, round, f.id);
    const options = optionsAt(ctx, fight, index);
    const choice = own(recorded, key);
    out.push({ who: f.id, round, key, options, decided: choice !== undefined && options.some((o) => optionKey(o) === choice) ? choice : null });
  }
  return out;
}

/** Someone a fight's answer names, as the view names them: a person the player character can't see is marked as every read marks one. */
function nameIn(view: ToolReadView, ctx: ReadContext, id: EntityId): string {
  return view.mark(labelOf(ctx, id), view.entitySecrecy(id));
}

/** An option in words, as the pack labels an `npc.choose` choice, with its odds where it rolls. */
function optionWords(view: ToolReadView, ctx: ReadContext, o: FightOption): { label: string; odds?: Record<string, number> } {
  const odds = o.odds.odds;
  return { label: `${o.action.label}${o.target ? ` ${nameIn(view, ctx, o.target)}` : ""}`, ...(odds ? { odds: Object.fromEntries(Object.entries(odds).map(([outcome, p]) => [outcome, percent(p)])) } : {}) };
}

/** The pack's Encounter card as an answer gives it: without whose view it is, which the tool says, and without the palette's own options, which these tools give by key. */
function cardOf(card: EncounterView | null): Omit<EncounterView, "gm" | "actions"> | null {
  return card ? { round: card.round, turn: card.turn, yours: card.yours, order: card.order, economy: card.economy, log: card.log } : null;
}

/**
 * A fight as its tools answer it, read from `ctx` (the state a call read, or the one its round
 * left): the encounter as the game master sees it, what the player character may do on their turn,
 * each other fighter's next turn (`due`, only `who`'s when given) with its options by key, and what
 * the next call needs. `tell` gives a line as the view may have it (`marker`).
 */
function fightAnswer(view: ToolReadView, ctx: ReadContext, fight: Fight, tell: (line: string) => string, who: EntityId | null = null): object {
  const { enc } = fight;
  const pov = ctx.world.pov;
  const at = enc.order.findIndex((f) => f.id === pov);
  const me = enc.order[at];
  const up = enc.order[enc.turn];
  const fighting = me !== undefined && standing(ctx, enc, me);
  // The game master's card names everyone in the fight and tells its log as it happened: each name and line as the view may have it.
  const card = cardOf(optionalQuery(ctx, "combat.gm")?.(ctx) ?? null);
  return {
    encounter: card && { ...card, turn: tell(card.turn), order: card.order.map((row) => (row.id === null || row.you ? row : { ...row, name: view.mark(row.name, view.entitySecrecy(row.id)) })), log: card.log.map(tell) },
    player: { ...view.entity(pov), up: fighting && up?.id === pov, out: !fighting, actions: fighting ? optionsAt(ctx, fight, at).map((o) => ({ action: o.action.id, params: o.params, ...optionWords(view, ctx, o) })) : [] },
    due: dueTurns(ctx, fight)
      .filter((d) => who === null || d.who === who)
      .map((d) => ({ who: { id: d.who, name: nameIn(view, ctx, d.who) }, round: d.round, options: d.options.map((o) => ({ key: optionKey(o), ...optionWords(view, ctx, o) })), ...(d.decided !== null ? { decided: d.decided } : {}) })),
    next: !fighting ? view.text(PLAY_NOTE.nextOut) : up?.id === pov ? view.text(PLAY_NOTE.nextAction) : view.text(PLAY_NOTE.nextOthers, { who: up ? nameIn(view, ctx, up.id) : "" }),
  };
}

/**
 * The choices in force for the turns due: those already recorded, and the ones a call gives
 * (`decisions`: each fighter's option key, by their id or name), with the events that record what
 * it gives. Or the answer that says which choice it can't take.
 */
function decisionsFor(view: ToolReadView, args: JsonObject, due: readonly DueTurn[]): { events: LedgerEvent[]; chosen: Record<string, string> } | ToolOutcome {
  const given = objectArg(args, "decisions");
  if (argGiven(args, "decisions") && given === null) return view.refuse(PLAY_NOTE.badDecisions);
  const chosen: Record<string, string> = {};
  for (const d of due) if (d.decided !== null) chosen[d.key] = d.decided;
  const events: LedgerEvent[] = [];
  for (const [said, value] of Object.entries(given ?? {})) {
    const named = resolvePerson(view, said);
    if ("refused" in named) return named.refused;
    const turnOf = due.find((d) => d.who === named.id);
    if (!turnOf) return view.refuse(PLAY_NOTE.notDue, { name: view.name(named.id) });
    const choice = typeof value === "string" ? value.trim() : "";
    if (!turnOf.options.some((o) => optionKey(o) === choice)) return view.refuse(PLAY_NOTE.badChoice, { name: view.name(named.id), choice: typeof value === "string" ? value : JSON.stringify(value), options: turnOf.options.map(optionKey).join(", ") });
    if (chosen[turnOf.key] !== choice) events.push({ type: "combat.decision", data: { key: turnOf.key, choice } });
    chosen[turnOf.key] = choice;
  }
  return { events, chosen };
}

/**
 * What a round's dice are drawn from: the turn's seed and the fight as the call read it in the
 * chat's record (its id, its round, whose turn it is and what everyone has left). Nothing a call
 * says is part of it: not what was decided for the turns due, not the player character's action,
 * which draws as any played attempt does (`rollSeed`).
 */
export function roundSeed(turnSeed: string, state: Readonly<WorldState>): string {
  return hashParts("lre.harness.fight", turnSeed, hashJson(sliceOf(state, PACK).encounter ?? null));
}

/** Who is down once `events` have played, by name: those the fight had down before, with each fall and each rise since. */
function downAfter(view: ToolReadView, ctx: ReadContext, enc: Encounter, events: readonly LedgerEvent[]): string[] {
  const down = new Set(enc.order.filter((f) => f.down).map((f) => f.id));
  for (const e of events) {
    if (e.type !== "combat.down" || !("data" in e) || typeof e.data.entity !== "string") continue;
    if (e.data.down === true) down.add(e.data.entity);
    else down.delete(e.data.entity);
  }
  return [...down].map((id) => nameIn(view, ctx, id));
}

export const FIGHT_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: READ,
    family: HARNESS_FAMILY.fights,
    tier: "read",
    parameters: () => objectSchema({ who: text() }),
    async run(args, env) {
      const view = await env.reader.view();
      const rules = rulesOf(view.world);
      const enc = rules ? encounterOf(view.state) : null;
      if (!rules || !enc) return view.answer({ fight: false, note: view.text(rules ? PLAY_NOTE.noFight : PLAY_NOTE.noCombat) });
      const said = textArg(args, "who");
      const named = said === null ? null : resolvePerson(view, said);
      if (named && "refused" in named) return named.refused;
      const fight = { rules, enc };
      return view.read(() => {
        if (named && named.id !== view.pov && !dueTurns(view.ctx, fight).some((d) => d.who === named.id)) return view.refuse(PLAY_NOTE.notDue, { name: view.name(named.id) });
        return view.answer({ fight: true, ...fightAnswer(view, view.ctx, fight, marker(view), named?.id ?? null) });
      });
    },
  },
  {
    name: START,
    family: HARNESS_FAMILY.fights,
    tier: "write",
    parameters: () => objectSchema({ foes: words() }),
    async run(args, env) {
      const view = await env.reader.view();
      const turn = authorTurn(view, env, START);
      if ("text" in turn) return turn;
      const { registry: reg, world, state, pov } = view;
      const rules = rulesOf(world);
      if (!rules) return view.refuse(PLAY_NOTE.noCombat);
      if (encounterOf(state)) return view.refuse(PLAY_NOTE.fightOn);
      const foes: EntityId[] = [];
      for (const said of wordsArg(args, "foes") ?? []) {
        const named = resolvePerson(view, said);
        if ("refused" in named) return named.refused;
        foes.push(named.id);
      }
      // Drawn from the turn and the moment alone: whom the call names moves no dice.
      const seed = hashParts("lre.harness.fight.start", turn.seed, String(state.clock));
      const w = new Working(reg, world, state);
      // Whoever the call puts in the fight is given their detail first, as the action that starts one gives its participants theirs: initiative reads the sheet the fight will.
      for (const id of [pov, ...foes]) materializeAll(reg, w, id, turn.runSeed);
      // The ids are taken as given, never as a formula or a binding's name.
      const out = applyEffects(reg, w, [{ type: "combat.start", args: { foes } }], { bindings: { self: pov }, rng: createRng(seed), literal: true });
      const rejected = out.rejected[0];
      if (rejected) return view.refuse(PLAY_NOTE.noStart, { why: rejected.rejection.reason });
      runRulesOnEvents(reg, w, out.applied, { seed });
      const enc = encounterOf(w.state);
      if (!enc) return view.refuse(PLAY_NOTE.noStart, { why: w.dropped.at(-1)?.rejection.reason ?? "" });
      const lines = authorLines(reg, w.world, w.state, w.events, w.events.length);
      const staged = await stageChange(view, turn, { key: hashJson(["lre.harness.fight.start", seed, w.events]), changeType: "play", events: [...w.events], lines });
      if ("refused" in staged) return staged.refused;
      return view.read(() => {
        const tell = marker(view);
        return view.answer({ started: { lines: lines.map(tell), lands: staged.lands }, ...fightAnswer(view, w.ctx, { rules, enc }, tell) });
      });
    },
  },
  {
    name: ROUND,
    family: HARNESS_FAMILY.fights,
    tier: "write",
    parameters: (world) => {
      const { action, params, rating, reason, outcomes } = attemptProperties(world);
      return objectSchema({ action, params, rating, reason, outcomes, decisions: jsonObject(), tactics: BOOLEAN });
    },
    async run(args, env) {
      const view = await env.reader.view();
      const turn = authorTurn(view, env, ROUND);
      if ("text" in turn) return turn;
      const fight = fightUnderWay(view);
      if ("text" in fight) return fight;
      const { rules, enc } = fight;
      const { registry: reg, world, state, ctx, pov } = view;
      const me = fighterOf(enc, pov);
      const up = enc.order[enc.turn];
      const fighting = me !== undefined && standing(ctx, enc, me);
      const acts = argGiven(args, "action");
      if (fighting && up?.id === pov && !acts) return view.refuse(PLAY_NOTE.needsAction, { name: view.name(pov) });
      // The turns due before the player character's play in a call of their own: with the action in the same call, the pack would go on into whoever is up's next turn, which no one was asked about.
      if (fighting && up !== undefined && up.id !== pov && acts) return view.refuse(PLAY_NOTE.notUp, { up: view.name(up.id), name: view.name(pov) });
      const played = view.read((): { w: Working; attempt: Attempt | null; act: Played | null; seed: string; happened: string[] } | ToolOutcome => {
        const due = dueTurns(ctx, fight);
        const decided = decisionsFor(view, args, due);
        if ("text" in decided) return decided;
        // A player character who is no longer where the fight is has left it: the pack ends it before anyone acts, so no one has to choose.
        const open = povLeft(state, world, enc) ? [] : due.filter((d) => d.options.length > 1 && own(decided.chosen, d.key) === undefined);
        if (open.length > 0 && boolArg(args, "tactics") !== true) return view.refuse(PLAY_NOTE.undecided, { who: open.map((d) => view.name(d.who)).join(", ") });
        // The round's action is the player character's, whoever the call may name.
        const asked = acts ? askedOf(view, ROUND, { ...args, actor: pov }) : null;
        if (asked && !("request" in asked)) return asked;
        const attempt = asked ? attemptOf(view, asked, args) : null;
        if (attempt && !("asked" in attempt)) return attempt;
        const w = new Working(reg, world, state);
        w.applyAll(decided.events);
        const seed = roundSeed(turn.seed, state);
        const round = optionalService(w.ctx, "combat.round")?.(w, createRng(seed));
        if (!round) return view.refuse(PLAY_NOTE.noCombat);
        // What the round service says happened is the classic turn's own telling of a fight, in the order it happened.
        if (!attempt) return { w, attempt, act: null, seed, happened: round.after(null) };
        // The action's dice fall here, once, as `action_play` rolls an attempt: the first the call learns of them is a roll the round records.
        const act = playOn(view, w, turn, attempt);
        if (!("res" in act)) return act;
        return { w, attempt, act, seed, happened: round.after({ resolution: act.res, params: attempt.asked.request.params ?? {} }) };
      });
      if ("text" in played) return played;
      const { w, attempt, act, seed, happened } = played;
      const events = [...w.events];
      if (events.length === 0 && !act) return view.refuse(PLAY_NOTE.nothing);
      const after = encounterOf(w.state);
      // A round with nothing to record (an attempt the fight keeps no trace of) is answered, not staged.
      const staged = events.length > 0 ? await stageChange(view, turn, { key: hashJson(["lre.harness.fight.round", seed, events]), changeType: "play", events, lines: authorLines(reg, w.world, w.state, events, events.length), ...(after ? { time: 0 } : {}) }) : null;
      if (staged && "refused" in staged) return staged.refused;
      return view.read(() => {
        const tell = marker(view);
        return view.answer({
          round: enc.round,
          ...(attempt && act ? { action: { ...rollAnswer(view, attempt, act.res, tell), ...retryNote(view, attempt, act.res) } } : {}),
          happened: happened.map(tell),
          down: downAfter(view, w.ctx, enc, events),
          ended: after === null,
          ...(staged ? { lands: staged.lands } : {}),
          ...(after ? fightAnswer(view, w.ctx, { rules, enc: after }, tell) : { next: view.text(PLAY_NOTE.ended) }),
        });
      });
    },
  },
  {
    name: END,
    family: HARNESS_FAMILY.fights,
    tier: "write",
    parameters: () => objectSchema({ winner: text(SIDES), break_off: BOOLEAN }),
    async run(args, env) {
      const view = await env.reader.view();
      const turn = authorTurn(view, env, END);
      if ("text" in turn) return turn;
      const fight = fightUnderWay(view);
      if ("text" in fight) return fight;
      const { registry: reg, world, state } = view;
      const said = textArg(args, "winner");
      const winner = SIDES.find((side) => side === said);
      if (said !== null && winner === undefined) return badValue(view, END, "winner", said, SIDES);
      const seed = hashParts("lre.harness.fight.end", turn.seed, fightRound(view.ctx) ?? "");
      const w = new Working(reg, world, state);
      if (boolArg(args, "break_off") === true) {
        // As the classic turn ends a fight before a time skip the player asked for (`skipPastFight`).
        optionalService(w.ctx, "combat.break_off")?.(w, seed);
      } else {
        const out = applyEffects(reg, w, [{ type: "combat.end", args: winner !== undefined ? { winner } : {} }], { bindings: { self: world.pov }, rng: createRng(seed), literal: true });
        const rejected = out.rejected[0];
        if (rejected) return view.refuse(HARNESS_NOTE.eventRefused, { reason: rejected.rejection.reason, tool: END });
        // A world rule may hear a fight's end (an award, say), as it hears one the round service records.
        runRulesOnEvents(reg, w, out.applied, { seed });
      }
      if (encounterOf(w.state)) return view.refuse(HARNESS_NOTE.eventRefused, { reason: w.dropped.at(-1)?.rejection.reason ?? "", tool: END });
      const lines = authorLines(reg, w.world, w.state, w.events, w.events.length);
      const staged = await stageChange(view, turn, { key: hashJson(["lre.harness.fight.end", seed, w.events]), changeType: "play", events: [...w.events], lines });
      if ("refused" in staged) return staged.refused;
      return view.answer({ ended: { lines: view.read(() => lines.map(marker(view))), lands: staged.lands }, next: view.text(PLAY_NOTE.ended) });
    },
  },
  {
    name: MIND,
    family: HARNESS_FAMILY.mind,
    tier: "write",
    parameters: () => objectSchema({ choice: text() }),
    async run(args, env) {
      const view = await env.reader.view();
      // Who the fighter is comes from the call's `as`, never from an argument: the player's character fights as the player plays them, through the author's fight_round.
      const mine = await characterSelf(view, env, MIND);
      if (!("who" in mine)) return mine;
      if (mine.who === PLAYER) return view.refuse(MINDS_NOTE.playerFights);
      const { turn, who } = mine;
      const { registry: reg, world, state, ctx } = view;
      const rules = rulesOf(world);
      const enc = rules ? encounterOf(state) : null;
      const due = rules && enc ? view.read(() => dueTurns(ctx, { rules, enc }).find((d) => d.who === who)) : undefined;
      if (!due) return view.refuse(PLAY_NOTE.mindNoTurn, { name: view.name(who) });
      const choice = textArg(args, "choice");
      if (choice === null) {
        // The pack's own Encounter card, read with this fighter as its point of view: their own state exactly, anyone else's as far as they can tell.
        const seen = view.read(() => cardOf(buildEncounterView(reg.context({ ...world, pov: who }, state))));
        return view.answer({ you: view.entity(who), fight: seen, round: due.round, options: due.options.map((o) => ({ key: optionKey(o), ...optionWords(view, ctx, o) })), ...(due.decided !== null ? { decided: due.decided } : {}), note: view.text(PLAY_NOTE.mindChoose) });
      }
      const picked = due.options.find((o) => optionKey(o) === choice);
      if (!picked) return view.refuse(PLAY_NOTE.badChoice, { name: view.name(who), choice, options: due.options.map(optionKey).join(", ") });
      const { label } = optionWords(view, ctx, picked);
      const staged = await stageChange(view, turn, { key: hashJson(["lre.harness.fight.decision", due.key, choice]), changeType: "mind", events: [{ type: "combat.decision", data: { key: due.key, choice } }], lines: [view.text(PLAY_NOTE.decided, { name: view.name(who), round: String(due.round), choice: label })] });
      if ("refused" in staged) return staged.refused;
      return view.answer({ decided: { choice, label, round: due.round, lands: staged.lands }, note: view.text(PLAY_NOTE.mindDecided) });
    },
  },
];
