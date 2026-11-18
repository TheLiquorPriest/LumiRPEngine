// RPE's trace port (`TracePort` in `rp-harness/contract`): everything RPH does goes to the live hub, on
// the chat the run is played in (a job of no chat's on `LIVE_JOBS`, the name the pages that follow his
// jobs follow), and is kept at the top of the turn's folder (or of the session's, for a job of no turn:
// a job of no chat's session sits at the user's level, under `jobs/`) in a file of RPE's own,
// `trace.jsonl`, for the Turn page, the Jobs page and a live view that joins late. Each agent's traffic
// (its messages, its tool calls and their results) has one writer, RPH, in that agent's transcript (plan
// §5.3 `transcripts/`, §13.4): this port writes nothing in `transcripts/`, keeps a record of a message, a
// call or a result without what the transcript holds, and reads that back from the transcript when the
// trace is read. Streaming text goes to the live hub only; the call's `call_ended` holds it whole. A
// piece of streaming text names only its run, by RPH's own id for it: where it goes is where its run's
// records go, each run's first record coming before any piece of it.

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRef, JsonValue, Log, RunScope, ToolContent, TraceDelta, TracePort, TraceRecord } from "rp-harness/contract";
import { LIVE_JOBS, type LiveHub } from "../app";
import { isRecord } from "../shared/json";
import { type TreeFiles, TURN_TRACE, TURN_TRANSCRIPTS } from "../tree";
import type { RunTimes } from "./spans";

/** A transcript's line as RPH writes it (`{"at":…,"type":"message"|"call"|"result",…}`), found by its time, its type and its call: a message by the call's number, a tool call and its result by the model's id for the call. */
type Lines = ReadonlyMap<string, Record<string, unknown>>;
const lineKey = (at: number, type: "message" | "call" | "result", call: number | string): string => `${at} ${type} ${call}`;
const NO_LINES: Lines = new Map();

/** An agent's transcript in `transcripts/`, as RPH names it: `<definition>-<handle>.jsonl`, any character but a letter, a digit, `_` or `-` made a `-`. */
const transcriptName = (agent: AgentRef): string => `${`${agent.definition}-${agent.id}`.replace(/[^A-Za-z0-9_-]/g, "-")}.jsonl`;

/** A record of an agent's traffic, whose words its transcript holds. */
const isTraffic = (record: TraceRecord): record is TraceRecord & { agent: AgentRef } =>
  record.agent !== undefined && (record.event.kind === "call_ended" || record.event.kind === "tool_started" || record.event.kind === "tool_ended");

/**
 * The rows of a JSON-lines file that `takes` takes, none where there is no file. A line torn by a crash, or written over, costs that line:
 * the rest is read, and the log says how many were passed over, and of which file (`name`, below the folder).
 */
async function readLines(folder: string, name: string, takes: (row: Record<string, unknown>) => boolean, log: Log): Promise<Record<string, unknown>[]> {
  const file = Bun.file(join(folder, name));
  if (!(await file.exists())) return [];
  const rows: Record<string, unknown>[] = [];
  let unreadable = 0;
  for (const line of (await file.text()).split("\n")) {
    if (line.trim() === "") continue;
    try {
      const row: unknown = JSON.parse(line);
      if (isRecord(row) && takes(row)) rows.push(row);
      else unreadable++;
    } catch {
      unreadable++;
    }
  }
  if (unreadable > 0) log.warn("Lines of a turn's trace or of an agent's transcript could not be read and were left out of the turn's trace.", { file: name, lines: unreadable });
  return rows;
}

/** An agent's transcript, each line by its time, its type and its call. */
async function transcriptLines(folder: string, name: string, log: Log): Promise<Lines> {
  const lines = new Map<string, Record<string, unknown>>();
  const rows = await readLines(folder, `${TURN_TRANSCRIPTS}/${name}`, (row) => typeof row.at === "number" && typeof row.type === "string", log);
  for (const row of rows) {
    const at = row.at as number;
    if (row.type === "message" && typeof row.call === "number") lines.set(lineKey(at, "message", row.call), row);
    else if ((row.type === "call" || row.type === "result") && typeof row.callId === "string") lines.set(lineKey(at, row.type, row.callId), row);
  }
  return lines;
}

