// The minds' knowledge step (DESIGN §24.11): after the reply, beside the read, who learned what that
// matters to them. The story itself is what everyone there knows of a scene; this records only the
// few facts that would change what someone does, says, hides or believes (a secret, a revelation, a
// lie, what they would act on…), each saying why it matters and to whom, as its default wording says.
// One call per scene by default, or one per character (Settings → Minds → Knowledge), for everyone
// who could perceive the turn: the player character and whoever was there with them, each call asked
// once the one before it is checked.
//
//   knowledgeContext  what the call reads: what happened (the player's message, the reply, the turn's
//                     events and what the read found in it), who could perceive it and from when,
//                     the facts in play and those the turn's calls before it made, by id, each one
//                     fact however it is worded, to be learned by its id rather than made again
//                     (`stepReuse`), and each person's holdings, witness log (by ref) and traits,
//                     within the user's tokens (`stepTokens`).
//   checkKnowledge    its answer, checked as the engine checks every proposal: a new fact says why it
//                     matters and to whom, and one that says again (case, spacing and punctuation
//                     aside: `claimKey`, a backstop to the step's own naming of a fact it was shown)
//                     a fact the chat holds or another of the turn's calls made is that fact, its
//                     learners joining those who hold it; a witnessing reaches everyone there
//                     throughout but whom the answer says missed it, and no one there for only part
//                     of the turn; a teller holds what they tell, and one there throughout witnessed
//                     what the turn made; an inference rests only on facts its person holds and lines
//                     of their own witness log; a confidence runs from 0 to 1. An inference under the
//                     threshold is kept, as a suspicion. Within the user's limits (`factsPerTurn`,
//                     `learningsPerTurn`, `factsPerChat`, `holdersPerFact`, `claimChars`): a new fact
//                     is charged, and kept, only once a learning lands on it; one no one learns is
//                     counted (`unlearned`), never made. Tellings are checked after everything else
//                     the answer learned. Every learner it names is recorded or counted: one with a
//                     call of their own (`own_call`), one no call is about (`not_this_call`). It
//                     returns the learnings of everyone but the player character as
//                     events, each whole with the facts it names that the turn didn't start with, and
//                     the player character's own as `learn` and `reveal` changes (C4), whose modes decide
//                     them (`backend/runtime.ts`). With knowledge on, telling is this step's alone: a told
//                     learning adds the listener's `told` witness entry, and the memory step records none.
// Every name the model gives is resolved to someone in the world (`named`), "you" being the player
// character, who never infers or doubts here: what they make of things is the player's. A lore id
// (a world lore entry, a book entry or its mark, by its short id too) names the chat's fact of it
// (`lore`); one the chat holds no fact of is refused, and nothing is made of its prose.

import type { Counts, KnowledgeRefusal } from "../shared/agent-yield";
import type { EntityId, MessageId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { FactId, FactTruth, Holding, HoldingBelief, KeptFrom, KnowledgeFact, KnowledgeProposal, KnowledgeSettings, KnowledgeTextId, LearnEventData, MindsMemoryConfig, PresenceEventData } from "../shared/minds";
import { claimFactId, claimKey, FACT_TRUTHS, fillText, HOLDING_BELIEFS, isConfidence, isWitnessRef, knowledgeText, knowledgeThreshold, MIND_TEXT_CAPS, MINDS_EVENTS, parseFactId, witnessRef } from "../shared/minds";
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
  /** Everyone a call of this step is about: after the reply everyone who could perceive the turn (the default), before the plan those a decision turns on. */
  asked?: readonly EntityId[];
  /** The fact each lore id the answer gave names (`loreRefs` in `backend/minds.ts`): a world lore entry's, a book entry's or one of its marks', by a short id (with `#n`), `bookId/entryId` or its lore id. */
  lore?: ReadonlyMap<string, FactId>;
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
 * who could perceive it and from when, the facts in play and those the turn's calls before this one
 * made (`spent`), with that a fact listed is one fact however it is worded (`stepReuse`), and each
 * person's holdings, witness log and traits. Within `stepTokens`: what happened and who perceived it
 * come first, then every person's lines one round at a time (their best holding, their latest
 * witness line, their next…), so the limit cuts each person's least, and the reply's beginning goes
 * first when even that is over it. It says what the turn can still record (`stepBudget`): the new
 * facts and learnings its limits leave, less what the calls before this one spent.
 */
