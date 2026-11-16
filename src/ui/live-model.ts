// A chat's runs as the Live and Turn pages show them, pure so that it is tested without a browser. Every
// record of a run's trace is folded into the agent it is about, in order: a model call's start and its
// answer into one step, with the text that streamed between them; a tool call's start, updates and
// result into one; every other record into a step of its own. Nothing an agent did is left out. Each
// agent sits under the agent that started it, beside the tool call that did.
//
// Every run is held under RPH's own id for it, which each of its records, each piece of its streaming
// text and each piece of what it sent to the chat carries; the turn it belongs to is in its records'
// scope. A turn's continue is a run of its own under an id of its own, so records never go to a run by
// a guess on order or time. A chat can have several runs going on at once (a turn and a job beside it).
//
// Records come in order from the live hub, and again from a read when the page catches up, so a record
// already folded is passed over and one past a hole waits until the hole is filled. Every change makes
// new objects only along its path (run, agent, step), so a view can tell what changed by identity.

import type { AgentStatus, TodoItem } from "rp-harness/contract";
import type { AgentRef, LiveEvent, Release, ReplyPiece, RunOutcome, RunScope, ToolResult, TraceDelta, TraceEvent, TraceRecord, TurnReply, Usage } from "../shared/api";
import { isRecord } from "../shared/json";

export type EventOf<K extends TraceEvent["kind"]> = Extract<TraceEvent, { kind: K }>;

/** Where a step starts in its run (`at`), the records folded into it (`seqs`), and a key that stays the same as the run grows. */
interface StepBase {
  readonly key: string;
  readonly at: number;
  readonly seqs: readonly number[];
}

/** A model call: what was sent, the text that streamed, and its whole answer once it came. */
export interface CallStep extends StepBase {
  readonly kind: "call";
  readonly call: number;
  readonly sent: EventOf<"call_started">;
  readonly streamed: { readonly text: string; readonly thinking: string };
  readonly answer: EventOf<"call_ended"> | null;
  readonly answeredAt: number | null;
}

/** A tool call: its arguments, what it showed while it ran, its result, and the agents it started. */
export interface ToolStep extends StepBase {
  readonly kind: "tool";
  readonly callId: string;
  readonly started: EventOf<"tool_started">;
  readonly updates: readonly ToolResult[];
  readonly ended: EventOf<"tool_ended"> | null;
  readonly endedAt: number | null;
  readonly agents: readonly string[];
}

/** Any other record, as it was traced. */
export interface NoteStep extends StepBase {
  readonly kind: "note";
  readonly record: TraceRecord;
}

export type Step = CallStep | ToolStep | NoteStep;

export interface AgentNode {
  readonly ref: AgentRef;
  /** The agent, run and tool call that started it, when another did. */
  readonly startedBy: { readonly agent: string; readonly run: string; readonly call: string } | null;
  readonly info: EventOf<"agent_started"> | null;
  readonly at: number;
  readonly lastAt: number;
  readonly steps: readonly Step[];
  /** The agents it started, in the order they began. */
  readonly children: readonly string[];
  /** Its `todo` list as it last stood. */
  readonly todo: readonly TodoItem[] | null;
  readonly ended: EventOf<"agent_ended"> | null;
  readonly endedAt: number | null;
}

/** What went to the chat: the reply's text, the progress lines, and pieces that came past a hole. */
export interface ReplySoFar {
  readonly text: string;
  readonly progress: readonly string[];
  readonly held: readonly { readonly from: number; readonly text: string }[];
}

export interface RunNode {
  /** RPH's own id for the run, which its records, its streaming text and what it sent to the chat carry; RPE's own id for it, read before its first record is in. */
  readonly run: string;
  /** The turn it is a run of, as its records' scope names it, or the read that named the run; null for a run of no turn (a job the user started), or one heard of by nothing else yet. */
  readonly turn: string | null;
  readonly scope: RunScope | null;
  /** The agent, run and tool call of another run that started this one (a job's). */
  readonly startedBy: { readonly agent: string; readonly run: string; readonly call: string } | null;
  readonly started: EventOf<"run_started"> | null;
  readonly startedAt: number | null;
  readonly intent: string | null;
  readonly agents: ReadonlyMap<string, AgentNode>;
  /** Agents no agent of this run started: the lead, first. */
  readonly roots: readonly string[];
  /** The records of the run that are about no agent (the host's word: a session opened, closed or forked), in order. */
  readonly host: readonly NoteStep[];
  readonly released: Release | null;
  readonly releasedAt: number | null;
  readonly outcome: RunOutcome | null;
  readonly endedAt: number | null;
  readonly reply: ReplySoFar;
  /** The last record folded: every record up to it is in. */
  readonly seq: number;
  /** Records past a hole, in order, waiting for it to be filled. */
  readonly waiting: readonly TraceRecord[];
  readonly firstAt: number | null;
  readonly lastAt: number | null;
}

