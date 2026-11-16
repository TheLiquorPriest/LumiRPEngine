// The switches over all jobs and the limits in force (plan §13.5, R-38, R-73): "Switch jobs off" (no job starts, by an agent's call or from the page;
// those waiting keep waiting) and "Hold jobs" (those running are held at their agents' next call and none starts, until he lets them go), his own
// stop; and the limits in force with today's use where one counts, each leading to its row on Settings.

import { useState } from "preact/hooks";
import { useApp } from "../../app";
import { Badge, Banner, Button, Section } from "../../atoms";
import { useRead } from "../../reading";
import { callWanted } from "../../wanted";
import { errorWords, num } from "../../words";

export function SwitchesSection(props: { reload: number; onChanged(): void; onSetting(key: string): void }) {
  const app = useApp();
  const state = useRead(() => callWanted(app.client, "GET /api/v1/jobs/switches", {}), [props.reload]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const press = (body: { off?: boolean; held?: boolean }): void => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    callWanted(app.client, "POST /api/v1/jobs/switches", {}, { body }).then(
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
            <Button small busy={busy} onClick={() => press({ off: !now.off })}>
              {now.off ? "Switch jobs on" : "Switch jobs off"}
            </Button>
            <Button small kind="ghost" busy={busy} onClick={() => press({ held: !now.held })}>
              {now.held ? "Let jobs go" : "Hold jobs"}
            </Button>
          </div>
          <p class="rpe-meta">Off: no job starts, by an agent's call or from here; those waiting keep waiting. Held: those running stop at their agent's next call and none starts, until you let them go.</p>
          <ul class="rpe-plain lre-stack" data-limits>
            {now.limits.map((l) => (
              <li key={l.key} class="rpe-line">
                <Button small kind="ghost" onClick={() => props.onSetting(l.key)}>
                  {l.key}
                </Button>{" "}
                {typeof l.value === "number" || typeof l.value === "string" ? String(l.value) : JSON.stringify(l.value)}
                {l.used === null ? "" : ` · used ${num(l.used)}`}
              </li>
            ))}
          </ul>
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
