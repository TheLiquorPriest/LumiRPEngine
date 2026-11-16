// RPE's trace port (`TracePort` in `rp-harness/contract`): everything RPH does goes to the live hub, on
// the chat the run is played in, and is kept in the turn's folder (plan §5.3 `transcripts/`) in one file
// of its own, `trace.jsonl`, each record as RPH gave it, for the Turn page and a live view that joins
// late. Each agent's own transcript there, and each request kept beside it, has one writer, RPH: this
// port writes none of them. Streaming text goes to the live hub only; the call's `call_ended` holds it
// whole. A piece of streaming text names only its run, by RPH's own id for it: its chat is the one its
// run's records name, each run's first record coming before any piece of it.

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Log, Scope, TraceDelta, TracePort, TraceRecord } from "rp-harness/contract";
import type { LiveHub } from "../app";
import { isRecord } from "../shared/json";
import type { TreeFiles } from "../tree";
import type { RunTimes } from "./spans";

/** The turn folder's transcripts, where the trace is kept beside them. */
export const TRANSCRIPTS = "transcripts";

/** The trace's file in `transcripts/`: no agent's transcript is named so (RPH names each `<definition>-<handle>`). */
export const TRACE_FILE = "trace.jsonl";

export interface TraceDeps {
  live: LiveHub;
  files: TreeFiles;
  /** The turn's runs, given every record and piece as it comes: they take RPH's own id for each of theirs, and the times of its lead's writing (`spans.ts`). */
  runs: Pick<RunTimes, "record" | "delta">;
  log: Log;
}

export interface TurnTrace extends TracePort {
  /** Every record kept for a scope's turn so far, in the order RPH gave them. */
  records(scope: Scope): Promise<TraceRecord[]>;
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
  /** Each run going on, by RPH's id for it, from its records: its chat and the folder its records go to; let go when the run ends. */
  const going = new Map<string, { chat: string; key: string }>();
  const pending = new Set<Promise<unknown>>();

  const keyOf = (scope: Scope): string => JSON.stringify([scope.user, scope.chat, scope.session, scope.turn ?? null]);
  const lookup = (scope: Scope): Promise<string | null> => (scope.turn === undefined ? deps.files.sessionDisk(scope) : deps.files.turnDisk(scope));
  const release = (key: string): void => {
    const at = open.get(key);
    if (at !== undefined && at.runs.size === 0 && at.writes === 0) open.delete(key);
  };

  /** Follows which runs are going on, and where: a turn's run ends with its `run_ended`, a job's with the view that says it ended. */
  const follow = (record: TraceRecord, key: string, at: Open): void => {
    const { event } = record;
    const ended = event.kind === "run_ended" ? record.run : event.kind === "job" && event.job.ended !== undefined ? event.job.id : null;
    if (ended === null) {
      going.set(record.run, { chat: record.scope.chat, key });
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
      await mkdir(join(folder, TRANSCRIPTS), { recursive: true });
      await appendFile(join(folder, TRANSCRIPTS, TRACE_FILE), `${JSON.stringify(record)}\n`, "utf8");
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
      const key = keyOf(record.scope);
      let at = open.get(key);
      if (at === undefined) {
        at = { folder: lookup(record.scope), tail: Promise.resolve(), runs: new Set(), writes: 0 };
        open.set(key, at);
      }
      follow(record, key, at);
      deps.runs.record(record);
      deps.live.publish(record.scope.chat, { kind: "trace", data: record });
      keep(record, key, at);
    },
    delta(delta: TraceDelta) {
      deps.runs.delta(delta);
      const chat = going.get(delta.run)?.chat;
      if (chat !== undefined) deps.live.publish(chat, { kind: "delta", data: delta });
    },
    async flush() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
    async records(scope) {
      while (pending.size > 0) await Promise.allSettled([...pending]);
      const folder = await (open.get(keyOf(scope))?.folder ?? lookup(scope));
      if (folder === null) return [];
      const out: TraceRecord[] = [];
      const file = Bun.file(join(folder, TRANSCRIPTS, TRACE_FILE));
      // No record was kept yet: the run has not begun.
      if (!(await file.exists())) return [];
      // A line torn by a crash, or written over, costs that line: the rest of the trace is read, and the log says how many were passed over.
      let unreadable = 0;
      for (const line of (await file.text()).split("\n")) {
        if (line.trim() === "") continue;
        try {
          const record: unknown = JSON.parse(line);
          if (isRecord(record) && typeof record.seq === "number" && isRecord(record.event)) out.push(record as unknown as TraceRecord);
          else unreadable++;
        } catch {
          unreadable++;
        }
      }
      if (unreadable > 0) deps.log.warn("Lines of a turn's trace could not be read and were left out of it.", { file: join(TRANSCRIPTS, TRACE_FILE), lines: unreadable });
      return out.sort((a, b) => a.at - b.at || a.seq - b.seq);
    },
  };
}
