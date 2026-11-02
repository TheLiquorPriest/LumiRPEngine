// The director role, agent-backed (INC2-SPEC C9, AGENT-LOOP-PLAN §5, §7): the odds of each person's
// choices, before the plan for the people present and after the reply for those off-screen, which
// the engine samples on the turn's seeded generator (`oddsDecisions`, classic's); the brief and the
// outline for the planned turn, held to classic's caps and leak checks; and suggested next moves
// after the reply, held to classic's.
//
// Every task of it reads as every role does (Settings → Agents → Context): its tools everything,
// secrets marked, and its prompt starting with the sections its context names (by default the Minds
// and the Scene, with the scene role's notes). Each person's choices are their own agent's, told to
// work from what they know (its perspective and its task's holdings), with the director's tools. A
// brief or outline line that contradicts the turn it was given (`proseClashes`) is flagged to the
// main agent and Diagnostics, never dropped: the line stays. Knowledge before the plan: while the chat
// tracks knowledge, a decision before the plan turns on what its chooser heard in the player's
// message, so the knowledge step runs for the choosers who heard it first, on the knowledge role's
// settings; what they learned is recorded ahead of the decisions (`heard.learned`) as the user's
// `learn` mode keeps it after the reply, and each decision reads its chooser's holdings with what was kept.

import type { EntityId } from "../../../shared/ids";
import { isRecord } from "../../../shared/json";
import { roleTaskTextId } from "../../../shared/role-prompts";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { own } from "../../../engine/pack-kit";
import { placeOfEntity } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { Working } from "../../../engine/working";
import { preKnowledge } from "../../minds";
import { heldKnowledge } from "../../minds-context";
import { FAILED_TEXT } from "../../../shared/agent-failures";
import { renderPrompt } from "../../prompts";
import type { Runtime } from "../../runtime";
import { effectiveMode } from "../../settings-store";
import { decisionAnswers } from "../../steps";
import { npcOddsOf, npcQuestions, OUTLINE_BEATS_MAX, proseAnswer, type TieOdds } from "../../turn-steps";
import type { ChoicesTask, ChooseTask, DirectorProse, ProseTask, RoleResult, TurnAgentCtx } from "../turn-ctx";
import { addUsage, emptyUsage } from "../usage";
import { mindAsk } from "./minds-ask";
import { namesOf, type RoleAnswer, roleCtx, runRoleAgent } from "./agent";
import { type ProseClash, proseClashes } from "./prose-check";

/** The facts a prose step reads, as its task text names them: classic's own vars, the empty ones empty. */
function proseData(vars: Readonly<Record<string, string>>): Record<string, string> {
  return { facts: vars.facts ?? "", present: vars.present ?? "", outcome: vars.outcome ?? "", beats: vars.beats ?? "", brief: vars.brief ?? "", recent: vars.recent ?? "", user: vars.user ?? "", reply: vars.reply ?? "" };
}

/**
 * Knowledge before the plan (AGENT-LOOP-PLAN §7.2): what the choosers of `task`'s ties who heard the
 * player's message learned from it, on the knowledge role's settings, handed to the turn ahead of
 * its decisions as the read keeps everyone else's learnings (`runtime.ts`): unless the user's `learn`
 * is Never on the connection the knowledge step ran on. The state their decisions read, with what
 * was kept.
 */
async function learnFirst(rt: Runtime, task: ChooseTask, ctx: TurnAgentCtx, choosers: readonly EntityId[]): Promise<Readonly<WorldState>> {
  if (!task.heard || !task.knowing) return task.state;
  const knowing = await roleCtx(rt, ctx, "knowledge");
  const ask = knowing.settings.promptOnly ? undefined : mindAsk(rt, knowing, "pre");
  const learned = await preKnowledge({ ...rt.minds, ...(ask ? { ask } : {}) }, { chatId: ctx.chatId, userId: ctx.userId, world: task.world, state: task.state, messageId: task.heard.messageId, user: task.heard.text, who: choosers, signal: ctx.signal });
  if (learned.events.length === 0) return task.state;
  const settings = await rt.settings.get(ctx.userId);
  if (effectiveMode(settings, await rt.settings.learningOf(ctx.userId), learned.connection ?? task.heard.connection, "learn").mode === "never") return task.state;
  task.heard.learned(learned.events);
  const w = new Working(rt.registry, task.world, task.state);
  w.applyAll(learned.events);
  return w.state;
}

