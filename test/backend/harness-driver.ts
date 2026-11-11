// A small driver that plays LumiAH's runtime against the harness engine, on the fake host: what the
// runtime does at its side of the boundary (`backend/harness/shapes.ts`), in the order it does it.
// It asks what the engine claims of a chat, begins a run, sends tool calls as named agents, asks for
// the writer's request, says the reply was written, and ends the run. The host plays Lumiverse as it
// does for every other test: the generation, its prompt, the reply saved.
//
// Nothing here is a model, and no test that uses it scripts one: the fake host's helper throws, and
// `noModelCalls` checks that the engine never reached it. Every decision a test's turn takes is a
// tool call the test makes as an agent, as the author's would be.

import { expect } from "bun:test";
import type { AgentUsage, ChatInfo, ModelMessage, RemoteTool, RunKind, StorySource, TurnKind, TurnRecord, TurnStatus } from "../../src/backend/harness/shapes";
import { toChain } from "../../src/backend/ledger-io";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import type { JsonObject } from "../../src/shared/json";
import type { Rec } from "../../src/shared/ledger";
import { activeRecord } from "../../src/engine/ledger/path";
import { balance } from "../../src/packs/economy/core/model";
import type { WorldState } from "../../src/engine/state";
import type { AssembledEntry, Generation, StartOptions } from "../support/fake-host";
import type { Rig } from "../support/rig";
import { type AlderSetup, alderChat, HOME } from "../support/tools";

/** The tests' own people, by id. Mara, Joss and Ilse are where the player character wakes; Okoro and Brann are elsewhere. */
export const MARA = "mara";
export const JOSS = "joss";
export const ILSE = "ilse";
export const OKORO = "okoro";
export const BRANN = "brann";

const person = (id: string, name: string, here: boolean): JsonObject => ({ id, kind: "character", name, tier: "background", fields: here ? { place: HOME } : {}, relations: [] });

/** The people every harness chat of these tests has beside the player character. */
export const PEOPLE: Record<string, JsonObject> = { [MARA]: person(MARA, "Mara", true), [JOSS]: person(JOSS, "Joss", true), [ILSE]: person(ILSE, "Ilse", true), [OKORO]: person(OKORO, "Okoro", false), [BRANN]: person(BRANN, "Brann", false) };

/**
 * An agent of a run as the runtime names it in a call: its handle, the definition it runs as, and
 * where it stands in the run. Where a test says nothing of that, an agent of a turn's run is one
 * the run's main agent started, and a job's run is its agent's own.
 */
export interface Agent {
  id: string;
  role: string;
  /** It is its run's main agent. */
  main?: boolean;
  /** The agents over it, from the run's main agent down to the one that started it. */
  above?: readonly Agent[];
}

/** The main agent of a turn's run. */
export const AUTHOR: Agent = { id: "main", role: HARNESS_AGENT.author, main: true };

const USAGE: AgentUsage = { calls: 0, toolTurns: 0, in: 0, cachedIn: 0, out: 0, reasoningOut: 0, estimated: false, ms: 0 };

/** How the core frames the brief it puts into the writer's request (its `writer.brief` text, which is the user's to change). */
const BRIEF_FRAME = "The author's brief for this reply:";

/** What the author hands the writer where a test names no brief of its own. A turn is played only once its author handed one over: the core asks for the writer's request with no brief when the author stopped short of one, and the reply is then one no turn was played for. */
export const A_BRIEF = "- Write the scene as it now stands.";

const KINDS: Record<string, TurnKind> = { normal: "new", regenerate: "regenerate", swipe: "swipe", continue: "continue" };

/** A marker line of the engine's, of any turn: what stands before and after a section in a prompt as Lumiverse assembled it. */
export const MARKER = /\/\/ lre:[0-9a-f]{8}:[0-9a-f]{8}(?::end)?/;

/** LumiAH's switch for each chat, as the engine set it: what mounting LumiAH gives the engine (`HarnessEngine.pin`). */
export type Pins = { chatId: string; harness: boolean }[];

