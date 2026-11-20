// A skip of time the player asked for from a sheet (the palette's Timelapse, the HUD's), carried out by `pass_time`, the one operation that
// moves the clock: its `target` is the sheet's own (`{type: "shift"}`, `{type: "day_part", dayPart}`), its `routine` is Follow my routine, and
// its `interrupts` are what the player set to stop a skip, class by class. The sheet's press reaches the Author as these arguments
// (`timelapsePass`), and `act` with the timelapse action reads the press's own values to the same place (`ops-act.ts`): one road.
//
// What a stop and a held routine can mean here is what this build lists. Nothing steps a person or raises an interrupt as a run goes (the
// engine's `advance` does that, and no turn runs it), so what the player can stop for is the part of what falls due that has a class: an
// arrival (`arrival`), a need reaching its line (`needs`) and a change in the weather (`weather`). The other classes name things only a
// process of the old turn raised, so nothing of them is ever listed to stop at.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { clockPlus } from "../engine/calendar";
import { interruptPolicy } from "../engine/simulate";
import { TIMELAPSE_ACTION } from "../engine/turn";
import { parseOverrides, parseTarget, resolveTarget } from "../engine/time";
import { INTERRUPT_CLASSES, type InterruptClass, type InterruptPolicy } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { DueItem } from "./kit";
import { notAs, type OpContext, type Unread } from "./ops";

/** The arguments of `pass_time` that only a skip the player asked for gives: where it goes, whether their routine runs, what stops it. */
export const PRESS_ARGS = ["target", "routine", "interrupts"] as const;

/** The class of interrupt a thing that falls due is, for those that have one; none for the rest. */
const CLASS_OF_KIND: Readonly<Record<string, InterruptClass>> = { arrival: "arrival", need: "needs", weather: "weather" };

/** The kinds of what falls due that are where a person's routine puts them or what it has them doing: the player's character's are held back when they hold their routine. */
const ROUTINE_KINDS: ReadonlySet<string> = new Set(["place", "activity"]);

/**
 * The arguments of `pass_time` that carry out a timelapse as a sheet presses it (`target`, `overrides`, `followRoutine`, `label`): a
 * duration as its minutes, any other target as it is, what stops it as `interrupts` (always given, which is what has the skip stop where
 * the player set it to), and Follow my routine as `routine`. What `pass_time` reads for itself (`minutes`, `until`, `for`…) goes as it is,
 * the way an Author may have put the span; the label is only the press's own name for itself.
 */
export function timelapsePass(values: JsonObject): JsonObject {
  const out: JsonObject = {};
  const said = values.target;
  const target = parseTarget(said);
  if (target?.type === "duration") out.minutes = target.minutes;
  else if (said !== undefined && said !== null) out.target = target === null ? said : { ...target };
  for (const field of ["minutes", "seconds", "rounds", "for", "until", "at"]) if (values[field] !== undefined && out[field] === undefined) out[field] = values[field];
  const stops = values.interrupts ?? values.overrides;
  out.interrupts = isRecord(stops) ? (stops as JsonObject) : stops === undefined || stops === null ? {} : stops;
  const routine = values.routine ?? values.followRoutine;
  if (routine !== undefined && routine !== null) out.routine = routine;
  return out;
}

/**
 * The `pass_time` operation the Author is told to send for a press of a skip of time (the notices part's `panel_request`): the press's own
 * values as the operation reads them, from the player. None for a press of any other action.
 */
export function timelapseOperation(action: string | null, values: JsonObject): JsonObject | null {
  return action === TIMELAPSE_ACTION ? { op: "pass_time", ...timelapsePass(values), source: { from: "player" } } : null;
}

/** What the clock reads where a sheet's target lands, by the engine's own reading of a target (`resolveTarget`); a target this build cannot run or one that names no time is answered as such. */
export function readTarget(o: OpContext, said: JsonValue): number | Unread {
  const target = parseTarget(said);
  // A stage is reached by the story's own record of it, which nothing runs here.
  if (target === null || target.type === "stage") return notAs(o, "target", said, "timelapse_target");
  const now = o.draft.w.state.clock;
  if (target.type === "duration") return clockPlus(now, target.minutes);
  const resolved = resolveTarget(o.reading.registry, o.draft.w.world, o.draft.w.state, target);
  if ("code" in resolved) {
    o.draft.note(resolved);
    return { line: "not_applicable", fields: { n: o.n, op: o.op, code: resolved.code } };
  }
  // The target as far as it lies: a skip here is not run in steps, so the rest of the way is not left for a Continue.
  return resolved.goal ?? resolved.to;
}

/** What the player set to stop a skip, class by class, over their own settings; none where the call gives no `interrupts`. */
export function readInterrupts(o: OpContext): Record<InterruptClass, InterruptPolicy> | Unread | undefined {
  const said = o.args.interrupts;
  if (said === undefined || said === null) return undefined;
  const given = isRecord(said) ? (said as JsonObject) : null;
  const known = (c: string): c is InterruptClass => (INTERRUPT_CLASSES as readonly string[]).includes(c);
  if (given === null || Object.entries(given).some(([c, p]) => !known(c) || (p !== "stop" && p !== "note" && p !== "ignore"))) return notAs(o, "interrupts", said, "interrupts");
  return interruptPolicy(o.draft.w.state, parseOverrides(given));
}

/** Whether the player's character holds their routine for the skip (`routine` false) or it runs as time passes: the default. */
export function readRoutine(o: OpContext): boolean | Unread | undefined {
  const said = o.args.routine;
  if (said === undefined || said === null || said === "") return undefined;
  return said === true || said === "true" ? true : said === false || said === "false" ? false : notAs(o, "routine", said, "yes_no");
}

/**
 * The first thing in the span, soonest first, of a class the player set to stop a skip, where the player's character is (or at `at`, the part
 * of the tree the call names); none where nothing of that class falls due in it.
 */
export function firstStop(o: OpContext, policy: Readonly<Record<InterruptClass, InterruptPolicy>>, span: { from: number; to: number }, at: string | null): DueItem | undefined {
  if (!INTERRUPT_CLASSES.some((c) => policy[c] === "stop")) return undefined;
  const listing = o.call.deps.due.due(o.reading.state, span, at, o.call.settings.dueItems);
  return listing.items.find((item) => {
    const cls = CLASS_OF_KIND[item.kind];
    return cls !== undefined && policy[cls] === "stop" && item.at > span.from && item.at <= span.to;
  });
}

/** The class of interrupt a thing that falls due is; none for one that has none. */
export function classOf(item: DueItem): InterruptClass | undefined {
  return CLASS_OF_KIND[item.kind];
}

/**
 * What a skip lists of what fell due: not what the player set to be ignored, and, where they hold their routine, not where their own routine
 * would put them or what it would have them doing.
 */
export function listedOf(items: readonly DueItem[], policy: Readonly<Record<InterruptClass, InterruptPolicy>> | undefined, routine: boolean | undefined, pov: string): DueItem[] {
  return items.filter((item) => {
    const cls = CLASS_OF_KIND[item.kind];
    if (policy !== undefined && cls !== undefined && policy[cls] === "ignore") return false;
    return !(routine === false && ROUTINE_KINDS.has(item.kind) && item.who?.includes(pov) === true);
  });
}
