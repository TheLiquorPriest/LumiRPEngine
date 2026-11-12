// What the harness engine registers with LumiAH: its cast of agent definitions with their skills,
// how an agent of each definition reads and writes in RPEngine, and the world's level of guidance.
//
// - The cast (DEPTH2-PLAN §3, §5): the author, the main agent of every turn, and those it starts
//   (`delegate`, `job_start`): a character, one instance per principal (`as`, the person it is); the
//   game master; the narrator; the historian. The game master's assistant is the GM's own
//   conversation (GM → Assistant), which no turn starts. Nothing here starts an agent or decides for
//   one.
// - A definition is LumiAH's (`AgentDefinition`). Its name, what it is for and its instructions are
//   registry texts (`shared/harness-texts.ts`, the page "Harness engine", each lane's own gathered
//   there), sent in the user's own words where they wrote them. Its effort and budget are what it
//   runs with until the user's own settings for it say otherwise: LumiAH takes an extension's
//   definitions as defaults the user still overrides, so every number here is a setting's default,
//   never a rule. Its name, what it is for, its instructions and its tools stay the engine's
//   (`owns`), whatever version of it the user keeps in LumiAH: the texts are edited on the engine's
//   own Prompts page, and they name the tools. A definition whose texts aren't registered isn't
//   registered.
// - Each is given the tools its part needs and no more, and every tool its texts and skills name
//   (`test/backend/harness-cast-held.test.ts`). What it may do with them is held by the tools
//   themselves and the bridge's gate (who may write which beat, whose mind a character reads),
//   never by these lists alone.
// - The world's guidance is read for each chat: what the world is, whose the player character is,
//   and a line for each of the world's rules and tone settings as they stand in that chat.

import type { RoleId, RoleTier } from "../../../shared/agent-roles";
import type { ToolView } from "../../../shared/agent-tools";
import { HARNESS_AGENT, HARNESS_AGENT_IDS, HARNESS_FAMILY, HARNESS_TEXT, HARNESS_TOOL, type HarnessAgentId } from "../../../shared/harness-texts";
import { MINDS_TOOL } from "../../../shared/harness-texts-minds";
import { PLAY_TOOL } from "../../../shared/harness-texts-play";
import { PREPARE_TOOL } from "../../../shared/harness-texts-prepare";
import { RECORD_TOOL } from "../../../shared/harness-texts-record";
import { STAGE_TOOL } from "../../../shared/harness-texts-stage";
import { hasOwn } from "../../../shared/json";
import { worldMindsOf } from "../../../shared/minds";
import type { PromptTexts } from "../../../shared/prompts";
import type { NarratorView } from "../../../shared/settings";
import type { WorldDoc } from "../../../shared/world";
import { policyOf } from "../../../engine/adjudication";
import { own } from "../../../engine/pack-kit";
import { presetOf } from "../../../engine/realism";
import type { WorldState } from "../../../engine/state";
import { HARNESS_LISTED, type HarnessListed } from "../../agents/tools/harness";
import { toolsGuide } from "../../agents/tools/registry";
import { renderPrompt } from "../../prompts";
import type { AgentBudget, AgentDefinition, OwnedField, Skill } from "../shapes";
import { harnessSkills } from "../skills";
import { LUMIAH_FAMILY, LUMIAH_TOOL } from "./lumiah";

export { HARNESS_AGENT } from "../../../shared/harness-texts";

// ---------------------------------------------------------------- tools

const family = (id: string): string => `@${id}`;
const names = (pick: (tool: HarnessListed) => boolean): string[] => HARNESS_LISTED.filter(pick).map((t) => t.name);

/** A tool of the old engines' that only reads the world. `lore_load` reads too, but puts lore into the reply the turn is writing, which is the author's to do. */
const reads = (tool: HarnessListed): boolean => tool.writer === "read" && tool.name !== "lore_load";

/**
 * LumiAH's families the author is given whole: all but the reply's (it names `reply_write` alone:
 * on the harness no writer writes the reply, so `write_reply` is no tool of its), the preset's
 * (each agent is given its own part of the preset, `story/preset.ts`), and the web, which acts
 * outside the world and the chat.
 */
const AUTHOR_LUMIAH = Object.values(LUMIAH_FAMILY).filter((f) => f !== LUMIAH_FAMILY.reply && f !== LUMIAH_FAMILY.preset && f !== LUMIAH_FAMILY.web);

