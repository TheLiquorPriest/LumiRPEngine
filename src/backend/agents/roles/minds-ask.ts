// The minds' calls in an agent turn (INC2-SPEC lane T2): every call a minds phase makes (a mind, a
// memory, a consolidation, the knowledge step, a time skip's beats or its plan) is asked of the role
// its step belongs to, on that role's settings. Its agent works the call's task from the call's own
// context, which classic builds for the character it is about, so it gets no tools: what it reads is
// that character's own. Classic's own check takes or refuses its answer; a refused one does as the
// role's `onFail` says, call by call: classic's own call, nothing (the step's call failed), or the
// turn stopped (after the reply, its read: `Orchestrator.roleStopped`). Who is asked, what they read
// and how their answers are recorded stay classic's.

import type { RoleId } from "../../../shared/agent-roles";
import { ROLE_LABEL } from "../../../shared/agent-roles";
import type { DiagPhase } from "../../../shared/diagnostics";
import type { JsonValue } from "../../../shared/json";
import { knowledgeText } from "../../../shared/minds";
import { roleTaskTextId } from "../../../shared/role-prompts";
import type { StepPurpose } from "../../../shared/world";
import type { MindAsk, MindCall, MindCallKind } from "../../mind-ask";
import type { Runtime } from "../../runtime";
import type { TurnAgentCtx } from "../turn-ctx";
import { type RoleAnswer, roleCtx, runRoleAgent } from "./agent";

/** Each call's role and task, and the classic step whose connection it runs on while the role names none. */
const KINDS: Readonly<Record<MindCallKind, { role: RoleId; sub: string; purpose: StepPurpose }>> = {
  mind: { role: "minds", sub: "mind", purpose: "mind" },
  memory: { role: "memory", sub: "memory", purpose: "memory" },
  consolidate: { role: "memory", sub: "consolidate", purpose: "consolidate" },
  knowledge: { role: "knowledge", sub: "knowledge", purpose: "knowledge" },
  skip: { role: "skip", sub: "beats", purpose: "skip" },
  skip_plan: { role: "skip", sub: "plan", purpose: "skip" },
};

/**
 * One minds call as its role's agent works it, on `ctx`, that role's context: the call's own task,
 * placeholders, wording and context, with no tools, and its answer as classic's own check takes it,
 * or why not, with the answer as written. The minds family's asker runs each call so; Test for a
 * minds role's text runs one.
 */
export async function mindRun(rt: Runtime, ctx: TurnAgentCtx, call: MindCall, phase: DiagPhase): Promise<RoleAnswer<JsonValue>> {
  const kind = KINDS[call.kind];
  const settings = await rt.settings.get(ctx.userId);
  const taskId = roleTaskTextId(kind.role, kind.sub, "task");
  const answer = call.knowing ? { part: "answer_knowing" } : call.kind === "knowledge" ? { part: "answer", vars: { lists: knowledgeText(settings.minds.knowledge, "stepAnswer") } } : undefined;
  return runRoleAgent(rt, ctx, {
    sub: kind.sub,
    purpose: kind.purpose,
    phase,
    names: { world: call.vars.world ?? "", pov: call.vars.pov ?? "" },
    vars: call.vars,
    ...(call.template !== null ? { own: { [taskId]: call.template } } : {}),
    data: call.context,
    ...(answer ? { answer } : {}),
    tools: null,
    // A call about one character reads that character's own knowledge, which the main agent's words are held to.
    ...(ctx.settings.knowledge === "own" ? { reads: { own: call.who } } : {}),
    check: (raw) => (call.check(raw) ? raw : null),
  });
}

/**
 * The asker of `ctx`'s turn for the minds phase that runs in `phase`: each call answered by its own
 * role's agent (`mindRun`), or by classic's call where that role is prompt-only. A call the turn's
 * signal cut short (its Cancel, a role that stopped the read) answers nothing, as classic's own call
 * does, so the phase ends as classic's would.
 */
export function mindAsk(rt: Runtime, ctx: TurnAgentCtx, phase: DiagPhase): MindAsk {
  return async (call) => {
    const kind = KINDS[call.kind];
    const own = await roleCtx(rt, ctx, kind.role);
    if (own.settings.promptOnly) return call.classic();
    let r: RoleAnswer<JsonValue>;
    try {
      r = await mindRun(rt, own, call, phase);
    } catch (error) {
      if (own.signal.aborted) return null;
      throw error;
    }
    call.usage.tokens += r.usage.in + r.usage.out;
    if (r.ok) return r.out;
    call.failure.reason = r.reason;
    rt.host.log("warn", `[LumiRPEngine] turn ${ctx.generationId.slice(0, 8)}: the ${ROLE_LABEL[kind.role]} role's ${call.kind} call gave no answer it takes (${r.code}: ${r.reason})`, ctx.userId);
    if (own.settings.onFail === "prompt_only") return call.classic();
    if (own.settings.onFail === "stop") rt.orchestrator.roleStopped({ chatId: ctx.chatId, userId: ctx.userId, turn: ctx.generationId }, phase, kind.role, r.reason);
    return null;
  };
}
