// The minds' knowledge step (DESIGN §24.11): after the reply, beside the read, who learned what that
// matters to them. The story itself is what everyone there knows of a scene; this records only the
// few facts that would change what someone does, says, hides or believes (a secret, a revelation, a
// lie, what they would act on…), each saying why it matters and to whom, as its default wording says.
// One call per scene by default, or one per character (Settings → Minds → Knowledge), for everyone
// who could perceive the turn: the player character and whoever was there with them.
//
//   knowledgeContext  what the call reads: what happened (the player's message, the reply, the turn's
//                     events and what the read found in it), who could perceive it and from when,
//                     the facts in play by id, and each person's holdings, witness log (by ref) and
//                     traits, within the user's tokens (`stepTokens`).
//   checkKnowledge    its answer, checked as the engine checks every proposal: a new fact says why it
//                     matters and to whom; a witnessing reaches
//                     everyone there throughout but whom the answer says missed it, and no one there
//                     for only part of the turn; a teller holds what they tell; an inference rests only
//                     on facts its person holds and lines of their own witness log; a confidence runs
//                     from 0 to 1. An inference under the threshold is kept, as a suspicion. Within the
//                     user's limits (`factsPerTurn`, `learningsPerTurn`, `factsPerChat`, `holdersPerFact`,
//                     `claimChars`). It returns the learnings of everyone but the player character as
//                     events, each whole with the facts it names that the turn didn't start with, and
//                     the player character's own as `learn` and `reveal` changes (C4), whose modes decide
//                     them (`backend/runtime.ts`). With knowledge on, telling is this step's alone: a told
//                     learning adds the listener's `told` witness entry, and the memory step records none.
// Every name the model gives is resolved to someone in the world (`named`), "you" being the player
// character, who never infers or doubts here: what they make of things is the player's.

