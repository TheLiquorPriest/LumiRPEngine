import type { CarriedTurnReply } from "../../../../shared/api";
import { Badge, Pre, Row } from "../../../../frontend/components";
import { valueWords } from "../changes";
import type { TurnSection } from "../types";

export const ENGINE_WORDS: Readonly<Record<NonNullable<CarriedTurnReply["engine"]>, string>> = { classic: "the classic engine", agents: "the agents engine", harness: "the earlier harness" };

/** What an old engine recorded on a reply the migration carried: the engine that played the chat, why no turn was played, where the reply says something against its turn, each part of the record as it was, and every text it names word for word. */
export function CarriedRecord(props: { carried: CarriedTurnReply }) {
  const c = props.carried;
  return (
    <div class="lre-stack" data-carried={c.turn}>
      <Row k="Played by" v={c.engine === null ? <span class="lre-muted">the engine was not read</span> : <Badge>{ENGINE_WORDS[c.engine]}</Badge>} />
      {c.unplayed === null ? null : <Row k="Why no turn was played" v={c.unplayed} />}
      {c.departures.length === 0 ? null : (
        <div class="lre-stack" data-departures>
          <span class="rpe-caption">Where the reply says something against its turn</span>
          <ul class="rpe-plain lre-stack">
            {c.departures.map((line, i) => (
              <li key={i} class="rpe-line">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.fields.length === 0 ? <p class="lre-muted rpe-line">The old record holds no part.</p> : null}
      {c.fields.map((f) => (
        <div key={f.name} class="lre-stack" data-part={f.name}>
          <span class="rpe-caption">{f.name}</span>
          <Pre text={valueWords(f.value)} />
        </div>
      ))}
      {c.texts.map((t) => (
        <div key={`${t.part}:${t.path}`} class="lre-stack" data-text={t.path}>
          <span class="rpe-caption">
            {t.part}: {t.path}
          </span>
          {t.text === null ? <p class="lre-muted rpe-line">The previous build's clean-up had removed this text.</p> : <Pre text={t.text} mono={false} />}
        </div>
      ))}
    </div>
  );
}

export const section: TurnSection = {
  id: "carried",
  order: 106,
  title: "What the old engine recorded",
  spoiler: true,
  body: ({ turn, review }) => {
    if (turn.carried === null) return null;
    if (review?.carried === null || review === undefined) return <p class="lre-muted rpe-line">{review?.problem ?? "Reading the old record…"}</p>;
    return <CarriedRecord carried={review.carried} />;
  },
};
