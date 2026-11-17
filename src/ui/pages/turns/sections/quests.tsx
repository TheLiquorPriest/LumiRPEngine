import type { TurnReply } from "../../../../shared/api";
import { Badge, Button } from "../../../../frontend/components";
import type { TurnSection } from "../types";

/** The open quests the turn touched, each opening on the Quests page. */
export function TouchedQuests(props: { quests: TurnReply["quests"]; onOpen?: (id: string) => void }) {
  return (
    <ul class="rpe-plain lre-stack" data-touched-quests>
      {props.quests.map((q) => (
        <li key={q.id} class="rpe-line" data-quest={q.id}>
          <span class="rpe-strong">{q.name}</span> <Badge>{q.kind}</Badge>{" "}
          {props.onOpen === undefined ? null : (
            <Button size="sm" variant="ghost" onClick={() => props.onOpen?.(q.id)}>
              Open it
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export const section: TurnSection = {
  id: "quests",
  order: 108,
  title: "Quests it touched",
  spoiler: true,
  body: ({ turn, onOpenQuest }) => (turn.quests.length === 0 ? null : <TouchedQuests quests={turn.quests} onOpen={onOpenQuest} />),
};
