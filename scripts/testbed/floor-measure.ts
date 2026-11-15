// The floor test's table (STANDALONE-PLAN §17.1), measured as §17.1 defines it and not another way:
// every row, from what the run recorded of each turn, with no network, so a recorded run gives the same
// table again. The live and rig forms (`scripts/proof/floor/gate.ts`) gather the turns; this file only
// reads them.
//
// The rows, as the floor's package sets them (PlanGates-4):
// - First words on screen: per turn, from the request leaving to the reply's first word on the chat page
//   (tag form) or to the moment its message ended and was shown whole (two-step form, l.1773), less
//   exactly the intent record's own time (`timings.intent`, R-185, R-91); the median over the RPE turns
//   against plain's median to its first word (tag) or its last word (two-step); same model, same thinking
//   effort (R-92). Thinking for both arms and the record's own time are printed beside it.
// - Time per output token: tag form, first word to last word on the page over Lumiverse's token count
//   less one, gated at 15%; two-step form, the reply call's streamed pieces over its output tokens,
//   against plain's page measure: reported, not gated.
// - Model calls on the reply's path: begun by any agent before the reply's first piece left RPE (tag) or
//   its release (two-step); exactly 1, or exactly 2, in at least 9 of 10 (R-96).
// - What the model was sent, and Activated lore: every RPE turn.
// - Intake: reported on the floor's chat; the gate is on a 10,000-message chat (PlanGates-5).
// - The Author's tools: the largest `toolTokens` over every call of the Author, under 8,000 (R-67).
// - The Author's guidance stack: `openingTokens` of its first call, reported against about 6,000.
// - The run after the reply: release to the run's end, median and longest, with how long a next
//   message would have waited.

import type { TraceDelta, TraceRecord } from "rp-harness/contract";
import { compareLore, loreFold, type BookDesign } from "../proof/lib/lore";
import type { ChatRow, LoreEntry, StoredMessage } from "../proof/lib/read";
import type { PlainReasoning } from "../proof/lib/record";
import { compareSent, sentFold } from "../proof/lib/sent";
import { callsBefore, callsOf, leadOf, leadStart, releaseOf, replyCall, spanMs, traceIntentMs, type Call, type KeptRequest, type RecordTimes } from "../proof/lib/turn";
import type { TurnTimings } from "../../src/ui/api";

/** The form RPE's connection replies in (plan §10.7): the tags in one call, or the record and the reply as two. */
export type Form = "tag" | "two-step";

/** §17.1's pass values, the plan's own; none is a value of this script's. */
export const PASS = {
  /** First words: RPE's median, less the record's own time, at most this much over plain's. */
  firstWordsOverMs: 3000,
  /** Time per output token: RPE's median at most this fraction over plain's (tag form). */
  perTokenOver: 0.15,
  /** Calls on the reply's path, by form, in at least `share.hits` of `share.of` turns. */
  calls: { tag: 1, "two-step": 2 } as Readonly<Record<Form, number>>,
  share: { hits: 9, of: 10 },
  /** The test is ten pairs. */
  pairs: 10,
  /** The Author's tools: under this many tokens. */
  toolTokens: 8000,
  /** The Author's guidance stack: reported against a target of about this many tokens. */
  stackTarget: 6000,
} as const;

/** What the chat page showed of one turn, timed in the page by the browser driver, in ms on the page's clock. */
export interface PageTimes {
  /** Send pressed in the composer: the request leaving. */
  sent: number;
  /** The reply's thinking block first showed text. */
  firstThinking: number | null;
  /** The reply's first word was shown. */
  firstWord: number | null;
  /** Its last word was shown. */
  lastWord: number | null;
  /** Its message ended and was shown whole. */
  ended: number | null;
  /** How finely the page's moments can be told apart, in ms. */
  resolution: number;
}

/** What Lumiverse's socket told of the turn, kept as support (ms on the script's clock), with its token count and the saved message. */
export interface SocketTimes {
  started: number | null;
  firstReasoning: number | null;
  firstToken: number | null;
  lastToken: number | null;
  ended: number | null;
  /** Lumiverse's own count of the reply's tokens (`GENERATION_METRICS_READY.tokenCount`). */
  tokens: number | null;
  messageId: string | null;
  error: string | null;
}