export interface LiveModel {
  /** In the order each run was first heard of. */
  readonly runs: readonly RunNode[];
}

export const EMPTY_LIVE: LiveModel = { runs: [] };

const NO_STREAM = { text: "", thinking: "" } as const;
const NO_REPLY: ReplySoFar = { text: "", progress: [], held: [] };

function emptyRun(run: string, turn: string | null = null): RunNode {
  return { run, turn, scope: null, startedBy: null, started: null, startedAt: null, intent: null, agents: new Map(), roots: [], host: [], released: null, releasedAt: null, outcome: null, endedAt: null, reply: NO_REPLY, seq: 0, waiting: [], firstAt: null, lastAt: null };
}

function withRun(model: LiveModel, next: RunNode): LiveModel {
  const at = model.runs.findIndex((r) => r.run === next.run);
  if (at < 0) return { runs: [...model.runs, next] };
  const runs = [...model.runs];
  runs[at] = next;
  return { runs };
}

/** The run of an id: the one a record, a piece of streaming text, a piece of the reply or a read is about. */
export function runOf(model: LiveModel, run: string): RunNode | undefined {
  return model.runs.find((r) => r.run === run);
}


function lastIndex<T>(list: readonly T[], match: (item: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (match(list[i] as T)) return i;
  return -1;
}

function replaced<T>(list: readonly T[], at: number, item: T): T[] {
  const out = [...list];
  out[at] = item;
  return out;
}

// ---------------------------------------------------------------- reading what the hub carries

/** A trace record as the live hub carries it, or null when it is not one: its envelope is checked, and an event of a kind this page does not know is kept as it is. */
export function readTrace(value: unknown): TraceRecord | null {
  if (!isRecord(value)) return null;
  const { seq, run, at, agent, scope, event, parent } = value;
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1 || typeof run !== "string" || typeof at !== "number") return null;
  if (agent !== undefined && (!isRecord(agent) || typeof agent.id !== "string" || typeof agent.definition !== "string")) return null;
  if (!isRecord(scope) || (scope.chat !== undefined && typeof scope.chat !== "string") || !isRecord(event) || typeof event.kind !== "string") return null;
  if (parent !== undefined && !(isRecord(parent) && typeof parent.agent === "string" && typeof parent.run === "string" && typeof parent.call === "string")) return null;
  return value as unknown as TraceRecord;
}

function readDelta(value: unknown): TraceDelta | null {
  if (!isRecord(value) || typeof value.run !== "string" || typeof value.agent !== "string" || typeof value.call !== "number") return null;
  if ((value.text !== undefined && typeof value.text !== "string") || (value.thinking !== undefined && typeof value.thinking !== "string")) return null;
  return value as unknown as TraceDelta;
}

function readPiece(value: unknown): ReplyPiece | null {
  if (!isRecord(value) || typeof value.run !== "string") return null;
  if (typeof value.from === "number" && typeof value.text === "string") return { run: value.run, from: value.from, text: value.text };
  if (typeof value.line === "number" && typeof value.progress === "string") return { run: value.run, line: value.line, progress: value.progress };
  return null;
}

// ---------------------------------------------------------------- folding

function noteOf(record: TraceRecord): NoteStep {
  return { kind: "note", key: `s${record.seq}`, at: record.at, seqs: [record.seq], record };
}

