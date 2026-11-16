// The player's journal (plan §8.3, §14 Quests, scenario 31): each quest he may see, drawn from the Author's records and cut by what each quest lets him
// see: the whole quest, or only its name and the stages named, or nothing, and a quest that shows him nothing is absent, with no count. It stands
// outside the spoiler gate, because the route gives only what he may see; the stage's condition is left to the record behind the gate.

import type { Journal, JournalQuestRow, QuestStageRow } from "../../../shared/api";
import { Badge, Banner, Row, Section } from "../../atoms";
import { counted } from "../../words";

export const KIND_WORDS: Readonly<Record<JournalQuestRow["kind"], string>> = { quest: "quest", secret: "secret", puzzle: "puzzle", agenda: "agenda" };

/** What was called on a stage, in words; a stage nothing was called on is open to be. */
export function stageWords(stage: Pick<QuestStageRow, "state" | "why" | "current">): string {
  const state = stage.state === "met" ? "met" : stage.state === "failed" ? "failed" : stage.state === "open" ? "open" : "not called on yet";
  return `${state}${stage.current === true ? ", where it stands now" : ""}${stage.why === null || stage.why === "" ? "" : `: ${stage.why}`}`;
}

export function StageList(props: { stages: readonly QuestStageRow[]; withCondition?: boolean }) {
  return (
    <ol class="rpe-plain lre-stack" data-stages>
      {props.stages.map((stage) => (
        <li key={stage.id} data-stage={stage.id} data-state={stage.state ?? "none"}>
          <p class="rpe-line">
            <strong>{stage.label}</strong>{" "}
            <Badge tone={stage.state === "met" ? "pos" : stage.state === "failed" ? "neg" : undefined}>{stage.state ?? "not called on"}</Badge>
          </p>
          {props.withCondition === true ? <p class="rpe-meta" data-condition>It moves on when: {stage.condition}</p> : null}
          <p class="rpe-meta">{stageWords(stage)}</p>
        </li>
      ))}
    </ol>
  );
}

function JournalQuest(props: { quest: JournalQuestRow }) {
  const { quest } = props;
  return (
    <li class="rpe-entry lre-stack" data-journal-quest={quest.id} data-whole={quest.whole ? "yes" : "no"}>
      <p class="rpe-line">
        <strong>{quest.name}</strong> <Badge>{KIND_WORDS[quest.kind]}</Badge> {quest.closed === null ? <Badge tone="accent">open</Badge> : <Badge tone="warn">closed</Badge>}
      </p>
      {quest.closed === null ? null : (
        <p class="rpe-meta" data-closed>
          Closed: {quest.closed.outcome}
          {quest.closed.why === null ? "" : `. ${quest.closed.why}`}
        </p>
      )}
      {quest.whole ? (
        <div class="lre-stack">
          {quest.objective === null ? null : <Row label="What it is" value={quest.objective} />}
          {quest.why === null ? null : <Row label="Why it matters" value={quest.why} />}
          {quest.stakes === null ? null : <Row label="What is at stake" value={quest.stakes} />}
          {quest.rewards === null ? null : <Row label="What it may give" value={quest.rewards} />}
        </div>
      ) : (
        <p class="lre-muted rpe-meta" data-stages-only>Only its name and the stages named are shown to him.</p>
      )}
      {quest.stages.length === 0 ? null : <StageList stages={quest.stages} />}
    </li>
  );
}

export function JournalView(props: { journal: Journal | null; loading: boolean; problem: string | null }) {
  const { journal } = props;
  return (
    <Section id="journal" title="What he sees in his journal">
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The journal could not be read">
          <span>{props.problem}</span>
        </Banner>
      )}
      {journal === null ? (
        props.loading ? <p class="lre-muted rpe-line">Reading the journal…</p> : null
      ) : journal.quests.length === 0 ? (
        <p class="lre-muted rpe-line" data-journal-none>His journal holds no quest yet.</p>
      ) : (
        <>
          <p class="rpe-meta" data-journal-open>{counted(journal.open, "quest")} open in it. A quest set to show him nothing is not here, and not counted.</p>
          <ul class="rpe-plain lre-stack" data-journal>
            {journal.quests.map((quest) => (
              <JournalQuest key={quest.id} quest={quest} />
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
