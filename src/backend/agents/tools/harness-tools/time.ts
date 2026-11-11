// Time on the harness engine (HARNESS-SLICE3: "Skills RPEngine ships: time passing"): how long a
// turn takes is the author's to say, with `time_pass`, which stands in for the classic turn's own
// tick.
//
// The engine passes the span as it passes any time the story says passed (`applyTimeAdvance`, the
// path a narrated skip and the clock's ✎ fix take): the world runs across it whole, with what is
// scheduled, what people's routines have them do, the world's own processes, its rules and its
// quests, the player character held where the story has them. Its events are recorded as a
// timelapse's are (coarsened, one unit kept or dropped whole) and staged as the turn's time
// (`HarnessChange.time`), so a turn that passed time, or said that none passes, gets no tick besides.
//
// - `time_pass` is the turn's main agent's alone, and only until the turn's reply is written: no
//   agent it started and no job's run passes time with it. The time a reply's telling added is the
//   story's to record afterwards (`story_record`, which passes it through `passSpan` too).
// - A span is a change of the type "time passing" (`time_advance`): Never refuses it, Confirm puts
//   it on the review card. Saying that no time passes changes nothing in the chat's record, so it is
//   under no mode: it only tells the turn to add no tick of its own.
// - The player's pause of the scene's clock holds it, and one call moves the clock no farther than
//   the player allows (Settings → Agents: `harnessLimits.timePassMinutes`).

import { HARNESS_FAMILY, HARNESS_NOTE, HARNESS_TOOL } from "../../../../shared/harness-texts";
import { hashJson, hashParts } from "../../../../shared/hash";
import type { JsonObject } from "../../../../shared/json";
import type { LedgerEvent } from "../../../../shared/ledger";
import { calendarOf, clockOfStamp, formatStamp, placeOffset } from "../../../../engine/calendar";
import { authorLines } from "../../../../engine/player-events";
import { placeOfEntity } from "../../../../engine/scope";
import { coarsen } from "../../../../engine/simulate";
import { applyTimeAdvance, clockPaused } from "../../../../engine/time";
import { TIME_LIMITS } from "../../../../engine/time-limits";
import { Working } from "../../../../engine/working";
import { turnTimeLine } from "../../../turn-steps";
import type { ToolOutcome } from "../../runtime";
import { clockWords } from "../read/time";
import type { ToolReadView } from "../read-view";
import { argGiven, intArg, integer, objectSchema, text, textArg } from "../schema";
import { marker } from "./checks";
import { type HarnessToolDefinition, stageChange } from "./kit";

/** The clock now as `until` is written: a date and time of day in the world's calendar, local to where the player character is. */
function stampNow(view: ToolReadView): string {
  const { world, state } = view;
  return formatStamp(calendarOf(world), state.clock, placeOffset(world, state.clock, placeOfEntity(state, world.pov)));
}

/** The minutes a call passes: its `minutes`, or from now to its `until`; else the answer that says how to give them. */
function spanOf(view: ToolReadView, args: JsonObject): number | ToolOutcome {
  const { world, state } = view;
  const until = textArg(args, "until");
  if (until !== null) {
    const at = clockOfStamp(calendarOf(world), until);
    // Local time at the player character's place, as the clock is read and a ✎ fix writes it.
    const to = at === null ? null : at - placeOffset(world, at, placeOfEntity(state, world.pov));
    return to === null || to < state.clock ? view.refuse(HARNESS_NOTE.timeUntil, { now: stampNow(view) }) : to - state.clock;
  }
  const minutes = argGiven(args, "minutes") ? intArg(args, "minutes") : null;
  return minutes === null || minutes < 0 ? view.refuse(HARNESS_NOTE.timeMinutes) : minutes;
}

/** A span as the engine passed it on the state a call read. */
export interface PassedSpan {
  /** What the span did, recorded as a timelapse's events are: coarsened, and as one unit kept or dropped whole. */
  events: LedgerEvent[];
  /** How much time passed, as the turn's own time is told. */
  line: string;
  /** What happened in the span, in the engine's plain words: the change's own lines, for the review card and the commit's answer. */
  recorded: string[];
  /** The same lines as the calling agent's view may have them: one that carries a secret marked as every read marks one. */
  happened: string[];
  /** The clock once the span has passed. */
  clock: number;
}

