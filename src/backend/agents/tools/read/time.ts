// The time family (AGENT-LOOP-PLAN §6; INC1-SPEC R3a): the clock, and a person's day.
//
// - `time_clock` reads the clock as the HUD and the calendar renderer do: the date and time in the
//   world's calendar, local to the place asked about, else to where the player character is, the
//   part of the day, that day's holidays, and whether the clock is paused for the scene
//   (`clockPaused`).
// - `time_day` reads a person's day. Under `everyone` the day the planner lays for them (`dayPlan`),
//   each block with what they do and where, a restricted place, a step of an agenda that isn't
//   public and a private block of their routine marked; under `gm` the day as GM → Routine reads it
//   (`routineGmView`), with why each block is there.

import { calendarOf, clockAt, dateAt, dayPartAt, formatClock, formatTimeOfDay, holidaysOn, placeOffset } from "../../../../engine/calendar";
import { placeOfEntity } from "../../../../engine/scope";
import { clockPaused } from "../../../../engine/time";
import { AGENDA_OPTION, dayPlan } from "../../../../packs/castlife/core/index";
import { activeBlocks, ROUTINE_OPTION } from "../../../../packs/castlife/core/routines";
import { routineGmView } from "../../../../packs/castlife/core/view";
import { TOOL_NOTE, toolArgTextId } from "../../../../shared/agent-tools";
import type { EntityId } from "../../../../shared/ids";
import type { BlockOrigin, LaidBlock } from "../../../../shared/routines";
import type { ToolDefinition } from "../registry";
import type { Secrecy, ToolReadView, ViewRef } from "../read-view";
import { resolvePerson, resolvePlace } from "../resolve";
import { badValue, intArg, integer, needText, objectSchema, placeEnum, text, textArg } from "../schema";

const CLOCK = "time_clock";
const DAY = "time_day";

/** A clock reading in the world's calendar words ("Mon 14 Sep 2026, 6:15 AM"), local to where the player character is, as the HUD reads the clock. */
export function clockWords(view: ToolReadView, at: number): string {
  return formatClock(calendarOf(view.world), at, placeOffset(view.world, at, placeOfEntity(view.state, view.pov)));
}

/** The clock as `time_clock` gives it. */
interface ClockAnswer {
  /** The date and time, local to the place asked about (where the player character is, when none was). */
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

/** The clock now, local to `place`. */
function clockAnswer(view: ToolReadView, place: string | null): ClockAnswer {
  const { world, state } = view;
  const cal = calendarOf(world);
  const offset = placeOffset(world, state.clock, place);
  return {
    time: formatClock(cal, state.clock, offset),
    minutes: state.clock,
    dayPart: dayPartAt(cal, state.clock + offset).label,
    holidays: holidaysOn(cal, dateAt(cal, state.clock + offset).dayIndex).map((h) => h.label),
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
  /** Under `gm`: the kind of time it is, and why it's there. */
  kind?: LaidBlock["kind"];
  reasons?: string[];
  /** Under `gm`: where it comes from (a block of their routine, a schedule, a plan, an agenda, an invitation), with its owner and source. */
  origin?: BlockOrigin;
}

interface DayAnswer {
  person: ViewRef;
  /** The day, by its date. */
  day: string;
  blocks: DayBlock[];
}

/**
 * How the blocks of someone's day are marked where the view marks: those the player reads as "Busy"
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

/** Someone's day `offset` days from today; null for someone the view may not name. */
function dayAnswer(view: ToolReadView, who: EntityId, offset: number): DayAnswer | null {
  const person = view.entity(who);
  if (!person) return null;
  const cal = calendarOf(view.world);
  const day = dateAt(cal, view.state.clock).dayIndex + offset;
  const date = formatClock(cal, clockAt(cal, day, 0)).split(",")[0] ?? "";
  if (view.knowledge === "gm") {
    // Where the view marks, a block is marked as the planner's option for it would be: an agenda's step, or a private block of their routine.
    const secrecy = view.marked ? blockSecrecy(view, who, day) : null;
    const keptOf = (o: BlockOrigin): Secrecy | null => (secrecy === null ? null : o.type === "agenda" ? secrecy(`${AGENDA_OPTION}${o.track}`) : o.type === "routine" ? secrecy(`${ROUTINE_OPTION}${o.block}`) : null);
    const blocks = routineGmView(view.ctx, who, day).day.blocks.map((b): DayBlock => ({ from: b.from, to: b.to, label: view.mark(b.label, keptOf(b.origin)), activity: view.mark(b.activity, keptOf(b.origin)), place: b.place === null ? null : view.place(b.place), kind: b.kind, reasons: b.reasons, origin: b.origin }));
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
    // The place is one the view may name, by its id or its name.
    parameters: (world) => objectSchema({ place: text(placeEnum(world)) }),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = textArg(args, "place");
      return view.read(() => {
        const r = said === null ? { id: placeOfEntity(view.state, view.pov) } : resolvePlace(view, said);
        if ("refused" in r) return r.refused;
        return view.answer(clockAnswer(view, r.id));
      });
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
      return answer ? view.answer(answer) : view.refuse(TOOL_NOTE.noPerson, { name: said });
    },
  },
];
