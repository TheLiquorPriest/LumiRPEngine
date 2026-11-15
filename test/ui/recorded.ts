// An invented turn, recorded as the live hub would carry it, for the UI's tests and the preview. A
// lighthouse story: the player's character, Ash, asks the keeper, Moira, why the lamp went dark. The
// Author (the lead) writes its intent record, starts two sub-agents at once (the GM, who rolls and
// rules, and the character agent playing Moira), a rule fires on the GM's roll, and the reply streams to
// the chat before the Author's closing calls. Every name, id and number here is made up.

import type { AgentRef, TraceDelta, TraceEvent, TraceRecord, Usage } from "rp-harness/contract";
import type { ChatsReply, LevelNode, LevelReflection, LiveEvent, ReplyPiece, RunShown, TurnReply, TurnRow, TurnsReply, WorldReply } from "../../src/shared/api";
import type { ValuesShown } from "../../src/ui/pages/world";

export const USER = "user-1";
export const CHAT = "chat-calder";
export const RUN = "turn-31";
/** RPH's own id for the turn's first run, and for the continue's run: each run of a turn has one, the turn is in its records' scope. */
export const RUN_FIRST = "run-31a";
export const RUN_SECOND = "run-31b";
export const SESSION = "session-4";
/** 12 Nov 2026, 20:15:00 UTC: when the Author's run began. */
export const T0 = Date.UTC(2026, 10, 12, 20, 15, 0);
/** The request reached RPE this long before the run began. */
const INTAKE_MS = 240;

export const AUTHOR: AgentRef = { id: "a1", definition: "author" };
export const GM: AgentRef = { id: "a2", definition: "gm", parent: "a1" };
export const MOIRA: AgentRef = { id: "a3", definition: "character", parent: "a1", plays: "char-moira" };

export const INTENT = [
  "Wants: speech. Ash presses Moira about the lamp going dark, and is after what really happened last night.",
  "Scope: one exchange in the lamp room, a few minutes; Ash and Moira.",
  "Story lane: the first crack in Moira's account of the wreck.",
  "Engine lane: a few minutes pass. Nothing else changes.",
  "Needs: Moira's own words, and whether her story holds up against what Ash saw.",
].join("\n");

const PLAN = "Assisted: the GM rules on whether Moira's story holds, Moira answers in her own words, then I write.";
const THINKING_1 = "Moira kept the watch. The log says the lamp failed at three; Ash saw it dark before midnight. She lied to the harbourmaster, and Ash is close to it.";
const MOIRA_LINE = '"The chimney glass cracked in the cold," Moira says, not looking up. "I had it swapped by three."';
const RULING = "Ruling: her story does not hold. Ash remembers the beam gone before midnight, not at three, and Moira's hands shake on the logbook.";

export const REPLY = [
  "Moira's hands go still on the logbook.",
  "",
  '"The chimney glass cracked in the cold," she says, not looking up. "I had it swapped by three."',
  "",
  "But you remember the dark coming well before midnight, the beam gone from the rocks while the supper bell still rang in the village. She turns a page that does not need turning.",
].join("\n");

export const PROGRESS = ["Reading the scene", "Asking the GM", "Writing"];

/** The lore of the recorded turn's prompt: the entries Lumiverse activated for it, by Lumiverse's ids, and those its lore map showed the Author, by RPE's. */
export const LORE = { activated: ["wbe-0071", "wbe-0102"], map: ["e-12", "e-31", "e-40"] } as const;

const scope = { user: USER, chat: CHAT, session: SESSION, turn: RUN };
const usage = (calls: number, input: number, cacheRead: number, output: number, reasoning?: number): Usage => ({ calls, input, cacheRead, cacheWrite: 0, output, ...(reasoning === undefined ? {} : { reasoning }) });

const A1_CALL_1 = usage(1, 12_840, 9_216, 412, 96);
const A1_CALL_2 = usage(1, 14_310, 12_288, 236, 40);
const A2_CALL_1 = usage(1, 3_020, 2_048, 88);
const A2_CALL_2 = usage(1, 3_310, 3_072, 57);
const A3_CALL_1 = usage(1, 2_210, 1_536, 64);
export const A1_USAGE = usage(2, 27_150, 21_504, 648, 136);
export const A2_USAGE = usage(2, 6_330, 5_120, 145);
export const A3_USAGE = A3_CALL_1;
export const TOTAL = usage(5, 35_690, 28_160, 857, 136);

