// The time family (AGENT-LOOP-PLAN §6; INC1-SPEC R3a): the clock, and a person's day.
//
// - `time_clock` reads the clock as the HUD and the calendar renderer do: the date and time in the
//   world's calendar, local to where the player character is, the part of the day, today's
//   holidays, and whether the clock is paused for the scene (`clockPaused`). Under `pov` only as far
//   as the player character's Calendar & time level lets Play show it (the calendar renderer's
//   gate): nothing at 0, the part of the day alone at 1, the date and time from 2, local time from
//   3, holidays at 4.
// - `time_day` reads a person's day. Under `pov` only as Play's Cast shows it (`routinePlayerView`:
//   today, of someone with the player character, with no place, company or GM change, a private
//   block or a restricted agenda's step read as "Busy"); any other day, or someone Cast shows no day
//   of, the player character doesn't know. Under `everyone` the day the planner lays for them
//   (`dayPlan`), each block with what they do and where, a restricted place, a step of an agenda
//   that isn't public and a private block of their routine marked; under `gm` the day as GM →
//   Routine reads it (`routineGmView`), with why each block is there.

import { calendarOf, clockAt, dateAt, dayPartAt, formatClock, formatTimeOfDay, holidaysOn, placeOffset } from "../../../../engine/calendar";
import { placeOfEntity } from "../../../../engine/scope";
import { clockPaused } from "../../../../engine/time";
import { AGENDA_OPTION, dayPlan } from "../../../../packs/castlife/core/index";
import { activeBlocks, ROUTINE_OPTION } from "../../../../packs/castlife/core/routines";
import { routineGmView, routinePlayerView } from "../../../../packs/castlife/core/view";
import { TOOL_NOTE, toolArgTextId } from "../../../../shared/agent-tools";
import type { EntityId } from "../../../../shared/ids";
import type { BlockOrigin, LaidBlock, PlayerBlock } from "../../../../shared/routines";
import type { ToolDefinition } from "../registry";
import type { Secrecy, ToolReadView, ViewRef } from "../read-view";
import { resolvePerson } from "../resolve";
import { badValue, intArg, integer, needText, objectSchema, text } from "../schema";

const CLOCK = "time_clock";
const DAY = "time_day";

/** A clock reading in the world's calendar words ("Mon 14 Sep 2026, 6:15 AM"), local to where the player character is, as the HUD reads the clock. */
export function clockWords(view: ToolReadView, at: number): string {
  return formatClock(calendarOf(view.world), at, placeOffset(view.world, at, placeOfEntity(view.state, view.pov)));
}

/** The clock as `time_clock` gives it; under `pov` each part only from the Calendar & time level Play shows it at. */
interface ClockAnswer {
  /** The date and time, local to where the player character is. */
  time?: string;
  /** The clock as the engine counts it: minutes since the world's epoch. */
  minutes?: number;
  /** The part of the day, by its label. */
  dayPart: string;
  /** Today's holidays, by name. */
  holidays?: string[];
  /** Whether the clock is paused for this scene. */
  paused: boolean;
}

/** The clock now; null under `pov` when the player character's Calendar & time is off. */
function clockAnswer(view: ToolReadView): ClockAnswer | null {
  const { world, state } = view;
  // Under `pov`, the calendar renderer's gate: what the player character's Calendar & time level shows.
  const level = view.knowledge === "pov" ? view.ctx.levelOf(view.pov, "calendar") : null;
  const shows = (from: number): boolean => level === null || level >= from;
  if (!shows(1)) return null;
  const cal = calendarOf(world);
  const offset = shows(3) ? placeOffset(world, state.clock, placeOfEntity(state, view.pov)) : 0;
  return {
    time: shows(2) ? formatClock(cal, state.clock, offset) : undefined,
    minutes: shows(2) ? state.clock : undefined,
    dayPart: dayPartAt(cal, state.clock + offset).label,
    holidays: shows(4) ? holidaysOn(cal, dateAt(cal, state.clock + offset).dayIndex).map((h) => h.label) : undefined,
    paused: clockPaused(world, state),
  };
}