/** A record as RPE keeps it: a message, a tool call or a result without what its agent's transcript holds (the text, the thinking, the arguments, what the model was shown); any other whole. */
function withoutTraffic(record: TraceRecord): unknown {
  if (!isTraffic(record)) return record;
  const { event } = record;
  switch (event.kind) {
    case "call_ended": {
      const { text: _text, thinking: _thinking, toolCalls, ...rest } = event;
      return { ...record, event: { ...rest, toolCalls: toolCalls.map(({ args: _args, ...call }) => call) } };
    }
    case "tool_started": {
      const { args: _args, ...rest } = event;
      return { ...record, event: rest };
    }
    case "tool_ended": {
      const { content: _content, reports: _reports, error: _error, ...result } = event.result;
      return { ...record, event: { ...event, result } };
    }
    default:
      return record;
  }
}

/** A kept record of an agent's traffic with what its transcript's line holds read back in; what no line holds (its write failed, or has not landed) is left empty. */
function withTraffic(record: TraceRecord, lines: Lines): TraceRecord {
  const { event } = record;
  switch (event.kind) {
    case "call_ended": {
      const line = lines.get(lineKey(record.at, "message", event.call));
      const args = new Map<unknown, unknown>((Array.isArray(line?.toolCalls) ? line.toolCalls : []).filter(isRecord).map((call) => [call.id, call.args]));
      return {
        ...record,
        event: {
          ...event,
          text: typeof line?.text === "string" ? line.text : "",
          ...(typeof line?.thinking === "string" ? { thinking: line.thinking } : {}),
          toolCalls: event.toolCalls.map((call) => ({ ...call, args: (args.get(call.id) ?? null) as JsonValue })),
        },
      };
    }
    case "tool_started":
      return { ...record, event: { ...event, args: (lines.get(lineKey(record.at, "call", event.callId))?.args ?? null) as JsonValue } };
    case "tool_ended": {
      const result = lines.get(lineKey(record.at, "result", event.callId))?.result;
      const shown = isRecord(result) ? result : {};
      return {
        ...record,
        event: {
          ...event,
          result: {
            ...event.result,
            content: Array.isArray(shown.content) ? (shown.content as ToolContent[]) : [],
            ...(Array.isArray(shown.reports) ? { reports: shown.reports as string[] } : {}),
            ...(shown.error === true ? { error: true as const } : {}),
          },
        },
      };
    }
    default:
      return record;
  }
}

export interface TraceDeps {
  live: LiveHub;
  files: TreeFiles;
  /** The turn's runs, given every record and piece as it comes: they take RPH's own id for each of theirs, and the times of its lead's writing (`spans.ts`). */
  runs: Pick<RunTimes, "record" | "delta">;
  log: Log;
}

export interface TurnTrace extends TracePort {
  /** Every record kept for a scope's turn so far (for a scope of no turn, its session's: a job's), in the order RPH gave them. */
  records(scope: RunScope): Promise<TraceRecord[]>;
  /** What the trace holds now: the turn folders it writes to, the runs it follows, and its writes not yet landed. */
  held(): { folders: number; runs: number; writes: number };
}

/** A turn folder that records are being written to: its place on disk, its chain of appends, the runs whose records go there, and the appends not settled. */
interface Open {
  folder: Promise<string | null>;
  tail: Promise<unknown>;
  runs: Set<string>;
  writes: number;
}

