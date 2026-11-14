// An invented turn, recorded as the live hub would carry it, for the UI's tests and the preview. A
// lighthouse story: the player's character, Ash, asks the keeper, Moira, why the lamp went dark. The
// Author (the lead) writes its intent record, starts two sub-agents at once (the GM, who rolls and
// rules, and the character agent playing Moira), a rule fires on the GM's roll, and the reply streams to
// the chat before the Author's closing calls. Every name, id and number here is made up.

import type { AgentRef, TraceDelta, TraceEvent, TraceRecord, Usage } from "rp-harness/contract";
import type { ChatList, LiveEvent, ReplyPiece, TurnDetail, TurnList, TurnSummary } from "../../src/ui/api";
import type { JsonValue } from "../../src/shared/json";

export const USER = "user-1";
export const CHAT = "chat-calder";
export const RUN = "turn-31";
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
  const push = (kind: string, data: unknown): void => {
    events.push({ chat: CHAT, seq: events.length + 1, kind, at: now, data: data as JsonValue });
  };
  const trace = (ms: number, agent: AgentRef, event: TraceEvent, parent?: string): void => {
    now += ms;
    const rec: TraceRecord = { seq: ++seq, run: RUN, scope, at: now, agent, ...(parent === undefined ? {} : { parent: { agent: AUTHOR.id, run: RUN, call: parent } }), event };
    push("trace", rec);
  };
  const delta = (ms: number, agent: AgentRef, call: number, part: { text?: string; thinking?: string }): void => {
    now += ms;
    const d: TraceDelta = { run: RUN, agent: agent.id, call, ...part, at: now };
    push("delta", d);
  };
  let replyAt = 0;
  const reply = (ms: number, piece: { text: string } | { line: number; progress: string }): void => {
    now += ms;
    let out: ReplyPiece;
    if ("text" in piece) {
      out = { run: RUN, from: replyAt, text: piece.text };
      replyAt += piece.text.length;
    } else out = { run: RUN, line: piece.line, progress: piece.progress };
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

/** A turn as a read of it answers, from the live events of its run heard so far, with its trace from record `from`. */
export function turnOf(seen: readonly LiveEvent[], options: { run: string; chat: string; received: number; from?: number }): TurnDetail {
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
  return {
    id: options.run,
    chat: options.chat,
    kind: "new",
    onPath: true,
    message: outcome?.released === true ? "msg-0412" : null,
    status: outcome?.status ?? "running",
    timings: { received: options.received, started: at("run_started"), firstWord, released: at("released"), ended: at("run_ended") },
    usage: outcome?.usage ?? sum,
    intent: intent?.kind === "intent" ? intent.text : null,
    reply: { text, progress },
    error: outcome?.error ?? null,
    trace: records.filter((r) => r.seq >= (options.from ?? 1)),
  };
}

/** The recorded turn as a read of it answers once the hub had sent its first `count` events (all of them when absent), with its trace from record `from`. */
export function turnAt(count: number = RECORDED.length, from = 1, chat = CHAT): TurnDetail {
  const detail = turnOf(RECORDED.slice(0, count), { run: RUN, chat, received: T0 - INTAKE_MS, from });
  return chat === CHAT ? detail : { ...detail, trace: detail.trace.map((r) => ({ ...r, scope: { ...r.scope, chat } })) };
}

export function summaryOf(detail: TurnDetail): TurnSummary {
  return { id: detail.id, kind: detail.kind, onPath: detail.onPath, message: detail.message, status: detail.status, timings: detail.timings, usage: detail.usage };
}

/** The chat's earlier turns: a swipe that stands, the attempt it replaced (off the path now), and one stopped by the player. */
export const EARLIER: readonly TurnSummary[] = [
  { id: "turn-30", kind: "swipe", onPath: true, message: "msg-0410", status: "released", timings: { received: T0 - 600_000, started: T0 - 599_780, firstWord: T0 - 591_200, released: T0 - 586_900, ended: T0 - 586_700 }, usage: usage(3, 24_100, 19_456, 512, 88) },
  { id: "turn-29", kind: "new", onPath: false, message: "msg-0410", status: "released", timings: { received: T0 - 720_000, started: T0 - 719_700, firstWord: T0 - 709_900, released: T0 - 705_100, ended: T0 - 704_800 }, usage: usage(4, 30_870, 22_528, 640, 120) },
  { id: "turn-28", kind: "new", onPath: true, message: "msg-0408", status: "stopped", timings: { received: T0 - 1_500_000, started: T0 - 1_499_760, firstWord: null, released: null, ended: T0 - 1_492_000 }, usage: usage(2, 11_920, 8_192, 301, 64) },
];

const EARLIER_WORDS: Readonly<Record<string, { intent: string; reply: string }>> = {
  "turn-30": { intent: "Wants: action. Ash climbs to the lamp room to see the lamp for themself.\nScope: the stairs and the lamp room, a few minutes.", reply: "You take the stairs two at a time. The lamp room smells of paraffin and cold brass." },
  "turn-29": { intent: "Wants: action. Ash climbs to the lamp room.\nScope: the stairs, a few minutes.", reply: "The stairs wind up into the dark, and the wind finds every crack in the tower." },
  "turn-28": { intent: "Wants: a question. Ash asks the harbourmaster about the wreck.\nScope: one exchange on the quay.", reply: "" },
};

/** One of the earlier turns as a read of it answers: its record, without its trace. */
export function earlierTurn(id: string, chat = CHAT): TurnDetail | null {
  const summary = EARLIER.find((t) => t.id === id);
  const words = EARLIER_WORDS[id];
  if (summary === undefined || words === undefined) return null;
  return { ...summary, chat, intent: words.intent, reply: { text: words.reply, progress: [] }, error: summary.status === "stopped" ? { code: "stopped" } : null, trace: [] };
}

/** A chat's list of turns, newest first: the recorded one as it stands after `count` events, then the earlier ones. */
export function turnListAt(count: number = RECORDED.length, chat = CHAT): TurnList {
  return { turns: [summaryOf(turnAt(count, 1, chat)), ...EARLIER], more: false };
}

export const CHATS: ChatList = {
  chats: [
    { id: CHAT, name: "Calder Point", lastTurnAt: T0, running: false },
    { id: "chat-orchard", name: "The orchard war", lastTurnAt: T0 - 3 * 86_400_000, running: false },
  ],
};
