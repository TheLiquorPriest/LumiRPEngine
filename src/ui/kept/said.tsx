// What a kept page says once, above the view: RPE's own words for a request it does not serve yet that
// the page asked for, and an Undo's sentence (app.ts, `said`).

import { Banner } from "../../frontend/components";
import { type Readable, useSelect } from "../store";

export function Said(props: { said: Readable<readonly string[]> }) {
  const said = useSelect(props.said, (all) => all);
  if (said.length === 0) return null;
  return (
    <div class="lre-stack" data-rpe-said>
      {said.map((sentence) => (
        <Banner key={sentence} tone="info" icon="info">
          {sentence}
        </Banner>
      ))}
    </div>
  );
}
