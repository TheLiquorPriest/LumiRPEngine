// Test for a role's text (Settings → Agents → Prompts, `lre.prompts test`; AGENT-LOOP-PLAN §9, DESIGN
// §6.12). The text is checked as Settings would save it (R5's `testPrompt`); then the task whose
// contract it keeps runs once by its role's agent on the open chat, with the user's texts and this one
// in place, and the answer is checked against that contract.
//
// The task is the chat's own, built from its latest exchange as a turn builds it (`GROUNDED`): the
// latest reply and the player's message it answers, with that reply's turn as its record holds it
// (`readContext`). The pre phase's tasks read the state the turn planned from, the post phase's the
// state its reply was written in, each through the builder its turn phase uses; the director's prose
// takes the plan's lines from the turn's output events. A minds call is the first one its phase would
// make there, every call caught and none sent (`firstCall`). A task whose inputs only a turn under way
// has (`MID_TURN`), or one the chat can't give at all, runs on its role's texts alone, named for the
// chat's world and player character. Either way Test says, in words, what of the task it left out.
//
// No tools, so one model call; a writer that stages nothing; the call a Diagnostics record of its own
// (`test:<text id>`). The answer stays here: the page is told only what Test found, in words.

import { ROLE_IDS, type RoleId } from "../../../shared/agent-roles";
import { WRITE_NOTE } from "../../../shared/agent-tools-write";
import type { ChatId, MessageId, UserId } from "../../../shared/ids";
import type { JsonValue } from "../../../shared/json";
import type { PromptDef, PromptTexts } from "../../../shared/prompts";
import { roleContractId, rolePageId, ROLE_TASKS, roleTaskTextId } from "../../../shared/role-prompts";
import type { UserSettings } from "../../../shared/settings";
import type { StepPurpose, StepTemplateDef, WorldDoc } from "../../../shared/world";
import type { ChainMessage } from "../../../engine/ledger/chain";
import { ownMessage } from "../../../engine/ledger/path";
import { outputsOf } from "../../../engine/outputs";
import { unrevealedSecrets } from "../../../engine/visibility";
import { usualRoutineForExtract } from "../../../packs/castlife/core/usual";
import { knowledgeOn } from "../../chat-knowledge-prefs";
import { readableReply } from "../../json-hiding";
import type { MindAsk, MindCall, MindCallKind } from "../../mind-ask";
import { postKnowledge, postMemory, postMindsInput, postOpening, type PostMindsInput, preMinds } from "../../minds";
import type { Guidance } from "../../preset-binding";
import { type PromptTestResult, renderPrompt, testPrompt } from "../../prompts";
import type { ReadInput, Runtime } from "../../runtime";
import { noFacts, renderTemplate, runsOf, type SignalFacts, type StepRun } from "../../turn-steps";
import { recentLines } from "../../view";
import { AgentTurn } from "../runtime";
import { type ChatHead, chatHead } from "../tools/workspace";
import type { OpRefusal, ToolWriter } from "../tools/writer";
import type { TurnAgentCtx } from "../turn-ctx";
import { turnReader } from "../turn-writer";
import { namesOf, type RoleAnswer, runRoleAgent } from "./agent";
import { roleContract } from "./contracts";
import { choicesRun, proseRun } from "./director";
import { interpretRun } from "./intent";
import { mindRun } from "./minds-ask";
import { extractRun } from "./read";
import { sceneRun } from "./scene";
import { effectsRun } from "./world";

/**
 * Test for a role's text (R5's `testPrompt`): `text` checked as Settings would save it as `def`'s;
 * then, for a text describing a task's answer, the task run once by its role's agent with `text` in
 * place (`run`, given the texts to run with), and the answer checked against the task's contract.
 */
export function testRoleText(def: PromptDef, text: string, input: { maxChars: number; texts: PromptTexts; run(texts: PromptTexts): Promise<{ text: string }> }): Promise<PromptTestResult> {
  return testPrompt(def, text, { maxChars: input.maxChars, contract: def.contract ? roleContract(def.contract) : null, run: async (t) => (await input.run({ ...input.texts, [def.id]: t })).text });
}