import type { EntityId, MessageId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { FactId, FactTruth, Holding, HoldingBelief, KeptFrom, KnowledgeFact, KnowledgeProposal, KnowledgeSettings, KnowledgeTextId, LearnEventData, MindsMemoryConfig, PresenceEventData } from "../shared/minds";
import { claimFactId, FACT_TRUTHS, fillText, HOLDING_BELIEFS, isConfidence, isWitnessRef, knowledgeText, knowledgeThreshold, MIND_TEXT_CAPS, MINDS_EVENTS, parseFactId, witnessRef } from "../shared/minds";
import { applyMarks } from "../shared/secret-marks";
import type { WorldDoc } from "../shared/world";
import { calendarOf, formatClock } from "../engine/calendar";
import { own } from "../engine/pack-kit";
import type { Registry } from "../engine/registry-impl";
import { placeOfEntity } from "../engine/scope";
import type { WorldState } from "../engine/state";
import { unrevealedSecretFacts } from "../engine/visibility";
import { hiddenNameCheck } from "../engine/player-events";
import { capText } from "../packs/minds/core/edit";
import { learnedWitness } from "../packs/minds/core/events";
import { factsOf, holdingLine, latestTurns, rankedHoldings, type HoldingWords } from "../packs/minds/core/knowledge";
import { worldSecrets } from "../packs/minds/core/knowledge-section";
import { readCharacter, readKnowledge, readSlice } from "../packs/minds/core/state";
import { sectionTokens } from "./book";
import { readableReply } from "./json-hiding";
import { sheetLines } from "./minds-context";

/** One turn as the knowledge step reads it. */
export interface KnowledgeTurn {
  reg: Registry;
  world: WorldDoc;
  /** The state it reads and checks against: the reply's, with this turn's presence and seeding in it. */
  state: Readonly<WorldState>;
  /** The state the reply was written in, before the turn's minds events: each learning carries every fact it names that this doesn't hold. */
  before: Readonly<WorldState>;
  messageId: MessageId;
  user: string;
  reply: string;
  /** Who perceived it: heard the player's message (`said`), met at its end (`met`), left partway (`left`). */
  presence: { said: PresenceEventData; met: PresenceEventData | null; left: readonly EntityId[] };
  /** What the turn's planned events showed, and what the reply's read found in it, in words. */
  happened: readonly string[];
  settings: KnowledgeSettings;
  memory: Pick<MindsMemoryConfig, "witness">;
  hideJson: boolean;
  /** The lore pinned to the knowledge step (Build → Pinned lore), as lines read for it (`pinnedLines`). */
  pinned: readonly string[];
  /** A person a model named: by id, whole name, or a word of their name no one else has. */
  named(name: string): EntityId | null;
}

/** Everyone who could perceive the turn: the player character, then whoever was there, each once. */
export function perceivers(turn: Pick<KnowledgeTurn, "world" | "presence">): EntityId[] {
  return [...new Set([turn.world.pov, ...turn.presence.said.who, ...(turn.presence.met?.who ?? [])])];
}

/** The calls a turn's knowledge step makes, each the people it is about: one for the scene, or one per person. */
export function knowledgeBatches(turn: Pick<KnowledgeTurn, "world" | "presence" | "settings">): EntityId[][] {
  const people = perceivers(turn);
  return turn.settings.batch === "character" ? people.map((who) => [who]) : [people];
}

/** A person as the step names them: their name and id, the player character's own as such (`stepYou`). */
function label(turn: Pick<KnowledgeTurn, "state" | "world" | "settings">, id: EntityId): string {
  const name = own(turn.state.entities, id)?.name ?? id;
  return fillText(knowledgeText(turn.settings, id === turn.world.pov ? "stepYou" : "stepPerson"), { name, id });
}

/**
 * The knowledge step's user message for one call (`batch`, the people it is about): what happened,
 * who could perceive it and from when, the facts in play, and each person's holdings, witness log and
 * traits. Within `stepTokens`: what happened and who perceived it come first, then every person's
 * lines one round at a time (their best holding, their latest witness line, their next…), so the
 * limit cuts each person's least, and the reply's beginning goes first when even that is over it.
 */
export function knowledgeContext(turn: KnowledgeTurn, batch: readonly EntityId[]): string {
  const { world, state, settings, presence } = turn;
  const text = (id: KnowledgeTextId): string => knowledgeText(settings, id);
  const cal = calendarOf(world);
  const pov = world.pov;
  const slice = readSlice(state);
  const reader = { world, state };
  const claim = (fact: KnowledgeFact | undefined, id: FactId): string => applyMarks(fact?.claim ?? id, reader, "marked");
  const words: HoldingWords = { texts: settings, threshold: knowledgeThreshold(slice), nameOf: (id) => own(state.entities, id)?.name ?? id };
  const people = perceivers(turn);
  const here = placeOfEntity(state, pov);
  const play = { here: [...people, ...(here ? [here] : [])], recent: latestTurns(slice, settings.inPlayTurns), secret: worldSecrets(turn.reg.context(world, state)) };
  const block = (title: string, lines: readonly string[]): string => (lines.length > 0 ? `## ${title}\n${lines.join("\n")}` : "");
  const story = readableReply(turn.reply, turn.hideJson).trim();
  const happened = (reply: string): string =>
    block(text("stepHappened"), [
      ...(turn.user.trim() !== "" ? [fillText(text("stepSaid"), { name: label(turn, pov), text: turn.user.trim() })] : []),
      ...(reply !== "" ? [fillText(text("stepStory"), { text: reply })] : []),
      ...turn.happened.map((l) => `- ${l}`),
    ]);
  const met = presence.met?.who ?? [];
  const present = block(
    text("stepPresent"),
    people.map((id) => {
      const when = id === pov ? text("stepThroughout") : presence.left.includes(id) ? text("stepLeft") : presence.said.who.includes(id) ? text("stepThroughout") : met.includes(id) ? text("stepCame") : text("stepThroughout");
      return `- ${label(turn, id)}: ${when}`;
    }),
  );
  // The facts in play: everything the people here hold, and what the latest turns taught anyone.
  const facts = factsOf(slice);
  const inPlay = new Set<FactId>();
  for (const id of people) for (const h of rankedHoldings(slice, id, play)) inPlay.add(h.id);
  for (const [id, f] of Object.entries(facts)) if (f.source?.msg && play.recent.has(f.source.msg)) inPlay.add(id);
  const factLines = [...inPlay].sort().map((id) => {
    const f = own(facts, id);
    return `- [${id}] ${claim(f, id)}${f?.truth === "open" ? ` ${text("stepOpen")}` : f?.truth === "false" ? ` ${text("stepFalse")}` : ""}`;
  });
  // Each person's lines, best first: who they are, then holdings and witness lines in turn.
  const persons = batch.map((id) => {
    const holdings = rankedHoldings(slice, id, play).map((h) => `- [${h.id}] ${holdingLine(claim(h.fact, h.id), h.holding, words)}`);
    const log = readCharacter(state, id).witness;
    const witness = log
      .slice(Math.max(0, log.length - turn.memory.witness.show))
      .reverse()
      .map((w) => `- [${witnessRef(w)}] ${formatClock(cal, w.at)}, ${w.how === "told" ? fillText(text("told"), { by: w.by ? (own(state.entities, w.by)?.name ?? w.by) : text("stepSomeone") }) : text("witnessed")}: ${w.what}`);
    const traits = id === pov ? [] : sheetLines({ reg: turn.reg, world, state, who: id });
    return { id, traits, holdings, witness };
  });
  const render = (reply: string, taken: Map<EntityId, { holdings: number; witness: number }>): string =>
    [
      happened(reply),
      present,
      block(text("stepFacts"), factLines),
      block(text("stepPinned"), turn.pinned),
      block(
        text("stepPeople"),
        persons.map((p) => {
          const n = taken.get(p.id) ?? { holdings: 0, witness: 0 };
          return [`### ${label(turn, p.id)}`, ...(p.traits.length > 0 ? [text("stepTraits"), ...p.traits] : []), text("stepHolds"), ...(n.holdings > 0 ? p.holdings.slice(0, n.holdings) : [`- ${text("stepNothing")}`]), ...(n.witness > 0 ? [text("stepWitnessed"), ...p.witness.slice(0, n.witness)] : [])].join("\n");
        }),
      ),
    ]
      .filter((part) => part !== "")
      .join("\n\n");
  const limit = settings.stepTokens;
  const none = new Map<EntityId, { holdings: number; witness: number }>();
  // The reply whole, or its end within the limit with nothing else of each person's.
  let reply = story;
  while (reply !== "" && sectionTokens(render(reply, none)) > limit) reply = reply.length > 40 ? `…${reply.slice(Math.ceil(reply.length / 4)).replace(/^\S*\s+/, "")}` : "";
  const taken = new Map(persons.map((p) => [p.id, { holdings: 0, witness: 0 }]));
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of persons) {
      const n = taken.get(p.id) ?? { holdings: 0, witness: 0 };
      for (const part of ["holdings", "witness"] as const) {
        if (n[part] >= p[part].length) continue;
        n[part]++;
        if (sectionTokens(render(reply, taken)) > limit) n[part]--;
        else grew = true;
      }
    }
  }
  return render(reply, taken);
}

