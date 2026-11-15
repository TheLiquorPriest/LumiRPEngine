// The gates of row 0.2 played by the proof runner itself over recorded turns: the floor's replay host (`../../floor/replay.ts`),
// the real gate (`scripts/proof/phase0-0.2-*/gate.ts`) with its form replaced by the gate's own play over a
// reader made up here, which answers each line with the trace a test gives it and keeps what the play wrote
// to the chat's settings. Turns are invented in the shapes RPE's trace holds them.

import type { ToolCallView, TraceEvent, TraceRecord } from "rp-harness/contract";
import { resolve } from "node:path";
import type { Play } from "../../../../scripts/proof/route/form";
import type { FloorActs, Ground, TurnRead } from "../../../../scripts/proof/floor/play";
import { installedRoots, type Roots } from "../../../../scripts/proof/lib/pi";
import { isLoopReader, type LoopReader } from "../../../../scripts/proof/lib/loop";
import { playTagsWith } from "../../../../scripts/proof/phase0-0.2-tags/play";
import { playTwoStepWith } from "../../../../scripts/proof/phase0-0.2-two-step/play";
import { recordedRun } from "../../floor/recorded";
import { LEADS, playReplay, replaying, SERVED, type Played, type ReplayGate, type Sent } from "../../floor/replay";

const REPO = resolve(import.meta.dir, "../../../..");

export const AUTHOR = { id: "lead", definition: "author" } as const;
const SCOPE = { user: "u-floor", chat: "chat-floor", session: "s-floor", turn: "t-1" };

/** The reply contract's header as the shipped one writes it. */
export const CONTRACT = "---\ntags:\n  reply: reply\n  intent: intent\nintent_file: scratch/intent.md\n---\nThe reply goes between the tags.";

/** A turn's records for the lead in one run, in order. */
function records(events: [number, TraceEvent][], agent: { id: string; definition: string } = AUTHOR): TraceRecord[] {
  return events.map(([at, event], i) => ({ seq: i + 1, run: "run-1", scope: SCOPE, at, agent: { ...agent }, event }));
}

const usage = { calls: 1, input: 1, cacheRead: 0, cacheWrite: 0, output: 1 };
const start = (lead: string): [number, TraceEvent][] => [
  [1, { kind: "run_started", run: "turn", turn: "new", lead }],
  [2, { kind: "agent_started", definition: lead, connection: "rpe-floor", model: "deepseek-v4-flash", effort: "high", session: "s-floor", given: [] }],
];
const callStarted = (call: number, at: number): [number, TraceEvent] => [at, { kind: "call_started", call, connection: "rpe-floor", model: "deepseek-v4-flash", messages: 3, tools: 4 }];
const callEnded = (call: number, at: number, text: string, toolCalls: ToolCallView[] = []): [number, TraceEvent] => [at, { kind: "call_ended", call, model: "deepseek-v4-flash", text, toolCalls, stop: "stop", usage, ms: 1 }];

/** A tag-form turn: one call whose first message holds the intent record and the reply in their tags. */
export function tagsTrace(text = "<intent>wants: shelter</intent>\n<reply>Marta nods and sets down the cup.</reply>", lead = "author"): TraceRecord[] {
  return records([...start(lead), callStarted(1, 3), callEnded(1, 20, text), [21, { kind: "released", release: { by: { ...AUTHOR }, form: "tags", length: 40 } }]], { ...AUTHOR, definition: lead });
}

/** A two-step turn: the intent file written in the first call, the reply the plain text of the second; `extra` calls (tool rounds) come between. */
export function twoStepTrace(options: { extra?: number; writesIntent?: boolean; workingText?: string } = {}): TraceRecord[] {
  const write: ToolCallView = { id: "w", name: "file_write", args: { path: "scratch/intent.md" } };
  const look: ToolCallView = { id: "l", name: "lore_search", args: { query: "reef" } };
  const first = options.writesIntent === false ? look : write;
  const events: [number, TraceEvent][] = [...start("author"), callStarted(1, 3), [5, { kind: "tool_started", callId: first.id, tool: first.name, args: first.args, closing: false }], callEnded(1, 8, options.workingText ?? "", [first])];
  let call = 1;
  for (let n = 0; n < (options.extra ?? 0); n++) events.push(callStarted(++call, 10 + n), callEnded(call, 11 + n, ""));
  events.push(callStarted(++call, 20), callEnded(call, 30, "Marta nods and sets down the cup."), [30, { kind: "released", release: { by: { ...AUTHOR }, form: "message", length: 40 } }]);
  return records(events);
}

/** What a test gives the loop replay. */
export interface LoopSpec {
  /** The trace each line is answered with, in order; null: the turn's RPE side could not be read. */
  turns: readonly (TraceRecord[] | null)[];
  contract?: string;
  /** The setting's write fails with this. */
  writeFails?: string;
  /** The setting reads as this after it was written (default: as written). */
  reads?: string;
  /** The turn's run is still going after the reply, from this turn on (1-based). */
  runningFrom?: number;
}

/** What the play did of the chat's settings and its lines. */
export interface Log {
  writes: { chat: string; key: string; value: unknown }[];
  sent: Sent[];
}

