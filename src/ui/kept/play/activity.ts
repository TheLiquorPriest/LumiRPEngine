// What the chat's live trace says is going on (plan §14, PlanChatUI-P1): a turn's run begins, who is at
// work, the newest progress line it gave, whether its model call is held by his pause on Live, and how
// it ended. Folded from the events the page hears as they come, so the HUD and Now show a turn the moment
// it starts, name the agent at work and the newest progress line, say Paused while the run is held, and
// say a failed run failed. Nothing is read on a timer.

import type { Activity } from "../../../shared/diagnostics";
import type { LiveEvent } from "../../../shared/api";

/** What the page knows of the chat's run: the line shown (null when none runs and none failed), and whether the run's call is held. */
export interface RunLine {
  activity: Activity | null;
  held: boolean;
}

export const NO_RUN: RunLine = { activity: null, held: false };

/** What a failed run says, in a line: the run's own error code and detail. */
function failure(outcome: { status: string; error?: { code: string; detail?: string; agent?: string } }): string {
  const error = outcome.error;
  if (error === undefined) return `The turn ended: ${outcome.status}.`;
  const who = error.agent === undefined ? "" : ` (${error.agent})`;
  return `The turn failed${who}: ${error.detail ?? error.code}.`;
}

/** The run line after `events` (a chat's, in order) came. */
export function foldRun(chat: string, before: RunLine, events: readonly LiveEvent[]): RunLine {
  let line = before;
  for (const event of events) {
    if (event.kind === "reply") {
      const piece = event.data;
      if ("progress" in piece && line.activity?.state === "running") line = { ...line, activity: { ...line.activity, label: piece.progress } };
      continue;
    }
    if (event.kind !== "trace") continue;
    const { event: said, scope, at } = event.data;
    if (said.kind === "run_started") {
      if (said.run === "turn") line = { held: false, activity: { chatId: chat, turn: scope.turn ?? null, state: "running", label: `${said.lead} is starting the turn`, since: at } };
    } else if (said.kind === "agent_started") {
      if (line.activity?.state === "running") line = { ...line, activity: { ...line.activity, label: `${said.definition} is at work` } };
    } else if (said.kind === "paused") {
      if (line.activity?.state === "running") line = { ...line, held: true };
    } else if (said.kind === "resumed") {
      line = { ...line, held: false };
    } else if (said.kind === "run_ended") {
      // A run that failed stays as the line until the next run begins; any other end clears it.
      const status = (said.outcome as { status?: string } | undefined)?.status;
      line = status === "failed" || status === "limit" ? { held: false, activity: { chatId: chat, turn: scope.turn ?? null, state: "failed", label: failure(said.outcome), since: at } } : NO_RUN;
    }
  }
  return line;
}
