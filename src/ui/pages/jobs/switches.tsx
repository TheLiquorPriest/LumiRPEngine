// The switches over all jobs and the limits in force (plan §13.5, R-38, R-73): "Switch jobs off" (no job starts, by an agent's call or from the page;
// those waiting keep waiting) and "Hold jobs" (those running are held at their agents' next call and none starts, until he lets them go), his own
// stop; and the limits in force, each as the Settings page's own row for it (its name, its value in words with its unit, the control
// that changes it) with the use it is held against beside it where one is counted.

import { useEffect, useState } from "preact/hooks";
import { useApp } from "../../app";
import { Badge, Banner, Button, Section } from "../../../frontend/components";
import type { SettingView } from "../../../shared/api";
import { useRead } from "../../reading";
import { errorWords } from "../../words";
import { useSettings } from "../settings";
import { LevelBar } from "../settings/levelbar";
import { type ChangeLevel, numberWords, valueWords } from "../settings/model";
import { SettingRow } from "../settings/row";

/** What is counted of a limit, said beside it: the jobs running now for the jobs at once, the jobs started over the last 24 hours (the count the limit itself holds you to) for the jobs in a day, else the tokens used over the last 24 hours. */
function usedWords(s: SettingView, used: number): string {
  if (s.key === "jobs.atOnce") return `${numberWords(used, s.unit)} running now`;
  return s.key === "jobs.perDay" ? `${numberWords(used, s.unit)} started in the last 24 hours` : `${numberWords(used, s.unit)} used in the last 24 hours`;
}

export function SwitchesSection(props: { chat: string | null; reload: number; onChanged(): void }) {
  const app = useApp();
  const state = useRead(() => app.client.call("GET /api/v1/jobs/switches", {}, { query: props.chat === null ? {} : { chat: props.chat } }), [props.reload, props.chat]);
  // A change to a limit is for every chat until he chooses this chat alone; the use is read again after it.
  const { shown, actions } = useSettings(props.chat, () => state.again());
  const [level, setLevel] = useState<ChangeLevel>("global");
  useEffect(() => setLevel("global"), [props.chat]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const press = (body: { off?: boolean; held?: boolean }): void => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    app.client.call("POST /api/v1/jobs/switches", {}, { body }).then(
      () => {
        setBusy(false);
        state.again();
        props.onChanged();
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  const now = state.value;
  return (
    <Section id="switches" title="All jobs">
      {state.problem === null ? null : <p class="rpe-line">{state.problem}</p>}
      {now === null ? null : (
        <>
          <p class="rpe-line" data-switch-state>
            <Badge tone={now.off ? "warn" : "pos"}>{now.off ? "switched off" : "switched on"}</Badge> <Badge tone={now.held ? "warn" : undefined}>{now.held ? "held" : "not held"}</Badge>
          </p>
          <div class="lre-inline rpe-wrap">
            <Button size="sm" busy={busy} onClick={() => press({ off: !now.off })}>
              {now.off ? "Switch jobs on" : "Switch jobs off"}
            </Button>
            <Button size="sm" variant="ghost" busy={busy} onClick={() => press({ held: !now.held })}>
              {now.held ? "Let jobs go" : "Hold jobs"}
            </Button>
          </div>
          <p class="rpe-meta">Off: no job starts, by an agent's call or from here; those waiting keep waiting. Held: those running stop at their agent's next call and none starts, until you let them go.</p>
          <div class="rpe-set-group" data-limits>
            <h4 class="rpe-set-grouptitle">Limits on jobs</h4>
            {props.chat === null ? null : <LevelBar level={level} onLevel={setLevel} />}
            {shown.problem === null ? null : (
              <Banner tone="neg" icon="alert" title="The limits could not be read">
                <span>{shown.problem}</span>
              </Banner>
            )}
            {shown.reply === null && shown.loading ? <p class="lre-muted rpe-line">Reading the limits…</p> : null}
            <ul class="rpe-plain rpe-set-rows">
              {now.limits.flatMap((l) => {
                const s = shown.reply?.settings.find((it) => it.key === l.key);
                if (s === undefined) return [];
                return [
                  <SettingRow
                    key={s.key}
                    setting={s}
                    level={level}
                    busy={shown.busy}
                    refusal={shown.refusal !== null && shown.refusal.key === s.key ? shown.refusal.words : null}
                    choices={null}
                    books={null}
                    aside={
                      <>
                        {valueWords(s, s.value)}
                        {l.used === null ? "" : ` · ${usedWords(s, l.used)}`}
                      </>
                    }
                    onWrite={actions.onWrite}
                    onTakeAway={actions.onTakeAway}
                  />,
                ];
              })}
            </ul>
          </div>
        </>
      )}
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not done">
          <span data-problem>{problem}</span>
        </Banner>
      )}
    </Section>
  );
}
