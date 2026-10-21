// Someone's usual routine as words (DESIGN §6.6, §24.5): the blocks of their routine in force and
// their own place and activity schedules, each as one clause ("weekdays, opens the shop at 09:00"),
// the ones around now first. It reads the routine as the world and the chat set it, never the day the
// planner lays: the planner fills free time with meals, friends and invitations the story never set
// up, and those are no one's habit. Routines are informative here: these clauses are what the
// narrator and a character's own mind may weigh, never what the engine makes anyone do.

import type { EntityId } from "../../../shared/ids";
import { routineSettingsOf, type RoutineBlock, type RoutineDays } from "../../../shared/routines";
import type { Recurrence } from "../../../shared/world";
import { calendarOf, clockAt, dateAt, dayPartAt, formatHHMM, MINUTES_PER_DAY, parseHHMM, recursOn, weekdayName, type Calendar } from "../../../engine/calendar";
import { povLife } from "../../../engine/life";
import { own } from "../../../engine/pack-kit";
import { hiddenNameCheck } from "../../../engine/player-events";
import type { ReadContext } from "../../../engine/registry";
import { chatSchedulesIn, scheduleOwners } from "../../../engine/schedules";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { canSeeEntity, canSeeField, canSeePlace, findLeaks, unrevealedSecrets } from "../../../engine/visibility";
import { activeBlocks, blockOnDay, routineRole, scheduleOff } from "./routines";

/** One clause of someone's usual routine, and what a reader needs to choose and screen it. */
export interface UsualClause {
  text: string;
  /** Minutes after midnight it starts, and how long it runs. */
  start: number;
  minutes: number;
  /** It is on today. */
  today: boolean;
  /** A routine block marked private (the player reads it as "Busy"). */
  private: boolean;
  /** It is theirs alone: a block of their own routine or a chat's change for them, or a schedule they own by name. */
  own: boolean;
}

/** A list of words as English joins it: "a", "a and b", "a, b and c". */
function joined(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;
}

/** Weekdays as a phrase: "weekdays", "weekends", "on Tue", "on Mon and Thu" (the calendar's own names); every day is "". */
function weekdaysPhrase(cal: Calendar, days: readonly number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 0 || set.length >= 7) return "";
  if (set.join() === "1,2,3,4,5") return "weekdays";
  if (set.join() === "0,6") return "weekends";
  return `on ${joined(set.map((d) => weekdayName(cal, d)))}`;
}

/** When a block is on, as a phrase ("" every day). Occasions the block keys to read as the occasion. */
function blockDays(cal: Calendar, d: RoutineDays | undefined): string {
  if (!d) return "";
  const parts: string[] = [];
  if (d.weekdays) parts.push(weekdaysPhrase(cal, d.weekdays));
  if (d.off === "only") parts.push("on days off");
  if (d.off === "never") parts.push("on working days");
  if (d.holidays) parts.push("on holidays");
  if (d.birthday === "own") parts.push("on their birthday");
  if (d.birthday === "friend") parts.push("on a friend's birthday");
  if (d.seasons) parts.push(`in ${joined(d.seasons)}`);
  if (d.weather) parts.push(`in ${d.weather} weather`);
  return parts.filter((p) => p !== "").join(", ");
}

/** When a schedule runs, as a phrase ("" every day). */
function recurrenceDays(cal: Calendar, r: Recurrence): string {
  if (r.every === "week") return weekdaysPhrase(cal, r.weekdays ?? []);
  if (r.every === "month") return "monthly";
  if (r.every === "year") return "yearly";
  return "";
}

/** A routine block as words: "Tuesdays, swimming in the evening", "sometimes", "2 days a week". */
function blockClause(cal: Calendar, day: number, block: RoutineBlock): { text: string; start: number } {
  const fixed = block.kind === "fixed" && block.at !== undefined;
  const start = fixed && block.at ? parseHHMM(block.at) : block.window ? parseHHMM(block.window.from) : 0;
  // A window reads as the day part it opens in, as the world's calendar names it.
  const time = fixed ? ` at ${block.at}` : block.window ? ` in the ${dayPartAt(cal, clockAt(cal, day, start)).label.toLowerCase()}` : "";
  const often = block.kind === "optional" ? "sometimes" : block.perWeek !== undefined && block.perWeek < 7 ? `${block.perWeek} day${block.perWeek === 1 ? "" : "s"} a week` : "";
  const days = [blockDays(cal, block.days), often].filter((p) => p !== "").join(", ");
  return { text: `${days !== "" ? `${days}, ` : ""}${block.label.trim().replace(/[.;]+$/, "")}${time}`, start };
}

/**
 * Someone's usual routine as clauses (DESIGN §6.6, §24.5): each block of their routine in force (the
 * built-in basic needs aside: everyone sleeps and eats), and each span of the place and activity
 * schedules that apply to them and they still follow in this chat, consecutive slots with one value
 * as one, and a place and an activity on the same days at the same times as one ("on Sat, work
 * shift at the café 06:00–14:00"). Today's come first, the one under way or the next before the
 * rest; then the others by time of day. Nothing the planner laid is here. `read.place` names a place
 * schedule's place, or null to leave it out; without `read.activity` activity schedules are left out.
 */
