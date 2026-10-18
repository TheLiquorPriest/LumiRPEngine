// Play → Calendar (DESIGN §12): the clock and today, what's coming, Pause/Resume and Timelapse,
// and this chat's time controls as `time` markers on the running chat (DESIGN §9.2).

import { isRecord } from "../../../shared/json";
import type { StateView } from "../../../shared/state-view";
import { useApp } from "../../../frontend/app";
import { Card, Empty, Row, useBusy } from "../../../frontend/components";
import { list, str, strings } from "../../../frontend/decode";
import { clockText } from "../../../frontend/hud";
import type { PanelProps } from "../../../frontend/registry";
import { timeMarker } from "../../../frontend/requests";
import { TimeControlsEditor } from "../../../frontend/time-controls";
import type { TimeValues } from "../../../frontend/time-controls";

import type { CalendarView } from "../core/view";

export function decodeCalendarView(value: unknown): CalendarView | null {
  if (!isRecord(value)) return null;
  return {
    level: typeof value.level === "number" ? value.level : 2,
    date: str(value.date),
    weekday: str(value.weekday),
    dayPart: str(value.dayPart),
    holidays: strings(value.holidays),
    upcoming: list(value.upcoming, (u) => ({ at: str(u.at), label: str(u.label), kind: u.kind === "holiday" ? "holiday" : "commitment" })),
  };
}

function controlValues(state: StateView): TimeValues | null {
  const time = state.controls?.time;
  if (!time) return null;
  return { sceneTicks: time.sceneTicks, scale: time.scale, interrupts: time.interrupts, speedThrough: time.speedThrough, montage: time.montage, unitCap: time.unitCap };
}

export function CalendarPanel(props: PanelProps) {
  const app = useApp();
  const { state } = props;
  const calendar = decodeCalendarView(props.view);
  const [busy, run] = useBusy();
  const hud = state.hud;
  const values = controlValues(state);
  const paused = state.controls?.time.paused ?? hud?.clock.paused ?? false;
  return (
    <div class="lre-stack" data-lre-panel="calendar.calendar">
      <Card title="Clock" aside={paused ? <span class="lre-badge warn">Paused</span> : null}>
        {hud ? <Row k={<span class="lre-num" style={{ fontSize: "18px", fontWeight: 600 }}>{clockText(hud)}</span>} v={calendar?.dayPart || hud.clock.dayPart} /> : null}
        {calendar ? <Row k={`${calendar.weekday} ${calendar.date}`.trim() || "—"} v={calendar.holidays.join(", ") || undefined} /> : null}
        <div class="lre-inline" style={{ marginTop: "8px" }}>
          <button
            type="button"
            class="lre-btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await app.request(timeMarker(props.chatId, "pause", { all: true }, !paused));
              })
            }
          >
            <span aria-hidden="true">{paused ? "▶" : "⏸"}</span> {paused ? "Resume clock" : "Pause clock"}
          </button>
          {state.palette?.timelapse ? (
            <button type="button" class="lre-btn primary" onClick={() => void app.overlays.openPalette("timelapse")}>
              <span aria-hidden="true">⏩</span> Timelapse…
            </button>
          ) : null}
        </div>
      </Card>
      <Card title="Coming up">
        {!calendar || calendar.upcoming.length === 0 ? (
          <Empty>Nothing scheduled.</Empty>
        ) : (
          calendar.upcoming.map((u, i) => <Row key={`${u.at}:${i}`} k={u.label} sub={u.kind} v={u.at} />)
        )}
      </Card>
      <div class="lre-h">This chat's time controls</div>
      {values ? (
        <TimeControlsEditor
          values={values}
          currentSceneType={state.controls?.time.sceneType}
          disabled={busy}
          onChange={(change) =>
            run(async () => {
              const result = await app.request(timeMarker(props.chatId, change.control, change.scope, change.to));
              if (result?.pending) app.toast("Saved — it applies when the reply finishes.", "info");
            })
          }
        />
      ) : (
        <Empty>Time controls appear once the chat has started.</Empty>
      )}
    </div>
  );
}
