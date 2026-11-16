// The jobs' table (plan §14, PlanChatUI-B2): each job Build ran or is running, by user, with its status, its progress, its input and its result
// (a model job's proposals as each chunk is read), so Build still shows them after a reload or a restart. A job that was running when RPE stopped is
// read back as interrupted (`home.ts`).

import type { Migration } from "../../app/migrations";

export const JOB_MIGRATION: Migration = {
  version: 2,
  name: "Build's jobs",
  sql: `CREATE TABLE build_job (
  user TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  world TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL NOT NULL,
  message TEXT,
  input TEXT NOT NULL,
  result TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (user, id)
) WITHOUT ROWID;
CREATE INDEX build_job_world ON build_job (user, world, at)`,
};
