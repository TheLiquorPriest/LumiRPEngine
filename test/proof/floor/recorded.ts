// Recorded floor runs for the floor's tests: invented data in the shapes a run records (R-19), never a
// recording of a real instance. Each pair is a plain turn and an RPE turn with the page's moments (the
// page's clock), Lumiverse's socket support and its count of the shown reply, and RPE's side as its
// routes give it: the turn route's timings with `intent` and `thinking` (PlanTurn-3 item 4, as the lead
// ruled their shape), the trace (RPH's events at the pin, with C7's `began` on tool calls), and the live
// socket's pieces (RPE's clock, set far from the page's on purpose: the floor never mixes the two clocks).
//
// The defaults are a sound run: the tag form takes the record from the first piece of the lead's text
// (600 ms) and releases at 1.7 s; the two-step form writes the record as a `file_write` begun at 1.0 s and
// kept at 1.6 s, then the reply as a message of the second call, ended and released at 3.5 s.

import type { Effort, ToolCallView, TraceDelta, TraceEvent, TraceRecord } from "rp-harness/contract";
import type { FloorRun, FloorTurn, Form } from "../../../scripts/testbed/floor-measure";
import type { RecordTimes } from "../../../scripts/proof/lib/turn";

export const LEAD = { id: "lead", definition: "author" } as const;
const SCOPE = { user: "u-floor", chat: "chat-floor", session: "s-floor" };
export const MODEL = "deepseek-v4-flash";

export interface Shape {
  form: Form;
  /** Every RPE turn streamed (its first word left RPE before its release, in the two-step form), and run.json says the Author's connection streams. */
  streamed?: boolean;
  /** What run.json says of the Author's streaming, where it differs from `streamed`. */
  streams?: boolean;
  /** The pairs whose two-step turn streamed, where they differ from `streamed`. */
  streamedPairs?: (pair: number) => boolean;
  pairs?: number;
  /** The Author's `agent_started.effort`; null for a record naming none. */
  effort?: Effort | null;
  plain?: Partial<NonNullable<FloorRun["plain"]>>;
  /** The record's own time by pair: a span offset from the turn's start (ms), null for none, "not served" for an RPE whose route lacks it. Default 1000 to 1600. */
  intent?: (pair: number) => { from: number; to: number | null } | null | "not served";
  /** Extra calls begun before the reply, by pair (tool rounds before the reply). */
  extraCalls?: (pair: number) => number;
  /** Tool and opening tokens of every Author call. */
  toolTokens?: number | null;
  openingTokens?: number | null;
  /** RPE's reply ends this much later on the page (ms), by pair: a slower RPE. */
  slower?: (pair: number) => number;
  /** The trace's record time differs from the route's by this much (ms), by pair. */
  traceSkew?: (pair: number) => number;
  /** Lumiverse's count of each shown reply, by arm (its tokenizer for the model): what time per token divides by. */
  visible?: { plain: number; rpe: number };
  /** The provider's completion count Lumiverse's metrics event gives, by arm: support only. */
  tokens?: { plain: number; rpe: number };
  /** Plain's last word on the page after its send (ms). */
  plainLast?: number;
  /** The RPE connection the Author ran on, as its trace names it. Default "rpe-floor". */
  connection?: string;
  /** The provider each arm's connection is of, where it differs from the default "deepseek": plain's as Lumiverse holds it, RPE's as RPE's own connections do (null: not read). */
  plainProvider?: string | null;
  rpeProvider?: string | null;
}

const PAGE0 = 5_000_000;
const RPE0 = 1_763_000_000_000;
/** The script's own clock, apart from the page's and RPE's: when each line was sent and its turn read. */
const SCRIPT0 = 1_700_000_000_000;

function plainTurn(pair: number, shape: Shape): FloorTurn {
  const sent = PAGE0 + pair * 100_000;
  const last = shape.plainLast ?? 2800;
  return {
    pair,
    arm: "plain",
    line: `an invented line ${pair}a`,
    page: { sent, firstThinking: sent + 300, firstWord: sent + 1100, lastWord: sent + last, ended: sent + last + 50, resolution: 20 },
    socket: { started: null, firstReasoning: null, firstToken: null, lastToken: null, ended: null, tokens: shape.tokens?.plain ?? 120, messageId: `m-${pair}a`, error: null, lore: [] },
    visible: shape.visible?.plain ?? 120,
    visibleWhy: null,
    chat: "chat-floor",
    preset: "preset-floor",
    began: SCRIPT0 + pair * 10_000,
    finished: SCRIPT0 + pair * 10_000 + 4_000,
    rpe: null,
    error: null,
  };
}