/** Splits `text` into `n` pieces of about the same length. */
function pieces(text: string, n: number): string[] {
  const size = Math.ceil(text.length / n);
  const out: string[] = [];
  for (let at = 0; at < text.length; at += size) out.push(text.slice(at, at + size));
  return out;
}

/** The recording, built in the order it happened. */
function record(): LiveEvent[] {
  const events: LiveEvent[] = [];
  let seq = 0;
  let now = T0;
  const push = (kind: LiveEvent["kind"], data: unknown): void => {
    events.push({ chat: CHAT, seq: events.length + 1, kind, at: now, data } as LiveEvent);
  };
  const trace = (ms: number, agent: AgentRef, event: TraceEvent, parent?: string): void => {
    now += ms;
    const rec: TraceRecord = { seq: ++seq, run: RUN_FIRST, scope, at: now, agent, ...(parent === undefined ? {} : { parent: { agent: AUTHOR.id, run: RUN_FIRST, call: parent } }), event };
    push("trace", rec);
  };
  const delta = (ms: number, agent: AgentRef, call: number, part: { text?: string; thinking?: string }): void => {
    now += ms;
    const d: TraceDelta = { run: RUN_FIRST, agent: agent.id, call, ...part, at: now };
    push("delta", d);
  };
  let replyAt = 0;
  const reply = (ms: number, piece: { text: string } | { line: number; progress: string }): void => {
    now += ms;
    let out: ReplyPiece;
    if ("text" in piece) {
      out = { run: RUN_FIRST, from: replyAt, text: piece.text };
      replyAt += piece.text.length;
    } else out = { run: RUN_FIRST, line: piece.line, progress: piece.progress };
    push("reply", out);
  };

  // The Author begins, writes its intent record and plan, and asks for three tools at once.
  trace(0, AUTHOR, { kind: "run_started", run: "turn", turn: "new", lead: "author" });
  trace(6, AUTHOR, { kind: "agent_started", definition: "author", connection: "Deepseek", model: "deepseek-v4-flash", effort: "medium", session: SESSION, given: ["prompt:all", "story:brief", "world:scene"] });
  trace(4, AUTHOR, { kind: "call_started", call: 1, connection: "Deepseek", model: "deepseek-v4-flash", messages: 18, tools: 30, maxTokens: 4096 });
  reply(30, { line: 0, progress: PROGRESS[0] as string });
  for (const part of pieces(THINKING_1, 3)) delta(220, AUTHOR, 1, { thinking: part });
  const call1Text = `<intent>\n${INTENT}\n</intent>\n${PLAN}`;
  for (const part of pieces(call1Text, 6)) delta(260, AUTHOR, 1, { text: part });
  trace(40, AUTHOR, { kind: "intent", text: INTENT });
  const todo1 = { id: "call-todo-1", name: "todo", args: { items: ["Ask the GM whether Moira's story holds", "Get Moira's answer", "Write the reply"] } };
  const gmTask = { id: "call-gm-1", name: "delegate", args: { agent: "gm", task: "Ash asks Moira why the lamp went dark. Does her story (a cracked chimney glass) hold against what Ash saw? Rule it, and roll if it is contested." } };
  const moiraTask = { id: "call-moira-1", name: "delegate", args: { agent: "character", plays: "char-moira", task: "Ash asks you why the lamp went dark last night. Answer in your own words." } };
  trace(30, AUTHOR, { kind: "call_ended", call: 1, model: "deepseek-v4-flash", text: call1Text, thinking: THINKING_1, toolCalls: [todo1, gmTask, moiraTask], stop: "toolUse", usage: A1_CALL_1, ms: 3820 });
  trace(3, AUTHOR, { kind: "tool_started", callId: todo1.id, tool: "todo", args: todo1.args, closing: false });
  trace(2, AUTHOR, { kind: "todo", items: todo1.args.items.map((text) => ({ text, done: false })) });
  trace(2, AUTHOR, { kind: "tool_ended", callId: todo1.id, tool: "todo", result: { content: [{ type: "text", text: "3 open, 0 done." }] }, clean: true, endedRun: false, ms: 4 });
  trace(2, AUTHOR, { kind: "tool_started", callId: gmTask.id, tool: "delegate", args: gmTask.args, closing: false });
  trace(1, AUTHOR, { kind: "tool_started", callId: moiraTask.id, tool: "delegate", args: moiraTask.args, closing: false });
  reply(5, { line: 1, progress: PROGRESS[1] as string });

  // The GM and Moira work at once.
  trace(12, GM, { kind: "agent_started", definition: "gm", connection: "Deepseek", model: "deepseek-v4-flash", effort: "low", session: SESSION, given: ["world:scene(full)"] }, gmTask.id);
  trace(3, MOIRA, { kind: "agent_started", definition: "character", connection: "Deepseek", model: "deepseek-v4-flash", effort: "low", session: SESSION, given: ["cast:char-moira"] }, moiraTask.id);
  trace(4, GM, { kind: "call_started", call: 1, connection: "Deepseek", model: "deepseek-v4-flash", messages: 6, tools: 12 }, gmTask.id);
  trace(2, MOIRA, { kind: "call_started", call: 1, connection: "Deepseek", model: "deepseek-v4-flash", messages: 5, tools: 4 }, moiraTask.id);
  const gmText1 = "Contested: Moira's account against Ash's memory of the light. Rolling.";
  const gm1 = pieces(gmText1, 3);
  const mo1 = pieces(MOIRA_LINE, 3);
  for (let i = 0; i < 3; i++) {
    delta(300, GM, 1, { text: gm1[i] as string });
    delta(150, MOIRA, 1, { text: mo1[i] as string });
  }
  const roll = { id: "call-roll-1", name: "roll", args: { dice: "2d6", against: 8, why: "Moira's story holds" } };
  trace(80, GM, { kind: "call_ended", call: 1, model: "deepseek-v4-flash", text: gmText1, toolCalls: [roll], stop: "toolUse", usage: A2_CALL_1, ms: 1460 }, gmTask.id);
  trace(2, GM, { kind: "tool_started", callId: roll.id, tool: "roll", args: roll.args, closing: false }, gmTask.id);
  trace(2, GM, { kind: "tool_ended", callId: roll.id, tool: "roll", result: { content: [{ type: "text", text: "2d6 = 4 + 1 = 5 against 8: it does not hold." }], details: { dice: [4, 1], total: 5, against: 8 } }, clean: true, endedRun: false, ms: 2 }, gmTask.id);
  trace(1, GM, { kind: "rule_fired", firing: { rule: "rolls-say-why", path: "rules/rolls-say-why.md", level: "shipped", moment: "tool-result", watched: "result", agent: GM, callId: roll.id, tool: "roll", matched: "does not hold", action: "remind" } }, gmTask.id);
  trace(260, MOIRA, { kind: "call_ended", call: 1, model: "deepseek-v4-flash", text: MOIRA_LINE, toolCalls: [], stop: "stop", usage: A3_CALL_1, ms: 1890 }, moiraTask.id);
  trace(2, MOIRA, { kind: "agent_ended", status: "done", usage: A3_USAGE }, moiraTask.id);
  trace(3, AUTHOR, { kind: "tool_ended", callId: moiraTask.id, tool: "delegate", result: { content: [{ type: "text", text: MOIRA_LINE }] }, clean: true, endedRun: false, ms: 1930 });
  trace(5, GM, { kind: "call_started", call: 2, connection: "Deepseek", model: "deepseek-v4-flash", messages: 9, tools: 12 }, gmTask.id);
  for (const part of pieces(RULING, 3)) delta(240, GM, 2, { text: part });
  trace(60, GM, { kind: "call_ended", call: 2, model: "deepseek-v4-flash", text: RULING, toolCalls: [], stop: "stop", usage: A2_CALL_2, ms: 980 }, gmTask.id);
  trace(2, GM, { kind: "agent_ended", status: "done", usage: A2_USAGE }, gmTask.id);
  trace(3, AUTHOR, { kind: "tool_ended", callId: gmTask.id, tool: "delegate", result: { content: [{ type: "text", text: RULING }] }, clean: true, endedRun: false, ms: 3420 });

  // The Author writes the reply; it streams to the chat as it is written.
  trace(6, AUTHOR, { kind: "call_started", call: 2, connection: "Deepseek", model: "deepseek-v4-flash", messages: 24, tools: 30, maxTokens: 4096 });
  reply(10, { line: 2, progress: PROGRESS[2] as string });
  delta(400, AUTHOR, 2, { text: "<reply>\n" });
  for (const part of pieces(REPLY, 6)) {
    delta(420, AUTHOR, 2, { text: part });
    reply(8, { text: part });
  }
  delta(120, AUTHOR, 2, { text: "\n</reply>" });
  const todo2 = { id: "call-todo-2", name: "todo", args: { done: [0, 1, 2], closing: true } };
  const story = { id: "call-story-1", name: "story_record", args: { beat: "Moira's account of the lamp cracks under Ash's question.", closing: true } };
  trace(40, AUTHOR, { kind: "call_ended", call: 2, model: "deepseek-v4-flash", text: `<reply>\n${REPLY}\n</reply>`, toolCalls: [todo2, story], stop: "toolUse", usage: A1_CALL_2, ms: 5210 });
  trace(2, AUTHOR, { kind: "released", release: { by: AUTHOR, form: "tags", length: REPLY.length } });
  trace(3, AUTHOR, { kind: "tool_started", callId: todo2.id, tool: "todo", args: { done: todo2.args.done }, closing: true });
  trace(1, AUTHOR, { kind: "todo", items: todo1.args.items.map((text) => ({ text, done: true })) });
  trace(1, AUTHOR, { kind: "tool_ended", callId: todo2.id, tool: "todo", result: { content: [{ type: "text", text: "0 open, 3 done." }] }, clean: true, endedRun: false, ms: 2 });
  trace(2, AUTHOR, { kind: "tool_started", callId: story.id, tool: "story_record", args: { beat: story.args.beat }, closing: true });
  trace(14, AUTHOR, { kind: "tool_ended", callId: story.id, tool: "story_record", result: { content: [{ type: "text", text: "Recorded the beat: Moira's account of the lamp cracks under Ash's question." }] }, clean: true, endedRun: true, ms: 12 });
  trace(2, AUTHOR, { kind: "agent_ended", status: "done", usage: A1_USAGE });
  trace(1, AUTHOR, { kind: "run_ended", outcome: { status: "released", released: true, usage: TOTAL } });
  return events;
}

