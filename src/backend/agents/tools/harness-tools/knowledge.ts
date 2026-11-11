// Who knows what on the harness engine (HARNESS-SLICE3: "Knowledge"): the two tools the knowledge
// agent works with, which stand in for the classic `knowledge` step.
//
// - `knowledge_scene` reads what the step was handed as its context (`knowledgeContext`): what
//   happened, who could perceive it, the facts in play and each person's holdings and witness log, by
//   the ids and refs an answer names them with. The step is handed the engine's own words; an agent
//   reads through its view, so a secret in the context is marked as every other read marks one
//   (`markedScene`).
// - `knowledge_infer` takes the step's own answer (`KnowledgeOutput`) as its arguments and checks it
//   exactly as the step's is checked (`checkKnowledge`): what holds is staged, everyone else's
//   learnings as `minds.fact` and `minds.learn` events under the `learn` change type, the player
//   character's own as `learn` and `reveal` changes whose modes decide them; what doesn't is answered
//   with the engine's reason, so the agent can fix it.
//
// A turn's limits (new facts, learnings) hold across its calls. Nothing is kept between calls: what
// the turn has spent is read from what it changed (`spentOf`), so a call after a restart, or from
// another agent, counts the same.

import { hashJson } from "../../../../shared/hash";
import { HARNESS_FAMILY, HARNESS_NOTE, HARNESS_TOOL } from "../../../../shared/harness-texts";
import type { EntityId } from "../../../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../../../shared/json";
import type { LedgerEvent } from "../../../../shared/ledger";
import { claimKey, effectiveMemory, FACT_TRUTHS, HOLDING_BELIEFS, type LearnEventData, MINDS_EVENTS } from "../../../../shared/minds";
import { pinsFor } from "../../../../engine/lore-pins";
import { own } from "../../../../engine/pack-kit";
import { authorLines, witnessLines } from "../../../../engine/player-events";
import type { WorldState } from "../../../../engine/state";
import { Working } from "../../../../engine/working";
import { readKnowledge } from "../../../../packs/minds/core/state";
import { checkKnowledge, knowledgeContext, type KnowledgeSpent, knowledgeSpent, type KnowledgeTurn, perceivers } from "../../../knowledge-step";
import { readPins } from "../../../lore-pins";
import { loreRefs, personNamed } from "../../../minds";
import { pinnedLines } from "../../../minds-context";
import type { ToolOutcome } from "../../runtime";
import type { HarnessTurn } from "../harness-turn";
import { wordsArg } from "../propose";
import { factSecrecyOf } from "../read/knowledge";
import { named } from "../read/orgs";
import type { ToolReadView } from "../read-view";
import type { ToolEnv } from "../registry";
import { resolvePerson } from "../resolve";
import { objectSchema, text } from "../schema";
import { type HarnessToolDefinition, list, number, presenceOf, stageChange, words } from "./kit";

const HOW = ["witnessed", "told"] as const;
const LISTS = ["facts", "learned", "inferred", "doubted"] as const;

/**
 * What the turn has spent of its knowledge limits so far (`KnowledgeSpent`), read from what it
 * changed since it started: each claim it made, and each holding it gave or changed, a witnessing
 * once for its fact, as the step charges them. What the world's author gave someone from the start
 * (seeded as the reply is written) is no learning of the turn's.
 */
function spentOf(start: Readonly<WorldState>, state: Readonly<WorldState>): KnowledgeSpent {
  const before = readKnowledge(start);
  const now = readKnowledge(state);
  const spent = knowledgeSpent();
  for (const [id, fact] of Object.entries(now.facts)) if (fact.kind === "claim" && own(before.facts, id) === undefined) spent.facts.set(claimKey(fact.claim) || id, fact);
  for (const [who, held] of Object.entries(now.holdings)) {
    const had = own(before.holdings, who) ?? {};
    for (const [fact, holding] of Object.entries(held)) {
      if (holding.how === "authored" || hashJson((own(had, fact) ?? null) as unknown as JsonValue) === hashJson(holding as unknown as JsonValue)) continue;
      if (holding.how === "witnessed") spent.witnessed.add(fact);
      else spent.learnings += 1;
    }
  }
  spent.learnings += spent.witnessed.size;
  return spent;
}

