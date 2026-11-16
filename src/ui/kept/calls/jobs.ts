// Build's jobs on RPE's typed routes (plan §4.4, §14; PlanChatUI-B2 item 5): today's `lre.job` (list a world's jobs, start one, cancel, dismiss) goes
// to the job routes, and the answer comes back as today's result body. A change of a job told on RPE's live feed (kind `build_job`, the user's own
// channel) is today's `lre.job.update`, which the Tools list, the job page and the review hear as before.

import type { RequestBody } from "../../../frontend/registry";
import type { LiveEvent } from "../../../shared/api";
import type { JobKind, JobResult, JobSummary } from "../../../shared/jobs";
import { PROTOCOL_VERSION, type ResultBodies } from "../../../shared/protocol";
import type { CallContext, CallFile, ServedBody } from "../client";
import { Refusal } from "../client";

async function job(request: Extract<RequestBody, { type: "lre.job" }>, ctx: CallContext): Promise<ResultBodies["lre.job"]> {
  const call = ctx.client.call;
  switch (request.op) {
    case "list": {
      const answer = await call("GET /api/v1/build/jobs", {}, { query: { world: request.worldId } });
      return { jobs: answer.jobs as unknown as JobSummary[] };
    }
    case "start": {
      const answer = await call("POST /api/v1/build/jobs", {}, { body: { world: request.worldId, kind: request.kind, input: request.input } });
      return { jobId: answer.job };
    }
    case "cancel":
      await call("POST /api/v1/build/jobs/:job/cancel", { job: request.jobId });
      return {};
    case "dismiss":
      await call("DELETE /api/v1/build/jobs/:job", { job: request.jobId });
      return {};
    default:
      throw new Refusal("bad_request", "the op is start, cancel, list or dismiss");
  }
}

export const calls: CallFile = {
  name: "jobs",
  takes: (request) => request.type === "lre.job",
  async serve(request, ctx): Promise<ServedBody> {
    if (request.type !== "lre.job") throw new Refusal("internal", `The jobs calls do not take ${request.type}.`);
    return await job(request, ctx);
  },
  live(event: LiveEvent): readonly unknown[] {
    if (event.kind !== "build_job") return [];
    const { jobId, kind, status, progress, message, result } = event.data;
    // A job read back as interrupted ended without a word of its own: it is told as a failure, as the job page words it.
    return [
      {
        lre: PROTOCOL_VERSION,
        type: "lre.job.update",
        jobId,
        kind: kind as JobKind,
        status: status === "interrupted" ? "failed" : status,
        progress,
        ...(message === undefined ? {} : { message }),
        ...(result === undefined ? {} : { result: result as unknown as JobResult }),
      },
    ];
  },
};

