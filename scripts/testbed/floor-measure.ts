// The floor test's numbers (STANDALONE-PLAN §17.1), with no network: what RPE's own record of one
// turn says (its timings, usage and trace, and the streaming text its live socket gave), and the
// test's table from every turn the run measured. `floor.ts` gathers the turns; this file only reads
// them, so an earlier run's JSON gives the same table again.

import type { ReleaseForm, TraceDelta, TraceRecord, Usage } from "rp-harness/contract";
import type { TurnDetail, TurnTimings } from "../../src/ui/api";

/** The form RPE's connection replies in (plan §10.7): the reply's tags in one call, or the intent record in one call and the reply as its own message in the next. */
export type Form = "tag" | "two-step";

/** The release form RPE's trace names for each form (`Release.form` in `rp-harness/contract`). */
export const RELEASE_FORM: Readonly<Record<Form, ReleaseForm>> = { tag: "tags", "two-step": "message" };

/** The pass values of §17.1's table. */
export const PASS = {
  /** First words: RPE's median, the intent record's time taken off, at most this much over plain generation's. */
  firstWordsOverMs: 3000,
  /** Time per output token: RPE's median at most this fraction over plain generation's. */
  perTokenOver: 0.15,
  /** Model calls on the reply's path: in at least this share of the turns… */
  callsShare: 0.9,
  /** …exactly this many, by form. */
  calls: { tag: 1, "two-step": 2 } as Readonly<Record<Form, number>>,
  /** The table's gates are set on ten pairs. */
  pairs: 10,
} as const;

/** One model call of an RPE turn, as its trace records it (times on RPE's clock). */
export interface RpeCall {
  agent: string;
  definition: string;
  call: number;
  model: string;
  startedAt: number;
  /** Messages and tools the request carried (counts only: the trace keeps no more of the request). */
  messages: number;
  tools: number;
  endedAt: number | null;
  ms: number | null;
  usage: Usage | null;
}

/** RPE's side of one RPE turn. Times are milliseconds on RPE's clock; the `*Ms` spans are differences on it. */
export interface RpeTurn {
  turn: string;
  status: string;
  kind: string;
  /** The release form the trace names; null when the reply was never released. */
  form: ReleaseForm | null;
  timings: TurnTimings;
  usage: Usage;
  calls: RpeCall[];
  /** Calls begun, by any agent, before the reply's first piece left RPE (or its release, when no piece did). */
  callsOnPath: number | null;
  /** Tools called before the reply's first piece, in order. */
  toolsBeforeReply: string[];
  intentAt: number | null;
  /** The model's time writing its intent record: from where its text began in the call that wrote it to the record. */
  intentOwnMs: number | null;
  /** Where that time was taken from: the call's first piece of text, else its last piece of thinking before the record. */
  intentFrom: "text" | "thinking" | null;
  /** The lead's thinking in its first call: its first piece of thinking to its first piece of text (or the intent record). */
  thinkingMs: number | null;
  /** From the request reaching RPE to: its run starting, the intent record, the reply's first piece. */
  intakeMs: number | null;
  intentAfterMs: number | null;
  firstPieceAfterMs: number | null;
  /** How long the run went on after the reply was released: how long a next message would have waited for it. */
  afterReplyMs: number | null;
  /** Streaming text pieces heard for the turn, and whether the live socket dropped any while it ran. */
  deltasHeard: number;
  deltasMissed: boolean;
}

/** One turn of the run, as the page saw it, and for an RPE turn RPE's own side of it. */
export interface Measured {
  pair: number;
  arm: "plain" | "rpe";
  line: string;
  messageId: string | null;
  /** Milliseconds from the request leaving to each moment; null when it never came. */
  toStarted: number | null;
  toFirstThinking: number | null;
  toFirstWord: number | null;
  toLastWord: number | null;
  toEnded: number | null;
  /** Characters of thinking and of reply text the page was streamed. */
  thinkingChars: number;
  replyChars: number;
  /** Lumiverse's own count of the reply's tokens, when it reported one. */
  tokens: number | null;
  error: string | null;
  /** RPE's side; null on a plain turn, or when no RPE turn could be matched (then `rpeError` says why). */
  rpe: RpeTurn | null;
  rpeError: string | null;
}

const span = (from: number | null | undefined, to: number | null | undefined): number | null => (from == null || to == null ? null : to - from);

