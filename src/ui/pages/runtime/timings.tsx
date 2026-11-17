// Where the time goes (plan §4.4 the `service` group, §4.7, §14 Runtime): for a chat or for every chat, each part of a turn
// (intake's steps, the wait for the turn before, the first word, the release, the end) with how many of the latest turns
// it was seen in, its middle time, the slowest and the latest. Time is reported here and gates nothing.

import type { ServiceTimings } from "../../../shared/api";
import { Banner, Button, Section } from "../../../frontend/components";
import { counted, duration } from "../../words";

export interface TimingsViewProps {
  timings: ServiceTimings | null;
  loading: boolean;
  problem: string | null;
  /** The chat the page is on, offered as the scope beside every chat; null where it is on none. */
  chat: string | null;
  /** Whether the timings are of that chat alone. */
  ofChat: boolean;
  onScope(ofChat: boolean): void;
}

export function TimingsView(props: TimingsViewProps) {
  const { timings } = props;
  return (
    <Section
      id="timings"
      title="Where the time goes"
      aside={
        props.chat === null ? undefined : (
          <div class="lre-inline">
            <Button size="sm" variant="ghost" current={!props.ofChat} onClick={() => props.onScope(false)}>
              Every chat
            </Button>
            <Button size="sm" variant="ghost" current={props.ofChat} onClick={() => props.onScope(true)}>
              This chat
            </Button>
          </div>
        )
      }
    >
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The timings could not be read">
          <span>{props.problem}</span>
        </Banner>
      )}
      {timings === null ? (
        props.problem === null ? <p class="lre-muted rpe-line">Reading the timings…</p> : null
      ) : timings.parts.length === 0 ? (
        <p class="lre-muted rpe-line" data-timings-empty>No turn has been timed yet.</p>
      ) : (
        <>
          <p class="rpe-meta">Over the latest {counted(timings.turns, "turn")}; a part is counted in the turns it began and ended in.</p>
          <div class="rpe-timings" data-timings>
            <div class="rpe-timings-row rpe-timings-head" aria-hidden="true">
              <span>Part</span>
              <span>Turns</span>
              <span>Middle</span>
              <span>Slowest</span>
              <span>Latest</span>
            </div>
            {timings.parts.map((p) => (
              <div key={p.part} class="rpe-timings-row" data-part={p.part}>
                <span class="rpe-timings-part">{p.part}</span>
                <span data-cell="turns"><span class="rpe-timings-label">in </span>{p.turns}<span class="rpe-timings-label"> turns</span></span>
                <span data-cell="median"><span class="rpe-timings-label">middle </span>{duration(p.median)}</span>
                <span data-cell="slowest"><span class="rpe-timings-label">slowest </span>{duration(p.slowest)}</span>
                <span data-cell="latest"><span class="rpe-timings-label">latest </span>{duration(p.latest)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}