/**
 * Passes `minutes` (above none) on the state `view` reads, as the engine passes any time the story
 * says passed (`applyTimeAdvance`), no farther than `most`; or why it wasn't passed: longer than
 * that, or more happens in the span than the engine runs in one go.
 */
export function passSpan(view: ToolReadView, runSeed: string, minutes: number, most: number): PassedSpan | { stopped: "over_cap" | "unit_cap" } {
  const { registry: reg, world, state } = view;
  const w = new Working(reg, world, state);
  return view.read(() => {
    const passed = applyTimeAdvance(reg, w, minutes, { runSeed, capMinutes: most });
    if (!passed.applied) return { stopped: passed.reason === "unit_cap" ? "unit_cap" : "over_cap" };
    const coarse = coarsen(reg, world, state, w.events);
    const group = `time:${hashParts(JSON.stringify(coarse)).slice(0, 10)}`;
    const events = coarse.length < 2 ? coarse : coarse.map((e): LedgerEvent => ({ ...e, group }));
    const recorded = authorLines(reg, world, w.state, events, events.length);
    return { events, line: turnTimeLine(w.ctx, minutes, view.texts), recorded, happened: recorded.map(marker(view)), clock: w.state.clock };
  });
}

export const TIME_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: HARNESS_TOOL.timePass,
    family: HARNESS_FAMILY.time,
    tier: "write",
    parameters: () => objectSchema({ minutes: integer({ minimum: 0 }), until: text() }),
    async run(args, env) {
      const view = await env.reader.view();
      const turn = env.turn;
      if (!turn) return view.refuse(HARNESS_NOTE.noTurn);
      // Once the reply is written the turn's time is settled: whoever calls then, the author included, is told where the telling's own time is recorded.
      if (turn.reply !== null) return view.refuse(HARNESS_NOTE.timeAfter);
      if (!turn.main) return view.refuse(HARNESS_NOTE.timeAuthor);
      const { world, state } = view;
      const minutes = spanOf(view, args);
      if (typeof minutes !== "number") return minutes;
      if (minutes > 0 && clockPaused(world, state)) return view.refuse(HARNESS_NOTE.timePaused);
      const most = Math.min(turn.settings.agents.harnessLimits.timePassMinutes, TIME_LIMITS.timelapseMinutes);
      if (minutes > most) return view.refuse(HARNESS_NOTE.timeTooLong, { minutes: String(most) });
      const passed: PassedSpan | { stopped: "over_cap" | "unit_cap" } = minutes > 0 ? passSpan(view, turn.runSeed, minutes, most) : { events: [], line: turnTimeLine(view.ctx, 0, view.texts), recorded: [], happened: [], clock: state.clock };
      if ("stopped" in passed) return passed.stopped === "unit_cap" ? view.refuse(HARNESS_NOTE.timeTooMuch) : view.refuse(HARNESS_NOTE.timeTooLong, { minutes: String(most) });
      const { events, line, recorded, happened, clock } = passed;
      const staged = await stageChange(view, turn, {
        key: hashJson(["lre.harness.time", state.clock, minutes]),
        changeType: minutes > 0 ? "time_advance" : null,
        events,
        lines: [line, ...recorded],
        time: minutes,
        // Where the span waits on the reply's review card, Apply makes it again from this, on the chat as it then stands: which the card does for no span longer than a reply passes without asking (Settings → Time). A longer one it lands as it was run here.
        ...(minutes > 0 && minutes <= turn.settings.time.askBeyondMinutes ? { proposal: { type: "time_advance", minutes } } : {}),
      });
      if ("refused" in staged) return staged.refused;
      return view.answer({ passed: { minutes, line, now: clockWords(view, clock), lands: staged.lands }, ...(happened.length > 0 ? { happened } : {}) });
    },
  },
];
