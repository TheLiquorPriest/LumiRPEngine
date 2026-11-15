// Row 0.2's live counters (STANDALONE-PLAN §18.1 row 0.2 l.1920; PlanGates-24), pure: what RPE's trace of a
// turn says of the floor model's reply form, of the Author's tool calls under a preset's sampling, and of
// eight agents run at once. A script plays the turns and reads each trace; this file counts. Nothing here
// reads a route or a socket, so a recorded turn gives the same count again.
//
// The tags (item 1), thirty turns on the floor chat: a turn is KEPT when its first message held the intent
// record in its tag at its head and the reply in its tag, closed, with nothing leaked, before any reminder
// added a call (the first build's definition, RPHarness `spikes/live/REPORT.md` §1.1, now read from RPE's
// trace). The names of the tags are the reply contract's (`.prompts/reply-contract.md`, "set here and
// nowhere else"): `tagsOf` reads them from its header, and nothing here writes one. Pass: 28 of 30; below,
// the connection works the two-step way (§10.7) and, the floor model being this one, the owner is told at
// G0 (§17.1 l.1773).
//
// The two-step form (item 2), the same thirty lines: a turn is kept when the intent record was written
// first (the first tool call of the lead is `file_write` of the intent file), the reply was the plain text
// of a message of its own shown when the message ended, and no working text was shown; calls per turn are
// counted against exactly 2 (R-96).
//
// The Author's call under a preset's sampling (item 3): per turn, the tool calls made, each parsed and run
// without error, and no tool-call text leaked into the reply. The preset arm's calls survive when it makes
// them as cleanly as the own arm; if not, the Author keeps its own sampling (§22 l.2136).
//
// Eight agents at once (item 5): every event and every streamed piece carries its run, agent and call and
// none is filed under another; all eight finish and their transcripts are whole. What marks a piece as
// another agent's is read from the trace alone (a piece or a tool's end whose run, agent and call no model
// call or tool start of that run, agent and call began), and, where the run gives each agent a marker its
// own pieces hold, from that.

import type { TraceDelta, TraceRecord } from "rp-harness/contract";
import { callsOf, leadOf, releaseOf, writesIntent } from "./turn";

/** Row 0.2's pass for the tags: at least this many of this many turns kept (the plan's own). */
export const TAGS_PASS = { hits: 28, of: 30 } as const;

/** The turns of each arm of the sampling check (proposed: the owner changes it in the gate's option). */
export const SAMPLING_TURNS = 10;

