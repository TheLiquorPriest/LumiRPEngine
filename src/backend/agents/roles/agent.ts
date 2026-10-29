// An agent-backed role's task (INC2-SPEC C9, lane T2): one agent per task, started on the role's
// settings (`startRoleAgent`: its connection, model, effort, budget within the turn's, and caching),
// told its role's texts from R5's registry (`shared/role-prompts.ts`: its system prompt, its
// instructions with the preset's guidance for its steps after them and its pinned files after that,
// then the task's text and the description of its answer), given the tools of its families and tier
// under its knowledge (`toolsFor`, reading through the turn's reader and staging through its
// writer), and answered in its task's JSON contract, which classic's own validator turns into
// classic's type or refuses.
//
// A role reading with one character's own knowledge, or a task that reads only what its context holds
// (a mind, a decision), gets no tools and no pinned files: the tool layer reads as the player
// character, everyone or the GM, none of which is one character's own. Its pinned files are those
// `.pins.json` lists for its role, then those pinned in GM → Workspace, read with its knowledge on
// the turn's head within its pins budget (`pinnedFiles`). Every call is recorded in Diagnostics, and
// the live trace shows the role at work, by its label only.

import { FAILED_TEXT } from "../../../shared/agent-failures";
import type { RoleId, RoleTier } from "../../../shared/agent-roles";
import { ROLE_LABEL } from "../../../shared/agent-roles";
import type { AgentKnowledge, ToolFamily } from "../../../shared/agent-tools";
import type { DiagPhase } from "../../../shared/diagnostics";
import type { JsonValue } from "../../../shared/json";
import type { PromptTexts } from "../../../shared/prompts";
import { ROLES_TEXT, roleTaskTextId, roleTextId } from "../../../shared/role-prompts";
import { helperCallOf, stepConfigOf } from "../../../shared/settings";
import type { StepPurpose, WorldDoc } from "../../../shared/world";
import { firedTimeout } from "../../../shared/timeouts";
import { GUIDANCE_PREFIX, GUIDANCE_TARGETS, type GuidanceTarget } from "../../preset-binding";
import { renderPrompt } from "../../prompts";
import type { Runtime } from "../../runtime";
import { parseJsonReply } from "../../steps";
import type { TaskReads } from "../brief";
import type { AgentTool } from "../runtime";
import type { ToolReader } from "../tools/read-view";
import { toolsFor } from "../tools/registry";
import type { ToolWriter } from "../tools/writer";
import { recordAgentCalls } from "../transcripts";
import { type RoleResult, startRoleAgent, type TurnAgentCtx } from "../turn-ctx";
import { pinnedFiles, type PinsTexts } from "../turn-task";

/** The preset's guidance blocks each role gets, by the classic steps it stands in for, in Settings' order (§5's guidance rule). */
const ROLE_GUIDANCE: Readonly<Record<RoleId, readonly GuidanceTarget[]>> = {
  intent: ["interpret", "judge", "puzzle.answer"],
  scene: [],
  minds: ["mind"],
  knowledge: ["knowledge"],
  director: ["brief", "outline", "choices", "npc.choose"],
  read: ["extract"],
  memory: ["memory", "consolidate"],
  skip: ["skip"],
  world: [],
};

/** The tool families whose writes are the story's own (`opTier`): the workspace, and lore saved to it. A role at the story tier is given those writes and no GM edit. */
const STORY_FAMILIES: readonly ToolFamily[] = ["workspace", "lore"];

/** One task of a role, as its agent is asked to work it. */
export interface RoleAsk<O> {
  /** Which of its role's tasks it is (`ROLE_TASKS`): the texts it is told. */
  sub: string;
  /** The classic step it stands in for: its connection and model while the role names none (§15); null for a task no classic step works, which runs on the helper's. */
  purpose: StepPurpose | null;
  /** Where in the turn its calls are recorded. */
  phase: DiagPhase;
  /** The player character's name, and the world's: every role text may name them. */
  names: { world: string; pov: string };
  /** The task text's placeholders. */
  vars: Readonly<Record<string, string>>;
  /** The step's own wording of a task text, by its id (its world level: the world's or the user's step template, filled in). */
  own?: Readonly<Record<string, string>>;
  /** What it reads besides its task text, as the classic step reads it (a minds step's context): after the task text. */
  data?: string;
  /** Its answer's text (default `answer`), and that text's placeholders. */
  answer?: { part: string; vars?: Readonly<Record<string, string>> };
  /** The world its tools' schemas are filled from; null for a task that gets none. */
  tools: WorldDoc | null;
  /**
   * Whose knowledge the task reads with: what its tools and pinned files read with in place of its
   * role's (the director's brief and outline as the player character, as classic's prose steps
   * read, whatever the director reads with), and what the main agent's words for it are held to
   * (`screenBrief`): a decision its chooser's own, a player surface the player character's. Absent:
   * its role's, and under a character's own knowledge a character the task doesn't name, so none.
   */
  reads?: TaskReads;
  /** Classic's own check of the answer: its classic type, or null when it isn't one. */
  check(raw: JsonValue): O | null;
}