/** The agent with `record` folded into its steps. */
function stepInto(agent: AgentNode, record: TraceRecord): AgentNode {
  const { event, at, seq } = record;
  const base: AgentNode = { ...agent, lastAt: at };
  switch (event.kind) {
    case "call_started":
      return { ...base, steps: [...agent.steps, { kind: "call", key: `s${seq}`, at, seqs: [seq], call: event.call, sent: event, streamed: NO_STREAM, answer: null, answeredAt: null }] };
    case "call_ended": {
      const i = lastIndex(agent.steps, (s) => s.kind === "call" && s.call === event.call && s.answer === null);
      const step = agent.steps[i];
      if (step?.kind === "call") return { ...base, steps: replaced(agent.steps, i, { ...step, seqs: [...step.seqs, seq], answer: event, answeredAt: at }) };
      break;
    }
    case "tool_started":
      return { ...base, steps: [...agent.steps, { kind: "tool", key: `s${seq}`, at, seqs: [seq], callId: event.callId, started: event, updates: [], ended: null, endedAt: null, agents: [] }] };
    case "tool_update":
    case "tool_ended": {
      const i = lastIndex(agent.steps, (s) => s.kind === "tool" && s.callId === event.callId && s.ended === null);
      const step = agent.steps[i];
      if (step?.kind !== "tool") break;
      const next: ToolStep = event.kind === "tool_update" ? { ...step, seqs: [...step.seqs, seq], updates: [...step.updates, event.partial] } : { ...step, seqs: [...step.seqs, seq], ended: event, endedAt: at };
      return { ...base, steps: replaced(agent.steps, i, next) };
    }
    case "agent_started":
      return { ...base, info: event, steps: [...agent.steps, noteOf(record)] };
    case "todo":
      return { ...base, todo: event.items, steps: [...agent.steps, noteOf(record)] };
    case "agent_ended":
      return { ...base, ended: event, endedAt: at, steps: [...agent.steps, noteOf(record)] };
  }
  // Every other record, and an answer or result whose start is not here, is a step of its own.
  return { ...base, steps: [...agent.steps, noteOf(record)] };
}

/** The agent `parent` with `child` started by it, beside the tool call that started it when that call is one of its steps. */
function adopt(parent: AgentNode, child: string, call: string | undefined): AgentNode {
  const i = call === undefined ? -1 : lastIndex(parent.steps, (s) => s.kind === "tool" && s.callId === call);
  const step = parent.steps[i];
  const steps = step?.kind === "tool" ? replaced(parent.steps, i, { ...step, agents: [...step.agents, child] }) : parent.steps;
  return { ...parent, children: [...parent.children, child], steps };
}

/** The run with the record that follows its last one folded in; one about no agent is a note of the run's own. */
function fold(run: RunNode, record: TraceRecord): RunNode {
  const { event, at } = record;
  const agents = new Map(run.agents);
  let roots = run.roots;
  let host = run.host;
  if (record.agent === undefined) host = [...host, noteOf(record)];
  else {
    const id = record.agent.id;
    let agent = agents.get(id);
    if (agent === undefined) {
      const startedBy = record.parent ?? null;
      agent = { ref: record.agent, startedBy, info: null, at, lastAt: at, steps: [], children: [], todo: null, ended: null, endedAt: null };
      // A sub-agent's records name the agent and call that started it; an agent of a job started from another run is a root of its own run.
      const parentId = startedBy !== null ? (startedBy.run === record.run ? startedBy.agent : undefined) : record.agent.parent;
      const parent = parentId === undefined ? undefined : agents.get(parentId);
      if (parent === undefined) roots = [...roots, id];
      else agents.set(parent.ref.id, adopt(parent, id, startedBy?.call));
    }
    agents.set(id, stepInto(agent, record));
  }
  const startedBy = run.firstAt === null && record.parent !== undefined && record.parent.run !== record.run ? record.parent : run.startedBy;
  const next: RunNode = { ...run, agents, roots, host, startedBy, seq: record.seq, scope: run.scope ?? record.scope, firstAt: run.firstAt ?? at, lastAt: at };
  switch (event.kind) {
    case "run_started":
      return { ...next, started: event, startedAt: at };
    case "intent":
      return { ...next, intent: event.text };
    case "released":
      return { ...next, released: event.release, releasedAt: at };
    case "run_ended":
      return { ...next, outcome: event.outcome, endedAt: at };
    default:
      return next;
  }
}

/** The model with one trace record in: folded when it follows its run's last, passed over when it is in already, held when it comes past a hole. */
export function applyRecord(model: LiveModel, record: TraceRecord): LiveModel {
  const found = runOf(model, record.run) ?? emptyRun(record.run);
  if (record.seq <= found.seq || found.waiting.some((w) => w.seq === record.seq)) return model;
  // Its turn is known from any record of it, one held past a hole included.
  const run = found.turn === null && record.scope.turn !== undefined ? { ...found, turn: record.scope.turn } : found;
  if (record.seq !== run.seq + 1) {
    const waiting = [...run.waiting, record].sort((a, b) => a.seq - b.seq);
    return withRun(model, { ...run, waiting });
  }
  let next = fold(run, record);
  let waiting = run.waiting;
  while (waiting.length > 0 && waiting[0]?.seq === next.seq + 1) {
    next = fold(next, waiting[0]);
    waiting = waiting.slice(1);
  }
  return withRun(model, { ...next, waiting });
}