/** The whole recording, in the order the hub numbered it. */
export const RECORDED: readonly LiveEvent[] = record();

/** Its trace records alone, in order. */
export const RECORDS: readonly TraceRecord[] = RECORDED.filter((e) => e.kind === "trace").map((e) => e.data as unknown as TraceRecord);

export const CONTINUED_REPLY = 'She closes the logbook. "Ask the harbourmaster, then, if you think I lie."';
const CONTINUED_USAGE = usage(1, 14_900, 12_288, 61);

/** The recorded turn continued half a minute after its run ended: a second run of it, under the same run id, its records numbered from 1 again. */
function continued(): LiveEvent[] {
  const events: LiveEvent[] = [];
  let seq = 0;
  let now = (RECORDS.at(-1)?.at ?? T0) + 30_000;
  const push = (kind: LiveEvent["kind"], data: unknown): void => {
    events.push({ chat: CHAT, seq: RECORDED.length + events.length + 1, kind, at: now, data } as LiveEvent);
  };
  const trace = (ms: number, event: TraceEvent): void => {
    now += ms;
    const rec: TraceRecord = { seq: ++seq, run: RUN_SECOND, scope, at: now, agent: AUTHOR, event };
    push("trace", rec);
  };
  trace(0, { kind: "run_started", run: "turn", turn: "continue", lead: "author" });
  trace(5, { kind: "agent_started", definition: "author", connection: "Deepseek", model: "deepseek-v4-flash", effort: "medium", session: SESSION, given: ["prompt:all", "story:brief"] });
  trace(4, { kind: "call_started", call: 1, connection: "Deepseek", model: "deepseek-v4-flash", messages: 20, tools: 30 });
  now += 900;
  push("reply", { run: RUN_SECOND, from: 0, text: CONTINUED_REPLY } satisfies ReplyPiece);
  trace(40, { kind: "call_ended", call: 1, model: "deepseek-v4-flash", text: `<reply>\n${CONTINUED_REPLY}\n</reply>`, toolCalls: [], stop: "stop", usage: CONTINUED_USAGE, ms: 950 });
  trace(2, { kind: "released", release: { by: AUTHOR, form: "tags", length: CONTINUED_REPLY.length } });
  trace(2, { kind: "agent_ended", status: "done", usage: CONTINUED_USAGE });
  trace(1, { kind: "run_ended", outcome: { status: "released", released: true, usage: CONTINUED_USAGE } });
  return events;
}

