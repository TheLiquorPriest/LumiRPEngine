// Nothing in RPE's turn waits for, holds or orders a step (plan §10.3, §10.7, §17.2 "Nothing in code holds the process"). A release
// is known the moment the reply's first text reaches RPE: marked on the run, told live while the run goes on, and read at once by
// `turn.owes.reply`. Whether a reply went out before its intent record is counted from the order the two reached RPE. A tool the
// Author calls before its record runs at once; with `reply-missing` off, a message with no call before any reply ends the run in one
// call. And the record's own time and the thinking before each call's first output are kept on the run as they arrive (R-185). Played
// through the stand-in Lumiverse on the scripted model, and, for the times, RPH's trace as it would come. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import type { AgentRef, Scope, TraceDelta, TraceEvent, TraceRecord } from "rp-harness/contract";
import { gate } from "rp-harness/testing/rig";
import type { LiveEvent } from "../../src/shared/api";
import type { Run } from "../../src/turn/runs";
import { RunTimes } from "../../src/turn/spans";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function bed(options: Parameters<typeof openTurnBed>[0]): Promise<TurnBed> {
  const b = await openTurnBed(options);
  beds.push(b);
  return b;
}

/** Follows the bed's chat on RPE's live hub, each event as it is published, with `onEvent` called then. */
function follow(b: TurnBed, onEvent: (event: LiveEvent) => void = () => undefined): LiveEvent[] {
  const heard: LiveEvent[] = [];
  b.app.live.follow(CHAT, {
    take: (batch) => {
      // The hub carries only the kinds it declares, each with its declared data: the shared types say which.
      for (const event of batch.events as unknown as readonly LiveEvent[]) {
        heard.push(event);
        onEvent(event);
      }
      return true;
    },
  });
  return heard;
}