export function turnTrace(deps: TraceDeps): TurnTrace {
  /**
   * Each folder records are being written to, by its scope: kept while a run's records go there or an append to it is not settled, then
   * let go, so nothing is held for a turn whose run has ended. A past turn's folder is looked up again when it is read.
   */
  const open = new Map<string, Open>();
  /** Each run going on, by RPH's id for it, from its records: where the live hub tells it (its chat, or `LIVE_JOBS`) and the folder its records go to; let go when the run ends. */
  const going = new Map<string, { to: string; key: string }>();
  const pending = new Set<Promise<unknown>>();

  const keyOf = (scope: RunScope): string => JSON.stringify([scope.user, scope.chat ?? null, scope.session, scope.turn ?? null]);
  const lookup = (scope: RunScope): Promise<string | null> => (scope.turn === undefined ? deps.files.sessionDisk(scope) : deps.files.turnDisk(scope));
  const release = (key: string): void => {
    const at = open.get(key);
    if (at !== undefined && at.runs.size === 0 && at.writes === 0) open.delete(key);
  };

  /**
   * Follows which runs are going on, and where: a turn's run ends with its `run_ended`, a job's with the view that says it ended. A
   * record about no agent is no run's (the host's word: a session's change, a session-close hook), never started or ended: nothing
   * is held for it.
   */
  const follow = (record: TraceRecord, to: string, key: string, at: Open): void => {
    if (record.agent === undefined) return;
    const { event } = record;
    const ended = event.kind === "run_ended" ? record.run : event.kind === "job" && event.job.ended !== undefined ? event.job.id : null;
    if (ended === null) {
      going.set(record.run, { to, key });
      at.runs.add(record.run);
      return;
    }
    const was = going.get(ended);
    going.delete(ended);
    at.runs.delete(ended);
    if (was !== undefined && was.key !== key) {
      open.get(was.key)?.runs.delete(ended);
      release(was.key);
    }
  };

  const keep = (record: TraceRecord, key: string, at: Open): void => {
    at.writes++;
    const next = at.tail.then(async () => {
      const folder = await at.folder;
      if (folder === null) return;
      await mkdir(folder, { recursive: true });
      await appendFile(join(folder, TURN_TRACE), `${JSON.stringify(withoutTraffic(record))}\n`, "utf8");
    });
    at.tail = next.catch(() => undefined);
    const done = next
      .catch((error: unknown) => deps.log.error("A trace record could not be kept in the turn's folder.", { run: record.run, error: error instanceof Error ? error.message : String(error) }))
      .finally(() => {
        at.writes--;
        release(key);
      });
    pending.add(done);
    void done.finally(() => pending.delete(done));
  };

  return {
    event(record) {
      deps.runs.record(record);
      const { scope } = record;
      const to = scope.chat ?? LIVE_JOBS;
      const key = keyOf(scope);
      let at = open.get(key);
      if (at === undefined) {
        at = { folder: lookup(scope), tail: Promise.resolve(), runs: new Set(), writes: 0 };
        open.set(key, at);
      }
      follow(record, to, key, at);
      deps.live.publish(to, { kind: "trace", data: record });
      keep(record, key, at);
    },
    delta(delta: TraceDelta) {
      deps.runs.delta(delta);
      const to = going.get(delta.run)?.to;
      if (to !== undefined) deps.live.publish(to, { kind: "delta", data: delta });
    },
    async flush() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
    held() {
      return { folders: open.size, runs: going.size, writes: pending.size };
    },
    async records(scope) {
      while (pending.size > 0) await Promise.allSettled([...pending]);
      const folder = await (open.get(keyOf(scope))?.folder ?? lookup(scope));
      // No folder, or no record kept yet: the run has not begun.
      if (folder === null) return [];
      const kept = (await readLines(folder, TURN_TRACE, (row) => typeof row.seq === "number" && isRecord(row.event), deps.log)) as unknown as TraceRecord[];
      // Each agent's transcript the trace's traffic is in, read once.
      const names = [...new Set(kept.flatMap((record) => (isTraffic(record) ? [transcriptName(record.agent)] : [])))];
      const transcripts = new Map(await Promise.all(names.map(async (name) => [name, await transcriptLines(folder, name, deps.log)] as const)));
      return kept
        .map((record) => (isTraffic(record) ? withTraffic(record, transcripts.get(transcriptName(record.agent)) ?? NO_LINES) : record))
        .sort((a, b) => a.at - b.at || a.seq - b.seq);
    },
  };
}