/** The continue's run as the hub carries it, after the whole recording. */
export const CONTINUED: readonly LiveEvent[] = continued();
export const CONTINUED_RECORDS: readonly TraceRecord[] = CONTINUED.filter((e) => e.kind === "trace").map((e) => e.data as unknown as TraceRecord);

/**
 * Events of the recording as RPH gives them since each run has an id of its own: `run` wherever the recording names its run by the
 * turn's id (a record's run and a sub-agent's parent run, a piece of streaming text, a piece of the reply), the turn kept in each
 * record's scope.
 */
export function underRun(events: readonly LiveEvent[], run: string): LiveEvent[] {
  return events.map((e): LiveEvent => {
    if (e.kind === "trace") return { ...e, data: { ...e.data, run, ...(e.data.parent === undefined ? {} : { parent: { ...e.data.parent, run } }) } };
    if (e.kind === "delta") return { ...e, data: { ...e.data, run } };
    if (e.kind === "reply") return { ...e, data: { ...e.data, run } };
    return e;
  });
}

/** The recorded turn once continued, as a read of it answers: what its latest run (the continue) says, the records of both its runs in time order, and each run. */
export function continuedTurn(): TurnReply {
  const latest = turnOf(CONTINUED, { run: RUN, chat: CHAT, received: (CONTINUED_RECORDS[0]?.at ?? T0) - INTAKE_MS });
  const first = turnAt().runs;
  const again = latest.runs.map((run): RunShown => ({ ...run, id: `${RUN}.2`, nth: 2, kind: "continue" }));
  return { ...latest, kind: "continue", trace: [...RECORDS, ...latest.trace], runs: [...first, ...again] };
}

