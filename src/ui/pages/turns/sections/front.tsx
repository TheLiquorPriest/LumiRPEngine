import { NO_NOTICES, promptNoticeWords } from "../../../notice-words";
import { counted } from "../../../words";
import type { TurnSection } from "../types";

/** How much of the prompt's front was the same as the turn before and which part broke it, and what changed in the prompt's shape, in the notices file's words. */
export const section: TurnSection = {
  id: "front",
  order: 56,
  title: "The prompt's front, and what changed in it",
  spoiler: false,
  body: ({ turn, notices }) => {
    const prompt = turn.prompt;
    if (prompt === null) return null;
    const { front } = prompt;
    return (
      <div class="lre-stack" data-front-report>
        <p class="rpe-line" data-front>
          {front.brokenBy === undefined ? `The whole of the prompt's front held (${counted(front.length, "character")}).` : `The prompt's front held for ${counted(front.length, "character")}; the part marked ${front.brokenBy} broke it.`}
        </p>
        {prompt.notices.length === 0 ? null : (
          <ul class="rpe-reports" data-prompt-notices>
            {prompt.notices.map((notice, i) => (
              <li key={i}>{promptNoticeWords(notices ?? NO_NOTICES, notice)}</li>
            ))}
          </ul>
        )}
      </div>
    );
  },
};