/** A block of someone's day as `time_day` gives it. */
interface DayBlock {
  /** When it starts and when it ends, as times of day. */
  from: string;
  to: string;
  label: string;
  /** Under `everyone` and `gm`: what they do, and where (null: no place of its own). */
  activity?: string;
  place?: ViewRef | null;
  /** Under `pov` and `gm`: the kind of time it is, and why it's there. */
  kind?: LaidBlock["kind"];
  reasons?: string[];
  /** Under `pov`: where it comes from, as the player may know it. */
  source?: PlayerBlock["source"];
  /** Under `gm`: where it comes from (a block of their routine, a schedule, a plan, an agenda, an invitation), with its owner and source. */
  origin?: BlockOrigin;
}

interface DayAnswer {
  person: ViewRef;
  /** The day: under `pov` as Cast names it, else its date. */
  day: string;
  blocks: DayBlock[];
}

/**
 * How the blocks of someone's day are marked under `everyone`: those the player reads as "Busy"
 * (`playerBlocks`). A step of an agenda that isn't public carries its track's secrecy; a private
 * block of their routine is their own business, known to them alone.
 */
function blockSecrecy(view: ToolReadView, who: EntityId, day: number): (option: string) => Secrecy | null {
  const privateBlocks = new Set(
    activeBlocks(view.ctx, who, day)
      .filter((a) => a.block.private === true)
      .map((a) => a.block.id),
  );
  const theirs: Secrecy = { known: [view.name(who)], kept: "everyone" };
  return (option) => {
    if (option.startsWith(AGENDA_OPTION)) return view.trackSecrecy(option.slice(AGENDA_OPTION.length));
    return option.startsWith(ROUTINE_OPTION) && privateBlocks.has(option.slice(ROUTINE_OPTION.length).replace(/:carried$/, "")) ? theirs : null;
  };
}

/** Someone's day `offset` days from today, as the view may read it; null under `pov` when Play shows the player character no such day of them. */
function dayAnswer(view: ToolReadView, who: EntityId, offset: number): DayAnswer | null {
  const person = view.entity(who);
  if (!person) return null;
  if (view.knowledge === "pov") {
    const shown = offset === 0 ? routinePlayerView(view.ctx, who) : null;
    return shown?.day ? { person, day: shown.day.label, blocks: shown.day.blocks } : null;
  }
  const cal = calendarOf(view.world);
  const day = dateAt(cal, view.state.clock).dayIndex + offset;
  const date = formatClock(cal, clockAt(cal, day, 0)).split(",")[0] ?? "";
  if (view.knowledge === "gm") {
    const blocks = routineGmView(view.ctx, who, day).day.blocks.map((b): DayBlock => ({ from: b.from, to: b.to, label: b.label, activity: b.activity, place: b.place === null ? null : view.place(b.place), kind: b.kind, reasons: b.reasons, origin: b.origin }));
    return { person, day: date, blocks };
  }
  const secrecy = blockSecrecy(view, who, day);
  const blocks = dayPlan(view.ctx, who, day).blocks.map((b): DayBlock => {
    const kept = secrecy(b.option);
    return { from: formatTimeOfDay(dateAt(cal, b.start).minuteOfDay), to: formatTimeOfDay(dateAt(cal, b.end).minuteOfDay), label: view.mark(b.label, kept), activity: view.mark(b.activity, kept), place: b.place === null ? null : view.place(b.place) };
  });
  return { person, day: date, blocks };
}

/** The time family, in the order of its texts (`shared/agent-tools-read.ts`). */
export const TIME_TOOLS: readonly ToolDefinition[] = [
  {
    name: CLOCK,
    family: "time",
    tier: "read",
    parameters: () => objectSchema({}),
    run: async (_args, env) => {
      const view = await env.reader.view();
      const answer = view.read(() => clockAnswer(view));
      return answer ? view.answer(answer) : view.refuse(TOOL_NOTE.hidden, { pov: view.name(view.pov) });
    },
  },
  {
    name: DAY,
    family: "time",
    tier: "read",
    parameters: () => objectSchema({ person: text(), day: integer() }, ["person"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = needText(view, DAY, args, "person");
      if (typeof said !== "string") return said;
      const r = resolvePerson(view, said);
      if ("refused" in r) return r.refused;
      const given = args.day;
      const offset = given === undefined || given === null ? 0 : intArg(args, "day");
      if (offset === null) return badValue(view, DAY, "day", typeof given === "string" ? given : JSON.stringify(given), [view.text(toolArgTextId(DAY, "day"))]);
      const answer = view.read(() => dayAnswer(view, r.id, offset));
      return answer ? view.answer(answer) : view.refuse(TOOL_NOTE.hidden, { pov: view.name(view.pov) });
    },
  },
];
