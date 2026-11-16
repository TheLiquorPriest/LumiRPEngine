import { duration } from "../../../words";
import type { TurnSection } from "../types";

/** A reply asked for whole (the preset's streaming switched off) cannot be kept alive past ten minutes: where a run was held, the page says so and at what time its limit was held, under ten minutes. */
export const section: TurnSection = {
  id: "whole",
  order: 58,
  title: "A reply asked for whole",
  spoiler: false,
  body: ({ turn }) => {
    const held = turn.runs.flatMap((run) => (run.stoppedBy !== null && "hold" in run.stoppedBy ? [{ run, hold: run.stoppedBy.hold }] : []));
    if (held.length === 0) return null;
    return (
      <div class="lre-stack" data-whole>
        {held.map(({ run, hold }) => (
          <p key={run.id} class="rpe-line">
            {turn.runs.length > 1 ? `Run ${run.nth}: ` : ""}
            This reply was asked for whole, the preset's streaming being off, and the chat application ends a generation that has shown nothing for ten minutes. The turn's limit on time was held under that, at {duration(hold)} from the request's arrival, and the run stopped there with what it had.
          </p>
        ))}
      </div>
    );
  },
};