/** The classic step whose connection a task's Test runs on while its role names none (§15), as the task's run in play does; by its contract. */
const TEST_PURPOSE: Readonly<Record<string, StepPurpose | null>> = {
  [roleContractId("intent", "interpret")]: "interpret",
  [roleContractId("intent", "judge")]: "judge",
  [roleContractId("intent", "puzzle")]: "puzzle.answer",
  [roleContractId("scene", "scene")]: null,
  [roleContractId("minds", "mind")]: "mind",
  [roleContractId("knowledge", "knowledge")]: "knowledge",
  [roleContractId("director", "decisions")]: "npc.choose",
  [roleContractId("director", "prose")]: "brief",
  [roleContractId("director", "choices")]: "choices",
  [roleContractId("read", "extract")]: "extract",
  [roleContractId("memory", "memory")]: "memory",
  [roleContractId("memory", "consolidate")]: "consolidate",
  [roleContractId("skip", "beats")]: "skip",
  [roleContractId("skip", "plan")]: "skip",
  [roleContractId("world", "effects")]: "extract",
};

/** The role whose page `def` is on, when it is a role's text with a task's contract: what Test runs. */
export function testedRole(def: PromptDef): RoleId | null {
  return def.contract === undefined ? null : (ROLE_IDS.find((role) => def.page === rolePageId(role)) ?? null);
}

/** What Test found (`PromptTestResult`), and what of the role's task the chat couldn't give: each part left out, in words, with why. */
export type RoleTestResult = PromptTestResult & { left: string[] };

/** The chat's latest exchange, as Test builds a task from it. */
interface Moment {
  chatId: ChatId;
  userId: UserId;
  head: ChatHead;
  settings: UserSettings;
  guidance: Guidance;
  /** The latest reply's turn as its record holds it (`readContext`), with the Journal's lines before it; the chat's head stands in for both its states while the reply has no record. */
  at: ReadInput;
  /** `at`'s world with the lore its World Info books hold now, as a turn's steps read it. */
  world: WorldDoc;
  /** The latest reply (the greeting before any turn), as the engine reads it; null in a chat with none. */
  reply: { id: MessageId; text: string } | null;
  /** The player's message it answers; "" when none does. */
  user: string;
  /** The messages before that message, or before the reply when none answers. */
  earlier: ChainMessage[];
  /** Whether the chat tracks knowledge (`knowledgeOn`). */
  knowing: boolean;
  /** What of the exchange the chat couldn't give. */
  left: string[];
}

async function momentOf(rt: Runtime, chatId: ChatId, userId: UserId, settings: UserSettings): Promise<Moment> {
  const head = await chatHead(rt, chatId, userId);
  if (!head) throw new Error("this chat's world isn't loaded");
  const { core, observed } = head;
  const index = observed.findLastIndex((m) => !m.isUser);
  const last = observed[index];
  const said = ownMessage(observed.slice(0, Math.max(index, 0)));
  const record = last ? core.readContext(last.id, observed) : null;
  const recent = index < 0 ? [] : recentLines(core, observed, index, rt.registry);
  const left: string[] = [];
  if (!last) left.push("the reply: the chat has none yet");
  else if (!said) left.push("the player's message: none comes right before the latest reply");
  if (last && !record) left.push("the turn's record: the latest reply has none, so the chat as it stands now is the state before and after it");
  const at: ReadInput = record ? { ...record, recent } : { world: head.world, state: head.state, start: head.state, pre: [], seed: "", read: "", recent };
  return {
    chatId,
    userId,
    head,
    settings,
    guidance: rt.presets.last(userId).guidance,
    at,
    world: await rt.readLore(chatId, userId, at.world),
    reply: last ? { id: last.id, text: readableReply(last.swipes[last.swipeId] ?? "", settings.hideJsonBlocks) } : null,
    user: said ? (said.swipes[said.swipeId] ?? "") : "",
    earlier: observed.slice(0, said ? observed.indexOf(said) : Math.max(index, 0)),
    knowing: knowledgeOn(await rt.chatKnowledge.get(chatId, userId), at.world, settings),
    left,
  };
}

/** Every signal fired: Test runs a step as a turn that fires it would, whatever its signals. */
const FIRING: SignalFacts = { ...noFacts(), typed: true, reply: true, sceneChange: true, slotCrossed: true, dayStart: true, beat: true, agentsPresent: true, present: true, offscreen: true, tieZone: true, invitation: true, timelapse: true, conflict: true };

/** The runs of `purpose` in the moment's world, as a turn firing every signal would make them; with `output`, only those templates. */
function stepRuns(m: Moment, purpose: StepPurpose, output?: StepTemplateDef["output"]): StepRun[] {
  return runsOf(m.settings.modelUse, m.at.world, purpose, FIRING, { guidance: m.guidance, ...(output ? { output } : {}) });
}

/** A task's classic call, which Test never makes: it runs the role's agent. */
function noClassic(): Promise<never> {
  return Promise.reject(new Error("Test runs the role's agent, never the classic step's call"));
}

