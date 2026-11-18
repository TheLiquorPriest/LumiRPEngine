// What a job recorded, listed with the job and kept until he undoes it (plan §12, §10.9, §6.3; R-26, R-27,
// R-29). Every writer records a job's call through the store's one write target (`writeTarget`): a job
// an agent started records with its starting turn, a job he started (no turn) as his own changes of the
// chat, with the job, which take effect before the first turn that begins after the job ends and stay
// when turns are swiped or deleted. These routes list what one job recorded, change by change, with its
// source, what it cites and whether it applied, beside the job's evidence (the gap checks and consents
// it was told, `toldRows`), and which later change of his undid each; and undo one change of it, or all
// of it, as his own (the store's `undo`: the changes reversing it are recorded at the chat's head,
// citing what they undo; nothing recorded is taken away).

import type { JobView } from "rp-harness/contract";
import { route, RouteError, shape } from "../app";
import type { ChangeRow } from "../store";
import { toldRows } from "./events";
import type { Turns } from "./lane";
import { report, undoAnswer, undoReply } from "./review";
import { toldShown } from "./shapes";

const T = shape.text();
const nullable = shape.nullable;

const jobChange = shape.named(
  "JobChange",
  "One change a job recorded: its id, its lane and operation, its value, who decided it, where it came from, how sure it is, what it cites, whether it applied, its reports, and the changes of his that undid it.",
  shape.object({
    id: T,
    lane: T,
    op: T,
    value: shape.json(),
    by: nullable(T),
    source: nullable(T),
    standing: nullable(T),
    precision: nullable(T),
    cite: shape.json(),
    applied: shape.yesNo(),
    reports: shape.list(report),
    undoneBy: shape.list(T),
  }),
);

const jobChangesReply = shape.named(
  "JobChangesReply",
  "What a job recorded, change by change in the order recorded, and the evidence it was told as it went (its gap checks, consents and rules fired).",
  shape.object({ job: T, changes: shape.list(jobChange), told: toldShown }),
);

export function ownerJobRoutes(turns: Turns) {
  /** The user's job by id; a 404 for one he has none by. */
  const jobOf = async (user: string, id: string): Promise<JobView> => {
    const job = await turns.harness.jobs.get(user, id);
    if (job === undefined) throw new RouteError(404, `There is no job ${id}.`);
    return job;
  };

  /** What the job recorded, in the order recorded: with the turn that started it, or among his own changes of its chat; none for a job of no chat. */
  const recorded = (user: string, job: JobView): ChangeRow[] => {
    const { scope } = job;
    if (scope.chat === undefined) return [];
    const s = turns.store.user(user);
    return (scope.turn !== undefined ? s.changes(scope.turn) : s.ownerChanges(scope.chat)).filter((c) => c.job === job.id);
  };

  /** Each of `ids` with the changes of his that undid it (`cite.undoes`). */
  const undoneBy = (user: string, ids: readonly number[]): Map<number, string[]> => {
    const by = new Map<number, string[]>();
    if (ids.length === 0) return by;
    const rows = turns.store.db
      .query<{ id: number; undoes: number }, [string, string]>(
        "SELECT id, json_extract(cite, '$.undoes') AS undoes FROM change WHERE user = ? AND json_extract(cite, '$.undoes') IN (SELECT value FROM json_each(?)) ORDER BY id",
      )
      .all(user, JSON.stringify(ids));
    for (const r of rows) by.set(r.undoes, [...(by.get(r.undoes) ?? []), String(r.id)]);
    return by;
  };

  return [
    route({
      method: "GET",
      path: "/api/v1/jobs/:job/changes",
      access: "page",
      group: "jobs",
      does: "What a job recorded, change by change, with its source, what it cites, whether it applied and what undid it, beside the gap checks, consents and rules the job was told.",
      reply: jobChangesReply,
      handle: async ({ user, params }) => {
        const job = await jobOf(user, params.job);
        const changes = recorded(user, job);
        const undone = undoneBy(
          user,
          changes.map((c) => c.id),
        );
        const { db } = turns.store;
        const of = { job: job.id };
        return {
          job: job.id,
          changes: changes.map((c) => ({
            id: String(c.id),
            lane: c.lane,
            op: c.op,
            value: c.value,
            by: c.by,
            source: c.source,
            standing: c.standing,
            precision: c.precision,
            cite: c.cite,
            applied: c.applied,
            reports: c.reports,
            undoneBy: undone.get(c.id) ?? [],
          })),
          told: {
            gapChecks: toldRows(db, user, "gap-check", of).map((r) => ({ check: r.body, at: r.at })),
            consents: toldRows(db, user, "consent", of).map((r) => ({ grant: r.body, at: r.at })),
            rules: toldRows(db, user, "rule", of).map((r) => ({ firing: r.body, at: r.at })),
            attachments: [],
            dropped: [],
          },
        };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/jobs/:job/changes/:change/undo",
      access: "page",
      group: "jobs",
      does: "Undoes one change a job recorded, as his own: the changes reversing it are recorded at the chat's head, citing it. Says what was recorded and what is left, as report codes and in the play answers' words.",
      reply: undoReply,
      handle: async ({ user, params }) => {
        const job = await jobOf(user, params.job);
        const id = Number(params.change);
        if (!Number.isInteger(id) || !recorded(user, job).some((c) => c.id === id)) throw new RouteError(404, `Job ${job.id} recorded no change ${params.change}.`);
        const s = turns.store.user(user);
        const undone = await turns.writes.run(() => s.undo(id), "undoing a change a job recorded");
        return await undoAnswer(undone);
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/jobs/:job/undo",
      access: "page",
      group: "jobs",
      does: "Undoes all a job recorded that no change of his undid yet, the newest first, as his own. Says what was recorded and what is left, as report codes and in the play answers' words.",
      reply: undoReply,
      handle: async ({ user, params }) => {
        const job = await jobOf(user, params.job);
        const changes = recorded(user, job);
        const undone = undoneBy(
          user,
          changes.map((c) => c.id),
        );
        const ids = changes
          .filter((c) => !undone.has(c.id))
          .map((c) => c.id)
          .reverse();
        const s = turns.store.user(user);
        const done = await turns.writes.run(() => s.undo(ids), "undoing all a job recorded");
        return await undoAnswer(done);
      },
    }),
  ] as const;
}
