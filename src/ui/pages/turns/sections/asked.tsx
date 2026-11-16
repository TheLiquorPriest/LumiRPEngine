import { when } from "../../../words";
import { askedWords } from "../parts";
import type { TurnSection } from "../types";

/** What the player asked for beside his words, with the composer's controls or a panel, as the turn was told it. */
export const section: TurnSection = {
  id: "asked",
  order: 45,
  title: "What you asked for",
  spoiler: false,
  body: ({ turn }) =>
    turn.asked.length === 0 ? null : (
      <ul class="rpe-plain lre-stack" data-asked>
        {turn.asked.map((line) => (
          <li key={line.id} class="rpe-entry">
            <p class="rpe-line">{askedWords(line)}</p>
            <p class="rpe-meta">
              {when(line.at)}
              {line.played ? ", played now as a message of its own" : ""}
            </p>
          </li>
        ))}
      </ul>
    ),
};