/** Mounts the driver where LumiAH's backend will be: the engine is given LumiAH's switch for a chat, which lets a chat be switched to the harness. */
export function mount(rig: Rig): Pins {
  const pins: Pins = [];
  rig.rt.harness.pin = async (chatId, _userId, harness) => void pins.push({ chatId, harness });
  return pins;
}

/**
 * A Port Alder chat on the harness engine with the tests' people, and a helper that fails any model
 * call made of the engine. `setup` adds to the world; `minds` switches character minds on.
 */
export async function harnessChat(setup: AlderSetup = {}): Promise<{ rig: Rig; chatId: string }> {
  const made = await alderChat({ ...setup, put: { ...setup.put, entities: { ...PEOPLE, ...setup.put?.entities } } });
  made.rig.host.quietReply = () => {
    throw new Error("the harness path reached one of the engine's own model calls");
  };
  mount(made.rig);
  await playOn(made.rig, made.chatId, "harness");
  return made;
}

/** Chooses a chat's engine, as GM → This chat → Engine does. */
export async function playOn(rig: Rig, chatId: string, engine: "classic" | "agents" | "harness"): Promise<void> {
  rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: engine === "classic" ? null : engine }));
}

/** No model call was made of the engine: on the harness every model call is an agent's, in LumiAH's runtime. */
export function noModelCalls(rig: Rig): void {
  expect(rig.host.quietCalls.map((c) => (c.messages[0]?.content ?? "").slice(0, 80))).toEqual([]);
  expect(rig.host.decideCalls).toEqual([]);
}

/** LumiAH's record of a turn, as its run's end hands it over. */
export function turnRecord(run: Run, over: Partial<TurnRecord> = {}): TurnRecord {
  return { v: 1, generationId: run.turn, kind: run.kind === "job" || run.kind === "side" ? "new" : run.kind, at: 1, path: `path-${run.turn}`, segment: `segment-${run.turn}`, usage: USAGE, ...over };
}

/** One run of the runtime: a turn that answers a generation, or a job's. */
export class Run {
  private calls = 0;
  /** The World Info the generation's prompt held, as the host assembled it. */
  readonly assembled: AssembledEntry[];

  constructor(
    readonly rig: Rig,
    readonly chatId: string,
    /** The run's id: the generation's, or the job's. */
    readonly turn: string,
    readonly kind: RunKind,
    /** The generation the run answers; none for a job's. */
    readonly generation: Generation | null,
  ) {
    this.assembled = generation ? [...rig.host.assembled] : [];
  }

  private get engine() {
    return this.rig.rt.harness;
  }

  /** One tool call of `agent`, as the runtime sends it over the link: with the run's kind, whether the agent is the run's main agent, and the agents over it. */
  call(agent: Agent, name: string, args: JsonObject = {}, signal: AbortSignal = new AbortController().signal): Promise<{ text: string; error?: boolean }> {
    const own = this.kind === "job" || this.kind === "side";
    const above = agent.above ?? (agent.main === true || own ? [] : [AUTHOR]);
    const main = agent.main ?? (own && above.length === 0);
    return this.engine.tools.call({ name, args, turn: this.turn, chatId: this.chatId, agentId: agent.id, role: agent.role, callId: `call-${++this.calls}`, kind: this.kind, main, above: above.map(({ id, role }) => ({ agentId: id, role })) }, signal);
  }

  /** A call's answer read back from its JSON; a refusal fails the test with its text. */
  async answer(agent: Agent, name: string, args: JsonObject = {}): Promise<Record<string, unknown>> {
    const out = await this.call(agent, name, args);
    if (out.error) throw new Error(`${name} refused: ${out.text}`);
    return JSON.parse(out.text) as Record<string, unknown>;
  }

