// How a bootstrap job shows in the jobs' lists and on its own page (plan §12, PlanPages-35): marked as one, with the token limit at which it asks, and its
// brief, which is the skill's whole text, folded under the skill's name instead of printed.

import type { JobView } from "../../../shared/api";
import { Badge, Disclosure, Pre } from "../../../frontend/components";
import { num } from "../../words";

/** The attachment a bootstrap job is given by name, which marks it as one. */
const BOOTSTRAP_ATTACH = "bootstrap:job";

/** Whether a job is a chat's bootstrap job, by what its start gave it. */
export function isBootstrapJob(job: JobView): boolean {
  return job.attach?.includes(BOOTSTRAP_ATTACH) === true;
}

/** A bootstrap job's mark in the list and, where it has one, the token limit at which it asks. */
export function BootstrapMark(props: { job: JobView }) {
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
