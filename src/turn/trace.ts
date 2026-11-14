// RPE's trace port (`TracePort` in `rp-harness/contract`): everything RPH does goes to the live hub, on
// the chat the run is played in, and into the turn's folder (plan §5.3 `transcripts/`): one file of
// JSON lines per agent, each record as RPH gave it. Streaming text goes to the live hub only; the
// call's `call_ended` holds it whole.

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Log, Scope, TraceDelta, TracePort, TraceRecord } from "rp-harness/contract";
import type { LiveHub } from "../app";
import type { JsonValue } from "../shared/json";
import type { TreeFiles } from "../tree";

/** The turn folder's transcripts. */
export const TRANSCRIPTS = "transcripts";

/** An agent's transcript file in the turn folder: its definition and its handle, as a file name. */
export function transcriptName(agent: { id: string; definition: string }): string {
  return `${`${agent.definition}-${agent.id}`.replace(/[^A-Za-z0-9_-]/g, "-")}.jsonl`;
}

export interface TraceDeps {
  live: LiveHub;
  files: TreeFiles;
  /** The chat a run is played in, for a piece of streaming text, which names only its run. */
  chatOfRun(run: string): string | null;
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
      const file = join(folder, TRANSCRIPTS, transcriptName(record.agent));
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
      deps.live.publish(record.scope.chat, { kind: "trace", data: record as unknown as JsonValue });
      keep(record);
    },
    delta(delta: TraceDelta) {
      const chat = deps.chatOfRun(delta.run);
      if (chat !== null) deps.live.publish(chat, { kind: "delta", data: delta as unknown as JsonValue });
    },
    async flush() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
    async records(scope) {
      while (pending.size > 0) await Promise.allSettled([...pending]);
      const folder = await folderOf(scope);
      if (folder === null) return [];
      const out: TraceRecord[] = [];
      const glob = new Bun.Glob("*.jsonl");
      const names: string[] = [];
      try {
        for await (const name of glob.scan({ cwd: join(folder, TRANSCRIPTS), onlyFiles: true })) names.push(name);
      } catch {
        // No record was kept yet: the run has not begun.
        return [];
      }
      for (const name of names) {
        const text = await Bun.file(join(folder, TRANSCRIPTS, name)).text();
        for (const line of text.split("\n")) if (line.trim() !== "") out.push(JSON.parse(line) as TraceRecord);
      }
      return out.sort((a, b) => a.at - b.at || a.seq - b.seq);
    },
  };
}