/**
 * The old engines' tools the assistant's own conversation can't use. Four note a fact for a turn's
 * own record to land (`ReadNotes`), and a conversation outside a turn has no record. The two that
 * keep a lore file would land it, on the game master's Apply, in the chat's own kept files rather
 * than the harness's workspace, where LumiAH's own `workspace_write` writes one at once.
 */
const NOT_IN_CONVERSATION: readonly string[] = ["person_add", "purchase", "revenue_note", "project_note", "lore_save", "lore_draft"];

/**
 * The tools each definition is given, by name or as a whole family (`@<family>`): the engine's own
 * whatever version the user keeps (`OWNS`), each switched off only on LumiAH's Tools page.
 * - The author: every family of the engine's but a person's own mind (it knows what no one person
 *   does), with the mind tools it needs by name (it reads any mind, and writes who a principal is
 *   and a supporting character's profile); LumiAH's families but the reply's, the preset's and the
 *   web; and `reply_write`, which releases a passage.
 * - A character: what reached it (`feed_read`), its own acts (`beat_write`), its own mind, its
 *   choice in a fight, and its skills. Nothing that reads the world as the game master does. On the
 *   direct line its answer is the reply: the author hands it the reply's stream (`delegate` with
 *   `to_reply`), which LumiAH streams through the author's own hold on the reply, so the character
 *   holds no `reply_write` of its own.
 * - The game master: what reads the world, an attempt's odds and stakes and a fight as it stands;
 *   a passage held to its beats (`passage_read`, `passage_check`); the story record it reads and
 *   writes its rulings to; any mind, to read. It rolls nothing: the dice fall when the author plays
 *   the attempt.
 * - The narrator: what reached the point of view it tells, and the passage it drafts, and nothing
 *   else.
 * - The historian: the one stretch of the chat's past the author opened for it (`stretch_read`),
 *   the beats it records from it (`stretch_beats`, `stretch_done`), and what reads the people,
 *   places, clock and lore those beats name. None of LumiAH's chat tools: it reads only its stretch.
 * - The game master's assistant: what reads the world, and every change the old engines' assistant
 *   could propose (the story's and the game master's), but those its conversation can't use
 *   (`NOT_IN_CONVERSATION`); LumiAH's chat and workspace. None of the harness engine's own tools:
 *   each works inside a turn. Its conversation's writer only checks a change and adds it to a
 *   proposal (`harness/assistant.ts`).
 */
function toolsOf(id: HarnessAgentId): string[] {
  switch (id) {
    case HARNESS_AGENT.author:
      return [...new Set([...HARNESS_LISTED.map((t) => t.family).filter((f) => f !== HARNESS_FAMILY.mind), ...AUTHOR_LUMIAH])].map(family).concat(MINDS_TOOL.read, MINDS_TOOL.write, LUMIAH_TOOL.replyWrite);
    case HARNESS_AGENT.character:
      return [RECORD_TOOL.feedRead, RECORD_TOOL.beatWrite, MINDS_TOOL.read, MINDS_TOOL.write, MINDS_TOOL.digested, PLAY_TOOL.mindFight, LUMIAH_TOOL.skillLoad];
    case HARNESS_AGENT.gm:
      return [...names(reads), HARNESS_TOOL.checksStakes, PLAY_TOOL.fightRead, STAGE_TOOL.passageRead, STAGE_TOOL.passageCheck, RECORD_TOOL.beatsRead, RECORD_TOOL.beatWrite, MINDS_TOOL.read, MINDS_TOOL.seed];
    case HARNESS_AGENT.narrator:
      return [STAGE_TOOL.narrationRead, STAGE_TOOL.passageDraft];
    case HARNESS_AGENT.historian:
      return [PREPARE_TOOL.read, PREPARE_TOOL.beats, PREPARE_TOOL.done, "people_find", "people_sheet", "places_find", "places_read", "time_clock", "lore_search", "lore_read"];
    case HARNESS_AGENT.assistant:
      return [...names((t) => t.writer !== null && t.name !== "lore_load" && !NOT_IN_CONVERSATION.includes(t.name)), family(LUMIAH_FAMILY.chat), family(LUMIAH_FAMILY.workspace)];
  }
}

/** The engine's tools among `tools`, a family's each by its name: what the tools' shared texts are read for. */
function listedIn(tools: readonly string[]): { name: string }[] {
  return HARNESS_LISTED.filter((t) => tools.includes(t.name) || tools.includes(family(t.family)));
}

// ---------------------------------------------------------------- budgets

const UNLIMITED = { callTokensIn: null, callMs: null, callTools: null, tokensIn: null, tokensOut: null, wallMs: null } as const;

