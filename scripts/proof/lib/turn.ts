// Readers of RPE's account of one turn, for every proof script (PlanGates-4 "gives to others"): the
// turn route's timings, the trace's calls, efforts, intent and release, and a kept request file. Pure:
// what a route answered goes in, facts come out. Where a field is newer than the RPE a run stood on,
// the reader says it is not served rather than guessing a value.
//
// Shapes, and where each was taken from:
// - `TurnDetail`, `TurnRun`, `TurnTimings`: RPE `src/ui/api.ts:124-191`.
// - `timings.intent` and `timings.thinking` (PlanTurn-3 item 4), as the lead ruled their shape on 15 Nov:
//   `intent: { from: number; to: number | null } | null` (the record's first token to its last, R-185)
//   and `thinking: { from: number; to: number | null }[]` (one span per model call on the reply's path
//   that thought before its first output, in call order), epoch ms on RPE's clock; `to: null` began and
//   did not end.
// - Trace events (`agent_started.effort`, `call_started.toolTokens`/`openingTokens`/`request`,
//   `call_ended.usage`/`toolCalls`, `intent`, `released.release`): RPH `src/contract/trace.ts` at the pin.
// - `call_ended.toolCalls[].began`, when the model began writing each tool call (pi's `toolcall_start`):
//   PlanHarnessCore-1 item 9, contract change C7, as its lane writes it in RPH `src/contract/trace.ts`
//   (`ToolCallView.began?: number`, the host's clock). Read where present; absent before it lands.
// - The kept request: RPE `GET /api/v1/chats/:chat/turns/:turn/requests/*` (`requestReply`, RPE `src/turn/shapes.ts`),
//   `{ name, same, messages: [{ role, text, block? }], tools: [{ name, file? }] }`: RPH keeps a request as pointers into the
//   turn's files, so the file itself holds no messages and the route rebuilds them exactly as sent. `same: false` is a rebuild
//   that is not what was sent, which shows nothing and is not read. A message's `block`, RPH's name for its own block (the
//   session's carry, the briefing), is read where the route gives one.
// - A run's id is its own, made by RPH when the run starts: a turn's first run, a continue and a "Settle
//   now" each have one, and none is the turn's (RPH `ff1c9839`; PlanHarnessTools-20). A record carries
//   its run's id in `run` and its turn in `scope.turn`; a streamed piece (`TraceDelta`) carries only
//   `run`. So a turn's pieces are those of any run its records name (`deltasOfTurn`), and a call, a
//   release or an intent is held to its own run, never found by the turn's id.

import type { ReleaseForm, TraceDelta, TraceRecord, Usage } from "rp-harness/contract";
import { isRecord } from "../../../src/shared/json";

/** A stretch of time on RPE's clock: began at `from`, ended at `to`, or began and did not end. */
export interface Span {
  from: number;
  to: number | null;
}

/** A span's length, or null where it did not end. */
export function spanMs(span: Span): number | null {
  return span.to === null ? null : span.to - span.from;
}

function isSpan(value: unknown): value is Span {
  return isRecord(value) && typeof value.from === "number" && (value.to === null || typeof value.to === "number");
}

/** The intent record's own time and the thinking before it, as the turn route serves them; "not served" by an RPE whose route gives neither field. */
export interface RecordTimes {
  intent: Span | null;
  thinking: Span[];
}

export function recordTimes(timings: unknown): RecordTimes | "not served" {
  if (!isRecord(timings) || !("intent" in timings) || !("thinking" in timings)) return "not served";
  const { intent, thinking } = timings;
  if (!(intent === null || isSpan(intent)) || !Array.isArray(thinking) || !thinking.every(isSpan)) return "not served";
  return { intent, thinking };
}

/** One model call of a turn, from its `call_started` and `call_ended`. Times on RPE's clock. */
export interface Call {
  agent: string;
  /** The run it belongs to, by the run's own id. */
  run: string;
  definition: string;
  call: number;
  startedAt: number;
  endedAt: number | null;
  /** The connection the call went to, by the name RPE's trace gives it. */
  connection: string;
  model: string;
  tools: number;
  /** The tokens of the tool list as sent and of the agent's opening block, by RPH's own estimate; null in records made before RPH gave them. */
  toolTokens: number | null;
  openingTokens: number | null;
  /** The kept request's file in the turn's folder, where the user's setting keeps it. */
  request: string | null;
  usage: Usage | null;
  /** Each tool call the model made: its name, the path its arguments name where they name one, and when it began to be written where the trace says (C7). */
  toolCalls: { name: string; path: string | null; began: number | null }[];
}

export function callsOf(trace: readonly TraceRecord[]): Call[] {
  const ends = new Map<string, TraceRecord>();
  for (const r of trace) if (r.event.kind === "call_ended") ends.set(`${r.run}\u0000${r.agent.id}\u0000${r.event.call}`, r);
  return trace.flatMap((r): Call[] => {
    if (r.event.kind !== "call_started") return [];
    const end = ends.get(`${r.run}\u0000${r.agent.id}\u0000${r.event.call}`);
    const ended = end?.event.kind === "call_ended" ? end.event : null;
    return [
      {
        agent: r.agent.id,
        run: r.run,
        definition: r.agent.definition,
        call: r.event.call,
        startedAt: r.at,
        endedAt: end?.at ?? null,
        connection: r.event.connection,
        model: r.event.model,
        tools: r.event.tools,
        toolTokens: r.event.toolTokens ?? null,
        openingTokens: r.event.openingTokens ?? null,
        request: r.event.request ?? null,
        usage: ended?.usage ?? null,
        toolCalls: (ended?.toolCalls ?? []).map((t) => ({ name: t.name, path: isRecord(t.args) && typeof t.args.path === "string" ? t.args.path : null, began: "began" in t && typeof t.began === "number" ? t.began : null })),
      },
    ];
  });
}

