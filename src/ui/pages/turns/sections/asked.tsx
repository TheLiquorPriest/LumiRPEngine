import { when } from "../../../words";
import { askedWords, feedbackOf, settledWords } from "../parts";
import type { TurnSection } from "../types";

/** What the player asked for beside his words, with the composer's controls or a panel, as the turn was told it; for a swipe or a regenerate, the feedback he typed in Lumiverse's own dialog, where it was told apart, or the word that it was not. */
export const section: TurnSection = {
  id: "asked",
  order: 45,
  title: "What you asked for",
  spoiler: false,
  body: ({ turn }) => {
    const again = turn.kind === "swipe" || turn.kind === "regenerate";
    const separated = turn.asked.some((line) => feedbackOf(line) !== null);
    if (turn.asked.length === 0 && !again) return null;
    return (
      <div class="lre-stack">
        {turn.asked.length === 0 ? null : (
          <ul class="rpe-plain lre-stack" data-asked>
            {turn.asked.map((line) => {
              const feedback = feedbackOf(line);
              return (
                <li key={line.id} class="rpe-entry" data-feedback={feedback === null ? undefined : ""}>
                  <p class="rpe-line">{askedWords(line)}</p>
                  <p class="rpe-meta">
                    {when(line.at)}
                    {line.played ? ", played now as a message of its own" : ""}
                    {feedback === null ? "" : `: ${settledWords(feedback)}`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {again && !separated ? (
          <p class="rpe-meta" data-feedback-unseparated>
            No feedback was told apart for this attempt. If you typed any in Lumiverse's own dialog, it stands inside your last line of the prompt as Lumiverse put it.
          </p>
        ) : null}
      </div>
    );
  },
};
