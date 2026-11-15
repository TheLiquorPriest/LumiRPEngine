// The floor test's table (STANDALONE-PLAN §17.1), measured as §17.1 defines it and not another way:
// every row, from what the run recorded of each turn, with no network, so a recorded run gives the same
// table again. The live and rig forms (`scripts/proof/floor/gate.ts`) gather the turns; this file only
// reads them.
//
// Every turn is accounted for (PlanGates-4-fix1 item 1). The timing rows are judged only when all ten
// pairs were measured on both sides: a pair whose turn failed, ran past a limit (`LIMITS`), was not played
// because the floor stopped, or lost a read the row needs, is named with its cause, and the row is not
// judged ("9 of 10 pairs measured; pair 10: ..."), never judged on a median of the rest. Each read of the
// RPE side stands alone: one that failed leaves only the rows that need it not judged, by name. A row
// with no figure is not judged, with why; a reported row with its figure is met. Each row says how many
// turns its figure stands on. Where the floor found its own reasons for a trial before the first pair
// (`trials`), the table prints them first and no verdict.
//
// The rows, as the floor's packages set them (PlanGates-4, PlanGates-4-fix1):
// - First words on screen: per turn, from Send to the reply's first word on the chat page (tag form) or
//   to the moment its message ended and was shown whole (two-step form, l.1773), less exactly the intent
//   record's own time (`timings.intent`, R-185); a turn where no intent record began is judged with
//   nothing taken off and named (the lead's ruling); one whose record began and did not end, or a route
//   that serves no `timings.intent`, leaves its pair unmeasured (R-91). RPE's median against plain's to
//   its first word (tag) or last word (two-step); same model, same thinking effort (R-92). Whether RPE's
//   reply streamed is read from `run.json` (`agents[].streams`) and from each turn (its first word left
//   RPE before its release): a streamed two-step run is not judged, "streamed".
// - Time per output token: first word to last word on the page over the tokens of the reply shown,
//   less one, both arms counted alike: Lumiverse's own count of the shown text, by the model both ran
//   on (the count its speed figure uses for visible text), never a provider's completion count nor the
//   count RPE reports. Gated at 15% in the tag form; in the two-step form the reply call's streamed
//   pieces over the same count, reported, not gated.
// - Model calls on the reply's path: begun by any agent before the reply's first piece left RPE (tag) or
//   its release (two-step); exactly 1, or exactly 2, in at least 9 of 10 (R-96). A failed turn is a miss.
// - What the model was sent, and Activated lore: every RPE turn (`scripts/proof/lib/sent.ts`, `lore.ts`).
// - Intake: reported on the floor's chat; the gate is on a 10,000-message chat (PlanGates-5).
// - The Author's tools: the largest `toolTokens` over every call of the Author, under 8,000 (R-67).
// - The Author's guidance stack: `openingTokens` of its first call, reported against about 6,000.
// - The run after the reply: release to the run's end, median and longest, with how long a next
//   message would have waited; a run still going at the floor's limit counts as longer than it.

import type { TraceDelta, TraceRecord } from "rp-harness/contract";
import { compareLore, loreFold, type ActivatedEntry, type BookDesign } from "../proof/lib/lore";
import type { LoreEntry } from "../proof/lib/read";
import type { PlainReasoning } from "../proof/lib/record";
import { compareSent, sentFold, type ChatRow, type StoredMessage } from "../proof/lib/sent";
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

/**
 * How long the floor waits, at most (limits of the proof script, not of the product): for Lumiverse's
 * socket to tell a generation's end and stored prompt after the page's end, for RPE to tie the reply,
 * and for RPE's run to end. A turn past the first two is an error named in its pair; a run past the last
 * stops the floor, and the table says so.
 */
export const LIMITS = { afterEnd: 30_000, tie: 60_000, runEnd: 15 * 60_000 } as const;

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

/** What Lumiverse's socket told of the turn, kept as support (ms on the script's clock), with the saved message and the lore it activated. */
export interface SocketTimes {
  started: number | null;
  firstReasoning: number | null;
  firstToken: number | null;
  lastToken: number | null;
  ended: number | null;
  /** The provider's completion count (`GENERATION_METRICS_READY.tokenCount`, reasoning included): support only, never a row's count. */
  tokens: number | null;
  messageId: string | null;
  error: string | null;
  /** The entries of the generation's `WORLD_INFO_ACTIVATED` event; null when none was heard. */
  lore: ActivatedEntry[] | null;
}

