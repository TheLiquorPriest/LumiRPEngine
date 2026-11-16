// His jobs of LumiAH's (STANDALONE-PLAN §15.2, "Approvals and jobs": carried as history): each job's document under `harness/docs/jobs/`, with its
// task whole, its report and its transcript from the blob store, goes into RPE's job history marked carried, where the Jobs page lists it
// beside RPE's own. The migration may not import the turn lane, so the lane's writer (`carryJob`, `src/turn/jobs.ts`) is handed in. A job
// that never finished (queued, running, paused, interrupted, off the path) is carried as cancelled, with what it had written; one that stopped
// at a limit as ended. A job of a chat this run did not carry stays in the backup. A job belongs to no turn here: LumiAH names the generation
// it started in, which RPE has no turn for. The approvals he kept for a chat are carried with the turns (`turn-things.ts`).

import type { Database } from "bun:sqlite";
import { isRecord } from "../shared/json";
import { blobPath } from "./inside";
import type { Item } from "./report";
import type { Today } from "./today";

/** One job as the turn lane's writer takes it. */
export interface CarriedJobRow {
  id: string;
  chat: string;
  turn: string | null;
  agent: string;
  brief: string;
  state: "ended" | "failed" | "cancelled";
  startedBy: "user" | { agent: string; role: string };
  started: number;
  ended: number;
  usage: { tokensIn: number; tokensOut: number; calls?: number };
  report: string | null;
  transcript: string | null;
}

/** The turn lane's writer of a carried job (`carryJob`), inside the caller's write. */
export type KeepCarriedJob = (db: Database, user: string, job: CarriedJobRow) => void;

/** What a run did with his jobs. */
export interface JobsCarried {
  /** False: the run was not given the turn lane's writer of a carried job, and his jobs are in the backup only. */
  written: boolean;
  /** Jobs put into the job history. */
  carried: number;
  /** Jobs of a chat this run did not carry, and documents that are no job: in the backup only. */
  left: number;
  /** Jobs that had not finished and are carried as cancelled. */
  unfinished: number;
}

const ENDED: Readonly<Record<string, CarriedJobRow["state"]>> = { done: "ended", spent: "ended", failed: "failed", cancelled: "cancelled" };

const num = (value: unknown, otherwise: number): number => (typeof value === "number" && Number.isFinite(value) ? value : otherwise);

/** Carries his jobs of the chats `chats` into the job history through `keep`. */
export async function carryJobs(input: { today: Today; items: readonly Item[]; db: Database; user: string; chats: ReadonlySet<string>; keep: KeepCarriedJob | undefined }): Promise<JobsCarried> {
  const { today, db, user, keep } = input;
  const out: JobsCarried = { written: keep !== undefined, carried: 0, left: 0, unfinished: 0 };
  const docs = input.items.filter((i) => i.where === "user storage" && i.row === "approvals-jobs" && i.fate === "carried" && /^harness\/docs\/jobs\/[^/]+\.json$/.test(i.path));
  if (keep === undefined) return out;
  const blob = async (hash: unknown): Promise<string | null> => (typeof hash === "string" && hash !== "" ? today.userView.read(blobPath("harness", hash)) : null);
  for (const item of docs) {
    let doc: unknown = null;
    try {
      doc = JSON.parse((await today.userView.read(item.path)) ?? "null");
    } catch {
      doc = null;
    }
    const job = isRecord(doc) && doc.kind === "job" && isRecord(doc.job) ? doc.job : null;
    const task = isRecord(doc) && typeof doc.task === "string" ? doc.task : null;
    if (job === null || task === null || typeof job.id !== "string" || typeof job.chatId !== "string" || !input.chats.has(job.chatId)) {
      out.left++;
      continue;
    }
    const finished = typeof job.state === "string" && Object.hasOwn(ENDED, job.state);
    const state = finished ? (ENDED[job.state as string] as CarriedJobRow["state"]) : "cancelled";
    if (!finished) out.unfinished++;
    const by = isRecord(job.by) && job.by.who === "agent" ? { agent: typeof job.by.id === "string" ? job.by.id : "", role: typeof job.by.role === "string" ? job.by.role : "" } : "user";
    const usage = isRecord(job.usage) ? job.usage : {};
    const created = num(job.createdAt, 0);
    const report = (await blob(job.report)) ?? (typeof job.reason === "string" ? job.reason : null);
    const transcript = await blob(job.transcript);
    const row: CarriedJobRow = {
      id: job.id,
      chat: job.chatId,
      turn: null,
      agent: typeof job.agent === "string" ? job.agent : "",
      brief: task,
      state,
      startedBy: by,
      started: num(job.startedAt, created),
      ended: num(job.endedAt, num(job.startedAt, created)),
      usage: { tokensIn: num(usage.in, 0), tokensOut: num(usage.out, 0), calls: num(usage.calls, 0) },
      report,
      transcript,
    };
    db.transaction(() => keep(db, user, row))();
    out.carried++;
  }
  return out;
}