/** Where the harness keeps what one model call was sent, below the turn's folder. */
export function requestFile(agent: AgentRef, call: number): string {
  return `transcripts/${agent.definition}-${agent.id}.call-${call}.json`;
}

/** A turn as a read of it answers, from the live events of its run heard so far, with its trace from record `from`. */
export function turnOf(seen: readonly LiveEvent[], options: { run: string; chat: string; received: number; from?: number }): TurnReply {
  const records = seen.filter((e) => e.kind === "trace").map((e) => e.data as unknown as TraceRecord);
  const pieces = seen.filter((e) => e.kind === "reply").map((e) => e.data as unknown as ReplyPiece);
  const text = pieces.flatMap((p) => ("text" in p ? [p.text] : [])).join("");
  const progress = pieces.flatMap((p) => ("progress" in p ? [p.progress] : []));
  const at = (kind: TraceEvent["kind"]): number | null => records.find((r) => r.event.kind === kind)?.at ?? null;
  const firstWord = seen.find((e) => e.kind === "reply" && "text" in (e.data as object))?.at ?? null;
  const ended = records.find((r) => r.event.kind === "run_ended")?.event;
  const outcome = ended?.kind === "run_ended" ? ended.outcome : null;
  const intent = records.find((r) => r.event.kind === "intent")?.event;
  const spent = records.flatMap((r) => (r.event.kind === "call_ended" ? [r.event.usage] : []));
  const sum = spent.reduce<Usage>((a, b) => ({ calls: a.calls + b.calls, input: a.input + b.input, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, output: a.output + b.output, reasoning: (a.reasoning ?? 0) + (b.reasoning ?? 0) }), { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 });
  const status = outcome?.status ?? "running";
  const timings = { received: options.received, started: at("run_started"), firstWord, released: at("released"), ended: at("run_ended"), intent: null, thinking: [] };
  const trace = records.filter((r) => r.seq >= (options.from ?? 1));
  const run: RunShown = {
    id: `${options.run}.1`,
    run: records[0]?.run ?? options.run,
    nth: 1,
    kind: "new",
    status,
    timings,
    usage: outcome?.usage ?? sum,
    reply: { text, progress },
    error: outcome?.error ?? null,
    stoppedBy: null,
    lastText: false,
    notGiven: [],
    trace,
    requests: records.flatMap((r) => (r.event.kind === "call_started" ? [{ agent: r.agent.id, definition: r.agent.definition, call: r.event.call, file: requestFile(r.agent, r.event.call) }] : [])),
  };
  return {
    id: options.run,
    chat: options.chat,
    kind: "new",
    onPath: true,
    message: outcome?.released === true ? "msg-0412" : null,
    status,
    timings,
    usage: outcome?.usage ?? sum,
    intent: intent?.kind === "intent" ? intent.text : null,
    reply: { text, progress },
    error: outcome?.error ?? null,
    trace,
    lore: { activated: [...LORE.activated], map: [...LORE.map] },
    runs: [run],
  };
}