/** A turn as the knowledge step reads it, whom a call is about, and what the turn has spent; or the answer that says why there is nothing to read. */
async function knowledgeTurn(view: ToolReadView, env: ToolEnv, args: JsonObject): Promise<{ turn: HarnessTurn; step: KnowledgeTurn; batch: EntityId[]; spent: KnowledgeSpent } | ToolOutcome> {
  const turn = env.turn;
  if (!turn) return view.refuse(HARNESS_NOTE.noTurn);
  if (!turn.knowing) return view.refuse(HARNESS_NOTE.knowledgeOff);
  // A learning is recorded against the reply once it is written, before it against the player's message, as the step before a plan records one.
  const messageId = turn.reply?.messageId ?? turn.said.messageId;
  if (messageId === null) return view.refuse(HARNESS_NOTE.knowledgeNoMessage);
  const { registry: reg, world, state } = view;
  const { settings } = turn;
  const pinned = pinnedLines({ reg, world, state, reads: settings.minds.reads, pinned: await readPins(turn.host, world, pinsFor(world, null, undefined, ["knowledge"]), env.userId) }, "knowledge");
  const step: KnowledgeTurn = {
    reg,
    world,
    state,
    before: turn.start,
    messageId,
    user: turn.said.user,
    reply: turn.reply?.text ?? "",
    presence: presenceOf(view, turn),
    happened: witnessLines(reg, world, state, world.pov, turn.landed(), Number.POSITIVE_INFINITY),
    settings: settings.minds.knowledge,
    memory: effectiveMemory(world, settings.minds),
    hideJson: settings.hideJsonBlocks,
    pinned,
    named: (name) => personNamed(reg, world, state, name),
  };
  const people = perceivers(step);
  const batch: EntityId[] = [];
  for (const said of wordsArg(args, "who") ?? []) {
    const named = resolvePerson(view, said);
    if ("refused" in named) return named.refused;
    if (!people.includes(named.id)) return view.refuse(HARNESS_NOTE.knowledgeNotThere, { name: view.name(named.id) });
    if (!batch.includes(named.id)) batch.push(named.id);
  }
  // Counted on everything the turn's agents staged, where the turn gives it: two agents recording side by side share one budget.
  return { turn, step, batch: batch.length > 0 ? batch : people, spent: spentOf(turn.start, turn.whole?.() ?? state) };
}

/**
 * The call's arguments as the step's answer (`KnowledgeOutput`): its four lists, and nothing else of
 * the call. Whom a learning is kept from is a list in the tool's schema (one type a node), so the
 * one word `everyone` in it reads as the answer's `"everyone"`.
 */
function answerOf(args: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const key of LISTS) if (Array.isArray(args[key])) out[key] = args[key];
  out.learned = (Array.isArray(out.learned) ? out.learned : []).map((l: JsonValue): JsonValue => {
    const kept = isRecord(l) ? l.keptFrom : undefined;
    return isRecord(l) && Array.isArray(kept) && kept.length === 1 && typeof kept[0] === "string" && kept[0].trim().toLowerCase() === "everyone" ? { ...l, keptFrom: "everyone" } : l;
  });
  return out;
}

/** A learning in the words `knowledge_infer` answers with: who learned which fact, how, and where it stands. */
function learnedLine(view: ToolReadView, learn: LearnEventData, claim: string, lands: string): JsonObject {
  return { who: learn.who.map((id) => view.name(id)), fact: learn.fact, claim, how: learn.how, ...(learn.by !== null ? { by: view.name(learn.by) } : {}), confidence: learn.confidence, lands };
}

/** A line of the step's context that lists a fact or a line of someone's witness log: its id in brackets, as an answer names it, then its words. */
const LISTED = /^- \[([^\]]+)\] (.+)$/;

/**
 * The step's context as this view gives it. Under a view that marks, every secret in it is marked
 * as the read tools mark one: someone or somewhere restricted goes by the name the view gives them
 * (`named`, the reads' own), and a fact someone keeps is marked wherever a line lists it, by the
 * knowledge reads' own rule (`factSecrecyOf`). A line's id stays as an answer names it: only its
 * words are read for names. The marks come after the step's own cut to its token limit, so a
 * context with secrets runs past it by their marks.
 */
function markedScene(view: ToolReadView, context: string): string {
  if (!view.marked) return context;
  const secrecy = factSecrecyOf(view);
  const lines = context.split("\n").map((line) => {
    const listed = LISTED.exec(line);
    return listed ? { id: listed[1] ?? "", words: listed[2] ?? "" } : line;
  });
  return named(view, lines)
    .map((line) => (typeof line === "string" ? line : `- [${line.id}] ${view.mark(line.words, secrecy(line.id))}`))
    .join("\n");
}