export function usualRoutine(ctx: ReadContext, who: EntityId, read: { place: (place: string) => string | null; activity: boolean }): UsualClause[] {
  const { registry: reg, world, state } = ctx;
  const cal = calendarOf(world);
  const now = dateAt(cal, state.clock);
  const day = now.dayIndex;
  const out: UsualClause[] = [];
  for (const { block, from } of activeBlocks(ctx, who)) {
    if (from.level === "builtin") continue;
    const { text, start } = blockClause(cal, day, block);
    let today = false;
    try {
      today = blockOnDay(ctx, who, block, day);
    } catch {
      // A day the planner can't read (no occasion data) is just not known to be today.
    }
    out.push({ text, start, minutes: block.minutes, today, private: block.private === true, own: from.level === "own" || from.level === "chat" });
  }
  // Schedule spans by their days and times, so a place and an activity schedule that go together
  // (a shift and where it is worked) read as one clause.
  const spans = new Map<string, { days: string; start: number; end: number; today: boolean; own: boolean; activity?: string; place?: string }>();
  for (const s of chatSchedulesIn(ctx)) {
    if (!((s.target === "activity" && read.activity) || s.target === "place") || scheduleOff(state, who, s.id, state.clock) || !scheduleOwners(reg, world, state, s).includes(who)) continue;
    const days = recurrenceDays(cal, s.recurrence);
    const today = recursOn(cal, s.recurrence, day);
    // Consecutive slots with the same value are one span: a lunch break between two shifts stays its
    // own. A weighted draw has no one value to tell, so only fixed values are told.
    const runs: { value: string; start: number; end: number }[] = [];
    for (const slot of s.slots) {
      const raw = typeof slot.value === "string" ? slot.value.trim() : "";
      const value = raw === "" ? null : s.target === "place" ? read.place(raw) : raw.replace(/_/g, " ");
      if (value === null) continue;
      const start = parseHHMM(slot.start);
      const end = parseHHMM(slot.end);
      const last = runs[runs.length - 1];
      if (last && last.value === value && last.end === start) last.end = end;
      else runs.push({ value, start, end });
    }
    for (const run of runs) {
      const key = `${days}\u0000${run.start}\u0000${run.end}`;
      const span = spans.get(key) ?? { days, start: run.start, end: run.end, today, own: s.owner === who };
      if (s.target === "place") span.place ??= run.value;
      else span.activity ??= run.value;
      spans.set(key, span);
    }
  }
  for (const span of spans.values()) {
    const what = span.activity !== undefined ? `${span.activity}${span.place !== undefined ? ` at ${span.place}` : ""}` : `at ${span.place ?? ""}`;
    const minutes = (span.end - span.start + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
    out.push({ text: `${span.days !== "" ? `${span.days}, ` : ""}${what} ${formatHHMM(span.start)}–${formatHHMM(span.end)}`, start: span.start, minutes, today: span.today, private: false, own: span.own });
  }
  // Around now: today's under way or still to come first, by start; then the rest by time of day.
  const minute = now.minuteOfDay;
  const rank = (c: UsualClause): number => (c.today && c.start + c.minutes > minute ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.start - b.start || a.text.localeCompare(b.text));
}

/**
 * The narrator's soft context for routines (DESIGN §6.6, `routineSettings.narrator`): for each
 * person at the POV's place that it can see and who acts as it knows, one line of their usual
 * routine around now, up to three clauses, after a lead line that says it is background the narrator
 * may use or ignore. It is the player's view of a routine: never a private block, a place the POV
 * can't see, an activity it may not see them do, a secret or a hidden name. Someone whose routine
 * role is `off` has none to tell; for an informative one it is the only way their routine reaches
 * the story, and the narrator decides.
 *
 * A hint renderer on People: People names everyone with the POV the POV can see, those the Minds
 * section tells of included (Stance leaves them out, and with minds on the Live cast are exactly
 * those), so the line reaches the narrator for all of them. As a hint it rides last on the section
 * budget and never displaces a section, People never goes out on hints alone, and the helpers' fact
 * lines leave it out, so no prose helper or contradiction check reads a habit as a fact.
 */
export function usualRoutineHints(ctx: ReadContext): string[] {
  const { registry: reg, world, state } = ctx;
  const pov = world.pov;
  const here = placeOfEntity(state, pov);
  if (here === null || !routineSettingsOf(world).narrator) return [];
  let safe: ((text: string) => boolean) | null = null;
  const lines: string[] = [];
  for (const id of Object.keys(state.entities).sort()) {
    const e = own(state.entities, id);
    if (!e || id === pov || placeOfEntity(state, id) !== here || !kindIs(reg, world, e.kind, "person") || isGone(state, id) || !canSeeEntity(reg, world, state, pov, id) || povLife(world, state, id)?.acts === false) continue;
    if (routineRole(ctx, id) === "off") continue;
    const clauses = usualRoutine(ctx, id, { place: (place) => (canSeePlace(reg, world, state, pov, place) ? (own(world.places, place)?.name ?? null) : null), activity: canSeeField(reg, world, state, pov, id, "activity") }).filter((c) => !c.private);
    if (clauses.length === 0) continue;
    // The leak test is built on its first use, so a scene with no routine to tell never pays for it.
    if (!safe) {
      const secrets = unrevealedSecrets(reg, world, state);
      const namesHidden = hiddenNameCheck(reg, world, state, pov);
      safe = (t) => findLeaks(t, secrets).length === 0 && !namesHidden(t);
    }
    const told = clauses.map((c) => c.text).filter(safe).slice(0, 3);
    if (told.length > 0) lines.push(`${e.name} usually: ${told.join("; ")}.`);
  }
  return lines.length === 0 ? [] : ["Usual routines (background you may use or ignore, never a fact to state; what the story establishes always comes first):", ...lines];
}