/** The recorded turn as a read of it answers once the hub had sent its first `count` events (all of them when absent), with its trace from record `from`. */
export function turnAt(count: number = RECORDED.length, from = 1, chat = CHAT): TurnReply {
  const detail = turnOf(RECORDED.slice(0, count), { run: RUN, chat, received: T0 - INTAKE_MS, from });
  return chat === CHAT ? detail : { ...detail, trace: detail.trace.map((r) => ({ ...r, scope: { ...r.scope, chat } })), runs: detail.runs.map((run) => ({ ...run, trace: run.trace.map((r) => ({ ...r, scope: { ...r.scope, chat } })) })) };
}

export function summaryOf(detail: TurnReply): TurnRow {
  return { id: detail.id, kind: detail.kind, onPath: detail.onPath, message: detail.message, status: detail.status, timings: detail.timings, usage: detail.usage };
}

/** The chat's earlier turns: a swipe that stands, the attempt it replaced (off the path now), and one stopped by the player. */
export const EARLIER: readonly TurnRow[] = [
  { id: "turn-30", kind: "swipe", onPath: true, message: "msg-0410", status: "released", timings: { received: T0 - 600_000, started: T0 - 599_780, firstWord: T0 - 591_200, released: T0 - 586_900, ended: T0 - 586_700, intent: null, thinking: [] }, usage: usage(3, 24_100, 19_456, 512, 88) },
  { id: "turn-29", kind: "new", onPath: false, message: "msg-0410", status: "released", timings: { received: T0 - 720_000, started: T0 - 719_700, firstWord: T0 - 709_900, released: T0 - 705_100, ended: T0 - 704_800, intent: null, thinking: [] }, usage: usage(4, 30_870, 22_528, 640, 120) },
  { id: "turn-28", kind: "new", onPath: true, message: "msg-0408", status: "stopped", timings: { received: T0 - 1_500_000, started: T0 - 1_499_760, firstWord: null, released: null, ended: T0 - 1_492_000, intent: null, thinking: [] }, usage: usage(2, 11_920, 8_192, 301, 64) },
];

const EARLIER_WORDS: Readonly<Record<string, { intent: string; reply: string }>> = {
  "turn-30": { intent: "Wants: action. Ash climbs to the lamp room to see the lamp for themself.\nScope: the stairs and the lamp room, a few minutes.", reply: "You take the stairs two at a time. The lamp room smells of paraffin and cold brass." },
  "turn-29": { intent: "Wants: action. Ash climbs to the lamp room.\nScope: the stairs, a few minutes.", reply: "The stairs wind up into the dark, and the wind finds every crack in the tower." },
  "turn-28": { intent: "Wants: a question. Ash asks the harbourmaster about the wreck.\nScope: one exchange on the quay.", reply: "" },
};

/** One of the earlier turns as a read of it answers: its record, without its trace. */
export function earlierTurn(id: string, chat = CHAT): TurnReply | null {
  const summary = EARLIER.find((t) => t.id === id);
  const words = EARLIER_WORDS[id];
  if (summary === undefined || words === undefined) return null;
  const error = summary.status === "stopped" ? { code: "stopped" as const } : null;
  const reply = { text: words.reply, progress: [] };
  // The recording names a run by its turn, as RPH did before each run had an id of its own.
  const run: RunShown = { id: `${id}.1`, run: id, nth: 1, stoppedBy: null, lastText: false, notGiven: [], kind: summary.kind, status: summary.status, timings: summary.timings, usage: summary.usage, reply, error, trace: [], requests: [] };
  return { ...summary, chat, intent: words.intent, reply, error, trace: [], lore: { activated: [], map: [] }, runs: [run] };
}

/** A chat's list of turns, newest first: the recorded one as it stands after `count` events, then the earlier ones. */
export function turnListAt(count: number = RECORDED.length, chat = CHAT): TurnsReply {
  return { turns: [summaryOf(turnAt(count, 1, chat)), ...EARLIER], more: false };
}

export const CHATS: ChatsReply = {
  chats: [
    { id: CHAT, name: "Calder Point", lastTurnAt: T0, running: false, played: true, world: true },
    { id: "chat-orchard", name: "The orchard war", lastTurnAt: T0 - 3 * 86_400_000, running: false, played: true, world: false },
    { id: "chat-harbour", name: "The harbour master's ledger", lastTurnAt: null, running: false, played: false, world: true },
  ],
};