/** RPE's side of one turn, from its Turn page record and the streaming text of its run. */
export function rpeSide(detail: TurnDetail, deltas: readonly TraceDelta[], deltasMissed: boolean): RpeTurn {
  const trace: readonly TraceRecord[] = detail.trace;
  const t = detail.timings;
  const replyAt = t.firstWord ?? t.released;
  const lead = trace.find((r) => r.event.kind === "run_started")?.agent.id ?? null;
  const ends = new Map<string, TraceRecord>();
  for (const r of trace) if (r.event.kind === "call_ended") ends.set(`${r.agent.id}\u0000${r.event.call}`, r);
  const calls: RpeCall[] = trace.flatMap((r) => {
    if (r.event.kind !== "call_started") return [];
    const end = ends.get(`${r.agent.id}\u0000${r.event.call}`);
    const ended = end?.event.kind === "call_ended" ? end.event : null;
    return [{ agent: r.agent.id, definition: r.agent.definition, call: r.event.call, model: r.event.model, startedAt: r.at, messages: r.event.messages, tools: r.event.tools, endedAt: end?.at ?? null, ms: ended?.ms ?? null, usage: ended?.usage ?? null }];
  });
  const intent = trace.find((r) => r.event.kind === "intent") ?? null;
  const intentAt = intent?.at ?? null;
  const own = deltas.filter((d) => d.run === detail.id && d.agent === lead);
  // The call the intent record was written in: the lead's last call begun before it.
  const intentCall = intentAt === null ? undefined : calls.filter((c) => c.agent === lead && c.startedAt <= intentAt).at(-1)?.call;
  let intentOwnMs: number | null = null;
  let intentFrom: RpeTurn["intentFrom"] = null;
  if (intentAt !== null && intentCall !== undefined) {
    const before = own.filter((d) => d.call === intentCall && d.at <= intentAt);
    const text = before.find((d) => (d.text ?? "") !== "");
    const thinking = before.filter((d) => (d.thinking ?? "") !== "").at(-1);
    if (text !== undefined) [intentOwnMs, intentFrom] = [intentAt - text.at, "text"];
    else if (thinking !== undefined) [intentOwnMs, intentFrom] = [intentAt - thinking.at, "thinking"];
  }
  const firstCall = own.filter((d) => d.call === 1);
  const firstThinking = firstCall.find((d) => (d.thinking ?? "") !== "");
  const firstText = firstCall.find((d) => (d.text ?? "") !== "");
  const thinkingEnd = firstText?.at ?? (intentCall === 1 ? intentAt : null);
  const released = trace.find((r) => r.event.kind === "released");
  return {
    turn: detail.id,
    status: detail.status,
    kind: detail.kind,
    form: released?.event.kind === "released" ? released.event.release.form : null,
    timings: t,
    usage: detail.usage,
    calls,
    callsOnPath: replyAt === null ? null : calls.filter((c) => c.startedAt <= replyAt).length,
    toolsBeforeReply: replyAt === null ? [] : trace.flatMap((r) => (r.event.kind === "tool_started" && r.at <= replyAt ? [r.event.via === undefined ? r.event.tool : `${r.event.tool} (via ${r.event.via})`] : [])),
    intentAt,
    intentOwnMs,
    intentFrom,
    thinkingMs: firstThinking === undefined ? null : span(firstThinking.at, thinkingEnd),
    intakeMs: span(t.received, t.started),
    intentAfterMs: span(t.received, intentAt),
    firstPieceAfterMs: span(t.received, t.firstWord),
    afterReplyMs: span(t.released, t.ended),
    deltasHeard: own.length,
    deltasMissed,
  };
}

// ---------------------------------------------------------------- the table

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Milliseconds per output token while the reply streamed on the page, from Lumiverse's own token count. */
export function perToken(m: Measured): number | null {
  if (m.tokens === null || m.tokens < 2 || m.toFirstWord === null || m.toLastWord === null) return null;
  return (m.toLastWord - m.toFirstWord) / (m.tokens - 1);
}

export type Verdict = "pass" | "fail" | "reported" | "not judged" | "not measured";

export interface Row {
  measure: string;
  pass: string;
  measured: string;
  verdict: Verdict;
  /** The rule applied, or why the row was not judged or not measured. */
  note: string;
}

const s = (ms: number | null): string => (ms === null ? "—" : `${(ms / 1000).toFixed(2)} s`);
const values = (list: readonly (number | null)[]): number[] => list.filter((v): v is number => v !== null);