  /** A call's refusal, as the model reads it; an answer fails the test. */
  async refusal(agent: Agent, name: string, args: JsonObject = {}): Promise<string> {
    const out = await this.call(agent, name, args);
    if (!out.error) throw new Error(`${name} answered: ${out.text}`);
    return out.text;
  }

  /**
   * The writer's request as the core builds it from the prompt Lumiverse assembled: each enabled
   * preset block, with the World Info of each outlet it holds where the outlet stands; then the
   * World Info placed by position; then the chat; and the brief as one message before the player's
   * last.
   */
  request(brief: string | null): ModelMessage[] {
    const host = this.rig.host;
    const outlet = (name: string): string =>
      this.assembled
        .filter((e) => e.position === 8 && (e.outlet ?? "").toLowerCase() === name)
        .map((e) => e.content)
        .join("\n");
    const blocks = host.presetBlocks.filter((b) => host.blockStates[b.id] ?? b.enabled).map((b): ModelMessage => ({ role: "system", content: b.content.replace(/\{\{outlet::([^}]*)\}\}/gi, (_whole, name: string) => outlet(name.trim().toLowerCase())) }));
    const lore = this.assembled.filter((e) => e.position !== 8).map((e): ModelMessage => ({ role: "system", content: e.content }));
    const chat = host
      .chat(this.chatId)
      .messages.filter((m) => m.isUser || (m.swipes[m.swipeId] ?? "") !== "")
      .map((m): ModelMessage => ({ role: m.isUser ? "user" : "assistant", content: m.swipes[m.swipeId] ?? "" }));
    const messages = [...blocks, ...lore, ...chat];
    if (brief !== null) {
      const at = messages.findLastIndex((m) => m.role === "user");
      messages.splice(at < 0 ? messages.length : at, 0, { role: "system", content: `${BRIEF_FRAME}\n${brief}` });
    }
    return messages;
  }

  /** The messages the writer is sent: the core's request (`messages`, as it built it unless given) as the engine rewrote it, or as it came where the engine rewrites nothing. */
  async writer(brief: string | null, messages: ModelMessage[] = this.request(brief)): Promise<ModelMessage[]> {
    if (this.kind === "job" || this.kind === "side") throw new Error("only a turn has a writer");
    return (await this.engine.extension.writerRequest?.({ userId: this.rig.host.userId, chatId: this.chatId, generationId: this.turn, kind: this.kind, brief, messages })) ?? messages;
  }

  /** The reply was written whole. */
  async written(reply: string): Promise<void> {
    await this.engine.extension.replyWritten?.({ userId: this.rig.host.userId, chatId: this.chatId, turn: this.turn, reply, finish: "stop" });
  }

  /** The run ended, with LumiAH's record of the turn when it is done. */
  async end(status: TurnStatus = "done", over: { record?: TurnRecord | null; reason?: string; reply?: string } = {}): Promise<void> {
    const record = over.record !== undefined ? over.record : status === "done" && this.generation ? turnRecord(this) : null;
    await this.engine.extension.runEnded?.({ userId: this.rig.host.userId, chatId: this.chatId, turn: this.turn, kind: this.kind, status, ...(over.reason !== undefined ? { reason: over.reason } : {}), reply: over.reply ?? "", record, usage: USAGE });
    await this.rig.host.settle();
  }

  /**
   * The rest of a turn as it usually goes: the writer is asked with the author's brief, the reply is
   * written and Lumiverse saves it, and the run ends with its record. The messages the writer was sent.
   * `brief` null: the author stopped short of a brief, and the reply is written without one.
   */
  async finish(reply: string, brief: string | null = A_BRIEF): Promise<ModelMessage[]> {
    if (!this.generation) throw new Error("only a turn has a reply");
    const sent = await this.writer(brief);
    await this.written(reply);
    await this.rig.host.finish(this.generation, reply);
    await this.end("done");
    return sent;
  }
}

