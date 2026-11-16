import { ChangeLine, unsettledWhy } from "../changes";
import type { TurnSection } from "../types";

export const section: TurnSection = {
  id: "unsettled",
  order: 120,
  title: "Unsettled",
  spoiler: true,
  body: ({ turn }) => {
    const listed = turn.changes.flatMap((l) => l.changes.map((change) => ({ lane: l.lane, change, why: unsettledWhy(change, turn.told) })).filter((c) => c.why.length > 0));
    if (listed.length === 0) return null;
    return (
      <ul class="rpe-plain lre-stack" data-unsettled>
        {listed.map(({ lane, change, why }) => (
          <ChangeLine key={change.id} change={change} lane={lane} why={why} />
        ))}
      </ul>
    );
  },
};
