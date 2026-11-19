// How a bootstrap job shows in the jobs' lists and on its own page (plan §12, PlanPages-35): marked as one, with the token limit at which it asks, and its
// brief, which is the skill's whole text, folded under the skill's name instead of printed; in a list, named by what it is.

import type { JobRow, JobView } from "../../../shared/api";
import { Badge, Disclosure, Pre } from "../../../frontend/components";
import { cut, num } from "../../words";

/** The attachment a bootstrap job is given by name, which marks it as one. */
const BOOTSTRAP_ATTACH = "bootstrap:job";

/** Whether a job is a chat's bootstrap job, by what its start gave it. */
export function isBootstrapJob(job: Pick<JobRow, "attach">): boolean {
  return job.attach?.includes(BOOTSTRAP_ATTACH) === true;
}

/** A job's brief in a list: the start of what it was asked, cut at `chars`; a bootstrap job's, the skill's whole text, by what it is. */
export function briefLine(job: Pick<JobRow, "attach" | "brief">, chars: number): string {
  return isBootstrapJob(job) ? "the bootstrap skill's text" : cut(job.brief, chars);
}

/** A bootstrap job's mark in the list and, where it has one, the token limit at which it asks. */
export function BootstrapMark(props: { job: Pick<JobRow, "limits"> }) {
  const { askAt } = props.job.limits ?? {};
  return (
    <>
      <Badge tone="accent">bootstrap</Badge>
      {askAt === undefined ? null : <Badge title="The tokens at which this job asks whether to go on">asks at {num(askAt)}</Badge>}
    </>
  );
}

/** A bootstrap job's brief is the skill's whole text: folded under the skill's name. */
export function BootstrapBrief(props: { job: JobView }) {
  const { brief } = props.job;
  return (
    <Disclosure summary="The bootstrap skill's text, its brief" class="rpe-open">
      {brief === "" ? <p class="lre-muted rpe-line">The skill is switched off: the job was given no brief.</p> : <Pre text={brief} mono={false} />}
    </Disclosure>
  );
}
