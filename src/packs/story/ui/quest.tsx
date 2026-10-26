// The quest sheet: one track of the quest log as the POV knows it: where it stands (its current
// stage and cue), what the POV has learned, its objectives, n of m done, and the hints earned at
// its stage behind "Show a hint" (DESIGN §10): a puzzle stage earns one per wrong answer given there,
// any other stage has its hints as soon as the track reaches it. Opening one is the player's own
// doing, kept in the chat with its Undo, and only the opened ones reach the narrator. A track isn't
// an entity, so opening the sheet observes nothing new.

import { useApp } from "../../../frontend/app";
import { Badge, Button, Empty, IdText, List, ListRow, PageHeader, Section, useBusy } from "../../../frontend/components";
import { Icon } from "../../../frontend/icons";
import type { SheetProps } from "../../../frontend/registry";
import { hintRequest } from "../../../frontend/requests";
import { decodeQuestsView, KIND_LABEL, objectiveCount, STATUS_LABEL } from "./panel";

export function QuestSheet(props: SheetProps) {
  const app = useApp();
  const [busy, run] = useBusy();
  const track = decodeQuestsView(props.state.panels["story.quests"])?.tracks.find((t) => t.id === props.id);
  if (!track) {
    return (
      <div class="lre-stack lre-world">
        <PageHeader title="Quest" onBack={props.close} />
        <Empty icon="flag">This isn't in your quest log any more.</Empty>
      </div>
    );
  }
  const shown = Math.min(track.opened, track.hints.length);
  const reveal = () =>
    run(async () => {
      const result = await app.request(hintRequest(track.id, props.chatId));
      if (result?.pending) app.toast("Hint saved — it shows when the reply finishes.", "info");
    });
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
                  <Button icon="help" busy={busy} onClick={reveal}>
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
