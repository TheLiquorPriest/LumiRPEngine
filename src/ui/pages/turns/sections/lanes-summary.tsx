import type { TurnReply } from "../../../../shared/api";
import { Badge } from "../../../../frontend/components";
import { counted } from "../../../words";
import type { TurnSection } from "../types";

/** The two lanes every turn is asked to write to: the story, and the engine. */
export const LANES: readonly { lane: string; words: string }[] = [
  { lane: "story", words: "The story lane" },
  { lane: "engine", words: "The engine lane" },
];

/** How many changes the turn made in a lane. */
export function laneCount(turn: TurnReply, lane: string): number {
  return turn.changes.find((l) => l.lane === lane)?.changes.length ?? 0;
}

/** The count of each lane, always both, so an engine that was ignored shows at a glance. */
function LaneSummary(props: { turn: TurnReply }) {
  return (
    <div class="lre-stack" data-lanes-summary>
      {LANES.map(({ lane, words }) => {
        const n = laneCount(props.turn, lane);
        return (
          <p key={lane} class="rpe-line" data-lane-count={lane}>
            <span class="rpe-strong">{words}</span> {n === 0 ? <Badge tone={lane === "engine" ? "warn" : undefined}>{lane === "engine" ? "nothing changed in the engine" : "no change"}</Badge> : counted(n, "change")}
          </p>
        );
      })}
    </div>
  );
}

export const section: TurnSection = { id: "lanes-summary", order: 100, title: "Changes by lane", spoiler: false, body: ({ turn }) => <LaneSummary turn={turn} /> };