/**
 * The odds of each tie of `task`, one agent per chooser: its choices, with what is known of each,
 * and, while the chat tracks knowledge, what its chooser holds. A chooser whose agent gives no answer
 * classic's check takes does as the role's `onFail` says: their ties take classic's own odds, or
 * decide nothing; when no chooser's does, the role fails, and the orchestrator does as it says.
 */
export async function decideRun(rt: Runtime, task: ChooseTask, ctx: TurnAgentCtx): Promise<RoleResult<TieOdds | null>> {
  if (task.ties.length === 0) return { ok: true, out: null, usage: emptyUsage(), via: "agent" };
  const settings = await rt.settings.get(ctx.userId);
  const ownTexts = ctx.texts ?? settings.prompts.texts;
  const choosers = [...new Set(task.ties.map((t) => t.agent))];
  const state = await learnFirst(rt, task, ctx, choosers);
  const questionId = roleTaskTextId("director", "decisions", "question");
  const question = renderPrompt(questionId, ownTexts, {}, task.template !== null ? { [questionId]: task.template } : null);
  const names = namesOf(task.world, task.state);
  const cal = calendarOf(task.world);
  const asked = await Promise.all(
    choosers.map(async (who) => {
      const ties = task.ties.filter((t) => t.agent === who);
      const { questions } = npcQuestions(ties, task.describe, "");
      const choices = Object.fromEntries(
        ties.map((t, i) => {
          const q = questions[`t${i}`];
          return [`t${i}`, { about: task.describe(t), options: q?.type === "choice" ? q.criteria : {} }];
        }),
      );
      const place = placeOfEntity(state, who);
      const r = await runRoleAgent(
        rt,
        ctx,
        {
          sub: "decisions",
          purpose: "npc.choose",
          phase: task.phase === "pre" ? "pre" : "read",
          names,
          vars: {
            question,
            who: own(state.entities, who)?.name ?? who,
            place: place ? (own(task.world.places, place)?.name ?? place) : "",
            time: formatClock(cal, state.clock),
            holdings: task.knowing ? heldKnowledge({ reg: rt.registry, world: task.world, state, who }, settings.minds.knowledge, place) : "",
            choices: JSON.stringify(choices),
          },
          tools: task.world,
          check: (raw) => {
            const answers = decisionAnswers(raw, questions);
            const odds = answers ? npcOddsOf(ties, answers) : {};
            return Object.keys(odds).length > 0 ? odds : null;
          },
        },
      );
      return { ties, r };
    }),
  );
  const usage = emptyUsage();
  for (const { r } of asked) addUsage(usage, r.usage);
  const failed = asked.filter((a) => !a.r.ok);
  const first = failed[0]?.r;
  if (failed.length === asked.length && first && !first.ok) return { ok: false, code: first.code, reason: first.reason, usage, via: "agent" };
  const odds: TieOdds = {};
  for (const { r } of asked) if (r.ok) Object.assign(odds, r.out);
  if (failed.length > 0 && ctx.settings.onFail === "stop") return { ok: false, code: "contract", reason: renderPrompt(FAILED_TEXT.choices, ownTexts, {}), usage, via: "agent" };
  if (failed.length > 0 && ctx.settings.onFail === "prompt_only") {
    const classic = (await task.classic(ctx.signal)) ?? {};
    for (const { ties } of failed) for (const t of ties) if (classic[t.key]) odds[t.key] = classic[t.key] ?? {};
  }
  return { ok: true, out: odds, usage, via: "agent" };
}

