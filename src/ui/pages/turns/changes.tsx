// A turn's changes as the Turn page lists them: each with its operation and values, who made it, how exact
// and how sure it is, where it came from, and what it reported; and why one is "unsettled". Shared by the
// lanes, what is still open and the unsettled list.

import type { TurnChange } from "../../../shared/api";
import { Badge } from "../../atoms";
import { marksWords } from "../../marks";
import type { TurnReply } from "../../../shared/api";

/** A value as a line: a text as it is, anything else as compact JSON. */
export function valueWords(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "";
}

/** One change: its operation and values, whether it applied, who made it and where it came from, and what it reported. */
export function ChangeLine(props: { change: TurnChange; lane?: string; why?: readonly string[] }) {
  const { change } = props;
  return (
    <li class="rpe-entry" data-change={change.id}>
      <p class="rpe-line">
        <span class="rpe-strong">{change.op}</span> {valueWords(change.value)} {change.applied ? null : <Badge tone="warn">not applied</Badge>}
        {props.lane === undefined ? null : <Badge>{props.lane}</Badge>}
      </p>
      <p class="rpe-meta">
        {marksWords(change)}
        {change.by === null ? "" : `, by ${change.by}`}
        {change.job === null ? "" : `, in job ${change.job}`}
      </p>
      {change.reports.length === 0 ? null : (
        <ul class="rpe-reports">
          {change.reports.map((report, i) => (
            <li key={i}>
              {report.code}
              {report.values === undefined ? "" : `: ${valueWords(report.values)}`}
            </li>
          ))}
        </ul>
      )}
      {props.why === undefined || props.why.length === 0 ? null : <p class="rpe-meta">Listed because it {props.why.join(", and ")}.</p>}
    </li>
  );
}

/** Why a change is listed as unsettled: it carries a report, did not apply, has no source, or is an invention with no gap check or consent in the turn's told list; none where it is settled. */
export function unsettledWhy(change: TurnChange, told: TurnReply["told"]): string[] {
  const why: string[] = [];
  if (change.reports.length > 0) why.push("carries a report");
  if (!change.applied) why.push("was not applied");
  if (change.source === null) why.push("has no source");
  if (change.source === "invented" && told.gapChecks.length === 0 && told.consents.length === 0) why.push("is an invention with no gap check or consent");
  return why;
}