export function knowledgeContext(turn: KnowledgeTurn, batch: readonly EntityId[], spent: Pick<KnowledgeSpent, "facts" | "learnings"> = knowledgeSpent()): string {
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
  // A fact as every list of them gives it: its id as an answer names it, in brackets (`idOf` in
  // `checkKnowledge`), its claim, and its truth unless it is true.
  const factLine = (id: FactId, f: KnowledgeFact | undefined): string => `- [${id}] ${claim(f, id)}${f?.truth === "open" ? ` ${text("stepOpen")}` : f?.truth === "false" ? ` ${text("stepFalse")}` : ""}`;
  const factLines = [...inPlay].sort().map((id) => factLine(id, own(facts, id)));
  // And what the turn's calls before this one made, in the order they made them: this call names
  // one by its id where it would say it again, in whatever words (`stepReuse`).
  const madeLines = [...spent.facts.values()].filter((f) => !inPlay.has(f.id)).map((f) => factLine(f.id, f));
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
  // What the turn can still record: a new fact counts once someone learns it, against the turn's limit and the chat's.
  const claims = Object.values(readKnowledge(turn.before).facts).filter((f) => f.kind === "claim").length;
  const left = (n: number): string => String(Math.max(0, n));
  const budget = fillText(text("stepBudget"), { facts: left(settings.factsPerTurn - spent.facts.size), chat: left(settings.factsPerChat - claims - spent.facts.size), learnings: left(settings.learningsPerTurn - spent.learnings) });
  const render = (reply: string, taken: Map<EntityId, { holdings: number; witness: number }>): string =>
    [
      happened(reply),
      present,
      block(text("stepFacts"), factLines),
      block(text("stepMade"), madeLines),
      factLines.length + madeLines.length > 0 ? text("stepReuse") : "",
      budget,
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

/**
 * What one call's answer gives, checked: the learnings of everyone but the player character, their
 * own changes, and what was refused: why, each line naming what it was about (the host log's), and
 * how many of each kind (`refusedAs`), which the run's answer, Diagnostics and the host log word in
 * the user's texts (`shared/agent-yield.ts`).
 */
export interface KnowledgeChecked {
  events: LedgerEvent[];
  proposals: KnowledgeProposal[];
  refused: string[];
  refusedAs: Counts<KnowledgeRefusal>;
}

const str = (v: JsonValue | undefined): string => (typeof v === "string" ? v.trim() : "");
const list = (v: JsonValue | undefined): JsonValue[] => (Array.isArray(v) ? v : []);

/**
 * What a turn's knowledge step has spent of its limits, across its calls: the new facts learnings
 * landed on, by what each says (`claimKey`), which each later call reads (`knowledgeContext`) and may
 * name by id, and which one that makes a fact again in the same words names, spending nothing
 * (`factsPerTurn`, `factsPerChat`); the new facts its calls made that no learning has landed on
 * (`unlearned`, by `claimKey`), never charged or listed, which the step counts once its calls are
 * done; its learnings (`learningsPerTurn`), and the facts whose witnessing it has charged, each once
 * in the turn, however many calls give it.
 */
export interface KnowledgeSpent {
  facts: Map<string, KnowledgeFact>;
  unlearned: Map<string, KnowledgeFact>;
  learnings: number;
  witnessed: Set<FactId>;
}

/** A turn's knowledge step before its first call: nothing spent. */
export function knowledgeSpent(): KnowledgeSpent {
  return { facts: new Map(), unlearned: new Map(), learnings: 0, witnessed: new Set() };
}

/**
 * One call's answer, checked against the turn (see the header). `batch` is who the call was about:
 * only they learn, infer or doubt from it. Learnings are checked in the answer's order, each on what
 * the ones before it left, so a fact someone learns may be told on, or reasoned from, further down.
 */
export function checkKnowledge(turn: KnowledgeTurn, batch: readonly EntityId[], raw: JsonValue, spent: KnowledgeSpent = knowledgeSpent()): KnowledgeChecked {
  const out: KnowledgeChecked = { events: [], proposals: [], refused: [], refusedAs: {} };
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
  const refuse = (kind: KnowledgeRefusal, why: string): void => {
    out.refused.push(why);
    out.refusedAs[kind] = (out.refusedAs[kind] ?? 0) + 1;
  };
  // The holdings and witness logs as this answer leaves them, and every fact it may name: the
  // chat's, and those the turn's calls before this one made, which its context listed by id, so a
  // learning that names one of those is its learner joining those who hold it.
  const facts = new Map<FactId, KnowledgeFact>(Object.entries(k.facts));
  for (const f of spent.facts.values()) if (!facts.has(f.id)) facts.set(f.id, f);
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
  // An id as the context shows it, "[id]" (each fact in play and each witness line is listed so), is
  // that id: no id holds a bracket. So is a ref: a new fact's own, and wherever the answer names one
  // (a learning's fact, an inference's evidence), each read without its brackets.
  const idOf = (v: JsonValue | undefined): string => str(v).replace(/^\[([^[\]]+)\]$/, "$1").trim();
  // The chat's claims as the turn began, and each new one this turn makes, once whichever call makes it (`spent`).
  const claims = Object.values(begun).filter((f) => f.kind === "claim").length;
  // One fact per real fact: what a fact says (`claimKey`) names it, so one said again, by another of
  // the turn's calls or a later turn, is the fact there is, and whoever learns it now joins those who
  // hold it. A backstop: the step is shown the facts in play and the turn's own by id, and told to
  // name one it would say again (`stepReuse`); this catches only one said in the same words. The
  // turn's own first, then the chat's: of two alike that an earlier build made, the one more people
  // hold, then the first by id. Nothing recorded changes: only what the step makes now.
  const heldCount = new Map<FactId, number>();
  for (const held of Object.values(k.holdings)) for (const id of Object.keys(held)) heldCount.set(id, (heldCount.get(id) ?? 0) + 1);
  const count = (id: FactId): number => heldCount.get(id) ?? 0;
  const said = new Map<string, FactId>();
  for (const f of Object.values(k.facts)) {
    const key = claimKey(f.claim);
    const there = said.get(key);
    if (key !== "" && (there === undefined || count(f.id) > count(there) || (count(f.id) === count(there) && f.id < there))) said.set(key, f.id);
  }
  for (const [key, f] of spent.facts) said.set(key, f.id);
  // One an earlier call made that no one learned yet keeps the id it was made with, when said again.
  for (const [key, f] of spent.unlearned) if (!said.has(key)) said.set(key, f.id);
  // The new facts this answer made, by id with what each says: none is charged until a learning lands on it (`fits`, `charge`).
  const pending = new Map<FactId, string>();
  for (const f of list(raw.facts)) {
    if (!isRecord(f)) continue;
    const claim = capText(str(f.claim), settings.claimChars);
    if (claim === "") continue;
    const made = claimFactId(claim, turn.messageId);
    // A claim of no words is told apart by its id alone.
    const key = claimKey(claim) || made;
    const id = said.get(key) ?? made;
    if (!facts.has(id)) {
      // A new fact says why it matters and to whom; one that doesn't is no fact worth keeping.
      const matters = capText(str(f.matters), settings.claimChars);
      if (matters === "") {
        refuse("matters", `a new fact that doesn't say why it matters, or to whom: "${claim}"`);
        continue;
      }
      // The turn's and the chat's limits are checked once a learning lands on it (`fits`).
      const about = [...new Set(list(f.about).flatMap((n) => {
        const name = str(n);
        const person = name === "" ? null : who(name);
        const place = person ? null : Object.keys(world.places).find((p) => p === name || own(world.places, p)?.name.toLowerCase() === name.toLowerCase());
        return person ? [person] : place ? [place] : [];
      }))];
      const truth: FactTruth = (FACT_TRUTHS as readonly string[]).includes(str(f.truth)) ? (str(f.truth) as FactTruth) : "true";
      const fact: KnowledgeFact = { id, kind: "claim", claim, about, truth, source: { msg: turn.messageId, at }, matters };
      facts.set(id, fact);
      pending.set(id, key);
      spent.unlearned.set(key, fact);
      said.set(key, id);
    }
    // Only a fact the turn may name is the answer's to refer to by its ref.
    const ref = idOf(f.ref);
    if (ref !== "") refs.set(ref, id);
    written.set(id, str(f.claim));
  }
  // A fact the answer gave (by its ref) or the chat holds (by its id); a lore id names the chat's fact of its entry.
  const factOf = (v: JsonValue | undefined): FactId | null => {
    const id = idOf(v);
    const lore = turn.lore?.get(id);
    return refs.get(id) ?? (facts.has(id) ? id : lore !== undefined && facts.has(lore) ? lore : null);
  };
  /** Why a learning, an inference or a doubt names no fact: a lore entry the chat holds no fact of gets its guidance; anything else is `kind`. */
  const unknown = (v: JsonValue | undefined, kind: KnowledgeRefusal, why: string): void => {
    const lore = turn.lore?.get(idOf(v));
    if (lore === undefined || facts.has(lore)) refuse(kind, why);
    else refuse("lore_entry", `${idOf(v)} names a lore entry the chat holds no fact of (${lore}), and nothing is made of an entry's prose: make what was learned a new fact in the answer's own words`);
  };
  // A new fact is charged once, when the first learning lands on it, whoever learns it: the turn's limit and the chat's are checked then.
  const fits = (ids: readonly string[], label: string): boolean => {
    const fresh = new Set(ids.filter((id) => pending.has(id))).size;
    if (fresh === 0) return true;
    if (spent.facts.size + fresh > settings.factsPerTurn) {
      refuse("facts_limit", `a new fact past this turn's limit of ${settings.factsPerTurn} new facts: ${label}`);
      return false;
    }
    if (claims + spent.facts.size + fresh > settings.factsPerChat) {
      refuse("facts_chat", `a new fact past this chat's limit of ${settings.factsPerChat} facts made in play: ${label}`);
      return false;
    }
    return true;
  };
  const charge = (ids: readonly string[]): void => {
    for (const id of ids) {
      const key = pending.get(id);
      const fact = facts.get(id);
      if (key === undefined || !fact) continue;
      pending.delete(id);
      spent.unlearned.delete(key);
      spent.facts.set(key, fact);
    }
  };
  // A fact the turn made: by this answer, or by the turn's calls before it.
  const madeNow = (id: FactId): boolean => pending.has(id) || [...spent.facts.values()].some((f) => f.id === id);
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
    if (learners.length < data.who.length) refuse("learnings_limit", `learnings past this turn's limit of ${settings.learningsPerTurn} learnings: ${label}`);
    if (learners.length === 0) return;
    if (!whole) spent.learnings += learners.length;
    const needs = carried([data.fact, ...data.evidence.filter((ref) => !isWitnessRef(ref))]);
    charge(needs.map((f) => f.id));
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
  // Whom some call of this step is about: one there whom this call isn't about has their own call, or none.
  const asked = new Set(turn.asked ?? perceivers(turn));
  // Tellings last: a teller may be one of those the answer has witness the fact, further down it.
  const learned = list(raw.learned);
  for (const l of [...learned.filter((x) => !isRecord(x) || x.how !== "told"), ...learned.filter((x) => isRecord(x) && x.how === "told")]) {
    if (!isRecord(l)) continue;
    const fact = factOf(l.fact);
    const how = l.how === "told" ? "told" : l.how === "witnessed" ? "witnessed" : null;
    if (fact === null || how === null) {
      unknown(l.fact, "no_fact", `a learning of a fact the step didn't give or make, or not witnessed or told: ${JSON.stringify(l.fact ?? null)}`);
      continue;
    }
    const claim = facts.get(fact)?.claim ?? fact;
    const by = how === "told" ? who(str(l.by)) : null;
    // A teller there throughout the turn witnessed what the turn made, though a call about someone
    // else never records it of them: they hold it as a witness would, for this telling.
    const witnessed: Holding | undefined = by !== null && madeNow(fact) && present.has(by) && !partTime(by) ? { how: "witnessed", by: null, evidence: [], since: { msg: turn.messageId, at }, belief: facts.get(fact)?.truth === "open" ? "uncertain" : "true", confidence: 1 } : undefined;
    const teller = by === null ? undefined : (heldBy(by).get(fact) ?? witnessed);
    if (how === "told" && (by === null || teller === undefined)) {
      refuse("teller", `${by === null ? "a telling with no teller in the world" : `${nameOf(by)} told what they don't hold`}: "${claim}"`);
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
      refuse("witnesses", `a witnessing whose witnesses aren't names: "${claim}"`);
      continue;
    }
    if (how === "witnessed" && (unnamed(l.missed) || missedNames.some((n) => who(n) === null))) {
      refuse("missed", `a witnessing that says someone missed it whom the world doesn't have, or more than one person goes by: "${claim}"`);
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
        refuse("absent", `${nameOf(id)} wasn't there to witness: "${claim}"`);
        continue;
      }
      // Nor what happened while they weren't: the engine can't tell when in the turn something did, so someone there for only part of it witnesses none of it.
      if (how === "witnessed" && partTime(id)) {
        refuse("part_time", `${nameOf(id)} was there for only part of the turn, so can't be held to have witnessed: "${claim}"`);
        continue;
      }
      if (how === "told" && !present.has(id) && !present.has(by ?? "")) {
        refuse("absent", `neither ${nameOf(id)} nor ${nameOf(by ?? "")} was there for the telling: "${claim}"`);
        continue;
      }
      // A call about one person answers for them alone, and one about the scene for everyone there;
      // someone who perceived nothing is told from whichever call has the telling.
      if (!batch.includes(id) && present.has(id)) {
        refuse(asked.has(id) ? "own_call" : "not_this_call", `${nameOf(id)} ${asked.has(id) ? "is left to their own call" : "isn't someone the step's calls are about"}: "${claim}"`);
        continue;
      }
      let target = fact;
      if (id === pov) {
        mine ??= forPov(fact);
        if ("refused" in mine) {
          refuse("pov", mine.refused);
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
        refuse("holders", `${nameOf(id)} past the limit of holders a fact has: "${claim}"`);
        continue;
      }
      learning.set(id, target);
    }
    if (learning.size === 0) continue;
    if (!fits([...learning.values()], `"${claim}"`)) continue;
    // A witnessing counts once in the turn, however many were there and however many calls give it
    // (one per person, `batch: "character"`): a crowded scene's never crowds out the tellings and
    // secrets after it, and never reaches some of those there but not the rest.
    const whole = how === "witnessed";
    if (whole && !spent.witnessed.has(fact)) {
      if (spent.learnings >= settings.learningsPerTurn) {
        refuse("learnings_limit", `learnings past this turn's limit of ${settings.learningsPerTurn} learnings: "${claim}"`);
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
      const why = `an inference by no one the step was about, of no fact it gave or made, or by the player character: "${claim}"`;
      if (fact === null) unknown(i.fact, "inference", why);
      else refuse("inference", why);
      continue;
    }
    if (!isConfidence(i.confidence)) {
      refuse("confidence", `${nameOf(id)}'s inference has no confidence from 0 to 1: "${claim}"`);
      continue;
    }
    // Evidence: each a fact they hold, or a line of their own witness log, at least one; one that is neither refuses it.
    const evidence = list(i.evidence).map((e) => (isWitnessRef(idOf(e)) ? idOf(e) : (factOf(e) ?? idOf(e))));
    const unheld = evidence.filter((ref) => (isWitnessRef(ref) ? !seenBy(id).has(ref) : !heldBy(id).has(ref) || ref === fact));
    if (evidence.length === 0 || unheld.length > 0) {
      refuse("evidence", `${nameOf(id)} infers from what they neither hold nor witnessed (${unheld.join(", ") || "nothing"}): "${claim}"`);
      continue;
    }
    // An inference never overrides a holding at least as sure; one that replaces a holding keeps whom it is kept from.
    const already = heldBy(id).get(fact);
    if (already && already.confidence >= i.confidence) {
      refuse("already", `${nameOf(id)} already holds it at least as surely as they would infer it: "${claim}"`);
      continue;
    }
    if (already === undefined && holders(fact) >= settings.holdersPerFact) {
      refuse("holders", `${nameOf(id)} past the limit of holders a fact has: "${claim}"`);
      continue;
    }
    const belief: HoldingBelief = (HOLDING_BELIEFS as readonly string[]).includes(str(i.belief)) ? (str(i.belief) as HoldingBelief) : "true";
    if (!fits([fact], `"${claim}"`)) continue;
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
      const why = `a doubt of what they don't hold, or the player character's: "${claim}"`;
      if (fact === null) unknown(d.fact, "doubt", why);
      else refuse("doubt", why);
      continue;
    }
    if (!isConfidence(d.confidence)) {
      refuse("confidence", `${nameOf(id)}'s doubt has no confidence from 0 to 1: "${claim}"`);
      continue;
    }
    const belief: HoldingBelief = (HOLDING_BELIEFS as readonly string[]).includes(str(d.belief)) ? (str(d.belief) as HoldingBelief) : "uncertain";
    record({ who: [id], fact, how: held.how, by: held.by, evidence: held.evidence, belief, confidence: d.confidence, ...(held.keptFrom ? { keptFrom: held.keptFrom } : {}), msg: held.since.msg, at: held.since.at }, `"${claim}"`);
  }
  return out;
}
