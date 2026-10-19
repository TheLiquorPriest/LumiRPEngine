// Play → Story → Calendar (DESIGN §12): the clock and today, today's holidays, what's coming up,
// Pause/Resume and Timelapse. This chat's time controls (scene ticks, scale, interrupts…) live in
// GM → This chat (contract §4.7, §9.6); a pointer leads there. The calendar's glance on Now gives
// the POV's next two commitments.

import { isRecord } from "../../../shared/json";
import { useApp } from "../../../frontend/app";
import { Badge, Button, Empty, List, ListRow, Section, Stat, useBusy } from "../../../frontend/components";
import { list, str, strings } from "../../../frontend/decode";
import { clockText } from "../../../frontend/hud";
import { GlanceCard } from "../../../frontend/play/glance";
import type { PanelProps } from "../../../frontend/registry";
import { timeMarker } from "../../../frontend/requests";

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

export function CalendarPanel(props: PanelProps) {
  const app = useApp();
  const { state } = props;
  const calendar = decodeCalendarView(props.view);
  const [busy, run] = useBusy();
  const hud = state.hud;
  const paused = state.controls?.time.paused ?? hud?.clock.paused ?? false;
  const day = calendar ? `${calendar.weekday} ${calendar.date}`.trim() : "";
  return (
    <div class="lre-stack lre-world" data-lre-panel="calendar.calendar">
      <Section title="Today" aside={paused ? <Badge tone="warn">Paused</Badge> : null}>
        <div class="lre-stack">
          <div class="lre-world-clock">
            {hud ? <Stat label={calendar?.dayPart || hud.clock.dayPart || "Time"} value={clockText(hud)} sub={day || undefined} /> : <Stat label="Date" value={day || "—"} sub={calendar?.dayPart || undefined} />}
          </div>
          {calendar && calendar.holidays.length > 0 ? (
            <div class="lre-world-badges start">
              {calendar.holidays.map((h) => (
                <Badge key={h} tone="accent">
                  {h}
                </Badge>
              ))}
            </div>
          ) : null}
          <div class="lre-inline">
            <Button
              icon={paused ? "play" : "pause"}
              busy={busy}
              onClick={() =>
                run(async () => {
                  await app.request(timeMarker(props.chatId, "pause", { all: true }, !paused));
                })
              }
            >
              {paused ? "Resume clock" : "Pause clock"}
            </Button>
            {state.palette?.timelapse ? (
              <Button variant="primary" icon="fast-forward" onClick={() => void app.overlays.openPalette("timelapse")}>
                Timelapse…
              </Button>
            ) : null}
          </div>
        </div>
      </Section>
      <Section title="Coming up" flush>
        {!calendar || calendar.upcoming.length === 0 ? (
          <Empty icon="calendar">Nothing scheduled.</Empty>
        ) : (
          <List>
            {calendar.upcoming.map((u, i) => (
              <ListRow key={`${u.at}:${i}`} icon={u.kind === "holiday" ? "star" : "clock"} title={u.label} subtitle={u.kind === "holiday" ? "Holiday" : undefined} value={u.at} valueTone="muted" />
            ))}
          </List>
        )}
      </Section>
      <div class="lre-world-pointer">
        <Button variant="ghost" size="sm" icon="sliders" iconAfter="chevron-right" onClick={() => app.ui.update((ui) => ({ ...ui, mode: "gm", gm: { ...ui.gm, section: "chat" } }))}>
          This chat's time controls are in GM → This chat
        </Button>
      </div>
    </div>
  );
}

/** Now's calendar glance: the POV's next two commitments, or nothing when none is coming up. */
export function CalendarGlance(props: PanelProps) {
  const next = (decodeCalendarView(props.view)?.upcoming ?? []).filter((u) => u.kind === "commitment").slice(0, 2);
  if (next.length === 0) return null;
  return (
    <GlanceCard title="Coming up" panel="calendar.calendar">
      {next.map((u, i) => (
        <ListRow key={`${u.at}:${i}`} icon="clock" title={u.label} value={u.at} valueTone="muted" />
      ))}
    </GlanceCard>
  );
}
