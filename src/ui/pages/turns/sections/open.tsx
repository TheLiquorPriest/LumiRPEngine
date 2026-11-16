import type { JsonValue } from "../../../../shared/api";
import { valueWords } from "../changes";
import type { TurnSection } from "../types";

/** What the Author's record says it means to do next, where it says. */
function nextOf(record: { [key: string]: JsonValue } | null): string | null {
  const next = record?.next;
  return next === undefined || next === null || next === "" ? null : valueWords(next);
}

export const section: TurnSection = {
  id: "open",
  order: 110,
  title: "What is still open",
  spoiler: true,
  body: ({ turn }) => {
    const next = nextOf(turn.record);
    const reported = turn.changes.flatMap((l) => l.changes.filter((c) => c.reports.length > 0).map((c) => ({ lane: l.lane, change: c })));
    const todos = turn.todos.filter((t) => t.open.length > 0);
    if (next === null && reported.length === 0 && todos.length === 0) return null;
    return (
      <div class="lre-stack" data-open>
        {next === null ? null : (
          <p class="rpe-line" data-open-next>
            <span class="rpe-strong">Next, by its record:</span> {next}
          </p>
        )}
        {reported.length === 0 ? null : (
          <div class="lre-stack">
            <span class="rpe-caption">Not adding up</span>
            <ul class="rpe-reports">
              {reported.map(({ lane, change }) => (
                <li key={change.id}>
                  {lane} lane, {change.op} {valueWords(change.value)}: {change.reports.map((r) => r.code).join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}
        {todos.map((t) => (
          <div key={t.agent} class="lre-stack" data-todo-of={t.agent}>
            <span class="rpe-caption">{`${t.agent}'s open todo items`}</span>
            <ul class="rpe-reports">
              {t.open.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  },
};
