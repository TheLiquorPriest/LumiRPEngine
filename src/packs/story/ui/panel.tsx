// Play → Quests (DESIGN §10): the tracks the POV knows, with the current stage, its cue, revealed
// truths, objectives and hints. The view is the story pack's quest log `{active, done, failed}`,
// already POV-filtered: truth text never appears here before reveal.

import { useState } from "preact/hooks";
import { isRecord } from "../../../shared/json";
import { Card, Empty, JsonView, Seg } from "../../../frontend/components";
import { list, oneOf, optStr, str, strings } from "../../../frontend/decode";
import type { PanelProps } from "../../../frontend/registry";

const KINDS = ["quest", "secret", "puzzle", "agenda"] as const;
const STATUSES = ["active", "done", "failed"] as const;
type Status = (typeof STATUSES)[number];

export interface QuestTrack {
  id: string;
  label: string;
  kind: (typeof KINDS)[number];
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

function Track(props: { track: QuestTrack }) {
  const { track } = props;
  const done = track.objectives.filter((o) => o.done).length;
  return (
    <Card title={track.label} aside={<span class={track.status === "done" ? "lre-badge pos" : track.status === "failed" ? "lre-badge neg" : "lre-badge accent"}>{track.status === "active" ? track.kind : track.status}</span>}>
      {track.stage ? <div class="lre-small lre-muted">{track.stage}</div> : null}
      {track.cue ? <p style={{ margin: "6px 0", whiteSpace: "normal", overflowWrap: "anywhere" }}>{track.cue}</p> : null}
      {track.truths.length > 0 ? (
        <div data-lre-quest-truths>
          <div class="lre-small lre-muted">What you've learned</div>
          {track.truths.map((truth) => (
            <div key={truth} class="lre-small" style={{ margin: "2px 0" }}>
              • {truth}
            </div>
          ))}
        </div>
      ) : null}
      {track.objectives.length > 0 ? (
        <div>
          <div class="lre-small lre-muted">
            {done}/{track.objectives.length} objectives
          </div>
          {track.objectives.map((o) => (
            <div key={o.label} class="lre-small" style={{ margin: "4px 0" }}>
              <span role="img" aria-label={o.done ? "Done:" : "To do:"}>
                {o.done ? "☑" : "☐"}
              </span>{" "}
              {o.label}
            </div>
          ))}
        </div>
      ) : null}
      {track.hints.length > 0 ? (
        <div data-lre-quest-hints>
          {/* The engine releases hints one per failed attempt; every hint in the view is earned. */}
          {track.hints.map((hint) => (
            <div key={hint} class="lre-small" style={{ margin: "4px 0" }}>
              <span aria-hidden="true">💡</span> {hint}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export function QuestsPanel(props: PanelProps) {
  const view = decodeQuestsView(props.view);
  const [status, setStatus] = useState<Status>("active");
  if (props.view === null || props.view === undefined) return <Empty>No quests.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  const tracks = view.tracks.filter((t) => t.status === status);
  return (
    <div class="lre-stack" data-lre-panel="story.quests">
      <Seg<Status> label="Quest status" value={status} options={STATUSES.map((s) => ({ value: s, label: `${s[0]?.toUpperCase()}${s.slice(1)} ${view.tracks.filter((t) => t.status === s).length}` }))} onChange={(next) => setStatus(next)} />
      {tracks.length === 0 ? <Empty>None.</Empty> : tracks.map((t) => <Track key={t.id} track={t} />)}
    </div>
  );
}
