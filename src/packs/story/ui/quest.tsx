// The quest sheet (contract §4.3): one track of the quest log as the POV knows it: where it
// stands (its current stage and cue), what the POV has learned, its objectives, n of m done, and
// its hints behind "Show a hint". The engine releases hints one per failed attempt, so every hint
// in the view is earned; the sheet only keeps them out of sight until asked. A track isn't an
// entity, so opening it observes nothing new.

import { useState } from "preact/hooks";
import { Badge, Button, Empty, IdText, List, ListRow, PageHeader, Section } from "../../../frontend/components";
import { Icon } from "../../../frontend/icons";
import type { SheetProps } from "../../../frontend/registry";
import { decodeQuestsView, KIND_LABEL, objectiveCount, STATUS_LABEL } from "./panel";

/** Hints shown so far per chat and track, kept for the session so a sheet opened again shows them still. */
const shownHints = new Map<string, number>();

export function QuestSheet(props: SheetProps) {
  const key = `${props.chatId}\u0000${props.id}`;
  const [hints, setHints] = useState(() => shownHints.get(key) ?? 0);
  const track = decodeQuestsView(props.state.panels["story.quests"])?.tracks.find((t) => t.id === props.id);
  if (!track) {
    return (
      <div class="lre-stack lre-world">
        <PageHeader title="Quest" onBack={props.close} />
        <Empty icon="flag">This isn't in your quest log any more.</Empty>
      </div>
    );
  }
  const shown = Math.min(hints, track.hints.length);
  const reveal = () => {
    shownHints.set(key, shown + 1);
    setHints(shown + 1);
  };
  return (
    <div class="lre-stack lre-world" data-lre-sheet-quest={track.id}>
      <PageHeader title={track.label} subtitle={`${KIND_LABEL[track.kind]} · ${STATUS_LABEL[track.status]}`} onBack={props.close} />
      <IdText id={track.id} />
      {track.stage || track.cue ? (
        <Section title={track.status === "active" ? "Where it stands" : "How it ended"}>
          <div class="lre-world-stage">
            {track.stage ? <strong>{track.stage}</strong> : null}
            {track.cue ? <p class="lre-world-cue">{track.cue}</p> : null}
          </div>
        </Section>
      ) : null}
      {track.objectives.length > 0 ? (
        <Section title="Objectives" aside={<Badge>{objectiveCount(track)}</Badge>} flush>
          <List>
            {track.objectives.map((o) => (
              <ListRow
                key={o.label}
                leading={o.done ? <Icon name="check" label="Done" class="lre-world-done" /> : <span class="lre-world-todo" role="img" aria-label="To do" />}
                title={o.done ? <span class="lre-muted">{o.label}</span> : o.label}
              />
            ))}
          </List>
        </Section>
      ) : null}
      {track.truths.length > 0 ? (
        <div data-lre-quest-truths>
          <Section title="What you've learned" flush>
            <List>
              {track.truths.map((truth) => (
                <ListRow key={truth} icon="sparkle" title={truth} />
              ))}
            </List>
          </Section>
        </div>
      ) : null}
      {track.hints.length > 0 ? (
        <div data-lre-quest-hints>
          <Section title="Hints" aside={<Badge>{`${shown} of ${track.hints.length}`}</Badge>}>
            <div class="lre-stack">
              {track.hints.slice(0, shown).map((hint) => (
                <p key={hint} class="lre-world-hint">
                  <Icon name="help" size={16} />
                  <span>{hint}</span>
                </p>
              ))}
              {shown < track.hints.length ? (
                <div>
                  <Button icon="help" onClick={reveal}>
                    {shown === 0 ? "Show a hint" : "Show another hint"}
                  </Button>
                </div>
              ) : null}
            </div>
          </Section>
        </div>
      ) : null}
    </div>
  );
}
