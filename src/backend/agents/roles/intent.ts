// The intent role, agent-backed (INC2-SPEC C9, AGENT-LOOP-PLAN §5): it reads the player's message into
// the actions it takes (`interpret`), judges an approach the player described (`judge`), and checks an
// answer to a puzzle (`puzzle.answer`), each as its classic step does, with the player character's
// knowledge by default. Each answer is classic's own type, read by classic's own parser: the read then
// goes through classic's post-processing (claims, Try, payees, leaks, unfit), the judgement through
// its reason check, and the probability into the intent.

import { roleTaskTextId } from "../../../shared/role-prompts";
import type { Judgement } from "../../../engine/adjudication";
import { TRY_ACTION } from "../../../engine/inferred";
import { ACTION_QUEUE_LIMIT } from "../../../engine/steps";
import { TIMELAPSE_ACTION } from "../../../engine/turn";
import { renderPrompt } from "../../prompts";
import type { Runtime } from "../../runtime";
import { catalogLine, decisionAnswers, type InterpretRead, interpretAnswer } from "../../steps";
import { judgeAnswer, judgeOdds } from "../../turn-steps";
import type { InterpretTask, JudgeTask, PuzzleTask, TurnAgentCtx } from "../turn-ctx";
import { emptyUsage } from "../usage";
import { namesOf, type RoleAnswer, runRoleAgent } from "./agent";

/** `interpret` as the intent role works it: the catalog, the scene and the player's words, read into the actions they take. A catalog with nothing in it reads as no action, with no call, as classic's does. */
export async function interpretRun(rt: Runtime, task: InterpretTask, ctx: TurnAgentCtx): Promise<RoleAnswer<InterpretRead | null>> {
  if (task.catalog.length === 0) return { ok: true, out: { action: null, params: {}, probabilities: { none: 1 } }, usage: emptyUsage(), via: "agent", text: "" };
  const own = ctx.texts ?? (await rt.settings.get(ctx.userId)).prompts.texts;
  const rule = (part: "timelapse" | "try", action: string): string => (task.catalog.some((a) => a.id === action) ? renderPrompt(roleTaskTextId("intent", "interpret", part), own, { action }) : "");
  const { world, pov, scene } = task.context;
  return runRoleAgent(
    rt,
    ctx,
    {
      sub: "interpret",
      purpose: "interpret",
      phase: "pre",
      names: { world: world.name, pov: pov.name },
      vars: {
        pov_id: pov.id,
        instructions: task.instructions ?? "",
        scene: scene.lines.join("\n"),
        places: scene.places.join("\n"),
        recent: scene.recent.join("\n"),
        catalog: task.catalog.map(catalogLine).join("\n"),
        text: task.text,
        currency: world.currency.code,
        symbol: world.currency.symbol,
        more: String(ACTION_QUEUE_LIMIT - 1),
        timelapse: rule("timelapse", TIMELAPSE_ACTION),
        try: rule("try", TRY_ACTION),
      },
      tools: task.world,
      check: (raw) => interpretAnswer(raw, task.catalog),
    },
  );
}

/** `judge` as the intent role works it: the approach rated for the check, and each outcome's odds when the story decides. */
export async function judgeRun(rt: Runtime, task: JudgeTask, ctx: TurnAgentCtx): Promise<RoleAnswer<Judgement>> {
  const own = ctx.texts ?? (await rt.settings.get(ctx.userId)).prompts.texts;
  const odds = judgeOdds(task.ask);
  const question = roleTaskTextId("intent", "judge", "question");
  return runRoleAgent(
    rt,
    ctx,
    {
      sub: "judge",
      purpose: "judge",
      phase: "pre",
      names: namesOf(task.world, task.state),
      vars: {
        question: renderPrompt(question, own, {}, task.template !== null ? { [question]: task.template } : null),
        max: String(task.ask.max),
        outcomes: odds ? renderPrompt(roleTaskTextId("intent", "judge", "outcomes"), own, { odds: JSON.stringify(odds) }) : "",
        action: task.ask.action,
        // As classic tells it: the player's words, at most 2,000 characters of them.
        text: task.ask.text.slice(0, 2000),
        scene: JSON.stringify(task.ask.scene),
      },
      answer: { part: "answer", vars: { keys: task.ask.odds ? `, "outcomes": {${Object.keys(task.ask.odds).map((o) => `"${o}": number`).join(", ")}}` : "" } },
      tools: task.world,
      check: (raw) => judgeAnswer(raw, task.ask),
    },
  );
}

/** `puzzle.answer` as the intent role works it: how likely the answer is right, from the accepted answers only this call is told. */
export async function puzzleRun(rt: Runtime, task: PuzzleTask, ctx: TurnAgentCtx): Promise<RoleAnswer<number>> {
  const own = ctx.texts ?? (await rt.settings.get(ctx.userId)).prompts.texts;
  const question = roleTaskTextId("intent", "puzzle", "question");
  return runRoleAgent(
    rt,
    ctx,
    {
      sub: "puzzle",
      purpose: "puzzle.answer",
      phase: "pre",
      names: namesOf(task.world, task.state),
      vars: { question: renderPrompt(question, own, {}, task.template !== null ? { [question]: task.template } : null), puzzle: task.question, accepted: JSON.stringify(task.accepted), answer: task.answer },
      // Only this call is told the accepted answers: it reads nothing else, so no tool can carry them on.
      tools: null,
      check: (raw) => {
        const a = decisionAnswers(raw, { correct: { type: "noul", instructions: "" } })?.correct;
        return a?.type === "noul" ? a.noul : null;
      },
    },
  );
}
