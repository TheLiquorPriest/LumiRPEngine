// His jobs of LumiAH's (STANDALONE-PLAN §15.2, "Approvals and jobs": carried as history): each job's document under `harness/docs/jobs/`, with its
// task whole, its report and its transcript from the blob store, goes into RPE's job history marked carried, where the Jobs page lists it
// beside RPE's own. The migration may not import the turn lane, so the lane's writer (`carryJob`, `src/turn/jobs.ts`) is handed in. A job
// that never finished (queued, running, paused, interrupted, off the path) is carried as cancelled, with what it had written; one that stopped
// at a limit as ended. A job of a chat this run did not carry stays in the backup. A job is put on the turn it belonged to: LumiAH names that
// turn by its generation (`basis`: the turn whose agent started the job), and the carried reply whose record holds that generation, its own or a
// Continue's, is the turn; a job he started himself, or one whose generation left no reply, belongs to the chat alone. A chat's earlier carried
// jobs go first, so a later run puts each on the turns it made then. The approvals he kept for a chat are carried with the turns (`turn-things.ts`).

import type { Database } from "bun:sqlite";
import { isRecord } from "../shared/json";
import type { UserStore } from "../store";
import { importedTurns, pathTurns } from "./history";
import { blobPath } from "./inside";
import type { Item } from "./report";
import type { Today } from "./today";
import { recHarnessOf } from "./today/harness-record";

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
  /** Of those carried, the jobs put on the turn they belonged to; the rest belong to the chat alone (a job he started, or one whose turn left no reply). */
  onTurn: number;
}

const ENDED: Readonly<Record<string, CarriedJobRow["state"]>> = { done: "ended", spent: "ended", failed: "failed", cancelled: "cancelled" };

const num = (value: unknown, otherwise: number): number => (typeof value === "number" && Number.isFinite(value) ? value : otherwise);

/** The turn each generation a chat's carried replies name is the reply of: a reply's own and each Continue's, by the generation's id; those of the turns a branch shares with the chat it was made from too. */
function turnsOfGenerations(db: Database, s: UserStore, chat: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const { turn, record } of [...importedTurns(db, s, chat), ...pathTurns(db, s, chat)]) {
    const harness = recHarnessOf(record);
    if (harness === null) continue;
    const own = harness.record?.generationId;
    for (const generation of [...harness.turns, ...(typeof own === "string" && own !== "" ? [own] : [])]) if (!out.has(generation)) out.set(generation, turn.id);
  }
  return out;
}

/** Carries his jobs of the chats `chats` into the job history through `keep`. */
export async function carryJobs(input: { today: Today; items: readonly Item[]; db: Database; s: UserStore; user: string; chats: ReadonlySet<string>; keep: KeepCarriedJob | undefined }): Promise<JobsCarried> {
  const { today, db, s, user, keep } = input;
  const out: JobsCarried = { written: keep !== undefined, carried: 0, left: 0, unfinished: 0, onTurn: 0 };
  const docs = input.items.filter((i) => i.where === "user storage" && i.row === "approvals-jobs" && i.fate === "carried" && /^harness\/docs\/jobs\/[^/]+\.json$/.test(i.path));
  if (keep === undefined) return out;
  // What an earlier run carried of these chats' jobs goes first: its turns were replaced with the chats', so each job is put on the turn it has now.
  for (const chat of input.chats) db.run("DELETE FROM job WHERE user = ? AND chat = ? AND value IS NOT NULL AND json_extract(value, '$.carried') = 1", [user, chat]);
  const generations = new Map<string, Map<string, string>>();
  const blob = async (hash: unknown): Promise<string | null> => (typeof hash === "string" && hash !== "" ? today.userView.read(blobPath("harness", hash)) : null);
  for (const item of docs) {
    const doc = await today.userView.json(item.path);
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
    const chatTurns = generations.get(job.chatId) ?? turnsOfGenerations(db, s, job.chatId);
    generations.set(job.chatId, chatTurns);
    const turn = typeof job.basis === "string" ? (chatTurns.get(job.basis) ?? null) : null;
    const report = (await blob(job.report)) ?? (typeof job.reason === "string" ? job.reason : null);
    const transcript = await blob(job.transcript);
    const row: CarriedJobRow = {
      id: job.id,
      chat: job.chatId,
      turn,
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
    if (turn !== null) out.onTurn++;
  }
  return out;
}