const quiet = (over: Partial<LevelReflection> = {}): LevelReflection => ({ people: 0, things: 0, places: 0, groups: 0, records: 0, notable: [], open: 0, changed: null, note: null, ...over });

/** The story's world as the store's tree holds it, every level with all its values (what it inherits among them). */
export const WORLD: readonly LevelNode[] = [
  {
    ref: "world",
    kind: "world",
    name: "The Calder coast",
    what: null,
    reflection: quiet({ people: 2, things: 2, places: 2, changed: 31 }),
    values: [
      { key: "time", value: "12 Nov, 21:40", from: { system: "calendar" } },
      { key: "currency", value: "crowns", mark: { turn: "turn-28", n: 28, precision: "exact", standing: "established", source: "import" } },
    ],
    facts: [],
    children: ["place:calder-point", "groups", "elsewhere"],
    parent: null,
  },
  {
    ref: "place:calder-point",
    kind: "place",
    name: "Calder Point",
    what: null,
    reflection: quiet({ people: 2, things: 2, places: 1, notable: ["Moira Vell"], changed: 31 }),
    values: [
      { key: "weather", value: "north wind, sleet", from: { system: "weather" } },
      { key: "keeper", value: "Moira Vell", mark: { turn: "turn-30", n: 30, precision: "exact", standing: "established", source: "lore" } },
    ],
    facts: [{ id: "f-1", about: "place:calder-point", key: "keeper", value: "Moira has kept the light for forty years", precision: "approximate", standing: "established", source: "lore", by: "a1", turn: "turn-30", n: 30 }],
    children: ["place:lamp-room"],
    parent: "world",
  },
  {
    ref: "place:lamp-room",
    kind: "place",
    name: "The lamp room",
    what: null,
    reflection: quiet({ people: 2, things: 2, notable: ["Moira Vell", "Ash"], open: 1, changed: 31, note: "Ash will not leave until the lamp is explained." }),
    values: [
      { key: "weather", value: "north wind, sleet", from: { system: "weather" } },
      { key: "keeper", value: "Moira Vell", from: { ref: "place:calder-point", name: "Calder Point" } },
      { key: "lamp", value: "dark", mark: { turn: "turn-31", n: 31, precision: "exact", standing: "proposed", source: "gm" } },
    ],
    facts: [
      { id: "f-2", about: "place:lamp-room", key: "lamp", value: "the chimney glass cracked in the cold", precision: "vague", standing: "assumed", source: "character", by: "a3", turn: "turn-31", n: 31 },
      { id: "f-3", about: "place:lamp-room", key: "smell", value: "paraffin and cold brass", precision: "exact", standing: "established", source: "prose", by: null, turn: "turn-30", n: 30 },
    ],
    children: ["entity:moira", "entity:logbook"],
    parent: "place:calder-point",
  },
  { ref: "entity:moira", kind: "entity", name: "Moira Vell", what: "person", reflection: quiet(), values: [{ key: "holding", value: "the logbook" }], facts: [], children: [], parent: "place:lamp-room" },
  { ref: "entity:logbook", kind: "entity", name: "The keeper's logbook", what: "thing", reflection: quiet(), values: [], facts: [], children: [], parent: "place:lamp-room" },
  { ref: "groups", kind: "groups", name: null, what: null, reflection: quiet(), values: [], facts: [], children: [], parent: "world" },
  { ref: "elsewhere", kind: "elsewhere", name: null, what: null, reflection: quiet(), values: [], facts: [], children: [], parent: "world" },
];

/** The world as its route answers for a level, to a depth, with the values asked for: the level, then each level below in order. */
export function worldAt(at: string, depth: number, values: ValuesShown = "all"): WorldReply | null {
  const byRef = new Map(WORLD.map((node) => [node.ref, node]));
  if (!byRef.has(at)) return null;
  const nodes: LevelNode[] = [];
  const walk = (ref: string, down: number): void => {
    const node = byRef.get(ref);
    if (node === undefined) return;
    nodes.push({ ...node, values: values === "none" ? [] : values === "own" ? node.values.filter((v) => v.from?.ref === undefined) : node.values });
    if (down < depth) for (const child of node.children) walk(child, down + 1);
  };
  walk(at, 0);
  return { at, nodes };
}
