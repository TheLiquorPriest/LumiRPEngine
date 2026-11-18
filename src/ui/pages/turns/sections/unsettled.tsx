import { ChangeLine, UNSETTLED_WORDS } from "../changes";
import type { TurnSection } from "../types";

/** What the turn left unsettled, as the turn's route lists it: each change of it, and each placed after it before the next turn, with what it is about and why it is listed. */
export const section: TurnSection = {
  id: "unsettled",
  order: 120,
  title: "Unsettled",
  spoiler: true,
  body: ({ turn }) =>
    turn.unsettled.length === 0 ? null : (
      <ul class="rpe-plain lre-stack" data-unsettled>
        {turn.unsettled.map(({ change, lane, about, why, turn: of }) => (
          <li key={change.id} class="lre-stack">
            <ChangeLine change={change} lane={lane} why={why.map((w) => UNSETTLED_WORDS[w])} />
            {about.length === 0 ? null : <p class="rpe-meta">It is about {about.join(", ")}.</p>}
            {of === null ? <p class="rpe-meta">Placed after the turn, as your own change.</p> : of === turn.id ? null : <p class="rpe-meta">Of turn {of}.</p>}
          </li>
        ))}
      </ul>
    ),
};