describe("a turn played through", () => {
  test("a release is marked and told live the moment the reply's first text reaches RPE, while the run goes on, and owes reply reads it at once", async () => {
    const hold = gate();
    const b = await bed({ answers: [{ pieces: [{ text: "<intent>One exchange.</intent>" }, { text: "<reply>The lamp turns.</reply>" }, { hold }] }] });
    let seen: { run: Run | undefined; owes: Promise<unknown> } | null = null;
    const heard = follow(b, (event) => {
      if (event.kind !== "released" || seen !== null) return;
      // Asked in the same tick as the release is told, as a run-end rule would ask it.
      const run = b.turns.runs.ofChat(USER, CHAT)[0];
      const scope: Scope | null = run === undefined ? null : { user: USER, chat: CHAT, session: run.session, turn: run.turn };
      seen = { run, owes: scope === null ? Promise.resolve(null) : b.turns.facts.read(scope, ["turn.owes.reply"]) };
    });
    b.host.send(CHAT, "I climb the stairs.");
    const playing = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    const told = await b.until("the release to be told live", () => seen);
    expect(told.run?.status).toBe("running");
    expect(told.run?.released).not.toBeNull();
    expect(await told.owes).toEqual({ "turn.owes.reply": { count: 0 } });
    const released = heard.find((e) => e.kind === "released");
    expect(released?.data).toEqual({ run: told.run?.traceRun ?? "", at: told.run?.released ?? 0 });
    // The release came before the run ended.
    expect(heard.findIndex((e) => e.kind === "released")).toBeLessThan(heard.findIndex((e) => e.kind === "trace" && e.data.event.kind === "run_ended") >>> 0);
    hold.open();
    expect((await playing).error).toBeNull();
  });

  test("whether a reply went out before its intent record is counted from the order the two reached RPE; a tool called before the record runs at once, and the record is kept as it arrives", async () => {
    const b = await bed({
      answers: [
        { pieces: [{ text: "<reply>The lamp turns.</reply>" }] },
        { pieces: [{ call: "world_query", args: { at: "world" } }] },
        replying("Wren looks up."),
      ],
    });
    const heard = follow(b);
    const played = [];
    for (const said of ["I climb the stairs.", "I wave."]) {
      b.host.send(CHAT, said);
      const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
      expect(out.error).toBeNull();
      played.push(await settledTurn(b, out.generationId!));
    }
    const first = played[0]!;
    const second = played[1]!;
    const [run1] = b.turns.runs.ofTurn(USER, first.id);
    const [run2] = b.turns.runs.ofTurn(USER, second.id);
    expect([run1?.withoutIntent, run1?.intent]).toEqual([true, null]);
    expect(run2?.withoutIntent).toBe(false);
    expect(run2?.intent?.to).not.toBeNull();
    expect(run2!.intent!.to!).toBeLessThanOrEqual(run2!.released!);
    expect(b.turns.store.user(USER).turn(second.id)?.intent).toBe("One exchange.");
    // The tool ran in the Author's first call, before any record of the turn was written.
    const records = heard.flatMap((e) => (e.kind === "trace" && e.data.scope.turn === second.id ? [e.data] : []));
    const ended = records.findIndex((r) => r.event.kind === "tool_ended");
    expect(ended).toBeGreaterThanOrEqual(0);
    expect(ended).toBeLessThan(records.findIndex((r) => r.event.kind === "intent"));
    // The fact, for each turn once tied, reads its own last release.
    const read = async (turn: string, session: string) => (await b.turns.facts.read({ user: USER, chat: CHAT, session, turn }, ["turn.last.without.intent"]))["turn.last.without.intent"];
    expect(await read(first.id, run1!.session)).toEqual({ count: 1 });
    expect(await read(second.id, run2!.session)).toEqual({ count: 0 });
  });

  test("with reply-missing switched off, a message that makes no call before any reply ends the run in one call, with the error line", async () => {
    const b = await bed({ off: ["rules/reply-missing"], answers: [{ pieces: [{ text: "<intent>Nothing to say.</intent>" }] }] });
    b.host.send(CHAT, "I climb the stairs.");
    const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    expect(out.error).not.toBeNull();
    await b.until("the run to be over", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
    expect(b.model.requests.length).toBe(1);
  });
});

// ---------------------------------------------------------------- the record's own time and the thinking, as RPH's trace gives them

const LEAD: AgentRef = { id: "lead-1", definition: "author" };
const OTHER: AgentRef = { id: "gm-2", definition: "gm", parent: "lead-1" };
const SCOPE = { user: USER, chat: CHAT, session: "session-7", turn: "turn-7" } as const;

/** RPE's run of the turn, as the times write to it: no record, no thinking, no release yet. */
function freshRun(): Run {
  // The times read and write these fields alone; the rest of a run is the turn lane's.
  const fields: Pick<Run, "traceRun" | "released" | "intent" | "thinking" | "leadCall"> = { traceRun: null, released: null, intent: null, thinking: [], leadCall: { open: null, failed: null } };
  return fields as Run;
}

/** RunTimes over one running run, with the record and delta makers of RPH's run `run-7`. */
function timed() {
  const run = freshRun();
  const times = new RunTimes({ started: (record) => void (run.traceRun = record.run), running: (_user, turn) => (turn === SCOPE.turn ? run : undefined) });
  let seq = 0;
  const record = (at: number, event: TraceEvent, agent: AgentRef = LEAD): void => times.record({ seq: ++seq, run: "run-7", scope: SCOPE, at, agent, event } satisfies TraceRecord);
  const delta = (at: number, call: number, piece: { text: string } | { thinking: string }, agent: AgentRef = LEAD): void => times.delta({ run: "run-7", agent: agent.id, call, ...piece, at } satisfies TraceDelta);
  const ended = (at: number, call: number, text: string, toolCalls: { id: string; name: string; args: Record<string, string> }[] = []): void =>
    record(at, { kind: "call_ended", call, model: "m", text, toolCalls, stop: toolCalls.length > 0 ? "toolUse" : "stop", usage: { calls: 1, input: 1, cacheRead: 0, cacheWrite: 0, output: 1 }, ms: 1 });
  record(0, { kind: "run_started", run: "turn", turn: "new", lead: "author" });
  return { run, record, delta, ended };
}

const started = (call: number): TraceEvent => ({ kind: "call_started", call, connection: "c", model: "m", messages: 1, tools: 0 });

describe("the record's own time and the thinking", () => {
  test("one call that waits, thinks, then writes the record and the reply: one thinking span, first to last thought, with no wait in it; the record's time ends at its last token", () => {
    const { run, record, delta, ended } = timed();
    record(10, started(1));
    delta(400, 1, { thinking: "The keeper " });
    delta(450, 1, { thinking: "is lying." });
    record(470, { kind: "intent_began" });
    delta(470, 1, { text: "<intent>She lies" });
    delta(520, 1, { text: ".</intent>" });
    record(520, { kind: "intent", text: "She lies." });
    run.released = 600;
    delta(600, 1, { text: "<reply>No.</reply>" });
    // A sub-agent's thinking is not the lead's.
    delta(610, 2, { thinking: "rolling" }, OTHER);
    ended(650, 1, "<intent>She lies.</intent><reply>No.</reply>");
    expect(run.thinking).toEqual([{ from: 400, to: 450 }]);
    expect(run.intent).toEqual({ from: 470, to: 520 });
  });

  test("two-step: the record's call and the reply's message each think first; two spans in call order, neither holding the record or the tool round", () => {
    const { run, record, delta, ended } = timed();
    record(10, started(1));
    delta(100, 1, { thinking: "Plan." });
    delta(140, 1, { thinking: "Write it down." });
    ended(300, 1, "", [{ id: "t1", name: "file_write", args: { path: "scratch/intent.md", text: "She lies." } }]);
    record(320, { kind: "intent", text: "She lies." });
    record(400, started(2));
    delta(500, 2, { thinking: "Now the reply." });
    delta(530, 2, { thinking: "Short." });
    delta(560, 2, { text: "No." });
    run.released = 560;
    ended(600, 2, "No.");
    // A call after the release is past the reply's path.
    record(700, started(3));
    delta(710, 3, { thinking: "Tidy up." });
    expect(run.thinking).toEqual([
      { from: 100, to: 140 },
      { from: 500, to: 530 },
    ]);
  });

  test("a call stopped while it thinks keeps a span that did not end", () => {
    const { run, record, delta } = timed();
    record(10, started(1));
    delta(200, 1, { thinking: "Hmm" });
    record(250, { kind: "run_ended", outcome: { status: "stopped", released: false, usage: { calls: 1, input: 1, cacheRead: 0, cacheWrite: 0, output: 0 } } });
    expect(run.thinking).toEqual([{ from: 200, to: null }]);
    expect(run.intent).toBeNull();
  });

  test("a record begun and stopped before it ended keeps its first token's time and no end", () => {
    const { run, record, delta } = timed();
    record(10, started(1));
    record(300, { kind: "intent_began" });
    delta(300, 1, { text: "<intent>She" });
    record(350, { kind: "run_ended", outcome: { status: "stopped", released: false, usage: { calls: 1, input: 1, cacheRead: 0, cacheWrite: 0, output: 1 } } });
    expect(run.intent).toEqual({ from: 300, to: null });
  });

  test("no record and no thinking: the record's time is none and the thinking is empty", () => {
    const { run, record, delta, ended } = timed();
    record(10, started(1));
    delta(50, 1, { text: "<reply>No.</reply>" });
    ended(60, 1, "<reply>No.</reply>");
    expect([run.intent, run.thinking]).toEqual([null, []]);
  });
});