/** §17.1's table from every turn of a run, for RPE's connection in `form`. */
export function floorTable(all: readonly Measured[], form: Form): Row[] {
  const good = (arm: Measured["arm"]) => all.filter((m) => m.arm === arm && m.error === null && m.toFirstWord !== null);
  const plain = good("plain");
  const rpe = good("rpe");
  const rpeTurns = all.filter((m) => m.arm === "rpe");
  const pairs = Math.max(0, ...all.map((m) => m.pair));
  // A release form other than the one the flag names contradicts the flag: no gate is judged on it.
  const wrongForm = rpeTurns.filter((m) => m.rpe !== null && m.rpe.form !== null && m.rpe.form !== RELEASE_FORM[form]);
  const unjudged = (needsPlain: boolean): string | null => {
    if (wrongForm.length > 0) return `${wrongForm.length} RPE turn(s) were released as "${wrongForm[0]?.rpe?.form}", not "${RELEASE_FORM[form]}" as --form ${form} says`;
    if (rpe.length === 0) return "no RPE turn completed";
    if (needsPlain && plain.length === 0) return "no plain turn completed (--only rpe)";
    if (pairs < PASS.pairs) return `the gate is set on ${PASS.pairs} pairs; this run played ${pairs}`;
    return null;
  };
  const rows: Row[] = [];

  // First words: RPE's time to the reply's first piece on the page, less the intent record's own time.
  const adjusted = rpe.map((m) => (m.toFirstWord as number) - (m.rpe?.intentOwnMs ?? 0));
  const unadjusted = rpe.filter((m) => m.rpe?.intentOwnMs == null).length;
  const rpeFirst = median(adjusted);
  const plainRef = form === "tag" ? median(plain.map((m) => m.toFirstWord as number)) : median(values(plain.map((m) => m.toLastWord)));
  const firstOver = rpeFirst === null || plainRef === null ? null : rpeFirst - plainRef;
  const firstWhy = unjudged(true);
  rows.push({
    measure: "First words on screen",
    pass: `RPE's median at most ${PASS.firstWordsOverMs / 1000} s over plain's`,
    measured: `RPE ${s(rpeFirst)} (unadjusted ${s(median(rpe.map((m) => m.toFirstWord as number)))}, intent record ${s(median(values(rpe.map((m) => m.rpe?.intentOwnMs ?? null))))}); plain ${s(plainRef)}; RPE less plain ${s(firstOver)}. Thinking: RPE ${s(median(values(rpe.map((m) => m.rpe?.thinkingMs ?? null))))}, plain ${s(median(values(plain.map((m) => (m.toFirstThinking === null ? null : (m.toFirstWord as number) - m.toFirstThinking)))))}`,
    verdict: firstWhy !== null || firstOver === null ? "not judged" : firstOver <= PASS.firstWordsOverMs ? "pass" : "fail",
    note: [
      form === "tag"
        ? "tag form: request to the reply's first word on the page, less the intent record's own time, against plain's request to first word"
        : "two-step form: request to the reply's first piece on the page, less the intent record's own time, against plain's request to its last word",
      unadjusted > 0 ? `${unadjusted} RPE turn(s) had no intent time to take off and count unadjusted` : null,
      firstWhy,
    ]
      .filter((x) => x !== null)
      .join("; "),
  });

  // Time per output token: gated only in the tag form.
  const rpeTok = median(values(rpe.map(perToken)));
  const plainTok = median(values(plain.map(perToken)));
  const tokOver = rpeTok === null || plainTok === null ? null : rpeTok / plainTok - 1;
  const tokWhy = unjudged(true);
  rows.push({
    measure: "Time per output token",
    pass: form === "tag" ? `RPE's median at most ${PASS.perTokenOver * 100}% over plain's` : "reported, not gated (two-step form)",
    measured: `RPE ${rpeTok === null ? "—" : `${rpeTok.toFixed(1)} ms`}, plain ${plainTok === null ? "—" : `${plainTok.toFixed(1)} ms`}${tokOver === null ? "" : `; ${Math.abs(tokOver * 100).toFixed(1)}% ${tokOver > 0 ? "over" : "under"} plain`}`,
    verdict: form === "two-step" ? "reported" : tokWhy !== null || tokOver === null ? "not judged" : tokOver <= PASS.perTokenOver ? "pass" : "fail",
    note: ["first word to last word on the page over Lumiverse's token count less one", form === "tag" ? tokWhy : null].filter((x) => x !== null).join("; "),
  });

  // Model calls on the reply's path.
  const want = PASS.calls[form];
  const counted = rpeTurns.map((m) => m.rpe?.callsOnPath ?? null);
  const exact = counted.filter((c) => c === want).length;
  const needed = Math.ceil(PASS.callsShare * Math.max(rpeTurns.length, PASS.pairs));
  const callsWhy = unjudged(false);
  rows.push({
    measure: "Model calls on the reply's path",
    pass: `exactly ${want} in at least ${needed} of ${Math.max(rpeTurns.length, PASS.pairs)}`,
    measured: `exactly ${want} in ${exact} of ${rpeTurns.length} (counts: ${counted.map((c) => c ?? "?").join(", ")})`,
    verdict: callsWhy !== null ? "not judged" : exact >= needed ? "pass" : "fail",
    note: [`${form} form: calls begun by any agent before the reply's first piece left RPE`, callsWhy].filter((x) => x !== null).join("; "),
  });

  rows.push({
    measure: "What the model was sent",
    pass: "the Author's first request holds every message Lumiverse sent that the window kept, in order, same roles, right after the opening block",
    measured: "—",
    verdict: "not measured",
    note: "RPE's API does not give a call's request: the trace's call_started holds only counts (messages, tools). Needed: GET /api/v1/chats/:chat/turns/:turn giving, on the lead's first call_started, the request's messages in order as { role, text }[] (or a route GET /api/v1/chats/:chat/turns/:turn/calls/:agent/:call answering { messages }). Lumiverse's side is readable now: GET /api/v1/generate/breakdown/:messageId, field messages",
  });
  rows.push({
    measure: "Activated lore",
    pass: "every activated entry appears in the lore map",
    measured: "—",
    verdict: "not measured",
    note: "the activated ids and the lore map are in the turn's folder (turn.json lore, briefing's lore map) and no route serves them. Needed: TurnDetail fields lore.activated (ids) and lore.map (ids)",
  });
  const after = values(rpeTurns.map((m) => m.rpe?.afterReplyMs ?? null));
  const intake = median(values(rpeTurns.map((m) => m.rpe?.intakeMs ?? null)));
  rows.push({
    measure: "Intake",
    pass: "median ≤ 150 ms on a 10,000-message chat",
    measured: `${s(intake)} on this chat (request reaching RPE to its run starting)`,
    verdict: "not measured",
    note: "the gate is on a 10,000-message chat; the floor chat is short",
  });
  rows.push({
    measure: "The Author's tools",
    pass: "under 8,000 tokens",
    measured: `tools on the lead's first call (median count): ${median(values(rpeTurns.map((m) => m.rpe?.calls[0]?.tools ?? null))) ?? "—"}`,
    verdict: "not measured",
    note: "the trace counts the tools a call carried, not their tokens. Needed: call_started giving the tools' token count (or the tool definitions as sent)",
  });
  rows.push({
    measure: "The Author's guidance stack",
    pass: "reported at every wave, against about 6,000 tokens",
    measured: "—",
    verdict: "not measured",
    note: "no route gives the guidance stack's size. Needed: TurnDetail (or call_started) giving the tokens of the guidance the lead's first request carried",
  });
  rows.push({
    measure: "The run after the reply",
    pass: "reported, with how long a next message would have waited",
    measured: `median ${s(median(after))}, longest ${s(after.length === 0 ? null : Math.max(...after))}`,
    verdict: "reported",
    note: "release to the run's end, RPE's timings; a next message sent at the release waits that long",
  });
  return rows;
}