/** How a role's task ended (C9), with the answer as the model wrote it, which Test checks against the contract. */
export type RoleAnswer<O> = RoleResult<O> & { text: string };

/** The tools a role is given (§6): its families, at its tier, under the knowledge its task reads with (`io` its reader and writer); none under a character's own knowledge. */
function roleTools(ctx: TurnAgentCtx, io: { reader: ToolReader; writer: ToolWriter }, world: WorldDoc, texts: PromptTexts, knowledge: AgentKnowledge): AgentTool[] {
  const tier: RoleTier = ctx.settings.tier;
  const env = { userId: ctx.userId, chatId: ctx.chatId, knowledge, reader: io.reader, writer: tier === "read" ? null : io.writer, agent: { role: ctx.role, id: ctx.agentId }, signal: ctx.signal };
  const families = ctx.settings.families;
  const reads = toolsFor({ world, tiers: ["read"], families, texts, env });
  if (tier === "read") return reads;
  const writes = toolsFor({ world, tiers: ["gm"], families: tier === "gm" ? families : families.filter((f) => STORY_FAMILIES.includes(f)), texts, env });
  return [...reads, ...writes];
}

/** The preset's guidance for the role's steps, each block under its name, after its instructions; empty when the preset has none. */
function guidanceOf(rt: Runtime, ctx: TurnAgentCtx, texts: PromptTexts, names: RoleAsk<unknown>["names"]): string {
  const guidance = rt.presets.last(ctx.userId).guidance;
  const steps = GUIDANCE_TARGETS.filter((t) => ROLE_GUIDANCE[ctx.role].includes(t));
  const blocks = steps.flatMap((step) => {
    const text = guidance[step]?.trim() ?? "";
    return text === "" ? [] : [renderPrompt(ROLES_TEXT.guidanceBlock, texts, { step: `${GUIDANCE_PREFIX}${step}`, text })];
  });
  return blocks.length > 0 ? renderPrompt(ROLES_TEXT.guidance, texts, { ...names, blocks: blocks.join("\n\n") }) : "";
}

/** A role's framing of its pinned files, from the Every role page. */
const ROLE_PINS_TEXTS: PinsTexts = { pins: ROLES_TEXT.pins, file: ROLES_TEXT.pinsFile, headings: ROLES_TEXT.pinsHeadings, none: ROLES_TEXT.pinsNoHeadings };

/** `ctx`'s role's pinned files, read through `reader` (its task's knowledge) on the turn's head: its pins budget the manifest's for it, else `tokens`; none while the chat's world isn't loaded. */
async function rolePins(ctx: TurnAgentCtx, reader: ToolReader, texts: PromptTexts, tokens: number): Promise<string> {
  let view;
  try {
    view = await reader.view();
  } catch {
    return "";
  }
  return pinnedFiles(view, { role: ctx.role, tokens, pinned: true, texts, framing: ROLE_PINS_TEXTS });
}

/**
 * Works one task of `ctx`'s role with an agent and checks its answer with classic's own validator
 * (`ask.check`): classic's type, or why the answer isn't one. A role naming no connection runs on its
 * classic step's, else the helper's (§15). `ctx.texts`, where given, stands in for the user's own texts
 * (Test runs a role with the text it checks). A task whose phase's time ran out (Settings →
 * Timeouts) failed, as classic's call answers nothing then; a cancelled turn's task throws, as
 * classic's call would.
 */