/**
 * Each definition's budget as shipped: the default of its settings in LumiAH, where the user changes
 * any of it. Only an answer's size, the rounds of tool calls, the revisions and the calls at once are
 * bounded; everything else is unlimited until the user bounds it.
 */
const BUDGETS: Readonly<Record<HarnessAgentId, AgentBudget>> = {
  // A call's answer room holds the model's reasoning too, and a strong reasoning model can spend several thousand tokens deciding before it writes or calls anything: with too little room the answer is cut mid-thought and the run ends with nothing. So every agent's room is generous; rounds enough for a scene of several beats, its rulings, each passage released, and the jobs it starts.
  [HARNESS_AGENT.author]: { ...UNLIMITED, callTokensOut: 32_000, toolTurns: 40, revisions: 2, concurrency: 4 },
  // What reached them, a file or two of their own mind, their act, and a passage when the reply is theirs: a mind still calling tools after that has left its task.
  [HARNESS_AGENT.character]: { ...UNLIMITED, callTokensOut: 16_000, toolTurns: 12, revisions: 2, concurrency: 2 },
  // The odds, what the ruling turns on, what is at stake, the beat it writes; or a passage held to its beats, and held again after each redraft.
  [HARNESS_AGENT.gm]: { ...UNLIMITED, callTokensOut: 16_000, toolTurns: 12, revisions: 2, concurrency: 2 },
  // What reached the point of view, then the passage, and a round for each redraft the check asks: six rounds ran out mid-revision in a live scene, and its last draft was refused.
  [HARNESS_AGENT.narrator]: { ...UNLIMITED, callTokensOut: 16_000, toolTurns: 12, revisions: 3, concurrency: 1 },
  // One stretch read whole, its beats recorded a few calls at a time, and the stretch closed.
  [HARNESS_AGENT.historian]: { ...UNLIMITED, callTokensOut: 16_000, toolTurns: 16, revisions: 1, concurrency: 2 },
  // A question read from several sides, then the changes it asked for, each checked.
  [HARNESS_AGENT.assistant]: { ...UNLIMITED, callTokensOut: 16_000, toolTurns: 20, revisions: 1, concurrency: 4 },
};

// ---------------------------------------------------------------- definitions

/**
 * Definitions whose tools are their own trade, given whoever starts them (LumiAH's `grant`): the
 * author, who starts them all, holds none of a person's own mind's tools, nor the narrator's, nor
 * every tool the game master and the historian read and write with, and must not.
 */
const OWN_TOOLS: ReadonlySet<HarnessAgentId> = new Set([HARNESS_AGENT.character, HARNESS_AGENT.gm, HARNESS_AGENT.narrator, HARNESS_AGENT.historian]);

/**
 * What of each definition stays the engine's wherever the user keeps a version of it in LumiAH
 * (LumiAH's `owns`): its name, what it is for and its instructions, which are edited on the engine's
 * own Prompts page, and its tools, which those texts name. The user's version keeps its connection,
 * model, effort and limits.
 */
const OWNS: readonly OwnedField[] = ["instructions", "tools", "name", "description"];

/**
 * One definition in `texts`. Its instructions end with what its tools share (`toolsGuide`: what a
 * change does, how a thing is named), which the old engines tell an agent once in its system prompt
 * too. The author is given the request its turn answers (as much of it as the chat's claim shows
 * it); everyone it starts, its task alone, on the author's connection and model until the user, or
 * the engine's model settings, give them their own.
 */
function definitionOf(id: HarnessAgentId, texts: PromptTexts): AgentDefinition {
  const tools = toolsOf(id);
  const instructions = [renderPrompt(HARNESS_TEXT.agent(id, "instructions"), texts, {}), toolsGuide(listedIn(tools), texts)].filter((part) => part.trim() !== "").join("\n\n");
  return {
    id,
    name: renderPrompt(HARNESS_TEXT.agent(id, "name"), texts, {}),
    description: renderPrompt(HARNESS_TEXT.agent(id, "description"), texts, {}),
    instructions,
    given: id === HARNESS_AGENT.author ? "request" : "task",
    ...(id === HARNESS_AGENT.author ? {} : { follows: HARNESS_AGENT.author }),
    ...(OWN_TOOLS.has(id) ? { grant: "definition" as const } : {}),
    owns: [...OWNS],
    connectionId: null,
    model: null,
    effort: "inherit",
    toolCalls: "auto",
    tools,
    budget: { ...BUDGETS[id] },
  };
}

