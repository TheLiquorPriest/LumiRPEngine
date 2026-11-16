import type { TurnSection } from "../types";

/** The tools its agents reached through `tool_search` and `tool_use` in the turn, by name. */
export const section: TurnSection = {
  id: "found",
  order: 66,
  title: "Tools it found",
  spoiler: false,
  body: ({ turn }) =>
    turn.found.length === 0 ? null : (
      <ul class="rpe-files" data-found>
        {turn.found.map((name) => (
          <li key={name}>
            <code class="lre-id">{name}</code>
          </li>
        ))}
      </ul>
    ),
};