/** The model with a piece of a model call's streaming text in; a piece for a call not open here is let go, since the call's answer holds the whole. */
export function applyDelta(model: LiveModel, delta: TraceDelta): LiveModel {
  const run = runOf(model, delta.run);
  const agent = run?.agents.get(delta.agent);
  if (run === undefined || agent === undefined) return model;
  const i = lastIndex(agent.steps, (s) => s.kind === "call" && s.call === delta.call && s.answer === null);
  const step = agent.steps[i];
  if (step?.kind !== "call" || (delta.text === undefined && delta.thinking === undefined)) return model;
  const streamed = { text: step.streamed.text + (delta.text ?? ""), thinking: step.streamed.thinking + (delta.thinking ?? "") };
  const agents = new Map(run.agents);
  agents.set(agent.ref.id, { ...agent, steps: replaced(agent.steps, i, { ...step, streamed }) });
  return withRun(model, { ...run, agents });
}

/** `text` with `piece` written over it at `from`; null when `from` is past its end (a hole). */
function writeAt(text: string, from: number, piece: string): string | null {
  if (from > text.length) return null;
  return text.slice(0, from) + piece + text.slice(from + piece.length);
}

/** The reply with every held piece that now meets its text written in. */
function settleReply(text: string, progress: readonly string[], held: readonly { from: number; text: string }[]): ReplySoFar {
  let out = text;
  let waiting = [...held].sort((a, b) => a.from - b.from);
  for (;;) {
    const at = waiting.findIndex((p) => p.from <= out.length);
    if (at < 0) break;
    const piece = waiting[at] as { from: number; text: string };
    out = writeAt(out, piece.from, piece.text) ?? out;
    waiting = waiting.filter((_, i) => i !== at);
  }
  return { text: out, progress, held: waiting };
}

/** The model with a piece of what went to the chat in, at its place, so a piece heard twice changes nothing. */
export function applyReply(model: LiveModel, piece: ReplyPiece): LiveModel {
  const run = runOf(model, piece.run) ?? emptyRun(piece.run);
  const reply = run.reply;
  if ("progress" in piece) {
    if (reply.progress[piece.line] === piece.progress) return model;
    const progress = [...reply.progress];
    progress[piece.line] = piece.progress;
    return withRun(model, { ...run, reply: { ...reply, progress: Array.from(progress, (line) => line ?? "") } });
  }
  return withRun(model, { ...run, reply: settleReply(reply.text, reply.progress, [...reply.held, { from: piece.from, text: piece.text }]) });
}

/** The model with one live event of the chat in; kinds that are not a run's are other pages' business. */
export function applyLive(model: LiveModel, event: LiveEvent): LiveModel {
  if (event.kind === "trace") {
    const record = readTrace(event.data);
    return record === null ? model : applyRecord(model, record);
  }
  if (event.kind === "delta") {
    const delta = readDelta(event.data);
    return delta === null ? model : applyDelta(model, delta);
  }
  if (event.kind === "reply") {
    const piece = readPiece(event.data);
    return piece === null ? model : applyReply(model, piece);
  }
  return model;
}

/**
 * The model with a read of one turn in: its records, and what went to the chat, which holds as far as it
 * goes. A read that says a run has ended holds too, for a run whose records do not say so (a turn read
 * without its trace): its outcome is the read's. What a read says beside its records is of each of the
 * turn's runs, by RPH's id for it; a run read before its first record is in goes under RPE's own id for
 * it, and gives way to RPH's once a read names that.
 */
export function applyRead(model: LiveModel, detail: TurnReply): LiveModel {
  let next = model;
  for (const record of detail.trace) next = applyRecord(next, record);
  const named = new Set(detail.runs.flatMap((view) => (view.run === null ? [] : [view.id])));
  if (next.runs.some((r) => named.has(r.run))) next = { runs: next.runs.filter((r) => !named.has(r.run)) };
  for (const view of detail.runs) {
    const name = view.run ?? view.id;
    const run = runOf(next, name) ?? emptyRun(name, detail.id);
    const known = run.reply;
    const text = known.text.length > view.reply.text.length ? view.reply.text + known.text.slice(view.reply.text.length) : view.reply.text;
    const progress = Array.from({ length: Math.max(known.progress.length, view.reply.progress.length) }, (_, i) => view.reply.progress[i] ?? known.progress[i] ?? "");
    const status = view.status;
    const outcome: RunOutcome | null = status !== "running" && run.outcome === null && run.waiting.length === 0 ? { status, released: view.timings.released !== null, usage: view.usage, ...(view.error === null ? {} : { error: view.error }) } : run.outcome;
    const endedAt = outcome !== run.outcome ? view.timings.ended : run.endedAt;
    next = withRun(next, { ...run, turn: run.turn ?? detail.id, reply: settleReply(text, progress, known.held), outcome, endedAt, startedAt: run.startedAt ?? view.timings.started });
  }
  return next;
}

