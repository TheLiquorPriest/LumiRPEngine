// What the harness engine registers with LumiAH (HARNESS-SLICE3: "Agents RPEngine registers"): its
// agent definitions with its skills, how an agent of each definition reads and writes in RPEngine,
// and the world's level of guidance.
//
// - A definition is LumiAH's (`AgentDefinition`). Its name, what it is for and its instructions are
//   registry texts (`shared/harness-texts.ts`, the page "Harness engine"), sent in the user's own
//   words where they wrote them. Its tools, effort and budget are what it runs with until the user's
//   own settings for it say otherwise: LumiAH takes an extension's definitions as defaults the user
//   still overrides, so every number here is a setting's default, never a rule.
// - The author is the main agent of a chat the engine claims; every other definition is one it
//   starts (`delegate`, `job_start`). Nothing here starts an agent or decides for one.
// - The world's guidance is read for each chat: what the world is, whose the player character is,
//   and a line for each of the world's rules and tone settings as they stand in that chat.

import type { RoleId, RoleTier } from "../../../shared/agent-roles";
import type { ToolView } from "../../../shared/agent-tools";
import { HARNESS_AGENT, HARNESS_AGENT_IDS, HARNESS_FAMILY, HARNESS_TEXT, HARNESS_TOOL, type HarnessAgentId } from "../../../shared/harness-texts";
import { PLAY_TOOL } from "../../../shared/harness-texts-play";
import { STORY_TOOL } from "../../../shared/harness-texts-story";
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
import type { AgentBudget, AgentDefinition, Skill } from "../shapes";
import { harnessSkills } from "../skills";
import { LUMIAH_FAMILY, LUMIAH_TOOL } from "./lumiah";

export { HARNESS_AGENT } from "../../../shared/harness-texts";

// ---------------------------------------------------------------- tools

const family = (id: string): string => `@${id}`;
const names = (pick: (tool: HarnessListed) => boolean): string[] => HARNESS_LISTED.filter(pick).map((t) => t.name);

/** A tool of the old engines' that only reads the world. `lore_load` reads too, but puts lore into the reply the turn is writing, which is the author's to do. */
const reads = (tool: HarnessListed): boolean => tool.writer === "read" && tool.name !== "lore_load";

/**
 * The old engines' tools the assistant's own conversation can't use. Four note a fact for a turn's
 * own record to land (`ReadNotes`), and a conversation outside a turn has no record. The two that
 * keep a lore file would land it, on the game master's Apply, in the chat's own kept files rather
 * than the harness's workspace, where LumiAH's own `workspace_write` writes one at once.
 */
const NOT_IN_CONVERSATION: readonly string[] = ["person_add", "purchase", "revenue_note", "project_note", "lore_save", "lore_draft"];

/**
 * The tools each definition is given until the user says otherwise, by name or as a whole family
 * (`@<family>`).
 * - The author: every family of the engine's but a person's own mind (it knows what no one person
 *   does, so a mind it wrote would be no one's own), and every family of LumiAH's.
 * - A character: only its own mind's tools (its view, its decision, its memory, its files, its
 *   choice in a fight), so what it reads is what that person perceives.
 * - The game master: what reads the world, a fight as it stands, and an attempt's odds and stakes.
 *   It changes nothing, and it rolls nothing: the dice fall when the author plays the attempt.
 * - The knowledge agent: its own two tools, and what reads people and who knows what.
 * - The chronicler: the chat as written, what reads the world, the story's own changes (things,
 *   places made in play, people who walk on, purchases), what the reply told (`story_record`: a
 *   move, an injury, a payment, a death, the time its telling added), and where the reply says
 *   something against its turn (`story_departure`). Not `time_pass`: the turn's own time is the
 *   author's alone, before its reply.
 * - The game master's assistant: what reads the world, and every change the old engines' assistant
 *   could propose (the story's and the game master's), but those its conversation can't use
 *   (`NOT_IN_CONVERSATION`); LumiAH's chat and workspace. None of the harness engine's own tools:
 *   each works inside a turn. Its conversation's writer only checks a change and adds it to a
 *   proposal (`harness/assistant.ts`).
 */
function toolsOf(id: HarnessAgentId): string[] {
  switch (id) {
    case HARNESS_AGENT.author:
      return [...new Set([...HARNESS_LISTED.map((t) => t.family).filter((f) => f !== HARNESS_FAMILY.mind), ...Object.values(LUMIAH_FAMILY)])].map(family);
    case HARNESS_AGENT.character:
      return [family(HARNESS_FAMILY.mind)];
    case HARNESS_AGENT.gm:
      return [...names(reads), HARNESS_TOOL.checksStakes, PLAY_TOOL.fightRead];
    case HARNESS_AGENT.knowledge:
      return [HARNESS_TOOL.knowledgeScene, HARNESS_TOOL.knowledgeInfer, ...names((t) => reads(t) && (t.family === "knowledge" || t.family === "people"))];
    case HARNESS_AGENT.chronicler:
      return [LUMIAH_TOOL.chatRead, LUMIAH_TOOL.chatGrep, LUMIAH_TOOL.chatSearch, ...names((t) => reads(t) || t.writer === "story"), STORY_TOOL.record, STORY_TOOL.departure];
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
  // Room in each answer for a reasoning model's thinking and a brief; rounds enough for a turn that reads, has people think, rolls, records, commits and starts its jobs.
  [HARNESS_AGENT.author]: { ...UNLIMITED, callTokensOut: 16_000, toolTurns: 40, revisions: 2, concurrency: 4 },
  // A look, a file or two of its own, its notes folded when some are due, and one record: a mind still calling tools after that has left its task.
  [HARNESS_AGENT.character]: { ...UNLIMITED, callTokensOut: 4000, toolTurns: 10, revisions: 2, concurrency: 2 },
  // The odds, what the ruling turns on, what is at stake.
  [HARNESS_AGENT.gm]: { ...UNLIMITED, callTokensOut: 4000, toolTurns: 8, revisions: 2, concurrency: 2 },
  // The scene, one record, and a second for what the first refused.
  [HARNESS_AGENT.knowledge]: { ...UNLIMITED, callTokensOut: 8000, toolTurns: 8, revisions: 1, concurrency: 2 },
  // Lookups together, then changes together, a few times over.
  [HARNESS_AGENT.chronicler]: { ...UNLIMITED, callTokensOut: 8000, toolTurns: 12, revisions: 1, concurrency: 4 },
  // A question read from several sides, then the changes it asked for, each checked.
  [HARNESS_AGENT.assistant]: { ...UNLIMITED, callTokensOut: 8000, toolTurns: 20, revisions: 1, concurrency: 4 },
};

// ---------------------------------------------------------------- definitions

/**
 * One definition in `texts`. Its instructions end with what its tools share (`toolsGuide`: what a
 * change does, how a thing is named), which the old engines tell an agent once in its system prompt
 * too. The author is given the request its turn answers; everyone it starts, its task alone, on the
 * author's connection and model until the user gives them their own.
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
    // A character's tools are its definition's, whoever starts it. LumiAH gives a delegate only what its starter holds unless the definition says otherwise, and the author, who starts every character, holds none of a mind's tools itself (it knows what no one person does).
    ...(id === HARNESS_AGENT.character ? { grant: "definition" as const } : {}),
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
  [HARNESS_AGENT.knowledge]: { role: "knowledge", tier: "read", view: "gm", marks: true },
  // The chronicler keeps the world's fabric true to the reply, as the Curator did, at the story's tier.
  [HARNESS_AGENT.chronicler]: { role: "curator", tier: "story", view: "gm", marks: true },
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
