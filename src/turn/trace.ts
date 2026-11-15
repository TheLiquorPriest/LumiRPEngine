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

export function turnTrace(deps: TraceDeps): TurnTrace {
  /** Each turn folder's place on disk, once found. */
  const folders = new Map<string, Promise<string | null>>();
  const pending = new Set<Promise<unknown>>();
  /** Appends to one file run in the order given. */
  const tails = new Map<string, Promise<unknown>>();
  /** The chat of each run going on, by RPH's id for the run, from its records; let go when the run ends. */
  const chats = new Map<string, string>();

  /** Follows which runs are going on, and where: a turn's run ends with its `run_ended`, a job's with the view that says it ended. */
  const follow = (record: TraceRecord): void => {
    const { event } = record;
    if (event.kind === "run_ended") chats.delete(record.run);
    else if (event.kind === "job" && event.job.ended !== undefined) chats.delete(event.job.id);
    else chats.set(record.run, record.scope.chat);
  };

  const folderOf = (scope: Scope): Promise<string | null> => {
    const key = JSON.stringify([scope.user, scope.chat, scope.session, scope.turn ?? null]);
    let found = folders.get(key);
    if (found === undefined) {
      found = scope.turn === undefined ? deps.files.sessionDisk(scope) : deps.files.turnDisk(scope);
      folders.set(key, found);
    }
    return found;
  };

  const keep = (record: TraceRecord): void => {
    const done = (async () => {
      const folder = await folderOf(record.scope);
      if (folder === null) return;
      const file = join(folder, TRANSCRIPTS, TRACE_FILE);
      const before = tails.get(file) ?? Promise.resolve();
      const next = before.then(async () => {
        await mkdir(join(folder, TRANSCRIPTS), { recursive: true });
        await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
      });
      tails.set(file, next.catch(() => undefined));
      await next;
    })().catch((error: unknown) => deps.log.error("A trace record could not be kept in the turn's folder.", { run: record.run, error: error instanceof Error ? error.message : String(error) }));
    pending.add(done);
    void done.finally(() => pending.delete(done));
  };

  return {
    event(record) {
      follow(record);
      deps.runs.record(record);
      deps.live.publish(record.scope.chat, { kind: "trace", data: record });
      keep(record);
    },
    delta(delta: TraceDelta) {
      deps.runs.delta(delta);
      const chat = chats.get(delta.run);
      if (chat !== undefined) deps.live.publish(chat, { kind: "delta", data: delta });
    },
    async flush() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
    async records(scope) {
      while (pending.size > 0) await Promise.allSettled([...pending]);
      const folder = await folderOf(scope);
      if (folder === null) return [];
      const out: TraceRecord[] = [];
      const file = Bun.file(join(folder, TRANSCRIPTS, TRACE_FILE));
      // No record was kept yet: the run has not begun.
      if (!(await file.exists())) return [];
      // A line torn by a crash, or written over, costs that line: the rest of the trace is read.
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