/** What a reply's steps read besides it, as its read gives them (`readVars`): the placeholders, the usual routines, and the secrets they may not repeat. */
function replyFacts(rt: Runtime, m: Moment, reply: string): { vars: Record<string, string>; usual: string[]; secrets: string[] } {
  const usual = usualRoutineForExtract(rt.registry.context(m.at.world, m.at.state));
  const secrets = unrevealedSecrets(rt.registry, m.world, m.at.state);
  return { usual, secrets, vars: rt.readVars(m.at, { plan: undefined, user: m.user, text: reply, brief: outputsOf(m.at.pre)?.brief ?? "", usual, secrets }) };
}

/**
 * The first call of `kind` a minds phase would make, given its asker (`phase`): every call is caught
 * and answered with nothing, so no model is called; Test then asks the one it caught.
 */
async function firstCall(kind: MindCallKind, phase: (ask: MindAsk) => Promise<unknown>): Promise<MindCall | null> {
  const caught: MindCall[] = [];
  await phase(async (call) => {
    if (call.kind === kind) caught.push(call);
    return null;
  });
  return caught[0] ?? null;
}

/** A task as Test builds it from the chat: its run on the role's context, and what of it the chat couldn't give; no run when the chat can't give the task, which then runs on the role's texts alone. */
interface Grounded {
  run: ((ctx: TurnAgentCtx) => Promise<RoleAnswer<unknown>>) | null;
  left: string[];
}

type Build = (rt: Runtime, m: Moment, def: PromptDef, signal: AbortSignal) => Promise<Grounded>;

/** The minds' post phase input for the reply, as its read builds it. */
function postInput(m: Moment, reply: { id: MessageId; text: string }): Omit<PostMindsInput, "signal" | "read"> {
  return postMindsInput({ ...m.at, world: m.world }, { chatId: m.chatId, userId: m.userId, messageId: reply.id, user: m.user, reply: reply.text, guidance: m.guidance, knowledge: m.knowing });
}

/** A memory (`kind` memory) or consolidation after the reply, the first its post phase would ask; an answer text of the memory's tests itself, with knowledge tracked or not. */
function memoryTask(kind: "memory" | "consolidate"): Build {
  return async (rt, m, def, signal) => {
    const reply = m.reply;
    if (!reply) return { run: null, left: [] };
    const input = postInput(m, reply);
    const opening = await postOpening(rt.minds, input);
    const call = opening ? await firstCall(kind, (ask) => postMemory({ ...rt.minds, ask }, { ...input, signal }, opening)) : null;
    if (!call) return { run: null, left: [kind === "memory" ? "a memory: no one heard the latest exchange at a level that remembers it, or the minds are off" : "a consolidation: no one's notes are due to fold, or the minds are off"] };
    const knowing = def.id === roleTaskTextId("memory", "memory", "answer_knowing") || (def.id !== roleTaskTextId("memory", "memory", "answer") && call.knowing === true);
    const { knowing: _knowing, ...asked } = call;
    return { run: (ctx) => mindRun(rt, ctx, knowing ? { ...asked, knowing: true } : asked, "memory"), left: [] };
  };
}

