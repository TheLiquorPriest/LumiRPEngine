import type { StageReading, StageTurn } from "../../../../shared/api";
import { Badge } from "../../../../frontend/components";
import { counted } from "../../../words";
import type { TurnSection } from "../types";

/** How the stage was read for the turn, in words: the page says which it was, so a turn with no scene is a plain record. */
export const STAGE_WORDS: Readonly<Record<StageReading, string>> = {
  scene: "Read from the open scene and from who the world's state places in its place.",
  owner: "No scene was recorded, so the stage was read from where your character stands.",
  none: "No scene and no place of your character was recorded, so no stage was read.",
};

/**
 * Who was on stage and who of them has a perception of the turn: plain record, with the ones who have none marked. A turn the migration
 * carried owes none: the page says the previous build played it, and gives each one's old mind files instead of a gap.
 */
export function Perceptions(props: { stage: StageTurn }) {
  const { stage } = props;
  const none = stage.carried ? [] : stage.people.filter((p) => p.perceptions.length === 0);
  return (
    <div class="lre-stack" data-perceptions data-read={stage.read} data-carried-stage={stage.carried ? "yes" : "no"}>
      {stage.carried ? (
        <p class="rpe-line" data-carried-words>
          The previous build played this turn, and the migration carried it, so no perception is owed for it. What its characters took from it came with them as their old mind files, which their agents are given whole until those are filed.
        </p>
      ) : null}
      <p class="rpe-line" data-stage-read>{STAGE_WORDS[stage.read]}</p>
      {stage.people.length === 0 ? (
        <p class="lre-muted rpe-line">Nobody was on stage.</p>
      ) : (
        <ul class="rpe-plain lre-stack">
          {stage.people.map((p) => (
            <li key={p.name} class="rpe-line" data-person={p.name} data-perceived={p.perceptions.length > 0 ? "yes" : stage.carried ? "carried" : "no"}>
              <span class="rpe-strong">{p.name}</span> {p.casting === null ? null : <Badge>{p.casting}</Badge>}{" "}
              {p.perceptions.length > 0 ? counted(p.perceptions.length, "perception") : stage.carried ? null : <Badge tone="warn">none</Badge>}
              {p.character === null ? (
                <span class="rpe-meta"> · the cast holds no character by that name</span>
              ) : stage.carried ? (
                <span class="rpe-meta" data-files>
                  {" · "}
                  {p.files.length === 0 ? "no old mind files were carried with them" : `old mind files carried: ${p.files.map((f) => `${f.name} (${f.filed ? "filed" : "not filed yet"})`).join(", ")}`}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {none.length === 0 || stage.people.length === 0 ? null : <p class="rpe-meta" data-none>{counted(none.length, "person", "people")} on stage with no perception of this turn: {none.map((p) => p.name).join(", ")}.</p>}
    </div>
  );
}

export const section: TurnSection = {
  id: "perceptions",
  order: 105,
  title: "Who perceived the turn",
  spoiler: false,
  body: ({ stage }) => (stage === undefined || stage === null ? null : <Perceptions stage={stage} />),
};
