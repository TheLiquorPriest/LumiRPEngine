// Whether a connection keeps the reply's tags (plan §18.1): the newest check it had (kept in so many of so many turns, on which model, when),
// the reply form it gets, whether the check set it, a control that sets the form for it (the setting the Settings page writes), and "Check the tags",
// which starts the check as a job. RPH's refusal of the job (jobs off, no model, the part missing) is worded here, not hidden.

import type { ConnectionShown, TagCheck, TagCheckStarted } from "../../../shared/api";
import { Badge, Button } from "../../../frontend/components";
import { when } from "../../words";
import { refusalWords } from "../jobs/words";

/** One connection's tag check as the page holds it: asking, the job it started, RPH's refusal or the page's problem, and what a form it set said. */
export interface TagCheckState {
  busy: boolean;
  job: string | null;
  refusal: string | null;
  said: string | null;
}

export const NO_TAG_STATE: TagCheckState = { busy: false, job: null, refusal: null, said: null };

export type ReplyForm = TagCheck["form"];

export const FORM_WORDS: Readonly<Record<ReplyForm, string>> = { tags: "tags", "two-step": "two steps" };

/** The settings key that holds one connection's reply form. */
export function formKey(connection: string): string {
  return `reply.forms.${connection}`;
}

/** What a check found, in a line; none was made when `check` is null. */
export function tagCheckWords(check: TagCheck | null | undefined): string {
  if (check === null || check === undefined) return "Its tags have not been checked.";
  return `It kept the tags in ${check.kept} of ${check.tried} turns (${check.needed} needed), on ${check.model}, ${when(check.at)}: its reply form is ${FORM_WORDS[check.form]}${check.set ? ", and the check set that for it" : ", and the check did not set it"}.`;
}

/** What RPE answered to the start of a check: the job it started, or RPH's refusal in words. */
export function startedState(answer: TagCheckStarted): TagCheckState {
  return "job" in answer ? { ...NO_TAG_STATE, job: answer.job.id } : { ...NO_TAG_STATE, refusal: refusalWords(answer.refusal) };
}

export function TagCheckShown(props: { view: ConnectionShown; state: TagCheckState | undefined; onCheck(id: string): void; onForm(id: string, form: ReplyForm): void }) {
  const { view } = props;
  const state = props.state ?? NO_TAG_STATE;
  const check = view.tagCheck ?? null;
  return (
    <div class="lre-stack" data-tag-check={view.id}>
      <p class="rpe-meta" data-tag-words>
        {check === null ? <Badge>not checked</Badge> : <Badge tone={check.form === "tags" ? "pos" : "warn"}>{FORM_WORDS[check.form]}</Badge>} {tagCheckWords(check)}
      </p>
      <div class="lre-inline rpe-wrap">
        <Button size="sm" variant="ghost" busy={state.busy} onClick={() => props.onCheck(view.id)}>
          Check the tags
        </Button>
        <Button size="sm" variant="ghost" onClick={() => props.onForm(view.id, "tags")}>
          Use tags
        </Button>
        <Button size="sm" variant="ghost" onClick={() => props.onForm(view.id, "two-step")}>
          Use two steps
        </Button>
      </div>
      {state.job === null ? null : (
        <p class="rpe-meta" data-started>
          The check is job {state.job}; its result shows here when it ends.
        </p>
      )}
      {state.said === null ? null : <p class="rpe-meta" data-said>{state.said}</p>}
      {state.refusal === null ? null : <p class="rpe-meta" data-refusal>{state.refusal}</p>}
    </div>
  );
}