/** The reads of an RPE turn that can fail on their own, each leaving only the rows that need it not judged. */
export type RpeRead = "request" | "stored" | "rows" | "lore";

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
   * when `history.hold.on`; null: none) and the framing line RPH sends before block 2 (plan §10.2 l.1160),
   * as RPH renders it (`scripts/proof/lib/frame.ts`) and as RPH's model layer marks it when sent as a
   * note, or null with `framingWhy`. The floor gives no reach of the story record, so with the hold on
   * its turns are not judged (PlanGates-4-fix1 item 9).
   */
  stored: StoredMessage[] | null;
  rows: ChatRow[] | null;
  history: { keep: number | null; step: number | null; hold: number | null; framing: string | null; framingNote: string | null; framingWhy: string | null };
  /** The turn's lore: the lore map's ids (`TurnDetail.lore.map`), and the lore route's entries tying them to Lumiverse's; null when the read failed. What Lumiverse activated is its own event's (`SocketTimes.lore`). */
  lore: { map: string[]; entries: LoreEntry[] | null };
  /** Each read that failed, and why. */
  missing: Partial<Record<RpeRead, string>>;
}

export interface FloorTurn {
  pair: number;
  arm: "plain" | "rpe";
  line: string;
  page: PageTimes | null;
  socket: SocketTimes;
  /** Lumiverse's own count of the reply as shown (`POST /api/v1/tokenizers/count`, the tokenizer its speed figure counts visible text with), by the plain arm's model; null with `visibleWhy`. */
  visible: number | null;
  visibleWhy: string | null;
  rpe: RpeSide | null;
  /** Why the turn failed, when it did. */
  error: string | null;
}

/** An arm's connection, as Lumiverse holds it and, for RPE's, as the trace says the Author ran. */
export interface Arm {
  connection: string;
  provider: string | null;
  model: string | null;
}

