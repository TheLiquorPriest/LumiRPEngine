import { ChangeLine } from "../changes";
import type { TurnSection } from "../types";
import { LANES } from "./lanes-summary";

export const section: TurnSection = {
  id: "lanes",
  order: 101,
  title: "The changes, lane by lane",
  spoiler: true,
  body: ({ turn }) => {
    const extra = turn.changes.filter((l) => !LANES.some((known) => known.lane === l.lane)).map((l) => ({ lane: l.lane, words: `The ${l.lane} lane` }));
    return (
      <div class="lre-stack">
        {[...LANES, ...extra].map(({ lane, words }) => {
          const changes = turn.changes.find((l) => l.lane === lane)?.changes ?? [];
          return (
            <div key={lane} class="lre-stack" data-lane={lane}>
              <span class="rpe-caption">{words}</span>
              {changes.length === 0 ? (
                <p class="rpe-meta">{lane === "engine" ? "This turn changed nothing in the engine." : `This turn changed nothing in the ${lane} lane.`}</p>
              ) : (
                <ul class="rpe-plain lre-stack">
                  {changes.map((change) => (
                    <ChangeLine key={change.id} change={change} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    );
  },
};
