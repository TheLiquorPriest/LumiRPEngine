import { Badge } from "../../../../frontend/components";
import type { TurnSection } from "../types";

/** The threads the turn opened or wrote anything of that stay open, with their words, their state and their stakes as the story record holds them at the turn. */
export const section: TurnSection = {
  id: "threads",
  order: 109,
  title: "Threads it left open",
  spoiler: true,
  body: ({ turn }) =>
    turn.threads.length === 0 ? null : (
      <ul class="rpe-plain lre-stack" data-open-threads>
        {turn.threads.map((t) => (
          <li key={t.id} class="rpe-entry" data-thread={t.id}>
            <p class="rpe-line">
              {t.text ?? <span class="lre-muted">no words written</span>} {t.state === null ? null : <Badge>{t.state}</Badge>}
            </p>
            {t.stakes === null ? null : <p class="rpe-meta">At stake: {t.stakes}</p>}
          </li>
        ))}
      </ul>
    ),
};
