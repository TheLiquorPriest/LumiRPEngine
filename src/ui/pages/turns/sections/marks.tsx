import type { TurnMark } from "../../../../shared/api";
import { when } from "../../../words";
import type { TurnSection } from "../types";

/** What a mark on a turn says, in words: why this turn is not as plainly its run as the others; the message it concerns where one is named. */
export function markWords(mark: Pick<TurnMark, "kind" | "message">): string {
  const on = mark.message === null ? "" : ` (message ${mark.message})`;
  if (mark.kind === "interrupted") return `RPE restarted while a run of this turn went on; what it had staged was dropped${on}.`;
  if (mark.kind === "saved-otherwise") return `What Lumiverse saved is not what was released, beyond the prefill in front and a continue's join${on}.`;
  if (mark.kind === "edited-reply") return `This turn's reply was edited in the chat after it was saved${on}; the Author is told the text before and after at the next turn.`;
  if (mark.kind === "edited-message") return `A message this turn stands on was edited after it was played${on}.`;
  return `A message was inserted before the one this turn stands on, after it was played${on}.`;
}

/** A mark's kind as a turn's row in the chat's list badges it; its words are the badge's title. */
export const MARK_BADGES: Readonly<Record<TurnMark["kind"], string>> = {
  interrupted: "interrupted",
  "saved-otherwise": "saved otherwise",
  "edited-reply": "edited",
  "edited-message": "an earlier message edited",
  "inserted-message": "a message inserted before it",
};

export const section: TurnSection = {
  id: "marks",
  order: 5,
  title: "Marks on this turn",
  spoiler: false,
  body: ({ turn }) =>
    turn.marks.length === 0 ? null : (
      <ul class="rpe-plain lre-stack" data-marks>
        {turn.marks.map((mark, i) => (
          <li key={i} class="rpe-line" data-mark={mark.kind}>
            {markWords(mark)} <span class="rpe-meta">{when(mark.at)}</span>
          </li>
        ))}
      </ul>
    ),
};
