// What the chat's live trace says is going on (plan §14, PlanChatUI-P1): a turn's run begins, who is at
// work, the newest progress line it gave, whether its model call is held by his pause on Live, and how
// it ended. Folded from the events the page hears as they come, so the HUD and Now show a turn the moment
// it starts, name the agent at work and the newest progress line, say Paused while the run is held, and
// say a failed run failed; and, where a turn ended before a word of its reply went out and the empty reply
// Lumiverse kept for it stays in the chat, what to do with that reply. A page that was not following when
// these were told (opened while a turn runs, or after one ended) folds the same from the chat's newest
// turn as the Live view reads it (`toldOfTurn`): its trace, its newest progress line, and the empty reply
// it left standing. Nothing is read on a timer.

import type { Activity } from "../../../shared/turn-activity";
import type { LiveEvent, TurnReply } from "../../../shared/api";
import { endedWords } from "../../trace-view";

/**
 * What the page knows of the chat's run: the line shown (null when none runs and none failed), whether the run's call is held, and the
 * turn whose empty reply stays in the chat with what to do with it, which the line keeps saying until the next run begins. While a turn
 * runs, RPH's id for its run and the definition of each of its agents by handle, so the line can say whose thinking or writing streams.
 */
export interface RunLine {
  activity: Activity | null;
  held: boolean;
  empty?: { turn: string; words: string };
  run?: string;
  agents?: Readonly<Record<string, string>>;
}

export const NO_RUN: RunLine = { activity: null, held: false };

/**
 * What a turn's read tells, as the events a follower would have heard: each record of its trace, its newest progress line, and the empty
 * reply it left standing in the chat (where it stands, the setting that takes such replies away is taken to be off, as shipped).
 */
export function toldOfTurn(chat: string, turn: TurnReply): LiveEvent[] {
  const events: LiveEvent[] = turn.trace.map((record) => ({ chat, seq: 0, kind: "trace", at: record.at, data: record }));
  const last = turn.trace.at(-1);
  const progress = turn.reply.progress.at(-1);
  if (last !== undefined && progress !== undefined) events.push({ chat, seq: 0, kind: "reply", at: last.at, data: { run: last.run, line: turn.reply.progress.length - 1, progress } });
  if (turn.emptyReply !== null) events.push({ chat, seq: 0, kind: "empty_reply", at: last?.at ?? 0, data: { turn: turn.id, message: turn.emptyReply, off: true } });
  return events;
}

/** A turn's read folded as if heard: a run its trace leaves going on that the turn no longer runs (its end was never told) shows nothing. */
export function runOfTurn(chat: string, turn: TurnReply): RunLine {
  const line = foldRun(chat, NO_RUN, toldOfTurn(chat, turn));
  return line.activity?.state === "running" && turn.status !== "running" && turn.status !== "released" ? NO_RUN : line;
}

/** The line of a turn that ended before a word of its reply went out, where no failure of its run was told yet. */
const ENDED_EMPTY = "The turn ended before a word of its reply went out.";

/** RPE's agents in a line's words, by their definition; another by its definition's name. */
const AGENT_WORDS: Readonly<Record<string, string>> = { author: "The Author", gm: "The GM", narrator: "The narrator", character: "A character" };
const agentWords = (definition: string | undefined): string => (definition === undefined ? "An agent" : Object.hasOwn(AGENT_WORDS, definition) ? AGENT_WORDS[definition]! : `The ${definition}`);

/** The run line after `events` (a chat's, in order) came. */
export function foldRun(chat: string, before: RunLine, events: readonly LiveEvent[]): RunLine {
  let line = before;
  for (const event of events) {
    if (event.kind === "delta") {
      // A model call of the turn's run streams: the line says whose, and whether it thinks or writes, until a progress line comes.
      const delta = event.data;
      if (line.activity?.state !== "running" || delta.run !== line.run) continue;
      const doing = delta.thinking !== undefined && delta.thinking !== "" ? "thinking" : delta.text !== undefined && delta.text !== "" ? "writing" : null;
      const label = doing === null ? null : `${agentWords(line.agents?.[delta.agent])} is ${doing}`;
      if (label !== null && label !== line.activity.label) line = { ...line, activity: { ...line.activity, label } };
      continue;
    }
    if (event.kind === "reply") {
      const piece = event.data;
      if ("progress" in piece && line.activity?.state === "running") line = { ...line, activity: { ...line.activity, label: piece.progress } };
      continue;
    }
    if (event.kind === "empty_reply") {
      const { turn, off } = event.data;
      const words = off
        ? "Its empty reply stays in your chat: swipe it or delete it in Lumiverse, or switch on “Take away an empty reply a failed or stopped turn left” in Settings."
        : "Its empty reply stays in your chat, as RPE could not take it away: swipe it or delete it in Lumiverse.";
      const ended = line.activity?.state === "failed" && line.activity.turn === turn ? line.activity.label : ENDED_EMPTY;
      line = { held: false, activity: { chatId: chat, turn, state: "failed", label: `${ended} ${words}`, since: event.at }, empty: { turn, words } };
      continue;
    }
    if (event.kind !== "trace") continue;
    const { event: said, scope, at, agent, run } = event.data;
    // Each agent of the turn's run, by its handle, as its records name it.
    if (agent !== undefined && run === line.run && line.agents?.[agent.id] !== agent.definition) line = { ...line, agents: { ...line.agents, [agent.id]: agent.definition } };
    if (said.kind === "run_started") {
      if (said.run === "turn") line = { held: false, run, agents: agent === undefined ? {} : { [agent.id]: agent.definition }, activity: { chatId: chat, turn: scope.turn ?? null, state: "running", label: `${agentWords(said.lead)} is starting the turn`, since: at } };
    } else if (said.kind === "agent_started") {
      if (line.activity?.state === "running") line = { ...line, activity: { ...line.activity, label: `${agentWords(said.definition)} is at work` } };
    } else if (said.kind === "paused") {
      if (line.activity?.state === "running") line = { ...line, held: true };
    } else if (said.kind === "resumed") {
      line = { ...line, held: false };
    } else if (said.kind === "run_ended") {
      // A run that failed stays as the line until the next run begins; any other end clears it, but for the empty reply its turn left.
      const outcome = said.outcome;
      const failed = outcome.status === "failed" || outcome.status === "limit";
      const empty = line.empty !== undefined && line.empty.turn === scope.turn ? line.empty : undefined;
      // It is said in the Turn page's words (`endedWords`): the limit it reached and how far it went, the provider's tries and what broke the last.
      if (empty !== undefined) line = { held: false, activity: { chatId: chat, turn: empty.turn, state: "failed", label: `${failed ? endedWords(undefined, outcome) : ENDED_EMPTY} ${empty.words}`, since: at }, empty };
      else line = failed ? { held: false, activity: { chatId: chat, turn: scope.turn ?? null, state: "failed", label: endedWords(undefined, outcome), since: at } } : NO_RUN;
    }
  }
  return line;
}