/** The tasks Test builds from the chat, by contract, each as its turn phase does. */
const GROUNDED: Readonly<Record<string, Build>> = {
  [roleContractId("intent", "interpret")]: async (rt, m) => {
    const run = stepRuns(m, "interpret")[0];
    if (!run) return { run: null, left: ["the player's message and its scene: the interpret step is off"] };
    const state = m.at.start;
    const left = m.user.trim() === "" ? "" : await rt.leftUnplayed(m.chatId, m.userId, m.earlier, m.user);
    const built = rt.interpretTask({ text: m.user, render: { world: m.world, state }, all: rt.actionsOffered(m.world), earlier: m.earlier, run, hideJson: m.settings.hideJsonBlocks, left });
    return { run: (ctx) => interpretRun(rt, { text: m.user, world: m.world, state, ...built, classic: noClassic }, ctx), left: [] };
  },
  [roleContractId("scene", "scene")]: async (rt, m) => ({ run: (ctx) => sceneRun(rt, { text: m.user, world: m.world, state: m.at.start, classic: noClassic }, ctx), left: [] }),
  [roleContractId("minds", "mind")]: async (rt, m, _def, signal) => {
    const before = m.earlier.findLast((x) => !x.isUser);
    const call = await firstCall("mind", (ask) => preMinds({ ...rt.minds, ask }, { chatId: m.chatId, userId: m.userId, world: m.world, state: m.at.start, user: m.user, reply: before ? (before.swipes[before.swipeId] ?? "") : "", timelapse: false, signal, guidance: m.guidance.mind ?? "", knowledge: m.knowing }));
    return call ? { run: (ctx) => mindRun(rt, ctx, call, "pre"), left: [] } : { run: null, left: ["a mind: no one thinks at the turn's start (no one is with the player character, or the minds are off)"] };
  },
  [roleContractId("knowledge", "knowledge")]: async (rt, m, _def, signal) => {
    const reply = m.reply;
    if (!reply) return { run: null, left: [] };
    if (!m.knowing) return { run: null, left: ["the knowledge step: this chat doesn't track knowledge"] };
    const input = postInput(m, reply);
    const opening = await postOpening(rt.minds, input);
    const call = opening ? await firstCall("knowledge", (ask) => postKnowledge({ ...rt.minds, ask }, { ...input, signal, read: Promise.resolve([]) }, opening)) : null;
    return call ? { run: (ctx) => mindRun(rt, ctx, call, "read"), left: ["what the read found: Test doesn't read the reply first"] } : { run: null, left: ["the knowledge step: no one was there to learn from the latest exchange"] };
  },
  [roleContractId("read", "extract")]: async (rt, m) => {
    const run = stepRuns(m, "extract").find((r) => r.template === null || r.template.output !== "effects");
    const reply = m.reply;
    if (!run) return { run: null, left: ["the reply's read: the extract step is off"] };
    if (!reply) return { run: null, left: [] };
    const { vars, usual } = replyFacts(rt, m, reply.text);
    const input = rt.extractInput(m.at, { run, text: reply.text, said: m.user, vars, usual, skipped: false });
    return { run: (ctx) => extractRun(rt, { reply: reply.text, world: m.world, state: m.at.state, input, classic: noClassic }, ctx), left: [] };
  },
  [roleContractId("memory", "memory")]: memoryTask("memory"),
  [roleContractId("memory", "consolidate")]: memoryTask("consolidate"),
  [roleContractId("director", "prose")]: async (rt, m) => {
    const briefRuns = stepRuns(m, "brief", "text");
    const outlineRuns = stepRuns(m, "outline", "text");
    if (briefRuns.length === 0 && outlineRuns.length === 0) return { run: null, left: ["the brief and the outline: both steps are off"] };
    const out = outputsOf(m.at.pre);
    const lines = { outcome: out?.outcome ?? [], montage: out?.montage ?? [], beats: out?.outline ?? [] };
    const render = { world: m.world, state: m.at.state };
    const asks = rt.proseAsks(render, { plan: undefined, lines, text: m.user, recent: m.at.recent, secrets: unrevealedSecrets(rt.registry, m.world, m.at.state), briefRuns, outlineRuns });
    return { run: (ctx) => proseRun(rt, { lines, ...render, ...asks, classic: noClassic }, ctx), left: out ? [] : ["the plan's lines: the latest turn recorded none"] };
  },
  [roleContractId("director", "choices")]: async (rt, m) => {
    const run = stepRuns(m, "choices", "text")[0];
    const reply = m.reply;
    if (!run) return { run: null, left: ["suggested next moves: the choices step is off"] };
    if (!reply) return { run: null, left: [] };
    const { vars, secrets } = replyFacts(rt, m, reply.text);
    const withheld = rt.choiceWithheld(m.world, m.at.state, secrets, [`${reply.text}\n${m.user}`, ...Object.values(vars)].join("\n"));
    return { run: (ctx) => choicesRun(rt, { reply: reply.text, template: run.template ? renderTemplate(run.template.template, vars) : null, vars, withheld, classic: noClassic }, ctx), left: [] };
  },
  [roleContractId("world", "effects")]: async (rt, m) => {
    const run = (["extract", "choices"] as const).flatMap((purpose) => stepRuns(m, purpose, "effects"))[0];
    const reply = m.reply;
    if (!run) return { run: null, left: ["the world's effects step: the world has none"] };
    if (!reply) return { run: null, left: [] };
    const { vars } = replyFacts(rt, m, reply.text);
    return { run: (ctx) => effectsRun(rt, { template: run.template?.template ?? "", world: m.world, vars, currency: m.at.world.currency, classic: noClassic }, ctx), left: [] };
  },
};

/** The tasks whose inputs only a turn under way has, which Test runs on their role's texts alone: what it leaves out, and why. */
const MID_TURN: Readonly<Record<string, string>> = {
  [roleContractId("intent", "judge")]: "the approach and the check it is rated for: only a turn under way asks the judge, for the action its plan rolls",
  [roleContractId("intent", "puzzle")]: "the puzzle and the answers it takes: only a turn under way, answering a puzzle, has them",
  [roleContractId("director", "decisions")]: "the ties and who chooses them: a turn asks each chooser on their own, after the knowledge step for those who heard the player's message",
  [roleContractId("skip", "beats")]: "the time skip's span and beats: only a timelapse turn has them",
  [roleContractId("skip", "plan")]: "the time skip's span: only a timelapse turn has it",
};

