// What a stage's parse didn't keep of a model's answer as the model wrote it (the raw-against-saved
// audit, `shared/misread.ts`): each field by its path, with what the answer said there and what it
// was read as, then the answer itself where it was kept. GM → Depth → Turn shows it under a model
// call, the Bootstrap view on a spot-check card.

import { misreadText, type Misread } from "../../shared/misread";
import { Disclosure } from "../components";

/** A call's misread fields (`count` in all, the first listed), and the answer as written, folded, where given. */
export function MisreadFields(props: { fields: readonly Misread[]; count: number; raw?: string }) {
  const { fields, count } = props;
  return (
    <div class="lre-stack" data-lre-depth-misread={count}>
      <p class="lre-small">{`The parser didn't keep ${count} ${count === 1 ? "field" : "fields"} of this answer as written:`}</p>
      <ul class="lre-small">
        {fields.map((m, i) => (
          <li key={i}>{misreadText(m)}</li>
        ))}
      </ul>
      {count > fields.length ? <p class="lre-small lre-muted">{`…and ${count - fields.length} more.`}</p> : null}
      {props.raw !== undefined ? (
        <Disclosure summary="The answer as the model wrote it">
          <pre class="lre-section-text" tabIndex={0}>
            {props.raw}
          </pre>
        </Disclosure>
      ) : null}
    </div>
  );
}
