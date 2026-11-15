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
// - The kept request file: RPH `src/harness/requests.ts` at the pin, `{"messages":[{"role","text"}]}`.

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
  definition: string;
  call: number;
  startedAt: number;
  endedAt: number | null;
  model: string;
  tools: number;
  /** The tokens of the tool list as sent and of the agent's opening block, by RPH's own estimate; null in records made before RPH gave them. */
  toolTokens: number | null;
  openingTokens: number | null;
  /** The kept request's file in the turn's folder, where the user's setting keeps it. */
  request: string | null;
  usage: Usage | null;
  /** Each tool call the model made, with when it began to be written where the trace says (C7). */
  toolCalls: { name: string; began: number | null }[];
}

export function callsOf(trace: readonly TraceRecord[]): Call[] {
  const ends = new Map<string, TraceRecord>();
  for (const r of trace) if (r.event.kind === "call_ended") ends.set(`${r.agent.id}\u0000${r.event.call}`, r);
  return trace.flatMap((r): Call[] => {
    if (r.event.kind !== "call_started") return [];
    const end = ends.get(`${r.agent.id}\u0000${r.event.call}`);
    const ended = end?.event.kind === "call_ended" ? end.event : null;
    return [
      {
        agent: r.agent.id,
        definition: r.agent.definition,
        call: r.event.call,
        startedAt: r.at,
        endedAt: end?.at ?? null,
        model: r.event.model,
        tools: r.event.tools,
        toolTokens: r.event.toolTokens ?? null,
        openingTokens: r.event.openingTokens ?? null,
        request: r.event.request ?? null,
        usage: ended?.usage ?? null,
        toolCalls: (ended?.toolCalls ?? []).map((t) => ({ name: t.name, began: "began" in t && typeof t.began === "number" ? t.began : null })),
      },
    ];
  });
}

/** The agent the turn's run started with (the Author, as shipped), by its id and definition. */
export function leadOf(trace: readonly TraceRecord[]): { id: string; definition: string } | null {
  const started = trace.find((r) => r.event.kind === "run_started");
  return started ? { id: started.agent.id, definition: started.agent.definition } : null;
}

/** The effort and model the lead began at (`agent_started`); effort null where the record says none. */
export function leadStart(trace: readonly TraceRecord[]): { effort: string | null; model: string; connection: string } | null {
  const lead = leadOf(trace);
  const started = trace.find((r) => r.event.kind === "agent_started" && r.agent.id === lead?.id);
  return started?.event.kind === "agent_started" ? { effort: started.event.effort ?? null, model: started.event.model, connection: started.event.connection } : null;
}

/** The release: when, in which form, and by which agent. */
export function releaseOf(trace: readonly TraceRecord[]): { at: number; form: ReleaseForm; by: string } | null {
  const released = trace.find((r) => r.event.kind === "released");
  return released?.event.kind === "released" ? { at: released.at, form: released.event.release.form, by: released.event.release.by.id } : null;
}

/** When the intent record reached the trace, whole. */
export function intentAt(trace: readonly TraceRecord[]): number | null {
  return trace.find((r) => r.event.kind === "intent")?.at ?? null;
}

/** The call that wrote the reply: the releasing agent's last call begun before the release. */
export function replyCall(calls: readonly Call[], release: { at: number; by: string } | null): Call | null {
  if (release === null) return null;
  return calls.filter((c) => c.agent === release.by && c.startedAt <= release.at).at(-1) ?? null;
}

/** Calls begun by any agent before a moment: the reply's first piece leaving RPE (tag form) or its release (two-step form). */
export function callsBefore(calls: readonly Call[], moment: number): number {
  return calls.filter((c) => c.startedAt < moment).length;
}

/** The kept request of a call: its messages in order, and the tools it names where the file gives them. */
export interface KeptRequest {
  messages: { role: string; text: string }[];
  tools: string[] | null;
}

export function keptRequest(text: string): KeptRequest {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw) || !Array.isArray(raw.messages)) throw new Error("the kept request file holds no list of messages");
  const messages = raw.messages.map((m, i) => {
    if (!isRecord(m) || typeof m.role !== "string" || typeof m.text !== "string") throw new Error(`message ${i + 1} of the kept request is not a role and a text`);
    return { role: m.role, text: m.text };
  });
  // PlanHarnessTools-5 item 3 names each declared tool in the kept request; an older file names none.
  const tools = Array.isArray(raw.tools) ? raw.tools.flatMap((t) => (typeof t === "string" ? [t] : isRecord(t) && typeof t.name === "string" ? [t.name] : [])) : null;
  return { messages, tools };
}

/**
 * The trace's own measure of the intent record's time, the cross-check of `timings.intent` (PlanGates-4
 * item 3): in the tag form from the first piece of the lead's text in the call that wrote the record to
 * the `intent` event; in the two-step form from when the model began writing the record's tool call
 * (C7's `began`) to the `intent` event. Null where the trace cannot say.
 */
export function traceIntentMs(form: "tag" | "two-step", trace: readonly TraceRecord[], deltas: readonly TraceDelta[], run: string): number | null {
  const at = intentAt(trace);
  const lead = leadOf(trace);
  if (at === null || lead === null) return null;
  const calls = callsOf(trace).filter((c) => c.agent === lead.id && c.startedAt <= at);
  const call = calls.at(-1);
  if (call === undefined) return null;
  if (form === "tag") {
    const first = deltas.find((d) => d.run === run && d.agent === lead.id && d.call === call.call && (d.text ?? "") !== "");
    return first === undefined ? null : at - first.at;
  }
  const began = call.toolCalls.map((t) => t.began).find((b): b is number => b !== null && b <= at);
  return began === undefined ? null : at - began;
}