/** A job's run begins that no agent of a turn started (the user's own): the engine is told of no reply for it. */
export async function beginUserJob(rig: Rig, chatId: string, id: string): Promise<Run> {
  const run = new Run(rig, chatId, id, "job", null);
  await rig.rt.harness.extension.runBegan?.({ userId: rig.host.userId, chatId, turn: id, kind: "job", story: STORY_WITHOUT_CLAIM });
  return run;
}

/** What counts as the chat's story without the engine's word, as LumiAH resolves it for the claim (its defaults: hidden messages left out, everyone's messages read). */
export const STORY_WITHOUT_CLAIM: StorySource = { hidden: "leave_out", from: "everyone", newest: "directive" };

/** What the engine claims of the chat, as the runtime asks at the start of every run: with what holds of the story without the claim, and Lumiverse's Sovereign Hand as the runtime read it (null: Lumiverse doesn't say). */
export function claimOf(rig: Rig, chatId: string, without: { story?: StorySource; sovereignHand?: boolean | null } = {}) {
  const chat: ChatInfo = { id: chatId, name: "Alder", characterId: null, characterName: "Narrator", branchedFrom: null };
  return rig.rt.harness.extension.claim?.({ userId: rig.host.userId, chatId, chat, story: without.story ?? STORY_WITHOUT_CLAIM, sovereignHand: without.sovereignHand ?? null }) ?? Promise.resolve(null);
}

/** The engine's tools as the runtime lists them for the chat. */
export function toolsOf(rig: Rig, chatId: string): Promise<RemoteTool[]> {
  return rig.rt.harness.tools.list(chatId);
}

/**
 * A turn begins: the player's message is sent (`text`; null for a swipe, a Regenerate or a Continue),
 * Lumiverse starts the generation and assembles its prompt, and the runtime, which found the request
 * on its connection, asks the engine about the chat and begins the run.
 */
export async function beginTurn(rig: Rig, chatId: string, text: string | null, opts: StartOptions = { type: "normal" }): Promise<Run> {
  if (text !== null) {
    rig.host.sendUser(chatId, text);
    await rig.host.settle();
  }
  const generation = await rig.host.begin(chatId, opts);
  const kind = KINDS[generation.type];
  if (!kind) throw new Error(`no turn answers a ${generation.type} generation`);
  const run = new Run(rig, chatId, generation.id, kind, generation);
  await claimOf(rig, chatId);
  await rig.rt.harness.extension.runBegan?.({ userId: rig.host.userId, chatId, turn: generation.id, kind, story: STORY_WITHOUT_CLAIM });
  return run;
}

/** A job's run begins: one an agent of `basis` started (`by`: its main agent, unless said; `parent`: the job that agent was of, where it was a job's own), which the runtime told the engine of as it started. */
export async function beginJob(rig: Rig, basis: Pick<Run, "turn" | "chatId">, id: string, by: Agent = AUTHOR, parent?: string): Promise<Run> {
  rig.rt.harness.jobKnown({ id, basis: basis.turn, by: { who: "agent", id: by.id, role: by.role }, ...(parent !== undefined ? { parent } : {}) });
  const run = new Run(rig, basis.chatId, id, "job", null);
  await rig.rt.harness.extension.runBegan?.({ userId: rig.host.userId, chatId: basis.chatId, turn: id, kind: "job", story: STORY_WITHOUT_CLAIM });
  return run;
}

/** The chat's state as its ledger folds it now. */
export async function stateOf(rig: Rig, chatId: string): Promise<WorldState> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no ledger");
  return core.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
}

/** The record the shown swipe of a message holds, as the ledger has it (the journal's over the message's); null when it holds none. */
export async function recordOn(rig: Rig, chatId: string, messageId: string): Promise<Rec | null> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no ledger");
  const message = core.chain(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).find((m) => m.id === messageId);
  return message ? activeRecord(message, core.journal.tombstones) : null;
}

/** An account's money as the ledger folds it now, in cents: the player character's unless named. */
export async function cashOf(rig: Rig, chatId: string, who = "pov"): Promise<number> {
  return balance(await stateOf(rig, chatId), who);
}