export const KNOWLEDGE_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: HARNESS_TOOL.knowledgeScene,
    family: HARNESS_FAMILY.knowledge,
    tier: "read",
    parameters: () => objectSchema({ who: words() }),
    async run(args, env) {
      const view = await env.reader.view();
      const read = await knowledgeTurn(view, env, args);
      if (!("step" in read)) return read;
      // The step's own context, prose and lists a model reads as they are: sent as text.
      return { text: view.read(() => markedScene(view, knowledgeContext(read.step, read.batch, read.spent))) };
    },
  },
  {
    name: HARNESS_TOOL.knowledgeInfer,
    family: HARNESS_FAMILY.knowledge,
    tier: "write",
    parameters: () =>
      objectSchema({
        who: words(),
        facts: list(objectSchema({ ref: text(), claim: text(), matters: text(), about: words(), truth: text(FACT_TRUTHS) }, ["ref", "claim", "matters"])),
        learned: list(objectSchema({ fact: text(), how: text(HOW), missed: words(), who: words(), by: text(), keptFrom: words() }, ["fact", "how"])),
        inferred: list(objectSchema({ who: text(), fact: text(), confidence: number(), evidence: words(), belief: text(HOLDING_BELIEFS) }, ["who", "fact", "confidence", "evidence"])),
        doubted: list(objectSchema({ who: text(), fact: text(), confidence: number(), belief: text(HOLDING_BELIEFS) }, ["who", "fact", "confidence"])),
      }),
    async run(args, env) {
      const view = await env.reader.view();
      const read = await knowledgeTurn(view, env, args);
      if (!("step" in read)) return read;
      const { turn, step, batch, spent } = read;
      const { registry: reg, world, state } = view;
      const raw = answerOf(args);
      if (LISTS.every((key) => !Array.isArray(raw[key]) || raw[key].length === 0)) return view.refuse(HARNESS_NOTE.knowledgeNothing);
      // A lore id the answer names stands for the chat's fact of that entry, as the step reads one.
      const lore = await loreRefs({ loreEntry: async (_user, id) => (await view.routing?.entryOf(id)) ?? null }, world, env.userId, raw);
      const checked = view.read(() => checkKnowledge({ ...step, ...(lore.size > 0 ? { lore } : {}) }, batch, raw, spent));
      const refused = new Set(checked.refused);
      const recorded: JsonObject[] = [];
      // Everyone else's learnings, each whole with the facts it carries: one change a learning, checked on what the ones before it left.
      const after = new Working(reg, world, state);
      const claimOf = (fact: string): string => own(readKnowledge(after.state).facts, fact)?.claim ?? fact;
      let unit: LedgerEvent[] = [];
      for (const event of checked.events) {
        unit.push(event);
        if (event.type !== MINDS_EVENTS.learn) continue;
        const events = unit;
        unit = [];
        const mark = after.mark();
        const rejection = events.map((e) => after.apply(e)).find((r) => r !== null);
        const learn = event.data as unknown as LearnEventData;
        if (rejection) {
          after.restore(mark);
          refused.add(`${rejection.reason}: "${claimOf(learn.fact)}"`);
          continue;
        }
        const staged = await stageChange(view, turn, { key: hashJson(["lre.harness.learn", events as unknown as JsonValue]), changeType: "learn", events, lines: authorLines(reg, world, after.state, events, events.length) });
        // A mode's refusal is every learning's alike, so it is said once.
        if ("refused" in staged) refused.add(staged.reason);
        else recorded.push(learnedLine(view, learn, claimOf(learn.fact), staged.lands));
      }
      // The player character's own, as the changes their modes decide: the proposal its channel takes goes with it, for the review card.
      for (const change of checked.proposals) {
        const proposal = change as unknown as JsonObject;
        const events: LedgerEvent[] = [...change.facts.map((fact): LedgerEvent => ({ type: MINDS_EVENTS.fact, data: { fact: fact as unknown as JsonObject } })), { type: MINDS_EVENTS.learn, data: change.learn as unknown as JsonObject }];
        const staged = await stageChange(view, turn, { key: hashJson(["lre.harness.know", proposal]), changeType: change.type, events, lines: [change.claim], proposal });
        if ("refused" in staged) refused.add(`${staged.reason} "${change.claim}"`);
        else recorded.push(learnedLine(view, change.learn, change.claim, staged.lands));
      }
      for (const fact of spent.unlearned.values()) refused.add(view.text(HARNESS_NOTE.knowledgeUnlearned, { claim: fact.claim }));
      if (recorded.length === 0) return refused.size > 0 ? view.refuse(HARNESS_NOTE.knowledgeRefused, { refused: [...refused].map((line) => `- ${line}`).join("\n") }) : view.refuse(HARNESS_NOTE.knowledgeHeld);
      return view.answer({ recorded, ...(refused.size > 0 ? { refused: [...refused] } : {}), ...(Object.keys(checked.cuts).length > 0 ? { cut: checked.cuts, note: view.text(HARNESS_NOTE.cut) } : {}) });
    },
  },
];