/** The runs of a turn, the first first, for the Turn page: each run its records' scope names the turn for; one at least. */
export function runsOf(model: LiveModel, turn: string): RunNode[] {
  const runs = model.runs.filter((r) => r.turn === turn);
  return runs.length > 0 ? runs : [emptyRun(turn, turn)];
}

/** Where a read of the run should start to fill a hole, or null when nothing is missing. */
export function holeIn(run: RunNode): number | null {
  return run.waiting.length > 0 || run.reply.held.length > 0 ? run.seq + 1 : null;
}

/** Whether the run is held by his pause, by the newest `paused` or `resumed` record it holds; null where it holds neither (the page then asks RPE). */
export function pausedIn(run: RunNode): boolean | null {
  let newest: { seq: number; paused: boolean } | null = null;
  const notes = [...run.host, ...[...run.agents.values()].flatMap((agent) => agent.steps.filter((s): s is NoteStep => s.kind === "note"))];
  for (const { record } of notes) {
    const { kind } = record.event;
    if ((kind === "paused" || kind === "resumed") && (newest === null || record.seq > newest.seq)) newest = { seq: record.seq, paused: kind === "paused" };
  }
  return newest === null ? null : newest.paused;
}

/** The runs the Live page shows, in the order it shows them: those going on first, as each began, then those that ended, the one that ended last first. */
export function shownRuns(model: LiveModel): RunNode[] {
  const began = (run: RunNode): number => run.startedAt ?? run.firstAt ?? 0;
  const going = model.runs.filter((run) => run.outcome === null).sort((a, b) => began(a) - began(b));
  const ended = model.runs.filter((run) => run.outcome !== null).sort((a, b) => (b.endedAt ?? began(b)) - (a.endedAt ?? began(a)));
  return [...going, ...ended];
}

/** What a run's Stop acts on: a turn's run stops its turn, a job's run cancels its job. */
export type StopTarget = { readonly turn: string } | { readonly job: string };

/** What a run's Stop acts on; null for a run nothing on the page stops (a talk with an agent, or a job or turn not yet named by a record). */
export function stopOf(run: RunNode): StopTarget | null {
  const kind = run.started?.run;
  if (kind === "talk") return null;
  if (kind === "job") {
    const job = run.agents.get(run.roots[0] ?? "")?.ref.job;
    return job === undefined ? null : { job };
  }
  return run.turn === null ? null : { turn: run.turn };
}

// ---------------------------------------------------------------- what the pages say of a run and its agents

/** How an agent stands: at work, how it ended, or unfinished (its run ended and it never said it had). */
export type AgentState = AgentStatus | "working" | "unfinished";

export function agentState(agent: AgentNode, run: RunNode): AgentState {
  if (agent.ended !== null) return agent.ended.status;
  return run.outcome === null ? "working" : "unfinished";
}

const ZERO: Usage = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  const reasoning = (a.reasoning ?? 0) + (b.reasoning ?? 0);
  return { calls: a.calls + b.calls, input: a.input + b.input, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, output: a.output + b.output, ...(a.reasoning !== undefined || b.reasoning !== undefined ? { reasoning } : {}) };
}

/** What an agent spent: as it said when it ended, else the sum of its calls answered so far. */
export function agentUsage(agent: AgentNode): Usage {
  if (agent.ended !== null) return agent.ended.usage;
  let sum = ZERO;
  for (const step of agent.steps) if (step.kind === "call" && step.answer !== null) sum = addUsage(sum, step.answer.usage);
  return sum;
}

/** A run's counts: its agents, model calls and tool calls, and what it spent (as its end said, else its agents' sums). */
export interface RunTotals {
  agents: number;
  calls: number;
  tools: number;
  rules: number;
  usage: Usage;
}

export function runTotals(run: RunNode): RunTotals {
  let calls = 0;
  let tools = 0;
  let rules = run.host.filter((step) => step.record.event.kind === "rule_fired").length;
  let usage = ZERO;
  for (const agent of run.agents.values()) {
    usage = addUsage(usage, agentUsage(agent));
    for (const step of agent.steps) {
      if (step.kind === "call") calls++;
      else if (step.kind === "tool") tools++;
      else if (step.record.event.kind === "rule_fired") rules++;
    }
  }
  return { agents: run.agents.size, calls, tools, rules, usage: run.outcome?.usage ?? usage };
}
