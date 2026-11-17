// Durations as kept code says and waits them: a duration in words, a limit's milliseconds for a timer,
// and how long the in-page client waits for an answer until the user's setting says otherwise. The
// previous build's registry of timeouts is today's, read only by the migration (`migrate/today/timeouts.ts`).

import type { Limit } from "./minds";
import { limitOf } from "./minds";

/** The longest a JavaScript timer can wait (2^31 − 1 ms, about 24.8 days): a longer one fires at once, so a longer limit runs as no limit. */
export const TIMER_MAX_MS = 2_147_483_647;

const MIN = 60_000;

/** How long the in-page client waits for each answer until the user's own wait is known (the Engine requests setting's default). */
export const REQUEST_WAIT_MS = 5 * MIN;

/** A duration as the page and the messages say it: "45 s", "1.5 s", "2 min", "1 min 30 s", "1 h 5 min". */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "no limit";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < MIN) return `${Number((ms / 1000).toFixed(1))} s`;
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h > 0 ? `${h} h` : "", m > 0 ? `${m} min` : "", s > 0 && h === 0 ? `${s} s` : ""].filter((p) => p !== "").join(" ");
}

/** A limit's milliseconds for a timer: null for no limit, or one longer than a timer can wait. */
export function timerMs(limit: Limit): number | null {
  const ms = limitOf(limit);
  return ms >= TIMER_MAX_MS ? null : Math.max(0, ms);
}