export async function runRoleAgent<O>(rt: Runtime, ctx: TurnAgentCtx, ask: RoleAsk<O>): Promise<RoleAnswer<O>> {
  const settings = await rt.settings.get(ctx.userId);
  const own = ctx.texts ?? settings.prompts.texts;
  const role = ctx.role;
  const step = helperCallOf(ask.purpose ? stepConfigOf(settings.modelUse.steps, ask.purpose) : null, settings.helper);
  const at = ctx.settings.connectionId !== null ? ctx : { ...ctx, settings: { ...ctx.settings, connectionId: step.connectionId, model: ctx.settings.model ?? step.model } };
  const roleKnowledge = ctx.settings.knowledge !== "own" ? ctx.settings.knowledge : null;
  // What the task reads with: its own where it names one, else its role's; a task given no tools reads only what it is told.
  const knowledge = ask.tools ? (typeof ask.reads === "string" ? ask.reads : roleKnowledge) : null;
  const io = knowledge !== null && knowledge !== roleKnowledge ? ctx.readAs(knowledge) : { reader: ctx.reader, writer: ctx.writer };
  const sees = renderPrompt(ROLES_TEXT.sees[knowledge ?? "own"], own, ask.names);
  const system = renderPrompt(roleTextId(role, "system"), own, { ...ask.names, knowledge: sees });
  const pins = knowledge ? await rolePins(ctx, io.reader, own, settings.agents.main.pinsTokens) : "";
  const prefix = [renderPrompt(roleTextId(role, "instructions"), own, ask.names), guidanceOf(rt, ctx, own, ask.names), pins].filter((t) => t.trim() !== "");
  const tools = ask.tools && knowledge ? roleTools(ctx, io, ask.tools, own, knowledge) : [];
  const answer = ask.answer?.part ?? "answer";
  // The main agent's words for this run (C10's `brief`), held to what this task reads with; none in the fixed pipeline.
  const told = ctx.brief?.for(ask.reads ?? (ctx.settings.knowledge === "own" ? { own: null } : ctx.settings.knowledge)) ?? "";
  const message = [renderPrompt(roleTaskTextId(role, ask.sub, "task"), own, { ...ask.names, ...ask.vars }, ask.own), ask.data ?? "", renderPrompt(roleTaskTextId(role, ask.sub, answer), own, { ...ask.names, ...(ask.answer?.vars ?? {}) }), told]
    .filter((t) => t.trim() !== "")
    .join("\n\n");
  const handle = startRoleAgent(rt, at, { system, prefix, tools });
  rt.diag.agentWorking(ctx.chatId, ctx.userId, handle.id, ROLE_LABEL[role]);
  let reply;
  try {
    reply = await handle.send(message, ctx.signal);
  } finally {
    rt.diag.agentDone(ctx.chatId, ctx.userId, handle.id);
    await recordAgentCalls(rt.diag, { at: { chatId: ctx.chatId, userId: ctx.userId, turn: ctx.generationId }, phase: ask.phase, role, connection: at.settings.connectionId ?? "active", model: at.settings.model, transcript: handle.transcript() }).catch((error: unknown) => rt.host.log("warn", `[LumiRPEngine] turn ${ctx.generationId.slice(0, 8)}: the ${ROLE_LABEL[role]} role's calls weren't all recorded (${error instanceof Error ? error.message : String(error)})`, ctx.userId));
  }
  const usage = handle.usage();
  if (ctx.signal.aborted) {
    const fired = firedTimeout(ctx.signal);
    if (fired) return { ok: false, code: "timeout", reason: fired.message, usage, via: "agent", text: reply.text };
    throw ctx.signal.reason instanceof Error ? ctx.signal.reason : new Error("the turn was cancelled");
  }
  if (reply.status !== "answered") return { ok: false, code: reply.code ?? reply.status, reason: reply.reason ?? renderPrompt(FAILED_TEXT.noAnswer, own, {}), usage, via: "agent", text: reply.text };
  let raw: JsonValue;
  try {
    raw = parseJsonReply(reply.text);
  } catch {
    return { ok: false, code: "no_json", reason: renderPrompt(FAILED_TEXT.noJson, own, {}), usage, via: "agent", text: reply.text };
  }
  const out = ask.check(raw);
  return out === null ? { ok: false, code: "contract", reason: renderPrompt(FAILED_TEXT.contract, own, {}), usage, via: "agent", text: reply.text } : { ok: true, out, usage, via: "agent", text: reply.text };
}

/**
 * Another role's context in the same turn (a skip's minds at its beats, a decision's knowledge step):
 * that role's settings and an agent id of its own; the turn, its signal, reader and writer stay the
 * same. The main agent's words were for the role it ran, so the other role gets none of them.
 */
export async function roleCtx(rt: Runtime, ctx: TurnAgentCtx, role: RoleId): Promise<TurnAgentCtx> {
  if (role === ctx.role) return ctx;
  const settings = await rt.settings.get(ctx.userId);
  return { ...ctx, role, agentId: `${ctx.agentId}>${role}`, settings: settings.agents.roles[role], brief: null };
}

/** The player character's name and the world's, as every role text names them. */
export function namesOf(world: WorldDoc, state: { entities: Readonly<Record<string, { name: string } | undefined>> }): RoleAsk<unknown>["names"] {
  return { world: world.name, pov: state.entities[world.pov]?.name ?? world.pov };
}
