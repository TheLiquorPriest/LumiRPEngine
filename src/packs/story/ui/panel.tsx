// Play → Story → Quests (DESIGN §10): the tracks the POV knows, active, done or failed, each
// opening its quest sheet with the current stage, its cue, revealed truths, objectives and hints.
// The view is the story pack's quest log `{active, done, failed}`, already POV-filtered: truth text
// never appears here before reveal. The story's glance on Now gives the next step of the quest in
// hand.

import { useState } from "preact/hooks";
import { isRecord } from "../../../shared/json";
import { pushSheet, useApp } from "../../../frontend/app";
import { Empty, JsonView, List, ListRow, Section, Seg } from "../../../frontend/components";
import { list, oneOf, optStr, str, strings } from "../../../frontend/decode";
import type { IconName } from "../../../frontend/icons";
import type { PanelProps } from "../../../frontend/registry";
import { GlanceCard } from "../../../frontend/play/glance";

const KINDS = ["quest", "secret", "puzzle", "agenda"] as const;
const STATUSES = ["active", "done", "failed"] as const;
type Status = (typeof STATUSES)[number];
type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = { quest: "Quest", secret: "Secret", puzzle: "Puzzle", agenda: "Agenda" };
export const KIND_ICON: Record<Kind, IconName> = { quest: "flag", secret: "key", puzzle: "help", agenda: "scroll" };
export const STATUS_LABEL: Record<Status, string> = { active: "Active", done: "Done", failed: "Failed" };

export interface QuestTrack {
  id: string;
  label: string;
  kind: Kind;
  stage: string;
  cue?: string;
  truths: string[];
  objectives: { label: string; done: boolean }[];
  hints: string[];
  status: Status;
}

export function decodeQuestsView(value: unknown): { tracks: QuestTrack[] } | null {
  if (!isRecord(value) || !STATUSES.some((status) => Array.isArray(value[status]))) return null;
  return {
    tracks: STATUSES.flatMap((status) =>
      list(value[status], (t) =>
        typeof t.id === "string"
          ? {
              id: t.id,
              label: str(t.label, t.id),
              kind: oneOf(t.kind, KINDS, "quest"),
              stage: str(t.stage),
              cue: optStr(t.cue),
              truths: strings(t.truths),
              objectives: list(t.objectives, (o) => ({ label: str(o.label), done: o.done === true })),
              hints: strings(t.hints),
              status,
            }
          : null,
      ),
    ),
  };
}

/** "2 of 3" objectives done, or nothing for a track without objectives. */
export function objectiveCount(track: QuestTrack): string | undefined {
  return track.objectives.length > 0 ? `${track.objectives.filter((o) => o.done).length} of ${track.objectives.length}` : undefined;
}

export function QuestsPanel(props: PanelProps) {
  const app = useApp();
  const view = decodeQuestsView(props.view);
  const [status, setStatus] = useState<Status>("active");
  if (props.view === null || props.view === undefined) return <Empty icon="flag">No quests.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  const tracks = view.tracks.filter((t) => t.status === status);
  return (
    <div class="lre-stack lre-world" data-lre-panel="story.quests">
      <Seg<Status> label="Quest status" value={status} options={STATUSES.map((s) => ({ value: s, label: `${STATUS_LABEL[s]} ${view.tracks.filter((t) => t.status === s).length}` }))} onChange={(next) => setStatus(next)} />
      {tracks.length === 0 ? (
        <Empty icon="flag">{status === "active" ? "Nothing under way." : status === "done" ? "Nothing finished yet." : "Nothing failed."}</Empty>
      ) : (
        <Section flush>
          <List>
            {tracks.map((t) => (
              <ListRow
                key={t.id}
                id={t.id}
                icon={KIND_ICON[t.kind]}
                title={t.label}
                subtitle={[t.kind === "quest" ? null : KIND_LABEL[t.kind], t.stage].filter((part) => part).join(" · ") || undefined}
                value={objectiveCount(t)}
                valueTone="muted"
                chevron
                onClick={() => app.ui.update((ui) => pushSheet(ui, { kind: "quest", id: t.id }))}
              />
            ))}
          </List>
        </Section>
      )}
    </div>
  );
}

/** The quest in hand: the first active quest, else the first active track of any kind, with its first objective not yet done. */
export function questInHand(tracks: readonly QuestTrack[]): { track: QuestTrack; next?: QuestTrack["objectives"][number] } | null {
  const active = tracks.filter((t) => t.status === "active");
  const track = active.find((t) => t.kind === "quest") ?? active[0];
  return track ? { track, next: track.objectives.find((o) => !o.done) } : null;
}

/** Now's story glance: the next step of the quest in hand, or nothing. */
export function StoryGlance(props: PanelProps) {
  const app = useApp();
  const hand = questInHand(decodeQuestsView(props.view)?.tracks ?? []);
  if (!hand) return null;
  const { track, next } = hand;
  return (
    <GlanceCard title="Story" panel="story.quests">
      <ListRow
        icon={next ? "checklist" : KIND_ICON[track.kind]}
        title={next ? next.label : track.stage || track.label}
        subtitle={track.label}
        value={objectiveCount(track)}
        valueTone="muted"
        chevron
        onClick={() => app.ui.update((ui) => pushSheet(ui, { kind: "quest", id: track.id }))}
      />
    </GlanceCard>
  );
}
