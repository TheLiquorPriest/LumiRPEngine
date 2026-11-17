// The activity line of a chat's turn (plan §14, PlanChatUI-P1): who is at work and the newest progress
// line it gave, and for how long, read from RPE's live trace (`ui/kept/play/activity.ts`); and a run that
// failed, which says so and opens the turn's page. It takes the place of the earlier engine's line, which
// opened that engine's Diagnostics.

import { useEffect, useState } from "preact/hooks";
import type { Activity } from "../../shared/turn-activity";
import { Icon } from "../../ui/icons";
import { useSelect } from "../../ui/store";
import { useUiSetting } from "../../ui/ui-settings";
import { useApp } from "../app";

/** How long a turn has run: "42 s", "3 m 05 s". */
export function elapsedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, "0")} s`;
}

/** The chat's activity line, redrawn at the page's tick while it runs. */
export function useActivity(): { activity: Activity | null; now: number } {
  const app = useApp();
  const tickMs = useUiSetting("tickMs");
  const activity = useSelect(app.sync, (state) => state.activity);
  const [now, setNow] = useState(() => Date.now());
  const running = activity?.state === "running";
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [running, tickMs]);
  return { activity, now };
}

/** Where a failed run is read: its turn's page, or the Live page where the turn is not known. */
function failureRoute(activity: Activity) {
  return activity.turn === null ? { page: "live", chat: activity.chatId } : { page: "turns", chat: activity.chatId, at: [activity.turn] };
}

/** What the engine is doing now ("The author is at work 12 s"), or that the last turn failed, with a way to its page. Nothing while idle. `compact` drops the words for the time (the HUD pill on a phone). */
export function ActivityLine(props: { compact?: boolean }) {
  const app = useApp();
  const { activity, now } = useActivity();
  if (!activity) return null;
  if (activity.state === "failed") {
    const open = app.open;
    return (
      <button type="button" class="lre-activity failed" data-lre-activity="failed" onClick={() => open?.(failureRoute(activity))} disabled={open === undefined} aria-label={`${activity.label}. Open the turn's page`} title="Open the turn's page">
        <Icon name="alert" size={16} />
        {props.compact ? null : <span class="lre-activity-label">{activity.label}</span>}
      </button>
    );
  }
  const elapsed = elapsedText(now - activity.since);
  return (
    <span class="lre-activity" data-lre-activity="running" role="status" aria-live="polite" aria-label={`${activity.label} ${elapsed}`}>
      <span class="lre-chat-pulse" aria-hidden="true" />
      {props.compact ? null : <span class="lre-activity-label">{activity.label}</span>}
      <span class="lre-num lre-activity-time">{elapsed}</span>
    </span>
  );
}
