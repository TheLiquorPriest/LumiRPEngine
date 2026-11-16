// A job carried from today's `jobs.json` (plan §15.2; PlanChatUI-B2 items 1, 7): written as an ended job with what it had, its proposals still to
// review. A job the file kept as running had been cut off by a stop: it reads as interrupted, as any job found running is. The write takes the
// migration's own database, inside its transaction, and replaces the job of the same id.

import type { Database } from "bun:sqlite";
import type { UserId } from "../../shared/ids";
import type { JobSummary } from "../../shared/protocol";
import { interruptedMessage } from "./home";

export function writeCarriedJob(db: Database, user: UserId, job: JobSummary): void {
  const status = job.status === "running" ? "interrupted" : job.status;
  db.query("INSERT OR REPLACE INTO build_job (user, id, kind, world, status, progress, message, input, result, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    user,
    job.jobId,
    job.kind,
    job.worldId,
    status,
    job.progress,
    job.status === "running" ? interruptedMessage(job) : (job.message ?? null),
    JSON.stringify(job.input),
    job.result === undefined ? null : JSON.stringify(job.result),
    job.at,
  );
}