/** RPE's side of one RPE turn, as its routes and live socket gave it. Times on RPE's clock. */
export interface RpeSide {
  turn: string;
  status: string;
  timings: TurnTimings;
  record: RecordTimes | "not served";
  trace: TraceRecord[];
  /** The turn's streamed pieces from RPE's live socket, and whether the socket dropped any while the turn ran. */
  deltas: TraceDelta[];
  deltasMissed: boolean;
  /** The lead's first call's kept request. */
  request: KeptRequest | null;
  /**
   * The prompt Lumiverse stored with the reply and the chat's rows, for what the model was sent; with the
   * history window as RPE's settings give it for the chat (`history.window`, `history.step`, the hold's cap
   * when `history.hold.on`; null: none) and the framing line RPH sends before block 2 (the chat's
   * `.prompts/prompt-frame.md`, plan §10.2 l.1160).
   */
  stored: StoredMessage[] | null;
  rows: ChatRow[] | null;
  history: { keep: number | null; step: number | null; hold: number | null; framing: string | null };
  /** The turn's lore: Lumiverse's activated ids and the lore map's ids (`TurnDetail.lore`), and the lore route's entries tying the two. */
  lore: { activated: string[]; map: string[]; entries: LoreEntry[] | null };
  /** What could not be read of this turn, each in plain words. */
  problems: string[];
}

export interface FloorTurn {
  pair: number;
  arm: "plain" | "rpe";
  line: string;
  page: PageTimes | null;
  socket: SocketTimes;
  rpe: RpeSide | null;
  /** Why the turn failed, when it did. */
  error: string | null;
}

/** A floor run as the table reads it: the form and streaming of the Author's connection, plain's reasoning and model, the intake wait limit, the turns. */
export interface FloorRun {
  form: Form;
  /** The Author's connection named in `reply.streamAnyway`: a two-step reply streamed anyway. */
  streamed: boolean;
  plain: (PlainReasoning & { model: string }) | null;
  /** `limits.previousRun` as the run gave it: how long a next message waits for the run before it, in seconds. */
  previousRun: number | null;
  /** The floor's book as the fixture made it, with Lumiverse's ids for its entries, so the lore row says which designed entries never activated; null when no book was found. */
  book: BookDesign | null;
  turns: FloorTurn[];
}

export type Verdict = "pass" | "fail" | "reported" | "not judged";

