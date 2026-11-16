import type { TurnReply } from "../../../../shared/api";
import type { TurnSection } from "../types";

/** What a continue's tie came to be: the message Lumiverse names when the generation ends is the tie; the tag's target is only a first word. */
function tieWords(run: TurnReply["runs"][number], message: string | null): string | null {
  if (run.kind !== "continue") return null;
  if (message === null) return run.target === null ? "Where it goes on from was not known when it began, and is not yet tied." : `Its tag named message ${run.target}; Lumiverse has not yet named the message it was saved in.`;
  if (run.target === null) return `Its tag did not know which message it went on from; the target was learned at the end: message ${message}.`;
  if (run.target !== message) return `Its tag named message ${run.target}, and the end named message ${message}: it is tied to ${message}.`;
  return null;
}

export const section: TurnSection = {
  id: "continued",
  order: 35,
  title: "Where a continue went on from",
  spoiler: false,
  body: ({ turn }) => {
    const lines = turn.runs.flatMap((run) => {
      const words = tieWords(run, turn.message);
      return words === null ? [] : [{ run, words }];
    });
    if (lines.length === 0) return null;
    return (
      <ul class="rpe-plain lre-stack" data-continued>
        {lines.map(({ run, words }) => (
          <li key={run.id} class="rpe-line">
            {turn.runs.length > 1 ? `Run ${run.nth}: ` : ""}
            {words}
          </li>
        ))}
      </ul>
    );
  },
};