/** A floor run as the table reads it. */
export interface FloorRun {
  /** The Author's reply form, from `run.json` (`agents[].replyForm`). */
  form: Form;
  /** Why the form could not be read from `run.json`; null when it was. The rows read in the form are then not judged. */
  formWhy: string | null;
  /** Whether the Author's connection streams, from `run.json` (`agents[].streams`). */
  streams: boolean;
  plain: (PlainReasoning & { model: string }) | null;
  /** Each arm's connection, provider and model (PlanGates-4-fix1 item 13). */
  arms: { plain: Arm; rpe: Arm };
  /** The owner's connections the floor played on, by option: Lumiverse's for plain, RPE's (by the name the trace gives) for the Author; null: the floor's own (N-15). */
  option: { plain: string; rpe: string } | null;
  /** `limits.previousRun` as the run gave it: how long a next message waits for the run before it, in seconds. */
  previousRun: number | null;
  /** The floor's book as the fixture made it, so the lore row says which designed entries were not played; null when no book was found. */
  book: BookDesign | null;
  /** The floor's own reasons for a trial, found before the first pair (PlanGates-4-fix1 item 4). */
  trials: string[];
  /** Why the floor stopped before its last pair; null when it played them all. */
  stopped: string | null;
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
  /** How many turns its figure stands on. */
  stands: string;
  /** Why it is not judged; empty when it is judged or reported. */
  why: string[];
  /** The rule applied, and turns named for the lead. */
  notes: string[];
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

const s = (ms: number | null): string => (ms === null ? "—" : ms === Number.POSITIVE_INFINITY ? `longer than ${LIMITS.runEnd / 60_000} min` : `${(ms / 1000).toFixed(2)} s`);
const msText = (ms: number | null): string => (ms === null ? "—" : `${ms.toFixed(1)} ms`);
const known = (list: readonly (number | null)[]): number[] => list.filter((v): v is number => v !== null);
export const label = (t: FloorTurn): string => `pair ${t.pair} ${t.arm === "plain" ? "plain" : "RPE"}${t.rpe ? ` (turn ${t.rpe.turn})` : ""}`;
const isString = (w: string | null): w is string => w !== null;

/** The words for a turn where no intent record began (the lead's ruling on finding 17). */
export const NO_RECORD = "no intent record began; nothing taken off";

/** The intent record's own time of an RPE turn, exactly `timings.intent`'s length (zero where no record began); or why it is not measured. */
export function intentOwn(turn: FloorTurn): { ms: number; began: boolean } | { none: string } {
  if (turn.rpe === null) return { none: "no RPE turn was matched to it" };
  if (turn.rpe.record === "not served") return { none: "the turn route gives no timings.intent (PlanTurn-3 item 4)" };
  const intent = turn.rpe.record.intent;
  if (intent === null) return { ms: 0, began: false };
  const ms = spanMs(intent);
  return ms === null ? { none: "its intent record began and did not end" } : { ms, began: true };
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

/**
 * Why the comparison rows cannot be judged on this run's connections, models and effort: one model on
 * both arms and the same thinking effort (R-92), and, given the owner's connections by option, both arms
 * on them (PlanGates-4-fix1 item 13); null when they hold.
 */
export function effortRefusal(run: FloorRun): string | null {
  const starts = run.turns.flatMap((t) => (t.rpe ? [leadStart(t.rpe.trace)] : []));
  if (starts.length === 0) return "no RPE turn says what the Author ran at";
  if (starts.some((st) => st === null)) return "an RPE turn's trace has no agent_started for its lead";
  const efforts = new Set(starts.map((st) => st?.effort ?? "not said"));
  const models = new Set(starts.map((st) => st?.model ?? ""));
  const connections = new Set(starts.map((st) => st?.connection ?? ""));
  if (efforts.size > 1) return `the Author ran at more than one effort (${[...efforts].join(", ")})`;
  if (models.size > 1) return `the Author ran on more than one model (${[...models].join(", ")})`;
  const effort = [...efforts][0] as string;
  const model = [...models][0] as string;
  if (run.option !== null && (connections.size > 1 || !connections.has(run.option.rpe))) return `the Author ran on ${[...connections].join(", ")}, not on the owner's connection the option names (${run.option.rpe})`;
  if (run.option !== null && run.arms.plain.connection !== run.option.plain) return `plain generation ran on ${run.arms.plain.connection}, not on the owner's connection the option names (${run.option.plain})`;
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

/** Why a turn is not measured for a row (a read the row needs is missing), or null when it is. */
type Need = (t: FloorTurn) => string | null;

/** The pairs measured for a row, of the ten, and each pair not measured with its cause. */
export interface PairCount {
  measured: number[];
  faults: string[];
}

export function countPairs(run: FloorRun, need: { plain: Need; rpe: Need }): PairCount {
  const measured: number[] = [];
  const faults: string[] = [];
  for (let pair = 1; pair <= PASS.pairs; pair++) {
    const causes: string[] = [];
    for (const arm of ["plain", "rpe"] as const) {
      const t = run.turns.find((x) => x.pair === pair && x.arm === arm);
      const cause = t === undefined ? `not played${run.stopped === null ? "" : ` (${run.stopped})`}` : t.error !== null ? t.error : need[arm](t);
      if (cause !== null) causes.push(`${arm === "plain" ? "plain" : "RPE"}: ${cause}`);
    }
    if (causes.length === 0) measured.push(pair);
    else faults.push(`pair ${pair}: ${causes.join("; ")}`);
  }
  return { measured, faults };
}

/** A timing row's reason for not being judged: fewer than ten pairs measured, each named; null when all ten were. */
export function pairsWhy(count: PairCount): string | null {
  return count.measured.length < PASS.pairs ? `${count.measured.length} of ${PASS.pairs} pairs measured; ${count.faults.join("; ")}` : null;
}

const inPairs = (run: FloorRun, arm: "plain" | "rpe", pairs: readonly number[]): FloorTurn[] => run.turns.filter((t) => t.arm === arm && pairs.includes(t.pair) && t.error === null);

/** The release forms the RPE turns were released in, against the run's form: a turn released in another form is named. */
function formFaults(run: FloorRun): string[] {
  const want = run.form === "tag" ? "tags" : "message";
  return run.turns.flatMap((t) => {
    const release = t.rpe ? releaseOf(t.rpe.trace) : null;
    return release !== null && release.form !== want ? [`${label(t)} was released as "${release.form}", while run.json gives the Author's form as ${run.form}`] : [];
  });
}

/** Whether a two-step turn streamed: its first word left RPE before its release (PlanGates-4-fix1 item 5). */
export function streamedTurn(t: FloorTurn): boolean {
  const timings = t.rpe?.timings;
  return timings !== undefined && timings.firstWord !== null && timings.released !== null && timings.firstWord < timings.released;
}

/** Why a two-step run's first words are not judged because RPE's reply streamed: from `run.json` and from each turn. */
export function streamedWhy(run: FloorRun): string | null {
  if (run.form !== "two-step") return null;
  const turns = run.turns.filter(streamedTurn).map((t) => `pair ${t.pair}`);
  if (!run.streams && turns.length === 0) return null;
  const from = [run.streams ? "run.json says the Author's connection streams (agents[].streams)" : null, turns.length > 0 ? `the first word left RPE before the release on ${turns.join(", ")}` : null].filter(isString);
  return `streamed: ${from.join("; ")}`;
}

function firstWordsRow(run: FloorRun, refusal: string | null): Row {
  const twoStep = run.form === "two-step";
  // Two-step: to the moment the message ended and was shown whole; tag: to the first word.
  const rpeEnd = (t: FloorTurn) => (t.page === null ? null : twoStep ? t.page.ended : t.page.firstWord);
  const plainEnd = (t: FloorTurn) => (t.page === null ? null : twoStep ? t.page.lastWord : t.page.firstWord);
  const count = countPairs(run, {
    plain: (t) => (t.page === null ? "the page timed nothing" : plainEnd(t) === null ? `the page never showed its ${twoStep ? "last" : "first"} word` : null),
    rpe: (t) => {
      if (t.page === null) return "the page timed nothing";
      if (rpeEnd(t) === null) return `the page never showed ${twoStep ? "its message ended" : "its first word"}`;
      const own = intentOwn(t);
      return "none" in own ? own.none : null;
    },
  });
  const rpe = inPairs(run, "rpe", count.measured);
  const plain = inPairs(run, "plain", count.measured);
  const adjusted: number[] = [];
  const unadjusted: number[] = [];
  const own: number[] = [];
  const noRecord: string[] = [];
  const streamedFigures: number[] = [];
  for (const t of rpe) {
    const end = rpeEnd(t);
    const intent = intentOwn(t);
    if (end === null || t.page === null || "none" in intent) continue;
    unadjusted.push(end - t.page.sent);
    adjusted.push(end - t.page.sent - intent.ms);
    if (intent.began) own.push(intent.ms);
    else noRecord.push(`pair ${t.pair}`);
    if (t.page.firstWord !== null && streamedTurn(t)) streamedFigures.push(t.page.firstWord - t.page.sent - intent.ms);
  }
  const plainTimes = known(plain.map((t) => (t.page === null || plainEnd(t) === null ? null : (plainEnd(t) as number) - t.page.sent)));
  const rpeMedian = median(adjusted);
  const plainMedian = median(plainTimes);
  const over = rpeMedian === null || plainMedian === null ? null : rpeMedian - plainMedian;
  const thinkingRpe = rpe.map(rpeThinking);
  const notKnown = thinkingRpe.filter((v) => v === "not known").length;
  const thinkingText = `Thinking: RPE ${s(median(thinkingRpe.filter((v): v is number => typeof v === "number")))}${notKnown > 0 ? ` (${notKnown} turn(s) not known: a call's thinking began and did not end)` : ""}, plain ${s(median(known(plain.map(plainThinking))))}. The intent record's own time: ${s(median(own))}, over the ${own.length} turn(s) that had one`;
  const streamed = streamedWhy(run);
  let measured = `RPE ${s(rpeMedian)} (to the page without taking the record off: ${s(median(unadjusted))}); plain ${s(plainMedian)}; RPE less plain ${s(over)}. ${thinkingText}`;
  if (streamed !== null) measured += `. RPE's first streamed word less the record: ${s(median(streamedFigures))}, reported, not judged`;
  const why = [run.formWhy, streamed, refusal, pairsWhy(count), ...formFaults(run)].filter(isString);
  return {
    id: "first-words",
    measure: "First words on screen",
    pass: `RPE's median, less the intent record's own time, at most ${PASS.firstWordsOverMs / 1000} s over plain's, same model, same thinking effort`,
    measured,
    verdict: why.length > 0 || over === null ? "not judged" : over <= PASS.firstWordsOverMs ? "pass" : "fail",
    stands: `${adjusted.length} RPE turn(s) and ${plainTimes.length} plain turn(s), of ${count.measured.length} pair(s) measured`,
    why: why.length === 0 && over === null ? ["no figure on one arm"] : why,
    notes: [twoStep ? "two-step form: Send to the moment the reply's message ended and was shown whole, less exactly timings.intent, against plain's Send to its last word" : "tag form: Send to the reply's first word on the page, less exactly timings.intent, against plain's Send to its first word", ...(noRecord.length > 0 ? [`${NO_RECORD}: ${noRecord.join(", ")}`] : [])],
  };
}

/** A turn whose intent record's own time on the turn route and in the trace differ by more than the page's resolution; `trace` "trace incomplete" where the live socket missed pieces, null where the trace cannot say. */
export interface CrossCheck {
  turn: string;
  route: number;
  trace: number | "trace incomplete" | null;
  resolution: number;
}

/** The intent record's own time against the trace's measure of it, turn by turn, for the lead (PlanGates-4 item 3; PlanGates-4-fix1 item 11). */
export function intentCrossCheck(run: FloorRun): CrossCheck[] {
  return run.turns.flatMap((t): CrossCheck[] => {
    if (t.rpe === null || t.page === null) return [];
    const own = intentOwn(t);
    if (!("ms" in own) || !own.began) return [];
    if (run.form === "tag" && t.rpe.deltasMissed) return [{ turn: label(t), route: own.ms, trace: "trace incomplete", resolution: t.page.resolution }];
    const trace = traceIntentMs(run.form, t.rpe.trace, t.rpe.deltas, t.rpe.turn);
    return trace === null || Math.abs(trace - own.ms) > t.page.resolution ? [{ turn: label(t), route: own.ms, trace, resolution: t.page.resolution }] : [];
  });
}

/** One turn's time per output token on the page: first word to last word over the shown reply's tokens less one. */
export function pagePerToken(t: FloorTurn): number | null {
  const p = t.page;
  if (p === null || t.visible === null || t.visible < 2 || p.firstWord === null || p.lastWord === null) return null;
  return (p.lastWord - p.firstWord) / (t.visible - 1);
}

/** Why a turn has no time per token on the page, or null when it has one. */
function pageTokenNeed(t: FloorTurn): string | null {
  if (t.page === null) return "the page timed nothing";
  if (t.page.firstWord === null || t.page.lastWord === null) return "the page never showed its first and last word";
  if (t.visible === null) return t.visibleWhy ?? "Lumiverse gave no count of its shown text";
  if (t.visible < 2) return `its shown text is ${t.visible} token(s), too few to time between words`;
  return null;
}

/** The reply call's own time per output token from RPE's live socket: its first streamed piece to its last, over the shown reply's tokens less one. */
export function replyCallPerToken(t: FloorTurn): number | null {
  if (t.rpe === null || t.rpe.deltasMissed || t.visible === null || t.visible < 2) return null;
  const release = releaseOf(t.rpe.trace);
  const call = replyCall(callsOf(t.rpe.trace), release);
  if (call === null) return null;
  const pieces = t.rpe.deltas.filter((d) => d.run === t.rpe?.turn && d.agent === call.agent && d.call === call.call && (d.text ?? "") !== "");
  const first = pieces[0];
  const last = pieces.at(-1);
  return first === undefined || last === undefined ? null : (last.at - first.at) / (t.visible - 1);
}

function replyCallNeed(t: FloorTurn): string | null {
  if (t.rpe === null) return "no RPE turn was matched to it";
  if (t.rpe.deltasMissed) return "RPE's live socket missed pieces of the turn";
  if (t.visible === null) return t.visibleWhy ?? "Lumiverse gave no count of its shown text";
  return replyCallPerToken(t) === null ? "the reply call's streamed pieces were not heard" : null;
}

function perTokenRow(run: FloorRun, refusal: string | null): Row {
  const twoStep = run.form === "two-step";
  const count = countPairs(run, { plain: pageTokenNeed, rpe: twoStep ? replyCallNeed : pageTokenNeed });
  const plainFigures = known(inPairs(run, "plain", count.measured).map(pagePerToken));
  const rpeFigures = known(inPairs(run, "rpe", count.measured).map(twoStep ? replyCallPerToken : pagePerToken));
  const plain = median(plainFigures);
  const rpe = median(rpeFigures);
  const stands = `${rpeFigures.length} RPE turn(s) and ${plainFigures.length} plain turn(s), of ${count.measured.length} pair(s) measured`;
  const counted = "both arms' shown reply counted by Lumiverse's own tokenizer for the model both ran on, never a provider's completion count (it holds plain's reasoning) nor the count RPE reports (RPH's turn budget)";
  if (twoStep) {
    const why = [run.formWhy, pairsWhy(count), rpe === null || plain === null ? "no figure on one arm" : null].filter(isString);
    return {
      id: "per-token",
      measure: "Time per output token",
      pass: "two-step form: reported, not gated (l.1773)",
      measured: `RPE's reply call ${msText(rpe)} per token (its streamed pieces on RPE's live socket over the shown reply's tokens less one), plain ${msText(plain)} per token on the page`,
      verdict: why.length > 0 ? "not judged" : "reported",
      stands,
      why,
      notes: ["which call wrote the reply is read from the released event", counted],
    };
  }
  const over = rpe === null || plain === null ? null : rpe / plain - 1;
  const why = [run.formWhy, refusal, pairsWhy(count), ...formFaults(run), over === null ? "no figure on one arm" : null].filter(isString);
  return {
    id: "per-token",
    measure: "Time per output token",
    pass: `RPE's median at most ${PASS.perTokenOver * 100}% over plain's`,
    measured: `RPE ${msText(rpe)}, plain ${msText(plain)} per token${over === null ? "" : `; ${Math.abs(over * 100).toFixed(1)}% ${over > 0 ? "over" : "under"} plain`}`,
    verdict: why.length > 0 || over === null ? "not judged" : over <= PASS.perTokenOver ? "pass" : "fail",
    stands,
    why,
    notes: [`tag form: first word to last word on the page over the shown reply's tokens less one; ${counted}`],
  };
}

/** Each RPE turn's calls on the reply's path, or why it has none: a failed turn is a miss. */
export function pathCalls(run: FloorRun, t: FloorTurn): { calls: number } | { none: string } {
  if (t.rpe === null) return { none: t.error ?? "no RPE turn was matched to it" };
  const moment = run.form === "tag" ? t.rpe.timings.firstWord : t.rpe.timings.released;
  if (moment === null) return { none: run.form === "tag" ? "no piece of the reply left RPE" : "the reply was never released" };
  return { calls: callsBefore(callsOf(t.rpe.trace), moment) };
}

function callsRow(run: FloorRun): Row {
  const want = PASS.calls[run.form];
  const rpe = run.turns.filter((t) => t.arm === "rpe" && t.pair <= PASS.pairs);
  const counted = rpe.map((t) => pathCalls(run, t));
  const hits = counted.filter((c) => "calls" in c && c.calls === want).length;
  const played = counted.length;
  const faults = formFaults(run);
  const why = [run.formWhy, played < PASS.share.of ? `the share is judged on ${PASS.share.of} turns; ${played} RPE turn(s) were played${run.stopped === null ? "" : ` (${run.stopped})`}` : null, ...faults].filter(isString);
  return {
    id: "calls",
    measure: "Model calls on the reply's path",
    pass: `exactly ${want} in at least ${PASS.share.hits} of ${PASS.share.of}`,
    measured: `exactly ${want} in ${hits} of ${played} (${counted.map((c) => ("calls" in c ? String(c.calls) : "miss")).join(", ")})`,
    verdict: why.length > 0 ? "not judged" : hits * PASS.share.of >= PASS.share.hits * played ? "pass" : "fail",
    stands: `${played} RPE turn(s), every one counted, a failed turn as a miss`,
    why,
    notes: [`${run.form} form: calls begun by any agent before the reply's ${run.form === "tag" ? "first piece left RPE (timings.firstWord)" : "release (timings.released)"}, as the trace holds them`, ...counted.flatMap((c, i) => ("none" in c ? [`${label(rpe[i] as FloorTurn)}: a miss: ${c.none}`] : []))],
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

/** RPE turns whose trace was never read, named: their calls are not known. */
function unread(run: FloorRun): string[] {
  return run.turns.filter((t) => t.arm === "rpe" && t.rpe === null).map((t) => `${label(t)}: ${t.error ?? "no RPE turn was matched to it"}`);
}

function toolsRow(run: FloorRun): Row {
  const calls = authorCalls(run);
  const unknown = calls.filter((c) => c.call.toolTokens === null);
  const largest = calls.reduce<{ tokens: number; at: string } | null>((best, c) => (c.call.toolTokens !== null && (best === null || c.call.toolTokens > best.tokens) ? { tokens: c.call.toolTokens, at: `${label(c.turn)} call ${c.call.call}` } : best), null);
  const tools = Math.max(0, ...calls.map((c) => c.call.tools));
  const names = [...new Set(run.turns.flatMap((t) => t.rpe?.request?.tools ?? []))];
  const notRead = unread(run);
  const why = [calls.length === 0 ? "no call of the Author was recorded" : null, unknown.length > 0 ? `${unknown.length} call(s) of the Author carry no toolTokens (records made before RPH gave them)` : null, notRead.length > 0 ? `the calls of RPE turns whose trace was not read are not known: ${notRead.join("; ")}` : null].filter(isString);
  return {
    id: "tools",
    measure: "The Author's tools",
    pass: `under ${PASS.toolTokens.toLocaleString("en")} tokens, on every call of the Author`,
    measured: `the largest ${largest === null ? "—" : `${largest.tokens.toLocaleString("en")} tokens (${largest.at})`}, by RPH's own estimate; up to ${tools} tools on a call${names.length > 0 ? `: ${names.join(", ")}` : ""}`,
    verdict: why.length > 0 || largest === null ? "not judged" : largest.tokens < PASS.toolTokens ? "pass" : "fail",
    stands: `${calls.length} call(s) of the Author over ${run.turns.filter((t) => t.rpe !== null).length} RPE turn(s) read`,
    why,
    notes: [],
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
    measured: low === null || high === null ? "—" : `${low === high ? low.toLocaleString("en") : `${low.toLocaleString("en")} to ${high.toLocaleString("en")}`} tokens in the Author's opening block on its first call, by RPH's own estimate`,
    verdict: low === null ? "not judged" : "reported",
    stands: `${sizes.length} first call(s) of the Author`,
    why: low === null ? ["no first call of the Author carries openingTokens"] : [],
    notes: ["call_started.openingTokens of the Author's first call; the Files page's stack view of the same chat is saved as a screen beside it"],
  };
}

/** The run after the reply in numbers: each RPE run's release to its end, a run still going at the floor's limit as longer than it; how long a next message sent at the release would have waited, up to `limits.previousRun`. */
export function afterReply(run: FloorRun): { spans: number[]; median: number | null; longest: number | null; waited: { median: number | null; longest: number | null }; running: string[]; unknown: string[] } {
  const spans: number[] = [];
  const running: string[] = [];
  const unknown: string[] = [];
  for (const t of run.turns) {
    if (t.arm !== "rpe") continue;
    const timings = t.rpe?.timings;
    if (t.rpe?.status === "running") {
      spans.push(Number.POSITIVE_INFINITY);
      running.push(`pair ${t.pair}`);
    } else if (timings !== undefined && timings.released !== null && timings.ended !== null) spans.push(timings.ended - timings.released);
    else unknown.push(`${label(t)}: ${t.error ?? (timings === undefined ? "no RPE turn was matched to it" : timings.released === null ? "the reply was never released" : "its run has no end")}`);
  }
  const limit = run.previousRun === null ? null : run.previousRun * 1000;
  const waits = spans.map((span) => (limit === null ? span : Math.min(span, limit)));
  const longest = (list: number[]) => (list.length === 0 ? null : Math.max(...list));
  return { spans, median: median(spans), longest: longest(spans), waited: { median: median(waits), longest: longest(waits) }, running, unknown };
}

function afterRow(run: FloorRun): Row {
  const a = afterReply(run);
  const limit = run.previousRun;
  const why = [a.spans.length === 0 ? "no RPE turn's run ended after a release" : null, a.unknown.length > 0 ? `RPE turns whose run after the reply is not known: ${a.unknown.join("; ")}` : null].filter(isString);
  return {
    id: "after-reply",
    measure: "The run after the reply",
    pass: "its time reported on its own, with how long a next message would have waited",
    measured: `median ${s(a.median)}, longest ${s(a.longest)}; a next message sent at the release would have waited ${s(a.waited.median)} (median), ${s(a.waited.longest)} (longest)${limit === null ? "" : `, ${limit} s at most (limits.previousRun), after which that run is stopped`}${a.running.length > 0 ? `; still going at the floor's limit of ${LIMITS.runEnd / 60_000} min: ${a.running.join(", ")}` : ""}`,
    verdict: why.length > 0 ? "not judged" : "reported",
    stands: `${a.spans.length} RPE run(s)`,
    why,
    notes: ["timings.released to timings.ended"],
  };
}

/** Intake in numbers: each RPE turn's request reaching RPE to its run starting. */
export function intakeSpans(run: FloorRun): number[] {
  return known(run.turns.map((t) => (t.arm !== "rpe" || t.rpe === null || t.rpe.timings.started === null ? null : t.rpe.timings.started - t.rpe.timings.received)));
}

function intakeRow(run: FloorRun): Row {
  const spans = intakeSpans(run);
  return {
    id: "intake",
    measure: "Intake",
    pass: "median ≤ 150 ms on a 10,000-message chat (PlanGates-5 judges it there)",
    measured: `${s(median(spans))} on the floor's chat, from the request reaching RPE to its run starting`,
    verdict: spans.length === 0 ? "not judged" : "reported",
    stands: `${spans.length} RPE turn(s)`,
    why: spans.length === 0 ? ["no RPE turn gives both timings.received and timings.started"] : [],
    notes: ["timings.received to timings.started; the gate is on the long chat"],
  };
}

/** The rows this file measures from the turns' times, calls and tokens, by id: every row but what the model was sent and the activated lore. */
export function measuredRows(run: FloorRun): Record<"first-words" | "per-token" | "calls" | "intake" | "tools" | "stack" | "after-reply", Row> {
  const refusal = effortRefusal(run);
  return { "first-words": firstWordsRow(run, refusal), "per-token": perTokenRow(run, refusal), calls: callsRow(run), intake: intakeRow(run), tools: toolsRow(run), stack: stackRow(run), "after-reply": afterRow(run) };
}

/** Why an RPE turn has no verdict for a row needing these reads: the turn failed, or one of the reads is missing. */
function readWhy(t: FloorTurn, reads: readonly RpeRead[]): string | null {
  if (t.rpe === null) return t.error ?? "no RPE turn was matched to it";
  const missing = reads.flatMap((r) => (t.rpe?.missing[r] === undefined ? [] : [t.rpe.missing[r] as string]));
  return missing.length > 0 ? missing.join("; ") : null;
}

function sentRow(run: FloorRun): Row {
  const rpe = run.turns.filter((t) => t.arm === "rpe");
  const turns = rpe.map((t) => {
    const why = readWhy(t, ["request", "stored"]) ?? (t.rpe?.request && t.rpe.stored ? null : "the kept request or the stored prompt is missing");
    const side = t.rpe;
    return { turn: label(t), why, verdict: why === null && side?.request && side.stored ? compareSent({ request: side.request.messages, stored: side.stored, rows: side.rows ?? undefined, keep: side.history.keep, step: side.history.step, hold: side.history.hold, framing: side.history.framing, framingNote: side.history.framingNote }) : null };
  });
  const folded = sentFold(turns);
  const framingWhy = [...new Set(rpe.flatMap((t) => (t.rpe?.history.framingWhy ? [t.rpe.history.framingWhy] : [])))];
  const notJudged = folded.verdict === "not judged";
  return {
    id: "sent",
    measure: "What the model was sent",
    pass: "for every RPE turn, the Author's first request holds every message Lumiverse sent that the window kept, in the same order with the same roles, right after the opening block",
    measured: folded.measured,
    verdict: folded.verdict,
    stands: `${turns.filter((t) => t.verdict !== null).length} of ${rpe.length} RPE turn(s) compared`,
    why: notJudged ? (folded.why.length > 0 ? folded.why : ["a turn was not compared"]) : [],
    notes: [...folded.notes, ...framingWhy.map((w) => `the framing line: ${w}`)],
  };
}

function loreRow(run: FloorRun): Row {
  const rpe = run.turns.filter((t) => t.arm === "rpe");
  const turns = rpe.map((t) => {
    const why = readWhy(t, ["lore"]) ?? (t.socket.lore === null ? "Lumiverse's socket told no WORLD_INFO_ACTIVATED for the generation" : null);
    const side = t.rpe;
    return { turn: label(t), line: 2 * t.pair, verdict: why === null && side?.lore.entries && t.socket.lore ? compareLore({ lumiverse: t.socket.lore, map: side.lore.map, entries: side.lore.entries }) : null, why };
  });
  const folded = loreFold(turns, run.book ?? undefined);
  return {
    id: "lore",
    measure: "Activated lore",
    pass: "for every RPE turn, every entry Lumiverse activated appears in the lore map",
    measured: folded.measured,
    verdict: folded.verdict,
    stands: `${turns.filter((t) => t.verdict !== null).length} of ${rpe.length} RPE turn(s) compared`,
    why: folded.verdict === "not judged" ? (folded.why.length > 0 ? folded.why : ["a turn was not compared"]) : [],
    notes: folded.notes,
  };
}

/** §17.1's table for a run, rows in the plan's order. */
export function floorTable(run: FloorRun): Row[] {
  const rows = measuredRows(run);
  return [rows["first-words"], rows["per-token"], rows.calls, sentRow(run), loreRow(run), rows.intake, rows.tools, rows.stack, rows["after-reply"]];
}

/** The lines the table starts with after the run's standing: the floor's own trials, a stop, and each arm's connection. */
export function floorHead(run: FloorRun): string[] {
  const arm = (a: Arm) => `${a.provider ?? "provider not known"} / ${a.model ?? "model not known"} (connection ${a.connection})`;
  return [
    ...(run.trials.length > 0 ? [`TRIAL: no verdict. ${run.trials.join("; ")}.`] : []),
    ...(run.stopped === null ? [] : [`STOPPED: ${run.stopped}.`]),
    `Played on ${run.option === null ? "the floor's own connections (N-15)" : "the owner's connections, by option"}: plain ${arm(run.arms.plain)}; RPE ${arm(run.arms.rpe)}, the Author's model by its trace.`,
  ];
}

/** The table in words, after the run's standing; a trial prints its figures and no verdict. */
export function tableText(rows: readonly Row[], head: readonly string[], trial: boolean, crossCheck: readonly CrossCheck[]): string {
  const out = ["§17.1 The floor test", ...head];
  for (const r of rows) {
    out.push("", `${r.measure}: ${trial ? "no verdict (trial)" : r.verdict.toUpperCase()}`, `  pass:      ${r.pass}`, `  measured:  ${r.measured}`, `  stands on: ${r.stands}`);
    if (!trial) for (const why of r.why) out.push(`  not judged: ${why}`);
    for (const note of r.notes) out.push(`  note:      ${note}`);
  }
  if (crossCheck.length > 0) {
    out.push("", "For the lead: turns whose intent record time on the turn route and in the trace differ by more than the page's resolution, or whose trace is incomplete");
    for (const c of crossCheck) out.push(`  ${c.turn}: route ${s(c.route)}, trace ${typeof c.trace === "number" ? s(c.trace) : (c.trace ?? "—")}, resolution ${c.resolution} ms`);
  }
  return `${out.join("\n")}\n`;
}
