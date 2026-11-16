import { Badge } from "../../../atoms";
import { valueWords } from "../changes";
import { askedWords } from "../parts";
import type { TurnSection } from "../types";

/** The Author's record of the turn, every field as it wrote it, its decision line first where it has one; what was asked for stands beside it. */
export const section: TurnSection = {
  id: "record",
  order: 62,
  title: "The Author's record of the turn",
  spoiler: true,
  body: ({ turn }) => {
    const record = turn.record;
    if (record === null) return null;
    const keys = Object.keys(record).sort((a, b) => Number(/decision/i.test(b)) - Number(/decision/i.test(a)));
    return (
      <div class="lre-stack" data-record>
        {turn.asked.length === 0 ? null : (
          <p class="rpe-meta">
            Asked for: {turn.asked.map(askedWords).join("; ")}
          </p>
        )}
        <dl class="rpe-fields">
          {keys.map((key) => (
            <div key={key} class="rpe-field" data-field={key}>
              <dt>{key}</dt>
              <dd>
                {/decision/i.test(key) ? <Badge tone="gm">decision</Badge> : null} {valueWords(record[key])}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  },
};