function rpeTurn(pair: number, shape: Shape): FloorTurn {
  const two = shape.form === "two-step";
  const turn = `t-${pair}`;
  // The run's own id, which is never the turn's (RPH `ff1c9839`): the turn is in each record's scope, the run in its `run`.
  const run = `run-${pair}-1`;
  const sent = PAGE0 + pair * 100_000 + 50_000;
  const r = RPE0 + pair * 100_000;
  const records: TraceRecord[] = [];
  const deltas: TraceDelta[] = [];
  const push = (at: number, event: TraceEvent) => records.push({ seq: records.length + 1, run, scope: { ...SCOPE, turn }, at, agent: { ...LEAD }, event });
  const usage = (output: number) => ({ calls: 1, input: 9000, cacheRead: 8000, cacheWrite: 0, output });
  const tokens = { toolTokens: shape.toolTokens === undefined ? 6400 : shape.toolTokens, openingTokens: shape.openingTokens === undefined ? 5800 : shape.openingTokens };
  const callStarted = (at: number, call: number) =>
    push(at, { kind: "call_started", call, connection: shape.connection ?? "rpe-floor", model: MODEL, messages: 12, tools: 30, ...(call === 1 ? { request: "transcripts/author-lead.call-1.json" } : {}), ...(tokens.toolTokens === null ? {} : { toolTokens: tokens.toolTokens }), ...(tokens.openingTokens === null ? {} : { openingTokens: tokens.openingTokens }) });
  const span = shape.intent ? shape.intent(pair) : { from: 1000, to: 1600 };
  const skew = shape.traceSkew?.(pair) ?? 0;
  const extra = shape.extraCalls?.(pair) ?? 0;
  const slower = shape.slower?.(pair) ?? 0;
  const streamed = shape.streamedPairs?.(pair) ?? shape.streamed ?? false;
  push(r + 50, { kind: "run_started", run: "turn", turn: "new", lead: "author" });
  push(r + 55, { kind: "agent_started", definition: "author", connection: shape.connection ?? "rpe-floor", model: MODEL, ...(shape.effort === null ? {} : { effort: shape.effort ?? "low" }), session: "s-floor", given: [] });
  callStarted(r + 60, 1);
  for (const at of [300, 600, 900]) deltas.push({ run, agent: LEAD.id, call: 1, thinking: "…", at: r + at });
  const recordTo = span === null || span === "not served" ? 1600 : (span.to ?? 1600);
  // The trace's own sight of the record: its first piece of text (tag) or its tool call's start (two-step), to the intent event.
  const traceFrom = (span === null || span === "not served" ? 1000 : span.from) + skew;
  let call = 1;
  let released: number;
  let firstWord: number;
  if (!two) {
    for (let at = traceFrom; at <= recordTo; at += 100) deltas.push({ run, agent: LEAD.id, call: 1, text: at === traceFrom ? "<intent>wants:" : " …", at: r + at });
    push(r + recordTo, { kind: "intent", text: "wants: shelter\nscope: the room\nstory: …\nengine: none\nneeds: nothing" });
    for (let n = 0; n < extra; n++) callStarted(r + recordTo + 10 + n, ++call);
    released = r + 1700 + slower;
    firstWord = released;
    push(released, { kind: "released", release: { by: { ...LEAD }, form: "tags", length: 400 } });
    for (let at = 1700 + slower; at <= 4000 + slower; at += 100) deltas.push({ run, agent: LEAD.id, call, text: " word", at: r + at });
    push(r + 4000 + slower, { kind: "call_ended", call, model: MODEL, text: "…", toolCalls: [], stop: "stop", usage: usage(300), ms: 3940 });
  } else {
    // `began` is C7's field (PlanHarnessCore-1), newer than the pinned contract's type: the route serves it as JSON either way.
    const writing: ToolCallView & { began: number } = { id: "c1", name: "file_write", args: { path: "scratch/intent.md" }, began: r + traceFrom };
    push(r + 1650, { kind: "call_ended", call: 1, model: MODEL, text: "", thinking: "…", toolCalls: [writing], stop: "toolUse", usage: usage(180), ms: 1590 });
    push(r + recordTo, { kind: "intent", text: "wants: shelter\nscope: the room\nstory: …\nengine: none\nneeds: nothing" });
    for (let n = 0; n < extra; n++) callStarted(r + 1660 + n, ++call);
    callStarted(r + 1700, ++call);
    for (const at of [1800, 2000, 2200]) deltas.push({ run, agent: LEAD.id, call, thinking: "…", at: r + at });
    for (let at = 2300; at <= 3500 + slower; at += 100) deltas.push({ run, agent: LEAD.id, call, text: " word", at: r + at });
    released = r + 3500 + slower;
    firstWord = streamed ? r + 2300 : released;
    push(released, { kind: "released", release: { by: { ...LEAD }, form: "message", length: 400 } });
    push(released, { kind: "call_ended", call, model: MODEL, text: "…", toolCalls: [], stop: "stop", usage: usage(130), ms: 1800 + slower });
  }
  const ended = released + 600;
  push(ended, { kind: "run_ended", outcome: { status: "released", released: true, usage: { calls: two ? 2 : 1, input: 18_000, cacheRead: 16_000, cacheWrite: 0, output: 310 } } });
  const record: RecordTimes | "not served" = span === "not served" ? "not served" : { intent: span === null ? null : { from: r + span.from, to: span.to === null ? null : r + span.to }, thinking: two ? [{ from: r + 300, to: r + 900 }, { from: r + 1800, to: r + 2200 }] : [{ from: r + 300, to: r + 900 }] };
  // The page sees RPE's moments some 70 ms later than RPE sends them: Lumiverse's way to the page.
  const toPage = (rpeAt: number) => sent + (rpeAt - r) + 70;
  return {
    pair,
    arm: "rpe",
    line: `an invented line ${pair}b`,
    // The tag form's reply streams to the page until its call ends; the two-step form's shows whole at the release.
    page: { sent, firstThinking: null, firstWord: toPage(firstWord), lastWord: toPage(two ? released : r + 4000 + slower), ended: toPage(two ? released : r + 4000 + slower) + 30, resolution: 20 },
    socket: { started: null, firstReasoning: null, firstToken: null, lastToken: null, ended: null, tokens: shape.tokens?.rpe ?? 150, messageId: `m-${pair}b`, error: null, lore: [] },
    visible: shape.visible?.rpe ?? 150,
    visibleWhy: null,
    chat: "chat-floor",
    preset: "preset-floor",
    began: SCRIPT0 + pair * 10_000 + 5_000,
    finished: SCRIPT0 + pair * 10_000 + 9_000,
    rpe: {
      turn,
      status: "done",
      timings: { received: r, started: r + 50, firstWord, released, ended, intent: record === "not served" ? null : record.intent, thinking: record === "not served" ? [] : record.thinking },
      record,
      trace: records,
      deltas,
      deltasMissed: false,
      request: null,
      stored: null,
      rows: null,
      history: { keep: null, step: null, hold: null, framing: null, framingNote: null, framingWhy: null },
      lore: { map: [], entries: [] },
      missing: {},
    },
    error: null,
  };
}

/** A recorded run of the shape asked, ten pairs unless said. */
export function recordedRun(shape: Shape): FloorRun {
  const pairs = shape.pairs ?? 10;
  const turns: FloorTurn[] = [];
  for (let p = 1; p <= pairs; p++) turns.push(plainTurn(p, shape), rpeTurn(p, shape));
  return {
    form: shape.form,
    formWhy: null,
    streams: shape.streams ?? shape.streamed ?? false,
    lead: "author",
    plain: { connection: "conn-plain-floor", preset: "preset-floor", source: "connection", apiReasoning: true, effort: "low", customBody: null, model: MODEL, ...shape.plain },
    arms: { plain: { connection: "conn-plain-floor", provider: shape.plainProvider === undefined ? "deepseek" : shape.plainProvider, providerWhy: null, model: MODEL }, rpe: { connection: shape.connection ?? "rpe-floor", provider: shape.rpeProvider === undefined ? "deepseek" : shape.rpeProvider, providerWhy: null, model: MODEL } },
    option: null,
    previousRun: 20,
    book: null,
    trials: [],
    stopped: null,
    turns,
  };
}
