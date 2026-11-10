// Why an agent's run gave no answer the engine takes (Increment 2's integration review, L4): the
// agent runtime's stops (a cancel, its budgets, the loop detector, a call that failed, the
// acceptance runs' guard) and a role's own failures (no answer, no JSON, not its task's form). Each
// is a registry text on the Main agent page, beside `main.ran.failed`, which tells the main agent of
// a role that failed with one of them as its `{{reason}}`; the same words reach Diagnostics, the
// engine-failed card and the GM assistant's answer. Pure data.

import { MAIN_AGENT_PAGE } from "./main-agent-prompts";
import type { PromptDef, PromptVar } from "./prompts";

/** The agent runtime's stops (`AgentStop`), by what stopped it. */
export const STOP_TEXT = {
  cancelled: "main.stop.cancelled",
  busy: "main.stop.busy",
  revisions: "main.stop.revisions",
  wallTime: "main.stop.wall_time",
  turnTime: "main.stop.turn_time",
  callTime: "main.stop.call_time",
  callTokensIn: "main.stop.call_tokens_in",
  tokensIn: "main.stop.tokens_in",
  tokensOut: "main.stop.tokens_out",
  turnTokensIn: "main.stop.turn_tokens_in",
  turnTokensOut: "main.stop.turn_tokens_out",
  loop: "main.stop.loop",
  toolTurns: "main.stop.tool_turns",
  turnToolTurns: "main.stop.turn_tool_turns",
  failed: "main.stop.failed",
  acceptanceRoulette: "main.stop.acceptance_roulette",
  acceptanceClosed: "main.stop.acceptance_closed",
  ceilingIn: "main.stop.ceiling_in",
  ceilingOut: "main.stop.ceiling_out",
  throttle: "main.stop.throttle",
} as const;

/** A role's own failures (`RoleResult.reason`): its answer, or its classic call's. */
export const FAILED_TEXT = {
  noAnswer: "main.failed.no_answer",
  noJson: "main.failed.no_json",
  contract: "main.failed.contract",
  interpret: "main.failed.interpret",
  choices: "main.failed.choices",
} as const;

const page = MAIN_AGENT_PAGE.id;
const STOPS = "Why an agent stopped";
const FAILURES = "Why a role failed";
const v = (name: string, text: string): PromptVar => ({ name, text, required: true });
const stop = (id: string, label: string, note: string, text: string, vars: readonly PromptVar[] = []): PromptDef => ({ id, page, group: STOPS, label, note: `${note} The reason a run that stopped so gives, in main.ran.failed's {{reason}}, Diagnostics and the engine-failed card.`, text, vars });
const failed = (id: string, label: string, note: string, text: string): PromptDef => ({ id, page, group: FAILURES, label, note: `${note} The reason the role's run gives, in main.ran.failed's {{reason}}, Diagnostics and the engine-failed card.`, text, vars: [] });