/** The engine's agent definitions and skills, in `texts`: what LumiAH reads at the start of every run (`HarnessExtension.definitions`). */
export function harnessDefinitions(texts: PromptTexts): { agents: AgentDefinition[]; skills: Skill[] } {
  return { agents: HARNESS_AGENT_IDS.map((id) => definitionOf(id, texts)), skills: harnessSkills(texts) };
}

// ---------------------------------------------------------------- how a definition's agents read and write

/**
 * How an agent of a definition works in RPEngine: the role its writes are made as (whose modes and
 * caps the writer reads, Settings → Agents), the writer tier it starts a run with (the author may
 * raise it, `grant_writes`), and the view its tools read with.
 */
export interface HarnessRole {
  role: RoleId;
  tier: RoleTier;
  view: ToolView;
  /** Under `gm`: every secret marked with whom it is known to and kept from, as a turn agent reads. */
  marks: boolean;
}

const ROLES: Readonly<Record<HarnessAgentId, HarnessRole>> = {
  // The author stands where the director did: it sees everything, marked, and may make the game master's edits.
  [HARNESS_AGENT.author]: { role: "director", tier: "gm", view: "gm", marks: true },
  // A mind names only who the world holds, and reads nothing through the view but who it is: what it perceives comes from its own tools.
  [HARNESS_AGENT.character]: { role: "minds", tier: "read", view: "everyone", marks: false },
  // The ruling stands in for the judge's answer, which the intent role gave.
  [HARNESS_AGENT.gm]: { role: "intent", tier: "read", view: "gm", marks: true },
  // The narrator tells what reached a point of view, through its own tool: it reads nothing else, and writes nothing.
  [HARNESS_AGENT.narrator]: { role: "scene", tier: "read", view: "everyone", marks: false },
  // The historian records what the chat's past established, as the Curator kept the world's fabric, at the story's tier.
  [HARNESS_AGENT.historian]: { role: "curator", tier: "story", view: "gm", marks: true },
  // In a turn it only reads, as any agent no turn has a part for. Its own conversation (GM → Assistant, `harness/assistant.ts`) gives it the game master's tier there, with a writer that only checks.
  [HARNESS_AGENT.assistant]: { role: "director", tier: "read", view: "gm", marks: true },
};

/** How an agent of the definition `id` reads and writes; null for a definition that isn't the engine's (a user's own, LumiAH's), which only reads. */
export function harnessRole(id: string): HarnessRole | null {
  return hasOwn(ROLES, id) ? ROLES[id as HarnessAgentId] : null;
}

// ---------------------------------------------------------------- the world's guidance

/**
 * The world's level of guidance for one chat (`ChatClaim.guidance`), in `texts`: the world and its
 * player character by name, then a line for each rule and tone setting as it stands in the chat's
 * state. `narrator`: what the narrator knows in this chat (`narratorView`); without it, its two
 * lines are left out. A line the user blanked is left out too.
 */
export function worldGuidance(input: { world: WorldDoc; state: Readonly<WorldState>; texts: PromptTexts; narrator?: NarratorView }): { name: string; text: string } {
  const { world, state, texts, narrator } = input;
  const text = (id: string, vars: Readonly<Record<string, string>> = {}): string => renderPrompt(id, texts, vars);
  const said = { world: world.name, pov: own(state.entities, world.pov)?.name ?? world.pov };
  const policy = policyOf(world, state);
  const approach = { max: String(policy.description.max), at: String(policy.description.advantageAt) };
  const rules = [text(HARNESS_TEXT.checks(policy.checks)), text(HARNESS_TEXT.authority(policy.authority)), text(HARNESS_TEXT.approach(policy.description.weight), approach), text(HARNESS_TEXT.retry(policy.retry), { minutes: String(policy.retryAfter) })];
  const tone = [
    text(HARNESS_TEXT.realism(presetOf(state.realism))),
    text(HARNESS_TEXT.secrecy(worldMindsOf(world).secrecy)),
    ...(narrator ? [text(HARNESS_TEXT.narrator(narrator.knowledge), said), text(HARNESS_TEXT.secrets(narrator.secrets))] : []),
    text(HARNESS_TEXT.pricing(world.lenientPricing)),
  ];
  const listed = (parts: readonly string[]): string => parts.filter((line) => line.trim() !== "").join("\n");
  return { name: text(HARNESS_TEXT.guidanceName), text: text(HARNESS_TEXT.guidance, { ...said, rules: listed(rules), tone: listed(tone) }) };
}