/** The frontmatter of a text, parsed as RPH reads a file's header: between two `---` lines at the top, by Bun's own parser. Null where there is none or it does not parse. */
export function frontMatter(text: string): Record<string, unknown> | null {
  const lines = (text.startsWith("\uFEFF") ? text.slice(1) : text).replace(/\r\n?/g, "\n").split("\n");
  if (!/^---[ \t]*$/.test(lines[0] ?? "")) return null;
  const end = lines.findIndex((line, i) => i > 0 && /^---[ \t]*$/.test(line));
  if (end === -1) return null;
  try {
    const parsed: unknown = Bun.YAML.parse(lines.slice(1, end).join("\n"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The names of the reply's tags and the intent record's file, as the reply contract's header sets them. */
export interface ReplyTags {
  reply: string;
  intent: string;
  intentFile: string;
}

/** The reply contract's tags (`tags.reply`, `tags.intent`) and `intent_file`, or why its header gives none: never a default. */
export function tagsOf(contract: string): ReplyTags | { none: string } {
  const header = frontMatter(contract);
  if (header === null) return { none: "the reply contract has no header that parses" };
  const tags = header.tags;
  const name = (value: unknown): string | null => (typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value) ? value : null);
  const reply = typeof tags === "object" && tags !== null ? name((tags as Record<string, unknown>).reply) : null;
  const intent = typeof tags === "object" && tags !== null ? name((tags as Record<string, unknown>).intent) : null;
  const file = typeof header.intent_file === "string" && header.intent_file.trim() !== "" ? header.intent_file.trim() : null;
  if (reply === null || intent === null) return { none: "the reply contract's header names no tags.reply and tags.intent" };
  if (file === null) return { none: "the reply contract's header names no intent_file" };
  return { reply, intent, intentFile: file };
}

/** The lead's first message of a turn: its first run's call 1, whole as the trace holds it. */
export interface FirstMessage {
  run: string;
  text: string;
  toolCalls: number;
}

export function firstMessage(trace: readonly TraceRecord[]): FirstMessage | null {
  const lead = leadOf(trace);
  if (lead === null) return null;
  const ended = trace.find((r) => r.event.kind === "call_ended" && r.agent.id === lead.id && r.event.call === 1);
  return ended?.event.kind === "call_ended" ? { run: ended.run, text: ended.event.text, toolCalls: ended.event.toolCalls.length } : null;
}

/** What came of a turn's first message in the tag form, one word each. */
export type TagsOutcome = "kept" | "no-first-message" | "tool-calls-first" | "no-intent-tag" | "intent-unclosed" | "no-reply-tag" | "reply-unclosed" | "leaked" | "reminded";

export const TAGS_WORDS: Readonly<Record<TagsOutcome, string>> = {
  kept: "kept: the intent record in its tag at the head of the first message, the reply in its tag, closed, nothing leaked, no reminder before it",
  "no-first-message": "the Author's first message is not in the trace",
  "tool-calls-first": "the first message was tool calls with no text",
  "no-intent-tag": "the first message did not open with the intent record's tag",
  "intent-unclosed": "the intent record's tag was never closed",
  "no-reply-tag": "the first message held no reply tag after the intent record",
  "reply-unclosed": "the reply's tag was never closed in the first message",
  leaked: "text outside the tags, or a tag inside the reply, leaked",
  reminded: "a reminder added a call before the reply was released",
};

/** One turn's outcome in the tag form, from RPE's trace. */
export function tagsTurn(trace: readonly TraceRecord[], tags: ReplyTags): TagsOutcome {
  const first = firstMessage(trace);
  if (first === null) return "no-first-message";
  const head = first.text.trimStart();
  if (head === "") return first.toolCalls > 0 ? "tool-calls-first" : "no-first-message";
  const open = (tag: string) => `<${tag}>`;
  const close = (tag: string) => `</${tag}>`;
  if (!head.startsWith(open(tags.intent))) return "no-intent-tag";
  const intentEnd = head.indexOf(close(tags.intent));
  if (intentEnd === -1) return "intent-unclosed";
  const rest = head.slice(intentEnd + close(tags.intent).length);
  const replyStart = rest.indexOf(open(tags.reply));
  if (replyStart === -1) return "no-reply-tag";
  const afterOpen = rest.slice(replyStart + open(tags.reply).length);
  const replyEnd = afterOpen.indexOf(close(tags.reply));
  if (replyEnd === -1) return "reply-unclosed";
  const between = rest.slice(0, replyStart).trim();
  const body = afterOpen.slice(0, replyEnd);
  const tail = afterOpen.slice(replyEnd + close(tags.reply).length).trim();
  if (between !== "" || tail !== "" || [tags.intent, tags.reply].some((tag) => body.includes(open(tag)) || body.includes(close(tag)))) return "leaked";
  // A reminder adds a call: the lead's second call began before the reply was released.
  const lead = leadOf(trace);
  const release = releaseOf(trace);
  const second = callsOf(trace).find((c) => c.agent === lead?.id && c.run === first.run && c.call === 2);
  if (second !== undefined && (release === null || second.startedAt < release.at)) return "reminded";
  return "kept";
}

/** What came of a turn in the two-step form, one word each. */
export type TwoStepOutcome = "kept" | "no-reply" | "intent-not-first" | "reply-not-a-message" | "working-text-shown";

export const TWO_STEP_WORDS: Readonly<Record<TwoStepOutcome, string>> = {
  kept: "kept: the intent record written first, the reply the plain text of a message of its own, no working text shown",
  "no-reply": "the Author's reply was never released",
  "intent-not-first": "the intent record was not the first tool call written",
  "reply-not-a-message": "the reply was not the plain text of a message of its own",
  "working-text-shown": "working text was shown in a message, or leaked into the reply",
};

/** One turn in the two-step form: its outcome, and the lead's calls begun before the reply's release (null with none). */
export function twoStepTurn(trace: readonly TraceRecord[], tags: ReplyTags): { outcome: TwoStepOutcome; calls: number | null } {
  const lead = leadOf(trace);
  const release = releaseOf(trace);
  if (lead === null || release === null || release.by !== lead.id) return { outcome: "no-reply", calls: null };
  const calls = callsOf(trace).filter((c) => c.agent === lead.id && c.run === release.run && c.startedAt <= release.at);
  const counted = calls.length;
  // The first tool call the lead began writing, in any call of the run: the intent file's write.
  const firstTool = trace.find((r) => r.event.kind === "tool_started" && r.agent.id === lead.id && r.run === release.run);
  const args = firstTool?.event.kind === "tool_started" ? firstTool.event.args : null;
  const path = typeof args === "object" && args !== null && !Array.isArray(args) && typeof args.path === "string" ? args.path : null;
  if (firstTool?.event.kind !== "tool_started" || !writesIntent({ name: firstTool.event.tool, path }) || (path !== null && !path.endsWith(tags.intentFile))) return { outcome: "intent-not-first", calls: counted };
  if (release.form !== "message") return { outcome: "reply-not-a-message", calls: counted };
  const replyCall = calls.at(-1);
  const texts = trace.flatMap((r) => (r.event.kind === "call_ended" && r.agent.id === lead.id && r.run === release.run ? [{ call: r.event.call, text: r.event.text }] : []));
  const working = texts.filter((t) => t.call !== replyCall?.call && t.text.trim() !== "");
  const reply = texts.find((t) => t.call === replyCall?.call)?.text ?? "";
  const tagged = [tags.intent, tags.reply].some((tag) => reply.includes(`<${tag}>`) || reply.includes(`</${tag}>`));
  if (working.length > 0 || tagged) return { outcome: "working-text-shown", calls: counted };
  return { outcome: "kept", calls: counted };
}

/** A form's thirty (or fewer) turns counted: how many were kept, by each outcome, how many could not be read, and the plan's verdict. */
export interface FormCount {
  /** The turns played, those whose trace could not be read included. */
  played: number;
  kept: number;
  by: Record<string, number>;
  /** Turns played whose trace was not read: neither kept nor missed, so a verdict that they could change is not given. */
  unread: number;
  verdict: "pass" | "fail" | "not judged";
  why: string[];
}

/**
 * The count of a form over its turns: kept against 28 of 30. Judged only on all thirty turns, or earlier
 * when the miss count already makes 28 of 30 out of reach (a form stopped once 28 could no longer be
 * reached, as the first build stopped its tag variants); fewer turns than that are not judged, with how
 * many were played. A turn whose trace could not be read (`unread`) is not kept and not a miss: the count
 * fails only when 28 are out of reach even were every unread turn kept, passes only on 28 kept, and is not
 * judged between, so a failed read of RPE never tells the owner the floor model lost its tags.
 */
export function formCount(outcomes: readonly string[], unread = 0): FormCount {
  const by: Record<string, number> = {};
  for (const o of outcomes) by[o] = (by[o] ?? 0) + 1;
  const kept = by.kept ?? 0;
  const played = outcomes.length + unread;
  const reachable = kept + unread + (TAGS_PASS.of - played);
  const why: string[] = [];
  let verdict: FormCount["verdict"];
  if (reachable < TAGS_PASS.hits) verdict = "fail";
  else if (played < TAGS_PASS.of) {
    verdict = "not judged";
    why.push(`${played} of ${TAGS_PASS.of} turns were played, and ${TAGS_PASS.hits} of ${TAGS_PASS.of} can still be reached`);
  } else if (kept >= TAGS_PASS.hits) verdict = "pass";
  else {
    verdict = "not judged";
    why.push(`${unread} turn(s) could not be read, and with them kept ${TAGS_PASS.hits} of ${TAGS_PASS.of} can still be reached`);
  }
  return { played, kept, by, unread, verdict, why };
}

/** Calls per turn against exactly `want`: how many turns made exactly that many, over the turns whose reply was released. */
export function exactCalls(calls: readonly (number | null)[], want: number): { exact: number; of: number; each: string } {
  return { exact: calls.filter((c) => c === want).length, of: calls.length, each: calls.map((c) => (c === null ? "none" : String(c))).join(", ") };
}

/** How tool-call text written as a message looks, whichever provider's markup: the lead's own words, never the reply's. Data of the check, not a prompt. */
export const TOOL_MARKUP: readonly RegExp[] = [/<\s*\/?\s*(tool_call|tool_calls|function_call|function_calls|tool_use|invoke|antml:invoke)\b/i, /<[^<>]{0,12}DSML[^<>]{0,12}>/i, /"tool_calls?"\s*:\s*\[/i, /\bfunction\s*=\s*["']?\w+["']?\s*>/i];

/** The text of the turn's reply as the trace holds it: the lead's last call's message before the release. */
export function replyText(trace: readonly TraceRecord[]): string {
  const lead = leadOf(trace);
  const release = releaseOf(trace);
  if (lead === null || release === null) return "";
  const calls = callsOf(trace).filter((c) => c.agent === lead.id && c.run === release.run && c.startedAt <= release.at);
  const last = calls.at(-1);
  const ended = trace.find((r) => r.event.kind === "call_ended" && r.agent.id === lead.id && r.run === release.run && r.event.call === last?.call);
  return ended?.event.kind === "call_ended" ? ended.event.text : "";
}

/** One turn of the sampling check: the lead's tool calls made, those that failed (named), and whether tool-call text leaked into the reply. */
export interface SamplingTurn {
  made: number;
  failed: string[];
  leaked: boolean;
  clean: boolean;
}

export function samplingTurn(trace: readonly TraceRecord[]): SamplingTurn {
  const lead = leadOf(trace);
  const started = trace.filter((r) => r.event.kind === "tool_started" && r.agent.id === lead?.id);
  const failed: string[] = [];
  for (const r of started) {
    if (r.event.kind !== "tool_started") continue;
    const ended = trace.find((e) => e.event.kind === "tool_ended" && e.event.callId === (r.event.kind === "tool_started" ? r.event.callId : "") && e.run === r.run);
    if (ended === undefined || ended.event.kind !== "tool_ended") failed.push(`${r.event.tool}: it never ran`);
    else if (ended.event.result.error === true) failed.push(`${r.event.tool}: it ended in an error`);
  }
  const text = replyText(trace);
  const leaked = TOOL_MARKUP.some((pattern) => pattern.test(text));
  return { made: started.length, failed, leaked, clean: started.length > 0 && failed.length === 0 && !leaked };
}

/** An arm of the sampling check over its turns. */
export interface SamplingArm {
  value: "own" | "preset";
  turns: number;
  withCalls: number;
  clean: number;
  failed: number;
  leaked: number;
}

export function samplingArm(value: SamplingArm["value"], turns: readonly SamplingTurn[]): SamplingArm {
  return { value, turns: turns.length, withCalls: turns.filter((t) => t.made > 0).length, clean: turns.filter((t) => t.clean).length, failed: turns.filter((t) => t.failed.length > 0).length, leaked: turns.filter((t) => t.leaked).length };
}

/**
 * Whether the Author's tool calls survive a preset's sampling: the preset arm makes them as cleanly as the
 * own arm. Not judged when an arm has no turns, or the arms played different numbers, or the own arm made
 * no clean turn (then there is nothing the preset arm is to match).
 */
export function samplingVerdict(own: SamplingArm, preset: SamplingArm): { verdict: "survive" | "do not survive" | "not judged"; why: string } {
  if (own.turns === 0 || preset.turns === 0) return { verdict: "not judged", why: "an arm has no turn" };
  if (own.turns !== preset.turns) return { verdict: "not judged", why: `the arms played ${own.turns} and ${preset.turns} turns, so their rates are not of the same count` };
  if (own.clean === 0) return { verdict: "not judged", why: "the own arm made no clean turn, so there is no clean rate for the preset arm to match" };
  const line = `own ${own.clean} of ${own.turns} turns clean (${own.failed} with a failed call, ${own.leaked} with leaked tool-call text), preset ${preset.clean} of ${preset.turns} (${preset.failed}, ${preset.leaked})`;
  return preset.clean >= own.clean ? { verdict: "survive", why: line } : { verdict: "do not survive", why: line };
}

/** One of the eight agents' runs: its transcript as kept, in order, by role. */
export interface Transcript {
  agent: string;
  run: string;
  roles: string[];
  /** pi's own placeholders in a message's text ("No result provided", "Operation aborted") that must never reach a transcript. */
  texts?: string[];
}

/** What a run of agents at once gives the crossing check: RPE's trace and live pieces, the agents it started, each one's transcript, and, where each agent's pieces hold a marker of its own, that marker. */
export interface AtOnce {
  agents: string[];
  trace: readonly TraceRecord[];
  deltas: readonly TraceDelta[];
  transcripts: readonly Transcript[];
  marker?: Readonly<Record<string, string>>;
}

export interface Crossing {
  /** Each event or piece filed under an agent, run or call it does not belong to, named. */
  crossed: string[];
  /** Each agent that did not finish, or whose transcript is not whole, named with why. */
  unfinished: string[];
  /** How many events and pieces were checked. */
  checked: { records: number; pieces: number };
}

/** pi's placeholders for work that was cut off: a whole transcript holds neither. */
const PLACEHOLDERS = ["No result provided", "Operation aborted"] as const;

/** The key a call is filed under. */
const callKey = (run: string, agent: string, call: number): string => `${run}\u0000${agent}\u0000${call}`;

/**
 * The crossing check (row 0.2, §13.3 l.1468): each model call, tool and piece belongs to the run, agent
 * and call that began it. A piece or a call's end filed under a run, agent or call no `call_started`
 * of that run, agent and call began; a tool's end filed apart from the run and agent of its start; a
 * record of an agent the run did not start; a piece that holds another agent's marker: each is crossed.
 * Each of the agents must have started, ended, and given a whole transcript.
 */
export function crossing(run: AtOnce): Crossing {
  const crossed: string[] = [];
  const known = new Set(run.agents);
  const started = new Set<string>();
  const tools = new Map<string, { run: string; agent: string }>();
  for (const r of run.trace) {
    if (r.event.kind === "call_started") started.add(callKey(r.run, r.agent.id, r.event.call));
    if (r.event.kind === "tool_started") tools.set(r.event.callId, { run: r.run, agent: r.agent.id });
  }
  let records = 0;
  for (const r of run.trace) {
    records++;
    const where = `${r.agent.id} in ${r.run} (record ${r.seq}, ${r.event.kind})`;
    if (!known.has(r.agent.id)) crossed.push(`${where}: an agent the run did not start`);
    if (r.event.kind === "call_ended" && !started.has(callKey(r.run, r.agent.id, r.event.call))) crossed.push(`${where}: call ${r.event.call} ended in a run and agent that never began it`);
    if (r.event.kind === "tool_ended") {
      const began = tools.get(r.event.callId);
      if (began === undefined) crossed.push(`${where}: tool call ${r.event.callId} ended and no run began it`);
      else if (began.run !== r.run || began.agent !== r.agent.id) crossed.push(`${where}: tool call ${r.event.callId} began in ${began.run} by ${began.agent}`);
    }
  }
  let pieces = 0;
  for (const d of run.deltas) {
    pieces++;
    const where = `piece at ${d.at} filed under ${d.agent} in ${d.run} call ${d.call}`;
    if (!started.has(callKey(d.run, d.agent, d.call))) crossed.push(`${where}: no model call of that run, agent and call began`);
    const others = Object.entries(run.marker ?? {}).filter(([agent, marker]) => agent !== d.agent && marker !== "" && `${d.text ?? ""}${d.thinking ?? ""}`.includes(marker));
    for (const [agent] of others) crossed.push(`${where}: it holds ${agent}'s marker`);
  }
  const unfinished: string[] = [];
  for (const agent of run.agents) {
    const runs = new Set(run.trace.filter((r) => r.agent.id === agent && r.event.kind === "agent_started").map((r) => r.run));
    const ended = run.trace.some((r) => r.agent.id === agent && r.event.kind === "agent_ended");
    if (runs.size === 0) unfinished.push(`${agent}: it never started`);
    else if (!ended) unfinished.push(`${agent}: it never ended`);
    const own = run.transcripts.filter((t) => t.agent === agent);
    const transcript = own[0];
    if (transcript === undefined) unfinished.push(`${agent}: no transcript was kept`);
    else if (transcript.roles.length < 2 || transcript.roles.at(-1) !== "assistant") unfinished.push(`${agent}: its transcript is not whole (${transcript.roles.length} message(s), ending on ${transcript.roles.at(-1) ?? "nothing"})`);
    else if ((transcript.texts ?? []).some((text) => PLACEHOLDERS.some((p) => text.includes(p)))) unfinished.push(`${agent}: its transcript holds a placeholder for work that was cut off`);
  }
  return { crossed, unfinished, checked: { records, pieces } };
}