export const AGENT_FAILURE_PROMPTS: readonly PromptDef[] = [
  stop(STOP_TEXT.cancelled, "Cancelled", "The agent was cancelled: the turn's Cancel, its run ending, or the orchestrator stopping it.", "the agent was cancelled"),
  stop(STOP_TEXT.busy, "Still working", "A message sent while the agent still works on its last one.", "the agent is still working on its last message"),
  stop(STOP_TEXT.revisions, "Out of revisions", "A message after its first answer, once it has had every revision its budget allows (Revisions per agent).", "it has had the {{revisions}} it may have after its first answer", [v("revisions", "the revisions it may have, with the word: \"2 revisions\"")]),
  stop(STOP_TEXT.wallTime, "Out of time", "The agent's own time ran out (Time per agent, Settings → Agents → Budgets).", "the agent's time ran out (Time per agent)"),
  stop(STOP_TEXT.turnTime, "The turn out of time", "The turn's agents' time ran out (Agent time per turn).", "the turn's agent time ran out (Agent time per turn)"),
  stop(STOP_TEXT.callTime, "A call too slow", "One call took longer than Time per call.", "the call took longer than Time per call"),
  stop(STOP_TEXT.callTokensIn, "A prompt too long", "A call whose prompt, as estimated, is past Prompt per call.", "the call's prompt, about {{tokens}}, is past Prompt per call ({{limit}})", [v("tokens", "the prompt's estimate, with the word: \"9,000 tokens\""), v("limit", "Prompt per call")]),
  stop(STOP_TEXT.tokensIn, "The agent's prompt tokens spent", "A call that would take the agent's prompt tokens past Prompt tokens per agent.", "the call would take the agent's prompt tokens past {{limit}} (Prompt tokens per agent)", [v("limit", "Prompt tokens per agent")]),
  stop(STOP_TEXT.tokensOut, "The agent's answer tokens spent", "The agent has written all Answer tokens per agent allows.", "the agent has written its {{tokens}} (Answer tokens per agent)", [v("tokens", "Answer tokens per agent, with the word: \"4,000 tokens\"")]),
  stop(STOP_TEXT.turnTokensIn, "The turn's prompt tokens spent", "A call that would take the turn's prompt tokens past Prompt tokens per turn.", "the call would take the turn's prompt tokens past {{limit}} (Prompt tokens per turn)", [v("limit", "Prompt tokens per turn")]),
  stop(STOP_TEXT.turnTokensOut, "The turn's answer tokens spent", "The turn's agents have written all Answer tokens per turn allows.", "the turn's agents have written its {{tokens}} (Answer tokens per turn)", [v("tokens", "Answer tokens per turn, with the word: \"20,000 tokens\"")]),
  stop(STOP_TEXT.loop, "The loop detector", "The agent called one tool with the same arguments as many times in a row as the loop detector allows.", "the agent called {{tool}} with the same arguments {{times}} in a row (Loop detector)", [v("tool", "the tool's name"), v("times", "how many times, with the word: \"3 times\"")]),
  stop(STOP_TEXT.toolTurns, "The agent's tool rounds spent", "The agent has had every round of tool calls Tool rounds per agent allows.", "the agent has had its {{rounds}} of tool calls (Tool rounds per agent)", [v("rounds", "Tool rounds per agent, with the word: \"8 rounds\"")]),
  stop(STOP_TEXT.turnToolTurns, "The turn's tool rounds spent", "The turn's agents have had every round of tool calls Tool rounds per turn allows.", "the turn's agents have had its {{rounds}} of tool calls (Tool rounds per turn)", [v("rounds", "Tool rounds per turn, with the word: \"40 rounds\"")]),
  stop(STOP_TEXT.failed, "A call failed", "A call that failed: the connection's or Lumiverse's error, as it gave it; words of your own may go around it.", "{{error}}", [v("error", "the error, as the connection or Lumiverse gave it")]),
  stop(STOP_TEXT.acceptanceRoulette, "A Model Roulette over a guarded connection", "An agent call on a Model Roulette connection that may send it on a connection acceptance runs guard.", "connection {{connection}} is a Model Roulette that may send the call on connection {{picked}}, which acceptance runs guard: an agent never calls through it while any of its connections is guarded", [v("connection", "the Model Roulette connection"), v("picked", "the guarded connection it may send the call on")]),
  stop(STOP_TEXT.acceptanceClosed, "No acceptance run open", "An agent call on a connection kept for acceptance runs while none is open.", "connection {{connection}} is kept for acceptance runs, and none is open: open one in Settings → Agents → Acceptance runs", [v("connection", "the connection")]),
  stop(STOP_TEXT.ceilingIn, "An acceptance run's prompt ceiling", "An agent call that would pass the connection's prompt-token ceiling for the open acceptance run.", "the call would pass connection {{connection}}'s ceiling for this acceptance run: {{ceiling}} in all, {{used}} of them spent or held, and it needs about {{needs}}", [v("connection", "the connection"), v("ceiling", "the run's prompt-token ceiling, with the words: \"300,000 prompt tokens\""), v("used", "the prompt tokens spent or held"), v("needs", "the prompt tokens the call needs, as estimated")]),
  stop(STOP_TEXT.ceilingOut, "An acceptance run's answer ceiling", "An agent call that would pass the connection's answer-token ceiling for the open acceptance run.", "the call would pass connection {{connection}}'s ceiling for this acceptance run: {{ceiling}} in all, {{used}} of them spent or held, and it may write {{needs}}", [v("connection", "the connection"), v("ceiling", "the run's answer-token ceiling, with the words: \"30,000 answer tokens\""), v("used", "the answer tokens spent or held"), v("needs", "the answer tokens the call may write")]),
  stop(STOP_TEXT.throttle, "Past a connection's throttle", "An agent call that needs more tokens than the connection's throttle lets through in a minute (Settings → Agents → Throttles).", "the call needs {{tokens}}, more than this connection's throttle lets through in a minute ({{limit}})", [v("tokens", "the tokens the call needs, with the word: \"9,000 tokens\""), v("limit", "the tokens the throttle lets through in a minute")]),
  failed(FAILED_TEXT.noAnswer, "No answer", "A role's agent stopped without an answer and without saying why.", "the agent stopped without an answer"),
  failed(FAILED_TEXT.noJson, "No JSON", "A role's agent answered with no JSON in it.", "the answer holds no JSON"),
  failed(FAILED_TEXT.contract, "Not its task's form", "A role's agent answered JSON that isn't its task's output contract, which classic's own check refuses.", "the answer doesn't keep the task's form"),
  failed(FAILED_TEXT.interpret, "The read of your message failed", "The intent role run prompt-only, when its classic call that reads the player's message failed.", "the call that reads the player's message failed"),
  failed(FAILED_TEXT.choices, "A person's choices unanswered", "The director's choices under Stop the turn, when one of the people a decision asks about got no odds the engine takes from their agent.", "a person's choices got no answer the engine takes"),
];