/** What one call's answer gives, checked: the learnings of everyone but the player character, their own changes, and what was refused, with why. */
export interface KnowledgeChecked {
  events: LedgerEvent[];
  proposals: KnowledgeProposal[];
  refused: string[];
}

const str = (v: JsonValue | undefined): string => (typeof v === "string" ? v.trim() : "");
const list = (v: JsonValue | undefined): JsonValue[] => (Array.isArray(v) ? v : []);

/**
 * What a turn's knowledge step has spent of its limits, across its calls: the new facts it made
 * (`factsPerTurn`, `factsPerChat`), its learnings (`learningsPerTurn`), and the facts whose
 * witnessing it has charged, each once in the turn, however many calls give it.
 */
export interface KnowledgeSpent {
  facts: Set<FactId>;
  learnings: number;
  witnessed: Set<FactId>;
}

/**
 * One call's answer, checked against the turn (see the header). `batch` is who the call was about:
 * only they learn, infer or doubt from it. Learnings are checked in the answer's order, each on what
 * the ones before it left, so a fact someone learns may be told on, or reasoned from, further down.
 */
export function checkKnowledge(turn: KnowledgeTurn, batch: readonly EntityId[], raw: JsonValue, spent: KnowledgeSpent = { facts: new Set(), learnings: 0, witnessed: new Set() }): KnowledgeChecked {
  const out: KnowledgeChecked = { events: [], proposals: [], refused: [] };
  if (!isRecord(raw)) return out;
  const { world, state, settings } = turn;
  const pov = world.pov;
  const k = readKnowledge(state);
  const begun = readKnowledge(turn.before).facts;
  const present = new Set(perceivers(turn));
  const scene = turn.presence.said.place ?? turn.presence.met?.place ?? placeOfEntity(state, pov);
  const at = state.clock;
  const who = (name: string): EntityId | null => (/^(you|the player character|player character)$/i.test(name.trim()) ? pov : turn.named(name));
  const nameOf = (id: EntityId): string => own(state.entities, id)?.name ?? id;
  const refuse = (why: string): void => {
    out.refused.push(why);
  };
  // The holdings and witness logs as this answer leaves them, and every fact it may name.
  const facts = new Map<FactId, KnowledgeFact>(Object.entries(k.facts));
  const holding = new Map<EntityId, Map<FactId, Holding>>();
  const heldBy = (id: EntityId): Map<FactId, Holding> => {
    const known = holding.get(id) ?? new Map(Object.entries(own(k.holdings, id) ?? {}));
    holding.set(id, known);
    return known;
  };
  const seen = new Map<EntityId, Set<string>>();
  const seenBy = (id: EntityId): Set<string> => {
    const refs = seen.get(id) ?? new Set(readCharacter(state, id).witness.map(witnessRef));
    seen.set(id, refs);
    return refs;
  };
  // New facts, by the answer's own refs, and each one's words as the step wrote them, before they are cut to a claim (`claimChars`).
  const refs = new Map<string, FactId>();
  const written = new Map<FactId, string>();
  // The chat's claims as the turn began, and each new one this turn makes, once whichever call makes it (`spent`).
  const claims = Object.values(begun).filter((f) => f.kind === "claim").length;
  for (const f of list(raw.facts)) {
    if (!isRecord(f)) continue;
    const claim = capText(str(f.claim), settings.claimChars);
    if (claim === "") continue;
    const id = claimFactId(claim, turn.messageId);
    if (!facts.has(id)) {
      // A new fact says why it matters and to whom; one that doesn't is no fact worth keeping.
      const matters = capText(str(f.matters), settings.claimChars);
      if (matters === "") {
        refuse(`a new fact that doesn't say why it matters, or to whom: "${claim}"`);
        continue;
      }
      if (!spent.facts.has(id) && (spent.facts.size >= settings.factsPerTurn || claims + spent.facts.size >= settings.factsPerChat)) {
        refuse(`a new fact past the limit of new facts a turn or a chat: "${claim}"`);
        continue;
      }
      const about = [...new Set(list(f.about).flatMap((n) => {
        const name = str(n);
        const person = name === "" ? null : who(name);
        const place = person ? null : Object.keys(world.places).find((p) => p === name || own(world.places, p)?.name.toLowerCase() === name.toLowerCase());
        return person ? [person] : place ? [place] : [];
      }))];
      const truth: FactTruth = (FACT_TRUTHS as readonly string[]).includes(str(f.truth)) ? (str(f.truth) as FactTruth) : "true";
      facts.set(id, { id, kind: "claim", claim, about, truth, source: { msg: turn.messageId, at }, matters });
      spent.facts.add(id);
    }
    // Only a fact the turn may name is the answer's to refer to by its ref.
    if (str(f.ref) !== "") refs.set(str(f.ref), id);
    written.set(id, str(f.claim));
  }
  const factOf = (v: JsonValue | undefined): FactId | null => {
    const id = str(v);
    return refs.get(id) ?? (facts.has(id) ? id : null);
  };
  // What a learning needs besides itself: each fact it names that the turn didn't start with.
  const carried = (ids: readonly string[]): KnowledgeFact[] => ids.flatMap((id) => (own(begun, id) === undefined && facts.has(id) ? [facts.get(id) as KnowledgeFact] : []));
  // What the player character learns reaches their screens, as the chip's words and in What you know
  // (DESIGN §24.11): the world's secrets and the turn's own words decide what they come to hold (`forPov`).
  const secret = worldSecrets(turn.reg.context(world, state));
  const unrevealed = unrevealedSecretFacts(turn.reg, world, state);
  const hidden = hiddenNameCheck(turn.reg, world, state, pov, { stages: false });
  const heard = `${turn.user}\n${turn.reply}`;
  // A learning counts against the turn's limit (`learningsPerTurn`) once for each person it reaches;
  // a witnessing, which reaches everyone there, once for its fact, which its caller charges (`whole`).
  const record = (data: LearnEventData, label: string, whole = false): void => {
    const learners = whole ? data.who : data.who.slice(0, Math.max(0, settings.learningsPerTurn - spent.learnings));
    if (learners.length < data.who.length) refuse(`learnings past the limit a turn: ${label}`);
    if (learners.length === 0) return;
    if (!whole) spent.learnings += learners.length;
    const needs = carried([data.fact, ...data.evidence.filter((ref) => !isWitnessRef(ref))]);
    const line = learnedWitness(data);
    for (const id of learners) {
      heldBy(id).set(data.fact, { how: data.how, by: data.by, evidence: data.evidence, since: { msg: data.msg, at: data.at }, belief: data.belief, confidence: data.confidence, ...(data.keptFrom ? { keptFrom: data.keptFrom } : {}) });
      if (line) seenBy(id).add(witnessRef(line));
    }
    const npcs = learners.filter((id) => id !== pov);
    if (npcs.length > 0) {
      for (const fact of needs) out.events.push({ type: MINDS_EVENTS.fact, data: { fact: fact as unknown as JsonObject } });
      out.events.push({ type: MINDS_EVENTS.learn, data: { ...data, who: npcs } as unknown as JsonObject });
    }
    if (!learners.includes(pov)) return;
    const fact = facts.get(data.fact);
    out.proposals.push({ type: secret(data.fact, fact) ? "reveal" : "learn", facts: needs, learn: { ...data, who: [pov] }, claim: fact?.claim ?? data.fact, with: npcs });
  };
  /**
   * What the player character comes to hold of a fact they learn: one of the world's secrets, as itself
   * (a reveal); else nothing when its words, as the step wrote them, name anyone or anything they can't
   * know of that the turn's own words don't; else, when they carry every phrase of one secret, that
   * secret (a reveal, so that its Apply opens what the story told them); nothing when they carry only
   * part of a secret, or any of more than one; else the fact.
   */
  const forPov = (id: FactId): { fact: FactId } | { refused: string } => {
    const f = facts.get(id);
    if (secret(id, f)) return { fact: id };
    const claim = f?.claim ?? id;
    const words = written.get(id) ?? claim;
    if (hidden(words, heard)) return { refused: `what the player character would learn names someone or something they can't know of: "${claim}"` };
    const lower = words.toLowerCase().replace(/\s+/g, " ");
    const carries = (phrase: string): boolean => lower.includes(phrase.toLowerCase());
    const [one, ...more] = [...new Map(unrevealed.filter((s) => s.phrases.some(carries)).map((s) => [s.fact, s])).values()];
    if (!one) return { fact: id };
    if (more.length > 0) return { refused: `what the player character would learn carries more than one secret's words: "${claim}"` };
    if (!one.parts.every(carries)) return { refused: `what the player character would learn carries only part of a secret: "${claim}"` };
    if (!facts.has(one.fact)) facts.set(one.fact, { id: one.fact, kind: parseFactId(one.fact)?.kind ?? "lore", claim: capText(one.text, settings.claimChars), about: one.about, truth: "true" });
    return { fact: one.fact };
  };
  // What a learning would leave someone holding, past the limit of holders a fact has.
  const holders = (fact: FactId): number => [...new Set([...Object.keys(k.holdings).filter((id) => own(own(k.holdings, id) ?? {}, fact) !== undefined), ...[...holding].filter(([, h]) => h.has(fact)).map(([id]) => id)])].length;
  // Who was there for only part of the turn: whoever left partway, or came in during it or was met at its end.
  const partTime = (id: EntityId): boolean => id !== pov && (turn.presence.left.includes(id) || ((turn.presence.met?.who ?? []).includes(id) && !turn.presence.said.who.includes(id)));
  for (const l of list(raw.learned)) {
    if (!isRecord(l)) continue;
    const fact = factOf(l.fact);
    const how = l.how === "told" ? "told" : l.how === "witnessed" ? "witnessed" : null;
    if (fact === null || how === null) {
      refuse(`a learning of a fact the step didn't give or make, or not witnessed or told: ${JSON.stringify(l.fact ?? null)}`);
      continue;
    }
    const claim = facts.get(fact)?.claim ?? fact;
    const by = how === "told" ? who(str(l.by)) : null;
    const teller = by === null ? undefined : heldBy(by).get(fact);
    if (how === "told" && (by === null || teller === undefined)) {
      refuse(`${by === null ? "a telling with no teller in the world" : `${nameOf(by)} told what they don't hold`}: "${claim}"`);
      continue;
    }
    // What a listener comes to hold is no surer than its teller holds it, and is what the teller makes
    // of it; what someone witnesses they hold true, an open question as one.
    const belief: HoldingBelief = teller ? teller.belief : facts.get(fact)?.truth === "open" ? "uncertain" : "true";
    const confidence = teller ? teller.confidence : 1;
    // Who learned it. A telling names its listeners (`who`). A witnessing reaches everyone there
    // throughout the turn this call is about, or, when it names its witnesses (`who`, the answer
    // format's first version), whom it names; either way but whom the answer says missed it (`missed`,
    // "you" for the player character). A name may come alone, as a string. Who missed it is never
    // guessed at: a name among them the world doesn't have, or that more than one person goes by,
    // refuses the witnessing, so no one is held to have seen what they may have missed.
    const namesOf = (v: JsonValue | undefined): string[] => (typeof v === "string" ? [v] : list(v).map(str));
    const idsOf = (names: readonly string[]): EntityId[] => names.flatMap((n) => {
      const id = who(n);
      return id === null ? [] : [id];
    });
    const missedNames = namesOf(l.missed);
    const unnamed = (v: JsonValue | undefined): boolean => v !== undefined && v !== null && typeof v !== "string" && !Array.isArray(v);
    if (how === "witnessed" && unnamed(l.who)) {
      refuse(`a witnessing whose witnesses aren't names: "${claim}"`);
      continue;
    }
    if (how === "witnessed" && (unnamed(l.missed) || missedNames.some((n) => who(n) === null))) {
      refuse(`a witnessing that says someone missed it whom the world doesn't have, or more than one person goes by: "${claim}"`);
      continue;
    }
    const missed = new Set(idsOf(missedNames));
    const witnesses = namesOf(l.who);
    const reached = (how === "told" || witnesses.length > 0 ? idsOf(witnesses) : perceivers(turn).filter((id) => batch.includes(id) && !partTime(id))).filter((id) => how === "told" || !missed.has(id));
    // Each learner, and what they come to hold: the fact, or the player character's own (`forPov`).
    const learning = new Map<EntityId, FactId>();
    let mine: { fact: FactId } | { refused: string } | undefined;
    for (const id of reached) {
      if (id === by || learning.has(id)) continue;
      // Perception: no one witnesses what happened where they weren't; a telling reaches whoever was there, or anyone the teller reached from it.
      if (how === "witnessed" && !present.has(id)) {
        refuse(`${nameOf(id)} wasn't there to witness: "${claim}"`);
        continue;
      }
      // Nor what happened while they weren't: the engine can't tell when in the turn something did, so someone there for only part of it witnesses none of it.
      if (how === "witnessed" && partTime(id)) {
        refuse(`${nameOf(id)} was there for only part of the turn, so can't be held to have witnessed: "${claim}"`);
        continue;
      }
      if (how === "told" && !present.has(id) && !present.has(by ?? "")) {
        refuse(`neither ${nameOf(id)} nor ${nameOf(by ?? "")} was there for the telling: "${claim}"`);
        continue;
      }
      // A call about one person answers for them alone; one about the scene, for everyone there and anyone a teller there reached.
      if (!batch.includes(id) && (present.has(id) || settings.batch === "character")) continue;
      let target = fact;
      if (id === pov) {
        mine ??= forPov(fact);
        if ("refused" in mine) {
          refuse(mine.refused);
          continue;
        }
        target = mine.fact;
      }
      // A learning never leaves anyone less sure than they were, whatever it makes of the fact: it
      // replaces a holding only when surer, or as sure and alike where that one was worked out or
      // guessed. Someone made to doubt what they hold is a doubt (`doubted`), never a learning.
      const already = heldBy(id).get(target);
      if (already && (already.confidence > confidence || (already.confidence === confidence && (already.belief !== belief || (already.how !== "inferred" && already.how !== "guessed"))))) continue;
      if (already === undefined && holders(target) >= settings.holdersPerFact) {
        refuse(`${nameOf(id)} past the limit of holders a fact has: "${claim}"`);
        continue;
      }
      learning.set(id, target);
    }
    if (learning.size === 0) continue;
    // A witnessing counts once in the turn, however many were there and however many calls give it
    // (one per person, `batch: "character"`): a crowded scene's never crowds out the tellings and
    // secrets after it, and never reaches some of those there but not the rest.
    const whole = how === "witnessed";
    if (whole && !spent.witnessed.has(fact)) {
      if (spent.learnings >= settings.learningsPerTurn) {
        refuse(`learnings past the limit a turn: "${claim}"`);
        continue;
      }
      spent.learnings += 1;
      spent.witnessed.add(fact);
    }
    const named: KeptFrom = l.keptFrom === "everyone" ? "everyone" : [...new Set(list(l.keptFrom).flatMap((n) => {
      const id = who(str(n));
      return id !== null && !learning.has(id) ? [id] : [];
    }))];
    const line = { what: capText(claim, MIND_TEXT_CAPS.told), place: scene };
    // One learning for each fact and whom it is kept from: whom the answer names, else, for a holding it
    // replaces, whom that one was kept from.
    const groups = new Map<string, { fact: FactId; keptFrom: KeptFrom | undefined; who: EntityId[] }>();
    for (const [id, target] of learning) {
      const keptFrom = named === "everyone" || named.length > 0 ? named : heldBy(id).get(target)?.keptFrom;
      const kept = keptFrom === "everyone" || (keptFrom !== undefined && keptFrom.length > 0) ? keptFrom : undefined;
      const key = JSON.stringify([target, kept ?? null]);
      const group = groups.get(key) ?? { fact: target, keptFrom: kept, who: [] };
      group.who.push(id);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const data: LearnEventData = { who: group.who, fact: group.fact, how, by, evidence: [], belief, confidence, ...(group.keptFrom ? { keptFrom: group.keptFrom } : {}), msg: turn.messageId, at, witness: line };
      const entry = learnedWitness(data);
      record({ ...data, evidence: entry ? [witnessRef(entry)] : [] }, `"${claim}"`, whole);
    }
  }
  for (const i of list(raw.inferred)) {
    if (!isRecord(i)) continue;
    const id = who(str(i.who));
    const fact = factOf(i.fact);
    const claim = fact === null ? str(i.fact) : (facts.get(fact)?.claim ?? fact);
    if (id === null || fact === null || id === pov || !batch.includes(id)) {
      refuse(`an inference by no one the step was about, of no fact it gave or made, or by the player character: "${claim}"`);
      continue;
    }
    if (!isConfidence(i.confidence)) {
      refuse(`${nameOf(id)}'s inference has no confidence from 0 to 1: "${claim}"`);
      continue;
    }
    // Evidence: each a fact they hold, or a line of their own witness log, at least one; one that is neither refuses it.
    const evidence = list(i.evidence).map((e) => (isWitnessRef(str(e)) ? str(e) : (factOf(e) ?? str(e))));
    const unheld = evidence.filter((ref) => (isWitnessRef(ref) ? !seenBy(id).has(ref) : !heldBy(id).has(ref) || ref === fact));
    if (evidence.length === 0 || unheld.length > 0) {
      refuse(`${nameOf(id)} infers from what they neither hold nor witnessed (${unheld.join(", ") || "nothing"}): "${claim}"`);
      continue;
    }
    // An inference never overrides a holding at least as sure; one that replaces a holding keeps whom it is kept from.
    const already = heldBy(id).get(fact);
    if (already && already.confidence >= i.confidence) {
      refuse(`${nameOf(id)} already holds it at least as surely as they would infer it: "${claim}"`);
      continue;
    }
    if (already === undefined && holders(fact) >= settings.holdersPerFact) {
      refuse(`${nameOf(id)} past the limit of holders a fact has: "${claim}"`);
      continue;
    }
    const belief: HoldingBelief = (HOLDING_BELIEFS as readonly string[]).includes(str(i.belief)) ? (str(i.belief) as HoldingBelief) : "true";
    // Under the threshold it is kept as it is: a suspicion (`isSuspicion`).
    record({ who: [id], fact, how: "inferred", by: null, evidence: [...new Set(evidence)], belief, confidence: i.confidence, ...(already?.keptFrom ? { keptFrom: already.keptFrom } : {}), msg: turn.messageId, at }, `"${claim}"`);
  }
  for (const d of list(raw.doubted)) {
    if (!isRecord(d)) continue;
    const id = who(str(d.who));
    const fact = factOf(d.fact);
    const held = id !== null && fact !== null ? heldBy(id).get(fact) : undefined;
    const claim = fact === null ? str(d.fact) : (facts.get(fact)?.claim ?? fact);
    if (id === null || fact === null || id === pov || !batch.includes(id) || !held) {
      refuse(`a doubt of what they don't hold, or the player character's: "${claim}"`);
      continue;
    }
    if (!isConfidence(d.confidence)) {
      refuse(`${nameOf(id)}'s doubt has no confidence from 0 to 1: "${claim}"`);
      continue;
    }
    const belief: HoldingBelief = (HOLDING_BELIEFS as readonly string[]).includes(str(d.belief)) ? (str(d.belief) as HoldingBelief) : "uncertain";
    record({ who: [id], fact, how: held.how, by: held.by, evidence: held.evidence, belief, confidence: d.confidence, ...(held.keptFrom ? { keptFrom: held.keptFrom } : {}), msg: held.since.msg, at: held.since.at }, `"${claim}"`);
  }
  return out;
}