/** The acts and the loop reader of a spec. */
function sourceOf(spec: LoopSpec, log: Log, seen?: Partial<Ground>): (sent: Sent[]) => { acts: FloorActs; reader: LoopReader; played: () => never[] } {
  return (sent) => {
    const base = recordedRun({ form: "tag" });
    const rpe = base.turns[1]?.rpe;
    if (rpe === undefined || rpe === null) throw new Error("the recorded run has no RPE turn to take the shape from");
    let at = 0;
    const acts: FloorActs = {
      lumiverse: { base: "http://lumiverse.invalid", token: "invented" },
      rpe: { base: "http://rpe.invalid", token: "invented" },
      connections: { plain: base.arms.plain.connection, rpe: "rpe-floor" },
      chat: async () => "chat-floor",
      send: async (_chat, connection, line) => {
        sent.push({ connection, line });
        log.sent.push({ connection, line });
        return { sent: 0, firstThinking: null, firstWord: null, lastWord: null, ended: null, resolution: 20 };
      },
    };
    const ground: Ground = {
      observed: { plain: base.plain, shipped: SERVED, layers: [], off: [], leads: LEADS },
      plain: base.arms.plain,
      history: { keep: null, step: null, hold: null, framing: null, framingNote: null, framingWhy: null },
      previousRun: base.previousRun,
      rpeConnections: { list: [{ id: "id-rpe-floor", name: "rpe-floor", provider: "deepseek" }], why: null },
      ...seen,
    };
    let written: string | null = null;
    const reader: LoopReader = {
      fixture: async () => ({ preset: { id: "preset-floor" }, persona: { id: "persona-floor" }, card: { id: "card-floor" }, book: { id: "book-floor", name: "Floor test lore (invented)", entries: [], vectorBlockers: [] } }),
      ground: async () => ground,
      turn: async (_chat, _arm, send): Promise<TurnRead> => {
        await send();
        const trace = spec.turns[at++];
        const done = { page: null, socket: { started: null, firstReasoning: null, firstToken: null, lastToken: null, ended: null, tokens: null, messageId: null, error: null, lore: [] }, visible: null, visibleWhy: null };
        if (trace === undefined || trace === null) return { ...done, rpe: null, error: "RPE's turn could not be read" };
        return { ...done, rpe: { ...rpe, trace, status: spec.runningFrom !== undefined && at >= spec.runningFrom ? "running" : "done" }, error: null };
      },
      messages: async () => [],
      close: () => undefined,
      contract: async () => spec.contract ?? CONTRACT,
      setting: async (_chat, key) => (key.startsWith("reply.forms.") && written !== null ? { value: spec.reads ?? written, from: "chat" } : null),
      put: async (chat, key, value) => {
        if (spec.writeFails !== undefined) throw new Error(spec.writeFails);
        written = String(value);
        log.writes.push({ chat, key, value });
      },
    };
    return { acts, reader, played: () => [] };
  };
}

let deps: { roots: Roots; printed: string[] } | null = null;

function setup(): { roots: Roots; out: (text: string) => void } {
  if (deps === null) throw new Error("no loop replay is set");
  const { printed, roots } = deps;
  return { roots, out: (text) => void printed.push(text) };
}

/** The tags gate's form over the current replay. */
export async function replayedTags(play: Play): Promise<void> {
  const now = replaying();
  if (!isLoopReader(now.reader)) throw new Error("the replay's reader is not a loop reader");
  await playTagsWith(play, now.acts, now.reader, null, setup());
}

/** The two-step gate's form over the current replay. */
export async function replayedTwoStep(play: Play): Promise<void> {
  const now = replaying();
  if (!isLoopReader(now.reader)) throw new Error("the replay's reader is not a loop reader");
  await playTwoStepWith(play, now.acts, now.reader, null);
}

export const TAGS_GATE: ReplayGate = { id: "phase0-0.2-tags", gate: "scripts/proof/phase0-0.2-tags/gate.ts", form: { module: "test/proof/phase0/loop/replay.ts", name: "replayedTags" } };
export const TWO_STEP_GATE: ReplayGate = { id: "phase0-0.2-two-step", gate: "scripts/proof/phase0-0.2-two-step/gate.ts", form: { module: "test/proof/phase0/loop/replay.ts", name: "replayedTwoStep" } };

/** What the runner made of a replayed gate, with what it wrote to the chat's settings and what the play printed. */
export interface LoopPlayed extends Played {
  log: Log;
  printed: string[];
}

/** Plays a gate of row 0.2 through the runner's own `main` over a spec. */
export async function playLoop(gate: ReplayGate, loop: LoopSpec, options: { roots?: Roots; ground?: Partial<Ground> } = {}): Promise<LoopPlayed> {
  const printed: string[] = [];
  const made: Log = { writes: [], sent: [] };
  deps = { roots: options.roots ?? installedRoots(REPO), printed };
  try {
    const played = await playReplay({ run: recordedRun({ form: gate === TWO_STEP_GATE ? "two-step" : "tag" }), ground: options.ground, source: sourceOf(loop, made, options.ground) }, gate);
    return { ...played, log: made, printed };
  } finally {
    deps = null;
  }
}
