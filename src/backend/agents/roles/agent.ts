// An agent-backed role's task (INC2-SPEC C9, lane T2): one agent per task, started on the role's
// settings (`startRoleAgent`: its connection, model, effort, budget within the turn's, and caching),
// told its role's texts from R5's registry (`shared/role-prompts.ts`), given the tools of its families
// and tier (`toolsFor`, reading through the turn's reader and staging through its writer), and
// answered in its task's JSON contract, which classic's own validator turns into classic's type or
// refuses.
//
// Its context is its config's (Settings → Agents → Context, `agents.context.roles[<role>]`), a guide
// and never a screen: every role's tools read everything, secrets marked in the user's wording,
// whatever perspective it works from. The prompt is laid out so the provider can cache what stays the
// same: the system prompt (with its perspective's text, then the workspace's system files for it,
// AGENTS.md and roles/<role>.md, the global workspace's then the chat's) and the stable prefix (its
// instructions, the preset's guidance for its steps, its pinned files: those its config pins, then
// `.pins.json`'s for it, then those pinned in GM → Workspace, within its pins budget; and the lore
// index when it starts with it) come first, then the message: the task's text, what the task reads
// besides it, the narrator's sections its config starts it with as they stand now, its answer's
// description, and the main agent's words for it whole. Every call is recorded in Diagnostics, and
// the live trace shows the role at work, by its label only.

import { LORE_INDEX_SOURCE } from "../../../shared/agent-context";
import { FAILED_TEXT } from "../../../shared/agent-failures";
import { RUNTIME_TEXT } from "../../../shared/agent-prompts";
import type { RoleId, RoleTier } from "../../../shared/agent-roles";
import { ROLE_LABEL } from "../../../shared/agent-roles";
import type { ToolFamily } from "../../../shared/agent-tools";
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
import type { AgentTool } from "../runtime";
import type { Summarize } from "../tools/condense";
import { loreIndexText } from "../tools/lore";
import { toolsFor } from "../tools/registry";
import { recordAgentCalls } from "../transcripts";
import { type RoleResult, startRoleAgent, type TurnAgentCtx } from "../turn-ctx";
import { pinnedFiles, type PinsTexts } from "../turn-task";
import { systemInstructions, withInstructions } from "../system-files";

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
  /** The world its tools' schemas are filled from; null for a task that gets none (a puzzle's answer, which only its call is told). */
  tools: WorldDoc | null;
  /** Classic's own check of the answer: its classic type, or null when it isn't one. */
  check(raw: JsonValue): O | null;
}

/** How a role's task ended (C9), with the answer as the model wrote it, which Test checks against the contract. */
export type RoleAnswer<O> = RoleResult<O> & { text: string };

/** The tools a role is given (§6): its families, at its tier, every one reading the GM's view with every secret marked; `summarize` lets its `condense` tool condense a source with its own model. */
function roleTools(ctx: TurnAgentCtx, world: WorldDoc, texts: PromptTexts, summarize: Summarize): AgentTool[] {
  const tier: RoleTier = ctx.settings.tier;
  const env = { userId: ctx.userId, chatId: ctx.chatId, knowledge: "gm" as const, marks: true, reader: ctx.reader, writer: tier === "read" ? null : ctx.writer, agent: { role: ctx.role, id: ctx.agentId }, signal: ctx.signal, loads: ctx.loads, summarize };
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
  const context = settings.agents.context.roles[role];
  const step = helperCallOf(ask.purpose ? stepConfigOf(settings.modelUse.steps, ask.purpose) : null, settings.helper);
  const at = ctx.settings.connectionId !== null ? ctx : { ...ctx, settings: { ...ctx.settings, connectionId: step.connectionId, model: ctx.settings.model ?? step.model } };
  // Its perspective is a hint in its system prompt; its tools read the same whatever it is.
  const perspective = renderPrompt(ROLES_TEXT.sees[context.perspective], own, ask.names);
  const system = renderPrompt(roleTextId(role, "system"), own, { ...ask.names, knowledge: perspective });
  // The head it reads, once for its system files, its pinned files and its lore index; none while the chat's world isn't loaded.
  const view = await ctx.reader.view().catch(() => null);
  // AGENTS.md and roles/<role>.md, the global workspace's then the chat's, after the role's own system prompt (DESIGN §4.4).
  const instructions = view ? await systemInstructions(view, { role, tokens: settings.agents.systemTokens, texts: own }) : "";
  const pins = view ? await pinnedFiles(view, { role, tokens: settings.agents.main.pinsTokens, pinned: true, texts: own, framing: ROLE_PINS_TEXTS, config: context.pins }) : "";
  const indexed = view && context.start.includes(LORE_INDEX_SOURCE) ? await loreIndexText(view, { tokens: settings.loreIndex.promptTokens }) : "";
  const index = typeof indexed === "string" ? indexed : "";
  const prefix = [renderPrompt(roleTextId(role, "instructions"), own, ask.names), guidanceOf(rt, ctx, own, ask.names), pins, index].filter((t) => t.trim() !== "");
  // What changes as the turn goes comes after the task, so the prefix stays the provider's to cache.
  const sections = await ctx.sections(context.start.filter((s) => s !== LORE_INDEX_SOURCE));
  const answer = ask.answer?.part ?? "answer";
  const message = [
    renderPrompt(roleTaskTextId(role, ask.sub, "task"), own, { ...ask.names, ...ask.vars }, ask.own),
    ask.data ?? "",
    sections === "" ? "" : renderPrompt(ROLES_TEXT.context, own, { ...ask.names, sections }),
    renderPrompt(roleTaskTextId(role, ask.sub, answer), own, { ...ask.names, ...(ask.answer?.vars ?? {}) }),
    // The main agent's words for this run (C10's `brief`), whole; none in the fixed pipeline.
    ctx.brief ?? "",
  ]
    .filter((t) => t.trim() !== "")
    .join("\n\n");
  // A source its `condense` tool condenses goes to one call of its own model, with no tools, recorded as its role's; its system files go with it, as with every call of the role.
  const condenseSystem = withInstructions(renderPrompt(RUNTIME_TEXT.condenseSystem, own, {}), instructions);
  const summarize: Summarize = async (asked, text, signal) => {
    const condenser = startRoleAgent(rt, at, { system: condenseSystem, prefix: [], tools: [] }, { phase: ask.phase, task: "condense" });
    try {
      const reply = await condenser.send(`${asked}\n\n${text}`, AbortSignal.any([ctx.signal, signal]));
      return reply.status === "answered" && reply.text.trim() !== "" ? { text: reply.text.trim() } : { failed: reply.reason ?? renderPrompt(FAILED_TEXT.noAnswer, own, {}) };
    } finally {
      await recordAgentCalls(rt.diag, { at: { chatId: ctx.chatId, userId: ctx.userId, turn: ctx.generationId }, phase: ask.phase, role, connection: at.settings.connectionId ?? "active", model: at.settings.model, transcript: condenser.transcript() }).catch(() => undefined);
    }
  };
  const tools = ask.tools ? roleTools(ctx, ask.tools, own, summarize) : [];
  const handle = startRoleAgent(rt, at, { system: withInstructions(system, instructions), prefix, tools }, { phase: ask.phase, task: ask.sub });
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
