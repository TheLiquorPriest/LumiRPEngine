// RPE's record of its own last run (plan §4.4 the `service` group, §14 Runtime): when it started, on which build, and how that run ended,
// kept in the data folder beside the database, so that the next start can say in the log why it began. A run that ends on a restart you
// asked for, an update or a stop writes how before the process goes; one that was killed, ran out of memory or lost the machine writes
// nothing, and the next start says that it ended without saying why. The log's first line is that start, so a page that reads the log
// after RPE restarted finds what happened at its oldest end.

import { join } from "node:path";
import type { JsonValue } from "../shared/json";
import { readText, writeWhole } from "./disk";

/** The file in the data folder's root. */
export const RUN_FILE = "last-run.json";

/** How a run ended, when it ended as it chose to: a restart asked from the Runtime page, an update onto another build, a stop, or a failure. */
export type Ending = { why: "restart"; at: number } | { why: "update"; at: number; to: string } | { why: "stop"; at: number } | { why: "failed"; at: number; error: string };

/** What a run asks of its end: how it is ending, before the time is known. */
export type EndingAsk = { why: "restart" } | { why: "update"; to: string } | { why: "stop" } | { why: "failed"; error: string };

/** A run: the build it ran, when it started, and how it ended (null while it runs, and for one that did not say). */
export interface RunRecord {
  build: string;
  started: number;
  ending: Ending | null;
}

/** The last run's record; null where there is none, or what is there is not one. */
export async function readRun(root: string): Promise<RunRecord | null> {
  const text = await readText(join(root, RUN_FILE));
  if (text === null) return null;
  try {
    const found: unknown = JSON.parse(text);
    if (typeof found !== "object" || found === null) return null;
    const { build, started, ending } = found as Record<string, unknown>;
    if (typeof build !== "string" || typeof started !== "number") return null;
    return { build, started, ending: isEnding(ending) ? ending : null };
  } catch {
    return null;
  }
}

function isEnding(value: unknown): value is Ending {
  if (typeof value !== "object" || value === null) return false;
  const { why, at, to, error } = value as Record<string, unknown>;
  if (typeof at !== "number") return false;
  return why === "restart" || why === "stop" || (why === "update" && typeof to === "string") || (why === "failed" && typeof error === "string");
}

/** This run begins: its record is written, ending with nothing yet. */
export async function beginRun(root: string, build: string, started: number): Promise<void> {
  await writeWhole(join(root, RUN_FILE), `${JSON.stringify({ build, started, ending: null } satisfies RunRecord)}\n`);
}

/** This run ends as `ending` says, at `at`: put in its record, if it is still the one written. */
export async function endRun(root: string, ending: EndingAsk, at: number): Promise<void> {
  const run = await readRun(root);
  if (run === null) return;
  await writeWhole(join(root, RUN_FILE), `${JSON.stringify({ ...run, ending: { ...ending, at } } satisfies RunRecord)}\n`);
}

/**
 * The line that opens the log of a run: when it started is the line's own time; which build, and why it started, in words to the person who
 * reads the Runtime page, from how the run before it ended (`previous`), and whether RPE's service started it (`service`).
 */
export function startedLine(previous: RunRecord | null, build: string, service: boolean): { message: string; fields: Record<string, JsonValue> } {
  const head = `RPE started on build ${build}`;
  const by = service ? ", started by its service," : "";
  if (previous === null) return { message: `${head}. It holds no record of an earlier run on this data folder, so this is its first start here.`, fields: { build, why: "first start" } };
  const earlier: Record<string, JsonValue> = { build, previousBuild: previous.build, previousStarted: previous.started };
  const ending = previous.ending;
  if (ending === null) {
    return {
      message: `${head}${by} after its last run, on build ${previous.build}, ended without saying why: it was killed, ran out of memory, or the machine stopped.`,
      fields: { ...earlier, why: "the last run ended without saying why", service },
    };
  }
  switch (ending.why) {
    case "restart":
      return { message: `${head}, after the restart you asked for.`, fields: { ...earlier, why: "a restart you asked for", service } };
    case "update":
      return { message: `${head}, after an update from build ${previous.build}.`, fields: { ...earlier, why: "an update", service } };
    case "stop":
      return { message: `${head}${by} after it was stopped.`, fields: { ...earlier, why: "it was stopped", service } };
    case "failed":
      return { message: `${head}${by} after its last run, on build ${previous.build}, failed: ${ending.error}`, fields: { ...earlier, why: "the last run failed", service, ended: ending.error } };
  }
}