// Every task of every role is built from the chat or named as a turn under way's: one missing would be a Test that can't say what it left out.
for (const [role, subs] of Object.entries(ROLE_TASKS)) {
  for (const sub of subs) {
    const id = roleContractId(role as keyof typeof ROLE_TASKS, sub);
    if (!GROUNDED[id] && !MID_TURN[id]) throw new Error(`Test builds no task for the role task ${role}.${sub}`);
  }
}

/** What `left` closes with when the task ran on its texts alone. */
const ALONE = "the rest of its task: it ran on the role's texts alone, named for the chat's world and player character";

/** A task on its role's texts alone, named for the chat's world and player character with no other placeholder filled; a description of its answer tests itself as the answer, any other text with its task's own. */
function textsAlone(rt: Runtime, ctx: TurnAgentCtx, m: Moment, def: PromptDef, contract: string): Promise<RoleAnswer<JsonValue>> {
  const sub = contract.slice(roleContractId(ctx.role, "").length);
  const part = def.id.startsWith(`${contract}.answer`) ? def.id.slice(contract.length + 1) : "answer";
  return runRoleAgent(rt, ctx, { sub, purpose: TEST_PURPOSE[contract] ?? null, phase: "pre", names: namesOf(m.head.world, m.head.state), vars: {}, answer: { part }, tools: null, check: (raw) => raw });
}

/**
 * Test for a role's text on `chatId` (Settings → Agents → Prompts, AGENT-LOOP-PLAN §9): `text`
 * checked as Settings would save it as `def`'s; then the task whose contract it keeps, built from the
 * chat's latest exchange, run once by its role's agent on the role's settings with no tools, with the
 * user's texts and `text` in place, and its answer checked against the contract, with what of the task
 * the chat couldn't give (`left`). One model call, which reads through the role's knowledge, stages
 * nothing and is a Diagnostics record of its own (`test:<text id>`). A text with problems makes no
 * call, and leaves nothing out.
 */
export async function roleTextTest(rt: Runtime, input: { userId: UserId; chatId: ChatId; def: PromptDef; role: RoleId; text: string; signal: AbortSignal }): Promise<RoleTestResult> {
  const { userId, chatId, def, role, signal } = input;
  const contract = def.contract ?? "";
  const settings = await rt.settings.get(userId);
  const own = settings.agents.roles[role];
  const refused = (): OpRefusal => ({ refused: true, code: "no_writer", reason: renderPrompt(WRITE_NOTE.noWriter, settings.prompts.texts, {}) });
  const writer: ToolWriter = { dryRun: async () => refused(), apply: async (ops) => ({ applied: [], refused: ops.map(() => refused()), chipId: null, pending: false }) };
  let left: string[] = [];
  const found = await testRoleText(def, input.text, {
    maxChars: settings.prompts.maxChars,
    texts: settings.prompts.texts,
    run: async (texts) => {
      const m = await momentOf(rt, chatId, userId, settings);
      const build = GROUNDED[contract];
      const task: Grounded = build ? await build(rt, m, def, signal) : { run: null, left: [MID_TURN[contract] ?? contract] };
      left = [...m.left, ...task.left, ...(task.run ? [] : [ALONE])];
      const ctx: TurnAgentCtx = {
        turn: new AgentTurn(settings.agents.turn),
        signal,
        userId,
        chatId,
        generationId: `test:${def.id}`,
        reader: turnReader(rt, () => m.head, { userId, chatId, knowledge: own.knowledge === "own" ? null : own.knowledge }),
        writer,
        role,
        agentId: `test:${role}`,
        // No tool families: the one call answers, and nothing is read or staged past what it is told.
        settings: { ...own, families: [] },
        brief: null,
        texts,
        readAs: (knowledge) => ({ reader: turnReader(rt, () => m.head, { userId, chatId, knowledge }), writer }),
      };
      const out = task.run ? await task.run(ctx) : await textsAlone(rt, ctx, m, def, contract);
      // An answer that doesn't keep the contract is what Test reports; a call that never answered is no Test at all.
      if (!out.ok && out.code !== "no_json" && out.code !== "contract") throw new Error(`the ${role} role's agent didn't answer (${out.reason})`);
      return out;
    },
  });
  return { ...found, left };
}