export interface Row {
  /** The gate part this row judges. */
  id: string;
  measure: string;
  pass: string;
  measured: string;
  verdict: Verdict;
  /** The rule applied, why the row was not judged, and turns listed for the lead. */
  notes: string[];
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

const s = (ms: number | null): string => (ms === null ? "—" : `${(ms / 1000).toFixed(2)} s`);
const msText = (ms: number | null): string => (ms === null ? "—" : `${ms.toFixed(1)} ms`);
const known = (list: readonly (number | null)[]): number[] => list.filter((v): v is number => v !== null);
const label = (t: FloorTurn): string => `pair ${t.pair} ${t.arm}${t.rpe ? ` (turn ${t.rpe.turn})` : ""}`;

/** The intent record's own time of an RPE turn, exactly `timings.intent`'s length; or why the turn has none. */
export function intentOwn(turn: FloorTurn): { ms: number } | { none: string } {
  if (turn.rpe === null) return { none: "no RPE turn was matched to it" };
  if (turn.rpe.record === "not served") return { none: "the turn route gives no timings.intent (PlanTurn-3 item 4)" };
  const intent = turn.rpe.record.intent;
  if (intent === null) return { none: "no intent record began" };
  const ms = spanMs(intent);
  return ms === null ? { none: "its intent record began and did not end" } : { ms };
}

/** RPE's thinking on the reply's path: the sum of `timings.thinking`'s spans; "not known" where one began and did not end. */
export function rpeThinking(turn: FloorTurn): number | "not known" | null {
  if (turn.rpe === null || turn.rpe.record === "not served") return null;
  let sum = 0;
  for (const span of turn.rpe.record.thinking) {
    const ms = spanMs(span);
    if (ms === null) return "not known";
    sum += ms;
  }
  return sum;
}

/** Plain's thinking on the page: from its thinking block's first text to the reply's first word. */
function plainThinking(turn: FloorTurn): number | null {
  const p = turn.page;
  return p === null || p.firstThinking === null || p.firstWord === null ? null : p.firstWord - p.firstThinking;
}

/** Why the comparison rows cannot be judged on this run's model and effort: same model and same thinking effort (R-92), or null when they hold. */
export function effortRefusal(run: FloorRun): string | null {
  const starts = run.turns.flatMap((t) => (t.rpe ? [leadStart(t.rpe.trace)] : []));
  if (starts.length === 0) return "no RPE turn says what the Author ran at";
  if (starts.some((st) => st === null)) return "an RPE turn's trace has no agent_started for its lead";
  const efforts = new Set(starts.map((st) => st?.effort ?? "not said"));
  const models = new Set(starts.map((st) => st?.model ?? ""));
  if (efforts.size > 1) return `the Author ran at more than one effort (${[...efforts].join(", ")})`;
  if (models.size > 1) return `the Author ran on more than one model (${[...models].join(", ")})`;
  const effort = [...efforts][0] as string;
  const model = [...models][0] as string;
  if (effort === "not said") return "the Author's agent_started names no effort, so its thinking effort is not known";
  const plain = run.plain;
  if (plain === null) return "plain generation's reasoning setting was not read";
  if (plain.model !== model) return `plain generation ran on ${plain.model} and the Author on ${model}: not the same model`;
  if (plain.customBody !== null && plain.customBody.reasoningKeys.length > 0) return `a custom request body (${plain.customBody.from}'s) sets ${plain.customBody.reasoningKeys.join(", ")} for plain generation, so its effort is not the one named`;
  if (plain.apiReasoning === null) return "plain generation's reasoning is not set in Lumiverse, so it thinks at the provider's own effort";
  if (effort === "off" && plain.apiReasoning) return `RPE's thinking is off while plain generation's is on (at ${plain.effort ?? "auto"})`;
  const plainEffort = plain.apiReasoning ? (plain.effort ?? "auto") : "off";
  if (plainEffort !== effort) return `the Author thinks at ${effort} and plain generation at ${plainEffort}: not the same thinking effort`;
  return null;
}

/** Why the run as a whole leaves a timing row unjudged: too few pairs, or no completed turn on an arm. */
function runRefusal(run: FloorRun, needsPlain: boolean): string | null {
  const pairs = Math.max(0, ...run.turns.map((t) => t.pair));
  if (pairs < PASS.pairs) return `the test is ${PASS.pairs} pairs; this run played ${pairs}`;
  if (!run.turns.some((t) => t.arm === "rpe" && t.error === null)) return "no RPE turn completed";
  if (needsPlain && !run.turns.some((t) => t.arm === "plain" && t.error === null)) return "no plain turn completed";
  return null;
}

/** The release forms the RPE turns were released in, against the run's form: a turn released in another form is listed. */
function formFaults(run: FloorRun): string[] {
  const want = run.form === "tag" ? "tags" : "message";
  return run.turns.flatMap((t) => {
    const release = t.rpe ? releaseOf(t.rpe.trace) : null;
    return release !== null && release.form !== want ? [`${label(t)} was released as "${release.form}", not "${want}"`] : [];
  });
}

function firstWordsRow(run: FloorRun, refusal: string | null): Row {
  const done = run.turns.filter((t) => t.error === null && t.page !== null);
  const rpe = done.filter((t) => t.arm === "rpe");
  const plain = done.filter((t) => t.arm === "plain");
  const twoStep = run.form === "two-step";
  // Two-step: to the moment the message ended and was shown whole; tag: to the first word.
  const rpeEnd = (t: FloorTurn) => (t.page === null ? null : twoStep ? t.page.ended : t.page.firstWord);
  const plainEnd = (t: FloorTurn) => (t.page === null ? null : twoStep ? t.page.lastWord : t.page.firstWord);
  const notes: string[] = [twoStep ? "two-step form: request to the moment the reply's message ended and was shown whole, less exactly timings.intent, against plain's request to its last word" : "tag form: request to the reply's first word on the page, less exactly timings.intent, against plain's request to its first word"];
  const withoutIntent: string[] = [];
  const adjusted: number[] = [];
  const unadjusted: number[] = [];
  const own: number[] = [];
  const streamed: number[] = [];
  for (const t of rpe) {
    const end = rpeEnd(t);
    const intent = intentOwn(t);
    if (end === null || t.page === null) {
      withoutIntent.push(`${label(t)}: the page never showed ${twoStep ? "its message ended" : "its first word"}`);
      continue;
    }
    unadjusted.push(end - t.page.sent);
    if ("none" in intent) withoutIntent.push(`${label(t)}: ${intent.none}`);
    else {
      own.push(intent.ms);
      adjusted.push(end - t.page.sent - intent.ms);
      if (t.page.firstWord !== null) streamed.push(t.page.firstWord - t.page.sent - intent.ms);
    }
  }
  const plainTimes = known(
    plain.map((t) => {
      const end = plainEnd(t);
      return t.page === null || end === null ? null : end - t.page.sent;
    }),
  );
  const rpeMedian = median(adjusted);
  const plainMedian = median(plainTimes);
  const over = rpeMedian === null || plainMedian === null ? null : rpeMedian - plainMedian;
  const thinkingRpe = rpe.map(rpeThinking);
  const notKnown = thinkingRpe.filter((v) => v === "not known").length;
  const thinkingText = `Thinking: RPE ${s(median(thinkingRpe.filter((v): v is number => typeof v === "number")))}${notKnown > 0 ? ` (${notKnown} turn(s) not known: a call's thinking began and did not end)` : ""}, plain ${s(median(known(plain.map(plainThinking))))}. The intent record's own time: ${s(median(own))}`;
  let measured = `RPE ${s(rpeMedian)} (to the page without taking the record off: ${s(median(unadjusted))}); plain ${s(plainMedian)}; RPE less plain ${s(over)}. ${thinkingText}`;
  // A streamed two-step run is shown beside the verdict's measure, never judged by it (PlanGates-4 item 2).
  if (twoStep && run.streamed) measured += `. Streamed: RPE's first streamed word less the record ${s(median(streamed))}: reported, not judged`;
  const why = [refusal, runRefusal(run, true), twoStep && run.streamed ? "streamed: reported, not judged (the Author's connection is named in reply.streamAnyway; the verdict needs the connection as shipped, its message shown when it ends)" : null, ...formFaults(run), withoutIntent.length > 0 ? `a turn without the intent record's own time is never judged unadjusted: ${withoutIntent.join("; ")}` : null].filter((w): w is string => w !== null);
  return {
    id: "first-words",
    measure: "First words on screen",
    pass: `RPE's median, less the intent record's own time, at most ${PASS.firstWordsOverMs / 1000} s over plain's, same model, same thinking effort`,
    measured,
    verdict: why.length > 0 || over === null ? "not judged" : over <= PASS.firstWordsOverMs ? "pass" : "fail",
    notes: [...notes, ...why],
  };
}

/** A turn whose intent record's own time on the turn route and in the trace differ by more than the page's resolution; `trace` null where the trace cannot say. */
export interface CrossCheck {
  turn: string;
  route: number;
  trace: number | null;
  resolution: number;
}

/** The intent record's own time against the trace's measure of it, turn by turn, for the lead (PlanGates-4 item 3). */
export function intentCrossCheck(run: FloorRun): CrossCheck[] {
  return run.turns.flatMap((t) => {
    if (t.rpe === null || t.page === null) return [];
    const own = intentOwn(t);
    if (!("ms" in own)) return [];
    const trace = traceIntentMs(run.form, t.rpe.trace, t.rpe.deltas, t.rpe.turn);
    return trace === null || Math.abs(trace - own.ms) > t.page.resolution ? [{ turn: label(t), route: own.ms, trace, resolution: t.page.resolution }] : [];
  });
}

/** One turn's time per output token on the page: first word to last word over Lumiverse's count less one. */
export function pagePerToken(t: FloorTurn): number | null {
  const p = t.page;
  const tokens = t.socket.tokens;
  if (p === null || tokens === null || tokens < 2 || p.firstWord === null || p.lastWord === null) return null;
  return (p.lastWord - p.firstWord) / (tokens - 1);
}

/** The reply call's own time per output token from RPE's live socket: its first streamed piece to its last, over its output tokens less one. */
export function replyCallPerToken(t: FloorTurn): number | null {
  if (t.rpe === null || t.rpe.deltasMissed) return null;
  const release = releaseOf(t.rpe.trace);
  const call = replyCall(callsOf(t.rpe.trace), release);
  if (call === null || call.usage === null || call.usage.output < 2) return null;
  const pieces = t.rpe.deltas.filter((d) => d.run === t.rpe?.turn && d.agent === call.agent && d.call === call.call && (d.text ?? "") !== "");
  const first = pieces[0];
  const last = pieces.at(-1);
  return first === undefined || last === undefined ? null : (last.at - first.at) / (call.usage.output - 1);
}

function perTokenRow(run: FloorRun, refusal: string | null): Row {
  const done = run.turns.filter((t) => t.error === null);
  const plain = median(known(done.filter((t) => t.arm === "plain").map(pagePerToken)));
  if (run.form === "two-step") {
    const rpe = median(known(done.filter((t) => t.arm === "rpe").map(replyCallPerToken)));
    return {
      id: "per-token",
      measure: "Time per output token",
      pass: "two-step form: reported, not gated (l.1773)",
      measured: `RPE's reply call ${msText(rpe)} per token (its streamed pieces on RPE's live socket over its output tokens), plain ${msText(plain)} per token on the page`,
      verdict: "reported",
      notes: ["which call wrote the reply is read from the released event"],
    };
  }
  const rpe = median(known(done.filter((t) => t.arm === "rpe").map(pagePerToken)));
  const over = rpe === null || plain === null ? null : rpe / plain - 1;
  const why = [refusal, runRefusal(run, true), ...formFaults(run)].filter((w): w is string => w !== null);
  return {
    id: "per-token",
    measure: "Time per output token",
    pass: `RPE's median at most ${PASS.perTokenOver * 100}% over plain's`,
    measured: `RPE ${msText(rpe)}, plain ${msText(plain)} per token${over === null ? "" : `; ${Math.abs(over * 100).toFixed(1)}% ${over > 0 ? "over" : "under"} plain`}`,
    verdict: why.length > 0 || over === null ? "not judged" : over <= PASS.perTokenOver ? "pass" : "fail",
    notes: ["tag form: first word to last word on the page over Lumiverse's token count less one", ...why],
  };
}

/** Each RPE turn's calls on the reply's path, or why it has none. */
export function pathCalls(run: FloorRun, t: FloorTurn): { calls: number } | { none: string } {
  if (t.rpe === null) return { none: t.error ?? "no RPE turn was matched to it" };
  const moment = run.form === "tag" ? t.rpe.timings.firstWord : t.rpe.timings.released;
  if (moment === null) return { none: run.form === "tag" ? "no piece of the reply left RPE" : "the reply was never released" };
  return { calls: callsBefore(callsOf(t.rpe.trace), moment) };
}

function callsRow(run: FloorRun): Row {
  const want = PASS.calls[run.form];
  const rpe = run.turns.filter((t) => t.arm === "rpe");
  const counted = rpe.map((t) => pathCalls(run, t));
  const hits = counted.filter((c) => "calls" in c && c.calls === want).length;
  const judged = counted.length;
  const enough = judged >= PASS.share.of;
  const meets = hits * PASS.share.of >= PASS.share.hits * judged;
  return {
    id: "calls",
    measure: "Model calls on the reply's path",
    pass: `exactly ${want} in at least ${PASS.share.hits} of ${PASS.share.of}`,
    measured: `exactly ${want} in ${hits} of ${judged} (${counted.map((c) => ("calls" in c ? String(c.calls) : "?")).join(", ")})`,
    verdict: !enough ? "not judged" : meets ? "pass" : "fail",
    notes: [`${run.form} form: calls begun by any agent before the reply's ${run.form === "tag" ? "first piece left RPE (timings.firstWord)" : "release (timings.released)"}`, ...counted.flatMap((c, i) => ("none" in c ? [`${label(rpe[i] as FloorTurn)}: ${c.none}`] : [])), ...(enough ? [] : [`the share is judged on ${PASS.share.of} turns; ${judged} were played`]), ...formFaults(run)],
  };
}

/** The Author's calls across the run: every call of each RPE turn's lead. */
function authorCalls(run: FloorRun): { turn: FloorTurn; call: Call }[] {
  return run.turns.flatMap((t) => {
    if (t.rpe === null) return [];
    const lead = leadOf(t.rpe.trace);
    return callsOf(t.rpe.trace)
      .filter((c) => c.agent === lead?.id)
      .map((call) => ({ turn: t, call }));
  });
}

function toolsRow(run: FloorRun): Row {
  const calls = authorCalls(run);
  const unknown = calls.filter((c) => c.call.toolTokens === null);
  const largest = calls.reduce<{ tokens: number; at: string } | null>((best, c) => (c.call.toolTokens !== null && (best === null || c.call.toolTokens > best.tokens) ? { tokens: c.call.toolTokens, at: `${label(c.turn)} call ${c.call.call}` } : best), null);
  const tools = Math.max(0, ...calls.map((c) => c.call.tools));
  const names = [...new Set(run.turns.flatMap((t) => t.rpe?.request?.tools ?? []))];
  const why = [calls.length === 0 ? "no call of the Author was recorded" : null, unknown.length > 0 ? `${unknown.length} call(s) of the Author carry no toolTokens (records made before RPH gave them)` : null].filter((w): w is string => w !== null);
  return {
    id: "tools",
    measure: "The Author's tools",
    pass: `under ${PASS.toolTokens.toLocaleString("en")} tokens, on every call of the Author`,
    measured: `the largest ${largest === null ? "—" : `${largest.tokens.toLocaleString("en")} tokens (${largest.at})`}, by RPH's own estimate, over ${calls.length} call(s); up to ${tools} tools on a call${names.length > 0 ? `: ${names.join(", ")}` : ""}`,
    verdict: why.length > 0 || largest === null ? "not judged" : largest.tokens < PASS.toolTokens ? "pass" : "fail",
    notes: why,
  };
}

function stackRow(run: FloorRun): Row {
  const first = authorCalls(run).filter((c) => c.call.call === 1);
  const sizes = known(first.map((c) => c.call.openingTokens));
  const low = sizes.length === 0 ? null : Math.min(...sizes);
  const high = sizes.length === 0 ? null : Math.max(...sizes);
  return {
    id: "stack",
    measure: "The Author's guidance stack",
    pass: `reported at every wave, against a target of about ${PASS.stackTarget.toLocaleString("en")} tokens`,
    measured: low === null ? "— (no first call of the Author carries openingTokens)" : `${low === high ? `${low?.toLocaleString("en")}` : `${low.toLocaleString("en")} to ${high?.toLocaleString("en")}`} tokens in the Author's opening block on its first call, by RPH's own estimate, over ${sizes.length} turn(s)`,
    verdict: "reported",
    notes: ["call_started.openingTokens of the Author's first call; the Files page's stack view of the same chat is saved as a screen beside it"],
  };
}

function afterRow(run: FloorRun): Row {
  const spans = known(run.turns.map((t) => (t.rpe === null || t.rpe.timings.released === null || t.rpe.timings.ended === null ? null : t.rpe.timings.ended - t.rpe.timings.released)));
  const longest = spans.length === 0 ? null : Math.max(...spans);
  const limit = run.previousRun;
  return {
    id: "after-reply",
    measure: "The run after the reply",
    pass: "its time reported on its own, with how long a next message would have waited",
    measured: `median ${s(median(spans))}, longest ${s(longest)}; a next message sent at the release would have waited as long${limit === null ? "" : `, up to ${limit} s (limits.previousRun), after which that run is stopped`}`,
    verdict: "reported",
    notes: ["timings.released to timings.ended"],
  };
}

function intakeRow(run: FloorRun): Row {
  const spans = known(run.turns.map((t) => (t.rpe === null || t.rpe.timings.started === null ? null : t.rpe.timings.started - t.rpe.timings.received)));
  return {
    id: "intake",
    measure: "Intake",
    pass: "median ≤ 150 ms on a 10,000-message chat (PlanGates-5 judges it there)",
    measured: `${s(median(spans))} on the floor's chat, from the request reaching RPE to its run starting`,
    verdict: "reported",
    notes: ["timings.received to timings.started; the gate is on the long chat"],
  };
}

/** The rows this file measures from the turns' times, calls and tokens, by id: every row but what the model was sent and the activated lore. */
export function measuredRows(run: FloorRun): Record<"first-words" | "per-token" | "calls" | "intake" | "tools" | "stack" | "after-reply", Row> {
  const refusal = effortRefusal(run);
  return { "first-words": firstWordsRow(run, refusal), "per-token": perTokenRow(run, refusal), calls: callsRow(run), intake: intakeRow(run), tools: toolsRow(run), stack: stackRow(run), "after-reply": afterRow(run) };
}

function sentRow(run: FloorRun): Row {
  const turns = run.turns.filter((t) => t.arm === "rpe").map((t) => {
    const side = t.rpe;
    const why = side === null ? (t.error ?? "no RPE turn was matched to it") : side.request === null ? "RPE kept no first request of the lead" : side.stored === null ? "Lumiverse stored no prompt with the reply" : null;
    return { turn: label(t), why, verdict: side?.request && side.stored ? compareSent({ request: side.request.messages, stored: side.stored, rows: side.rows ?? undefined, ...side.history }) : null };
  });
  const folded = sentFold(turns);
  return { id: "sent", measure: "What the model was sent", pass: "for every RPE turn, the Author's first request holds every message Lumiverse sent that the window kept, in the same order with the same roles, right after the opening block", ...folded };
}

function loreRow(run: FloorRun): Row {
  const turns = run.turns.filter((t) => t.arm === "rpe").map((t) => {
    const side = t.rpe;
    const why = side === null ? (t.error ?? "no RPE turn was matched to it") : side.lore.entries === null ? "RPE's lore route gave no entries" : null;
    return { turn: label(t), why, verdict: side?.lore.entries ? compareLore({ activated: side.lore.activated, map: side.lore.map, entries: side.lore.entries }) : null };
  });
  const folded = loreFold(turns, run.book ?? undefined);
  return { id: "lore", measure: "Activated lore", pass: "for every RPE turn, every entry Lumiverse activated appears in the lore map", ...folded };
}

/** §17.1's table for a run, rows in the plan's order. */
export function floorTable(run: FloorRun): Row[] {
  const rows = measuredRows(run);
  return [rows["first-words"], rows["per-token"], rows.calls, sentRow(run), loreRow(run), rows.intake, rows.tools, rows.stack, rows["after-reply"]];
}

/** The table in words, after the run's standing; a trial prints its figures and no verdict. */
export function tableText(rows: readonly Row[], standing: readonly string[], trial: boolean, crossCheck: readonly CrossCheck[]): string {
  const out = ["§17.1 The floor test", ...standing];
  for (const r of rows) {
    out.push("", `${r.measure}: ${trial ? "no verdict (trial)" : r.verdict.toUpperCase()}`, `  pass:     ${r.pass}`, `  measured: ${r.measured}`);
    for (const note of r.notes) out.push(`  note:     ${note}`);
  }
  if (crossCheck.length > 0) {
    out.push("", "For the lead: turns whose intent record time on the turn route and in the trace differ by more than the page's resolution");
    for (const c of crossCheck) out.push(`  ${c.turn}: route ${s(c.route)}, trace ${s(c.trace)}, resolution ${c.resolution} ms`);
  }
  return `${out.join("\n")}\n`;
}