/**
 * The brief and the outline for the planned turn, from one agent: only what classic's steps would
 * write this turn, each line held to their caps and marked as classic's steps mark it (`ProseMark`:
 * a line carrying a secret goes on marked, never left out). A line
 * that contradicts the turn the director was given, as it started and as it ends alike
 * (`proseClashes`: someone here whom both have elsewhere, or gone whom both have here; a thing in the
 * hands of someone who has it in neither, or lying here when neither has it here), is flagged to the
 * main agent and Diagnostics with its run (`DirectorProse.flagged`, `yields.ts`), and stays.
 */
export async function proseRun(rt: Runtime, task: ProseTask, ctx: TurnAgentCtx): Promise<RoleAnswer<DirectorProse>> {
  const { brief, outline } = task;
  if (!brief && !outline) return { ok: true, out: { prose: { brief: null, outline: [] } }, usage: emptyUsage(), via: "agent", text: "" };
  const ownTexts = ctx.texts ?? (await rt.settings.get(ctx.userId)).prompts.texts;
  const rule = (part: "brief" | "outline", ask: NonNullable<typeof brief>): string => {
    const id = roleTaskTextId("director", "prose", part);
    return renderPrompt(id, ownTexts, ask.vars, ask.template !== null ? { [id]: ask.template } : null);
  };
  const vars = (outline ?? brief)?.vars ?? {};
  const r = await runRoleAgent(
    rt,
    ctx,
    {
      sub: "prose",
      purpose: brief ? "brief" : "outline",
      phase: "prose",
      names: namesOf(task.world, task.state),
      vars: { ...vars, ...proseData(vars), asks: [brief ? rule("brief", brief) : "", outline ? rule("outline", outline) : ""].filter((t) => t !== "").join("\n\n"), sections: outline?.vars.sections ?? "" },
      answer: { part: "answer", vars: { beats_max: String(OUTLINE_BEATS_MAX) } },
      tools: task.world,
      check: (raw): DirectorProse | null => {
        if (!isRecord(raw)) return null;
        const clash = proseClashes(rt.registry, task.world, task.start, task.state);
        const flagged: ProseClash[] = [];
        // A clash is told with the run, and the line stays: the main agent and the GM judge it.
        const flag = (line: string): void => {
          const kind = clash(line);
          if (kind !== null) flagged.push({ kind, line });
        };
        const told = brief ? proseAnswer("brief", raw.brief, brief.mark).join(" ").trim() : "";
        for (const sentence of told.split(/(?<=[.!?])\s+(?=["“'(]?\p{Lu})/u)) if (sentence.trim() !== "") flag(sentence);
        const beats = outline ? proseAnswer("outline", raw.beats, outline.mark) : [];
        for (const beat of beats) flag(beat);
        return { prose: { brief: told === "" ? null : told, outline: beats }, ...(flagged.length > 0 ? { flagged } : {}) };
      },
    },
  );
  return r;
}

/** Suggested next moves after the reply: held to classic's own check (at most four, each short enough for a chip); one carrying a secret stays, its chip a spoiler (`ChoicesTask.secret`). */
export async function choicesRun(rt: Runtime, task: ChoicesTask, ctx: TurnAgentCtx): Promise<RoleAnswer<string[]>> {
  const ownTexts = ctx.texts ?? (await rt.settings.get(ctx.userId)).prompts.texts;
  const ruleId = roleTaskTextId("director", "choices", "rule");
  return runRoleAgent(
    rt,
    ctx,
    {
      sub: "choices",
      purpose: "choices",
      phase: "read",
      names: { world: task.vars.world ?? "", pov: task.vars.pov ?? "" },
      vars: { ...task.vars, ...proseData(task.vars), rule: renderPrompt(ruleId, ownTexts, task.vars, task.template !== null ? { [ruleId]: task.template } : null), reply: task.reply },
      tools: null,
      check: (raw) => (isRecord(raw) ? proseAnswer("choices", raw.choices) : null),
    },
  );
}