/** The agent the turn's run started with (the Author, as shipped), by its id and definition. */
export function leadOf(trace: readonly TraceRecord[]): { id: string; definition: string } | null {
  const started = trace.find((r) => r.event.kind === "run_started");
  return started ? { id: started.agent.id, definition: started.agent.definition } : null;
}

/** What the lead began at (`agent_started`): its effort (null where the record says none), model and connection. */
export interface LeadStart {
  effort: string | null;
  model: string;
  connection: string;
}

/** The effort and model the lead began at (`agent_started`); effort null where the record says none. */
export function leadStart(trace: readonly TraceRecord[]): LeadStart | null {
  const lead = leadOf(trace);
  const started = trace.find((r) => r.event.kind === "agent_started" && r.agent.id === lead?.id);
  return started?.event.kind === "agent_started" ? { effort: started.event.effort ?? null, model: started.event.model, connection: started.event.connection } : null;
}

/** The release: when, in which form, by which agent, and in which run. */
export function releaseOf(trace: readonly TraceRecord[]): { at: number; form: ReleaseForm; by: string; run: string } | null {
  const released = trace.find((r) => r.event.kind === "released");
  return released?.event.kind === "released" ? { at: released.at, form: released.event.release.form, by: released.event.release.by.id, run: released.run } : null;
}

/** When the intent record reached the trace, whole, and in which run. */
export function intentOf(trace: readonly TraceRecord[]): { at: number; run: string } | null {
  const intent = trace.find((r) => r.event.kind === "intent");
  return intent === undefined ? null : { at: intent.at, run: intent.run };
}

/** The call that wrote the reply: the releasing agent's last call of the releasing run begun before the release. */
export function replyCall(calls: readonly Call[], release: { at: number; by: string; run: string } | null): Call | null {
  if (release === null) return null;
  return calls.filter((c) => c.agent === release.by && c.run === release.run && c.startedAt <= release.at).at(-1) ?? null;
}

/** The streamed pieces of a turn: those of every run its records name, whichever run of the turn it is, and none of another turn's. */
export function deltasOfTurn(trace: readonly TraceRecord[], deltas: readonly TraceDelta[], turn: string): TraceDelta[] {
  const runs = new Set(trace.filter((r) => r.scope.turn === turn).map((r) => r.run));
  return deltas.filter((d) => runs.has(d.run));
}

/** Calls begun by any agent before a moment: the reply's first piece leaving RPE (tag form) or its release (two-step form). */
export function callsBefore(calls: readonly Call[], moment: number): number {
  return calls.filter((c) => c.startedAt < moment).length;
}

/** The kept request of a call: its messages in order, each with the RPH block the route names it as, and the tools it names. */
export interface KeptRequest {
  messages: { role: string; text: string; block: string | null }[];
  tools: string[] | null;
}

/** A kept request from the route's answer: only a rebuild that is exactly what was sent is read; any other is an error that says so. */
export function keptRequest(answer: unknown): KeptRequest {
  if (!isRecord(answer) || typeof answer.same !== "boolean" || !Array.isArray(answer.messages)) throw new Error("RPE's request route gave no `same` and no list of messages");
  if (!answer.same) throw new Error("RPE could not rebuild the request exactly as it was sent (`same: false`)");
  const messages = answer.messages.map((m, i) => {
    if (!isRecord(m) || typeof m.role !== "string" || typeof m.text !== "string") throw new Error(`message ${i + 1} of the kept request is not a role and a text`);
    return { role: m.role, text: m.text, block: typeof m.block === "string" && m.block !== "" ? m.block : null };
  });
  const tools = Array.isArray(answer.tools) ? answer.tools.flatMap((t) => (isRecord(t) && typeof t.name === "string" ? [t.name] : [])) : null;
  return { messages, tools };
}

/** The intent record's file, as the two-step form's record call writes it in the turn's scratch folder (plan §10.7). */
export const INTENT_FILE = "scratch/intent.md";

/** Whether a tool call writes the intent record: `file_write` of `scratch/intent.md`, by that path or one ending in it. */
export function writesIntent(tool: { name: string; path: string | null }): boolean {
  return tool.name === "file_write" && tool.path !== null && (tool.path === INTENT_FILE || tool.path.endsWith(`/${INTENT_FILE}`));
}

/**
 * The trace's own measure of the intent record's time, the cross-check of `timings.intent` (PlanGates-4
 * item 3, PlanGates-4-fix1 item 11): in the tag form from the first piece of the lead's text in the call
 * that wrote the record to the `intent` event; in the two-step form from when the model began writing
 * the `file_write` of `scratch/intent.md` (C7's `began`) to the `intent` event, never from another tool
 * call of that model call. The call and its pieces are those of the run that wrote the record. Null
 * where the trace cannot say.
 */
export function traceIntentMs(form: "tag" | "two-step", trace: readonly TraceRecord[], deltas: readonly TraceDelta[]): number | null {
  const intent = intentOf(trace);
  const lead = leadOf(trace);
  if (intent === null || lead === null) return null;
  const { at, run } = intent;
  const calls = callsOf(trace).filter((c) => c.agent === lead.id && c.run === run && c.startedAt <= at);
  if (form === "tag") {
    const call = calls.at(-1);
    if (call === undefined) return null;
    const first = deltas.find((d) => d.run === run && d.agent === lead.id && d.call === call.call && (d.text ?? "") !== "");
    return first === undefined ? null : at - first.at;
  }
  const write = calls.flatMap((c) => c.toolCalls).filter((t) => writesIntent(t) && t.began !== null && t.began <= at).at(-1);
  return write?.began == null ? null : at - write.began;
}
