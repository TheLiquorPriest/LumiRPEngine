// An agent's transcript as Diagnostics keeps it (AGENT-LOOP-PLAN §3.5): one agent record per call its
// send made (a call the connection refused for its native tools among them), and one for a stop short
// of an answer, each with what that call was sent and answered as a blob only Diagnostics points to.
// The GM assistant's sends, the main agent's stages and the roles' tasks record so.

import type { DiagAgentOutcome, DiagPhase } from "../../shared/diagnostics";
import type { DiagAt, Diagnostics } from "../diagnostics";
import type { AgentStatus, AgentTranscript } from "./runtime";

/** Each call's outcome as Diagnostics records it, by how the answer ended there; the loop detector's stop is a refusal to run the call. */
const OUTCOME: Readonly<Record<AgentStatus, DiagAgentOutcome>> = { answered: "ok", refused: "refused", stopped: "refused", cancelled: "cancelled", failed: "failed" };

/**
 * The text each Diagnostics record of an answer keeps, one per call (one the connection refused for
 * its native tools among them) and one for a stop short of an answer: what that call was sent that
 * the one before it wasn't (the first, the system prompt and the thread's history too), then what it
 * answered, or why it was refused or stopped. A send that a tool ended (`ToolOutcome.end`) keeps that
 * round's results with its last call.
 */
function callTexts(t: AgentTranscript): string[] {
  const texts: string[] = [];
  let lines: string[] = [`system:\n${[...t.prefix, t.system].join("\n\n")}`, ...t.history.map((m) => `${m.role}:\n${m.text}`)];
  for (const e of t.entries) {
    if (e.kind === "message") lines.push(`user:\n${e.text}`);
    else if (e.kind === "result") lines.push(`tool ${e.name}${e.error ? " (failed)" : ""}:\n${e.text}`);
    else {
      lines.push(e.kind === "answer" ? `assistant:\n${e.text}${e.calls.map((c) => `\n→ ${c.name} ${JSON.stringify(c.args)}`).join("")}` : e.kind === "stop" ? `stopped (${e.code}): ${e.reason}` : e.reason);
      texts.push(lines.join("\n\n"));
      lines = [];
    }
  }
  const last = texts.length - 1;
  if (last >= 0 && lines.length > 0) texts[last] = [texts[last], ...lines].join("\n\n");
  return texts;
}

/**
 * Each call an agent's send made, and how it stopped short of an answer if it did, as Diagnostics
 * agent records: under `at`'s turn, or outside any (the GM assistant), in `phase`. A call the
 * connection refused for its native tools is one too, refused, saying why, so the turn to tools as
 * text is on the record. `model` names the model of a stop with no call before it.
 */
export async function recordAgentCalls(diag: Pick<Diagnostics, "agentCall">, input: { at: DiagAt; phase: DiagPhase | null; role: string; connection: string; model: string | null; transcript: AgentTranscript }): Promise<void> {
  const { at, phase, role, connection, transcript } = input;
  const texts = callTexts(transcript);
  let n = 0;
  let model = input.model ?? "";
  let since = transcript.entries[0]?.at ?? Date.now();
  for (const e of transcript.entries) {
    if (e.kind === "answer") {
      model = e.model || model;
      const { estimated, ...counts } = e.usage;
      await diag.agentCall(at, phase, { role, connection, model: e.model, usage: { ...counts, ...(estimated.length > 0 ? { estimated: [...estimated] } : {}) }, ms: e.ms, outcome: "ok", ...(e.calls.length > 0 ? { tools: e.calls.map((c) => c.name) } : {}) }, texts[n++]);
    } else if (e.kind === "tools_refused") {
      await diag.agentCall(at, phase, { role, connection, model, usage: null, ms: e.ms, outcome: "refused", error: e.reason }, texts[n++]);
    } else if (e.kind === "stop") {
      await diag.agentCall(at, phase, { role, connection, model, usage: null, ms: Math.max(0, e.at - since), outcome: OUTCOME[e.status], error: e.reason }, texts[n++]);
    }
    since = e.at;
  }
}