export function printTable(rows: readonly Row[]): void {
  console.log("\n§17.1 The floor test");
  for (const r of rows) {
    console.log(`\n${r.measure}: ${r.verdict.toUpperCase()}`);
    console.log(`  pass:     ${r.pass}`);
    console.log(`  measured: ${r.measured}`);
    if (r.note !== "") console.log(`  ${r.verdict === "not measured" ? "why" : "rule"}:     ${r.note}`);
  }
}

/** One line per RPE turn: RPE's own numbers. */
export function printRpeTurns(all: readonly Measured[]): void {
  const rpe = all.filter((m) => m.arm === "rpe");
  if (rpe.length === 0) return;
  console.log("\npair  calls  intent  first piece  intent's own  after reply  tokens in/cached/out  tools before the reply");
  for (const m of rpe) {
    const r = m.rpe;
    if (r === null) {
      console.log(`${String(m.pair).padStart(4)}  no RPE turn: ${m.rpeError ?? "unknown"}`);
      continue;
    }
    console.log(
      `${String(m.pair).padStart(4)}  ${String(r.callsOnPath ?? "?").padStart(5)}  ${s(r.intentAfterMs).padStart(6)}  ${s(r.firstPieceAfterMs).padStart(11)}  ${s(r.intentOwnMs).padStart(12)}  ${s(r.afterReplyMs).padStart(11)}  ${`${r.usage.input}/${r.usage.cacheRead}/${r.usage.output}`.padStart(20)}  ${r.toolsBeforeReply.join(", ") || "none"}`,
    );
  }
}
